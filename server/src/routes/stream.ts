import { Router } from 'express';
import { suscribirRT } from '../realtime/bus.js';

/**
 * EL STREAM DE TIEMPO REAL (Server-Sent Events).
 *
 * Cada Hermes abierto mantiene una conexión acá. Cuando el server recibe un
 * mensaje o cambia el estado de la sesión, empuja un evento por este stream, y el
 * frontend invalida las queries afectadas al instante. No transporta contenido,
 * pero los eventos de mensaje SÍ llevan el teléfono del contacto (PII), así que
 * el stream vive DETRÁS del perímetro (`auth/perimetro.ts`) como todo /api. Como
 * EventSource no puede mandar headers, el front lo consume con fetch + Bearer y
 * parsea el SSE a mano (`src/lib/datos/tiempoReal.ts`).
 */
export const streamRouter = Router();

streamRouter.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // que nginx no bufferee el stream
  });
  res.write('retry: 3000\n\n'); // si se corta, el navegador reintenta a los 3s

  const baja = suscribirRT((e) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  });

  // Keep-alive: un comentario cada 25s para que proxies no corten la conexión ociosa.
  const latido = setInterval(() => res.write(': keep-alive\n\n'), 25_000);

  req.on('close', () => {
    baja();
    clearInterval(latido);
  });
});
