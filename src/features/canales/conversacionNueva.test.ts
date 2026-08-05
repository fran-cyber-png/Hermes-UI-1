import { describe, expect, it } from 'vitest';
import { conversacionDeTelefono } from './conversacionNueva';

const RELOJ = new Date('2026-08-05T14:00:00.000Z');

describe('conversacionDeTelefono — la clave que arma el front tiene que ser la del server', () => {
  it('arma `conv:<canal>:<persona>:<numeroPropio>`, que es lo que construye el SQL de la cola', () => {
    const c = conversacionDeTelefono({
      telefono: '51987654321',
      numeroPropio: '51986394450',
      ahora: RELOJ,
    });
    expect(c.clave).toBe('conv:whatsapp:51987654321:51986394450');
    expect(c.persona_id).toBe('51987654321');
    expect(c.numero_propio).toBe('51986394450');
  });

  it('normaliza el teléfono ANTES de armar la clave: un «+51 987 654 321» tiene que dar la misma', () => {
    // El padrón guarda el teléfono formateado y la cola no: si la normalización
    // no pasara por acá, la misma persona tendría dos claves según de qué
    // pantalla se la abrió, y ninguna de las dos matchearía con la real.
    const formateado = conversacionDeTelefono({
      telefono: '+51 987 654 321',
      numeroPropio: '51986394450',
      ahora: RELOJ,
    });
    const crudo = conversacionDeTelefono({
      telefono: '51987654321',
      numeroPropio: '51986394450',
      ahora: RELOJ,
    });
    expect(formateado.clave).toBe(crudo.clave);
  });

  it('sin línea propia deja la clave terminada en «:» y `numero_propio` en null — no inventa un número', () => {
    // Con WhatsApp caído el panel se tiene que poder abrir igual. Y la clave con
    // la cola vacía no es una clave rota: el SQL del server usa
    // COALESCE(numeroPropio, '') y produce exactamente esta forma.
    const c = conversacionDeTelefono({ telefono: '51987654321', numeroPropio: null, ahora: RELOJ });
    expect(c.clave).toBe('conv:whatsapp:51987654321:');
    expect(c.numero_propio).toBeNull();
  });

  it('lleva el nombre que ya sabíamos, y null cuando no sabemos ninguno', () => {
    const con = conversacionDeTelefono({
      telefono: '51987654321',
      numeroPropio: null,
      nombre: 'Javier Peralta',
      ahora: RELOJ,
    });
    const sin = conversacionDeTelefono({ telefono: '51987654321', numeroPropio: null, ahora: RELOJ });
    expect(con.persona_nombre).toBe('Javier Peralta');
    expect(sin.persona_nombre).toBeNull();
  });

  it('es un chat de WhatsApp sin nada medido: nivel neutro y cero mensajes', () => {
    // `n: 0` y `nivel: 5` no son valores de relleno: dicen «no hay hilo todavía».
    // Un nivel bajo colaría a alguien que nunca escribió en la deuda de la cola.
    const c = conversacionDeTelefono({ telefono: '51987654321', numeroPropio: null, ahora: RELOJ });
    expect(c).toMatchObject({
      canal: 'whatsapp',
      tipo: 'mensaje',
      n: 0,
      nivel: 5,
      respondida: false,
      pide_info: false,
      texto: null,
    });
    expect(c.referencia).toBe(RELOJ.toISOString());
    expect(c.ultimo_at).toBe(RELOJ.toISOString());
  });
});
