/**
 * Contexto del contacto para el bot — recolecta datos reales del lead
 * desde todas las fuentes disponibles.
 *
 * Cada fuente tiene timeout propio (5s) y degrada independientemente:
 * si Cerberus no responde, el bot conversa sin nombre, pero no se cuelga.
 *
 * ── Fuentes ──────────────────────────────────────────────────────────
 * Memoria      → nombre, pais (lo que el lead dijo en turnos anteriores)
 * Cerberus     → nombre, esCliente, ventasCount, pais (teléfono verificado)
 * Perfil WA    → nombre del perfil de WhatsApp (último recurso)
 * Intereses    → interes (curso registrado manualmente)
 * Señales      → cotizada, enfriada
 * Origen       → campaña/anuncio/formulario → interesPropuesto
 */

import { db } from "../db/client.js";
import { aliasesActivos } from "../cursos/repositorio.js";
import { ficha } from "../cerberus/ficha.js";
import { consultarSenales } from "../senales/consultarSenales.js";
import { consultarIntereses } from "../gestiones/intereses.js";
import { familiaDeTexto, familiaDeAnuncio, type AliasCurso } from "../cursos/alias.js";
import { hiloDe } from "../whatsapp/hilo.js";
import { leerHechos } from "./memoria.js";
import { resolverIdentidad } from "./identidad.js";
import { armarContextoContacto } from "./prompt.js";

export interface ContextoContacto {
  nombre: string | null;
  procedenciaNombre: string | null;
  pais: string | null;
  interes: string | null;
  interesPropuesto: string | null;
  senales: string[];
  esCliente: boolean;
  ventasCount: number | null;
  errores: string[];
}

const TIMEOUT_FUENTE_MS = 5000;

async function conTimeout<T>(
  nombre: string,
  promesa: Promise<T>,
  errores: string[],
): Promise<T | null> {
  try {
    const resultado = await Promise.race([
      promesa,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), TIMEOUT_FUENTE_MS),
      ),
    ]);
    return resultado;
  } catch (err) {
    const msg = (err as Error).message;
    errores.push(`${nombre}: ${msg}`);
    return null;
  }
}

export async function recolectarContextoContacto(
  clave: string,
  numeroPropio: string,
): Promise<ContextoContacto> {
  const errores: string[] = [];
  const telefono = extraerTelefono(clave);

  // ── Memoria (lo que el lead dijo en turnos anteriores) ─────────────
  const memoria = (await conTimeout("memoria", leerHechos(clave), errores)) ?? {};

  // ── Cerberus ──────────────────────────────────────────────────────
  let nombre: string | null = null;
  let procedenciaNombre: string | null = null;
  let pais: string | null = null;
  let esCliente = false;
  let ventasCount: number | null = null;

  if (telefono) {
    const f = await conTimeout("Cerberus", ficha(telefono), errores);
    if (f) {
      if (f.estado === "cliente") {
        nombre = f.nombre;
        procedenciaNombre = "de Cerberus";
        pais = f.pais || null;
        esCliente = true;
        ventasCount = f.ventasCount;
      } else if (f.estado === "error") {
        errores.push(`Cerberus: ${f.motivo}`);
      }
      // "nuevo" → sin datos, no es error
    }
  }

  // ── Señales ───────────────────────────────────────────────────────
  const senales: string[] = [];
  const senalesResult = await conTimeout(
    "senales",
    consultarSenales(db, { claves: [clave] }),
    errores,
  );
  if (senalesResult) {
    const s = senalesResult[clave];
    if (s) {
      if (s.cotizacion?.esCotizacion) senales.push("Cotizado");
      if (s.enfriamiento.enfriada) senales.push("Se enfrió");
    }
  }

  // ── Intereses ─────────────────────────────────────────────────────
  let interes: string | null = null;
  const interesesResult = await conTimeout(
    "intereses",
    consultarIntereses(db, [clave]),
    errores,
  );
  if (interesesResult) {
    const cursos = interesesResult.intereses[clave];
    if (cursos && cursos.length > 0) {
      interes = cursos[0]!;
    }
  }

  // ── Origen (campaña/anuncio/formulario) ───────────────────────────
  let interesPropuesto: string | null = null;
  let perfilNombre: string | null = null;

  if (telefono) {
    const hilo = await conTimeout(
      "origen",
      hiloDe(db, telefono, numeroPropio).then((r) => r as Record<string, unknown>[]).catch(() => [] as Record<string, unknown>[]),
      errores,
    );
    if (hilo && hilo.length > 0) {
      const aliases = await conTimeout(
        "aliases",
        aliasesActivos(db),
        errores,
      );
      interesPropuesto = resolverInteresPropuesto(hilo, aliases ?? []);

      // El nombre del perfil de WhatsApp (lo persiste la ingesta en cada mensaje)
      perfilNombre = hilo
        .map((m) => (m.persona_nombre as string | null | undefined) ?? null)
        .find((n): n is string => n !== null) ?? null;
    }
  }

  // ── Resolver identidad: memoria > Cerberus > perfil de WhatsApp ──
  const identidad = resolverIdentidad(memoria, { nombre, pais }, perfilNombre);
  nombre = identidad.nombre;
  procedenciaNombre = identidad.procedenciaNombre;
  pais = identidad.pais;

  return {
    nombre,
    procedenciaNombre,
    pais,
    interes,
    interesPropuesto,
    senales,
    esCliente,
    ventasCount,
    errores,
  };
}

/**
 * Escanea el hilo en busca del origen (campaña de anuncio o formulario)
 * y lo traduce a una familia de curso usando el diccionario de alias.
 */
function resolverInteresPropuesto(
  hilo: Record<string, unknown>[],
  aliases: AliasCurso[],
): string | null {
  if (aliases.length === 0) return null;

  // Buscar el mensaje con origen (campaña de Click-to-WhatsApp)
  for (const msg of hilo) {
    const origen = msg.origen as
      | { fuente?: string; titulo?: string; adId?: string }
      | undefined
      | null;
    if (!origen) continue;

    // Intentar matchear por anuncio (adId) primero — lo afirmado gana
    const porAnuncio = familiaDeAnuncio(aliases, {
      adId: origen.adId,
      titulo: origen.titulo,
    });
    if (porAnuncio) return porAnuncio.nombreCurso;

    // Después por texto del título
    if (origen.titulo) {
      const porTexto = familiaDeTexto(aliases, origen.titulo);
      if (porTexto) return porTexto.nombreCurso;
    }
  }

  return null;
}

/**
 * Construye el bloque de contacto para el prompt del bot.
 * Usa la misma función `armarContextoContacto` de prompt.ts.
 */
export function aBloqueDePrompt(ctx: ContextoContacto): string {
  return armarContextoContacto({
    nombre: ctx.nombre ?? undefined,
    procedenciaNombre: ctx.procedenciaNombre ?? undefined,
    interes: ctx.interes ?? ctx.interesPropuesto ?? undefined,
    senales: ctx.senales.length > 0 ? ctx.senales : undefined,
  });
}

function extraerTelefono(clave: string): string | null {
  const partes = clave.split(":");
  return partes.length >= 3 ? partes[2] ?? null : null;
}
