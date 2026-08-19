import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { queryClient } from '../../lib/datos/cliente';
import { VistaCambiarClave, type PasoCambiarClave } from './CambiarClave';
import { ContenidoUsuario } from './PanelUsuario';

/**
 * LA GALERÍA DE «CAMBIAR CONTRASEÑA» — evidencia de la regla dura #2, sin server
 * ni `fetch`: importa `VistaCambiarClave` directo (sin hooks), el mismo truco que
 * `galeria-mi-linea.tsx`, y el panel abierto con `ContenidoUsuario`.
 *
 * Entry APARTE de Vite (`galeria-cambiar-clave.html`, no entra al bundle):
 *
 *     npx vite --port 5199
 *     → http://localhost:5199/galeria-cambiar-clave.html?paso=panel
 *     → ?paso=formulario | formulario_error | rechazo_django | enviando | listo
 *
 * Los dos rechazos son los que devuelve producción, no un texto inventado: el
 * de la actual es el de `routes/auth.ts`, y el de Django es literalmente lo que
 * dice su `MinimumLengthValidator` en castellano.
 */

const nada = () => {};
const CAMPOS = { actual: '••••••••', nueva: 'Nueva-Segura-2026', repetir: 'Nueva-Segura-2026' };

const PASOS: Record<string, PasoCambiarClave> = {
  formulario: { tipo: 'formulario', campos: { actual: '', nueva: '', repetir: '' }, onCampo: nada, onEnviar: nada, enviando: false, error: null },
  formulario_error: {
    tipo: 'formulario',
    campos: CAMPOS,
    onCampo: nada,
    onEnviar: nada,
    enviando: false,
    error: 'La contraseña actual no es correcta.',
  },
  rechazo_django: {
    tipo: 'formulario',
    campos: { actual: '••••••••', nueva: '1234', repetir: '1234' },
    onCampo: nada,
    onEnviar: nada,
    enviando: false,
    error: 'Esta contraseña es demasiado corta. Debe contener al menos 8 caracteres. Esta contraseña es completamente numérica.',
  },
  enviando: { tipo: 'formulario', campos: CAMPOS, onCampo: nada, onEnviar: nada, enviando: true, error: null },
  listo: { tipo: 'listo', onCerrar: nada },
};

const paso = new URLSearchParams(location.search).get('paso') ?? 'formulario';

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {paso === 'panel' ? (
        // El panel del avatar, abierto y anclado abajo a la izquierda como en la app.
        <div className="relative h-screen w-screen bg-background">
          <div className="absolute bottom-3 left-3 w-64 rounded-xl border border-border bg-card p-3 shadow-panel">
            <ContenidoUsuario
              vendedora={{ id: 'ventas12@grupogoberna.com', nombre: 'Ventas12' }}
              cerberusVivo
              mias={[{ numero: '51984429504', etiqueta: 'Ventas Meta', compartida: true }]}
              motivoVincular={null}
              onSalir={nada}
              onCambiarClave={nada}
            />
          </div>
        </div>
      ) : (
        <VistaCambiarClave paso={PASOS[paso] ?? PASOS.formulario} onCerrar={nada} />
      )}
    </QueryClientProvider>
  </StrictMode>,
);
