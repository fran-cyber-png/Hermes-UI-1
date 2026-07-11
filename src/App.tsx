import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import AppShell from './layout/AppShell';
import BandejaPage from './pages/BandejaPage';
import LeadsPage from './pages/LeadsPage';
import AnalisisPage from './pages/AnalisisPage';
import CampaignsListPage from './pages/CampaignsListPage';
import NewCampaignPage from './pages/NewCampaignPage';
import CampaignStructurePage from './pages/CampaignStructurePage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          {/* La home es para actuar. Entender es otra pantalla, a propósito:
              cuando compartían plano, se estorbaban y se contradecían. */}
          <Route index element={<BandejaPage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="analisis" element={<AnalisisPage />} />
          <Route path="campanas" element={<CampaignsListPage />} />
          <Route path="campanas/nueva" element={<NewCampaignPage />} />
          <Route path="campanas/:campaignId" element={<CampaignStructurePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
