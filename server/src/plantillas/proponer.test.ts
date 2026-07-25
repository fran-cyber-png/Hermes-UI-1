import test from "node:test";
import assert from "node:assert/strict";
import { firmaDeMensaje, nombreDeSecuencia, proponerSecuencias, type SalienteMinado } from "./proponer.js";

/**
 * Los textos son los REALES de la secuencia de venta minada en prod el 25-jul.
 * Las cantidades están a escala (÷10) para que el test se lea, con los pisos
 * bajados en la misma proporción — lo que se fija es el MÉTODO, no los números.
 */
const FLYER = "🕵️‍♂️DIPLOMA INTERNACIONAL DE INTELIGENCIA Y CONTRAINTELIGENCIA";
const SALUDO = "👋 Hola, te saluda Luz, asesora comercial de Goberna";
const TEMARIO = "Temario del diploma";
const DURACION = "El diploma dura 3 semanas de clases en vivo";

/** Arma `n` conversaciones que mandaron exactamente esta lista de pasos. */
function conversaciones(
  prefijo: string,
  n: number,
  pasos: { texto: string | null; conMedia?: boolean }[],
): SalienteMinado[] {
  const salida: SalienteMinado[] = [];
  for (let i = 0; i < n; i++) {
    pasos.forEach((p, j) => {
      salida.push({
        clave: `conv:whatsapp:${prefijo}${i}:51999999999`,
        posicion: j + 1,
        texto: p.texto,
        conMedia: p.conMedia ?? false,
      });
    });
  }
  return salida;
}

const OPCIONES = { minRespaldo: 5, minCuota: 0.25, maxPasos: 6, variantes: 2 };

test("sin datos no se propone nada (no se inventa una secuencia)", () => {
  assert.deepEqual(proponerSecuencias([], OPCIONES), []);
});

test("un puñado de conversaciones no alcanza: sin respaldo, no hay propuesta", () => {
  const pocas = conversaciones("a", 3, [{ texto: FLYER, conMedia: true }, { texto: TEMARIO }]);
  assert.deepEqual(proponerSecuencias(pocas, OPCIONES), []);
});

test("la secuencia canónica se reconstruye del histórico, en orden y con la imagen", () => {
  const datos = conversaciones("a", 40, [
    { texto: FLYER, conMedia: true },
    { texto: FLYER, conMedia: true },
    { texto: TEMARIO, conMedia: true },
    { texto: DURACION },
  ]);

  const [s] = proponerSecuencias(datos, OPCIONES);
  assert.equal(s.respaldo, 40);
  assert.deepEqual(
    s.pasos.map((p) => p.orden),
    [1, 2, 3, 4],
  );
  assert.equal(s.pasos[0].conMedia, true, "el flyer lleva imagen: el 42% de los mensajes la lleva");
  assert.equal(s.pasos[2].texto, TEMARIO);
  assert.equal(s.pasos[3].conMedia, false);
});

test("los dos arranques reales (flyer y saludo) dan DOS secuencias, no un promedio", () => {
  const datos = [
    ...conversaciones("f", 41, [{ texto: FLYER, conMedia: true }, { texto: TEMARIO, conMedia: true }]),
    ...conversaciones("s", 19, [{ texto: SALUDO }, { texto: FLYER, conMedia: true }]),
  ];

  const propuestas = proponerSecuencias(datos, OPCIONES);
  assert.equal(propuestas.length, 2);
  assert.equal(propuestas[0].respaldo, 41, "la más respaldada va primero");
  assert.equal(propuestas[0].pasos[0].conMedia, true);
  assert.equal(propuestas[1].pasos[0].texto, SALUDO);
});

test("la secuencia se corta donde el histórico deja de coincidir", () => {
  const datos = [
    // Todas arrancan igual y siguen igual dos pasos…
    ...conversaciones("a", 30, [{ texto: FLYER, conMedia: true }, { texto: TEMARIO, conMedia: true }]),
    // …y después cada una hace la suya: ningún tercer paso llega al piso.
    ...Array.from({ length: 30 }, (_, i) => ({
      clave: `conv:whatsapp:a${i}:51999999999`,
      posicion: 3,
      texto: `respuesta suelta ${i}`,
      conMedia: false,
    })),
  ];

  const [s] = proponerSecuencias(datos, OPCIONES);
  assert.equal(s.pasos.length, 2, "no se propone el tercer paso: no hay uno que se repita");
});

test("dos redacciones del mismo flyer cuentan como el mismo paso", () => {
  const datos = [
    ...conversaciones("a", 15, [{ texto: `${FLYER}\n\nInscríbete ya`, conMedia: true }]),
    ...conversaciones("b", 15, [{ texto: `${FLYER}\n\nÚltimas vacantes`, conMedia: true }]),
  ];
  const [s] = proponerSecuencias(datos, OPCIONES);
  assert.equal(s.respaldo, 30, "el encabezado común los agrupa; el pie distinto no los separa");
});

test("mandar el temario como imagen y describirlo con palabras NO es el mismo paso", () => {
  assert.notEqual(firmaDeMensaje(TEMARIO, true), firmaDeMensaje(TEMARIO, false));
});

test("los acentos, emojis y mayúsculas no cambian la firma", () => {
  assert.equal(
    firmaDeMensaje("🕵️ La INVERSIÓN del diploma", false),
    firmaDeMensaje("la inversion del diploma", false),
  );
});

test("una ráfaga de 8 se propone hasta el tope de pasos configurado", () => {
  const ocho = Array.from({ length: 8 }, (_, i) => ({ texto: `paso ${i + 1}` }));
  const datos = conversaciones("a", 20, ocho);
  const [s] = proponerSecuencias(datos, { ...OPCIONES, maxPasos: 6 });
  assert.equal(s.pasos.length, 6, "las ráfagas de 8 son reales, pero seis ya es una venta entera");
});

test("el nombre de la secuencia sale de su primer paso, no de un contador", () => {
  assert.equal(
    nombreDeSecuencia({ orden: 1, texto: SALUDO, conMedia: false, respaldo: 1, cuota: 1 }),
    SALUDO,
  );
  assert.match(
    nombreDeSecuencia({ orden: 1, texto: null, conMedia: true, respaldo: 1, cuota: 1 }),
    /imagen/i,
  );
});

test("el literal que se guarda es el texto EXACTO más repetido, no una mezcla", () => {
  const datos = [
    ...conversaciones("a", 20, [{ texto: `${FLYER}\n\nInscríbete ya`, conMedia: true }]),
    ...conversaciones("b", 8, [{ texto: `${FLYER}\n\nÚltimas vacantes`, conMedia: true }]),
  ];
  const [s] = proponerSecuencias(datos, OPCIONES);
  assert.equal(s.pasos[0].texto, `${FLYER}\n\nInscríbete ya`);
});
