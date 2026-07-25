import { cuerpoParaCerberus } from './latin1.js';
import { obtenerSesionCerberus } from './sesionStore.js';

/**
 * CREAR UNA VENTA EN CERBERUS, DESDE HERMES.
 *
 * La vendedora llena el formulario en Hermes; acá lo POSTeamos al `crear_venta`
 * real de Cerberus con SU sesión, así la venta queda a su nombre y ella nunca
 * abre Cerberus. Cerberus sigue siendo el que valida (stock, cuotas, folio) y
 * crea — Hermes solo le pasa el formulario ya lleno.
 *
 * Todo el vocabulario de Cerberus (ids de moneda/país, csrf, el formato del
 * `productos_json`) muere acá adentro; hacia arriba solo viajan datos limpios.
 */

const BASE = (process.env.CERBERUS_BASE_URL ?? 'https://app.goberna.us').replace(/\/$/, '');
const URL_VENTA = `${BASE}/ventas/crearVenta/`;

export interface Opcion {
  id: string;
  nombre: string;
}

export interface FormularioVenta {
  monedas: Opcion[];
  paises: Opcion[];
  /** Choices estáticos de VentaForm — Medio y Origen se llenan solos, pero van igual. */
  medios: Opcion[];
  origenes: Opcion[];
}

export interface ProductoVenta {
  productoId: string;
  cantidad: number;
  precioRegular: number;
  precioVenta: number;
}

export interface OrdenVenta {
  clienteId: number;
  monedaId: string;
  paisId: string;
  /** Preventa: para cursos (sin stock) evita exigir local/ubicación. */
  preventa: boolean;
  medio: string;
  origen: string;
  montoTotal: number;
  productos: ProductoVenta[];
  /** 'cotizacion' (presupuesto, seguro) o 'venta' (final). */
  saveMode: 'cotizacion' | 'venta';
}

export type ResultadoVenta = { ok: true; folio?: string; mensaje?: string } | { ok: false; motivo: string };

const MEDIOS: Opcion[] = [
  { id: 'organico', nombre: 'Orgánico' },
  { id: 'pagado', nombre: 'Pagado' },
  { id: 'referente', nombre: 'Referente' },
  { id: 'remarketing', nombre: 'Remarketing' },
  { id: 'postventa', nombre: 'PostVenta' },
];
const ORIGENES: Opcion[] = [
  { id: 'facebook', nombre: 'Facebook' },
  { id: 'instagram', nombre: 'Instagram' },
  { id: 'whatsapp', nombre: 'WhatsApp' },
  { id: 'tiktok', nombre: 'Tiktok' },
  { id: 'google', nombre: 'Google' },
  { id: 'linkedin', nombre: 'Linkedin' },
  { id: 'llamada', nombre: 'Llamada' },
  { id: 'correo', nombre: 'Correo' },
];

function parseOpciones(html: string, name: string): Opcion[] {
  const sel = html.match(new RegExp(`<select[^>]*name="${name}"[\\s\\S]*?</select>`))?.[0] ?? '';
  return [...sel.matchAll(/<option value="(\d+)"[^>]*>([^<]+)</g)].map((m) => ({ id: m[1], nombre: m[2].trim() }));
}

function parseCsrf(html: string): string {
  return html.match(/name="csrfmiddlewaretoken"\s+value="([^"]+)"/)?.[1] ?? '';
}

/** Las opciones del formulario (para armar los dropdowns en Hermes). */
export async function cargarFormulario(vendedoraId: string): Promise<FormularioVenta | null> {
  const s = obtenerSesionCerberus(vendedoraId);
  if (!s) return null;
  const r = await fetch(URL_VENTA, {
    headers: { cookie: `sessionid=${s.sessionid}; csrftoken=${s.csrftoken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) return null;
  const html = await r.text();
  return {
    monedas: parseOpciones(html, 'moneda'),
    paises: parseOpciones(html, 'pais'),
    medios: MEDIOS,
    origenes: ORIGENES,
  };
}

/** Crea la venta (o cotización) en Cerberus con la sesión de la vendedora. */
export async function crearVenta(vendedoraId: string, orden: OrdenVenta): Promise<ResultadoVenta> {
  const s = obtenerSesionCerberus(vendedoraId);
  if (!s) return { ok: false, motivo: 'la sesión de Cerberus expiró — volvé a entrar a Hermes' };

  const cookie = `sessionid=${s.sessionid}; csrftoken=${s.csrftoken}`;

  // 1. GET para un CSRF fresco (Django rota el token del formulario).
  let csrf = s.csrftoken;
  try {
    const g = await fetch(URL_VENTA, { headers: { cookie }, signal: AbortSignal.timeout(15_000) });
    if (g.ok) csrf = parseCsrf(await g.text()) || csrf;
  } catch {
    /* seguimos con el token que tenemos */
  }

  // 2. El productos_json con la forma exacta que espera crear_venta.
  const productosJson = JSON.stringify(
    orden.productos.map((p) => ({
      producto_id: p.productoId,
      cantidad: p.cantidad,
      precio_regular: p.precioRegular,
      precio_venta: p.precioVenta,
      precio_total: p.precioVenta * p.cantidad,
    })),
  );

  // Cada valor sale saneado para el MySQL latin1 de Cerberus (regla dura #4,
  // #108). Va acá, al armar el cuerpo, y no campo por campo: hoy solo
  // `venta_request_key` lleva texto de origen humano —el username de la
  // vendedora—, pero el día que alguien agregue `observacion` (el
  // `mostrar_observacion_pdf` de abajo delata que Cerberus la tiene esperando)
  // o el nombre del cliente, nace cubierto sin que nadie se acuerde.
  const body = cuerpoParaCerberus({
    csrfmiddlewaretoken: csrf,
    cliente: String(orden.clienteId),
    moneda: orden.monedaId,
    pais: orden.paisId,
    local: '',
    ubicacion: '',
    medio: orden.medio,
    origen: orden.origen,
    estado: '1',
    monto_total: String(orden.montoTotal),
    fecha_venta: new Date().toISOString().slice(0, 16),
    is_preventa: orden.preventa ? 'true' : '',
    productos_json: productosJson,
    cuotas_json: '[]',
    save_mode: orden.saveMode,
    mostrar_observacion_pdf: 'true',
    // Idempotencia: dos clicks no crean dos ventas.
    venta_request_key: `hermes-${vendedoraId}-${Date.now()}`,
  });

  try {
    const r = await fetch(URL_VENTA, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
        referer: URL_VENTA,
        origin: BASE,
        'x-requested-with': 'XMLHttpRequest',
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    });

    const texto = await r.text();
    let json: { success?: boolean; message?: string; folio?: string; folio_venta?: string } = {};
    try {
      json = JSON.parse(texto);
    } catch {
      /* si no es JSON, caemos al análisis de status abajo */
    }

    if (json.success) {
      return { ok: true, folio: json.folio ?? json.folio_venta, mensaje: json.message };
    }
    if (json.message) return { ok: false, motivo: json.message };
    if (r.status >= 200 && r.status < 400) return { ok: true, mensaje: 'registrada' };
    return { ok: false, motivo: `Cerberus rechazó la venta (HTTP ${r.status})` };
  } catch (err) {
    return { ok: false, motivo: `no se pudo crear la venta: ${(err as Error).message}` };
  }
}
