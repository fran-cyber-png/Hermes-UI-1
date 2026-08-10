import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * NOTAS — el «Notion» a una tecla (issue #47). Datos y reglas de orden/atajo;
 * la UI vive en `PanelNotas.tsx`. Ancladas a una conversación (`clave` de la
 * cola) o a `'general'` (la libreta personal, tecla «n» — `App.tsx`).
 *
 * A propósito NO entran a `PERSISTIBLES` (`src/lib/datos/persistencia.ts`): una
 * nota «paga el viernes» rehidratada como actual desde IndexedDB es peor que un
 * spinner. El queryKey `['notas', clave]` queda fuera de la lista blanca.
 */

export const LIMITE_TEXTO = 2000;

export interface Nota {
  id: number;
  clave: string;
  vendedoraId: string;
  /**
   * El texto plano. Cuando hay `doc`, es lo que el SERVER derivó de él — nunca
   * se manda desde acá: el navegador no calcula derivados (ver el server,
   * `notas/textoPlano.ts`). Se usa para la lista, la búsqueda y el preview.
   */
  texto: string;
  /**
   * El documento rico de BlockNote. `null` en toda nota escrita antes de la
   * Libreta, y en TODA histórica de `gestiones` — que se pintan desde `texto`.
   */
  doc: unknown;
  fijada: boolean;
  creadoAt: string;
  /** null = nunca editada. */
  editadoAt: string | null;
  /** null = viva. No hay borrado físico. */
  archivadoAt: string | null;
  /**
   * 'nota' = editable, de la tabla `notas`. 'gestion' = HISTÓRICA — el texto
   * que quedó en `gestiones.notas` antes de #47 (el viejo textarea de
   * `RegistrarGestion`), solo lectura: no tiene PATCH posible (ver ADR 0012).
   * `id` de una histórica es el id de esa fila de `gestiones`, no de `notas`.
   */
  origen: 'nota' | 'gestion';
  /**
   * DÓNDE VIVE (ADR 0046). `null` = la libreta privada de su autora.
   *
   * ⚠️ Se lee como **opcional**: un server viejo no lo manda, y la ausencia
   * significa lo mismo que `null` (la libreta de siempre). Nunca al revés.
   */
  espacioId?: number | null;
}

/**
 * Fijada primero, luego más nueva primero — espejo del `ORDER BY` del server
 * (`notas/notas.ts` en el server). Se re-aplica acá porque una edición local
 * (fijar/desfijar) puede llegar antes que la invalidación del query.
 */
export function ordenarNotas(notas: Nota[]): Nota[] {
  return [...notas].sort((a, b) => {
    if (a.fijada !== b.fijada) return a.fijada ? -1 : 1;
    return new Date(b.creadoAt).getTime() - new Date(a.creadoAt).getTime();
  });
}

/**
 * ¿La tecla que llegó es el atajo de la libreta? Puro — sin `preventDefault` ni
 * lectura del DOM: eso lo decide `App.tsx`, que además guarda con `tecleandoEn`
 * (ningún atajo global pisa un input). Los acordes con modificador NO son este
 * atajo (⌘N, Ctrl+N son del sistema operativo/navegador).
 */
export function esAtajoLibreta(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): boolean {
  return e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey;
}

/**
 * Las páginas de un lugar: mi libreta privada (`espacioId === null`) o un espacio.
 *
 * 🔴 **EL `espacioId` VA EN LA `queryKey`, Y NO ES OPCIONAL.** Sin él, las dos
 * listas comparten entrada de caché: cambiás de espacio y ves durante un
 * instante —o hasta que resuelva el refetch— las páginas del anterior, bajo el
 * nombre del nuevo. No es un parpadeo cosmético: en un frente cuyo punto entero
 * es quién ve qué, se lee como que el espacio tiene contenido que no tiene.
 */
export function useNotas(clave: string, espacioId: number | null = null, activo = true) {
  return useQuery({
    queryKey: ['notas', clave, espacioId],
    queryFn: () =>
      api<{ notas: Nota[] }>(
        `/api/notas?clave=${encodeURIComponent(clave)}${espacioId === null ? '' : `&espacio=${espacioId}`}`,
      ),
    select: (d) => ordenarNotas(d.notas),
    enabled: activo && Boolean(clave),
  });
}

export function useBuscarNotas(q: string) {
  const termino = q.trim();
  return useQuery({
    queryKey: ['notas', 'buscar', termino],
    queryFn: () => api<{ notas: Nota[] }>(`/api/notas?q=${encodeURIComponent(termino)}`),
    select: (d) => ordenarNotas(d.notas),
    enabled: termino.length > 0,
  });
}

/**
 * Las mutaciones comparten la invalidación: la lista de esa `clave` (nunca se
 * cachea en disco). `onSuccess` DEVUELVE la promesa de `invalidateQueries` (no
 * `void`) a propósito: así `mutateAsync(...)` no se considera terminada hasta
 * que la lista se refrescó de verdad — sin esto, dos clics rápidos en "fijar"
 * (el botón se reactiva apenas el PATCH vuelve, todavía con el dato viejo en
 * caché) podían pisarse. `PanelNotas` además deshabilita el botón mientras la
 * promesa está en vuelo.
 */
export function useMutacionesNotas(clave: string, espacioId: number | null = null) {
  const qc = useQueryClient();
  const invalidar = () => qc.invalidateQueries({ queryKey: ['notas', clave, espacioId] });

  const crear = useMutation({
    mutationFn: (v: string | { texto?: string; doc?: unknown }) => {
      const cuerpo = typeof v === 'string' ? { texto: v } : v;
      // `espacioId` viaja SIEMPRE: una página nueva nace donde la vendedora está
      // parada. Sin esto, escribir adentro de un espacio creaba la página en la
      // libreta privada — y desaparecía de la lista apenas refrescaba.
      return api<{ ok: true; nota: Nota }>('/api/notas', {
        method: 'POST',
        body: JSON.stringify({ clave, espacioId, ...cuerpo }),
      });
    },
    onSuccess: invalidar,
  });

  const editar = useMutation({
    mutationFn: (v: { id: number; texto?: string; doc?: unknown; fijada?: boolean }) =>
      api<{ ok: true; nota: Nota }>(`/api/notas/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ texto: v.texto, doc: v.doc, fijada: v.fijada }),
      }),
    onSuccess: invalidar,
  });

  /**
   * AUTOGUARDADO del editor. Es `editar` con otra política de caché: parchea la
   * fila en el caché en vez de invalidar. Invalidar en cada tecleo dispara un
   * refetch por pulsación y hace parpadear la lista mientras se escribe — y el
   * único dato que cambia es el `texto` derivado y el `editadoAt`, que vienen en
   * la respuesta. El editor no se toca: es no-controlado, así que un refetch
   * tampoco lo resetearía, solo cuesta.
   */
  const autoguardar = useMutation({
    mutationFn: (v: { id: number; doc: unknown }) =>
      api<{ ok: true; nota: Nota }>(`/api/notas/${v.id}`, { method: 'PATCH', body: JSON.stringify({ doc: v.doc }) }),
    onSuccess: (r) => {
      qc.setQueryData<{ notas: Nota[] }>(['notas', clave, espacioId], (prev) =>
        prev ? { notas: prev.notas.map((n) => (n.id === r.nota.id && n.origen === 'nota' ? { ...n, ...r.nota } : n)) } : prev,
      );
    },
  });

  const archivar = useMutation({
    mutationFn: (id: number) => api<{ ok: true; nota: Nota }>(`/api/notas/${id}/archivar`, { method: 'PATCH' }),
    onSuccess: invalidar,
  });

  /** El «Deshacer» del toast que sigue a archivar — el camino de vuelta que faltaba. */
  const desarchivar = useMutation({
    mutationFn: (id: number) => api<{ ok: true; nota: Nota }>(`/api/notas/${id}/desarchivar`, { method: 'PATCH' }),
    onSuccess: invalidar,
  });

  return { crear, editar, archivar, desarchivar, autoguardar };
}

/** La primera línea con texto — el título que la Libreta muestra en la lista. */
export function tituloDeNota(nota: Nota): string {
  const primera = nota.texto.split('\n').find((l) => l.trim() !== '');
  return primera?.trim() ?? '';
}

/**
 * El resto, para el renglón de abajo en la lista. Se corta con `slice` y no con
 * CSS porque son varias líneas colapsadas en una: sin el corte, una nota larga
 * manda un párrafo entero al DOM de cada fila.
 */
export function resumenDeNota(nota: Nota, tope = 90): string {
  const titulo = tituloDeNota(nota);
  const resto = nota.texto.slice(titulo.length).replace(/\s+/g, ' ').trim();
  return resto.length > tope ? `${resto.slice(0, tope)}…` : resto;
}

/**
 * El `doc` que le entra al editor. Una nota vieja (o una histórica de
 * `gestiones`) no tiene documento: se convierte su texto a párrafos, uno por
 * línea, para que se pueda abrir y seguir escribiendo sin migrar nada.
 * `undefined` cuando no hay ni texto — BlockNote no acepta contenido vacío.
 */
export function docParaEditor(nota: Nota): unknown[] | undefined {
  if (Array.isArray(nota.doc) && nota.doc.length > 0) return nota.doc;
  const lineas = nota.texto.split('\n');
  if (lineas.every((l) => l.trim() === '')) return undefined;
  return lineas.map((linea) => ({ type: 'paragraph', content: linea === '' ? [] : [{ type: 'text', text: linea, styles: {} }] }));
}
