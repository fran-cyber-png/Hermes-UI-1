import { Router } from "express";
import { db } from "../db/client.js";
import { requiereVendedora } from "../auth/sesion.js";
import { buscarProductos } from "../cerberus/productos.js";
import { CATALOGO_EVENTOS, TIPOS_EVENTO, TOPE_CURSO, TOPE_NOTA, validarEvento } from "../eventos/catalogo.js";
import {
  archivarEvento,
  consultarEventos,
  editarEvento,
  registrarEvento,
} from "../eventos/registrarEvento.js";

/**
 * EVENTOS DEL CONTACTO — lo que la vendedora escuchó, en el timeline.
 *
 * Router chico, como `notas.ts`: acá se decodifica el HTTP (status, body) y se
 * le pasa el `db` singleton al seam. El vocabulario vive en
 * `eventos/catalogo.ts` (puro) y las reglas en `eventos/registrarEvento.ts`
 * (con `db` inyectado, ADR 0008).
 *
 * El `vendedoraId` SIEMPRE sale del token, nunca del body: nadie registra un
 * evento en nombre de otra — que es todo el punto de un timeline firmado.
 */
export const eventosRouter = Router();
eventosRouter.use(requiereVendedora);

/**
 * EL VOCABULARIO COMO DATO.
 *
 * Se DERIVA de `CATALOGO_EVENTOS` en cada request — nada de un JSON que alguien
 * se tiene que acordar de actualizar (misma decisión que
 * `/api/catalogo/vocabulario`). El front lleva su copia para poder pintar el
 * popover sin un request de ida y vuelta, y un test de paridad las cruza; esto
 * es lo que hace que esa copia sea verificable en vez de una promesa.
 */
eventosRouter.get("/vocabulario", (_req, res) => {
  res.json({
    tipos: TIPOS_EVENTO.map((id) => ({ id, ...CATALOGO_EVENTOS[id] })),
    topes: { nota: TOPE_NOTA, curso: TOPE_CURSO },
  });
});

/** Los eventos vivos de una conversación — de TODO el equipo, con su autora. */
eventosRouter.get("/", async (req, res) => {
  const clave = String(req.query.clave ?? "").trim();
  if (!clave) {
    res.status(400).json({ ok: false, message: "falta la conversación" });
    return;
  }
  res.json({ eventos: await consultarEventos(db, clave) });
});

/**
 * Registrar un evento.
 *
 * Un `pregunto_curso` **también asienta el interés** (ver el porqué en el seam),
 * y la respuesta lo dice con `interesAsentado` + `motivoInteres`: la UI tiene
 * que poder decir «anotado, pero sin precio» en vez de fingir que quedó
 * cotizable — la misma honestidad que `POST /api/gestiones/intereses`.
 */
eventosRouter.post("/", async (req, res) => {
  const clave = String(req.body?.clave ?? "").trim();
  if (!clave) {
    res.status(400).json({ ok: false, message: "falta la conversación" });
    return;
  }

  const v = validarEvento(req.body ?? {});
  if (!v.ok) {
    res.status(400).json({ ok: false, message: v.message });
    return;
  }

  const r = await registrarEvento(db, {
    clave,
    vendedoraId: req.vendedoraId!,
    evento: v.evento,
    catalogo: () => buscarProductos(),
  });
  res.json({ ok: true, ...r });
});

/**
 * Corregir el comentario (y el curso, si el evento ya tenía uno). El `tipo` no
 * se edita — está en el seam por qué.
 *
 * **409 y no 403** cuando el evento es de otra: no es una falla de permisos del
 * perímetro (el token es válido y la conversación es del equipo), es que esa
 * fila tiene dueña. El mensaje la nombra, para poder ir a pedirle que lo corrija.
 */
eventosRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, message: "id inválido" });
    return;
  }

  const nota = String(req.body?.nota ?? "").trim().slice(0, TOPE_NOTA) || null;
  const curso = String(req.body?.curso ?? "").trim().slice(0, TOPE_CURSO) || null;

  const r = await editarEvento(db, { id, vendedoraId: req.vendedoraId!, nota, curso });
  if (!r.ok) {
    res.status(r.codigo === "no_existe" ? 404 : 409).json(r);
    return;
  }
  res.json({ ok: true, evento: r.evento });
});

/** Borrar = archivar. No hay DELETE físico (ver el seam). */
eventosRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, message: "id inválido" });
    return;
  }

  const r = await archivarEvento(db, { id, vendedoraId: req.vendedoraId! });
  if (!r.ok) {
    res.status(r.codigo === "no_existe" ? 404 : 409).json(r);
    return;
  }
  res.json({ ok: true, evento: r.evento });
});
