import { fileURLToPath } from 'node:url';
import { TransporteFalso } from './transporteFalso.js';
import { TransporteWhatsmeow } from './transporteWhatsmeow.js';
import { TransporteCloudApi } from './transporteCloudApi.js';
import { IngestaWhatsapp } from './ingesta.js';
import { EnvioControlado } from './envioControlado.js';
import { repositorioDrizzle } from './repositorioDrizzle.js';
import { registroEnviosDrizzle } from './registroEnviosDrizzle.js';
import { GestorWhatsapp, numerosConfigurados, type WhatsappArmado } from './gestor.js';
import { emitirRT } from '../realtime/bus.js';
import { notificarEntrante } from '../bot/ingesta.js';
import { configDesdeEnv } from '../bot/config.js';
import { db } from '../db/client.js';
import { guardarReaccion } from '../reacciones/repositorio.js';
import { aplicarRecibo } from '../entrega/repositorio.js';
import type { TransporteWhatsapp } from './transporte.js';
import { porQueFallo } from '../lib/porQueFallo.js';

/**
 * EL ARMADO DE WHATSAPP AL ARRANCAR EL SERVER — ahora de N números (#50).
 *
 * Elige el transporte por env (`WHATSAPP_TRANSPORTE`: `falso` o `whatsmeow`), lo
 * engancha a la ingesta (persiste cada mensaje) y monta la única puerta de
 * salida (`EnvioControlado`). Es el ÚNICO lugar que decide qué transportes
 * corren; todo lo demás habla con la interfaz.
 *
 *   · falso     → para desarrollo y demo, sin vincular nada.
 *   · whatsmeow → el real. La sesión se vincula aparte (`npm run wa:vincular`,
 *                 decisión D13); acá solo se conecta a la sesión ya guardada.
 *   · cloud-api → SPIKE (30-jul-2026), un número de PRUEBA de la Cloud API
 *                 oficial de Meta. Se monta SIEMPRE ADEMÁS de lo elegido por
 *                 `WHATSAPP_TRANSPORTE`, nunca en su lugar: se prende solo si
 *                 `WHATSAPP_CLOUD_API_NUMERO_PROPIO` está puesto (ausente =
 *                 apagado). Si fuera excluyente, prenderlo en VPS1 apagaría
 *                 las tres líneas whatsmeow reales — exactamente lo que este
 *                 diseño existe para no poder hacer.
 *
 * **Qué números corren y cómo se los encuentra vive en `gestor.ts`**, que es puro
 * y se testea sin base. Acá queda el cableado: instanciar, enganchar la ingesta y
 * arrancar.
 *
 * ══ QUÉ REEMPLAZA, Y POR QUÉ ════════════════════════════════════════════════
 *
 * Hasta acá esto era **un** transporte en un singleton (`let armado`). El equipo
 * vende por varias líneas, así que el modelo de datos ya estaba listo para
 * varias —la clave de una conversación es
 * `conv:<canal>:<persona>:<numeroPropio>` desde el día uno— pero el runtime no:
 * había una sola sesión viva, elegida por `WHATSAPP_NUMERO`.
 *
 * La consecuencia práctica, que es lo que motiva el cambio: **vincular una
 * segunda línea no la ponía a andar**, y apuntar `WHATSAPP_NUMERO` a la nueva
 * **apagaba la primera**. No había forma de tener dos.
 *
 * ══ `whatsapp()` SIGUE EXISTIENDO, Y APUNTA AL PRIMERO ══════════════════════
 *
 * Hay consumidores escritos cuando había una sola línea (`/sesion`,
 * `conversacionWa.ts`). Se los deja andando contra el primer número en vez de
 * romperlos en el mismo cambio: migrarlos es trabajo aparte y con su propio
 * riesgo. Lo que NO se deja pasar es un envío enrutado a la línea equivocada —
 * de eso se ocupa la guarda #0 de `EnvioControlado`, que compara el
 * `numeroPropio` de la orden con el del transporte al que se la mandó.
 */

export { GestorWhatsapp, numerosConfigurados, type WhatsappArmado };

let gestor: GestorWhatsapp | null = null;

