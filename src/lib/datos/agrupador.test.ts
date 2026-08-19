import { describe, expect, it } from 'vitest';
import { crearAgrupador, type RelojDelAgrupador } from './agrupador';

/** Un reloj de mentira: guarda lo programado y lo dispara cuando el test quiere. */
function relojFalso() {
  const tareas = new Map<number, { fn: () => void; ms: number }>();
  let siguiente = 1;
  const reloj: RelojDelAgrupador = {
    programar: (fn, ms) => {
      const id = siguiente++;
      tareas.set(id, { fn, ms });
      return id;
    },
    cancelar: (id) => void tareas.delete(id),
  };
  return {
    reloj,
    pendientes: () => tareas.size,
    demoras: () => [...tareas.values()].map((t) => t.ms),
    correrTodo: () => {
      for (const [id, t] of [...tareas]) {
        tareas.delete(id);
        t.fn();
      }
    },
  };
}

describe('el agrupador junta invalidaciones en una ventana', () => {
  it('doce pedidos dentro de la ventana son UNA sola corrida', () => {
    const f = relojFalso();
    const ag = crearAgrupador(() => 15_000, f.reloj);
    let corridas = 0;
    for (let i = 0; i < 12; i++) ag.pedir(() => corridas++);

    expect(f.pendientes()).toBe(1);
    f.correrTodo();
    expect(corridas).toBe(1);
  });

  /**
   * 🔴 LA PROPIEDAD QUE SEPARA ESTO DE UN `debounce`, y la razón de existir del
   * módulo. Un debounce reinicia el reloj con cada pedido: bajo tráfico continuo
   * no corre NUNCA. Acá la ventana se abre una vez y vence pase lo que pase.
   */
  it('bajo tráfico continuo SÍ corre — no se muere de hambre', () => {
    const f = relojFalso();
    const ag = crearAgrupador(() => 15_000, f.reloj);
    let corridas = 0;

    for (let ronda = 0; ronda < 3; ronda++) {
      for (let i = 0; i < 5; i++) ag.pedir(() => corridas++);
      f.correrTodo(); // vence la ventana de esta ronda
    }

    expect(corridas).toBe(3); // una por ventana, no cero y no quince
  });

  it('después de que la ventana vence, el próximo pedido abre otra', () => {
    const f = relojFalso();
    const ag = crearAgrupador(() => 15_000, f.reloj);
    let corridas = 0;

    ag.pedir(() => corridas++);
    f.correrTodo();
    expect(corridas).toBe(1);

    ag.pedir(() => corridas++);
    expect(f.pendientes()).toBe(1);
    f.correrTodo();
    expect(corridas).toBe(2);
  });

  it('la demora se pregunta UNA vez por ventana, no por pedido', () => {
    const f = relojFalso();
    let consultas = 0;
    const ag = crearAgrupador(() => {
      consultas++;
      return 15_000;
    }, f.reloj);

    for (let i = 0; i < 5; i++) ag.pedir(() => {});
    expect(consultas).toBe(1);
  });

  it('cancelar tira lo pendiente y no corre nada', () => {
    const f = relojFalso();
    const ag = crearAgrupador(() => 15_000, f.reloj);
    let corridas = 0;

    ag.pedir(() => corridas++);
    ag.cancelar();
    f.correrTodo();
    expect(corridas).toBe(0);
    expect(f.pendientes()).toBe(0);
  });

  /**
   * ⚠️ Si `hacer` tira, la ventana tiene que quedar libre igual: con el flag
   * pendiente para siempre, la cola no se volvería a refrescar NUNCA — un error
   * transitorio se convertiría en una pantalla congelada hasta recargar.
   */
  it('un error adentro no deja la ventana trabada', () => {
    const f = relojFalso();
    const ag = crearAgrupador(() => 15_000, f.reloj);

    ag.pedir(() => {
      throw new Error('boom');
    });
    expect(() => f.correrTodo()).toThrow('boom');

    let corridas = 0;
    ag.pedir(() => corridas++);
    expect(f.pendientes()).toBe(1);
    f.correrTodo();
    expect(corridas).toBe(1);
  });

  it('el jitter sigue siendo del llamador: cada ventana puede tener otra demora', () => {
    const f = relojFalso();
    const demoras = [1000, 7000];
    let i = 0;
    const ag = crearAgrupador(() => demoras[i++]!, f.reloj);

    ag.pedir(() => {});
    expect(f.demoras()).toEqual([1000]);
    f.correrTodo();
    ag.pedir(() => {});
    expect(f.demoras()).toEqual([7000]);
  });
});
