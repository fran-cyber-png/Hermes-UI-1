import { test } from "node:test";
import assert from "node:assert/strict";
import { veredictoDelPreflight, type FilaPreflight } from "./preflightFrontera.js";

/**
 * EL VEREDICTO DEL PREFLIGHT, INTERROGADO SIN BASE.
 *
 * La regla que decide «se despliega o no» tiene que poder probarse sin montar
 * nada: los escenarios que importan —alguien en cero, alguien arrastrando el
 * archivo entero, todas viendo lo mismo— son combinaciones de números, y armar
 * cada uno con siembra costaría tres tests con base para verificar una tabla de
 * verdad.
 */

const sana = (over: Partial<FilaPreflight> = {}): FilaPreflight => ({
  vendedoraId: "sindy",
  veTodo: false,
  total: 40,
  propias: 38,
  huerfanas: 2,
  // El caso base es el de casi todo el equipo: NO trajo su propia línea. Por eso
  // `ajenas` va en `null` —«no se midió»— y no en 0: en estas filas la tercera
  // consulta no se paga, y un 0 acá afirmaría que se midió y dio cero.
  lineaPropia: false,
  lineasPropias: [],
  servidorDice: undefined,
  ajenas: null,
  ...over,
});

/** Quien SÍ trajo su línea por QR, y todo salió bien: el server la aplicó y de
 *  afuera de sus líneas sólo le quedan los formularios de la ventana. */
const conLineaPropia = (over: Partial<FilaPreflight> = {}): FilaPreflight =>
  sana({
    vendedoraId: "walter",
    total: 205,
    propias: 51,
    huerfanas: 154,
    lineaPropia: true,
    lineasPropias: ["51941654039"],
    servidorDice: true,
    ajenas: 154,
    ...over,
  });

const UMBRALES = { maxHuerfanas: 500, maxAjenas: 500 };

test("una mesa sana pasa", () => {
  const v = veredictoDelPreflight(
    [sana(), sana({ vendedoraId: "luz", total: 60, propias: 58, huerfanas: 2 })],
    UMBRALES,
  );
  assert.equal(v.ok, true, v.problemas.join(" · "));
});

test("🔴 alguien en CERO frena el deploy", () => {
  const v = veredictoDelPreflight(
    [sana(), sana({ vendedoraId: "tracy", total: 0, propias: 0, huerfanas: 0 })],
    UMBRALES,
  );
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /tracy/);
  assert.match(v.problemas.join(" "), /VACÍA/);
});

/**
 * ⚠️ Una supervisora en cero es un problema distinto y por eso también frena:
 * ve todo por definición, así que cero significa que la cola entera está vacía y
 * la medición de todas las demás no vale nada.
 */
test("una SUPERVISORA en cero también frena: la medición entera queda invalidada", () => {
  const v = veredictoDelPreflight(
    [sana({ vendedoraId: "jefa", veTodo: true, total: 0, propias: 0, huerfanas: 0 })],
    UMBRALES,
  );
  assert.equal(v.ok, false);
});

test("🔴 arrastrar el archivo de las líneas muertas frena el deploy por el OTRO lado", () => {
  const v = veredictoDelPreflight(
    [sana({ total: 2900, propias: 25, huerfanas: 2875 }), sana({ vendedoraId: "luz", total: 60 })],
    UMBRALES,
  );
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /2875 huérfanas/);
});

/**
 * 🔴 EL DETECTOR DE «FRONTERA APAGADA», y es el que un preflight ingenuo no
 * tiene: cada fila por separado se ve perfectamente razonable.
 */
test("si TODAS las vendedoras ven exactamente lo mismo, la frontera no se está aplicando", () => {
  const v = veredictoDelPreflight(
    [
      sana({ vendedoraId: "sindy", total: 300, propias: 20, huerfanas: 280 }),
      sana({ vendedoraId: "luz", total: 300, propias: 250, huerfanas: 50 }),
    ],
    UMBRALES,
  );
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /ven EXACTAMENTE lo mismo/);
});

/**
 * ⚠️ El control del test de arriba: con UNA sola vendedora la coincidencia no
 * significa nada, y disparar ahí volvería el preflight inservible justo en la
 * situación más común (una persona de guardia).
 */
test("con una sola vendedora, «todas ven lo mismo» no dispara", () => {
  const v = veredictoDelPreflight([sana(), sana({ vendedoraId: "jefa", veTodo: true, total: 40 })], UMBRALES);
  assert.equal(v.ok, true, v.problemas.join(" · "));
});

