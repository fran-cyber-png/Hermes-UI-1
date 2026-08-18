import { describe, expect, it } from 'vitest';
import { ensamblarTimeline, type EventoLinea, type TimelineArmada } from './timeline';
import type { Ficha, VentaFicha } from '../cerberus/ficha';
import type { InteresRegistrado } from '../gestion/lineaDeTiempo';
import type { Senal } from '../senales/senales';

const relojFijo = (iso: string) => () => new Date(iso);

function eventosDe(r: TimelineArmada): EventoLinea[] {
  return r.grupos.flatMap((g) => g.eventos);
}

function venta(sobre: Partial<VentaFicha> = {}): VentaFicha {
  return {
    folio: 'GOB-001',
    estado: 'pagada',
    monto: '1200',
    moneda: 'S/',
    fecha: '2026-03-14T12:00:00Z',
    ...sobre,
  };
}

function cliente(sobre: Partial<Extract<Ficha, { estado: 'cliente' }>> = {}): Extract<Ficha, { estado: 'cliente' }> {
  return {
    estado: 'cliente',
    id: 1,
    nombre: 'María Torres',
    codigo: 'MT001',
    dni: '12345678',
    pais: 'PE',
    correo: 'maria@test.com',
    ventasCount: 1,
    ventas: [venta()],
    ...sobre,
  };
}

function nuevo(): Extract<Ficha, { estado: 'nuevo' }> {
  return { estado: 'nuevo' };
}

function errorFicha(motivo = 'timeout'): Extract<Ficha, { estado: 'error' }> {
  return { estado: 'error', motivo };
}

function interes(sobre: Partial<InteresRegistrado> = {}): InteresRegistrado {
  return { curso: 'Oratoria', creadoAt: '2026-05-01T12:00:00Z', ...sobre };
}

function senal(sobre: Partial<Senal> = {}): Senal {
  return {
    clave: 'wa:51999888777',
    etiquetas: [],
    corroborada: false,
    enfriamiento: { enfriada: false, diasDeSilencio: null, motivo: '' },
    cotizacion: null,
    ...sobre,
  };
}

