import { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { ruta } from '../lib/ruta.js';
import { abrirLink, cortarLink, leerPorToken } from '../espacios/linkRepositorio.js';
import { configuracionDeLink, puedeEditarPorLink } from '../espacios/linkModelo.js';
import { personasDelRegistro, resumirPorLink } from '../espacios/auditoriaLink.js';
import { historialDe } from '../espacios/auditoriaLinkRepositorio.js';
import { espaciosDe } from '../espacios/repositorio.js';
import { puedeEditar, puedeEscribirEn, type QuienPregunta } from '../espacios/visibilidad.js';
import { consultarNotaPorId } from '../notas/consultarNotaPorId.js';
import type { NotaFila } from '../notas/notas.js';
import {
  archivarNota,
  buscarNotas,
  crearNota,
  desarchivarNota,
  editarNota,
  listarNotas,
  moverNota,
  prepararContenido,
  prepararEdicion,
} from '../notas/notas.js';

/**
 * `crearNota`/`editarNota`/`archivarNota`/`desarchivarNota` solo tocan la tabla
 * `notas` — cualquier fila que devuelven es, por construcción, editable (nunca
 * histórica de `gestiones`). Acá se le agrega el campo `origen` para que el
 * front reciba la MISMA forma sin importar qué endpoint contestó.
 */
function conOrigenNota(fila: NotaFila) {
  return { ...fila, origen: 'nota' as const };
}

/**
 * QUIÉN PREGUNTA — el token más los espacios de los que es miembro (ADR 0046).
 *
 * Se resuelve en CADA request y no se cachea en el proceso: sacar a alguien de un
 * espacio tiene que dejar de servirle las páginas en el request siguiente, no
 * cuando venza un TTL. Es una consulta por un índice sobre `lower(vendedora_id)`.
 *
 * ⚠️ Si la tabla no existe (falta la migración `0022`), `espaciosDe` devuelve `[]`
 * y la regla colapsa a «solo mi libreta privada»: la Libreta de antes de este
 * frente. Degrada hacia MENOS, nunca hacia más.
 */
async function quienPregunta(vendedoraId: string): Promise<QuienPregunta> {
  return { vendedoraId, espacios: await espaciosDe(db, vendedoraId) };
}

/**
 * El `?espacio=` de la query. `null` = mi libreta privada (y es el default, así
 * que un front viejo sigue viendo exactamente lo suyo).
 *
 * Un valor que no es un entero **no cae en silencio a la libreta privada**:
 * responde `'invalido'`. Sin eso, `?espacio=abc` mostraría las páginas propias
 * con el título del espacio compartido arriba — la peor forma de fallar, porque
 * se ve bien.
 */
function espacioPedido(valor: unknown): number | null | 'invalido' {
  if (valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : 'invalido';
}

/**
 * Tope de tamaño del DOCUMENTO, aparte del de `texto`.
 *
 * `validarTexto` mira los 2.000 caracteres del texto **aplanado**, y eso no
 * acota el JSON: una tabla de 500 filas vacías, o un doc con basura en los
 * props, pesa megas y aplana a nada. Sin este tope, el body pasa la validación
 * de texto y entra igual a una columna `jsonb`.
 *
 * Es generoso a propósito —la nota más larga que se puede escribir ronda las
 * decenas de KB— y solo frena lo que no es una nota.
 */
const TOPE_DOC_BYTES = 512 * 1024;

function docExcedeElTope(doc: unknown): string | null {
  if (doc === undefined) return null;
  const bytes = Buffer.byteLength(JSON.stringify(doc) ?? '', 'utf8');
  if (bytes <= TOPE_DOC_BYTES) return null;
  return `el documento de la nota pesa ${Math.round(bytes / 1024)} KB y el tope es ${TOPE_DOC_BYTES / 1024} KB`;
}

/**
 * NOTAS — el «Notion» a una tecla (issue #47). Router chico: la lógica (SQL +
 * reglas) vive en `notas/notas.ts` como seam testeable; acá solo se decodifica
 * el HTTP (status codes, body) y se pasa el `db` singleton.
 *
 * `requiereVendedora` nace ACÁ, como en `correos.ts` — el barrido de auth de
 * #36 no toca este router porque ya nace protegido. El `vendedoraId` SIEMPRE
 * sale del token, nunca del body: nadie escribe una nota en nombre de otra.
 */
export const notasRouter = Router();
notasRouter.use(requiereVendedora);

/**
 * GET /api/notas?clave=<clave>              → mi libreta privada de esa ancla.
 * GET /api/notas?clave=<clave>&espacio=<id> → las páginas de ESE espacio.
 * GET /api/notas?q=<texto>                  → búsqueda sobre TODO lo visible
 *                                             (mi libreta + mis espacios).
 */
notasRouter.get('/', ruta(async (req, res) => {
  const quien = await quienPregunta(req.vendedoraId!);

  const q = typeof req.query.q === 'string' ? req.query.q : '';
  if (q.trim()) {
    const filas = await buscarNotas(db, { quien, q });
    res.json({ notas: filas.map(conOrigenNota) });
    return;
  }

  const clave = typeof req.query.clave === 'string' ? req.query.clave.trim() : '';
  if (!clave) {
    res.status(400).json({ ok: false, message: 'falta clave (o q para buscar)' });
    return;
  }

  const espacioId = espacioPedido(req.query.espacio);
  if (espacioId === 'invalido') {
    res.status(400).json({ ok: false, message: 'espacio inválido' });
    return;
  }
  // 🔴 LA MEMBRESÍA SE VERIFICA ACÁ, ANTES DE CONSULTAR. `listarNotas` confía en
  // este chequeo a propósito (con dos, habría dos lugares decidiendo lo mismo),
  // así que si esta guarda se cae, un `?espacio=7` a mano sirve las páginas de un
  // equipo del que no sos parte. Es 403 y no una lista vacía: «no sos miembro» y
  // «el espacio está vacío» son cosas distintas y se leen distinto.
  if (espacioId !== null && !quien.espacios.includes(espacioId)) {
    res.status(403).json({ ok: false, message: 'no sos miembro de ese espacio' });
    return;
  }

  // Ya viene con `origen` — listarNotas mezcla lo editable con lo histórico de gestiones.
  const notas = await listarNotas(db, { clave, vendedoraId: req.vendedoraId!, espacioId });
  res.json({ notas });
}));

notasRouter.post('/', ruta(async (req, res) => {
  const clave = typeof req.body?.clave === 'string' ? req.body.clave.trim() : '';
  if (!clave) {
    res.status(400).json({ ok: false, message: 'falta la clave (conversación, o "general" para la libreta)' });
    return;
  }
  const excede = docExcedeElTope(req.body?.doc);
  if (excede) {
    res.status(400).json({ ok: false, message: excede });
    return;
  }
  // `prepararContenido` deriva el texto del `doc` cuando viene, y descarta el
  // que haya mandado el cliente: el server calcula, el navegador no.
  const v = prepararContenido(req.body ?? {});
  if (!v.ok) {
    res.status(400).json({ ok: false, message: v.motivo });
    return;
  }

  const espacioId = espacioPedido(req.body?.espacioId);
  if (espacioId === 'invalido') {
    res.status(400).json({ ok: false, message: 'espacio inválido' });
    return;
  }
  // 🔴 LA FRONTERA TAMBIÉN VA DEL LADO DE LA ESCRITURA. Sin esto, cualquiera
  // PLANTA una página adentro del espacio de otro equipo mandando un número en el
  // body — un agujero que no se ve mirando solo la lectura, porque la lista de
  // ese equipo la mostraría como una página más y de nadie.
  const quien = await quienPregunta(req.vendedoraId!);
  if (!puedeEscribirEn(espacioId, quien)) {
    res.status(403).json({ ok: false, message: 'no sos miembro de ese espacio' });
    return;
  }

  const nota = await crearNota(db, {
    clave,
    vendedoraId: req.vendedoraId!,
    texto: v.texto,
    espacioId,
    ...(req.body?.doc !== undefined ? { doc: req.body.doc } : {}),
  });
  res.json({ ok: true, nota: conOrigenNota(nota) });
}));

notasRouter.patch('/:id', ruta(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const preparado = prepararEdicion(req.body ?? {}, new Date());
  if (!preparado.ok) {
    res.status(400).json({ ok: false, message: preparado.motivo });
    return;
  }
  const r = await editarNota(db, { id, quien: await quienPregunta(req.vendedoraId!), cambios: preparado.cambios });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la nota no existe (o ya está archivada)' });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'solo la autora puede editar esta nota' });
    return;
  }
  res.json({ ok: true, nota: conOrigenNota(r.nota) });
}));

