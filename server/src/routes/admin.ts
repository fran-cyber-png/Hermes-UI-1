import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { Router, type Request, type Response } from "express";
import { db } from "../db/client.js";
import { whatsapp } from "../whatsapp/wiring.js";
import { vinculador } from "../whatsapp/vinculador.js";
import {
  esquemaUpsert,
  normalizarNumero,
  estadoSesionAContrato,
  estadoVinculacionAContrato,
  type SesionContrato,
} from "../numeros/dominio.js";
import {
  listarNumeros,
  obtenerNumero,
  upsertNumero,
  desactivarNumero,
  marcarVinculado,
  type NumeroRow,
} from "../numeros/repositorio.js";

/**
 * API DE ADMINISTRACIÓN DE NÚMEROS — lo que Cerberus consume (issue #50 / #95).
 *
 * Va detrás de `requiereServicio` (se monta con él en index.ts): lo llama un
 * SISTEMA (el panel de Cerberus), no una vendedora. Cerberus es la fuente de
 * verdad y EMPUJA acá los cambios; Hermes guarda la copia que necesita para rutear
 * y etiquetar, y ejecuta la vinculación (la credencial nunca sale del server).
 *
 * Errores con envelope común `{ error: { motivo, mensaje } }` y el HTTP saliendo
 * del motivo (patrón de la casa, arquitectura §5.4).
 */
export const adminRouter = Router();

const DIR_SESIONES = new URL("../../.wa-sessions/", import.meta.url).pathname;

function responderError(res: Response, status: number, motivo: string, mensaje: string): void {
  res.status(status).json({ error: { motivo, mensaje } });
}

/**
 * El estado de sesión de UN número, honesto con lo que hoy corre. Hoy vive UN
 * transporte (el de `WHATSAPP_NUMERO`): si el número consultado es ese, se reporta
 * su estado real; si no, se deduce de si existe la sesión `.db` (vinculado pero no
 * en vivo hasta el GestorWhatsapp, #50).
 */
function sesionDeNumero(numero: string): SesionContrato {
  const numeroVivo = normalizarNumero(process.env.WHATSAPP_NUMERO ?? "");
  if (numeroVivo && numero === numeroVivo) {
    try {
      return estadoSesionAContrato(whatsapp().transporte.estado());
    } catch {
      /* whatsapp no arrancado (no debería en runtime); cae a la deducción por archivo */
    }
  }
  if (existsSync(`${DIR_SESIONES}${numero}.db`)) return { estado: "desconectado", ban: null };
  return { estado: "sin_vincular", ban: null };
}

function aNumeroContrato(fila: NumeroRow) {
  const sesion = sesionDeNumero(fila.numero);
  return {
    numero: fila.numero,
    etiqueta: fila.etiqueta,
    proposito: fila.proposito,
    referencia: fila.referencia,
    activo: fila.activo,
    vendedoras: fila.vendedoras,
    sesion: {
      estado: sesion.estado,
      vinculado_at: fila.vinculadoAt ? fila.vinculadoAt.toISOString() : null,
      ban: sesion.ban,
    },
  };
}

/** Verificación de credencial: Cerberus la usa al configurar el token. */
adminRouter.get("/ping", (_req: Request, res: Response) => {
  res.json({ servicio: "cerberus", ok: true });
});

adminRouter.get("/numeros", async (_req: Request, res: Response) => {
  try {
    const filas = await listarNumeros(db);
    res.json({ numeros: filas.map(aNumeroContrato) });
  } catch (err) {
    responderError(res, 500, "fallo_interno", (err as Error).message);
  }
});

adminRouter.get("/numeros/:numero", async (req: Request, res: Response) => {
  const numero = normalizarNumero(req.params.numero);
  if (!numero) return responderError(res, 400, "entrada_invalida", "número inválido");
  try {
    const fila = await obtenerNumero(db, numero);
    if (!fila) return responderError(res, 404, "no_existe", `el número ${numero} no está registrado`);
    res.json({ numero: aNumeroContrato(fila) });
  } catch (err) {
    responderError(res, 500, "fallo_interno", (err as Error).message);
  }
});

