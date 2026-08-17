/**
 * QUÉ DICE EL TRIÁNGULO ROJO — la traducción del código de Meta.
 *
 * ── Lo que se rompe sin esto ─────────────────────────────────────────────
 * El triángulo decía «No se pudo entregar» y nada más, así que la vendedora no
 * podía distinguir **«el número está mal»** de **«se te pasó la hora»** — y son
 * dos acciones opuestas: una se corrige, la otra se convierte en plantilla. Peor:
 * como el mensaje SÍ había salido, lo que ella concluía era «Hermes no lo mandó».
 *
 * ── EL CASO QUE ES CASI TODO ─────────────────────────────────────────────
 * `131047`, la ventana de 24 h. Medido el 17-ago-2026, los dos únicos fallos de
 * envíos manuales en dos semanas eran eso — uno se pasó **por media hora**. Hoy
 * Hermes manda por una sola línea y es la Cloud API, donde el plazo es duro.
 *
 * ── LA REDACCIÓN DICE QUÉ HACER, NO QUÉ PASÓ ─────────────────────────────
 * «Re-engagement message» es el título de Meta y no le sirve a nadie. Cada
 * lectura termina en la salida: si hay una plantilla que sí entra, lo dice.
 *
 * ⚠️ **Un código desconocido NUNCA inventa una explicación**: cae en la lectura
 * neutra («WhatsApp no lo entregó») y el código crudo se va al `title`, que es
 * donde alguien lo puede leer para agregarlo acá. Adivinar «probablemente la
 * ventana» sería peor que no decir nada — la vendedora dejaría de escribirle a
 * alguien que sí podía recibir.
 */

/** Lo que se dibuja, ya resuelto. `detalle` es el `title` del hover. */
export interface LecturaDeMotivo {
  /** La línea visible, corta: entra abajo de la burbuja sin envolver dos veces. */
  texto: string;
  /** El hover, con el código crudo. Sirve para reportar y para agregar el caso. */
  detalle: string;
}

/**
 * Los códigos que sabemos nombrar. Los que puede ver un envío MANUAL de texto:
 * los de plantilla y los de media viven en sus propios frentes.
 *
 * Fuente: la tabla de errores de la Cloud API de Meta. **Se agrega uno cuando se
 * lo ve en producción**, no por barrer la doc: una lectura escrita a ciegas es
 * una afirmación sin medir, y acá lo que se afirma decide si se vuelve a escribir.
 */
const LECTURAS: Record<string, string> = {
  // La ventana de atención al cliente. El único que aparece hoy en envíos manuales.
  '131047': 'pasaron más de 24 h desde su último mensaje. Solo entra una plantilla aprobada.',
  // El mismo caso, con el código viejo: Meta lo mandó durante años y las filas
  // históricas lo tienen. Misma lectura, porque es el mismo hecho.
  '470': 'pasaron más de 24 h desde su último mensaje. Solo entra una plantilla aprobada.',
  '131026': 'ese número no puede recibir mensajes: puede no tener WhatsApp.',
  '131049': 'WhatsApp lo retuvo para cuidar la experiencia del usuario. No es tu número.',
  '131048': 'WhatsApp frenó los envíos de esta línea por ritmo. Esperá antes de insistir.',
  '131021': 'el destinatario y el remitente son el mismo número.',
  '131051': 'WhatsApp no admite ese tipo de mensaje.',
  '131052': 'no se pudo leer el archivo adjunto.',
  '130472': 'esa persona quedó fuera por una regla de Meta, no por algo nuestro.',
  '131000': 'falló del lado de Meta. Se puede reintentar.',
};

/** El encabezado, siempre el mismo: lo primero es que NO llegó. */
const CABEZA = 'No se entregó';

/**
 * La lectura de un fallo. `codigo` ausente es el caso mayoritario al principio
 * —todo lo anterior a la migración 0028— y devuelve la línea neutra, que es
 * exactamente lo que el triángulo decía antes.
 */
export function lecturaDeMotivo(codigo?: string | null): LecturaDeMotivo {
  const clave = (codigo ?? '').trim();
  const conocida = LECTURAS[clave];
  if (conocida) {
    return {
      texto: `${CABEZA}: ${conocida}`,
      detalle: `WhatsApp rechazó la entrega (código ${clave})`,
    };
  }
  /**
   * ⚠️ Los dos casos sin lectura NO dicen lo mismo, y la primera redacción los
   * juntaba en «No se entregó: WhatsApp no lo entregó» — que además de morderse
   * la cola era falsa en uno de los dos: con un código desconocido Meta SÍ dijo
   * por qué, lo que falta es la traducción. **El código se muestra**: es lo que
   * la vendedora puede pasar para que alguien lo agregue acá.
   */
  return {
    texto: clave
      ? `${CABEZA}: WhatsApp lo rechazó (código ${clave}).`
      : `${CABEZA}: WhatsApp no dijo por qué.`,
    detalle: clave
      ? `WhatsApp rechazó la entrega (código ${clave}, sin lectura todavía)`
      : 'WhatsApp rechazó la entrega y no dijo por qué',
  };
}

/** Solo para el test de que ninguna lectura quede huérfana. */
export const CODIGOS_CON_LECTURA = Object.keys(LECTURAS);
