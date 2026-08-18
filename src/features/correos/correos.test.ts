import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../../lib/datos/cliente';
import {
  TOPE_CUERPO,
  agruparPorDia,
  etiquetaDia,
  lecturaDeError,
  motivoParaNoEnviar,
  resumenDelSobre,
  techoQuemado,
  type CamposDelCorreo,
} from './correos';
import type { EstadoDeCorreos, RemitentePublico } from './tipos';

/**
 * LOS CANDADOS DE CORREOS.
 *
 * Cada test se llama por **el defecto que impide**, no por la función que toca:
 * el nombre de un test es lo único que se lee cuando se pone rojo dentro de seis
 * meses, y «funciona ok» no le dice a nadie qué se rompió ni por qué importaba.
 */

const REMITENTE: RemitentePublico = {
  id: 1,
  direccion: 'escuela@goberna.us',
  nombre: 'Escuela Goberna',
  responderA: 'escuela@goberna.us',
  firma: 'Escuela de Gobierno',
};

const ESTADO: EstadoDeCorreos = {
  conectado: true,
  desde: 'Escuela Goberna <escuela@goberna.us>',
  remitentes: [REMITENTE],
  sinRemitentes: false,
  supervisor: false,
  dominiosVerificados: ['goberna.us'],
  ritmo: { techoHora: 20, techoDia: 60, usadoHora: 0, usadoDia: 0 },
};

const LLENO: CamposDelCorreo = {
  para: 'lead@ejemplo.com',
  asunto: 'El Foro de Estado',
  cuerpo: 'Hola, te paso el temario.',
  remitenteId: 1,
};

/** El motivo, o `null` si dijo que sí. Para no repetir el narrowing en cada test. */
function porQueNo(campos: Partial<CamposDelCorreo>, estado: EstadoDeCorreos | undefined = ESTADO) {
  const r = motivoParaNoEnviar({ ...LLENO, ...campos }, estado);
  return r.puede ? null : r.motivo;
}

