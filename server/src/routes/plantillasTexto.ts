import { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { ruta } from '../lib/ruta.js';
import { archivarPlantilla, crearPlantilla, editarPlantilla, listarPlantillas, validarPlantilla } from '../notas/plantillasTexto.js';

/**
 * PLANTILLAS DE TEXTO DE LA LIBRETA — router chico, mismo molde que `notas.ts`:
 * la lógica vive en `notas/plantillasTexto.ts`, acá solo se decodifica el HTTP.
 *
 * `requiereVendedora` nace ACÁ: el `vendedoraId` sale siempre del token, nunca
 * del body — nadie guarda ni borra una plantilla en nombre de otra.
 */
export const plantillasTextoRouter = Router();
plantillasTextoRouter.use(requiereVendedora);

plantillasTextoRouter.get('/', ruta(async (req, res) => {
  const plantillas = await listarPlantillas(db, req.vendedoraId!);
  res.json({ plantillas });
}));

plantillasTextoRouter.post('/', ruta(async (req, res) => {
  const v = validarPlantilla(req.body ?? {});
  if (!v.ok) {
    res.status(400).json({ ok: false, message: v.motivo });
    return;
  }
  const plantilla = await crearPlantilla(db, { vendedoraId: req.vendedoraId!, titulo: v.titulo, texto: v.texto });
  res.json({ ok: true, plantilla });
}));

plantillasTextoRouter.patch('/:id', ruta(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const v = validarPlantilla(req.body ?? {});
  if (!v.ok) {
    res.status(400).json({ ok: false, message: v.motivo });
    return;
  }
  const r = await editarPlantilla(db, { id, vendedoraId: req.vendedoraId!, titulo: v.titulo, texto: v.texto, ahora: new Date() });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la plantilla no existe (o ya está archivada)' });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'solo la dueña puede editar esta plantilla' });
    return;
  }
  res.json({ ok: true, plantilla: r.plantilla });
}));

plantillasTextoRouter.delete('/:id', ruta(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const r = await archivarPlantilla(db, { id, vendedoraId: req.vendedoraId!, ahora: new Date() });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la plantilla no existe (o ya estaba archivada)' });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'solo la dueña puede eliminar esta plantilla' });
    return;
  }
  res.json({ ok: true });
}));
