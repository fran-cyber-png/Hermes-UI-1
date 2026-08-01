export interface CampoMeta {
  label: string;
  /** '' → el par se muestra con «—» (el campo existe, sin valor). */
  valor: string;
  onClick?: () => void;
}

function contenidoDelPar(campo: CampoMeta) {
  return (
    <>
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {campo.label}
      </span>
      <span className="mt-0.5 block truncate text-[13px] font-medium text-foreground">
        {campo.valor || '—'}
      </span>
    </>
  );
}

/**
 * La meta es pares label/valor, no celdas con icono dentro de una card
 * (V2-4): grid simple, sin borde, sin fondo. A 13 px la campaña se lee
 * entera — a 15 px en una celda, se truncaba a ~13 caracteres.
 */
export function BloqueMeta({ campos }: { campos: CampoMeta[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 max-[340px]:grid-cols-1">
      {campos.map((campo) =>
        campo.onClick ? (
          <button
            key={campo.label}
            type="button"
            onClick={campo.onClick}
            className="-mx-1 rounded-md px-1 text-left transition-colors hover:bg-muted"
          >
            {contenidoDelPar(campo)}
          </button>
        ) : (
          <div key={campo.label} className="-mx-1 px-1">
            {contenidoDelPar(campo)}
          </div>
        ),
      )}
    </div>
  );
}

/** Dos pares label+barra; el ancho de la barra refleja cuántos campos habrá. */
export function BloqueMetaSkeleton({ cantidad }: { cantidad: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 max-[340px]:grid-cols-1" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="animate-pulse">
          <span className="block h-2.5 w-14 rounded bg-muted" />
          <span className={`mt-1.5 block h-3.5 rounded bg-muted ${cantidad > 2 ? 'w-24' : 'w-16'}`} />
        </div>
      ))}
    </div>
  );
}
