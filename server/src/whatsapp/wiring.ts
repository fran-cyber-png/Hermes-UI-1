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
import type { TransporteWhatsapp } from './transporte.js';

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
