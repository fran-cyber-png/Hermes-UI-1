import { asc, desc, eq, sql } from 'drizzle-orm';
import type { db as Base } from '../db/client.js';
import { correos, remitentesCorreo } from '../db/schema.js';
import { porQueFallo } from '../lib/porQueFallo.js';
import type { Remitente } from './remitente.js';
import type { ConteosDeRitmo } from './ritmo.js';

/**
 * LO QUE ESTE FRENTE LE PREGUNTA Y LE ESCRIBE A LA BASE.
 *
 * Es un SEAM: `db` entra como primer argumento —la ruta le pasa el singleton, el
 * test su base de prueba (ADR 0008)—, igual que `entrega/repositorio.ts` y
 * `reacciones/repositorio.ts`. Acá no vive ninguna regla: el destinatario lo
 * decide `destinatario.ts`, el sobre `remitente.ts`, el dominio verificado
 * `verificado.ts` y el techo `ritmo.ts`. Los cuatro son puros **porque este
 * archivo existe**: sin un lugar donde meter la base, la regla se les cuela
 * adentro y deja de poder interrogarse sin levantar Postgres.
 *
 * ══ EL AGUJERO QUE `listarCorreos` VIENE A TAPAR (H4) ═══════════════════════
 *
 * 🔴 **`db.select().from(correos)` MANDABA EL CUERPO DE TODOS LOS CORREOS DEL
 * EQUIPO A CADA VENDEDORA.** Sin proyección, drizzle sirve las nueve columnas, y
 * `cuerpo` es lo que una persona le escribió a un lead: la cotización, el precio,
 * lo que le prometió. La pantalla no lo dibujaba —y por eso nadie lo vio— pero
 * **un recorte dibujado en el navegador no existe**: los datos ya viajaron, ya
 * están en el caché de IndexedDB (ADR 0007) y ya salieron en cualquier captura de
 * la pestaña de red. Es exactamente lo que ADR 0035 y 0036 prohíben.
 *
 * Por eso las dos lecturas son distintas a propósito: `listarCorreos` **enumera
 * columna por columna y no incluye `cuerpo`**, y `leerCorreo` sí lo trae. La
 * diferencia entre las dos no es cuánto devuelven: es que **el cuerpo se pide, no
 * se recibe de yapa**.
 *
 * ⚠️ Y enumerar tiene un segundo efecto que es el que la hace sostenible: una
 * columna nueva del schema **nace fuera de la lista**. Con `select()` a secas
 * nace servida a todo el equipo, y quien la agrega ni se entera.
 *
 * ══ CÓMO DEGRADA, Y HACIA QUÉ LADO ═════════════════════════════════════════
 *
 * Sin la migración 0029 (`remitentes_correo` y las cuatro columnas nuevas de
 * `correos` vienen juntas), esto **degrada hacia LO DE ANTES**: `listarRemitentes`
 * avisa por log y devuelve `[]`, así que la pantalla no tiene remitente que
 * ofrecer y el envío se queda como el 21-jul — un `SMTP_FROM` para las nueve. Las
 * lecturas de `correos` se sirven sin las columnas del sobre, y ahí el hueco **no
 * miente**: sin la migración ningún correo pudo salir con remitente (ver
 * `guardarCorreo`), así que `desde: null` es la verdad y no un «no se pudo
 * preguntar».
 *
 * El criterio es el de `reacciones/repositorio.ts` —acá el consumidor es una
 * persona, y una lista de correos sin la columna del remitente sigue siendo la
 * lista— y **no** el del catálogo de piezas (ADR 0023), donde el consumidor es un
 * índice que cachea y media respuesta honesta se vuelve una mentira.
 *
 * ⚠️ Lo que **no** degrada es `conteosDeRitmo`: ahí «no pude contar» tendría que
 * devolver cero, o sea dejar mandar, y un techo que se abre solo cuando la base
 * hipa es la definición de teatro. Ver su docblock.
 */

