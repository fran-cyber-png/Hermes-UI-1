/**
 * Ejecución de acciones del bot — el puente entre "lo que el agente decidió"
 * y "lo que se escribe en la base".
 *
 * Separa los efectos del pipeline: el orquestador solo llama a `ejecutarAcciones`
 * y este módulo se ocupa de las tablas. Si una tabla no existe, degrada sin tumbar.
 */

import { db } from "../db/client.js";
import { botPausas, botCalificaciones } from "../db/bot.js";
import type { Accion } from "./acciones.js";

export async function ejecutarAcciones(
  acciones: Accion[],
  clave: string,
): Promise<void> {
  for (const accion of acciones) {
    await ejecutarUna(accion, clave);
  }
}

async function ejecutarUna(accion: Accion, clave: string): Promise<void> {
  try {
    switch (accion.tipo) {
      case "calificar":
        await db
          .insert(botCalificaciones)
          .values({
            clave,
            temperatura: accion.temperatura,
            motivo: accion.motivo,
            escalada: false,
          })
          .onConflictDoUpdate({
            target: botCalificaciones.clave,
            set: {
              temperatura: accion.temperatura,
              motivo: accion.motivo,
              actualizadoEn: new Date(),
            },
          });
        break;

      case "escalar":
        await db
          .insert(botCalificaciones)
          .values({
            clave,
            temperatura: "caliente",
            motivo: accion.motivo,
            escalada: true,
          })
          .onConflictDoUpdate({
            target: botCalificaciones.clave,
            set: {
              escalada: true,
              motivo: accion.motivo,
              actualizadoEn: new Date(),
            },
          });
        await db
          .insert(botPausas)
          .values({
            clave,
            motivo: `escalado_${accion.motivo}`,
            hasta: null,
          })
          .onConflictDoUpdate({
            target: botPausas.clave,
            set: {
              motivo: `escalado_${accion.motivo}`,
              hasta: null,
            },
          });
        break;

      case "pausar":
        await db
          .insert(botPausas)
          .values({
            clave,
            motivo: accion.motivo,
            hasta: null,
          })
          .onConflictDoUpdate({
            target: botPausas.clave,
            set: {
              motivo: accion.motivo,
              hasta: null,
            },
          });
        break;

      case "mandar_pieza":
      case "registrar_interes":
        // Estas acciones las ejecuta el handler en tools.ts
        break;
    }
  } catch {
    // Degradación: si la tabla no existe, la acción se pierde sin tumbar el loop
  }
}
