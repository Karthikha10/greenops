import { BrowserRouter, Routes, Route } from "react-router-dom";

import Layout from "./Layout";

import Overview from "./pages/Overview";
import Servers from "./pages/Servers";
import ServerDetail from "./pages/ServerDetail";
import Storage from "./pages/Storage";
import Analytics from "./pages/Analytics";
import ModelEval from "./pages/ModelEval";
import Recommendations from "./pages/Recommendations";
import RecommendationDetail from "./pages/RecommendationDetail";
import Preferences from "./pages/Preferences";
import Reports from "./pages/Reports";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>

        <Route element={<Layout />}>

          {/* Dashboard */}
          <Route index element={<Overview />} />

          {/* Infrastructure */}
          <Route path="servers" element={<Servers />} />
          <Route path="servers/:id" element={<ServerDetail />} />

          {/* Storage */}
          <Route path="storage" element={<Storage />} />

          {/* Analytics */}
          <Route path="analytics" element={<Analytics />} />

          {/* ML */}
          <Route path="model-eval" element={<ModelEval />} />

          {/* Recommendations */}
          <Route path="recommendations" element={<Recommendations />} />
          <Route path="recommendations/:id" element={<RecommendationDetail />} />

          {/* Preferences */}
          <Route path="preferences" element={<Preferences />} />

          {/* ESG report */}
          <Route path="reports" element={<Reports />} />

        </Route>

      </Routes>
    </BrowserRouter>
  );
}
