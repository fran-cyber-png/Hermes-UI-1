/**
 * LA FICHA DEL CONTACTO — ¿quién es esta persona en Cerberus?
 *
 * Cuando la vendedora abre un chat de WhatsApp, esto resuelve el teléfono contra
 * Cerberus: ¿ya es cliente? ¿cuánto compró? La respuesta cambia cómo le escribe —
 * no es lo mismo un lead nuevo que alguien que ya pagó tres cursos.
 *
 * Cerberus no tiene API REST, pero expone dos endpoints JSON públicos que
 * alcanzan: `buscar` (por teléfono) y el detalle del cliente (con sus ventas).
 * Match SOLO por teléfono por ahora (decisión de Estephano); la unificación
 * cross-canal (IG/FB) queda para cuando exista `tb_contacto_canal`.
 */

import { mismoTelefono, variantesLocales } from '../telefono/paises.js';

const BASE = (process.env.CERBERUS_BASE_URL ?? 'https://app.goberna.us').replace(/\/$/, '');

export interface VentaFicha {
  folio: string;
  estado: string;
  monto: string;
  moneda: string;
  fecha: string;
}

export type Ficha =
  | {
      estado: 'cliente';
      id: number;
      nombre: string;
      codigo: string;
      dni: string;
      pais: string;
      correo: string;
      ventasCount: number;
      ventas: VentaFicha[];
    }
  /** El teléfono no figura en Cerberus: es un lead nuevo, el caso normal. */
  | { estado: 'nuevo' }
  /** Cerberus no respondió. NO es lo mismo que "no es cliente" — son opuestos. */
  | { estado: 'error'; motivo: string };

/**
 * CON QUÉ SE LE PREGUNTA A CERBERUS, y por qué no alcanza una sola forma.
 *
 * Del otro lado, `buscar/?q=` hace `telefonos__numero__icontains=q` sobre
 * `tb_telefono.numero`, que guarda el número LOCAL (el prefijo vive en otra
 * columna) cargado a mano a lo largo de años. Hasta acá se preguntaba SIEMPRE
 * por los últimos 9 dígitos del E.164, que es correcto para Perú y **no puede
 * dar verdadero nunca** para un país con local más corto: Guatemala es
 * `502` + 8 dígitos, así que los 9 finales arrancan con el `2` del código de
 * país y esa cadena no está adentro de un `numero` de 8. No es que matcheara
 * poco: era aritméticamente imposible, y son los 393 guatemaltecos, los 934
 * bolivianos y los 300 panameños del padrón.
 *
 * `variantesLocales` devuelve las formas plausibles en orden, de la más
 * específica a la más laxa, y termina SIEMPRE con el sufijo de 9 — así lo que
 * hoy encuentra a alguien lo sigue encontrando.
 */

/** Un fallo del otro lado, para que no se confunda con «no figura». */
class ErrorDeCerberus extends Error {}

