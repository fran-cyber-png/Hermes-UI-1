import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { obtenerNumero } from "../numeros/repositorio.js";
import { destinosPosibles, esDestinoValido } from "../reparto/destino.js";
import { vendedorasDeLaRueda } from "../reparto/asignar.js";
import {
  campanasDeWhatsapp,
  clienteDeEntorno,
  cuentasDePauta,
  resolverAnuncios,
} from "../routing/meta.js";
import {
  VENTANA_DIAS,
  anunciosVistos,
  fotoDeRouting,
  guardarAnuncios,
  mapaDeAnuncios,
  guardarCampanas,
  ponerCables,
  cursosDeFormulario,
  ponerCablesDeCurso,
  cablearProducto,
  anunciosDeCampana,
} from "../routing/repositorio.js";
import { lineaDeCloudApi } from "../routing/linea.js";
import { esTablaAusente } from "../cola/estadoSql.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { ruta } from "../lib/ruta.js";
import { nombreDeProducto } from "../routing/producto.js";
import {
  corregirProductoDePieza,
  familiasElegibles,
  type TipoDePieza,
} from "../routing/productoDePieza.js";
import { buscarProductos } from "../cerberus/productos.js";
import { aliasesActivos } from "../cursos/repositorio.js";

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
routingRouter.get("/", ruta(async (_req, res) => {
  const linea = lineaDeCloudApi();
  if (!linea) return sinLinea(res);

  try {
    const [foto, enLaRueda, numero, cursos] = await Promise.all([
      fotoDeRouting(db, linea),
      vendedorasDeLaRueda(db, linea).catch(() => [] as string[]),
      obtenerNumero(db, linea).catch(() => null),
      // Los formularios de icarus no dependen de la línea —no entraron por
      // ninguna— así que si su tabla falta, el resto de la pantalla sigue.
      cursosDeFormulario(db).catch(() => []),
    ]);

    /**
     * EL CATÁLOGO DE PRODUCTOS lo arma el SERVER y no el navegador, por lo de
     * siempre: el nombre lindo de un producto sale de una regla
     * (`nombreDeProducto`) y con dos implementaciones la pantalla mostraría un
     * nombre y el acuse de la acción masiva otro.
     */
    const aliases = await aliasesActivos(db).catch(() => []);
    const familias = new Set(
      [...foto.campanas, ...cursos].map((x) => x.familia).filter((f): f is string => Boolean(f)),
    );
    const productos = [...familias]
      .map((familia) => ({
        familia,
        nombre: nombreDeProducto(
          familia,
          cursos.filter((c) => c.familia === familia).map((c) => ({ curso: c.curso, leads: c.leads })),
          aliases,
        ),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    res.json({
      linea,
      etiqueta: numero?.etiqueta ?? null,
      ventanaDias: VENTANA_DIAS,
      cursos,
      productos,
      ...foto,
      destinos: destinosPosibles({ rueda: enLaRueda, mapa: numero?.vendedoras ?? [] }),
    });
  } catch (e) {
    console.error(`GET /api/routing falló — ${porQueFallo(e)}`);
    res.status(500).json({ ok: false, message: "No se pudo completar la operación." });
  }
}));

const cablesSchema = z.object({
  /** El conjunto COMPLETO de conectadas. `[]` corta todos los cables. */
  vendedoras: z.array(z.string().min(1)).max(20),
});

/**
 * DEJAR LOS CABLES DE UNA CAMPAÑA COMO DICE LA PANTALLA.
 *
 * `PUT` y declarativo: viaja el conjunto entero, no un cable. Con
 * `connect`/`disconnect` por cable, dos personas editando la misma campaña se
 * pisan sin enterarse — la última cree que sumó uno y en realidad borró el de la
 * otra. Mandando el conjunto, lo guardado es lo que se veía.
 *
 * **Cada destino se VERIFICA** contra los mismos `destinosPosibles` del reparto:
 * un dedazo en el username de Cerberus escribiría un cable válido y **todos los
 * leads de esa campaña le caerían a alguien que no existe** — peor que el
 * round-robin, que al menos les encontraba dueño. El 409 enumera a quién sí.
 */
routingRouter.put("/campanas/:campanaId", ruta(async (req, res) => {
  const linea = lineaDeCloudApi();
  if (!linea) return sinLinea(res);

  const campanaId = String(req.params.campanaId ?? "").trim();
  if (!campanaId) {
    res.status(400).json({ ok: false, message: "falta la campaña" });
    return;
  }
  const parsed = cablesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: "se espera `vendedoras` (un arreglo, `[]` para cortar todos)" });
    return;
  }
  const pedidas = [...new Set(parsed.data.vendedoras.map((v) => v.trim()).filter(Boolean))];

  try {
    if (pedidas.length > 0) {
      const [enLaRueda, numero] = await Promise.all([
        vendedorasDeLaRueda(db, linea),
        obtenerNumero(db, linea).catch(() => null),
      ]);
      const destinos = destinosPosibles({ rueda: enLaRueda, mapa: numero?.vendedoras ?? [] });
      const desconocidas = pedidas.filter((v) => !esDestinoValido(v, destinos));
      if (desconocidas.length > 0) {
        res.status(409).json({
          ok: false,
          motivo: "vendedora_desconocida",
          message:
            `${desconocidas.map((d) => `«${d}»`).join(", ")} no participa de la línea ${linea}. ` +
            (destinos.length
              ? `Se le puede dar a: ${destinos.join(", ")}.`
              : "Esa línea todavía no tiene a nadie en el reparto (`npm run reparto:rueda`)."),
          destinos,
        });
        return;
      }
    }

    await ponerCables(db, linea, campanaId, pedidas, req.vendedoraId ?? "");
    res.json({ ok: true, campanaId, vendedoras: pedidas });
  } catch (e) {
    console.error(`PUT /api/routing/campanas/${campanaId} falló — ${porQueFallo(e)}`);
    res.status(500).json({ ok: false, message: "No se pudo completar la operación." });
  }
}));

