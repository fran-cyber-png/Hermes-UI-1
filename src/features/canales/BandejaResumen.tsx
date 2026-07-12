import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Clock } from 'lucide-react';
import type { CanalesResponse, Interaccion } from './types';
import { useBandeja } from './useBandeja';
import { useInvalidarBandeja } from './useInteracciones';
import ResponderPanel from './ResponderPanel';

const COLOR: Record<string, string> = {
  facebook: '#1877F2',
  instagram: '#C13584',
  whatsapp: '#25D366',
};

/** Cuántas se asoman. Lo justo para saber si hay que entrar. */
const ASOMO = 4;

/**
 * El monitor de la bandeja, al costado del dashboard.
 *
 * Contesta tres cosas de un vistazo: a cuántos les puedes escribir hoy, si se
 * están respondiendo, y si sigue entrando gente. No trae filtros ni scroll — el
 * home no es donde trabajas, es donde te enteras de que hay trabajo. Para
 * trabajar se entra a la bandeja completa.
 *
 * Responder desde aquí igual se puede: obligarte a cambiar de pantalla para
 * contestar dos comentarios sería ceremonia sin motivo.
 */
export default function BandejaResumen({ estado }: { estado: CanalesResponse | null }) {
  const [abierta, setAbierta] = useState<Interaccion | null>(null);
  const invalidarBandeja = useInvalidarBandeja();

  // `respondida` NO es un estado del cliente: es una derivación de `status`, que el servidor
  // ya persiste y la API ya devuelve. Antes esto era un `useState<number[]>([])` que se vaciaba
  // en cada recarga — respondías, apretabas F5, y el trabajo hecho se volvía invisible.

  const { items, total, cargando } = useBandeja('puedo-escribirle');
  const asomo = items.slice(0, ASOMO);
  const restantes = total - asomo.length;

  const canales = estado?.interacciones ?? [];
  const entraron = canales.reduce((s, c) => s + c.total, 0);
  const sinAtender = canales.reduce((s, c) => s + c.sin_atender, 0);
  const atendidas = entraron - sinAtender;

  return (
    <aside className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* La cifra que manda: a cuántos les corre el reloj. */}
      <div className="bg-navy px-5 py-5 text-white">
        {cargando ? (
          <p className="text-sm text-navy-muted">Cargando...</p>
        ) : total === 0 ? (
          <div className="flex items-start gap-2.5">
            <Check size={17} className="mt-0.5 shrink-0 text-success" />
            <div>
              <p className="font-heading text-lg font-extrabold">Estás al día</p>
              <p className="mt-0.5 text-xs text-navy-muted">
                Nadie tiene la ventana abierta ahora mismo.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="font-heading text-4xl font-extrabold tabular-nums text-gold">
                {total}
              </span>
              <span className="text-sm font-semibold">
                {total === 1 ? 'espera' : 'esperan'} respuesta
              </span>
            </div>
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-navy-muted">
              <Clock size={11} />
              Meta cierra el privado a los 7 días.
            </p>
          </>
        )}
      </div>

      {/* Si están llegando, y si se están respondiendo. */}
      <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
        <div className="px-5 py-3">
          <p className="font-heading text-lg font-extrabold tabular-nums text-foreground">
            {entraron.toLocaleString('es')}
          </p>
          <p className="text-xs text-muted-foreground">entraron</p>
        </div>
        <div className="px-5 py-3">
          <p
            className={
              'font-heading text-lg font-extrabold tabular-nums ' +
              (atendidas > 0 ? 'text-success' : 'text-destructive')
            }
          >
            {atendidas.toLocaleString('es')}
          </p>
          <p className="text-xs text-muted-foreground">
            {atendidas === 1 ? 'respondida' : 'respondidas'}
          </p>
        </div>
      </div>

      <div className="flex-1">
        {asomo.length === 0 && !cargando ? (
          <p className="px-5 py-8 text-center text-xs text-muted-foreground">
            Cuando alguien comente, aparece aquí con el reloj corriendo.
          </p>
        ) : (
          asomo.map((i) => {
            const restan = 7 - i.dias;
            const respondida = i.status !== 'nuevo';

            return (
              <button
                key={i.id}
                type="button"
                onClick={() => setAbierta(i)}
                className={
                  'flex w-full flex-col gap-1 border-b border-border px-5 py-3 text-left transition-colors last:border-b-0 ' +
                  (respondida ? 'bg-success/5' : 'hover:bg-muted/50')
                }
              >
                <div className="flex items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: COLOR[i.canal] ?? '#94A3B8' }}
                  />
                  <span className="text-xs font-bold text-gold-ink">
                    {restan <= 1 ? 'último día' : `quedan ${restan} días`}
                  </span>
                  {respondida && (
                    <span className="ml-auto inline-flex items-center gap-0.5 text-xs font-bold text-success">
                      <Check size={11} />
                      Lista
                    </span>
                  )}
                </div>
                <p
                  className={
                    'line-clamp-2 text-sm ' +
                    (i.pide_info ? 'font-semibold text-foreground' : 'text-muted-foreground')
                  }
                >
                  {i.texto || '(sin texto)'}
                </p>
              </button>
            );
          })
        )}
      </div>

      <Link
        to="/bandeja"
        className="flex items-center justify-center gap-1.5 border-t border-border bg-muted/40 px-5 py-3 text-xs font-bold text-muted-foreground transition-colors hover:text-primary"
      >
        {restantes > 0 ? `Ver la bandeja completa (${restantes} más)` : 'Ver la bandeja completa'}
        <ArrowRight size={12} />
      </Link>

      <ResponderPanel
        interaccion={abierta}
        onCerrar={() => setAbierta(null)}
        onRespondido={invalidarBandeja}
      />
    </aside>
  );
}
