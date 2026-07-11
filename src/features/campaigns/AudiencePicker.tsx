import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Search, Users } from 'lucide-react';
import { API_URL } from '../../config';
import { cardClass, cardHeaderClass } from '../../lib/styles';

export interface Audience {
  id: string;
  name: string;
  subtype: string;
  grupo: string;
  size: number | null;
  listo: boolean;
  sugeridoParaExcluir: boolean;
}

interface Props {
  accountId: string;
  include: string[];
  exclude: string[];
  onChange: (include: string[], exclude: string[]) => void;
}

const fmtSize = (n: number | null) => (n === null ? '—' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export default function AudiencePicker({ accountId, include, exclude, onChange }: Props) {
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    fetch(`${API_URL}/api/audiences?accountId=${accountId}`)
      .then((r) => r.json())
      .then((d) => {
        setAudiences(d.audiences ?? []);
        setLoading(false);
      });
  }, [accountId]);

  const grupos = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtrados = needle
      ? audiences.filter((a) => a.name.toLowerCase().includes(needle))
      : audiences;
    const map = new Map<string, Audience[]>();
    for (const a of filtrados) {
      if (!map.has(a.grupo)) map.set(a.grupo, []);
      map.get(a.grupo)!.push(a);
    }
    return Array.from(map.entries());
  }, [audiences, q]);

  function toggle(id: string, lista: 'include' | 'exclude') {
    const enInclude = include.includes(id);
    const enExclude = exclude.includes(id);

    if (lista === 'include') {
      // Un público no puede estar incluido y excluido a la vez.
      onChange(enInclude ? include.filter((x) => x !== id) : [...include, id], exclude.filter((x) => x !== id));
    } else {
      onChange(include.filter((x) => x !== id), enExclude ? exclude.filter((x) => x !== id) : [...exclude, id]);
    }
  }

  const sugeridos = audiences.filter((a) => a.sugeridoParaExcluir && !exclude.includes(a.id));

  return (
    <div className={cardClass}>
      <div className={`${cardHeaderClass} flex items-center justify-between`}>
        <span className="flex items-center gap-2">
          <Users size={15} /> Públicos
        </span>
        <span className="text-xs font-normal text-navy-muted">
          {include.length} incluidos · {exclude.length} excluidos
        </span>
      </div>

      <div className="p-5">
        {sugeridos.length > 0 && (
          <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <p className="text-xs text-warning">
              <strong>{sugeridos.length} públicos</strong> parecen ser de exclusión por su nombre (gente que ya se
              inscribió o compró). Si no los excluís, le vas a pagar a Meta por mostrarles el anuncio otra vez.
            </p>
            <button
              type="button"
              onClick={() => onChange(include, [...exclude, ...sugeridos.map((a) => a.id)])}
              className="mt-2 text-xs font-bold text-warning underline"
            >
              Excluirlos a todos
            </button>
          </div>
        )}

        <div className="relative mb-3">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Buscar entre ${audiences.length} públicos...`}
            className="w-full rounded-lg border border-border bg-muted py-1.5 pl-8 pr-3 text-sm text-foreground"
          />
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando públicos...</p>
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
            {grupos.map(([grupo, items]) => (
              <div key={grupo}>
                <div className="sticky top-0 bg-muted px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {grupo} · {items.length}
                </div>
                {items.map((a) => {
                  const inc = include.includes(a.id);
                  const exc = exclude.includes(a.id);
                  return (
                    <div
                      key={a.id}
                      className={
                        'flex items-center gap-2 border-b border-border px-3 py-2 last:border-0 ' +
                        (inc ? 'bg-primary/5' : exc ? 'bg-destructive/5' : '')
                      }
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={a.name}>
                        {a.name}
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {fmtSize(a.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggle(a.id, 'include')}
                        title="Incluir"
                        className={
                          'shrink-0 rounded p-1 ' +
                          (inc ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')
                        }
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(a.id, 'exclude')}
                        title="Excluir"
                        className={
                          'shrink-0 rounded p-1 ' +
                          (exc ? 'bg-destructive text-white' : 'text-muted-foreground hover:bg-muted')
                        }
                      >
                        <Minus size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
