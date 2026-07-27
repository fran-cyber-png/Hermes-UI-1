import test from "node:test";
import assert from "node:assert/strict";
import { ALIAS_SEMILLA } from "../cursos/alias.js";
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

/**
 * ══ LA SECUENCIA REAL DEL DUEÑO, LA DE DOS PASOS ════════════════════════════
 *
 * «(1) 👋Hola buenos días, te saluda Sofía… (2) el flyer con imagen». El minado
 * la encontraba PARTIDA en dos propuestas de un paso (419 y 296 conversaciones)
 * porque agrupa por el primer mensaje y la hora del día cae dentro de los 40
 * caracteres de la firma: «buenos días» y «buenas tardes» eran dos arranques
 * distintos, cada uno con la mitad del respaldo, y ninguno le ganaba al flyer.
 */
const SOFIA_MANANA =
  "👋Hola buenos días, te saluda *Sofía, asesora comercial de Goberna*. En seguida te comparto la información del diploma.";
const SOFIA_TARDE =
  "👋Hola buenas tardes, te saluda *Sofía, asesora comercial de Goberna*. En seguida te comparto la información del diploma.";

test("«buenos días» y «buenas tardes» son EL MISMO saludo: no parten el cohorte", () => {
  assert.equal(firmaDeMensaje(SOFIA_MANANA, false), firmaDeMensaje(SOFIA_TARDE, false));
  assert.equal(
    firmaDeMensaje("Hola buenas noches, te saluda Sofía", false),
    firmaDeMensaje("Hola buenos días, te saluda Sofía", false),
  );
});

test("«buen día» no es lo mismo que el resto del mensaje: el colapso no borra palabras", () => {
  assert.notEqual(firmaDeMensaje(SOFIA_MANANA, false), firmaDeMensaje("Hola buenos días", false));
});

test("la secuencia de DOS pasos (saludo → flyer) se propone entera", () => {
  const datos = [
    ...conversaciones("m", 11, [{ texto: SOFIA_MANANA }, { texto: FLYER, conMedia: true }]),
    ...conversaciones("t", 10, [{ texto: SOFIA_TARDE }, { texto: FLYER, conMedia: true }]),
    // Y el otro arranque real: el flyer directo, con menos respaldo que los dos juntos.
    ...conversaciones("f", 15, [{ texto: FLYER, conMedia: true }, { texto: TEMARIO }]),
  ];

  const propuestas = proponerSecuencias(datos, OPCIONES);
  const saludo = propuestas.find((p) => p.pasos[0].texto?.includes("Sofía"));

  assert.ok(saludo, "el saludo tiene que llegar a ser una propuesta, no partirse en dos");
  assert.equal(saludo.respaldo, 21, "los dos horarios suman un solo cohorte");
  assert.equal(saludo.pasos.length, 2, "y su segundo paso —el flyer— aparece");
  assert.equal(saludo.pasos[1].conMedia, true);
  assert.equal(propuestas[0].respaldo, 21, "el cohorte unido ahora le gana al flyer suelto");
});

/**
 * ══ LA FAMILIA DE CURSO, INFERIDA ═══════════════════════════════════════════
 *
 * Sin familia, una propuesta aprobada NO matchea con el curso de ninguna
 * conversación: queda aprobada e inútil. Y el dato estaba en el propio texto.
 */
test("la familia se infiere del texto minado: el flyer dice de qué diploma habla", () => {
  const datos = conversaciones("a", 30, [{ texto: FLYER, conMedia: true }]);
  const [s] = proponerSecuencias(datos, { ...OPCIONES, aliases: ALIAS_SEMILLA });
  assert.equal(s.familia, "DIPICOT");
  assert.equal(s.curso, "Inteligencia y Contrainteligencia");
});

test("la familia sale de TODA la secuencia: el saludo no nombra el curso, el paso 2 sí", () => {
  const datos = conversaciones("a", 30, [{ texto: SOFIA_MANANA }, { texto: FLYER, conMedia: true }]);
  const [s] = proponerSecuencias(datos, { ...OPCIONES, aliases: ALIAS_SEMILLA });
  assert.equal(s.familia, "DIPICOT");
});

test("si el texto no nombra ningún curso NO se inventa una familia", () => {
  const datos = conversaciones("a", 30, [{ texto: "Hola, ya te respondo en un momento" }]);
  const [s] = proponerSecuencias(datos, { ...OPCIONES, aliases: ALIAS_SEMILLA });
  assert.equal(s.familia, null);
  assert.equal(s.curso, null);
});

test("sin diccionario cargado la propuesta sale igual, solo que sin familia", () => {
  const datos = conversaciones("a", 30, [{ texto: FLYER, conMedia: true }]);
  const [s] = proponerSecuencias(datos, OPCIONES);
  assert.equal(s.familia, null);
  assert.equal(s.pasos.length, 1, "el minado no depende del diccionario para funcionar");
});

test("el literal que se guarda es el texto EXACTO más repetido, no una mezcla", () => {
  const datos = [
    ...conversaciones("a", 20, [{ texto: `${FLYER}\n\nInscríbete ya`, conMedia: true }]),
    ...conversaciones("b", 8, [{ texto: `${FLYER}\n\nÚltimas vacantes`, conMedia: true }]),
  ];
  const [s] = proponerSecuencias(datos, OPCIONES);
  assert.equal(s.pasos[0].texto, `${FLYER}\n\nInscríbete ya`);
});
