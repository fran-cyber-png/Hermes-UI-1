import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gestorWhatsapp } from "../whatsapp/wiring.js";
import { sesionPublicada, type SesionContrato } from "./dominio.js";
import type { EstadoSesion } from "../whatsapp/transporte.js";

const DIR_SESIONES = fileURLToPath(new URL("../../.wa-sessions/", import.meta.url));

/**
 * El estado de sesión de UN número, honesto con lo que de verdad corre (#50).
 *
 * Vivía duplicado adentro de `routes/admin.ts`. Con la auto-vinculación (D13
 * deja de ser solo consola de operador) apareció un SEGUNDO consumidor —la
 * vendedora consultando su propia línea— y dos copias del mismo hecho ya
 * divergieron una vez en este repo (#37): se extrae a un solo lugar antes de
 * que haya una segunda a la que olvidarse de actualizar.
 */
export function sesionDeNumero(numero: string): SesionContrato {
  let estadoVivo: EstadoSesion | null = null;
  try {
    // `de()` nunca cae al primero: una línea que no corre es `null`, no la de otra.
    estadoVivo = gestorWhatsapp().de(numero)?.transporte.estado() ?? null;
  } catch {
    /* whatsapp no arrancado (no debería en runtime); cae a la deducción por archivo */
  }
  return sesionPublicada(estadoVivo, existsSync(`${DIR_SESIONES}${numero}.db`));
}