/**
 * MOVER UNA PÁGINA DE LUGAR. `espacioId: null` = traerla a mi libreta privada.
 *
 * ⚠️ **`null` y «ausente» significan cosas distintas acá, al revés que en el
 * POST**: en el POST, omitirlo es «la libreta» (el default de un front viejo);
 * acá omitirlo es «no me dijiste a dónde» y responde 400. Sin esa diferencia, un
 * body mal armado movería páginas a la libreta privada de quien lo mandó — o sea
 * que un bug del cliente **se las sacaría al equipo en silencio**.
 */
notasRouter.patch('/:id/mover', ruta(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  if (!('espacioId' in (req.body ?? {}))) {
    res.status(400).json({ ok: false, message: 'falta espacioId (null para tu libreta)' });
    return;
  }
  const destino = req.body.espacioId === null ? null : espacioPedido(req.body.espacioId);
  if (destino === 'invalido') {
    res.status(400).json({ ok: false, message: 'espacio inválido' });
    return;
  }

  const r = await moverNota(db, { id, destino, quien: await quienPregunta(req.vendedoraId!) });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la nota no existe (o está archivada)' });
    return;
  }
  // Moverla a donde ya está no es un error que valga la pena mostrarle a nadie:
  // es un clic de más. Se contesta 200 sin haber escrito nada.
  if (!r.ok && r.motivo === 'sin-cambio') {
    res.json({ ok: true, sinCambio: true });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'no podés mover esa página ahí' });
    return;
  }
  res.json({ ok: true, nota: conOrigenNota(r.nota) });
}));

