import { describe, expect, test } from 'vitest';
import {
  MODOS,
  MODOS_ELEGIBLES,
  NOMBRE_MODO,
  horaCorta,
  modoDe,
  puertaDeRevision,
  resumenCola,
  resumenDeCola,
  verAutoRespuesta,
  type InterruptorApi,
  type ModoAutoRespuesta,
  type PendienteApi,
  type RespuestaAutoRespuesta,
} from './estado';

/**
 * EL ESTADO QUE VE LA VENDEDORA. Lo que se fija acá es que la pantalla no pueda
 * mentir: «apagada» y «frenada por un ban» son cosas distintas, «supervisada» y
 * «automática» no se pueden confundir (una espera tu OK, la otra ya mandó),
 * «encendida sin `AUTO_RESPUESTA=on` en el server» no manda nada y tiene que
 * decirlo, y sin la migración no se puede fingir un estado.
 */

const pendiente = (id: number, iso: string, estado = 'pendiente'): PendienteApi => ({
  id,
  telefono: `5196150000${id}`,
  estado,
  programadoPara: iso,
});

const interruptor = (over: Partial<InterruptorApi> = {}): InterruptorApi => ({
  encendida: false,
  motivo: null,
  actualizadoPor: null,
  actualizadoAt: null,
  ...over,
});

const respuesta = (over: Partial<RespuestaAutoRespuesta> = {}): RespuestaAutoRespuesta => ({
  habilitadaEnEntorno: true,
  interruptor: interruptor(),
  modo: 'apagada',
  pendientes: [],
  ...over,
});

const en = (modo: ModoAutoRespuesta, over: Partial<RespuestaAutoRespuesta> = {}) =>
  respuesta({
    modo,
    interruptor: interruptor({ encendida: modo !== 'apagada', modo, actualizadoPor: 'ana' }),
    ...over,
  });

describe('los estados que puede tener', () => {
  test('sin respuesta del server no inventa un estado', () => {
    const v = verAutoRespuesta(undefined);
    expect(v.clase).toBe('desconocida');
    expect(v.puedeCambiar).toBe(false);
  });

  test('contra un server VIEJO (404) no muestra nada: ahí la feature no existe', () => {
    const v = verAutoRespuesta(undefined, { sinRuta: true });
    expect(v.clase).toBe('ausente');
    expect(v.puedeCambiar).toBe(false);
  });

  test('sin la migración lo dice, y no deja cambiar de modo', () => {
    const v = verAutoRespuesta({ sinTablas: true, mensaje: 'faltan las tablas: corré `npm run db:push`' });
    expect(v.clase).toBe('sin-migracion');
    expect(v.etiqueta).toMatch(/migración/);
    expect(v.detalle).toMatch(/db:push/);
    expect(v.puedeCambiar).toBe(false);
  });

  test('apagada a mano: se puede cambiar, y avisa del simulacro', () => {
    const v = verAutoRespuesta(en('apagada'));
    expect(v.clase).toBe('apagada');
    expect(v.modo).toBe('apagada');
    expect(v.detalle).toMatch(/simulacro/);
  });

  test('apagada por el FRENO automático es un estado propio, no «apagada» a secas', () => {
    const v = verAutoRespuesta(
      respuesta({
        interruptor: interruptor({
          motivo: 'freno automático: el número está suspendido por WhatsApp (código 191, se levanta mañana)',
          actualizadoPor: 'sistema',
        }),
      }),
    );
    expect(v.clase).toBe('frenada');
    expect(v.detalle).toMatch(/suspendido por WhatsApp/);
    expect(v.puedeCambiar).toBe(true);
  });

  test('SUPERVISADA dice cuántas te esperan, no cuántas salieron', () => {
    const v = verAutoRespuesta(en('supervisada', { esperandoAprobacion: 12 }));
    expect(v.clase).toBe('supervisada');
    expect(v.esperandoAprobacion).toBe(12);
    expect(v.detalle).toMatch(/esperando tu OK/);
    expect(v.detalle).toMatch(/No sale ninguno/);
  });

  test('supervisada sin nada esperando no alarma, pero se sigue viendo prendida', () => {
    const v = verAutoRespuesta(en('supervisada'));
    expect(v.clase).toBe('supervisada');
    expect(v.detalle).toMatch(/no hay nada esperando/);
  });

  test('AUTOMÁTICA se muestra como lo que es desde ADR 0018: un modo RETIRADO del que hay que salir', () => {
    // Ya no se llega acá eligiéndolo: se hereda. Si la pantalla dijera
    // «automática» a secas, nadie entendería por qué el selector no la tiene —
    // y lo importante (está mandando sola) quedaría dicho igual que antes.
    const v = verAutoRespuesta(en('automatica', { pendientes: [pendiente(1, '2026-07-26T12:40:00Z')] }));
    expect(v.clase).toBe('automatica');
    expect(v.etiqueta).toMatch(/RETIRADO/);
    expect(v.detalle).toMatch(/manda sola/);
    // La salida tiene que estar abierta: heredarlo no puede ser una trampa.
    expect(v.puedeCambiar).toBe(true);
  });

  test('encendida pero sin `AUTO_RESPUESTA=on` en el server: NO manda nada y lo dice', () => {
    const v = verAutoRespuesta(en('automatica', { habilitadaEnEntorno: false }));
    expect(v.clase).toBe('sin-efecto');
    expect(v.detalle).toMatch(/no se prepara ni se manda nada/);
    expect(v.etiqueta).toMatch(/automática \(sin efecto\)/);
  });
});

