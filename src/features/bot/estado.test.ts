import { describe, expect, it } from 'vitest';
import {
  deDondeSaleElModo,
  porQueNoSeGuardo,
  puertaDelFreno,
  QUE_HACE,
  verBot,
  type RespuestaBotApi,
} from './estado';

/**
 * LO QUE ESTE ARCHIVO PROTEGE, en una línea: **que un estado que no se pudo leer
 * nunca se dibuje como «apagado»**.
 *
 * En un interruptor el falso OK es el peor error posible: la vendedora lee
 * «apagado» sobre un bot que le sigue escribiendo a leads reales. Por eso casi
 * todos los casos de acá miran lo mismo desde otro ángulo — el server mudo, el
 * server viejo, el server sin línea, un modo que esta app no conoce — y todos
 * afirman lo mismo: `clase !== 'apagado'` y `modo !== 'apagado'`.
 */

const VIVO: RespuestaBotApi = {
  numero: '51984429504',
  habilitada: true,
  modoEfectivo: 'automatico',
  modoDeLaBase: null,
  modoDelEntorno: 'automatico',
  frenado: false,
  frenadoMotivo: null,
};

describe('lo que no se pudo leer NO se dibuja como apagado', () => {
  it('el server mudo es «sin señal», y no se puede cambiar nada desde ahí', () => {
    const v = verBot(undefined);
    expect(v.clase).toBe('desconocida');
    expect(v.modo).toBeNull();
    expect(v.puedeCambiar).toBe(false);
    expect(v.detalle).toMatch(/no quiere decir que esté apagado/i);
  });

  it('el server SIN LA RUTA no dibuja nada: ahí esta feature no existe', () => {
    const v = verBot(undefined, { sinRuta: true });
    expect(v.clase).toBe('ausente');
    expect(v.modo).toBeNull();
  });

  it('el 400 «no sé sobre qué línea» se dice, y nombra las DOS causas posibles', () => {
    const v = verBot(undefined, { sinLinea: true });
    expect(v.clase).toBe('sin-linea');
    expect(v.modo).toBeNull();
    expect(v.puedeCambiar).toBe(false);
    // No se adivina cuál de las dos es: el motivo viaja en `error` y no llega acá.
    expect(v.detalle).toMatch(/BOT_LINEAS/);
    expect(v.detalle).toMatch(/varias/);
  });

  it('un modo que esta app no conoce se DICE, y aun así se puede apagar', () => {
    const v = verBot({ ...VIVO, modoEfectivo: 'automatiko' });
    expect(v.clase).toBe('desconocida');
    expect(v.modo).toBeNull();
    // 🔴 Lo importante de la rama: el kill-switch tiene que servir sobre todo
    // cuando el estado no se entiende.
    expect(v.puedeCambiar).toBe(true);
    expect(v.aviso).toBe('modo raro');
  });
});

describe('el freno', () => {
  it('gana sobre el modo, y NOMBRA el modo al que se vuelve al soltarlo', () => {
    const v = verBot({ ...VIVO, frenado: true, frenadoMotivo: 'temporary_ban' });
    expect(v.clase).toBe('frenado');
    expect(v.modo).toBe('automatico');
    expect(v.detalle).toMatch(/temporary_ban/);
    expect(v.detalle).toMatch(/vuelve a «Automático»/);
    // 🔴 El rótulo ruidoso no es decorativo: sin él, el selector muestra
    // «Automático» puesto y eso se lee como «está mandando».
    expect(v.aviso).toBe('frenado');
  });

  it('el caso sano NO lleva rótulo: gritar siempre es no gritar nunca', () => {
    expect(verBot(VIVO).aviso).toBeNull();
  });

  it('un motivo sin `frenado` se lee como FRENADO: se sobre-reporta la parada', () => {
    const v = verBot({ ...VIVO, frenado: false, frenadoMotivo: 'lo frenó Luz' });
    expect(v.frenado).toBe(true);
    expect(v.clase).toBe('frenado');
  });

  it('con el modo raro el freno se nombra igual: es lo único que se sabe con certeza', () => {
    const v = verBot({ ...VIVO, modoEfectivo: 'xxx', frenado: true, frenadoMotivo: 'a mano' });
    expect(v.detalle).toMatch(/FRENADA/);
    expect(puertaDelFreno(v)).toEqual({ abre: true, texto: 'a mano · soltar' });
  });

  it('sin freno el renglón NO es botón y dice de dónde sale el modo', () => {
    const puerta = puertaDelFreno(verBot(VIVO));
    expect(puerta.abre).toBe(false);
    expect(puerta.texto).toMatch(/BOT_MODO=automatico/);
  });
});

