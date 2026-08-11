import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { obtenerNumero } from "../numeros/repositorio.js";
import { destinosPosibles, esDestinoValido } from "../reparto/destino.js";
import { vendedorasDeLaRueda } from "../reparto/asignar.js";
import { clienteDeEntorno, resolverAnuncios } from "../routing/meta.js";
import {
  VENTANA_DIAS,
  anunciosVistos,
  fotoDeRouting,
  guardarAnuncios,
  mapaDeAnuncios,
  ponerRegla,
  sacarRegla,
} from "../routing/repositorio.js";
import { lineaDeCloudApi } from "../routing/linea.js";

/**
 * ROUTING — qué campaña de Meta cae en qué vendedora.
 *
 * Detrás de `requiereVendedora`, como el reparto: lo usa una PERSONA desde la
 * app. Y como el reparto, **es un filtro y no un permiso**: decide a quién le
 * aparece primero un lead nuevo, no quién puede abrir el chat. Lo que sí hay es
 * rastro (`asignada_por`).
 *
 * ⚠️ **Solo tiene sentido sobre la línea de Cloud API**, y no porque se haya
 * elegido así: el `referral` con el `source_id` del anuncio lo manda META, y
 * solo llega por su webhook. Las tres líneas de las vendedoras son whatsmeow y
 * ahí no existe el dato — un mensaje que entra por ellas no dice de qué campaña
 * vino, así que ofrecer la pantalla para esas líneas sería ofrecer una decisión
 * que no se puede tomar.
 */
export const routingRouter = Router();

/**
 * Sin línea de Cloud API no hay pantalla, y se DICE cuál es el motivo.
 *
 * Devolver una lista vacía haría ver «no hay campañas» —que se lee como «la
 * pauta no está trayendo a nadie», una afirmación sobre el NEGOCIO— cuando lo
 * que pasa es que Hermes no tiene la línea levantada. Son dos hechos opuestos y
 * en pantalla se verían igual.
 */
function sinLinea(res: Parameters<Parameters<typeof routingRouter.get>[1]>[1]) {
  res.status(503).json({
    ok: false,
    motivo: "sin_linea_cloud_api",
    message:
      "esta instalación no tiene línea de Cloud API (`WHATSAPP_CLOUD_API_NUMERO_PROPIO`): " +
      "el ruteo por campaña necesita el referral del anuncio, y eso solo lo manda Meta por su webhook",
  });
}

/**
 * LA FOTO: las campañas que trajeron gente a esta línea, con a quién le caen.
 *
 * `destinos` viaja acá y no en otra llamada porque son la misma decisión: elegir
 * a quién le cae una campaña sin la lista de a quién SE PUEDE es adivinar, y una
 * pantalla que ofrece un nombre que el server después rechaza con 409 es peor
 * que no ofrecerlo.
 */
routingRouter.get("/", async (_req, res) => {
  const linea = lineaDeCloudApi();
  if (!linea) return sinLinea(res);

  try {
    const [foto, enLaRueda, numero] = await Promise.all([
      fotoDeRouting(db, linea),
      vendedorasDeLaRueda(db, linea).catch(() => [] as string[]),
      obtenerNumero(db, linea).catch(() => null),
    ]);
    res.json({
      linea,
      etiqueta: numero?.etiqueta ?? null,
      ventanaDias: VENTANA_DIAS,
      ...foto,
      destinos: destinosPosibles({ rueda: enLaRueda, mapa: numero?.vendedoras ?? [] }),
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: (e as Error).message });
  }
});

const reglaSchema = z.object({
  /** `null` saca la regla: la campaña vuelve a repartirse por la rueda. */
  vendedoraId: z.string().min(1).nullable(),
});

/**
 * PONER (o sacar) LA REGLA DE UNA CAMPAÑA.
 *
 * `PUT` y no `POST` por lo mismo que la asignación del reparto: es declarativo e
 * idempotente («el dueño de esta campaña es X»). Mandarlo dos veces deja lo mismo.
 *
 * El destino se VERIFICA contra los mismos `destinosPosibles` del reparto y un
 * desconocido es **409 enumerando a quién sí se puede**. Sin esa guarda, un
 * dedazo en el username de Cerberus escribe una regla válida y **todos los leads
 * de esa campaña le caen a alguien que no existe** — que es peor que el problema
 * original, porque hasta el round-robin le encontraba dueño.
 */
