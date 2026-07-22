import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MessageSquareText, X } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { useConversaciones, type Conversacion } from '../canales/conversaciones';
import { BadgeCanal } from '../canales/BadgeCanal';
import { Intereses } from '../gestion/Intereses';
import { hace } from '../../lib/datos/frescura';

/**
 * EL EMBUDO — kanban real, con las etapas del negocio y sus compuertas.
 *
 *   Interesados → Contactados → Cotizados → Cierre · Perdidos
 *
 * Se ARRASTRA: soltar una tarjeta en otra columna registra la gestión. Pero el
 * embudo no miente: el server valida las compuertas —a Cotizados no se pasa
 * sin un curso de interés registrado (puede tener varios); a Cierre no se pasa
 * declarándolo: se llega REGISTRANDO LA VENTA (y al registrarla, el lead se
 * mueve solo)— y si una compuerta frena, el motivo se muestra acá, en la cara.
 */

const ETAPAS = [
  { id: 'interesado', titulo: 'Interesados', pista: 'Levantaron la mano. Todo lo nuevo cae acá.' },
  { id: 'contactado', titulo: 'Contactados', pista: 'Ya les hablamos.' },
  { id: 'cotizado', titulo: 'Cotizados', pista: 'Compuerta: exige curso de interés.' },
  { id: 'cierre', titulo: 'Cierre', pista: 'Se llega registrando la venta.' },
  { id: 'perdido', titulo: 'Perdidos', pista: 'Se enfrió o dijo que no.' },
] as const;

type Etapa = (typeof ETAPAS)[number]['id'];

function TarjetaEmbudo({
  c,
  onAbrir,
  alArrastrar,
}: {
  c: Conversacion;
  onAbrir: (c: Conversacion) => void;
  alArrastrar: (c: Conversacion) => void;
}) {
  const horas = (Date.now() - new Date(c.referencia).getTime()) / 3_600_000;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        alArrastrar(c);
      }}
      className="group cursor-grab rounded-xl border border-border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgba(14,42,82,0.05)] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-panel active:cursor-grabbing"
    >
      <div className="flex items-center gap-2">
        <BadgeCanal canal={c.canal} />
        <span className="min-w-0 truncate font-heading text-[13px] font-semibold text-foreground">
          {c.persona_nombre ?? c.persona_id ?? 'Sin nombre'}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{hace(horas)}</span>
        <button
          type="button"
          title="Abrir en la Bandeja"
          onClick={() => onAbrir(c)}
          className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-secondary hover:text-navy"
        >
          <MessageSquareText size={13} />
        </button>
      </div>
      {c.texto && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{c.texto}</p>}
      <Intereses clave={c.clave} compacto />
    </div>
  );
}

export function VistaEmbudo({ onAbrir }: { onAbrir: (c: Conversacion) => void }) {
  const qc = useQueryClient();
  const { items, cargando, hayMas, cargandoMas, cargarMas } = useConversaciones('');
  const [arrastrada, setArrastrada] = useState<Conversacion | null>(null);
  const [sobre, setSobre] = useState<Etapa | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const etapas = useQuery({
    queryKey: ['embudo', 'etapas'],
    queryFn: () => api<{ etapas: Record<string, string> }>('/api/gestiones/etapas'),
  });

  const mover = useMutation({
    mutationFn: (v: { c: Conversacion; etapa: Etapa }) =>
      api('/api/gestiones', {
        method: 'POST',
        body: JSON.stringify({
          clave: v.c.clave,
          canal: v.c.canal,
          personaId: v.c.persona_id,
          personaNombre: v.c.persona_nombre,
          numeroPropio: v.c.numero_propio,
          etapa: v.etapa,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['embudo'] });
      void qc.invalidateQueries({ queryKey: ['gestiones'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      setAviso(null);
    },
    onError: (err) => {
      // La compuerta habló: se muestra el motivo tal cual, sin disimular.
      setAviso(err instanceof ErrorApi ? err.message : 'No se pudo mover.');
      window.setTimeout(() => setAviso(null), 8000);
    },
  });

  const porEtapa = useMemo(() => {
    const mapa = new Map<Etapa, Conversacion[]>(ETAPAS.map((e) => [e.id, []]));
    for (const c of items) {
      const declarada = (etapas.data?.etapas[c.clave] ?? 'interesado') as Etapa;
      const etapa = ETAPAS.some((e) => e.id === declarada) ? declarada : 'interesado';
      mapa.get(etapa)!.push(c);
    }
    return mapa;
  }, [items, etapas.data]);

  function soltar(etapa: Etapa) {
    if (!arrastrada) return;
    const actual = (etapas.data?.etapas[arrastrada.clave] ?? 'interesado') as Etapa;
    if (actual !== etapa) mover.mutate({ c: arrastrada, etapa });
    setArrastrada(null);
    setSobre(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2.5 flex shrink-0 items-center gap-3 px-1">
        <p className="text-xs text-muted-foreground">
          Arrastrá para mover. A <b>Cotizados</b> con curso de interés; a <b>Cierre</b>, registrando la venta.
        </p>
        {hayMas && (
          <button
            type="button"
            onClick={cargarMas}
            disabled={cargandoMas}
            className="ml-auto rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
          >
            {cargandoMas ? 'Cargando…' : 'Traer más'}
          </button>
        )}
      </div>

      {aviso && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-gold/50 bg-gold/10 px-3 py-2 text-xs text-gold-ink">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="flex-1">{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} className="shrink-0 hover:text-foreground">
            <X size={13} />
          </button>
        </div>
      )}

      {cargando ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-5 gap-2.5">
          {ETAPAS.map((etapa) => {
            const enEtapa = porEtapa.get(etapa.id) ?? [];
            const esDestino = sobre === etapa.id && arrastrada;
            return (
              <section
                key={etapa.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setSobre(etapa.id);
                }}
                onDragLeave={() => setSobre((s) => (s === etapa.id ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  soltar(etapa.id);
                }}
                className={
                  'flex min-h-0 flex-col rounded-2xl border bg-card/60 p-2 shadow-panel transition-colors ' +
                  (esDestino ? 'border-primary bg-secondary/40' : 'border-border')
                }
              >
                <header className="px-1.5 pb-2 pt-1">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-heading text-[13px] font-bold text-foreground">{etapa.titulo}</h3>
                    <span className="font-mono text-[11px] text-muted-foreground">{enEtapa.length}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{etapa.pista}</p>
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-0.5">
                  {enEtapa.length === 0 ? (
                    <div
                      className={
                        'rounded-xl border border-dashed p-4 text-center text-[11px] text-muted-foreground ' +
                        (esDestino ? 'border-primary' : 'border-border')
                      }
                    >
                      {esDestino ? 'Soltá acá' : 'Vacía'}
                    </div>
                  ) : (
                    enEtapa.map((c) => (
                      <TarjetaEmbudo key={c.clave} c={c} onAbrir={onAbrir} alArrastrar={setArrastrada} />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