/**
 * DEJAR LOS CABLES DE UN CURSO DE FORMULARIO.
 *
 * ⚠️ **El curso va en el body y no en la ruta**: son nombres de producto con
 * espacios, tildes y `&` («Diploma técnico en Osint & Socmint»), y meterlos en el
 * path los deja a merced de cada proxy que normalice la URL por su cuenta.
 *
 * Mismo contrato declarativo y la misma verificación de destino que las
 * campañas: un dedazo mandaría todos los leads de ese curso a alguien que no
 * existe, y ahí no hay round-robin que los rescate.
 */
routingRouter.put("/cursos", ruta(async (req, res) => {
  const parsed = z
    .object({ curso: z.string().min(1), vendedoras: z.array(z.string().min(1)).max(20) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: "se espera `curso` y `vendedoras`" });
    return;
  }
  const curso = parsed.data.curso.trim();
  const pedidas = [...new Set(parsed.data.vendedoras.map((v) => v.trim()).filter(Boolean))];
  const linea = lineaDeCloudApi();

  try {
    if (pedidas.length > 0) {
      const [enLaRueda, numero] = await Promise.all([
        linea ? vendedorasDeLaRueda(db, linea) : Promise.resolve([] as string[]),
        linea ? obtenerNumero(db, linea).catch(() => null) : Promise.resolve(null),
      ]);
      const destinos = destinosPosibles({ rueda: enLaRueda, mapa: numero?.vendedoras ?? [] });
      const desconocidas = pedidas.filter((v) => !esDestinoValido(v, destinos));
      if (desconocidas.length > 0) {
        res.status(409).json({
          ok: false,
          motivo: "vendedora_desconocida",
          message:
            `${desconocidas.map((d) => `«${d}»`).join(", ")} no participa del reparto. ` +
            (destinos.length ? `Se le puede dar a: ${destinos.join(", ")}.` : ""),
          destinos,
        });
        return;
      }
    }
    await ponerCablesDeCurso(db, curso, pedidas, req.vendedoraId ?? "");
    res.json({ ok: true, curso, vendedoras: pedidas });
  } catch (e) {
    console.error(`PUT /api/routing/cursos («${curso}») falló — ${porQueFallo(e)}`);
    res.status(500).json({ ok: false, message: "No se pudo completar la operación." });
  }
}));

/**
 * LOS ANUNCIOS DE UNA CAMPAÑA — el nivel de adentro del lienzo.
 *
 * 🔴 **Solo lectura, y no hay un `PUT` gemelo a propósito**: el reparto resuelve
 * `ad_id → campaña → vendedoras` y no existe una regla por anuncio. Sirve para
 * entender de dónde vino el volumen, no para cambiarlo.
 */