/**
 * 🔴 EL FALSO POSITIVO QUE ENCONTRÓ CORRER EL SCRIPT, NO UN TEST.
 *
 * Dos personas con una conversación propia cada una ven «1» las dos, y no hay
 * absolutamente nada mal: nadie está viendo trabajo ajeno. La primera versión de
 * la regla frenaba el deploy ahí. Por eso además de la coincidencia se pide que
 * ALGUIEN vea algo que no es suyo — con la frontera apagada eso se cumple solo,
 * porque lo ajeno que se cuela cuenta como «huérfanas».
 */
test("si todas ven lo mismo pero NADIE ve nada ajeno, no dispara", () => {
  const v = veredictoDelPreflight(
    [
      sana({ vendedoraId: "luz", total: 1, propias: 1, huerfanas: 0 }),
      sana({ vendedoraId: "sindy", total: 1, propias: 1, huerfanas: 0 }),
    ],
    UMBRALES,
  );
  assert.equal(v.ok, true, v.problemas.join(" · "));
});

test("sin filas el preflight FALLA: no verificó nada", () => {
  const v = veredictoDelPreflight([], UMBRALES);
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /no se midió a NADIE/);
});

test("el techo de huérfanas se puede bajar, y entonces sí dispara", () => {
  const filas = [sana({ huerfanas: 40, total: 78 }), sana({ vendedoraId: "luz", total: 60 })];
  assert.equal(veredictoDelPreflight(filas, { maxHuerfanas: 500, maxAjenas: 500 }).ok, true);
  assert.equal(veredictoDelPreflight(filas, { maxHuerfanas: 10, maxAjenas: 500 }).ok, false);
});

/**
 * 🔴 EL CASO QUE HABRÍA ROJO AL PREFLIGHT CONTRA PRODUCCIÓN, POR UN MOTIVO FALSO.
 *
 * Para una supervisora `huerfanas = total - propias` es la mesa entera POR
 * DEFINICIÓN —ve todo, que es lo que la frontera le concede—, así que con la
 * mesa real (~5.492 en la ventana de 30 días) rompe sola cualquier techo. Sin la
 * guarda, el script salía en 1 diciendo «la cláusula de línea no está acotando —
 * revisá `numero_vendedora`»: un diagnóstico falso que manda a mirar la tabla
 * equivocada justo antes de un N5.
 *
 * ⚠️ Y el techo tiene que seguir disparando para una VENDEDORA en la misma
 * corrida, o la guarda estaría apagando el chequeo en vez de acotarlo.
 */
test("una supervisora no rompe el techo de huérfanas — ve todo por definición", () => {
  const jefa = sana({
    vendedoraId: "jefa",
    veTodo: true,
    total: 5492,
    propias: 12,
    huerfanas: 5480,
  });
  assert.equal(veredictoDelPreflight([jefa, sana()], UMBRALES).ok, true);

  // La misma corrida, con una VENDEDORA arrastrando lo mismo: eso sí es el bug
  // que el chequeo existe para ver.
  const v = veredictoDelPreflight(
    [jefa, sana({ vendedoraId: "sindy", total: 5492, propias: 12, huerfanas: 5480 })],
    UMBRALES,
  );
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /sindy arrastra 5480 huérfanas/);
  assert.doesNotMatch(v.problemas.join(" "), /jefa arrastra/);
});

/**
 * 🔴 EL DEPLOY QUE NO HIZO NADA — el tercer lado por el que este script falla.
 *
 * El mapa dice que Walter trajo su línea por QR y la respuesta de la cola no
 * dice que la regla se haya aplicado. Ninguna fila queda en cero y ningún techo
 * salta: sin este chequeo el preflight sale en VERDE sobre una cola que no
 * cambió una sola fila, y lo que se despliega es la regla escrita, no la
 * cableada.
 */
test("🔴 con línea propia y el server callado, el preflight FRENA", () => {
  const v = veredictoDelPreflight([conLineaPropia({ servidorDice: undefined }), sana()], UMBRALES);
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /walter/);
  assert.match(v.problemas.join(" "), /NO publica esa bandera/);
});

/**
 * ⚠️ Y `false` explícito NO se confunde con ausente: son dos causas distintas
 * —la mitad sin cablear vs. el server diciendo que a esta persona no le toca— y
 * el renglón tiene que mandar a mirar lugares distintos.
 */
test("el server que dice `false` sobre alguien con línea propia también frena, con otra redacción", () => {
  const v = veredictoDelPreflight([conLineaPropia({ servidorDice: false })], UMBRALES);
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /dice que NO la aplicó/);
});

/**
 * 🔴 LA RAMA CABLEADA Y MAL ESCRITA: el server dice que sí y no se nota.
 *
 * Los números son los medidos el 18-ago-2026: con la rama viva, a Walter le
 * entran 2.879 conversaciones del archivo de las líneas apagadas que no son
 * suyas. Con la regla puesta ahí sólo puede quedar lo asignado (hoy 0) y los
 * formularios de la ventana (~154).
 */
