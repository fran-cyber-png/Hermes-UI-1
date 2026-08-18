/**
 * EL CONTRATO DE CORREOS, DEL LADO DEL NAVEGADOR — copia del server, y ninguna
 * de las dos mitades es la fuente de verdad de la otra.
 *
 * ══ POR QUÉ CASI TODO ES OPCIONAL ═══════════════════════════════════════════
 *
 * 🔴 **El front y el server NO se despliegan juntos, y la ventana entre los dos
 * dura horas.** El front sale por **N4** (automático, sin restart, apenas pasa
 * staging) y el server por **N5**, que es un botón que aprieta una persona. O sea
 * que existe —siempre, en cada PR que toca las dos mitades— un rato en que la app
 * NUEVA le está hablando al server VIEJO. Y hay un segundo camino para lo mismo
 * que no depende del deploy: el caché de consultas se persiste en IndexedDB
 * (ADR 0007) y se rehidrata antes del primer render, así que una respuesta de ayer
 * —guardada por una versión anterior de la app— se lee como si acabara de llegar.
 *
 * Por eso **el tipo dice la verdad sobre lo que puede faltar** en vez de mentir
 * con campos requeridos que el consumidor va a completar con un `??` a mano. Un
 * `supervisor: boolean` requerido no evita el `undefined`: lo esconde, y el
 * `if (estado.supervisor)` de la pantalla se lee como si nunca pudiera fallar.
 * Con `supervisor?: boolean`, TypeScript obliga a decidir qué se hace mientras
 * no se sabe — que es la pregunta que importa.
 *
 * ⚠️ **El default de cada campo ausente NO es siempre `false`, y por eso no vive
 * acá sino en cada consumidor**: `remitentes ?? []` (no hay ninguno que mostrar) y
 * `supervisor ?? false` (fail-closed: no se dibuja una pantalla de administración
 * sobre una duda) van para un lado, pero el precedente exacto de que a veces va al
 * revés es `soloMisAsignadas ?? true` en `VistaDashboard.tsx:221` — ahí el `false`
 * por default le habría escondido «El negocio» a TODAS durante la ventana N4↔N5.
 *
 * ══ LO QUE **NO** ESTÁ ACÁ, A PROPÓSITO ═════════════════════════════════════
 *
 * 🔴 **`CorreoEnLista` no lleva `cuerpo`.** `GET /api/correos` servía el cuerpo
 * COMPLETO de todos los correos del equipo en cada carga de la vista: el texto que
 * Sindy le escribió a un lead viajaba al navegador de las otras ocho sin que nadie
 * lo pidiera ni lo mostrara. Ahora el cuerpo se PIDE, de a uno, por
 * `GET /api/correos/:id` (`CorreoCompleto`). Que sean dos tipos y no uno con
 * `cuerpo?: string` es deliberado: con el campo opcional, la lista y el detalle se
 * vuelven el mismo tipo y nada impide que mañana alguien lo emita de nuevo en la
 * lista «total ya está en el tipo».
 */

/**
 * Un remitente tal como lo ve una vendedora: lo que hace falta para DIBUJAR el
 * sobre antes de mandar.
 *
 * 🔴 Es lo que vuelve verdadera la promesa vieja de la pantalla. El pie del
 * composer decía «con tu nombre» y el `From` era `Escuela Goberna
 * <escuela@goberna.us>` para las nueve; el placeholder decía «con tu firma de
 * siempre» y no había una sola línea de código que agregara una firma. Con estos
 * campos la pantalla puede **mostrar** con qué nombre sale y a dónde vuelven las
 * respuestas, en vez de prometerlo — ver `resumenDelSobre` en `correos.ts`.
 */
export interface RemitentePublico {
  id: number;
  /** El buzón por el que SALE. Vive en un dominio verificado en SES (`goberna.us`). */
  direccion: string;
  /** El display name del remitente («Escuela Goberna»). SES no lo verifica. */
  nombre: string;
  /**
   * A dónde vuelven las respuestas cuando el `vendedora_id` de quien escribe no es
   * un buzón. `null` = no se configuró ninguno.
   */
  responderA: string | null;
  /** El texto que se pega al final del cuerpo. `null` = este remitente no firma. */
  firma: string | null;
}

