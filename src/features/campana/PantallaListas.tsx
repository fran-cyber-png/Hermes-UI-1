import { useEffect, useState } from 'react';
import { AlertTriangle, Archive, ListChecks, Loader2, Plus, Users2, X } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import { sectionLabel } from '../../lib/styles';
import { DIMENSIONES, useFacetas, type Dimension } from '../padron/padron';
import { useArchivarLista, useGuardarLista, useListas, type Lista } from './plantillas';

/**
 * LISTAS — un recorte del padrón, guardado con nombre.
 *
 * ══ LO QUE HAY QUE ENTENDER ANTES DE MIRAR LA PANTALLA ══════════════════════
 *
 * **Una lista es un FILTRO, no un conjunto de contactos.** «Los mexicanos que
 * nunca compraron» se guarda como la condición, no como los 11.646 números que
 * hoy la cumplen.
 *
 * Eso tiene una consecuencia visible y hay que decirla, no esconderla: **el
 * tamaño cambia solo**. Por eso el conteo se pide en vivo cada vez y la pantalla
 * dice «hoy» al lado del número — si dijera «11.646» a secas, alguien lo leería
 * como un padrón congelado y armaría una campaña sobre una cifra vieja.
 *
 * ⚠️ Cuando icarus no responde, el conteo es **«no se pudo preguntar»**, nunca
 * cero. Un cero se lee como «esta lista está vacía» y lleva a borrar una lista
 * buena — o peor, a creer que una campaña no le llega a nadie.
 */

