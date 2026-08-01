import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TransporteCloudApi } from './transporteCloudApi.js';

/**
 * EL ENVÍO DE MEDIA POR LA CLOUD API — el bloqueador B4.
 *
 * `enviarMedia` lanzaba («este spike solo valida texto»). El costo no se vio
 * hasta que el bot pasó a la línea de Meta: esa línea **no podía mandar el
 * flyer**, y el 42 % de las secuencias que cierran ventas llevan imagen.
 *
 * Lo que estos tests fijan es la FORMA del intercambio con Meta, que es donde
 * está todo el riesgo: son dos requests (subir y mandar) y el segundo depende
 * del id que devuelve el primero. Si alguien "simplifica" a una sola, el
 * mensaje no llega y el error de Meta no dice por qué.
 */

interface Llamada {
  url: string;
  body: unknown;
  esForm: boolean;
}

let llamadas: Llamada[] = [];
let fetchOriginal: typeof globalThis.fetch;
let dir: string;
let archivo: string;

function respuesta(cuerpo: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as Response;
}

function transporteConectado(): TransporteCloudApi {
  const t = new TransporteCloudApi({
    numeroPropio: '51984429504',
    phoneNumberId: 'PNID',
    token: 'tok',
  });
  // `iniciar()` pregunta a Meta por el nombre verificado; con el fake alcanza.
  return t;
}

beforeEach(() => {
  llamadas = [];
  fetchOriginal = globalThis.fetch;
  dir = mkdtempSync(join(tmpdir(), 'hermes-media-'));
  archivo = join(dir, 'flyer.jpeg');
  writeFileSync(archivo, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  rmSync(dir, { recursive: true, force: true });
});

function mockFetch(): void {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const esForm = init?.body instanceof FormData;
    llamadas.push({
      url: u,
      body: esForm ? null : init?.body ? JSON.parse(String(init.body)) : null,
      esForm,
    });
    if (u.includes('?fields=verified_name')) return respuesta({ verified_name: 'Goberna' });
    if (u.endsWith('/media')) return respuesta({ id: 'MEDIA_ID_123' });
    return respuesta({ messages: [{ id: 'wamid.ABC' }] });
  }) as typeof globalThis.fetch;
}

describe('TransporteCloudApi.enviarMedia', () => {
  it('sube el archivo y DESPUÉS manda el id — son dos requests, en ese orden', async () => {
    mockFetch();
    const t = transporteConectado();
    await t.iniciar();

    const r = await t.enviarMedia('51995500419', {
      ruta: archivo,
      clase: 'imagen',
      mime: 'image/jpeg',
      texto: 'El temario del diploma',
    });

    const sinInicio = llamadas.filter((l) => !l.url.includes('verified_name'));
    assert.strictEqual(sinInicio.length, 2, 'una request para subir y una para mandar');
    assert.ok(sinInicio[0]!.url.endsWith('/PNID/media'), 'primero sube');
    assert.ok(sinInicio[0]!.esForm, 'la subida va como multipart, no como JSON');
    assert.ok(sinInicio[1]!.url.endsWith('/PNID/messages'), 'después manda');
    assert.strictEqual(r.idExterno, 'wamid.ABC');
  });

  it('el caption viaja CON la imagen: una imagen con pie es UN mensaje, no dos', async () => {
    mockFetch();
    const t = transporteConectado();
    await t.iniciar();

    await t.enviarMedia('51995500419', {
      ruta: archivo,
      clase: 'imagen',
      mime: 'image/jpeg',
      texto: 'El temario del diploma',
    });

    const envio = llamadas.find((l) => l.url.endsWith('/messages'))!.body as {
      type: string;
      image: { id: string; caption?: string };
    };
    assert.strictEqual(envio.type, 'image');
    assert.strictEqual(envio.image.id, 'MEDIA_ID_123', 'usa el id que devolvió la subida');
    assert.strictEqual(envio.image.caption, 'El temario del diploma');
  });

  it('sin texto no se manda un caption vacío', async () => {
    mockFetch();
    const t = transporteConectado();
    await t.iniciar();

    await t.enviarMedia('51995500419', { ruta: archivo, clase: 'imagen', mime: 'image/jpeg' });

    const envio = llamadas.find((l) => l.url.endsWith('/messages'))!.body as {
      image: Record<string, unknown>;
    };
    assert.ok(!('caption' in envio.image));
  });

  it('un documento lleva filename; el audio NO lleva caption (la Cloud API no lo acepta)', async () => {
    mockFetch();
    const t = transporteConectado();
    await t.iniciar();

    await t.enviarMedia('51995500419', {
      ruta: archivo,
      clase: 'documento',
      mime: 'application/pdf',
      nombre: 'temario.pdf',
      texto: 'acá va',
    });
    const doc = llamadas.find((l) => l.url.endsWith('/messages'))!.body as {
      document: { filename: string; caption?: string };
    };
    assert.strictEqual(doc.document.filename, 'temario.pdf');
    assert.strictEqual(doc.document.caption, 'acá va');

    llamadas = [];
    await t.enviarMedia('51995500419', {
      ruta: archivo,
      clase: 'audio',
      mime: 'audio/ogg',
      texto: 'esto se ignora',
    });
    const audio = llamadas.find((l) => l.url.endsWith('/messages'))!.body as {
      audio: Record<string, unknown>;
    };
    assert.ok(!('caption' in audio.audio), 'el audio no acepta caption');
  });

  it('si la subida falla, NO se manda nada: el error nombra el paso', async () => {
    // Un id inventado sobre una subida fallida produciría un mensaje que Meta
    // rechaza con un error distinto, y el motivo real se perdería.
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes('?fields=verified_name')) return respuesta({ verified_name: 'Goberna' });
      if (u.endsWith('/media')) return respuesta({ error: { message: 'file too big' } }, false, 400);
      llamadas.push({ url: u, body: null, esForm: false });
      return respuesta({ messages: [{ id: 'no-deberia-llegar' }] });
    }) as typeof globalThis.fetch;

    const t = transporteConectado();
    await t.iniciar();

    await assert.rejects(
      () => t.enviarMedia('51995500419', { ruta: archivo, clase: 'imagen', mime: 'image/jpeg' }),
      /subiendo media/,
    );
    assert.strictEqual(llamadas.length, 0, 'no se llamó a /messages');
  });

  it('con la sesión caída no se manda — ni siquiera se sube', async () => {
    mockFetch();
    const t = transporteConectado(); // sin iniciar(): estado "conectando"
    await assert.rejects(
      () => t.enviarMedia('51995500419', { ruta: archivo, clase: 'imagen', mime: 'image/jpeg' }),
      /la sesión está/,
    );
    assert.strictEqual(llamadas.length, 0);
  });

  it('un teléfono inválido se rechaza antes de subir el archivo', async () => {
    mockFetch();
    const t = transporteConectado();
    await t.iniciar();
    llamadas = [];
    await assert.rejects(
      () => t.enviarMedia('abc', { ruta: archivo, clase: 'imagen', mime: 'image/jpeg' }),
      /Tel[eé]fono inv[aá]lido/,
    );
    assert.strictEqual(llamadas.length, 0, 'no se sube un archivo para un número que no existe');
  });
});
