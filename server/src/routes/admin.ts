import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Router, type Request, type Response } from "express";
import { db } from "../db/client.js";
import { gestorWhatsapp } from "../whatsapp/wiring.js";
import { vinculador } from "../whatsapp/vinculador.js";
import {
  esquemaUpsert,
  normalizarNumero,
  sesionPublicada,
  estadoVinculacionAContrato,
  esPareoEnVuelo,
  type SesionContrato,
} from "../numeros/dominio.js";
import type { EstadoSesion } from "../whatsapp/transporte.js";
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

const DIR_SESIONES = fileURLToPath(new URL("../../.wa-sessions/", import.meta.url));

function responderError(res: Response, status: number, motivo: string, mensaje: string): void {
  res.status(status).json({ error: { motivo, mensaje } });
}

/**
 * El estado de sesión de UN número, honesto con lo que de verdad corre.
 *
 * Con el `GestorWhatsapp` (#50) viven N transportes, así que el estado sale de la
 * línea que corresponde a ESE número. Si esa línea no está levantada, se deduce
 * de si existe la sesión `.db`.
 */
function sesionDeNumero(numero: string): SesionContrato {
  // LE PREGUNTA AL GESTOR, NO AL ENV (#50).
  //
  // Antes esto miraba `WHATSAPP_NUMERO`: el único número que podía reportar
  // estado real era el primero, y **cualquier otra línea viva se veía
  // "Desconectado"** aunque estuviera conectada y atendiendo. Con una sola línea
  // eso era exacto; con dos, el semáforo del panel miente justo sobre lo que se
  // acaba de agregar — y un semáforo que miente enseña a no mirarlo.
  //
  // Ahora el estado sale de la línea que DE VERDAD corre, sea cuál sea.
  let estadoVivo: EstadoSesion | null = null;
  try {
    // `de()` devuelve null si esa línea no corre — y NUNCA cae al primero, que es
    // lo que hacía que el semáforo de la segunda línea mostrara el de la primera.
    estadoVivo = gestorWhatsapp().de(numero)?.transporte.estado() ?? null;
  } catch {
    /* whatsapp no arrancado (no debería en runtime); cae a la deducción por archivo */
  }

  // La decisión vive en `numeros/dominio.ts`, pura y con test. Acá solo se juntan
  // los dos datos que hay que mirar.
  return sesionPublicada(estadoVivo, existsSync(`${DIR_SESIONES}${numero}.db`));
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

  // Solo un pareo EN VUELO toma el candado. Un `conectado`/`error`/`baneado` viejo
  // no: el cliente de ese ya está cerrado o muerto, e `iniciar()` arranca cerrando.
  // Antes bloqueaba cualquier estado, así que una vinculación EXITOSA dejaba el
  // vinculador en `conectado` para siempre y el próximo número nuevo comía 409
  // eternamente — el éxito bloqueaba tanto como la falla.
  const enCurso = vinculador.estado();
  if (esPareoEnVuelo(enCurso) && "numero" in enCurso && enCurso.numero !== numero) {
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

/**
 * SUELTA el vinculador. Es la salida del operador que abrió una vinculación y no
 * la escaneó: el vinculador es uno-a-la-vez, así que ese pareo colgado bloquea a
 * TODOS los demás números, y hasta acá la única forma de destrabarlo era reiniciar
 * Hermes — que tira las sesiones de las vendedoras.
 *
 * Es idempotente: cancelar algo que ya no está en curso responde 200 con
 * `cancelada: false`. Cancelar la vinculación de OTRO número es 409, no un
 * silencio: quien la pidió tiene que saber que apagó algo ajeno.
 */
adminRouter.delete("/numeros/:numero/vincular", async (req: Request, res: Response) => {
  const numero = normalizarNumero(req.params.numero);
  if (!numero) return responderError(res, 400, "entrada_invalida", "número inválido");

  // Si no hay nada EN VUELO, no hay nada que soltar: un `conectado` terminal ya no
  // toma el candado, así que cancelarlo no destraba nada que estuviera trabado.
  const enCurso = vinculador.estado();
  if (!esPareoEnVuelo(enCurso)) {
    res.json({ estado: "inactivo", cancelada: false });
    return;
  }
  if ("numero" in enCurso && enCurso.numero !== numero) {
    res.status(409).json({
      error: {
        motivo: "vinculacion_en_curso",
        mensaje: `la vinculación en curso es de ${enCurso.numero}, no de ${numero}`,
        numero_en_curso: enCurso.numero,
      },
    });
    return;
  }

  await vinculador.cancelar();
  res.json({ estado: "inactivo", cancelada: true });
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
