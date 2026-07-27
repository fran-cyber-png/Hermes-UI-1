import { describe, expect, it } from 'vitest';
import type { Ficha } from '../cerberus/ficha';
import { estadoDelContacto, type EntradaEstadoContacto } from './estadoContacto';

const CLIENTE: Ficha = {
  estado: 'cliente',
  id: 6281,
  nombre: 'DR EN DERECHO IGNACIO ALEJANDRO VILA CHÁVEZ',
  codigo: 'CLI-06281',
  dni: '',
  pais: 'México',
  correo: 'avilach01@icloud.com',
  ventasCount: 2,
  ventas: [
    { folio: 'GOB-13706', estado: 'Pagado', monto: '1960.00', moneda: 'MXN', fecha: '2026-09-07' },
    { folio: 'GOB-13222', estado: 'Pagado', monto: '2800.00', moneda: 'MXN', fecha: '2026-04-06' },
  ],
};

function entrada(p: Partial<EntradaEstadoContacto> = {}): EntradaEstadoContacto {
  return { conTelefono: true, cargando: false, error: false, ficha: undefined, enfriada: false, ...p };
}

describe('estadoDelContacto — quién es, de un vistazo', () => {
  it('un cliente se distingue de un desconocido por el acento, no por un texto que hay que leer', () => {
    const cliente = estadoDelContacto(entrada({ ficha: CLIENTE }));
    const nuevo = estadoDelContacto(entrada({ ficha: { estado: 'nuevo' } }));
    expect(cliente.acento).toBe('cliente');
    expect(nuevo.acento).toBe('neutro');
    expect(cliente.acento).not.toBe(nuevo.acento);
  });

  it('el cliente trae su cifra ya sumada: es lo que cambia el trato', () => {
    expect(estadoDelContacto(entrada({ ficha: CLIENTE }))).toMatchObject({
      tono: 'cliente',
      titulo: 'Cliente',
      compras: { moneda: 'MXN', total: 4760, n: 2 },
      detalle: null,
    });
  });

  it('cliente sin ventas cargadas lo dice, en vez de mostrar un hueco donde iba la cifra', () => {
    const e = estadoDelContacto(entrada({ ficha: { ...CLIENTE, ventas: [], ventasCount: 0 } }));
    expect(e.tono).toBe('cliente');
    expect(e.compras).toBeNull();
    expect(e.detalle).toMatch(/sin ventas/i);
  });

  it('Cerberus caído NO es «lead nuevo» — son cosas opuestas y se ven distinto', () => {
    const caido = estadoDelContacto(entrada({ error: true }));
    expect(caido.tono).toBe('sin-saber');
    expect(caido.acento).toBe('alerta');
    expect(caido.detalle).toMatch(/no cargó/i);
    expect(caido.tono).not.toBe(estadoDelContacto(entrada({ ficha: { estado: 'nuevo' } })).tono);
  });

  it('la ficha que responde `error` pesa lo mismo que la consulta que falló', () => {
    expect(estadoDelContacto(entrada({ ficha: { estado: 'error', motivo: 'timeout' } })).tono).toBe('sin-saber');
  });

  it('mientras carga no se adelanta ningún veredicto', () => {
    const e = estadoDelContacto(entrada({ cargando: true }));
    expect(e.tono).toBe('cargando');
    expect(e.compras).toBeNull();
  });

  it('en un canal sin teléfono lo dice, en vez de fingir que la persona no existe', () => {
    const e = estadoDelContacto(entrada({ conTelefono: false }));
    expect(e.tono).toBe('otro-canal');
    expect(e.detalle).toMatch(/teléfono/i);
  });
});

describe('el frío es del hilo, no de la persona', () => {
  it('una conversación fría de un lead nuevo pinta fría', () => {
    const e = estadoDelContacto(entrada({ ficha: { estado: 'nuevo' }, enfriada: true }));
    expect(e.acento).toBe('frio');
    expect(e.detalle).toMatch(/dejó de contestar/i);
  });

  it('un CLIENTE que se enfrió sigue siendo cliente: el verde no cede', () => {
    const e = estadoDelContacto(entrada({ ficha: CLIENTE, enfriada: true }));
    expect(e.acento).toBe('cliente');
    // pero el dato no se pierde: viaja para que la etiqueta automática lo diga.
    expect(e.enfriada).toBe(true);
  });

  it('el frío nunca tapa que Cerberus no respondió', () => {
    expect(estadoDelContacto(entrada({ error: true, enfriada: true })).acento).toBe('alerta');
  });
});

/**
 * EL PADRÓN LOCAL MIENTRAS CERBERUS PIENSA (#133).
 *
 * La ficha tiene un techo de 12 s porque Cerberus a veces deja la conexión
 * abierta sin responder. Durante esos segundos el panel decía «Buscando en
 * Cerberus…» incluso cuando la cola YA sabía —por el cruce contra el padrón—
 * que esa persona compró tres veces. El dato existía y se escondía.
 */
describe('mientras Cerberus responde, el padrón local ya sabe algo', () => {
  it('cargando + padrón que dice cliente: se pinta cliente, no un spinner', () => {
    const e = estadoDelContacto(entrada({ cargando: true, padron: 'recompro' }));
    expect(e.tono).toBe('cliente');
    expect(e.acento).toBe('cliente');
    expect(e.titulo).toBe('Cliente');
    expect(e.detalle).toMatch(/confirmando/i);
  });

  it('la llamada viva MANDA: cuando llega, la ficha reemplaza a la provisional', () => {
    const e = estadoDelContacto(entrada({ ficha: CLIENTE, padron: 'compro' }));
    expect(e.compras).toMatchObject({ n: 2 });
    expect(e.detalle).toBeNull();
  });

  it('«lead nuevo» NO se dice cuando el padrón lo tiene como cliente: la frase afirma de más', () => {
    const e = estadoDelContacto(entrada({ ficha: { estado: 'nuevo' }, padron: 'compro' }));
    expect(e.titulo).not.toBe('Lead nuevo');
    expect(e.tono).toBe('sin-saber');
    expect(e.acento).toBe('alerta');
    expect(e.detalle).toMatch(/otro teléfono/i);
  });

  it('sin padrón, un lead nuevo sigue siendo un lead nuevo, sin ruido', () => {
    const e = estadoDelContacto(entrada({ ficha: { estado: 'nuevo' } }));
    expect(e.titulo).toBe('Lead nuevo');
    expect(e.acento).toBe('neutro');
  });

  it('sin padrón, cargando sigue siendo cargando (nada cambió para el 93% de las filas)', () => {
    expect(estadoDelContacto(entrada({ cargando: true })).tono).toBe('cargando');
  });

  it('el padrón no tapa un error de Cerberus: «no se pudo saber» no es «es cliente»', () => {
    expect(estadoDelContacto(entrada({ error: true, padron: 'vip' })).acento).toBe('alerta');
  });
});
