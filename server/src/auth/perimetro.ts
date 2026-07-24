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

/** Prefijos de /api que NO exigen token, cada uno con su razón de existir. */
const PREFIJOS_ABIERTOS = [
  '/api/auth', // el login: sin esto nadie consigue token (y /yo valida el suyo adentro)
  '/api/whatsapp/_sim', // dev-only: index.ts solo lo monta fuera de producción
  '/api/whatsapp/_dev', // dev-only: index.ts solo lo monta con el transporte falso y fuera de producción
];

/** ¿Esta ruta queda fuera de la exigencia de vendedora? */
export function esRutaAbierta(path: string): boolean {
  if (path !== '/api' && !path.startsWith('/api/')) return true;
  return PREFIJOS_ABIERTOS.some((p) => path === p || path.startsWith(`${p}/`));
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
