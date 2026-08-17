import { Router, type Request, type RequestHandler, type Response } from "express";
import { requiereVendedora } from "../auth/sesion.js";
import { ruta } from "../lib/ruta.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { mismaVendedora } from "../reparto/destino.js";
import {
  esPareoEnVuelo,
  estadoVinculacionAContrato,
  normalizarNumero,
  type DatosUpsert,
  type EstadoVinculacion,
  type SesionContrato,
} from "../numeros/dominio.js";
import { esMiPareo, pareoVigente, type PareoPropio } from "../numeros/pareoPropio.js";
import {
  puedeAutoVincular,
  type LineaDeLaVendedora,
  type MotivoRechazoAutoVinculacion,
} from "../numeros/autoVinculacion.js";

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
 * ══ POR QUÉ ES UNA FACTORY Y NO UN ROUTER SUELTO ═══════════════════════════
 *
 * La primera versión importaba `db`, `vinculador` y `wiring` a nivel de módulo,
 * y con eso **no se podía escribir un solo test**: importar el archivo levantaba
 * la conexión a Postgres y el binario Go de whatsmeow. Los seams entran por
 * parámetro, con el molde que el repo ya usa (`iviRouter(preguntar)` en
 * `routes/ivi.ts`), y el cableado real vive aparte en
 * `numeros/miLineaCableado.ts`. Lo que gana no es cobertura: es que las cuatro
 * decisiones que este router toma —de quién es el pareo, qué número se deja
 * parear, qué pasa si el montaje falla— se pueden interrogar sin base.
 *
 * ══ EL CANDADO TIENE DUEÑO Y CADUCA ═══════════════════════════════════════
 *
 * `pareoActual` existe para que el pareo en vuelo no se le atribuya a quien lo
 * mira, sino a quien lo empezó. El vinculador es un singleton sin dueño: sin
 * esto, si Ana inicia un pareo y Bea consulta ESTE `/vincular/estado` mientras
 * tanto, Bea vería el QR de Ana y —peor— si llega justo cuando conecta, la línea
 * de Ana quedaría escrita como propia de Bea.
 *
 * ⚠️ **Este candado cubre SÓLO esta puerta.** La consola anónima de `/vincular`
 * lo derrotaba entero —lee el MISMO singleton y no pide credencial—, y por eso
 * dejó de montarse en producción el 17-ago-2026 (PR #400). En local sigue
 * montada, o sea que **ahí este candado sigue sin valer**: es el precio conocido
 * de conservar la herramienta de trabajo, no un descuido. La regla (dueño + vigencia, comparando
 * grafías normalizadas) vive pura en `numeros/pareoPropio.ts`.
 *
 * Se declara `requiereVendedora` explícitamente aunque el perímetro
 * (`auth/perimetro.ts`) ya lo exija para todo `/api`: verificar dos veces es
 * gratis, olvidarse una vez ya costó una exposición (#36) — y sin esto el router
 * montado solo en un test serviría con `vendedoraId` indefinido, que es
 * exactamente el escenario que no se quiere poder escribir.
 */

// ── LOS SEAMS ─────────────────────────────────────────────────────────────────

/**
 * Lo que este router necesita del registro de números. Nada de SQL acá.
 *
 * ⚠️ `lineasDeVendedora` trae **cuántas la atienden**, no sólo el número: sin ese
 * dato no se puede distinguir su línea de la del equipo, y las siete personas de
 * `51984429504` quedaban sin poder traer la suya. Ver `numeros/autoVinculacion.ts`.
 */
export interface RepositorioMiLinea {
  lineasDeVendedora(vendedoraId: string): Promise<LineaDeLaVendedora[]>;
  obtenerNumero(numero: string): Promise<{ numero: string; vendedoras: string[] } | null>;
  upsertNumero(numero: string, datos: DatosUpsert): Promise<unknown>;
  marcarVinculado(numero: string): Promise<void>;
}

/**
 * La línea PROPIA: la que no comparte con nadie. `null` si sólo atiende líneas
 * del equipo — que es justo el caso en el que todavía puede traer la suya.
 */
export function lineaPropia(lineas: readonly LineaDeLaVendedora[]): string | null {
  return lineas.find((l) => l.duenas === 1)?.numero ?? null;
}

/** Lo que este router necesita del vinculador global (D13). Lo satisface el real. */
export interface PuertaVinculador {
  estado(): EstadoVinculacion;
  iniciar(numero: string): Promise<void>;
  cerrar(): Promise<void>;
  cancelar(): Promise<void>;
}

export interface DependenciasMiLinea {
  repositorio: RepositorioMiLinea;
  vinculador: PuertaVinculador;
  /** Monta la línea recién vinculada en el proceso vivo. Puede lanzar. */
  montarLinea(numero: string): void;
  /** ¿Esa línea YA está corriendo en este proceso? */
  lineaMontada(numero: string): boolean;
  /** El estado de sesión publicado de un número (`numeros/estadoSesion.ts`). */
  sesionDe(numero: string): SesionContrato;
  /** Inyectable para poder interrogar la caducidad del candado sin esperarla. */
  ahora?: () => number;
  /** Inyectable: de acá sale el veto del transporte y la lista de supervisores. */
  env?: NodeJS.ProcessEnv;
}

// ── EL ENVELOPE DE ERROR ──────────────────────────────────────────────────────

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

const MENSAJE_RECHAZO: Record<MotivoRechazoAutoVinculacion, string> = {
  // ⚠️ En castellano y sin nombrar la variable de entorno: la vendedora no puede
  // hacer nada con `WHATSAPP_TRANSPORTE`, y decírselo sólo la manda a pedir algo
  // que no sabe nombrar. Quien SÍ puede accionarlo lee el log del server.
  transporte_sin_vinculacion:
    "este Hermes no está configurado para vincular líneas nuevas — avisá a quien lo administra",
  ya_tiene_linea: "ya tenés una línea vinculada — para cambiarla, hablá con quien administra Hermes",
};

const MENSAJE_EN_CURSO =
  "alguien más está vinculando un número ahora mismo — esperá un momento y probá de nuevo";

// ── LA NARROWING DEL `vendedoraId`, SIN `!` ──────────────────────────────────

type ManejadorConVendedora = (req: Request, res: Response, vendedoraId: string) => Promise<void>;

/**
 * Le pasa el `vendedoraId` YA ESTRECHADO al handler, en vez de un `req.vendedoraId!`
 * repetido cuatro veces. El 401 de acá abajo no lo alcanza nadie en producción
 * —`requiereVendedora` ya cortó— y por eso mismo no puede ser un `!`: el día que
 * alguien monte este router sin la guarda, la diferencia entre las dos formas es
 * un 401 honesto contra una línea escrita a nombre de `undefined`.
 */
function conVendedora(fn: ManejadorConVendedora): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const vendedoraId = req.vendedoraId;
    if (!vendedoraId) {
      responderError(res, 401, "sesion_invalida", "sesión inválida o expirada, volvé a ingresar");
      return;
    }
    await fn(req, res, vendedoraId);
  };
}