/** Una fila de `correos` entera, cuerpo incluido. La sirve `leerCorreo`, nadie más. */
export type FilaCorreo = typeof correos.$inferSelect;

/** Una fila de `remitentes_correo`. */
export type FilaRemitente = typeof remitentesCorreo.$inferSelect;

/**
 * Los dos estados que este frente escribe.
 *
 * ⚠️ **`enviado` significa «SES aceptó el POST», no «llegó»** (H5). El rebote, el
 * buzón lleno y la queja de spam pasan DESPUÉS y sin webhook de bounce no hay
 * forma de enterarse — es el mismo hueco que tenían los ✓✓ antes de la migración
 * 0021. Lo único que acorta la distancia es `idExterno`, que sirve para cruzar
 * esta fila contra los logs de SES y para nada más.
 */
export type EstadoCorreo = 'enviado' | 'fallido';

/**
 * Un correo como lo ve la lista del equipo: **sin `cuerpo`**.
 *
 * Se declara a mano en vez de derivarlo del schema para que el `tsc` cruce esta
 * forma contra la proyección de abajo: si alguien agrega una columna al `select`,
 * tiene que agregarla acá y **decidir** que la lista la sirve.
 */
export interface CorreoDeLaLista {
  id: number;
  vendedoraId: string;
  para: string;
  asunto: string;
  clave: string | null;
  estado: string;
  motivo: string | null;
  creadoAt: Date;
  remitenteId: number | null;
  desde: string | null;
  responderA: string | null;
  idExterno: string | null;
}

/** Las columnas que existen desde el 21-jul-2026, o sea las que hay pase lo que pase. */
const COLUMNAS_DE_SIEMPRE = {
  id: correos.id,
  vendedoraId: correos.vendedoraId,
  para: correos.para,
  asunto: correos.asunto,
  clave: correos.clave,
  estado: correos.estado,
  motivo: correos.motivo,
  creadoAt: correos.creadoAt,
} as const;

/** Las de la migración 0029: con qué sobre salió ese correo. */
const COLUMNAS_DEL_SOBRE = {
  remitenteId: correos.remitenteId,
  desde: correos.desde,
  responderA: correos.responderA,
  idExterno: correos.idExterno,
} as const;

/**
 * El sobre que no se pudo leer.
 *
 * No es «no sabemos»: sin la migración el INSERT de un correo con remitente
 * habría fallado entero, así que estos cuatro nulos son el estado real de todas
 * las filas que puedan existir en esa base.
 */
const SIN_SOBRE = {
  remitenteId: null,
  desde: null,
  responderA: null,
  idExterno: null,
} as const;

/** Tope duro de la lista: la pantalla pide una página, no la auditoría entera. */
const TOPE_LISTA = 200;

/**
 * 🔴 EL `code` DE POSTGRES **NO** ESTÁ EN EL ERROR: ESTÁ EN `err.cause`.
 *
 * Es la misma cicatriz que `porQueFallo`, entrando por la otra puerta. drizzle
 * envuelve TODA consulta fallida en un `DrizzleQueryError` cuyo `message` es el
 * SQL y cuya `cause` es el error del driver (`drizzle-orm/errors.js:12`,
 * verificado contra la versión instalada, 0.45.2 — y el envoltorio está en los
 * cinco caminos de `pg-core/session.js`). O sea que un
 * `(e as { code?: string }).code === '42P01'` da **`undefined` siempre**: la
 * degradación no se dispara nunca y en vez de una lista vacía con su log, la
 * pantalla se come un 500.
 *
 * ⚠️ Se recorre la cadena en vez de mirar un solo nivel porque quien envuelve no
 * es siempre el mismo: un error de transacción trae otro adentro. Y se mira
 * también el error de afuera, para el día que el driver deje de envolver.
 */
function codigoDeError(e: unknown): string | undefined {
  let actual: unknown = e;
  for (let salto = 0; salto < 4 && actual; salto += 1) {
    const codigo = (actual as { code?: unknown }).code;
    if (typeof codigo === 'string' && codigo !== '') return codigo;
    actual = (actual as { cause?: unknown }).cause;
  }
  return undefined;
}

