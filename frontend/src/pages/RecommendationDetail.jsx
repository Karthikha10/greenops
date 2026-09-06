import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api from "../api";


function typeLabel(type) {
  return (
    {
      consolidate: "Consolidate workload",
      rightsize: "Rightsize storage",
      archive: "Archive stale data",
      deduplicate: "Deduplicate storage",
    }[type] || type
  );
}


function acceptActionFor(type) {
  return type === "consolidate" ? "consolidate" : "rightsize";
}


function acceptLabelFor(type) {
  return (
    {
      consolidate: "Consolidate",
      rightsize: "Rightsize",
      archive: "Archive",
      deduplicate: "Deduplicate",
    }[type] || "Accept"
  );
}


function formatValue(value, suffix = "") {
  if (value === null || value === undefined) {
    return "—";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "—";
  }

  return `${number.toFixed(2)}${suffix}`;
}


function candidateReason(candidate, isSelected) {
  if (isSelected) {
    return candidate.forecast_available
      ? "Selected because it is the highest-ranked safe target " +
          "with the most remaining CPU/memory headroom, now and by " +
          "its own near-term forecast."
      : "Selected because it is the highest-ranked safe target " +
          "with the most remaining CPU/memory headroom, based on its " +
          "current load -- not enough history yet for a near-term " +
          "forecast on this candidate.";
  }

  if (candidate.safe) {
    return (
      "Safe target, but ranked below the selected server because " +
      "it leaves less headroom after the workload move."
    );
  }

  if (candidate.safe_now && !candidate.safe_forecast) {
    return (
      "Looks safe right now, but this server's own near-term " +
      `forecast (independent of this move) predicts ${candidate.forecast_predicted_cpu}% CPU / ` +
      `${candidate.forecast_predicted_memory}% memory soon -- combined with this workload, that ` +
      "would cross the 75% safety limit, so it's rejected."
    );
  }

  return (
    "Not suitable because CPU or memory would reach/exceed " +
    "the 75% safety limit after the workload move."
  );
}


