import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import express, { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { gestorWhatsapp, whatsapp } from '../whatsapp/wiring.js';
import { hiloDe } from '../whatsapp/hilo.js';
import {
  consultarEntrantesParaTildes,
  consultarOrigenDelLead,
  guardarFotoDePerfil,
  leerFotoDePerfilCacheada,
  type OrigenDelLead,
} from '../whatsapp/consultasDeWhatsapp.js';
import { enviarMediaYProyectar, enviarTextoYProyectar } from '../whatsapp/enviarYProyectar.js';
import { resolverAnuncio } from '../meta/anuncio.js';
import { RUTA_MEDIA, nombreSeguro } from '../whatsapp/mediaDir.js';
import { normalizarTelefono, identidadDeParametro } from '../whatsapp/identidadWa.js';
import { FotoNoDisponibleError, type FotoPerfil, type MediaSaliente } from '../whatsapp/transporte.js';
import { claseDeMime, limitesDe, motivoPorTamano } from '../whatsapp/limitesMedia.js';
import { cancelarPorRespuestaHumana, faltaEsquema } from '../autorespuesta/repositorio.js';
import { procedenciaDelComposer, type LeerPasoDeSecuencia } from '../procedencia/desdeElComposer.js';
import { obtenerPlantilla } from '../plantillas/repositorio.js';
import { listarNumeros } from '../numeros/repositorio.js';
import { soloSusLineas } from '../cola/lineas.js';
import { upsertEstado } from '../cola/estado.js';
import { reaccionesPorMensaje } from '../reacciones/repositorio.js';
import { estadosPorMensaje } from '../entrega/repositorio.js';
import { reaccionar } from '../reacciones/enviar.js';
import { resolverCitados, resolverCitaSaliente } from '../whatsapp/citaRepositorio.js';
import { edicionesPorMensaje } from '../ediciones/repositorio.js';
import { editarMensaje } from '../ediciones/editar.js';
import { ruta } from '../lib/ruta.js';
import { porQueFallo } from '../lib/porQueFallo.js';

/**
 * LA CONVERSACIÓN NATIVA DE WHATSAPP dentro de Hermes: ver el hilo y responder,
 * sin salir de la app. Todo envío pasa por `EnvioControlado` (la única puerta):
 * la ruta no llama nunca a `enviarTexto` directo.
 */
export const whatsappRouter = Router();

/**
 * El contenido AUTORAL de un paso, leído de la MISMA fila que lee
 * `POST /api/plantillas/:id/enviar-paso`: el texto guardado (con sus
 * `{nombre}`/`{precio}` sin resolver) y el archivo adjunto.
 *
 * Es lo que le falta al cuerpo que manda el navegador, y por eso la versión no
 * se puede calcular con lo que él declara. El porqué, medido, está en
 * `procedencia/desdeElComposer.ts`.
 *
 * **Degrada, pero RUIDOSO.** No poder leer el paso no puede tumbar un envío —la
 * vendedora aprieta Enviar, no «versionar»—, así que devuelve `null` y el envío
 * sale con `pieza_version` en «no sabemos». Pero se avisa: perder la versión en
 * silencio es cómo se acumulan meses de filas que después no cruzan con nada, y
 * es el modo de fallo exacto que este frente existe para no repetir.
 */
function leerPasoDeSecuencia(vendedoraId: string): LeerPasoDeSecuencia {
  return async (plantillaId, orden) => {
    const plantilla = await obtenerPlantilla(db, vendedoraId, plantillaId).catch((e: unknown) => {
      console.error(`[procedencia] no se pudo leer la plantilla ${plantillaId}: el envío sale sin versión de pieza`, e);
      return null;
    });
    const paso = plantilla?.pasos.find((p) => p.orden === orden);
    // `null` = no se pudo determinar el contenido, que es un dato y no un hueco.
    if (!paso) {
      if (plantilla) {
        console.warn(`[procedencia] la plantilla ${plantillaId} no tiene el paso ${orden}: el envío sale sin versión de pieza`);
      }
      return null;
    }
    return { texto: paso.texto, archivo: paso.media?.archivo ?? null };
  };
}

/**
 * El estado de la sesión. Sin parámetro devuelve la primera CONECTADA (la que el
 * semáforo del header debe mostrar: verde si ALGUNA línea puede mandar y recibir,
 * caída solo si todas están caídas). Con `?numeroPropio=` devuelve el estado de
 * ESA línea — para que el composer sepa si puede enviar POR la línea de esta
 * conversación, no por la primera que encontró el gestor.
 */
whatsappRouter.get('/sesion', (req, res) => {
  const numeroPropio = typeof req.query.numeroPropio === 'string' ? req.query.numeroPropio : undefined;
  if (numeroPropio) {
    const linea = gestorWhatsapp().de(numeroPropio);
    if (!linea) {
      res.status(404).json({ ok: false, message: 'esa línea no está corriendo' });
      return;
    }
    // Además del estado, QUÉ HAY DEL OTRO LADO y cuánto acepta. La app usa los
    // límites para frenar un adjunto pesado ANTES de subirlo (18 MB de video
    // tardan, y el rechazo llegaba recién al final). El server los verifica
    // igual: esto es conveniencia, no la garantía.
    res.json({
      ...linea.transporte.estado(),
      transporte: linea.transporte.nombre,
      limitesMedia: limitesDe(linea.transporte.nombre),
      // Feature-detectado: hoy solo whatsmeow lo tiene (la Cloud API no lo
      // expone). El botón de editar en el hilo lee esto para no ofrecer algo
      // que la línea no puede hacer.
      puedeEditar: Boolean(linea.transporte.editarTexto),
    });
    return;
  }
  // Semáforo global: la primera conectada, si hay; si no, la primera cualquiera.
  const todas = gestorWhatsapp().todos();
  const conectada = todas.find((l) => l.transporte.estado().estado === 'conectado');
  res.json((conectada ?? todas[0])?.transporte.estado() ?? { estado: 'desconectado' as const, motivo: 'sin líneas' });
});

/**
 * LAS LÍNEAS QUE ESTÁN CORRIENDO, para que la vendedora pueda recortar la cola a
 * una (#50). Lo que devuelve es el GESTOR —las líneas vivas—, no `numeros_wa`:
 * una fila registrada por Cerberus cuyo transporte no arrancó no es una línea
 * que se pueda mirar, y ofrecerla como filtro daría una cola vacía sin decir por
 * qué.
 *
 * `numeros_wa` aporta UNA cosa: el nombre. El chip tiene que decir «Walter», no
 * «51941654039» — un número no se reconoce de un vistazo y elegir la línea
 * equivocada se descubre tarde. Es un LEFT JOIN conceptual: sin fila registrada,
 * sin tabla todavía, o con la base caída, la línea igual se lista con su número
 * como etiqueta. **Perder el rótulo no puede esconder la línea**: quedarse sin
 * filtro es peor que un filtro que dice el número crudo.
 *
 * `mias` (de `numero_vendedora`) es lo que le permite a la barra ofrecer «Las
 * mías» SOLO a quien tiene líneas asignadas. Sin eso sería un botón que no hace
 * nada — la misma regla por la que el selector entero no se dibuja con una sola
 * línea. Y viaja por el mismo camino que el rótulo: si el mapa no se pudo leer,
 * `mias` queda en `false` en todas y la opción desaparece, o sea que la
 * vendedora ve TODO. Fail-open también acá.
 */
whatsappRouter.get('/lineas', ruta(async (req, res) => {
  const vivas = gestorWhatsapp().todos();

  let etiquetas = new Map<string, string>();
  let mias = new Set<string>();
  /**
   * Las que atiende MÁS DE UNA persona. `51984429504` tiene siete en producción,
   * y por eso no es «la línea» de ninguna de ellas: nadie se la trajo y nadie la
   * puede retirar. El panel lo usa para decidir si ofrece traer una propia — con
   * la misma regla que el tope del server (`numeros/autoVinculacion.ts`), porque
   * con dos reglas distintas el botón aparecería y el POST contestaría 409.
   */
  let compartidas = new Set<string>();
  let exclusiva = false;
  try {
    const registradas = await listarNumeros(db);
    etiquetas = new Map(registradas.map((n) => [n.numero, n.etiqueta]));
    compartidas = new Set(registradas.filter((n) => n.vendedoras.length > 1).map((n) => n.numero));
    const yo = req.vendedoraId;
    if (yo) {
      // Normalizando los DOS lados: Cerberus empuja la grafía que tiene («Luz»)
      // y el `vendedoraId` sale de lo que se tipeó al entrar («luz»). Con
      // comparación exacta, sus líneas no son suyas y no hay un solo síntoma.
      const igual = (v: string) => v.trim().toLowerCase() === yo.trim().toLowerCase();
      const misNumeros = registradas.filter((n) => n.vendedoras.some(igual));
      mias = new Set(misNumeros.map((n) => n.numero));
      // Quien atiende una línea de campaña no elige entre colas: ofrecerle las
      // de la Escuela sería ofrecerle trabajo que no es suyo. Misma regla que
      // recorta la cola (`cola/lineas.ts`), leída del mismo dato.
      exclusiva = soloSusLineas(misNumeros) && mias.size > 0;
    }
  } catch (e) {
    console.warn('[lineas] no se pudieron leer los rótulos de `numeros_wa`: van con el número crudo', e);
  }

  // Fail-open igual que siempre: si el mapa no se pudo leer, `exclusiva` queda
  // en false y se ofrecen todas — quedarse sin filtro es peor que ver de más.
  const ofrecidas = exclusiva ? vivas.filter((l) => mias.has(l.numero)) : vivas;

  res.json({
    lineas: ofrecidas.map((l) => ({
      numero: l.numero,
      etiqueta: etiquetas.get(l.numero)?.trim() || l.numero,
      estado: l.transporte.estado().estado,
      mias: mias.has(l.numero),
      compartida: compartidas.has(l.numero),
    })),
  });
}));

/** El hilo completo de una conversación, en orden cronológico + de dónde vino el lead. */
whatsappRouter.get('/conversacion/:telefono', ruta(async (req, res) => {
  const telefono = identidadDeParametro(req.params.telefono);
  // Con varias líneas vivas, la MISMA persona puede tener dos conversaciones que
  // para ella son dos chats distintos. Sin este scope las dos se ven como una, y
  // la respuesta puede salir por el número que el lead no conoce.
  const numeroPropio = typeof req.query.numeroPropio === 'string' ? req.query.numeroPropio : undefined;
  const mensajes = await hiloDe(db, telefono, numeroPropio);

  // La captura del embudo: si algún mensaje trajo el origen (anuncio/landing), se
  // devuelve — enriquecido con el nombre del anuncio y la campaña si vino de Meta.
  let origen: OrigenDelLead | null = await consultarOrigenDelLead(db, telefono, numeroPropio);
  if (origen?.fuente === 'anuncio' && origen.adId) {
    const anuncio = await resolverAnuncio(origen.adId);
    origen = { ...origen, ...(anuncio ? { anuncio: anuncio.anuncio, campana: anuncio.campana } : {}) };
  }

  /**
   * LAS REACCIONES, colgadas de su mensaje.
   *
   * Una consulta para todo el hilo (no una por burbuja) y **fuera de `hiloDe`**:
   * ese SQL ya carga dos LEFT JOIN para la marca de automático, y un tercero
   * agregando emojis lo volvería ilegible por un dato que casi siempre está
   * vacío. Acá se pega, que es donde se arma la respuesta.
   */
  const ids = mensajes.map((m) => String((m as { external_id: string }).external_id));

  /**
   * LOS MENSAJES CITADOS, resueltos en UNA segunda consulta.
   *
   * La cita viene del crudo del evento y trae solo un id (`cita.ts`): quién lo
   * dijo y qué decía se busca acá, contra `interactions`. No es un tercer JOIN
   * en `hiloDe` a propósito — sería un self-join sobre la tabla que esa consulta
   * ya está leyendo, para un dato que la mayoría de las filas no tiene.
   */
  const citados = [
    ...new Set(
      mensajes
        .map((m) => (m as { cita?: { mensajeExternalId?: string } | null }).cita?.mensajeExternalId)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];

  const [porMensaje, estados, citas, ediciones] = await Promise.all([
    reaccionesPorMensaje(db, ids, numeroPropio),
    // Los ✓✓ solo de los SALIENTES: preguntar por los entrantes sería pedirle a
    // `envios_wa` filas que por definición no tiene.
    estadosPorMensaje(
      db,
      mensajes.filter((m) => (m as { direccion?: string }).direccion === 'saliente').map((m) => String((m as { external_id: string }).external_id)),
    ),
    resolverCitados(db, citados),
    // LAS EDICIONES, colgadas de su mensaje — mismo criterio que las
    // reacciones: una consulta para todo el hilo, pegada acá y no adentro de
    // `hiloDe` (ver el comentario de arriba sobre reacciones).
    edicionesPorMensaje(db, ids),
  ]);
  const enriquecidos = mensajes.map((m) => {
    const fila = m as Record<string, unknown> & { external_id: string };
    const r = porMensaje.get(fila.external_id);
    const e = estados.get(fila.external_id);
    const ed = ediciones.get(fila.external_id);
    /**
     * 🔴 SI EL CITADO NO ESTÁ, SE DIBUJA EL HUECO — nunca se descarta el mensaje
     * ni se calla la cita. Que el mensaje al que alguien respondió sea anterior a
     * la vinculación del número (o de antes de que Hermes capturara citas) es lo
     * NORMAL las primeras semanas, y esconderlo haría que la respuesta se lea
     * como un mensaje suelto que no contesta nada.
     */
    const refCita = (fila.cita as { mensajeExternalId?: string } | null | undefined)?.mensajeExternalId;
    const cita = refCita
      ? (citas.get(refCita) ?? { mensajeExternalId: refCita, texto: null, direccion: null, mediaClase: null })
      : null;
    // Ausentes y no `[]`/`null`: el front distingue «no tiene» de «no se pudo
    // saber» sin tener que inventarse la diferencia. Un mensaje viejo, anterior
    // a este frente, no tiene estado — y no dibujar nada es más honesto que
    // afirmar un ✓ que nadie confirmó.
    return {
      ...fila,
      ...(r?.length ? { reacciones: r } : {}),
      ...(e ? { entrega: e } : {}),
      // El texto vigente (después de editar), aparte del `texto` original: la
      // burbuja lo prefiere y muestra «Editado» — igual que WhatsApp, que no
      // pisa el mensaje, lo marca.
      ...(ed ? { editado: { texto: ed.texto, editadoEn: ed.editadoAt } } : {}),
      // Se pisa la clave cruda del payload con la resuelta (o con `null`): lo que
      // el front recibe es siempre la forma de `CitaEnElHilo`, nunca el crudo.
      cita,
    };
  });

  res.json({ telefono, mensajes: enriquecidos, origen });
}));

/**
 * Marcar leído al abrir — y son DOS cosas, no una.
 *
 * ── Lo que faltaba ───────────────────────────────────────────────────────
 * Esta ruta mandaba los ticks azules al lead y **nada más**. El cursor de
 * lectura de la VENDEDORA (`estado_conversacion.leido_hasta`) lo movía otro
 * endpoint, que solo se disparaba desde el menú `···` de la fila. O sea: abrías
 * el chat, lo leías, salías, y **el punto azul de «sin leer» seguía puesto sobre
 * algo que ya habías leído**. El mecanismo estaba entero —columna, SQL, ruta— y
 * abrir el chat no lo usaba.
 *
 * ── 🔴 Lo que NO cambia, y es a propósito ────────────────────────────────
 * **La conversación no se mueve de lugar.** El orden de la cola es
 * `fijada → nivel de urgencia → antigüedad`, y `no_leido` no participa. Si el
 * lead escribió y nadie respondió, sigue siendo deuda y sigue arriba: **leer no
 * es atender**. Decisión del dueño del 7-ago-2026, y es lo que la cola existe
 * para garantizar — que mirar algo no lo haga desaparecer de la vista.
 *
 * El cursor necesita saber de QUÉ conversación se trata, y eso incluye la línea:
 * sin `numeroPropio` no se puede construir la clave, así que se mandan los ticks
 * igual y el cursor no se toca (en vez de avanzar el de una conversación
 * adivinada).
 */
whatsappRouter.post('/leido/:telefono', requiereVendedora, ruta(async (req, res) => {
  const telefono = identidadDeParametro(req.params.telefono);
  const numeroPropio = typeof req.query.numeroPropio === 'string' ? req.query.numeroPropio : undefined;

  // ── 1 · EL CURSOR PRIMERO. Es lo único que la vendedora está esperando. ──
  // Antes iba después de los ticks, y los ticks son una llamada de RED (whatsmeow
  // es un subprocess Go; la Cloud API es HTTP a Meta). O sea que apagar el punto
  // azul de SU cola esperaba a que WhatsApp le acusara los tildes al LEAD — dos
  // destinatarios que no tienen nada que ver, uno bloqueando al otro.
  let cursor = false;
  if (numeroPropio && req.vendedoraId) {
    try {
      await upsertEstado(db, req.vendedoraId, {
        clave: `conv:whatsapp:${telefono}:${normalizarTelefono(numeroPropio) ?? numeroPropio}`,
        leido: true,
      });
      cursor = true;
    } catch (e) {
      console.warn(`[leido] no se pudo avanzar el cursor de lectura: ${porQueFallo(e)}`);
    }
  }

  // ── 2 · Se responde YA. Los tildes salen después, sin nadie esperándolos. ──
  res.json({ ok: true, cursor });

  // ── 3 · Los tildes azules, fuera del camino crítico ──
  // Fire-and-forget a propósito: son cortesía hacia el lead y nadie del lado de
  // la vendedora depende de que salgan. Si tardan tres segundos o fallan, ella ya
  // vio su cola actualizada. Lo que NO se hace es saltearlos.
  void (async () => {
    try {
      const filas = await consultarEntrantesParaTildes(db, telefono, numeroPropio);
      // El external_id se guarda prefijado 'wa:'; el transporte quiere el id crudo.
      const ids = filas.map((f) => f.external_id.replace(/^wa:/, ''));
      // Los tildes tienen que salir POR LA LÍNEA a la que la persona escribió:
      // mandarlos por otra es, para ella, que un número desconocido le leyó el
      // mensaje. Sin `numeroPropio` se usa la primera, como siempre.
      const linea = numeroPropio ? gestorWhatsapp().de(numeroPropio) : whatsapp();
      await linea?.transporte.marcarLeido(telefono, ids);
    } catch {
      // Marcar leído es cortesía: si falla, no rompe nada. Y acá ya ni siquiera
      // hay una respuesta que arruinar.
    }
  })();
}));

/**
 * Responder. La ÚNICA vía de salida: pasa por `EnvioControlado`, que exige la
 * vendedora (del token), audita, y frena si la sesión está baneada.
 */
whatsappRouter.post('/enviar', requiereVendedora, ruta(async (req, res) => {
  const { numeroPropio, telefono, texto, referencia, citaDe } = req.body ?? {};

  // Mandar y persistir el saliente van juntos (`enviarYProyectar.ts`): un envío
  // que sale y no queda en el hilo es un mensaje fantasma, y la vendedora lo
  // manda de nuevo. Las plantillas-secuencia usan la MISMA función.
  //
  // `citaDe` es el `external_id` del mensaje al que se responde, y NADA MÁS: de
  // quién era y qué decía lo resuelve el server contra lo que ya guardó. Ver el
  // porqué en `whatsapp/citaRepositorio.ts` — es un dato que el LEAD va a ver, y
  // por eso se resuelve ACOTADO A ESTA CONVERSACIÓN: el id viene del navegador.
  const r = await enviarTextoYProyectar({
    vendedoraId: req.vendedoraId!,
    numeroPropio: String(numeroPropio ?? ''),
    telefono: String(telefono ?? ''),
    texto: String(texto ?? ''),
    referencia: String(referencia ?? ''),
    cita: await resolverCitaSaliente(db, typeof citaDe === 'string' ? citaDe : null, {
      telefono: String(telefono ?? ''),
      numeroPropio: String(numeroPropio ?? '') || null,
    }),
    procedencia: await procedenciaDelComposer(req.body?.pieza, leerPasoDeSecuencia(req.vendedoraId!)),
  });

  if (!r.ok) {
    res.status(409).json({ ok: false, message: r.motivo });
    return;
  }

  // La persona ganó de mano a la máquina: si había una auto-respuesta en cola
  // para esta conversación, se cancela (#125). Va acá, en el momento exacto en
  // que deja de hacer falta, y no rompe el envío si el esquema no está.
  // (La proyección del saliente ya la hizo `enviarTextoYProyectar`.)
  await cancelarPorRespuestaHumana(db, String(referencia ?? ''));

  res.json({ ok: true, idExterno: r.idExterno });
}));

/**
 * Servir un adjunto ya descargado. El nombre se valida contra una lista blanca
 * de caracteres: nada de `..`, nada de rutas — un nombre de archivo o un 404.
 */
whatsappRouter.get('/media/:archivo', (req, res) => {
  const archivo = req.params.archivo;
  if (!/^[A-Za-z0-9._-]+$/.test(archivo) || archivo.includes('..')) {
    res.status(400).json({ ok: false, message: 'nombre de archivo inválido' });
    return;
  }
  const ruta = join(RUTA_MEDIA, archivo);
  if (!existsSync(ruta)) {
    res.status(404).json({ ok: false, message: 'ese archivo no está (¿media vieja de antes de los adjuntos?)' });
    return;
  }
  res.sendFile(ruta);
});

/**
 * La FOTO DE PERFIL de un contacto de WhatsApp, cacheada. Detrás de auth: la foto
 * es PII. On-demand — se trae al abrir el contacto, una vez, y se guarda en disco
 * como la media. `archivo` null en cache = ya preguntamos y no tiene → 404 sin
 * volver a molestar a WhatsApp hasta que caduque (una semana). El front cae a las
 * iniciales ante cualquier 404/error.
 *
 * Ese cache de negativo SOLO es válido si de verdad preguntamos. Si el transporte
 * no pudo (`FotoNoDisponibleError`: sesión no conectada, típicamente justo tras un
 * restart del server mientras whatsmeow reconecta) se responde 503 y NO se
 * guarda nada — de lo contrario cada restart envenenaría la caché por 7 días
 * para cualquier contacto consultado en ese hueco (hallazgo de la revisión del
 * PR #75).
 *
 * `numeroPropio` es opcional por retrocompatibilidad (un caché de front viejo,
 * ADR 0007, puede no mandarlo), pero cuando viene se respeta: sin él, esto
 * consulta SIEMPRE por `whatsapp()` = la primera línea armada, y con más de una
 * línea whatsmeow eso filtra la foto de un contacto de una línea hacia la cuenta
 * de otra. Con `numeroPropio` que no resuelve a una línea montada no se cae al
 * primero (mismo criterio que `GestorWhatsapp.de()`): 503, nunca una consulta
 * adivinada.
 */
const FOTO_FRESCA_MS = 7 * 24 * 60 * 60 * 1000;

whatsappRouter.get('/foto/:telefono', requiereVendedora, ruta(async (req, res) => {
  const telefono = normalizarTelefono(req.params.telefono);
  if (!telefono) {
    res.status(400).json({ ok: false, message: 'teléfono inválido' });
    return;
  }
  const numeroPropio = typeof req.query.numeroPropio === 'string' ? req.query.numeroPropio : undefined;

  const cache = await leerFotoDePerfilCacheada(db, telefono);
  const fresca = cache && Date.now() - cache.actualizadoAt.getTime() < FOTO_FRESCA_MS;

  if (fresca) {
    if (!cache.archivo) {
      res.status(404).end(); // ya sabíamos que no tiene foto
      return;
    }
    const ruta = join(RUTA_MEDIA, cache.archivo);
    if (existsSync(ruta)) {
      res.sendFile(ruta);
      return;
    }
    // el archivo se perdió del disco: caemos a re-traer abajo.
  }

  const linea = numeroPropio ? gestorWhatsapp().de(numeroPropio) : whatsapp();
  if (!linea) {
    res.status(503).json({ ok: false, message: `la línea ${numeroPropio} no está montada ahora mismo` });
    return;
  }
  const transporte = linea.transporte;
  let foto: FotoPerfil | null;
  try {
    foto = transporte.fotoDePerfil ? await transporte.fotoDePerfil(telefono) : null;
  } catch (err) {
    if (err instanceof FotoNoDisponibleError) {
      // No pudimos preguntar (sesión no conectada / falla de conexión): 503, sin
      // tocar la caché. Un negativo acá sería «no tiene foto» durante 7 días
      // sobre un contacto que ni siquiera llegamos a consultar.
      res.status(503).json({ ok: false, message: 'no se pudo consultar la foto ahora mismo, reintentá en un momento' });
      return;
    }
    throw err;
  }

  const guardar = (fotoId: string | null, archivo: string | null, mime: string | null) =>
    guardarFotoDePerfil(db, telefono, fotoId, archivo, mime);

  if (!foto) {
    await guardar(null, null, null); // cachear "no tiene foto"
    res.status(404).end();
    return;
  }

  const archivo = `pfp-${telefono}.${foto.mime.includes('png') ? 'png' : 'jpg'}`;
  await writeFile(join(RUTA_MEDIA, archivo), foto.bytes);
  await guardar(foto.id, archivo, foto.mime);

  res.setHeader('content-type', foto.mime);
  res.setHeader('cache-control', 'private, max-age=3600');
  res.send(foto.bytes);
}));

/**
 * REACCIONAR a un mensaje del lead. Emoji vacío = quitar.
 *
 * No pasa por `EnvioControlado` a propósito y el porqué está en
 * `reacciones/enviar.ts`: una reacción no es un mensaje, no tiene pieza que
 * estampar, y contarla contra el ritmo le robaría cupo a los envíos de verdad.
 * Lo que sí conserva es la guarda de sesión: con la línea caída o baneada, no
 * sale.
 */
whatsappRouter.post('/reaccionar', requiereVendedora, express.json(), ruta(async (req, res) => {
  const { telefono, numeroPropio, mensajeId, emoji } = (req.body ?? {}) as Record<string, string>;
  const linea = gestorWhatsapp().de(String(numeroPropio ?? ''));
  if (!linea) {
    res.status(409).json({ ok: false, message: 'esa línea no está corriendo' });
    return;
  }
  const r = await reaccionar(db, linea.transporte, {
    numeroPropio: String(numeroPropio ?? ''),
    telefono: String(telefono ?? '').replace(/\D/g, ''),
    mensajeId: String(mensajeId ?? '').replace(/^wa:/, ''),
    emoji: String(emoji ?? ''),
  });
  if (!r.ok) {
    res.status(409).json({ ok: false, message: r.motivo });
    return;
  }
  res.json({ ok: true, quitada: r.quitada });
}));

/**
 * EDITAR el texto de un mensaje SALIENTE ya mandado. Hoy solo whatsmeow puede
 * (`transporte.editarTexto?`, ausente en Cloud API): `editarMensaje` devuelve
 * el motivo redactado si esta línea no lo tiene, y la ruta lo pasa tal cual.
 *
 * No pasa por `EnvioControlado`, mismo argumento que `/reaccionar`: corrige
 * algo que ya le llegó a esa persona, no le manda nada a alguien nuevo.
 */
whatsappRouter.post('/editar', requiereVendedora, express.json(), ruta(async (req, res) => {
  const { telefono, numeroPropio, mensajeId, texto } = (req.body ?? {}) as Record<string, string>;
  const linea = gestorWhatsapp().de(String(numeroPropio ?? ''));
  if (!linea) {
    res.status(409).json({ ok: false, message: 'esa línea no está corriendo' });
    return;
  }
  const r = await editarMensaje(db, linea.transporte, {
    numeroPropio: String(numeroPropio ?? ''),
    telefono: String(telefono ?? '').replace(/\D/g, ''),
    mensajeId: String(mensajeId ?? '').replace(/^wa:/, ''),
    textoNuevo: String(texto ?? ''),
  });
  if (!r.ok) {
    res.status(409).json({ ok: false, message: r.motivo });
    return;
  }
  res.json({ ok: true });
}));

/**
 * Enviar un adjunto (imagen, video, audio o documento). El cuerpo es el archivo
 * CRUDO (Content-Type = su mime); los metadatos van en la query. Pasa por la
 * MISMA puerta que el texto: EnvioControlado, con vendedora y auditoría.
 */
whatsappRouter.post(
  '/enviar-media',
  requiereVendedora,
  express.raw({ type: () => true, limit: '64mb' }),
  ruta(async (req, res) => {
    const { telefono, numeroPropio, referencia, caption, nombre } = req.query as Record<string, string | undefined>;
    const mime = req.headers['content-type'] ?? 'application/octet-stream';
    const bytes = req.body as Buffer;

    if (!bytes?.length) {
      res.status(400).json({ ok: false, message: 'el cuerpo tiene que ser el archivo crudo' });
      return;
    }

    const clase = claseDeMime(mime);

    // ── EL TOPE, ANTES DE GASTAR NADA ──
    // Los límites son de la LÍNEA, no de Hermes: 16 MB de video es de la Cloud
    // API, y las líneas whatsmeow no lo tienen. Verificar acá —antes de escribir
    // el archivo y antes de subirlo a Meta— es lo que evita pagar la subida de
    // 18 MB para recibir un `fbtrace_id` que la vendedora no puede leer.
    // Ver `whatsapp/limitesMedia.ts`.
    const linea = gestorWhatsapp().de(String(numeroPropio ?? ''));
    const motivo = motivoPorTamano(clase, bytes.length, limitesDe(linea?.transporte.nombre ?? 'whatsmeow'));
    if (motivo) {
      res.status(409).json({ ok: false, message: motivo, codigo: 'adjunto_muy_pesado' });
      return;
    }

    // Se guarda primero: el archivo enviado también es parte de la conversación.
    const archivo = nombreSeguro(`out-${Date.now()}-${nombre || 'archivo'}`);
    await writeFile(join(RUTA_MEDIA, archivo), bytes);

    const media: MediaSaliente = {
      ruta: join(RUTA_MEDIA, archivo),
      clase,
      mime,
      nombre: nombre || null,
      texto: caption || null,
    };

    const r = await enviarMediaYProyectar({
      vendedoraId: req.vendedoraId!,
      numeroPropio: String(numeroPropio ?? ''),
      telefono: String(telefono ?? ''),
      referencia: String(referencia ?? ''),
      media,
      archivo,
    });

    if (!r.ok) {
      res.status(409).json({ ok: false, message: r.motivo });
      return;
    }

    // Mandar un adjunto también es responder: cancela la automática en cola.
    // (La proyección del saliente ya la hizo `enviarMediaYProyectar`.)
    await cancelarPorRespuestaHumana(db, String(referencia ?? ''));

    res.json({ ok: true, idExterno: r.idExterno });
  }),
);
