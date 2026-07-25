/**
 * ¿ESTE MENSAJE SALIENTE ES UNA COTIZACIÓN?
 *
 * El Pipeline muestra 3 cotizados porque «cotizado» exige que alguien tipee el
 * interés a mano, y en toda la base hay 1. Mientras tanto, la minería de
 * producción (2026-07-25) encontró **696 conversaciones con un precio enviado**.
 * El embudo no está vacío: está ciego. Este módulo es el ojo.
 *
 * ES PURO A PROPÓSITO (patrón puro+wrapper, `arquitectura.md` §5.3): decide
 * sobre un `string`, sin base ni red, así el criterio se puede discutir con un
 * test en la mano en vez de con un regex enterrado en un SQL. El seam que lo
 * corre sobre la base (`consultarSenales.ts`) lo llama UNA vez por mensaje
 * candidato — no hay una segunda implementación en SQL, así que no hay nada que
 * pueda divergir (la lección de #37 / ADR 0009).
 *
 * EL CRITERIO, en una línea: **hay cotización cuando hay un MONTO con moneda
 * explícita y plausible, salvo que el monto sea una instrucción de pago.**
 *
 * Por qué exigir la moneda: el regex ingenuo que dio los 696 marca cualquier
 * número. «Son 11 módulos», «120 horas académicas», «te escribo al 986394450» y
 * «mi DNI es 45678912» son todos números y ninguno es un precio. La moneda es lo
 * que separa una cifra de un precio.
 *
 * Por qué el veto bancario: el dueño lo pidió por nombre — «tenemos cuenta
 * bancaria en soles» no es una cotización. Esa frase ni siquiera trae cifra, así
 * que cae sola; pero «deposita a la cuenta BCP soles S/ 250» SÍ trae una, y sigue
 * sin ser una cotización: es la instrucción de pago de una cotización que ya se
 * mandó antes. Se veta cuando el texto habla de una cuenta y NO enmarca la cifra
 * como precio.
 */

/** Las dos monedas que la Escuela cobra. `PEN` es soles; `USD`, dólares. */
export type Moneda = "PEN" | "USD";

export interface Monto {
  moneda: Moneda;
  valor: number;
  /** El texto crudo que se leyó, para poder mostrar la evidencia. */
  crudo: string;
  /** Dónde empieza en el texto — el veto mira lo que hay alrededor. */
  indice: number;
}

/**
 * `alta` = monto + la frase lo enmarca como precio («la inversión es S/250»).
 * `media` = monto suelto («S/250»): casi siempre es una cotización, pero no hay
 * una segunda señal que lo confirme. `null` = no es cotización.
 */
export type Confianza = "alta" | "media";

export interface Veredicto {
  esCotizacion: boolean;
  confianza: Confianza | null;
  montos: Monto[];
  /** En castellano, por qué. Va al tooltip de la etiqueta automática. */
  motivo: string;
  /** Qué frenó la detección (vacío si no frenó nada). */
  vetos: string[];
}

/**
 * El piso y el techo de lo plausible. Los cursos de la Escuela van de S/100 a
 * S/250 (catálogo medido el 24-jul, issue #129); el pack más caro no llega a
 * S/2000. Un «S/ 5» es una fracción de cuota o un typo, y un número de 8 dígitos
 * es una cuenta bancaria, no un precio.
 */
export const MONTO_MINIMO = 10;
export const MONTO_MAXIMO = 100_000;

/** Sin acentos y en minúsculas: «INVERSIÓN» y «inversion» pesan igual. */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Las palabras que ENMARCAN una cifra como precio. No detectan nada por sí
 * solas (sin monto no hay cotización): suben la confianza y levantan el veto
 * bancario.
 */
const PALABRAS_DE_PRECIO = [
  "precio",
  "inversion",
  "invertir",
  "cuesta",
  "cuestan",
  "costo",
  "coste",
  "promocion",
  "promo",
  "descuento",
  "tarifa",
  "matricula",
  "oferta",
  "cuota",
  "cuotas",
  "vale",
  "valor",
  "sale en",
  "queda en",
  "por solo",
  "pago unico",
];

/**
 * Las palabras de INSTRUCCIÓN DE PAGO. Cuando aparecen y la cifra no está
 * enmarcada como precio, el mensaje es «acá depositás», no «esto cuesta».
 * Deliberadamente cortas: `yape`/`plin`/`transferencia` NO están, porque una
 * cotización real dice «S/250, lo puedes pagar por Yape» y eso sí es cotizar.
 */
const PALABRAS_DE_CUENTA = ["cuenta", "cci", "interbancari", "nro de cuenta", "n de cuenta"];

/**
 * El escáner de montos. Dos formas, las dos con la moneda pegada:
 *   · símbolo adelante — `S/250`, `S/. 250`, `USD 60`, `$60`, `PEN 199`
 *   · palabra atrás    — `250 soles`, `60 dólares`, `199 USD`
 *
 * «soles» SOLO cuenta como sufijo. Es lo que hace que «cuenta BCP soles
 * 191-1234567-0-52» no rinda ningún monto: ahí la palabra va ANTES de la cifra.
 */
const RE_MONTO =
  /(?:(?<simbolo>us\$|u\$s|\busd\b|\bpen\b|s\/\.?|s\.\/|\$)\s*(?<n1>\d[\d.,]*)|(?<n2>\d[\d.,]*)\s*(?<palabra>soles?|d[oó]lares?|\busd\b|\bpen\b|\$))/giu;

