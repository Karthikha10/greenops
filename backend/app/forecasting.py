"""Near-term workload forecasting for idle or underutilized servers.

The model is deliberately separated from the recommendation engine. It answers one
bounded question: given the observed telemetry history, what CPU demand is likely
15 minutes from now? The forecast never authorizes an action by itself.

Training uses only timestamped telemetry already stored in the GreenOps database.
The provided cross-sectional CSV is intentionally not used for lagged forecasting
because it has no timestamped server sequence from which to build honest lags.
"""
from bisect import bisect_left
from collections import defaultdict
from datetime import datetime, timedelta
import json
import math
import os
from typing import Iterable, Optional

import joblib

from . import models, rules_engine

FORECAST_HORIZON_MINUTES = 15
LAG_MINUTES = (5, 10, 15, 20)
MAX_MATCH_GAP_MINUTES = 1.5
LOOKBACK_HOURS = 6
MODEL_FILENAME = "workload_forecast_model.joblib"
METRICS_FILENAME = "forecast_metrics.json"
MODEL_DIR = os.path.join(os.path.dirname(__file__), "ml_artifacts")
MODEL_PATH = os.path.join(MODEL_DIR, MODEL_FILENAME)
METRICS_PATH = os.path.join(MODEL_DIR, METRICS_FILENAME)

# Memory forecast -- same lag-feature approach and training data as the CPU
# forecast (train_workload_forecast.py trains both from the same samples),
# kept as a separate model file/metrics rather than a multi-output model so
# each target's own MAE/RMSE/R2 and selected algorithm stay independently
# visible, same as the CPU/power model split in train_model.py.
MEMORY_MODEL_FILENAME = "workload_forecast_memory_model.joblib"
MEMORY_METRICS_FILENAME = "forecast_memory_metrics.json"
MEMORY_MODEL_PATH = os.path.join(MODEL_DIR, MEMORY_MODEL_FILENAME)
MEMORY_METRICS_PATH = os.path.join(MODEL_DIR, MEMORY_METRICS_FILENAME)

FEATURE_COLUMNS = [
    "cpu_lag_5m",
    "cpu_lag_10m",
    "cpu_lag_15m",
    "cpu_lag_20m",
    "avg_cpu_last_hour",
    "memory_utilization",
    "workload_intensity",
    "network_throughput_gbps",
    "hour_sin",
    "hour_cos",
]


def _as_sorted_rows(rows: Iterable) -> list:
    return sorted(
        [row for row in rows if row.timestamp is not None and row.cpu_utilization is not None],
        key=lambda row: row.timestamp,
    )


def _nearest_row(rows: list, timestamps: list, target: datetime, max_gap_minutes: float = MAX_MATCH_GAP_MINUTES):
    """Return the closest recorded row to target, never inventing an observation."""
    if not rows:
        return None
    position = bisect_left(timestamps, target)
    candidates = []
    if position < len(rows):
        candidates.append(rows[position])
    if position > 0:
        candidates.append(rows[position - 1])
    if not candidates:
        return None
    closest = min(candidates, key=lambda row: abs((row.timestamp - target).total_seconds()))
    if abs((closest.timestamp - target).total_seconds()) > max_gap_minutes * 60:
        return None
    return closest


def _time_features(timestamp: datetime) -> dict:
    minutes = timestamp.hour * 60 + timestamp.minute
    angle = 2 * math.pi * minutes / (24 * 60)
    return {"hour_sin": round(math.sin(angle), 6), "hour_cos": round(math.cos(angle), 6)}


