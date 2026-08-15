import { Router, type Request, type Response } from "express";
import { db } from "../db/client.js";
import { vinculador } from "../whatsapp/vinculador.js";
import { agregarLineaWhatsmeow } from "../whatsapp/wiring.js";
import {
  esPareoEnVuelo,
  estadoVinculacionAContrato,
  normalizarNumero,
} from "../numeros/dominio.js";
import { sesionDeNumero } from "../numeros/estadoSesion.js";
import { lineasDeVendedora, marcarVinculado, obtenerNumero, upsertNumero } from "../numeros/repositorio.js";
import { puedeAutoVincular } from "../numeros/autoVinculacion.js";

/**
 * MI LÍNEA — la auto-vinculación desde la app (decisión del dueño, 15-ago-2026).
 *
 * Hasta acá vincular era D13: server-side, un operador mirando `/vincular` o el
 * panel de Cerberus. Esto NO reemplaza esa puerta — Cerberus sigue siendo quien
 * declara cualquier línea con `PUT /api/admin/numeros/:numero`, y esa sigue
 * siendo la única forma de tocar una línea de la Escuela o de campaña. Esto abre
 * una puerta SEGUNDA y más angosta: una vendedora sin línea propia puede traer
 * la suya, sola, escaneando su propio QR desde Hermes.
 *
 * Va detrás de `requiereVendedora` (perímetro de `/api`, `auth/perimetro.ts`):
 * no hace falta declararlo acá, nace cerrado. Reusa el vinculador GLOBAL
 * (`whatsapp/vinculador.ts`, D13): sigue siendo de a UN pareo a la vez en todo
 * el server — Cerberus vinculando una línea de campaña y una vendedora
 * auto-vinculando la suya compiten por el mismo candado, y el que llegó segundo
 * recibe el mismo 409 `vinculacion_en_curso` de siempre.
 *
 * 🔴 **`pareoActual` existe para que el pareo en vuelo no se le atribuya a
 * quien lo mira, sino a quien lo empezó.** El vinculador es un singleton sin
 * dueño: sin esto, si Ana inicia un pareo y Bea consulta `/vincular/estado`
 * mientras tanto, Bea vería el QR de Ana y —peor— si llega justo cuando conecta,
 * la línea de Ana quedaría escrita como propia de Bea. Se limpia SIEMPRE antes
 * del primer `await` de cada rama que lo consume: dos pollings que se solapan no
 * pueden procesar el mismo `conectado` dos veces (Node no interrumpe entre el
 * chequeo y el `= null`).
 */
export const miLineaRouter = Router();

/**
 * `{ ok: false, message, codigo }` — el envelope que el CLIENTE del front sabe
 * leer (`lib/datos/cliente.ts:api()`). Es DISTINTO del de `admin.ts`
 * (`{error:{motivo,mensaje}}`): aquél lo consume Cerberus con su propio
 * cliente; a esta ruta la llama la app de la vendedora por la puerta de
 * siempre, y esa puerta espera `message`/`codigo`, no `error.mensaje`.
 */
function responderError(res: Response, status: number, codigo: string, message: string): void {
  res.status(status).json({ ok: false, message, codigo });
}

let pareoActual: { numero: string; vendedoraId: string } | null = null;

/** Mi línea de hoy. `numero: null` = todavía no auto-vinculé ninguna. */
miLineaRouter.get("/", async (req: Request, res: Response) => {
  const vendedoraId = req.vendedoraId!;
  try {
    const [numero] = await lineasDeVendedora(db, vendedoraId);
    if (!numero) {
      res.json({ numero: null });
      return;
    }
    res.json({ numero, sesion: sesionDeNumero(numero) });
  } catch (err) {
    responderError(res, 500, "fallo_interno", (err as Error).message);
  }
});

