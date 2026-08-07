import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { VistaNavegador } from './VistaNavegador';

/**
 * LA GALERÍA DEL NAVEGADOR — la evidencia de la regla dura #2.
 *
 * Entry APARTE de Vite (`galeria-navegador.html` en la raíz): **no entra al
 * bundle de la app** (`vite build` toma solo `index.html`) y se abre a mano.
 *
 *     npx vite --port 5199
 *     → http://localhost:5199/galeria-navegador.html          (dentro de la cáscara)
 *     → http://localhost:5199/galeria-navegador.html?sistema=1 (en un navegador común)
 *
 * ⚠️ POR QUÉ HAY QUE FINGIR LA CÁSCARA. La vista dice cosas distintas según
 * dónde corra —«se abre en una ventana de Hermes» vs «se abre en tu
 * navegador»—, y una galería es siempre un navegador común: sin el stub, la
 * captura mostraría SOLO el caso degradado y el que se quiso construir quedaría
 * sin evidencia. El stub es de dos renglones y no manda nada: `invoke` resuelve
 * y listo, que es justo lo que hace falta para fotografiar el acuse.
 */
const params = new URLSearchParams(location.search);
const enSistema = params.has('sistema');
/** `?basura=1` deja la caja con una búsqueda: es el estado del recorte de `interpretar`. */
const textoInicial = params.has('basura') ? 'cuanto sale el diploma' : params.get('texto') ?? '';

if (!enSistema) {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: Record<string, unknown>) => {
      // Se loguea en vez de abrir: la galería documenta la PANTALLA. Que la
      // ventana abra de verdad se verifica en la app real, no acá.
      console.log('[galería] invoke', cmd, args);
    },
  };
}

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* La barra imita la cabecera del shell: el rótulo de la vista sale de
          `VISTAS` y la vista NO lo repite (por eso no tiene título propio). Sin
          esta franja, la captura se leería como una pantalla sin nombre. */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 pb-2 pt-4">
        <h1 className="font-heading text-sm font-bold tracking-tight text-navy">Navegador</h1>
      </header>
      <VistaNavegador textoInicial={textoInicial} />
    </div>
  </StrictMode>,
);