// ── EL ROUTER ─────────────────────────────────────────────────────────────────

export function miLineaRouter(deps: DependenciasMiLinea): Router {
  const router = Router();
  const reloj = deps.ahora ?? (() => Date.now());
  const env = deps.env ?? process.env;

  /**
   * El candado es POR ROUTER, no por módulo: dos instancias en dos tests no se
   * pisan el estado. En producción hay una sola (`numeros/miLineaCableado.ts`),
   * así que sigue siendo global como el vinculador que protege.
   */
  let pareoActual: PareoPropio | null = null;

  /** Suelta el candado sólo si sigue siendo el que tomé yo. */
  const soltarSiEsMio = (mio: PareoPropio): void => {
    if (pareoActual === mio) pareoActual = null;
  };

  router.use(requiereVendedora as RequestHandler);

  /** Mi línea de hoy. `numero: null` = todavía no auto-vinculé ninguna. */
  router.get(
    "/",
    ruta(
      conVendedora(async (_req, res, vendedoraId) => {
        // La del EQUIPO no es «mi línea»: si sólo atiende la compartida, acá va
        // `null` y el panel le ofrece traer la suya. Misma regla que el tope.
        const numero = lineaPropia(await deps.repositorio.lineasDeVendedora(vendedoraId));
        if (!numero) {
          res.json({ numero: null });
          return;
        }
        res.json({ numero, sesion: deps.sesionDe(numero) });
      }),
    ),
  );

  /** Arranca MI vinculación. El QR aparece en el polling de `.../vincular/estado`. */
  router.post(
    "/vincular",
    ruta(
      conVendedora(async (req, res, vendedoraId) => {
        const numero = normalizarNumero(String(req.body?.numero ?? ""));
        if (!numero) {
          responderError(res, 400, "entrada_invalida", "número inválido");
          return;
        }

        const ahora = reloj();
        // 🔴 EL CANDADO SE TOMA ACÁ, SIN NINGÚN `await` DE POR MEDIO — y es la
        // parte que importa. `vinculador.iniciar()` tiene su PROPIO
        // `await this.cerrar()` antes de marcarse `esperando`, así que leer
        // `vinculador.estado()` como señal de «hay alguien en vuelo» tiene una
        // ventana donde todavía dice `inactivo` aunque YA se haya disparado un
        // `iniciar()`. Dos POST casi simultáneos pasarían los dos ese chequeo y
        // el segundo `iniciar()` le cerraría el cliente al primero a mitad de
        // camino. El candado se toma de forma SÍNCRONA, antes de la primera
        // espera: Node no interrumpe este bloque para atender la otra request.
        if (pareoVigente(pareoActual, ahora)) {
          responderError(res, 409, "vinculacion_en_curso", MENSAJE_EN_CURSO);
          return;
        }
        const mio: PareoPropio = { numero, vendedoraId, tocadoEn: ahora };
        pareoActual = mio;

        // 🔴 EL `finally` ES EL ARREGLO DEL CANDADO SIN DUEÑO: cada rama que
        // rechaza —y cualquier excepción que se escape hacia `ruta()`— suelta lo
        // que tomó. Antes cada `return` tenía que acordarse de su `= null`, y el
        // que se olvidaba dejaba a TODAS bloqueadas hasta reiniciar Hermes.
        let arrancado = false;
        try {
          const lineasActuales = await deps.repositorio.lineasDeVendedora(vendedoraId);
          const decision = puedeAutoVincular(vendedoraId, env, lineasActuales, numero);
          if (!decision.ok) {
            responderError(res, 409, decision.motivo, MENSAJE_RECHAZO[decision.motivo]);
            return;
          }

          // Un número que YA está en `numeros_wa` —de la Escuela, de campaña, o
          // de otra vendedora— no se puede pisar por acá: eso lo sigue
          // declarando Cerberus. Rechazar ANTES de tocar el vinculador es lo que
          // evita escanear un QR real para enterarse recién al final de que el
          // número no servía.
          //
          // ⚠️ Salvo que ya sea MÍO: ahí no es un choque, es el reintento. Se
          // compara con `mismaVendedora` y no con `includes`, por la cicatriz de
          // siempre — Cerberus escribió `Luz`, ella vuelve como `luz`, y con
          // comparación exacta su propia línea le contesta «ya está registrada».
          const existente = await deps.repositorio.obtenerNumero(numero);
          if (existente && !existente.vendedoras.some((v) => mismaVendedora(v, vendedoraId))) {
            responderError(res, 409, "numero_en_uso", "ese número ya está registrado en Hermes");
            return;
          }

          // 🔴 UNA LÍNEA QUE YA ESTÁ CORRIENDO NO SE RE-PAREA. El transporte
          // tiene abierto `.wa-sessions/<numero>.db` y el vinculador abriría el
          // MISMO archivo: SQLite no admite dos escritores. Es el precio de
          // permitir el reintento, y se paga con un rechazo claro en vez de con
          // una sesión corrupta (que se recupera sólo con el teléfono físico).
          if (deps.lineaMontada(numero)) {
            responderError(
              res,
              409,
              "linea_ya_corriendo",
              "esa línea ya está conectada en Hermes — no hace falta volver a vincularla",
            );
            return;
          }

          // Cruce con el OTRO origen del mismo candado global: un operador
          // vinculando por `/vincular` o `/api/admin` en este mismo instante. El
          // candado de arriba solo cubre a esta ruta; esto cubre a las demás.
          const enCurso = deps.vinculador.estado();
          if (esPareoEnVuelo(enCurso) && "numero" in enCurso && enCurso.numero !== numero) {
            responderError(res, 409, "vinculacion_en_curso", MENSAJE_EN_CURSO);
            return;
          }

          // ⚠️ No es `void iniciar(...)`: `iniciar()` atrapa lo suyo, pero su
          // `mkdirSync` y su `cerrar()` corren afuera de ese try, y un rechazo
          // sin manejar en Express 4 **tumba el proceso** (`lib/ruta.ts`). Si
          // falla, se suelta el candado — la vendedora ve `expirado` y puede
          // volver a intentar, en vez de quedar todo tomado.
          void deps.vinculador.iniciar(numero).catch((err: unknown) => {
            console.error(`[mi-linea] no se pudo arrancar el pareo de ${numero} — ${porQueFallo(err)}`);
            soltarSiEsMio(mio);
          });
          arrancado = true;
          res.json({ estado: "vinculando" });
        } finally {
          if (!arrancado) soltarSiEsMio(mio);
        }
      }),
    ),
  );

  /**
   * Polling de MI pareo. Al llegar a `conectado`: libera la sesión `.db`, la
   * registra (`numeros_wa` + `numero_vendedora`, propósito `vendedora`) y la
   * monta EN CALIENTE — sin este último paso, la línea quedaría vinculada y muda
   * hasta el próximo reinicio del server.
   */
  router.get(
    "/vincular/estado",
    ruta(
      conVendedora(async (_req, res, vendedoraId) => {
        const ahora = reloj();
        const vivo = pareoVigente(pareoActual, ahora);
        if (!vivo || !mismaVendedora(vivo.vendedoraId, vendedoraId)) {
          // Nada en vuelo PARA MÍ — sea porque nunca empecé, porque ya terminó,
          // porque caducó, o porque el pareo en curso es de otra persona. No se
          // distingue: filtrar por dueño es la garantía, no un detalle a pulir.
          if (!vivo) pareoActual = null; // caducado: se suelta acá y no bloquea a nadie más
          res.json({ estado: "expirado" });
          return;
        }

        const e = deps.vinculador.estado();
        if (!("numero" in e) || e.numero !== vivo.numero) {
          // El vinculador se soltó solo (caducó y nadie lo tomó, o — no debería,
          // por el 409 de arriba — otro número lo tomó). Nada mío que reportar.
          soltarSiEsMio(vivo);
          res.json({ estado: "expirado" });
          return;
        }

        if (e.estado === "conectado") {
          const { numero } = vivo;
          // Se limpia YA, antes del primer `await`: un segundo polling que
          // llegue mientras esto corre ya no encuentra el candado y no
          // reprocesa nada.
          soltarSiEsMio(vivo);
          try {
            await deps.vinculador.cerrar();
            // 🔴 EL ORDEN IMPORTA: `upsertNumero` crea la fila; `marcarVinculado`
            // la ACTUALIZA. Al revés, el `UPDATE` corre contra un `numero` que
            // todavía no existe en `numeros_wa` —0 filas, sin error— y el INSERT
            // que sigue no lleva `vinculado_at` en su lista de columnas: queda
            // NULL para siempre, y el panel de Cerberus mostraría «nunca se
            // vinculó» sobre una línea que sí está viva.
            await deps.repositorio.upsertNumero(numero, {
              etiqueta: vendedoraId,
              proposito: "vendedora",
              activo: true,
              referencia: null,
              vendedoras: [vendedoraId],
            });
            await deps.repositorio.marcarVinculado(numero);
          } catch (err) {
            // El teléfono SÍ conectó — no perder eso de vista en el mensaje: no
            // es "no se pudo vincular", es "vinculó y Hermes no lo pudo dejar
            // anotado". El detalle va al LOG con `porQueFallo` y no a la
            // respuesta: en drizzle `err.message` es el SQL, no la causa.
            console.error(`[mi-linea] ${numero} conectó pero no se pudo registrar — ${porQueFallo(err)}`);
            responderError(
              res,
              500,
              "fallo_interno",
              "el WhatsApp conectó pero Hermes no pudo dejarlo registrado — avisá para revisarlo a mano",
            );
            return;
          }

          // 🔴 EL MONTAJE VA APARTE, Y SI FALLA LA FILA QUEDA. No hay rollback
          // posible: `GestorWhatsapp` expone `agregar`, `de`, `primero`,
          // `numeros` y `todos` — y ningún `quitar`. Así que el arreglo no puede
          // ser «desmontar»: es «la fila queda, el montaje se reintenta». El
          // reintento es volver a `POST /vincular` con el MISMO número, que
          // ahora pasa las tres guardas (la línea es suya, no está montada, y
          // `puedeAutoVincular` acepta re-parear la propia).
          //
          // ⚠️ Y `montada: false` no se esconde: la vendedora ve que quedó
          // vinculada PERO todavía no está atendiendo, que es la verdad y es
          // accionable. Decir «¡Listo!» sobre una línea muda es la mentira que
          // este frente existe para no contar.
          let montada = true;
          try {
            deps.montarLinea(numero);
          } catch (err) {
            montada = false;
            console.error(
              `[mi-linea] ${numero} quedó registrado pero NO se pudo montar en caliente — ${porQueFallo(err)}`,
            );
          }
          res.json({ estado: "conectado", numero, montada });
          return;
        }

        if (e.estado === "error" || e.estado === "baneado") {
          soltarSiEsMio(vivo);
        } else {
          // Sigue en vuelo y hay alguien mirando: se vuelve a sellar el candado.
          // Sin esto caducaría a los 60 s con la vendedora esperando el QR
          // delante de la pantalla.
          pareoActual = { ...vivo, tocadoEn: ahora };
        }
        res.json(estadoVinculacionAContrato(e));
      }),
    ),
  );

  /** Cancela MI pareo en vuelo. Cancelar el de otra persona es 409, no un silencio. */
  router.delete(
    "/vincular",
    ruta(
      conVendedora(async (_req, res, vendedoraId) => {
        const ahora = reloj();
        if (!esMiPareo(pareoActual, vendedoraId, ahora)) {
          if (!pareoVigente(pareoActual, ahora)) pareoActual = null;
          const enCurso = deps.vinculador.estado();
          if (esPareoEnVuelo(enCurso)) {
            responderError(res, 409, "vinculacion_ajena", "la vinculación en curso no es la tuya");
            return;
          }
          res.json({ estado: "inactivo", cancelada: false });
          return;
        }
        pareoActual = null;
        await deps.vinculador.cancelar();
        res.json({ estado: "inactivo", cancelada: true });
      }),
    ),
  );

  return router;
}
