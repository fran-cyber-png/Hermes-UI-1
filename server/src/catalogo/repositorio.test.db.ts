import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba, type DbDePrueba } from "../pruebas/base.js";
import { hechos, plantillaPasos, plantillas } from "../db/schema.js";
import { leerPiezas } from "./repositorio.js";

/**
 * EL CATÁLOGO CONTRA POSTGRES DE VERDAD (ADR 0008).
 *
 * Los tests puros de la ruta prueban la puerta y la honestidad de la respuesta
 * con un lector inyectado. Acá se prueba lo otro: que el lector REAL traduzca
 * bien lo que hay en la base, y —lo que ningún test puro puede probar— que ante
 * una base que no responde **explote** en vez de devolver medio catálogo.
 */

async function sembrarPlantilla(
  db: DbDePrueba,
  p: {
    vendedoraId?: string;
    nombre?: string;
    estado?: string;
    origen?: string;
    familiaCurso?: string | null;
    archivada?: boolean;
    pasos: { orden: number; texto?: string | null; mediaClase?: string | null; mediaArchivo?: string | null }[];
  },
): Promise<number> {
  const [fila] = await db
    .insert(plantillas)
    .values({
      vendedoraId: p.vendedoraId ?? "ana",
      nombre: p.nombre ?? "Bienvenida",
      estado: p.estado ?? "aprobada",
      origen: p.origen ?? "manual",
      familiaCurso: p.familiaCurso ?? null,
      archivadoAt: p.archivada ? new Date() : null,
    })
    .returning({ id: plantillas.id });
  const id = (fila as { id: number }).id;
  for (const paso of p.pasos) {
    await db.insert(plantillaPasos).values({
      plantillaId: id,
      orden: paso.orden,
      texto: paso.texto ?? null,
      mediaClase: paso.mediaClase ?? null,
      mediaArchivo: paso.mediaArchivo ?? null,
    });
  }
  return id;
}

test("una plantilla aprobada sale VIGENTE, con sus pasos en orden y su versión", async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarPlantilla(db, {
    familiaCurso: "DIPICOT",
    pasos: [
      { orden: 1, texto: "Hola {nombre}" },
      { orden: 2, texto: "El {curso} sale {precio}" },
    ],
  });

  const piezas = await leerPiezas(db);
  const pieza = piezas.find((p) => p.clase === "plantilla" && p.id === String(id));

  assert.ok(pieza);
  assert.equal(pieza.estado, "vigente");
  assert.equal(pieza.enviable, true);
  assert.equal(pieza.alcance, "vendedora");
  assert.equal(pieza.propietario, "ana");
  assert.deepEqual(pieza.familia, { vocabulario: "sku-cerberus", valor: "DIPICOT" });
  assert.deepEqual(
    pieza.pasos?.map((p) => p.orden),
    [1, 2],
  );
  assert.deepEqual(pieza.placeholders, ["curso", "nombre", "precio"]);
  assert.equal(pieza.sintaxisPlaceholder, "llave-simple");
  assert.match(pieza.version, /^sha256:[0-9a-f]{16}$/);
});

test("cambiar el TEXTO cambia la versión; cambiar el NOMBRE no", async (t) => {
  // El pedido (a) de Ivi, el único irreparable hacia atrás: sin versión por
  // texto, una pieza que rendía 12 % y subió a 30 % se reporta 21 % para
  // siempre. Y el otro lado de la moneda: si el rótulo contara, arreglarle una
  // tilde al nombre partiría el historial de la pieza en dos por nada.
  const db = await baseDePrueba(t);
  const id = await sembrarPlantilla(db, { pasos: [{ orden: 1, texto: "Hola" }] });

  const versionDe = async () =>
    (await leerPiezas(db)).find((p) => p.clase === "plantilla" && p.id === String(id))?.version;

  const original = await versionDe();

  await db.update(plantillas).set({ nombre: "Bienvenida (v2)" });
  assert.equal(await versionDe(), original, "renombrar no es un texto nuevo");

  await db.update(plantillaPasos).set({ texto: "Hola!" });
  assert.notEqual(await versionDe(), original, "editar el texto SÍ es una versión nueva");
});

