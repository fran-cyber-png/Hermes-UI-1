import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Router, type Request, type Response } from "express";
import { exigeServicio } from "../auth/servicio.js";
import { db } from "../db/client.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { ruta } from "../lib/ruta.js";
import { gestorWhatsapp } from "../whatsapp/wiring.js";
import { vinculador } from "../whatsapp/vinculador.js";
import {
  esquemaUpsert,
  normalizarNumero,
  estadoVinculacionAContrato,
  esPareoEnVuelo,
} from "../numeros/dominio.js";
import { sesionDeNumero } from "../numeros/estadoSesion.js";
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

adminRouter.get(
  "/numeros",
  ruta(async (_req: Request, res: Response) => {
    try {
      const filas = await listarNumeros(db);
      res.json({ numeros: filas.map(aNumeroContrato) });
    } catch (err) {
      console.error(`GET /api/admin/numeros falló — ${porQueFallo(err)}`);
      responderError(res, 500, "fallo_interno", "no se pudo completar la operación");
    }
  }),
);

adminRouter.get(
  "/numeros/:numero",
  ruta(async (req: Request, res: Response) => {
    const numero = normalizarNumero(req.params.numero);
    if (!numero) return responderError(res, 400, "entrada_invalida", "número inválido");
    try {
      const fila = await obtenerNumero(db, numero);
      if (!fila) return responderError(res, 404, "no_existe", `el número ${numero} no está registrado`);
      res.json({ numero: aNumeroContrato(fila) });
    } catch (err) {
      console.error(`GET /api/admin/numeros/${numero} falló — ${porQueFallo(err)}`);
      responderError(res, 500, "fallo_interno", "no se pudo completar la operación");
    }
  }),
);

/** Upsert declarativo: Cerberus empuja el estado deseado completo. Idempotente. */
adminRouter.put(
  "/numeros/:numero",
  ruta(async (req: Request, res: Response) => {
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
      console.error(`PUT /api/admin/numeros/${numero} falló — ${porQueFallo(err)}`);
      responderError(res, 500, "fallo_interno", "no se pudo completar la operación");
    }
  }),
);

/**
 * Baja lógica. `?purgar=true` borra además la sesión `.db` (destructivo).
 *
 * 🔴 Lleva `exigeServicio("cerberus")` aunque hoy sea la única credencial que
 * existe: es lo ÚNICO irreversible de este router —recuperar una sesión purgada
 * pide el teléfono físico y volver a escanear el QR— y el router entero se monta
 * detrás de un solo middleware. Sin esto, el día que entre una segunda credencial
 * de servicio, hereda el purgado sin que nadie lo haya decidido y sin que se vea
 * leyendo esta ruta. Ver `auth/servicio.ts`.
 */
adminRouter.delete(
  "/numeros/:numero",
  exigeServicio("cerberus"),
  ruta(async (req: Request, res: Response) => {
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
      console.error(`DELETE /api/admin/numeros/${numero} falló — ${porQueFallo(err)}`);
      responderError(res, 500, "fallo_interno", "no se pudo completar la operación");
    }
  }),
);

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
adminRouter.delete(
  "/numeros/:numero/vincular",
  ruta(async (req: Request, res: Response) => {
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
  }),
);

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
