import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tieneLineaPropia,
  lineasPropiasDe,
  PROPOSITO_LINEA_PROPIA,
  type LineaDeVendedora,
} from "./lineaPropia.js";

/**
 * Los números y los conteos son los de PRODUCCIÓN, medidos el 18-ago-2026 sobre
 * `numeros_wa` × `numero_vendedora`. No son ejemplos inventados: cada caso de
 * abajo existe hoy en la base, y dos de ellos son exactamente los que hacen que
 * ninguna de las dos condiciones alcance sola.
 */
const WALTER = { numero: "51941654039", proposito: "vendedora", duenas: 1 } satisfies LineaDeVendedora;
const USUARIO1 = { numero: "51955135507", proposito: "vendedora", duenas: 1 } satisfies LineaDeVendedora;
/** «Ventas Meta»: la línea que trae los leads, compartida por SIETE personas. */
const VENTAS_META = { numero: "51984429504", proposito: "vendedora", duenas: 7 } satisfies LineaDeVendedora;
/** «Betto»: la línea de campaña, dos personas. */
const CAMPANA = { numero: "51963139984", proposito: "campana", duenas: 2 } satisfies LineaDeVendedora;
/** «Ventas Perú», retirada: propósito escuela y sin nadie en el mapa. */
const ESCUELA_SOLA = { numero: "51986394450", proposito: "escuela", duenas: 1 } satisfies LineaDeVendedora;
/** «Venta Peru»: dada de alta como vendedora y **nadie la declara suya**. */
const SIN_DUENO = { numero: "51944531711", proposito: "vendedora", duenas: 0 } satisfies LineaDeVendedora;

test("Walter vinculó su línea por QR y es de él solo: tiene línea propia", () => {
  assert.equal(tieneLineaPropia([WALTER]), true);
  assert.deepEqual(lineasPropiasDe([WALTER]), [WALTER.numero]);
});

test("Usuario1, el otro caso real del pedido, también", () => {
  assert.equal(tieneLineaPropia([USUARIO1]), true);
});

test("🔴 Ventas Meta NO es línea propia aunque diga `vendedora`: la comparten 7", () => {
  // ESTE es el test que justifica el conteo. `proposito` solo alcanzaría para
  // decir que sí, y entonces la regla caería sobre Luz, Sindy y las cinco
  // `ventas1X`: TODO el equipo de la Escuela, que es lo contrario de lo pedido
  // («de ventas meta solo los que le asignaron a ellos»).
  assert.equal(VENTAS_META.proposito, PROPOSITO_LINEA_PROPIA);
  assert.equal(tieneLineaPropia([VENTAS_META]), false);
  assert.deepEqual(lineasPropiasDe([VENTAS_META]), []);
});

test("🔴 una línea de ESCUELA con una sola persona tampoco: el conteo solo no alcanza", () => {
  // El espejo del anterior. El día que Ventas Meta quede con una sola persona
  // —una baja, o un push de Cerberus con `vendedoras` incompleto, que vacía el
  // mapa sin log— el conteo pelado la marcaría como propia y le daría la línea
  // entera de la Escuela a quien quedó. El propósito es lo que lo impide.
  assert.equal(ESCUELA_SOLA.duenas, 1);
  assert.equal(tieneLineaPropia([ESCUELA_SOLA]), false);
});

test("una línea de campaña compartida no es línea propia", () => {
  assert.equal(tieneLineaPropia([CAMPANA]), false);
});

test("una línea de vendedora que NADIE declara suya no la trajo nadie", () => {
  // `51944531711` existe en `numeros_wa` con `proposito='vendedora'` y cero
  // filas en `numero_vendedora`. Sin esta guarda, un número huérfano le regalaría
  // la regla a cualquiera que lo tuviera colgando del mapa.
  assert.equal(tieneLineaPropia([SIN_DUENO]), false);
  assert.deepEqual(lineasPropiasDe([SIN_DUENO]), []);
});

test("sin líneas no hay línea propia: se comporta como hoy (fail-open)", () => {
  // `true` QUITA la rama de lo huérfano en la frontera, así que afirmarlo sin
  // dato le escondería trabajo a alguien. Un mapa que no se pudo leer degrada
  // en «ves de más», nunca en «no ves nada» — la misma dirección que
  // `recorteDeLineas` con `sinLineasPropias`.
  assert.equal(tieneLineaPropia([]), false);
  assert.deepEqual(lineasPropiasDe([]), []);
});

test("sin el dato del mapa (undefined) tampoco: no se afirma lo que no se pudo leer", () => {
  assert.equal(tieneLineaPropia(undefined), false);
  assert.deepEqual(lineasPropiasDe(undefined), []);
});

test("mixto: quien tiene su línea Y está en Ventas Meta sigue teniendo línea propia", () => {
  // Es el caso EXACTO del pedido, y por eso alcanza con UNA: exigir que todas
  // sean propias apagaría la regla justo para la persona que la motivó.
  assert.equal(tieneLineaPropia([WALTER, VENTAS_META]), true);
});

test("mixto: `lineasPropiasDe` devuelve SOLO la propia, nunca la compartida", () => {
  // Devolver Ventas Meta acá sería darle a Walter la línea entera de la Escuela,
  // que es lo que este frente viene a evitar.
  assert.deepEqual(lineasPropiasDe([WALTER, VENTAS_META, CAMPANA]), [WALTER.numero]);
});

test("el orden y los repetidos no cambian la respuesta: el `IN (...)` sale igual", () => {
  const desordenado = [USUARIO1, WALTER, { ...WALTER, numero: ` ${WALTER.numero} ` }];
  assert.deepEqual(lineasPropiasDe(desordenado), [WALTER.numero, USUARIO1.numero].sort());
});
