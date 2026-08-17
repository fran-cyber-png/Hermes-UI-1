import { describe, expect, it } from 'vitest';
import {
  configuracionSeLee,
  cuandoSeLee,
  fraseDeEvento,
  plazoInicial,
  quienSeLee,
  venceAtDelPlazo,
  type EventoAnotado,
} from './auditoria';

function evento(parcial: Partial<EventoAnotado> & { evento: EventoAnotado['evento'] }): EventoAnotado {
  return {
    id: 1,
    notaId: 7,
    etiqueta: 'a1b2c3',
    quien: null,
    alcance: null,
    permiso: null,
    venceAt: null,
    motivo: null,
    at: '2026-08-15T10:00:00.000Z',
    ...parcial,
  };
}

describe('cómo se nombra a quien hizo algo', () => {
  it('🔴 «sin cuenta» se dice en positivo, nunca como un dato faltante', () => {
    // `null` no es «no se cargó»: es todo lo que se puede saber de quien abre un
    // link público, y todo lo que se quiere saber.
    expect(quienSeLee(null)).toBe('Alguien con el link');
  });

  it('a la gente de Goberna se la nombra corto, como en toda la app', () => {
    expect(quienSeLee('ventas10@grupogoberna.com')).toBe('ventas10');
    expect(quienSeLee('luz')).toBe('luz');
  });
});

describe('qué dice cada renglón', () => {
  it('creado lleva quién, la etiqueta y con qué permisos quedó', () => {
    const r = fraseDeEvento(evento({ evento: 'creado', quien: 'luz', alcance: 'publico', permiso: 'ver' }));
    expect(r.frase).toBe('luz creó el link a1b2c3');
    expect(r.detalle).toContain('cualquiera con el link, solo lectura');
    expect(r.detalle).toContain('no vence');
  });

  it('🔴 reconfigurar NO se dice como «creó uno nuevo»', () => {
    // El token repartido es el MISMO (ADR 0048). Decir otra cosa haría creer que
    // el link viejo murió, que es justo lo contrario de lo que pasó.
    const r = fraseDeEvento(evento({ evento: 'reconfigurado', quien: 'luz', alcance: 'goberna', permiso: 'editar' }));
    expect(r.frase).toBe('luz cambió los permisos del link a1b2c3');
    expect(r.frase).not.toContain('creó');
  });

  it('🔴 una apertura anónima se cuenta como apertura, nunca como una persona', () => {
    const r = fraseDeEvento(evento({ evento: 'usado', quien: null }));
    expect(r.frase).toBe('Se abrió el link a1b2c3');
    expect(r.detalle).toBe('sin cuenta: no se sabe quién');
    // «entró alguien» afirmaría una persona detrás de cada apertura, y puede ser
    // la misma recargando.
    expect(r.frase).not.toMatch(/entró|persona/i);
  });

  it('una apertura con cuenta sí lleva nombre', () => {
    const r = fraseDeEvento(evento({ evento: 'usado', quien: 'alan' }));
    expect(r.frase).toBe('alan abrió el link a1b2c3');
  });

  it('🔴 los cortes automáticos NO se le atribuyen a nadie como si los hubiera hecho', () => {
    // Sacar a alguien de un espacio le corta los links que abrió (ADR 0048). Sin
    // el motivo, el registro lo muestra cortando links uno por uno.
    const sacada = fraseDeEvento(evento({ evento: 'cortado', quien: 'luz', motivo: 'sacaron_al_miembro' }));
    expect(sacada.frase).toBe('El link a1b2c3 se cortó al sacar a luz del espacio');

    const archivado = fraseDeEvento(evento({ evento: 'cortado', quien: null, motivo: 'archivaron_el_espacio' }));
    expect(archivado.frase).toBe('Se cortó el link a1b2c3 al archivar el espacio');

    const aMano = fraseDeEvento(evento({ evento: 'cortado', quien: 'luz' }));
    expect(aMano.frase).toBe('luz cortó el link a1b2c3');
  });

  it('🔴 un evento que este front no conoce se DIBUJA, no rompe ni desaparece', () => {
    // La ventana entre N4 y N5 dura horas: en ese rato el server sabe cosas que el
    // front no. Un registro que se cae —o que esconde filas— ante un valor nuevo
    // deja de estar justo cuando algo raro pasó.
    const r = fraseDeEvento(evento({ evento: 'vencido' as never, quien: 'luz' }));
    expect(r.frase).toBe('luz hizo algo con el link a1b2c3');
    expect(r.detalle).toBe('vencido');
  });
});