routingRouter.get("/campanas/:campanaId/anuncios", ruta(async (req, res) => {
  const campanaId = String(req.params.campanaId ?? "").trim();
  if (!campanaId) {
    res.status(400).json({ ok: false, message: "falta la campaña" });
    return;
  }
  try {
    res.json({ anuncios: await anunciosDeCampana(db, campanaId) });
  } catch (e) {
    console.error(`GET /api/routing/campanas/${campanaId}/anuncios falló — ${porQueFallo(e)}`);
    res.status(500).json({ ok: false, message: "No se pudo completar la operación." });
  }
}));

/**
 * CABLEAR UN PRODUCTO ENTERO — la acción masiva.
 *
 * 🔴 **Escribe el cable en cada campaña y cada formulario del producto; NO crea
 * una regla que los demás hereden.** Decisión del dueño del 12-ago-2026, y es lo
 * que hace que la cola no tenga que cambiar una línea: sigue leyendo
 * `campana_ruteo` y `curso_ruteo`, sin precedencias que resolver.
 *
 * ⚠️ **Pisa lo que había**, incluida una campaña que tuviera otro cable. Por eso
 * la pantalla nombra ANTES qué va a pisar: una acción masiva silenciosa es la
 * forma más rápida de que alguien pierda una regla que puso a mano.
 *
 * ⚠️ Y por eso mismo la respuesta dice **qué tocó**: sin eso, «listo» sobre 5
 * renglones es indistinguible de «listo» sobre 0 (el caso de un producto cuyas
 * campañas dejaron de mandar a esta línea).
 */
routingRouter.put("/productos", ruta(async (req, res) => {
  const parsed = z
    .object({
      familia: z.string().min(1),
      vendedoras: z.array(z.string().min(1)).max(20),
      // El default es el de la pantalla vieja (el botón masivo). Ver `ModoDeCableado`.
      modo: z.enum(["reemplazar", "agregar", "quitar"]).default("reemplazar"),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: "se espera `familia` y `vendedoras`" });
    return;
  }
  const familia = parsed.data.familia.trim();
  const pedidas = [...new Set(parsed.data.vendedoras.map((v) => v.trim()).filter(Boolean))];
  const linea = lineaDeCloudApi();

  try {
    if (pedidas.length > 0) {
      const [enLaRueda, numero] = await Promise.all([
        linea ? vendedorasDeLaRueda(db, linea) : Promise.resolve([] as string[]),
        linea ? obtenerNumero(db, linea).catch(() => null) : Promise.resolve(null),
      ]);
      const destinos = destinosPosibles({ rueda: enLaRueda, mapa: numero?.vendedoras ?? [] });
      const desconocidas = pedidas.filter((v) => !esDestinoValido(v, destinos));
      if (desconocidas.length > 0) {
        res.status(409).json({
          ok: false,
          motivo: "vendedora_desconocida",
          message:
            `${desconocidas.map((d) => `«${d}»`).join(", ")} no participa del reparto. ` +
            (destinos.length ? `Se le puede dar a: ${destinos.join(", ")}.` : ""),
          destinos,
        });
        return;
      }
    }

    const tocados = await cablearProducto(
      db,
      linea,
      familia,
      pedidas,
      req.vendedoraId ?? "",
      parsed.data.modo,
    );
    res.json({ ok: true, familia, vendedoras: pedidas, modo: parsed.data.modo, ...tocados });
  } catch (e) {
    console.error(`PUT /api/routing/productos («${familia}») falló — ${porQueFallo(e)}`);
    res.status(500).json({ ok: false, message: "No se pudo completar la operación." });
  }
}));

/**
 * A QUÉ PRODUCTOS SE PUEDE MANDAR UNA PIEZA.
 *
 * Va aparte del GET principal **porque pregunta a Cerberus**, y esa llamada no
 * puede colgarse de la pantalla que hay que abrir justo cuando algo anda mal
 * (el mismo argumento por el que refrescar es un POST). Se pide al abrir la
 * hoja de la derecha, que es cuando alguien va a elegir.
 */
routingRouter.get("/productos-elegibles", ruta(async (_req, res) => {
  try {
    const r = await familiasElegibles(db, () => buscarProductos());
    res.json(r);
  } catch (e) {
    console.error(`GET /api/routing/productos-elegibles falló — ${porQueFallo(e)}`);
    res.status(500).json({ ok: false, message: "No se pudo completar la operación." });
  }
}));

