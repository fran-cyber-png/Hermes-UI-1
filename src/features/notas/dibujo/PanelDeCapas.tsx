import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Eye,
  EyeOff,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import { MiniaturaDeCapa } from './MiniaturaDeCapa';
import type { Capa } from './capas';
import { figurasDe } from './capas';
import type { Figura, Reordenamiento } from './figuras';
import { boton } from '../../../lib/styles';

/**
 * EL PANEL DE CAPAS — qué hay en cada una, cuál está activa, qué se ve.
 *
 * ══ LA LISTA VA AL REVÉS QUE EL ARRAY ═══════════════════════════════════════
 *
 * 🔴 Arriba se muestra la capa que se pinta ENCIMA. Es la convención de todo
 * editor gráfico y la que hace que arrastrar «hacia arriba» signifique «adelante».
 * En `capas.ts` el índice 0 es el fondo, así que la vuelta se da acá y en un solo
 * lugar: `alReves`. Con la inversión repartida, arrastrar movería la capa al
 * lado contrario del que se soltó y nadie sabría por qué.
 *
 * ══ DOS EJES DISTINTOS Y CONVIENE NO MEZCLARLOS ═════════════════════════════
 *
 * El ORDEN DE LAS CAPAS (arrastrando la tarjeta) decide qué capa tapa a cuál.
 * El ORDEN DE LOS OBJETOS (las acciones rápidas de abajo) decide qué figura tapa
 * a cuál **dentro** de su capa. Mezclarlos —«mandar a la capa de arriba»— es la
 * fuente clásica de confusión: un objeto puede estar en la capa de arriba y aun
 * así quedar tapado por otro de su misma capa.
 */

const ORDENES: { id: Reordenamiento; rotulo: string; Icono: typeof ArrowUp }[] = [
  { id: 'frente', rotulo: 'Traer al frente', Icono: ChevronsUp },
  { id: 'subir', rotulo: 'Subir una posición', Icono: ArrowUp },
  { id: 'bajar', rotulo: 'Bajar una posición', Icono: ArrowDown },
  { id: 'fondo', rotulo: 'Enviar al fondo', Icono: ChevronsDown },
];

function Icono({
  rotulo,
  onClick,
  activo,
  deshabilitado,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  activo?: boolean;
  deshabilitado?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // La tarjeta entera es clicable para activar la capa; sin esto, tocar el
        // ojo además la seleccionaría.
        e.stopPropagation();
        onClick();
      }}
      disabled={deshabilitado}
      title={rotulo}
      aria-label={rotulo}
      aria-pressed={activo}
      className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** El menú `…` de una capa. Se cierra al elegir o al tocar afuera. */
