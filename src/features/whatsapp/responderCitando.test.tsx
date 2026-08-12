// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { escribir, montar, pegar, reposar, teclear, tocar, type Montado } from '../../pruebas/dom';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../canales/conversaciones';

/**
 * RESPONDER CITANDO — el CABLEADO, que es lo que ningún test puro ve.
 *
 * `cita.ts` está testeado hasta el hueso y no puede ver nada de esto: que el
 * botón esté en la burbuja antes de cualquier hover, que la tirita aparezca en la
 * caja, que **el `citaDe` salga en el body del POST**, que Escape la suelte y que
 * se limpie después de mandar. Es la lección de ADR 0024: el defecto vive en el
 * cableado, no en la decisión.
 *
 * El que más importa es el `citaDe`: si se pierde entre la caja y el `fetch`, el
 * mensaje sale igual —sin la tirita— y en Hermes se ve exactamente como si
 * hubiera salido bien. El síntoma lo tiene el lead, no la vendedora.
 */

const TELEFONO = '51987654321';
const NUMERO_PROPIO = '51984429504';
const AHORA = new Date().toISOString();

const CONVERSACION = {
  clave: `conv:whatsapp:${TELEFONO}:${NUMERO_PROPIO}`,
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: TELEFONO,
  persona_nombre: 'Javier',
  numero_propio: NUMERO_PROPIO,
  texto: 'hola',
  contexto_texto: null,
  respondida: false,
  ventana_abierta: true,
  pregunto: false,
  n: 1,
  referencia: 'r1',
  ultimo_at: AHORA,
  dias: 0,
  nivel: 0,
} as Conversacion;

const EL_PRECIO = {
  id: 1,
  direccion: 'saliente',
  autor: 'luz',
  texto: 'El diploma sale S/ 450 y se puede pagar en dos cuotas.',
  occurred_at: AHORA,
  external_id: 'wa:EL_PRECIO',
};
const LA_PREGUNTA = {
  id: 2,
  direccion: 'entrante',
  autor: TELEFONO,
  texto: '¿Y con tarjeta?',
  occurred_at: AHORA,
  external_id: 'wa:LA_PREGUNTA',
};

let montado: Montado | null = null;
/** Todo lo que la app POSTeó a `/enviar`, ya parseado. */
let enviados: Record<string, unknown>[] = [];

