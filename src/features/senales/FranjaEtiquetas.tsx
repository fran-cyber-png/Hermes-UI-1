import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import { useCategorias } from '../gestion/categorias';
import {
  claseBorde,
  CLASE_FONDO_TENUE,
  CLASE_TEXTO,
  resolverColor,
} from '../gestion/paletaCategorias';
import { useSenales } from './senales';

/**
 * LA FRANJA DE ETIQUETAS — lo que esta conversación es, de un vistazo.
 *
 * Dos familias en la misma línea, a propósito: el ojo lee «etiqueta» en las dos.
 * Lo que las distingue es el DIBUJO, no un ícono ni un tooltip:
 *
 *   · **automática** (`Cotizado`, `Se enfrió`) — píldora de FONDO tenue. La pone
 *     el hilo, se recalcula sola, no se puede borrar (ADR 0015).
 *   · **manual** (las categorías de #48) — píldora de BORDE de color. La pone la
 *     vendedora, y se edita donde siempre: en la barra de arriba del chat.
 *
 * Es de solo lectura. Duplicar el editor de categorías acá sería tener dos
 * lugares donde se hace lo mismo, con dos comportamientos que empiezan iguales.
 */

export function FranjaEtiquetas({ clave }: { clave: string }) {
  const { data: senales } = useSenales([clave]);
  const { data: categorias = [] } = useCategorias();
  const { data: manuales = [] } = useQuery({
    queryKey: ['etiquetas', clave],
    queryFn: () =>
      api<{ etiquetas: Record<string, string[]> }>(
        `/api/gestiones/etiquetas?claves=${encodeURIComponent(clave)}`,
      ),
    select: (d) => d.etiquetas[clave] ?? [],
  });

  const automaticas = senales?.senales[clave]?.etiquetas ?? [];
  if (automaticas.length === 0 && manuales.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {automaticas.map((e) => (
        <span
          key={e.clave}
          title={e.detalle}
          className={
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ' +
            CLASE_FONDO_TENUE[e.color] +
            ' ' +
            CLASE_TEXTO[e.color]
          }
        >
          {/* El punto hereda el color del texto de la píldora: un solo lugar donde
              vive el color, y nada que se pueda desincronizar. */}
          <span className="size-1.5 rounded-full bg-current" />
          {e.rotulo}
        </span>
      ))}

      {manuales.map((nombre) => (
        <span
          key={nombre}
          className={
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold text-foreground ' +
            claseBorde(resolverColor(nombre, categorias))
          }
        >
          {nombre}
        </span>
      ))}
    </div>
  );
}