/** Un carácter que, pegado a la cifra, delata que es parte de un código y no un precio. */
function pegoteDeCodigo(c: string | undefined): boolean {
  return c !== undefined && /[\d\-/]/.test(c);
}

/**
 * Convierte «1,200» / «1.200» / «250,50» / «250.00» al número que la vendedora
 * quiso decir. La regla: con un solo separador, tres dígitos detrás es MILES y
 * uno o dos son DECIMALES — que es como se escribe la plata en Perú y en toda
 * la región, sin ponerse de acuerdo en cuál símbolo usar.
 */
export function parsearNumero(raw: string): number | null {
  const limpio = raw.replace(/\s/g, "").replace(/[.,]+$/, "");
  const soloDigitos = limpio.replace(/[.,]/g, "");
  if (!/^\d+$/.test(soloDigitos)) return null;
  // Más de 7 dígitos no es un precio: es una cuenta, un CCI o un teléfono.
  if (soloDigitos.length > 7) return null;

  const puntos = (limpio.match(/\./g) ?? []).length;
  const comas = (limpio.match(/,/g) ?? []).length;

  let normalizado = limpio;
  if (puntos > 0 && comas > 0) {
    // Con los dos, el ÚLTIMO manda: es el decimal.
    const decSep = limpio.lastIndexOf(".") > limpio.lastIndexOf(",") ? "." : ",";
    const milSep = decSep === "." ? "," : ".";
    normalizado = limpio.split(milSep).join("").replace(decSep, ".");
  } else if (puntos > 0 || comas > 0) {
    const sep = puntos > 0 ? "." : ",";
    const partes = limpio.split(sep);
    normalizado =
      partes.length === 2 && partes[1].length !== 3 ? partes.join(".") : partes.join("");
  }

  const valor = Number.parseFloat(normalizado);
  return Number.isFinite(valor) ? valor : null;
}

function monedaDeSimbolo(s: string): Moneda {
  const n = normalizar(s);
  return n.startsWith("s/") || n.startsWith("s.") || n === "pen" ? "PEN" : "USD";
}

function monedaDePalabra(p: string): Moneda {
  const n = normalizar(p);
  return n.startsWith("sol") || n === "pen" ? "PEN" : "USD";
}

/**
 * Todos los montos plausibles del texto, en orden de aparición. Exportado
 * aparte porque es la mitad interesante: se puede mirar sin el veredicto.
 */
export function montosDelTexto(texto: string | null | undefined): Monto[] {
  if (!texto) return [];
  const montos: Monto[] = [];

  for (const m of texto.matchAll(RE_MONTO)) {
    const g = m.groups!;
    const indice = m.index!;
    const crudo = m[0];

    // Pegado a un guion, una barra o más dígitos → es un código, no un precio.
    if (pegoteDeCodigo(texto[indice - 1])) continue;
    if (pegoteDeCodigo(texto[indice + crudo.length])) continue;

    const raw = g.n1 ?? g.n2;
    if (!raw) continue;
    const valor = parsearNumero(raw);
    if (valor === null || valor < MONTO_MINIMO || valor > MONTO_MAXIMO) continue;

    montos.push({
      moneda: g.simbolo ? monedaDeSimbolo(g.simbolo) : monedaDePalabra(g.palabra!),
      valor,
      crudo,
      indice,
    });
  }

  return montos;
}

/** ¿El texto enmarca la cifra como precio? */
export function tienePalabraDePrecio(texto: string): boolean {
  const n = normalizar(texto);
  return PALABRAS_DE_PRECIO.some((p) => n.includes(p));
}

/** ¿El texto está dando datos de una cuenta para depositar? */
export function tienePalabraDeCuenta(texto: string): boolean {
  const n = normalizar(texto);
  return PALABRAS_DE_CUENTA.some((p) => n.includes(p));
}

/**
 * EL VEREDICTO. Un mensaje saliente entra, sale si es una cotización y por qué.
 */
export function esCotizacion(texto: string | null | undefined): Veredicto {
  const limpio = (texto ?? "").trim();
  if (!limpio) {
    return { esCotizacion: false, confianza: null, montos: [], motivo: "sin texto", vetos: [] };
  }

  const montos = montosDelTexto(limpio);
  if (montos.length === 0) {
    return {
      esCotizacion: false,
      confianza: null,
      montos: [],
      motivo: "no hay ningún monto con moneda (una cifra sin moneda no es un precio)",
      vetos: [],
    };
  }

  const conPrecio = tienePalabraDePrecio(limpio);

  // EL VETO: habla de una cuenta y no enmarca la cifra como precio ⇒ es la
  // instrucción de pago, no la cotización.
  if (!conPrecio && tienePalabraDeCuenta(limpio)) {
    return {
      esCotizacion: false,
      confianza: null,
      montos,
      motivo: "la cifra está en datos de una cuenta bancaria: es instrucción de pago, no cotización",
      vetos: ["cuenta-bancaria"],
    };
  }

  const principal = montos[0];
  return {
    esCotizacion: true,
    confianza: conPrecio ? "alta" : "media",
    montos,
    motivo: conPrecio
      ? `precio enmarcado: ${principal.crudo.trim()}`
      : `monto con moneda, sin palabra de precio alrededor: ${principal.crudo.trim()}`,
    vetos: [],
  };
}