function MenuDeCapa({
  puedeBorrar,
  onRenombrar,
  onDuplicar,
  onBorrar,
}: {
  puedeBorrar: boolean;
  onRenombrar(): void;
  onDuplicar(): void;
  onBorrar(): void;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  // Cerrar al tocar afuera. En captura, para ganarle al `onPointerDown` de la
  // tarjeta que hay debajo.
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('pointerdown', afuera, true);
    return () => document.removeEventListener('pointerdown', afuera, true);
  }, [abierto]);

  const opciones: { rotulo: string; Ic: typeof Pencil; hacer: () => void; apagado?: boolean }[] = [
    { rotulo: 'Renombrar', Ic: Pencil, hacer: onRenombrar },
    { rotulo: 'Duplicar capa', Ic: Copy, hacer: onDuplicar },
    { rotulo: 'Eliminar capa', Ic: Trash2, hacer: onBorrar, apagado: !puedeBorrar },
  ];

  return (
    <div ref={caja} className="relative shrink-0">
      <Icono rotulo="Opciones de la capa" activo={abierto} onClick={() => setAbierto((a) => !a)}>
        <MoreHorizontal className="size-3.5" />
      </Icono>

      {abierto && (
        <div
          role="menu"
          aria-label="Opciones de la capa"
          className="absolute right-0 top-full z-40 mt-1 w-40 rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {opciones.map(({ rotulo, Ic, hacer, apagado }) => (
            <button
              key={rotulo}
              type="button"
              role="menuitem"
              disabled={apagado}
              onClick={(e) => {
                e.stopPropagation();
                setAbierto(false);
                hacer();
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-foreground transition hover:bg-muted disabled:opacity-40"
            >
              <Ic className="size-3.5 text-muted-foreground" />
              {rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PanelDeCapas({
  capas,
  figuras,
  capaActiva,
  haySeleccion,
  onCapaActiva,
  onCambiarCapa,
  onRenombrar,
  onAgregar,
  onDuplicar,
  onBorrar,
  onMover,
  onOrdenar,
}: {
  capas: Capa[];
  figuras: Figura[];
  capaActiva: string;
  haySeleccion: boolean;
  onCapaActiva(id: string): void;
  onCambiarCapa(id: string, cambios: Partial<Omit<Capa, 'id'>>): void;
  onRenombrar(id: string, nombre: string): void;
  onAgregar(): void;
  onDuplicar(id: string): void;
  onBorrar(id: string): void;
  /** `hacia` es el índice en el ARRAY (0 = fondo), ya desinvertido. */
  onMover(id: string, hacia: number): void;
  onOrdenar(a: Reordenamiento): void;
}) {
  const [renombrando, setRenombrando] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  /** Sobre qué tarjeta está el puntero mientras se arrastra. */
  const [encima, setEncima] = useState<string | null>(null);

  // Arriba la que se pinta encima. Ver el docblock.
  const alReves = [...capas].reverse();
  const puedeBorrar = capas.length > 1;

  return (
    <div
      className="flex max-h-[26rem] w-72 flex-col rounded-lg border border-border bg-card shadow-lg"
      role="dialog"
      aria-label="Capas"
      // El panel vive pegado a la barra; sin esto, cada clic acá dentro también
      // cuenta como un clic en la barra.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">Capas</span>
        <button
          type="button"
          onClick={onAgregar}
          aria-label="Nueva capa"
          title="Nueva capa"
          className={boton('secundario')}
        >
          <Plus className="size-3" />
          Nueva
        </button>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {alReves.map((capa) => {
          const activa = capa.id === capaActiva;
          const cuantas = figurasDe(figuras, capa.id).length;

          return (
            <li
              key={capa.id}
              draggable
              onDragStart={() => setArrastrando(capa.id)}
              onDragEnd={() => {
                setArrastrando(null);
                setEncima(null);
              }}
              onDragOver={(e) => {
                // Sin el `preventDefault` el navegador no considera esta zona un
                // destino válido y el `drop` no llega nunca.
                e.preventDefault();
                if (capa.id !== arrastrando) setEncima(capa.id);
              }}
              onDragLeave={() => setEncima((v) => (v === capa.id ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                setEncima(null);
                if (!arrastrando || arrastrando === capa.id) return;
                // La lista está invertida: el índice del array es el complemento.
                onMover(arrastrando, capas.length - 1 - alReves.findIndex((c) => c.id === capa.id));
              }}
              onClick={() => onCapaActiva(capa.id)}
              aria-current={activa}
              className={
                'mb-1 flex cursor-pointer items-center gap-2 rounded-lg border p-1.5 transition ' +
                (activa ? 'border-primary bg-secondary' : 'border-transparent hover:bg-muted') +
                (arrastrando === capa.id ? ' opacity-40' : '') +
                // La línea de destino va ARRIBA de la tarjeta señalada, que es
                // donde va a quedar la capa arrastrada.
                (encima === capa.id ? ' border-t-2 border-t-primary' : '')
              }
            >
              <MiniaturaDeCapa capa={capa} figuras={figuras} />

              <div className="min-w-0 flex-1">
                {renombrando === capa.id ? (
                  <input
                    autoFocus
                    defaultValue={capa.nombre}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v) onRenombrar(capa.id, v);
                      setRenombrando(null);
                    }}
                    onKeyDown={(e) => {
                      // El teclado no sube: una Enter acá no puede llegar al
                      // documento ni a los atajos de la capa de dibujo.
                      e.stopPropagation();
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setRenombrando(null);
                    }}
                    aria-label={`Nombre de ${capa.nombre}`}
                    className="w-full rounded border border-input bg-card px-1 py-0.5 text-xs outline-none focus:border-ring"
                  />
                ) : (
                  <p
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenombrando(capa.id);
                    }}
                    title="Doble clic para renombrar"
                    className="truncate text-xs font-medium text-foreground"
                  >
                    {capa.nombre}
                  </p>
                )}

                <p className="flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
                  <span>{Math.round(capa.opacidad * 100)}%</span>
                  <span>·</span>
                  <span>
                    {cuantas} {cuantas === 1 ? 'objeto' : 'objetos'}
                  </span>
                </p>
              </div>

              <Icono
                rotulo={`${capa.visible ? 'Ocultar' : 'Mostrar'} ${capa.nombre}`}
                activo={!capa.visible}
                onClick={() => onCambiarCapa(capa.id, { visible: !capa.visible })}
              >
                {capa.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </Icono>

              <Icono
                rotulo={`${capa.bloqueada ? 'Desbloquear' : 'Bloquear'} ${capa.nombre}`}
                activo={capa.bloqueada}
                onClick={() => onCambiarCapa(capa.id, { bloqueada: !capa.bloqueada })}
              >
                {capa.bloqueada ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
              </Icono>

              <MenuDeCapa
                puedeBorrar={puedeBorrar}
                onRenombrar={() => setRenombrando(capa.id)}
                onDuplicar={() => onDuplicar(capa.id)}
                onBorrar={() => onBorrar(capa.id)}
              />
            </li>
          );
        })}
      </ul>

      {/* OPACIDAD DE LA CAPA ACTIVA. Va acá y no en la tarjeta: un deslizador por
          fila haría cada tarjeta el doble de alta para una perilla que se toca
          sobre una capa a la vez. */}
      {capas.find((c) => c.id === capaActiva) && (
        <div className="shrink-0 border-t border-border px-2 py-1.5">
          <label className="flex items-center gap-2">
            <span className="shrink-0 text-[0.625rem] uppercase tracking-wide text-muted-foreground">Opacidad</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((capas.find((c) => c.id === capaActiva)?.opacidad ?? 1) * 100)}
              onChange={(e) => onCambiarCapa(capaActiva, { opacidad: Number(e.target.value) / 100 })}
              aria-label="Opacidad de la capa"
              className="min-w-0 flex-1 cursor-pointer accent-primary"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round((capas.find((c) => c.id === capaActiva)?.opacidad ?? 1) * 100)}
              onChange={(e) => {
                if (e.target.value === '') return;
                const n = Math.min(100, Math.max(0, Number(e.target.value)));
                onCambiarCapa(capaActiva, { opacidad: n / 100 });
              }}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label="Opacidad de la capa en porcentaje"
              className="w-11 shrink-0 rounded border border-input bg-card px-1 py-0.5 text-right text-[0.6875rem] tabular-nums outline-none focus:border-ring"
            />
          </label>
        </div>
      )}

      {/* ACCIONES RÁPIDAS: el orden de los OBJETOS elegidos dentro de su capa.
          Apagadas sin selección, antes que sin efecto. */}
      <div className="flex shrink-0 gap-1 border-t border-border px-2 py-1.5">
        {ORDENES.map(({ id, rotulo, Icono: Ic }) => (
          <button
            key={id}
            type="button"
            onClick={() => onOrdenar(id)}
            disabled={!haySeleccion}
            title={rotulo}
            aria-label={rotulo}
            className="flex flex-1 items-center justify-center rounded border border-border py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <Ic className="size-3.5" />
          </button>
        ))}
      </div>

      <p className="shrink-0 px-2 pb-2 text-[0.625rem] leading-tight text-muted-foreground">
        Una capa bloqueada se ve pero no se puede seleccionar. Arrastrá una tarjeta para cambiar el orden.
      </p>
    </div>
  );
}
