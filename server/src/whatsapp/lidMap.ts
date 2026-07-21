import { DatabaseSync } from 'node:sqlite';
import { normalizarTelefono } from './identidadWa.js';

/**
 * El mapa LID → teléfono, leído del store que whatsmeow YA sincroniza.
 *
 * WhatsApp moderno identifica a algunos remitentes con `@lid` (un id anónimo
 * por privacidad) en vez de `@s.whatsapp.net`. El teléfono real existe: vive en
 * la tabla `whatsmeow_lid_map` del store SQLite de la sesión (usuario pelado,
 * `106743…|51986…`), que el propio whatsmeow mantiene al sincronizar contactos.
 *
 * Leerla acá — SOLO lectura — es la única forma de bajar un @lid a teléfono con
 * el wrapper actual (`@whatsmeow-node` 0.7.0 no expone `GetPNForLID` por IPC).
 * Es un acople al schema interno de whatsmeow, aceptado a propósito: vive
 * adentro del transporte (la costura existe para esto), la versión está pineada,
 * y si el schema cambia el fallo degrada al comportamiento de siempre — el
 * mensaje se descarta y el log lo cuenta. Nunca se inventa un teléfono.
 */
export class MapaLids {
  private db: DatabaseSync | null = null;

  constructor(private rutaStore: string) {}

  /** `106743493296209@lid` (con o sin sufijo `:device`) → `51986394450` | null. */
  telefonoDeLid(jid: string): string | null {
    const [usuario, servidor] = (jid ?? '').split('@');
    if (servidor !== 'lid' || !usuario) return null;

    const db = this.abrir();
    if (!db) return null;

    try {
      const fila = db
        .prepare('SELECT pn FROM whatsmeow_lid_map WHERE lid = ?')
        .get(usuario.split(':')[0]) as { pn?: string } | undefined;
      return fila?.pn ? normalizarTelefono(fila.pn) : null;
    } catch {
      // Schema distinto o store a mitad de escritura: se degrada al descarte.
      return null;
    }
  }

  private abrir(): DatabaseSync | null {
    if (this.db) return this.db;
    try {
      // Solo lectura: whatsmeow (el binario Go) es el único que escribe acá.
      this.db = new DatabaseSync(this.rutaStore, { readOnly: true });
    } catch {
      // Sin sesión vinculada todavía no hay archivo — se reintenta al próximo
      // mensaje (el archivo aparece al vincular).
      return null;
    }
    return this.db;
  }

  cerrar(): void {
    try {
      this.db?.close();
    } catch {
      // ya estaba cerrada
    }
    this.db = null;
  }
}
