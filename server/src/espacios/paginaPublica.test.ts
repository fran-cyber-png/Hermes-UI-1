import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { escapar, paginaHtml } from './paginaPublica.js';

/**
 * EL HTML DE LA PÁGINA PÚBLICA (ADR 0047).
 *
 * 🔴 Esto se sirve a **cualquiera con el link, sin credencial**, y el contenido
 * lo escribe una persona en un editor. Es el único lugar de Hermes donde texto
 * de un humano se convierte en HTML para un desconocido: el escape no es
 * higiene, es la diferencia entre una página y un vector.
 */

describe('escapar', () => {
  test('🔴 una nota con <script> NO se ejecuta: se ve como texto', () => {
    const html = paginaHtml('x', '<script>alert(1)</script>');
    assert.ok(!html.includes('<script>alert(1)</script>'), 'no queda el tag vivo');
    assert.ok(html.includes('&lt;script&gt;'), 'se ve escrito, que es lo que la persona quiso');
  });

  test('cierra los atributos y las entidades', () => {
    assert.equal(escapar('a & b'), 'a &amp; b');
    assert.equal(escapar('"x"'), '&quot;x&quot;');
    assert.equal(escapar('<img onerror=1>'), '&lt;img onerror=1&gt;');
  });

  test('el & se escapa PRIMERO — si no, se escaparían dos veces las entidades', () => {
    // Con el orden al revés, `<` → `&lt;` y después el `&` de `&lt;` → `&amp;lt;`,
    // y la página mostraría «&lt;» literal en vez de «<».
    assert.equal(escapar('<'), '&lt;');
  });
});

describe('paginaHtml', () => {
  test('lleva noindex — sin esto el primer link pegado en un chat termina en Google', () => {
    const html = paginaHtml('Precios', 'MXN 4,900');
    assert.ok(html.includes('name="robots"'));
    assert.ok(html.includes('noindex'));
  });

  test('el título va escapado en el <title>', () => {
    assert.ok(paginaHtml('<b>x</b>', 'y').includes('<title>&lt;b&gt;x&lt;/b&gt;</title>'));
  });

  test('conserva los renglones — una página de precios los necesita', () => {
    const html = paginaHtml('t', 'Perú: S/ 1,200\nMéxico: MXN 4,900');
    assert.ok(html.includes('<p>Perú: S/ 1,200</p>'));
    assert.ok(html.includes('<p>México: MXN 4,900</p>'));
  });

  test('🔴 NO lleva JavaScript: es HTML servido a un desconocido', () => {
    assert.ok(!/<script/i.test(paginaHtml('t', 'texto común')));
  });

  test('sin título el <title> cae a «Nota», no queda vacío', () => {
    assert.ok(paginaHtml('', 'algo').includes('<title>Nota</title>'));
  });
});
