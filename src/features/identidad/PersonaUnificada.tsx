import { useState } from 'react';
import { BadgeCheck, Link2, Loader2, Unlink } from 'lucide-react';
import { fechaCorta } from '../../lib/formato';
import { sectionLabel } from '../../lib/styles';
import { BadgeCanal, nombreCanal } from '../../components/BadgeCanal';
import { useFicha } from '../cerberus/useFicha';
import { BuscadorContactos } from './BuscadorContactos';
import { etiquetaDeOrigen } from './etiquetaOrigen';
import { useDeshacerEnlace, useUnificado, type OrigenUnificado } from './enlaces';

/**
 * LA MISMA PERSONA — el bloque de la ficha unificada (issue #58, ADR 0017).
 *
 * «A veces hablás con la misma persona pero te escribe de otro número.» Acá la vendedora lo
 * dice y la ficha se une: los intereses, las gestiones y las compras del otro contacto
 * aparecen en esta ficha, cada uno diciendo DE DÓNDE salió.
 *
 * Lo que este bloque NO hace, y por eso no confunde: no toca los chats. La conversación de
 * WhatsApp y la de Instagram siguen siendo dos hilos en la cola. Se unifica la ficha —
 * quién es esta persona— y nada más.
 *
 * Un solo archivo, colgado con UNA línea de `FichaContacto` y otra de `PanelContexto`: la
 * ficha se está tocando en varios frentes a la vez y este cambio tiene que poder mergearse
 * sin pelear con ninguno.
 */

export function PersonaUnificada({
  clave,
  nombreActual,
}: {
  clave: string;
  /** Cómo se llama el contacto de ESTA ficha — para que la confirmación diga a quién une. */
  nombreActual: string;
}) {
  const [buscando, setBuscando] = useState(false);
  const { data, isPending } = useUnificado(clave);
  const deshacer = useDeshacerEnlace(clave);

  // Un comentario suelto no identifica a nadie: no hay a qué enlazarlo, y decirlo con un
  // botón que rebota sería peor que no mostrarlo.
  if (!clave.startsWith('conv:')) return null;

  const origenes = data?.origenes ?? [];

  return (
    <div className="mt-5">
      <div className={sectionLabel}>La misma persona</div>

      {isPending ? (
        <div className="mt-2 h-9 animate-pulse rounded-xl bg-muted" />
      ) : origenes.length === 0 ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Si esta persona también te escribe desde otro número o desde otra red, uní las dos fichas.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {origenes.map((o) => (
            <Origen
              key={o.identidad}
              origen={o}
              deshaciendo={deshacer.isPending && deshacer.variables === (o.claves[0] ?? '')}
              onDeshacer={() => o.claves[0] && deshacer.mutate(o.claves[0])}
            />
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setBuscando(true)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-xs font-bold text-foreground transition-colors duration-200 ease-house hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Link2 size={13} /> Es la misma persona que…
      </button>

      {deshacer.isError && (
        <p className="mt-1.5 text-[11px] text-destructive">No se pudo deshacer — probá de nuevo.</p>
      )}

      {buscando && (
        <BuscadorContactos
          clave={clave}
          nombreActual={nombreActual}
          yaEnlazadas={origenes.flatMap((o) => o.claves)}
          onCerrar={() => setBuscando(false)}
        />
      )}
    </div>
  );
}

/**
 * Un contacto unido, con TODO lo que aporta y de dónde viene.
 *
 * El origen no es decoración: es la única forma de auditar una ficha unificada. Si mañana
 * aparece un interés que nadie pidió por este chat, tiene que poder leerse de un vistazo que
 * vino «de +51 987 654 321».
 */
function Origen({
  origen,
  deshaciendo,
  onDeshacer,
}: {
  origen: OrigenUnificado;
  deshaciendo: boolean;
  onDeshacer: () => void;
}) {
  // Las compras salen de la MISMA ficha de Cerberus que ya usa el panel, pedida por el
  // teléfono del otro contacto. Una sola fuente de verdad para «cuánto compró».
  const esTelefono = origen.canal === 'whatsapp';
  const { data: ficha } = useFicha(esTelefono ? origen.personaId : null, esTelefono);
  const compras = ficha?.estado === 'cliente' ? ficha.ventasCount : null;

  return (
    <li className="rounded-xl border border-border bg-muted/40 p-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          <BadgeCanal canal={origen.canal} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold text-foreground">
            {origen.nombre ?? etiquetaDeOrigen(origen.canal, origen.personaId, null)}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            de {etiquetaDeOrigen(origen.canal, origen.personaId, origen.nombre)} · {nombreCanal(origen.canal)}
          </div>
        </div>
        <button
          type="button"
          onClick={onDeshacer}
          disabled={deshaciendo}
          title="Deshacer el enlace"
          aria-label={`Deshacer el enlace con ${origen.nombre ?? origen.personaId}`}
          className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-card hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
        >
          {deshaciendo ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />}
        </button>
      </div>

      {/* Lo que ese origen aporta a esta ficha. Si no aporta nada, no se dibuja un hueco. */}
      {(origen.intereses.length > 0 || origen.gestiones > 0 || compras) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {compras ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success">
              <BadgeCheck size={11} /> {compras} {compras === 1 ? 'compra' : 'compras'}
            </span>
          ) : null}
          {origen.intereses.map((curso) => (
            <span
              key={curso}
              className="max-w-full truncate rounded-full bg-card px-2 py-0.5 text-[11px] text-foreground ring-1 ring-border"
            >
              {curso}
            </span>
          ))}
          {origen.gestiones > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {origen.gestiones} {origen.gestiones === 1 ? 'gestión' : 'gestiones'}
              {origen.ultimaEtapa ? ` · ${origen.ultimaEtapa}` : ''}
            </span>
          )}
        </div>
      )}

      <p className="mt-1 text-[10px] text-muted-foreground">
        Unida el {fechaCorta(origen.enlazadoAt)} por {origen.enlazadoPor.replace('operador:', '')}
      </p>
    </li>
  );
}
