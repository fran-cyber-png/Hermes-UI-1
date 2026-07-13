import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Coins,
  Mail,
  Phone,
  RotateCcw,
  Search,
  Send,
  ShoppingBag,
  User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useBuscarGente, usePersona360, type EventoPersona, type Persona360 } from '../lib/datos/gente';
import Volver from '../layout/Volver';

/**
 * LA GENTE — la persona, a fondo, en una línea de tiempo.
 *
 * El payoff de la matriz: el grafo de identidad junta al cliente de Cerberus con el lead de Meta, y
 * acá se lee su historia entera —qué compró, qué pagó, qué le dijimos a Meta— con inferencias de
 * quién es. Buscás arriba, y la línea de tiempo cuenta el recorrido de esa persona con nosotros.
 */

const TEMP = { fresco: '#16A34A', tibio: '#CAA106', frio: '#C2410C', helado: '#64748B' } as const;
const META_BLUE = '#1877F2';
const GOLD_INK = '#B58900';

const EVENTO: Record<EventoPersona['tipo'], { icono: LucideIcon; color: string }> = {
  compra: { icono: ShoppingBag, color: TEMP.fresco },
  pago: { icono: Coins, color: '#0E2A52' },
  reportado: { icono: Send, color: META_BLUE },
  perdido: { icono: AlertTriangle, color: TEMP.frio },
  reembolso: { icono: RotateCcw, color: TEMP.frio },
};

const TONO: Record<'valor' | 'riesgo' | 'neutro', string> = {
  valor: TEMP.fresco,
  riesgo: TEMP.frio,
  neutro: TEMP.helado,
};

function humano(fecha: string): string {
  const d = new Date(fecha);
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Buscador() {
  const [q, setQ] = useState('');
  const { data } = useBuscarGente(q);
  const nav = useNavigate();

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
        <Search size={16} className="shrink-0 text-navy/40" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar persona por nombre, correo o teléfono..."
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      {data && data.personas.length > 0 && (
        <div className="mt-2 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {data.personas.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => nav(`/gente/${p.id}`)}
              className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-left last:border-0 hover:bg-muted"
            >
              <User size={15} className="shrink-0 text-navy/50" />
              <span className="text-sm font-semibold text-navy">{p.nombre ?? 'Sin nombre'}</span>
              <span className="ml-auto font-mono text-[11px] uppercase tracking-wide text-navy/45">
                {p.detalle}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Ficha360({ p }: { p: Persona360 }) {
  const r = p.resumen;
  return (
    <div className="flex flex-col gap-6">
      {/* Cabecera: quién es, sus contactos, y las inferencias. */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(14,42,82,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-navy/45">
              Persona · {p.id}
            </p>
            <h1 className="mt-1 font-heading text-2xl font-bold text-navy">{p.nombre ?? 'Sin nombre'}</h1>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {p.identidades.map((i) => (
                <span key={i.tipo + i.valor} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {i.tipo === 'email' ? <Mail size={12} /> : <Phone size={12} />}
                  {i.valor}
                </span>
              ))}
              {r.paises.length > 0 && (
                <span className="text-xs text-muted-foreground">· {r.paises.join(', ')}</span>
              )}
            </div>
          </div>
          {/* El LTV: el número que resume el valor de esta persona. En oro.
              Y cuando no se puede medir, lo dice — no lo pinta de $0. Una compra en una moneda sin
              tasa no vale cero: no sabemos cuánto vale, y eso es otra cosa. */}
          <div className="text-right">
            {r.ltvUsd != null ? (
              <p className="font-heading text-3xl font-extrabold tabular-nums" style={{ color: GOLD_INK }}>
                ${r.ltvUsd.toLocaleString('es')}
              </p>
            ) : (
              <p className="font-heading text-2xl font-extrabold text-navy/35">no medible</p>
            )}
            <p className="font-mono text-[10px] uppercase tracking-wide text-navy/45">
              valor de vida · {r.compras} {r.compras === 1 ? 'compra' : 'compras'}
            </p>
          </div>
        </div>

        {p.inferencias.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
            {p.inferencias.map((inf) => (
              <span
                key={inf.texto}
                className="rounded-full border px-3 py-1 text-xs font-semibold"
                style={{ borderColor: `${TONO[inf.tono]}55`, color: TONO[inf.tono], background: `${TONO[inf.tono]}0f` }}
              >
                {inf.texto}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* La línea de tiempo. */}
      <div>
        <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-navy/45">
          La línea de tiempo · {p.timeline.length} momentos
        </p>
        <ol className="flex flex-col">
          {p.timeline.map((e, i) => {
            const cfg = EVENTO[e.tipo];
            const Icono = cfg.icono;
            const ultimo = i === p.timeline.length - 1;
            return (
              <li key={i} className="flex gap-4">
                {/* El riel + el nodo del evento. */}
                <div className="flex flex-col items-center">
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ background: cfg.color }}
                  >
                    <Icono size={15} />
                  </span>
                  {!ultimo && <span className="my-1 w-0.5 flex-1 rounded-full bg-border" />}
                </div>
                {/* El contenido del evento. */}
                <div className={'flex-1 ' + (ultimo ? 'pb-1' : 'pb-6')}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-heading text-sm font-bold text-navy">{e.titulo}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-navy/40">
                      {humano(e.fecha)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{e.detalle}</p>
                  {e.montoUsd != null && (
                    <p className="mt-1 font-heading text-base font-extrabold tabular-nums text-navy">
                      ${Math.round(e.montoUsd).toLocaleString('es')}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
          Los comentarios, reacciones y mensajes de Meta de esta persona se sumarán cuando exista el
          puente de identidad (clic-a-WhatsApp / Cloud API): hoy viven bajo un id de Meta que todavía
          no se puede atar a un comprador.
        </p>
      </div>
    </div>
  );
}

export default function GentePage() {
  const { id } = useParams();
  const { data, isPending } = usePersona360(id ? Number(id) : null);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Volver a={id ? '/gente' : '/'} texto={id ? 'Volver a buscar' : 'Volver al inicio'} />

      {!id && (
        <>
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-navy/45">
              La matriz · gente
            </p>
            <h1 className="mt-1 font-heading text-2xl font-bold text-navy">¿A quién buscamos?</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Cada persona, con todo lo que hizo con nosotros —lo que compró, lo que pagó, lo que le
              dijimos a Meta— en una sola línea de tiempo.
            </p>
          </div>
          <Buscador />
        </>
      )}

      {id && isPending && (
        <p className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          Cargando...
        </p>
      )}
      {id && data && <Ficha360 p={data} />}
      {id && !isPending && !data && (
        <p className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          No encontramos a esa persona. <Link to="/gente" className="font-semibold text-navy underline">Buscar otra</Link>
        </p>
      )}
    </div>
  );
}
