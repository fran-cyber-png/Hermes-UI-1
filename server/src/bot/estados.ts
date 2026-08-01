/**
 * Máquina de estados del bot — 10 estados con transiciones deterministas.
 *
 * La máquina decide el próximo estado a partir del actual + la acción del pipeline.
 * No sabe de base de datos, no sabe de red: es pura y se testea en milisegundos.
 *
 * El estado se persiste en `bot_estado_conversacion` para sobrevivir reinicios y
 * poder preguntar "¿cuántas conversaciones están en cotizando?" sin parsear prompts.
 */

export const ESTADOS = [
  "desconocido",
  "saludo",
  "identificando",
  "calificando",
  "informando",
  "cotizando",
  "escalado",
  "pausado",
  "enfriado",
  "completado",
] as const;

export type EstadoConversacion = (typeof ESTADOS)[number];

/** Estados en los que el bot todavía puede y debe responder. */
export const ESTADOS_ACTIVOS: readonly EstadoConversacion[] = [
  "saludo",
  "identificando",
  "calificando",
  "informando",
  "cotizando",
  "enfriado",
];

/** Estados en los que la conversación ya fue resuelta (por humano o por cierre). */
export const ESTADOS_TERMINALES: readonly EstadoConversacion[] = [
  "escalado",
  "pausado",
  "completado",
];

/** Acciones que el pipeline le reporta a la máquina de estados después de cada turno. */
export type AccionEstado =
  | { tipo: "saludo_inicial" }
  | { tipo: "bot_respondio" }
  | { tipo: "lead_respondio" }
  | { tipo: "interes_registrado" }
  | { tipo: "escalacion"; motivo: string }
  | { tipo: "pausa"; motivo: string }
  | { tipo: "sin_respuesta" }
  | { tipo: "venta_cerrada" };

export interface ResultadoTransicion {
  estado: EstadoConversacion;
  terminal: boolean;
}

/**
 * Transición determinista. Mismo estado + misma acción → mismo resultado.
 * Los estados terminales no transicionan (la conversación ya está resuelta).
 */
export function transicionar(
  actual: EstadoConversacion,
  accion: AccionEstado,
): ResultadoTransicion {
  // Los estados terminales no cambian, salvo que vuelva a hablar el lead o
  // se cierre una venta sobre un escalado.
  if (ESTADOS_TERMINALES.includes(actual)) {
    if (accion.tipo === "lead_respondio" && actual === "escalado") {
      return { estado: "calificando", terminal: false };
    }
    if (accion.tipo === "venta_cerrada" && actual === "escalado") {
      return { estado: "completado", terminal: true };
    }
    return { estado: actual, terminal: true };
  }

  switch (accion.tipo) {
    case "saludo_inicial":
      return { estado: "saludo", terminal: false };

    case "bot_respondio":
      if (actual === "desconocido") return { estado: "saludo", terminal: false };
      if (actual === "saludo") return { estado: "identificando", terminal: false };
      if (actual === "identificando") return { estado: "calificando", terminal: false };
      if (actual === "calificando") return { estado: "informando", terminal: false };
      // informando, cotizando, enfriado: el bot puede seguir respondiendo sin cambiar de fase
      return { estado: actual, terminal: false };

    case "lead_respondio":
      // Si el lead responde desde enfriado, vuelve a calificando
      if (actual === "enfriado") return { estado: "calificando", terminal: false };
      return { estado: actual, terminal: false };

    case "interes_registrado":
      if (ESTADOS_ACTIVOS.includes(actual)) return { estado: "informando", terminal: false };
      return { estado: actual, terminal: false };

    case "escalacion":
      return { estado: "escalado", terminal: true };

    case "pausa":
      return { estado: "pausado", terminal: true };

    case "sin_respuesta":
      if (ESTADOS_ACTIVOS.includes(actual)) return { estado: "enfriado", terminal: false };
      return { estado: actual, terminal: false };

    case "venta_cerrada":
      return { estado: "completado", terminal: true };

    default:
      return { estado: actual, terminal: false };
  }
}

/** ¿El bot debe responder en este estado? */
export function debeResponder(estado: EstadoConversacion): boolean {
  return ESTADOS_ACTIVOS.includes(estado);
}

/** ¿Esta conversación ya fue atendida por un humano o está cerrada? */
export function esTerminal(estado: EstadoConversacion): boolean {
  return ESTADOS_TERMINALES.includes(estado);
}

/**
 * Descripción legible del estado para logs y auditoría.
 * Se agrega acá, no en la UI: el orquestador y la auditoría la usan.
 */
export function describirEstado(estado: EstadoConversacion): string {
  const m: Record<EstadoConversacion, string> = {
    desconocido: "Conversación nueva o sin estado registrado",
    saludo: "El bot saludó y espera respuesta del lead",
    identificando: "El bot preguntó nombre/país, esperando respuesta",
    calificando: "El bot preguntó sobre intereses, esperando respuesta",
    informando: "El bot está dando información sobre programas",
    cotizando: "El lead preguntó por precio/inscripción, preparando handoff",
    escalado: "Conversación derivada a vendedora humana",
    pausado: "El lead rechazó o se despidió",
    enfriado: "Sin respuesta del lead después de mostrar interés",
    completado: "Venta cerrada por vendedora humana",
  };
  return m[estado];
}

/**
 * Infiere la acción de estado que corresponde a las acciones que el agente
 * devolvió. Esto ES determinista: el texto del agente no decide el estado.
 */
export function accionDesdeAgente(
  acciones: { tipo: string; motivo?: string; [k: string]: unknown }[],
): AccionEstado | null {
  const escalar = acciones.find((a) => a.tipo === "escalar");
  if (escalar) return { tipo: "escalacion", motivo: (escalar.motivo as string) ?? "sin_motivo" };
  const pausar = acciones.find((a) => a.tipo === "pausar");
  if (pausar) return { tipo: "pausa", motivo: (pausar.motivo as string) ?? "sin_motivo" };
  const interes = acciones.find((a) => a.tipo === "registrar_interes");
  if (interes) return { tipo: "interes_registrado" };
  return null;
}

/**
 * Datos que la máquina de estados guarda por conversación.
 * El JSONB es flexible: cada frente agrega lo que necesita sin migrar schema.
 */
export interface DatosEstado {
  nombre?: string;
  pais?: string;
  familia?: string;
  ultimoEstadoEn?: string; // ISO timestamp
  turnosEnEstado?: number;
}
