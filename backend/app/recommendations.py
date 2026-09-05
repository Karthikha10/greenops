"""
GreenOps Recommendation Engine.

Converts active rule-based flags into operator-facing recommendations,
estimates the impact of acting on them (including, for consolidation, an
actual candidate-target simulation with a safety check), and ranks pending
recommendations using organization-configurable weights.

This module does NOT perform infrastructure changes.
It only recommends, estimates, and records operator decisions.
"""

from datetime import datetime, timedelta

import pandas as pd
from sqlalchemy.orm import Session

from . import models, rules_engine


# ------------------------------------------------------------
# Recommendation mapping
# ------------------------------------------------------------

RECOMMENDATION_MAP = {
    "idle_server": {
        "type": "consolidate",
        "title": "Consolidate workload",
    },

    "stale_data": {
        "type": "archive",
        "title": "Archive stale data",
    },

    "duplicate_data": {
        "type": "deduplicate",
        "title": "Deduplicate storage",
    },

    "overprovisioned": {
        "type": "rightsize",
        "title": "Rightsize storage",
    },
}


# ------------------------------------------------------------
# Priority (severity-derived label, unchanged -- still shown on the card)
# ------------------------------------------------------------

PRIORITY_RANK = {
    "high": 3,
    "medium": 2,
    "low": 1,
}


def calculate_priority(flag):
    """
    Priority is primarily based on the severity assigned by
    the rule engine.

    A high severity flag becomes a high priority recommendation.
    """

    severity = (flag.severity or "low").lower()

    if severity == "high":
        return "high"

    if severity == "medium":
        return "medium"

    return "low"


# ------------------------------------------------------------
# Create / update recommendations
# ------------------------------------------------------------

def sync_recommendations(db: Session):
    """
    Convert every active Flag into a Recommendation.

    Existing recommendations are updated instead of duplicated. A snoozed
    recommendation whose snooze window has passed is reopened as pending so
    the underlying waste isn't silently forgotten.
    """

    active_flags = (
        db.query(models.Flag)
        .filter(models.Flag.resolved == 0)
        .order_by(models.Flag.created_at.desc())
        .all()
    )

    created = 0
    updated = 0
    now = datetime.utcnow()

    for flag in active_flags:

        mapping = RECOMMENDATION_MAP.get(flag.flag_type)

        if not mapping:
            continue

        recommendation = (
            db.query(models.Recommendation)
            .filter(
                models.Recommendation.flag_id == flag.id
            )
            .first()
        )

        priority = calculate_priority(flag)

        explanation = flag.detail or ""

        if recommendation:

            recommendation.server_id = flag.server_id
            recommendation.recommendation_type = mapping["type"]
            recommendation.priority = priority
            recommendation.title = mapping["title"]
            recommendation.explanation = explanation

            # A snooze that has expired reopens as pending. Accepted/rejected
            # decisions, and snoozes still in their window, are left alone.
            if recommendation.status == "snoozed" and (
                recommendation.snoozed_until is None or recommendation.snoozed_until <= now
            ):
                recommendation.status = "pending"
                recommendation.snoozed_until = None
            elif recommendation.status not in ("accepted", "rejected", "snoozed"):
                recommendation.status = "pending"

            updated += 1

        else:

            recommendation = models.Recommendation(
                flag_id=flag.id,
                server_id=flag.server_id,
                recommendation_type=mapping["type"],
                priority=priority,
                title=mapping["title"],
                explanation=explanation,
                status="pending",
            )

            db.add(recommendation)
            created += 1

    # _upsert_flag() creates a NEW Flag row (new id) whenever a condition
    # re-triggers after previously resolving -- so a server that flips
    # idle/healthy/idle repeatedly ends up with several Flag rows over time,
    # only the newest of which is active. Without this pass, the OLDER
    # recommendations (tied to now-resolved flags) never got cleaned up and
    # piled up as stale duplicates for the same server. Withdraw any pending
    # recommendation whose flag is no longer active.
    active_flag_ids = [flag.id for flag in active_flags]
    withdrawn = (
        db.query(models.Recommendation)
        .filter(
            models.Recommendation.status == "pending",
            ~models.Recommendation.flag_id.in_(active_flag_ids),
        )
        .all()
    )
    for recommendation in withdrawn:
        recommendation.status = "withdrawn"

    db.commit()

    return {
        "created": created,
        "updated": updated,
        "withdrawn": len(withdrawn),
    }