/** 42P01 = undefined_table. Falta la migración 0029, no es que la base esté caída. */
function faltaLaTabla(e: unknown): boolean {
  return codigoDeError(e) === '42P01';
}

/** 42703 = undefined_column. Idem: las cuatro columnas del sobre no están todavía. */
function faltaLaColumna(e: unknown): boolean {
  return codigoDeError(e) === '42703';
}

/** 23505 = unique_violation. Acá solo puede ser el índice de `lower(direccion)`. */
function esDireccionRepetida(e: unknown): boolean {
  return codigoDeError(e) === '23505';
}

/**
 * LOS ÚLTIMOS CORREOS DEL EQUIPO, **SIN EL CUERPO**.
 *
 * Sin `WHERE vendedora_id`, a propósito y como siempre: esto se mira para no
 * escribirle dos veces a la misma persona, y para eso hacen falta los de las
 * otras. Lo que cambia con H4 es **qué** se comparte: a quién, cuándo, con qué
 * sobre y si salió — nunca lo que se le dijo.
 *
 * ⚠️ El desempate va por `id` y no es adorno: dos correos del mismo segundo
 * quedan en orden arbitrario, y una lista que se reordena sola entre dos
 * refrescos se lee como que se mandó algo dos veces.
 */
export async function listarCorreos(
  base: typeof Base,
  limite = 50,
): Promise<CorreoDeLaLista[]> {
  const tope = Math.min(Math.max(Math.trunc(limite), 1), TOPE_LISTA);

  try {
    return await base
      .select({ ...COLUMNAS_DE_SIEMPRE, ...COLUMNAS_DEL_SOBRE })
      .from(correos)
      .orderBy(desc(correos.creadoAt), desc(correos.id))
      .limit(tope);
  } catch (e) {
    if (!faltaLaColumna(e)) throw e;
    console.warn(
      `[correos] falta la migración 0029: la lista va sin el sobre — ${porQueFallo(e)}`,
    );
    const filas = await base
      .select(COLUMNAS_DE_SIEMPRE)
      .from(correos)
      .orderBy(desc(correos.creadoAt), desc(correos.id))
      .limit(tope);
    return filas.map((f) => ({ ...f, ...SIN_SOBRE }));
  }
}

/**
 * UN correo, cuerpo incluido.
 *
 * Existe para que la auditoría sea completa: cuando alguien pregunta «¿qué le
 * dijimos?», la respuesta tiene que existir en algún lado. La diferencia con
 * `listarCorreos` **no es el volumen, es quién lo pide**: acá hay una persona
 * abriendo un correo puntual, allá hay una pantalla que se refresca sola.
 */
export async function leerCorreo(base: typeof Base, id: number): Promise<FilaCorreo | null> {
  try {
    const [fila] = await base.select().from(correos).where(eq(correos.id, id)).limit(1);
    return fila ?? null;
  } catch (e) {
    if (!faltaLaColumna(e)) throw e;
    console.warn(`[correos] falta la migración 0029: el correo va sin el sobre — ${porQueFallo(e)}`);
    const [fila] = await base
      .select({ ...COLUMNAS_DE_SIEMPRE, cuerpo: correos.cuerpo })
      .from(correos)
      .where(eq(correos.id, id))
      .limit(1);
    return fila ? { ...fila, ...SIN_SOBRE } : null;
  }
}

/** Qué se le pide a `listarRemitentes`. Por default, solo lo que se puede elegir. */
export interface FiltroDeRemitentes {
  /**
   * `true` = también los retirados. Es para la pantalla de administración, que es
   * el único lugar donde apagar tiene que poder deshacerse: `leerCatalogo` de
   * `hechos` filtraba por `activo` y nada podía volver a prender un dato apagado.
   */
  incluirInactivos?: boolean;
}

