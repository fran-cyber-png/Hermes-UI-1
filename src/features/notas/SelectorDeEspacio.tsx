import { useState } from 'react';
import { Check, Lock, Plus, Users, X } from 'lucide-react';
import {
  type DondeEstoy,
  type Espacio,
  nombreCorto,
  puedoAdministrar,
  useEspacios,
  useMutacionesEspacios,
  usePadron,
} from './espacios';

/**
 * DÓNDE ESTOY ESCRIBIENDO — el selector que encabeza la lista de páginas.
 *
 * ══ LA LIBRETA PRIVADA VA PRIMERA Y NO SE PUEDE SACAR ═══════════════════════
 *
 * No sale de la lista del server (es implícita, `espacioId === null`), así que se
 * dibuja acá a mano y siempre arriba. Es deliberado: quien no crea ni un espacio
 * tiene que ver **exactamente la Libreta de antes**, con un renglón de más.
 *
 * ══ EL CANDADO Y LA GENTE SON LA MISMA INFORMACIÓN ══════════════════════════
 *
 * 🔒 privado · 👥 compartido. **Sin oro**: el dorado significa tiempo que se
 * acaba y acá no se acaba nada. Y el ícono no es decoración — es lo único que
 * contesta la pregunta que una vendedora se hace antes de escribir un precio mal
 * puesto: «¿esto lo ve alguien más?».
 */

