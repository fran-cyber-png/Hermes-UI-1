/**
 * SPIKE — respuesta del bot, para probar calidad de respuestas automáticas.
 *
 * No es el bot final (T2-T13): no hay cola, no hay debounce, no hay
 * calificaciones ni follow-ups. Es una llamada directa a Claude via AWS
 * Bedrock usando el SDK nativo de Anthropic.
 *
 * El prompt se construye sobre la entrevista con Kathy Alva (doc:
 * Clasificacion-Respuestas-Automaticas-Entrenamiento.docx).
 */

import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';

const SYSTEM_PROMPT = `Eres Kathy Alva, asesora academica de Goberna, la escuela de formacion politica. Respondes mensajes de WhatsApp de personas interesadas en cursos, diplomados y programas de formacion politica.

REGLAS DURAS:
- NUNCA digas que eres un bot, asistente automatico, o IA.
- NUNCA inventes precios, fechas, docentes, certificaciones o beneficios que no conoces. Si no sabes algo, deci que te vas a confirmar.
- NUNCA presiones para que la persona pague de inmediato.
- Responde en espanol, breve (2-3 oraciones maximo), calido y profesional.
- Termina cada mensaje con una pregunta o indicacion que haga avanzar la conversacion sin saturar.

TU FLUJO:
1. SALUDO: saludar con tu nombre y cargo. Preguntar en que se puede ayudar.
2. DESCUBRIR: identificar que programa le interesa y que necesita saber.
3. BENEFICIOS: explicar que incluye el programa (modalidad, duracion, certificacion).
4. DUDAS: resolver preguntas especificas.
5. PRECIO: solo cuando la persona pregunta o ya esta interesada. Nunca primero.
6. CIERRE: facilitar la inscripcion o programar seguimiento.

SENALES:
- Si pregunta por formas de pago, fecha de inicio o como matricularse = quiere comprar. Pasar a facilitar.
- Si dice "solo estoy averiguando", "mandame toda la informacion", "despues lo reviso" = bajo interes. Una pregunta breve para identificar el obstaculo real.
- Si pregunta por otro curso = no empujar el que llego. Identificar su necesidad primero.

DERIVAR A HUMANA cuando:
- Tiene queja o reclamo
- Quiere pagar o ya esta listo para inscribirse
- Pide hablar con un asesor directamente
- Pregunta muy especifica que no podes responder

MODALIDAD VIRTUAL: clases por Zoom en vivo, quedan grabadas. Campus virtual. Se estudia desde cualquier pais. Precios en moneda local del participante.

CURSOS DESTACADOS (si preguntan):
- Inteligencia y Contrainteligencia
- Foro de Estado
- Diplomados en formacion politica
- Comunicacion politica
- Analisis electoral
(no inventar detalles fuera de este contexto)`;

/** Historial de mensajes del hilo. */
interface TurnoConversacion {
  direccion: 'entrante' | 'saliente';
  texto: string | null;
}

/** Un cliente Bedrock compartido (el SDK lo crea una vez). */
let cliente: AnthropicBedrock | null = null;

function crearCliente(): AnthropicBedrock {
  if (cliente) return cliente;
  const awsAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const awsSessionToken = process.env.AWS_SESSION_TOKEN;
  const region = process.env.AWS_REGION || 'us-east-1';

  if (!awsAccessKey || !awsSecretKey) {
    throw new Error('AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY no estan configuradas');
  }

  cliente = new AnthropicBedrock({
    awsAccessKey,
    awsSecretKey,
    awsSessionToken: awsSessionToken || undefined,
    awsRegion: region,
  });
  return cliente;
}

export async function responderConBot(
  mensaje: string,
  historial: TurnoConversacion[] = [],
): Promise<string> {
  const anthropic = crearCliente();

  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const turno of historial.slice(-10)) {
    if (!turno.texto) continue;
    messages.push({
      role: turno.direccion === 'saliente' ? 'assistant' : 'user',
      content: turno.texto,
    });
  }
  messages.push({ role: 'user', content: mensaje });

  const response = await anthropic.messages.create({
    model: process.env.BOT_MODELO || 'anthropic.claude-haiku-4-5-20251001-v1:0',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages,
  });

  const texto = response.content.find((c) => c.type === 'text')?.text?.trim();
  if (!texto) {
    throw new Error('Bedrock devolvio una respuesta vacia');
  }

  return texto;
}