describe('de dónde sale el modo — la pregunta de las 2 AM', () => {
  it('sin fila en la base manda el entorno, y lo dice con la variable', () => {
    expect(deDondeSaleElModo({ modoDeLaBase: null, modoDelEntorno: 'automatico' })).toBe(
      'del entorno (BOT_MODO=automatico) · nadie lo tocó desde acá',
    );
  });

  it('con fila manda la fila, y se nombra el desacuerdo con el entorno', () => {
    expect(deDondeSaleElModo({ modoDeLaBase: 'apagado', modoDelEntorno: 'automatico' })).toBe(
      'puesto desde acá · el entorno dice «Automático»',
    );
  });

  it('cuando coinciden se dice que coinciden: no es lo mismo que nadie lo haya tocado', () => {
    expect(deDondeSaleElModo({ modoDeLaBase: 'sombra', modoDelEntorno: 'sombra' })).toBe(
      'puesto desde acá · el entorno dice lo mismo',
    );
  });

  it('un server que no manda ninguna de las dos no se inventa una fuente', () => {
    expect(deDondeSaleElModo({})).toBe('no dice de dónde sale');
  });
});

describe('la línea que el bot ni mira', () => {
  it('`habilitada: false` es «sin efecto», no «apagado»: el modo guardado sigue ahí', () => {
    const v = verBot({ ...VIVO, habilitada: false, modoEfectivo: 'apagado', modoDeLaBase: 'apagado' });
    expect(v.clase).toBe('sin-efecto');
    expect(v.modo).toBe('apagado');
    expect(v.aviso).toBe('sin efecto');
    expect(v.detalle).toMatch(/BOT_LINEAS/);
  });

  it('frenado le gana a sin-efecto, y el detalle menciona las dos cosas', () => {
    const v = verBot({ ...VIVO, habilitada: false, frenado: true, frenadoMotivo: 'ban' });
    expect(v.clase).toBe('frenado');
    expect(v.detalle).toMatch(/BOT_LINEAS/);
  });
});

describe('el caso normal', () => {
  it('cada modo es su propia clase y se puede cambiar', () => {
    for (const modo of ['apagado', 'sombra', 'automatico'] as const) {
      const v = verBot({ ...VIVO, modoEfectivo: modo });
      expect(v.clase).toBe(modo);
      expect(v.modo).toBe(modo);
      expect(v.puedeCambiar).toBe(true);
    }
  });

  it('la descripción del SERVER le gana a la copia del front (una sola fuente viva)', () => {
    const v = verBot({ ...VIVO, modos: [{ modo: 'sombra', descripcion: 'lo que diga el server' }] });
    expect(v.queHace.sombra).toBe('lo que diga el server');
    // Las que el server no mandó conservan el respaldo, en vez de quedar vacías.
    expect(v.queHace.automatico).toBe(QUE_HACE.automatico);
  });

  it('una descripción vacía del server NO borra la del front', () => {
    const v = verBot({ ...VIVO, modos: [{ modo: 'sombra', descripcion: '   ' }] });
    expect(v.queHace.sombra).toBe(QUE_HACE.sombra);
  });
});

describe('por qué no se guardó — se lee del status, y nunca dice «ya está apagado»', () => {
  it('el 503 nombra la migración que falta', () => {
    expect(porQueNoSeGuardo(503)).toMatch(/bot_estado/);
  });

  it('todas empiezan por NO se guardó: un cambio que falló no puede parecer aplicado', () => {
    for (const status of [400, 401, 403, 500, 503, null]) {
      expect(porQueNoSeGuardo(status)).toMatch(/^NO se guardó/);
    }
  });
});
