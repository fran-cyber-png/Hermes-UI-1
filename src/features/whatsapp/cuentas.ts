import { useLocalStorage } from '../../lib/useLocalStorage';

/**
 * LAS SESIONES DE WHATSAPP DENTRO DE HERMES.
 *
 * ── Cómo funciona una sesión acá ──
 * Cada cuenta vive en su propia partición de Electron (`persist:wa:<id>`). Una
 * partición es un almacenamiento aislado — cookies, localStorage e IndexedDB
 * propios — y es exactamente donde WhatsApp Web guarda las llaves de la sesión.
 * Consecuencias, en orden de importancia:
 *
 *   1. El QR se escanea UNA VEZ por cuenta. La sesión sobrevive a cerrar la app,
 *      igual que WhatsApp Desktop.
 *   2. Dos cuentas nunca se ven entre sí. Es la misma garantía que dan dos
 *      perfiles distintos de Chrome, no un truco.
 *   3. Hermes NUNCA toca el QR ni las credenciales. El código lo renderiza
 *      WhatsApp adentro del webview y lo escanea un humano con su teléfono. No
 *      hay ningún punto del sistema donde pase una credencial de WhatsApp por
 *      código nuestro — y eso es lo que mantiene esto lejos de Baileys.
 *
 * ── Los límites que impone WhatsApp, no nosotros ──
 *   · Un número admite 4 dispositivos vinculados. Cinco vendedores compartiendo
 *     un número NO entran: el quinto desvincula a otro.
 *   · Si el teléfono principal queda offline ~14 días, WhatsApp desvincula todo.
 *   · Un número registrado en la Cloud API deja de funcionar en WhatsApp Web.
 *     El día del cutover a Cloud API, la sesión de ese número acá se muere — es
 *     un cambio, no una convivencia.
 */

export type CuentaWhatsapp = {
  /** Solo [a-z0-9-]: se concatena a la partición de Electron. */
  id: string;
  nombre: string;
};

/**
 * La partición de Electron de una cuenta.
 *
 * El prefijo `persist:` es lo que hace que sobreviva al cierre de la app. Sin él
 * la partición es en memoria y el QR vuelve a pedirse en cada arranque.
 */
export function particionDe(cuenta: CuentaWhatsapp): string {
  return `persist:wa:${cuenta.id}`;
}

export const CUENTA_INICIAL: CuentaWhatsapp = { id: 'principal', nombre: 'Principal' };

/** Un id estable y seguro para partición, derivado del nombre que escribió la persona. */
export function idDesdeNombre(nombre: string): string {
  const base = nombre
    .toLowerCase()
    .normalize('NFD')
    // `\p{Diacritic}` en vez de un rango literal: los combining chars escritos a
    // mano son invisibles en el editor y nadie sabría qué está borrando esta línea.
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base || `cuenta-${Date.now()}`;
}

/**
 * Las cuentas configuradas y cuál se está mirando.
 *
 * Vive en localStorage y no en el servidor a propósito: es una preferencia de
 * ESTA máquina. Qué números tiene vinculados la laptop de un vendedor no es un
 * dato del negocio, y sincronizarlo entre equipos solo lograría que la app de
 * uno prometa sesiones que ese equipo no tiene.
 */
export function useCuentasWhatsapp() {
  const [cuentas, setCuentas] = useLocalStorage<CuentaWhatsapp[]>('hermes.cuentasWa', [CUENTA_INICIAL]);
  const [activaId, setActivaId] = useLocalStorage<string>('hermes.cuentaWaActiva', CUENTA_INICIAL.id);

  // Si la cuenta activa se borró, se cae a la primera en vez de quedar en la nada.
  const activa = cuentas.find((c) => c.id === activaId) ?? cuentas[0] ?? CUENTA_INICIAL;

  function agregar(nombre: string): void {
    const id = idDesdeNombre(nombre);
    if (cuentas.some((c) => c.id === id)) {
      setActivaId(id);
      return;
    }
    setCuentas([...cuentas, { id, nombre: nombre.trim() }]);
    setActivaId(id);
  }

  /**
   * Saca la cuenta de la lista. OJO: NO borra la partición del disco, así que la
   * sesión de WhatsApp sigue vinculada. Volver a agregar la cuenta con el mismo
   * nombre la recupera sin escanear de nuevo.
   *
   * Para desvincular de verdad hay que cerrar sesión desde el teléfono (Ajustes →
   * Dispositivos vinculados). Es correcto que sea así: borrar la sesión de alguien
   * desde un botón de nuestra app sería sorprendente, y el teléfono es la única
   * autoridad real sobre sus dispositivos.
   */
  function quitar(id: string): void {
    if (cuentas.length <= 1) return;
    setCuentas(cuentas.filter((c) => c.id !== id));
    if (activaId === id) setActivaId(cuentas.find((c) => c.id !== id)?.id ?? CUENTA_INICIAL.id);
  }

  return { cuentas, activa, setActivaId, agregar, quitar };
}
