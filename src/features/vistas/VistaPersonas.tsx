import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, ExternalLink, Search, ShoppingBag, UserPlus } from 'lucide-react';
import { api } from '../../lib/datos/cliente';

/**
 * PERSONAS — buscar a alguien por teléfono y ver su ficha de Cerberus.
 *
 * El caso real: alguien te pasa su número en un chat de Messenger (que no trae
 * teléfono), o te preguntan por un cliente en voz alta. Se busca acá, sin entrar
 * a Cerberus.
 *
 * La búsqueda matchea SOLO por teléfono — es el único identificador compartido
 * con Cerberus hoy. La unificación entre canales (que esta vista encuentre a la
 * persona por su nombre de Instagram) llega con la identidad cross-canal (H4);
 * hasta entonces no se dibuja lo que no existe.
 *
 * Mismos 4 estados honestos que la ficha: cliente / nueva / cargando / Cerberus
 * caído. Jamás "no figura" cuando lo que pasó es que la API falló.
 */

interface VentaFicha {
  folio: string;
  estado: string;
  monto: string;
  moneda: string;
  fecha: string;
}

type Ficha =
  | { estado: 'cliente'; id: number; nombre: string; codigo: string; dni: string; pais: string; correo: string; ventasCount: number; ventas: VentaFicha[] }
  | { estado: 'nuevo' }
  | { estado: 'error'; motivo: string };

const CERBERUS = import.meta.env.VITE_CERBERUS_URL ?? 'https://app.goberna.us';

export function VistaPersonas({ telefonoInicial }: { telefonoInicial?: string | null }) {
  const [entrada, setEntrada] = useState(telefonoInicial ?? '');
  const [telefono, setTelefono] = useState<string | null>(
    telefonoInicial && telefonoInicial.replace(/\D/g, '').length >= 8 ? telefonoInicial.replace(/\D/g, '') : null,
  );

  const { data, isPending, isError, isFetching } = useQuery({
    queryKey: ['ficha', telefono],
    queryFn: () => api<Ficha>(`/api/contactos/ficha?telefono=${encodeURIComponent(telefono ?? '')}`),
    enabled: Boolean(telefono),
    staleTime: 60_000,
  });

  function onBuscar(e: FormEvent) {
    e.preventDefault();
    const limpio = entrada.replace(/\D/g, '');
    if (limpio.length >= 8) setTelefono(limpio);
  }

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl">
        <h1 className="font-heading text-base font-bold text-foreground">Personas</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Buscá por teléfono y mirá su ficha de Cerberus sin salir de Hermes.
        </p>

        <form onSubmit={onBuscar} className="mt-4 flex gap-2">
          <div className="flex flex-1 items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2.5 transition-all duration-200 focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]">
            <Search size={15} className="shrink-0 text-muted-foreground" />
            <input
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              autoFocus
              inputMode="tel"
              placeholder="Teléfono con código de país, ej. 51 986 394 450"
              className="w-full bg-transparent font-mono text-sm text-foreground outline-none placeholder:font-sans"
            />
          </div>
          <button
            type="submit"
            disabled={entrada.replace(/\D/g, '').length < 8}
            className="rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground shadow-[0_4px_16px_-4px_rgba(37,99,235,0.5)] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
          >
            Buscar
          </button>
        </form>

        <p className="mt-2 text-[11px] text-muted-foreground">
          Matchea solo por teléfono. La búsqueda por nombre o por usuario de Instagram llega con la
          identidad entre canales.
        </p>

        <div className="mt-6">
          {!telefono ? null : isPending || isFetching ? (
            <div className="space-y-2 rounded-2xl border border-border bg-card p-5 shadow-panel">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
            </div>
          ) : isError || data?.estado === 'error' ? (
            <div className="flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-xs text-gold-ink">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                Cerberus no responde: no se puede saber si <span className="font-mono">{telefono}</span> ya es
                cliente. No es que sea nuevo — la ficha no cargó.
              </span>
            </div>
          ) : data?.estado === 'nuevo' ? (
            <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-panel">
              <UserPlus size={16} className="shrink-0" />
              <span>
                <span className="font-mono">{telefono}</span> no figura en Cerberus. Es un lead nuevo.
              </span>
            </div>
          ) : data?.estado === 'cliente' ? (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-panel">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-bold text-success">
                    <BadgeCheck size={12} /> Cliente
                  </span>
                  <h2 className="mt-2 font-heading text-lg font-bold text-foreground">{data.nombre}</h2>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground">
                    <span>{data.codigo}</span>
                    {data.dni && <span>DNI {data.dni}</span>}
                    {data.pais && <span>{data.pais}</span>}
                    <span>{telefono}</span>
                  </div>
                </div>
                <a
                  href={`${CERBERUS}/clientes/${data.id}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                >
                  Ver en Cerberus <ExternalLink size={11} />
                </a>
              </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <ShoppingBag size={12} /> Compras ({data.ventasCount})
                </div>
                {data.ventas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Es cliente, pero sin ventas cargadas.</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {data.ventas.map((v) => (
                      <li key={v.folio} className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-foreground">{v.folio}</span>
                          <span className="font-mono font-bold tabular-nums text-navy">
                            {v.moneda} {v.monto}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-muted-foreground">
                          <span>{v.estado}</span>
                          <span className="font-mono">{v.fecha}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
