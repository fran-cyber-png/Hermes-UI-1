import { useEffect, useState } from 'react';
import { Mail, Phone, Search } from 'lucide-react';
import { fetchLeads } from './api';
import type { Lead } from './types';
import { TEMPERATURE_META, daysSince, temperatureOf } from './temperature';
import { cardClass, cardHeaderClass } from '../../lib/styles';

const PAIS_NOMBRE: Record<string, string> = {
  MX: 'México', GT: 'Guatemala', CL: 'Chile', PE: 'Perú', EC: 'Ecuador',
  BO: 'Bolivia', DO: 'Rep. Dominicana', US: 'Estados Unidos', CO: 'Colombia',
  AR: 'Argentina', ES: 'España', HN: 'Honduras', PA: 'Panamá', SV: 'El Salvador',
};

/** Cuántos se muestran de entrada. Pintar los 680 de una hacía una pantalla de
 *  20.000 píxeles: no es una lista, es un muro. */
const TANDA = 25;

export default function LeadsInbox() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [visibles, setVisibles] = useState(TANDA);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      fetchLeads({ q }).then((d) => {
        setLeads(d.leads);
        setTotal(d.total);
        setVisibles(TANDA); // buscar es empezar de nuevo, no seguir donde ibas
        setLoading(false);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const mostrados = leads.slice(0, visibles);

  return (
    <div className={cardClass}>
      <div className={`${cardHeaderClass} flex items-center justify-between`}>
        <span>Formularios</span>
        <span className="text-xs font-normal text-navy-muted">
          {loading ? 'cargando...' : `${total.toLocaleString('es')} personas`}
        </span>
      </div>

      <div className="border-b border-border p-3">
        <div className="relative max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, correo o campaña..."
            className="w-full rounded-lg border border-border bg-muted py-1.5 pl-8 pr-3 text-sm text-foreground"
          />
        </div>
      </div>

      <div className="divide-y divide-border">
        {mostrados.map((lead) => {
          const temp = temperatureOf(lead.createdTime);
          const meta = TEMPERATURE_META[temp];
          const dias = daysSince(lead.createdTime);
          const perfil = lead.customFields?.['¿cuál_es_tu_cargo?'];

          return (
            <div key={lead.id} className="flex gap-3 p-4 hover:bg-muted/50">
              {/* La banda de temperatura: el estado se lee antes que el texto. */}
              <div className={`w-1 shrink-0 rounded-full ${meta.bar}`} aria-hidden="true" />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-foreground">{lead.fullName ?? 'Sin nombre'}</span>
                  {lead.country && (
                    <span className="text-xs text-muted-foreground">
                      {PAIS_NOMBRE[lead.country] ?? lead.country}
                    </span>
                  )}
                  {perfil && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                      {perfil.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  {lead.email && (
                    <span className="inline-flex items-center gap-1">
                      <Mail size={11} /> {lead.email}
                    </span>
                  )}
                  {lead.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone size={11} /> {lead.phone}
                    </span>
                  )}
                </div>

                <div className="mt-1.5 text-xs text-muted-foreground">
                  {lead.campaignName} · anuncio “{lead.adName}” · {lead.platform === 'ig' ? 'Instagram' : 'Facebook'}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className={`font-heading text-lg font-bold tabular-nums ${meta.text}`}>{dias}d</div>
                <div className={`text-xs font-semibold ${meta.text}`}>{meta.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {!loading && leads.length === 0 && (
        <p className="p-5 text-sm text-muted-foreground">No hay leads que coincidan.</p>
      )}

      {visibles < leads.length && (
        <div className="border-t border-border p-3 text-center">
          <button
            type="button"
            onClick={() => setVisibles((v) => v + TANDA)}
            className="rounded-xl border border-border px-5 py-2 text-xs font-bold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            Ver {Math.min(TANDA, leads.length - visibles)} más
            <span className="ml-1.5 font-normal">
              (quedan {(leads.length - visibles).toLocaleString('es')})
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