test("CAMBIAR EL FLYER cambia la versión — del paso y de la secuencia", async (t) => {
  // El bug que este test mata, contra filas de verdad: el catálogo hasheaba
  // `media_clase` (la cadena "imagen") en vez de `media_archivo`, así que
  // reemplazar el flyer de julio por el de agosto dejaba la versión IDÉNTICA.
  //
  // Importa porque el 42 % de la secuencia de venta lleva imagen y en Goberna
  // **el precio y las fechas viven adentro del flyer**: los resultados de dos
  // ofertas distintas se habrían sumado bajo una sola versión, que es
  // exactamente el blanco móvil que H5 vino a evitar — movido de la prosa a la
  // imagen.
  const db = await baseDePrueba(t);
  const id = await sembrarPlantilla(db, {
    pasos: [
      { orden: 1, texto: "Mirá el temario", mediaClase: "imagen", mediaArchivo: "flyer-julio.jpg" },
      { orden: 2, texto: "¿Te reservo el cupo?" },
    ],
  });

  const piezaDe = async () =>
    (await leerPiezas(db)).find((p) => p.clase === "plantilla" && p.id === String(id))!;

  const antes = await piezaDe();
  await db
    .update(plantillaPasos)
    .set({ mediaArchivo: "flyer-agosto-PRECIO-NUEVO.jpg" })
    .where(sql`orden = 1`);
  const despues = await piezaDe();

  assert.equal(
    antes.pasos?.[0]?.texto,
    despues.pasos?.[0]?.texto,
    "el texto no se tocó: lo único que cambió es la imagen",
  );
  assert.notEqual(
    antes.pasos?.[0]?.version,
    despues.pasos?.[0]?.version,
    "el paso del flyer tiene que cambiar de versión",
  );
  assert.notEqual(antes.version, despues.version, "y la secuencia entera también");
  assert.equal(
    antes.pasos?.[1]?.version,
    despues.pasos?.[1]?.version,
    "el paso que no se tocó conserva su versión",
  );
});

test("cada paso publica SU versión — es lo que el lazo estampa como `plantilla:<id>#<orden>`", async (t) => {
  // Sin la versión por paso, lo que el lazo escribe en `envios_wa` no existiría
  // en ninguna parte del catálogo y el join daría cero, más disimulado.
  const db = await baseDePrueba(t);
  const id = await sembrarPlantilla(db, {
    pasos: [
      { orden: 1, texto: "uno" },
      { orden: 2, texto: "dos" },
    ],
  });

  const pieza = (await leerPiezas(db)).find((p) => p.clase === "plantilla" && p.id === String(id));
  assert.ok(pieza?.pasos);
  for (const paso of pieza.pasos) assert.match(paso.version, /^sha256:[0-9a-f]{16}$/);
  assert.notEqual(pieza.pasos[0]?.version, pieza.pasos[1]?.version, "textos distintos, versiones distintas");
  assert.notEqual(pieza.version, pieza.pasos[0]?.version, "la secuencia no es su primer paso");
});

test("una propuesta es BORRADOR y no es enviable; una archivada es RETIRADA", async (t) => {
  const db = await baseDePrueba(t);
  const propuesta = await sembrarPlantilla(db, {
    estado: "propuesta",
    pasos: [{ orden: 1, texto: "minada del histórico" }],
  });
  const archivada = await sembrarPlantilla(db, {
    archivada: true,
    pasos: [{ orden: 1, texto: "vieja" }],
  });

  const piezas = await leerPiezas(db);
  const p = (id: number) => piezas.find((x) => x.clase === "plantilla" && x.id === String(id));

  assert.equal(p(propuesta)?.estado, "borrador");
  assert.equal(p(propuesta)?.enviable, false);
  assert.equal(p(propuesta)?.motivoNoEnviable, "no_vigente");
  // Retirada, pero PUBLICADA: un resultado histórico atribuido a ella tiene que
  // seguir teniendo a qué apuntar.
  assert.equal(p(archivada)?.estado, "retirada");
});

