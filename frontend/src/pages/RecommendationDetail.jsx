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
    { consolidate: "Consolidate", rightsize: "Rightsize", archive: "Archive", deduplicate: "Deduplicate" }[type] ||
    "Accept"
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
      setError(err.response?.data?.detail || "Recommendation not found.");
      setRec(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleAction = async (action, snoozeHours) => {
    try {
      setActionLoading(true);
      setError("");
      await api.recommendationAction(id, action, "", snoozeHours);
      navigate("/recommendations");
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to record decision.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Link to="/recommendations" style={{ fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}>
          ← Recommendations
        </Link>
        <div className="empty-state" style={{ marginTop: 16 }}>Loading recommendation...</div>
      </div>
    );
  }

  if (!rec) {
    return (
      <div>
        <Link to="/recommendations" style={{ fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}>
          ← Recommendations
        </Link>
        <div className="empty-state" style={{ marginTop: 16 }}>{error || "Recommendation not found."}</div>
      </div>
    );
  }

  const impact = rec.impact || {};
  const isConsolidate = rec.recommendation_type === "consolidate";
  const rejected = isConsolidate && impact.safe === false;
  const candidates = impact.candidates || [];

  return (
    <div>
      <Link to="/recommendations" style={{ fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}>
        ← Recommendations
      </Link>

      <div className="page-header" style={{ marginTop: 6 }}>
        <div>
          <p className="page-title">{typeLabel(rec.recommendation_type)}</p>
          <p className="page-subtitle">
            Server <Link to={`/servers/${rec.server_id}`} className="server-link">{rec.server_id}</Link> · Flagged{" "}
            {rec.created_at ? new Date(rec.created_at).toLocaleString() : "—"}
          </p>
        </div>
        <span className={`badge ${rec.priority}`} style={{ fontSize: 13 }}>{rec.priority} priority</span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="card-title">Why this was flagged</p>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>{rec.explanation}</p>
      </div>

      {isConsolidate && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="card-title">Candidate targets, ranked</p>
          <p className="card-subtitle">
            Every {rec.server_id ? "same-type" : ""} server considered as a place to move this workload to, safest
            and most-headroom-left first. Only the top-ranked <strong>safe</strong> candidate is actually used for
            the impact estimate below.
          </p>
          {candidates.length === 0 ? (
            <div className="empty-state">No other same-type server exists to evaluate as a target.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Server</th>
                  <th>Status</th>
                  <th>Post-move CPU</th>
                  <th>Post-move memory</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr key={c.server_id} style={c.server_id === impact.target_server_id ? { background: "var(--page-bg)" } : undefined}>
                    <td className="row-title">#{i + 1}</td>
                    <td>
                      <Link to={`/servers/${c.server_id}`} className="server-link">{c.server_id}</Link>
                      {c.server_id === impact.target_server_id && (
                        <span className="badge good" style={{ marginLeft: 8 }}>Selected</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${c.safe ? "good" : "danger"}`}>{c.safe ? "Safe" : "Over limit"}</span>
                    </td>
                    <td>{c.post_move_cpu}%</td>
                    <td>{c.post_move_memory}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="card-title">Estimated impact</p>
        {rejected ? (
          <div className="what-if-rejected" style={{ fontSize: 14 }}>
            {impact.assumptions?.[0] || "No server currently has enough headroom to safely absorb this workload."}
          </div>
        ) : (
          <div className="metric-grid">
            <div className="metric-card">
              <p className="metric-label">Energy saving</p>
              <p className="metric-value">{formatValue(impact.estimated_energy_saving_kwh, " kWh")}</p>
            </div>
            <div className="metric-card">
              <p className="metric-label">Carbon reduction</p>
              <p className="metric-value">{formatValue(impact.estimated_carbon_reduction_kg, " kg")}</p>
            </div>
            <div className="metric-card">
              <p className="metric-label">Cost saving</p>
              <p className="metric-value">₹{formatValue(impact.estimated_cost_saving)}</p>
            </div>
            {impact.estimated_water_saving_l !== undefined && (
              <div className="metric-card">
                <p className="metric-label">Water saving</p>
                <p className="metric-value">{formatValue(impact.estimated_water_saving_l, " L")}</p>
              </div>
            )}
            <div className="metric-card">
              <p className="metric-label">Storage reclaimed</p>
              <p className="metric-value">{formatValue(impact.estimated_storage_reclaimed_gb, " GB")}</p>
            </div>
            {impact.risk_score !== null && impact.risk_score !== undefined && (
              <div className="metric-card neutral">
                <p className="metric-label">Risk score</p>
                <p className="metric-value">{impact.risk_score}</p>
                <p className="metric-hint">0 = no risk, 1 = at the safety limit</p>
              </div>
            )}
          </div>
        )}

        {impact.assumptions?.length > 0 && (
          <div className="threshold-note" style={{ marginTop: 14 }}>
            <strong>Assumptions:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {impact.assumptions.map((a, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card">
        <p className="card-title">Decision</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(!isConsolidate || !rejected) && (
            <button
              className="primary-button"
              onClick={() => handleAction(acceptActionFor(rec.recommendation_type))}
              disabled={actionLoading}
            >
              {acceptLabelFor(rec.recommendation_type)}
            </button>
          )}
          <button className="secondary-button" onClick={() => handleAction("snooze", 24)} disabled={actionLoading}>
            Snooze 24h
          </button>
          <button className="danger-button" onClick={() => handleAction("do_nothing")} disabled={actionLoading}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function formatValue(value, suffix = "") {
  return value === null || value === undefined ? "—" : `${value}${suffix}`;
}