/**
 * LOS REMITENTES QUE SE PUEDEN ELEGIR.
 *
 * 🔴 **Degrada a `[]` con su log, y ese `[]` es lo que apaga el frente entero
 * hacia LO DE ANTES.** Sin remitentes no hay a quién elegir, la pantalla no
 * ofrece ninguno y el envío se comporta como el 21-jul. Es degradar hacia MENOS
 * —el molde de `espacios/visibilidad.ts`—, nunca hacia más.
 *
 * ⚠️ Solo `42P01` se traga. Un fallo de conexión **no** es «no hay remitentes»:
 * con eso adentro del mismo `catch`, un hipo de Postgres retiraría en silencio
 * todos los remitentes y la pantalla diría que nadie dio ninguno de alta.
 *
 * ⚠️ El orden es por `lower(nombre)`: con el orden crudo, «escuela» cae después
 * de «Ventas» en cualquier collation que ordene por byte, y un selector que
 * ordena por la mayúscula parece desordenado.
 */
export async function listarRemitentes(
  base: typeof Base,
  filtro: FiltroDeRemitentes = {},
): Promise<FilaRemitente[]> {
  try {
    return await base
      .select()
      .from(remitentesCorreo)
      .where(filtro.incluirInactivos ? undefined : eq(remitentesCorreo.activo, true))
      .orderBy(sql`lower(${remitentesCorreo.nombre})`, asc(remitentesCorreo.id));
  } catch (e) {
    if (!faltaLaTabla(e)) throw e;
    console.warn(
      `[correos] \`remitentes_correo\` no existe todavía: se sirve la lista vacía — ${porQueFallo(e)}`,
    );
    return [];
  }
}

/**
 * La fila por id **sin mirar si está activa** — la que hace falta para volver a
 * prenderla.
 *
 * ⚠️ Es la excepción a `leerRemitente`, y las dos tienen que existir: aquélla
 * filtra por `activo` porque su pregunta es «¿con esto se puede MANDAR?», y ésta
 * no puede filtrar porque su pregunta es «¿qué buzón es el que estoy por
 * reactivar?» — un retirado es exactamente el caso. Colapsarlas en una deja sin
 * poder chequear el dominio justo en el camino que lo necesita.
 */
export async function filaPorId(base: typeof Base, id: number): Promise<FilaRemitente | null> {
  const [fila] = await base
    .select()
    .from(remitentesCorreo)
    .where(eq(remitentesCorreo.id, id))
    .limit(1);
  return fila ?? null;
}

/**
 * EL REMITENTE CON EL QUE SE VA A MANDAR — y por eso **filtra por `activo`**.
 *
 * 🔴 Un remitente retirado y uno que no existe contestan lo MISMO (`null`), como
 * el token cortado y el inexistente de ADR 0047. Si esta función devolviera la
 * fila apagada y le dejara al que llama la tarea de mirar `activo`, la baja
 * lógica sería exactamente el teatro de `numeros_wa.activo`: una columna que se
 * escribe, se muestra y **no retira nada**. Acá `activo` tiene un lector, y es
 * éste. Para verlos todos —incluida la pantalla que los vuelve a prender— está
 * `listarRemitentes({ incluirInactivos: true })`.
 *
 * ⚠️ **El tipo del retorno es un candado, no una firma rebuscada.** La fila de la
 * tabla es lo que `armarSobre` recibe como `Remitente`, sin un mapeo en el medio
 * que pueda perder un campo; declarar la intersección hace que el compilador lo
 * verifique acá — el día que `Remitente` pida un dato que la tabla no tiene, esto
 * no compila, en vez de fallar armando un sobre incompleto.
 */
export async function leerRemitente(
  base: typeof Base,
  id: number,
): Promise<(FilaRemitente & Remitente) | null> {
  const fila = await filaPorId(base, id);
  return fila && fila.activo ? fila : null;
}

