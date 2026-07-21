import { useQuery } from '@tanstack/react-query';
import { api } from './cliente';

/**
 * QUÉ TAN VIEJO ES LO QUE EL VENDEDOR ESTÁ MIRANDO.
 *
 * ── El bug que esto mata ──
 * La bandeja abre filtrada por "les puedo escribir", que son los comentarios de
 * los últimos 7 días. Si la ingesta está detenida hace más de 7 días, ese filtro
 * devuelve CERO y la pantalla dice "Estás al día".
 *
 * Medido el 21-jul-2026 sobre la base real: 94.371 interacciones, 0 con la
 * ventana abierta — porque el último dato capturado era del 11-jul. La pantalla
 * felicitaba al vendedor por tener limpia una bandeja que en realidad no había
 * mirado en diez días.
 *
 * Un estado vacío indistinguible de un pipeline muerto es peor que un error: el
 * error te hace mirar, la calma falsa te manda a tu casa tranquilo.
 */
export type Frescura = {
  /** El evento más nuevo que tenemos. Lo que pasó en el mundo. */
  ultimoDato: string | null;
  /** Cuándo lo capturamos nosotros. La diferencia contra ultimoDato es el atraso. */
  ultimaIngesta: string | null;
  horasDesdeIngesta: number | null;
  total: number;
  /** < 6 h. El compromiso es que lo que ve el vendedor sea de esta jornada. */
  fresca: boolean;
};

export function useFrescura() {
  return useQuery({
    queryKey: ['frescura'],
    queryFn: () => api<Frescura>('/api/interactions/frescura'),
    /**
     * Se revalida sola cada minuto. Es el único dato de la pantalla que envejece
     * SIN que nadie haga nada: los demás cambian por acción humana, este cambia
     * por el mero paso del tiempo.
     */
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** "hace 3 minutos" / "hace 10 días". Sin librería: es una sola forma y un solo idioma. */
export function hace(horas: number | null): string {
  if (horas == null) return 'nunca';
  if (horas < 1) {
    const min = Math.max(1, Math.round(horas * 60));
    return `hace ${min} min`;
  }
  if (horas < 24) {
    const h = Math.round(horas);
    return `hace ${h} ${h === 1 ? 'hora' : 'horas'}`;
  }
  const d = Math.round(horas / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}
