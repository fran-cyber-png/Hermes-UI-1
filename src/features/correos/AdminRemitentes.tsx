import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, AtSign, Check, Loader2, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import { tokenGuardado } from '../../lib/datos/token';
import { quienDiceSer } from '../auth/sesion';
import { useEscape } from '../../lib/teclado/useEscape';
import { kicker } from '../../lib/styles';
import {
  dominioAceptado,
  dominioDe,
  FORMA_DE_CORREO,
  lecturaDeErrorDeRemitente,
  limpia,
  motivoParaNoGuardar,
  REMITENTE_VACIO,
  resumenDelSobre,
  type CamposDelRemitente,
} from './correos';
import type { EstadoDeCorreos, Remitente, RemitentePublico } from './tipos';

/**
 * LOS REMITENTES — con qué correo sale lo que escribe el equipo.
 *
 * ══ QUÉ VINO A ARREGLAR ═════════════════════════════════════════════════════
 *
 * 🔴 **Hasta este frente el `From` era `Escuela Goberna <escuela@goberna.us>` para
 * las nueve vendedoras, no había `Reply-To`, y el pie del composer decía «con tu
 * nombre».** O sea: el lead recibía un correo de un buzón genérico, contestaba a
 * ese buzón, y la respuesta caía en un lugar que Hermes no lee y que nadie tiene
 * asignado. Con tres filas en toda la tabla `correos` —las tres pruebas— eso nunca
 * se descubrió operando: se descubrió leyendo el código.
 *
 * Esta pantalla es la mitad que el dueño pidió con todas las letras («poder
 * configurar con qué correo quiero mandar»). Lo que administra no es cosmética: es
 * **de dónde sale** y **a dónde vuelve** cada correo que el equipo manda.
 *
 * ══ ESTO ES VISIBILIDAD, NO UNA FRONTERA ════════════════════════════════════
 *
 * ⚠️ **El guard de verdad vive en el server** (`403 no_es_supervisor` en las cuatro
 * rutas de `/api/correos/remitentes`). Lo de acá es que quien no administra no vea
 * una pantalla que no le sirve — nada más. La regla del repo es literal y vale
 * igual acá: **esconder algo del riel no protege nada, el recorte de datos va en el
 * `WHERE` de su ruta** (ADR 0035/0036). Si mañana alguien monta este componente sin
 * mirar `supervisor`, lo que pasa es que ve una hoja con un 403 adentro — no que se
 * filtre un remitente.
 *
 * ⚠️ Y por eso `supervisor` se lee **fail-closed** (`?? false`): ausente = server
 * viejo en la ventana N4↔N5, o una respuesta rehidratada de IndexedDB (ADR 0007).
 * Ante la duda no se dibuja la administración, porque el costo de esconderla un
 * rato es que alguien vuelva a abrirla, y el de dibujarla es una pantalla entera de
 * botones que contestan 403.
 *
 * ══ 🔴 CÓMO TIENE QUE MONTARLA QUIEN LA USA ═════════════════════════════════
 *
 * 🔴 **ESTA HOJA SE MONTA SÓLO MIENTRAS ESTÁ ABIERTA. No la montes siempre con un
 * `if (!abierta) return null` adentro.** `useEscape` registra en **captura sobre
 * `window`** y hace `stopPropagation()`: un listener registrado de más apaga el
 * Escape de TODA la app, y en silencio. Eso ya pasó exactamente así con la hoja de
 * Ivi (ADR 0024): mientras estaba cerrada —o sea casi siempre— se comía el Escape y
 * dejaban de andar la tecla que cierra la conversación en Mensajes, la de la Cabina
 * y la de la libreta; tres atajos rotos por un componente que no toca ninguno de
 * esos archivos. `ConsultaIvi` lo paga con un `abierta` explícito porque `App.tsx`
 * la monta siempre; acá la firma **no tiene** ese parámetro a propósito, así que el
 * contrato es el otro: `{abierta && <AdminRemitentes … />}`.
 */

/**
 * ⚠️ **LAS REGLAS DE ESTA PANTALLA NO ESTÁN ACÁ: viven en `correos.ts`.**
 * `dominioDe`, `dominioAceptado`, `motivoParaNoGuardar` y `lecturaDeErrorDeRemitente`
 * se exportaban desde este `.tsx` —cuatro avisos de `react(only-export-components)`—
 * contra la convención que sigue todo el resto del frente: la regla en el `.ts` puro,
 * el `.tsx` sólo dibuja. Su test las interroga sin montar nada, que es el punto.
 *
 * 🔴 **Y con ellas se fue la TERCERA copia de `FORMA_DE_CORREO`**, que este archivo
 * llevaba anotada como deuda: mientras las tres eran `const` privadas, aflojar una y
 * no las otras hacía que la pantalla aceptara una dirección que el server rechaza —
 * o, peor, que se negara a guardar una válida sin forma de arreglarlo desde la app.
 */

