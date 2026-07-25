import type { EstadoPendiente } from './estados.js';

/**
 * EL INTERRUPTOR DE TRES POSICIONES (#125 · ADR 0016).
 *
 * ADR 0015 dejó un booleano: apagada o mandando sola. El dueño pidió el punto
 * del medio —«que sea igual medio supervisado por la misma vendedora»— y ese
 * punto no es un matiz del booleano, es un tercer estado:
 *
 *   · **apagada**      nadie recibe nada. El default, y el que sigue siendo el default.
 *   · **supervisada**  la cola prepara igual (misma decisión, mismo ritmo) pero NO
 *                      manda: cada mensaje espera el OK de una persona.
 *   · **automática**   lo de ADR 0015 tal cual: prepara y despacha sola.
 *
 * Lo que hace supervisada distinta de «apagada + trabajo manual» es que la
 * decisión y el RITMO ya están hechos: la vendedora no elige a quién ni a qué
 * hora, elige si va. Y lo que la hace distinta de automática es una sola línea
 * en `estados.ts`: lo que escribe queda `preparada`, y el despachador no ve las
 * preparadas.
 *
 * Este módulo es puro y minúsculo a propósito: es la traducción entre lo que hay
 * guardado en la base (una columna de texto que puede no existir todavía) y las
 * dos preguntas que se le hacen mil veces por día — «¿preparo?» y «¿en qué
 * estado escribo?».
 */

export const MODOS = ['apagada', 'supervisada', 'automatica'] as const;
export type ModoAutoRespuesta = (typeof MODOS)[number];

export function esModo(v: unknown): v is ModoAutoRespuesta {
  return typeof v === 'string' && (MODOS as readonly string[]).includes(v);
}

/**
 * LOS MODOS QUE SE PUEDEN ELEGIR HOY — dos, no tres (ADR 0018).
 *
 * `automatica` sigue arriba, en `MODOS`, porque una fila guardada puede tenerla
 * y `leerModo` tiene que devolverla TAL CUAL: reinterpretarla en silencio sería
 * decirle a la pantalla «apagada» mientras el despachador manda. Lo que se cierra
 * no es la representación, es **la puerta**: nadie puede entrar ahí.
 *
 * Que sean dos conjuntos distintos —lo que existe y lo que se elige— es toda la
 * decisión, y por eso vive acá arriba y no adentro de un `if` de la ruta. La
 * misma forma que el salto prohibido `preparada → enviada` de `estados.ts`: una
 * lista blanca con su test, no una condición que el primer atajo futuro borra.
 *
 * Por qué se cierra, en una línea: Hermes nunca manda solo. El modo automático
 * es la única configuración en la que el mensaje es genuinamente de una máquina,
 * y el estudio aleatorizado que cita #152 (n>6.200, *Marketing Science*) midió
 * que revelar que es un bot baja la compra 79,7%. Con una persona aprobando, ese
 * problema no existe — y la burbuja del hilo puede decir «Aprobado · ana» en vez
 * de «Automático», que es la verdad.
 */
export const MODOS_ELEGIBLES = ['apagada', 'supervisada'] as const satisfies readonly ModoAutoRespuesta[];
export type ModoElegible = (typeof MODOS_ELEGIBLES)[number];

export function esModoElegible(v: unknown): v is ModoElegible {
  return typeof v === 'string' && (MODOS_ELEGIBLES as readonly string[]).includes(v);
}

/** El texto que se le devuelve a quien intente entrar en automática. */
export const PORQUE_NO_AUTOMATICA =
  'el modo automático se retiró (ADR 0018): Hermes no manda solo. Usá «supervisada» — prepara igual y espera tu OK.';

/**
 * EL BOOLEANO VIEJO DE ADR 0015, traducido. `PUT /interruptor {encendida:true}`
 * dejaba el modo AUTOMÁTICO: era una puerta trasera a un estado que la UI ya no
 * ofrecía, alcanzable con un `curl` y el Bearer de cualquier vendedora.
 *
 * Ahora prender por ahí deja **supervisada**. Lo que esa ruta existe para hacer
 * —frenar en una emergencia, con `false`— no cambia ni un carácter.
 */
export function modoDelBooleano(encendida: boolean): ModoElegible {
  return encendida ? 'supervisada' : 'apagada';
}

/** ¿Este modo hace que el encolado corra? Los dos encendidos, sí. */
export function prepara(modo: ModoAutoRespuesta): boolean {
  return modo !== 'apagada';
}

/**
 * En qué estado nace lo que escribe el encolado. `null` = no se escribe nada.
 * Esta función es el único lugar donde el modo toca la cola: todo lo demás
 * (decidir, programar, los techos) es idéntico en los dos modos encendidos, y
 * tiene que seguir siéndolo — si supervisada usara otro camino, lo que la
 * vendedora aprueba no sería lo que la automática mandaría.
 */
export function estadoAlEncolar(modo: ModoAutoRespuesta): EstadoPendiente | null {
  if (modo === 'supervisada') return 'preparada';
  if (modo === 'automatica') return 'pendiente';
  return null;
}

/**
 * El booleano de ADR 0015, DERIVADO del modo. Se sigue guardando en la columna
 * `encendida` (y la ruta vieja `PUT /interruptor` lo sigue leyendo) porque
 * durante la ventana entre el deploy del código y el `db:push` hay un server
 * nuevo hablándole a un esquema viejo. La dirección importa: el modo es la
 * verdad, el booleano su sombra. Al revés no se puede — de un `true` no sale
 * «supervisada».
 */
export function encendidaEn(modo: ModoAutoRespuesta): boolean {
  return prepara(modo);
}

/**
 * Lee el modo de la fila guardada. FAIL-SAFE hacia el silencio: una columna que
 * todavía no existe, o un valor que no reconozco, NO se interpretan como «mandá
 * mensajes». Lo peor que puede pasar acá es que la auto-respuesta no ande;
 * mandar sola por un typo en la base sería mucho peor.
 */
export function leerModo(fila: { modo: string | null | undefined; encendida: boolean }): ModoAutoRespuesta {
  if (esModo(fila.modo)) return fila.modo;
  // Sin columna `modo` (esquema de ADR 0015): el booleano viejo es todo lo que
  // hay, y prendido significaba «manda sola».
  if (fila.modo == null) return fila.encendida ? 'automatica' : 'apagada';
  return 'apagada';
}

/** Cómo se dice cada modo en la pantalla y en los motivos que se guardan. */
export function nombreDeModo(modo: ModoAutoRespuesta): string {
  return modo === 'automatica' ? 'automática' : modo;
}
