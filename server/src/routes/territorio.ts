import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { ruta } from "../lib/ruta.js";
import { lineasDeVendedoraConProposito } from "../numeros/repositorio.js";
import { PROPOSITO_CAMPANA } from "../numeros/campana.js";
import { distritoAjeno } from "../territorio/dominio.js";
import {
  anotarTerritorio,
  borrarTerritorio,
  catalogoDe,
  conteoPorDistrito,
  territorioDe,
} from "../territorio/repositorio.js";

/**
 * EL TERRITORIO — LA PRIMERA SUPERFICIE DE `campana` DEL REPO (ADR 0063).
 *
 * ══ POR QUÉ ESTA RUTA EXISTE Y NO ES UN CAMPO MÁS DE LA FICHA ══════════════
 *
 * Un CRM de ventas no necesita saber dónde vota nadie; una campaña no puede
 * trabajar sin eso. Es el ejemplo de que los dos módulos **no son el mismo
 * producto con otro vocabulario**: acá hay un dato, una tabla y una pregunta
 * («¿cuántos comprometidos tengo en San Juan de Lurigancho?») que del lado de
 * ventas no existen.
 *
 * ══ 🔴 SE MONTA CON `deCampana`, Y ESO ESTRENA EL CANDADO SIMÉTRICO ═════════
 *
 * Hasta acá el middleware sólo se usaba en un sentido (negarle a la campaña las
 * superficies de la Escuela). Ésta es la primera del otro lado: una vendedora de
 * la Escuela come **403** — no porque el dato sea secreto, sino porque un
 * distrito electoral no significa nada en su embudo y ofrecerlo sería sumarle
 * ruido a la única pantalla donde decide a quién le escribe.
 *
 * ══ EL CATÁLOGO SE ACOTA A SU LÍNEA, Y ESO ES LA FRONTERA ══════════════════
 *
 * 🔴 **La línea sale de `numero_vendedora`, NUNCA del query string.** Con un
 * `?linea=` cualquier operador de campaña leería el catálogo —y los conteos— de
 * otra candidatura, que es exactamente lo que ADR 0063 fase 3 viene a impedir
 * entre rivales. Acá se cierra por construcción antes de que el problema exista.
 *
 * ⚠️ **El catálogo NO se edita desde la app**: se carga con
 * `npm run territorio:distritos`, igual que la rueda del reparto y los roles.
 * Qué distritos tiene una candidatura es una decisión de quien la maneja, no una
 * acción de la mesa de trabajo — y meterla acá la dejaría a un clic de cualquier
 * token.
 */
export const territorioRouter = Router();

/** La línea de campaña de quien pide. `null` = no tiene ninguna. */
async function miLineaDeCampana(vendedoraId: string | undefined): Promise<string | null> {
  if (!vendedoraId) return null;
  const lineas = await lineasDeVendedoraConProposito(db, vendedoraId);
  return lineas.find((l) => l.proposito === PROPOSITO_CAMPANA)?.numero ?? null;
}

/**
 * EL CATÁLOGO Y LOS CONTEOS, más —si se pide una `?clave=`— dónde vota ESA
 * conversación. Todo en una respuesta: el panel las necesita juntas y separarlo
 * serían dos requests por cada ficha que se abre.
 */