describe('motivoParaNoEnviar — el botón y ⌘↵ preguntan lo MISMO', () => {
  it('con todo lleno y el canal andando, deja mandar', () => {
    expect(motivoParaNoEnviar(LLENO, ESTADO)).toEqual({ puede: true });
  });

  it('frena el cuerpo largo — el tope que el acorde ⌘↵ se salteaba cuando cada puerta tenía su condición', () => {
    // La versión vieja apagaba el botón con `para && asunto && cuerpo` y el onKeyDown
    // repetía esa misma cuenta: cualquier tope agregado a una puerta no existía en la
    // otra. Es el defecto textual de Ivi (#169), donde pegar 4.500 caracteres apagaba
    // el botón y el acorde mandaba igual.
    const motivo = porQueNo({ cuerpo: 'x'.repeat(TOPE_CUERPO + 1) });
    expect(motivo).toContain('20.000');
    // Y dice CUÁNTO sobra: sin eso, borrar «un poco» es prueba y error.
    expect(motivo).toContain('sobra');
  });

  it('el cuerpo justo en el tope SÍ sale — el error clásico del `>` por el `>=`', () => {
    expect(motivoParaNoEnviar({ ...LLENO, cuerpo: 'x'.repeat(TOPE_CUERPO) }, ESTADO)).toEqual({
      puede: true,
    });
  });

  it('el motivo del techo dice el NÚMERO, no «no se pudo»', () => {
    const motivo = porQueNo(
      {},
      { ...ESTADO, ritmo: { techoHora: 20, techoDia: 60, usadoHora: 20, usadoDia: 25 } },
    );
    expect(motivo).toContain('20 de 20');
    // Y dice cuándo se destraba: un aviso sin eso sólo invita a volver a apretar.
    expect(motivo).toContain('hora');
  });

  it('con las DOS ventanas quemadas nombra la HORA, no el día — el día manda a esperar hasta mañana de más', () => {
    const motivo = porQueNo(
      {},
      { ...ESTADO, ritmo: { techoHora: 20, techoDia: 60, usadoHora: 25, usadoDia: 70 } },
    );
    expect(motivo).toContain('esta hora');
    expect(motivo).not.toContain('mañana');
  });

  it('el techo del día se nombra sólo cuando la hora está libre', () => {
    const motivo = porQueNo(
      {},
      { ...ESTADO, ritmo: { techoHora: 20, techoDia: 60, usadoHora: 3, usadoDia: 60 } },
    );
    expect(motivo).toContain('60 de 60');
    expect(motivo).toContain('mañana');
  });

  /**
   * 🔴 **Lo que se fija es la RELACIÓN, no cada mitad por su lado.** El contador de
   * la cabecera se pinta con `techoQuemado` y el botón se apaga con
   * `motivoParaNoEnviar`: si alguien vuelve a escribir el `>=` adentro del JSX, el
   * número puede quedar gris sobre un botón apagado —el defecto original, invisible
   * hasta apretar Enviar— o gritar sobre un botón que anda, que frena a alguien que
   * sí podía mandar. Ninguna de las dos cosas rompe nada, y por eso hace falta el test.
   */
  it('el contador de la cabecera se enciende EXACTAMENTE cuando el botón se apaga', () => {
    const casos = [
      { techoHora: 20, techoDia: 60, usadoHora: 0, usadoDia: 0 },
      { techoHora: 20, techoDia: 60, usadoHora: 19, usadoDia: 59 },
      { techoHora: 20, techoDia: 60, usadoHora: 20, usadoDia: 25 },
      { techoHora: 20, techoDia: 60, usadoHora: 3, usadoDia: 60 },
      { techoHora: 20, techoDia: 60, usadoHora: 25, usadoDia: 70 },
    ];
    for (const ritmo of casos) {
      const frenaElBoton = !motivoParaNoEnviar(LLENO, { ...ESTADO, ritmo }).puede;
      expect(techoQuemado(ritmo) !== null, JSON.stringify(ritmo)).toBe(frenaElBoton);
    }
  });

  it('sin `ritmo` el contador NO se pinta de quemado — sobre un campo ausente diría que está frenada sin estarlo', () => {
    expect(techoQuemado(undefined)).toBe(null);
  });

  it('con las dos ventanas llenas el contador nombra la HORA — es la que se destraba antes', () => {
    expect(techoQuemado({ techoHora: 20, techoDia: 60, usadoHora: 25, usadoDia: 70 })).toBe('hora');
  });

  it('sin `ritmo` NO frena — un server viejo no lo emite y la vista quedaría muerta toda la ventana N4↔N5', () => {
    const { ritmo: _, ...sinRitmo } = ESTADO;
    expect(motivoParaNoEnviar(LLENO, sinRitmo)).toEqual({ puede: true });
  });

  it('el canal caído se dice ANTES que las cajas vacías — si no, manda a llenar un formulario que no va a servir', () => {
    const motivo = porQueNo({ para: '', asunto: '', cuerpo: '' }, { ...ESTADO, conectado: false });
    expect(motivo).toContain('no está conectado');
  });

  it('mientras el estado no llegó NO se afirma que el canal está caído', () => {
    // ⚠️ No pasa por `porQueNo`: su parámetro tiene default, así que un `undefined`
    // explícito se convertiría en ESTADO y el test verificaría lo contrario en verde.
    const r = motivoParaNoEnviar(LLENO, undefined);
    expect(r.puede).toBe(false);
    const motivo = r.puede ? '' : r.motivo;
    expect(motivo).not.toContain('no está conectado');
    expect(motivo).toContain('Todavía');
  });

  it('las cajas se reclaman en el orden de la pantalla: Para antes que Asunto antes que Cuerpo', () => {
    expect(porQueNo({ para: '  ', asunto: '', cuerpo: '' })).toContain('a quién');
    expect(porQueNo({ asunto: '   ', cuerpo: '' })).toContain('asunto');
    expect(porQueNo({ cuerpo: '\n \n' })).toContain('texto');
  });

  it('pide elegir remitente cuando hay de dónde elegir y todavía no eligió', () => {
    expect(porQueNo({ remitenteId: null })).toContain('remitente');
  });

  it('con `sinRemitentes` NO pide elegir — se manda por el SMTP_FROM de compatibilidad', () => {
    // Pedir que se elija algo que no existe deja la vista trabada sin decir contra qué.
    const compat: EstadoDeCorreos = { conectado: true, desde: 'a@goberna.us', sinRemitentes: true };
    expect(motivoParaNoEnviar({ ...LLENO, remitenteId: null }, compat)).toEqual({ puede: true });
  });

  it('un envío en vuelo frena el segundo ⌘↵ — dos acordes seguidos mandaban dos correos al mismo lead', () => {
    expect(porQueNo({ enVuelo: true })).toContain('saliendo');
  });
});

