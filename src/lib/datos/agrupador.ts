/**
 * ══ JUNTAR INVALIDACIONES EN UNA VENTANA ═════════════════════════════════════
 *
 * 🔴 **EL SSE ES LA FUENTE, Y ESO LO VOLVIÓ EL PROBLEMA.** Cada mensaje de
 * WhatsApp que entra emite en el bus, y el front invalida `['conversaciones']`
 * al instante. Medido en producción el 19-ago-2026 leyendo el log del proceso:
 * **7 a 18 mensajes por minuto** entrando por whatsmeow. Con tres vendedoras
 * conectadas eso son ~36 invalidaciones por minuto de la consulta más cara del
 * sistema — y hasta ese día cada invalidación disparaba **cinco** (las columnas
 * del Pipeline). El resultado fue `hermes_db` al 747 % de ocho núcleos y la API
 * devolviendo 504 en el 100 % de los pedidos durante minutos enteros.
 *
 * ⚠️ **El jitter que ya había NO reduce nada: reparte.** Existe para que ocho
 * pestañas no invaliden en el mismo segundo (y para eso sirve, hay que
 * conservarlo), pero doce mensajes seguían siendo doce refetches, sólo que
 * desparramados. Lo que falta es juntarlos.
 *
 * ══ VENTANA FIJA, NO `debounce` ══════════════════════════════════════════════
 *
 * 🔴 **UN `debounce` CLÁSICO SE MUERE DE HAMBRE JUSTO ACÁ, y por eso no se usa.**
 * Un debounce reinicia su reloj con cada evento: con un mensaje cada 5 s y una
 * ventana de 15 s, el reloj **nunca vence** y la cola no se refresca *nunca* —
 * exactamente en el momento de más actividad, que es cuando más importa.
 *
 * Acá el PRIMER evento abre una ventana de duración fija y todo lo que caiga
 * adentro viaja en ella. La demora máxima es la ventana, pase lo que pase, y el
 * ritmo queda acotado a una invalidación por ventana por más tráfico que entre.
 */

/** Lo que hace falta para programar; inyectable para poder testear sin relojes reales. */
export interface RelojDelAgrupador {
  programar: (fn: () => void, ms: number) => number;
  cancelar: (id: number) => void;
}

const RELOJ_REAL: RelojDelAgrupador = {
  programar: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  cancelar: (id) => clearTimeout(id),
};

export interface Agrupador {
  /**
   * Pide que `hacer` corra al final de la ventana. Si ya hay una abierta, este
   * pedido viaja en ella y **no** programa nada nuevo.
   */
  pedir: (hacer: () => void) => void;
  /** Cancela lo pendiente (desmontaje). Lo que no llegó a correr, no corre. */
  cancelar: () => void;
}

/**
 * `demoraMs` se llama UNA vez por ventana, al abrirla. Es una función y no un
 * número para que el jitter siga siendo del llamador: la ventana acota el
 * RITMO, el jitter desincroniza las PESTAÑAS, y son dos propiedades distintas
 * que se necesitan las dos.
 */
export function crearAgrupador(
  demoraMs: () => number,
  reloj: RelojDelAgrupador = RELOJ_REAL,
): Agrupador {
  let pendiente: number | null = null;

  return {
    pedir(hacer) {
      // 🔴 La guarda ES el frente. Sin ella esto es el código de antes.
      if (pendiente !== null) return;
      pendiente = reloj.programar(() => {
        // Se suelta ANTES de correr: si `hacer` tirara, la ventana quedaría
        // cerrada para siempre y la cola no se volvería a refrescar nunca.
        pendiente = null;
        hacer();
      }, demoraMs());
    },
    cancelar() {
      if (pendiente === null) return;
      reloj.cancelar(pendiente);
      pendiente = null;
    },
  };
}
