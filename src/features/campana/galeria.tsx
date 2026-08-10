import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../lib/datos/cliente';
import { PantallaCampanas } from './PantallaCampanas';
import '../../index.css';

/**
 * LA PANTALLA DE CAMPAÑAS, SIN SERVER NI BASE.
 *
 * Entry aparte, FUERA del bundle de la app (como `galeria-padron.html`): sirve
 * para ver los estados —incluidos los que cuesta reproducir en vivo, como una
 * plantilla pausada— y para dejar la evidencia visual que exige la regla dura.
 *
 *   node scratchpad/stub-campanas.mjs
 *   VITE_API_URL=http://localhost:4199 npx vite --port 5199
 *   → http://localhost:5199/galeria-campanas.html
 *   → …?seccion=plantillas   (cuánto se mandó con cada plantilla)
 */
// La sección la valida la pantalla, contra la misma lista que dibuja las solapas.
const seccion = new URLSearchParams(location.search).get('seccion') ?? undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="h-screen bg-background">
        <div className="flex h-full min-h-0 flex-col">
          <PantallaCampanas seccionInicial={seccion} />
        </div>
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
