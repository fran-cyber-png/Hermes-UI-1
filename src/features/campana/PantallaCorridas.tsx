import { useState } from 'react';
import { AlertTriangle, Clock, Megaphone, Radio, ShieldOff } from 'lucide-react';
import { sectionLabel } from '../../lib/styles';
import {
  enCriollo,
  tasaEsDecidible,
  tonoDeEspera,
  useCorridas,
  useEsperando,
  type ComoVaLaCorrida,
} from './campana';

/**
 * CÓMO VAN LAS CAMPAÑAS — la pantalla.
 *
 * ══ EL ORDEN NO ES TEMÁTICO: ES EL DE LAS PREGUNTAS ═════════════════════════
 *
 * Igual que el panel derecho (ADR 0017), esto se ordena por lo que se pregunta
 * quien lo mira, y en el momento en que lo pregunta:
 *
 *   1. **¿Hay algo mal?** — el aviso, arriba de todo y en rojo. Si no hay, no
 *      se dibuja nada: una franja verde de «todo bien» es ruido permanente.
 *   2. **¿Salió?** — enviados, fallidos, si sigue saliendo.
 *   3. **¿Contestaron?** — con su denominador SIEMPRE al lado.
 *   4. **¿Los están atendiendo?** — la única de las cuatro que ninguna
 *      herramienta de Meta puede contestar, y la que se vuelve urgente
 *      mientras el lote sale.
 *
 * ══ LO QUE ESTA PANTALLA NO DICE, A PROPÓSITO ═══════════════════════════════
 *
 * **No dice «rentabilidad».** El seam de ventas (`resultados/ventas.ts`)
 * devuelve hoy `null` = «no lo sabemos», nunca `false`, porque las ventas no
 * están atadas a la conversación. Un número ahí sería inventado. Cuando ese
 * seam funcione, entra sin rediseñar nada.
 *
 * **No manda nada.** Es la contracara de la frase del padrón: acá se MIRA. Un
 * botón de enviar en esta pantalla sería la puerta por la que la excepción a
 * «un envío = una acción humana» se estira sola.
 */
export function PantallaCorridas() {
  const { data, isPending, isError, error } = useCorridas();
  const [abierta, setAbierta] = useState<string | null>(null);

  if (isPending) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    /**
     * ⚠️ Un 403 NO es «no hay campañas». Son dos cosas distintas y se ven igual
     * si se dibuja una lista vacía: la cicatriz de ADR 0023.
     */
    const esPermiso = (error as { status?: number })?.status === 403;
    return (
      <Aviso
        tono={esPermiso ? 'aviso' : 'error'}
        titulo={esPermiso ? 'Las campañas las mira un supervisor' : 'No se pudieron leer las campañas'}
        detalle={
          esPermiso
            ? 'Tu usuario no está en la lista de supervisores. No es que no haya campañas: es que esta pantalla no es para vos.'
            : error instanceof Error
              ? error.message
              : 'El server no respondió.'
        }
      />
    );
  }

  const corridas = data.corridas;
  if (corridas.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-12 text-center">
        <Megaphone size={26} className="text-muted-foreground/40" />
        <p className="max-w-sm text-sm text-muted-foreground">
          No salió ninguna campaña en los últimos 30 días.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      {corridas.map((c) => (
        <Corrida
          key={c.pieza}
          c={c}
          abierta={abierta === c.pieza}
          onAbrir={() => setAbierta(abierta === c.pieza ? null : c.pieza)}
        />
      ))}
    </div>
  );
}