describe('el modo, leído de lo que conteste el server', () => {
  test('el modo declarado manda', () => {
    expect(modoDe({ modo: 'supervisada' })).toBe('supervisada');
  });

  test('un server anterior a ADR 0016 solo manda el booleano: prendido era automática', () => {
    expect(modoDe({ interruptor: interruptor({ encendida: true }) })).toBe('automatica');
    expect(modoDe({ interruptor: interruptor({ encendida: false }) })).toBe('apagada');
  });

  test('un modo que no conozco no se toma por bueno', () => {
    expect(modoDe({ modo: 'turbo' as ModoAutoRespuesta, interruptor: interruptor() })).toBe('apagada');
  });
});

describe('el resumen de la cola', () => {
  test('cuenta lo que todavía puede salir — aprobada incluida — y toma la más temprana', () => {
    const r = resumenCola([
      pendiente(1, '2026-07-26T12:40:00Z'),
      pendiente(2, '2026-07-26T12:31:00Z', 'aprobada'),
      pendiente(3, '2026-07-26T12:35:00Z', 'enviada'),
      pendiente(4, '2026-07-26T12:33:00Z', 'cancelada'),
      pendiente(5, '2026-07-26T12:20:00Z', 'preparada'),
    ]);
    expect(r.enCola).toBe(2);
    expect(r.proxima?.toISOString()).toBe('2026-07-26T12:31:00.000Z');
  });

  test('lo preparado NO cuenta como cola: todavía no tiene turno de nadie', () => {
    expect(resumenCola([pendiente(1, '2026-07-26T12:31:00Z', 'preparada')]).enCola).toBe(0);
  });

  test('en supervisada la línea dice lo tuyo: cuántas te esperan', () => {
    const v = verAutoRespuesta(en('supervisada', { esperandoAprobacion: 12 }));
    expect(resumenDeCola(v)).toBe('12 esperando tu OK');
  });

  test('en automática dice cuántas salen y cuándo la próxima', () => {
    const v = verAutoRespuesta(
      en('automatica', {
        pendientes: [pendiente(1, '2026-07-26T12:40:00Z'), pendiente(2, '2026-07-26T12:31:00Z')],
      }),
    );
    expect(resumenDeCola(v)).toBe(`2 en cola · próxima ${horaCorta(new Date('2026-07-26T12:31:00Z'))}`);
  });

  test('apagada no dice nada: el estado ya lo dice el chip', () => {
    expect(resumenDeCola(verAutoRespuesta(en('apagada')))).toBe(null);
  });

  test('supervisada sin nada que revisar lo dice, en vez de un cero mudo', () => {
    expect(resumenDeCola(verAutoRespuesta(en('supervisada')))).toBe('nada esperando');
  });

  test('supervisada con lo aprobado en cola dice cuándo sale la próxima', () => {
    // Antes decía solo «N aprobadas en cola». La hora es la mitad que importa:
    // es lo que se puede frenar, y sin ella hay que abrir otra cosa para saberlo.
    const v = verAutoRespuesta(
      en('supervisada', { pendientes: [pendiente(1, '2026-07-26T12:31:00Z', 'aprobada')] }),
    );
    expect(resumenDeCola(v)).toBe(`1 aprobadas en cola · próxima ${horaCorta(new Date('2026-07-26T12:31:00Z'))}`);
  });
});

/**
 * LA PUERTA (ADR 0018) — el renglón del número ES el botón de entrar a revisar.
 * El dueño: «esa etiqueta … al tocarla se entra a revisarlas».
 */
describe('la puerta a la revisión', () => {
  test('con gente esperando, el renglón abre y dice cuántas', () => {
    const p = puertaDeRevision(verAutoRespuesta(en('supervisada', { esperandoAprobacion: 12 })));
    expect(p).toEqual({ abre: true, cuantas: 12, texto: '12 esperando tu OK' });
  });

  test('sin nada esperando NO abre: un botón que no hace nada enseña que ahí no se toca', () => {
    const p = puertaDeRevision(verAutoRespuesta(en('supervisada')));
    expect(p.abre).toBe(false);
    expect(p.cuantas).toBe(0);
    expect(p.texto).toBe('nada esperando');
  });

  test('apagada no abre nada y no inventa texto', () => {
    const p = puertaDeRevision(verAutoRespuesta(en('apagada')));
    expect(p).toEqual({ abre: false, cuantas: 0, texto: '' });
  });
});

describe('qué modos se pueden elegir', () => {
  test('dos, no tres: a automática ya no se entra (ADR 0018)', () => {
    expect([...MODOS_ELEGIBLES]).toEqual(['apagada', 'supervisada']);
  });

  test('los tres se siguen pudiendo NOMBRAR: el server puede informar el retirado', () => {
    expect([...MODOS]).toEqual(['apagada', 'supervisada', 'automatica']);
    for (const m of MODOS) expect(NOMBRE_MODO[m]).toBeTruthy();
  });
});
