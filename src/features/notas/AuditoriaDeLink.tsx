import { useMemo, useState } from 'react';
import { AlertTriangle, Link2, Link2Off, PenLine, ScrollText, X } from 'lucide-react';
import { useEscape } from '../../lib/teclado/useEscape';
import {
  EVENTOS_DE_LINK,
  cuandoSeLee,
  fraseDeEvento,
  quienSeLee,
  useRegistroDeLink,
  type EventoAnotado,
  type EventoDeLink,
  type ResumenDeLink,
} from './auditoria';

/**
 * EL REGISTRO DE AUDITORÍA DE UN LINK — quién abrió la puerta, quién entró y
 * cuánto (17-ago-2026; molde: el Audit Log de Discord).
 *
 * ══ LO QUE ESTA PANTALLA SE NIEGA A DECIR ═══════════════════════════════════
 *
 * 🔴 **No dice «cuánta gente entró», y no es que falte el número: es que no
 * existe.** Un link público se abre sin sesión, así que dos aperturas pueden ser
 * una persona que recargó o dos personas distintas. Averiguarlo sería fichar a
 * gente que no dio su consentimiento (ver `db/links.ts` en el server).
 *
 * Por eso arriba van **tres cifras separadas** y ninguna se suma con otra:
 * aperturas (exacto) · personas de Goberna (solo las identificadas) · sin cuenta
 * (lo que no se sabe). Colapsarlas daría el número que todo el mundo quiere y que
 * nadie puede sostener — la misma regla de `resultados/medicion.ts`: ninguna cifra
 * se sirve sin decir sobre qué base está contada.
 *
 * ⚠️ **Los números los calcula el SERVER** (`resumirPorLink`). Recalcularlos acá
 * sería la pantalla afirmando «12 aperturas» sobre un server que cuenta otra cosa,
 * y en esta superficie el número ES el producto (#37).
 */

const ICONO: Record<EventoDeLink, typeof Link2> = {
  creado: Link2,
  reconfigurado: PenLine,
  usado: ScrollText,
  cortado: Link2Off,
};

