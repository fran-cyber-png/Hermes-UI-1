import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bot, CornerDownLeft, RotateCcw, ShieldCheck, User } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { useLineas } from '../canales/lineas';
import { PanelCorridas } from './PanelCorridas';
import { PanelLecciones } from './PanelLecciones';
import {
  lecturaDeSilencio,
  motivoParaNoProbar,
  type DetalleDeRespuesta,
  type TurnoDePrueba,
} from './entrenamiento';

/**
 * LA VISTA DE ENTRENAMIENTO — donde se mira trabajar al bot sin gastar pauta (#256).
 *
 * ══ POR QUÉ EXISTE ═══════════════════════════════════════════════════════════
 *
 * Los adsets del bot se pausaron porque sus respuestas eran inestables, y para
 * verificar cualquier arreglo había que volver a exponer tráfico pagado. Este es
 * el primer lugar donde se lo puede ver responder sin que nadie del otro lado
 * reciba nada.
 *
 * Es el tracer bullet de la épica (#253): la vista y el chat. El Replay sobre
 * conversaciones reales, el embudo y el catálogo cuelgan de acá después.
 *
 * ══ LO QUE SE VE, Y POR QUÉ NO ES SOLO EL TEXTO ══════════════════════════════
 *
 * Cada respuesta viene con lo que el bot DECIDIÓ: a qué estado llevó la
 * conversación y qué acciones pidió. Sin eso, «el bot contestó bien» es una
 * impresión: el turno donde registra el interés y el turno donde escala se ven
 * igual de amables y son cosas muy distintas.
 *
 * Y cuando NO habla, eso también se muestra —con su motivo— en vez de quedar en
 * blanco: el silencio es exactamente lo que una persona real habría recibido, y
 * dibujarlo como error mandaría a buscar el problema al lado equivocado.
 */