function Corrida({ c, abierta, onAbrir }: { c: ComoVaLaCorrida; abierta: boolean; onAbrir: () => void }) {
  const tono = tonoDeEspera(c.masViejaSinAtenderMin);

  return (
    <section className="rounded-2xl border border-border bg-card">
      {/* ── Cabecera: qué campaña, y si sigue saliendo ── */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Megaphone size={15} className="shrink-0 text-navy" />
        <h3 className="font-heading text-sm font-bold text-foreground">{c.pieza}</h3>
        {c.enCurso && (
          /* Verde y con el ícono latiendo: «esto está pasando AHORA». Sin oro —
             el oro es tiempo que se acaba, y acá no se acaba nada. */
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success">
            <Radio size={11} className="animate-pulse" /> saliendo
          </span>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {c.empezo ? new Date(c.empezo).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
        </span>
      </header>

      {/* ── 1 · ¿Hay algo mal? Solo si lo hay. ── */}
      {c.aviso && (
        <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p className="font-semibold">{c.aviso}</p>
        </div>
      )}

      {/* ── 2 y 3 · Salió · Contestaron ── */}
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        <Cifra rotulo="Enviados" valor={String(c.enviados)} />
        <Cifra
          rotulo="Fallidos"
          valor={String(c.fallidos)}
          tenue={c.fallidos === 0}
        />
        <Cifra
          rotulo="Respondieron"
          valor={`${c.respondieron.n}`}
          /* El denominador va SIEMPRE: una tasa sin `n` no se puede leer —
             2/3 (67 %) no le gana a 180/400 (45 %). */
          pie={`de ${c.respondieron.de} · ${c.respondieron.pct}%`}
          nota={tasaEsDecidible(c.respondieron) ? null : 'muestra chica'}
        />
        <Cifra
          rotulo="Sin atender"
          valor={`${c.sinAtender.n}`}
          pie={`de ${c.sinAtender.de} que contestaron`}
          tono={c.sinAtender.n > 0 ? tono : 'bien'}
        />
      </div>

      {/* ── Los detalles que solo importan si algo pasa ── */}
      <div className="space-y-2 px-4 py-3">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {c.medianaRespuestaMin !== null && (
            <span>
              contestan en <strong className="text-foreground">{enCriollo(c.medianaRespuestaMin)}</strong> (mediana)
            </span>
          )}
          {c.enLaPrimeraHora > 0 && <span>{c.enLaPrimeraHora} en la primera hora</span>}
          {/*
            SE DICEN, NO SE ESCONDEN. Quien mira tiene que poder enterarse de
            que hay NEGOCIOS en la lista: es el dato con el que se arma mejor
            la próxima campaña. Escondiéndolos del todo, «628 enviados, 5
            respondieron» no dejaría rastro de por qué la tasa es tan baja.
          */}
          {c.autoRespuestas > 0 && (
            <span title="Son el saludo automático del WhatsApp Business de otra empresa: la lista tiene números de negocios, no de personas.">
              🤖 {c.autoRespuestas} contestador{c.autoRespuestas > 1 ? 'es' : ''} de otra empresa
            </span>
          )}
          {c.masViejaSinAtenderMin !== null && (
            <span className={tono === 'mal' ? 'font-bold text-destructive' : ''}>
              <Clock size={11} className="mr-1 inline" />
              la más vieja espera {enCriollo(c.masViejaSinAtenderMin)}
            </span>
          )}
        </p>

        {c.fallosPorMotivo.length > 0 && (
          <ul className="space-y-0.5 text-xs">
            {c.fallosPorMotivo.map((f) => (
              <li
                key={f.motivo}
                className={f.motivo.startsWith('🔴') ? 'font-semibold text-destructive' : 'text-muted-foreground'}
              >
                {f.n} · {f.motivo}
              </li>
            ))}
          </ul>
        )}

        {c.porDuena.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {c.porDuena.map((d) => (
              <span
                key={d.duena}
                className="inline-flex items-center gap-1 rounded-full bg-navy/10 px-2.5 py-0.5 text-[11px] font-semibold text-navy"
                title={`${d.enviados} enviados · ${d.respondieron} respondieron · ${d.sinAtender} sin atender`}
              >
                {nombreCorto(d.duena)}
                <span className="tabular-nums opacity-70">{d.enviados}</span>
                {d.sinAtender > 0 && (
                  <span className="rounded-full bg-destructive/15 px-1 tabular-nums text-destructive">
                    {d.sinAtender}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}

        {c.sinAtender.n > 0 && (
          <button
            type="button"
            onClick={onAbrir}
            className="text-xs font-bold text-navy underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {abierta ? 'Ocultar' : `Ver quiénes esperan (${c.sinAtender.n}) →`}
          </button>
        )}
      </div>

      {abierta && <Esperando pieza={c.pieza} />}
    </section>
  );
}

/**
 * QUIÉNES ESPERAN — con el TEXTO de lo que dijeron.
 *
 * Sin el texto esto es una columna de teléfonos que hay que abrir de a uno para
 * saber cuál urge. «Quiero el paquete» y «ok» no valen lo mismo, y esa
 * diferencia es toda la utilidad de la lista.
 */
function Esperando({ pieza }: { pieza: string }) {
  const { data, isPending, isError } = useEsperando(pieza);

  if (isPending) return <div className="m-4 h-20 animate-pulse rounded-xl bg-muted" />;
  if (isError) {
    return (
      <p className="border-t border-border px-4 py-3 text-xs text-destructive">
        No se pudo leer quiénes esperan.
      </p>
    );
  }
  if (data.esperando.length === 0) {
    return (
      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        Ya los atendieron a todos.
      </p>
    );
  }

  return (
    <ul className="border-t border-border">
      {data.esperando.map((e) => (
        <li key={e.telefono} className="flex items-start gap-3 border-b border-border/60 px-4 py-2 last:border-b-0">
          <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {e.telefono}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={e.texto ?? ''}>
            {e.texto || <span className="italic text-muted-foreground">(sin texto)</span>}
          </span>
          <span
            className={`shrink-0 text-[11px] tabular-nums ${
              e.minutosEsperando > 60 ? 'font-bold text-destructive' : 'text-muted-foreground'
            }`}
          >
            {enCriollo(e.minutosEsperando)}
          </span>
          {e.duena && (
            <span className="w-20 shrink-0 truncate text-right text-[11px] text-muted-foreground">
              {nombreCorto(e.duena)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Cifra({
  rotulo,
  valor,
  pie,
  nota,
  tono = 'bien',
  tenue = false,
}: {
  rotulo: string;
  valor: string;
  pie?: string;
  nota?: string | null;
  tono?: 'bien' | 'aviso' | 'mal';
  tenue?: boolean;
}) {
  const tinta =
    tono === 'mal' ? 'text-destructive' : tono === 'aviso' ? 'text-warning-foreground' : tenue ? 'text-muted-foreground' : 'text-foreground';
  return (
    <div className="bg-card px-4 py-3">
      <p className={sectionLabel}>{rotulo}</p>
      <p className={`font-heading text-2xl font-bold tabular-nums ${tinta}`}>{valor}</p>
      {pie && <p className="text-[11px] tabular-nums text-muted-foreground">{pie}</p>}
      {nota && <p className="text-[11px] italic text-muted-foreground">{nota}</p>}
    </div>
  );
}

/** `ventas10@grupogoberna.com` → `Ventas10`. El correo entero no entra en un chip. */
function nombreCorto(id: string): string {
  const base = id.split('@')[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function Aviso({ tono, titulo, detalle }: { tono: 'error' | 'aviso'; titulo: string; detalle: string }) {
  const tinta =
    tono === 'error'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : 'border-warning/40 bg-warning/10 text-warning-foreground';
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center p-8">
      <div className={`flex max-w-md items-start gap-2.5 rounded-2xl border p-4 text-sm ${tinta}`}>
        {tono === 'error' ? (
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        ) : (
          <ShieldOff size={16} className="mt-0.5 shrink-0" />
        )}
        <div>
          <p className="font-bold">{titulo}</p>
          <p className="mt-1 text-xs leading-relaxed opacity-90">{detalle}</p>
        </div>
      </div>
    </div>
  );
}