def build_feature_rows(rows: Iterable, horizon_minutes: int = FORECAST_HORIZON_MINUTES) -> list[dict]:
    """Build supervised lagged samples from observed timestamped telemetry.

    A sample is created only when all four lag observations and the future target
    are present within the matching tolerance. This prevents the trainer from
    silently filling gaps with fabricated values.
    """
    by_server = defaultdict(list)
    for row in rows:
        by_server[row.server_id].append(row)

    samples = []
    for server_rows in by_server.values():
        ordered = _as_sorted_rows(server_rows)
        timestamps = [row.timestamp for row in ordered]
        for current in ordered:
            lag_rows = {
                minutes: _nearest_row(
                    ordered,
                    timestamps,
                    current.timestamp - timedelta(minutes=minutes),
                )
                for minutes in LAG_MINUTES
            }
            future = _nearest_row(
                ordered,
                timestamps,
                current.timestamp + timedelta(minutes=horizon_minutes),
            )
            if future is None or any(lag_rows[minutes] is None for minutes in LAG_MINUTES):
                continue

            hour_start = current.timestamp - timedelta(hours=1)
            recent_cpu = [
                row.cpu_utilization
                for row in ordered
                if hour_start <= row.timestamp <= current.timestamp
                and row.cpu_utilization is not None
            ]
            if not recent_cpu:
                continue

            sample = {
                f"cpu_lag_{minutes}m": float(lag_rows[minutes].cpu_utilization)
                for minutes in LAG_MINUTES
            }
            sample.update({
                "avg_cpu_last_hour": sum(recent_cpu) / len(recent_cpu),
                "memory_utilization": float(current.memory_utilization or 0),
                "workload_intensity": float(current.workload_intensity or 0),
                "network_throughput_gbps": float(current.network_throughput_gbps or 0),
                "target_cpu": float(future.cpu_utilization),
                "target_memory": float(future.memory_utilization)
                if future.memory_utilization is not None
                else None,
                "server_id": current.server_id,
                "timestamp": current.timestamp,
            })
            sample.update(_time_features(current.timestamp))
            samples.append(sample)
    return sorted(samples, key=lambda sample: sample["timestamp"])


def build_inference_features(rows: Iterable, as_of: Optional[datetime] = None) -> Optional[dict]:
    """Build the current feature vector for inference, or None when lags are absent."""
    ordered = _as_sorted_rows(rows)
    if not ordered:
        return None
    current = ordered[-1] if as_of is None else min(ordered, key=lambda row: abs((row.timestamp - as_of).total_seconds()))
    timestamps = [row.timestamp for row in ordered]
    lag_rows = {
        minutes: _nearest_row(
            ordered,
            timestamps,
            current.timestamp - timedelta(minutes=minutes),
        )
        for minutes in LAG_MINUTES
    }
    if any(lag_rows[minutes] is None for minutes in LAG_MINUTES):
        return None

    hour_start = current.timestamp - timedelta(hours=1)
    recent_cpu = [
        row.cpu_utilization
        for row in ordered
        if hour_start <= row.timestamp <= current.timestamp and row.cpu_utilization is not None
    ]
    features = {
        f"cpu_lag_{minutes}m": float(lag_rows[minutes].cpu_utilization)
        for minutes in LAG_MINUTES
    }
    features.update({
        "avg_cpu_last_hour": sum(recent_cpu) / len(recent_cpu) if recent_cpu else float(current.cpu_utilization),
        "memory_utilization": float(current.memory_utilization or 0),
        "workload_intensity": float(current.workload_intensity or 0),
        "network_throughput_gbps": float(current.network_throughput_gbps or 0),
    })
    features.update(_time_features(current.timestamp))
    return features


def trend_forecast(
    rows: Iterable,
    horizon_minutes: int = FORECAST_HORIZON_MINUTES,
    field: str = "cpu_utilization",
) -> dict:
    """
    Transparent fallback used until enough live history exists for the model.

    `field` selects which telemetry column to extrapolate -- "cpu_utilization"
    or "memory_utilization" -- since the same simple rate-of-change logic
    applies to either.
    """
    ordered = _as_sorted_rows(rows)
    if not ordered:
        return {"predicted_value": None, "trend": "unknown", "reference_minutes": None}
    current = ordered[-1]
    current_value = getattr(current, field)
    timestamps = [row.timestamp for row in ordered]
    reference = _nearest_row(
        ordered,
        timestamps,
        current.timestamp - timedelta(minutes=horizon_minutes),
        max_gap_minutes=3,
    )
    if reference is None or reference.timestamp == current.timestamp:
        return {
            "predicted_value": round(float(current_value), 2),
            "trend": "stable",
            "reference_minutes": None,
        }
    reference_value = getattr(reference, field)
    elapsed_minutes = (current.timestamp - reference.timestamp).total_seconds() / 60
    rate_per_minute = (current_value - reference_value) / elapsed_minutes
    predicted = max(0.0, min(100.0, current_value + rate_per_minute * horizon_minutes))
    trend = "rising" if rate_per_minute > 0.05 else "falling" if rate_per_minute < -0.05 else "stable"
    return {
        "predicted_value": round(float(predicted), 2),
        "trend": trend,
        "reference_minutes": round(elapsed_minutes, 1),
    }