/**
 * CORREGIR A QUÉ PRODUCTO PERTENECE UNA PIEZA — «esta campaña va con otro».
 *
 * 🔴 **Escribe en `alias_curso`, así que CORRIGE EN TODAS LAS PANTALLAS**: el
 * chip de curso de la cola, el Dashboard y el bot leen ese mismo diccionario.
 * Decisión del dueño del 18-ago-2026 — la alternativa era una tabla propia de
 * Routing, y con eso la cola seguiría mostrando el producto viejo (#37). Ver
 * `routing/productoDePieza.ts`.
 *
 * ⚠️ **La clave viaja, el TEXTO no.** El server lo resuelve de la base: el alias
 * se guarda por texto exacto normalizado, así que un carácter de diferencia
 * escribe una fila que no matchea la pieza y la corrección se ve aplicada sin
 * estarlo.
 *
 * `familia: null` deshace y la pieza vuelve a resolverse sola.
 */
routingRouter.put("/pieza-producto", ruta(async (req, res) => {
  const parsed = z
    .object({
      tipo: z.enum(["campana", "curso"]),
      clave: z.string().min(1),
      familia: z.string().min(1).nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "se espera `tipo` (campana|curso), `clave` y `familia` (o `null` para deshacer)",
    });
    return;
  }

  try {
    const r = await corregirProductoDePieza(db, {
      tipo: parsed.data.tipo as TipoDePieza,
      clave: parsed.data.clave,
      familia: parsed.data.familia,
      quien: req.vendedoraId ?? "",
      catalogo: () => buscarProductos(),
    });
    if (!r.ok) {
      /**
       * ⚠️ **Tres códigos, tres estados HTTP distintos.** `catalogo_caido` es un
       * 503 y no un 409: lo que falló es Cerberus, y quien lo lea tiene que
       * volver a intentar, no cambiar lo que pidió.
       */
      const estado =
        r.codigo === "pieza_desconocida" ? 404 : r.codigo === "catalogo_caido" ? 503 : 409;
      res.status(estado).json(r);
      return;
    }
    res.json(r);
  } catch (e) {
    console.error(`PUT /api/routing/pieza-producto falló — ${porQueFallo(e)}`);
    res.status(500).json({ ok: false, message: "No se pudo completar la operación." });
  }
}));

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
routingRouter.post("/refrescar", ruta(async (req, res) => {
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

    /**
     * 🔴 PRIMERO EL CATÁLOGO DE CAMPAÑAS, Y ES LO QUE HACE ÚTIL LA PANTALLA.
     * Sin esto la lista solo puede mostrar campañas que YA trajeron gente, y el
     * momento en que querés dejar el cable puesto es justamente antes del primer
     * lead. Trae también a qué número manda cada una, que es lo que permite
     * ofrecer solo las que esta línea puede recibir.
     */
    const cuentas = await cuentasDePauta([...vistos.map((v) => v.adId), ...mapa.keys()], cliente);
    let campanas = 0;
    for (const cuenta of cuentas) {
      campanas += await guardarCampanas(db, await campanasDeWhatsapp(cuenta, cliente));
    }

    // Y después los anuncios nuevos: el webhook resuelve `ad_id → campaña`
    // contra esta tabla, así que sin ella un lead cae a la rueda aunque su
    // campaña tenga cables.
    const pedir = vistos.map((v) => v.adId).filter((ad) => todo || !mapa.has(ad));
    if (pedir.length === 0) {
      res.json({ ok: true, campanas, preguntados: 0, resueltos: 0, fallaron: [] });
      return;
    }

    const { resueltos, fallaron } = await resolverAnuncios(pedir, cliente);
    const guardados = await guardarAnuncios(db, resueltos);
    res.json({ ok: true, campanas, preguntados: pedir.length, resueltos: guardados, fallaron });
  } catch (e) {
    /**
     * ⚠️ **Un fallo de la BASE no es «Meta no contestó».** Con la migración sin
     * aplicar, el borrador mostraba «meta_no_contesto» y mandaba a revisar el
     * token, el permiso de la app y la cuenta de pauta — todo sano. Cada causa
     * con su nombre.
     */
    if (esTablaAusente(e)) {
      res.status(503).json({
        ok: false,
        motivo: "ruteo_no_migrado",
        message: "faltan las tablas del ruteo: no hay dónde guardar lo que conteste Meta",
      });
      return;
    }
    console.error(`POST /api/routing/refrescar falló — ${porQueFallo(e)}`);
    res.status(502).json({
      ok: false,
      motivo: "meta_no_contesto",
      message: "No se pudo completar la operación.",
    });
  }
}));