describe('ensamblarTimeline', () => {
  it('cliente con compras: genera eventos por cada venta, ordenados por fecha, sin pendientes', () => {
    const resultado = ensamblarTimeline({
      ficha: cliente({
        ventasCount: 2,
        ventas: [
          venta({ folio: 'GOB-010', monto: '800', moneda: 'USD', fecha: '2026-01-15T10:00:00Z' }),
          venta({ folio: 'GOB-020', monto: '1200', moneda: 'S/', fecha: '2026-06-01T10:00:00Z' }),
        ],
      }),
    });

    const compras = eventosDe(resultado).filter((e) => e.tipo === 'compra');
    expect(compras).toHaveLength(2);
    expect(compras.every((e) => e.estado === 'confirmado')).toBe(true);
    expect(compras.every((e) => e.fuente === 'Cerberus')).toBe(true);

    expect(compras[0].valor).toBe('1200 S/');
    expect(compras[1].valor).toBe('800 USD');

    expect(resultado.pendientes).toHaveLength(0);
    expect(resultado.progreso).toBe(100);
  });

  it('lead nuevo sin datos: solo llegada si hay campaña, mas pendientes', () => {
    const resultado = ensamblarTimeline({
      ficha: nuevo(),
      leadForm: { campana: 'Diplomados 2026', fecha: '2026-07-28T14:22:00Z' },
    });

    expect(eventosDe(resultado)).toHaveLength(1);
    expect(eventosDe(resultado)[0]).toMatchObject({
      tipo: 'llegada',
      estado: 'confirmado',
      valor: 'Diplomados 2026',
      fuente: 'Meta Ads',
    });

    expect(resultado.pendientes.length).toBeGreaterThanOrEqual(2);
    expect(resultado.pendientes.map((p) => p.campo)).toContain('Nombre completo');
    expect(resultado.pendientes.map((p) => p.campo)).toContain('Interés específico');

    expect(resultado.progreso).toBeLessThan(100);
  });

  it('lead nuevo sin campaña y sin mas datos: solo pendientes', () => {
    const resultado = ensamblarTimeline({ ficha: nuevo() });

    expect(eventosDe(resultado)).toHaveLength(0);
    expect(resultado.pendientes.length).toBeGreaterThanOrEqual(2);
  });

  it('Cerberus error: no genera compras, sí pendientes', () => {
    const resultado = ensamblarTimeline({ ficha: errorFicha('timeout') });

    expect(eventosDe(resultado).filter((e) => e.tipo === 'compra')).toHaveLength(0);
    expect(resultado.pendientes.length).toBeGreaterThan(0);
    expect(resultado.pendientes.map((p) => p.campo)).toContain('Nombre completo');
  });

  it('con intereses registrados: genera un evento por cada interés', () => {
    const resultado = ensamblarTimeline({
      intereses: [
        interes({ curso: 'Oratoria', creadoAt: '2026-05-01T12:00:00Z' }),
        interes({ curso: 'Consultoría Política', creadoAt: null }),
      ],
    });

    const evs = eventosDe(resultado).filter((e) => e.tipo === 'interes_registrado');
    expect(evs).toHaveLength(2);
    expect(evs.every((e) => e.estado === 'manual')).toBe(true);
    expect(evs.every((e) => e.fuente === 'Vendedora')).toBe(true);
    expect(evs[0].valor).toBe('Oratoria');
    expect(evs[1].valor).toBe('Consultoría Política');

    expect(evs[0].timestamp).toBe('2026-05-01T12:00:00Z');
    expect(evs[1].timestamp).toBeUndefined();
  });

  it('con señales: genera enfriamiento y cotizacion con estado ia', () => {
    const resultado = ensamblarTimeline({
      senales: senal({
        enfriamiento: { enfriada: true, diasDeSilencio: 5, motivo: 'sin respuesta' },
        cotizacion: { esCotizacion: true, motivo: 'monto con moneda', ocurridoEn: '2026-07-28' },
      }),
    });

    const enf = eventosDe(resultado).find((e) => e.tipo === 'enfriamiento');
    expect(enf).toBeDefined();
    expect(enf!.estado).toBe('ia');
    expect(enf!.valor).toBe('5 días');

    const cot = eventosDe(resultado).find((e) => e.tipo === 'cotizacion');
    expect(cot).toBeDefined();
    expect(cot!.estado).toBe('ia');
    expect(cot!.fuente).toBe('Señal automática');
  });

  it('señal de enfriamiento sin diasDeSilencio no pone valor', () => {
    const resultado = ensamblarTimeline({
      senales: senal({
        enfriamiento: { enfriada: true, diasDeSilencio: null, motivo: '' },
      }),
    });

    const enf = eventosDe(resultado).find((e) => e.tipo === 'enfriamiento');
    expect(enf).toBeDefined();
    expect(enf!.valor).toBeUndefined();
  });

  it('progreso correcto: confirmados / (confirmados + pendientes)', () => {
    const resultado = ensamblarTimeline({
      ficha: nuevo(),
      leadForm: { campana: 'Campaña Test' },
      senales: senal({
        enfriamiento: { enfriada: true, diasDeSilencio: 3, motivo: '' },
      }),
    });

    const confirmados = eventosDe(resultado).filter((e) => e.estado === 'confirmado').length;
    expect(confirmados).toBe(1);

    const esperado = Math.round((confirmados / (confirmados + resultado.pendientes.length)) * 100);
    expect(resultado.progreso).toBe(esperado);
  });

  it('progreso 100 cuando no hay pendientes y hay confirmados', () => {
    const resultado = ensamblarTimeline({
      ficha: cliente(),
      leadForm: { campana: 'Test' },
    });

    expect(resultado.pendientes).toHaveLength(0);
    expect(resultado.progreso).toBe(100);
  });

  it('sin datos: progreso 0, hay pendientes', () => {
    const resultado = ensamblarTimeline({});

    expect(eventosDe(resultado)).toHaveLength(0);
    expect(resultado.progreso).toBe(0);
    expect(resultado.pendientes.length).toBeGreaterThan(0);
  });

  it('cliente con todo: tipos presentes, sin importar la fuente', () => {
    const resultado = ensamblarTimeline({
      ficha: cliente({
        ventasCount: 1,
        ventas: [venta({ folio: 'GOB-050', monto: '1500', moneda: 'USD', fecha: '2026-04-01T10:00:00Z' })],
      }),
      intereses: [interes({ curso: 'Ciberseguridad', creadoAt: '2026-05-01T12:00:00Z' })],
      senales: senal({
        enfriamiento: { enfriada: true, diasDeSilencio: 7, motivo: '' },
        cotizacion: { esCotizacion: true, motivo: '', ocurridoEn: '2026-07-01' },
      }),
      leadForm: { campana: 'Campaña Julio' },
      conversacion: { persona_nombre: 'Alejandro García' },
    });

    const tipos = eventosDe(resultado).map((e) => e.tipo);
    expect(tipos.filter((t) => t === 'compra' || t === 'llegada' || t === 'identidad' || t === 'interes_registrado')).toHaveLength(4);
    expect(tipos.filter((t) => t === 'enfriamiento' || t === 'cotizacion')).toHaveLength(2);

    expect(resultado.pendientes).toHaveLength(0);
  });

  it('los eventos con estado manual o ia NO cuentan como confirmados para el progreso', () => {
    const resultado = ensamblarTimeline({
      intereses: [
        interes({ curso: 'Oratoria' }),
        interes({ curso: 'Consultoría' }),
      ],
      senales: senal({
        enfriamiento: { enfriada: true, diasDeSilencio: 3, motivo: '' },
      }),
    });

    const confirmados = eventosDe(resultado).filter((e) => e.estado === 'confirmado').length;
    expect(confirmados).toBe(0);

    expect(resultado.progreso).toBe(0);
  });

  it('identidad desde persona_nombre usa WhatsApp, desde lead_nombre usa Formulario', () => {
    const conWhatsApp = ensamblarTimeline({
      conversacion: { persona_nombre: 'Juan Pérez' },
    });

    const ev = eventosDe(conWhatsApp).find((e) => e.tipo === 'identidad');
    expect(ev).toBeDefined();
    expect(ev!.fuente).toBe('WhatsApp');

    const conForm = ensamblarTimeline({
      conversacion: { lead_nombre: 'Ana López' },
    });

    const ev2 = eventosDe(conForm).find((e) => e.tipo === 'identidad');
    expect(ev2).toBeDefined();
    expect(ev2!.fuente).toBe('Formulario');
  });

  it('persona_nombre le gana a lead_nombre, fuente es WhatsApp', () => {
    const resultado = ensamblarTimeline({
      conversacion: { persona_nombre: 'Juan', lead_nombre: 'Juancho' },
    });

    const ev = eventosDe(resultado).find((e) => e.tipo === 'identidad');
    expect(ev).toBeDefined();
    expect(ev!.valor).toBe('Juan');
    expect(ev!.fuente).toBe('WhatsApp');
  });

  it('orden cronológico descendente con timestamps mezclados, sin importar la fuente', () => {
    const resultado = ensamblarTimeline(
      {
        ficha: cliente({
          ventasCount: 1,
          ventas: [venta({ folio: 'GOB-010', monto: '800', moneda: 'USD', fecha: '2026-01-15T10:00:00Z' })],
        }),
        intereses: [
          interes({ curso: 'A', creadoAt: '2026-05-01T12:00:00Z' }),
          interes({ curso: 'B', creadoAt: '2026-03-01T12:00:00Z' }),
        ],
        leadForm: { campana: 'X', fecha: '2026-07-20T10:00:00Z' },
      },
      relojFijo('2026-07-31T12:00:00Z'),
    );

    const evs = eventosDe(resultado);
    expect(evs.map((e) => e.tipo)).toEqual(['llegada', 'interes_registrado', 'interes_registrado', 'compra']);
    expect(evs.map((e) => e.timestamp)).toEqual([
      '2026-07-20T10:00:00Z',
      '2026-05-01T12:00:00Z',
      '2026-03-01T12:00:00Z',
      '2026-01-15T10:00:00Z',
    ]);
  });

  it('eventos sin timestamp van al final, en el grupo «Sin fecha»', () => {
    const resultado = ensamblarTimeline(
      {
        intereses: [interes({ curso: 'Con fecha', creadoAt: '2026-07-01T12:00:00Z' })],
        senales: senal({
          enfriamiento: { enfriada: true, diasDeSilencio: 5, motivo: '' },
        }),
        conversacion: { persona_nombre: 'Juan' },
      },
      relojFijo('2026-07-31T12:00:00Z'),
    );

    expect(resultado.grupos[resultado.grupos.length - 1].etiqueta).toBe('Sin fecha');
    const ultimoGrupo = resultado.grupos[resultado.grupos.length - 1].eventos;
    expect(ultimoGrupo.map((e) => e.tipo)).toEqual(['identidad', 'enfriamiento']);
  });

  it('agrupa por día con etiquetas del reloj inyectado: Hoy, Ayer, fecha, Sin fecha', () => {
    const resultado = ensamblarTimeline(
      {
        intereses: [
          interes({ curso: 'Hoy', creadoAt: '2026-07-31T08:00:00Z' }),
          interes({ curso: 'Ayer', creadoAt: '2026-07-30T09:00:00Z' }),
          interes({ curso: 'Viejo', creadoAt: '2026-07-14T09:00:00Z' }),
        ],
        conversacion: { persona_nombre: 'Sin fecha' },
      },
      relojFijo('2026-07-31T12:00:00Z'),
    );

    const jul14 = new Date('2026-07-14T09:00:00Z').toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
    expect(resultado.grupos.map((g) => g.etiqueta)).toEqual(['Hoy', 'Ayer', jul14, 'Sin fecha']);
    expect(resultado.grupos[0].eventos.map((e) => e.valor)).toEqual(['Hoy']);
    expect(resultado.grupos[1].eventos.map((e) => e.valor)).toEqual(['Ayer']);
  });

  it('fecha de hace más de un año usa fecha larga', () => {
    const resultado = ensamblarTimeline(
      {
        intereses: [interes({ curso: 'Viejo', creadoAt: '2025-01-05T09:00:00Z' })],
      },
      relojFijo('2026-07-31T12:00:00Z'),
    );

    const esperado = new Date('2025-01-05T09:00:00Z').toLocaleDateString('es-PE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    expect(resultado.grupos[0].etiqueta).toBe(esperado);
  });

  it('id estable: el mismo evento produce el mismo id, con timestamp y valor adentro', () => {
    const datos = { intereses: [interes({ curso: 'Oratoria', creadoAt: '2026-05-01T12:00:00Z' })] };
    const a = eventosDe(ensamblarTimeline(datos, relojFijo('2026-07-31T12:00:00Z')));
    const b = eventosDe(ensamblarTimeline(datos, relojFijo('2026-07-31T12:00:00Z')));

    expect(a[0].id).toBe(b[0].id);
    expect(a[0].id).toBe('interes_registrado:2026-05-01T12:00:00Z:Oratoria');
  });

  it('sin timestamp, el id usa «sin-fecha» y valor vacío para el hueco', () => {
    const resultado = eventosDe(
      ensamblarTimeline({ conversacion: { persona_nombre: 'Juan' } }, relojFijo('2026-07-31T12:00:00Z')),
    );

    expect(resultado[0].id).toBe('identidad:sin-fecha:Juan');
  });
});

/**
 * 🔴 H7: EL CORREO TIENE QUE VERSE EN EL TIMELINE.
 *
 * La columna `correos.clave` existió desde el 21-jul-2026 **sin un solo lector**:
 * el front no la mandaba, el server no la consultaba y las tres filas de
 * producción la tenían en NULL. Este frente cerró la cadena entera y el defecto
 * apareció DOS veces más en el camino, siempre con la misma forma —el dato llega
 * y alguien lo descarta en un borde, sin error y sin log—: primero el server no
 * lo consultaba, después `useEventos` lo tiraba con un `select`.
 *
 * Estos tests fijan el último tramo. Lo que protegen no es «se dibuja un
 * renglón»: es que **un correo nunca se pueda confundir con un evento editable**,
 * porque esa confusión archiva la fila de otra persona.
 */
describe('H7 — los correos en el timeline', () => {
  const CORREO = {
    id: 7,
    vendedoraId: 'ventas11@grupogoberna.com',
    para: 'lead@gmail.com',
    asunto: 'Diplomado en Gestión Pública',
    estado: 'enviado',
    motivo: null,
    creadoAt: '2026-08-17T15:00:00.000Z',
  };

  const lineas = (correos: unknown[]) =>
    ensamblarTimeline({ correos: correos as never, yo: 'luz' }).grupos.flatMap((g) => g.eventos);

  it('un correo enviado aparece, con su asunto y quién lo mandó', () => {
    const [linea] = lineas([CORREO]).filter((e) => e.tipo === 'correo');
    expect(linea, 'el correo no llegó al timeline').toBeDefined();
    expect(linea.valor).toBe('Diplomado en Gestión Pública');
    expect(linea.estado).toBe('confirmado');
    expect(linea.comentario).toContain('lead@gmail.com');
    expect(linea.autor, 'sin autor, un correo se lee como algo que pasó solo').toBeTruthy();
  });

  it('🔴 NO trae `eventoId` ni `editable`: con eso, Borrar archivaría el evento manual con ese id', () => {
    // `eventos_contacto.id` y `correos.id` son dos bigserial independientes: el
    // evento 7 y el correo 7 existen los dos a la vez.
    const [linea] = lineas([CORREO]).filter((e) => e.tipo === 'correo');
    expect(linea.eventoId).toBeUndefined();
    expect(linea.editable).toBeFalsy();
    expect(linea.mio, 'sin `mio` no se dibujan Editar ni Borrar').toBeFalsy();
  });

  it('🔴 el que NO salió se ve distinto y dice por qué', () => {
    const [linea] = lineas([
      { ...CORREO, estado: 'fallido', motivo: '550 mailbox unavailable' },
    ]).filter((e) => e.tipo === 'correo');
    expect(linea.estado).toBe('fallido');
    expect(linea.rotulo).not.toBe('Correo enviado');
    expect(linea.comentario, 'el motivo es lo único accionable que hay').toContain('550');
  });

  it('⚠️ un `estado` que este build no conoce se DIBUJA (no se descarta ni se afirma fallido)', () => {
    // La columna es `text` y el vocabulario crece del lado del server (N4 va solo,
    // N5 es un botón). Descartar escondería justo el correo raro.
    const [linea] = lineas([{ ...CORREO, estado: 'rebotado' }]).filter((e) => e.tipo === 'correo');
    expect(linea, 'un estado nuevo no puede hacer desaparecer el correo').toBeDefined();
    expect(linea.estado).toBe('confirmado');
  });

  it('⚠️ sin correos (server viejo o caché de ayer) el timeline se arma igual', () => {
    expect(() => ensamblarTimeline({ yo: 'luz' })).not.toThrow();
    expect(lineas([]).filter((e) => e.tipo === 'correo')).toHaveLength(0);
  });
});

describe('la ficha y los seguimientos en el timeline', () => {
  it('la ficha registrada entra como hecho MANUAL, con su autora', () => {
    const { grupos } = ensamblarTimeline({
      fichaLocal: { creadoAt: '2026-08-18T16:09:00.000Z', vendedoraId: 'ventas12@grupogoberna.com' },
    });
    const e = grupos.flatMap((g) => g.eventos).find((x) => x.tipo === 'ficha');

    expect(e?.rotulo).toBe('Contacto registrado');
    expect(e?.estado).toBe('manual');
    expect(e?.autor).toBe('Ventas12');
  });

  it('un seguimiento pendiente es lo ÚNICO del timeline que todavía no pasó', () => {
    const { grupos } = ensamblarTimeline({
      seguimientos: [{ id: 7, nota: 'llamarla', cuando: '2026-08-19T14:00:00.000Z', estado: 'pendiente' }],
    });
    const e = grupos.flatMap((g) => g.eventos).find((x) => x.tipo === 'seguimiento');

    expect(e?.rotulo).toBe('Seguimiento agendado');
    expect(e?.estado).toBe('pendiente');
    expect(e?.valor).toBe('llamarla');
  });

  it('cumplido y cancelado no se leen igual — son dos historias distintas', () => {
    const { grupos } = ensamblarTimeline({
      seguimientos: [
        { id: 1, nota: 'la llamé', cuando: '2026-08-17T14:00:00.000Z', estado: 'hecho' },
        { id: 2, nota: 'ya no hace falta', cuando: '2026-08-17T15:00:00.000Z', estado: 'cancelado' },
      ],
    });
    const rotulos = grupos.flatMap((g) => g.eventos).map((e) => e.rotulo);

    expect(rotulos).toContain('Seguimiento cumplido');
    expect(rotulos).toContain('Seguimiento cancelado');
  });
});
