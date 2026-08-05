import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * LOS EVENTOS DEL CONTACTO — lo que la vendedora ESCUCHÓ, en el timeline.
 *
 * El timeline del panel derecho se armaba solo con lo derivado (la compra que
 * dice Cerberus, la llegada que dice Meta, el enfriamiento que calcula el
 * server). Lo que pasa EN la conversación —«preguntó por gestión pública»,
 * «dijo que lo ve con su jefe», «está caro»— no tenía dónde caer.
 *
 * Este módulo es la parte pura + los hooks. Nada de JSX: la regla de «qué se
 * puede registrar» tiene que poder interrogarse en un test sin montar un DOM,
 * y sobre todo tiene que poder interrogarse **sobre el tipo que todavía no
 * existe** — que es el caso que importa, porque el vocabulario crece del lado
 * del server y el front se despliega aparte (N4 va solo, N5 es un botón).
 */

/**
 * EL VOCABULARIO — copia a mano del de `server/src/eventos/catalogo.ts`.
 *
 * Se duplica a propósito: el popover tiene que poder pintarse sin un request
 * de ida y vuelta para seis strings estáticos. Lo que hace que la copia sea
 * verificable y no una promesa es `server/src/eventos/paridad.test.ts`, que
 * LEE este archivo y falla si las dos listas divergen — el mismo candado que
 * ya protege `src/features/hechos/hechos.ts`.
 */
export const TIPOS_EVENTO = [
  'pregunto_curso',
  'pidio_precio',
  'objecion',
  'quedamos_en',
  'llamada',
  'otro',
] as const;

export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export interface DefinicionEvento {
  rotulo: string;
  pideCurso: boolean;
  exigeNota: boolean;
  ejemplo: string;
}

export const CATALOGO_EVENTOS: Record<TipoEvento, DefinicionEvento> = {
  pregunto_curso: {
    rotulo: 'Preguntó por un curso',
    pideCurso: true,
    exigeNota: false,
    ejemplo: 'cómo lo dijo, si mencionó otro…',
  },
  pidio_precio: {
    rotulo: 'Pidió precio',
    pideCurso: false,
    exigeNota: false,
    ejemplo: 'preguntó por cuotas, por el pago…',
  },
  objecion: {
    rotulo: 'Objeción',
    pideCurso: false,
    exigeNota: true,
    ejemplo: '«está caro», «lo veo el otro mes»…',
  },
  quedamos_en: {
    rotulo: 'Quedamos en…',
    pideCurso: false,
    exigeNota: true,
    ejemplo: 'qué se acordó, con quién, para cuándo',
  },
  llamada: {
    rotulo: 'Llamada hecha',
    pideCurso: false,
    exigeNota: false,
    ejemplo: 'qué se habló, si no contestó…',
  },
  otro: {
    rotulo: 'Otro',
    pideCurso: false,
    exigeNota: true,
    ejemplo: 'qué pasó',
  },
};

export const TOPE_NOTA = 500;

export function esTipoConocido(tipo: string): tipo is TipoEvento {
  return (TIPOS_EVENTO as readonly string[]).includes(tipo);
}

/**
 * EL RÓTULO DE UN TIPO, incluido el que este front no conoce.
 *
 * El server puede ir adelante (N5 es un botón, pero también puede apretarse
 * antes que el N4 de otro PR). Un tipo desconocido **se muestra tal cual**, en
 * criollo: nunca un throw, nunca el rótulo de otro tipo — que es la clase de
 * error que no se ve, porque en pantalla queda algo plausible.
 */
