import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { queryClient } from '../../lib/datos/cliente';
import { VistaMiLinea, type PasoMiLinea } from './VincularMiWhatsapp';

/**
 * LA GALERÍA DE LA AUTO-VINCULACIÓN — evidencia de la regla dura #2, sin server
 * ni `fetch`: importa `VistaMiLinea` directo (sin hooks), el mismo truco que
 * `reparto/galeria.tsx` con `ContenidoUsuario`.
 *
 * Entry APARTE de Vite (`galeria-mi-linea.html`, no entra al bundle):
 *
 *     npx vite --port 5199
 *     → http://localhost:5199/galeria-mi-linea.html?paso=formulario
 *     → ?paso=qr | conectado | baneado | error
 */

const QR_DEMO =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360">' +
      '<rect width="360" height="360" fill="#fff"/>' +
      '<rect x="18" y="18" width="60" height="60" fill="#0E2A52"/>' +
      '<rect x="282" y="18" width="60" height="60" fill="#0E2A52"/>' +
      '<rect x="18" y="282" width="60" height="60" fill="#0E2A52"/>' +
      '<rect x="150" y="150" width="60" height="60" fill="#0E2A52"/>' +
      '<text x="180" y="330" font-family="monospace" font-size="13" text-anchor="middle" fill="#5B6B86">QR de ejemplo</text>' +
      '</svg>',
  );

const PASOS: Record<string, PasoMiLinea> = {
  formulario: { tipo: 'formulario', numero: '', onNumero: () => {}, onVincular: () => {}, error: null },
  formulario_error: {
    tipo: 'formulario',
    numero: '51986394450',
    onNumero: () => {},
    onVincular: () => {},
    error: 'ese número ya está registrado en Hermes',
  },
  esperando: { tipo: 'esperando', onCancelar: () => {} },
  qr: { tipo: 'qr', qr: QR_DEMO, onCancelar: () => {} },
  conectado: { tipo: 'conectado', numero: '51955135507', onCerrar: () => {} },
  baneado: { tipo: 'baneado', ban: { codigo: '131056', expira: '2026-08-16 10:00' }, onVolver: () => {} },
  error: { tipo: 'error', motivo: 'no se pudo iniciar whatsmeow: sesión corrupta', onVolver: () => {} },
};

const paso = new URLSearchParams(location.search).get('paso') ?? 'formulario';

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <VistaMiLinea paso={PASOS[paso] ?? PASOS.formulario} onCerrar={() => {}} />
    </QueryClientProvider>
  </StrictMode>,
);