export function PantallaListas() {
  const { data, isPending, isError, error } = useListas();
  const [creando, setCreando] = useState(false);

  if (isPending) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    const sinMigracion = (error as { status?: number })?.status === 503;
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center p-8">
        <div className="flex max-w-md items-start gap-2.5 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold">{sinMigracion ? 'Falta aplicar la migración' : 'No se pudieron leer las listas'}</p>
            <p className="mt-1 text-xs leading-relaxed opacity-90">
              {sinMigracion
                ? 'La tabla `listas_campana` se crea con la migración 0019. No es que no haya listas: es que la tabla no existe todavía.'
                : error instanceof Error
                  ? error.message
                  : 'El server no respondió.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          Una lista es un <strong className="text-foreground">filtro guardado</strong>: su tamaño cambia
          solo cuando entran contactos nuevos.
        </p>
        <button
          type="button"
          onClick={() => setCreando(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-navy px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-navy/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Plus size={13} /> Crear una lista
        </button>
      </div>

      {creando && <Formulario onCerrar={() => setCreando(false)} />}

      {data.listas.length === 0 && !creando ? (
        <div className="flex flex-col items-center gap-2 p-12 text-center">
          <ListChecks size={26} className="text-muted-foreground/40" />
          <p className="max-w-sm text-sm text-muted-foreground">Todavía no hay ninguna lista.</p>
          <p className="max-w-md text-xs text-muted-foreground/80">
            Una lista es a quiénes le va a llegar una campaña. Se arma una vez y se reusa.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {data.listas.map((l) => (
            <Fila key={l.id} l={l} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** El conteo en vivo. `null` = no se pudo preguntar, y se DICE. */
function useCuantos(filtros: Record<string, unknown>) {
  const [cuantos, setCuantos] = useState<number | null | undefined>(undefined);
  const clave = JSON.stringify(filtros);
  useEffect(() => {
    let vivo = true;
    api<{ cuantos: number | null }>('/api/campana/cuantos', {
      method: 'POST',
      body: JSON.stringify({ filtros }),
    })
      .then((r) => vivo && setCuantos(r.cuantos))
      .catch(() => vivo && setCuantos(null));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  return cuantos;
}

function Fila({ l }: { l: Lista }) {
  const cuantos = useCuantos(l.filtros);
  const archivar = useArchivarLista();
  const [confirmando, setConfirmando] = useState(false);

  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-heading text-sm font-bold text-foreground">{l.nombre}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-navy/10 px-2 py-0.5 text-[11px] font-bold text-navy">
          <Users2 size={11} />
          {cuantos === undefined ? (
            <Loader2 size={10} className="animate-spin" />
          ) : cuantos === null ? (
            /* NUNCA un cero acá: llevaría a borrar una lista buena. */
            <span title="icarus no respondió. No quiere decir que la lista esté vacía.">no se pudo contar</span>
          ) : (
            <>
              {cuantos.toLocaleString('es-PE')} <span className="font-normal opacity-70">hoy</span>
            </>
          )}
        </span>
        <button
          type="button"
          onClick={() => (confirmando ? archivar.mutate(l.id) : setConfirmando(true))}
          className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
            confirmando
              ? 'bg-destructive text-white'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <Archive size={11} /> {confirmando ? '¿Seguro? Archivar' : 'Archivar'}
        </button>
      </div>

      {l.nota && <p className="mt-1 text-xs text-muted-foreground">{l.nota}</p>}

      <p className="mt-1.5 flex flex-wrap gap-1.5">
        {resumirFiltros(l.filtros).map((f) => (
          <span key={f} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {f}
          </span>
        ))}
      </p>

      <p className="mt-1.5 text-[11px] text-muted-foreground/80">
        la creó {nombreCorto(l.creadaPor)} el{' '}
        {new Date(l.creadaEn).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}
      </p>
    </li>
  );
}

function Formulario({ onCerrar }: { onCerrar: () => void }) {
  const [nombre, setNombre] = useState('');
  const [nota, setNota] = useState('');
  const [filtros, setFiltros] = useState<Record<string, unknown>>({});
  const cuantos = useCuantos(filtros);
  /**
   * Las facetas se cuentan SIN el propio filtro de cada dimensión (`donde.ts`
   * con `omitir`): si se contaran con él, tildar «México» reduciría la lista a
   * México y no habría forma de AGREGAR Perú.
   */
  const facetas = useFacetas(filtros, true);
  const guardar = useGuardarLista();

  const listo = nombre.trim().length > 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="font-heading text-sm font-bold">Crear una lista</h3>
        <button
          type="button"
          onClick={onCerrar}
          className="ml-auto rounded-full p-1 text-muted-foreground hover:bg-muted"
          aria-label="Cerrar"
        >
          <X size={15} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={sectionLabel}>Nombre</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Mexicanos que no compraron"
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className={sectionLabel}>Para qué es (opcional)</span>
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Para la promo de agosto"
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm"
          />
        </label>
      </div>

      {/*
        ⚠️ LAS OPCIONES SE DERIVAN DE LOS DATOS, NUNCA SE ESCRIBEN A MANO.
        Acá había un campo de texto («separá con comas») y era una trampa: los
        países en icarus son NOMBRES («México»), no códigos. Quien tipeara «MX»
        habría visto 0 y creído que la lista está vacía. Con las facetas, cada
        opción llega con su conteo — y ese número ES el total que el filtro
        después devuelve, que es lo que convierte elegir en decidir.
      */}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {DIMENSIONES.map((d) => (
          <Faceta
            key={d.id}
            dim={d}
            opciones={facetas.data?.facetas?.[d.id] ?? []}
            elegidos={(filtros[d.id] as string[] | undefined) ?? []}
            onCambio={(vals) =>
              setFiltros((f) => {
                const nuevo = { ...f };
                if (vals.length) nuevo[d.id] = vals;
                else delete nuevo[d.id];
                return nuevo;
              })
            }
          />
        ))}
        <label className="flex items-end gap-2 pb-1.5">
          <input
            type="checkbox"
            className="size-3.5 accent-navy"
            onChange={(e) =>
              setFiltros((f) => {
                const nuevo = { ...f };
                if (e.target.checked) nuevo.conVenta = true;
                else delete nuevo.conVenta;
                return nuevo;
              })
            }
          />
          <span className="text-xs text-muted-foreground">Sólo los que ya compraron</span>
        </label>
      </div>

      {/* El conteo en vivo mientras se arma: es lo que convierte «un filtro» en
          una decisión. Sin el número, elegir dimensiones es tantear. */}
      <p className="mt-3 text-sm">
        {cuantos === undefined ? (
          <span className="text-muted-foreground">contando…</span>
        ) : cuantos === null ? (
          <span className="text-warning-foreground">No se pudo contar (icarus no respondió).</span>
        ) : (
          <>
            <strong className="font-heading text-xl tabular-nums">{cuantos.toLocaleString('es-PE')}</strong>{' '}
            <span className="text-muted-foreground">contactos entran hoy en este filtro</span>
          </>
        )}
      </p>

      {guardar.isError && (
        <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
          {guardar.error instanceof Error ? guardar.error.message : 'No se pudo guardar.'}
        </p>
      )}

      <button
        type="button"
        disabled={!listo || guardar.isPending}
        onClick={() =>
          guardar.mutate({ nombre, filtros, nota }, { onSuccess: onCerrar })
        }
        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
      >
        {guardar.isPending && <Loader2 size={13} className="animate-spin" />}
        Guardar la lista
      </button>
    </section>
  );
}

/** Un desplegable de opciones REALES, cada una con su conteo. */
function Faceta({
  dim,
  opciones,
  elegidos,
  onCambio,
}: {
  dim: { id: Dimension; rotulo: string };
  opciones: { valor: string; contactos: number }[];
  elegidos: string[];
  onCambio: (v: string[]) => void;
}) {
  return (
    <div>
      <span className={sectionLabel}>{dim.rotulo}</span>
      <div className="max-h-28 overflow-auto rounded-lg border border-border bg-muted px-2 py-1">
        {opciones.length === 0 ? (
          <p className="py-1 text-[11px] text-muted-foreground">sin opciones</p>
        ) : (
          opciones.map((o) => (
            <label key={o.valor} className="flex cursor-pointer items-center gap-1.5 py-0.5 text-xs">
              <input
                type="checkbox"
                className="size-3 accent-navy"
                checked={elegidos.includes(o.valor)}
                onChange={(e) =>
                  onCambio(
                    e.target.checked
                      ? [...elegidos, o.valor]
                      : elegidos.filter((v) => v !== o.valor),
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate">{o.valor}</span>
              {/* El conteo ES el total que el filtro devuelve: sin él, un
                  desplegable de 62 países es una lista de nombres y filtrar
                  se vuelve tantear. */}
              <span className="shrink-0 tabular-nums text-muted-foreground">{o.contactos}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

/** El filtro en criollo. Una lista sin esto es un nombre sin contenido. */
export function resumirFiltros(f: Record<string, unknown>): string[] {
  const partes: string[] = [];
  for (const d of DIMENSIONES) {
    const v = f[d.id];
    if (Array.isArray(v) && v.length) partes.push(`${d.rotulo}: ${v.join(' o ')}`);
  }
  if (f.conVenta === true) partes.push('ya compraron');
  if (f.q) partes.push(`busca «${String(f.q)}»`);
  return partes.length ? partes : ['todo el padrón'];
}

function nombreCorto(id: string): string {
  const base = id.split('@')[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}
