import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { OpcionFaceta } from './padron';

/**
 * UN FILTRO DE VARIOS VALORES, con el número al lado de cada opción.
 *
 * ── Por qué el conteo va SIEMPRE, y por qué eso es el filtro ──
 * Sin él, un desplegable de 62 países es una lista de nombres: se tilda
 * «Honduras», aparecen 1.400 y recién ahí se sabe si valía la pena. Con el número
 * la decisión se toma ANTES de tildar, que es la diferencia entre filtrar y
 * tantear. Los conteos los calcula el server sobre el recorte actual: son el
 * MISMO número que el filtro va a devolver, fijado con un test.
 *
 * ── Por qué no es un `<select multiple>` ──
 * El nativo no muestra conteos, no se puede buscar adentro, y en Mac obliga a
 * ⌘+clic para sumar un segundo valor — un gesto que nadie descubre solo. Acá cada
 * opción es una casilla: se tilda, se ve el número, y el desplegable **no se
 * cierra**, porque elegir tres países son tres clics y no tres aperturas.
 */
export function FiltroFaceta({
  rotulo,
  opciones,
  elegidos,
  cargando,
  onAlternar,
  onLimpiar,
}: {
  rotulo: string;
  opciones: OpcionFaceta[];
  elegidos: string[];
  cargando: boolean;
  onAlternar: (valor: string) => void;
  onLimpiar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busca, setBusca] = useState('');
  const caja = useRef<HTMLDivElement>(null);

  // Cerrar al hacer clic afuera y con Escape. El listener vive SOLO mientras está
  // abierto: montado siempre, se comería el Escape del resto de la app (ADR 0024).
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setAbierto(false);
      }
    };
    document.addEventListener('mousedown', afuera);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('mousedown', afuera);
      document.removeEventListener('keydown', escape, true);
    };
  }, [abierto]);

  const n = elegidos.length;
  const filtradas = busca.trim()
    ? opciones.filter((o) => o.valor.toLowerCase().includes(busca.trim().toLowerCase()))
    : opciones;

  // Lo elegido va PRIMERO: con 62 países, tildar «Honduras» y que se quede en el
  // renglón 40 hace imposible saber qué está puesto sin recorrer la lista entera.
  const ordenadas = [
    ...filtradas.filter((o) => elegidos.includes(o.valor)),
    ...filtradas.filter((o) => !elegidos.includes(o.valor)),
  ];

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-normal transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
          n > 0
            ? 'border-navy bg-navy text-white'
            : 'border-border bg-card text-muted-foreground hover:text-foreground'
        }`}
      >
        {rotulo}
        {n > 0 && (
          <span className="rounded-full bg-white/25 px-1.5 text-[11px] font-bold tabular-nums">{n}</span>
        )}
        <ChevronDown size={12} className={abierto ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {abierto && (
        <div className="absolute left-0 z-30 mt-1.5 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-panel">
          {opciones.length > 8 && (
            <div className="border-b border-border p-2">
              <label className="relative block">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input
                  autoFocus
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder={`Buscar en ${rotulo.toLowerCase()}…`}
                  className="w-full rounded-lg bg-muted py-1.5 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
                />
              </label>
            </div>
          )}

          <div className="max-h-64 overflow-y-auto p-1">
            {cargando && opciones.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">Contando…</p>
            ) : ordenadas.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">
                {busca.trim() ? 'Nada con ese nombre.' : 'No queda ninguna opción en este recorte.'}
              </p>
            ) : (
              ordenadas.map((o) => {
                const puesto = elegidos.includes(o.valor);
                return (
                  <button
                    key={o.valor}
                    type="button"
                    onClick={() => onAlternar(o.valor)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        puesto ? 'border-navy bg-navy text-white' : 'border-border'
                      }`}
                    >
                      {puesto && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{o.valor}</span>
                    {/* El número que decide. Es el mismo que el filtro devuelve. */}
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {o.contactos.toLocaleString('es')}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {n > 0 && (
            <button
              type="button"
              onClick={onLimpiar}
              className="flex w-full items-center justify-center gap-1 border-t border-border py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X size={11} /> Quitar {rotulo.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