/** Lo que hace falta para dar de alta un remitente. */
export interface RemitenteNuevo {
  /**
   * ⚠️ **Tiene que venir ya aprobada por `puedeSerRemitente`.** Este módulo no
   * lee el entorno —es un seam de base, no de política— así que no puede
   * preguntarlo, y un remitente escrito sin esa pregunta se ve idéntico a uno
   * bueno hasta el 554 del primer envío, con un lead esperando.
   */
  direccion: string;
  nombre: string;
  responderA?: string | null;
  firma?: string | null;
  /** Qué supervisor lo dio de alta. Se guarda la grafía que vino, sin reescribir. */
  creadoPor: string;
}

/**
 * El alta salió, o chocó con uno que ya está.
 *
 * 🔴 No se deja propagar el `23505` crudo: al que llama le llegaría como «se
 * rompió» y contestaría un 500. Y lo que pasó no es un error del sistema — es que
 * **ese buzón ya está dado de alta, quizá con otra grafía**: el índice es sobre
 * `lower(direccion)`, así que la fila que choca puede no verse igual a la que el
 * operador acaba de escribir. Sin este motivo, la pantalla no tiene cómo
 * explicarle por qué le rebotó algo que en la lista no aparece igual.
 */
export type AltaDeRemitente =
  | { ok: true; remitente: FilaRemitente }
  | { ok: false; motivo: 'ya_existe' };

export async function crearRemitente(
  base: typeof Base,
  nuevo: RemitenteNuevo,
): Promise<AltaDeRemitente> {
  try {
    const [fila] = await base
      .insert(remitentesCorreo)
      .values({
        direccion: nuevo.direccion,
        nombre: nuevo.nombre,
        responderA: nuevo.responderA ?? null,
        firma: nuevo.firma ?? null,
        creadoPor: nuevo.creadoPor,
      })
      .returning();
    return { ok: true, remitente: fila };
  } catch (e) {
    if (esDireccionRepetida(e)) return { ok: false, motivo: 'ya_existe' };
    throw e;
  }
}

/**
 * Lo que se puede cambiar de un remitente.
 *
 * 🔴 **`direccion` NO está y no es un olvido: es la identidad.** Es lo que se
 * chequeó contra los dominios verificados al DAR DE ALTA (`verificado.ts`, que
 * corre ahí y en ningún otro lado) y es lo que ya viajó en el `desde` de cada
 * correo que salió por él. Editarla es la puerta de atrás para meter un dominio
 * sin verificar sin pasar por el único control que existe — el 554 aparecería
 * después, en el correo de otra persona. Mismo criterio que `hechos.clave`: se
 * propone al crear y después se congela. Para cambiar de buzón se da de alta otro
 * y se retira éste.
 *
 * ⚠️ `activo` sí está, y ése es el camino de vuelta: sin él, `desactivarRemitente`
 * sería para siempre desde la app.
 */
export interface CambiosDeRemitente {
  nombre?: string;
  responderA?: string | null;
  firma?: string | null;
  activo?: boolean;
}

/**
 * Edita lo editable. `null` = «no existe ese id», nunca «no se pudo».
 *
 * ⚠️ Solo se tocan las claves que VINIERON: mandar `firma: undefined` no es
 * mandar `firma: null`. Lo primero es silencio (la firma queda como estaba), lo
 * segundo es sacarla — y con un `set` armado a lo bruto, editar solo el nombre le
 * borraba la firma al remitente sin que nadie lo pidiera.
 *
 * ⚠️ Sin un solo cambio devuelve la fila tal cual: `.set({})` es un error de
 * drizzle, y «no cambiaste nada» no es «no existe».
 */
export async function editarRemitente(
  base: typeof Base,
  id: number,
  cambios: CambiosDeRemitente,
): Promise<FilaRemitente | null> {
  const set: CambiosDeRemitente = {};
  if (cambios.nombre !== undefined) set.nombre = cambios.nombre;
  if (cambios.responderA !== undefined) set.responderA = cambios.responderA;
  if (cambios.firma !== undefined) set.firma = cambios.firma;
  if (cambios.activo !== undefined) set.activo = cambios.activo;

  if (Object.keys(set).length === 0) return await filaPorId(base, id);

  const [fila] = await base
    .update(remitentesCorreo)
    .set(set)
    .where(eq(remitentesCorreo.id, id))
    .returning();
  return fila ?? null;
}