export default function RecommendationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [rec, setRec] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);


  const load = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.recommendation(id);

      setRec(response.data);
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        "Recommendation not found."
      );

      setRec(null);
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    load();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);


  const handleAction = async (
    action,
    snoozeHours
  ) => {
    try {
      setActionLoading(true);
      setError("");

      await api.recommendationAction(
        id,
        action,
        "",
        snoozeHours
      );

      navigate("/recommendations");

    } catch (err) {
      setError(
        err.response?.data?.detail ||
        "Failed to record decision."
      );
    } finally {
      setActionLoading(false);
    }
  };


  if (loading) {
    return (
      <div>

        <Link
          to="/recommendations"
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            textDecoration: "none",
          }}
        >
          ← Recommendations
        </Link>

        <div
          className="empty-state"
          style={{ marginTop: 16 }}
        >
          Loading recommendation...
        </div>

      </div>
    );
  }


  if (!rec) {
    return (
      <div>

        <Link
          to="/recommendations"
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            textDecoration: "none",
          }}
        >
          ← Recommendations
        </Link>

        <div
          className="empty-state"
          style={{ marginTop: 16 }}
        >
          {error || "Recommendation not found."}
        </div>

      </div>
    );
  }


  const impact = rec.impact || {};

  const isConsolidate =
    rec.recommendation_type === "consolidate";

  const rejected =
    isConsolidate &&
    impact.safe === false;

  const candidates =
    impact.candidates || [];

  const selectedCandidate =
    candidates.find(
      (c) =>
        c.server_id ===
        impact.target_server_id
    ) || null;


  return (
    <div>

      {/* -------------------------------------------------- */}
      {/* BACK */}
      {/* -------------------------------------------------- */}

      <Link
        to="/recommendations"
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          textDecoration: "none",
        }}
      >
        ← Recommendations
      </Link>


      {/* -------------------------------------------------- */}
      {/* HEADER */}
      {/* -------------------------------------------------- */}

      <div
        className="page-header"
        style={{ marginTop: 6 }}
      >

        <div>

          <p className="page-title">
            {typeLabel(
              rec.recommendation_type
            )}
          </p>

          <p className="page-subtitle">

            Server{" "}

            <Link
              to={`/servers/${rec.server_id}`}
              className="server-link"
            >
              {rec.server_id}
            </Link>

            {" "}· Flagged{" "}

            {rec.created_at
              ? new Date(
                  rec.created_at.endsWith("Z")
                    ? rec.created_at
                    : `${rec.created_at}Z`
                ).toLocaleString()
              : "—"}

          </p>

        </div>

        <span
          className={`badge ${rec.priority}`}
          style={{ fontSize: 13 }}
        >
          {rec.priority} priority
        </span>

      </div>


      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}


      {/* -------------------------------------------------- */}
      {/* WHY FLAGGED */}
      {/* -------------------------------------------------- */}

      <div
        className="card"
        style={{ marginBottom: 16 }}
      >

        <p className="card-title">
          Why this was flagged
        </p>

        <p
          style={{
            fontSize: 14.5,
            lineHeight: 1.6,
            color: "var(--text-secondary)",
          }}
        >
          {rec.explanation}
        </p>

      </div>


      {/* ================================================== */}
      {/* CONSOLIDATION CANDIDATES */}
      {/* ================================================== */}

      {isConsolidate && (
        <div
          className="card"
          style={{ marginBottom: 16 }}
        >

          <p className="card-title">
            Candidate targets, ranked
          </p>

          <p className="card-subtitle">

            Same-type servers are evaluated as possible
            workload targets. Safe candidates are ranked
            first by the amount of CPU/memory headroom
            remaining after the move.

          </p>


          {candidates.length === 0 ? (

            <div className="empty-state">
              No other same-type server exists to
              evaluate as a target.
            </div>

          ) : (

            <div
              style={{
                overflowX: "auto",
              }}
            >

              <table className="data-table">

                <thead>

                  <tr>

                    <th>Rank</th>

                    <th>Server</th>

                    <th>Status</th>

                    <th>Current CPU</th>

                    <th>Post-move CPU</th>

                    <th>Current memory</th>

                    <th>Post-move memory</th>

                    <th>Why this target?</th>

                  </tr>

                </thead>


                <tbody>

                  {candidates.map(
                    (c, i) => {

                      const isSelected =
                        c.server_id ===
                        impact.target_server_id;

                      return (

                        <tr
                          key={c.server_id}
                          style={
                            isSelected
                              ? {
                                  background:
                                    "var(--page-bg)",
                                }
                              : undefined
                          }
                        >

                          {/* Rank */}

                          <td className="row-title">
                            #{i + 1}
                          </td>


                          {/* Server */}

                          <td>

                            <Link
                              to={`/servers/${c.server_id}`}
                              className="server-link"
                            >
                              {c.server_id}
                            </Link>

                            {isSelected && (
                              <span
                                className="badge good"
                                style={{
                                  marginLeft: 8,
                                }}
                              >
                                Selected
                              </span>
                            )}

                          </td>


                          {/* Status */}

                          <td>

                            <span
                              className={`badge ${
                                c.safe
                                  ? "good"
                                  : c.safe_now && !c.safe_forecast
                                  ? "warn"
                                  : "danger"
                              }`}
                            >
                              {c.safe
                                ? "Safe"
                                : c.safe_now && !c.safe_forecast
                                ? "Risky soon"
                                : "Over limit"}
                            </span>

                          </td>


                          {/* Current CPU */}

                          <td>
                            {formatValue(
                              c.current_cpu,
                              "%"
                            )}
                          </td>


                          {/* Post move CPU */}

                          <td>
                            <strong>
                              {formatValue(
                                c.post_move_cpu,
                                "%"
                              )}
                            </strong>
                          </td>


                          {/* Current memory */}

                          <td>
                            {formatValue(
                              c.current_memory,
                              "%"
                            )}
                          </td>


                          {/* Post move memory */}

                          <td>
                            <strong>
                              {formatValue(
                                c.post_move_memory,
                                "%"
                              )}
                            </strong>
                          </td>


                          {/* Explanation */}

                          <td
                            style={{
                              minWidth: 300,
                              maxWidth: 420,
                              lineHeight: 1.45,
                              color:
                                "var(--text-secondary)",
                              fontSize: 13,
                            }}
                          >

                            {candidateReason(
                              c,
                              isSelected
                            )}

                          </td>

                        </tr>

                      );
                    }
                  )}

                </tbody>

              </table>

            </div>

          )}


          {/* Safety explanation */}

          {candidates.length > 0 && (
            <div
              className="threshold-note"
              style={{
                marginTop: 14,
              }}
            >

              <strong>
                Safety rule:
              </strong>{" "}

              A target is considered safe only when
              both CPU and memory remain below{" "}
              <strong>75%</strong> after the workload
              move -- checked twice: once against the
              target's current load, and once against
              its own 15-minute forecast (independent
              of this move). A candidate marked{" "}
              <strong>Risky soon</strong> passed the
              current check but is predicted to get
              busy on its own soon enough to cross the
              limit anyway.

            </div>
          )}

        </div>
      )}


      {/* ================================================== */}
      {/* BEFORE → AFTER SERVER UTILIZATION */}
      {/* ================================================== */}

      {isConsolidate &&
        !rejected &&
        impact.target_server_id && (
          <div
            className="card"
            style={{ marginBottom: 16 }}
          >

            <p className="card-title">
              If you choose this target
            </p>

            <p className="card-subtitle">
              The source workload would be moved onto{" "}
              <Link
                to={`/servers/${impact.target_server_id}`}
                className="server-link"
              >
                {impact.target_server_id}
              </Link>
              . The values below show the target
              server before and after the simulated move.
            </p>


            <div
              className="metric-grid"
              style={{
                marginTop: 14,
              }}
            >

              {/* CPU */}

              <div className="metric-card">

                <p className="metric-label">
                  Target CPU
                </p>

                <p className="metric-value">

                  {formatValue(
                    impact.target_current_cpu,
                    "%"
                  )}

                  <span
                    style={{
                      margin: "0 8px",
                      color:
                        "var(--text-secondary)",
                    }}
                  >
                    →
                  </span>

                  <strong>
                    {formatValue(
                      impact.post_move_cpu,
                      "%"
                    )}
                  </strong>

                </p>

                <p className="metric-hint">
                  Before → after consolidation
                </p>

              </div>


              {/* Memory */}

              <div className="metric-card">

                <p className="metric-label">
                  Target memory
                </p>

                <p className="metric-value">

                  {formatValue(
                    impact.target_current_memory,
                    "%"
                  )}

                  <span
                    style={{
                      margin: "0 8px",
                      color:
                        "var(--text-secondary)",
                    }}
                  >
                    →
                  </span>

                  <strong>
                    {formatValue(
                      impact.post_move_memory,
                      "%"
                    )}
                  </strong>

                </p>

                <p className="metric-hint">
                  Before → after consolidation
                </p>

              </div>


              {/* Safety */}

              <div className="metric-card">

                <p className="metric-label">
                  Safety limit
                </p>

                <p className="metric-value">
                  75%
                </p>

                <p
                  className="metric-hint"
                  style={{
                    color:
                      impact.safe
                        ? "var(--success)"
                        : "var(--danger)",
                  }}
                >
                  {impact.safe
                    ? "✓ Target remains within safe limits"
                    : "Target exceeds safe limits"}
                </p>

              </div>


              {/* Risk */}

              {impact.risk_score !==
                null &&
                impact.risk_score !==
                  undefined && (
                  <div
                    className="metric-card neutral"
                  >

                    <p className="metric-label">
                      Utilization risk
                    </p>

                    <p className="metric-value">
                      {formatValue(
                        impact.risk_score
                      )}
                    </p>

                    <p className="metric-hint">
                      0 = low risk · 1 = safety limit
                    </p>

                  </div>
                )}

            </div>


            {/* Source workload */}

            {(
              impact.source_current_cpu !==
                undefined ||
              impact.source_current_memory !==
                undefined
            ) && (

              <div
                className="threshold-note"
                style={{
                  marginTop: 14,
                }}
              >

                <strong>
                  Workload being moved:
                </strong>{" "}

                {formatValue(
                  impact.source_current_cpu,
                  "% CPU"
                )}

                {" · "}

                {formatValue(
                  impact.source_current_memory,
                  "% memory"
                )}

                {" "}from{" "}

                <Link
                  to={`/servers/${impact.server_id}`}
                  className="server-link"
                >
                  {impact.server_id}
                </Link>

                {" "}to{" "}

                <Link
                  to={`/servers/${impact.target_server_id}`}
                  className="server-link"
                >
                  {impact.target_server_id}
                </Link>

                .

              </div>

            )}

          </div>
        )}


      {/* ================================================== */}
      {/* ESTIMATED IMPACT */}
      {/* ================================================== */}

      <div
        className="card"
        style={{ marginBottom: 16 }}
      >

        <p className="card-title">
          Estimated impact
        </p>

        {rejected ? (

          <div
            className="what-if-rejected"
            style={{
              fontSize: 14,
            }}
          >
            {impact.assumptions?.[0] ||
              "No server currently has enough headroom to safely absorb this workload."}
          </div>

        ) : (

          <>

            {/* Explanation */}

            <p
              className="card-subtitle"
              style={{
                marginBottom: 14,
              }}
            >
              {impact.model_predicted_target_it_power_kw !== undefined &&
              impact.model_predicted_target_it_power_kw !== null ? (
                <>
                  Energy uses the trained power model's prediction for the
                  target's full post-move profile (CPU, memory, network,
                  cooling), scaled to facility power by its current PUE.
                  Carbon, cost and water are transparent formulas applied
                  on top of that energy estimate.
                </>
              ) : (
                <>
                  Estimated using transparent formulas from current
                  telemetry and configured environmental and cost
                  assumptions. The trained power model wasn't available for
                  this target, so no ML model is used for this estimate.
                </>
              )}
            </p>


            {/* BEFORE / AFTER TABLE */}

            <div
              style={{
                overflowX: "auto",
              }}
            >

              <table className="data-table">

                <thead>

                  <tr>

                    <th>Impact</th>

                    <th>Before</th>

                    <th>After</th>

                    <th>Saving / Reduction</th>

                  </tr>

                </thead>


                <tbody>

                  {/* Energy */}

                  <tr>

                    <td className="row-title">
                      Facility energy
                    </td>

                    <td>
                      {formatValue(
                        impact.estimated_energy_before_kwh,
                        " kWh"
                      )}
                    </td>

                    <td>
                      {formatValue(
                        impact.estimated_energy_after_kwh,
                        " kWh"
                      )}
                    </td>

                    <td>
                      <strong>
                        {formatValue(
                          impact.estimated_energy_saving_kwh,
                          " kWh"
                        )}
                      </strong>
                    </td>

                  </tr>


                  {/* Carbon */}

                  <tr>

                    <td className="row-title">
                      Carbon emissions
                    </td>

                    <td>
                      {formatValue(
                        impact.estimated_carbon_before_kg,
                        " kg"
                      )}
                    </td>

                    <td>
                      {formatValue(
                        impact.estimated_carbon_after_kg,
                        " kg"
                      )}
                    </td>

                    <td>
                      <strong>
                        {formatValue(
                          impact.estimated_carbon_reduction_kg,
                          " kg"
                        )}
                      </strong>
                    </td>

                  </tr>


                  {/* Cost */}

                  <tr>

                    <td className="row-title">
                      Electricity cost
                    </td>

                    <td>
                      ₹
                      {formatValue(
                        impact.estimated_cost_before
                      )}
                    </td>

                    <td>
                      ₹
                      {formatValue(
                        impact.estimated_cost_after
                      )}
                    </td>

                    <td>
                      <strong>
                        ₹
                        {formatValue(
                          impact.estimated_cost_saving
                        )}
                      </strong>
                    </td>

                  </tr>


                  {/* Water */}

                  {(
                    impact.estimated_water_before_l !==
                      undefined ||
                    impact.estimated_water_after_l !==
                      undefined
                  ) && (

                    <tr>

                      <td className="row-title">
                        Water consumption
                      </td>

                      <td>
                        {formatValue(
                          impact.estimated_water_before_l,
                          " L"
                        )}
                      </td>

                      <td>
                        {formatValue(
                          impact.estimated_water_after_l,
                          " L"
                        )}
                      </td>

                      <td>
                        <strong>
                          {formatValue(
                            impact.estimated_water_saving_l,
                            " L"
                          )}
                        </strong>
                      </td>

                    </tr>

                  )}

                </tbody>

              </table>

            </div>


            {/* Time basis */}

            <div
              className="threshold-note"
              style={{
                marginTop: 14,
              }}
            >

              <strong>
                Time basis:
              </strong>{" "}

              Energy, carbon, cost and water values are
              estimated over one hour.

            </div>


            {/* Storage */}

            <div
              className="metric-grid"
              style={{
                marginTop: 14,
              }}
            >

              <div className="metric-card">

                <p className="metric-label">
                  Storage reclaimed
                </p>

                <p className="metric-value">
                  {formatValue(
                    impact.estimated_storage_reclaimed_gb,
                    " GB"
                  )}
                </p>

                <p className="metric-hint">
                  Estimated storage capacity recovered
                </p>

              </div>


              {/* Risk */}

              {impact.risk_score !==
                null &&
                impact.risk_score !==
                  undefined && (

                <div
                  className="metric-card neutral"
                >

                  <p className="metric-label">
                    Risk score
                  </p>

                  <p className="metric-value">
                    {formatValue(
                      impact.risk_score
                    )}
                  </p>

                  <p className="metric-hint">
                    0 = no risk, 1 = at the safety limit
                  </p>

                </div>

              )}

            </div>

          </>

        )}


        {/* Assumptions */}

        {impact.assumptions?.length > 0 && (

          <div
            className="threshold-note"
            style={{
              marginTop: 14,
            }}
          >

            <strong>
              Assumptions:
            </strong>

            <ul
              style={{
                margin: "6px 0 0",
                paddingLeft: 18,
              }}
            >

              {impact.assumptions.map(
                (a, i) => (

                  <li
                    key={i}
                    style={{
                      marginBottom: 4,
                    }}
                  >
                    {a}
                  </li>

                )
              )}

            </ul>

          </div>

        )}

      </div>


      {/* ================================================== */}
      {/* DECISION */}
      {/* ================================================== */}

      <div className="card">

        <p className="card-title">
          Decision
        </p>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >

          {(!isConsolidate ||
            !rejected) && (

            <button
              className="primary-button"
              onClick={() =>
                handleAction(
                  acceptActionFor(
                    rec.recommendation_type
                  )
                )
              }
              disabled={actionLoading}
            >
              {acceptLabelFor(
                rec.recommendation_type
              )}
            </button>

          )}


          <button
            className="secondary-button"
            onClick={() =>
              handleAction(
                "snooze",
                24
              )
            }
            disabled={actionLoading}
          >
            Snooze 24h
          </button>


          <button
            className="danger-button"
            onClick={() =>
              handleAction(
                "do_nothing"
              )
            }
            disabled={actionLoading}
          >
            Dismiss
          </button>

        </div>

      </div>

    </div>
  );
}