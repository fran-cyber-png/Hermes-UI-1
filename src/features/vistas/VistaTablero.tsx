import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import { useFrescura, hace } from '../../lib/datos/frescura';
import { useSesionWa } from '../whatsapp/conversacionWa';
import { nombreCanal } from '../canales/BadgeCanal';

/**
 * EL TABLERO — los números honestos de la operación, en lenguaje humano.
 *
 * Regla de la casa hecha vista: un cero puede ser "no hay trabajo" o "no estoy
 * mirando", y acá se dice cuál. Todo lo que se muestra sale de datos vivos
 * (canales, frescura, sesión de WhatsApp). Lo que todavía no se mide (primera
 * respuesta, conversión por vendedora) se declara como hueco, no se inventa.
 *
 * El único dorado grande permitido: la cifra de gente ESPERANDO — porque es
 * tiempo que se acaba, el significado exclusivo del oro en Hermes.
 */

interface CanalStats {
  canal: string;
  total: number;
  pide_info: number;
  ventana_abierta: number;
  sin_atender: number;
  comentarios: number;
  mensajes: number;
}

function useCanales() {
  return useQuery({
    queryKey: ['canales-tablero'],
    queryFn: () => api<{ interacciones: CanalStats[] }>(`/api/interactions/canales`),
    staleTime: 60_000,
  });
}

export function VistaTablero() {
  const { data: canales, isPending } = useCanales();
  const { data: frescura } = useFrescura();
  const { data: sesionWa } = useSesionWa();

  const filas = canales?.interacciones ?? [];
  const pidenInfo = filas.reduce((n, c) => n + c.pide_info, 0);
  const ventanaAbierta = filas.reduce((n, c) => n + c.ventana_abierta, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-3 md:grid-cols-3">
        {/* LA CIFRA HÉROE: gente esperando = tiempo = el único oro grande. */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-panel md:col-span-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Esperando respuesta
          </div>
          {isPending ? (
            <div className="mt-3 h-10 w-64 animate-pulse rounded bg-muted" />
          ) : (
            <>
              <div className="mt-2 font-heading text-4xl font-extrabold tracking-tight text-gold-ink">
                {pidenInfo.toLocaleString('es')}{' '}
                <span className="font-sans text-sm font-semibold tracking-normal text-muted-foreground">
                  personas pidieron info y esperan
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {ventanaAbierta.toLocaleString('es')} con la ventana de privado todavía abierta. La
                Bandeja las ordena primero: lo que expira arriba.
              </p>
            </>
          )}
        </section>

        {/* FRESCURA POR FUENTE (D3): WhatsApp = sesión; Meta = edad de la captura. */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-panel">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Frescura por fuente
          </div>
          <ul className="mt-3 space-y-2.5 text-xs">
            <li className="flex items-center gap-2">
              <span
                className={
                  'size-2 shrink-0 rounded-full ' +
                  (sesionWa?.estado === 'conectado' ? 'bg-success' : sesionWa?.estado === 'baneado' ? 'bg-destructive' : 'bg-gold')
                }
              />
              <span className="text-foreground">WhatsApp</span>
              <span className="ml-auto font-mono text-muted-foreground">
                {sesionWa?.estado === 'conectado' ? 'en vivo' : (sesionWa?.estado ?? 'sin dato')}
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className={'size-2 shrink-0 rounded-full ' + (frescura?.fresca ? 'bg-success' : 'bg-gold')} />
              <span className="text-foreground">Meta (FB · IG · Messenger)</span>
              <span className="ml-auto font-mono text-muted-foreground">
                {frescura ? (frescura.ultimaIngesta == null ? 'nunca' : hace(frescura.horasDesdeIngesta)) : '…'}
              </span>
            </li>
          </ul>
          <p className="mt-3 rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
            Un cero puede ser “no hay trabajo” o “no estoy mirando”. Esta caja dice cuál.
          </p>
        </section>

        {/* POR CANAL: los números crudos, en mono. */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-panel md:col-span-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Por canal</div>
          {isPending ? (
            <div className="mt-3 h-24 animate-pulse rounded bg-muted" />
          ) : (
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Canal</th>
                  <th className="pb-2 text-right font-medium">Interacciones</th>
                  <th className="pb-2 text-right font-medium">Piden info</th>
                  <th className="pb-2 text-right font-medium">Ventana abierta</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((c) => (
                  <tr key={c.canal} className="border-t border-border">
                    <td className="py-2 font-semibold text-foreground">{nombreCanal(c.canal)}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-foreground">{c.total.toLocaleString('es')}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-foreground">{c.pide_info.toLocaleString('es')}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-gold-ink">{c.ventana_abierta.toLocaleString('es')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* LO QUE TODAVÍA NO SE MIDE: hueco declarado, no gráfico inventado. */}
        <section className="rounded-2xl border border-dashed border-border bg-card/50 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Lo que falta medir
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Tiempo de primera respuesta y conversión por vendedora llegan con la fase del embudo
            completo: se medirán desde los envíos firmados y las ventas registradas. Hasta entonces,
            acá no hay gráficos de mentira.
          </p>
        </section>
      </div>
    </div>
  );
}