test("🔴 con línea propia aplicada, seguir viendo miles de afuera de sus líneas frena", () => {
  const v = veredictoDelPreflight([conLineaPropia({ total: 2930, ajenas: 2879 })], UMBRALES);
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /2879 conversaciones de afuera/);
  assert.match(v.problemas.join(" "), /la rama NO se está cayendo/);
});

/**
 * 🔴 EL TECHO DE HUÉRFANAS NO SE LE APLICA, Y ES LA MITAD QUE HACE USABLE ESTO.
 *
 * La línea de Walter (`51941654039`) es una de las dos apagadas que concentran
 * el 99,1 % de lo huérfano de la ventana, y ese archivo es exactamente lo que el
 * dueño le concedió («su línea entera»). Con el techo viejo aplicado, un deploy
 * correcto saldría en rojo mandando a revisar `numero_vendedora`.
 *
 * ⚠️ Y la misma corrida tiene que seguir disparando para una vendedora sin línea
 * propia, o la guarda estaría apagando el chequeo en vez de acotarlo.
 */
test("quien tiene línea propia no rompe el techo de huérfanas: ese archivo es SU línea", () => {
  const walter = conLineaPropia({ total: 2930, propias: 51, huerfanas: 2879, ajenas: 154 });
  assert.equal(veredictoDelPreflight([walter, sana()], UMBRALES).ok, true);

  const v = veredictoDelPreflight(
    [walter, sana({ vendedoraId: "sindy", total: 2930, propias: 51, huerfanas: 2879 })],
    UMBRALES,
  );
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /sindy arrastra 2879 huérfanas/);
  assert.doesNotMatch(v.problemas.join(" "), /walter arrastra/);
});

/**
 * ⚠️ **NO MEDIDO NO ES CERO.** Si la tercera consulta no se pudo hacer, el
 * detector de «no surtió efecto» no corrió — y un preflight que no midió no
 * aprueba. Lo contrario (leer `null` como 0) sería el falso verde más caro de
 * los tres: diría «se nota perfecto» sobre algo que nadie miró.
 */
test("con línea propia y `ajenas` sin medir, el preflight no aprueba", () => {
  const v = veredictoDelPreflight([conLineaPropia({ ajenas: null })], UMBRALES);
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /NO se pudo medir/);
});

/**
 * ⚠️ El control: sin línea propia, `ajenas: null` es lo normal y no dice nada.
 * Sin esto, el chequeo de arriba frenaría todos los deploys del equipo entero.
 */
test("sin línea propia, `ajenas` sin medir es lo esperado y no frena", () => {
  assert.equal(
    veredictoDelPreflight([sana(), sana({ vendedoraId: "luz", total: 60, propias: 58 })], UMBRALES).ok,
    true,
  );
});

test("el techo de ajenas se puede bajar, y entonces sí dispara", () => {
  const filas = [conLineaPropia({ ajenas: 154 })];
  assert.equal(veredictoDelPreflight(filas, { maxHuerfanas: 500, maxAjenas: 500 }).ok, true);
  assert.equal(veredictoDelPreflight(filas, { maxHuerfanas: 500, maxAjenas: 100 }).ok, false);
});

/**
 * 🔴 EL ROJO FALSO QUE ESTE PREFLIGHT SE HABRÍA COMIDO CONTRA PRODUCCIÓN HOY.
 *
 * `usuario1` es **admin Y trajo su propia línea** (`51955135507`, medido el
 * 18-ago-2026). El server no le publica la bandera porque no le aplica ninguna
 * frontera —`veTodo` gana antes que cualquier recorte, D4—, así que sin la
 * guarda el script salía en 1 diciendo «la regla está escrita y la cola no
 * cambió una sola fila» sobre el único caso donde eso es exactamente lo
 * correcto. Un preflight que grita en verde se aprende a ignorar.
 *
 * ⚠️ Y la misma corrida tiene que seguir gritando por una VENDEDORA con línea
 * propia sin cablear, o la guarda estaría apagando el chequeo en vez de acotarlo.
 */
test("un admin con línea propia no dispara: `veTodo` gana antes que el recorte", () => {
  const usuario1 = conLineaPropia({
    vendedoraId: "usuario1",
    veTodo: true,
    total: 5628,
    propias: 51,
    huerfanas: 5577,
    lineasPropias: ["51955135507"],
    servidorDice: undefined,
    ajenas: null,
  });
  assert.equal(veredictoDelPreflight([usuario1, sana()], UMBRALES).ok, true);

  const v = veredictoDelPreflight([usuario1, conLineaPropia({ servidorDice: undefined })], UMBRALES);
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /walter/);
  assert.doesNotMatch(v.problemas.join(" "), /usuario1 tiene línea propia/);
});
