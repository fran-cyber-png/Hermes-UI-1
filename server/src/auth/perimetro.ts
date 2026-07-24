import type { NextFunction, Request, Response } from 'express';
import { requiereVendedora } from './sesion.js';

/**
 * EL PERÍMETRO DE LA API — cerrado por defecto.
 *
 * Antes cada router decidía por su cuenta si pedía token, y 19 de 27 quedaron
 * abiertos: la cola, los hilos, los adjuntos de clientes reales y el responder
 * que publica en Facebook, todo accesible desde internet (issue #36). La
 * lección: la auth por-router se olvida; el perímetro no.
 *
 * La regla es una sola: **todo `/api/*` exige una vendedora**, salvo lo que está
 * enumerado acá con su porqué. Un router nuevo nace protegido sin que nadie se
 * acuerde de nada. Lo que no es `/api` (webhooks, health, la UI servida, la
 * consola de vinculación) tiene su propia puerta y no pasa por este middleware.
 *
 * Los routers que ya traían `requiereVendedora` adentro lo conservan: verificar
 * dos veces es gratis; olvidarse una vez ya costó una exposición.
 */

/** Prefijos de /api que NO exigen vendedora NUNCA, con su razón de existir. */
const PREFIJOS_ABIERTOS = [
  '/api/auth', // el login: sin esto nadie consigue token (y /yo valida el suyo adentro)
  '/api/admin', // su puerta es la CREDENCIAL DE SERVICIO (requiereServicio, #85): la llama Cerberus, no una vendedora
];

/**
 * Prefijos exentos SOLO fuera de producción. En prod estas rutas ni se montan
 * (index.ts) — pero el perímetro no depende de acordarse de eso: si algún día
 * se montaran igual, acá nacen cerradas.
 */
const PREFIJOS_ABIERTOS_DEV = [
  '/api/whatsapp/_sim', // simular detección de origen
  '/api/whatsapp/_dev', // inyectar mensajes con el transporte falso
];

/** ¿Esta ruta queda fuera de la exigencia de vendedora? */
export function esRutaAbierta(
  path: string,
  enProduccion: boolean = process.env.NODE_ENV === 'production',
): boolean {
  // En minúsculas ANTES de comparar: Express rutea case-insensitive por
  // defecto, así que /API/conversaciones llega al router igual — sin esto,
  // las mayúsculas esquivaban la guardia.
  const p = path.toLowerCase();
  if (p !== '/api' && !p.startsWith('/api/')) return true;
  const abiertos = enProduccion ? PREFIJOS_ABIERTOS : [...PREFIJOS_ABIERTOS, ...PREFIJOS_ABIERTOS_DEV];
  return abiertos.some((prefijo) => p === prefijo || p.startsWith(`${prefijo}/`));
}

/**
 * Middleware de app (va ANTES de montar cualquier router): deja pasar lo
 * enumerado y exige vendedora para todo el resto de `/api`.
 */
export function perimetroApi(req: Request, res: Response, next: NextFunction): void {
  if (esRutaAbierta(req.path)) {
    next();
    return;
  }
  requiereVendedora(req, res, next);
}
