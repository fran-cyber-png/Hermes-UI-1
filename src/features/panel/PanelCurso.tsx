import { useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { sectionLabel } from '../../lib/styles';
import { Intereses } from '../gestion/Intereses';
import { useFamiliasCurso } from '../plantillas/plantillas';

/**
 * LA PESTAÑA «CURSO» — qué le interesa y qué se vende hoy, sin salir del chat.
 *
 * Dos cosas, y las dos honestas sobre su alcance:
 *
 *   1. **Le interesa** — la línea de tiempo del interés (#57), la misma que ya
 *      estaba en la ficha. Es lo que la vendedora anotó.
 *   2. **Los cursos** — UNA fila por diploma con su última edición (#129), no
 *      cinco «Diploma de Especializaci…» truncadas e indistinguibles. Sale del
 *      catálogo vivo de Cerberus.
 *
 * Lo que NO hay todavía: temario, docentes, fechas y cronograma. Eso es el
 * issue #51 (ingesta del endpoint rico de Cerberus) y **este panel lo dice** en
 * vez de disimularlo con una sección vacía.
 */

export function PanelCurso({ clave }: { clave: string }) {
  const [q, setQ] = useState('');
  const { data, isPending, isError } = useFamiliasCurso(true);

  const familias = (data?.familias ?? []).filter((f) =>
    f.nombre.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={sectionLabel}>Le interesa</div>
      <div className="mt-1.5">
        <Intereses clave={clave} compacto />
      </div>

      <div className={'mt-4 ' + sectionLabel}>Lo que se vende hoy</div>
      <label className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5">
        <Search size={12} className="shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar un diploma…"
          className="w-full bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
        />
      </label>

      <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <div className="space-y-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : isError ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-[11px] leading-relaxed text-warning-foreground">
            El catálogo de Cerberus no respondió. No es que no haya cursos: es que la lista no cargó.
          </p>
        ) : familias.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-muted-foreground">
            {q ? 'Ningún diploma coincide.' : 'El catálogo vino vacío.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {familias.map((f) => (
              <li key={f.familia} className="rounded-lg border border-border bg-card px-2 py-1.5">
                <div className="flex items-start gap-1.5">
                  <BookOpen size={11} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold leading-snug text-foreground">{f.nombre}</div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                      <span>{f.ultimaEdicionSku}</span>
                      {f.ediciones > 1 && <span>{f.ediciones} ediciones</span>}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-2 shrink-0 border-t border-border pt-2 text-[10px] leading-snug text-muted-foreground">
        El temario, los docentes y las fechas todavía no están acá: hace falta ingerir el endpoint
        rico de Cerberus (issue #51). Preferimos el hueco declarado al invento.
      </p>
    </div>
  );
}