def idle_eligibility(db, server_id: str) -> dict:
    """Apply the same six-hour, per-server-type rule used by the flags engine."""
    server = db.query(models.Server).filter(models.Server.server_id == server_id).first()
    if server is None:
        return {"eligible": False, "reason": "Server is not registered."}

    cutoff = datetime.utcnow() - timedelta(hours=LOOKBACK_HOURS)
    rows = (
        db.query(models.ServerTelemetry)
        .filter(
            models.ServerTelemetry.server_id == server_id,
            models.ServerTelemetry.timestamp >= cutoff,
        )
        .all()
    )
    if not rows:
        return {"eligible": False, "reason": "No recent server telemetry is available."}

    avg_cpu = sum(row.cpu_utilization for row in rows) / len(rows)
    threshold = rules_engine.get_idle_threshold(server.server_type)
    eligible = avg_cpu < threshold
    return {
        "eligible": eligible,
        "reason": (
            f"Average CPU {avg_cpu:.1f}% is below the {server.server_type} threshold of {threshold:.1f}%."
            if eligible
            else f"Forecasting is restricted to idle/underutilized servers; average CPU {avg_cpu:.1f}% is at or above the {server.server_type} threshold of {threshold:.1f}%."
        ),
        "avg_cpu": round(avg_cpu, 2),
        "idle_threshold": round(threshold, 2),
        "lookback_hours": LOOKBACK_HOURS,
    }


def load_forecast_model():
    if not os.path.exists(MODEL_PATH):
        return None
    return joblib.load(MODEL_PATH)


def load_forecast_metrics() -> dict:
    if not os.path.exists(METRICS_PATH):
        return {}
    with open(METRICS_PATH) as file:
        return json.load(file)


def load_forecast_memory_model():
    if not os.path.exists(MEMORY_MODEL_PATH):
        return None
    return joblib.load(MEMORY_MODEL_PATH)


def load_forecast_memory_metrics() -> dict:
    if not os.path.exists(MEMORY_METRICS_PATH):
        return {}
    with open(MEMORY_METRICS_PATH) as file:
        return json.load(file)


def forecast_server(db, server_id: str, horizon_minutes: int = FORECAST_HORIZON_MINUTES) -> dict:
    eligibility = idle_eligibility(db, server_id)
    if not eligibility["eligible"]:
        return {
            "server_id": server_id,
            "horizon_minutes": horizon_minutes,
            **eligibility,
        }

    rows = (
        db.query(models.ServerTelemetry)
        .filter(models.ServerTelemetry.server_id == server_id)
        .order_by(models.ServerTelemetry.timestamp.asc())
        .all()
    )
    model = load_forecast_model()
    metrics = load_forecast_metrics()
    live_features = build_inference_features(rows)
    method = "trend_extrapolation"
    model_version = None
    validation = {}

    predicted_cpu = None
    if model is not None and live_features is not None and horizon_minutes == FORECAST_HORIZON_MINUTES:
        predicted_cpu = float(model.predict([[live_features[column] for column in FEATURE_COLUMNS]])[0])
        predicted_cpu = max(0.0, min(100.0, predicted_cpu))
        method = metrics.get("selected_model", "lagged_model")
        model_version = metrics.get("model_version", "workload-forecast-v1")
        validation = metrics.get("selected_metrics", {})
    else:
        fallback = trend_forecast(rows, horizon_minutes=horizon_minutes, field="cpu_utilization")
        predicted_cpu = fallback["predicted_value"]
        method = "trend_extrapolation"
        trend = fallback["trend"]

    current = rows[-1]
    if method != "trend_extrapolation":
        trend = "rising" if predicted_cpu > current.cpu_utilization + 0.5 else "falling" if predicted_cpu < current.cpu_utilization - 0.5 else "stable"

    mae = validation.get("MAE")
    confidence_proxy = round(max(0.0, min(0.99, 1 - float(mae) / 100)) if mae is not None else 0.5, 2)
    return {
        "server_id": server_id,
        "eligible": True,
        "reason": eligibility["reason"],
        "avg_cpu_lookback": eligibility["avg_cpu"],
        "idle_threshold": eligibility["idle_threshold"],
        "horizon_minutes": horizon_minutes,
        "measured_cpu": round(float(current.cpu_utilization), 2),
        "predicted_cpu": round(float(predicted_cpu), 2),
        "predicted_workload": round(float(predicted_cpu) / 100, 4),
        "delta_cpu_pp": round(float(predicted_cpu) - float(current.cpu_utilization), 2),
        "trend": trend,
        "method": method,
        "model_version": model_version,
        "confidence_proxy": confidence_proxy,
        "validation_mae": validation.get("MAE"),
        "validation_rmse": validation.get("RMSE"),
        "validation_r2": validation.get("R2"),
        "source_observations": len(rows),
        "generated_at": datetime.utcnow().isoformat(),
        "model_ready": model is not None and live_features is not None and horizon_minutes == FORECAST_HORIZON_MINUTES,
    }


