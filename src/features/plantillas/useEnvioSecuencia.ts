import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ErrorApi } from '../../lib/datos/cliente';
import type { Conversacion } from '../canales/conversaciones';
import {
  avanzar,
  ESPERA_ENTRE_PASOS_MS,
  INICIAL,
  type EstadoSecuencia,
} from './secuencia';

/**
 * EL BUCLE DE ENVÍO — y vive ACÁ, en la pantalla de la vendedora, a propósito.
 *
 * El server expone `POST /api/plantillas/:id/enviar-paso`: **un mensaje por
 * llamada**. No existe un endpoint que reciba «mandá los cuatro», porque eso
 * sería un bot: la vendedora no podría frenarlo, no vería dónde va, y algo
 * seguiría mandando después de cerrar la app.
 *
 * Con el bucle acá arriba, las tres cosas que la casa exige son estructurales:
 *   · **ve el progreso** — cada vuelta actualiza «enviando 2 de 4»;
 *   · **puede cancelar a mitad** — la bandera corta el bucle antes del siguiente;
 *   · **si cierra la app, no queda nada mandándose solo** — el bucle muere con
 *     el componente.
 *
 * El espaciado (`ESPERA_ENTRE_PASOS_MS`) no es anti-ban ni warmup —eso está
 * prohibido y además no funciona—: es que cuatro mensajes en el mismo segundo se
 * leen como un bot del otro lado, y el punto de Hermes es que ahí hay una persona.
 */

interface PasoAEnviar {
  orden: number;
  mediaPendiente: boolean;
}

export function useEnvioSecuencia(conversacion: Conversacion | null) {
  const [estado, setEstado] = useState<EstadoSecuencia>(INICIAL);
  /** La bandera de corte. Un ref: el bucle la lee sin re-suscribirse a nada. */
  const cancelado = useRef(false);
  /**
   * El estado vive en un ref ADEMÁS de en el state: el bucle y el botón de
   * cancelar lo tocan desde dos tiempos distintos, y con solo el state uno de
   * los dos leería una foto vieja. Todas las transiciones pasan por `aplicar`,
   * así la máquina pura (`secuencia.ts`) es la única que decide.
   */
  const maquina = useRef<EstadoSecuencia>(INICIAL);
  const qc = useQueryClient();

  function aplicar(evento: Parameters<typeof avanzar>[1]): EstadoSecuencia {
    maquina.current = avanzar(maquina.current, evento);
    setEstado(maquina.current);
    return maquina.current;
  }

  function cancelar() {
    cancelado.current = true;
    aplicar({ tipo: 'cancelar' });
  }

  function reiniciar() {
    cancelado.current = false;
    maquina.current = INICIAL;
    setEstado(INICIAL);
  }

  /**
   * Manda la secuencia entera, de a un mensaje, esperando entre uno y otro.
   * Devuelve el estado final para quien quiera encadenar algo.
   */
  async function mandar(plantillaId: number, pasos: PasoAEnviar[]): Promise<void> {
    const telefono = conversacion?.persona_id;
    const numeroPropio = conversacion?.numero_propio;
    if (!conversacion || !telefono || !numeroPropio || pasos.length === 0) return;

    cancelado.current = false;
    maquina.current = INICIAL;
    aplicar({ tipo: 'arrancar', total: pasos.length });

    for (let i = 0; i < pasos.length; i++) {
      const paso = pasos[i];
      try {
        await api(`/api/plantillas/${plantillaId}/enviar-paso`, {
          method: 'POST',
          body: JSON.stringify({
            clave: conversacion.clave,
            orden: paso.orden,
            telefono,
            numeroPropio,
            personaNombre: conversacion.persona_nombre,
            ultimo: i === pasos.length - 1,
          }),
        });
        aplicar({ tipo: 'paso-ok' });
      } catch (err) {
        const motivo = err instanceof ErrorApi ? err.message : 'no se pudo enviar';
        aplicar({ tipo: 'paso-fallo', motivo });
      }

      // El hilo se refresca a cada paso: la vendedora ve caer los mensajes en el
      // chat mientras salen, no cuatro de golpe al final.
      void qc.invalidateQueries({ queryKey: ['wa', 'conversacion', telefono] });

      // Terminó, falló, o el corte llegó con este en vuelo (y salió igual).
      if (maquina.current.fase !== 'enviando' && maquina.current.fase !== 'cancelando') break;

      await new Promise((r) => setTimeout(r, ESPERA_ENTRE_PASOS_MS));

      // El corte llegó en el hueco: el siguiente NO se manda. Esta es la
      // diferencia entre «salieron 2 de 4» y «salieron 3 de 4», y decir la de
      // más sería mentir sobre lo que la persona recibió.
      if (cancelado.current) {
        aplicar({ tipo: 'cortar-antes-de-enviar' });
        break;
      }
    }

    void qc.invalidateQueries({ queryKey: ['conversaciones'] });
    void qc.invalidateQueries({ queryKey: ['plantillas'] });
  }

  return { estado, mandar, cancelar, reiniciar };
}