export function VistaEntrenamiento() {
  const { lineas } = useLineas();
  const [linea, setLinea] = useState<string | null>(null);
  // Dos formas de la misma pregunta: el chat explora lo que TODAVÍA no pasó, el
  // Replay mide sobre lo que ya pasó. Conmutadas por estado, sin router, como
  // todo en esta app (ADR 0002).
  const [pestana, setPestana] = useState<'chat' | 'corridas' | 'lecciones'>('chat');
  const [turnos, setTurnos] = useState<TurnoDePrueba[]>([]);
  const [borrador, setBorrador] = useState('');
  const finRef = useRef<HTMLDivElement>(null);
  const cajaRef = useRef<HTMLTextAreaElement>(null);

  // La primera línea disponible, apenas se sepan cuáles hay. Sin esto la
  // pantalla arranca sin poder probar y no dice por qué.
  useEffect(() => {
    if (!linea && lineas.length > 0) setLinea(lineas[0]!.numero);
  }, [lineas, linea]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turnos]);

  const probar = useMutation({
    mutationFn: (mensaje: string) =>
      api<{ ok: boolean; respuesta: DetalleDeRespuesta & { texto: string | null } }>(
        '/api/entrenamiento/probar',
        {
          method: 'POST',
          body: JSON.stringify({
            mensaje,
            numeroPropio: linea,
            // El hilo se manda entero: del lado del server la conversación no
            // existe en ninguna tabla, así que esto ES el historial.
            historial: turnos.map((t) => ({ de: t.de, texto: t.texto })),
          }),
        },
      ),
    onSuccess: (r) => {
      setTurnos((previos) => [
        ...previos,
        {
          de: 'bot',
          texto: r.respuesta.texto ?? '',
          detalle: r.respuesta,
        },
      ]);
    },
  });

  const motivoBloqueo = motivoParaNoProbar({
    mensaje: borrador,
    esperando: probar.isPending,
    linea,
  });

  function mandar() {
    if (motivoBloqueo) return;
    const texto = borrador.trim();
    setTurnos((previos) => [...previos, { de: 'persona', texto }]);
    setBorrador('');
    probar.mutate(texto);
  }

  const errorApi = probar.error instanceof ErrorApi ? probar.error : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">Entrenamiento del bot</h1>
          <p className="text-sm text-muted-foreground">
            Escribile como si fueras una persona y mirá qué contesta.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Línea</span>
          <select
            value={linea ?? ''}
            onChange={(e) => setLinea(e.target.value || null)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            {lineas.length === 0 && <option value="">(no hay líneas)</option>}
            {lineas.map((l) => (
              <option key={l.numero} value={l.numero}>
                {l.etiqueta}
              </option>
            ))}
          </select>
        </label>

        {pestana === 'chat' && (
          <button
            type="button"
            onClick={() => {
              setTurnos([]);
              probar.reset();
              cajaRef.current?.focus();
            }}
            disabled={turnos.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Empezar de nuevo
          </button>
        )}
      </header>

      <nav className="flex gap-1 border-b border-border px-6">
        {(
          [
            ['chat', 'Chat de prueba'],
            ['corridas', 'Corridas sobre conversaciones reales'],
            ['lecciones', 'Lecciones'],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPestana(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              pestana === id
                ? 'border-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {pestana === 'corridas' && <PanelCorridas linea={linea} />}
      {pestana === 'lecciones' && <PanelLecciones />}

      {pestana === 'chat' && (
        <>
      {/*
        La garantía se dice en pantalla, no solo en el código. Quien prueba tiene
        que poder confiar en que esto no le llega a nadie — si tiene que
        preguntarlo, no lo usa con una objeción real.
      */}
      <p className="flex items-center gap-2 border-b border-border bg-muted/40 px-6 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        Esta conversación no le llega a nadie: el motor corre sin transporte, así que no hay a dónde
        mandar. Tampoco entra al historial con el que se mide al bot.
      </p>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {turnos.length === 0 && (
          <p className="mx-auto max-w-md pt-10 text-center text-sm text-muted-foreground">
            Probá con lo que escribe una persona de verdad: «Hola quiero más información», «cuánto
            cuesta», «¿es presencial?». También sirve para las difíciles — una objeción que todavía
            nadie hizo no está en ninguna conversación pasada.
          </p>
        )}

        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {turnos.map((t, i) => (
            <Burbuja key={i} turno={t} />
          ))}

          {probar.isPending && (
            <p className="text-sm text-muted-foreground">Pensando…</p>
          )}

          {errorApi && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              {errorApi.message}
            </p>
          )}

          <div ref={finRef} />
        </div>
      </div>

      <div className="border-t border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <textarea
            ref={cajaRef}
            value={borrador}
            onChange={(e) => setBorrador(e.target.value)}
            onKeyDown={(e) => {
              // El acorde y el botón consultan la MISMA función: separados
              // divergen, y el acorde termina saltándose el tope (ADR 0024).
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                mandar();
              }
            }}
            rows={2}
            placeholder="Escribí como si fueras la persona…"
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{motivoBloqueo ?? '⌘↵ para mandar'}</span>
            <button
              type="button"
              onClick={mandar}
              disabled={motivoBloqueo !== null}
              className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              Mandar
              <CornerDownLeft className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function Burbuja({ turno }: { turno: TurnoDePrueba }) {
  const esPersona = turno.de === 'persona';
  const sinTexto = !esPersona && turno.texto.trim() === '';

  return (
    <div className={esPersona ? 'flex justify-end' : 'flex justify-start'}>
      <div className={esPersona ? 'max-w-[80%]' : 'max-w-[85%]'}>
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          {esPersona ? <User className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
          {esPersona ? 'La persona' : 'El bot'}
        </div>

        {sinTexto ? (
          // No habló. Se dibuja como información, NO como error: es exactamente
          // lo que una persona real habría recibido, y es lo que hay que mirar.
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            {lecturaDeSilencio(turno.detalle!)}
          </p>
        ) : (
          <p
            className={
              esPersona
                ? 'whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                : 'whitespace-pre-wrap rounded-lg border border-border bg-card px-3 py-2 text-sm'
            }
          >
            {turno.texto}
          </p>
        )}

        {turno.detalle && <Decidio detalle={turno.detalle} />}
      </div>
    </div>
  );
}

/**
 * Lo que el bot decidió además de hablar. Va debajo y en tono menor: el texto es
 * lo que la persona ve, esto es por qué lo dijo.
 */
function Decidio({ detalle }: { detalle: DetalleDeRespuesta }) {
  const acciones = Array.isArray(detalle.acciones) ? detalle.acciones : [];
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="rounded border border-border px-1.5 py-0.5">{detalle.estado}</span>
      {acciones.map((a, i) => {
        const tipo = (a as { tipo?: string })?.tipo ?? 'acción';
        const extra =
          (a as { motivo?: string; familia?: string; id?: string })?.motivo ??
          (a as { familia?: string })?.familia ??
          (a as { id?: string })?.id;
        return (
          <span key={i} className="rounded bg-muted px-1.5 py-0.5">
            {tipo}
            {extra ? ` · ${extra}` : ''}
          </span>
        );
      })}
      {detalle.tokensSalida !== null && (
        <span className="ml-auto tabular-nums">
          {detalle.tokensEntrada ?? 0}→{detalle.tokensSalida} tok
        </span>
      )}
    </div>
  );
}