# ------------------------------------------------------------
# What-if calculations
# ------------------------------------------------------------

TARIFF_PER_KWH = 8.0

CARBON_INTENSITY_KG_PER_KWH = 0.5

# How much of the source server's load a target absorbs when workload is
# actually moved. Real migrations rarely add load 1:1 -- some of it is
# eliminated (deduped connections, shared caches) -- so this sits inside the
# 0.85-0.95 range from the roadmap rather than assuming a full 1:1 transfer.
CONSOLIDATION_OVERHEAD_FACTOR = 0.9

# A candidate target must stay under this utilization after absorbing the
# source's load, on both CPU and memory, to be considered safe. Network
# throughput is reported for context but NOT used as a hard safety gate --
# there's no declared per-server network capacity anywhere in the schema, so
# inventing a cap to check against would be less honest than leaving it out.
SAFETY_LIMIT_PERCENT = 75.0

# Storage-only actions (archive/deduplicate/rightsize) don't have a target
# server or a power effect to model, so they carry a small fixed risk
# instead of a computed one -- freeing storage doesn't touch a running
# workload the way moving one does.
STORAGE_ACTION_RISK = 0.1


def _latest(db: Session, model, server_id: str):
    return (
        db.query(model)
        .filter(model.server_id == server_id)
        .order_by(model.timestamp.desc())
        .first()
    )


def _actively_idle_server_ids(db: Session) -> set:
    """Servers currently carrying an unresolved idle_server flag -- never a
    valid consolidation target, since they're the same kind of waste."""
    rows = (
        db.query(models.Flag.server_id)
        .filter(models.Flag.flag_type == "idle_server", models.Flag.resolved == 0)
        .all()
    )
    return {row[0] for row in rows}


def _predict_power_kw(power_model, server_meta, cooling, pue, cpu_value, memory_value, network_value, workload_value):
    """Reuse the trained power model exactly as /servers/{id}/prediction does."""
    if power_model is None or cooling is None:
        return None
    features = pd.DataFrame([{
        "workload_intensity": workload_value,
        "memory_utilization": memory_value,
        "network_throughput_gbps": network_value,
        "inlet_temperature_c": cooling.inlet_temperature_c,
        "cooling_efficiency": cooling.cooling_efficiency,
        "pue": pue,
        "server_type": server_meta.server_type,
        "cooling_type": server_meta.cooling_type,
        "datacenter_region": server_meta.datacenter_region,
        "time_of_day": "Peak",
        "cpu_utilization": cpu_value,
    }])
    return float(power_model.predict(features)[0])


def _rank_consolidation_candidates(db: Session, source_server, source_telemetry):
    """
    Implements the roadmap's what-if algorithm: candidates are same-type
    servers that aren't themselves idle; each is checked for whether it can
    safely absorb the source's load. Returns EVERY candidate considered,
    ranked safe-first then by most headroom left afterward -- not just the
    single winner -- so an operator can see what else was considered and
    why one candidate beat the others, not just take the answer on faith.
    """
    idle_ids = _actively_idle_server_ids(db)

    candidates = (
        db.query(models.Server)
        .filter(
            models.Server.server_type == source_server.server_type,
            models.Server.server_id != source_server.server_id,
        )
        .all()
    )

    ranked = []
    for candidate in candidates:
        if candidate.server_id in idle_ids:
            continue  # already flagged as its own kind of waste -- never a valid target

        target_telemetry = _latest(db, models.ServerTelemetry, candidate.server_id)
        if target_telemetry is None:
            continue

        post_move_cpu = target_telemetry.cpu_utilization + source_telemetry.cpu_utilization * CONSOLIDATION_OVERHEAD_FACTOR
        post_move_memory = target_telemetry.memory_utilization + source_telemetry.memory_utilization * CONSOLIDATION_OVERHEAD_FACTOR
        safe = post_move_cpu < SAFETY_LIMIT_PERCENT and post_move_memory < SAFETY_LIMIT_PERCENT
        headroom_used = max(post_move_cpu, post_move_memory)

        ranked.append({
            "server": candidate,
            "telemetry": target_telemetry,
            "post_move_cpu": post_move_cpu,
            "post_move_memory": post_move_memory,
            "safe": safe,
            "headroom_used": headroom_used,
        })

    # Safe candidates first (most headroom left = lowest resulting utilization
    # = best), then unsafe ones after, for transparency about what was ruled out.
    ranked.sort(key=lambda c: (not c["safe"], c["headroom_used"]))
    return ranked


