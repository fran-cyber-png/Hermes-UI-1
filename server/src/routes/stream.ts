import { Router } from 'express';
import { suscribirRT } from '../realtime/bus.js';
import { eventoPara, type QuienEscucha } from '../realtime/visibilidad.js';
import { mandaEnElEquipo } from '../equipo/cargarRol.js';
import { vedadasDe } from '../numeros/cargarLineasVedadas.js';

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
 *
 * ══ 🔴 ERA UN BROADCAST, Y AHORA SE FILTRA POR DUEÑA ════════════════════════
 *
 * Estar detrás del perímetro decía «es una vendedora», no «cuál»: el handler
 * reenviaba el evento crudo, así que **cada vendedora recibía el teléfono de
 * cada lead del equipo, en vivo y sin quedar en ningún log** — y con
 * `direccion: 'saliente'`, además, a quién le contestó la compañera y a qué
 * hora. Lo peor no era el dato suelto: era que le sacaba la precondición a las
 * otras fugas del hilo («conocer un teléfono ajeno»), así que este endpoint era
 * el enumerador de toda la cadena (auditoría del 17-ago-2026 §0.4).
 *
 * La decisión de qué ve cada quien vive en `realtime/visibilidad.ts`, pura. Acá
 * solo se arma el sujeto y se aplica.
 *
 * ⚠️ **`QuienEscucha` se resuelve UNA vez, en el handshake, y no se revalida.**
 * Es lo que ya pasaba con `requiereVendedora` (la conexión vive horas), así que
 * esto no lo empeora — pero conviene tenerlo escrito: a quien le cambien el rol
 * o le den de baja, su stream abierto sigue con el sujeto del momento en que se
 * conectó, hasta que el navegador reconecte (el `retry: 3000` de abajo, o
 * cualquier deploy). Fijarlo del todo es revalidar por evento; es otro frente.
 */
export const streamRouter = Router();

streamRouter.get('/', (req, res) => {
  // La identidad ya está en el request: `perimetroApi` dejó `req.vendedoraId` y
  // `cargarRol` dejó `req.rolResuelto`, los dos montados en `index.ts` ANTES de
  // este router. No hace falta consultar nada.
  const quien: QuienEscucha = {
    vendedoraId: req.vendedoraId,
    veTodo: mandaEnElEquipo(req),
    // Las líneas de campaña que no le tocan (`numeros/campana.ts`). Sale de la
    // MISMA anotación por request que usan las rutas, así que la regla se
    // evaluó una sola vez.
    //
    // 🔴 **Se lee ACÁ, antes del `writeHead`, y eso es a propósito**: si no se
    // pudieron resolver, `vedadasDe` tira y el stream **no se abre** (500 y el
    // navegador reintenta a los 3 s). Leerlo adentro del `suscribirRT` sería un
    // throw dentro de un callback del EventEmitter, o sea el proceso abajo — y
    // atraparlo ahí obligaría a elegir un default, que en una frontera es
    // elegir servir de más.
    lineasVedadas: vedadasDe(req),
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // que nginx no bufferee el stream
  });
  res.write('retry: 3000\n\n'); // si se corta, el navegador reintenta a los 3s

  const baja = suscribirRT((e) => {
    res.write(`data: ${JSON.stringify(eventoPara(e, quien))}\n\n`);
  });

  // Keep-alive: un comentario cada 25s para que proxies no corten la conexión ociosa.
  const latido = setInterval(() => res.write(': keep-alive\n\n'), 25_000);

  req.on('close', () => {
    baja();
    clearInterval(latido);
  });
});
