// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montar, type Montado } from '../../pruebas/dom';
import { ErrorApi } from '../../lib/datos/cliente';
import { useAutoguardado, type DestinoDeGuardado, type PuertasDeGuardado } from './useAutoguardado';
import { renglonDeEstado } from './guardado';

/**
 * EL AUTOGUARDADO, MONTADO — los tres defectos que salieron de tenerlo suelto
 * adentro de `Libreta.tsx`, cada uno con su test.
 *
 * Las puertas se INYECTAN (`PuertasDeGuardado`), así que acá no hay red ni
 * TanStack: lo que se mide es la máquina —cuándo dispara, qué hace con el
 * error, y qué pasa al salir—, que es donde estaban los bugs.
 *
 * La espera real son 800 ms; los tests adelantan el reloj para no dormir.
 *
 * ⚠️ DOS TRAMPAS DEL RELOJ FALSO, las dos pagadas acá:
 *
 *  1. Va ACOTADO a `setTimeout`/`clearTimeout`, que es lo único que usa el hook.
 *     Falseándolos todos (el default de vitest) el scheduler de React se queda
 *     sin con qué pintar y el componente **no renderiza**.
 *  2. **No se puede usar `reposar()`** de `pruebas/dom.tsx`: adentro hace un
 *     `setTimeout(…, 0)` que, falseado, no vence nunca — el test se cuelga hasta
 *     el timeout de 5 s y deja el DOM sucio para los que siguen. Acá se asienta
 *     adelantando el reloj, que es lo mismo pero con este reloj.
 */

/** Timers falsos, sólo los que el hook usa. */
function relojDeMentira() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

/** Adelanta el reloj y deja que React pinte lo que eso haya disparado. */
async function correrElReloj(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let montado: Montado | null = null;

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.useRealTimers();
});

/** Un anfitrión mínimo: escribe, muestra el estado, y deja cambiar de página. */
function Anfitrion({ puertas, idInicial = null }: { puertas: PuertasDeGuardado; idInicial?: number | null }) {
  const [id, setId] = useState<number | null>(idInicial);
  const { estado, alCambiar } = useAutoguardado({
    destino: id === null ? { tipo: 'nueva' } : { tipo: 'nota', id },
    puertas,
    alCrear: setId,
  });
  const r = renglonDeEstado(estado, false);
  return (
    <div>
      <button type="button" onClick={() => alCambiar({ doc: { escrito: true } })}>
        escribir
      </button>
      <p data-estado>{estado.tipo}</p>
      <p data-renglon>{r.texto}</p>
      <p data-id>{String(id)}</p>
    </div>
  );
}

/** Como el de arriba, más el botón que vuelve a poner la página en «nueva». */
function AnfitrionConCambioDePagina({ puertas }: { puertas: PuertasDeGuardado }) {
  const [id, setId] = useState<number | null>(null);
  const { estado, alCambiar } = useAutoguardado({
    destino: id === null ? { tipo: 'nueva' } : { tipo: 'nota', id },
    puertas,
    alCrear: setId,
  });
  return (
    <div>
      <button type="button" onClick={() => alCambiar({ doc: { escrito: true } })}>
        escribir
      </button>
      <button type="button" data-nueva onClick={() => setId(null)}>
        nueva
      </button>
      <p data-estado>{estado.tipo}</p>
      <p data-renglon>{estado.tipo}</p>
      <p data-id>{String(id)}</p>
    </div>
  );
}

function leer(m: Montado, campo: 'estado' | 'renglon' | 'id'): string {
  return m.contenedor.querySelector(`[data-${campo}]`)?.textContent ?? '';
}

function escribir(m: Montado) {
  act(() => {
    (m.contenedor.querySelector('button') as HTMLButtonElement).click();
  });
}

/** Deja correr los 800 ms de la espera y lo asíncrono que dispara. */
async function vencerLaEspera() {
  await correrElReloj(900);
}