routingRouter.put("/campanas/:campanaId", async (req, res) => {
  const linea = lineaDeCloudApi();
  if (!linea) return sinLinea(res);

  const campanaId = String(req.params.campanaId ?? "").trim();
  if (!campanaId) {
    res.status(400).json({ ok: false, message: "falta la campaña" });
    return;
  }
  const parsed = reglaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: "se espera `vendedoraId` (o `null` para sacarla)" });
    return;
  }
  const { vendedoraId } = parsed.data;

  try {
    if (vendedoraId === null) {
      const habia = await sacarRegla(db, linea, campanaId);
      res.json({ ok: true, campanaId, vendedoraId: null, habia });
      return;
    }

    const [enLaRueda, numero] = await Promise.all([
      vendedorasDeLaRueda(db, linea),
      obtenerNumero(db, linea).catch(() => null),
    ]);
    const destinos = destinosPosibles({ rueda: enLaRueda, mapa: numero?.vendedoras ?? [] });
    if (!esDestinoValido(vendedoraId, destinos)) {
      res.status(409).json({
        ok: false,
        motivo: "vendedora_desconocida",
        message:
          `«${vendedoraId}» no participa de la línea ${linea}. ` +
          (destinos.length
            ? `Se le puede dar a: ${destinos.join(", ")}.`
            : "Esa línea todavía no tiene a nadie en el reparto (`npm run reparto:rueda`)."),
        destinos,
      });
      return;
    }

    await ponerRegla(db, linea, campanaId, vendedoraId, req.vendedoraId ?? "");
    res.json({ ok: true, campanaId, vendedoraId });
  } catch (e) {
    res.status(500).json({ ok: false, message: (e as Error).message });
  }
});

/**
 * PREGUNTARLE A META DE QUÉ CAMPAÑA ES CADA ANUNCIO NUEVO.
 *
 * ⚠️ **Es un POST y va aparte del GET a propósito.** Escribir adentro de una
 * lectura haría que mirar la pantalla cambie el estado y que la pantalla tarde
 * lo que tarde Meta — y el día que la Graph API esté lenta, Routing no abriría.
 * Acá el que espera es alguien que apretó un botón sabiendo qué pidió.
 *
 * Solo se preguntan los anuncios que **trajeron gente y todavía no están
 * resueltos**: los ya conocidos no se vuelven a pedir, salvo `?todo=1`, que es
 * lo que refresca el ESTADO (una campaña que se pausó ayer sigue diciendo
 * «activa» hasta que alguien vuelva a preguntar).
 */
routingRouter.post("/refrescar", async (req, res) => {
  const linea = lineaDeCloudApi();
  if (!linea) return sinLinea(res);

  const cliente = clienteDeEntorno();
  if (!cliente) {
    res.status(503).json({
      ok: false,
      motivo: "falta_config",
      message: "falta META_ACCESS_TOKEN: no se le puede preguntar a Meta por las campañas",
    });
    return;
  }

  try {
    const todo = req.query.todo === "1";
    const [vistos, mapa] = await Promise.all([anunciosVistos(db), mapaDeAnuncios(db)]);
    const pedir = vistos.map((v) => v.adId).filter((ad) => todo || !mapa.has(ad));
    if (pedir.length === 0) {
      res.json({ ok: true, preguntados: 0, resueltos: 0, fallaron: [] });
      return;
    }

    const { resueltos, fallaron } = await resolverAnuncios(pedir, cliente);
    const guardados = await guardarAnuncios(db, resueltos);
    res.json({ ok: true, preguntados: pedir.length, resueltos: guardados, fallaron });
  } catch (e) {
    res.status(502).json({ ok: false, motivo: "meta_no_contesto", message: (e as Error).message });
  }
});
