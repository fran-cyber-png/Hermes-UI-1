import "dotenv/config";
import { db } from "../db/client.js";
import { crearPlantilla, listarPlantillas } from "../plantillas/repositorio.js";
import { expandirCuerpo } from "../plantillas/expandir.js";

/**
 * EL GUIÓN DE CONSULTORÍA — la secuencia con la que Walter atiende un lead nuevo.
 *
 *   npm run guion:consultoria -- --vendedora Walter            (dry-run)
 *   npm run guion:consultoria -- --vendedora Walter --aplicar
 *
 * Es el texto que ya manda a mano, verificado contra chats reales del 27-jul-2026,
 * con dos cambios y ninguno cosmético:
 *
 *  · **El saludo sale de `{saludo}`**, no escrito. Lo manda a cualquier hora —
 *    hay chats suyos con «Buenos días» a las 10:20 y con «Buenas noches» a las
 *    17:35— y un «buenos días» a las 11 de la noche le dice al lead que del otro
 *    lado hay un machote. La variable se resuelve al enviar (`expandir.ts`).
 *  · **Las erratas corregidas** (campaña, nuestros, Consultores, diagnóstico).
 *    Decisión del dueño. El texto sale hacia una persona que está evaluando si
 *    contratarnos para asesorarla.
 *
 * DOS PASOS y no uno, como los manda hoy: la presentación y el pedido de datos
 * llegan como dos globos. En el celular un bloque de seis líneas se lee como un
 * folleto; partido se lee como alguien escribiendo.
 *
 * **Es de Walter** (decisión del dueño, 27-jul-2026). `plantillas` es personal,
 * así que Sindy y Luz no la van a ver — y el próximo asesor de consultoría
 * arranca vacío. Está anotado acá porque es el costo conocido de esa decisión,
 * no una sorpresa para el que lea esto en un mes.
 */

const NOMBRE = "Consultoría — primer contacto";

/** Paso 1: quién soy. */
const PASO_1 = `{saludo},

Mi nombre es Walter Villaverde, Asesor Comercial del equipo de Consultoría & Estrategia de Goberna.
Encantado de poder brindarte la información.`;

/**
 * Paso 2: los dos datos que califican. Pedir «nombre y campaña» es lo que
 * convierte un curioso en un lead que un Consultor Senior puede tomar — y
 * contestarlo es la señal que `negocio/embudoConsultoria.ts` lee como CALIENTE.
 */
const PASO_2 = `Bríndeme sus nombres completos y a qué campaña está postulando, para generar un breve diagnóstico. Con esos datos uno de nuestros Consultores Senior se pondrá en contacto y le dará un diagnóstico estructurado GRATUITO.`;

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const vendedora = arg("vendedora");
  const aplicar = process.argv.includes("--aplicar");

  if (!vendedora) {
    console.error("Falta --vendedora <id>. Ej: --vendedora Walter");
    process.exit(1);
  }

  // Idempotente: si ya la tiene, no se duplica. Dos guiones con el mismo nombre
  // es peor que ninguno — la vendedora no sabe cuál es el bueno.
  const suyas = await listarPlantillas(db, vendedora);
  const yaEsta = suyas.find((p) => p.nombre === NOMBRE);

  console.log(`\nGuión: «${NOMBRE}» · vendedora: ${vendedora}\n`);
  for (const [i, texto] of [PASO_1, PASO_2].entries()) {
    const { texto: vista } = expandirCuerpo(texto, {});
    console.log(`── PASO ${i + 1} ${"─".repeat(52)}`);
    console.log(vista);
    console.log();
  }

  if (yaEsta) {
    console.log(`Ya existe (id ${yaEsta.id}, estado ${yaEsta.estado}). No se toca.`);
    console.log("Para cambiar el texto, editala desde la app: es de ella.\n");
    return;
  }

  if (!aplicar) {
    console.log("DRY-RUN. Nada se guardó. Agregá --aplicar para crearla.\n");
    return;
  }

  const creada = await crearPlantilla(
    db,
    vendedora,
    {
      nombre: NOMBRE,
      // Lo DECLARA, para que el motor no se lo proponga a un lead de curso.
      negocio: "consultoria",
      // Sin familia de curso A PROPÓSITO: consultoría no es un curso, y atarla a
      // una familia haría que `{curso}`/`{precio}` resolvieran a un diplomado.
      familiaCurso: null,
      pasos: [
        { orden: 1, texto: PASO_1, media: null, mediaPendiente: false },
        { orden: 2, texto: PASO_2, media: null, mediaPendiente: false },
      ],
    },
    // Aprobada: no es una propuesta minada que alguien tenga que revisar — es el
    // texto que su autor ya manda todos los días, y lo confirmó el dueño.
    "aprobada",
  );

  console.log(`Creada (id ${creada.id}), APROBADA y lista para mandar.\n`);
}

await main();
process.exit(0);
