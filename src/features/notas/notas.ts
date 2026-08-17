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

/**
 * EL TOPE DE UNA PÁGINA — **copia del server**, no la fuente de verdad.
 *
 * Acá solo se usa para redactar el fallo cuando el server no explicó por qué
 * rechazó (`guardado.ts`). La garantía es el 400 de `validarTexto`.
 *
 * ⚠️ **Y por eso hay un test de paridad que lee el archivo del server**
 * (`limiteTexto.paridad.test.ts`): con el número en dos lados, el día que uno
 * cambie el otro sigue diciendo el viejo y la pantalla afirma «pasa de los 2.000»
 * sobre un server que acepta 20.000. Es #37 en su forma más barata de introducir
 * y más difícil de notar, porque el mensaje **suena** correcto.
 */
export const LIMITE_TEXTO = 20_000;

/** Quién puede abrir un link (ADR 0048). Copia del server; ver `linkModelo.ts`. */
export type Alcance = 'publico' | 'goberna';
/** Qué puede hacer quien lo abre. `editar` NUNCA se combina con `publico`. */
export type Permiso = 'ver' | 'editar';

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
  /**
   * El token del link público, o `null`/ausente si NO está compartida (ADR 0047).
   *
   * ⚠️ **Opcional, y la ausencia se lee como «no compartida»** — nunca como «no
   * se sabe». Con un server viejo eso es exactamente correcto: si el server no
   * conoce los links, no hay ninguno. Al revés (dibujar «compartida» ante la
   * duda) sería alarmar sobre algo que no pasó.
   */
  token?: string | null;
  /** Quién puede abrir el link, si tiene (ADR 0048). Ausente = no tiene. */
  alcance?: Alcance | null;
  /** Qué puede hacer quien lo abre. */
  permiso?: Permiso | null;
  /** `null` = no vence. */
  venceAt?: string | null;
  /** `null` = nunca lo abrió nadie — la respuesta más útil. */
  ultimoAccesoAt?: string | null;
  /**
   * PANTALLA DIVIDIDA (17-ago-2026): con qué otra página se ve al lado, a la
   * derecha. `null`/ausente = pantalla simple.
   *
   * ⚠️ UNIDIRECCIONAL: es la contraparte que ESTA página eligió, no una
   * relación simétrica — abrir la otra no trae a ésta de vuelta salvo que
   * ELLA también apunte para acá. Y es UNA SOLA: dividir de nuevo reemplaza,
   * nunca agrega una segunda.
   */
  paginaDivididaId?: number | null;
  /**
   * `'texto'` (BlockNote, el de siempre) o `'diagrama'` (React Flow — nodos y
   * conexiones). Ausente se lee como `'texto'`: un server viejo no lo manda, y
   * toda fila de antes de este frente ES texto.
   */
  tipo?: 'texto' | 'diagrama';
  /** El diagrama de React Flow, o `null`/ausente si `tipo !== 'diagrama'`. */
  diagrama?: { nodes: unknown[]; edges: unknown[] } | null;
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

/**
 * UNA PÁGINA, POR SU ID — lo que la pantalla dividida necesita para mostrar al
 * lado una página que no pertenece a la `clave`/`espacio` que `useNotas` está
 * trayendo. `null` la apaga: no hay pantalla dividida (todavía) que mirar.
 */
