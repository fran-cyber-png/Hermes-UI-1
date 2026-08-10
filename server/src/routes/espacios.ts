import { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { esDestinoValido } from '../reparto/destino.js';
import { puedeAdministrar } from '../espacios/visibilidad.js';
import {
  agregarMiembro,
  archivarEspacio,
  crearEspacio,
  leerEspacio,
  listarEspaciosDe,
  padronDePersonas,
  sacarMiembro,
} from '../espacios/repositorio.js';

/**
 * LOS ESPACIOS DE TRABAJO DE LA LIBRETA (ADR 0046).
 *
 * Router chico, como `notas.ts`: acá se decodifica el HTTP y la regla vive en
 * `espacios/visibilidad.ts` (pura) y `espacios/repositorio.ts` (el IO).
 *
 * `requiereVendedora` nace ACÁ, delante de todo. El `vendedoraId` SIEMPRE sale
 * del token, nunca del body: nadie crea un espacio en nombre de otra ni se
 * agrega solo a uno ajeno.
 */
export const espaciosRouter = Router();
espaciosRouter.use(requiereVendedora);

const TOPE_NOMBRE = 80;

function nombreValido(valor: unknown): { ok: true; nombre: string } | { ok: false; motivo: string } {
  const nombre = typeof valor === 'string' ? valor.trim() : '';
  if (!nombre) return { ok: false, motivo: 'el espacio necesita un nombre' };
  if (nombre.length > TOPE_NOMBRE) {
    return { ok: false, motivo: `el nombre no puede superar los ${TOPE_NOMBRE} caracteres (tiene ${nombre.length})` };
  }
  return { ok: true, nombre };
}

/**
 * A quiénes se puede invitar.
 *
 * ⚠️ **Se sirve la lista, no un `true`/`false` por nombre.** Un endpoint de
 * «¿existe Fulana?» convertiría el padrón en algo que se puede enumerar a fuerza
 * de preguntas, y encima la pantalla necesita la lista igual para ofrecerla.
 */
espaciosRouter.get('/padron', async (_req, res) => {
  const personas = await padronDePersonas(db);
  res.json({ personas });
});

/** Los espacios vivos de los que soy miembro. La libreta privada NO está acá: es implícita. */
espaciosRouter.get('/', async (req, res) => {
  const espacios = await listarEspaciosDe(db, req.vendedoraId!);
  res.json({ espacios });
});

espaciosRouter.post('/', async (req, res) => {
  const v = nombreValido(req.body?.nombre);
  if (!v.ok) {
    res.status(400).json({ ok: false, message: v.motivo });
    return;
  }

  const pedidos: string[] = Array.isArray(req.body?.miembros)
    ? req.body.miembros.filter((m: unknown): m is string => typeof m === 'string')
    : [];

  // 🔴 EL DESTINO SE VERIFICA CONTRA EL PADRÓN, igual que una reasignación
  // (`reparto/destino.ts`). Hermes no tiene padrón de usuarios, así que un dedazo
  // (`sindi` por `sindy`) escribiría una fila perfectamente válida y esa persona
  // NUNCA vería el espacio: sin error, sin fila huérfana, sin nada que mirar.
  const padron = await padronDePersonas(db);
  const desconocidos = pedidos.filter((m) => m.trim() && !esDestinoValido(m, padron));
  if (desconocidos.length > 0) {
    res.status(409).json({
      ok: false,
      message: `no conozco a ${desconocidos.join(', ')}`,
      // Se enumera a quién SÍ se puede, nunca un «no» pelado: sin la lista, el
      // que se equivocó no tiene con qué corregir.
      posibles: padron,
    });
    return;
  }

  const espacio = await crearEspacio(db, {
    nombre: v.nombre,
    creadaPor: req.vendedoraId!,
    miembros: pedidos,
  });
  res.json({ ok: true, espacio });
});

/**
 * LA GUARDA DE ADMINISTRACIÓN, en un solo lugar.
 *
 * ⚠️ **Un espacio que no existe y uno que no es tuyo contestan distinto a
 * propósito**: 404 y 403. Es lo contrario de lo que suele hacerse por
 * paranoia —responder 404 a todo para no filtrar la existencia—, y acá no
 * aplica: el universo de espacios es de nueve personas de la misma empresa, y
 * un 404 sobre un espacio del que te acaban de sacar se lee «se borró» cuando lo
 * cierto es «ya no sos miembro».
 */
async function conPermisoDeAdmin(
  id: number,
  vendedoraId: string,
): Promise<{ ok: true; espacio: Awaited<ReturnType<typeof leerEspacio>> } | { ok: false; estado: 404 | 403; motivo: string }> {
  if (!Number.isInteger(id)) return { ok: false, estado: 404, motivo: 'id inválido' };
  const espacio = await leerEspacio(db, id);
  if (!espacio) return { ok: false, estado: 404, motivo: 'ese espacio no existe (o está archivado)' };
  if (!puedeAdministrar(espacio, { vendedoraId })) {
    return { ok: false, estado: 403, motivo: 'solo quien creó el espacio puede administrarlo' };
  }
  return { ok: true, espacio };
}

espaciosRouter.post('/:id/miembros', async (req, res) => {
  const permiso = await conPermisoDeAdmin(Number(req.params.id), req.vendedoraId!);
  if (!permiso.ok) {
    res.status(permiso.estado).json({ ok: false, message: permiso.motivo });
    return;
  }

  const quien = typeof req.body?.vendedoraId === 'string' ? req.body.vendedoraId.trim() : '';
  const padron = await padronDePersonas(db);
  if (!esDestinoValido(quien, padron)) {
    res.status(409).json({ ok: false, message: `no conozco a ${quien || '(nadie)'}`, posibles: padron });
    return;
  }

  await agregarMiembro(db, {
    espacioId: permiso.espacio!.id,
    vendedoraId: quien,
    agregadoPor: req.vendedoraId!,
  });
  res.json({ ok: true, espacio: await leerEspacio(db, permiso.espacio!.id) });
});

espaciosRouter.delete('/:id/miembros/:vendedoraId', async (req, res) => {
  const permiso = await conPermisoDeAdmin(Number(req.params.id), req.vendedoraId!);
  if (!permiso.ok) {
    res.status(permiso.estado).json({ ok: false, message: permiso.motivo });
    return;
  }

  // 🔴 LA CREADORA NO SE PUEDE SACAR, NI ELLA MISMA. El espacio quedaría sin
  // nadie que pueda administrarlo —agregar miembros exige ser la creadora, y
  // verlo exige ser miembro—, así que sería un lugar imposible de arreglar desde
  // la app. Para irse del todo, se archiva.
  const saliente = req.params.vendedoraId;
  if (esDestinoValido(saliente, [permiso.espacio!.creadaPor])) {
    res.status(409).json({
      ok: false,
      message: 'quien creó el espacio no se puede sacar — archivalo si ya no hace falta',
    });
    return;
  }

  await sacarMiembro(db, { espacioId: permiso.espacio!.id, vendedoraId: saliente });
  res.json({ ok: true, espacio: await leerEspacio(db, permiso.espacio!.id) });
});

/** Archivar el espacio. Las páginas NO se tocan: se archiva el lugar, no lo escrito. */
espaciosRouter.patch('/:id/archivar', async (req, res) => {
  const permiso = await conPermisoDeAdmin(Number(req.params.id), req.vendedoraId!);
  if (!permiso.ok) {
    res.status(permiso.estado).json({ ok: false, message: permiso.motivo });
    return;
  }
  await archivarEspacio(db, permiso.espacio!.id, new Date());
  res.json({ ok: true });
});