function FilaDeLugar({
  activo,
  onIr,
  icono,
  nombre,
  detalle,
}: {
  activo: boolean;
  onIr: () => void;
  icono: React.ReactNode;
  nombre: string;
  detalle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onIr}
      aria-current={activo ? 'true' : undefined}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
        activo ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted'
      }`}
    >
      <span className="shrink-0">{icono}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{nombre}</span>
      {detalle && <span className="shrink-0 text-[0.6875rem] text-muted-foreground">{detalle}</span>}
    </button>
  );
}

/**
 * CREAR UN ESPACIO. Los miembros se eligen del padrón — **no hay campo libre**,
 * y ése es el punto: Hermes no tiene tabla de usuarios, así que un nombre
 * tipeado a mano escribe una fila válida y esa persona no ve el espacio nunca,
 * sin un solo síntoma. El server igual rechaza con 409; esto es para que no se
 * llegue.
 */
function NuevoEspacio({ onListo, onCancelar }: { onListo: () => void; onCancelar: () => void }) {
  const [nombre, setNombre] = useState('');
  const [elegidos, setElegidos] = useState<string[]>([]);
  const padron = usePadron(true);
  const { crear } = useMutacionesEspacios();

  const puedeGuardar = nombre.trim().length > 0 && !crear.isPending;

  return (
    <form
      className="space-y-2 rounded-lg border border-border bg-card p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!puedeGuardar) return;
        crear.mutate({ nombre: nombre.trim(), miembros: elegidos }, { onSuccess: onListo });
      }}
    >
      <input
        autoFocus
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Nombre del espacio"
        aria-label="Nombre del espacio"
        maxLength={80}
        className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
      />

      <div>
        <p className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Quiénes entran</p>
        {padron.isPending && <p className="text-xs text-muted-foreground">Cargando…</p>}
        {padron.isError && <p className="text-xs text-destructive">No pude traer la lista de gente.</p>}
        <div className="flex flex-wrap gap-1">
          {(padron.data ?? []).map((p) => {
            const puesto = elegidos.includes(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={puesto}
                onClick={() => setElegidos((prev) => (puesto ? prev.filter((x) => x !== p) : [...prev, p]))}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                  puesto ? 'border-primary bg-secondary text-foreground' : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {puesto && <Check className="size-3" />}
                {nombreCorto(p)}
              </button>
            );
          })}
        </div>
        {/* Lo que la pantalla NO puede dejar de decir: quien crea entra siempre.
            Sin esto, elegir a nadie se lee como «un espacio vacío». */}
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">Vos entrás siempre. Podés sumar gente después.</p>
      </div>

      {crear.isError && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {crear.error instanceof Error ? crear.error.message : 'No se pudo crear'}
        </p>
      )}

      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={!puedeGuardar}
          className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
        >
          {crear.isPending ? 'Creando…' : 'Crear'}
        </button>
        <button type="button" onClick={onCancelar} className="rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted">
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Administrar un espacio: su nombre, sus miembros, y archivarlo. Solo quien lo creó. */
function Miembros({ espacio, onCerrar, onArchivado }: { espacio: Espacio; onCerrar: () => void; onArchivado: () => void }) {
  const padron = usePadron(true);
  const { agregarMiembro, sacarMiembro, renombrar, archivar } = useMutacionesEspacios();
  const [nombre, setNombre] = useState(espacio.nombre);
  const adentro = new Set(espacio.miembros.map((m) => m.trim().toLowerCase()));

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-center justify-between">
        <p className="truncate text-xs font-medium text-foreground">El espacio «{espacio.nombre}»</p>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded p-0.5 text-muted-foreground hover:bg-muted">
          <X className="size-3.5" />
        </button>
      </div>

      {/* RENOMBRAR. Guarda al salir del campo y con Enter: sin esto, un nombre mal
          puesto no tenía arreglo desde la app — había que archivar el espacio y
          rehacerlo, moviendo las páginas a mano. */}
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onBlur={() => {
          const limpio = nombre.trim();
          if (limpio && limpio !== espacio.nombre) renombrar.mutate({ espacioId: espacio.id, nombre: limpio });
          else setNombre(espacio.nombre);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          // Escape descarta y NO se propaga: el shell no tiene por qué enterarse
          // de que alguien se arrepintió de un nombre.
          if (e.key === 'Escape') {
            e.stopPropagation();
            setNombre(espacio.nombre);
            e.currentTarget.blur();
          }
        }}
        aria-label="Nombre del espacio"
        maxLength={80}
        className="h-7 w-full rounded border border-input bg-card px-2 text-xs outline-none focus:border-ring"
      />

      <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Quiénes lo ven</p>

      <div className="flex flex-wrap gap-1">
        {(padron.data ?? []).map((p) => {
          const esta = adentro.has(p.trim().toLowerCase());
          // 🔴 A LA CREADORA NO SE LA PUEDE SACAR, y el botón lo dice antes de que
          // el server lo rechace: el espacio quedaría sin nadie que pueda
          // administrarlo (agregar exige ser la creadora, ver exige ser miembro).
          const esLaCreadora = p.trim().toLowerCase() === espacio.creadaPor.trim().toLowerCase();
          return (
            <button
              key={p}
              type="button"
              disabled={esLaCreadora}
              title={esLaCreadora ? 'Creó el espacio: no se puede sacar' : undefined}
              onClick={() =>
                esta
                  ? sacarMiembro.mutate({ espacioId: espacio.id, vendedoraId: p })
                  : agregarMiembro.mutate({ espacioId: espacio.id, vendedoraId: p })
              }
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition disabled:opacity-60 ${
                esta ? 'border-primary bg-secondary text-foreground' : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {esta && <Check className="size-3" />}
              {nombreCorto(p)}
            </button>
          );
        })}
      </div>

      {/* ARCHIVAR. La ruta existía desde ADR 0046 y NO tenía botón: un espacio que
          ya no hacía falta se quedaba en la lista para siempre. Archivar el lugar
          NO toca las páginas — siguen en la base, y por eso no se pregunta como si
          fuera un borrado. */}
      <button
        type="button"
        onClick={() => archivar.mutate(espacio.id, { onSuccess: onArchivado })}
        className="text-xs text-muted-foreground hover:text-destructive hover:underline"
      >
        Archivar este espacio
      </button>
      <p className="text-[0.6875rem] text-muted-foreground">
        Las páginas no se borran, pero dejan de estar a la vista del equipo.
      </p>
    </div>
  );
}

export function SelectorDeEspacio({
  donde,
  onIr,
  vendedoraId,
}: {
  donde: DondeEstoy;
  onIr: (donde: DondeEstoy) => void;
  vendedoraId: string | null | undefined;
}) {
  const [creando, setCreando] = useState(false);
  const [administrando, setAdministrando] = useState<number | null>(null);
  const espacios = useEspacios();

  const lista = espacios.data ?? [];
  const actual = lista.find((e) => e.id === donde);
  const puedoTocarEste = Boolean(actual && puedoAdministrar(actual, vendedoraId));

  return (
    <div className="space-y-0.5 border-b border-border px-2 py-2">
      <FilaDeLugar
        activo={donde === null}
        onIr={() => onIr(null)}
        icono={<Lock className="size-3.5" />}
        nombre="Mi libreta"
        detalle="solo vos"
      />

      {lista.map((e) => (
        <FilaDeLugar
          key={e.id}
          activo={donde === e.id}
          onIr={() => onIr(e.id)}
          icono={<Users className="size-3.5" />}
          nombre={e.nombre}
          detalle={`${e.miembros.length}`}
        />
      ))}

      {/* ⚠️ Un fallo al traer los espacios SE DICE. Sin esto, la lista se dibuja
          con «Mi libreta» sola y se lee como «no tenés ningún espacio» — que es
          una afirmación sobre datos que no se pudieron leer. */}
      {espacios.isError && <p className="px-2.5 py-1 text-xs text-destructive">No pude traer tus espacios.</p>}

      {administrando !== null && actual && administrando === actual.id ? (
        <div className="pt-1">
          <Miembros
            espacio={actual}
            onCerrar={() => setAdministrando(null)}
            // Al archivarlo desaparece de la lista: hay que volver a la libreta o
            // el selector queda apuntando a un lugar que ya no existe.
            onArchivado={() => {
              setAdministrando(null);
              onIr(null);
            }}
          />
        </div>
      ) : (
        puedoTocarEste && (
          <button
            type="button"
            // Abrir uno cierra el otro: son dos formularios que viven en el
            // MISMO lugar de una barra de 19rem, y con los dos abiertos la lista
            // de páginas queda empujada fuera de la pantalla.
            onClick={() => {
              setCreando(false);
              setAdministrando(actual!.id);
            }}
            className="w-full rounded-lg px-2.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Administrar «{actual!.nombre}»…
          </button>
        )
      )}

      {creando ? (
        <div className="pt-1">
          <NuevoEspacio onListo={() => setCreando(false)} onCancelar={() => setCreando(false)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdministrando(null);
            setCreando(true);
          }}
          className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" />
          Nuevo espacio
        </button>
      )}
    </div>
  );
}
