import { ErrorApi } from '../../lib/datos/cliente';
import { fechaCorta } from '../../lib/formato';
import { nombreCorto } from '../../dominio/dueno';
import type { EstadoDeCorreos, RemitentePublico, RitmoDeCorreos } from './tipos';

/**
 * LAS REGLAS DE LA VISTA CORREOS, PURAS — lo que la pantalla decide antes de
 * tocar el server, y cómo lee lo que el server contesta.
 *
 * ══ POR QUÉ ESTO NO VIVE ADENTRO DE `VistaCorreos.tsx` ══════════════════════
 *
 * 🔴 **El botón de Enviar y el acorde `⌘↵` tenían cada uno su copia de la
 * condición, y por eso divergían.** En la versión vieja el botón se apagaba con
 * `para.trim() !== '' && asunto.trim() !== '' && cuerpo.trim() !== ''` y el
 * `onKeyDown` del textarea volvía a consultar esa misma variable — o sea que
 * cualquier tope que se agregara a uno (el largo del cuerpo, el techo de la hora)
 * había que acordarse de agregarlo al otro. Ya pasó, textualmente, en Ivi (#169):
 * pegando 4.500 caracteres el botón quedaba apagado y el acorde mandaba igual, el
 * server contestaba 400 y la pantalla decía «se rompió algo que nadie previó»
 * mientras dos líneas más abajo mostraba el diagnóstico correcto.
 *
 * Que sea puro no es estética: es lo que permite preguntar «⌘↵ con 25.000
 * caracteres» o «Enviar con el techo del día quemado» sin montar un componente.
 *
 * ══ LA REGLA QUE ORDENA TODO EL FRENTE ══════════════════════════════════════
 *
 * 🔴 **La pantalla MUESTRA lo que va a salir; no lo promete.** Desde el 21-jul-2026
 * el pie del composer decía «Se envía solo a esta persona, con tu nombre» y el
 * placeholder «va en texto plano, con tu firma de siempre», y las dos frases eran
 * falsas: el `From` era `Escuela Goberna <escuela@goberna.us>` para las nueve, no
 * había `Reply-To` —así que la respuesta del lead caía en un buzón que Hermes no
 * lee— y no existía una sola línea de código que agregara una firma. Con tres filas
 * en toda la base (las tres pruebas) nadie lo descubrió operando.
 *
 * El arreglo del server vuelve ciertas esas frases; el de acá es que la pantalla
 * deje de afirmar y **enseñe el sobre** (`resumenDelSobre`). Una promesa no se
 * puede verificar mirando; un `Luz · Escuela Goberna <escuela@goberna.us>` sí.
 */

/**
 * EL TOPE DEL CUERPO — **copia del server**, no la fuente de verdad.
 *
 * Acá se usa para apagar el botón y explicar por qué, o sea para que el aviso sea
 * de la app y no un 400 anónimo. La garantía sigue siendo la validación del server.
 *
 * ⚠️ **Y por eso hace falta un test de paridad que lea este archivo desde el
 * server** — el molde literal es `server/src/notas/limiteTexto.paridad.test.ts`,
 * que hace `readFileSync` del archivo del front y matchea
 * `/export const LIMITE_TEXTO\s*=\s*([\d_]+)/`. Copiar esa forma para
 * `TOPE_CUERPO`, no inventar otra.
 *
 * 🔴 **El defecto que ese candado evita ya ocurrió una vez, con este mismo
 * patrón**: al subir el tope de las notas de 2.000 a 20.000 el server cambió y el
 * front siguió diciendo 2.000. Lo que produce no es una rotura sino algo peor de
 * encontrar: la pantalla deja escribir 25.000 caracteres, el server los rechaza, y
 * el aviso explica el tope **con un número que no rige en ningún lado**. El mensaje
 * SUENA correcto, así que nadie lo reporta como bug.
 *
 * ⚠️ Se escribe con el separador `_` a propósito: es lo que el regex del candado
 * espera (`[\d_]+`), y así el número se lee de un vistazo.
 */
export const TOPE_CUERPO = 20_000;

/**
 * El separador entre el nombre de quien escribe y el del buzón por el que sale.
 *
 * ⚠️ **Es el mismo que el server usa en `armarSobre`** (`correos/remitente.ts`), y
 * tiene que seguir siéndolo: acá se dibuja lo que allá se manda, así que un guion
 * de este lado y un punto medio del otro hacen que la pantalla enseñe un sobre que
 * nadie va a recibir. Es el mismo punto medio con el que el resto de la app
 * encadena dos hechos («82 · de 3.051», «Aprobado · ana»).
 */
const SEPARADOR_NOMBRES = ' · ';

/**
 * La forma de un correo, **deliberadamente angosta y copiada del server**
 * (`correos/remitente.ts#FORMA_DE_CORREO`).
 *
 * No es un validador de RFC 5322 y no quiere serlo: la pregunta que contesta es
 * «¿este `vendedora_id` de Cerberus es ADEMÁS un buzón?». Hermes no tiene tabla de
 * personas —el `vendedora_id` es texto libre— y en producción conviven las dos
 * formas: `ventas10@grupogoberna.com` es un correo, `luz`, `Sindy` y `Usuario1` no.
 *
 * ⚠️ Ante la duda contesta que **no**, y esa asimetría es la decisión: fallar hacia
 * el «no» es barato (se cae al `responderA` del remitente, que existe y alguien
 * lee), y fallar hacia el «sí» pone una dirección inventada donde el lead va a
 * contestar. Por eso el juego de caracteres deja afuera la coma, el punto y coma y
 * el espacio: todo lo que convertiría un `Reply-To` en dos.
 *
 * 🔴 **Se exporta porque llegó a haber TRES copias**, y la tercera —privada de
 * `AdminRemitentes.tsx`— vivía anotada como deuda con su propia lápida escrita: *«si
 * alguien afloja una y no las otras, la pantalla acepta una dirección que el server
 * rechaza — o al revés, que es peor, porque entonces se niega a guardar algo válido y
 * no hay forma de arreglarlo desde la app»*. Quedan **dos**, y la otra es la del
 * server (`correos/remitente.ts`), que es la que manda: ésta sólo adelanta el aviso.
 */