describe('🔴 el fallo se VE', () => {
  it('un 400 deja el estado en fallo, con el motivo del server', async () => {
    relojDeMentira();
    const puertas: PuertasDeGuardado = {
      actualizar: () =>
        Promise.reject(new ErrorApi('la nota no puede superar los 2000 caracteres (tiene 2431)', 400)),
      crear: () => Promise.reject(new Error('no debería crear')),
    };
    montado = montar(<Anfitrion puertas={puertas} idInicial={7} />);

    escribir(montado);
    await vencerLaEspera();

    expect(leer(montado, 'estado')).toBe('fallo');
    expect(leer(montado, 'renglon')).toContain('2431');
    // Y lo que NO puede decir, que es el bug entero:
    expect(leer(montado, 'renglon')).not.toBe('Guardado');
  });

  it('cuando anda, dice guardado', async () => {
    relojDeMentira();
    const puertas: PuertasDeGuardado = {
      actualizar: () => Promise.resolve({}),
      crear: () => Promise.resolve({ nota: { id: 1 } as never }),
    };
    montado = montar(<Anfitrion puertas={puertas} idInicial={7} />);

    escribir(montado);
    await vencerLaEspera();

    expect(leer(montado, 'estado')).toBe('guardado');
  });
});

describe('🔴 la doble creación', () => {
  it('dos cambios seguidos en una página nueva crean UNA sola', async () => {
    relojDeMentira();
    let creaciones = 0;
    // El POST tarda: es la ventana en la que el segundo disparo veía `id: null`
    // y creaba otra página. La lista tarda todavía más (espera el refetch).
    const puertas: PuertasDeGuardado = {
      actualizar: () => Promise.resolve({}),
      crear: async () => {
        creaciones++;
        await new Promise((listo) => setTimeout(listo, 300));
        return { nota: { id: 42 } as never };
      },
    };
    montado = montar(<Anfitrion puertas={puertas} />);

    escribir(montado);
    await correrElReloj(900); // vence la espera → arranca el POST
    escribir(montado); // …y la vendedora sigue escribiendo mientras está en vuelo
    await correrElReloj(900);
    await correrElReloj(1000);

    expect(creaciones).toBe(1);
    expect(leer(montado, 'id')).toBe('42');
  });

  /**
   * La contracara del arreglo: el id creado se recuerda en un ref para no
   * depender del render, y ese ref **tiene que olvidarse** al cambiar de página.
   * Sin eso, «Nueva página» después de haber creado una escribiría ENCIMA de la
   * anterior — que es peor que el bug original.
   */
  it('empezar otra página nueva después de crear una NO pisa la anterior', async () => {
    relojDeMentira();
    const creados: unknown[] = [];
    const actualizados: number[] = [];
    const puertas: PuertasDeGuardado = {
      actualizar: (v) => {
        actualizados.push(v.id);
        return Promise.resolve({});
      },
      crear: () => {
        creados.push(1);
        return Promise.resolve({ nota: { id: 40 + creados.length } as never });
      },
    };
    montado = montar(<AnfitrionConCambioDePagina puertas={puertas} />);

    escribir(montado); // primera página nueva
    await vencerLaEspera();
    expect(leer(montado, 'id')).toBe('41');

    // La vendedora toca «Nueva página»: el de afuera vuelve a poner id = null.
    act(() => {
      (montado!.contenedor.querySelector('[data-nueva]') as HTMLButtonElement).click();
    });
    escribir(montado);
    await vencerLaEspera();

    expect(creados).toHaveLength(2);
    expect(actualizados, 'no puede haber tocado la página anterior').toEqual([]);
  });

  it('después de crearla, los cambios siguientes ACTUALIZAN esa página', async () => {
    relojDeMentira();
    const vistos: number[] = [];
    const puertas: PuertasDeGuardado = {
      actualizar: (v) => {
        vistos.push(v.id);
        return Promise.resolve({});
      },
      crear: () => Promise.resolve({ nota: { id: 42 } as never }),
    };
    montado = montar(<Anfitrion puertas={puertas} />);

    escribir(montado);
    await vencerLaEspera();
    escribir(montado);
    await vencerLaEspera();

    expect(vistos).toEqual([42]);
  });
});