/**
 * RETIRAR UN REMITENTE ES BAJA LÓGICA, NUNCA UN `DELETE`.
 *
 * 🔴 Con el `DELETE`, los correos que ya salieron por él se quedan con un
 * `remitente_id` que no apunta a ninguna fila: la auditoría pierde de qué buzón
 * salió justo cuando alguien pregunta por uno viejo. Es el mismo criterio que
 * `alias_curso` (`activo = false`, nunca DELETE) y por el mismo motivo — lo que
 * ya se usó no se puede desaparecer para limpiar una lista.
 *
 * Devuelve `false` solo si ese id no existe. Apagar dos veces devuelve `true` las
 * dos: es idempotente a propósito, porque «ya estaba apagado» no es un error que
 * la pantalla tenga que contar.
 */
export async function desactivarRemitente(base: typeof Base, id: number): Promise<boolean> {
  const filas = await base
    .update(remitentesCorreo)
    .set({ activo: false })
    .where(eq(remitentesCorreo.id, id))
    .returning({ id: remitentesCorreo.id });
  return filas.length > 0;
}

const UNA_HORA_MS = 60 * 60 * 1000;
const UN_DIA_MS = 24 * UNA_HORA_MS;

/**
 * CUÁNTOS CORREOS YA MANDÓ ESTA VENDEDORA — la munición de `frenoDeRitmo`.
 *
 * ══ POR QUÉ NO DEGRADA ═══════════════════════════════════════════════════
 *
 * 🔴 Un `catch` que devolviera `{ 0, 0 }` sería un techo que **se abre solo
 * cuando la base hipa**, y el techo es lo único que convierte «nada masivo» en
 * una propiedad del código (ver `ritmo.ts`). Acá degradar es degradar hacia MÁS,
 * que es justo lo contrario de lo que hace `listarRemitentes`. Y no hay caso de
 * «falta la migración»: `correos` existe desde el 21-jul-2026 y las tres columnas
 * que esta consulta toca son de entonces, así que un error acá **es** un problema
 * de base y tiene que llegar como tal.
 *
 * ══ LA VENTANA ES RODANTE, Y LOS TECHOS SON LOS MISMOS ═══════════════════
 *
 * ⚠️ Los números salen de `ritmo.ts` (20/hora, 60/día, los de WhatsApp), pero la
 * FORMA de la ventana no es la misma y conviene saberlo: la auto-respuesta cuenta
 * por hora y día **de calendario** en Lima porque planifica hacia adelante y
 * necesita saber cuándo se destraba; acá se cuenta hacia atrás desde `ahora`.
 * Dos motivos:
 *   · con baldes de calendario, 20 a las 10:59 y 20 a las 11:00 son 40 correos en
 *     dos minutos, y el techo no dice una palabra;
 *   · un «día» de calendario obliga a elegir zona horaria, y con la del server el
 *     contador diario se reiniciaría a media tarde de Lima.
 *
 * ⚠️ **`ahora` entra como argumento** (reloj inyectado): sin eso el test tendría
 * que esperar una hora, y las dos ventanas se medirían contra dos instantes
 * distintos. Por lo mismo van las dos en UNA consulta con `FILTER`: son dos
 * preguntas sobre la misma foto.
 *
 * ⚠️ **El `vendedora_id` se compara con `lower()` de los DOS lados.** En
 * producción el mismo humano tiene dos grafías vivas (`Luz`/`luz`,
 * `Usuario1`/`usuario1`): comparando exacto no hay error, hay un techo que no
 * cuenta los envíos de la propia persona — o sea, ninguno. El gemelo en TS es
 * `mismaVendedora` (`reparto/destino.ts`).
 *
 * ⚠️ Y las fechas viajan como ISO con su `::timestamptz`: un `Date` crudo adentro
 * de un template de drizzle lo rechaza postgres.js («The "string" argument…»), que
 * es lo que mató todos los ✓✓ en producción (`entrega/repositorio.ts`).
 */
