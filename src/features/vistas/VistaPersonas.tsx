import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, ExternalLink, Megaphone, MessageCircle, Search, ShoppingBag, ShoppingCart, UserPlus, Users2 } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import { sectionLabel } from '../../lib/styles';
import { fechaCorta, formatoTelefono } from '../../lib/formato';
import { BotonLlamar } from '../gestion/BotonLlamar';
import { FormularioVenta } from '../venta/FormularioVenta';
import { PantallaCampanas } from '../campana/PantallaCampanas';
import { PantallaPadron } from '../padron/PantallaPadron';
import type { DestinoCorreo } from '../../lib/puente';

/**
 * PERSONAS — buscar a alguien por teléfono y ver su ficha de Cerberus.
 *
 * El caso real: alguien te pasa su número en un chat de Messenger (que no trae
 * teléfono), o te preguntan por un cliente en voz alta. Se busca acá, sin entrar
 * a Cerberus.
 *
 * La búsqueda encuentra SOLO por teléfono — es el único identificador compartido
 * con Cerberus hoy. La unificación entre canales (que esta vista encuentre a la
 * persona por su nombre de Instagram) llega con la identidad cross-canal (H4);
 * hasta entonces no se dibuja lo que no existe.
 *
 * Mismos 4 estados honestos que la ficha: cliente / nueva / cargando / Cerberus
 * caído. Jamás "no figura" cuando lo que pasó es que la API falló. Y ninguna
 * ficha es un callejón: cliente y lead nuevo terminan en acciones (escribirle,
 * llamar, registrar venta).
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

const FOCO_ANILLO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** «2 compras · USD 1.250» — la cifra héroe de la ficha. Null si no hay compras. */
function cifraCompras(ventas: VentaFicha[], count: number): string | null {
  if (count <= 0) return null;
  const porMoneda = new Map<string, number>();
  for (const v of ventas) {
    const n = Number.parseFloat(v.monto);
    if (!Number.isNaN(n)) porMoneda.set(v.moneda, (porMoneda.get(v.moneda) ?? 0) + n);
  }
  const compras = count === 1 ? '1 compra' : `${count} compras`;
  if (porMoneda.size === 0) return compras;
  const montos = [...porMoneda.entries()]
    .map(([moneda, total]) => `${moneda} ${total.toLocaleString('es', { maximumFractionDigits: 2 })}`)
    .join(' + ');
  return `${compras} · ${montos}`;
}

/** Tinta del estado de una venta cuando el valor es del set conocido. */
function tintaEstadoVenta(estado: string): string {
  const e = estado.toLowerCase();
  if (e.includes('pagad') || e.includes('complet')) return 'text-success';
  if (e.includes('anulad') || e.includes('cancelad')) return 'text-destructive';
  return 'text-foreground';
}

/**
 * La fila que mata el dead-end: toda ficha (cliente Y lead nuevo) responde
 * «¿y ahora qué?». «Escribirle» solo aparece si App cableó el puente (Fase 3);
 * mientras tanto el primer botón visible es Llamar.
 */
function AccionesFicha({ telefono, onEscribir, onVenta }: { telefono: string; onEscribir?: (telefono: string) => void; onVenta?: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3.5">
      {onEscribir && (
        <button
          type="button"
          onClick={() => onEscribir(telefono)}
          className={`flex items-center gap-1.5 rounded-full bg-navy px-3.5 py-1.5 text-xs font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] ${FOCO_ANILLO}`}
        >
          <MessageCircle size={13} /> Escribirle
        </button>
      )}
      <BotonLlamar telefono={telefono} />
      {onVenta && (
        <button
          type="button"
          onClick={onVenta}
          className={`flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-bold text-navy transition-[background-color,transform] duration-200 ease-house hover:bg-muted active:scale-[0.98] ${FOCO_ANILLO}`}
        >
          <ShoppingCart size={13} /> Registrar venta
        </button>
      )}
    </div>
  );
}

/**
 * CONTACTOS — el padrón en una tabla, y la ficha viva de Cerberus por teléfono.
 *
 * Son DOS preguntas distintas y por eso conviven en vez de reemplazarse:
 *
 *   · **Padrón** (lo de siempre desde el 4-ago): los 72.923 contactos de icarus
 *     que nunca escribieron. El supervisor los recorta y los reparte; la
 *     vendedora ve los suyos. Es una LISTA, y es lo que la pantalla abre.
 *   · **Por teléfono**: alguien te dicta un número, o llegó por Messenger sin
 *     teléfono. Pregunta a **Cerberus en vivo** —otra fuente, con las ventas
 *     reales y el folio— y responde por UNA persona.
 *
 * El buscador no se archivó al llegar la tabla porque no consulta lo mismo: el
 * padrón es una copia de icarus y no tiene folios ni montos por venta.
 */