/**
 * EL LINK PÚBLICO de una página (ADR 0047).
 *
 * `POST` abre (idempotente: si ya tiene, devuelve el mismo) · `DELETE` corta.
 * La página que sirve el token vive **fuera de `/api`**, en `routes/publico.ts`.
 *
 * ⚠️ El server devuelve **el token**, no la URL entera: el origen público no lo
 * conoce (Hermes se sirve por OTA y la cáscara puede estar en otro lado), y
 * armarlo acá con una env sería un lugar más donde puede quedar mal. La pantalla
 * lo compone con su propio origen.
 */
notasRouter.post('/:id/link', ruta(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  // El alcance y el permiso vienen del body; `configuracionDeLink` es lo único
  // que puede construirlos, y hace IMPOSIBLE representar «público + editar».
  const config = configuracionDeLink(req.body ?? {});
  if (!config.ok) {
    res.status(400).json({ ok: false, message: config.motivo });
    return;
  }
  const r = await abrirLink(db, { notaId: id, quien: await quienPregunta(req.vendedoraId!), config: config.config });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la nota no existe (o está archivada)' });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'no podés compartir esa página' });
    return;
  }
  res.json({ ok: true, token: r.token });
}));

notasRouter.delete('/:id/link', ruta(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const r = await cortarLink(db, { notaId: id, quien: await quienPregunta(req.vendedoraId!) });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la nota no existe' });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'no podés cortar ese link' });
    return;
  }
  res.json({ ok: true, token: null });
}));

/**
 * EL REGISTRO DE AUDITORÍA del link de una página (17-ago-2026).
 *
 * Contesta las tres preguntas que el estado actual de `nota_link` no puede
 * contestar nunca: **quién abrió esta puerta**, **cuánto se usó** y **con qué
 * permisos estuvo abierta** — incluidos los links que ya se cortaron, que son de
 * los que más se pregunta.
 *
 * 🔴 **Detrás del MISMO permiso que compartir, no de uno nuevo.** Se pide
 * `puedeEditar` sobre la página, que es lo que ya se exige para abrir y cortar el
 * link (ADR 0047). Un registro de auditoría legible por quien no puede tocar la
 * página diría quién de Goberna leyó qué a alguien que no tiene nada que ver — y
 * uno reservado a la autora dejaría una página del equipo cuyo historial una sola
 * persona puede mirar.
 *
 * ⚠️ **El resumen se calcula ACÁ, no en el navegador** (`resumirPorLink`): con
 * dos implementaciones, la pantalla afirmaría «12 aperturas» sobre un server que
 * cuenta otra cosa. Es #37 en la forma más cara, porque acá el número ES el
 * producto.
 */