function conMensajes(mensajes: unknown[], estadoSesion = 'conectado') {
  enviados = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      const json = (c: unknown) =>
        new Response(JSON.stringify(c), { headers: { 'content-type': 'application/json' } });
      if (url.includes('/api/whatsapp/sesion')) return json({ estado: estadoSesion, telefono: NUMERO_PROPIO });
      if (url.includes('/api/whatsapp/conversacion/')) return json({ telefono: TELEFONO, mensajes, origen: null });
      if (url.includes('/api/whatsapp/enviar')) {
        enviados.push(JSON.parse(String(init?.body ?? '{}')));
        return json({ ok: true, idExterno: 'wa:nuevo' });
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

async function abrir(sugerencia?: Parameters<typeof HiloWhatsapp>[0]['sugerencia']): Promise<Montado> {
  const m = montar(<HiloWhatsapp conversacion={CONVERSACION} sugerencia={sugerencia} />);
  await reposar();
  montado = m;
  return m;
}

const botonesResponder = (m: Montado) =>
  [...m.contenedor.querySelectorAll<HTMLButtonElement>('button')].filter(
    (b) => b.getAttribute('aria-label') === 'Responder citando este mensaje',
  );

const caja = (m: Montado) => m.contenedor.querySelector('textarea')!;

describe('elegir a quién responder', () => {
  test('🔴 el botón está en los DOS sentidos y en el DOM antes de cualquier hover', async () => {
    // Citar lo PROPIO es el caso de retomar un precio que ya se pasó, así que el
    // botón no puede ser solo de los entrantes (al revés que reaccionar).
    conMensajes([EL_PRECIO, LA_PREGUNTA]);
    const botones = botonesResponder(await abrir());

    expect(botones).toHaveLength(2);
    // Montarlo recién al pasar el mouse haría que el primer clic caiga en la nada.
    expect(botones[0].className).toContain('opacity-0');
    expect(botones[0].className).toContain('group-hover/burbuja:opacity-100');
    // Y alcanzable por teclado, no solo con el mouse.
    expect(botones[0].className).toContain('focus-visible:opacity-100');
  });

  test('🔴 con la sesión caída se puede citar igual: esto no manda nada', async () => {
    // El freno de «no se puede enviar» vive en el botón de mandar. Atar también
    // esto a la sesión dejaría a la vendedora sin poder ni preparar la respuesta
    // mientras la línea reconecta.
    conMensajes([EL_PRECIO, LA_PREGUNTA], 'desconectado');
    expect(botonesResponder(await abrir())).toHaveLength(2);
  });

  test('tocar «Responder» pone la tirita arriba de la caja, con autor y extracto', async () => {
    conMensajes([EL_PRECIO, LA_PREGUNTA]);
    const m = await abrir();

    tocar(botonesResponder(m)[0]);
    await reposar();

    expect(m.contenedor.textContent).toContain('Respondiendo a Vos');
    expect(m.contenedor.textContent).toContain('El diploma sale S/ 450');
  });

  test('citando al lead, la tirita lo nombra a él', async () => {
    conMensajes([EL_PRECIO, LA_PREGUNTA]);
    const m = await abrir();

    tocar(botonesResponder(m)[1]);
    await reposar();

    expect(m.contenedor.textContent).toContain('Respondiendo a Javier');
    expect(m.contenedor.textContent).toContain('¿Y con tarjeta?');
  });

  test('un mensaje sin texto ni adjunto (la marca «Vino del anuncio») no se puede citar', async () => {
    conMensajes([
      { id: 3, direccion: 'entrante', autor: TELEFONO, texto: null, occurred_at: AHORA, external_id: 'wa:3',
        origen: { fuente: 'anuncio', titulo: 'Diploma OSINT' } },
    ]);
    expect(botonesResponder(await abrir())).toHaveLength(0);
  });

  test('en modo revisión NO se ofrece: ahí se aprueba un texto preparado', async () => {
    conMensajes([EL_PRECIO, LA_PREGUNTA]);
    const m = await abrir({
      id: 7,
      texto: 'Hola Javier, te comparto el temario.',
      campana: null,
      paso: { actual: 1, total: 3 },
      trabajando: false,
      onAprobar: () => {},
      onDescartar: () => {},
    });

    expect(botonesResponder(m)).toHaveLength(0);
  });
});

describe('mandar la respuesta', () => {
  test('🔴 el POST lleva `citaDe` con el external_id del citado', async () => {
    conMensajes([EL_PRECIO, LA_PREGUNTA]);
    const m = await abrir();

    tocar(botonesResponder(m)[0]);
    await reposar();
    escribir(caja(m), 'sí, con tarjeta también');
    teclear('Enter', { target: caja(m) });
    await reposar();

    expect(enviados).toHaveLength(1);
    expect(enviados[0].citaDe).toBe('wa:EL_PRECIO');
    expect(enviados[0].texto).toBe('sí, con tarjeta también');
  });

  test('sin cita el body NO lleva el campo: un envío normal no cambia de forma', async () => {
    conMensajes([EL_PRECIO]);
    const m = await abrir();

    escribir(caja(m), 'hola');
    teclear('Enter', { target: caja(m) });
    await reposar();

    expect(enviados).toHaveLength(1);
    expect('citaDe' in enviados[0]).toBe(false);
  });

  test('🔴 después de mandar, la tirita se va — o el siguiente saldría citando lo mismo', async () => {
    conMensajes([EL_PRECIO, LA_PREGUNTA]);
    const m = await abrir();

    tocar(botonesResponder(m)[0]);
    await reposar();
    escribir(caja(m), 'listo');
    teclear('Enter', { target: caja(m) });
    await reposar();

    expect(m.contenedor.textContent).not.toContain('Respondiendo a');
  });
});

describe('la cita y un adjunto no se llevan bien, y se dice ANTES', () => {
  test('🔴 con adjunto elegido, la tirita avisa que la cita no viaja', async () => {
    // Citar al mandar un adjunto no está implementado (queda como pendiente del
    // frente). Lo que NO se puede hacer es dejarla puesta en silencio: la
    // vendedora se enteraría cuando ya lo vio el lead.
    conMensajes([EL_PRECIO, LA_PREGUNTA]);
    const m = await abrir();

    tocar(botonesResponder(m)[0]);
    await reposar();
    pegar(caja(m), [new File([new Uint8Array([1, 2, 3])], 'flyer.png', { type: 'image/png' })]);
    await reposar();

    expect(m.contenedor.textContent).toContain('Con un adjunto la cita no viaja');
  });

  test('sin adjunto no aparece el aviso', async () => {
    conMensajes([EL_PRECIO, LA_PREGUNTA]);
    const m = await abrir();

    tocar(botonesResponder(m)[0]);
    await reposar();

    expect(m.contenedor.textContent).not.toContain('Con un adjunto la cita no viaja');
  });
});

describe('soltar la cita', () => {
  test('🔴 Escape con el foco en la caja la suelta', async () => {
    conMensajes([EL_PRECIO, LA_PREGUNTA]);
    const m = await abrir();

    tocar(botonesResponder(m)[0]);
    await reposar();
    expect(m.contenedor.textContent).toContain('Respondiendo a');

    const evento = teclear('Escape', { target: caja(m) });
    await reposar();

    expect(m.contenedor.textContent).not.toContain('Respondiendo a');
    expect(evento.defaultPrevented).toBe(true);
  });

  test('SIN cita, Escape en la caja no se toca: la tecla queda libre para el resto', async () => {
    // El Escape global (cerrar la conversación) hoy no llega acá porque `App.tsx`
    // lo filtra con `tecleandoEn`. Que este handler no lo cancele igual es lo que
    // deja la puerta abierta a que mañana sí llegue.
    conMensajes([EL_PRECIO]);
    const m = await abrir();

    const evento = teclear('Escape', { target: caja(m) });
    await reposar();

    expect(evento.defaultPrevented).toBe(false);
  });

  test('la X también la suelta', async () => {
    conMensajes([EL_PRECIO, LA_PREGUNTA]);
    const m = await abrir();

    tocar(botonesResponder(m)[0]);
    await reposar();

    const x = [...m.contenedor.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === 'Quitar la cita',
    );
    expect(x).toBeTruthy();
    tocar(x!);
    await reposar();

    expect(m.contenedor.textContent).not.toContain('Respondiendo a');
  });
});

describe('la cita recibida, dentro de la burbuja', () => {
  test('se dibuja con el autor y el extracto del citado', async () => {
    conMensajes([
      EL_PRECIO,
      {
        ...LA_PREGUNTA,
        cita: { mensajeExternalId: 'wa:EL_PRECIO', texto: 'El diploma sale S/ 450', direccion: 'saliente', mediaClase: null },
      },
    ]);
    const m = await abrir();

    expect(m.contenedor.textContent).toContain('Vos');
    expect(m.contenedor.textContent).toContain('El diploma sale S/ 450');
  });

  test('🔴 el citado que Hermes no tiene dibuja el HUECO, y el mensaje sigue estando', async () => {
    // Es lo NORMAL las primeras semanas: la cita apunta a algo anterior a la
    // captura. Esconderla dejaría una respuesta suelta que no contesta nada.
    conMensajes([
      {
        ...LA_PREGUNTA,
        cita: { mensajeExternalId: 'wa:VIEJISIMO', texto: null, direccion: null, mediaClase: null },
      },
    ]);
    const m = await abrir();

    expect(m.contenedor.textContent).toContain('Un mensaje anterior');
    expect(m.contenedor.textContent).toContain('¿Y con tarjeta?');
  });

  test('una cita a un adjunto sin texto dice qué era', async () => {
    conMensajes([
      {
        ...LA_PREGUNTA,
        cita: { mensajeExternalId: 'wa:FLYER', texto: null, direccion: 'saliente', mediaClase: 'imagen' },
      },
    ]);
    const m = await abrir();

    expect(m.contenedor.textContent).toContain('Foto');
  });

  test('un server viejo no la manda y no pasa nada', async () => {
    // El front sale por N4 y el server por N5: esta ventana existe en cada deploy.
    conMensajes([EL_PRECIO, LA_PREGUNTA]);
    const m = await abrir();

    expect(m.contenedor.textContent).toContain('El diploma sale S/ 450');
    expect(m.contenedor.textContent).not.toContain('Un mensaje anterior');
  });
});

/** Un mensaje del hilo, con cita opcional. */
const conCita = (id: number, externalId: string, cita?: Record<string, unknown>) => ({
  id,
  direccion: 'entrante',
  autor: TELEFONO,
  texto: `mensaje ${id}`,
  occurred_at: AHORA,
  external_id: externalId,
  ...(cita ? { cita } : {}),
});

const tirita = (m: Montado) =>
  [...m.contenedor.querySelectorAll<HTMLElement>('[aria-label^="Ir al mensaje citado"]')];

describe('saltar al mensaje citado', () => {
  test('🔴 la cita es BOTÓN cuando el citado está dibujado', async () => {
    conMensajes([
      EL_PRECIO,
      conCita(9, 'wa:RESPUESTA', {
        mensajeExternalId: 'wa:EL_PRECIO',
        texto: 'El diploma sale S/ 450',
        direccion: 'saliente',
        mediaClase: null,
      }),
    ]);
    const m = await abrir();
    expect(tirita(m)).toHaveLength(1);
    expect(tirita(m)[0].tagName).toBe('BUTTON');
  });

  test('🔴 y NO lo es cuando el server la resolvió pero el mensaje no está en pantalla', async () => {
    // Éste es el test que mata la objeción del ADR 0054. La cita viene COMPLETA
    // —con autor y con texto—, o sea que `direccion !== null`; lo que no hay es a
    // dónde saltar, porque el citado es más viejo que los 200 servidos. Si la
    // presencia se dedujera de `direccion`, acá habría un botón que no hace nada.
    conMensajes([
      conCita(9, 'wa:RESPUESTA', {
        mensajeExternalId: 'wa:MAS_VIEJO_QUE_200',
        texto: 'algo que dijimos hace un mes',
        direccion: 'saliente',
        mediaClase: null,
      }),
    ]);
    const m = await abrir();
    expect(tirita(m)).toHaveLength(0);
    // La cita se sigue DIBUJANDO: lo que no está es el botón.
    expect(m.contenedor.textContent).toContain('algo que dijimos hace un mes');
  });

  test('el hueco honesto tampoco es botón, y dice qué es', async () => {
    conMensajes([
      conCita(9, 'wa:RESPUESTA', {
        mensajeExternalId: 'wa:DE_ANTES',
        texto: null,
        direccion: null,
        mediaClase: null,
      }),
    ]);
    const m = await abrir();
    expect(tirita(m)).toHaveLength(0);
    expect(m.contenedor.textContent).toContain('Un mensaje anterior');
  });

  test('tocarla marca el destino, y solo el destino', async () => {
    conMensajes([
      EL_PRECIO,
      LA_PREGUNTA,
      conCita(9, 'wa:RESPUESTA', {
        mensajeExternalId: 'wa:EL_PRECIO',
        texto: 'El diploma sale S/ 450',
        direccion: 'saliente',
        mediaClase: null,
      }),
    ]);
    const m = await abrir();
    tocar(tirita(m)[0]);
    await reposar();

    const destino = m.contenedor.querySelector('[data-mensaje="wa:EL_PRECIO"]')!;
    const otro = m.contenedor.querySelector('[data-mensaje="wa:LA_PREGUNTA"]')!;
    expect(destino.className).toContain('ring-primary');
    expect(otro.className).not.toContain('ring-primary');
  });
});

describe('a quién le respondieron', () => {
  test('el mensaje citado lleva la marca; el que cita, no', async () => {
    conMensajes([
      EL_PRECIO,
      conCita(9, 'wa:RESPUESTA', {
        mensajeExternalId: 'wa:EL_PRECIO',
        texto: 'El diploma sale S/ 450',
        direccion: 'saliente',
        mediaClase: null,
      }),
    ]);
    const m = await abrir();
    const marcas = [...m.contenedor.querySelectorAll('[aria-label="Respondieron a este mensaje"]')];
    expect(marcas).toHaveLength(1);
    expect(m.contenedor.querySelector('[data-mensaje="wa:EL_PRECIO"]')!.contains(marcas[0])).toBe(true);
  });

  test('🔴 no existe la marca de «nadie respondió»: la ausencia no dice nada', async () => {
    // La derivación solo ve las respuestas que están entre los 200 servidos, así
    // que puede faltar. Por eso la marca solo afirma — y por eso el hilo no puede
    // tener en ninguna parte una leyenda negativa.
    conMensajes([EL_PRECIO, LA_PREGUNTA]);
    const m = await abrir();
    expect(m.contenedor.querySelectorAll('[aria-label="Respondieron a este mensaje"]')).toHaveLength(0);
    expect(m.contenedor.textContent).not.toContain('Sin respuesta');
    expect(m.contenedor.textContent).not.toContain('sin responder');
  });
});

describe('doble clic para responder', () => {
  const dobleClic = (el: Element) =>
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

  test('pone la cita, igual que el botón', async () => {
    conMensajes([EL_PRECIO]);
    const m = await abrir();
    dobleClic(m.contenedor.querySelector('[data-mensaje="wa:EL_PRECIO"]')!);
    await reposar();
    expect(m.contenedor.textContent).toContain('Respondiendo a Vos');
  });

  test('🔴 el `citaDe` que sale por el doble clic es el MISMO que sale por el botón', async () => {
    // Las dos puertas comparten `citaDeMensaje`. Si una lo armara distinto, el
    // síntoma lo tiene el LEAD —la tirita le llega mal— y acá no se ve nada.
    conMensajes([EL_PRECIO]);
    const m1 = await abrir();
    dobleClic(m1.contenedor.querySelector('[data-mensaje="wa:EL_PRECIO"]')!);
    await reposar();
    escribir(caja(m1), 'por doble clic');
    teclear('Enter', { target: caja(m1) });
    await reposar();
    const porDobleClic = enviados[0]?.citaDe;

    m1.desmontar();
    conMensajes([EL_PRECIO]);
    const m2 = await abrir();
    tocar(botonesResponder(m2)[0]);
    await reposar();
    escribir(caja(m2), 'por el botón');
    teclear('Enter', { target: caja(m2) });
    await reposar();

    expect(porDobleClic).toBe('wa:EL_PRECIO');
    expect(enviados[0]?.citaDe).toBe(porDobleClic);
  });

  test('🔴 limpia la selección: nada de resalte fantasma', async () => {
    // Responder mueve el foco al composer y eso colapsa la selección igual. Si no
    // la limpiáramos nosotros, podría quedar texto pintado como seleccionado que
    // ya no lo está — y ahí ⌘C copia otra cosa. Es el costo dicho del gesto:
    // adentro de la burbuja, el doble clic deja de seleccionar la palabra.
    conMensajes([EL_PRECIO]);
    const m = await abrir();
    const burbuja = m.contenedor.querySelector('[data-mensaje="wa:EL_PRECIO"]')!;
    const rango = document.createRange();
    rango.selectNodeContents(burbuja);
    window.getSelection()!.addRange(rango);
    expect(window.getSelection()!.rangeCount).toBe(1);

    dobleClic(burbuja);
    await reposar();
    expect(window.getSelection()!.rangeCount).toBe(0);
  });

  test('no responde si nace en un control: la imagen abre su visor, el enlace su navegador', async () => {
    conMensajes([EL_PRECIO]);
    const m = await abrir();
    const burbuja = m.contenedor.querySelector('[data-mensaje="wa:EL_PRECIO"]')!;
    const boton = burbuja.querySelector('button') ?? document.createElement('button');
    burbuja.appendChild(boton);
    dobleClic(boton);
    await reposar();
    expect(m.contenedor.textContent).not.toContain('Respondiendo a');
  });

  test('en modo revisión no pone cita: ahí se aprueba un texto', async () => {
    conMensajes([EL_PRECIO]);
    const m = await abrir({
      id: 7,
      texto: 'Hola, gracias por escribirnos.',
      campana: null,
      paso: { actual: 1, total: 3 },
      trabajando: false,
      onAprobar: () => {},
      onDescartar: () => {},
    });
    dobleClic(m.contenedor.querySelector('[data-mensaje="wa:EL_PRECIO"]')!);
    await reposar();
    expect(m.contenedor.textContent).not.toContain('Respondiendo a');
  });
});
