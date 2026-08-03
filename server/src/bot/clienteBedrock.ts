import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import type { ClienteAnthropic } from "./agente.js";

/**
 * EL CLIENTE DEL MODELO, EN UN SOLO LUGAR.
 *
 * Vivía inline en `index.ts`, que era el único que lo necesitaba. Con el chat de
 * prueba (#256) pasaron a ser dos, y el timeout de acá abajo **no se puede
 * duplicar**: tiene un porqué atado a un invariante del despachador, y dos
 * copias divergen el día que alguien ajusta una sola (la lección de #37).
 */
export function crearClienteBedrock(): ClienteAnthropic | null {
  const awsAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || "us-east-1";

  // El `AWS_SESSION_TOKEN` se mira porque el SDK no lo usa: con credenciales
  // temporales la llamada falla en runtime, y es mejor no arrancar que fallar
  // en el turno de una persona.
  if (!awsAccessKey || !awsSecretKey || process.env.AWS_SESSION_TOKEN !== undefined) {
    return null;
  }

  return new AnthropicBedrock({
    awsAccessKey,
    awsSecretKey,
    awsRegion: region,
    // ⚠️ EL TIMEOUT TIENE QUE SER MENOR QUE `VIGENCIA_CLAIM_MS` (5 min).
    //
    // El default del SDK son 10 minutos y 2 reintentos: el DOBLE del claim. Una
    // sola llamada colgada sobrevive al vencimiento, otro tick toma el mismo
    // pendiente, y la persona recibe **dos respuestas al mismo mensaje** — el
    // tell más obvio de que hay una máquina detrás.
    //
    // 90 s es holgado para un turno normal (el agente tarda 3–5 s) y deja margen
    // de sobra por debajo del claim aunque se use el reintento. `maxRetries: 1`
    // por lo mismo: dos reintentos con este timeout ya rozan los 5 min.
    timeout: 90_000,
    maxRetries: 1,
  }) as unknown as ClienteAnthropic;
}
