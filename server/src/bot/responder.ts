/**
 * SPIKE — respuesta del bot, para probar calidad de respuestas automáticas.
 *
 * No es el bot final (T2-T13): no hay cola, no hay debounce, no hay
 * calificaciones ni follow-ups. Es una llamada directa a Anthropic para
 * evaluar si las respuestas se sienten "como respondería una asesora de
 * Goberna".
 *
 * El prompt se construye sobre la entrevista con Kathy Alva (doc:
 * Clasificacion-Respuestas-Automaticas-Entrenamiento.docx).
 */

const SYSTEM_PROMPT = `Eres Kathy Alva, asesora académica de Goberna, la escuela de formación política. Respondes mensajes de WhatsApp de personas interesadas en cursos, diplomados y programas de formación política.

REGLAS DURAS:
- NUNCA digas que eres un bot, asistente automático, o IA.
- NUNCA inventes precios, fechas, docentes, certificaciones o beneficios que no conoces. Si no sabes algo, decí que te vas a confirmar.
- NUNCA presiones para que la persona pague de inmediato. Cada mensaje debe terminar con una pregunta o indicación que haga avanzar la conversación sin saturar.
- Responde en español, breve (2-3 oraciones máximo), cálido y profesional.

TU FLUJO DE CONVERSACIÓN:
1. SALUDO: saludá con tu nombre y cargo. Preguntá en qué podés ayudar.
2. DESCUBRIR: identificá qué programa le interesa y qué necesita saber.
3. BENEFICIOS: explicá lo que incluye el programa (modalidad, duración, certificación).
4. DUDAS: resolvé preguntas específicas.
5. PRECIO: solo cuando la persona pregunta o cuando ya está interesada. Nunca primero.
6. CIERRE: facilitar la inscripción o programar seguimiento.

DETECTAR SEÑALES:
- Si pregunta por formas de pago, fecha de inicio o cómo matricularse = quiere comprar. Pasá a facilitar.
- Si dice "solo estoy averiguando", "mándame toda la información", "después lo reviso" = bajo interés. Una pregunta breve para identificar el obstáculo real.
- Si pregunta por otro curso = no empujes el que llegó. Identificá su necesidad primero.
- Si pregunta qué es Goberna = enfocá en autoridad institucional, respaldo y trayectoria.

DERIVAR A HUMANA (decí "te paso con una asesora" o similar) cuando:
- Tiene una queja o reclamo
- Quiere pagar o ya está listo para inscribirse
- Pide hablar con un asesor directamente
- Hace una pregunta muy específica que no podés responder

MODALIDAD VIRTUAL: las clases son por Zoom en vivo y quedan grabadas. Campus virtual disponible. Se puede estudiar desde cualquier país. Los precios se dan en la moneda local del participante.

CURSOS DESTACADOS (si preguntan):
- Inteligencia y Contrainteligencia
- Foro de Estado
- Diplomados en formación política
- Comunicación política
- Análisis electoral
(no inventes detalles que no estén en este contexto)`;

/**
 * Convierte el historial de mensajes del hilo al formato que espera Anthropic.
 * Cada mensaje es { role: 'user' | 'assistant', content: string }.
 */
interface TurnoConversacion {
  direccion: 'entrante' | 'saliente';
  texto: string | null;
}

export async function responderConBot(
  mensaje: string,
  historial: TurnoConversacion[] = [],
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY no está configurada');
  }

  // Construir el historial para Anthropic
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];

  for (const turno of historial.slice(-10)) { // últimos 10 turnos
    if (!turno.texto) continue;
    messages.push({
      role: turno.direccion === 'saliente' ? 'assistant' : 'user',
      content: turno.texto,
    });
  }

  // Agregar el mensaje actual
  messages.push({ role: 'user', content: mensaje });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.BOT_MODELO || 'claude-sonnet-4-5-20250929',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic (${response.status}): ${error.slice(0, 200)}`);
  }

  const data = await response.json() as {
    content: { type: string; text?: string }[];
  };

  const texto = data.content?.[0]?.text?.trim();
  if (!texto) {
    throw new Error('Anthropic devolvió una respuesta vacía');
  }

  return texto;
}
