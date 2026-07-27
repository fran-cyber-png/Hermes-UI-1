import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * LAS LÍNEAS DE WHATSAPP QUE ESTÁN CORRIENDO (#50) — para poder recortar la cola
 * a una sola.
 *
 * Existe porque el equipo dejó de vender por un solo número: la línea de la
 * Escuela y la de cada vendedora entran a la MISMA cola, y sin forma de
 * separarlas cada una lee la conversación de la otra para llegar a la suya.
 *
 * Lo que llega es lo que el gestor tiene VIVO, no lo que Cerberus registró:
 * ofrecer como filtro una línea que no arrancó daría una cola vacía sin decir
 * por qué (`server/src/routes/whatsapp.ts`).
 */
export interface LineaWhatsapp {
  /** El número propio, canónico (solo dígitos con código de país). */
  numero: string;
  /** El nombre visible («Walter»). Cae al número si nadie lo registró. */
  etiqueta: string;
  estado: string;
}

export function useLineas() {
  const q = useQuery({
    queryKey: ['lineas-whatsapp'],
    queryFn: () => api<{ lineas: LineaWhatsapp[] }>('/api/whatsapp/lineas'),
    // Las líneas cambian cuando alguien vincula un número, o sea casi nunca y
    // nunca sin que una persona lo provoque. Refrescarlas con el pulso de la
    // cola sería una consulta por minuto para un dato que dura semanas.
    staleTime: 5 * 60_000,
  });

  const lineas = q.data?.lineas ?? [];
  return {
    lineas,
    /**
     * Con UNA sola línea el filtro no existe: un selector de un solo elemento no
     * es una elección, es ruido en una barra que ya está llena. Aparece solo
     * cuando hay algo que separar — que es también cómo esta app se comportaba
     * antes de que hubiera dos.
     */
    hayVarias: lineas.length > 1,
    cargando: q.isPending,
  };
}