// ════════════════════════════════════════════════════════════════════════════
// LA HOJA
// ════════════════════════════════════════════════════════════════════════════

export function AdminRemitentes({ onCerrar }: { onCerrar: () => void }) {
  const qc = useQueryClient();

  // Ver el docblock de arriba: el listener existe mientras la hoja está montada, y
  // la hoja se monta sólo abierta. No hace falta la condición de `ConsultaIvi`
  // porque acá el montaje ES la apertura — y por eso el contrato con quien la usa
  // está escrito en rojo y no en un comentario suelto.
  useEscape(onCerrar);

  const [alta, setAlta] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  const [porDesactivar, setPorDesactivar] = useState<number | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  /**
   * ⚠️ Quién está mirando sale del token, **no de `useSesion()`**: ese hook hace su
   * propio `fetch` a `/api/auth/yo` al montar, así que llamarlo desde un hijo suma un
   * viaje a VPS1 por cada vez que se abre la hoja. Es el mismo motivo por el que
   * `miVendedora` viaja como prop hasta el panel derecho (`App.tsx:652`); acá la
   * firma no admite props, así que se lee el token, que es local y no miente sobre la
   * identidad — la firma la sigue verificando el server en cada request.
   */
  const vendedoraId = quienDiceSer(tokenGuardado() ?? '')?.id ?? '';

  // La MISMA `queryKey` que el composer: el estado de correos es un solo hecho, y con
  // dos claves la hoja podría estar mostrando los dominios verificados de hace un rato
  // mientras la pantalla de atrás muestra otros.
  const estado = useQuery({
    queryKey: ['correos', 'estado'],
    queryFn: () => api<EstadoDeCorreos>('/api/correos/estado'),
  });

  const supervisor = estado.data?.supervisor ?? false;
  const dominios = estado.data?.dominiosVerificados;

  // No se pide lo que ya sabemos que va a contestar 403: la lista arranca apagada y
  // se enciende sola cuando el estado dice que sí.
  const lista = useQuery({
    queryKey: ['correos', 'remitentes'],
    queryFn: () => api<{ remitentes: Remitente[] }>('/api/correos/remitentes'),
    enabled: supervisor,
  });

  /**
   * Tocar un remitente cambia **las dos** consultas: la lista de acá y los remitentes
   * activos que el composer ofrece para elegir. Invalidar sólo una deja la pantalla de
   * atrás ofreciendo un buzón que se acaba de desactivar, y eso se descubre recién
   * cuando el envío falla.
   */
  function refrescar() {
    void qc.invalidateQueries({ queryKey: ['correos', 'remitentes'] });
    void qc.invalidateQueries({ queryKey: ['correos', 'estado'] });
  }

  const crear = useMutation({
    mutationFn: (campos: CamposDelRemitente) =>
      api<{ remitente: Remitente }>('/api/correos/remitentes', {
        method: 'POST',
        body: JSON.stringify({
          direccion: campos.direccion.trim(),
          nombre: campos.nombre.trim(),
          // ⚠️ La caja vacía viaja como `null`, no como `''`: son dos cosas distintas
          // del otro lado —«este remitente no firma» contra «firma con nada»— y la
          // segunda deja un renglón en blanco pegado al final de cada correo.
          responderA: limpia(campos.responderA),
          firma: limpia(campos.firma),
        }),
      }),
    onSuccess: (_r, campos) => {
      setAlta(false);
      setHecho(`Ahora se puede mandar desde ${campos.direccion.trim()}.`);
      refrescar();
    },
  });

  const editar = useMutation({
    mutationFn: ({ id, campos }: { id: number; campos: CamposDelRemitente }) =>
      api<{ remitente: Remitente }>(`/api/correos/remitentes/${id}`, {
        method: 'PATCH',
        // La dirección NO viaja: ver la nota del formulario. Se cambia el nombre, a
        // dónde vuelven las respuestas y la firma; el buzón es la identidad.
        body: JSON.stringify({
          nombre: campos.nombre.trim(),
          responderA: limpia(campos.responderA),
          firma: limpia(campos.firma),
        }),
      }),
    onSuccess: () => {
      setEditando(null);
      setHecho('Listo: los próximos correos salen así.');
      refrescar();
    },
  });

  const cambiarActivo = useMutation({
    // ⚠️ Los dos verbos NO devuelven la misma forma (el PATCH trae el remitente, el
    // DELETE un acuse), y la respuesta acá **no se usa para nada**: lo que refresca la
    // pantalla es la invalidación, no lo que contestó la ruta. Se tipa `unknown` a
    // propósito en vez de mentirle una forma común a un `mutationFn` que devuelve dos.
    mutationFn: ({ id, activo }: { id: number; activo: boolean; direccion: string }): Promise<unknown> =>
      activo
        ? api<{ remitente: Remitente }>(`/api/correos/remitentes/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ activo: true }),
          })
        : api<{ ok: true }>(`/api/correos/remitentes/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, v) => {
      setPorDesactivar(null);
      setHecho(
        v.activo
          ? `${v.direccion} vuelve a estar disponible.`
          : `${v.direccion} dejó de ofrecerse. Lo que ya salió no cambia.`,
      );
      refrescar();
    },
  });

  const remitentes = lista.data?.remitentes ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-navy/20 sm:p-4"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Remitentes de correo"
    >
      <div
        className="flex h-dvh w-full flex-col overflow-hidden bg-card shadow-panel animate-entrar sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[30rem] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <AtSign size={16} strokeWidth={2.1} className="shrink-0 text-navy" />
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-sm font-bold leading-tight text-navy">Remitentes</h2>
            <p className="truncate text-[10px] leading-tight text-muted-foreground">
              Con qué correo sale lo que manda el equipo, y a dónde vuelven las respuestas.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-200 ease-house hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {!supervisor ? (
            <SinPermiso
              cargando={estado.isPending}
              fallo={estado.isError}
              loDijoElServer={estado.data?.supervisor !== undefined}
              onReintentar={() => void estado.refetch()}
            />
          ) : (
            <>
              {dominios && dominios.length > 0 && (
                <p className="rounded-xl bg-muted/60 px-3 py-2 text-[11px] leading-snug text-foreground">
                  Amazon SES sólo deja mandar desde{' '}
                  <span className="font-mono font-semibold">{dominios.join(' · ')}</span>. A dónde vuelven las
                  respuestas puede ser cualquier buzón: eso SES no lo verifica.
                </p>
              )}

              {hecho && (
                <div
                  role="status"
                  className="flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-2 text-xs font-medium text-success"
                >
                  <Check size={13} className="shrink-0" />
                  <span className="min-w-0 flex-1">{hecho}</span>
                  <button
                    type="button"
                    onClick={() => setHecho(null)}
                    aria-label="Cerrar aviso"
                    className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {/* ── El alta ── */}
              {alta ? (
                <FormularioRemitente
                  titulo="Nuevo remitente"
                  inicial={REMITENTE_VACIO}
                  direccionEditable
                  dominios={dominios}
                  vendedoraId={vendedoraId}
                  desdeCompat={estado.data?.desde ?? null}
                  enVuelo={crear.isPending}
                  error={crear.error ? lecturaDeErrorDeRemitente(crear.error) : null}
                  onGuardar={(c) => crear.mutate(c)}
                  onCancelar={() => {
                    crear.reset();
                    setAlta(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setHecho(null);
                    setEditando(null);
                    setAlta(true);
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-xs font-semibold text-navy transition-colors duration-200 ease-house hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Plus size={14} />
                  Nuevo remitente
                </button>
              )}

              {/* ── Los que ya existen ── */}
              <h3 className={'pt-1 ' + kicker}>Dados de alta</h3>

              {lista.isPending ? (
                <div className="space-y-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
                  ))}
                </div>
              ) : lista.isError ? (
                <div className="rounded-xl border border-border p-4 text-center text-xs text-foreground">
                  {/* Un fallo de lectura NO se dibuja como una lista vacía: «no hay
                      remitentes» es una afirmación, y acá lo único cierto es que no se
                      pudo preguntar (el criterio del catálogo de piezas, ADR 0023). */}
                  <p>{lecturaDeErrorDeRemitente(lista.error)}</p>
                  <p className="mt-1 text-muted-foreground">No es que no haya remitentes: no se pudieron leer.</p>
                  <button
                    type="button"
                    onClick={() => void lista.refetch()}
                    className="mt-2.5 rounded-lg border border-border px-3 py-1.5 font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    Reintentar
                  </button>
                </div>
              ) : remitentes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-center text-[11px] leading-snug text-muted-foreground">
                  Todavía no hay ninguno. Mientras tanto los correos salen por{' '}
                  <span className="font-mono">{estado.data?.desde ?? 'el remitente de sistemas'}</span>, el mismo
                  para las nueve — que es justamente lo que esta pantalla vino a arreglar.
                </p>
              ) : (
                <ul className="space-y-2">
                  {remitentes.map((r) =>
                    editando === r.id ? (
                      <li key={r.id}>
                        <FormularioRemitente
                          titulo={`Editar ${r.direccion}`}
                          inicial={{
                            direccion: r.direccion,
                            nombre: r.nombre,
                            responderA: r.responderA ?? '',
                            firma: r.firma ?? '',
                          }}
                          direccionEditable={false}
                          dominios={dominios}
                          vendedoraId={vendedoraId}
                          desdeCompat={estado.data?.desde ?? null}
                          enVuelo={editar.isPending}
                          error={editar.error ? lecturaDeErrorDeRemitente(editar.error) : null}
                          onGuardar={(campos) => editar.mutate({ id: r.id, campos })}
                          onCancelar={() => {
                            editar.reset();
                            setEditando(null);
                          }}
                        />
                      </li>
                    ) : (
                      <li key={r.id}>
                        <FilaRemitente
                          remitente={r}
                          dominios={dominios}
                          confirmandoBaja={porDesactivar === r.id}
                          enVuelo={cambiarActivo.isPending && cambiarActivo.variables?.id === r.id}
                          error={
                            cambiarActivo.error && cambiarActivo.variables?.id === r.id
                              ? lecturaDeErrorDeRemitente(cambiarActivo.error)
                              : null
                          }
                          onEditar={() => {
                            setHecho(null);
                            editar.reset();
                            setAlta(false);
                            setPorDesactivar(null);
                            setEditando(r.id);
                          }}
                          onPedirBaja={() => {
                            setHecho(null);
                            cambiarActivo.reset();
                            setPorDesactivar(r.id);
                          }}
                          onCancelarBaja={() => setPorDesactivar(null)}
                          onCambiarActivo={(activo) =>
                            cambiarActivo.mutate({ id: r.id, activo, direccion: r.direccion })
                          }
                        />
                      </li>
                    ),
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Por qué esta pantalla está en blanco.
 *
 * ⚠️ **Las TRES razones se dicen distinto, y no es cortesía**: «no se pudo
 * preguntar» manda a reintentar, «el server no lo publica» manda a esperar el
 * despliegue, y «no sos supervisora» manda a pedírselo a alguien. Colapsarlas en un
 * «no tenés permiso» haría que, durante la ventana N4↔N5 o con un blip de red, una
 * supervisora de verdad crea que le sacaron el permiso — y no hay nada que pueda
 * hacer con esa creencia salvo avisar que Hermes se rompió.
 *
 * 🔴 **Y ninguna de las tres se puede dibujar como una lista vacía de remitentes**:
 * «no hay ninguno» es una afirmación sobre la base, y acá lo único cierto es que no
 * se llegó a mirarla. Es la cicatriz del catálogo de piezas (ADR 0023).
 */
function SinPermiso({
  cargando,
  fallo,
  loDijoElServer,
  onReintentar,
}: {
  cargando: boolean;
  fallo: boolean;
  loDijoElServer: boolean;
  onReintentar: () => void;
}) {
  if (cargando) {
    return (
      <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" />
        Viendo quién administra los remitentes…
      </p>
    );
  }

  if (fallo) {
    return (
      <div className="rounded-xl border border-border p-4 text-center text-xs text-foreground">
        <p>No se pudo preguntar quién administra los remitentes. No es que no puedas: no se sabe.</p>
        <button
          type="button"
          onClick={onReintentar}
          className="mt-2.5 rounded-lg border border-border px-3 py-1.5 font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-xl bg-muted/60 p-3.5 text-xs leading-relaxed text-foreground">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
      {loDijoElServer ? (
        <p>
          Los remitentes los administra quien está a cargo del equipo. Pedile que dé de alta el buzón que
          necesitás — vos podés seguir mandando correos con normalidad.
        </p>
      ) : (
        <p>
          Este servidor todavía no dice quién administra los remitentes: es un despliegue a medias, no algo que
          hayas hecho mal. Se enciende solo cuando termine.
        </p>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// UNA FILA
// ════════════════════════════════════════════════════════════════════════════

interface FilaProps {
  remitente: Remitente;
  /**
   * Los dominios que SES tiene verificados, para poder decir si ESTE buzón puede
   * ser `From`.
   *
   * ⚠️ **No contradice la nota de abajo.** Lo que se sacó de esta fila fue
   * `vendedoraId`/`desdeCompat`, o sea **quién mira**: un dato del observador metido
   * adentro de un recurso compartido. Esto es lo contrario — una propiedad del
   * remitente mismo, que vale igual la mire quien la mire. Si alguien vuelve a pedir
   * acá el id de quien mira, eso sí es reabrir el defecto.
   */
  dominios: string[] | undefined;
  /**
   * ⚠️ **Acá NO va `vendedoraId` ni `desdeCompat`, y la ausencia es la decisión.**
   * Estaban, y con ellos la fila dibujaba el sobre de quien mira. Ver el docblock de
   * `FilaRemitente`: el aviso de «Sin «responder a»» desaparecía para toda
   * supervisora cuyo id es un buzón. Si alguien los vuelve a pedir acá, lo más
   * probable es que esté reabriendo eso.
   */
  confirmandoBaja: boolean;
  enVuelo: boolean;
  error: string | null;
  onEditar: () => void;
  onPedirBaja: () => void;
  onCancelarBaja: () => void;
  onCambiarActivo: (activo: boolean) => void;
}

/**
 * UNA FILA DESCRIBE AL REMITENTE, **NO CÓMO SE VE CUANDO YO MANDO**.
 *
 * 🔴 **Acá se dibujaba `resumenDelSobre(r, vendedoraId, …)` y eso metía a quien
 * MIRA adentro de la identidad de un recurso COMPARTIDO.** Dos consecuencias, y la
 * segunda es la que muerde:
 *
 * 1. Cosmética: los cuatro renglones arrancaban con el nombre del que abrió la hoja
 *    —«Luz · Escuela Goberna», «Luz · Ventas»…—, o sea que lo que identifica la fila
 *    (el buzón) quedaba corrido a la derecha detrás de un dato que se repite cuatro
 *    veces y que no es de la fila.
 * 2. 🔴 **El aviso de «Sin «responder a»» DESAPARECÍA justo para quien tiene que
 *    verlo.** `resumenDelSobre` resuelve el `Reply-To` con la precedencia de envío
 *    (D2): gana el correo de la vendedora que escribe. Así que a una supervisora
 *    cuyo `vendedora_id` **es** un buzón —y tres de los ids vivos en producción son
 *    `ventas1X@grupogoberna.com`— las CUATRO filas le decían «las respuestas vuelven
 *    a ventas1X@…», que es cierto de SU envío y falso del remitente. Un remitente
 *    mal configurado —sin `responderA`, que es el defecto original de este frente—
 *    se leía como perfectamente configurado, **y sólo en la pantalla que existe para
 *    encontrar eso**. La condición ni siquiera es rara: es el caso normal de quien
 *    administra.
 *
 * ⚠️ Lo que SÍ es «cómo se ve cuando yo mando» es la vista previa del FORMULARIO
 * (`VistaPreviaDelSobre`), y ahí `resumenDelSobre` con `vendedoraId` es lo correcto:
 * la pregunta de ese lugar es «si guardo esto, ¿qué le llega al lead?». Son dos
 * preguntas distintas sobre el mismo dato y por eso se dibujan con dos funciones
 * distintas — colapsarlas es volver a esconder el aviso.
 */
function FilaRemitente(p: FilaProps) {
  const r = p.remitente;
  // El nombre puede venir vacío (el server no lo exige): ahí la dirección va sola,
  // porque unos picos con nada adelante se leen como un dato roto.
  const identidad = r.nombre.trim() === '' ? r.direccion : `${r.nombre.trim()} <${r.direccion}>`;

  /**
   * 🔴 **ESTA FILA PUEDE OFRECER EL ERROR QUE LA PANTALLA ENTERA EXISTE PARA
   * EVITAR, y lo hacía sin decir una palabra.** El alta chequea el dominio
   * (`motivoParaNoGuardar`) y el server chequea el alta (`puedeSerRemitente`), pero
   * **`PATCH {activo:true}` no chequea nada** —lo dice el docblock del propio PATCH:
   * el dominio se verifica «al DAR DE ALTA, el único control que existe»—, así que
   * «Volver a usarlo» era una puerta de atrás a un `From` que SES rechaza con **554**.
   *
   * Y no hace falta que nadie haga nada raro para llegar ahí. Dos caminos medidos:
   * el `INSERT` a mano contra producción que el propio runbook documenta como el
   * destrabe del deploy (se saltea `puedeSerRemitente` por definición), y
   * `SMTP_DOMINIOS_VERIFICADOS`, que es una variable de entorno: el día que se
   * angoste —o que SES revoque un dominio— todas las filas viejas de ese dominio
   * quedan dadas de alta, y retirarlas y volver a prenderlas no pregunta nada.
   *
   * ⚠️ **Y el estado se DICE, esté prendido o apagado.** Con la píldora
   * «desactivado» sola, la fila del dominio no verificado se ve igual que una que
   * alguien retiró porque ya no la usa — o sea que el motivo, que es lo único que
   * hace falta para no repetir el error, no está en ningún lado de la pantalla.
   * Prendida es peor todavía: ahí cada correo que sale por ella muere en un 554 con
   * un lead esperando, y la fila no lo insinúa.
   *
   * ⚠️ **Con la lista de dominios ausente o vacía NO se afirma nada** (lo resuelve
   * `dominioAceptado` devolviendo `true`): ausente es un server viejo en la ventana
   * N4↔N5, y apagar «Volver a usarlo» por un campo que todavía no llegó dejaría a
   * quien administra sin poder arreglar nada, peleando con una regla que no existe.
   */
  const sirveDeFrom = dominioAceptado(r.direccion, p.dominios);
  const dominiosDichos = (p.dominios ?? []).join(' · ');

  return (
    <div
      className={
        'rounded-xl border border-border p-3 ' + (r.activo ? 'bg-card' : 'bg-muted/50 opacity-80')
      }
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground" title={identidad}>
            {identidad}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {r.responderA ? (
              <>
                Las respuestas vuelven a <span className="font-mono">{r.responderA}</span>
              </>
            ) : (
              // Sin `Reply-To` la respuesta cae en el buzón por el que salió, que es
              // compartido. No se dibuja un hueco mudo: es el defecto original.
              // ⚠️ Y no se trunca: con la píldora «desactivado» al lado, el `truncate`
              // cortaba esta frase a la mitad («…por el q…») justo en la fila donde
              // hay algo que decidir.
              'Sin «responder a»: la respuesta cae en el mismo buzón por el que salió.'
            )}
          </p>
        </div>
        {!r.activo && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            desactivado
          </span>
        )}
      </div>

      {!sirveDeFrom && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] leading-snug text-warning-foreground">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            SES no tiene verificado <span className="font-mono">{dominioDe(r.direccion) ?? r.direccion}</span>
            {dominiosDichos === '' ? '' : <>, sólo <span className="font-mono">{dominiosDichos}</span></>}.{' '}
            {r.activo
              ? 'Cada correo que salga por acá muere en un 554 del proveedor, con el lead esperando.'
              : 'Por eso no se puede volver a usar: saldría, lo rechazaría SES, y el lead no se entera.'}
          </span>
        </p>
      )}

      {r.firma && (
        <p className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-2 text-[11px] leading-snug text-muted-foreground">
          {r.firma}
        </p>
      )}

      {p.error && (
        <p role="alert" className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
          {p.error}
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        {p.confirmandoBaja ? (
          <>
            {/* ⚠️ El texto dice la verdad completa, y por eso no dice «Eliminar»: la
                baja es lógica, lo que ya salió conserva con qué salió, y volver a
                prenderlo es un clic. Un «¿estás segura?» pelado no informa nada. */}
            <p className="min-w-0 flex-1 text-[11px] leading-snug text-foreground">
              Deja de ofrecerse para mandar. Los correos que ya salieron conservan con qué salieron.
            </p>
            <button
              type="button"
              onClick={() => p.onCambiarActivo(false)}
              disabled={p.enVuelo}
              className="shrink-0 rounded-lg bg-destructive px-2.5 py-1 text-[11px] font-bold text-destructive-foreground transition-colors duration-200 ease-house disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {p.enVuelo ? <Loader2 size={12} className="animate-spin" /> : 'Desactivar'}
            </button>
            <button
              type="button"
              onClick={p.onCancelarBaja}
              className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Dejarlo
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={p.onEditar}
              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Pencil size={11} />
              Editar
            </button>
            {r.activo ? (
              <button
                type="button"
                onClick={p.onPedirBaja}
                className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Desactivar
              </button>
            ) : (
              /* El botón se APAGA en vez de desaparecer, y el motivo ya está arriba en
                 el aviso: un botón que se esfuma se lee como que la pantalla se rompió,
                 y manda a buscarlo. Apagado dice que la acción existe y por qué hoy no.
                 ⚠️ El `title` repite el motivo porque un botón deshabilitado no dispara
                 hover en todos lados: es lo único que queda si el aviso se pasa por alto. */
              <button
                type="button"
                onClick={() => p.onCambiarActivo(true)}
                disabled={p.enVuelo || !sirveDeFrom}
                title={
                  sirveDeFrom
                    ? undefined
                    : `SES no tiene verificado el dominio de ${r.direccion}: volver a prenderlo haría que cada correo muera en un 554.`
                }
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-navy transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {p.enVuelo ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                Volver a usarlo
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EL FORMULARIO (alta y edición son el mismo)
// ════════════════════════════════════════════════════════════════════════════

interface FormularioProps {
  titulo: string;
  inicial: CamposDelRemitente;
  /**
   * 🔴 **La dirección no se edita: se da de baja el remitente y se crea otro.** Es la
   * identidad del remitente —contra ella se verifica el dominio en SES y contra ella
   * choca el 409— y editarla en la fila haría que la lista dijera una cosa sobre
   * correos que salieron con otra. Es el mismo criterio que la `clave` de un hecho
   * (ADR 0022): se propone al crear y después se congela.
   */
  direccionEditable: boolean;
  dominios: string[] | undefined;
  vendedoraId: string;
  desdeCompat: string | null;
  enVuelo: boolean;
  error: string | null;
  onGuardar: (campos: CamposDelRemitente) => void;
  onCancelar: () => void;
}

function FormularioRemitente(p: FormularioProps) {
  const [campos, setCampos] = useState<CamposDelRemitente>(p.inicial);

  const veredicto = motivoParaNoGuardar(campos, p.dominios, p.enVuelo);

  const campo = (k: keyof CamposDelRemitente) => (e: { target: { value: string } }) =>
    setCampos((c) => ({ ...c, [k]: e.target.value }));

  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <h3 className="truncate font-heading text-xs font-bold text-navy">{p.titulo}</h3>

      <div className="mt-2.5 flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-muted-foreground">Sale desde</span>
          <input
            value={campos.direccion}
            onChange={campo('direccion')}
            disabled={!p.direccionEditable}
            type="email"
            placeholder="ventas@goberna.us"
            className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-sans focus:border-primary focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] disabled:opacity-60"
          />
          {!p.direccionEditable && (
            <span className="text-[10px] leading-snug text-muted-foreground">
              El buzón no se cambia: es la identidad del remitente y lo que ya salió salió con él. Para usar
              otro, dá de baja éste y creá uno nuevo.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-muted-foreground">Nombre que se ve</span>
          <input
            value={campos.nombre}
            onChange={campo('nombre')}
            placeholder="Escuela Goberna"
            className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-200 focus:border-primary focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-muted-foreground">
            Responder a <span className="font-normal">(opcional)</span>
          </span>
          <input
            value={campos.responderA}
            onChange={campo('responderA')}
            type="email"
            placeholder="ventas@grupogoberna.com"
            className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-sans focus:border-primary focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
          />
          {/* Este es el único lugar donde el dominio no verificado está BIEN: SES
              mira de quién sale, no a dónde se contesta. Decirlo acá evita que
              alguien lo copie al campo de arriba «para que sea igual». */}
          <span className="text-[10px] leading-snug text-muted-foreground">
            El respaldo: se usa cuando el usuario de quien escribe no es un buzón. Acá sí vale cualquier
            dominio — SES verifica de quién sale, no a dónde se contesta.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-muted-foreground">
            Firma <span className="font-normal">(opcional)</span>
          </span>
          <textarea
            value={campos.firma}
            onChange={campo('firma')}
            rows={3}
            placeholder={'Escuela de Gobierno y Gestión Pública\ngrupogoberna.com'}
            className="resize-y rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm leading-relaxed outline-none transition-[border-color,box-shadow] duration-200 focus:border-primary focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
          />
        </label>

        <VistaPreviaDelSobre
          campos={campos}
          vendedoraId={p.vendedoraId}
          desdeCompat={p.desdeCompat}
          dominios={p.dominios}
        />

        {p.error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-[11px] leading-snug text-destructive">
            {p.error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              // La MISMA condición que apaga el botón decide acá. Separadas divergen:
              // es textualmente lo que pasó con `⌘↵` en Ivi (#169).
              if (!veredicto.puede) return;
              p.onGuardar(campos);
            }}
            disabled={!veredicto.puede}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground transition-[background-color,transform] duration-200 ease-house hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
          >
            {p.enVuelo && <Loader2 size={12} className="animate-spin" />}
            Guardar
          </button>
          <button
            type="button"
            onClick={p.onCancelar}
            className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Cancelar
          </button>
          {/* El botón apagado dice por qué. Un gris mudo se lee como que la app se colgó. */}
          {!veredicto.puede && (
            <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">{veredicto.motivo}</p>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * EL SOBRE, DIBUJADO CON LO QUE HAY ESCRITO AHORA MISMO.
 *
 * 🔴 **Es lo que reemplaza las dos frases que mintieron durante tres semanas.** El
 * pie del composer decía «con tu nombre» y el placeholder «con tu firma de siempre»,
 * y las dos eran falsas. Una promesa no se puede verificar mirando; un
 * `Luz · Escuela Goberna <escuela@goberna.us>` sí. Por eso esta pantalla **muestra**
 * y no afirma — y por eso el `de` sale de `resumenDelSobre`, la misma función que
 * dibuja el sobre del composer, que a su vez es el gemelo declarado de `armarSobre`
 * del server.
 *
 * ⚠️ **El sobre es el de QUIEN ESTÁ MIRANDO, y se dice.** El `Reply-To` lo gana el
 * correo de la vendedora que escribe (decisión D2 del dueño), así que el mismo
 * remitente le muestra una cosa a `ventas10@grupogoberna.com` y otra a `luz`. Sin
 * ese renglón, una supervisora configura mirando su propio caso y da por hecho que
 * las otras ocho ven lo mismo.
 *
 * ⚠️ **No se dibuja nada hasta que la dirección se lee como un correo.** Con la caja
 * a medias `resumenDelSobre(null, …)` devuelve el sobre de compatibilidad — o sea,
 * enseñaría el remitente VIEJO mientras alguien está creando uno nuevo, que es
 * exactamente la clase de mentira que este bloque vino a matar.
 */
function VistaPreviaDelSobre({
  campos,
  vendedoraId,
  desdeCompat,
  dominios,
}: {
  campos: CamposDelRemitente;
  vendedoraId: string;
  desdeCompat: string | null;
  dominios: string[] | undefined;
}) {
  const direccion = campos.direccion.trim();

  if (!FORMA_DE_CORREO.test(direccion) || !dominioAceptado(direccion, dominios)) {
    return (
      <p className="rounded-lg border border-dashed border-border px-2.5 py-2 text-[10px] leading-snug text-muted-foreground">
        Escribí una dirección de un dominio verificado y acá se dibuja, tal cual, el sobre que va a recibir el
        lead.
      </p>
    );
  }

  const candidato: RemitentePublico = {
    // El id no participa de nada de lo que `resumenDelSobre` decide: acá todavía no
    // hay fila, y ponerle uno real sería inventarlo.
    id: -1,
    direccion,
    nombre: campos.nombre.trim(),
    responderA: limpia(campos.responderA),
    firma: limpia(campos.firma),
  };
  const sobre = resumenDelSobre(candidato, vendedoraId, desdeCompat);

  return (
    <div className="rounded-lg bg-muted/60 px-2.5 py-2">
      <p className={kicker}>Así sale cuando escribís vos</p>
      <dl className="mt-1.5 space-y-1 text-[11px] leading-snug">
        <div className="flex gap-1.5">
          <dt className="w-16 shrink-0 text-muted-foreground">De</dt>
          <dd className="min-w-0 flex-1 break-all font-mono text-foreground">{sobre.de}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="w-16 shrink-0 text-muted-foreground">Responde a</dt>
          <dd className="min-w-0 flex-1 break-all font-mono text-foreground">
            {sobre.respondeA ?? (
              <span className="font-sans text-muted-foreground">
                al mismo buzón por el que salió — nadie en particular
              </span>
            )}
          </dd>
        </div>
        {candidato.firma && (
          <div className="flex gap-1.5">
            <dt className="w-16 shrink-0 text-muted-foreground">Firma</dt>
            <dd className="min-w-0 flex-1 whitespace-pre-wrap text-foreground">{candidato.firma}</dd>
          </div>
        )}
      </dl>
      <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
        A otra vendedora el «responde a» le va a decir otra cosa: gana su propio correo, y el de acá arriba es
        el respaldo.
      </p>
    </div>
  );
}
