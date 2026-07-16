import type { z } from "zod";

/**
 * EL SDK GOVERNA — los tipos.
 *
 * ── Qué es una Herramienta y qué NO es ──
 * Una Herramienta no tiene lógica. Es una DECLARACIÓN sobre lógica que ya existe: qué preguntas
 * responde, qué entrada acepta y de dónde sale su verdad. Si un envoltorio de acá adentro empieza
 * a calcular algo, ese cálculo está en el lugar equivocado — va a `analisis/`, a `dominio/` o a
 * `canales/`, donde se puede testear puro y donde el resto del sistema ya lo puede usar.
 *
 * Esa disciplina es la que hace que el modelo sea reemplazable: la inteligencia vive en el código
 * y en los datos, no en el prompt ni en los pesos.
 *
 * ── Por qué el registro existe ──
 * Hoy la única forma de llegar a la lógica de negocio es por endpoints con forma de PANTALLA.
 * `/api/overview` devuelve 62 KB —24 creativos con su copy, 15 filas crudas de la bandeja— porque
 * eso es lo que la home necesita. Ivi lo consume entero para preguntar "¿cuánto vendimos en
 * junio?", y su catálogo de qué pedir vive escrito a mano en Python, en otro host
 * (`goberna-kos/ivi/data_planner.py:12-52`).
 *
 * El síntoma ya estaba a la vista: `routes/overview.ts:224` agregó `/atribucion` con el comentario
 * "listo para Ivi (consultas especializadas)". La necesidad existía; le faltaba una casa.
 */

/**
 * De dónde sale la verdad de esta Herramienta.
 *
 * No es decorativo: es lo que permite que una CQ del Capability Registry se valide contra el
 * código en vez de contra la memoria de alguien. Cuando `kos cq verify` dice que una CQ y su Tool
 * discrepan, esto es lo que le dice al humano dónde ir a mirar para decidir quién miente.
 *
 * Formato: `"ruta/archivo.ts:linea"`.
 */
export type Fuente = string;

export type Herramienta<E extends z.ZodType = z.ZodType, S = unknown> = {
  /** `governa.<dominio>.<accion>`. Es el identificador estable: las CQs lo referencian. */
  nombre: string;

  /**
   * Qué responde, en una línea, en lenguaje de negocio.
   *
   * Se escribe para quien no conoce el código —un modelo o una persona nueva— así que dice qué
   * pregunta contesta, no cómo está implementada.
   */
  descripcion: string;

  /**
   * El contrato de entrada. Zod porque `z.toJSONSchema()` publica el catálogo sin escribirlo a
   * mano: una sola declaración sirve de validación en runtime, de tipo en compilación y de
   * documentación para el modelo. Tres cosas que, escritas por separado, divergen.
   */
  entrada: E;

  ejecutar: (entrada: z.output<E>) => Promise<S> | S;

  /**
   * ¿Llamarla dos veces con la misma entrada da lo mismo y no cambia nada?
   *
   * Hoy todas leen, así que todas son idempotentes. El día que una escriba (publicar en Meta,
   * mandar un WhatsApp), esto es lo que evita que un reintento cobre dos veces.
   */
  idempotente: boolean;

  /** Las CQs del Capability Registry que esta Herramienta responde. */
  cqIds?: string[];

  /** Dónde vive la verdad que devuelve. */
  fuentes?: Fuente[];
};

/** Lo que publica `GET /api/sdk/catalogo`. Es el contrato con Ivi, con MCP y con el tool calling. */
export type EntradaCatalogo = {
  nombre: string;
  descripcion: string;
  /** JSON Schema derivado del Zod. Nadie lo escribe a mano. */
  entrada: unknown;
  idempotente: boolean;
  cqIds: string[];
  fuentes: Fuente[];
};

/**
 * Por qué una invocación no produjo salida.
 *
 * Union discriminada, igual que `Resultado` en `lazo/evento.ts:107`: el fracaso se declara, no se
 * lanza. La mitad importante de un sistema es lo que NO hace y por qué — y eso hay que poder
 * contarlo, no atraparlo con un try/catch anónimo.
 */
export type MotivoFallo =
  /** No hay ninguna Herramienta con ese nombre. */
  | "no_existe"
  /** La entrada no pasó el schema. El detalle dice qué campo y por qué. */
  | "entrada_invalida"
  /** La Herramienta corrió y reventó. El detalle lleva el mensaje original. */
  | "fallo_ejecucion";

export type Resultado<S = unknown> =
  | { ok: true; salida: S; ms: number }
  | { ok: false; motivo: MotivoFallo; detalle: string; ms: number };
