/**
 * EL DESGLOSE QUE SIRVE EL SERVER: etapa × ya-le-hablamos × precio × viva, con su
 * conteo. Es la MISMA foto que las tarjetas, contada de una pasada
 * (`server/src/cola/consultarCola.ts`).
 *
 * **Vive en `dominio/` y no en `vistas/tablero.ts`, que es de donde salió.** Lo
 * necesitan las dos puntas: el Pipeline para repartir columnas y `conversaciones.ts`
 * para tipar lo que devuelve la cola. Mientras estaba adentro de la vista, el modelo
 * del front tenía que importar una PANTALLA para tipar su propia respuesta — que es
 * exactamente la inversión de capas que `arquitectura.json` › `capas` prohíbe.
 */
export interface FilaDesglose {
  etapa: string;
  yaLeHablamos: boolean;
  precio: boolean;
  viva: boolean;
  /**
   * La ventana de conversación sigue abierta (server: `cola/ventana.ts`): se le
   * puede escribir texto libre AHORA, sin pagar una plantilla. Opcional porque
   * un server viejo no manda el campo — y ahí el chip no se dibuja, que es como
   * se comportaba antes.
   */
  ventana?: boolean;
  /**
   * «Para seguir» (server: `cola/tiempoEnEtapa.ts`): silencio nuestro + entre 3 y
   * 14 días en la etapa. Opcional por lo mismo que `ventana` — un server viejo no
   * manda el campo, y ahí el chip no se dibuja en vez de prometer un recorte que
   * el server no sabe aplicar.
   */
  paraSeguir?: boolean;
  /**
   * «Se calló con el precio» (server: `cola/tiempoEnEtapa.ts`): había hablado y no
   * volvió a escribir después de recibirlo. Opcional, como los otros dos: sin el
   * campo el chip no se dibuja.
   */
  seCallo?: boolean;
  n: number;
}
