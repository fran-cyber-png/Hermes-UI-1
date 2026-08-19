/**
 * EL CORPUS DE TEXTOS REALES — el que hace que un test de paridad valga algo.
 *
 * Cada línea salió de producción (censo del 11-ago-2026) salvo las marcadas, que
 * son los bordes que el corpus real no tenía.
 *
 * Vive en un módulo propio desde que lo comparten DOS candados que tienen que
 * mirar los mismos textos: `pregunta.paridad.test.db.ts` (¿el SQL dice lo mismo
 * que TypeScript?) y `predicadosMaterializados.paridad.test.db.ts` (¿la COLUMNA
 * dice lo mismo que los dos?). Con una copia por test, arreglar un predicado
 * agregando un caso a uno de los dos dejaría al otro pasando sobre el corpus
 * viejo — que es la forma callada de que un candado deje de ser un candado.
 */
export const CORPUS = [
  // El texto que prellena Meta, en sus seis variantes reales.
  "Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia",
  "Hola. Quiero más información sobre el servicio de Consultoría.",
  "¡Hola! Quiero más información",
  "Hola. ¿Puedo obtener más información sobre esto?",
  "¡Hola! Me gustaría conseguir más información sobre esto.",
  "¡Hola! Quiero más información del I Foro de Estado 2026.",
  // El anuncio CON una pregunta agregada por la persona.
  "Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia ¿Cuál es el costo?",
  // Señales de plata.
  // ⚠️ La primera NO es un lead: es Walter probando el bot. Se conserva por su
  // forma; las tres de abajo son de gente real y son las que justifican la regla.
  "Pásame la cotización urgentemente quiero comprar ahora mismo",
  "Cual es el precio. Gracias",
  "Sí gracias por la información si hago un negocio en éstos días les envío el pago",
  "Es un precio elevado. Gracias..para la próxima cuando ya vaya como candidato",
  "Cuantas cuotas?",
  "el nombre de yape es a nombre de una empresa?",
  "Más tarde hago el pago",
  "Buen día me podrías enviar el link de pago de nuevo del 360",
  "Cuál es el proceso de inscripción y pago",
  "Que precio tiene?",
  "COSTO",
  "Y su costo",
  "Cuanto cuesta by cuandoninicia",
  // Sustantivos concretos.
  "Como son los certificados",
  "Cuales son los requisitos ?",
  "Quisiera saber qué días es",
  "Y ese certificado en que lugar me puede servir",
  // Pedidos genéricos escritos a mano.
  "Necesito información",
  "Un poco más de información x favor",
  "Información sobre el curso",
  "Más información",
  "Me das información por favor?",
  "Hola, me interesa el diplomado de inteligencia y contrainteligencia",
  // Cierres y cortesías.
  "Ya no me interesa",
  "Ya no estoy interesado",
  "MUCHAS GRACIAS POR LA INFORMACION. EXCELNTE DIA",
  "Muchas gracias por la información. Talvez en otra ocasión. Buenas tardes!",
  "Si me decido, les avisaré. Gracias por la información.",
  "Muchas gracias por la información, ¿cuánto cuesta?",
  // Autorespuestas de otros negocios.
  "Gracias por comunicarte con Lander Valera ¿Cómo puedo ayudarte?",
  "Gracias por comunicarte con Jasper Desing. ¿Cómo podemos ayudarte? 😀",
  "Gracias por comunicarte con nosotros. Por favor, haznos saber cómo podemos ayudarte",
  // Ruido puro.
  "Cómo estás",
  "gracias",
  "ok",
  "si",
  "hola",
  "👍",
  "buenas tardes",
  // «info» a secas y sus vecinos: el borde de palabra escrito a mano.
  "info",
  "info?",
  "más info por favor",
  "un trato informal",
  "infografía del curso",
  // Bordes que el corpus real no traía.
  "no me interesa el precio",
  "HOLA QUIERO MÁS INFORMACIÓN DEL DIPLOMA",
  "hola quiero mas informacion",
] as const;