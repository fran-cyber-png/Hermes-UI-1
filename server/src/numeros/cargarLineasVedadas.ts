import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verificarSesion } from "../auth/sesion.js";
import { porQueFallo } from "../lib/porQueFallo.js";

/**
 * LAS LÍNEAS VEDADAS DE QUIEN PIDE, ANOTADAS UNA VEZ POR REQUEST.
 *
 * Gemelo de `equipo/cargarRol.ts`, y por las mismas dos razones: resuelve el
 * Bearer por su cuenta (no puede depender de que `requiereVendedora` haya
 * corrido, porque `/api/auth` está en `PREFIJOS_ABIERTOS`) y **nunca tira**
 * (Express 4 no atrapa el rechazo de un middleware `async`: se vuelve
 * `unhandledRejection` y el proceso se cae — la cicatriz de `lib/ruta.ts`).
 *
 * ══ 🔴 NO ATRAPAR NO ES LO MISMO QUE FALLAR ABIERTO ══════════════════════════
 *
 * Acá el `catch` existe para que el proceso siga vivo, **no** para seguir
 * sirviendo. Cuando la lectura falla se anota el fallo y `vedadasDe(req)`
 * **tira**, así la ruta que la pide termina en 500 por `lib/ruta.ts`. Es la
 * diferencia entre «Hermes abajo para todo el equipo» y «esta ruta no puede
 * responder ahora», y en una frontera hay que elegir la segunda: un recorte que
 * no se pudo evaluar no se adivina hacia el lado cómodo.
 *
 * Una ruta que no pregunta no paga nada: sin sesión de vendedora ni siquiera se
 * consulta la base (`/api/admin` y `/api/catalogo` van con credencial de
 * servicio).
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Los números que esta persona no puede ver. `undefined` = no se resolvió. */
      lineasVedadas?: string[];
      /** Se intentó resolver y falló. Distinto de «no había sesión». */
      lineasVedadasRotas?: boolean;
    }
  }
}

/** El seam: quién lee el registro de líneas. Mismo motivo que `LectorDeEquipo`. */
export type LectorDeLineasVedadas = (vendedoraId: string) => Promise<string[]>;

export function cargarLineasVedadas(leer: LectorDeLineasVedadas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const id = token ? verificarSesion(token) : null;
    if (!id) {
      // Sin sesión de vendedora no hay identidad que consultar. Se deja SIN
      // anotar: `vedadasDe` lo trata como «sin identidad», que veda toda campaña.
      next();
      return;
    }
    leer(id)
      .then((vedadas) => {
        req.lineasVedadas = vedadas;
      })
      .catch((e: unknown) => {
        console.error(`[numeros] no se pudieron resolver las líneas vedadas de «${id}» — ${porQueFallo(e)}`);
        req.lineasVedadasRotas = true;
      })
      .finally(() => next());
  };
}

/**
 * Las líneas vedadas de este request.
 *
 * 🔴 **Tira si la lectura falló**, y ese throw es la frontera: sin él, una base
 * que parpadeó devolvería `[]` y `[]` significa «no le está vedada ninguna» —
 * exactamente la fuga que este módulo existe para cerrar, y sin un solo síntoma.
 *
 * Sin anotación y sin fallo (un request sin sesión, un router montado suelto en
 * un test) devuelve `[]`: ahí no hay nada que vedar porque no hay línea que
 * pedir — el que decide es el llamador, que compara contra un número concreto.
 */
export function vedadasDe(req: Request): string[] {
  if (req.lineasVedadasRotas) {
    throw new Error("no se pudo resolver qué líneas ve esta persona");
  }
  return req.lineasVedadas ?? [];
}

/** ¿Esta línea le está vedada a quien pide? `undefined`/`''` = no hay línea que juzgar. */
export function lineaVedadaEnElRequest(req: Request, numeroPropio: string | undefined | null): boolean {
  const n = (numeroPropio ?? "").trim();
  if (!n) return false;
  return vedadasDe(req).includes(n);
}
