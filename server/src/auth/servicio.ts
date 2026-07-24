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
