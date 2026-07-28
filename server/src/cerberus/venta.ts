import { armarLlaveAtribucion } from '../atribucion/llave.js';
import { cuerpoParaCerberus } from './latin1.js';
import { borrarSesionCerberus, obtenerSesionCerberus } from './sesionStore.js';

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
  /**
   * LA CONVERSACIÓN DE LA QUE SALIÓ (`conv:<canal>:<persona>:<numeroPropio>`).
   *
   * No la usa Cerberus: viaja adentro del `venta_request_key` y **vuelve** en el webhook
   * (`Venta.idempotency_key` → `icarus_payload.py:327`). Es lo que convierte la atribución en un
   * hecho en vez de un match por teléfono. Ver `atribucion/llave.ts`.
   */
  clave?: string | null;
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
  const s = await obtenerSesionCerberus(vendedoraId);
  if (!s) return null;
  const r = await fetch(URL_VENTA, {
    headers: { cookie: `sessionid=${s.sessionid}; csrftoken=${s.csrftoken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (r.url.includes('/ingresar')) {
    // Cerberus redirigió al login: la cookie persistida está muerta. Se borra
    // acá — es el primer lugar que lo descubre — para que `/yo` diga la verdad.
    await borrarSesionCerberus(vendedoraId);
    return null;
  }
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
  const s = await obtenerSesionCerberus(vendedoraId);
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
    // Idempotencia: dos clicks no crean dos ventas. Y —desde #161— también LA LLAVE DE
    // ATRIBUCIÓN: acá adentro viaja la conversación, Cerberus la guarda tal cual en
    // `Venta.idempotency_key` y la devuelve en el webhook. Es el único campo que hace el viaje
    // completo, así que es el único lugar donde la atribución puede volverse determinista.
    // Sin conversación usable, `armarLlaveAtribucion` devuelve exactamente la llave de antes.
    venta_request_key: armarLlaveAtribucion({ vendedoraId, clave: orden.clave }),
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
    if (r.status >= 300) {
      // Con `redirect: 'manual'`, un Django con la sesión muerta contesta 302 a
      // /ingresar/. Eso NUNCA es una venta registrada: reportarlo `ok` escribía
      // una conversión y cerraba el pipeline sobre una venta que no existe.
      // La fila persistida ya no sirve: se borra para que `/yo` diga la verdad.
      await borrarSesionCerberus(vendedoraId);
      return { ok: false, motivo: 'la sesión de Cerberus expiró — volvé a entrar a Hermes' };
    }
    if (r.status >= 200) return { ok: true, mensaje: 'registrada' };
    return { ok: false, motivo: `Cerberus rechazó la venta (HTTP ${r.status})` };
  } catch (err) {
    return { ok: false, motivo: `no se pudo crear la venta: ${(err as Error).message}` };
  }
}
