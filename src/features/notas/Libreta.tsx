import { useEffect, useRef, useState } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import { ChevronLeft, Notebook, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react';
import '@blocknote/mantine/style.css';
import {
  type Nota,
  docParaEditor,
  resumenDeNota,
  tituloDeNota,
  useBuscarNotas,
  useMutacionesNotas,
  useNotas,
} from './notas';

/**
 * LA LIBRETA — el espacio de trabajo privado de la vendedora, a pantalla completa.
 *
 * ══ POR QUÉ NO ES UNA VISTA DEL RIEL ════════════════════════════════════════
 *
 * El riel se queda en SEIS. Esto es una superficie que se abre con `n` y se
 * cierra con Escape, sin ícono permanente — la categoría que la app ya usa tres
 * veces (la Cabina con `?`, Ivi con `i`, y esta misma libreta antes de crecer).
 * Mantiene en pie el criterio de ADR 0016 —«el riel es para LUGARES»— en vez de
 * pedirle una excepción. Decidido en el ticket de la forma del mapa #197.
 *
 * ══ EL ESCAPE NO SE MANEJA ACÁ, Y ESO ES DELIBERADO ═════════════════════════
 *
 * Este componente vive MONTADO, abierto o cerrado. Si registrara `useEscape`
 * sin recibir su condición de abierta, **se comería el Escape de toda la app**
 * —ya pasó con `ConsultaIvi` y dejaron de andar cerrar la conversación, cerrar
 * la Cabina y cerrar la libreta (ADR 0024)—. Acá el Escape lo resuelve la
 * cascada de `App.tsx`, que cierra la libreta PRIMERO. No agregar un listener
 * propio sin pasarle `abierta`.
 *
 * ══ LO QUE NO HACE, POR REGLA ═══════════════════════════════════════════════
 *
 * **No tiene botón de mandar.** De una nota no se deriva nada: ni etapa, ni
 * recordatorio, ni envío (ADR 0012). Si se pareciera a una respuesta rápida
 * rompería «un envío = una acción humana». Se archiva, no se borra. Y **sin
 * oro**: el dorado significa tiempo que se acaba, y acá no se acaba nada.
 */

/** Lo que la lista tiene seleccionado: una nota guardada, o una página en blanco. */
type Seleccion = { tipo: 'nota'; id: number; origen: Nota['origen'] } | { tipo: 'nueva' } | null;

const CLAVE_LIBRETA = 'general';

/** Cuánto se espera después de la última tecla para guardar. */
const ESPERA_AUTOGUARDADO_MS = 800;

function mismaSeleccion(a: Seleccion, b: Seleccion): boolean {
  if (a === null || b === null) return a === b;
  if (a.tipo !== b.tipo) return false;
  return a.tipo === 'nota' && b.tipo === 'nota' ? a.id === b.id : true;
}

/**
 * EL EDITOR de una página. Va con `key` de afuera para que cambiar de nota lo
 * REMONTE: `useCreateBlockNote` fija su `initialContent` en el primer render y
 * no lo vuelve a mirar, así que sin remontar se quedaría con la nota anterior.
 */
function EditorDePagina({
  contenidoInicial,
  soloLectura,
  onCambio,
}: {
  contenidoInicial: unknown[] | undefined;
  soloLectura: boolean;
  onCambio: (doc: unknown) => void;
}) {
  const editor = useCreateBlockNote({
    // El cast es el borde con la librería: `docParaEditor` produce la forma de
    // BlockNote pero el tipo viaja como `unknown` desde la base — tiparlo fuerte
    // más arriba sería afirmar sobre un `jsonb` algo que nadie verificó.
    initialContent: contenidoInicial as never,
  });

  return (
    <BlockNoteView
      editor={editor}
      editable={!soloLectura}
      theme="light"
      onChange={() => onCambio(editor.document)}
      data-libreta-editor
    />
  );
}

/** Un renglón de la lista de páginas. */
function FilaPagina({
  nota,
  activa,
  onAbrir,
  onFijar,
  onArchivar,
}: {
  nota: Nota;
  activa: boolean;
  onAbrir: () => void;
  onFijar: () => void;
  onArchivar: () => void;
}) {
  const titulo = tituloDeNota(nota);
  const resumen = resumenDeNota(nota);
  const historica = nota.origen === 'gestion';

  return (
    <div
      className={`group relative rounded-lg border px-3 py-2 transition ${
        activa ? 'border-primary bg-secondary' : 'border-transparent hover:bg-muted'
      }`}
    >
      <button type="button" onClick={onAbrir} className="block w-full text-left">
        <div className="flex items-center gap-1.5">
          {nota.fijada && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="fijada" />}
          <span className="truncate text-sm font-medium text-foreground">{titulo || 'Sin título'}</span>
        </div>
        {resumen && <p className="mt-0.5 truncate text-xs text-muted-foreground">{resumen}</p>}
        <p className="mt-1 flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          <span>{new Date(nota.creadoAt).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}</span>
          {nota.editadoAt && <span>· editada</span>}
          {historica && (
            <span className="rounded border border-dashed border-border px-1 py-px" title="Quedó de una gestión: se lee, no se edita">
              de gestión
            </span>
          )}
        </p>
      </button>

      {!historica && (
        <div className="absolute right-1.5 top-1.5 hidden gap-0.5 group-hover:flex">
          <button
            type="button"
            onClick={onFijar}
            aria-label={nota.fijada ? 'Desfijar' : 'Fijar'}
            className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
          >
            {nota.fijada ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={onArchivar}
            aria-label="Archivar"
            className="rounded p-1 text-muted-foreground hover:bg-card hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function Libreta({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
  const [busqueda, setBusqueda] = useState('');
  const [seleccion, setSeleccion] = useState<Seleccion>(null);
  const [guardando, setGuardando] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const termino = busqueda.trim();
  const lista = useNotas(CLAVE_LIBRETA, abierta);
  const encontradas = useBuscarNotas(abierta ? termino : '');
  const { crear, editar, archivar, autoguardar } = useMutacionesNotas(CLAVE_LIBRETA);

  const notas = termino ? (encontradas.data ?? []) : (lista.data ?? []);
  const abierta_ = seleccion?.tipo === 'nota' ? notas.find((n) => n.id === seleccion.id && n.origen === seleccion.origen) : undefined;

  // Al cerrar se olvida qué página estaba abierta: la próxima vez se entra a la
  // lista, no a lo último que se tocó ayer.
  useEffect(() => {
    if (!abierta) {
      setSeleccion(null);
      setBusqueda('');
    }
  }, [abierta]);

  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);

  if (!abierta) return null;

  /**
   * El autoguardado con espera. La página EN BLANCO no existe en la base hasta
   * que se escribe algo: recién ahí se crea. Así «Nueva página» no ensucia la
   * lista con filas vacías si la vendedora se arrepiente.
   */
  function alCambiar(doc: unknown) {
    if (temporizador.current) clearTimeout(temporizador.current);
    setGuardando(true);
    temporizador.current = setTimeout(async () => {
      try {
        if (seleccion?.tipo === 'nota') {
          await autoguardar.mutateAsync({ id: seleccion.id, doc });
        } else if (seleccion?.tipo === 'nueva') {
          const r = await crear.mutateAsync({ doc });
          setSeleccion({ tipo: 'nota', id: r.nota.id, origen: 'nota' });
        }
      } catch {
        // El error se ve en el renglón de estado; no se pierde lo escrito
        // porque el editor conserva su documento.
      } finally {
        setGuardando(false);
      }
    }, ESPERA_AUTOGUARDADO_MS);
  }

  const cargando = termino ? encontradas.isPending : lista.isPending;
  const fallo = termino ? encontradas.isError : lista.isError;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Tu libreta">
      {/* CABECERA */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <Notebook className="size-4 shrink-0 text-primary" />
        <h2 className="hidden shrink-0 text-sm font-semibold text-foreground sm:block">Tu libreta</h2>

        <div className="relative ml-2 w-full min-w-0 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en tus páginas…"
            aria-label="Buscar en tus páginas"
            className="h-8 w-full rounded-lg border border-input bg-card pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
          />
        </div>

        <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {guardando ? 'Guardando…' : abierta_?.editadoAt ? 'Guardado' : ''}
        </span>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar la libreta"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/*
          LA LISTA DE PÁGINAS. En ancho de teléfono es MAESTRO-DETALLE: o la
          lista o la página, nunca las dos. Con las dos, el aside de 19rem le
          deja ~85 px al editor y el título sale una letra por renglón.
        */}
        <aside
          className={`w-full shrink-0 flex-col border-r border-border md:flex md:w-[19rem] ${
            seleccion === null ? 'flex' : 'hidden'
          }`}
        >
          <div className="p-3">
            <button
              type="button"
              onClick={() => setSeleccion({ tipo: 'nueva' })}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
            >
              <Plus className="size-4" />
              Nueva página
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {seleccion?.tipo === 'nueva' && (
              <div className="rounded-lg border border-primary bg-secondary px-3 py-2">
                <span className="text-sm font-medium text-foreground">Página nueva</span>
                <p className="mt-0.5 text-xs text-muted-foreground">Se guarda sola al escribir</p>
              </div>
            )}

            {cargando && <p className="px-2 py-3 text-sm text-muted-foreground">Cargando…</p>}
            {fallo && <p className="px-2 py-3 text-sm text-destructive">No se pudieron traer tus páginas.</p>}
            {!cargando && !fallo && notas.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {termino ? 'Nada con ese término.' : 'Todavía no escribiste nada acá.'}
              </p>
            )}

            {notas.map((n) => (
              <FilaPagina
                key={`${n.origen}-${n.id}`}
                nota={n}
                activa={mismaSeleccion(seleccion, { tipo: 'nota', id: n.id, origen: n.origen })}
                onAbrir={() => setSeleccion({ tipo: 'nota', id: n.id, origen: n.origen })}
                onFijar={() => editar.mutate({ id: n.id, fijada: !n.fijada })}
                onArchivar={() => {
                  archivar.mutate(n.id);
                  if (seleccion?.tipo === 'nota' && seleccion.id === n.id) setSeleccion(null);
                }}
              />
            ))}
          </div>
        </aside>

        {/* EL EDITOR */}
        <main className={`min-h-0 flex-1 overflow-y-auto md:block ${seleccion === null ? 'hidden' : 'block'}`}>
          {/* La vuelta a la lista, solo en teléfono: en desktop la lista nunca se fue. */}
          {seleccion !== null && (
            <button
              type="button"
              onClick={() => setSeleccion(null)}
              className="flex items-center gap-1 px-4 pt-3 text-sm text-muted-foreground hover:text-foreground md:hidden"
            >
              <ChevronLeft className="size-4" />
              Tus páginas
            </button>
          )}

          {seleccion === null && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Notebook className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Elegí una página, o creá una nueva.</p>
              <p className="max-w-xs text-xs text-muted-foreground/80">
                Es tuya: nadie más del equipo la ve. De acá no sale ningún mensaje.
              </p>
            </div>
          )}

          {seleccion?.tipo === 'nueva' && (
            <div className="mx-auto max-w-3xl px-6 py-8">
              <EditorDePagina key="nueva" contenidoInicial={undefined} soloLectura={false} onCambio={alCambiar} />
            </div>
          )}

          {abierta_ && (
            <div className="mx-auto max-w-3xl px-6 py-8">
              {abierta_.origen === 'gestion' && (
                <p className="mb-4 rounded-lg border border-dashed border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  Esta quedó de una gestión vieja. Se lee, no se edita — la etapa de esa conversación se apoya en ella.
                </p>
              )}
              <EditorDePagina
                key={`${abierta_.origen}-${abierta_.id}`}
                contenidoInicial={docParaEditor(abierta_)}
                soloLectura={abierta_.origen === 'gestion'}
                onCambio={alCambiar}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