export function VistaPersonas({
  telefonoInicial,
  onEscribir,
  miVendedora,
  onMandarCorreo,
}: {
  telefonoInicial?: string | null;
  /** Puente a Mensajes (Fase 3): abre (o crea) el chat con ese número. */
  onEscribir?: (telefono: string) => void;
  /** Quién mira — la `HojaContacto` del padrón la necesita (ADR 0037). */
  miVendedora?: string | null;
  /** Puente a Correos: sigue de largo hasta la ficha que abre el padrón. */
  onMandarCorreo?: (destino: DestinoCorreo) => void;
}) {
  // Con un teléfono en la mano se abre directo en la ficha: quien llega así ya
  // sabe a quién busca, y mostrarle la tabla primero sería un paso de más.
  const [modo, setModo] = useState<'padron' | 'telefono' | 'campanas'>(
    telefonoInicial ? 'telefono' : 'padron',
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-4 py-2">
        <Solapa activa={modo === 'padron'} onClick={() => setModo('padron')}>
          <Users2 size={13} /> Padrón
        </Solapa>
        <Solapa activa={modo === 'telefono'} onClick={() => setModo('telefono')}>
          <Search size={13} /> Buscar por teléfono
        </Solapa>
        {/*
          CAMPAÑAS va acá y no en el riel, y el precedente es el de al lado: el
          padrón (ADR 0035) también es supervisor-only, también es gente en
          bulto, y entró como solapa de Contactos. Una vista del riel tiene que
          ser un LUGAR con acción primaria nombrable (ADR 0034), y esto es una
          tarea con ventana — lo que ADR 0016 ya rechazó por escrito. Además el
          riel lo comparten cinco vendedoras: un ícono que a la mayoría le
          responde 403 no es un mapa diluido, es una promesa incumplida.

          La solapa se dibuja siempre y el 403 lo explica la pantalla: quién es
          supervisor lo dice el SERVER, y esconderla acá exigiría preguntarlo
          antes de que haga falta.
        */}
        <Solapa activa={modo === 'campanas'} onClick={() => setModo('campanas')}>
          <Megaphone size={13} /> Campañas
        </Solapa>
      </div>

      {modo === 'padron' ? (
        <PantallaPadron
          onEscribir={onEscribir}
          miVendedora={miVendedora}
          onMandarCorreo={onMandarCorreo}
        />
      ) : modo === 'campanas' ? (
        <PantallaCampanas />
      ) : (
        <BuscarPorTelefono telefonoInicial={telefonoInicial} onEscribir={onEscribir} />
      )}
    </div>
  );
}

