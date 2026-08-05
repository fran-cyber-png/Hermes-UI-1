import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  aE164Peru,
  contarMotivosDeLista,
  leerLista,
  parsearCsv,
  type FilaDeLista,
} from "./lista.js";

const fila = (p: Partial<FilaDeLista> & { linea: number }): FilaDeLista => ({
  telefono: null,
  nombre: null,
  estado: null,
  ...p,
});

// ─── El teléfono: lo único que en frío no se puede adivinar ──────────────────

test("un local peruano de 9 dígitos se completa con el código de país", () => {
  assert.deepEqual(aE164Peru("987654321"), { ok: true, telefono: "51987654321" });
});

test("un E.164 peruano ya completo pasa tal cual, con o sin adornos", () => {
  assert.deepEqual(aE164Peru("51987654321"), { ok: true, telefono: "51987654321" });
  assert.deepEqual(aE164Peru("+51 987 654 321"), { ok: true, telefono: "51987654321" });
  assert.deepEqual(aE164Peru("(+51) 987-654-321"), { ok: true, telefono: "51987654321" });
});

test("un teléfono vacío se distingue de uno ilegible", () => {
  assert.deepEqual(aE164Peru(""), { ok: false, motivo: "sin_telefono" });
  assert.deepEqual(aE164Peru(null), { ok: false, motivo: "sin_telefono" });
  assert.deepEqual(aE164Peru("   "), { ok: false, motivo: "sin_telefono" });
  assert.deepEqual(aE164Peru("511234"), { ok: false, motivo: "telefono_ilegible" });
});

/**
 * Los casos REALES de la base del Foro. No son hipótesis: son los largos que la
 * planilla trae, y cada uno se descarta por un motivo distinto.
 */
test("los teléfonos rotos de la planilla real se descartan, ninguno se adivina", () => {
  // `51` + 10 dígitos: Perú no tiene locales de 10.
  assert.deepEqual(aE164Peru("512221285857"), { ok: false, motivo: "telefono_ilegible" });
  // El código de país pegado dos veces.
  assert.deepEqual(aE164Peru("5151987802049"), { ok: false, motivo: "telefono_ilegible" });
  // Un fijo peruano: 9 dígitos que NO empiezan con 9.
  assert.deepEqual(aE164Peru("512131241"), { ok: false, motivo: "telefono_ilegible" });
  // `51` seguido de algo que no es un móvil.
  assert.deepEqual(aE164Peru("51123123123"), { ok: false, motivo: "telefono_ilegible" });
});

test("los de otro país salen con SU motivo, no como basura", () => {
  assert.deepEqual(aE164Peru("59165375423"), { ok: false, motivo: "otro_pais" }); // Bolivia
  assert.deepEqual(aE164Peru("593983302338"), { ok: false, motivo: "otro_pais" }); // Ecuador
  assert.deepEqual(aE164Peru("529999550849"), { ok: false, motivo: "otro_pais" }); // México
});

// ─── La lista: quién entra, en qué orden y con qué motivo sale ───────────────

test("«Desinteresado» veta el envío, y ése es el motivo que se guarda", () => {
  const { destinatarios, descartadas } = leerLista([
    fila({ linea: 1, telefono: "987654321", estado: "Desinteresado" }),
  ]);
  assert.equal(destinatarios.length, 0);
  assert.deepEqual(descartadas, [{ linea: 1, crudo: "987654321", motivo: "dijo_que_no" }]);
});

test("quien ya está inscrito o reservó no recibe una invitación a comprar", () => {
  const { descartadas } = leerLista([
    fila({ linea: 1, telefono: "987654321", estado: "Inscrito" }),
    fila({ linea: 2, telefono: "987654322", estado: "RESERVADO" }),
  ]);
  assert.deepEqual(
    descartadas.map((d) => d.motivo),
    ["ya_inscrito", "ya_inscrito"],
  );
});

