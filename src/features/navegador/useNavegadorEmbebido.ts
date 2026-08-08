import { useCallback, useEffect, useRef, useState } from 'react';
import { puenteTauri } from '../../lib/tauri';
import { esCascaraSinElComando } from './cascara';

/**
 * EL NAVEGADOR EMBEBIDO, DEL LADO DEL FRONT (ADR 0043).
 *
 * ══ LA COSTURA, Y POR QUÉ ES UN HOOK Y NO JSX ═══════════════════════════════
 *
 * El navegador NO se dibuja: se RESERVA. El webview hijo es una capa del
 * sistema operativo puesta ENCIMA del DOM, así que en React lo único que existe
 * es un hueco vacío (`hueco`), y este hook se ocupa de que el rectángulo de
 * verdad lo siga: lo mide, lo manda a Rust y lo vuelve a mandar cada vez que
 * cambia de tamaño.
 *
 * ══ 🔴 LO QUE HACE VIVIBLE A UNA CAPA DEL SO ════════════════════════════════
 *
 * Estar encima del DOM significa **tapar lo que caiga debajo**: Ivi, la cabina,
 * cualquier hoja. Ese era el motivo por el que ADR 0040 lo descartó, y sigue
 * siendo cierto — lo que cambió es que ahora se paga con código en vez de con
 * una ventana aparte. La regla vive acá y en un solo lugar:
 *
 *   · `tapado` → se ESCONDE (no se cierra: la página y la sesión quedan).
 *   · la vista se desmonta → se esconde igual.
 *
 * Quien monte una capa nueva encima de la mesa tiene que sumarla a `tapado` en
 * `App.tsx`. Si no lo hace, el síntoma es inconfundible —la capa nueva aparece
 * detrás del navegador— y por eso no hace falta un mecanismo más listo: un
 * registro global de capas se desincroniza en silencio, esto se ve en la
 * primera prueba.
 *
 * ══ LA ESCALERA DE RESPALDO ═════════════════════════════════════════════════
 *
 * Tres peldaños, y los tres existen por la misma cicatriz del 7-ago-2026: la
 * UI viaja por OTA y llega en el acto, la CÁSCARA es un `.dmg`/`.exe` que se
 * reinstala a mano.
 *
 *   1. cáscara con el embebido → el viewport de adentro (esto);
 *   2. cáscara vieja, con `abrir_navegador` → la ventana aparte de ADR 0040;
 *   3. fuera de Tauri, o cáscara más vieja → el navegador del sistema.
 *
 * `soportado` arranca en `null` —«todavía no se sabe»— y **no se adivina
 * mirando si estamos en Tauri**: esa fue exactamente la trampa que se comió el
 * frente anterior (`cascara.ts`). La pregunta correcta no es dónde corre, es si
 * el comando respondió, así que se resuelve con el PRIMER intento real.
 */

/** Lo que se le manda a Rust. Píxeles de CSS: el factor de escala lo aplica él. */
type Recuadro = { x: number; y: number; ancho: number; alto: number };

/**
 * Qué pasó al intentar abrir.
 *
 * `sin_embebido` es el peldaño, no un error: la cáscara instalada no tiene los
 * comandos y hay que seguir por la ventana aparte. `sin_recuadro` es el caso
 * mudo de siempre (la vista todavía no midió), y no merece cartel.
 */
export type ResultadoIr = 'ok' | 'sin_embebido' | 'error' | 'sin_recuadro';