/** Monta UNA línea: transporte + ingesta + puerta de salida. */
function montar(numero: string, cual: string): WhatsappArmado {
  let transporte: TransporteWhatsapp;
  let falso: TransporteFalso | null = null;

  if (cual === 'whatsmeow') {
    const dir = fileURLToPath(new URL('../../.wa-sessions/', import.meta.url));
    transporte = new TransporteWhatsmeow(numero, dir);
  } else if (cual === 'cloud-api') {
    // SPIKE (30-jul-2026): número de PRUEBA de la Cloud API oficial de Meta —
    // nunca una de las tres líneas whatsmeow de producción. Ver transporteCloudApi.ts.
    const phoneNumberId = process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
    if (!phoneNumberId || !token) {
      throw new Error(
        'WHATSAPP_TRANSPORTE=cloud-api necesita WHATSAPP_CLOUD_API_PHONE_NUMBER_ID y WHATSAPP_CLOUD_API_TOKEN.',
      );
    }
    transporte = new TransporteCloudApi({ numeroPropio: numero, phoneNumberId, token });
  } else {
    falso = new TransporteFalso({ telefono: numero });
    transporte = falso;
  }

  const ingesta = new IngestaWhatsapp(transporte, repositorioDrizzle, (m) => {
    // El bot llega por EL MISMO camino que ve la conversación: un entrante nuevo
    // en una línea de BOT_LINEAS crea el claim (notificarEntrante filtra la línea
    // y aplica el debounce). El webhook Cloud API es un camino aparte para cuando
    // el transporte sea cloud-api; acá va el de whatsmeow (y el falso, en dev).
    void notificarEntrante(
      `conv:whatsapp:${m.telefono}:${m.numeroPropio}`,
      m.numeroPropio,
      m.ocurridoEn,
      configDesdeEnv(),
    ).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[bot] notificarEntrante falló:', (err as Error).message);
    });
  });
  ingesta.iniciar();

  /**
   * LAS REACCIONES, por su propio canal.
   *
   * No pasan por `IngestaWhatsapp` a propósito: esa clase proyecta MENSAJES a
   * `interactions`, y una reacción no lo es — meterla ahí la dibujaría como una
   * burbuja vacía, que es el bug #70 exacto. Va derecho a su tabla.
   *
   * Fail-open y ruidoso: si guardarla falla, se loguea y la conversación sigue.
   * Un hilo sin un 👍 sigue siendo el hilo; un hilo que no carga no es nada.
   */
  transporte.onReaccion?.((r) => {
    void guardarReaccion(db, r)
      .then((que) => {
        // El hilo abierto se refresca solo: una reacción que aparece 5 s
        // después de que la pusieron se siente rota.
        if (que !== 'sin_tabla') emitirRT({ tipo: 'mensaje', canal: 'whatsapp', telefono: r.dePersona });
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[reacciones] no se pudo guardar:', (err as Error).message);
      });
  });

  /**
   * LOS ✓✓ de whatsmeow. Los de la línea Cloud API NO pasan por acá: llegan
   * como `statuses[]` al webhook, que es otro camino y ya los aplica.
   *
   * Fail-open: un recibo perdido deja el mensaje en su estado anterior, que es
   * exactamente como se veía antes de este frente.
   */
  transporte.onRecibo?.((r) => {
    void aplicarRecibo(db, r)
      .then((filas) => {
        // Solo se avisa si algo cambió de verdad: los recibos repetidos son la
        // mayoría, y un refresco por cada uno castigaría la pantalla.
        if (filas > 0) emitirRT({ tipo: 'mensaje', canal: 'whatsapp', telefono: null });
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[entrega] no se pudo aplicar el recibo:', porQueFallo(err));
      });
  });

  // Cada cambio de estado (conectado/desconectado/baneado) se empuja en vivo: el
  // header y el banner de sesión se actualizan sin recargar. Con varias líneas el
  // log dice CUÁL cambió — un «desconectado» sin número no se puede accionar.
  transporte.onEstado((e) => {
    // eslint-disable-next-line no-console
    console.log(`[wa estado] ${numero}: ${e.estado}`);
    emitirRT({ tipo: 'estado' });
  });

  /**
   * ⚠ EL ARRANQUE DE UNA LÍNEA NO PUEDE TUMBAR A LAS DEMÁS.
   *
   * Esto era `void transporte.iniciar()`. `void` no captura nada: si `init()`
   * rechaza —sesión corrupta, binario de whatsmeow que no levanta, `.db`
   * ilegible— queda una promesa rechazada sin manejar, y Node mata el proceso.
   * Con UNA línea eso era casi lo correcto: sin WhatsApp no hay Hermes. Con
   * varias es exactamente lo contrario — **la sesión vencida de la vendedora
   * nueva se llevaría puesta la línea que factura**, y encima en un ciclo de
   * systemd que reintenta y vuelve a morir.
   *
   * Se captura por línea y se sigue. La que falló queda en el estado que tenga
   * (nunca «conectado»), así que el semáforo del panel y `GET /lineas` la
   * muestran caída — que es la verdad, y es accionable. Lo que NO se hace es
   * fingir que arrancó.
   */
  void transporte.iniciar().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(
      `[wa arranque] la línea ${numero} NO pudo iniciar: queda caída y las demás siguen. ` +
        `Revisá su sesión en .wa-sessions/${numero}.db (re-vincular desde el panel de Cerberus).`,
      err,
    );
  });

  return { numero, transporte, envio: new EnvioControlado(transporte, registroEnviosDrizzle), falso };
}