describe('lecturaDeError — un rechazo por diseño no se lee como una falla', () => {
  it('el 400 «varios» dice que va UNO POR CORREO, y no «no se pudo enviar»', () => {
    // 🔴 Quien escribió `ana@x.com, beto@y.com` cree que puso una lista y que el
    // sistema falló: con un mensaje genérico vuelve a apretar Enviar y después avisa
    // que Correos está roto. Y hasta este frente esa cadena SALÍA, partida en dos
    // destinatarios por nodemailer, con una sola fila en la auditoría.
    const l = lecturaDeError(
      new ErrorApi('destinatario inválido', 400, undefined, undefined, undefined, undefined, {
        motivo: 'varios',
      }),
    );
    expect(l.texto).toContain('una sola persona');
    expect(l.texto.toLowerCase()).not.toContain('no se pudo enviar');
    // Reintentar con el mismo texto no puede dar otro resultado: no se ofrece.
    expect(l.reintentable).toBe(false);
  });

  it('los otros tres motivos del destinatario NO se colapsan en «revisá el correo»', () => {
    const con = (motivo: string) =>
      lecturaDeError(new ErrorApi('', 400, undefined, undefined, undefined, undefined, { motivo })).texto;

    // Decirle «pusiste varios» a quien escribió `Ana <ana@x.com>` la manda a buscar
    // una coma que no existe: cada motivo tiene que apuntar a otra corrección.
    expect(con('vacio')).toContain('vacía');
    expect(con('forma')).toContain('arroba');
    expect(con('salto_de_linea')).toContain('renglón');
    expect(new Set([con('vacio'), con('forma'), con('salto_de_linea'), con('varios')]).size).toBe(4);
  });

  it('el 429 dice el número y cuándo se destraba', () => {
    const l = lecturaDeError(
      new ErrorApi('', 429, undefined, undefined, 'techo_de_ritmo', undefined, {
        motivo: 'techo_hora',
        techo: 20,
        usado: 20,
      }),
    );
    expect(l.texto).toContain('20 de 20');
    expect(l.texto).toContain('hora');
    expect(l.reintentable).toBe(false);
  });

  it('el 429 sin cifras usables NO inventa un número ni las concatena crudas', () => {
    // Un `techo` que llega como cadena saldría en pantalla como «(20 de "20")» y,
    // peor, abriría la puerta a que cualquier texto del server llegue a la vista.
    const l = lecturaDeError(
      new ErrorApi('', 429, undefined, undefined, 'techo_de_ritmo', undefined, {
        motivo: 'techo_dia',
        techo: '60',
      }),
    );
    expect(l.texto).not.toContain('60');
    expect(l.texto).toContain('mañana');
  });

  it('el 503 dice que falta configuración de sistemas, no que la vendedora hizo algo mal', () => {
    const l = lecturaDeError(new ErrorApi('', 503));
    expect(l.texto).toContain('SMTP');
    expect(l.reintentable).toBe(false);
  });

  it('el 403 habla de administrar remitentes, no de perder el permiso de escribirle a un lead', () => {
    const l = lecturaDeError(new ErrorApi('', 403, undefined, undefined, 'no_es_supervisor'));
    expect(l.texto).toContain('supervisor');
  });

  it('el 502 muestra el motivo del proveedor — sin él, «la casilla no existe» y «se cayó» se leen igual', () => {
    const l = lecturaDeError(new ErrorApi('Email address is not verified', 502));
    expect(l.texto).toContain('not verified');
    expect(l.reintentable).toBe(true);
  });

  it('el 409 del remitente retirado NO se presenta como un bug de Hermes', () => {
    // 🔴 El propio frente modela este caso —otra supervisora retiró el buzón mientras
    // ésta tenía el composer abierto— y sin rama caía en «el server contestó algo que
    // esta versión de Hermes no reconoce (409)»: la pantalla mandando a reportar el
    // programa en vez de a elegir otro remitente, que es lo único que hace falta.
    const l = lecturaDeError(new ErrorApi('', 409, undefined, undefined, 'remitente_retirado'));
    expect(l.texto).toMatch(/se retiró/i);
    expect(l.texto).toMatch(/elegí otro/i);
    expect(l.texto).not.toMatch(/no reconoce/i);
    // Mandar otra vez lo mismo vuelve a fallar: lo que destraba es cambiar el sobre.
    expect(l.reintentable).toBe(false);
  });

  it('el 404 del remitente desconocido se lee distinto del 409 — se arreglan distinto', () => {
    const l = lecturaDeError(new ErrorApi('', 404, undefined, undefined, 'remitente_desconocido'));
    expect(l.texto).toMatch(/ya no existe/i);
    expect(l.texto).not.toMatch(/no reconoce/i);

    const retirado = lecturaDeError(new ErrorApi('', 409, undefined, undefined, 'remitente_retirado'));
    // El server paga una segunda consulta SÓLO para distinguirlos; colapsarlos acá
    // tiraría ese trabajo y dejaría a la pantalla dando el consejo equivocado.
    expect(l.texto).not.toBe(retirado.texto);
  });

  it('un 404 SIN código no le inventa un remitente que nadie tocó', () => {
    // ⚠️ `GET /api/correos/:id` también contesta 404 (`correo_desconocido`): ramificar
    // por el número en vez de por el código afirmaría con total seguridad que voló un
    // remitente, sobre un pedido que ni siquiera nombra uno.
    const l = lecturaDeError(new ErrorApi('Ese correo no existe.', 404));
    expect(l.texto).not.toMatch(/remitente/i);
    expect(l.texto).toContain('Ese correo no existe.');
  });

  it('un estado que esta versión no conoce cae en una lectura conservadora, NUNCA en un throw', () => {
    // El server sale por N5 y la app por N4: los códigos nuevos llegan antes que la
    // versión de la app que los conoce.
    const l = lecturaDeError(new ErrorApi('vaya a saber', 418, undefined, undefined, 'inventado'));
    expect(l.texto).toContain('418');
    expect(l.reintentable).toBe(false);
  });

  it('ninguna lectura se puede confundir con «no pasó nada» o «no hay nada»', () => {
    const casos: unknown[] = [
      new Error('boom'),
      new ErrorApi('', 401),
      new ErrorApi('', 400, undefined, undefined, undefined, undefined, { motivo: 'varios' }),
      new ErrorApi('', 429, undefined, undefined, undefined, undefined, { motivo: 'techo_dia' }),
      new ErrorApi('', 403),
      new ErrorApi('', 503),
      new ErrorApi('x', 502),
      new ErrorApi('', 418),
    ];
    for (const c of casos) {
      const { texto } = lecturaDeError(c);
      expect(texto.trim()).not.toBe('');
      expect(texto.toLowerCase()).not.toMatch(/no hay (nada|correos)/);
    }
  });

  it('lo que NO es un ErrorApi no promete que el correo salió', () => {
    const l = lecturaDeError(new TypeError('Failed to fetch'));
    expect(l.texto).toContain('no salió');
    expect(l.reintentable).toBe(true);
  });

  it('el `reintentable` del server le gana a esta tabla — la lección de #175', () => {
    // El 503 de la tabla dice que no sirve reintentar; si el server se pronuncia, manda él.
    const l = lecturaDeError(new ErrorApi('', 503, undefined, undefined, undefined, true));
    expect(l.reintentable).toBe(true);
  });
});

