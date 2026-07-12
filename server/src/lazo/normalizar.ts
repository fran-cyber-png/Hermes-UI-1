/**
 * Normalización de identidades antes de hashear y mandar a Meta.
 *
 * Regla de oro: normalizar NUNCA inventa. Si un valor no calza con ningún plan de numeración
 * real, devolvemos `null` — preferimos perder un match a fusionar dos personas distintas.
 * Un teléfono mal normalizado no es un match perdido: es una persona equivocada.
 *
 * Meta exige (developers.facebook.com/docs/marketing-api/conversions-api/parameters):
 *   - `em`: trim + minúsculas → SHA-256
 *   - `ph`: solo dígitos, CON código de país, SIN '+' ni ceros iniciales → SHA-256
 */

/** Países con plan de numeración conocido. Se agregan cuando aparece una fuente que los use. */
export type Pais =
  | "PE" | "MX" | "CL" | "BO" | "CO" | "EC"   // los 6 de Goberna
  | "GT" | "HN" | "PA" | "DO" | "US" | "PY" | "UY" | "AR";

type PlanNacional = {
  /** Código de país, sin '+'. */
  codigo: string;
  /** Largo del número nacional, ya sin prefijo de marcación. */
  largo: number;
  /** Primer dígito(s) válido(s) del número nacional. Vacío = cualquiera. */
  empiezaCon?: string[];
  /** Prefijo de marcación nacional que se descarta en E.164 (Ecuador y Argentina usan '0'). */
  troncal?: string;
};

const PLANES: Record<Pais, PlanNacional> = {
  PE: { codigo: "51", largo: 9, empiezaCon: ["9"] },
  MX: { codigo: "52", largo: 10 },
  CL: { codigo: "56", largo: 9, empiezaCon: ["9"] },
  BO: { codigo: "591", largo: 8, empiezaCon: ["6", "7"] },
  CO: { codigo: "57", largo: 10, empiezaCon: ["3"] },
  EC: { codigo: "593", largo: 9, empiezaCon: ["9"], troncal: "0" },
  GT: { codigo: "502", largo: 8 },
  HN: { codigo: "504", largo: 8 },
  PA: { codigo: "507", largo: 8 },
  DO: { codigo: "1", largo: 10 },
  US: { codigo: "1", largo: 10 },
  PY: { codigo: "595", largo: 9, troncal: "0" },
  UY: { codigo: "598", largo: 8, troncal: "0" },
  AR: { codigo: "54", largo: 10, troncal: "0" },
};

/** Los códigos más largos primero: '593' (Ecuador) debe ganarle a '59' (que no existe). */
const CODIGOS_POR_LARGO = [...new Set(Object.values(PLANES).map((p) => p.codigo))].sort(
  (a, b) => b.length - a.length,
);

function calzaConPlan(nacional: string, plan: PlanNacional): boolean {
  if (nacional.length !== plan.largo) return false;
  if (!plan.empiezaCon) return true;
  return plan.empiezaCon.some((d) => nacional.startsWith(d));
}

/**
 * Devuelve el número en E.164 sin '+' (lo que Meta quiere hashear), o `null` si no es un
 * teléfono válido de ningún país conocido.
 *
 * `paisPorDefecto` es de dónde suponemos que es la persona (el país del lead, de la landing,
 * de la cuenta). Si el número trae código de país explícito, ese gana.
 */
export function normalizarTelefono(crudo: string, paisPorDefecto: Pais | null): string | null {
  if (!crudo) return null;

  const tieneMas = crudo.trim().startsWith("+");
  const digitos = crudo.replace(/\D/g, "");
  if (digitos.length < 8 || digitos.length > 15) return null; // E.164 tope: 15 dígitos

  // 1. Si hay país por defecto y el número NO trae '+', probamos leerlo como número nacional.
  //    Es el caso más común: alguien escribe "987654321" en un formulario peruano.
  if (paisPorDefecto && !tieneMas) {
    const plan = PLANES[paisPorDefecto];
    const sinTroncal =
      plan.troncal && digitos.startsWith(plan.troncal)
        ? digitos.slice(plan.troncal.length)
        : digitos;
    if (calzaConPlan(sinTroncal, plan)) return plan.codigo + sinTroncal;
  }

  // 2. Si no calzó como nacional (o vino con '+'), lo leemos como E.164: buscamos qué código
  //    de país lo abre y validamos el resto contra ese plan.
  for (const codigo of CODIGOS_POR_LARGO) {
    if (!digitos.startsWith(codigo)) continue;
    const nacional = digitos.slice(codigo.length);
    const planes = Object.values(PLANES).filter((p) => p.codigo === codigo);
    if (planes.some((p) => calzaConPlan(nacional, p))) return codigo + nacional;
  }

  return null;
}

/**
 * Devuelve el correo en minúsculas y sin espacios, o `null` si no es sintácticamente un correo.
 *
 * NO corrige typos de dominio. Si alguien escribió 'gimei.com' queriendo decir 'gmail.com',
 * lo guardamos tal cual: corregirlo sería inventar un dato que la persona no escribió, y eso
 * es una inferencia, no un hecho.
 */
export function normalizarEmail(crudo: string): string | null {
  if (!crudo) return null;
  const limpio = crudo.trim().toLowerCase();
  // Deliberadamente simple: un `local@dominio.tld` con TLD de 2+ letras. No validamos que exista.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/.test(limpio)) return null;
  return limpio;
}