notasRouter.get('/:id/link/historial', ruta(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }

  const nota = await consultarNotaPorId(db, id);
  if (!nota) {
    res.status(404).json({ ok: false, message: 'la nota no existe' });
    return;
  }
  // La misma regla que compartir, preguntada con la MISMA función que usan
  // `abrirLink` y `cortarLink` (`puedeEditar`): quien puede abrir la puerta puede
  // ver quién entró por ella. Escribir el predicado a mano acá daría dos reglas
  // para la misma pregunta, y la que se olvidaría de actualizar es siempre ésta.
  const quien = await quienPregunta(req.vendedoraId!);
  if (!puedeEditar({ vendedoraId: nota.vendedoraId, espacioId: nota.espacioId }, quien)) {
    res.status(403).json({ ok: false, message: 'no podés ver el registro de esa página' });
    return;
  }

  const { eventos, sinTabla } = await historialDe(db, id);
  res.json({
    ok: true,
    eventos,
    links: resumirPorLink(eventos),
    personas: personasDelRegistro(eventos),
    // 🔴 Viaja SIEMPRE, y la pantalla lo dice: sin este campo, una migración sin
    // aplicar se ve idéntica a un link que nadie abrió nunca. En una superficie de
    // auditoría eso no es degradar, es afirmar que no pasó nada.
    sinRegistro: sinTabla,
  });
}));

/**
 * ABRIR UNA PÁGINA POR SU LINK, DESDE ADENTRO DE LA APP (ADR 0048).
 *
 * 🔴 **Esta ruta existe porque una navegación del navegador NO lleva el token de
 * Hermes**: la sesión vive en `localStorage`, no en una cookie. Así que un link
 * de alcance `goberna` **no puede servir contenido desde `/n/`** —ahí el server
 * no sabe quién sos— y en vez de eso manda a la app, que sí tiene el Bearer y
 * pregunta acá.
 *
 * La consecuencia es la que hace seguro el frente: **el contenido de un link
 * interno nunca sale por la ruta anónima.**
 *
 * ⚠️ Un link `publico` también se puede abrir por acá, y da lo mismo: quien tiene
 * sesión ya podía verlo por `/n/`. Lo que NO da lo mismo es `puedeEditar`, que
 * exige las dos cosas (permiso del link Y sesión).
 */
notasRouter.get('/por-link/:token', ruta(async (req, res) => {
  // ⚠️ **El `vendedoraId` va al registro, y ésta es la ÚNICA puerta que lo sabe.**
  // Del otro lado de `/n/<token>` no hay sesión, así que aquellas aperturas se
  // anotan sin identidad. Que las dos rutas anoten distinto no es una
  // inconsistencia: es la diferencia real entre abrir con cuenta y sin cuenta.
  const link = await leerPorToken(db, req.params.token, new Date(), req.vendedoraId ?? null);
  if (!link) {
    res.status(404).json({ ok: false, message: 'ese link no existe o ya no sirve' });
    return;
  }
  const nota = await consultarNotaPorId(db, link.notaId);
  if (!nota) {
    res.status(404).json({ ok: false, message: 'ese link no existe o ya no sirve' });
    return;
  }
  res.json({
    ok: true,
    nota: conOrigenNota(nota),
    // `true` solo si el link lo permite Y hay sesión — y acá siempre la hay,
    // porque el router entero está detrás de `requiereVendedora`.
    puedeEditar: puedeEditarPorLink(link, true),
  });
}));

notasRouter.patch('/:id/archivar', ruta(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const r = await archivarNota(db, { id, quien: await quienPregunta(req.vendedoraId!), ahora: new Date() });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la nota no existe (o ya estaba archivada)' });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'solo la autora puede archivar esta nota' });
    return;
  }
  res.json({ ok: true, nota: conOrigenNota(r.nota) });
}));

/**
 * DESHACER un archivado — el camino de vuelta que le faltaba al «un clic y
 * desaparece» (review de código del PR #47). Lo llama el toast «Nota archivada
 * — Deshacer» del front, apenas después de archivar.
 */
notasRouter.patch('/:id/desarchivar', ruta(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const r = await desarchivarNota(db, { id, quien: await quienPregunta(req.vendedoraId!) });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la nota no existe (o no estaba archivada)' });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'solo la autora puede desarchivar esta nota' });
    return;
  }
  res.json({ ok: true, nota: conOrigenNota(r.nota) });
}));
