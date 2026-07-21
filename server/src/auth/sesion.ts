import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * LA SESIÓN DE LA VENDEDORA EN HERMES.
 *
 * Cerberus valida las credenciales (ver `cerberus/auth.ts`); una vez validadas,
 * Hermes emite SU PROPIO token para no volver a pedir la clave en cada request.
 * El token es un HMAC firmado con `HERMES_SESSION_SECRET`: lleva el id de la
 * vendedora y una expiración, y no se puede falsificar sin el secreto.
 *
 * Es un Bearer token (va en `Authorization`, no en cookie httpOnly): la app de
 * escritorio habla con su propio backend, y un header evita todo el enredo de
 * cookies cross-origin entre el renderer de Electron y el server.
 */

const SECRET = process.env.HERMES_SESSION_SECRET ?? 'dev-inseguro-cambiar-en-produccion';
const DURACION_MS = 14 * 24 * 60 * 60 * 1000; // 14 días, como el "mantener sesión" de Cerberus.

if (SECRET === 'dev-inseguro-cambiar-en-produccion' && process.env.NODE_ENV === 'production') {
  throw new Error('HERMES_SESSION_SECRET no está configurado — no arranco en producción con el secreto de dev.');
}

export function firmarSesion(vendedoraId: string): string {
  const cuerpo = Buffer.from(`${vendedoraId}|${Date.now() + DURACION_MS}`).toString('base64url');
  const firma = createHmac('sha256', SECRET).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}

/** Devuelve el vendedoraId si el token es válido y no expiró; si no, null. */
export function verificarSesion(token: string): string | null {
  const [cuerpo, firma] = token.split('.');
  if (!cuerpo || !firma) return null;

  const esperada = createHmac('sha256', SECRET).update(cuerpo).digest('base64url');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  // Comparación en tiempo constante: no se filtra la firma correcta byte a byte.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [vendedoraId, expira] = Buffer.from(cuerpo, 'base64url').toString().split('|');
  if (!vendedoraId || Number(expira) < Date.now()) return null;
  return vendedoraId;
}

/** El id de la vendedora que Express cuelga del request tras validar el token. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      vendedoraId?: string;
    }
  }
}

/**
 * Middleware: exige una sesión válida. Sin token o con token inválido, 401 —
 * nada de lo protegido se ve. Es la puerta delante de todo lo que envía o
 * atribuye a una vendedora.
 */
export function requiereVendedora(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const vendedoraId = token ? verificarSesion(token) : null;

  if (!vendedoraId) {
    res.status(401).json({ ok: false, message: 'sesión inválida o expirada, volvé a ingresar' });
    return;
  }
  req.vendedoraId = vendedoraId;
  next();
}
