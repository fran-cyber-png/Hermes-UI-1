import { useEffect, useState } from 'react';
import type { MensajeBandeja } from './bandeja';
import { useBandeja, type ResultadoAprobar } from './datos';
import { enFila, proximaTrasResolver, quedanTras, saltar } from './revision';

/**
 * EL MODO REVISIÓN — quién está abierta, a cuál se va, y qué se le dijo al
 * server (ADR 0018).
 *
 * Todo el estado del modo vive acá y no repartido en el shell, porque son tres
 * cosas que solo tienen sentido juntas: la fila, la que está abierta, y el
 * recibo de lo último que se resolvió. Separarlas dejaría al shell decidiendo
 * «a cuál voy», que es justo lo que `revision.ts` tiene con tests.
 *
 * ── El detalle que hace que se pueda ir rápido ──
 * Al aprobar, el foco se mueve **antes** de que vuelva el server: la próxima se
 * calcula sobre la fila que ya está en pantalla (`proximaTrasResolver`) y recién
 * después se invalida. Si se esperara el refetch, entre el click y el salto
 * habría medio segundo en el que la pantalla muestra algo que ya se aprobó — y
 * la vendedora que va rápido aprueba dos veces.
 *
 * ── Salir solo ──
 * Cuando no queda ninguna, el modo se apaga. Quedarse en una pantalla vacía que
 * dice «revisión» obliga a un click extra para volver a la cola de siempre, que
 * es donde hay que estar cuando ya no hay nada que revisar.
 */
export function useModoRevision() {
  const [activo, setActivo] = useState(false);
  const [actualId, setActualId] = useState<number | null>(null);
  const [recibo, setRecibo] = useState<ResultadoAprobar | null>(null);

  const { datos, cargando, error, aprobar, descartar } = useBandeja(activo);

  const grupos = datos?.grupos ?? [];
  const fila = enFila(grupos);
  const actual = fila.find((m) => m.id === actualId) ?? null;

  // Al entrar (o cuando el refetch trae una fila donde la abierta ya no está),
  // se abre la primera. Nunca se queda sin ninguna abierta teniendo trabajo:
  // la columna del medio vacía en modo revisión no dice nada.
  useEffect(() => {
    if (!activo) return;
    if (fila.length === 0) return;
    if (actualId !== null && fila.some((m) => m.id === actualId)) return;
    setActualId(fila[0].id);
  }, [activo, actualId, fila]);

  // Se apaga solo al quedarse sin nada. `cargando` lo frena: apagarse mientras
  // se pide la bandeja cerraría el modo apenas se abre.
  useEffect(() => {
    if (activo && !cargando && !error && fila.length === 0 && datos) setActivo(false);
  }, [activo, cargando, error, fila.length, datos]);

  function entrar() {
    setRecibo(null);
    setActivo(true);
  }

  function salir() {
    setActivo(false);
    setActualId(null);
    setRecibo(null);
  }

  /** Mueve el foco ANTES de que conteste el server (ver arriba). */
  function correrElFoco(resueltos: readonly number[]) {
    if (resueltos.length === 1 && actualId === resueltos[0]) {
      setActualId(proximaTrasResolver(fila, resueltos[0]));
      return;
    }
    const quedan = quedanTras(fila, resueltos);
    setActualId(quedan[0]?.id ?? null);
  }

  /**
   * El array es el contrato del server (`POST /aprobar` reparte N con el mismo
   * `programar.ts`), pero desde #166 la UI manda SIEMPRE uno: el botón de lote
   * de la cabecera se retiró y aprobar es por conversación. Lo de abajo se
   * queda igual por eso mismo — si algún día vuelve a entrar más de uno, el
   * texto editado de la abierta no puede viajar para los otros: le pondría a
   * once personas una respuesta que no era la suya.
   */
  function aprobarIds(ids: number[], texto?: string) {
    if (ids.length === 0) return;
    const textos = ids.length === 1 && texto ? { [String(ids[0])]: texto } : undefined;
    correrElFoco(ids);
    aprobar.mutate({ ids, ...(textos ? { textos } : {}) }, { onSuccess: setRecibo });
  }

  function descartarIds(ids: number[]) {
    if (ids.length === 0) return;
    correrElFoco(ids);
    setRecibo(null);
    descartar.mutate({ ids });
  }

  function descartarTodo() {
    setActualId(null);
    setRecibo(null);
    descartar.mutate({ todas: true });
  }

  return {
    activo,
    grupos,
    fila,
    actual,
    actualId,
    recibo,
    cargando,
    error,
    trabajando: aprobar.isPending || descartar.isPending,
    entrar,
    salir,
    abrir: (m: MensajeBandeja) => setActualId(m.id),
    saltar: (p: 1 | -1) => setActualId(saltar(fila, actualId, p)),
    aprobarIds,
    descartarIds,
    descartarTodo,
    cerrarRecibo: () => setRecibo(null),
  };
}
