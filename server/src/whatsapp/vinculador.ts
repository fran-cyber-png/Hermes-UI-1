import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type WhatsmeowClient } from '@whatsmeow-node/whatsmeow-node';
import QRCode from 'qrcode';
import { estadoVinculacionVigente, type EstadoVinculacion } from '../numeros/dominio.js';

/**
 * EL VINCULADOR — el motor de la consola de operador (D13).
 *
 * Maneja el flujo de vincular UN número: crea el cliente whatsmeow, mantiene el
 * QR más reciente (como data-URL listo para pintar) y el estado de la conexión.
 * La página `/vincular` lo consulta y muestra el QR en vivo hasta que conecta.
 *
 * La sesión se guarda en `.wa-sessions/<numero>.db` — la MISMA que después usa el
 * transporte (`WHATSAPP_NUMERO`). Vinculás acá una vez; el server la reusa.
 *
 * Es de UN número a la vez (un vinculador global): la consola es una herramienta
 * de operador, no un servicio concurrente.
 */

// `EstadoVinculacion` vive en `numeros/dominio.ts`, que es el módulo que RAZONA
// sobre el estado; acá sólo se produce. Se re-exporta para no romperle el import
// a nadie que ya lo pedía de este archivo.
export type { EstadoVinculacion };

class Vinculador {
  private client: WhatsmeowClient | null = null;
  private actual: EstadoVinculacion = { estado: 'inactivo' };
  /** Cuándo dio señales el pareo en vuelo. Distingue uno vivo de uno colgado. */
  private actualizadoEn: number | null = null;

  constructor(private readonly ahora: () => number = () => Date.now()) {}

  /**
   * El estado que ve el mundo. NO es `this.actual` a secas: un pareo en vuelo que
   * dejó de dar señales se lee como `inactivo` (la regla vive en
   * `numeros/dominio.ts`, pura y con test). Sin eso, uno que nadie escaneó deja el
   * vinculador tomado y ningún otro número se puede vincular hasta reiniciar.
   */
  estado(): EstadoVinculacion {
    return estadoVinculacionVigente(this.actual, this.actualizadoEn, this.ahora());
  }

  /**
   * Suelta el vinculador a propósito: cierra el cliente y vuelve a `inactivo`.
   * Es la salida del operador cuando abrió una vinculación y no la escaneó — sin
   * esto, la única forma de destrabar es reiniciar Hermes, que tira las sesiones
   * de las vendedoras.
   */
  async cancelar(): Promise<void> {
    await this.cerrar();
    this.actual = { estado: 'inactivo' };
    this.actualizadoEn = null;
  }

  async iniciar(numeroRaw: string): Promise<void> {
    const numero = (numeroRaw ?? '').replace(/\D/g, '');
    if (numero.length < 8) {
      this.actual = { estado: 'error', numero, motivo: 'número inválido' };
      return;
    }

    // Reset de cualquier intento previo: un solo cliente vivo por vez.
    await this.cerrar();

    const dir = fileURLToPath(new URL('../../.wa-sessions/', import.meta.url));
    mkdirSync(dir, { recursive: true });
    const client = createClient({ store: `${dir}${numero}.db` });
    this.client = client;
    this.actual = { estado: 'esperando', numero };
    // Se estampa YA: un arranque que se cuelga (init() que nunca vuelve) también
    // tiene que caducar, o el candado queda tomado sin un solo QR de por medio.
    this.actualizadoEn = this.ahora();

    client.on('qr', async ({ code }) => {
      try {
        const qr = await QRCode.toDataURL(code, { width: 360, margin: 1 });
        this.actual = { estado: 'qr', numero, qr };
        this.actualizadoEn = this.ahora();
      } catch {
        /* si un QR puntual no renderiza, el próximo (rota cada ~20s) lo hará */
      }
    });
    client.on('connected', ({ jid }) => {
      this.actual = { estado: 'conectado', numero, jid };
    });
    client.on('temporary_ban', ({ code, expire }) => {
      this.actual = { estado: 'baneado', numero, codigo: String(code), expira: expire };
    });
    client.on('error', (err) => {
      this.actual = { estado: 'error', numero, motivo: (err as Error).message };
    });

    try {
      const { jid } = await client.init();
      if (jid) {
        // Ya estaba vinculado: reconecta y listo.
        this.actual = { estado: 'conectado', numero, jid };
        await client.connect();
        return;
      }
      await client.getQRChannel();
      await client.connect();
    } catch (err) {
      this.actual = { estado: 'error', numero, motivo: (err as Error).message };
    }
  }

  /**
   * Cierra el cliente para liberar la sesión `.db`. Se llama al terminar de
   * vincular: así el transporte del server puede abrir la MISMA sesión sin
   * chocar (SQLite no admite dos escritores).
   */
  async cerrar(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.disconnect();
      this.client.close();
    } catch {
      /* ya estaba muerto */
    }
    this.client = null;
  }
}

export const vinculador = new Vinculador();