def calculate_what_if(db: Session, recommendation, power_model=None):
    """
    Estimate the environmental and resource impact of applying a
    recommendation. This is a decision-support estimate only -- no physical
    infrastructure changes are performed.
    """

    server_id = recommendation.server_id

    result = {
        "recommendation_id": recommendation.id,
        "server_id": server_id,
        "action": recommendation.recommendation_type,

        "estimated_energy_saving_kwh": 0.0,
        "estimated_carbon_reduction_kg": 0.0,
        "estimated_cost_saving": 0.0,
        "estimated_storage_reclaimed_gb": 0.0,

        "target_server_id": None,
        "safe": None,
        "risk_score": None,

        "assumptions": [],
    }

    # ========================================================
    # CONSOLIDATION -- real target-candidate simulation
    # ========================================================

    if recommendation.recommendation_type == "consolidate":

        source_server = db.query(models.Server).filter(models.Server.server_id == server_id).first()
        source_telemetry = _latest(db, models.ServerTelemetry, server_id)
        source_power = _latest(db, models.PowerTelemetry, server_id)

        if source_server is None or source_telemetry is None:
            result["safe"] = False
            result["assumptions"].append("Not enough telemetry for this server to evaluate a move.")
            return result

        ranked = _rank_consolidation_candidates(db, source_server, source_telemetry)

        # Expose every candidate considered, not just the winner -- ranked
        # safe-first then by headroom, capped to a reasonable number to show.
        result["candidates"] = [
            {
                "server_id": c["server"].server_id,
                "safe": c["safe"],
                "post_move_cpu": round(c["post_move_cpu"], 2),
                "post_move_memory": round(c["post_move_memory"], 2),
            }
            for c in ranked[:5]
        ]

        safe_candidates = [c for c in ranked if c["safe"]]

        if not safe_candidates:
            result["safe"] = False
            result["risk_score"] = 1.0
            if ranked:
                result["assumptions"].append(
                    f"{len(ranked)} same-type server(s) considered, but none has headroom to absorb "
                    f"this workload without crossing {SAFETY_LIMIT_PERCENT:.0f}% CPU or memory -- "
                    "rejected, not recommended to act on."
                )
            else:
                result["assumptions"].append(
                    f"No other {source_server.server_type} server exists to evaluate as a target -- "
                    "rejected, not recommended to act on."
                )
            return result

        best = safe_candidates[0]
        target, target_telemetry, post_move_cpu, post_move_memory = (
            best["server"], best["telemetry"], best["post_move_cpu"], best["post_move_memory"],
        )

        result["target_server_id"] = target.server_id
        result["safe"] = True
        result["risk_score"] = round(max(post_move_cpu, post_move_memory) / SAFETY_LIMIT_PERCENT, 2)
        result["post_move_cpu"] = round(post_move_cpu, 2)
        result["post_move_memory"] = round(post_move_memory, 2)

        target_power = _latest(db, models.PowerTelemetry, target.server_id)
        target_cooling = _latest(db, models.CoolingTelemetry, target.server_id)

        if source_power and target_power:
            energy_before_kwh = float(source_power.facility_power_kw or 0) + float(target_power.facility_power_kw or 0)

            # Primary estimate: scale the TARGET's own current facility power
            # by its post-move CPU ratio. This stays on live telemetry's
            # scale throughout. We deliberately do NOT feed the trained power
            # model's raw output into this number -- that model was trained
            # on the historical dataset (tens of kW per reading) and, exactly
            # as documented on the Server Detail page, its absolute magnitude
            # doesn't match live simulated telemetry (single-digit kW). Using
            # it here would silently propagate that mismatch into a dollar
            # figure instead of just showing it as a number to eyeball.
            cpu_ratio = post_move_cpu / target_telemetry.cpu_utilization if target_telemetry.cpu_utilization else 1
            predicted_after_kw = float(target_power.facility_power_kw or 0) * cpu_ratio
            energy_saved = max(0.0, energy_before_kwh - predicted_after_kw)

            result["estimated_energy_saving_kwh"] = round(energy_saved, 2)
            result["estimated_carbon_reduction_kg"] = round(energy_saved * CARBON_INTENSITY_KG_PER_KWH, 2)
            result["estimated_cost_saving"] = round(energy_saved * TARIFF_PER_KWH, 2)

            water_factor = rules_engine.WUE_FACTORS.get(source_server.cooling_type, 0.5)
            result["estimated_water_saving_l"] = round(energy_saved * water_factor, 2)

            result["assumptions"].append(
                f"Estimated over one hour: moving {server_id}'s load onto {target.server_id} "
                f"(same type, {CONSOLIDATION_OVERHEAD_FACTOR}x overhead factor) would leave it at "
                f"{post_move_cpu:.0f}% CPU / {post_move_memory:.0f}% memory -- under the "
                f"{SAFETY_LIMIT_PERCENT:.0f}% safety limit."
            )
            result["assumptions"].append(
                f"Energy saving scales {target.server_id}'s own current facility power "
                f"({target_power.facility_power_kw:.2f} kW) by its post-move CPU ratio, "
                "not the trained power model -- that model's absolute scale doesn't match "
                "live simulated telemetry (see Model Eval / Server Detail for that gap)."
            )
            result["assumptions"].append(
                f"Water saving assumes {server_id}'s cooling load ({source_server.cooling_type}, "
                f"{water_factor} L/kWh) is freed along with its energy use."
            )

            # Trained power model's own prediction, shown for transparency
            # only -- never used in the estimate above, for the reason
            # stated there.
            if power_model is not None and target_cooling is not None:
                target_pue = rules_engine.compute_pue(target_power.it_power_kw, target_power.facility_power_kw)
                predicted_it_kw = _predict_power_kw(
                    power_model, target, target_cooling, pue=target_pue,
                    cpu_value=post_move_cpu,
                    memory_value=post_move_memory,
                    network_value=(target_telemetry.network_throughput_gbps or 0)
                    + (source_telemetry.network_throughput_gbps or 0) * CONSOLIDATION_OVERHEAD_FACTOR,
                    workload_value=min(1.0, (target_telemetry.workload_intensity or 0)
                                        + (source_telemetry.workload_intensity or 0) * CONSOLIDATION_OVERHEAD_FACTOR),
                )
                if predicted_it_kw is not None:
                    result["model_predicted_target_it_power_kw"] = round(predicted_it_kw, 2)

        return result

    # ========================================================
    # RIGHTSIZING / ARCHIVE / DEDUPLICATE -- storage only, no target
    # ========================================================

    if recommendation.recommendation_type in ("rightsize", "archive", "deduplicate"):

        flag = (
            db.query(models.Flag)
            .filter(models.Flag.id == recommendation.flag_id)
            .first()
        )

        if flag:
            reclaimable = float(flag.metric_value or 0)
            result["estimated_storage_reclaimed_gb"] = round(reclaimable, 2)
            result["risk_score"] = STORAGE_ACTION_RISK
            result["safe"] = True

            reason_by_type = {
                "rightsize": "Estimated reclaimable capacity is based on allocated storage that is currently unused.",
                "archive": "Estimated reclaimable storage is based on the stale-data volume identified by the rule engine.",
                "deduplicate": "Estimated reclaimable storage is based on detected duplicate-data volume.",
            }
            result["assumptions"].append(reason_by_type[recommendation.recommendation_type])
            result["assumptions"].append(
                "No energy/carbon/water effect is modeled for storage-only actions -- freeing "
                "capacity doesn't change a server's power draw in this system."
            )

        return result

    return result


