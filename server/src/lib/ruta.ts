import type { NextFunction, Request, RequestHandler, Response } from "express";
import { porQueFallo } from "./porQueFallo.js";

/**
 * 🔴 EL ENVOLTORIO QUE IMPIDE QUE UN FALLO DE BASE TUMBE EL PROCESO.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────
 *
 * **Express 4 no atrapa el rechazo de un handler `async`.** No es un descuido de
 * quien lo escribió: en Express 4 un handler que devuelve una promesa rechazada
 * no llega al middleware de error — la promesa queda sin manejar, Node dispara
 * `unhandledRejection` y **el proceso se cae**. No un 500: el server abajo.
 *
 * Ya ocurrió. `routes/auth.falloDeBase.test.ts` lo dejó escrito: con la base
 * caída, un login fallido se convertía en **Hermes abajo para las cinco
 * vendedoras**. Se arregló ahí con un `try/catch` a mano, y sólo ahí — medido el
 * 16-ago-2026, **105 de los 175 handlers `async` del repo no atrapaban nada** y
 * no había una sola red `unhandledRejection` en todo el server.
 *
 * ── Por qué un envoltorio y no 105 `try/catch` ───────────────────────────
 *
 * Un `try/catch` por handler es la misma decisión escrita 105 veces, y la #106 se
 * olvida — es la forma exacta del #36 («la auth por-router se olvida; el perímetro
 * no»). Acá el `catch` es estructural: si el handler está envuelto, no hay forma
 * de que un rechazo se escape.
 *
 * ── Las dos cosas que hace, y la segunda es la que no se ve ──────────────
 *
 * 1. **Loguea con `porQueFallo(err)`, jamás con `err.message`.** En una consulta
 *    de drizzle ese mensaje ES el SQL, no la causa (ver `porQueFallo.ts`).
 * 2. **Le contesta al cliente un cuerpo GENÉRICO.** Medido el mismo día: 20
 *    sitios devolvían `(err as Error).message` en la respuesta, o sea el SQL de la
 *    consulta —tablas, columnas y parámetros— al navegador. En `GET
 *    /api/conversaciones`, que es la ruta más caliente de la app, eso es el SQL de
 *    la cola entera.
 *
 * ⚠️ **Esto NO reemplaza a los errores TIPADOS del dominio.** `no_es_supervisor`,
 * `sin_migracion`, `adjunto_muy_pesado`, `modo_retirado` y los ocho códigos de Ivi
 * son respuestas deliberadas que la pantalla ramifica: se siguen contestando con
 * su `res.status(...)` de siempre, adentro del handler. Acá cae **lo que nadie
 * previó**, y de eso la pantalla no puede hacer nada útil salvo decir que falló.
 *
 * ── El guard de `headersSent`, que no es defensivo ───────────────────────
 *
 * Varios handlers de este repo responden y DESPUÉS siguen trabajando, a propósito:
 * `webhook/ruta.ts` contesta primero porque Meta desactiva la suscripción si no ve
 * un 200 rápido, y `POST /api/whatsapp/leido` contesta antes de mandar los tildes
 * porque esperar la red del subprocess costaba 3 segundos. Si uno de esos falla
 * después de responder, mandar un segundo `res.json()` tira
 * `ERR_HTTP_HEADERS_SENT` — otro rechazo, dentro del `catch` que vino a evitarlos.
 *
 * @example
 * agendaRouter.get('/', ruta(async (req, res) => {
 *   const filas = await consultarAgenda(db, req.vendedoraId!);
 *   res.json({ recordatorios: filas });
 * }));
 */
export function ruta(
  handler: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    // `Promise.resolve` y no `await`: el handler puede ser síncrono, y un `throw`
    // sincrónico tiene que caer en el mismo lugar que un rechazo.
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch((err: unknown) => {
        console.error(`${req.method} ${req.originalUrl} falló — ${porQueFallo(err)}`);
        if (res.headersSent) return;
        res.status(500).json({
          ok: false,
          message: "No se pudo completar la operación. Volvé a intentar en un momento.",
        });
      });
  };
}
