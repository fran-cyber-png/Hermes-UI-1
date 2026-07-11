import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import AppShell from './layout/AppShell';
import HomePage from './pages/HomePage';
import LeadsPage from './pages/LeadsPage';
import BandejaPage from './pages/BandejaPage';
import CanalPage from './pages/CanalPage';
import CampaignsListPage from './pages/CampaignsListPage';
import NewCampaignPage from './pages/NewCampaignPage';
import CampaignStructurePage from './pages/CampaignStructurePage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          {/* El home es el único punto de partida: contiene el trabajo (la
              bandeja) y las puertas a todo lo demás. Todo lo de abajo se abre
              desde ahí y vuelve ahí. Por eso no hay pestañas. */}
          <Route index element={<HomePage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="bandeja" element={<BandejaPage />} />
          {/* Cada canal a fondo: los canales NO son intercambiables, y una sola
              cola escondía justamente eso. */}
          <Route path="canal/:canal" element={<CanalPage />} />
          <Route path="campanas" element={<CampaignsListPage />} />
          <Route path="campanas/nueva" element={<NewCampaignPage />} />
          <Route path="campanas/:campaignId" element={<CampaignStructurePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