describe('resumenDelSobre — la pantalla MUESTRA el sobre en vez de prometerlo', () => {
  it('un vendedora_id que es correo se queda con el Reply-To, por encima del buzón compartido', () => {
    // 🔴 D2 del dueño: con el `responderA` arriba, la respuesta de un lead que Sindy
    // trabajó hace tres días le llega a todo el equipo y a nadie en particular — que
    // es el agujero que este frente vino a tapar.
    const s = resumenDelSobre(REMITENTE, 'ventas10@grupogoberna.com', null);
    expect(s.respondeA).toBe('ventas10@grupogoberna.com');
    expect(s.de).toBe('Ventas10 · Escuela Goberna <escuela@goberna.us>');
  });

  it('un vendedora_id que NO es correo cae al responderA del remitente, no a una dirección inventada', () => {
    const s = resumenDelSobre(REMITENTE, 'luz', null);
    expect(s.respondeA).toBe('escuela@goberna.us');
    expect(s.de).toBe('Luz · Escuela Goberna <escuela@goberna.us>');
  });

  it('el From sale por el dominio VERIFICADO aunque la vendedora sea de grupogoberna.com', () => {
    // SES verifica de quién SALE, no a dónde se CONTESTA: ponerla de From es un 554
    // con un lead esperando del otro lado.
    const s = resumenDelSobre(REMITENTE, 'ventas12@grupogoberna.com', null);
    expect(s.de).toContain('<escuela@goberna.us>');
    expect(s.de).not.toContain('<ventas12@grupogoberna.com>');
  });

  it('sin responderA y con un id que no es correo, se dice que no se sabe — no se inventa un buzón', () => {
    const s = resumenDelSobre({ ...REMITENTE, responderA: '   ' }, 'Sindy', null);
    expect(s.respondeA).toBeNull();
  });

  it('sin remitente dado de alta se muestra el SMTP_FROM, no un sobre vacío', () => {
    // Un `de` en blanco se lee como que algo se rompió; es el camino de compatibilidad.
    const s = resumenDelSobre(null, 'luz', 'Escuela Goberna <escuela@goberna.us>');
    expect(s.de).toBe('Escuela Goberna <escuela@goberna.us>');
    expect(s.respondeA).toBeNull();
  });

  it('sin nombre del remitente no queda un « · » huérfano', () => {
    const s = resumenDelSobre({ ...REMITENTE, nombre: '  ' }, 'luz', null);
    expect(s.de).toBe('Luz <escuela@goberna.us>');
  });

  it('una coma en el vendedora_id no se cuela al Reply-To — ahí un buzón se vuelve dos', () => {
    const s = resumenDelSobre(REMITENTE, 'a@x.com, b@y.com', null);
    expect(s.respondeA).toBe('escuela@goberna.us');
  });
});