/** Un renglón del registro, con el molde de Discord: ícono · frase · cuándo. */
function Renglon({ evento }: { evento: EventoAnotado }) {
  const { frase, detalle } = fraseDeEvento(evento);
  // Un evento que este front no conoce igual se dibuja: cae en el ícono neutro,
  // nunca en un hueco ni en un throw (ver `fraseDeEvento`).
  const Icono = ICONO[evento.evento] ?? ScrollText;

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
          evento.evento === 'cortado' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
        }`}
      >
        <Icono className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{frase}</span>
        {detalle && <span className="block truncate text-xs text-muted-foreground">{detalle}</span>}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{cuandoSeLee(evento.at)}</span>
    </li>
  );
}

/** Las tres cifras de un link, cada una con lo que de verdad cuenta. */
function Cifras({ link }: { link: ResumenDeLink }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          Link {link.etiqueta}
          {link.cortadoAt && <span className="ml-2 text-xs font-normal text-destructive">cortado</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {link.creadoPor ? `lo creó ${quienSeLee(link.creadoPor)}` : 'creado antes del registro'}
        </p>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2">
        <span>
          <span className="block text-lg font-semibold text-foreground">{link.aperturas}</span>
          <span className="block text-[0.6875rem] text-muted-foreground">aperturas</span>
        </span>
        <span>
          <span className="block text-lg font-semibold text-foreground">{link.personasDeGoberna}</span>
          <span className="block text-[0.6875rem] text-muted-foreground">personas de Goberna</span>
        </span>
        <span>
          {/* ⚠️ NO se rotula «personas»: son aperturas de las que no se sabe quién,
              y presentarlas como gente inventaría un número. */}
          <span className="block text-lg font-semibold text-foreground">{link.anonimas}</span>
          <span className="block text-[0.6875rem] text-muted-foreground">aperturas sin cuenta</span>
        </span>
        {link.reconfiguraciones > 0 && (
          <span>
            <span className="block text-lg font-semibold text-foreground">{link.reconfiguraciones}</span>
            <span className="block text-[0.6875rem] text-muted-foreground">cambios de permisos</span>
          </span>
        )}
      </div>
    </div>
  );
}

const CLASE_FILTRO =
  'h-10 w-full appearance-none rounded-lg border border-input bg-card px-3 pr-9 text-sm text-foreground outline-none transition focus:border-ring';

export function AuditoriaDeLink({ notaId, onCerrar }: { notaId: number; onCerrar: () => void }) {
  const [quien, setQuien] = useState('');
  const [evento, setEvento] = useState('');

  useEscape(onCerrar);
  const registro = useRegistroDeLink(notaId, true);

  /**
   * ⚠️ **El filtro se aplica ACÁ y no se le pide al server.** Es una lista chica
   * que ya está en memoria: mandar un request por cada cambio del desplegable
   * haría parpadear la pantalla y no cambiaría una fila del resultado. Lo que sí
   * viene calculado del server son los NÚMEROS, que es lo que no puede divergir.
   */
  const eventos = useMemo(() => {
    const lista = registro.data?.eventos ?? [];
    const q = quien.trim().toLowerCase();
    return lista
      .filter((e) => {
        if (evento && e.evento !== evento) return false;
        // Una apertura sin cuenta NUNCA cae bajo el filtro de una persona: nadie la hizo.
        if (q && (e.quien === null || e.quien.trim().toLowerCase() !== q)) return false;
        return true;
      })
      .slice()
      .reverse(); // El server sirve del más viejo al más nuevo; acá se lee al revés.
  }, [registro.data, quien, evento]);

  const links = registro.data?.links ?? [];

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-muted"
      role="dialog"
      aria-modal="true"
      aria-label="Registro del link"
    >
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="flex flex-wrap items-end gap-4 border-b border-border pb-5">
          <h2 className="mr-2 shrink-0 font-heading text-sm font-bold text-navy-ink">Registro</h2>

          <label className="min-w-[10rem] flex-1">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Filtrar por persona</span>
            <div className="relative">
              <select value={quien} onChange={(e) => setQuien(e.target.value)} className={CLASE_FILTRO}>
                <option value="">Todas</option>
                {/* 🔴 Las opciones salen del REGISTRO, no de la rueda ni del equipo:
                    el filtro tiene que ofrecer exactamente lo que puede encontrar.
                    Ofrecer a alguien que no hizo nada da una lista vacía que se lee
                    como que el registro está roto. */}
                {(registro.data?.personas ?? []).map((p) => (
                  <option key={p} value={p}>
                    {quienSeLee(p)}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">▾</span>
            </div>
          </label>

          <label className="min-w-[10rem] flex-1">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Filtrar por acción</span>
            <div className="relative">
              <select value={evento} onChange={(e) => setEvento(e.target.value)} className={CLASE_FILTRO}>
                <option value="">Todas</option>
                <option value="creado">Se creó</option>
                <option value="reconfigurado">Cambió de permisos</option>
                <option value="usado">Se abrió</option>
                <option value="cortado">Se cortó</option>
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">▾</span>
            </div>
          </label>

          <div className="flex shrink-0 flex-col items-center">
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar el registro"
              className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-card hover:text-foreground"
            >
              <X className="size-4" />
            </button>
            <span className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">Esc</span>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {registro.isPending && <p className="text-sm text-muted-foreground">Cargando el registro…</p>}

          {registro.isError && (
            <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-destructive">
              No se pudo traer el registro de esta página.
            </p>
          )}

          {/* 🔴 «No se pudo saber» NO es «no pasó nada», y en una superficie de
              auditoría confundirlos es el peor resultado posible: se concluye que
              nadie abrió el link. Por eso el server manda `sinRegistro` y acá se
              dice con todas las letras en vez de dibujar una lista vacía. */}
          {registro.data?.sinRegistro && (
            <p className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                El registro todavía no está activo en este server (falta la migración <code>0029</code>). Lo que ves
                arriba no es «no pasó nada»: es que <strong>no se puede saber</strong>.
              </span>
            </p>
          )}

          {links.map((l) => (
            <Cifras key={l.etiqueta} link={l} />
          ))}

          {registro.data && !registro.data.sinRegistro && eventos.length === 0 && (
            <p className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
              {quien || evento
                ? 'Nada con esos filtros.'
                : 'Todavía no pasó nada con el link de esta página.'}
            </p>
          )}

          {eventos.length > 0 && (
            <ul className="space-y-1.5">
              {eventos.map((e) => (
                <Renglon key={e.id} evento={e} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Lo exporta para el test de paridad con el server. */
export const ACCIONES_QUE_FILTRA = EVENTOS_DE_LINK;