export function useNotaPorId(id: number | null) {
  return useQuery({
    queryKey: ['notas', 'por-id', id],
    queryFn: () => api<{ ok: true; nota: Nota }>(`/api/notas/${id}`),
    select: (d) => d.nota,
    enabled: id !== null,
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

  /**
   * UN DIAGRAMA DE REACT FLOW (17-ago-2026) — el gemelo de `crear`/`autoguardar`
   * para `tipo: 'diagrama'`. Aparte y no una rama de las de arriba: un diagrama
   * nunca manda `texto`/`doc` (no hay BlockNote de por medio), así que
   * mezclarlos habría dejado un solo body con dos formas posibles según qué
   * campos vinieran — más difícil de leer que dos mutaciones chicas.
   */
  const crearDiagrama = useMutation({
    mutationFn: (v: { diagrama: unknown }) =>
      api<{ ok: true; nota: Nota }>('/api/notas', {
        method: 'POST',
        body: JSON.stringify({ clave, espacioId, tipo: 'diagrama', diagrama: v.diagrama }),
      }),
    onSuccess: invalidar,
  });

  const autoguardarDiagrama = useMutation({
    mutationFn: (v: { id: number; diagrama: unknown }) =>
      api<{ ok: true; nota: Nota }>(`/api/notas/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ diagrama: v.diagrama }),
      }),
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

  /**
   * MOVER una página de lugar (ADR 0047). `destino: null` = mi libreta privada.
   *
   * ⚠️ **Invalida las DOS listas**, la de origen y la de destino: la página
   * desaparece de una y aparece en la otra, y refrescar solo la actual dejaría la
   * otra con un fantasma hasta el próximo refetch — que en la lista de un espacio
   * compartido se lee como que la página sigue ahí para todos.
   */
  const mover = useMutation({
    mutationFn: (v: { id: number; destino: number | null }) =>
      api<{ ok: true }>(`/api/notas/${v.id}/mover`, {
        method: 'PATCH',
        body: JSON.stringify({ espacioId: v.destino }),
      }),
    onSuccess: (_r, v) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['notas', clave, espacioId] }),
        qc.invalidateQueries({ queryKey: ['notas', clave, v.destino] }),
      ]),
  });

  /**
   * Abrir —o RECONFIGURAR— el link (ADR 0048). Idempotente en el server: dos
   * clics no dan dos URLs, y cambiar el alcance surte efecto sobre el token que
   * ya se repartió.
   *
   * ⚠️ `permiso: 'editar'` con `alcance: 'publico'` lo rechaza el server con 400:
   * sin identidad no hay autoría. La pantalla no ofrece esa combinación.
   */
  const abrirLink = useMutation({
    mutationFn: (v: { id: number; alcance: Alcance; permiso: Permiso; venceAt?: string | null }) =>
      api<{ ok: true; token: string }>(`/api/notas/${v.id}/link`, {
        method: 'POST',
        body: JSON.stringify({ alcance: v.alcance, permiso: v.permiso, venceAt: v.venceAt ?? null }),
      }),
    onSuccess: invalidar,
  });

  /** Cortarlo. El corte es inmediato: el server borra la fila. */
  const cortarLink = useMutation({
    mutationFn: (id: number) => api<{ ok: true; token: null }>(`/api/notas/${id}/link`, { method: 'DELETE' }),
    onSuccess: invalidar,
  });

  /**
   * PANTALLA DIVIDIDA (17-ago-2026): con qué otra página se ve al lado.
   * `dividir` la abre —o la cambia—, `cortarDivision` la deshace.
   *
   * ⚠️ Invalida la lista de ESTA página (la que cambió su `paginaDivididaId`),
   * no la de la contraparte: dividir no la mueve de lugar ni la toca, así que
   * no hay nada que refrescar del otro lado. Quien la muestra al lado
   * (`useNotaPorId`) la trae por su propio queryKey.
   */
  const dividir = useMutation({
    mutationFn: (v: { id: number; paginaDivididaId: number }) =>
      api<{ ok: true; nota: Nota }>(`/api/notas/${v.id}/dividir`, {
        method: 'PATCH',
        body: JSON.stringify({ paginaDivididaId: v.paginaDivididaId }),
      }),
    onSuccess: invalidar,
  });

  const cortarDivision = useMutation({
    mutationFn: (id: number) => api<{ ok: true; nota: Nota }>(`/api/notas/${id}/dividir`, { method: 'DELETE' }),
    onSuccess: invalidar,
  });

  return {
    crear,
    editar,
    archivar,
    desarchivar,
    autoguardar,
    mover,
    abrirLink,
    cortarLink,
    dividir,
    cortarDivision,
    crearDiagrama,
    autoguardarDiagrama,
  };
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