/** Upsert declarativo: Cerberus empuja el estado deseado completo. Idempotente. */
adminRouter.put("/numeros/:numero", async (req: Request, res: Response) => {
  const numero = normalizarNumero(req.params.numero);
  if (!numero) return responderError(res, 400, "entrada_invalida", "número inválido");
  const parsed = esquemaUpsert.safeParse(req.body);
  if (!parsed.success) {
    return responderError(res, 400, "entrada_invalida", parsed.error.issues.map((i) => i.message).join("; "));
  }
  try {
    const fila = await upsertNumero(db, numero, parsed.data);
    res.json({ numero: aNumeroContrato(fila) });
  } catch (err) {
    responderError(res, 500, "fallo_interno", (err as Error).message);
  }
});

/** Baja lógica. `?purgar=true` borra además la sesión `.db` (destructivo). */
adminRouter.delete("/numeros/:numero", async (req: Request, res: Response) => {
  const numero = normalizarNumero(req.params.numero);
  if (!numero) return responderError(res, 400, "entrada_invalida", "número inválido");
  try {
    const existia = await desactivarNumero(db, numero);
    if (!existia) return responderError(res, 404, "no_existe", `el número ${numero} no está registrado`);
    if (req.query.purgar === "true") {
      for (const suf of ["", "-wal", "-shm"]) {
        await rm(`${DIR_SESIONES}${numero}.db${suf}`, { force: true }).catch(() => {});
      }
    }
    res.json({ ok: true });
  } catch (err) {
    responderError(res, 500, "fallo_interno", (err as Error).message);
  }
});

/**
 * Arranca la vinculación. El vinculador es global uno-a-la-vez (SQLite no admite
 * dos escritores de la misma sesión): si hay OTRO número en curso, 409. Si el
 * número ya está conectado y no se fuerza, 409. La respuesta es `vinculando`; el QR
 * aparece en el polling de `.../vincular/estado`.
 */
adminRouter.post("/numeros/:numero/vincular", (req: Request, res: Response) => {
  const numero = normalizarNumero(req.params.numero);
  if (!numero) return responderError(res, 400, "entrada_invalida", "número inválido");

  const enCurso = vinculador.estado();
  if (enCurso.estado !== "inactivo" && "numero" in enCurso && enCurso.numero !== numero) {
    res.status(409).json({
      error: {
        motivo: "vinculacion_en_curso",
        mensaje: `hay otra vinculación en curso (${enCurso.numero})`,
        numero_en_curso: enCurso.numero,
      },
    });
    return;
  }

  if (sesionDeNumero(numero).estado === "conectado" && req.query.forzar !== "true") {
    res.status(409).json({
      error: {
        motivo: "ya_vinculado",
        mensaje: `el número ${numero} ya está conectado; usá ?forzar=true para re-vincular`,
      },
    });
    return;
  }

  // Fire-and-forget: la vinculación corre en segundo plano; Cerberus poletea el estado.
  void vinculador.iniciar(numero);
  res.json({ estado: "vinculando" });
});

/** Polling del pareo. Al conectar, libera la sesión `.db` y marca vinculado. */
adminRouter.get("/numeros/:numero/vincular/estado", (req: Request, res: Response) => {
  const numero = normalizarNumero(req.params.numero);
  if (!numero) return responderError(res, 400, "entrada_invalida", "número inválido");

  const e = vinculador.estado();
  if (e.estado !== "inactivo" && "numero" in e && e.numero === numero) {
    if (e.estado === "conectado") {
      // Cierra el vinculador para liberar el `.db` (así el transporte lo abre) y
      // deja registrado el momento de vinculación. Efecto lateral idempotente.
      void vinculador.cerrar();
      void marcarVinculado(db, numero).catch(() => {});
    }
    res.json(estadoVinculacionAContrato(e));
    return;
  }

  // No hay pareo en curso para este número: se reporta su estado de sesión.
  res.json({ estado: sesionDeNumero(numero).estado === "conectado" ? "conectado" : "expirado" });
});
