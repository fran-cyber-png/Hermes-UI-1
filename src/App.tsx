import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import AppShell from './layout/AppShell';
import DashboardPage from './pages/DashboardPage';
import LeadsPage from './pages/LeadsPage';
import CampaignsListPage from './pages/CampaignsListPage';
import NewCampaignPage from './pages/NewCampaignPage';
import CampaignStructurePage from './pages/CampaignStructurePage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          {/* Pulso y Canales eran dos pantallas que contaban la misma realidad
              con números distintos. Ahora son una sola, y es la home. */}
          <Route index element={<DashboardPage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="campanas" element={<CampaignsListPage />} />
          <Route path="campanas/nueva" element={<NewCampaignPage />} />
          <Route path="campanas/:campaignId" element={<CampaignStructurePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
