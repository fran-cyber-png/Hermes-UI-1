import { db } from '../db/client.js';
import { proyectarMensaje } from '../whatsapp/proyectar.js';
import { repositorioDrizzle as repoMensajes } from '../whatsapp/repositorioDrizzle.js';
import { whatsapp } from '../whatsapp/wiring.js';
import { configDesdeEnv } from './config.js';
import { Despachador } from './despachador.js';
import { correrEncolado } from './encolar.js';
import { repositorioDrizzle } from './repositorio.js';

/**
 * EL RELOJ DE LA AUTO-RESPUESTA — dos ritmos, los dos apagados por defecto.
 *
 *   · el ENCOLADO (cada 5 min): mira quién quedó esperando y le reserva hora.
 *   · el DESPACHADOR (cada 30 s): manda como mucho UNA, si ya venció.
 *
 * Sigue la convención de `lazo/reloj.ts`: lo que ESCRIBE hacia afuera arranca
 * apagado y se enciende a propósito. Acá hay dos llaves — `AUTO_RESPUESTA=on`
 * (entorno) y el interruptor de la base — y esta función solo mira la primera:
 * la segunda la miran el encolado y el despachador en CADA corrida, que es lo
 * que hace que apagarla sin deploy tenga efecto inmediato.
 */

let despachador: Despachador | null = null;
let timerEncolado: NodeJS.Timeout | null = null;

export function arrancarAutoRespuesta(): void {
  const cfg = configDesdeEnv();

  if (!cfg.habilitada) {
    console.log(
      '[auto-respuesta] APAGADA (AUTO_RESPUESTA no está en `on`). Nadie recibe respuestas automáticas. ' +
        'Antes de encenderla: `npm run auto:simulacro` para ver el plan de despacho. Ver ADR 0015.',
    );
    return;
  }

  const repo = repositorioDrizzle(db);

  despachador = new Despachador({
    repo,
    // La ÚNICA puerta de salida, la misma que usa la vendedora.
    envio: whatsapp().envio,
    estadoSesion: () => whatsapp().transporte.estado(),
    cfg,
    // El saliente se persiste para que aparezca en el hilo con su marca.
    persistirSaliente: async (s) => {
      const proy = proyectarMensaje({
        idExterno: s.idExterno,
        numeroPropio: s.numeroPropio,
        telefono: s.telefono,
        esMio: true,
        esGrupo: false,
        ocurridoEn: s.ocurridoEn,
        nombreVisible: null,
        texto: s.texto,
        clase: 'texto',
      });
      if ('evento' in proy) await repoMensajes.persistir(proy.evento, proy.interaccion);
    },
  });
  despachador.iniciar();

  const encolar = () => {
    void correrEncolado({ base: db, repo, cfg }).catch((e) =>
      console.error(`[auto-respuesta] error encolando: ${(e as Error).message}`),
    );
  };
  timerEncolado = setInterval(encolar, cfg.encoladoMinutos * 60_000);
  timerEncolado.unref?.();
  encolar();

  console.log(
    `[auto-respuesta] encendida en el entorno (franja ${cfg.franja.desde}–${cfg.franja.hasta} ${cfg.zona}, ` +
      `despacho ${cfg.ventanaDespacho.desde}–${cfg.ventanaDespacho.hasta}, ` +
      `espaciado ${cfg.espaciadoSegundos[0]}–${cfg.espaciadoSegundos[1]} s, ` +
      `techos ${cfg.techoPorHora}/h y ${cfg.techoPorDia}/día). ` +
      'Falta la segunda llave: el interruptor de la base (`PUT /api/autorespuesta/interruptor`).',
  );
}

/** Para los tests y para un apagado ordenado. */
export function detenerAutoRespuesta(): void {
  despachador?.detener();
  despachador = null;
  if (timerEncolado) clearInterval(timerEncolado);
  timerEncolado = null;
}