# ------------------------------------------------------------
# Scoring / ranking
# ------------------------------------------------------------

def get_preferences(db: Session) -> models.Preferences:
    prefs = db.query(models.Preferences).filter(models.Preferences.id == 1).first()
    if prefs is None:
        prefs = models.Preferences(id=1)
        db.add(prefs)
        db.commit()
        db.refresh(prefs)
    return prefs


def _normalize(value: float, max_value: float) -> float:
    if not max_value or max_value <= 0:
        return 0.0
    return max(0.0, min(1.0, value / max_value))


def rank_recommendations(rows_with_impact: list, preferences: models.Preferences) -> list:
    """
    Score each (recommendation, impact) pair using the org's configured
    weights, normalizing each impact dimension against the max seen in this
    batch so no single unit (kWh vs kg vs GB) silently dominates just
    because its raw numbers happen to be larger.
    """
    max_energy = max((r["impact"]["estimated_energy_saving_kwh"] for r in rows_with_impact), default=0)
    max_cost = max((r["impact"]["estimated_cost_saving"] for r in rows_with_impact), default=0)
    max_carbon = max((r["impact"]["estimated_carbon_reduction_kg"] for r in rows_with_impact), default=0)
    max_water = max((r["impact"].get("estimated_water_saving_l", 0) for r in rows_with_impact), default=0)

    for entry in rows_with_impact:
        impact = entry["impact"]
        risk = impact.get("risk_score")
        risk = 0.5 if risk is None else risk

        score = (
            preferences.energy_weight * _normalize(impact["estimated_energy_saving_kwh"], max_energy)
            + preferences.cost_weight * _normalize(impact["estimated_cost_saving"], max_cost)
            + preferences.carbon_weight * _normalize(impact["estimated_carbon_reduction_kg"], max_carbon)
            + preferences.water_weight * _normalize(impact.get("estimated_water_saving_l", 0), max_water)
            - preferences.risk_weight * risk
        )
        entry["score"] = round(score, 3)

    rows_with_impact.sort(key=lambda entry: entry["score"], reverse=True)
    return rows_with_impact