export function rotuloDeTipo(tipo: string): string {
  if (esTipoConocido(tipo)) return CATALOGO_EVENTOS[tipo].rotulo;
  const limpio = tipo.trim().replace(/_/g, ' ');
  if (!limpio) return 'Evento';
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

export interface EventoContacto {
  id: number;
  clave: string;
  tipo: string;
  curso: string | null;
  productoId: string | null;
  nota: string | null;
  vendedoraId: string;
  creadoAt: string;
  editadoAt: string | null;
}

/**
 * POR QUÉ TODAVÍA NO SE PUEDE REGISTRAR, o `null` si ya se puede.
 *
 * Es la MISMA función que consultan el botón (para deshabilitarse) y el submit
 * (para no mandar). Separadas divergen — la lección literal de la superficie de
 * Ivi (ADR 0024), donde el acorde se salteaba el tope que el botón sí miraba y
 * la pantalla reportaba «se rompió algo» en vez de decir qué faltaba.
 *
 * Devuelve el motivo EN CRIOLLO, no un booleano: un botón gris que no dice por
 * qué está gris es un botón roto.
 */
export function motivoParaNoRegistrar(entrada: {
  tipo: string | null;
  curso: string;
  nota: string;
}): string | null {
  if (!entrada.tipo) return 'Elegí qué pasó';
  if (!esTipoConocido(entrada.tipo)) return null;

  const def = CATALOGO_EVENTOS[entrada.tipo];
  if (def.pideCurso && !entrada.curso.trim()) return 'Elegí el curso por el que preguntó';
  if (def.exigeNota && !entrada.nota.trim()) return 'Escribí qué pasó';
  if (entrada.nota.length > TOPE_NOTA) {
    return `Te pasaste ${entrada.nota.length - TOPE_NOTA} caracteres`;
  }
  return null;
}

/**
 * El nombre corto de quien registró. `ventas10@grupogoberna.com` → «Ventas10».
 *
 * El `vendedora_id` de las vendedoras nuevas ES el correo completo (verificado
 * en el panel de Cerberus el 4-ago); las viejas son cortas (`luz`, `alan`). La
 * misma regla que `canales/dueno.ts` — cortar en el `@` y capitalizar.
 */
export function nombreCortoVendedora(id: string): string {
  const corto = id.split('@')[0]?.trim() ?? '';
  if (!corto) return id;
  return corto.charAt(0).toUpperCase() + corto.slice(1);
}

/**
 * ¿Es mío este evento? Decide si se dibujan Editar y Borrar.
 *
 * 🔴 **Normaliza los DOS lados.** El mismo humano tiene dos grafías vivas en
 * producción: Cerberus empuja `Luz` y ella entra como `luz`. Con comparación
 * exacta esto no da un error visible — da que Luz no ve los botones de sus
 * propios eventos, y eso se lee como «no se puede editar», no como un bug.
 * El server aplica la misma regla (`mismaVendedora`); acá se repite porque el
 * front decide qué DIBUJA, y dibujar un botón que el server va a rechazar es
 * peor que no dibujarlo.
 */
export function esMio(evento: { vendedoraId: string }, yo: string | null | undefined): boolean {
  if (!yo) return false;
  const a = evento.vendedoraId.trim().toLowerCase();
  return a !== '' && a === yo.trim().toLowerCase();
}

// ── Los hooks ──────────────────────────────────────────────────────────────

export function useEventos(clave: string) {
  return useQuery({
    queryKey: ['eventos', clave],
    queryFn: () =>
      api<{ eventos: EventoContacto[] }>(`/api/eventos?clave=${encodeURIComponent(clave)}`),
    select: (d) => d.eventos,
  });
}

export interface NuevoEvento {
  tipo: string;
  curso?: string | null;
  productoId?: string | null;
  nota?: string | null;
}

export interface RespuestaRegistro {
  ok: true;
  evento: EventoContacto;
  interesAsentado: boolean;
  motivoInteres: 'producto_inexistente' | 'catalogo_caido' | null;
}

/**
 * Las tres mutaciones, con las invalidaciones que corresponden.
 *
 * `intereses` y `embudo` se invalidan porque un `pregunto_curso` ASIENTA el
 * interés del lado del server (es la única fuente de verdad de «qué curso
 * quiere», y es la compuerta de Cotizado). Sin esta invalidación el chip de
 * intereses de la barra mostraría el estado de antes y la vendedora creería
 * que no se guardó.
 */
export function useMutacionesEventos(clave: string) {
  const qc = useQueryClient();
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['eventos', clave] });
    void qc.invalidateQueries({ queryKey: ['intereses', clave] });
    void qc.invalidateQueries({ queryKey: ['embudo'] });
  };

  const registrar = useMutation({
    mutationFn: (e: NuevoEvento) =>
      api<RespuestaRegistro>('/api/eventos', {
        method: 'POST',
        body: JSON.stringify({ clave, ...e }),
      }),
    onSuccess: invalidar,
  });

  const editar = useMutation({
    mutationFn: (e: { id: number; nota: string | null; curso: string | null }) =>
      api(`/api/eventos/${e.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nota: e.nota, curso: e.curso }),
      }),
    onSuccess: invalidar,
  });

  const borrar = useMutation({
    mutationFn: (id: number) => api(`/api/eventos/${id}`, { method: 'DELETE' }),
    onSuccess: invalidar,
  });

  return { registrar, editar, borrar };
}