/** Arranca MI vinculación. El QR aparece en el polling de `.../vincular/estado`. */
miLineaRouter.post("/vincular", async (req: Request, res: Response) => {
  const vendedoraId = req.vendedoraId!;
  const numero = normalizarNumero(String(req.body?.numero ?? ""));
  if (!numero) return responderError(res, 400, "entrada_invalida", "número inválido");

  // 🔴 EL CANDADO SE TOMA ACÁ, SIN NINGÚN `await` DE POR MEDIO — y es la parte
  // que importa. `vinculador.iniciar()` tiene su PROPIO `await this.cerrar()`
  // antes de marcarse `esperando`, así que leer `vinculador.estado()` como
  // señal de «hay alguien en vuelo» tiene una ventana donde todavía dice
  // `inactivo` aunque YA se haya disparado un `iniciar()`. Dos POST casi
  // simultáneos pasarían los dos ese chequeo y el segundo `iniciar()` le
  // cerraría el cliente al primero a mitad de camino. `pareoActual` se toma de
  // forma SÍNCRONA, antes de la primera espera: Node no interrumpe este bloque
  // para atender la otra request en el medio.
  if (pareoActual) {
    responderError(
      res,
      409,
      "vinculacion_en_curso",
      "alguien más está vinculando un número ahora mismo — esperá un momento y probá de nuevo",
    );
    return;
  }
  pareoActual = { numero, vendedoraId };

  try {
    const lineasActuales = await lineasDeVendedora(db, vendedoraId);
    const decision = puedeAutoVincular(vendedoraId, process.env, lineasActuales);
    if (!decision.ok) {
      pareoActual = null;
      const mensaje =
        decision.motivo === "es_supervisor"
          ? "los supervisores no auto-vinculan una línea propia"
          : "ya tenés una línea vinculada — para cambiarla, hablá con quien administra Hermes";
      responderError(res, 409, decision.motivo, mensaje);
      return;
    }

    // Un número que YA está en `numeros_wa` —de la Escuela, de campaña, o de
    // otra vendedora— no se puede pisar por acá: eso lo sigue declarando
    // Cerberus. Rechazar ANTES de tocar el vinculador es lo que evita escanear
    // un QR real para enterarse recién al final de que el número no servía.
    const existente = await obtenerNumero(db, numero);
    if (existente) {
      pareoActual = null;
      responderError(res, 409, "numero_en_uso", "ese número ya está registrado en Hermes");
      return;
    }

    // Cruce con el OTRO origen del mismo candado global: un operador vinculando
    // por `/vincular` o `/api/admin` en este mismo instante. `pareoActual` de
    // arriba solo cubre a esta ruta; esto cubre a las demás.
    const enCurso = vinculador.estado();
    if (esPareoEnVuelo(enCurso) && "numero" in enCurso && enCurso.numero !== numero) {
      pareoActual = null;
      responderError(
        res,
        409,
        "vinculacion_en_curso",
        "alguien más está vinculando un número ahora mismo — esperá un momento y probá de nuevo",
      );
      return;
    }

    void vinculador.iniciar(numero);
    res.json({ estado: "vinculando" });
  } catch (err) {
    pareoActual = null;
    responderError(res, 500, "fallo_interno", (err as Error).message);
  }
});

/**
 * Polling de MI pareo. Al llegar a `conectado`: libera la sesión `.db`, la
 * registra (`numeros_wa` + `numero_vendedora`, propósito `vendedora`) y la
 * monta EN CALIENTE (`agregarLineaWhatsmeow`) — sin este último paso, la línea
 * quedaría vinculada y muda hasta el próximo reinicio del server.
 */
miLineaRouter.get("/vincular/estado", async (req: Request, res: Response) => {
  const vendedoraId = req.vendedoraId!;
  if (!pareoActual || pareoActual.vendedoraId !== vendedoraId) {
    // Nada en vuelo PARA MÍ — sea porque nunca empecé, porque ya terminó, o
    // porque el pareo en curso es de otra persona. No se distingue: filtrar
    // por dueño es la garantía, no un detalle a pulir después.
    res.json({ estado: "expirado" });
    return;
  }

  const e = vinculador.estado();
  if (!("numero" in e) || e.numero !== pareoActual.numero) {
    // El candado se soltó solo (caducó y nadie lo tomó, o — no debería, por el
    // 409 de arriba — otro número lo tomó). Ya no hay nada mío que reportar.
    pareoActual = null;
    res.json({ estado: "expirado" });
    return;
  }

  if (e.estado === "conectado") {
    const { numero } = pareoActual;
    // Se limpia YA, antes del primer `await`: un segundo polling que llegue
    // mientras esto corre ya no encuentra `pareoActual` y no reprocesa nada.
    pareoActual = null;
    try {
      await vinculador.cerrar();
      // 🔴 EL ORDEN IMPORTA: `upsertNumero` crea la fila; `marcarVinculado` la
      // ACTUALIZA. Al revés, el `UPDATE` corre contra un `numero` que todavía
      // no existe en `numeros_wa` —0 filas, sin error— y el INSERT que sigue
      // no lleva `vinculado_at` en su lista de columnas: queda NULL para
      // siempre, y el panel de Cerberus mostraría «nunca se vinculó» sobre una
      // línea que sí está viva.
      await upsertNumero(db, numero, {
        etiqueta: vendedoraId,
        proposito: "vendedora",
        activo: true,
        referencia: null,
        vendedoras: [vendedoraId],
      });
      await marcarVinculado(db, numero);
      agregarLineaWhatsmeow(numero);
    } catch (err) {
      // El teléfono SÍ conectó — no perder eso de vista en el mensaje: no es
      // "no se pudo vincular", es "vinculó y Hermes no lo pudo dejar anotado".
      console.error(`[mi-linea] ${numero} conectó pero no se pudo registrar:`, (err as Error).message);
      responderError(
        res,
        500,
        "fallo_interno",
        "el WhatsApp conectó pero Hermes no pudo dejarlo registrado — avisá para revisarlo a mano",
      );
      return;
    }
    res.json({ estado: "conectado", numero });
    return;
  }

  if (e.estado === "error" || e.estado === "baneado") {
    pareoActual = null;
  }
  res.json(estadoVinculacionAContrato(e));
});

/** Cancela MI pareo en vuelo. Cancelar el de otra persona es 409, no un silencio. */
miLineaRouter.delete("/vincular", async (req: Request, res: Response) => {
  const vendedoraId = req.vendedoraId!;
  if (!pareoActual || pareoActual.vendedoraId !== vendedoraId) {
    const enCurso = vinculador.estado();
    if (esPareoEnVuelo(enCurso)) {
      responderError(res, 409, "vinculacion_ajena", "la vinculación en curso no es la tuya");
      return;
    }
    res.json({ estado: "inactivo", cancelada: false });
    return;
  }
  pareoActual = null;
  await vinculador.cancelar();
  res.json({ estado: "inactivo", cancelada: true });
});
