/**
 * Lo que el adaptador de WhatsApp Web puede decir del chat abierto.
 *
 * Es una unión discriminada a propósito: obliga a la pantalla a tratar
 * `lector-offline` como un caso propio en vez de confundirlo con `sin-chat`.
 * Esa confusión es el modo de falla peligroso — un lector roto se ve idéntico a
 * "no hay nadie" si lo dejás colapsar en el mismo estado.
 */
export type LecturaWhatsapp =
  /** Está la pantalla del QR: esta cuenta todavía no se vinculó (o la desvincularon). */
  | { estado: 'sin-sesion' }
  /** El DOM no responde a los selectores conocidos. WhatsApp cambió el HTML. */
  | { estado: 'lector-offline'; motivo: string }
  /** WhatsApp está bien, pero no hay ninguna conversación abierta. */
  | { estado: 'sin-chat' }
  /** Hay chat, pero es un grupo: no hay "un" contacto que registrar. */
  | { estado: 'grupo' }
  | {
      estado: 'chat';
      /** Null cuando el contacto NO está guardado: ahí lo visible es el número. */
      nombre: string | null;
      telefonoVisible: string | null;
      /** Dígitos + prefijo 51. El mismo canónico que usa la dedup de Cerberus. */
      telefonoNormalizado: string | null;
      /** El contacto está guardado: el teléfono existe pero cuesta abrir el panel. */
      requiereDrawer: boolean;
      /** El número del propio vendedor, de su localStorage. */
      vendedorWid: string | null;
    };

export type RespuestaTelefono =
  | { ok: true; telefonoVisible: string; telefonoNormalizado: string | null }
  | { ok: false; motivo: string };

/** Lo que el preload de Electron deja en `window`. */
declare global {
  interface Window {
    hermes?: {
      plataforma: string;
      esEscritorio: boolean;
      adaptadorWhatsapp: string;
    };
  }
}
