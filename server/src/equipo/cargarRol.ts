import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verificarSesion } from "../auth/sesion.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { resolverRol, SIN_IDENTIDAD, type LecturaDeEquipo, type RolResuelto } from "./cascada.js";
import { puedeAdministrar, puedeSupervisar } from "./roles.js";

/**
 * EL ROL DE QUIEN PIDE, ANOTADO UNA VEZ POR REQUEST.
 *
 * ══ 🔴 POR QUÉ RESUELVE EL BEARER POR SU CUENTA Y NO LEE `req.vendedoraId` ════
 *
 * Parece que alcanzaría con encadenarlo detrás del perímetro y leer el
 * `vendedoraId` que `requiereVendedora` ya dejó. **No alcanza, y el modo de
 * fallar es invisible.**
 *
 * `'/api/auth'` está en `PREFIJOS_ABIERTOS` (`auth/perimetro.ts`, con el
 * comentario «(y /yo valida el suyo adentro)»), y `routes/auth.ts` monta
 * `requiereVendedora` como handler **del propio `/yo`** — o sea DESPUÉS de
 * cualquier `app.use` de `index.ts`. Resultado: en `GET /api/auth/yo` el rol
 * quedaría `undefined`… y `/yo` es el ÚNICO canal por el que el rol baja al
 * front. Con el default fail-closed, el panel de equipo sería invisible para
 * todos —incluido el admin— sin un 403, sin un log y sin nada que investigar.
 *
 * Por eso acá se lee el header y se verifica el token con `verificarSesion`, que
 * es puro y ya está exportado. **No responde 401 nunca**: no es una puerta, es
 * una anotación; la puerta sigue siendo el perímetro. Y con `if (!id) return
 * next()` un pedido sin sesión de vendedora —`/api/admin` y `/api/catalogo`, que
 * van con credencial de SERVICIO— no paga una consulta a la base.
 *
 * ══ NUNCA TIRA, Y ESO ES ESTRUCTURAL ═════════════════════════════════════════
 *
 * Express 4 no atrapa el rechazo de un middleware `async`: se vuelve
 * `unhandledRejection` y **el proceso se cae** (la misma cicatriz que documenta
 * `lib/ruta.ts`). Este corre delante de TODA la API, así que un rechazo acá no
 * es un 500: es Hermes abajo para todo el equipo. El `catch` deja el rol sin
 * resolver —fail-closed— y sigue.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Lo que dejó `cargarRol`. `undefined` si el pedido no traía sesión. */
      rolResuelto?: RolResuelto;
    }
  }
}

/**
 * El seam: quién lee la tabla.
 *
 * ⚠️ **Es un parámetro y no un default que importe `db/client.js`.** Ese módulo
 * **tira al importarse** si no hay `DATABASE_URL`, así que un default cómodo
 * ataría este archivo —y con él cualquier test que lo monte— a tener un `.env`.
 * Lo mismo por lo que `drizzle.config.ts` deja `client.ts` fuera de su glob.
 */
export type LectorDeEquipo = (idCrudo: string) => Promise<LecturaDeEquipo>;

export function cargarRol(
  leer: LectorDeEquipo,
  env: NodeJS.ProcessEnv = process.env,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const id = token ? verificarSesion(token) : null;
    // Sin sesión de vendedora no hay rol que resolver ni consulta que pagar.
    if (!id) {
      next();
      return;
    }
    leer(id)
      .then((lectura) => {
        req.rolResuelto = resolverRol(id, lectura, env);
      })
      .catch((e: unknown) => {
        // `leerPersona` ya traga lo suyo; esto es la red por si el seam es otro.
        console.error(`[equipo] cargarRol falló para «${id}» — ${porQueFallo(e)}`);
        req.rolResuelto = { ...SIN_IDENTIDAD, personaId: id.trim().toLowerCase() };
      })
      .finally(() => next());
  };
}

/**
 * EL ROL DE UN REQUEST, con su default explícito.
 *
 * Fail-closed: sin anotación, `vendedora` con `rolNoResuelto`. Un router montado
 * suelto en un test, o un pedido con credencial de servicio, no puede heredar
 * permisos por omisión — que es justo lo que hacía la lectura de `process.env`
 * desde adentro de cada handler.
 */
export function rolDe(req: Request): RolResuelto {
  return req.rolResuelto ?? SIN_IDENTIDAD;
}

/** ¿Manda sobre el trabajo de las demás? El reemplazo de `esSupervisor(id, env)`. */
export function mandaEnElEquipo(req: Request): boolean {
  return puedeSupervisar(rolDe(req).rol);
}

/** ¿Administra el equipo, las líneas y el ruteo? Solo admin. */
export function administra(req: Request): boolean {
  return puedeAdministrar(rolDe(req).rol);
}
