import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * MI LÍNEA — la auto-vinculación desde la app (decisión del dueño, 15-ago-2026).
 *
 * Hasta acá vincular una línea era D13: un operador mirando `/vincular` o el
 * panel de Cerberus, y la app de la vendedora "no vincula, solo ve". Esto abre
 * una puerta segunda: una vendedora SIN línea propia trae la suya, sola, desde
 * `PanelUsuario`. Server: `server/src/routes/miLinea.ts`.
 */

export interface MiLinea {
  numero: string | null;
  sesion?: { estado: string };
}

export function useMiLinea() {
  return useQuery({
    queryKey: ['mi-linea'],
    queryFn: () => api<MiLinea>('/api/whatsapp/mi-linea'),
    // Como `useLineas`: esto cambia cuando alguien vincula, casi nunca sin que
    // una persona lo provoque a propósito.
    staleTime: 5 * 60_000,
  });
}

export type EstadoAutoVinculacion =
  | { estado: 'expirado' }
  | { estado: 'vinculando' }
  | { estado: 'esperando_qr'; qr: string }
  /**
   * `montada` la agrega el server desde el arreglo del montaje: la línea quedó
   * REGISTRADA seguro, y `false` significa que todavía no está atendiendo. Viaja
   * **opcional** a propósito — un server viejo no la manda, y ahí se lee como
   * «anduvo», que es lo que ese server efectivamente prometía.
   */
  | { estado: 'conectado'; numero: string; montada?: boolean }
  | { estado: 'baneado'; ban: { codigo: string; expira: string } }
  | { estado: 'error'; motivo: string };

/**
 * 🔴 LOS CUATRO ESTADOS DONDE YA NO HAY NADA QUE ESPERAR.
 *
 * Sin esto, el polling seguía cada 1,5 s **después** de conectar. Y el server, al
 * llegar a `conectado`, suelta el candado — así que el poll siguiente contesta
 * `expirado` y la pantalla que decía «¡Listo! Tu número quedó vinculado» pasaba a
 * **«La vinculación se cortó»** un segundo y medio después, sobre una línea que
 * había quedado perfecta. Lo mismo pisaba `error` y `baneado`: el motivo real
 * —que es lo único accionable— se reemplazaba por el genérico.
 *
 * `expirado` también es terminal: significa «el server no tiene nada mío». Seguir
 * preguntando no lo va a cambiar.
 */
export const ESTADOS_TERMINALES = ['conectado', 'baneado', 'error', 'expirado'] as const;

export function esEstadoTerminal(e: EstadoAutoVinculacion | undefined): boolean {
  return e !== undefined && (ESTADOS_TERMINALES as readonly string[]).includes(e.estado);
}

/** El ritmo de la consola de operador (`routes/vincular.ts`), sin inventar otro. */
export const RITMO_POLLING_MS = 1500;

/**
 * Cuánto esperar hasta el próximo poll, o `false` para no volver a preguntar.
 * Vive fuera del hook, pura y con test, por lo mismo que `presentacion.ts` de Ivi:
 * adentro de la opción de `useQuery` esta decisión no se puede interrogar.
 */
export function ritmoDePolling(e: EstadoAutoVinculacion | undefined): number | false {
  return esEstadoTerminal(e) ? false : RITMO_POLLING_MS;
}

/**
 * El polling del pareo en vuelo — mismo ritmo que la consola HTML de operador
 * (`routes/vincular.ts`). Solo corre mientras `activo` (o sea: después de que el
 * POST volvió 200, nunca antes), y **se apaga solo** al llegar a un estado
 * terminal.
 *
 * ⚠️ `refetchOnWindowFocus` apagado por lo mismo: volver a la ventana media hora
 * después no puede convertir un «¡Listo!» en «se cortó».
 */
export function useEstadoAutoVinculacion(activo: boolean) {
  return useQuery({
    queryKey: ['mi-linea', 'vincular', 'estado'],
    queryFn: () => api<EstadoAutoVinculacion>('/api/whatsapp/mi-linea/vincular/estado'),
    enabled: activo,
    refetchInterval: (query) => ritmoDePolling(query.state.data),
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

/**
 * Tira el estado del pareo anterior. Hace falta al reintentar: la queryKey es la
 * misma, así que sin esto el primer render del intento nuevo muestra el
 * `conectado`/`error` del intento viejo hasta que llegue el primer poll.
 */
export function useOlvidarEstadoAutoVinculacion() {
  const qc = useQueryClient();
  return () => qc.removeQueries({ queryKey: ['mi-linea', 'vincular', 'estado'] });
}

export function useIniciarAutoVinculacion() {
  return useMutation({
    mutationFn: (numero: string) =>
      api<{ estado: string }>('/api/whatsapp/mi-linea/vincular', {
        method: 'POST',
        body: JSON.stringify({ numero }),
      }),
  });
}

/** Invalida lo que cambia cuando la línea propia queda conectada. */
export function useInvalidarMiLinea() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['mi-linea'] });
    // `PanelUsuario` (vía `useLineas`) y el selector de la barra leen de acá:
    // sin esto, la línea recién conectada no aparece hasta la próxima recarga.
    void qc.invalidateQueries({ queryKey: ['lineas-whatsapp'] });
  };
}

export function useCancelarAutoVinculacion() {
  const invalidar = useInvalidarMiLinea();
  return useMutation({
    mutationFn: () =>
      api<{ estado: string; cancelada: boolean }>('/api/whatsapp/mi-linea/vincular', { method: 'DELETE' }),
    onSettled: invalidar,
  });
}