describe('🔴 lo pendiente al salir', () => {
  it('desmontar ANTES de que venza la espera guarda igual', async () => {
    relojDeMentira();
    let guardados = 0;
    const puertas: PuertasDeGuardado = {
      actualizar: () => {
        guardados++;
        return Promise.resolve({});
      },
      crear: () => Promise.resolve({ nota: { id: 1 } as never }),
    };
    montado = montar(<Anfitrion puertas={puertas} idInicial={7} />);

    escribir(montado);
    await correrElReloj(200); // todavía no venció
    expect(guardados).toBe(0);

    montado.desmontar();
    montado = null;
    await correrElReloj(0);

    expect(guardados).toBe(1);
  });

  it('y no guarda DOS veces cuando la espera ya había vencido', async () => {
    relojDeMentira();
    let guardados = 0;
    const puertas: PuertasDeGuardado = {
      actualizar: () => {
        guardados++;
        return Promise.resolve({});
      },
      crear: () => Promise.resolve({ nota: { id: 1 } as never }),
    };
    montado = montar(<Anfitrion puertas={puertas} idInicial={7} />);

    escribir(montado);
    await vencerLaEspera();
    expect(guardados).toBe(1);

    montado.desmontar();
    montado = null;
    await correrElReloj(0);

    expect(guardados).toBe(1);
  });
});

describe('la espera agrupa', () => {
  it('escribir varias veces seguidas guarda UNA vez', async () => {
    relojDeMentira();
    let guardados = 0;
    const puertas: PuertasDeGuardado = {
      actualizar: () => {
        guardados++;
        return Promise.resolve({});
      },
      crear: () => Promise.resolve({ nota: { id: 1 } as never }),
    };
    montado = montar(<Anfitrion puertas={puertas} idInicial={7} />);

    escribir(montado);
    await correrElReloj(100);
    escribir(montado);
    await correrElReloj(100);
    escribir(montado);
    await vencerLaEspera();

    expect(guardados).toBe(1);
  });
});

/**
 * LO QUE ENCONTRÓ LA REVISIÓN ADVERSARIA — cuatro defectos con la misma forma:
 * el guardado salía hacia «la página abierta AHORA» en vez de hacia la que se
 * estaba editando cuando se agendó. Los 800 ms alcanzan de sobra para cambiar
 * de página.
 */

/** Anfitrión que permite saltar a cualquier destino, como la lista real. */
function AnfitrionConDestinos({
  puertas,
  inicial,
}: {
  puertas: PuertasDeGuardado;
  inicial: DestinoDeGuardado;
}) {
  const [destino, setDestino] = useState<DestinoDeGuardado>(inicial);
  const { estado, alCambiar } = useAutoguardado({ destino, puertas, alCrear: () => {} });
  return (
    <div>
      <button type="button" onClick={() => alCambiar({ doc: { escrito: true } })}>
        escribir
      </button>
      <button type="button" data-ir-b onClick={() => setDestino({ tipo: 'nota', id: 9 })}>
        ir a B
      </button>
      <button type="button" data-ir-nueva onClick={() => setDestino({ tipo: 'nueva' })}>
        nueva
      </button>
      <button type="button" data-ir-historica onClick={() => setDestino(null)}>
        histórica
      </button>
      <p data-estado>{estado.tipo}</p>
    </div>
  );
}

function tocar(m: Montado, marca: string) {
  act(() => {
    (m.contenedor.querySelector(`[data-${marca}]`) as HTMLButtonElement).click();
  });
}