test("una propuesta MINADA es del equipo, no de la vendedora bajo cuyo id se guardó", async (t) => {
  // «Las plantillas son personales» es cierto a medias: el minado guarda las
  // propuestas bajo UN `vendedora_id` porque la tabla exige uno, y la app se las
  // muestra a todas (ADR 0019). Marcarla como personal la escondería de
  // `?vendedora=` para todas menos una — el bug que ese ADR ya había arreglado.
  const db = await baseDePrueba(t);
  const minada = await sembrarPlantilla(db, {
    vendedoraId: "ana",
    estado: "propuesta",
    origen: "minado",
    pasos: [{ orden: 1, texto: "418 conversaciones usaron esto" }],
  });
  const suya = await sembrarPlantilla(db, {
    vendedoraId: "ana",
    pasos: [{ orden: 1, texto: "la que ella escribió" }],
  });

  const piezas = await leerPiezas(db);
  const p = (id: number) => piezas.find((x) => x.clase === "plantilla" && x.id === String(id));

  assert.equal(p(minada)?.alcance, "negocio");
  assert.equal(p(minada)?.propietario, "ana", "se dice quién tiene la fila, igual");
  assert.equal(p(suya)?.alcance, "vendedora");
});

test("un paso con imagen pendiente hace que la plantilla no sea enviable", async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarPlantilla(db, {
    pasos: [
      { orden: 1, texto: "mirá el flyer" },
      { orden: 2, mediaClase: "imagen", mediaArchivo: null },
    ],
  });

  const pieza = (await leerPiezas(db)).find((p) => p.clase === "plantilla" && p.id === String(id));
  assert.equal(pieza?.enviable, false);
  assert.equal(pieza?.motivoNoEnviable, "media_pendiente");
  assert.equal(pieza?.pasos?.[1]?.mediaPendiente, true);
});

test("un hecho apagado sale RETIRADO, y sus momentos viajan tal cual", async (t) => {
  const db = await baseDePrueba(t);
  await db.insert(hechos).values([
    {
      clave: "cuotas",
      rotulo: "2 cuotas",
      texto: "Se puede pagar en 2 cuotas.",
      momentos: ["cotizada", "momento-del-futuro"],
      orden: 1,
    },
    { clave: "viejo", rotulo: "x", texto: "y", momentos: [], orden: 2, activo: false },
  ]);

  const piezas = await leerPiezas(db);
  const cuotas = piezas.find((p) => p.clase === "hecho" && p.id === "cuotas");
  const viejo = piezas.find((p) => p.clase === "hecho" && p.id === "viejo");

  assert.equal(cuotas?.estado, "vigente");
  // Un momento que este build no conoce NO se filtra: vacío significa «vale
  // para todos», así que descartarlo ensancharía la pieza en vez de acotarla.
  assert.deepEqual(cuotas?.momentos, ["cotizada", "momento-del-futuro"]);
  assert.equal(viejo?.estado, "retirada");
  assert.equal(viejo?.enviable, false);
});

test("las piezas de código llegan aunque la base esté vacía", async (t) => {
  const db = await baseDePrueba(t);
  const piezas = await leerPiezas(db);

  assert.ok(piezas.some((p) => p.clase === "acuse"));
  assert.ok(piezas.some((p) => p.clase === "gancho"));
});

test("SIN LA TABLA (falta el db:push) el lector EXPLOTA — no devuelve medio catálogo", async (t) => {
  // Acá está la diferencia con `hechos/repositorio.ts`, que en este mismo caso
  // sirve el catálogo por defecto con `editable: false`. Para la vendedora eso
  // es correcto: ve las frases y la UI le avisa. Para una máquina que indexa y
  // cachea, un catálogo al que le falta una mitad es indistinguible de uno
  // donde esa mitad no existe. La ruta traduce este throw a un 5xx.
  const db = await baseDePrueba(t);
  await db.execute(sql`DROP TABLE hechos`);

  await assert.rejects(() => leerPiezas(db));
});