territorioRouter.get("/", ruta(async (req, res) => {
  const linea = await miLineaDeCampana(req.vendedoraId);
  /**
   * ⚠️ **Sin línea de campaña se sirve un catálogo VACÍO, no un 403.** El 403 ya
   * lo dio el candado de módulo si la persona es de ventas; llegar acá sin línea
   * es una operadora de campaña a la que todavía no le asignaron su número, y
   * ahí la respuesta honesta es «no hay distritos», no «no tenés permiso».
   */
  if (!linea) {
    res.json({ ok: true, distritos: [], conteos: {}, sinLinea: true });
    return;
  }
  const clave = typeof req.query.clave === "string" ? req.query.clave.trim() : "";
  const [distritos, conteos, actual] = await Promise.all([
    catalogoDe(db, linea),
    conteoPorDistrito(db, linea),
    clave ? territorioDe(db, clave) : Promise.resolve(null),
  ]);
  res.json({
    ok: true,
    distritos,
    conteos: Object.fromEntries(conteos.map((c) => [c.distritoId, c.n])),
    ...(clave ? { actual } : {}),
    // Sin la migración el catálogo viene vacío y hay que poder DECIRLO, en vez
    // de dibujar «todavía no cargaste distritos» sobre una tabla que no existe.
    ...(distritos.length === 0 ? { sinCatalogo: true } : {}),
  });
}));

const CuerpoAnotar = z.object({ distritoId: z.number().int().positive() });

/**
 * ANOTAR DÓNDE VOTA. **Reemplaza**: una persona vota en un lugar.
 *
 * 🔴 **El destino se VERIFICA contra el catálogo propio** (`distritoAjeno`), y
 * es la misma lección de `reparto/destino.ts`: un `distritoId` de otra campaña
 * es un número válido, escribe una fila válida y **nadie se entera** — la
 * persona quedaría anotada en un distrito que su propia pantalla no muestra, y
 * del otro lado engordaría un conteo ajeno. Hoy hay una sola campaña y esto no
 * puede pasar; se escribe igual porque el día que haya dos, la puerta ya está
 * cerrada.
 */
territorioRouter.put("/:clave", ruta(async (req, res) => {
  const clave = decodeURIComponent(req.params.clave ?? "").trim();
  if (!clave) {
    res.status(400).json({ ok: false, message: "falta la conversación" });
    return;
  }
  const cuerpo = CuerpoAnotar.safeParse(req.body);
  if (!cuerpo.success) {
    res.status(400).json({ ok: false, message: "se espera { distritoId: number }" });
    return;
  }
  const linea = await miLineaDeCampana(req.vendedoraId);
  if (!linea) {
    res.status(409).json({ ok: false, motivo: "sin_linea", message: "no tenés línea de campaña" });
    return;
  }
  const catalogo = await catalogoDe(db, linea);
  if (distritoAjeno(cuerpo.data.distritoId, catalogo)) {
    // Enumerando a quién SÍ, como el 409 del reparto: un rechazo que no dice las
    // opciones deja a la operadora probando números.
    res.status(409).json({
      ok: false,
      motivo: "distrito_desconocido",
      message: "ese distrito no está en tu catálogo",
      distritos: catalogo.map((d) => ({ id: d.id, nombre: d.nombre })),
    });
    return;
  }
  try {
    await anotarTerritorio(db, {
      clave,
      distritoId: cuerpo.data.distritoId,
      anotadoPor: req.vendedoraId ?? "",
    });
  } catch (e) {
    // Escribir NO degrada: un «guardado» que no guardó es peor que un error,
    // porque la operadora sigue caminando y da el dato por tomado.
    console.error(`[territorio] no se pudo anotar «${clave}» — ${porQueFallo(e)}`);
    res.status(503).json({ ok: false, message: "no se pudo guardar el distrito" });
    return;
  }
  res.json({ ok: true });
}));

/** Sacar el territorio: se anotó mal, o la persona se mudó. */
territorioRouter.delete("/:clave", ruta(async (req, res) => {
  const clave = decodeURIComponent(req.params.clave ?? "").trim();
  if (!clave) {
    res.status(400).json({ ok: false, message: "falta la conversación" });
    return;
  }
  try {
    await borrarTerritorio(db, clave);
  } catch (e) {
    console.error(`[territorio] no se pudo borrar «${clave}» — ${porQueFallo(e)}`);
    res.status(503).json({ ok: false, message: "no se pudo sacar el distrito" });
    return;
  }
  res.json({ ok: true });
}));
