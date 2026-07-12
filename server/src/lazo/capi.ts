import type { EventoCapi } from "./evento.js";

/**
 * El cliente de la Conversions API.
 *
 * La tubería YA EXISTE y YA CORRE: el pixel 513556103518928 (nuestro, activo desde 2022) recibió
 * 630 eventos por servidor en las últimas 24 h. Lo que NO manda es lo que importa:
 *
 *   Eventos `Purchase` en 24 h ............ 0
 *   Correos en ~1.200 eventos ............. 3
 *   Teléfonos ............................. 1
 *
 * Este módulo existe para darle la carga correcta.
 */

export type ResultadoEnvio = {
  ok: boolean;
  /** Cuántos eventos aceptó Meta. Debería ser igual a los que mandamos. */
  recibidos: number;
  /** Para rastrear un envío en el soporte de Meta si algo sale mal. */
  fbtraceId?: string;
  error?: string;
  crudo: unknown;
};

export class CapiClient {
  constructor(
    private readonly pixelId: string,
    private readonly token: string,
    /**
     * Código de Test Events (Events Manager → pestaña Test Events, formato `TEST12345`).
     *
     * Con él, los eventos aparecen en la herramienta de pruebas y **NO afectan la optimización
     * de los anuncios**. Sin él, cada evento es real y entra al modelo de Meta.
     *
     * Regla: nunca correr contra ventas reales sin haber probado primero con esto.
     */
    private readonly testEventCode?: string,
    private readonly version = "v25.0",
  ) {}

  async enviar(eventos: EventoCapi[]): Promise<ResultadoEnvio> {
    if (eventos.length === 0) return { ok: true, recibidos: 0, crudo: null };

    const cuerpo: Record<string, unknown> = { data: eventos };
    if (this.testEventCode) cuerpo.test_event_code = this.testEventCode;

    const url = `https://graph.facebook.com/${this.version}/${this.pixelId}/events`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...cuerpo, access_token: this.token }),
      });
    } catch (err) {
      // La red se cayó. No es un rechazo de Meta: es un reintento pendiente.
      return { ok: false, recibidos: 0, error: (err as Error).message, crudo: null };
    }

    const json = (await res.json().catch(() => ({}))) as any;

    if (!res.ok) {
      return {
        ok: false,
        recibidos: 0,
        fbtraceId: json?.error?.fbtrace_id,
        error: json?.error?.message ?? `HTTP ${res.status}`,
        crudo: json,
      };
    }

    // Meta responde `{ events_received, messages, fbtrace_id }`.
    // OJO: un 200 con `events_received: 1` NO garantiza que el evento haya hecho match con
    // nadie. Solo dice que lo aceptó. El match se ve en el Event Match Quality, y ese no es
    // un KPI para perseguir — la comunidad técnica lo trata como señal diagnóstica, no como meta.
    return {
      ok: true,
      recibidos: json?.events_received ?? 0,
      fbtraceId: json?.fbtrace_id,
      crudo: json,
    };
  }

  get esPrueba(): boolean {
    return Boolean(this.testEventCode);
  }
}

/** Construye el cliente desde el entorno. Falla ruidosamente si falta algo. */
export function capiDesdeEnv(): CapiClient {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_ACCESS_TOKEN ?? process.env.META_TOKEN;
  if (!pixelId) throw new Error("Falta META_PIXEL_ID en el entorno");
  if (!token) throw new Error("Falta META_ACCESS_TOKEN en el entorno");
  // Si META_TEST_EVENT_CODE está seteado, TODO va a Test Events y no afecta la optimización.
  return new CapiClient(pixelId, token, process.env.META_TEST_EVENT_CODE);
}
