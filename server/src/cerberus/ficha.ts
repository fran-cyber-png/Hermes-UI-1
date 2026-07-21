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
 * El teléfono para buscar en Cerberus. Cerberus guarda el número LOCAL (sin
 * código de país) en `tb_telefono.numero`, así que buscamos con los últimos 9
 * dígitos — el número de móvil peruano — que matchea sin depender de cómo esté
 * guardado el prefijo.
 */
function paraBuscar(telefono: string): string {
  const digitos = telefono.replace(/\D/g, '');
  return digitos.length > 9 ? digitos.slice(-9) : digitos;
}

export async function ficha(telefono: string): Promise<Ficha> {
  const q = paraBuscar(telefono);
  if (q.length < 6) return { estado: 'nuevo' };

  try {
    const r1 = await fetch(`${BASE}/clientes/buscar/?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!r1.ok) return { estado: 'error', motivo: `Cerberus respondió ${r1.status}` };

    const data = (await r1.json()) as { clientes?: Array<Record<string, unknown>> };
    const c = data.clientes?.[0];
    if (!c) return { estado: 'nuevo' };

    // Enriquecer con las ventas (el detalle del cliente). Si esto falla, igual
    // devolvemos que es cliente — saber que compró importa aunque el historial no cargue.
    let ventas: VentaFicha[] = [];
    let ventasCount = 0;
    try {
      const r2 = await fetch(`${BASE}/clientes/${c.id}/json/`, { signal: AbortSignal.timeout(12_000) });
      if (r2.ok) {
        const d = (await r2.json()) as { ventas_count?: number; ventas?: Array<Record<string, unknown>> };
        ventas = (d.ventas ?? []).map((v) => ({
          folio: String(v.folio_venta ?? ''),
          estado: String(v.estado_display ?? ''),
          monto: String(v.monto_total ?? ''),
          moneda: String(v.moneda ?? ''),
          fecha: String(v.fecha_venta ?? ''),
        }));
        ventasCount = d.ventas_count ?? ventas.length;
      }
    } catch {
      /* el detalle es un extra; la identidad ya la tenemos */
    }

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
  } catch (err) {
    return { estado: 'error', motivo: (err as Error).message };
  }
}
