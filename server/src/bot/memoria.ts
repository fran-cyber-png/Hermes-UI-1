/**
 * Memoria del lead — extrae hechos (nombre, país, curso) del historial
 * de mensajes entrantes y los persiste para turnos futuros.
 *
 * Determinista: usa regex, no LLM. El LLM no decide el nombre del lead,
 * lo extrae este módulo y se lo pasa al prompt.
 *
 * ── Qué se extrae ───────────────────────────────────────────────────
 * nombre  → "me llamo X", "soy X", "mi nombre es X"
 * pais    → "soy de X", "vivo en X", nombres de países
 * familia → alias de curso en el texto del lead
 */

import { db } from "../db/client.js";
import { botMemoriaLead } from "../db/bot.js";
import type { Turno } from "./acciones.js";
import { tramoDePipeline, type Traza } from "./traza.js";

export interface HechosLead {
  nombre?: string;
  pais?: string;
  familia?: string;
  nombreCurso?: string;
  extraidoEn?: string;
}

// ── Extracción de nombre ─────────────────────────────────────────────

const RE_NOMBRE = [
  /\b(?:me\s+llamo|mi\s+nombre\s+es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3})/i,
  /\b(?:soy\s+(?:la|el)\s+)?(?:sr|sra|dr|dra|lic|ing)\.?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3})/i,
];

function extraerNombre(texto: string): string | null {
  for (const re of RE_NOMBRE) {
    const m = re.exec(texto);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

// ── Extracción de país ───────────────────────────────────────────────

const RE_PAIS = [
  /\b(?:soy\s+de|vivo\s+en|estoy\s+en|escribo\s+desde)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/i,
];

// Países de LATAM + España (mercado de Goberna)
const PAISES_CONOCIDOS = new Set([
  "peru", "perú", "mexico", "méxico", "colombia", "argentina", "chile",
  "ecuador", "bolivia", "paraguay", "uruguay", "venezuela", "panama", "panamá",
  "costa rica", "guatemala", "honduras", "el salvador", "nicaragua",
  "republica dominicana", "república dominicana", "españa", "espana",
  "brasil", "estados unidos", "eeuu", "ee.uu.",
]);

function normalizarPais(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extraerPais(texto: string): string | null {
  for (const re of RE_PAIS) {
    const m = re.exec(texto);
    if (m?.[1]) {
      const candidato = m[1].trim();
      const norm = normalizarPais(candidato);
      if (PAISES_CONOCIDOS.has(norm)) return candidato;
    }
  }
  return null;
}

// ── Extracción de curso ──────────────────────────────────────────────

/**
 * Patrones que indican interés explícito en un curso/programa.
 * La familia real se resuelve contra alias_curso en el orquestador;
 * acá solo extraemos el texto crudo.
 */
const RE_CURSO = [
  /\b(?:me\s+interesa|quiero\s+(?:info(?:rmaci[oó]n)?\s+(?:sobre|de|del))?)\s+(.+?)(?:[.!?]|$)/i,
  /\b(?:estoy\s+(?:interesad[oa]|buscando)\s+(?:en\s+)?(?:el\s+)?)\s+(.+?)(?:[.!?]|$)/i,
];

function extraerCursoCrudo(texto: string): string | null {
  for (const re of RE_CURSO) {
    const m = re.exec(texto);
    if (m?.[1]) {
      const crudo = m[1].trim();
      // No extraer fragmentos muy cortos o muy largos
      if (crudo.length >= 4 && crudo.length <= 80) return crudo;
    }
  }
  return null;
}

// ── API pública ──────────────────────────────────────────────────────

const MAX_TURNOS_A_ANALIZAR = 10;

/**
 * Extrae hechos del historial de mensajes entrantes del lead.
 * Solo mira los últimos N turnos entrantes, en orden cronológico.
 * El último matcheo de cada categoría gana (la info más reciente).
 */
export function extraerHechos(historial: Turno[]): HechosLead {
  const entrantes = historial
    .filter((t) => t.rol === "lead" && t.texto)
    .slice(-MAX_TURNOS_A_ANALIZAR);

  const hechos: HechosLead = {};

  for (const t of entrantes) {
    const nombre = extraerNombre(t.texto);
    if (nombre) hechos.nombre = nombre;

    const pais = extraerPais(t.texto);
    if (pais) hechos.pais = pais;

    const curso = extraerCursoCrudo(t.texto);
    if (curso) hechos.familia = curso;
  }

  return hechos;
}

/**
 * Persiste (o actualiza) los hechos extraídos en la tabla de memoria.
 * Merge: no pisa lo que ya estaba si el nuevo valor es null/undefined.
 */
export async function persistirHechos(
  clave: string,
  nuevos: HechosLead,
  traza?: Traza,
): Promise<void> {
  const t = traza ? tramoDePipeline("memoria", traza) : null;

  try {
    // Leer lo que ya había para no pisar con nulls
    const existente = await db.query.botMemoriaLead
      .findFirst({
        where: (cols, { eq }) => eq(cols.clave, clave),
      })
      .catch(() => null);

    const previos = (existente?.hechos as HechosLead) ?? {};
    const merge: HechosLead = {
      ...previos,
      ...Object.fromEntries(
        Object.entries(nuevos).filter(([, v]) => v !== undefined && v !== null),
      ),
      extraidoEn: new Date().toISOString(),
    };

    await db
      .insert(botMemoriaLead)
      .values({
        clave,
        hechos: merge as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: botMemoriaLead.clave,
        set: {
          hechos: merge as Record<string, unknown>,
          actualizadoEn: new Date(),
        },
      });
    t?.cerrar("ok");
  } catch {
    t?.cerrar("sin_tabla");
  }
}

/**
 * Lee los hechos persistidos para una conversación.
 * Si la tabla no existe, devuelve vacío — el bot sigue sin memoria.
 */
export async function leerHechos(clave: string): Promise<HechosLead> {
  try {
    const fila = await db.query.botMemoriaLead.findFirst({
      where: (cols, { eq }) => eq(cols.clave, clave),
    });
    return (fila?.hechos as HechosLead) ?? {};
  } catch {
    return {};
  }
}
