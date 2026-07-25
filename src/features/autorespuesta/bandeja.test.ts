import { describe, expect, test } from 'vitest';
import {
  UMBRAL_APURO_MIN,
  haceCuanto,
  idsDeGrupos,
  resumenDeSeleccion,
  vencimiento,
  type GrupoBandeja,
  type MensajeBandeja,
} from './bandeja';

/**
 * LA BANDEJA DE REVISIÓN, sin React — lo que hace que se despache en dos
 * minutos: cuánto hace que esperan, cuánto queda para que caduquen, y qué dice
 * el botón de lote antes de tocarlo.
 *
 * Lo que más importa acá es el UMBRAL DEL ORO: en Hermes el dorado significa
 * una sola cosa, tiempo que se acaba (regla de marca). Una preparada que caduca
 * en 20 minutos ES eso; una que caduca en tres horas, no. Si el oro apareciera
 * en todas, dejaría de significar algo — y la vendedora no sabría cuál mirar
 * primero.
 */

const mensaje = (over: Partial<MensajeBandeja> = {}): MensajeBandeja => ({
  id: 1,
  clave: 'conv:whatsapp:51961506674:51986394450',
  telefono: '51961506674',
  personaNombre: 'Ana',
  plantillaId: 'fuera-de-horario-campana',
  texto: 'Hola Ana, gracias por escribirnos…',
  campana: 'Inteligencia y Contrainteligencia',
  campanaFuente: 'anuncio',
  editada: false,
  disparadaPor: '2026-07-26T05:00:00Z',
  programadoPara: '2026-07-26T12:30:00Z',
  caducaEn: '2026-07-26T15:30:00Z',
  esperandoMinutos: 300,
  ...over,
});

const grupo = (campana: string, ids: number[]): GrupoBandeja => ({
  campana,
  plantillaId: 'fuera-de-horario-campana',
  mensajes: ids.map((id) => mensaje({ id, campana })),
});

describe('cuánto hace que espera', () => {
  test('se dice en horas cuando pasó de una, en minutos cuando no', () => {
    expect(haceCuanto(300)).toBe('hace 5 h');
    expect(haceCuanto(95)).toBe('hace 1 h 35 min');
    expect(haceCuanto(45)).toBe('hace 45 min');
  });

  test('lo recién llegado no se dice «hace 0 min»', () => {
    expect(haceCuanto(0)).toBe('recién');
  });

  test('más de un día se dice en días: «hace 30 h» no lo lee nadie', () => {
    expect(haceCuanto(60 * 30)).toBe('hace 1 día');
    expect(haceCuanto(60 * 50)).toBe('hace 2 días');
  });
});

describe('cuánto le queda antes de caducar', () => {
  const ahora = new Date('2026-07-26T13:00:00Z');

  test('con horas por delante NO apura: nada de oro', () => {
    const v = vencimiento('2026-07-26T15:30:00Z', ahora);
    expect(v.minutos).toBe(150);
    expect(v.apura).toBe(false);
    expect(v.texto).toBe('vence en 2 h 30 min');
  });

  test('debajo del umbral apura, y ahí el oro significa algo', () => {
    const v = vencimiento('2026-07-26T13:20:00Z', ahora);
    expect(v.minutos).toBe(20);
    expect(v.apura).toBe(true);
    expect(v.texto).toBe('vence en 20 min');
  });

  test('el borde exacto del umbral todavía no apura', () => {
    const justo = new Date(ahora.getTime() + UMBRAL_APURO_MIN * 60_000);
    expect(vencimiento(justo.toISOString(), ahora).apura).toBe(false);
  });

  test('lo ya vencido se dice vencido, no «vence en -3 min»', () => {
    const v = vencimiento('2026-07-26T12:57:00Z', ahora);
    expect(v.minutos).toBe(0);
    expect(v.vencida).toBe(true);
    expect(v.texto).toBe('ya venció');
  });
});

describe('el lote, antes de tocarlo', () => {
  const grupos = [grupo('Inteligencia y Contrainteligencia', [1, 2, 3]), grupo('OSINT y SOCMINT', [4, 5])];

  test('todos los ids, para el «seleccionar todo»', () => {
    expect(idsDeGrupos(grupos)).toEqual([1, 2, 3, 4, 5]);
  });

  test('el botón dice cuántos mensajes y de cuántas campañas', () => {
    expect(resumenDeSeleccion(grupos, new Set([1, 2, 4]))).toBe('3 mensajes de 2 campañas');
  });

  test('uno solo se dice en singular: un botón que dice «1 mensajes» se ve barato', () => {
    expect(resumenDeSeleccion(grupos, new Set([1]))).toBe('1 mensaje de 1 campaña');
  });

  test('sin selección no hay resumen: el botón va deshabilitado', () => {
    expect(resumenDeSeleccion(grupos, new Set())).toBe(null);
  });

  test('un id que ya no está en la bandeja no infla la cuenta', () => {
    expect(resumenDeSeleccion(grupos, new Set([1, 999]))).toBe('1 mensaje de 1 campaña');
  });
});
