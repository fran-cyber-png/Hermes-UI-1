// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { escribir, montar, reposar, teclear, tocar, type Montado } from '../../pruebas/dom';
import { VistaCorreos } from './VistaCorreos';
import { TOPE_CUERPO } from './correos';
import type { EstadoDeCorreos } from './tipos';

/**
 * EL CANDADO DE LA COPIA — montado de verdad, porque lo que se rompió no fue una
 * función.
 *
 * 🔴 **El defecto que este archivo existe para que no vuelva no era un bug: eran
 * dos frases.** «Se envía solo a esta persona, con tu nombre» en el pie y «(va en
 * texto plano, con tu firma de siempre)» en el placeholder. Ninguna prueba pura
 * las podía ver —no hay función que las devuelva— y ninguna captura las delataba,
 * porque el texto se leía perfectamente razonable: el `From` era el buzón
 * compartido para las nueve vendedoras, no había `Reply-To` y la firma no la
 * agregaba nadie. Una promesa que el código no cumple **se ve idéntica a una que
 * sí**, y por eso el candado tiene que mirar el DOM.
 *
 * Lo que se fija es la RELACIÓN, no la redacción: que lo que la pantalla dice
 * sobre el sobre salga de los datos que llegaron (`resumenDelSobre`), y que
 * ninguna de las dos promesas vuelva a aparecer.
 */

let montado: Montado | null = null;

const REMITENTE = {
  id: 7,
  direccion: 'escuela@goberna.us',
  nombre: 'Escuela Goberna',
  responderA: 'escuela@goberna.us',
  firma: 'Escuela de Goberna\nLima, Perú',
};

function estadoQueContesta(extra: Partial<EstadoDeCorreos> = {}): EstadoDeCorreos {
  return {
    conectado: true,
    desde: 'escuela@goberna.us',
    remitentes: [REMITENTE],
    sinRemitentes: false,
    supervisor: false,
    dominiosVerificados: ['goberna.us'],
    ritmo: { techoHora: 20, techoDia: 60, usadoHora: 3, usadoDia: 11 },
    ...extra,
  };
}