def get_recommendations(db: Session, include_completed=False, power_model=None):
    """
    Returns pending (or all, if include_completed) recommendations with
    their computed impact/risk/score attached, ordered by score.
    """

    sync_recommendations(db)

    query = db.query(models.Recommendation)

    if not include_completed:
        query = query.filter(models.Recommendation.status == "pending")

    rows = query.all()
    preferences = get_preferences(db)

    enriched = []
    for row in rows:
        impact = calculate_what_if(db, row, power_model=power_model)
        enriched.append({"recommendation": row, "impact": impact})

    return rank_recommendations(enriched, preferences)


# ------------------------------------------------------------
# Operator decision
# ------------------------------------------------------------

def record_operator_action(
    db: Session,
    recommendation,
    action: str,
    notes=None,
    snooze_hours: float = 24,
    power_model=None,
):
    """
    Record the operator's decision on a recommendation.

    Supported operator actions:
        - consolidate
        - rightsize
        - snooze
        - do_nothing

    This records the decision only.
    It does NOT perform any physical infrastructure change.
    """

    valid_actions = {
        "consolidate",
        "rightsize",
        "snooze",
        "do_nothing",
    }

    if action not in valid_actions:
        raise ValueError(
            "Invalid operator action. "
            "Choose consolidate, rightsize, snooze, or do_nothing."
        )

    if action == "consolidate":
        if recommendation.recommendation_type != "consolidate":
            raise ValueError("Consolidate action is only valid for consolidation recommendations.")
        recommendation.status = "accepted"
        recommendation.decided_at = datetime.utcnow()

    elif action == "rightsize":
        if recommendation.recommendation_type not in ("rightsize", "archive", "deduplicate"):
            raise ValueError("Rightsize action is only valid for storage recommendations.")
        recommendation.status = "accepted"
        recommendation.decided_at = datetime.utcnow()

    elif action == "snooze":
        recommendation.status = "snoozed"
        recommendation.snoozed_until = datetime.utcnow() + timedelta(hours=snooze_hours)

    elif action == "do_nothing":
        recommendation.status = "rejected"
        recommendation.decided_at = datetime.utcnow()

    # Snapshot the impact estimate at the moment of decision, so the
    # decision log reflects what was actually shown to the operator.
    impact = calculate_what_if(db, recommendation, power_model=power_model)

    operator_action = models.OperatorAction(
        recommendation_id=recommendation.id,
        server_id=recommendation.server_id,
        action=action,
        notes=notes,
        estimated_energy_saving_kwh=impact.get("estimated_energy_saving_kwh"),
        estimated_carbon_reduction_kg=impact.get("estimated_carbon_reduction_kg"),
        estimated_cost_saving=impact.get("estimated_cost_saving"),
        estimated_storage_reclaimed_gb=impact.get("estimated_storage_reclaimed_gb"),
        target_server_id=impact.get("target_server_id"),
    )

    db.add(operator_action)

    db.commit()
    db.refresh(operator_action)

    return operator_action