test("el estado se lee sin acentos, en cualquier caja y con espacios de sobra", () => {
  const { descartadas } = leerLista([
    fila({ linea: 1, telefono: "987654321", estado: "  DESINTERESADO " }),
  ]);
  assert.equal(descartadas[0]?.motivo, "dijo_que_no");
});

/**
 * El defecto que este test existe para matar: dos filas del archivo, un solo
 * humano, dos mensajes. Es la forma más visible de que hay una máquina detrás.
 */
test("el duplicado se mide sobre el número normalizado, no sobre el texto", () => {
  const { destinatarios, descartadas } = leerLista([
    fila({ linea: 1, telefono: "987654321" }),
    fila({ linea: 2, telefono: "+51 987 654 321" }),
  ]);
  assert.equal(destinatarios.length, 1);
  assert.equal(destinatarios[0]?.telefono, "51987654321");
  assert.deepEqual(descartadas, [{ linea: 2, crudo: "+51 987 654 321", motivo: "duplicado" }]);
});

test("el que dijo que no gana sobre el teléfono roto: el motivo grave manda", () => {
  const { descartadas } = leerLista([
    fila({ linea: 1, telefono: "511234", estado: "Desinteresado" }),
  ]);
  assert.equal(descartadas[0]?.motivo, "dijo_que_no");
});

test("se respeta el orden del archivo — «los primeros» tiene que ser los primeros", () => {
  const { destinatarios } = leerLista([
    fila({ linea: 1, telefono: "987000001" }),
    fila({ linea: 2, telefono: "no es un teléfono" }),
    fila({ linea: 3, telefono: "987000003" }),
    fila({ linea: 4, telefono: "987000004" }),
  ]);
  assert.deepEqual(
    destinatarios.map((d) => d.telefono),
    ["51987000001", "51987000003", "51987000004"],
  );
  assert.deepEqual(
    destinatarios.map((d) => d.linea),
    [1, 3, 4],
  );
});

test("un nombre en blanco queda en null, no en cadena vacía", () => {
  const { destinatarios } = leerLista([
    fila({ linea: 1, telefono: "987654321", nombre: "   " }),
    fila({ linea: 2, telefono: "987654322", nombre: " Julio Gamboa " }),
  ]);
  assert.equal(destinatarios[0]?.nombre, null);
  assert.equal(destinatarios[1]?.nombre, "Julio Gamboa");
});

test("todos los motivos se cuentan, incluso los que dieron cero", () => {
  const cuenta = contarMotivosDeLista([{ linea: 1, crudo: "x", motivo: "duplicado" }]);
  assert.equal(cuenta.duplicado, 1);
  assert.equal(cuenta.dijo_que_no, 0);
  assert.equal(cuenta.otro_pais, 0);
  assert.equal(cuenta.ya_inscrito, 0);
  assert.equal(cuenta.sin_telefono, 0);
  assert.equal(cuenta.telefono_ilegible, 0);
});

// ─── El CSV ─────────────────────────────────────────────────────────────────

test("la cabecera se reconoce con acentos y en cualquier orden", () => {
  const filas = parsearCsv("Nombre,Teléfono,Estado\nJulio,987654321,Contactado\n");
  assert.deepEqual(filas, [
    { linea: 1, telefono: "987654321", nombre: "Julio", estado: "Contactado" },
  ]);
});

test("un CSV sin columna de teléfono TIRA, no lee la primera persona como cabecera", () => {
  assert.throws(() => parsearCsv("nombre,correo\nJulio,j@x.com\n"), /telefono/);
});

test("las comas y las comillas adentro de un campo no parten la fila", () => {
  const filas = parsearCsv('telefono,nombre\n987654321,"Gamboa, Julio ""el flaco"""\n');
  assert.equal(filas[0]?.nombre, 'Gamboa, Julio "el flaco"');
});

test("CRLF cuenta como un solo corte y la línea final vacía no es una fila", () => {
  const filas = parsearCsv("telefono,nombre\r\n987654321,Julio\r\n987654322,Ana\r\n\r\n");
  assert.equal(filas.length, 2);
  assert.equal(filas[1]?.nombre, "Ana");
});
