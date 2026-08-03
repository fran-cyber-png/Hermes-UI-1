import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { requiereVendedora } from "../auth/sesion.js";
import { configDesdeEnv } from "../bot/config.js";
import { crearClienteBedrock } from "../bot/clienteBedrock.js";
import {
  procesarConversacion,
  type FilaHilo,
  type FilaRespuestaBot,
} from "../bot/orquestador.js";

/**
 * EL CHAT DE PRUEBA — `POST /api/entrenamiento/probar` (#256).
 *
 * ══ PARA QUÉ EXISTE ══════════════════════════════════════════════════════════
 *
 * Hasta acá, la única forma de ver trabajar al bot era dejar que le contestara a
 * una persona real. Por eso afinarlo costaba tráfico pagado, y por eso los
 * adsets terminaron pausados: para verificar un arreglo había que exponerlo.
 *
 * Acá se le escribe como si uno fuera la persona y contesta en el momento. Lo
 * que el Replay no puede hacer —eso mide sobre conversaciones que YA pasaron— es
 * justamente esto: probar la objeción que todavía nadie hizo. El corpus tiene
 * cuatro días y una sola campaña; todo lo que nadie preguntó es invisible para él.
 *
 * ══ POR QUÉ NO PUEDE MANDARLE NADA A NADIE ═══════════════════════════════════
 *
 * Corre **el motor de producción** —el mismo `procesarConversacion`, el mismo
 * prompt, el mismo catálogo—, no una copia para probar: una copia mediría una
 * ficción y daría confianza falsa (la lección de #37).
 *
 * Lo único que cambia es lo que se le inyecta:
 *   · `gestor: null` → **no hay a dónde mandar**. No es una bandera que alguien
 *     pueda invertir: sin transporte el paso 14 sale por `sin_transporte`.
 *   · `guardarRespuesta` → a memoria. `bot_respuestas` es el corpus con el que se
 *     mide al bot; si esto escribiera ahí, cada prueba contaminaría la medición.
 *   · `leerHilo` → el hilo que viaja en el request. La conversación **no existe
 *     en ninguna tabla**: se está escribiendo ahora, en la pantalla.
 *
 * ⚠️ **Lo que SÍ toca la base, y es deuda conocida.** El pipeline escribe cosas
 * colaterales con `ctx.base` —la memoria de la persona, el estado de la
 * conversación, lo que registre `ejecutarAcciones`—. Acá van todas bajo una
 * clave reservada (`CLAVE_PRUEBA`), así que son identificables y borrables, pero
 * caen en la base de verdad. El aislamiento completo llega con la Corrida y su
 * tabla propia (#257); meterlo acá habría hecho del tracer bullet otro frente.
 * Por eso el teléfono es un número imposible: ninguna persona puede colisionar.
 */
export const entrenamientoRouter = Router();
entrenamientoRouter.use(requiereVendedora);

/**
 * El teléfono de las conversaciones de prueba. Empieza con `000` a propósito:
 * ningún país lo asigna, así que no puede chocar con una persona real ni
 * aparecer en la cola como si alguien hubiera escrito.
 */
const TELEFONO_PRUEBA = "000000000000";

const Cuerpo = z.object({
  /** Lo que la persona simulada acaba de escribir. */
  mensaje: z.string().trim().min(1).max(4000),
  /** El hilo previo de ESTA prueba, tal como se ve en pantalla. */
  historial: z
    .array(
      z.object({
        de: z.enum(["persona", "bot"]),
        texto: z.string().max(4000),
      }),
    )
    .max(60)
    .default([]),
  /** La línea contra la que se prueba (define catálogo y estado de línea). */
  numeroPropio: z.string().trim().min(6).max(20),
});

export interface RespuestaDePrueba {
  /** Lo que el bot contestó. `null` = no produjo texto (y eso también se muestra). */
  texto: string | null;
  /** El estado al que llevó la conversación. */
  estado: string;
  /** Por qué no salió, si no salió. */
  motivo: string | null;
  /** Lo que decidió hacer además de hablar. */
  acciones: unknown[];
  modelo: string | null;
  tokensEntrada: number | null;
  tokensSalida: number | null;
}

entrenamientoRouter.post("/probar", async (req, res) => {
  const parsed = Cuerpo.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: parsed.error.issues[0]?.message ?? "cuerpo inválido" });
    return;
  }
  const { mensaje, historial, numeroPropio } = parsed.data;

  // Sin credenciales no hay modelo, y eso se dice: un chat de prueba que
  // devuelve silencio se lee como «el bot no contestó», que es justo el
  // diagnóstico equivocado.
  const cliente = crearClienteBedrock();
  if (!cliente) {
    res.status(503).json({
      ok: false,
      codigo: "falta_config",
      message: "el modelo no está configurado en este entorno (faltan credenciales de AWS)",
    });
    return;
  }

  const cfg = configDesdeEnv();
  const clave = `conv:whatsapp:${TELEFONO_PRUEBA}:${numeroPropio}`;
  const ahora = new Date();

  // El hilo que el motor va a leer: lo escrito en pantalla más el turno nuevo.
  // Las fechas se escalonan hacia atrás para que el orden sea el real —el bot
  // mira cuál fue el ÚLTIMO entrante, y con todas iguales miraría cualquiera.
  const previos: FilaHilo[] = historial.map((t, i) => ({
    direccion: t.de === "persona" ? "entrante" : "saliente",
    texto: t.texto,
    occurred_at: new Date(ahora.getTime() - (historial.length - i + 1) * 60_000),
  }));
  const hilo: FilaHilo[] = [
    ...previos,
    { direccion: "entrante", texto: mensaje, occurred_at: ahora },
  ];

  const asentadas: FilaRespuestaBot[] = [];

  try {
    await procesarConversacion(
      clave,
      numeroPropio,
      // El modo se fuerza a `automatico`: en `sombra` el pipeline ni intenta
      // responder, y entonces la pantalla no mostraría lo que el bot HARÍA.
      // Es seguro porque no hay transporte: automático sin a dónde mandar es
      // exactamente «pensá todo y no salgas».
      { ...cfg, modo: "automatico" },
      cliente,
      ahora,
      {
        base: db,
        gestor: null, // ← la garantía: no hay a dónde mandar
        guardarRespuesta: async (fila) => {
          asentadas.push(fila);
        },
        leerHilo: async () => hilo,
      },
    );
  } catch (err) {
    res.status(502).json({
      ok: false,
      codigo: "motor_fallo",
      message: (err as Error).message,
    });
    return;
  }

  const ultima = asentadas[asentadas.length - 1];
  if (!ultima) {
    // El pipeline salió antes de asentar nada (un freno, un salto). No es un
    // error: es información, y la pantalla la muestra como tal.
    res.json({
      ok: true,
      respuesta: {
        texto: null,
        estado: "sin_respuesta",
        motivo: "el pipeline cortó antes de producir una respuesta",
        acciones: [],
        modelo: null,
        tokensEntrada: null,
        tokensSalida: null,
      } satisfies RespuestaDePrueba,
    });
    return;
  }

  res.json({
    ok: true,
    respuesta: {
      texto: ultima.texto,
      estado: ultima.estado,
      motivo: ultima.motivo,
      acciones: ultima.acciones,
      modelo: ultima.modelo,
      tokensEntrada: ultima.tokensEntrada,
      tokensSalida: ultima.tokensSalida,
    } satisfies RespuestaDePrueba,
  });
});
