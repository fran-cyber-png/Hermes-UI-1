import type { Importancia } from './importancia';
import { IMPORTANCIA_COLORES, etiquetaImportancia } from './importancia';

export function SelectorImportancia({
  valor,
  onChange,
  disabled = false,
}: {
  valor?: Importancia;
  onChange: (importancia: Importancia | undefined) => void;
  disabled?: boolean;
}) {
  const opciones: (Importancia | undefined)[] = [undefined, 'alta', 'media', 'baja'];

  return (
    <div className="flex gap-2 flex-wrap">
      {opciones.map((opcion) => {
        const esActiva = valor === opcion;
        const colores = opcion ? IMPORTANCIA_COLORES[opcion] : null;

        return (
          <button
            key={opcion || 'none'}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opcion)}
            className={`
              flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-normal transition-all
              ${esActiva
                ? colores
                  ? `${colores.bg} border-2 ${colores.border}`
                  : 'bg-gray-200 dark:bg-gray-700 border-2 border-gray-400 dark:border-gray-600'
                : 'border border-border hover:bg-secondary/30'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            {opcion ? (
              <>
                <span className={`w-2 h-2 rounded-full ${colores?.dot}`} />
                {etiquetaImportancia(opcion)}
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-gray-300" />
                ⚪ Sin definir
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