async function buscarCandidatos(telefono: string): Promise<Array<Record<string, unknown>>> {
  const vistos = new Map<string, Record<string, unknown>>();

  for (const q of variantesLocales(telefono)) {
    if (q.length < 6) continue;
    const r = await fetch(`${BASE}/clientes/buscar/?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(12_000),
    });
    // Un fallo de Cerberus NO se disfraza de «no está»: sale por el catch de arriba.
    if (!r.ok) throw new ErrorDeCerberus(`Cerberus respondió ${r.status}`);

    const data = (await r.json()) as { clientes?: Array<Record<string, unknown>> };
    for (const c of data.clientes ?? []) vistos.set(String(c.id), c);
    // La primera variante que identifica a UNA sola persona alcanza: seguir
    // preguntando con formas más laxas solo puede agregar homónimos de otro país.
    if (vistos.size === 1) break;
  }

  return [...vistos.values()];
}

/**
 * ¿ESTE CANDIDATO ES DE VERDAD ESTA PERSONA?
 *
 * `icontains` con 8 dígitos trae de más, así que ensanchar la búsqueda sin
 * verificar cambiaría el falso negativo de hoy por un falso positivo mañana —y
 * un «Cliente» inventado en la ficha de un desconocido es peor que no marcar
 * nada. El detalle (`/clientes/:id/json/`) trae **todos** los teléfonos del
 * cliente con su prefijo; la comparación estricta vive en `mismoTelefono`.
 *
 * `null` cuando el detalle no cargó: ahí no se puede verificar ni desmentir, y
 * lo que decide es el llamador.
 */
function telefonoCoincide(detalle: DetalleCliente, telefono: string): boolean | null {
  if (!Array.isArray(detalle.telefonos)) return null;
  return detalle.telefonos.some((t) =>
    mismoTelefono(`${t.prefijo ?? ''}${t.numero ?? ''}`, telefono) ||
    mismoTelefono(String(t.numero ?? ''), telefono),
  );
}

interface DetalleCliente {
  ventas_count?: number;
  ventas?: Array<Record<string, unknown>>;
  telefonos?: Array<{ numero?: string; prefijo?: string }>;
}

async function detalleDe(id: unknown): Promise<DetalleCliente | null> {
  const r = await fetch(`${BASE}/clientes/${id}/json/`, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) return null;
  return (await r.json()) as DetalleCliente;
}

function ventasDe(detalle: DetalleCliente | null): { ventas: VentaFicha[]; ventasCount: number } {
  const ventas = (detalle?.ventas ?? []).map((v) => ({
    folio: String(v.folio_venta ?? ''),
    estado: String(v.estado_display ?? ''),
    monto: String(v.monto_total ?? ''),
    moneda: String(v.moneda ?? ''),
    fecha: String(v.fecha_venta ?? ''),
  }));
  return { ventas, ventasCount: detalle?.ventas_count ?? ventas.length };
}

export async function ficha(telefono: string): Promise<Ficha> {
  const digitos = telefono.replace(/\D/g, '');
  if (digitos.length < 6) return { estado: 'nuevo' };

  try {
    const candidatos = await buscarCandidatos(telefono);
    if (candidatos.length === 0) return { estado: 'nuevo' };

    // EN PARALELO Y CON TOPE DE 3, no en serie. El panel corta a los 12 s
    // (`AbortSignal.any`, ADR 0017) porque Cerberus a veces deja la conexión
    // abierta: encadenar detalles de 12 s cada uno gastaría ese techo antes de
    // llegar al candidato bueno, y la vendedora vería «no se pudo saber» sobre
    // una ficha que existía. La búsqueda devuelve hasta 20; se miran los 3
    // primeros, que es donde cae el correcto cuando la consulta fue específica.
    const mirados = await Promise.all(
      candidatos.slice(0, 3).map(async (c) => {
        const detalle = await detalleDe(c.id).catch(() => null);
        return { c, detalle, coincide: detalle ? telefonoCoincide(detalle, telefono) : null };
      }),
    );

    // Gana el PRIMERO que coincide de verdad; el orden es el de Cerberus, que es
    // el de la variante más específica que lo trajo.
    const verificado = mirados.find((m) => m.coincide === true);
    if (verificado) return armar(verificado.c, verificado.detalle);

    // No se pudo verificar (el detalle no cargó, o el cliente no tiene teléfonos
    // cargados): no alcanza para afirmar, pero tampoco para desmentir.
    const respaldo = mirados.find((m) => m.coincide === null) ?? null;

    // Ningún candidato verificó. Si alguno quedó sin poder verificarse, vale
    // —es exactamente lo que hacía antes, y saber que compró importa—; si todos
    // se pudieron mirar y ninguno era, entonces de verdad no figura.
    if (respaldo) return armar(respaldo.c, respaldo.detalle);
    return { estado: 'nuevo' };
  } catch (err) {
    return { estado: 'error', motivo: (err as Error).message };
  }
}

function armar(c: Record<string, unknown>, detalle: DetalleCliente | null): Ficha {
  const { ventas, ventasCount } = ventasDe(detalle);
  return {
    estado: 'cliente',
    id: Number(c.id),
    nombre: String(c.nombre ?? ''),
    codigo: String(c.codigo ?? ''),
    dni: String(c.dni ?? ''),
    pais: String(c.pais ?? ''),
    correo: String(c.correo ?? ''),
    ventasCount,
    ventas,
  };
}
