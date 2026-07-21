import { useState } from 'react';
import { useLocalStorage } from '../../lib/useLocalStorage';
import { hace, useFrescura } from '../../lib/datos/frescura';
import type { Intencion, Interaccion } from './types';
import { useBandeja } from './useBandeja';
import { useInvalidarBandeja } from './useInteracciones';
import FilaInteraccion from './FilaInteraccion';
import ResponderPanel from './ResponderPanel';

const FILTROS: { valor: Intencion; label: string; vacio: string }[] = [
  {
    valor: 'puedo-escribirle',
    label: 'Les puedo escribir',
    vacio: 'Nadie tiene la ventana abierta ahora mismo. Estás al día.',
  },
  {
    valor: 'pide-info',
    label: 'Piden información',
    vacio: 'Nadie pidió información todavía.',
  },
  {
    valor: '',
    label: 'Todo',
    vacio: 'No entró nada por ningún canal.',
  },
];

/**
 * Una sola cola, todos los canales mezclados, ordenada por urgencia.
 *
 * El canal es una insignia de color, no una columna: nadie decide a quién
 * responder según por dónde le escribieron. Se responde primero al que se
 * está por vencer, venga de donde venga.
 */
export default function Bandeja() {
  const [intencion, setIntencion] = useLocalStorage<Intencion>(
    'meta-escuela.bandejaFiltro',
    'puedo-escribirle',
  );
  const [abierta, setAbierta] = useState<Interaccion | null>(null);
  const invalidarBandeja = useInvalidarBandeja();

  // `respondida` NO es un estado del cliente: es una derivación de `status`, que el servidor
  // ya persiste y la API ya devuelve. Antes esto era un `useState<number[]>([])` que se vaciaba
  // en cada recarga — respondías, apretabas F5, y el trabajo hecho se volvía invisible.

  const { items, total, hayMas, cargando, cargandoMas, cargarMas } = useBandeja(intencion);
  const filtro = FILTROS.find((f) => f.valor === intencion) ?? FILTROS[0];

  /**
   * El estado vacío NO puede decir "estás al día" si en realidad no estamos mirando.
   *
   * Cero interacciones significa una de dos cosas opuestas: no hay trabajo, o la
   * captura está muerta. Sin este chequeo la pantalla elige siempre la buena, que
   * es justo la que deja al vendedor tranquilo mientras pierde gente.
   */
  const { data: frescura } = useFrescura();
  const vacioPorAtraso = frescura != null && !frescura.fresca && frescura.total > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setIntencion(f.valor)}
              className={
                'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ' +
                (intencion === f.valor
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted')
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        {!cargando && total > 0 && (
          <span className="text-xs font-semibold text-muted-foreground tabular-nums">
            {total.toLocaleString('es')} en total
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {cargando ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">Cargando...</p>
        ) : items.length === 0 ? (
          <div className="px-5 py-12 text-center">
            {vacioPorAtraso ? (
              <>
                <p className="text-sm font-bold text-foreground">
                  No hay nada acá, pero no es porque estés al día.
                </p>
                <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
                  La última captura fue {hace(frescura.horasDesdeIngesta)}. Hay{' '}
                  {frescura.total.toLocaleString('es')} interacciones guardadas, pero ninguna es lo
                  bastante reciente como para entrar en este filtro.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{filtro.vacio}</p>
            )}
          </div>
        ) : (
          items.map((i) => (
            <FilaInteraccion
              key={i.id}
              i={i}
              respondida={i.status !== 'nuevo'}
              onAbrir={setAbierta}
            />
          ))
        )}
      </div>

      {/* Botón explícito, no scroll infinito: en una cola que se termina, saber
          dónde termina es la mitad del punto. */}
      {hayMas && (
        <button
          type="button"
          onClick={cargarMas}
          disabled={cargandoMas}
          className="mx-auto rounded-xl border border-border bg-card px-5 py-2 text-xs font-bold text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
        >
          {cargandoMas ? 'Cargando...' : 'Ver más'}
        </button>
      )}

      <ResponderPanel
        interaccion={abierta}
        onCerrar={() => setAbierta(null)}
        onRespondido={invalidarBandeja}
      />
    </div>
  );
}