/** Un token que `quienDiceSer` acepta sin server: `<id>|<vencimiento>` en base64url. */
function tokenVivo(id: string): string {
  const cuerpo = btoa(`${id}|${Date.now() + 60 * 60 * 1000}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${cuerpo}.firma-que-nadie-mira-acá`;
}

/**
 * LO QUE LA VISTA LE MANDÓ AL SERVER, en orden.
 *
 * 🔴 **Se espía el POST y no la pantalla, porque los dos candados que importan son
 * sobre lo que SALE.** Que `⌘↵` no mande con el cuerpo pasado del tope no se puede
 * ver mirando el DOM (la pantalla queda idéntica), y que la `clave` del puente viaje
 * tampoco: el correo se manda igual sin ella, sólo que después no existe para
 * ningún timeline ni para ninguna medición — las tres filas que hay en producción
 * la tienen en `NULL` y por eso son invisibles.
 */
const posts: { url: string; cuerpo: Record<string, unknown> }[] = [];

const OK = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** Un rechazo del server tal como llega: estado + el cuerpo con sus cifras. */
function rechazo(status: number, cuerpo: Record<string, unknown>) {
  return () =>
    new Response(JSON.stringify(cuerpo), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

function servidor(estado: EstadoDeCorreos, alEnviar: () => Response = OK) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/correos/enviar')) {
      posts.push({ url: u, cuerpo: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      return alEnviar();
    }
    const cuerpo = u.includes('/api/correos/estado') ? estado : { correos: [] };
    return new Response(JSON.stringify(cuerpo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

/**
 * ⚠️ **UN SOLO `reposar()` NO ALCANZA, y el síntoma es un flake ordenado.** La vista
 * espera DOS consultas y TanStack mete varios turnos del event loop entre el `fetch`
 * y el repintado; encima el primer caso del archivo paga además la compilación de los
 * módulos. Con un tick, el que corría primero veía la pantalla en «Viendo por dónde
 * sale…» y los siguientes pasaban — o sea un test que falla o no según en qué orden
 * lo corran, que es peor que uno que falla siempre. Por eso se espera **la condición**
 * (que el canal ya haya contestado) y no una cantidad de ticks.
 */
async function esperarAlCanal(m: Montado): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (!(m.contenedor.textContent ?? '').includes('Viendo por dónde sale')) return;
    await reposar();
  }
}

async function abrir(
  estado: EstadoDeCorreos,
  vendedoraId: string,
  alEnviar: () => Response = OK,
): Promise<Montado> {
  localStorage.setItem('hermes.token', tokenVivo(vendedoraId));
  vi.stubGlobal('fetch', servidor(estado, alEnviar));
  montado = montar(<VistaCorreos />);
  await esperarAlCanal(montado);
  return montado;
}

/** Las tres cajas llenas con algo válido: el punto de partida de todo lo que MANDA. */
function llenarComposer(m: Montado, cuerpo = 'Hola, te paso el temario.'): void {
  escribir(m.contenedor.querySelector('input[type="email"]') as HTMLInputElement, 'ana@correo.com');
  escribir(m.contenedor.querySelector('input[aria-label="Asunto"]') as HTMLInputElement, 'El temario');
  escribir(m.contenedor.querySelector('textarea') as HTMLTextAreaElement, cuerpo);
}

function botonEnviar(m: Montado): HTMLButtonElement {
  return [...m.contenedor.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes('Enviar'),
  ) as HTMLButtonElement;
}

/** El acorde tal como lo teclea la vendedora: el foco vive en el cuerpo. */
function acordeDeEnviar(m: Montado): void {
  teclear('Enter', { target: m.contenedor.querySelector('textarea') as HTMLTextAreaElement, meta: true });
}

/**
 * ⚠️ Mismo motivo que `esperarAlCanal`: la mutación tarda varios turnos del event
 * loop y esperar «dos ticks» daría un test que pasa o no según el orden.
 */
async function esperarAviso(m: Montado): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const aviso = m.contenedor.querySelector('[role="status"]');
    if (aviso) return aviso.textContent ?? '';
    await reposar();
  }
  return '';
}

beforeEach(() => {
  localStorage.clear();
  posts.length = 0;
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
  localStorage.clear();
  posts.length = 0;
});

describe('VistaCorreos — la pantalla MUESTRA el sobre en vez de prometerlo', () => {
  it('no vuelve a prometer el nombre ni la firma', async () => {
    const { contenedor } = await abrir(estadoQueContesta(), 'ventas11@grupogoberna.com');
    const texto = contenedor.textContent ?? '';
    const placeholders = [...contenedor.querySelectorAll('input, textarea')]
      .map((c) => (c as HTMLInputElement | HTMLTextAreaElement).placeholder)
      .join(' · ');

    expect(texto).not.toContain('con tu nombre');
    expect(texto).not.toContain('Nada masivo');
    expect(placeholders).not.toContain('con tu firma de siempre');
    expect(placeholders).not.toContain('texto plano');
  });

  it('dibuja el De: con el nombre de quien escribe y el buzón por el que sale', async () => {
    const { contenedor } = await abrir(estadoQueContesta(), 'luz');
    // `Luz · Escuela Goberna <escuela@goberna.us>` — las tres partes salen de datos:
    // el nombre corto de la vendedora, el del remitente y su dirección.
    expect(contenedor.textContent).toContain('Escuela Goberna <escuela@goberna.us>');
  });

  it('dice a dónde vuelve la respuesta cuando el `vendedora_id` ES un buzón', async () => {
    const { contenedor } = await abrir(estadoQueContesta(), 'ventas11@grupogoberna.com');
    expect(contenedor.textContent).toContain('Las respuestas te llegan a vos');
    expect(contenedor.textContent).toContain('ventas11@grupogoberna.com');
  });

  it('y lo sigue diciendo si entró tipeando el id con OTRA grafía', async () => {
    /**
     * ⚠️ **HONESTIDAD SOBRE ESTE CANDADO: hoy pasa también con la comparación exacta
     * que vino a reemplazar** — se verificó corriendo este archivo contra la versión
     * vieja. No es un test flojo, es que el defecto todavía no puede dispararse: cuando
     * el `Reply-To` es de ella, `resumenDelSobre` lo devuelve derivado de
     * `vendedoraId.trim()`, o sea la misma cadena por construcción.
     *
     * 🔴 **Lo que fija es la RELACIÓN, y por eso vale**: se pone rojo el día que
     * alguien normalice el `Reply-To` de un solo lado —bajarlo a minúsculas al armar el
     * sobre es lo primero que uno haría, y las cabeceras de correo no distinguen
     * mayúsculas— dejando la comparación exacta. Ese es exactamente el bug mudo que
     * este repo ya pagó cuatro veces: sin error, sin log, la afirmación se apaga sola.
     * En producción conviven `luz`/`Luz`, `usuario1`/`Usuario1` y `usuario2`/`Usuario2`
     * del MISMO humano, así que la grafía de más arriba no es la única que llega.
     */
    const { contenedor } = await abrir(estadoQueContesta(), 'Ventas11@grupogoberna.com');
    expect(contenedor.textContent).toContain('Las respuestas te llegan a vos');
    expect(contenedor.textContent).not.toContain('buzón compartido');
  });

  it('cuando no hay a quién responderle, lo DICE en vez de callarse', async () => {
    // `luz` no es un buzón y este remitente no tiene `responderA`: la respuesta del
    // lead cae en el buzón compartido, que es exactamente el agujero que hay que ver
    // ANTES de mandar, no después.
    const { contenedor } = await abrir(
      estadoQueContesta({ remitentes: [{ ...REMITENTE, responderA: null }] }),
      'luz',
    );
    expect(contenedor.textContent).toContain('no en tu casilla');
  });

  it('la firma se ofrece colapsada y NO se pega en el cuerpo', async () => {
    const { contenedor } = await abrir(estadoQueContesta(), 'luz');
    const cuerpo = contenedor.querySelector('textarea') as HTMLTextAreaElement;

    expect(contenedor.textContent).toContain('ver firma');
    // Pegarla acá la mandaría dos veces: el server ya la agrega al final.
    expect(cuerpo.value).toBe('');
  });

  it('con el composer vacío el botón está apagado y dice POR QUÉ', async () => {
    const { contenedor } = await abrir(estadoQueContesta(), 'luz');
    const enviar = [...contenedor.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Enviar'),
    ) as HTMLButtonElement;

    expect(enviar.disabled).toBe(true);
    // Un botón gris sin explicación se lee como que la app se colgó.
    expect(contenedor.textContent).toContain('Falta a quién se lo mandás.');
  });

  it('sin remitentes cargados no dibuja un desplegable vacío: dice por dónde sale', async () => {
    const { contenedor } = await abrir(
      estadoQueContesta({ remitentes: [], sinRemitentes: true }),
      'luz',
    );
    expect(contenedor.querySelector('select')).toBeNull();
    expect(contenedor.textContent).toContain('Todavía no hay remitentes cargados');
    expect(contenedor.textContent).toContain('escuela@goberna.us');
  });

  it('el botón de administrar remitentes es solo de quien manda', async () => {
    const { contenedor } = await abrir(estadoQueContesta({ supervisor: false }), 'luz');
    expect(contenedor.textContent).not.toContain('Administrar remitentes');

    montado?.desmontar();
    montado = null;
    vi.unstubAllGlobals();

    const conMando = await abrir(estadoQueContesta({ supervisor: true }), 'luz');
    expect(conMando.contenedor.textContent).toContain('Administrar remitentes');
  });
});

describe('VistaCorreos — el botón y ⌘↵ son la MISMA puerta', () => {
  /**
   * 🔴 **ESTE ES EL TEST QUE JUSTIFICA QUE `motivoParaNoEnviar` EXISTA.** El defecto
   * es textual, ya pasó en Ivi (#169) y no lo puede ver ningún test puro: el botón
   * se apagaba con una condición y el `onKeyDown` del textarea consultaba otra, así
   * que pegando un texto largo el botón quedaba gris **y el acorde mandaba igual**.
   * El server contestaba 400 y la pantalla decía «se rompió algo» mientras dos
   * renglones más abajo mostraba el diagnóstico correcto.
   *
   * Lo que se fija es la RELACIÓN entre las dos puertas, y por eso hacen falta los
   * dos casos: sin el feliz, este archivo pasaría en verde el día que el acorde deje
   * de andar del todo — un candado que aprueba porque la función no existe.
   */
  it('con el cuerpo pasado del tope, el botón está apagado y ⌘↵ TAMPOCO manda', async () => {
    const m = await abrir(estadoQueContesta(), 'luz');
    llenarComposer(m, 'x'.repeat(TOPE_CUERPO + 1));

    expect(botonEnviar(m).disabled).toBe(true);
    // El motivo sale de la misma función que apagó el botón, con el número del server.
    expect(m.contenedor.textContent).toContain('sobran 1');

    acordeDeEnviar(m);
    await reposar();
    expect(posts, 'el acorde se salteó el tope que apagó el botón').toHaveLength(0);
  });

  it('con todo en orden, ⌘↵ manda — y por eso el caso de arriba dice algo', async () => {
    const m = await abrir(estadoQueContesta(), 'luz');
    llenarComposer(m);

    expect(botonEnviar(m).disabled).toBe(false);
    acordeDeEnviar(m);
    await reposar();
    expect(posts).toHaveLength(1);
    expect(posts[0].cuerpo.para).toBe('ana@correo.com');
  });

  /**
   * ⚠️ El techo lo aplica el server (el 429 es la garantía), pero cuando ya lo dijo
   * en `/estado` no hay motivo para dejar escribir un correo entero y enterarse al
   * final — y el acorde tiene que respetar lo mismo que el botón.
   */
  it('con el techo de la hora quemado no manda por ninguna de las dos puertas', async () => {
    const m = await abrir(
      estadoQueContesta({ ritmo: { techoHora: 20, techoDia: 60, usadoHora: 20, usadoDia: 41 } }),
      'luz',
    );
    llenarComposer(m);

    expect(botonEnviar(m).disabled).toBe(true);
    expect(m.contenedor.textContent).toContain('techo de esta hora: 20 de 20');

    acordeDeEnviar(m);
    await reposar();
    expect(posts).toHaveLength(0);
  });
});

describe('VistaCorreos — cuando el server dice que no', () => {
  /**
   * 🔴 **UN 429 NO ES UNA FALLA, Y LEÍDO COMO FALLA HACE EXACTAMENTE LO PEOR.** El
   * server se toma el trabajo de decir CUÁL techo y CUÁNTO va usado; aplanado a «no
   * se pudo enviar», lo único que se puede hacer con el aviso es volver a apretar
   * Enviar contra un server que ya decidió que no. Y el que mira concluye que
   * Correos está roto.
   */
  it('el techo se lee con su número y no como una rotura', async () => {
    const m = await abrir(
      estadoQueContesta(),
      'luz',
      rechazo(429, { codigo: 'techo_de_ritmo', motivo: 'techo_hora', techo: 20, usado: 20 }),
    );
    llenarComposer(m);
    tocar(botonEnviar(m));

    const aviso = await esperarAviso(m);
    expect(aviso).toContain('20 de 20');
    expect(aviso).toContain('Se destraba al cambiar la hora');
    expect(aviso).not.toContain('no salió');
  });

  /**
   * 🔴 «Nada masivo» era una frase del pie y nada la garantizaba: nodemailer parte
   * `ana@x.com, beto@y.com` en dos destinatarios sin decir nada. Ahora el server lo
   * rechaza, y el aviso tiene que explicar **el diseño** —un correo va a una
   * persona— y no un error: quien escribió la lista cree que el sistema falló.
   */
  it('las dos direcciones se explican como «va uno por correo», no como una falla', async () => {
    const m = await abrir(estadoQueContesta(), 'luz', rechazo(400, { motivo: 'varios' }));
    llenarComposer(m);
    tocar(botonEnviar(m));

    const aviso = await esperarAviso(m);
    expect(aviso).toContain('Un correo va a una sola persona');
    expect(aviso).toContain('por separado');
  });
});

describe('VistaCorreos — el puente desde la ficha (H6/H7)', () => {
  it('llena el Para y anuncia que queda anotado en la conversación', async () => {
    localStorage.setItem('hermes.token', tokenVivo('luz'));
    vi.stubGlobal('fetch', servidor(estadoQueContesta()));
    montado = montar(
      <VistaCorreos
        correoInicial="ana@correo.com"
        claveInicial="conv:whatsapp:51999:51984429504"
        nombreInicial="Ana"
      />,
    );
    await esperarAlCanal(montado);

    const para = montado.contenedor.querySelector('input[type="email"]') as HTMLInputElement;
    expect(para.value).toBe('ana@correo.com');
    // La clave es lo único que hace que el correo exista para el resto de Hermes.
    expect(montado.contenedor.textContent).toContain('Queda anotado en la conversación de Ana');
  });

  /**
   * 🔴 **LA CLAVE TIENE QUE VIAJAR EN EL POST, y que la pantalla lo anuncie no
   * alcanza.** `correos.clave` es lo único que ata el mail a su conversación: sin
   * ella el correo sale igual —así que no hay error, ni log, ni nada raro que
   * mirar— y después no aparece en ningún timeline, no entra en ninguna medición y
   * no se cruza con la venta. Las tres filas de producción la tienen en `NULL`.
   */
  it('la clave del puente VIAJA con el envío, no sólo en el cartel', async () => {
    localStorage.setItem('hermes.token', tokenVivo('luz'));
    vi.stubGlobal('fetch', servidor(estadoQueContesta()));
    montado = montar(
      <VistaCorreos
        correoInicial="ana@correo.com"
        claveInicial="conv:whatsapp:51999:51984429504"
        nombreInicial="Ana"
      />,
    );
    await esperarAlCanal(montado);
    escribir(montado.contenedor.querySelector('input[aria-label="Asunto"]') as HTMLInputElement, 'El temario');
    escribir(montado.contenedor.querySelector('textarea') as HTMLTextAreaElement, 'Te paso el temario.');

    tocar(botonEnviar(montado));
    await esperarAviso(montado);

    expect(posts).toHaveLength(1);
    expect(posts[0].cuerpo.clave).toBe('conv:whatsapp:51999:51984429504');
  });

  /**
   * 🔴 Cambiar el destinatario a mano SUELTA la conversación. Sin esto, el correo
   * que la vendedora reescribe para otra persona queda colgado del timeline del
   * lead anterior — y ahí no se ve roto: se ve como un correo más.
   */
  it('si se reescribe el «Para», la clave NO se va prendida del correo de otra persona', async () => {
    localStorage.setItem('hermes.token', tokenVivo('luz'));
    vi.stubGlobal('fetch', servidor(estadoQueContesta()));
    montado = montar(
      <VistaCorreos
        correoInicial="ana@correo.com"
        claveInicial="conv:whatsapp:51999:51984429504"
        nombreInicial="Ana"
      />,
    );
    await esperarAlCanal(montado);
    escribir(montado.contenedor.querySelector('input[type="email"]') as HTMLInputElement, 'beto@correo.com');
    escribir(montado.contenedor.querySelector('input[aria-label="Asunto"]') as HTMLInputElement, 'Otra cosa');
    escribir(montado.contenedor.querySelector('textarea') as HTMLTextAreaElement, 'Hola Beto.');

    tocar(botonEnviar(montado));
    await esperarAviso(montado);

    expect(posts).toHaveLength(1);
    expect(posts[0].cuerpo.clave).toBeUndefined();
  });

  it('sin correo NO se queda con la clave colgada esperando un destinatario cualquiera', async () => {
    localStorage.setItem('hermes.token', tokenVivo('luz'));
    vi.stubGlobal('fetch', servidor(estadoQueContesta()));
    montado = montar(<VistaCorreos claveInicial="conv:whatsapp:51999:51984429504" nombreInicial="Ana" />);
    await esperarAlCanal(montado);

    expect(montado.contenedor.textContent).not.toContain('Queda anotado en la conversación');
  });
});