describe('🔴 el destino se captura al AGENDAR, no al disparar', () => {
  function espia() {
    const actualizados: { id: number }[] = [];
    const creados: unknown[] = [];
    const puertas: PuertasDeGuardado = {
      actualizar: (v) => {
        actualizados.push({ id: v.id });
        return Promise.resolve({});
      },
      crear: (v) => {
        creados.push(v.doc);
        return Promise.resolve({ nota: { id: 99 } as never });
      },
    };
    return { puertas, actualizados, creados };
  }

  it('escribo en A y salto a B: se guarda en A, no en B', async () => {
    relojDeMentira();
    const { puertas, actualizados } = espia();
    montado = montar(<AnfitrionConDestinos puertas={puertas} inicial={{ tipo: 'nota', id: 7 }} />);

    escribir(montado);
    tocar(montado, 'ir-b'); // dentro de los 800 ms
    await vencerLaEspera();

    expect(actualizados).toEqual([{ id: 7 }]);
  });

  it('escribo en A y toco «Nueva página»: guarda A, NO duplica A', async () => {
    relojDeMentira();
    const { puertas, actualizados, creados } = espia();
    montado = montar(<AnfitrionConDestinos puertas={puertas} inicial={{ tipo: 'nota', id: 7 }} />);

    escribir(montado);
    tocar(montado, 'ir-nueva');
    await vencerLaEspera();

    expect(actualizados).toEqual([{ id: 7 }]);
    expect(creados, 'no puede haber creado una página fantasma').toHaveLength(0);
  });

  it('escribo en A y abro una página histórica: NO escribe con el id de `gestiones`', async () => {
    relojDeMentira();
    const { puertas, actualizados } = espia();
    montado = montar(<AnfitrionConDestinos puertas={puertas} inicial={{ tipo: 'nota', id: 7 }} />);

    escribir(montado);
    tocar(montado, 'ir-historica');
    await vencerLaEspera();

    expect(actualizados).toEqual([{ id: 7 }]);
  });

  it('sobre una página histórica no se guarda nada: su id es de otra tabla', async () => {
    relojDeMentira();
    const { puertas, actualizados, creados } = espia();
    montado = montar(<AnfitrionConDestinos puertas={puertas} inicial={null} />);

    escribir(montado);
    await vencerLaEspera();

    expect(actualizados).toHaveLength(0);
    expect(creados).toHaveLength(0);
  });
});

describe('🔴 lo tecleado mientras se crea la página NO se descarta', () => {
  it('sale como update apenas se sabe el id, y no queda diciendo «Guardado» sobre lo que no salió', async () => {
    relojDeMentira();
    const actualizados: unknown[] = [];
    let creaciones = 0;
    const puertas: PuertasDeGuardado = {
      // El POST tarda MÁS que la espera: es lo garantizado contra VPS1, porque
      // además del POST espera el refetch de la lista.
      crear: async (v) => {
        creaciones++;
        await new Promise((listo) => setTimeout(listo, 2000));
        return { nota: { id: 42, doc: v.doc } as never };
      },
      actualizar: (v) => {
        actualizados.push(v.doc);
        return Promise.resolve({});
      },
    };
    montado = montar(<Anfitrion puertas={puertas} />);

    escribir(montado);
    await correrElReloj(900); // vence la espera → arranca el POST (tarda 2 s)
    escribir(montado); // sigue tecleando mientras viaja
    await correrElReloj(900); // el segundo timer vence CON el POST en vuelo
    await correrElReloj(3000); // el POST resuelve

    expect(creaciones, 'una sola página').toBe(1);
    expect(actualizados, 'lo tecleado durante el POST tiene que haber salido').toHaveLength(1);
    expect(leer(montado, 'estado')).toBe('guardado');
  });
});

describe('el estado no se hereda entre páginas', () => {
  it('abrir otra página no muestra el «Guardado» de la anterior', async () => {
    relojDeMentira();
    const puertas: PuertasDeGuardado = {
      actualizar: () => Promise.resolve({}),
      crear: () => Promise.resolve({ nota: { id: 1 } as never }),
    };
    montado = montar(<AnfitrionConDestinos puertas={puertas} inicial={{ tipo: 'nota', id: 7 }} />);

    escribir(montado);
    await vencerLaEspera();
    expect(leer(montado, 'estado')).toBe('guardado');

    tocar(montado, 'ir-b');
    await correrElReloj(0);

    expect(leer(montado, 'estado')).toBe('quieto');
  });

  it('pero un FALLO no se borra al cambiar de página: sigue siendo verdad', async () => {
    relojDeMentira();
    const puertas: PuertasDeGuardado = {
      actualizar: () => Promise.reject(new ErrorApi('no se pudo', 400)),
      crear: () => Promise.resolve({ nota: { id: 1 } as never }),
    };
    montado = montar(<AnfitrionConDestinos puertas={puertas} inicial={{ tipo: 'nota', id: 7 }} />);

    escribir(montado);
    await vencerLaEspera();
    expect(leer(montado, 'estado')).toBe('fallo');

    tocar(montado, 'ir-b');
    await correrElReloj(0);

    expect(leer(montado, 'estado')).toBe('fallo');
  });
});