export const FORMA_DE_CORREO = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/**
 * Un número con puntos de miles, sin depender del ICU del entorno.
 *
 * ⚠️ `toLocaleString('es')` daría lo mismo **cuando el runtime trae los datos de
 * locale completos**, y no siempre los trae: un node compilado con `small-icu`
 * devuelve `20,000`. El test afirma sobre el texto exacto, así que un formateo que
 * cambia según dónde corre convierte un candado en un flake.
 *
 * ⚠️ **Se exporta para el contador del composer, y por eso mismo no se puede
 * cambiar de forma alegremente**: el aviso del tope («sobran 5.000») y el contador
 * que la vendedora mira mientras escribe («19.812 de 20.000») tienen que contar la
 * misma cadena de la misma manera. Con una copia en el `.tsx`, el contador diría
 * que entra y el motivo diría que sobra, sobre el MISMO texto — que es #37 en su
 * forma más confusa: los dos números están a diez píxeles uno del otro.
 */
export function conMiles(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ════════════════════════════════════════════════════════════════════════════
// ¿SE PUEDE MANDAR?
// ════════════════════════════════════════════════════════════════════════════

/** Cuál de las dos ventanas del ritmo está quemada. `null` = todavía entra uno. */
export type TechoQuemado = 'hora' | 'dia' | null;

/**
 * ¿EL RITMO ESTÁ QUEMADO, Y CUÁL DE LAS DOS VENTANAS?
 *
 * 🔴 **Existe para que el contador de la cabecera y el botón no puedan opinar
 * distinto sobre el mismo hecho.** El contador se dibujaba **idéntico quemado que
 * sano** —«20/20 esta hora» en el mismo `text-muted-foreground` gris que «3/20»—,
 * o sea que el único momento en que ese número importa era justo el único en que no
 * se distinguía. La corrección natural es un `ritmo.usadoHora >= ritmo.techoHora`
 * adentro del JSX, y eso sería la MISMA comparación escrita dos veces (#37): el día
 * que el server cambie a «queda uno» o el techo pase a contar distinto, el botón se
 * apagaría y el número seguiría gris, o al revés — el número en rojo con el botón
 * andando, que es peor porque frena a alguien que sí podía mandar.
 *
 * ⚠️ **La HORA se pregunta primero, y ese orden es el de `motivoParaNoEnviar`**: el
 * más chico gana, así que con las dos ventanas quemadas hay que nombrar la que se
 * destraba antes. Nombrar el día mandaría a esperar hasta mañana a alguien a quien
 * destraba el próximo cambio de hora.
 *
 * ⚠️ **Sin `ritmo` contesta `null`, no «quemado»**: un server viejo (ventana N4↔N5)
 * no emite el campo, y pintar el freno sobre un dato ausente le diría a la vendedora
 * que está frenada cuando no lo está. El corte de verdad es el 429 del server y no
 * depende de que el front se entere.
 */
export function techoQuemado(ritmo: RitmoDeCorreos | undefined): TechoQuemado {
  if (!ritmo) return null;
  if (ritmo.usadoHora >= ritmo.techoHora) return 'hora';
  if (ritmo.usadoDia >= ritmo.techoDia) return 'dia';
  return null;
}

/** Lo que hay escrito en el composer ahora mismo. */
export interface CamposDelCorreo {
  para: string;
  asunto: string;
  cuerpo: string;
  /** Cuál remitente eligió. `null` = todavía ninguno. */
  remitenteId: number | null;
  /**
   * ¿Hay un envío en vuelo? Opcional para no romperle la firma a quien no lo
   * tenga a mano, pero **el que lo omite se queda sin el candado**: el botón se
   * apaga solo con `isPending`, y el acorde `⌘↵` no — así que sin esto dos `⌘↵`
   * seguidos mandan dos correos al mismo lead. Es exactamente la asimetría entre
   * las dos puertas que esta función existe para cerrar.
   */
  enVuelo?: boolean;
}

/** Por qué no sale, con el texto ya listo para mostrar. */
export interface MotivoParaNoEnviar {
  puede: false;
  motivo: string;
}

export type PuedeEnviar = { puede: true } | MotivoParaNoEnviar;

/**
 * ⚠️ El tipo de retorno es la FORMA y no `MotivoParaNoEnviar`: la misma fábrica la
 * usa `motivoParaNoGuardar` (los remitentes), donde «no enviar» sería el sujeto
 * equivocado. Son dos preguntas distintas con la misma respuesta estructural.
 */
const NO = (motivo: string): { puede: false; motivo: string } => ({ puede: false, motivo });

/**
 * ¿SE PUEDE MANDAR ESTE CORREO? — y si no, **por qué**, en una frase que la
 * pantalla pueda poner tal cual al lado del botón apagado.
 *
 * Devuelve el motivo y no un booleano por lo mismo que `lecturaDeError` devuelve
 * un texto: un botón gris sin explicación se lee como que la app se colgó, y lo
 * que hace quien lo mira es apretarlo de nuevo.
 *
 * ══ EL ORDEN DE LAS PREGUNTAS ES LA DECISIÓN ════════════════════════════════
 *
 * 🔴 **Primero lo que no depende de lo que escriba, después lo que escribió.** Si
 * el canal está caído o el techo del día está quemado, decírselo con el formulario
 * todavía vacío le ahorra escribir un correo entero para enterarse al final. Al
 * revés —«falta el destinatario» sobre un canal desconectado— la manda a llenar
 * cajas que no van a servir para nada.
 *
 * ⚠️ Y entre las cajas, el orden es **el de la pantalla** (Para → Asunto →
 * Cuerpo): el aviso tiene que apuntar a la primera caja vacía leyendo de arriba
 * hacia abajo, o señala una que está tres renglones más abajo de otra igual de
 * vacía.
 *
 * ⚠️ **Con `estado` sin resolver todavía NO se dice «no está conectado»**, que
 * sería afirmar una caída sobre un `useQuery` que está cargando. Se dice que
 * todavía no se sabe, que es lo cierto y dura un segundo.
 */
export function motivoParaNoEnviar(
  campos: CamposDelCorreo,
  estado: EstadoDeCorreos | undefined,
): PuedeEnviar {
  if (campos.enVuelo) return NO('Esperá: hay un correo saliendo.');

  if (!estado) return NO('Todavía estamos viendo si el canal de correo está andando.');
  if (!estado.conectado) return NO('El canal de correo no está conectado: no hay por dónde mandarlo.');

  // El ritmo va antes que las cajas y después de la conexión: es la otra razón por
  // la que no se puede mandar NADA, escriba lo que escriba.
  //
  // ⚠️ Sin `ritmo` no se frena: un server viejo no lo emite, y apagar el botón por
  // un campo ausente dejaría la vista muerta durante toda la ventana N4↔N5. El
  // corte de verdad es el 429 y ése no depende de que el front se entere.
  // ⚠️ **Quién está quemado lo decide `techoQuemado`, no un `>=` de acá.** Es la
  // misma pregunta que le da color al contador de la cabecera, y con dos copias el
  // botón y el número se separan sin que nada falle (ver su docblock).
  const ritmo = estado.ritmo;
  if (ritmo) {
    const quemado = techoQuemado(ritmo);
    if (quemado === 'hora') {
      return NO(
        `Llegaste al techo de esta hora: ${ritmo.usadoHora} de ${ritmo.techoHora}. Se destraba al cambiar la hora.`,
      );
    }
    if (quemado === 'dia') {
      return NO(`Llegaste al techo del día: ${ritmo.usadoDia} de ${ritmo.techoDia}. Sigue mañana.`);
    }
  }

  // Elegir remitente sólo se exige cuando hay de dónde elegir. Con `sinRemitentes`
  // el server manda por el `SMTP_FROM` de compatibilidad, y pedir que se elija algo
  // que no existe dejaría la vista trabada sin decir contra qué.
  const remitentes = estado.remitentes ?? [];
  if (!estado.sinRemitentes && remitentes.length > 0 && campos.remitenteId === null) {
    return NO('Elegí con qué remitente sale.');
  }

  if (campos.para.trim() === '') return NO('Falta a quién se lo mandás.');
  if (campos.asunto.trim() === '') return NO('Falta el asunto.');
  if (campos.cuerpo.trim() === '') return NO('Falta el texto del correo.');

  // ⚠️ Se mide el cuerpo CRUDO, no el recortado, igual que lo va a medir el server:
  // si uno contara los espacios del final y el otro no, el borde exacto sería
  // distinto en cada lado y volveríamos a tener dos criterios (#37).
  if (campos.cuerpo.length > TOPE_CUERPO) {
    const sobran = campos.cuerpo.length - TOPE_CUERPO;
    return NO(`El correo pasa de los ${conMiles(TOPE_CUERPO)} caracteres: sobran ${conMiles(sobran)}.`);
  }

  return { puede: true };
}

// ════════════════════════════════════════════════════════════════════════════
// EL SOBRE QUE SE MUESTRA
// ════════════════════════════════════════════════════════════════════════════

/** Lo que la pantalla dibuja arriba del composer: de quién sale y a dónde vuelve. */
export interface ResumenDelSobre {
  /** `Luz · Escuela Goberna <escuela@goberna.us>`, tal como lo va a ver el lead. */
  de: string;
  /** A dónde cae la respuesta. `null` = a ningún lado que podamos afirmar. */
  respondeA: string | null;
}

/**
 * EL SOBRE, PARA MOSTRARLO ANTES DE MANDAR.
 *
 * 🔴 **ES LA MISMA REGLA QUE `armarSobre` DEL SERVER, ESCRITA DOS VECES —
 * `server/src/correos/remitente.ts`.** Está anotado acá, arriba de todo y sin
 * matices, porque el argumento cómodo para dejar que se separen ya está escrito:
 * *«total, acá es sólo para mostrar»*. Es al revés: **mostrar algo distinto de lo
 * que sale es peor que no mostrar nada**. Un composer que no dibuja el sobre deja
 * a la vendedora sin saber; uno que dibuja «responde a luz@goberna.us» mientras el
 * server pone el buzón compartido la deja **creyendo que sabe**, y esa creencia es
 * la que hace que mande el correo. La pantalla vieja ya mintió dos veces por dos
 * frases sueltas; esto es lo que las reemplaza, y merece el mismo cuidado que un
 * envío.
 *
 * ⚠️ **Hace falta un test de paridad que cruce las dos** (#37), del molde de
 * `server/src/ivi/paridad-front.test.ts`: lo que hay que fijar no es el string
 * final —el server arma una cabecera RFC 5322 con comillas y acá se dibuja la
 * lectura humana— sino **la relación**: la misma precedencia del `Reply-To`, el
 * mismo separador, y que el buzón que se anuncia sea el mismo que sale.
 *
 * ══ LA PRECEDENCIA DEL `Reply-To` (decisión D2 del dueño, 17-ago-2026) ══════
 *
 * 🔴 **Gana el correo de la vendedora que escribió; el `responderA` del remitente
 * es el respaldo, y el orden no es intercambiable.** El `responderA` es un buzón
 * compartido: puesto arriba, la respuesta de un lead que Sindy trabajó hace tres
 * días le llega a todo el equipo y a nadie en particular — que es exactamente el
 * agujero que este frente vino a tapar.
 *
 * ⚠️ Que el correo de la vendedora viva en `grupogoberna.com` —**no verificado en
 * SES**— no es un problema acá y sí lo sería en el `From`: SES verifica de quién
 * SALE, no a dónde se CONTESTA. Por eso son dos campos y no uno.
 *
 * ⚠️ **`r === null` no es un error: es el camino de compatibilidad.** Sin ni un
 * remitente dado de alta se manda por el `SMTP_FROM`, y ahí el `de` es esa
 * dirección pelada. Devolver `de: ''` haría que la pantalla dibuje un sobre vacío,
 * que se lee como que algo se rompió.
 */
export function resumenDelSobre(
  r: RemitentePublico | null,
  vendedoraId: string,
  desdeCompat: string | null,
): ResumenDelSobre {
  const deLaVendedora = correoDeVendedora(vendedoraId);

  if (!r) {
    return { de: desdeCompat ?? '', respondeA: deLaVendedora };
  }

  // ⚠️ El nombre de quien escribe sale de `nombreCorto` (`dominio/dueno.ts`), que es
  // la misma función con la que la cola rotula al dueño de una conversación. Con
  // una copia propia acá, el mismo `vendedora_id` se leería «Ventas10» en la fila y
  // «ventas10» en el sobre, sobre el mismo humano.
  const partes = [nombreCorto(vendedoraId), r.nombre.trim()].filter((p) => p !== '');

  return {
    // Sin ninguna de las dos mitades la dirección va sola: un ` · ` huérfano o unos
    // picos vacíos se leen como un dato roto, y lo que falta acá es un nombre, no la
    // posibilidad de mandar el correo.
    de: partes.length === 0 ? r.direccion : `${partes.join(SEPARADOR_NOMBRES)} <${r.direccion}>`,
    respondeA: deLaVendedora ?? limpia(r.responderA),
  };
}

/** El `vendedora_id` si además es un buzón, o `null`. Gemelo de `correoDeVendedora` del server. */
function correoDeVendedora(vendedoraId: string): string | null {
  const limpio = vendedoraId.trim();
  return FORMA_DE_CORREO.test(limpio) ? limpio : null;
}

/**
 * Una cadena con algo adentro, o `null`. Una caja de espacios NO es un dato.
 *
 * ⚠️ **Se exporta porque el `null` y la cadena vacía significan cosas distintas del
 * otro lado**: «este remitente no firma» contra «firma con nada», y la segunda deja
 * un renglón en blanco pegado al final de cada correo. El formulario de remitentes
 * arma su cuerpo con esto en vez de con un `|| null` propio, que es como nace la
 * segunda versión de la misma decisión.
 */
export function limpia(crudo: string | null | undefined): string | null {
  const s = (crudo ?? '').trim();
  return s === '' ? null : s;
}

// ════════════════════════════════════════════════════════════════════════════
// CUANDO EL SERVER DICE QUE NO
// ════════════════════════════════════════════════════════════════════════════

/** Qué pasó, y si volver a apretar puede dar otro resultado. */
export interface LecturaDeErrorDeCorreo {
  texto: string;
  reintentable: boolean;
}

const LEER = (texto: string, reintentable: boolean): LecturaDeErrorDeCorreo => ({ texto, reintentable });

/**
 * Un entero de verdad que llegó por la red, o `null`.
 *
 * ⚠️ Un `techo` que viene como cadena **no se concatena**: caería en el mensaje
 * como «llegaste al techo: "20"» y, peor, dejaría pasar cualquier texto del server
 * directo a la pantalla. Ante algo que no es un número se cae a la lectura sin
 * cifras, que es correcta aunque diga menos.
 */
function entero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function cadena(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * LO QUE FALLÓ, EN CASTELLANO DE VENDEDORA.
 *
 * ══ EL CASO QUE OBLIGA A QUE ESTO EXISTA ════════════════════════════════════
 *
 * 🔴 **Un 400 por «pusiste varias direcciones» NO se puede leer como «no se pudo
 * enviar».** Quien escribió `ana@x.com, beto@y.com` cree que puso una lista y que
 * el sistema falló; con un mensaje genérico va a volver a apretar Enviar, y
 * después va a avisar que Correos está roto. Lo que necesita oír es que **un
 * correo va a una sola persona** — o sea el diseño, no un error. Y no es un borde
 * teórico: hasta este frente esa cadena **salía**, porque nodemailer la parte en
 * dos destinatarios sin decir nada, y la tabla `correos` guardaba UNA fila con la
 * cadena entera. La frase «nada masivo» del pie era una frase.
 *
 * ══ LAS TRES REGLAS ═════════════════════════════════════════════════════════
 *
 * 1. **Un código desconocido cae en una lectura conservadora, nunca en un
 *    `throw`.** El server sale por N5 y esta app por N4: los códigos nuevos llegan
 *    ANTES que la versión de la app que los conoce.
 * 2. **Ninguna lectura puede sonar a «no pasó nada» ni a «no hay nada».** Un fallo
 *    que se lee como un resultado vacío es el defecto que `errores.ts` de Ivi
 *    documenta y que un test recorre.
 * 3. **Lo que el server dijo sobre reintentar le gana a esta tabla** (#175), y se
 *    aplica al final y en un solo lugar, para que no se pueda agregar un caso nuevo
 *    y olvidarse de respetarlo.
 *
 * ⚠️ **ESTAS FRASES HABLAN DE UN ENVÍO, y por eso no se pueden reusar tal cual desde
 * la pantalla de remitentes**: ahí no se está mandando ningún correo, así que «el
 * correo no salió» sería un hecho falso escrito con toda seguridad. Lo que las dos
 * mitades SÍ comparten vive en `lecturaCompartida`, y el criterio para mudar algo
 * ahí está escrito en su docblock.
 */
export function lecturaDeError(err: unknown): LecturaDeErrorDeCorreo {
  // Ni siquiera se llegó al server: no hay `status` que interpretar y el correo con
  // seguridad no salió. Es lo único que se puede afirmar, y se afirma.
  if (!(err instanceof ErrorApi)) {
    return LEER('La app no pudo hablar con el server de Hermes. El correo no salió.', true);
  }

  const cuerpo = err.cuerpo ?? {};
  const motivo = cadena(cuerpo.motivo);
  const lectura = lecturaCompartida(err) ?? porCodigo(err, motivo, cuerpo);

  // El server, cuando se pronuncia, manda: pisa lo que decidió la tabla de arriba.
  return err.reintentable === undefined
    ? lectura
    : { ...lectura, reintentable: err.reintentable };
}

/**
 * LO QUE SE LEE IGUAL SE ESTUVIERA MANDANDO UN CORREO O ADMINISTRANDO REMITENTES.
 *
 * 🔴 **EL CRITERIO PARA MUDAR UN CASO ACÁ, Y ES DURO: la frase tiene que ser cierta
 * en las DOS pantallas.** Lo que motivó separarlo es que
 * `lecturaDeErrorDeRemitente` delegaba en `lecturaDeError` sin mirar esto, así que
 * un fallo al guardar un remitente —o al LEER la lista, que ni siquiera escribe—
 * salía en pantalla como «el correo no salió»: un hecho falso, afirmado con
 * seguridad, sobre una operación que no existió. No es un matiz de redacción, es la
 * misma familia de defecto que este frente entero vino a arreglar (el pie del
 * composer prometiendo un `Reply-To` que no se mandaba).
 *
 * Los tres que pasan la prueba: el perímetro de auth (401), quién administra
 * remitentes (403) y el SMTP sin configurar (503) — ninguno nombra un envío. Los que
 * **no** pasan y por eso se quedan afuera: el 400 (acá es el destinatario, allá la
 * dirección del remitente), el 429 (el ritmo es de envíos), el 502 (el rechazo del
 * proveedor sólo existe mandando) y el 409/404 (acá es «el remitente que elegiste
 * voló», allá «ese buzón ya está»).
 *
 * `null` = éste no es compartido; que lo lea quien llamó.
 */
function lecturaCompartida(err: ErrorApi): LecturaDeErrorDeCorreo | null {
  // El 401 lo emite el perímetro de auth, no Correos, y «volvé a entrar» no es un
  // reintento de esta acción: se resuelve antes que cualquier código.
  if (err.status === 401) {
    return LEER('Tu sesión venció. Volvé a entrar y probá de nuevo.', false);
  }

  if (err.status === 403) {
    // ⚠️ No se dice «no tenés permiso» a secas: el 403 de Correos nunca aparece
    // mandando un correo, sólo administrando remitentes, y confundirlos haría creer
    // que se perdió el permiso de escribirle a un lead.
    return LEER('Los remitentes los administra un supervisor. Pedile que lo dé de alta.', false);
  }

  if (err.status === 503) {
    return LEER(
      'El canal de correo no está configurado en este servidor: falta el SMTP. Es un paso de sistemas, no algo que hayas hecho mal.',
      false,
    );
  }

  return null;
}

function porCodigo(
  err: ErrorApi,
  motivo: string | null,
  cuerpo: Record<string, unknown>,
): LecturaDeErrorDeCorreo {
  if (err.status === 400) return porMotivoDelDestinatario(err, motivo);

  if (err.status === 429) {
    const techo = entero(cuerpo.techo);
    const usado = entero(cuerpo.usado);
    const cifras = techo !== null && usado !== null ? ` (${usado} de ${techo})` : '';
    // Se nombra CUÁNDO se destraba, no sólo que está trabado: sin eso lo único que
    // se puede hacer con el aviso es volver a probar, que es lo que no sirve.
    if (motivo === 'techo_dia') {
      return LEER(`Llegaste al techo de correos del día${cifras}. Sigue mañana.`, false);
    }
    return LEER(`Llegaste al techo de correos de esta hora${cifras}. Se destraba al cambiar la hora.`, false);
  }

  // 🔴 **EL REMITENTE QUE VOLÓ ES UN CASO NORMAL, NO UNA ROTURA — y hasta acá se
  // presentaba como «esta versión de Hermes no reconoce (409)».** El server modela
  // los dos con nombre propio (`remitente_retirado` 409 · `remitente_desconocido`
  // 404, `routes/correos.ts`) y se toma el trabajo de pagar una segunda consulta
  // sólo para distinguirlos, porque se arreglan distinto. Que otra supervisora
  // retire un buzón mientras esta vendedora tiene el composer abierto pasa sin que
  // nadie haga nada raro: leerlo como un bug del programa manda a reportar Hermes en
  // vez de a elegir otro remitente, que es lo único que hace falta.
  if (err.status === 409 || err.status === 404) return porRemitenteQueYaNoEsta(err);

  if (err.status === 502) {
    // El motivo crudo viene del proveedor y es lo único que distingue «la casilla no
    // existe» de «se cayó un momento». Se muestra aunque esté en inglés: sin él, dos
    // fallas con soluciones opuestas se leen igual.
    const detalle = cadena(err.message);
    return LEER(
      detalle
        ? `El correo no salió: el proveedor lo rechazó — ${detalle}`
        : 'El correo no salió: el proveedor lo rechazó.',
      true,
    );
  }

  // Un estado que esta versión no espera. Conservador en las dos puntas: no promete
  // que salió, no promete que reintentar sirva, y deja el número a la vista para que
  // una captura alcance para reportarlo.
  const dicho = cadena(err.message);
  return LEER(
    `El correo no salió y el server contestó algo que esta versión de Hermes no reconoce (${err.status}${dicho ? `: ${dicho}` : ''}).`,
    false,
  );
}

/**
 * LOS DOS ESTADOS EN LOS QUE EL SOBRE ELEGIDO YA NO SIRVE.
 *
 * ⚠️ **Se ramifica por `codigo` y no por el número**, y la salida cuando no hay
 * código no puede nombrar al remitente: `GET /api/correos/:id` también contesta 404
 * (`correo_desconocido`), así que un 404 pelado que llegue por otro camino diría con
 * total seguridad que voló un remitente que nadie tocó. Se dice lo único cierto de
 * ese estado —el server no encontró algo de lo que se le mandó— y se muestra lo que
 * dijo.
 *
 * ⚠️ **`reintentable: false` en los dos**: mandar otra vez EXACTAMENTE lo mismo
 * vuelve a fallar. Lo que destraba es elegir otro remitente, y por eso la frase
 * termina en esa acción y no en «probá de nuevo».
 */
function porRemitenteQueYaNoEsta(err: ErrorApi): LecturaDeErrorDeCorreo {
  if (err.codigo === 'remitente_retirado') {
    return LEER(
      'El remitente que elegiste se retiró mientras tenías esta pantalla abierta. Elegí otro de la lista y mandalo de nuevo: lo que ya salió por él no cambia.',
      false,
    );
  }

  if (err.codigo === 'remitente_desconocido') {
    return LEER('El remitente que elegiste ya no existe. Refrescá la pantalla y elegí otro de la lista.', false);
  }

  const dicho = cadena(err.message);
  return LEER(
    dicho
      ? `El correo no salió: ${dicho}`
      : 'El correo no salió: el server no encontró algo de lo que se le mandó. Refrescá la pantalla y probá de nuevo.',
    false,
  );
}

/**
 * Los cuatro motivos con los que el server rechaza un destinatario
 * (`correos/destinatario.ts`). No se colapsan en un «revisá el correo»: decirle
 * «pusiste varios» a quien escribió `Ana <ana@x.com>` la manda a buscar una coma
 * que no existe.
 */
function porMotivoDelDestinatario(err: ErrorApi, motivo: string | null): LecturaDeErrorDeCorreo {
  switch (motivo) {
    case 'varios':
      return LEER(
        'Un correo va a una sola persona, y en «Para» hay más de una dirección. Mandale a cada una por separado.',
        false,
      );
    case 'vacio':
      return LEER('Falta a quién se lo mandás: la casilla «Para» quedó vacía.', false);
    case 'forma':
      return LEER('Esa dirección no se lee como un correo. Revisá que tenga arroba y dominio, y nada más.', false);
    case 'salto_de_linea':
      return LEER('La dirección tiene un salto de línea. Escribila en un solo renglón.', false);
    default: {
      const dicho = cadena(err.message);
      return LEER(
        dicho ? `El correo no salió: ${dicho}` : 'El correo no salió: el server rechazó lo que se mandó.',
        false,
      );
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LA LISTA, AGRUPADA POR DÍA
// ════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ **El reloj se INYECTA**, y no es una comodidad de test: sin él, «ayer» sólo se
 * puede probar hasta la medianoche y el candado se pone rojo solo a las 00:00 de
 * cualquier día, en el CI de otra persona. El molde es
 * `senales/enfriamiento.ts`, que lo hace por la misma razón.
 */
export function etiquetaDia(fecha: string, ahora: Date = new Date()): string {
  const d = new Date(fecha);
  // Una fecha que no parsea se devuelve CRUDA. Es el mismo criterio que `fechaCorta`
  // y que `rotuloEtapa`: mostrar el dato feo es peor que mostrar «Invalid Date», y
  // las dos cosas son mejores que tirar y dejar la lista entera sin dibujar.
  if (Number.isNaN(d.getTime())) return fecha;

  if (mismoDia(d, ahora)) return 'hoy';

  const ayer = new Date(ahora);
  ayer.setDate(ahora.getDate() - 1);
  if (mismoDia(d, ayer)) return 'ayer';

  // ⚠️ De otro año se dice el AÑO. «lun 14 jul» sobre un correo de 2025 se lee como
  // de hace tres semanas, y en una lista ordenada por fecha eso no lo corrige nada.
  if (d.getFullYear() !== ahora.getFullYear()) return fechaCorta(fecha);

  return d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}

function mismoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export interface GrupoDeDia<T> {
  /** La llave del día, sólo para el `key` de React. No se muestra. */
  dia: string;
  etiqueta: string;
  correos: T[];
}

/**
 * Los correos partidos en días, **respetando el orden en el que vinieron**.
 *
 * ⚠️ **No ordena, y eso es deliberado**: el orden lo decide el server (la lista
 * viene del más nuevo al más viejo) y reordenarlo acá sería la misma regla en dos
 * lados — el precedente literal es la cola, que tampoco se reordena en el navegador
 * aunque el front sepa reordenarla. Un mismo día que aparece dos veces separado por
 * otro es un síntoma de que el server cambió el orden, y así se ve; escondiéndolo
 * con un `sort`, no.
 *
 * ⚠️ La llave del día se arma de las tres partes de la fecha LOCAL y no del
 * `creadoAt` recortado: el ISO viene en UTC, y a las 21:00 de Lima eso ya es el día
 * siguiente — los correos de una misma tarde quedarían partidos en dos grupos,
 * uno de ellos rotulado «hoy» y el otro también.
 */
export function agruparPorDia<T extends { creadoAt: string }>(
  correos: readonly T[],
  ahora: Date = new Date(),
): GrupoDeDia<T>[] {
  const grupos: GrupoDeDia<T>[] = [];

  for (const c of correos) {
    const d = new Date(c.creadoAt);
    const dia = Number.isNaN(d.getTime())
      ? c.creadoAt
      : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.dia === dia) ultimo.correos.push(c);
    else grupos.push({ dia, etiqueta: etiquetaDia(c.creadoAt, ahora), correos: [c] });
  }

  return grupos;
}

// ════════════════════════════════════════════════════════════════════════════
// LA ADMINISTRACIÓN DE REMITENTES
// ════════════════════════════════════════════════════════════════════════════

/**
 * ══ POR QUÉ ESTO NO VIVE EN `AdminRemitentes.tsx` ═══════════════════════════
 *
 * Vivía ahí, exportado desde el `.tsx`, y oxlint lo marcaba cuatro veces con
 * `react(only-export-components)`. La regla no es un capricho de estilo: un módulo
 * que exporta componentes **y** funciones sueltas rompe el fast-refresh y, más
 * importante acá, contradice la convención que el resto del frente sigue sin
 * excepción — la regla vive en el `.ts` puro (`ivi.ts`, `revision.ts`,
 * `presentacion.ts`, `cascara.ts`) y el `.tsx` sólo dibuja.
 *
 * ⚠️ Lo que se gana no es el lint apagado: es que estas preguntas —«¿qué pasa con un
 * dominio que SES no tiene verificado?»— se puedan hacer **sin montar nada**, que es
 * exactamente lo que su test hace hoy. Una regla metida adentro del JSX no se puede
 * interrogar sobre el caso que todavía no pasó.
 */

/** El formulario de un remitente, tal como está tipeado ahora mismo. Alta y edición son el mismo. */
export interface CamposDelRemitente {
  direccion: string;
  nombre: string;
  responderA: string;
  firma: string;
}

export const REMITENTE_VACIO: CamposDelRemitente = { direccion: '', nombre: '', responderA: '', firma: '' };

/** El dominio de una dirección, en minúsculas, o `null` si no se puede leer uno. */
export function dominioDe(direccion: string): string | null {
  const limpio = direccion.trim().toLowerCase();
  if (!FORMA_DE_CORREO.test(limpio)) return null;
  const dominio = limpio.slice(limpio.lastIndexOf('@') + 1);
  return dominio === '' ? null : dominio;
}

/**
 * ¿SES VA A ACEPTAR ESTE `From`?
 *
 * 🔴 **El error que esta pregunta evita es caro y TARDÍO.** SES verifica de quién
 * SALE un correo, no a dónde se contesta: `goberna.us` está verificado como dominio
 * y **`grupogoberna.com` no**, y tres de las nueve vendedoras tienen su
 * `vendedora_id` justamente en ese dominio. Dar de alta `ventas10@grupogoberna.com`
 * como remitente **no falla al guardarlo**: falla en el **554 de SES**, tres días
 * después, con un lead esperando del otro lado y sin nada en pantalla que ate una
 * cosa con la otra. El server lo valida igual —ésa es la garantía—; esto existe para
 * que la persona se entere **mientras lo está escribiendo**.
 *
 * 🔴 **UN DOMINIO VERIFICADO EN SES CUBRE SUS SUBDOMINIOS, Y ESTÁ MEDIDO — no se
 * puede volver a la igualdad exacta.** El 17-ago-2026 se mandó de verdad, con
 * controles que cortan la conclusión si la credencial no sirve:
 * `avisos@mail.goberna.us` y `a@x.y.goberna.us` **aceptados**; `prueba@gmail.com` y
 * `a@gobernaus.com` **554 «Email address is not verified»**. Ese segundo control es
 * el que obliga al `.` del `endsWith`: sin él, un dominio que sólo TERMINA parecido
 * pasaría.
 *
 * ⚠️ Esta comprobación puede ser **más floja** que la del server, nunca más estricta:
 * fallar hacia el «sí» cuesta un 400 que el server explica, y fallar hacia el «no»
 * deja a alguien peleando con una regla que no existe, desde una pantalla en la que
 * no puede hacer nada al respecto.
 *
 * ⚠️ **Con la lista ausente o vacía NO se valida nada.** Ausente es un server viejo
 * (N4↔N5) y vacía es indistinguible de un default: apagar el alta entera por
 * cualquiera de las dos dejaría esta pantalla muerta justo cuando hay que usarla.
 */
export function dominioAceptado(direccion: string, verificados: string[] | undefined): boolean {
  const dominios = (verificados ?? []).map((d) => d.trim().toLowerCase()).filter((d) => d !== '');
  if (dominios.length === 0) return true;

  const dominio = dominioDe(direccion);
  if (dominio === null) return false;

  return dominios.some((v) => dominio === v || dominio.endsWith(`.${v}`));
}

export type PuedeGuardar = { puede: true } | { puede: false; motivo: string };

/**
 * ¿SE PUEDE GUARDAR ESTE REMITENTE? — y si no, **por qué**, en la frase que va al
 * lado del botón apagado.
 *
 * Devuelve el motivo y no un booleano por lo mismo que `motivoParaNoEnviar`: un
 * botón gris sin explicación se lee como que la app se colgó, y lo que hace quien lo
 * mira es apretarlo de nuevo.
 *
 * ⚠️ El orden de las preguntas es **el de la pantalla** (dirección → nombre →
 * responder-a): el aviso tiene que apuntar a la primera caja con problema leyendo de
 * arriba hacia abajo, o señala una que está tres renglones más abajo de otra igual
 * de vacía.
 */
export function motivoParaNoGuardar(
  campos: CamposDelRemitente,
  dominiosVerificados: string[] | undefined,
  enVuelo = false,
): PuedeGuardar {
  if (enVuelo) return NO('Esperá: se está guardando.');

  const direccion = campos.direccion.trim();
  if (direccion === '') return NO('Falta la dirección por la que sale el correo.');
  if (!FORMA_DE_CORREO.test(direccion)) {
    return NO('Esa dirección no se lee como un correo. Revisá que tenga arroba y dominio, y nada más.');
  }
  if (!dominioAceptado(direccion, dominiosVerificados)) {
    const lista = (dominiosVerificados ?? []).join(' · ');
    return NO(
      `Amazon SES sólo deja mandar desde ${lista}. Con otro dominio el correo se guarda bien acá y lo rechaza el proveedor recién al mandarlo — el lead se queda esperando y nadie se entera.`,
    );
  }

  if (campos.nombre.trim() === '') return NO('Falta el nombre que va a ver quien lo reciba.');

  // El responder-a es opcional, pero si está escrito tiene que ser un correo: una
  // cadena a medias acá no rompe nada al guardar y manda la respuesta del lead a
  // ningún lado, que es el agujero exacto que este frente vino a tapar.
  const responderA = campos.responderA.trim();
  if (responderA !== '' && !FORMA_DE_CORREO.test(responderA)) {
    return NO('El «responder a» tampoco se lee como un correo. Dejalo vacío o escribí una dirección entera.');
  }

  return { puede: true };
}

/**
 * LO QUE FALLÓ ADMINISTRANDO REMITENTES, en castellano — **y sin nombrar ningún
 * envío**.
 *
 * 🔴 **ACÁ NO SE ESTÁ MANDANDO NINGÚN CORREO, y delegar en `lecturaDeError` hacía
 * que la pantalla afirmara que sí.** Esta función devolvía `lecturaDeError(err).texto`
 * para todo lo que no fuera 409 o 404, así que un fallo al guardar un remitente
 * salía como **«el correo no salió»** y un fallo al LEER LA LISTA —que ni siquiera
 * escribe nada— también. Es el mismo defecto que este frente vino a arreglar en el
 * pie del composer: una frase que suena bien afirmando algo que no pasó. Lo que sí
 * se comparte vive en `lecturaCompartida`, con el criterio escrito.
 *
 * ⚠️ **Ninguna frase puede decir «no se guardó», tampoco.** Se usa igual para los
 * cuatro caminos —alta, edición, baja y la LECTURA de la lista—, así que afirmar una
 * escritura fallida sería falso en el cuarto; y con un fallo de red ni siquiera se
 * sabe si el server llegó a escribir. Se dice lo que se sabe: no se pudo hablar.
 *
 * 🔴 **El 409 significa cosas distintas de los dos lados de Correos**, y por eso no
 * hay una sola tabla: acá es `remitente_repetido` («ese buzón ya está») y en el
 * envío es `remitente_retirado` («el que elegiste voló»). Un 409 leído con la tabla
 * equivocada manda a la persona a arreglar algo que está bien.
 *
 * Devuelve texto y no `LecturaDeErrorDeCorreo` a propósito: acá el «Reintentar» lo
 * decide la pantalla (una lista que no se pudo leer siempre se puede volver a
 * pedir), no una tabla de códigos.
 */
export function lecturaDeErrorDeRemitente(err: unknown): string {
  if (!(err instanceof ErrorApi)) {
    return 'La app no pudo hablar con el server de Hermes. Probá de nuevo en un momento.';
  }

  const compartida = lecturaCompartida(err);
  if (compartida) return compartida.texto;

  if (err.status === 409) {
    // El índice del server va sobre `lower(direccion)`, así que la fila que choca
    // puede no verse igual a la que acaban de escribir — y puede estar retirada, o
    // sea invisible en la lista. Si el mensaje no lo dice, la pantalla no puede
    // explicar por qué rebotó algo que no aparece por ningún lado.
    return 'Ese buzón ya está dado de alta (las mayúsculas no lo hacen distinto). Si no aparece en la lista es porque está retirado: reactivalo en vez de crearlo de nuevo.';
  }

  if (err.status === 404) {
    return 'Ese remitente ya no está: alguien lo dio de baja mientras tenías la pantalla abierta. Refrescá y volvé a intentar.';
  }

  if (err.status === 400) {
    // El server valida lo mismo que `motivoParaNoGuardar` y algo más (los saltos de
    // línea en las cabeceras, el largo). Su texto es más específico que cualquier
    // cosa que se pueda escribir acá, así que se muestra.
    const dicho = cadena(err.message);
    return dicho
      ? `El server rechazó lo que se mandó: ${dicho}`
      : 'El server rechazó lo que se mandó. Revisá la dirección y el nombre.';
  }

  // Un estado que esta versión no espera. El server sale por N5 y esta app por N4:
  // los códigos nuevos llegan ANTES que la versión de la app que los conoce. Se deja
  // el número a la vista para que una captura alcance para reportarlo.
  const dicho = cadena(err.message);
  return `El server contestó algo que esta versión de Hermes no reconoce (${err.status}${dicho ? `: ${dicho}` : ''}).`;
}
