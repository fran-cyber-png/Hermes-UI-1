import { describe, expect, it } from 'vitest';
import { decidirDrop, decidirRebote, reintentoTrasInteres } from './compuertas';

/**
 * LAS COMPUERTAS DEL PIPELINE (#60) — la lógica pura de qué pasa al soltar una
 * tarjeta: qué modal abre cada destino, y el reintento tras completar lo que
 * faltaba. La compuerta REAL vive en el server (gestiones.ts); esto solo decide
 * cómo la UI la acompaña en vez de rebotar.
 */

describe('decidirDrop — qué hace el Pipeline con cada destino', () => {
  it('soltar en la misma etapa no hace nada', () => {
    expect(decidirDrop({ actual: 'cotizado', destino: 'cotizado', canal: 'whatsapp' })).toEqual({
      accion: 'nada',
    });
  });

  it('Cierre + WhatsApp abre el modal de Registrar venta — el cierre no se declara, se gana', () => {
    expect(decidirDrop({ actual: 'contactado', destino: 'cierre', canal: 'whatsapp' })).toEqual({
      accion: 'modal-venta',
    });
  });

  it('Cierre + comentario (FB/IG) abre la conversación: sin teléfono no hay ficha ni venta', () => {
    expect(decidirDrop({ actual: 'interesado', destino: 'cierre', canal: 'facebook' })).toEqual({
      accion: 'abrir',
    });
    expect(decidirDrop({ actual: 'interesado', destino: 'cierre', canal: 'instagram' })).toEqual({
      accion: 'abrir',
    });
  });

  it('Cotizados intenta mover: la compuerta la decide el server, no la UI', () => {
    expect(decidirDrop({ actual: 'interesado', destino: 'cotizado', canal: 'whatsapp' })).toEqual({
      accion: 'mover',
      etapa: 'cotizado',
    });
  });

  it('Cotizados SIN interés registrado pregunta antes de ir al server: el viaje era un rebote seguro', () => {
    expect(
      decidirDrop({ actual: 'contactado', destino: 'cotizado', canal: 'whatsapp', tieneInteres: false }),
    ).toEqual({ accion: 'modal-interes' });
  });

  it('Cotizados CON interés registrado no pregunta nada: la compuerta ya está satisfecha', () => {
    expect(
      decidirDrop({ actual: 'contactado', destino: 'cotizado', canal: 'whatsapp', tieneInteres: true }),
    ).toEqual({ accion: 'mover', etapa: 'cotizado' });
  });

  it('las etapas sin compuerta se mueven directo', () => {
    expect(decidirDrop({ actual: 'interesado', destino: 'contactado', canal: 'whatsapp' })).toEqual({
      accion: 'mover',
      etapa: 'contactado',
    });
    expect(decidirDrop({ actual: 'cotizado', destino: 'perdido', canal: 'facebook' })).toEqual({
      accion: 'mover',
      etapa: 'perdido',
    });
  });

  it('con un modal ya abierto no se suelta nada: los modales no se apilan', () => {
    expect(
      decidirDrop({ actual: 'interesado', destino: 'cierre', canal: 'whatsapp', modalAbierto: true }),
    ).toEqual({ accion: 'nada' });
    expect(
      decidirDrop({ actual: 'interesado', destino: 'contactado', canal: 'whatsapp', modalAbierto: true }),
    ).toEqual({ accion: 'nada' });
  });
});

describe('decidirRebote — cuando el server rechazó el movimiento', () => {
  it('la compuerta de Cotizado (400) abre el modal del interés en vez de un aviso', () => {
    expect(
      decidirRebote({ destino: 'cotizado', status: 400, mensaje: 'Para pasar a Cotizado…' }),
    ).toEqual({ accion: 'modal-interes' });
  });

  it('un error de red en Cotizados es aviso, no modal — el fallback de siempre', () => {
    expect(decidirRebote({ destino: 'cotizado', status: null, mensaje: null })).toEqual({
      accion: 'aviso',
      mensaje: 'No se pudo mover.',
    });
  });

  it('si el modal de venta ya está abierto, la compuerta de Cotizado cae al aviso — jamás dos modales', () => {
    expect(
      decidirRebote({ destino: 'cotizado', status: 400, mensaje: 'Falta el interés.', ventaAbierta: true }),
    ).toEqual({ accion: 'aviso', mensaje: 'Falta el interés.' });
  });

  it('un rechazo en otra etapa es aviso con el motivo del server, con UN punto final', () => {
    expect(
      decidirRebote({ destino: 'contactado', status: 400, mensaje: 'etapa inválida.' }),
    ).toEqual({ accion: 'aviso', mensaje: 'etapa inválida.' });
    expect(decidirRebote({ destino: 'perdido', status: 500, mensaje: 'se rompió' })).toEqual({
      accion: 'aviso',
      mensaje: 'se rompió.',
    });
  });
});

describe('reintentoTrasInteres — el drag original se completa, no se repite a mano', () => {
  it('con una tarjeta esperando, el reintento va a cotizado con ESA tarjeta', () => {
    const c = { clave: 'conv:whatsapp:519:519' };
    expect(reintentoTrasInteres(c)).toEqual({ c, etapa: 'cotizado' });
  });

  it('sin tarjeta esperando no hay nada que reintentar', () => {
    expect(reintentoTrasInteres(null)).toBeNull();
  });
});