export type Navegador = {
  /** `null` mientras no se probó. `false` = esta cáscara no sabe (peldaño 2 o 3). */
  soportado: boolean | null;
  /** Dónde está parado de verdad — incluidas las navegaciones que hizo el sitio solo. */
  donde: string | null;
  /** Hay una página montada (aunque esté escondida por `tapado`). */
  montado: boolean;
  error: string | null;
  /** El hueco que el webview va a ocupar. Va en un `div` sin contenido. */
  hueco: React.RefObject<HTMLDivElement | null>;
  /**
   * Abre `url` en el viewport embebido. **Devuelve qué pasó**, y eso no es
   * decoración: `sin_embebido` es la señal de que hay que seguir por el peldaño
   * de abajo, EN EL MISMO CLIC. Ver el comentario de la implementación.
   */
  ir: (url: string) => Promise<ResultadoIr>;
  atras: () => void;
  adelante: () => void;
  recargar: () => void;
  cerrar: () => void;
};

/** Cada cuánto se pregunta dónde está parado. Ver `navegador_donde` en Rust. */
const CADA_CUANTO_MS = 1000;

export function useNavegadorEmbebido({ tapado }: { tapado: boolean }): Navegador {
  const hueco = useRef<HTMLDivElement | null>(null);
  /**
   * 🔴 `null` es «todavía no se sabe», y solo vale ADENTRO de la cáscara.
   *
   * Sin puente no hay nada que averiguar: se sabe desde el primer render que el
   * embebido no existe. Arrancar en `null` también acá dejaba la pantalla
   * prometiendo «se abre acá adentro, con la sesión de trabajo» a alguien que
   * corre `npm run dev` en Chrome — y esa promesa se desmiente recién al primer
   * clic. Es la diferencia entre no saber y saber que no.
   *
   * Lo que NO se puede saber de entrada es la cáscara VIEJA: ahí el puente
   * existe y el comando no. Eso se resuelve con el primer intento real, que es
   * la lección de `cascara.ts` — la pregunta no es dónde corre, es si el
   * comando respondió.
   */
  const [soportado, setSoportado] = useState<boolean | null>(() => (puenteTauri() ? null : false));
  const [montado, setMontado] = useState(false);
  const [donde, setDonde] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `tapado` en una ref además de en el estado: el `ResizeObserver` y el
  // intervalo se arman una vez y necesitan leer el valor de AHORA sin volver a
  // armarse en cada cambio.
  const tapadoAhora = useRef(tapado);
  tapadoAhora.current = tapado;

  const invocar = useCallback(async (cmd: string, args: Record<string, unknown> = {}) => {
    const puente = puenteTauri();
    if (!puente) throw new Error('sin cáscara');
    return puente.invoke(cmd, args);
  }, []);

  const medir = useCallback((): Recuadro | null => {
    const el = hueco.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // Un hueco de 0 pasa cuando la vista todavía no hizo layout. Mandarlo sería
    // pedirle a Rust un webview degenerado — que es justo lo que `medir()`
    // rechaza del otro lado, así que acá se calla en vez de dar un error falso.
    if (r.width < 1 || r.height < 1) return null;
    return { x: r.left, y: r.top, ancho: r.width, alto: r.height };
  }, []);

  /**
   * 🔴 ACÁ SE DECIDE EL PELDAÑO, Y SOLO ACÁ.
   *
   * Un rechazo de «esta cáscara no tiene el comando» apaga el embebido para
   * toda la sesión (`soportado = false`) y deja que la vista caiga al camino
   * viejo. Un rechazo de `validar()` —Rust dijo que no— es OTRA cosa: se
   * muestra su mensaje y NO se apaga nada, porque la cáscara está perfecta y
   * lo que estaba mal era la dirección. Colapsar los dos casos degradaría la
   * app entera por una URL mal tecleada.
   *
   * 🔴 **Y DEVUELVE `sin_embebido` EN VEZ DE TRAGARSE EL CLIC.** Acá esto se
   * limitaba a apagar el embebido y volver, así que el primer clic no abría
   * NADA: cambiaba el cartel y listo, y había que tocar Cerberus dos veces. El
   * detalle es que ese es el estado de TODAS las máquinas el día del deploy —la
   * UI viaja por OTA y la cáscara se reinstala a mano—, o sea que el defecto no
   * era un caso raro: era el estreno. Quien llama sigue por el peldaño de abajo
   * con el mismo clic.
   */
  const ir = useCallback(
    async (url: string): Promise<ResultadoIr> => {
      const recuadro = medir();
      if (!recuadro) return 'sin_recuadro';
      setError(null);
      try {
        await invocar('navegador_montar', { url, recuadro });
        setSoportado(true);
        setMontado(true);
        setDonde(url);
        return 'ok';
      } catch (e) {
        const motivo = typeof e === 'string' ? e : (e as Error)?.message ?? 'no se pudo abrir';
        if (esCascaraSinElComando(motivo) || motivo === 'sin cáscara') {
          setSoportado(false);
          return 'sin_embebido';
        }
        setError(motivo);
        return 'error';
      }
    },
    [invocar, medir],
  );

  const cerrar = useCallback(() => {
    setMontado(false);
    setDonde(null);
    void invocar('navegador_cerrar').catch(() => {});
  }, [invocar]);

  const atras = useCallback(() => void invocar('navegador_atras').catch(() => {}), [invocar]);
  const adelante = useCallback(() => void invocar('navegador_adelante').catch(() => {}), [invocar]);
  const recargar = useCallback(() => void invocar('navegador_recargar').catch(() => {}), [invocar]);

  /**
   * QUE EL RECTÁNGULO SIGA AL HUECO.
   *
   * ⚠️ Con `requestAnimationFrame` y no a cada evento: durante un arrastre de
   * la ventana el `ResizeObserver` dispara decenas de veces por segundo, y cada
   * disparo es un `invoke` que cruza a Rust. Sin el freno, redimensionar la
   * mesa inunda el IPC.
   */
  useEffect(() => {
    if (!montado) return;
    let pedido = 0;

    const acomodar = () => {
      cancelAnimationFrame(pedido);
      pedido = requestAnimationFrame(() => {
        if (tapadoAhora.current) return;
        const recuadro = medir();
        if (recuadro) void invocar('navegador_recuadro', { recuadro }).catch(() => {});
      });
    };

    const observador = new ResizeObserver(acomodar);
    if (hueco.current) observador.observe(hueco.current);
    window.addEventListener('resize', acomodar);

    return () => {
      cancelAnimationFrame(pedido);
      observador.disconnect();
      window.removeEventListener('resize', acomodar);
    };
  }, [montado, invocar, medir]);

  /**
   * ESCONDER Y VOLVER A MOSTRAR — la mitad que hace vivible a la capa del SO.
   *
   * Al volver se re-MONTA (sin URL) en vez de solo mostrarse: mientras estuvo
   * escondido la ventana pudo cambiar de tamaño, y el `ResizeObserver` no
   * dispara sobre un rectángulo que nadie movió. Sin esto, volver de Ivi
   * después de agrandar la ventana deja el navegador con el tamaño viejo.
   */
  useEffect(() => {
    if (!montado) return;
    if (tapado) {
      void invocar('navegador_ocultar').catch(() => {});
      return;
    }
    const recuadro = medir();
    if (recuadro) void invocar('navegador_montar', { recuadro }).catch(() => {});
  }, [tapado, montado, invocar, medir]);

  /** Al salir de la vista se esconde. NO se cierra: volver tiene que ser instantáneo. */
  useEffect(() => {
    return () => {
      void puenteTauri()?.invoke('navegador_ocultar', {})?.catch?.(() => {});
    };
  }, []);

  /** Dónde está parado. Ver el porqué del sondeo en `navegador_donde` (Rust). */
  useEffect(() => {
    if (!montado || tapado) return;
    const t = setInterval(() => {
      void invocar('navegador_donde')
        .then((u) => {
          if (typeof u === 'string' && u) setDonde(u);
        })
        .catch(() => {});
    }, CADA_CUANTO_MS);
    return () => clearInterval(t);
  }, [montado, tapado, invocar]);

  return { soportado, donde, montado, error, hueco, ir, atras, adelante, recargar, cerrar };
}
