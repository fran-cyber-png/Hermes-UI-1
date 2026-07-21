import { mkdirSync } from 'node:fs';
import { createClient, type WhatsmeowClient } from '@whatsmeow-node/whatsmeow-node';
import QRCode from 'qrcode';

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

export type EstadoVinculacion =
  | { estado: 'inactivo' }
  | { estado: 'esperando'; numero: string }
  | { estado: 'qr'; numero: string; qr: string }
  | { estado: 'conectado'; numero: string; jid: string }
  | { estado: 'baneado'; numero: string; codigo: string; expira: string }
  | { estado: 'error'; numero: string; motivo: string };

class Vinculador {
  private client: WhatsmeowClient | null = null;
  private actual: EstadoVinculacion = { estado: 'inactivo' };

  estado(): EstadoVinculacion {
    return this.actual;
  }

  async iniciar(numeroRaw: string): Promise<void> {
    const numero = (numeroRaw ?? '').replace(/\D/g, '');
    if (numero.length < 8) {
      this.actual = { estado: 'error', numero, motivo: 'número inválido' };
      return;
    }

    // Reset de cualquier intento previo: un solo cliente vivo por vez.
    await this.cerrar();

    const dir = new URL('../../.wa-sessions/', import.meta.url).pathname;
    mkdirSync(dir, { recursive: true });
    const client = createClient({ store: `${dir}${numero}.db` });
    this.client = client;
    this.actual = { estado: 'esperando', numero };

    client.on('qr', async ({ code }) => {
      try {
        const qr = await QRCode.toDataURL(code, { width: 360, margin: 1 });
        this.actual = { estado: 'qr', numero, qr };
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
