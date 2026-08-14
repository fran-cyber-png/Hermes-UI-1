import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * CREDENCIAL DE SERVICIO máquina-a-máquina (issue #95).
 *
 * El API de administración (`/api/admin`) lo consume CERBERUS, no una vendedora:
 * es un sistema hablándole a otro (registrar números, asignarlos, disparar la
 * vinculación). Por eso va detrás de un Bearer de SERVICIO —un secreto estático
 * compartido— y NO del HMAC de sesión de vendedoras (`auth/sesion.ts`). Mismo
 * header `Authorization`, otra familia de token.
 *
 * Fail-closed y en tiempo constante: sin el secreto configurado en el server,
 * TODO es 401 (nunca abre por accidente).
 */

if (!process.env.HERMES_ADMIN_SERVICE_TOKEN && process.env.NODE_ENV === "production") {
  throw new Error(
    "HERMES_ADMIN_SERVICE_TOKEN no está configurado — no arranco en producción sin la credencial de servicio del API de administración (/api/admin).",
  );
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** La identidad del servicio que pasó `requiereServicio` (hoy solo 'cerberus'). */
      servicio?: string;
    }
  }
}

/**
 * ¿El token recibido es EXACTAMENTE el esperado? Puro y en tiempo constante. Sin
 * secreto esperado devuelve siempre false (fail-closed). Extraído para poder
 * probar la puerta sin depender del env ni de Express.
 */
export function credencialValida(recibido: string, esperado: string): boolean {
  if (!esperado || !recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Middleware: exige la credencial de servicio. Sin ella (o incorrecta), 401 con el
 * mismo envelope de error `{ error: { motivo, mensaje } }` que el resto de `/api/admin`.
 */
export function requiereServicio(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!credencialValida(token, process.env.HERMES_ADMIN_SERVICE_TOKEN ?? "")) {
    res.status(401).json({
      error: { motivo: "credencial_invalida", mensaje: "credencial de servicio inválida o ausente" },
    });
    return;
  }
  req.servicio = "cerberus";
  next();
}

/**
 * EXIGE UNA IDENTIDAD DE SERVICIO CONCRETA — el candado que hace que `req.servicio`
 * signifique algo.
 *
 * ══ POR QUÉ HACE FALTA ══════════════════════════════════════════════════════
 *
 * `/api/admin` se monta con **un solo middleware para el router entero**
 * (`index.ts`: `app.use("/api/admin", requiereServicio, adminRouter)`), y hasta hoy
 * **nadie leía `req.servicio`**: se asignaba y nada más. O sea que la identidad no
 * acotaba nada, y el día que entre un segundo consumidor con su propia credencial
 * —el directorio de personas es el candidato— hereda de yapa **todo** `/api/admin`,
 * incluido `?purgar=true`, que es lo único irreversible del frente: recuperar una
 * sesión purgada exige el teléfono físico y volver a escanear el QR.
 *
 * El agujero no es que hoy alguien pueda purgar (hoy hay un solo token, y es de
 * Cerberus). Es que **sumar una credencial no cuesta nada y concede todo**, y eso no
 * se ve leyendo la ruta nueva: se ve leyendo un `app.use` de otro archivo.
 *
 * Con esto, una operación destructiva **nombra** de quién la acepta. Agregar un
 * consumidor pasa a ser una decisión explícita —hay que escribirlo en la lista— en
 * vez de un efecto secundario.
 */
export function exigeServicio(...permitidos: string[]) {
  return function guarda(req: Request, res: Response, next: NextFunction): void {
    if (!req.servicio || !permitidos.includes(req.servicio)) {
      res.status(403).json({
        error: {
          motivo: "servicio_no_autorizado",
          mensaje: "esta operación no está habilitada para tu credencial de servicio",
        },
      });
      return;
    }
    next();
  };
}

/**
 * LA SEGUNDA IDENTIDAD DE SERVICIO — el mecanismo ya existía, la identidad no.
 *
 * `requiereServicio` está clavado a UN consumidor (`req.servicio = "cerberus"`)
 * y a UN secreto (el del API de administración). Ivi es el consumidor #2, y su
 * necesidad es de solo lectura: el catálogo de piezas. Darle el token de
 * administración sería darle, de yapa, la potestad de re-apuntar números de
 * WhatsApp y borrar sesiones — para leer una lista.
 *
 * Así que la generalización mínima: la misma puerta, otro secreto, otra
 * identidad. Cada consumidor máquina trae su credencial y lo que se le rompa a
 * uno no toca al otro (issue #95).
 *
 * ── Por qué 503 y no 401 cuando falta el secreto ──
 * Es la lección que Ivi aprendió del otro lado con `401` vs `503`, y que ya
 * está escrita en `ivi/cliente.ts`: **«el server no tiene token» y «el cliente
 * mandó mal el token» no pueden verse iguales**, o una falla de configuración
 * se disfraza de credencial equivocada y se vive semanas sin enterarse. Del
 * lado de Cerberus esa distinción no existe porque el server **no arranca** en
 * producción sin `HERMES_ADMIN_SERVICE_TOKEN`; acá no se puede hacer lo mismo
 * sin voltear el server de producción en el próximo deploy, así que la falta de
 * configuración se dice en la respuesta. Sigue siendo fail-closed: sin secreto
 * no entra nadie.
 */
export function requiereServicioDeCatalogo(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const esperado = process.env.HERMES_CATALOGO_SERVICE_TOKEN ?? "";
  if (!esperado) {
    res.status(503).json({
      error: {
        motivo: "falta_config",
        mensaje:
          "el server no tiene configurada la credencial de servicio del catálogo (HERMES_CATALOGO_SERVICE_TOKEN)",
      },
    });
    return;
  }

  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!credencialValida(token, esperado)) {
    res.status(401).json({
      error: { motivo: "credencial_invalida", mensaje: "credencial de servicio inválida o ausente" },
    });
    return;
  }
  req.servicio = "catalogo";
  next();
}
