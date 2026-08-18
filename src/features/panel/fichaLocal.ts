import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * LA FICHA RÁPIDA DEL CONTACTO — datos y prellenado.
 *
 * Lo que la vendedora AVERIGUA en el chat y hasta ahora no tenía dónde caer:
 * apellido real, empresa, correo dictado, prioridad. **No compite con Cerberus**
 * —el cliente vive allá— ni con el lead-form: los dos se leen primero y esto
 * completa lo que falta (`identidad.ts` ya arbitra Cerberus > formulario >
 * alias de WhatsApp).
 *
 * La regla de la casa que ordena este archivo: **lo que ya está en la
 * conversación no se le vuelve a pedir a nadie**.
 */

export type Prioridad = 'alta' | 'media' | 'normal';

export interface FichaLocal {
  clave: string;
  telefono: string | null;
  nombre: string | null;
  apellido: string | null;
  empresa: string | null;
  email: string | null;
  prioridad: Prioridad | null;
  vendedoraId: string;
  creadoAt: string;
  actualizadoAt: string;
}

/** Lo que el drawer manda. `forzar` sólo lo pone el botón «Registrar igual». */
export interface DatosFicha {
  telefono: string;
  nombre: string;
  apellido: string;
  empresa: string;
  email: string;
  prioridad: Prioridad | null;
  forzar?: boolean;
}

/** La respuesta del POST: o se guardó, o hay otra ficha con este teléfono/correo. */
export type Guardado =
  | { ok: true; ficha: FichaLocal }
  | { ok: false; motivo: 'duplicado'; message: string; duplicada: FichaLocal };

export function useFichaLocal(clave: string | null) {
  return useQuery({
    queryKey: ['ficha-local', clave],
    enabled: clave != null,
    queryFn: () =>
      api<{ ficha: FichaLocal | null }>(`/api/contactos/registro?clave=${encodeURIComponent(clave!)}`),
    select: (d) => d.ficha,
  });
}

export function useGuardarFicha(clave: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: DatosFicha) =>
      api<Guardado>('/api/contactos/registro', { method: 'POST', body: JSON.stringify({ clave, ...d }) }),
    onSuccess: (r) => {
      // Un duplicado detectado NO invalida nada: no se escribió nada.
      if (r.ok) void qc.invalidateQueries({ queryKey: ['ficha-local', clave] });
    },
  });
}

// ── Prellenado: lo que el chat ya sabe ────────────────────────────────────

export interface Identidad {
  nombre: string;
  apellido: string;
  empresa: string;
}

/**
 * LOS SEPARADORES CON LOS QUE LA GENTE METE SU NEGOCIO EN EL NOMBRE DE WHATSAPP.
 *
 * «Jorge Martin - JM RUSH AUTOMOTRIZ» es un alias real de la cola, y es DOS
 * datos pegados con un guion. Partirlo es la diferencia entre una ficha con
 * empresa y una vendedora tipeando de nuevo algo que ya estaba en pantalla.
 *
 * El guion va con espacios a los dos lados a propósito: «Jean-Pierre» no se
 * parte, y ése es el apellido de alguien.
 */
const SEPARADORES = [' - ', ' – ', ' — ', ' | ', ' / '];

/**
 * Parte un nombre suelto en nombre · apellido · empresa.
 *
 * Reglas, en orden:
 *   1. Si hay separador, lo de la derecha es la EMPRESA (y si hay varios, se
 *      corta en el primero: lo de más a la izquierda es la persona).
 *   2. De la persona, la primera palabra es el nombre y el resto el apellido —
 *      con dos apellidos, los dos van juntos, que es como se escriben acá.
 *   3. Una sola palabra es un nombre, nunca un apellido: es lo que se usa para
 *      saludar, y saludar con el apellido suena a cobranza.
 */
export function partirIdentidad(crudo: string | null | undefined): Identidad {
  const texto = (crudo ?? '').replace(/\s+/g, ' ').trim();
  if (!texto) return { nombre: '', apellido: '', empresa: '' };

  let persona = texto;
  let empresa = '';
  for (const sep of SEPARADORES) {
    const i = texto.indexOf(sep);
    if (i > 0) {
      persona = texto.slice(0, i).trim();
      empresa = texto.slice(i + sep.length).trim();
      break;
    }
  }

  const partes = persona.split(' ').filter(Boolean);
  return {
    nombre: partes[0] ?? '',
    apellido: partes.slice(1).join(' '),
    empresa,
  };
}

/**
 * CON QUÉ ARRANCA EL FORMULARIO.
 *
 * El orden de preferencia es el mismo que el del encabezado del panel
 * (`identidad.ts`): lo que ya está REGISTRADO manda sobre lo que Cerberus sabe,
 * y Cerberus sobre el formulario, y el formulario sobre el alias de WhatsApp —
 * cada escalón es alguien que escribió el dato con más intención que el
 * anterior. Un campo vacío nunca pisa uno lleno.
 */
export function prellenar(o: {
  ficha?: FichaLocal | null;
  nombreCerberus?: string | null;
  correoCerberus?: string | null;
  nombreLead?: string | null;
  correoLead?: string | null;
  aliasChat?: string | null;
  telefono?: string | null;
}): DatosFicha {
  const desdeAlias = partirIdentidad(o.aliasChat);
  const mejorNombre = o.nombreCerberus?.trim() || o.nombreLead?.trim() || '';
  const partido = mejorNombre ? partirIdentidad(mejorNombre) : desdeAlias;

  const primero = (...vs: (string | null | undefined)[]) => vs.find((v) => v?.trim())?.trim() ?? '';

  return {
    telefono: primero(o.ficha?.telefono, o.telefono),
    nombre: primero(o.ficha?.nombre, partido.nombre),
    apellido: primero(o.ficha?.apellido, partido.apellido),
    // La empresa sale del alias aunque el nombre venga de Cerberus: son dos
    // datos distintos y Cerberus no guarda el segundo.
    empresa: primero(o.ficha?.empresa, partido.empresa, desdeAlias.empresa),
    email: primero(o.ficha?.email, o.correoCerberus, o.correoLead),
    prioridad: o.ficha?.prioridad ?? null,
  };
}

/** Qué falta para que la ficha sirva. Sin nombre no hay a quién llamar. */
export function faltaLoMinimo(d: DatosFicha): boolean {
  return d.nombre.trim() === '' && d.telefono.trim() === '';
}
