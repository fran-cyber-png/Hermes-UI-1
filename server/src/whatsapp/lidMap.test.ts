import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MapaLids } from './lidMap.js';

/**
 * WhatsApp moderno identifica a algunos remitentes con `@lid` (un id anónimo)
 * en vez del teléfono. whatsmeow YA sincroniza el mapa lid→teléfono en su
 * propio store (tabla `whatsmeow_lid_map`, formato usuario pelado: `1067…|519…`).
 * `MapaLids` lo lee — solo lectura — para que esos mensajes dejen de descartarse.
 */

const dir = mkdtempSync(join(tmpdir(), 'lidmap-'));
const rutaStore = join(dir, '51986394450.db');

function crearStoreConMapa(): void {
  const db = new DatabaseSync(rutaStore);
  db.exec('CREATE TABLE whatsmeow_lid_map (lid TEXT PRIMARY KEY, pn TEXT UNIQUE NOT NULL)');
  db.prepare('INSERT INTO whatsmeow_lid_map (lid, pn) VALUES (?, ?)').run(
    '106743493296209',
    '51986394450',
  );
  db.close();
}

describe('MapaLids — el @lid baja a teléfono con el mapa que whatsmeow ya sincroniza', () => {
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('un @lid conocido resuelve al teléfono normalizado', () => {
    crearStoreConMapa();
    const mapa = new MapaLids(rutaStore);
    assert.equal(mapa.telefonoDeLid('106743493296209@lid'), '51986394450');
    mapa.cerrar();
  });

  test('un @lid con sufijo de dispositivo también resuelve', () => {
    const mapa = new MapaLids(rutaStore);
    assert.equal(mapa.telefonoDeLid('106743493296209:12@lid'), '51986394450');
    mapa.cerrar();
  });

  test('un @lid que no está en el mapa → null (se descarta, no se inventa)', () => {
    const mapa = new MapaLids(rutaStore);
    assert.equal(mapa.telefonoDeLid('999999999999999@lid'), null);
    mapa.cerrar();
  });

  test('un JID que no es @lid no es asunto de este mapa → null', () => {
    const mapa = new MapaLids(rutaStore);
    assert.equal(mapa.telefonoDeLid('51987654321@s.whatsapp.net'), null);
    assert.equal(mapa.telefonoDeLid('grupo@g.us'), null);
    assert.equal(mapa.telefonoDeLid(''), null);
    mapa.cerrar();
  });

  test('sin store todavía (número no vinculado) → null, sin reventar', () => {
    const mapa = new MapaLids(join(dir, 'no-existe.db'));
    assert.equal(mapa.telefonoDeLid('106743493296209@lid'), null);
    mapa.cerrar();
  });
});
