import axios from "axios";

const API_BASE = "http://localhost:8000";

const client = axios.create({
  baseURL: API_BASE,
  timeout: 8000,
});

export const api = {
  root: () => client.get("/"),

  // ----------------------------------------------------------
  // SERVERS
  // ----------------------------------------------------------

  servers: () =>
    client.get("/servers"),

  serverHistory: (id, hours = 6) =>
    client.get(`/servers/${id}/history`, {
      params: { hours },
    }),

  serverDetail: (id) =>
    client.get(`/servers/${id}/detail`),

  serverPrediction: (id) =>
    client.get(`/servers/${id}/prediction`),

  serverForecast: (
    id,
    horizonMinutes = 15
  ) =>
    client.get(`/servers/${id}/forecast`, {
      params: {
        horizon_minutes: horizonMinutes,
      },
    }),

  forecasts: (
    serverId = "all",
    limit = 50
  ) =>
    client.get("/forecasts", {
      params: {
        server_id: serverId,
        limit,
      },
    }),

  // ----------------------------------------------------------
  // STORAGE
  // ----------------------------------------------------------

  storageFlags: () =>
    client.get("/storage/flags"),

  // ----------------------------------------------------------
  // FLAGS
  // ----------------------------------------------------------

  allFlags: () =>
    client.get("/flags"),

  // ----------------------------------------------------------
  // ANALYTICS
  // ----------------------------------------------------------

  analyticsSummary: () =>
    client.get("/analytics/summary"),

  analyticsHistory: (
    hours = 6
  ) =>
    client.get("/analytics/history", {
      params: { hours },
    }),

  analyticsDaily: ({
    days = 7,
    serverId = "all",
    region = "all",
  } = {}) =>
    client.get("/analytics/daily", {
      params: {
        days,
        server_id: serverId,
        region,
      },
    }),

  // ----------------------------------------------------------
  // MODEL
  // ----------------------------------------------------------

  modelEvaluation: () =>
    client.get("/model/evaluation"),

  thresholds: () =>
    client.get("/thresholds"),

  // ----------------------------------------------------------
  // RECOMMENDATIONS
  // ----------------------------------------------------------

  recommendations: (
    includeCompleted = false
  ) =>
    client.get("/recommendations", {
      params: {
        include_completed: includeCompleted,
      },
    }),

  recommendation: (id) =>
    client.get(`/recommendations/${id}`),

  recommendationWhatIf: (
    id
  ) =>
    client.get(
      `/recommendations/${id}/what-if`
    ),

  recommendationAction: (
    id,
    action,
    notes = "",
    snoozeHours = 24
  ) =>
    client.post(
      `/recommendations/${id}/action`,
      {
        action,
        notes,
        snooze_hours: snoozeHours,
      }
    ),

  // ----------------------------------------------------------
  // PREFERENCES (ranking weights)
  // ----------------------------------------------------------

  preferences: () =>
    client.get("/preferences"),

  updatePreferences: (weights) =>
    client.put("/preferences", weights),

  // ----------------------------------------------------------
  // ESG REPORT
  // ----------------------------------------------------------

  esgReport: (days = 30) =>
    client.get("/reports/esg", { params: { days } }),

  esgReportExportUrl: (days = 30) =>
    `${API_BASE}/reports/esg/export?days=${days}`,

  esgReportPdfUrl: (days = 30) =>
  `${API_BASE}/reports/esg/export/pdf?days=${days}`,

  // ----------------------------------------------------------
  // OPERATOR ACTIONS
  // ----------------------------------------------------------

  operatorActions: (
    limit = 50
  ) =>
    client.get("/operator-actions", {
      params: { limit },
    }),

  operatorActionUpdate: (id, payload) =>
    client.patch(`/operator-actions/${id}`, payload),
};

export default api;