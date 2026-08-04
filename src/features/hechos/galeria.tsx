import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { queryClient } from '../../lib/datos/cliente';
import { PantallaHechos } from './PantallaHechos';

/**
 * LA GALERÍA DEL CATÁLOGO DE DATOS — la evidencia de la regla dura #2.
 *
 * Entry APARTE de Vite (`galeria-hechos.html` en la raíz): **no entra al bundle
 * de la app** (`vite build` toma solo `index.html`) y se abre a mano.
 *
 *     node scratchpad/api-hechos.mjs                                  # :4199
 *     VITE_API_URL=http://localhost:4199 npx vite --port 5199
 *     → http://localhost:5199/galeria-hechos.html
 *
 * A diferencia de las otras galerías esta SÍ pide datos, contra un server de
 * mentira de 40 líneas: la pantalla no tiene estado propio interesante —lo que
 * hay que poder mirar es el recorte—, y fabricarle fixtures adentro del
 * componente obligaría a duplicar la regla que justamente no se quiere duplicar.
 *
 * Los datos del stub imitan la forma REAL medida en producción: las frases de
 * precio cargadas con `orden = 100` y, por lo tanto, invisibles detrás del tope
 * de 3. Si la captura no mostrara «no se ve» en ellas, la pantalla estaría mal.
 */

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PantallaHechos onCerrar={() => {}} />
    </QueryClientProvider>
  </StrictMode>,
);