function Solapa({
  activa,
  onClick,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors duration-200 ${FOCO_ANILLO} ${
        activa ? 'bg-navy text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function BuscarPorTelefono({
  telefonoInicial,
  onEscribir,
}: {
  telefonoInicial?: string | null;
  onEscribir?: (telefono: string) => void;
}) {
  const [entrada, setEntrada] = useState(telefonoInicial ?? '');
  const [telefono, setTelefono] = useState<string | null>(
    telefonoInicial && telefonoInicial.replace(/\D/g, '').length >= 8 ? telefonoInicial.replace(/\D/g, '') : null,
  );
  const [recientes, setRecientes] = useState<string[]>([]);
  const [faltanDigitos, setFaltanDigitos] = useState(false);
  const [ventaAbierta, setVentaAbierta] = useState(false);

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ['ficha', telefono],
    queryFn: () => api<Ficha>(`/api/contactos/ficha?telefono=${encodeURIComponent(telefono ?? '')}`),
    enabled: Boolean(telefono),
    staleTime: 60_000,
  });

  function buscar(limpio: string) {
    setTelefono(limpio);
    setFaltanDigitos(false);
    setVentaAbierta(false);
    setRecientes((prev) => [limpio, ...prev.filter((t) => t !== limpio)].slice(0, 3));
  }

  function onBuscar(e: FormEvent) {
    e.preventDefault();
    const limpio = entrada.replace(/\D/g, '');
    if (limpio.length >= 8) buscar(limpio);
    else setFaltanDigitos(true);
  }

  const buscando = Boolean(telefono);
  const entradaValida = entrada.replace(/\D/g, '').length >= 8;

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl">
        {/* Spotlight: sin búsqueda la barra vive centrada y generosa; al buscar se acopla arriba. */}
        <div
          className={`transition-transform duration-[250ms] ease-house ${buscando ? 'translate-y-0' : 'translate-y-[22vh]'}`}
        >
          <form onSubmit={onBuscar} className="flex gap-2">
            <div className="flex flex-1 items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2.5 transition-[border-color,box-shadow] duration-200 focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]">
              <Search size={15} className="shrink-0 text-muted-foreground" />
              <input
                value={entrada}
                onChange={(e) => setEntrada(e.target.value)}
                autoFocus
                inputMode="tel"
                placeholder="Teléfono con código de país, ej. 51 986 394 450"
                className={`w-full bg-transparent font-mono text-foreground outline-none placeholder:font-sans ${buscando ? 'text-sm' : 'text-base'}`}
              />
            </div>
            <button
              type="submit"
              className={`rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground shadow-[0_4px_16px_-4px_rgba(37,99,235,0.5)] transition-[background-color,transform,opacity] duration-200 ease-house hover:bg-primary-hover active:scale-[0.98] ${FOCO_ANILLO} ${entradaValida ? '' : 'opacity-40 shadow-none'}`}
            >
              Buscar
            </button>
          </form>

          {faltanDigitos && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Faltan dígitos — incluí el código de país (51 …).
            </p>
          )}

          {recientes.filter((t) => t !== telefono).length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {recientes
                .filter((t) => t !== telefono)
                .map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setEntrada(t);
                      buscar(t);
                    }}
                    className={`rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] tabular-nums text-muted-foreground transition-[border-color,color] duration-200 hover:border-primary hover:text-foreground ${FOCO_ANILLO}`}
                  >
                    {formatoTelefono(t)}
                  </button>
                ))}
            </div>
          )}

          {!buscando && (
            <div className="mt-10 flex flex-col items-center gap-3 text-center">
              <Search size={28} className="text-muted-foreground/40" />
              <p className="max-w-sm text-sm text-muted-foreground">
                ¿Te dictaron un número o llegó por Messenger sin teléfono? Pegalo arriba: te digo si
                ya es cliente de la Escuela.
              </p>
              <p className="max-w-sm text-[11px] text-muted-foreground">
                Busca solo por teléfono. El nombre o el usuario de Instagram llegan con la identidad
                entre canales.
              </p>
            </div>
          )}
        </div>

        {buscando && (
          <div className="mt-6">
            {isPending || isFetching ? (
              <div className="space-y-3 rounded-2xl bg-card p-5 shadow-panel">
                <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                <div className="h-6 w-48 animate-pulse rounded bg-muted" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="h-12 animate-pulse rounded-xl bg-muted" />
                  <div className="h-12 animate-pulse rounded-xl bg-muted" />
                </div>
              </div>
            ) : isError || data?.estado === 'error' ? (
              <div className="animate-[entrar_240ms_var(--ease-house)] rounded-2xl border border-warning/40 bg-warning/10 p-4 text-xs text-warning-foreground">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>
                    Cerberus no responde: no se puede saber si{' '}
                    <span className="font-mono tabular-nums">{formatoTelefono(telefono ?? '')}</span> ya es
                    cliente. No es que sea nuevo — la ficha no cargó.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className={`mt-3 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-[background-color] duration-200 hover:bg-muted ${FOCO_ANILLO}`}
                >
                  Reintentar
                </button>
              </div>
            ) : data?.estado === 'nuevo' ? (
              <div className="animate-[entrar_240ms_var(--ease-house)] rounded-2xl bg-card p-5 shadow-panel">
                <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <UserPlus size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p>
                      <span className="font-mono tabular-nums text-foreground">{formatoTelefono(telefono ?? '')}</span>{' '}
                      no figura en Cerberus. Es un lead nuevo.
                    </p>
                    <p className="mt-1 text-xs">
                      Cuando le registres una venta, la ficha va a aparecer sola acá.
                    </p>
                  </div>
                </div>
                <AccionesFicha telefono={telefono ?? ''} onEscribir={onEscribir} />
              </div>
            ) : data?.estado === 'cliente' ? (
              <div className="animate-[entrar_240ms_var(--ease-house)] rounded-2xl bg-card p-5 shadow-panel">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-bold text-success">
                      <BadgeCheck size={12} /> Cliente
                    </span>
                    <h2 className="mt-2 font-heading text-2xl font-bold text-foreground">{data.nombre}</h2>
                    {cifraCompras(data.ventas, data.ventasCount) && (
                      <div className="mt-1 font-heading text-xl font-bold tabular-nums text-navy">
                        {cifraCompras(data.ventas, data.ventasCount)}
                      </div>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground">
                      <span>{data.codigo}</span>
                      {data.dni && <span>DNI {data.dni}</span>}
                      {data.pais && <span>{data.pais}</span>}
                      <span className="tabular-nums">{formatoTelefono(telefono ?? '')}</span>
                    </div>
                  </div>
                  <a
                    href={`${CERBERUS}/clientes/${data.id}/`}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded text-xs font-bold text-primary hover:underline ${FOCO_ANILLO}`}
                  >
                    Ver en Cerberus <ExternalLink size={11} />
                  </a>
                </div>

                <AccionesFicha
                  telefono={telefono ?? ''}
                  onEscribir={onEscribir}
                  onVenta={() => setVentaAbierta(true)}
                />

                <div className="mt-5">
                  <div className={`mb-2 flex items-center gap-1.5 ${sectionLabel}`}>
                    <ShoppingBag size={12} /> Compras
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
                          <div className="mt-0.5 flex items-center justify-between">
                            <span className={`font-medium ${tintaEstadoVenta(v.estado)}`}>{v.estado}</span>
                            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                              {fechaCorta(v.fecha)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {ventaAbierta && telefono && (
                  <FormularioVenta
                    clienteId={data.id}
                    clienteNombre={data.nombre}
                    telefono={telefono}
                    canal="whatsapp"
                    personaNombre={data.nombre}
                    onCerrar={() => setVentaAbierta(false)}
                  />
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