def forecast_candidate_server(
    db, server_id: str, horizon_minutes: int = FORECAST_HORIZON_MINUTES
) -> dict:
    """
    Forecast a consolidation TARGET candidate's own near-term CPU and memory.

    forecast_server() above answers "will this already-idle server stay
    idle" and is gated on idle_eligibility() -- a candidate target is by
    definition NOT idle (that's what makes it a viable target), so it could
    never pass that gate. This answers the mirror-image question instead:
    "will this busy-but-not-full server still have headroom soon," with no
    idle gate at all -- any registered server with enough telemetry history
    is eligible here.

    Reuses the exact same trained CPU model as forecast_server(): the
    training data in build_feature_rows() was never restricted to idle
    servers in the first place, so the same model already generalizes to
    busy servers. Memory uses its own model trained the same way (see
    train_workload_forecast.py) since the CPU model only ever predicted CPU.

    Returns predicted CPU and memory 15 minutes out. Used by
    recommendations.py's candidate safety check to catch a target that
    looks safe RIGHT NOW but is about to get busy on its own, before any
    workload is even moved onto it.
    """
    server = db.query(models.Server).filter(models.Server.server_id == server_id).first()
    if server is None:
        return {"eligible": False, "reason": "Server is not registered."}

    rows = (
        db.query(models.ServerTelemetry)
        .filter(models.ServerTelemetry.server_id == server_id)
        .order_by(models.ServerTelemetry.timestamp.asc())
        .all()
    )
    if not rows:
        return {"eligible": False, "reason": "No telemetry available for this candidate."}

    current = rows[-1]
    live_features = build_inference_features(rows)
    use_model = live_features is not None and horizon_minutes == FORECAST_HORIZON_MINUTES

    cpu_model = load_forecast_model() if use_model else None
    memory_model = load_forecast_memory_model() if use_model else None
    cpu_metrics = load_forecast_metrics()
    memory_metrics = load_forecast_memory_metrics()

    if cpu_model is not None:
        predicted_cpu = float(
            cpu_model.predict([[live_features[column] for column in FEATURE_COLUMNS]])[0]
        )
        predicted_cpu = max(0.0, min(100.0, predicted_cpu))
        cpu_method = cpu_metrics.get("selected_model", "lagged_model")
    else:
        fallback = trend_forecast(rows, horizon_minutes=horizon_minutes, field="cpu_utilization")
        predicted_cpu = fallback["predicted_value"]
        cpu_method = "trend_extrapolation"

    if memory_model is not None:
        predicted_memory = float(
            memory_model.predict([[live_features[column] for column in FEATURE_COLUMNS]])[0]
        )
        predicted_memory = max(0.0, min(100.0, predicted_memory))
        memory_method = memory_metrics.get("selected_model", "lagged_model")
    else:
        fallback = trend_forecast(rows, horizon_minutes=horizon_minutes, field="memory_utilization")
        predicted_memory = fallback["predicted_value"]
        memory_method = "trend_extrapolation"

    if predicted_cpu is None or predicted_memory is None:
        return {
            "eligible": False,
            "reason": "Not enough history yet to forecast this candidate.",
        }

    return {
        "server_id": server_id,
        "eligible": True,
        "horizon_minutes": horizon_minutes,
        "measured_cpu": round(float(current.cpu_utilization), 2),
        "predicted_cpu": round(float(predicted_cpu), 2),
        "measured_memory": round(float(current.memory_utilization), 2),
        "predicted_memory": round(float(predicted_memory), 2),
        "cpu_method": cpu_method,
        "memory_method": memory_method,
        "model_ready": cpu_model is not None and memory_model is not None,
        "source_observations": len(rows),
    }
