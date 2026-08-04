import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { esTablaAusente } from "../cola/estadoSql.js";
import { normalizarTelefono } from "../whatsapp/identidadWa.js";
import { obtenerNumero } from "../numeros/repositorio.js";
import { comoVaElReparto, reasignar, vendedorasDeLaRueda } from "../reparto/asignar.js";
import { destinosPosibles, esDestinoValido } from "../reparto/destino.js";

/**
 * EL REPARTO, DESDE LA APP — leer quién tiene qué y pasarle una conversación a
 * otra persona.
 *
 * Va detrás de `requiereVendedora` (perímetro, `auth/perimetro.ts`): lo usa una
 * PERSONA desde la app, no Cerberus. La rueda se CARGA por otro lado a propósito
 * —`npm run reparto:rueda`, ver `scripts/repartoRueda.ts`—: quiénes entran al
 * reparto es una decisión de quien maneja el equipo, no una acción de la mesa de
 * trabajo, y meterla acá la dejaría a un clic de cualquier token de vendedora.
 *
 * ⚠️ **Es un filtro, no un permiso** (igual que `cola/lineas.ts` y
 * `cola/asignadaSql.ts`): cualquier vendedora puede pasar cualquier conversación.
 * Hermes no tiene modelo de permisos —`requiereVendedora` dice «es una
 * vendedora», no «cuál»— y fingir uno acá sería una frontera imaginaria. Lo que
 * sí hay es RASTRO: `asignada_por` guarda quién la pasó.
 */
export const repartoRouter = Router();

/** Un `?linea=` que no es un teléfono es un 400, nunca una rueda vacía. */
function lineaDe(crudo: unknown): string | null {
  const texto = typeof crudo === "string" ? crudo.trim() : "";
  if (!texto) return null;
  return normalizarTelefono(texto) || null;
}

/**
 * Sin la migración aplicada NO se inventa una respuesta vacía: se dice.
 *
 * Una rueda vacía y una tabla que no existe se ven idénticas desde la app —las
 * dos son «no hay a quién pasarle»— y significan cosas opuestas: la primera es
 * «todavía no cargaron a nadie», la segunda es «falta desplegar». El chip de la
 * auto-respuesta ya resolvió esto igual: dice «falta la migración» en vez de un
 * estado falso.
 */
function esFaltaDeMigracion(e: unknown): boolean {
  return esTablaAusente(e);
}

/**
 * QUIÉNES PARTICIPAN Y CÓMO VA — lo que la app necesita para ofrecer «pasar a…»
 * y para que cualquiera pueda auditar el reparto sin entrar a la base.
 *
 * `rueda` trae la carga de cada uno: la propiedad que el reparto promete —entre
 * el que más y el que menos nunca hay más de 1— se verifica MIRANDO esto, así que
 * el número viaja siempre, no solo cuando alguien lo pide.
 */
repartoRouter.get("/rueda", async (req, res) => {
  const linea = lineaDe(req.query.linea);
  if (!linea) {
    res.status(400).json({ ok: false, message: "falta `linea` (se espera un teléfono)" });
    return;
  }
  try {
    const [rueda, enLaRueda, numero] = await Promise.all([
      comoVaElReparto(db, linea),
      vendedorasDeLaRueda(db, linea),
      // El mapa de Cerberus: es lo que mete a Luz, que no está en la rueda a
      // propósito y a la que igual hay que poder pasarle una conversación.
      obtenerNumero(db, linea).catch(() => null),
    ]);
    res.json({
      linea,
      rueda,
      destinos: destinosPosibles({ rueda: enLaRueda, mapa: numero?.vendedoras ?? [] }),
    });
  } catch (e) {
    if (esFaltaDeMigracion(e)) {
      res.status(503).json({
        ok: false,
        motivo: "reparto_no_migrado",
        message: "falta la migración del reparto (`conversacion_asignada` / `reparto_rueda`)",
      });
      return;
    }
    res.status(500).json({ ok: false, message: (e as Error).message });
  }
});

const asignacionSchema = z.object({
  clave: z.string().min(1),
  numeroPropio: z.string().min(1),
  vendedoraId: z.string().min(1),
});

/**
 * PASARLE ESTA CONVERSACIÓN A OTRA PERSONA.
 *
 * `PUT` y no `POST` porque es declarativo e idempotente: «el dueño de esta clave
 * es X». Mandarlo dos veces deja lo mismo.
 *
 * El destino se VERIFICA (`reparto/destino.ts`) y un desconocido es **409, no
 * 200**. El `vendedora_id` es el username de Cerberus y Hermes no tiene padrón
 * contra el cual chequearlo: sin esta guarda, un dedazo escribe una fila válida,
 * la conversación desaparece de la cola de todo el mundo y no hay un solo síntoma.
 * El error enumera a quién SÍ se puede — un 409 que no dice la salida obliga a
 * adivinar dos veces.
 */
repartoRouter.put("/asignacion", async (req, res) => {
  const parsed = asignacionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: "asignación inválida (clave, numeroPropio, vendedoraId)" });
    return;
  }
  const { clave, vendedoraId } = parsed.data;
  const numeroPropio = normalizarTelefono(parsed.data.numeroPropio);
  if (!numeroPropio) {
    res.status(400).json({ ok: false, message: `línea inválida (${parsed.data.numeroPropio})` });
    return;
  }

  try {
    const [enLaRueda, numero] = await Promise.all([
      vendedorasDeLaRueda(db, numeroPropio),
      obtenerNumero(db, numeroPropio).catch(() => null),
    ]);
    const destinos = destinosPosibles({ rueda: enLaRueda, mapa: numero?.vendedoras ?? [] });
    if (!esDestinoValido(vendedoraId, destinos)) {
      res.status(409).json({
        ok: false,
        motivo: "vendedora_desconocida",
        message:
          `«${vendedoraId}» no participa de la línea ${numeroPropio}. ` +
          (destinos.length
            ? `Se le puede pasar a: ${destinos.join(", ")}.`
            : "Esa línea todavía no tiene a nadie en el reparto (`npm run reparto:rueda`)."),
        destinos,
      });
      return;
    }

    // `req.vendedoraId` lo puso el perímetro. Va como `asignada_por`: quién la
    // pasó es el único dato que un reparto a mano no puede reconstruir después.
    await reasignar(db, clave, numeroPropio, vendedoraId, req.vendedoraId ?? "");
    res.json({ ok: true, clave, vendedoraId });
  } catch (e) {
    if (esFaltaDeMigracion(e)) {
      res.status(503).json({
        ok: false,
        motivo: "reparto_no_migrado",
        message: "falta la migración del reparto: no se puede pasar la conversación",
      });
      return;
    }
    res.status(500).json({ ok: false, message: (e as Error).message });
  }
});
