import React, { useEffect, useState } from "react";
import api from "../api";

/* ==========================================================================
   1. UTILITY FUNCTIONS & HELPERS
   ========================================================================== */

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function actionBadgeClass(action) {
  if (["consolidate", "rightsize", "accepted"].includes(action)) return "good";
  if (action === "snooze") return "warn";
  if (action === "do_nothing") return "danger";
  return "neutral";
}

function actionLabel(action) {
  return (
    {
      consolidate: "Consolidated",
      rightsize: "Rightsized",
      snooze: "Snoozed",
      do_nothing: "Dismissed",
      accepted: "Accepted",
    }[action] || action
  );
}

/* ==========================================================================
   2. SUB-COMPONENTS
   ========================================================================== */

function ESGImpactSummary({ impact, decisionCounts }) {
  return (
    <div className="section-block">
      <p className="section-label">Cumulative Impact from Accepted Actions</p>
      <div className="metric-grid">
        <div className="metric-card">
          <p className="metric-label">Energy Saved</p>
          <p className="metric-value">
            {formatNumber(impact?.energy_kwh)} <span className="unit">kWh</span>
          </p>
          <p className="metric-hint">Integrated power reduction from operator choices</p>
        </div>

        <div className="metric-card">
          <p className="metric-label">Carbon Reduced</p>
          <p className="metric-value">
            {formatNumber(impact?.carbon_kg)} <span className="unit">kg</span>
          </p>
          <p className="metric-hint">Derived using grid intensity factor (0.5 kg/kWh)</p>
        </div>

        <div className="metric-card">
          <p className="metric-label">Cost Savings</p>
          <p className="metric-value">₹{formatNumber(impact?.cost)}</p>
          <p className="metric-hint">Estimated financial savings at ₹8.0/kWh tariff</p>
        </div>

        <div className="metric-card neutral">
          <p className="metric-label">Total Audit Trail</p>
          <p className="metric-value">{decisionCounts?.total || 0}</p>
          <div className="metric-sub-detail">
            Accepted: <strong>{decisionCounts?.accepted || 0}</strong> · Snoozed:{" "}
            <strong>{decisionCounts?.snoozed || 0}</strong> · Dismissed:{" "}
            <strong>{decisionCounts?.rejected || 0}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function DecisionAuditTable({ decisions }) {
  return (
    <div className="card">
      <div className="card-header-row">
        <div>
          <h3 className="card-title">Decision Audit Trail</h3>
          <p className="card-subtitle">
            Immutable log of operator actions captured at decision time.
          </p>
        </div>
        <span className="badge neutral">{decisions.length} Records Logged</span>
      </div>

      {decisions.length === 0 ? (
        <div className="empty-state">
          No operator decisions recorded within this timeframe.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Server</th>
              <th>Target</th>
              <th>Action</th>
              <th style={{ textAlign: "right" }}>Energy Impact</th>
              <th style={{ textAlign: "right" }}>Carbon Impact</th>
              <th style={{ textAlign: "right" }}>Cost Impact</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((d) => (
              <tr key={d.id}>
                <td>
                  {new Date(
    d.created_at.endsWith("Z") ? d.created_at : `${d.created_at}Z`
).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
})}
                </td>
                <td className="row-title">{d.server_id}</td>
                <td className="row-meaning">{d.target_server_id || "—"}</td>
                <td>
                  <span className={`badge ${actionBadgeClass(d.action)}`}>
                    {actionLabel(d.action)}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  {d.estimated_energy_saving_kwh
                    ? `${formatNumber(d.estimated_energy_saving_kwh)} kWh`
                    : "—"}
                </td>
                <td style={{ textAlign: "right" }}>
                  {d.estimated_carbon_reduction_kg
                    ? `${formatNumber(d.estimated_carbon_reduction_kg)} kg`
                    : "—"}
                </td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>
                  {d.estimated_cost_saving
                    ? `₹${formatNumber(d.estimated_cost_saving)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ==========================================================================
   3. MAIN PAGE CONTAINER & SCOPED INLINE STYLES
   ========================================================================== */

export default function Reports() {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (rangeDays) => {
    try {
      setLoading(true);
      setError("");
      const response = await api.esgReport(rangeDays);
      setReport(response.data);
    } catch (err) {
      setError("Failed to generate ESG & Decision audit report.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(days);
  }, [days]);

  return (
    <>
      <style>{`
        .reports-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 8px 0 32px 0;
        }

        .reports-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 20px;
        }

        .reports-filter-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
        }

        .range-button-group {
          display: flex;
          gap: 6px;
          background: var(--card-bg);
          border: 1px solid var(--border);
          padding: 4px;
          border-radius: 8px;
        }

        .range-btn {
          border: none;
          background: transparent;
          padding: 6px 14px;
          font-size: 12.5px;
          font-weight: 500;
          color: var(--text-secondary);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .range-btn.active {
          background: var(--accent-dark);
          color: #FFFFFF;
        }

        .unit {
          font-size: 14px;
          color: var(--text-muted);
          font-weight: normal;
        }

        .metric-sub-detail {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 6px;
        }

        .card-header-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 16px;
        }

        .secondary-button,
        .export-button {
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          border: 1px solid var(--border);
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .export-button {
          background: var(--accent-dark);
          color: #FFFFFF;
          border-color: var(--accent-dark);
        }

        .export-button:hover {
          background: var(--sidebar-bg);
        }

        .info-note {
          font-size: 13px;
          color: var(--text-secondary);
          background: #F4F8F6;
          border: 1px solid #DCEFE7;
          border-radius: 8px;
          padding: 12px 14px;
          margin-top: 20px;
          line-height: 1.5;
        }

        @media (max-width: 768px) {
          .reports-header,
          .reports-filter-row,
          .card-header-row {
            flex-direction: column;
            align-items: flex-start;
          }

          .reports-filter-row {
            gap: 16px;
          }
        }
      `}</style>

      <div className="reports-container">
        <div className="reports-header">
          <div>
            <h1 className="page-title">ESG &amp; Decision Audit Report</h1>
            <p className="page-subtitle">
              Historical audit trail of human decisions and accepted sustainability impacts.
            </p>
          </div>
          <a
            className="export-button"
            href={api.esgReportExportUrl(days)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>↓</span> Export CSV
          </a>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="reports-filter-row">
          <div className="range-button-group">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                className={`range-btn ${d === days ? "active" : ""}`}
                onClick={() => setDays(d)}
              >
                Past {d} Days
              </button>
            ))}
          </div>
          <span className="section-context">
            Reporting scope: {days} days relative to current time
          </span>
        </div>

        {loading && !report ? (
          <div className="empty-state">Generating audit log report...</div>
        ) : (
          <>
            <ESGImpactSummary
              impact={report?.estimated_impact_of_accepted_decisions}
              decisionCounts={report?.decision_counts}
            />

            <DecisionAuditTable decisions={report?.decisions || []} />

            <div className="info-note">
              <strong>Audit Guarantee:</strong> This report represents an operational decision log captured at the moment of operator interaction. Impact totals are based on accepted recommendation snapshots and estimated tariffs.
            </div>
          </>
        )}
      </div>
    </>
  );
}