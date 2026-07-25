import { describe, expect, test } from 'vitest';
import {
  horaCorta,
  resumenCola,
  resumenDeCola,
  verAutoRespuesta,
  type PendienteApi,
  type RespuestaAutoRespuesta,
} from './estado';

/**
 * EL ESTADO QUE VE LA VENDEDORA. Lo que se fija acá es que la pantalla no pueda
 * mentir: «apagada» y «frenada por un ban» son cosas distintas, «encendida sin
 * `AUTO_RESPUESTA=on` en el server» no manda nada y tiene que decirlo, y sin la
 * migración no se puede fingir un estado.
 */

const pendiente = (id: number, iso: string, estado = 'pendiente'): PendienteApi => ({
  id,
  telefono: `5196150000${id}`,
  estado,
  programadoPara: iso,
});

const respuesta = (over: Partial<RespuestaAutoRespuesta> = {}): RespuestaAutoRespuesta => ({
  habilitadaEnEntorno: true,
  interruptor: { encendida: false, motivo: null, actualizadoPor: null, actualizadoAt: null },
  pendientes: [],
  ...over,
});

describe('los estados que puede tener', () => {
  test('sin respuesta del server no inventa un estado', () => {
    const v = verAutoRespuesta(undefined);
    expect(v.clase).toBe('desconocida');
    expect(v.puedeCambiar).toBe(false);
  });

  test('contra un server VIEJO (404) no muestra nada: ahí la feature no existe', () => {
    // El front se despliega solo y el server necesita restart a mano: entre uno
    // y otro, la app nueva le habla a un server sin esta ruta. «Sin señal»
    // asustaría por algo que en ese server ni siquiera está.
    const v = verAutoRespuesta(undefined, { sinRuta: true });
    expect(v.clase).toBe('ausente');
    expect(v.puedeCambiar).toBe(false);
  });

  test('sin la migración lo dice, y no deja prender', () => {
    const v = verAutoRespuesta({ sinTablas: true, mensaje: 'faltan las tablas: corré `npm run db:push`' });
    expect(v.clase).toBe('sin-migracion');
    expect(v.etiqueta).toMatch(/migración/);
    expect(v.detalle).toMatch(/db:push/);
    expect(v.puedeCambiar).toBe(false);
    expect(v.accion).toBe(null);
  });

  test('apagada a mano: se puede prender, y avisa del simulacro', () => {
    const v = verAutoRespuesta(respuesta());
    expect(v.clase).toBe('apagada');
    expect(v.accion).toBe('prender');
    expect(v.detalle).toMatch(/simulacro/);
  });

  test('apagada por el FRENO automático es un estado propio, no «apagada» a secas', () => {
    const v = verAutoRespuesta(
      respuesta({
        interruptor: {
          encendida: false,
          motivo: 'freno automático: el número está suspendido por WhatsApp (código 191, se levanta mañana)',
          actualizadoPor: 'sistema',
          actualizadoAt: null,
        },
      }),
    );
    expect(v.clase).toBe('frenada');
    expect(v.detalle).toMatch(/suspendido por WhatsApp/);
    // Se puede volver a prender, pero después de leer por qué se frenó.
    expect(v.accion).toBe('prender');
  });

  test('encendida: se puede apagar y avisa que frena en seco', () => {
    const v = verAutoRespuesta(
      respuesta({ interruptor: { encendida: true, motivo: 'la encendió ana', actualizadoPor: 'ana', actualizadoAt: null } }),
    );
    expect(v.clase).toBe('encendida');
    expect(v.accion).toBe('apagar');
    expect(v.detalle).toMatch(/en seco/);
  });

  test('encendida pero sin `AUTO_RESPUESTA=on` en el server: NO manda nada y lo dice', () => {
    const v = verAutoRespuesta(
      respuesta({
        habilitadaEnEntorno: false,
        interruptor: { encendida: true, motivo: null, actualizadoPor: 'ana', actualizadoAt: null },
      }),
    );
    expect(v.clase).toBe('encendida-sin-efecto');
    expect(v.detalle).toMatch(/no se manda nada/);
    expect(v.accion).toBe('apagar');
  });
});

describe('el resumen de la cola', () => {
  test('cuenta solo lo que sigue pendiente y toma la más temprana', () => {
    const r = resumenCola([
      pendiente(1, '2026-07-26T12:40:00Z'),
      pendiente(2, '2026-07-26T12:31:00Z'),
      pendiente(3, '2026-07-26T12:35:00Z', 'enviada'),
      pendiente(4, '2026-07-26T12:33:00Z', 'cancelada'),
    ]);
    expect(r.enCola).toBe(2);
    expect(r.proxima?.toISOString()).toBe('2026-07-26T12:31:00.000Z');
  });

  test('sin pendientes no hay próxima', () => {
    expect(resumenCola([])).toEqual({ enCola: 0, proxima: null });
    expect(resumenCola([pendiente(1, '2026-07-26T12:31:00Z', 'enviada')]).proxima).toBe(null);
  });

  test('la línea de resumen solo existe cuando está encendida', () => {
    const encendida = verAutoRespuesta(
      respuesta({
        interruptor: { encendida: true, motivo: null, actualizadoPor: 'ana', actualizadoAt: null },
        pendientes: [pendiente(1, '2026-07-26T12:40:00Z'), pendiente(2, '2026-07-26T12:31:00Z')],
      }),
    );
    expect(resumenDeCola(encendida)).toBe(`2 en cola · próxima ${horaCorta(new Date('2026-07-26T12:31:00Z'))}`);

    expect(resumenDeCola(verAutoRespuesta(respuesta()))).toBe(null);
  });

  test('encendida y sin cola lo dice, en vez de mostrar un cero mudo', () => {
    const v = verAutoRespuesta(
      respuesta({ interruptor: { encendida: true, motivo: null, actualizadoPor: 'ana', actualizadoAt: null } }),
    );
    expect(resumenDeCola(v)).toBe('sin cola');
  });
});
