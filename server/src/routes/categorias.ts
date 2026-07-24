import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { colorCategoria, normalizarNombre } from '../categorias/paleta.js';
import {
  borrarCategoria,
  crearCategoria,
  editarCategoria,
  listarCategorias,
  CategoriaDuplicada,
} from '../categorias/consultarCategorias.js';

/**
 * EL CATÁLOGO DE CATEGORÍAS — CRUD por vendedora, con color elegible (#48).
 *
 * Nace AUTENTICADO: `requiereVendedora` desde la primera línea. La vendedora
 * sale del token (`req.vendedoraId`), nunca del body — nadie edita el catálogo
 * de otra. La ASIGNACIÓN (qué conversación lleva qué categoría) NO vive acá:
 * sigue en `/api/gestiones/etiquetas`. El color lo resuelve el front uniendo por
 * nombre; esta ruta solo administra el catálogo (nombre, color, favorita, orden).
 */
export const categoriasRouter = Router();
categoriasRouter.use(requiereVendedora);

const crearSchema = z.object({ nombre: z.string(), color: colorCategoria });
const editarSchema = z.object({
  nombre: z.string().optional(),
  color: colorCategoria.optional(),
  esFavorito: z.boolean().optional(),
  orden: z.number().int().optional(),
});

/** El catálogo de la vendedora + el conteo por categoría (para el modo Listas, #49). */
categoriasRouter.get('/', async (req, res) => {
  const categorias = await listarCategorias(db, req.vendedoraId!);
  res.json({ categorias });
});

/** Crear. Valida el color contra la paleta (Zod) y capa el nombre. 409 si ya existe. */
categoriasRouter.post('/', async (req, res) => {
  const parsed = crearSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: 'nombre o color inválido (el color sale de la paleta, sin oro)' });
    return;
  }
  if (!normalizarNombre(parsed.data.nombre)) {
    res.status(400).json({ ok: false, message: 'el nombre no puede estar vacío' });
    return;
  }
  try {
    const categoria = await crearCategoria(db, req.vendedoraId!, parsed.data);
    res.status(201).json({ ok: true, categoria });
  } catch (e) {
    if (e instanceof CategoriaDuplicada) {
      res.status(409).json({ ok: false, message: e.message });
      return;
    }
    throw e;
  }
});

/** Editar SOLO la propia (el seam filtra por `vendedora_id`). 404 si no es suya. */
categoriasRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const parsed = editarSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: 'cambios inválidos (color fuera de la paleta o tipos)' });
    return;
  }
  try {
    const categoria = await editarCategoria(db, req.vendedoraId!, id, parsed.data);
    if (!categoria) {
      res.status(404).json({ ok: false, message: 'esa categoría no existe o no es tuya' });
      return;
    }
    res.json({ ok: true, categoria });
  } catch (e) {
    if (e instanceof CategoriaDuplicada) {
      res.status(409).json({ ok: false, message: e.message });
      return;
    }
    throw e;
  }
});

/** Borrar la entrada del catálogo. Las asignaciones (`etiquetas`) quedan intactas. */
categoriasRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const borro = await borrarCategoria(db, req.vendedoraId!, id);
  if (!borro) {
    res.status(404).json({ ok: false, message: 'esa categoría no existe o no es tuya' });
    return;
  }
  res.json({ ok: true });
});