describe('el vencimiento', () => {
  const AHORA = new Date('2026-08-17T12:00:00.000Z');

  it('«No vence» es null, que es el default de un link de lead (ADR 0047)', () => {
    expect(venceAtDelPlazo('nunca', null, AHORA)).toBeNull();
    expect(plazoInicial(null)).toBe('nunca');
    expect(plazoInicial(undefined)).toBe('nunca');
  });

  it('un plazo se convierte en fecha con el reloj inyectado', () => {
    expect(venceAtDelPlazo('7d', null, AHORA)).toBe('2026-08-24T12:00:00.000Z');
    expect(venceAtDelPlazo('30m', null, AHORA)).toBe('2026-08-17T12:30:00.000Z');
  });

  it('🔴 «conservar» REENVÍA la fecha que el link ya tiene — no manda null', () => {
    // El bug que esto cierra: el body manda `venceAt ?? null` y el server trata
    // `undefined` igual que `null` («no vence»). Con lo natural, abrir el modal
    // para cambiar el ALCANCE de un link que vence el 20 y apretar «Guardar» le
    // sacaba el vencimiento, sin un solo síntoma en la pantalla.
    const actual = '2026-09-20T00:00:00.000Z';
    expect(venceAtDelPlazo('conservar', actual, AHORA)).toBe(actual);
    expect(plazoInicial(actual)).toBe('conservar');
  });

  it('«conservar» sobre un link que no vence sigue siendo «no vence»', () => {
    expect(venceAtDelPlazo('conservar', null, AHORA)).toBeNull();
  });

  it('🔴 abrir el modal NO corre el vencimiento al preset más parecido', () => {
    // Si `plazoInicial` eligiera «30 días», cada vez que alguien abre y guarda el
    // link se le correría el vencimiento unas horas sin que nadie lo pidiera.
    const dentroDe30Dias = new Date(AHORA.getTime() + 30 * 24 * 3_600_000).toISOString();
    expect(plazoInicial(dentroDe30Dias)).toBe('conservar');
    expect(venceAtDelPlazo(plazoInicial(dentroDe30Dias), dentroDe30Dias, AHORA)).toBe(dentroDe30Dias);
  });
});

describe('la configuración en una línea', () => {
  it('dice las dos mitades: quién lo abre y qué puede hacer', () => {
    expect(configuracionSeLee('publico', 'ver')).toBe('cualquiera con el link, solo lectura');
    expect(configuracionSeLee('goberna', 'editar')).toBe('solo gente de Goberna, puede editar');
    expect(configuracionSeLee('goberna', 'ver')).toBe('solo gente de Goberna, solo lectura');
  });

  it('sin alcance no inventa una configuración', () => {
    expect(configuracionSeLee(null, null)).toBe('');
  });
});

describe('cuándo', () => {
  const AHORA = new Date('2026-08-17T12:00:00.000Z');

  it('lo reciente se dice en criollo y lo viejo con fecha', () => {
    expect(cuandoSeLee('2026-08-17T11:59:40.000Z', AHORA)).toBe('recién');
    expect(cuandoSeLee('2026-08-17T11:30:00.000Z', AHORA)).toBe('hace 30 min');
    expect(cuandoSeLee('2026-07-02T14:00:00.000Z', AHORA)).toMatch(/jul/);
  });

  it('🔴 «hoy» y «ayer» son días del calendario, no ventanas de 24 horas', () => {
    // 22 horas atrás, pero ayer: con minutos transcurridos esto decía «hoy 09:00»
    // — una fecha falsa, y de las que no se notan porque la hora es correcta.
    const ayerCasiIgualDeTemprano = new Date(AHORA.getTime() - 22 * 3_600_000);
    expect(cuandoSeLee(ayerCasiIgualDeTemprano.toISOString(), AHORA)).toMatch(/^ayer /);

    // Y al revés: 20 horas atrás pero el MISMO día sigue siendo «hoy».
    const hoyTemprano = new Date(AHORA.getFullYear(), AHORA.getMonth(), AHORA.getDate(), 1, 0, 0);
    expect(cuandoSeLee(hoyTemprano.toISOString(), AHORA)).toMatch(/^hoy /);
  });
});