describe('agruparPorDia — la lista de enviados', () => {
  const AHORA = new Date(2026, 7, 17, 15, 0, 0); // 17-ago-2026, hora local

  const el = (y: number, m: number, d: number, h = 10) =>
    new Date(y, m, d, h, 0, 0).toISOString();

  it('dice «hoy» y «ayer» — con el reloj inyectado, porque si no el candado se pone rojo solo a medianoche', () => {
    expect(etiquetaDia(el(2026, 7, 17), AHORA)).toBe('hoy');
    expect(etiquetaDia(el(2026, 7, 16), AHORA)).toBe('ayer');
  });

  it('una fecha de otro año lleva el AÑO — «lun 14 jul» sobre un correo de 2025 se lee como de hace tres semanas', () => {
    expect(etiquetaDia(el(2025, 6, 14), AHORA)).toContain('2025');
  });

  it('una fecha del mismo año no repite el año pero sí el día de la semana', () => {
    const e = etiquetaDia(el(2026, 6, 14), AHORA);
    expect(e).not.toContain('2026');
    expect(e).toContain('14');
  });

  it('una fecha que no parsea se muestra CRUDA, nunca tira y nunca deja la lista sin dibujar', () => {
    expect(etiquetaDia('mañana a la tarde', AHORA)).toBe('mañana a la tarde');
    expect(agruparPorDia([{ creadoAt: 'ni idea' }], AHORA)).toHaveLength(1);
  });

  it('agrupa los del mismo día juntos y respeta el orden en el que vinieron', () => {
    const grupos = agruparPorDia(
      [
        { id: 1, creadoAt: el(2026, 7, 17, 14) },
        { id: 2, creadoAt: el(2026, 7, 17, 9) },
        { id: 3, creadoAt: el(2026, 7, 16, 18) },
      ],
      AHORA,
    );
    expect(grupos.map((g) => g.etiqueta)).toEqual(['hoy', 'ayer']);
    expect(grupos[0].correos.map((c) => c.id)).toEqual([1, 2]);
  });

  it('NO reordena: un día repetido se ve repetido, porque el orden lo decide el server', () => {
    // Reordenar acá sería la misma regla en dos lados (#37) — la cola tampoco se
    // reordena en el navegador. Y un día partido en dos es el SÍNTOMA de que el
    // server cambió el orden: esconderlo con un `sort` lo vuelve invisible.
    const grupos = agruparPorDia(
      [
        { creadoAt: el(2026, 7, 17, 14) },
        { creadoAt: el(2026, 7, 16, 18) },
        { creadoAt: el(2026, 7, 17, 8) },
      ],
      AHORA,
    );
    expect(grupos.map((g) => g.etiqueta)).toEqual(['hoy', 'ayer', 'hoy']);
  });

  it('sin correos no arma ningún grupo', () => {
    expect(agruparPorDia([], AHORA)).toEqual([]);
  });
});