export async function conteosDeRitmo(
  base: typeof Base,
  vendedoraId: string,
  ahora: Date,
): Promise<ConteosDeRitmo> {
  const quien = vendedoraId.trim().toLowerCase();
  const desdeLaHora = new Date(ahora.getTime() - UNA_HORA_MS).toISOString();
  const desdeElDia = new Date(ahora.getTime() - UN_DIA_MS).toISOString();

  const filas = await base.execute<{ ultima_hora: string | number; ultimo_dia: string | number }>(sql`
    SELECT
      count(*) FILTER (WHERE creado_at >= ${desdeLaHora}::timestamptz) AS ultima_hora,
      count(*) FILTER (WHERE creado_at >= ${desdeElDia}::timestamptz) AS ultimo_dia
      FROM correos
      -- Solo lo que SALIO: un intento fallido no gasto cupo de nadie, y contarlo
      -- dejaria a la vendedora frenada por correos que el lead nunca recibio.
     WHERE estado = 'enviado'
       AND lower(btrim(vendedora_id)) = ${quien}
  `);

  const fila = filas[0];
  return {
    // `count(*)` es un `bigint` y postgres.js lo devuelve como texto para no
    // perder precisión: sin el `Number`, `'20' >= 20` compara cadenas y el techo
    // se comporta distinto según el dígito.
    ultimaHora: Number(fila?.ultima_hora ?? 0),
    ultimoDia: Number(fila?.ultimo_dia ?? 0),
  };
}

/**
 * Lo que se audita de un correo. Es lo mismo para el que salió y para el que no:
 * lo único que los separa es `estado` (y `motivo`, que solo existe cuando algo se
 * rompió). Un intento que no salió es un dato, no un silencio.
 */
export interface CorreoAGuardar {
  vendedoraId: string;
  para: string;
  asunto: string;
  /** El cuerpo **con la firma ya pegada** (`componerCuerpo`): se audita lo que salió. */
  cuerpo: string;
  /**
   * La conversación de origen.
   *
   * 🔴 Es requerido aunque acepte `null`, y esa es toda la intención: hoy
   * `correos.clave` está en `null` en las tres filas de producción, así que **un
   * correo no aparece en ningún timeline ni en ninguna medición** (H7). Con la
   * clave opcional, quien cablee el correo desde la ficha se olvida y el agujero
   * sigue; siendo un campo que hay que contestar, hay que decidirlo.
   */
  clave: string | null;
  estado: EstadoCorreo;
  motivo?: string | null;
  remitenteId?: number | null;
  /** El `From` y el `Reply-To` tal como salieron, copiados (nunca releídos por join). */
  desde?: string | null;
  responderA?: string | null;
  /** El `messageId` de SES. Acuse de recibo del POST, no de la entrega. */
  idExterno?: string | null;
}

/**
 * ESCRIBE LA FILA DE AUDITORÍA Y LA DEVUELVE.
 *
 * 🔴 **Sin la migración 0029 esto FALLA, y no se degrada.** No es una elección
 * sobre estos campos: drizzle arma el `INSERT` nombrando **todas** las columnas
 * del schema aunque el objeto de valores no las traiga (`pg-core/dialect.js`,
 * `insertOrder`), así que el día que falte la migración no hay insert de correos
 * que funcione. Que sea así tiene una consecuencia buena y hay que apoyarse en
 * ella: **ningún correo pudo salir con remitente sin la migración**, y por eso los
 * nulos que sirven las lecturas degradadas son la verdad y no un hueco.
 *
 * Y si se pudiera degradar, tampoco: un correo que le llegó a un lead y del que no
 * quedó fila es peor que uno que no salió. Auditar es la mitad del contrato — la
 * misma razón por la que `envios_wa` y el envío viajan juntos.
 */
export async function guardarCorreo(
  base: typeof Base,
  fila: CorreoAGuardar,
): Promise<FilaCorreo> {
  const [guardada] = await base.insert(correos).values(fila).returning();
  return guardada;
}
