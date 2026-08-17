import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import express, { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { RUTA_MEDIA, archivoSeguro, nombreSeguro } from '../whatsapp/mediaDir.js';
import { ruta } from '../lib/ruta.js';
import { abrirLink, cortarLink, leerPorToken } from '../espacios/linkRepositorio.js';
import { configuracionDeLink, puedeEditarPorLink } from '../espacios/linkModelo.js';
import { personasDelRegistro, resumirPorLink } from '../espacios/auditoriaLink.js';
import { historialDe } from '../espacios/auditoriaLinkRepositorio.js';
import { espaciosDe } from '../espacios/repositorio.js';
import { puedeEditar, puedeEscribirEn, puedeVer, type QuienPregunta } from '../espacios/visibilidad.js';
import { consultarNotaPorId } from '../notas/consultarNotaPorId.js';
import type { NotaFila } from '../notas/notas.js';
import {
  archivarNota,
  buscarNotas,
  cortarDivision,
  crearNota,
  desarchivarNota,
  dividirNota,
  editarNota,
  listarNotas,
  moverNota,
  prepararContenido,
  prepararEdicion,
  validarAnotaciones,
  validarDiagrama,
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

/* ───────────────── Las imágenes que se pegan en una página ──────────────── */

/**
 * Los formatos que se aceptan. Lista BLANCA y corta: lo que un navegador pinta
 * sin sorpresas en un `<canvas>` y lo que el portapapeles produce de verdad
 * (una captura de pantalla siempre llega como PNG).
 *
 * ⚠️ Nada de SVG, y no es un olvido: un SVG es un documento con scripts y
 * referencias externas. Servirlo desde el mismo origen que la app sería darle a
 * cualquiera que pueda pegar una imagen un XSS de primera clase.
 */
const TIPOS_DE_IMAGEN: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * 8 MB por imagen. Es una captura de pantalla holgada y una foto de teléfono
 * normal. No es el tope del `jsonb` —la capa guarda el NOMBRE del archivo, no
 * los bytes— sino el del disco y el de la subida.
 */
const TOPE_IMAGEN_BYTES = 8 * 1024 * 1024;

/**
 * PEGAR UNA IMAGEN EN UNA PÁGINA — `POST /api/notas/adjuntos`.
 *
 * ══ POR QUÉ EL CUERPO ES CRUDO Y NO JSON ════════════════════════════════════
 *
 * `index.ts` monta `express.json()` sin `limit`, o sea 100 KB para toda la app.
 * Una captura de pantalla en base64 adentro de un JSON no entra ni de casualidad
 * — y aunque entrara, base64 infla un tercio y el body viaja en CADA
 * autoguardado de la página. Acá el cuerpo son los bytes tal cual, con su propio
 * tope, exactamente como ya lo hace `plantillas.ts` para el flyer de un paso.
 *
 * La capa de anotaciones guarda **el nombre del archivo**, nunca los bytes.
 *
 * ══ DÓNDE VIVEN ═════════════════════════════════════════════════════════════
 *
 * En `RUTA_MEDIA`, el mismo directorio por el que ya pasa todo adjunto de
 * WhatsApp: está gitignoreado, ya existe en cada deploy y ya tiene su saneado de
 * nombres. Inventar un segundo almacén sería un segundo lugar que respaldar y
 * un segundo saneado que endurecer por separado.
 *
 * El prefijo `nota-` no es decorativo: hace obvio de dónde salió cada archivo el
 * día que haya que limpiar huérfanos.
 */
notasRouter.post(
  '/adjuntos',
  express.raw({ type: () => true, limit: '8mb' }),
  ruta(async (req, res) => {
    const bytes = req.body as Buffer;
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();

    if (!bytes?.length) {
      res.status(400).json({ ok: false, message: 'el cuerpo tiene que ser la imagen cruda' });
      return;
    }
    if (bytes.length > TOPE_IMAGEN_BYTES) {
      res.status(413).json({
        ok: false,
        message: `la imagen pesa ${Math.round(bytes.length / 1024 / 1024)} MB y el tope es ${TOPE_IMAGEN_BYTES / 1024 / 1024} MB`,
      });
      return;
    }

    const extension = TIPOS_DE_IMAGEN[mime];
    if (!extension) {
      res.status(415).json({
        ok: false,
        message: `«${mime || 'sin tipo'}» no se puede pegar. Solo PNG, JPG, WEBP o GIF.`,
      });
      return;
    }

    // El nombre lo arma el SERVER, entero: nada de lo que llegue del cliente
    // entra en un path. `nombreSeguro` es la segunda red, no la primera.
    const archivo = nombreSeguro(`nota-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`);
    await writeFile(join(RUTA_MEDIA, archivo), bytes);

    res.status(201).json({ ok: true, adjunto: { archivo, mime, bytes: bytes.length } });
  }),
);

/**
 * SERVIR UNA IMAGEN PEGADA — `GET /api/notas/adjuntos/:archivo`.
 *
 * ══ VIVE DENTRO DEL PERÍMETRO, Y SE PUEDE ═══════════════════════════════════
 *
 * Todo `/api/*` exige el token de una vendedora, y un `<img src>` no manda
 * cabeceras — el atajo habitual sería abrir la ruta o meterle un token en la
 * URL. **No hace falta ninguna de las dos**: la capa pinta en un `<canvas>`, así
 * que el front baja la imagen con `fetch` y su `Authorization` de siempre y la
 * mete en un `ImageBitmap`.
 *
 * O sea: las imágenes de una libreta privada quedan tan cerradas como su texto,
 * sin una excepción nueva en el perímetro. Ver `dibujo/adjuntos.ts`.
 *
 * ⚠️ Lo que esto NO hace: comprobar que ESTA vendedora sea la dueña de la página
 * donde se pegó la imagen. Con el nombre de archivo (16 caracteres aleatorios) no
 * se puede adivinar cuál pedir, pero una compañera que lo conozca puede bajarlo.
 * Es exactamente la misma propiedad que ya tiene `/api/whatsapp/media/:archivo`
 * desde que existe; atarlo a la fila exige guardar de qué nota es cada adjunto y
 * es un frente propio.
 */
notasRouter.get('/adjuntos/:archivo', (req, res) => {
  const archivo = req.params.archivo;
  // `archivoSeguro` es lista blanca: un nombre o un 400, jamás un path.
  if (!archivoSeguro(archivo)) {
    res.status(400).json({ ok: false, message: 'nombre de archivo inválido' });
    return;
  }
  const ruta = join(RUTA_MEDIA, archivo);
  if (!existsSync(ruta)) {
    res.status(404).json({ ok: false, message: 'esa imagen ya no está' });
    return;
  }
  res.sendFile(ruta);
});

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

/**
 * UNA PÁGINA, POR SU ID — lo que le faltaba a la pantalla dividida (17-ago-2026):
 * mostrar al lado una página que no pertenece a la `clave`/`espacio` que el
 * listado de arriba está trayendo. Antes solo existía el equivalente para un
 * link anónimo (`por-link/:token`); acá es la MISMA fila, detrás de la sesión.
 *
 * ⚠️ **Va DESPUÉS de `/por-link/:token` en este archivo mismo por prolijidad,
 * pero no colisiona ni en ese orden ni al revés**: son dos segmentos
 * (`/por-link/xyz`) contra uno (`/42`), así que Express nunca confunde una ruta
 * con la otra sin importar quién se registró primero.
 */
notasRouter.get('/:id', ruta(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const nota = await consultarNotaPorId(db, id);
  if (!nota || nota.archivadoAt) {
    res.status(404).json({ ok: false, message: 'esa página no existe (o no la podés ver)' });
    return;
  }
  const quien = await quienPregunta(req.vendedoraId!);
  // Mismo mensaje que «no existe»: distinguirlos delataría que un id ajeno
  // EXISTE, aunque no se pueda ver — la misma guarda que `dividirNota`.
  if (!puedeVer({ vendedoraId: nota.vendedoraId, espacioId: nota.espacioId }, quien)) {
    res.status(404).json({ ok: false, message: 'esa página no existe (o no la podés ver)' });
    return;
  }
  res.json({ ok: true, nota: conOrigenNota(nota) });
}));

/**
 * EL TÍTULO FIJO de toda página de diagrama nueva — nunca se deriva de su
 * contenido (React Flow no tiene «texto», tiene nodos) y nunca se edita: es lo
 * que hace que `tituloDeNota` y la búsqueda tengan algo que mostrar sin que el
 * server tenga que inventar un aplanador de grafos.
 */
const TITULO_DIAGRAMA = 'Diagrama de flujo';

notasRouter.post('/', ruta(async (req, res) => {
  const clave = typeof req.body?.clave === 'string' ? req.body.clave.trim() : '';
  if (!clave) {
    res.status(400).json({ ok: false, message: 'falta la clave (conversación, o "general" para la libreta)' });
    return;
  }

  // ── UN DIAGRAMA ES OTRO CAMINO ENTERO, no una rama de `doc` ──
  // Nunca pasa por `prepararContenido`: no hay BlockNote de por medio, así que
  // exigirle `texto`/`doc` a una página de nodos sería rechazar exactamente lo
  // que este camino existe para aceptar.
  if (req.body?.tipo === 'diagrama') {
    const v = validarDiagrama(req.body?.diagrama);
    if (!v.ok) {
      res.status(400).json({ ok: false, message: v.motivo });
      return;
    }
    const espacioId = espacioPedido(req.body?.espacioId);
    if (espacioId === 'invalido') {
      res.status(400).json({ ok: false, message: 'espacio inválido' });
      return;
    }
    const quien = await quienPregunta(req.vendedoraId!);
    if (!puedeEscribirEn(espacioId, quien)) {
      res.status(403).json({ ok: false, message: 'no sos miembro de ese espacio' });
      return;
    }
    const nota = await crearNota(db, {
      clave,
      vendedoraId: req.vendedoraId!,
      texto: TITULO_DIAGRAMA,
      espacioId,
      tipo: 'diagrama',
      diagrama: v.diagrama,
    });
    res.json({ ok: true, nota: conOrigenNota(nota) });
    return;
  }

  const excede = docExcedeElTope(req.body?.doc);
  if (excede) {
    res.status(400).json({ ok: false, message: excede });
    return;
  }
  // La capa de anotaciones tiene su propio tope y su propia forma. Se valida
  // ACÁ y no dentro de `prepararContenido` porque no es contenido del texto: es
  // una columna aparte, y mezclarlas haría que un dibujo pesado se reporte como
  // un problema del texto.
  if (req.body?.anotaciones !== undefined) {
    const capa = validarAnotaciones(req.body.anotaciones);
    if (!capa.ok) {
      res.status(400).json({ ok: false, message: capa.motivo });
      return;
    }
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
    ...(req.body?.anotaciones !== undefined ? { anotaciones: req.body.anotaciones } : {}),
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
 * LA PANTALLA DIVIDIDA (17-ago-2026): con qué otra página se ve al lado.
 *
 * `PATCH` abre —o CAMBIA— la contraparte (una sola: dividir de nuevo reemplaza
 * la que había, nunca agrega una segunda). `DELETE` la deshace, sin tocar la
 * otra página. La regla entera vive en `notas/notas.ts`; acá solo el HTTP.
 */
notasRouter.patch('/:id/dividir', ruta(async (req, res) => {
  const id = Number(req.params.id);
  const objetivoId = Number(req.body?.paginaDivididaId);
  if (!Number.isInteger(id) || !Number.isInteger(objetivoId) || objetivoId <= 0) {
    res.status(400).json({ ok: false, message: 'falta un paginaDivididaId válido' });
    return;
  }
  if (objetivoId === id) {
    res.status(400).json({ ok: false, message: 'una página no se puede dividir consigo misma' });
    return;
  }

  const r = await dividirNota(db, { id, objetivoId, quien: await quienPregunta(req.vendedoraId!) });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la nota no existe (o está archivada)' });
    return;
  }
  if (!r.ok && r.motivo === 'objetivo-no-encontrado') {
    res.status(404).json({ ok: false, message: 'esa página no existe (o no la podés ver)' });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'no podés dividir esa página' });
    return;
  }
  res.json({ ok: true, nota: conOrigenNota(r.nota) });
}));

notasRouter.delete('/:id/dividir', ruta(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const r = await cortarDivision(db, { id, quien: await quienPregunta(req.vendedoraId!) });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la nota no existe (o está archivada)' });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'no podés tocar esa página' });
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
