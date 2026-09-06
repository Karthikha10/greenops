import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "../api";

function typeLabel(type) {
  return (
    {
      consolidate: "Consolidate",
      rightsize: "Rightsize",
      archive: "Archive",
      deduplicate: "Deduplicate",
    }[type] || type
  );
}

function safetyBadge(rec) {
  if (rec.recommendation_type !== "consolidate" || !rec.impact) return null;
  if (rec.impact.safe === false) {
    return <span className="badge danger">No safe target</span>;
  }
  if (rec.impact.safe === true && rec.impact.target_server_id) {
    return <span className="badge good">→ {rec.impact.target_server_id}</span>;
  }
  return null;
}

// The target candidate's own near-term CPU forecast (independent of the
// workload being moved onto it) -- pulled from the same `candidates` array
// the detail page renders as a table, matched by target_server_id so this
// list stays in sync with whichever candidate actually won.
function targetForecast(rec) {
  if (rec.recommendation_type !== "consolidate" || !rec.impact?.target_server_id) {
    return null;
  }
  const target = rec.impact.candidates?.find(
    (c) => c.server_id === rec.impact.target_server_id
  );
  if (!target || target.forecast_predicted_cpu === null || target.forecast_predicted_cpu === undefined) {
    return null;
  }
  return target;
}

export default function Recommendations() {
  const navigate = useNavigate();
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.recommendations(false);
      setRecommendations(response.data || []);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to load recommendations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const counts = {
    total: recommendations.length,
    high: recommendations.filter((r) => r.priority === "high").length,
    consolidate: recommendations.filter((r) => r.recommendation_type === "consolidate").length,
    storage: recommendations.filter((r) => ["archive", "deduplicate", "rightsize"].includes(r.recommendation_type)).length,
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="page-title">Recommendations</p>
          <p className="page-subtitle">
            Every row here comes from an active rule-based flag. Click one to see exactly why, and — for
            consolidations — every candidate server considered and how they ranked, not just the winner.
          </p>
        </div>
        <button className="secondary-button" onClick={load} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="metric-grid">
        <div className="metric-card">
          <p className="metric-label">Pending</p>
          <p className="metric-value">{counts.total}</p>
          <p className="metric-hint">Awaiting a decision</p>
        </div>
        <div className="metric-card warn">
          <p className="metric-label">High priority</p>
          <p className="metric-value">{counts.high}</p>
          <p className="metric-hint">Highest severity underlying flag</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Consolidations</p>
          <p className="metric-value">{counts.consolidate}</p>
          <p className="metric-hint">Idle servers with a candidate target</p>
        </div>
        <div className="metric-card neutral">
          <p className="metric-label">Storage actions</p>
          <p className="metric-value">{counts.storage}</p>
          <p className="metric-hint">Archive, deduplicate, rightsize</p>
        </div>
      </div>

      <div className="card">
        <p className="card-title">All pending recommendations</p>
        {loading && recommendations.length === 0 ? (
          <div className="empty-state">Loading recommendations...</div>
        ) : recommendations.length === 0 ? (
          <div className="empty-state">
            <h3>No pending recommendations</h3>
            <p>Every server and storage volume is currently within its normal range.</p>
          </div>
        ) : (
          <table className="data-table gridded">
            <thead>
              <tr>
                <th>Server</th>
                <th>Action</th>
                <th>Priority</th>
                <th>Target / status</th>
                <th>Target forecast (CPU)</th>
                <th style={{ textAlign: "right" }}>Score</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recommendations.map((rec) => (
                <tr
                  key={rec.id}
                  onClick={() => navigate(`/recommendations/${rec.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <td className="row-title">
                    <Link to={`/servers/${rec.server_id}`} onClick={(e) => e.stopPropagation()} className="server-link">
                      {rec.server_id}
                    </Link>
                  </td>
                  <td>{typeLabel(rec.recommendation_type)}</td>
                  <td>
                    <span className={`badge ${rec.priority}`}>{rec.priority}</span>
                  </td>
                  <td>{safetyBadge(rec) || <span className="row-meaning">—</span>}</td>
                  <td>
                    {(() => {
                      const target = targetForecast(rec);
                      if (!target) return <span className="row-meaning">—</span>;
                      const rising = target.forecast_predicted_cpu > target.current_cpu + 0.5;
                      const falling = target.forecast_predicted_cpu < target.current_cpu - 0.5;
                      return (
                        <span title={`${rec.impact.target_server_id}'s own forecast, independent of this move`}>
                          {target.current_cpu.toFixed(1)}%{" "}
                          <span style={{ color: "var(--text-muted)" }}>→</span>{" "}
                          {target.forecast_predicted_cpu.toFixed(1)}%
                          {rising && <span style={{ color: "var(--danger-text)" }}> ↑</span>}
                          {falling && <span style={{ color: "var(--accent-dark)" }}> ↓</span>}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {typeof rec.score === "number" ? rec.score.toFixed(2) : "—"}
                  </td>
                  <td style={{ textAlign: "right", color: "var(--accent-dark)", fontWeight: 500, whiteSpace: "nowrap" }}>
                    View →
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