export function arrancarWhatsapp(): GestorWhatsapp {
  const cual = process.env.WHATSAPP_TRANSPORTE ?? 'falso';
  const g = new GestorWhatsapp();

  if (cual === 'whatsmeow') {
    const numeros = numerosConfigurados();
    if (numeros.length === 0) {
      throw new Error(
        'WHATSAPP_TRANSPORTE=whatsmeow necesita WHATSAPP_NUMEROS (o WHATSAPP_NUMERO): los números propios ya vinculados con wa:vincular.',
      );
    }
    for (const n of numeros) g.agregar(montar(n, cual));
  } else {
    // El falso arranca con su número de siempre. Acepta la lista igual, para
    // poder reproducir en dev el escenario de dos líneas sin vincular nada.
    const numeros = numerosConfigurados({
      WHATSAPP_NUMEROS: process.env.WHATSAPP_NUMEROS_FALSOS ?? process.env.WHATSAPP_NUMERO_FALSO ?? '51987654321',
    } as NodeJS.ProcessEnv);
    for (const n of numeros) g.agregar(montar(n, cual));
  }

  // SPIKE cloud-api (30-jul-2026): número de PRUEBA de la Cloud API oficial de
  // Meta, SIEMPRE ADEMÁS de lo de arriba — nunca en su lugar. `WHATSAPP_TRANSPORTE`
  // decide whatsmeow/falso para las líneas de siempre; esto se prende con SU
  // PROPIA variable, ausente = apagado (igual que `BOT_LINEAS`), justamente para
  // que activarlo en VPS1 no pueda apagar las tres líneas reales de las vendedoras.
  const numeroCloudApi = process.env.WHATSAPP_CLOUD_API_NUMERO_PROPIO;
  if (numeroCloudApi) {
    g.agregar(montar(numeroCloudApi, 'cloud-api'));
  }

  gestor = g;
  return g;
}

/** El gestor vivo. Lanza si se pide antes de arrancar. */
export function gestorWhatsapp(): GestorWhatsapp {
  if (!gestor) throw new Error('WhatsApp no está arrancado todavía.');
  return gestor;
}

/**
 * MONTA UNA LÍNEA WHATSMEOW NUEVA EN CALIENTE — sin reiniciar el server.
 *
 * Hasta la auto-vinculación, `WHATSAPP_NUMEROS` era la ÚNICA forma de que una
 * línea recién vinculada empezara a andar: el operador editaba el `.env` de
 * VPS1 y reiniciaba (`docs`, gotcha «N5 verde no siempre reinicia»). Eso es
 * aceptable para Cerberus, que vincula de a una y con tiempo — pero rompe el
 * punto entero de que una vendedora se auto-vincule DESDE LA APP: si la línea
 * queda vinculada y sigue muda hasta que alguien reinicie el server, el enlace
 * no sirvió de nada.
 *
 * Reusa el MISMO `montar()` que usa `arrancarWhatsapp()` al bootear, así que la
 * línea nueva queda enganchada a la ingesta, las reacciones, los ✓✓ y
 * `EnvioControlado` exactamente igual que cualquier otra — no es un camino
 * aparte, es el mismo camino un rato después.
 *
 * 🔴 **ESTO ES SOLO EL PROCESO VIVO — NO SOBREVIVE UN REINICIO.** No toca
 * `WHATSAPP_NUMEROS`: sigue siendo la ÚNICA lista que `arrancarWhatsapp()` lee
 * al bootear (`numerosConfigurados()`). Una vendedora que se auto-vincula queda
 * andando AHORA MISMO, pero si el server reinicia (N5, un crash, un `systemctl
 * restart`) esa línea no vuelve a montarse sola — `numeros_wa` sigue diciendo
 * que está vinculada, y nada la levanta hasta que un operador la agregue a mano
 * al `.env` y reinicie, exactamente como hoy con una línea de Cerberus. Cerrar
 * esa brecha es sacar el arranque de `WHATSAPP_NUMEROS` y leerlo de
 * `numeros_wa` — ya está anotado como decisión aparte en `numeros/dominio.ts`
 * (#194) y no se resuelve acá: la contrapartida (leer `WHATSAPP_NUMEROS` al
 * bootear) es lo que hoy garantiza que un `.env` sin tocar levanta igual que
 * ayer, y tocar esa garantía es su propio frente, no un efecto colateral de
 * este.
 */
export function agregarLineaWhatsmeow(numero: string): WhatsappArmado {
  const g = gestorWhatsapp();
  if (g.de(numero)) {
    throw new Error(`La línea ${numero} ya está montada: no se monta dos veces.`);
  }
  const armado = montar(numero, 'whatsmeow');
  g.agregar(armado);
  return armado;
}

/**
 * Como `gestorWhatsapp()`, pero `null` en vez de lanzar. Para consumidores que
 * no pueden tumbar el proceso si WhatsApp corre con otro transporte o todavía
 * no arrancó — el webhook de la Cloud API (`webhook/whatsapp.ts`) es el caso:
 * un POST de Meta no puede 500 solo porque el server local corre `falso`.
 */
export function gestorWhatsappSiActivo(): GestorWhatsapp | null {
  return gestor;
}

/**
 * El armado de la PRIMERA línea, para los consumidores de un solo número.
 *
 * Se conserva a propósito (ver la cabecera): migrar a `gestorWhatsapp().de(n)`
 * cada consumidor es trabajo aparte. Lo que no depende de esta migración es que
 * un envío no salga por la línea equivocada — eso ya lo garantiza la guarda #0.
 */
export function whatsapp(): WhatsappArmado {
  return gestorWhatsapp().primero();
}