/**
 * El remitente COMPLETO, para administrarlo. Sólo se sirve a quien manda en el
 * equipo (`GET /api/correos/remitentes`, 403 `no_es_supervisor` al resto).
 *
 * ⚠️ **Incluye los inactivos, y ése es el motivo de que exista aparte de
 * `RemitentePublico`.** Dar de baja es lógico (`activo = false`), así que sin
 * servir lo apagado no habría forma de volver a prender nada — el mismo criterio
 * que `GET /api/hechos/catalogo`.
 */
export interface Remitente extends RemitentePublico {
  activo: boolean;
  /** Ausente en un server que todavía no lo emite: es dato de auditoría, no de decisión. */
  creadoAt?: string;
}

/**
 * Cuánto le queda a ESTA vendedora antes de que el server la frene.
 *
 * ⚠️ **Es informativo; la garantía es el 429.** La pantalla lo muestra para que
 * nadie escriba un correo entero y recién ahí se entere, pero quien decide es el
 * server (`correos/ritmo.ts`). Reimplementar el corte acá y creerle sería el bug
 * de #37 en su forma más cara: dos cuentas de la misma ventana que se separan sin
 * que nada falle.
 *
 * ⚠️ El sujeto es la **vendedora**, no la línea ni el remitente: los remitentes son
 * un puñado compartido por todo el equipo, así que un techo por remitente dejaría
 * que la primera que empieza a mandar se coma el cupo de las otras ocho.
 */
export interface RitmoDeCorreos {
  techoHora: number;
  techoDia: number;
  usadoHora: number;
  usadoDia: number;
}

/** `GET /api/correos/estado`. */
export interface EstadoDeCorreos {
  /** ¿Hay SMTP configurado? Sin esto no sale nada y la pantalla lo dice en vez de fingir. */
  conectado: boolean;
  /**
   * El `SMTP_FROM` de compatibilidad: por dónde sale un correo cuando no hay ni un
   * remitente dado de alta. `null` = ni siquiera eso está configurado.
   */
  desde: string | null;
  /** Los remitentes ACTIVOS, para elegir. Ausente = server viejo → `?? []`. */
  remitentes?: RemitentePublico[];
  /**
   * No hay tabla de remitentes o no hay ni una fila: se manda por `desde`.
   *
   * ⚠️ **No es lo mismo que `remitentes.length === 0`**, aunque hoy coincidan: esto
   * dice «el frente no está montado y se está usando el camino viejo», y con eso la
   * pantalla puede no pedir que se elija un remitente que no existe.
   */
  sinRemitentes?: boolean;
  /** ¿Puede administrar remitentes? Ausente → `?? false`: fail-closed. */
  supervisor?: boolean;
  /**
   * Los dominios que SES tiene verificados (hoy `['goberna.us']`).
   *
   * 🔴 Existe porque el error que evita es caro y tardío: `grupogoberna.com` **no**
   * está verificado, y tres de las nueve tienen su `vendedora_id` en ese dominio.
   * Darlo de alta como `From` no falla al guardarlo — falla en el **554 de SES**,
   * con un lead esperando del otro lado.
   */
  dominiosVerificados?: string[];
  /** Ausente = server viejo: no se dibuja el contador y no se frena nada acá. */
  ritmo?: RitmoDeCorreos;
}

/**
 * Un correo en la lista de «últimos enviados». **Sin cuerpo** — ver el docblock
 * de arriba.
 */
export interface CorreoEnLista {
  id: number;
  vendedoraId: string;
  para: string;
  asunto: string;
  estado: 'enviado' | 'fallido';
  /** Por qué falló, en criollo. `null` cuando salió bien. */
  motivo: string | null;
  /**
   * El `From` con el que SALIÓ, tal como lo vio quien lo recibió. Ausente en las
   * filas anteriores al frente: no hay backfill posible y un remitente inventado
   * es peor que un hueco (el criterio de los ✓✓).
   */
  desde?: string | null;
  /** El `Reply-To` con el que salió. Mismo criterio que `desde`. */
  responderA?: string | null;
  creadoAt: string;
}

/** `GET /api/correos/:id` — lo mismo, más el cuerpo, que acá SÍ se pidió. */
export interface CorreoCompleto extends CorreoEnLista {
  cuerpo: string;
}
