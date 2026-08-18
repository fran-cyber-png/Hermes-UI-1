import { useCallback, useMemo, useRef, useState } from 'react';
import {
  LIMITE_FIGURAS_BYTES,
  type Figura,
  type Reordenamiento,
  conColor,
  conOpacidad,
  duplicar,
  moverFigura,
  parsear,
  pesoDeFiguras,
  reordenar,
} from './figuras';

/**
 * EL ESTADO DE LA CAPA DE ANOTACIONES — separado del canvas a propósito.
 *
 * ══ POR QUÉ ES UN HOOK Y NO VIVE ADENTRO DEL CANVAS ═════════════════════════
 *
 * Porque tiene **dos consumidores en lugares distintos del árbol**: la barra de
 * la derecha (que prende «Deshacer» cuando hay algo que deshacer, y aplica un
 * color a lo que esté elegido) y la capa transparente (que dibuja). Con el
 * estado adentro del canvas, la barra tendría que recibir el editor por props o
 * el canvas tendría que renderizar la barra — y la barra dejaría de poder estar
 * donde tiene que estar, que es pegada al borde de la Libreta y no al del
 * dibujo.
 *
 * ══ CUÁNDO SE GUARDA, Y POR QUÉ IMPORTA TANTO ═══════════════════════════════
 *
 * `vistaPrevia` cambia lo que se ve y **no guarda**; `confirmar` cierra el gesto
 * y baja el resultado. Un `pointermove` dispara ~120 veces por segundo: guardar
 * en cada uno sería, por cada trazo de dos segundos, 240 pasos en la pila de
 * deshacer (un ⌘Z borraría **un punto**, no el trazo) y 240 disparos del
 * autoguardado. Con el gesto como unidad, un trazo es un cambio y ⌘Z deshace
 * exactamente lo que la vendedora entiende por «lo que acabo de hacer».
 *
 * ══ LA SELECCIÓN ES UN CONJUNTO DE IDS, NO DE POSICIONES ════════════════════
 *
 * 🔴 Y no es un detalle de estilo. Mandar una figura al frente reordena el
 * array; con la selección guardada como índices, el recuadro pasaría a marcar
 * otra figura **sin que nada falle** — y el siguiente ⌘C copiaría lo que no era.
 * Con ids, reordenar no toca la selección.
 */

export interface Anotaciones {
  figuras: Figura[];
  /** Los ids elegidos, en el orden en que se agregaron. Vacío = nada. */
  seleccionadas: string[];
  /** Las figuras elegidas, ya resueltas. Comodidad para los consumidores. */
  elegidas: Figura[];
  elegir(ids: string[]): void;
  /** Agrega o saca de la selección — el ⇧clic de siempre. */
  alternar(id: string): void;
  /** Cambia lo que se VE, sin tocar la pila ni guardar. Para el arrastre. */
  vistaPrevia(figuras: Figura[]): void;
  /** Cierra un gesto: apila lo anterior, fija lo nuevo y lo baja a guardar. */
  confirmar(nuevas: Figura[], previas: Figura[]): void;
  /** Suma figuras nuevas y las deja elegidas. Para pegar y duplicar. */
  agregar(nuevas: Figura[]): void;
  borrarSeleccion(): void;
  duplicarSeleccion(): void;
  /** Corre lo elegido. Lo usan las flechas del teclado. */
  correrSeleccion(dx: number, dy: number): void;
  /** Aplica un color a lo elegido. Devuelve `true` si tocó algo. */
  pintarSeleccion(color: string): boolean;
  /**
   * Aplica una opacidad a lo elegido. Devuelve `true` si tocó algo.
   *
   * 🔴 Esto es lo que faltaba y hacía que la opacidad «no funcionara»: el
   * deslizador guardaba el valor para las figuras FUTURAS y nunca tocaba la
   * selección, al revés del color. Se veía como un control muerto.
   */
  opacarSeleccion(opacidad: number): boolean;
  /** Reemplaza la lista entera en un solo paso. Lo usan las operaciones de capa. */
  reemplazar(figuras: Figura[], seleccion?: string[]): void;
  ordenarSeleccion(a: Reordenamiento): void;
  /** Muda de capa todo lo que estaba en una. Lo usa borrar una capa. */
  mudarDeCapa(desde: string, hacia: string): void;
  deshacer(): void;
  rehacer(): void;
  limpiar(): void;
  puedeDeshacer: boolean;
  puedeRehacer: boolean;
  hayAlgo: boolean;
  /** Lo que hay que decirle a la vendedora, o `null`. */
  aviso: string | null;
  avisar(mensaje: string | null): void;
}

export function useAnotaciones({
  iniciales,
  onGuardar,
}: {
  /** Lo que trajo la página. Se lee UNA vez: después manda este hook. */
  iniciales: unknown;
  onGuardar(figuras: Figura[]): void;
}): Anotaciones {
  /**
   * Se siembra con el inicializador de `useState` y no se vuelve a mirar
   * `iniciales`: releerlo en cada render armaría el ciclo «guardo → cambia la
   * prop → releo → guardo». Cambiar de página remonta todo (la `key` de la zona
   * de trabajo en `Libreta`), así que abrir otra nota siembra de nuevo.
   */
  const [figuras, setFiguras] = useState<Figura[]>(() => parsear(iniciales));
  const [historial, setHistorial] = useState<Figura[][]>([]);
  const [futuro, setFuturo] = useState<Figura[][]>([]);
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);

  const onGuardarRef = useRef(onGuardar);
  onGuardarRef.current = onGuardar;

  const vistaPrevia = useCallback((f: Figura[]) => setFiguras(f), []);

  /**
   * El tope se controla al CERRAR el gesto y no al empezarlo: recién al soltar
   * se sabe cuánto pesa el trazo. Si no entra, **se vuelve a lo anterior** en
   * vez de guardar a medias — y se dice en pantalla, que es lo que el 413 mudo
   * del server no haría.
   */
  const confirmar = useCallback((nuevas: Figura[], previas: Figura[]) => {
    if (pesoDeFiguras(nuevas) > LIMITE_FIGURAS_BYTES) {
      setFiguras(previas);
      setAviso(`Las anotaciones llegaron al tope de ${LIMITE_FIGURAS_BYTES / 1024} KB. Borrá algo para seguir.`);
      return;
    }
    setHistorial((h) => [...h, previas]);
    setFuturo([]);
    setFiguras(nuevas);
    setAviso(null);
    onGuardarRef.current(nuevas);
  }, []);

  /**
   * UNA OPERACIÓN SOBRE LO QUE HAY AHORA, en un solo paso de deshacer.
   *
   * Todas las acciones de abajo tienen la misma forma —leer lo actual, calcular
   * lo nuevo, apilar y guardar— y escribirla cinco veces es cinco lugares donde
   * olvidarse el `setFuturo([])` y dejar un «rehacer» que reviva un estado que
   * ya no existe.
   */
  const operar = useCallback(
    (calcular: (actuales: Figura[]) => { figuras: Figura[]; seleccion?: string[] } | null) => {
      setFiguras((actuales) => {
        const r = calcular(actuales);
        if (!r) return actuales;
        setHistorial((h) => [...h, actuales]);
        setFuturo([]);
        setAviso(null);
        if (r.seleccion !== undefined) setSeleccionadas(r.seleccion);
        onGuardarRef.current(r.figuras);
        return r.figuras;
      });
    },
    [],
  );

  const alternar = useCallback((id: string) => {
    setSeleccionadas((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }, []);

  const agregar = useCallback(
    (nuevas: Figura[]) => {
      if (nuevas.length === 0) return;
      // Lo recién pegado queda elegido: es lo que deja moverlo o borrarlo sin
      // tener que ir a buscarlo con el puntero.
      operar((actuales) => ({ figuras: [...actuales, ...nuevas], seleccion: nuevas.map((f) => f.id) }));
    },
    [operar],
  );

  const borrarSeleccion = useCallback(() => {
    operar((actuales) => {
      const quedan = actuales.filter((f) => !seleccionadas.includes(f.id));
      return quedan.length === actuales.length ? null : { figuras: quedan, seleccion: [] };
    });
  }, [operar, seleccionadas]);

  const duplicarSeleccion = useCallback(() => {
    operar((actuales) => {
      const copias = duplicar(actuales.filter((f) => seleccionadas.includes(f.id)));
      return copias.length === 0 ? null : { figuras: [...actuales, ...copias], seleccion: copias.map((f) => f.id) };
    });
  }, [operar, seleccionadas]);

  const correrSeleccion = useCallback(
    (dx: number, dy: number) => {
      operar((actuales) => {
        if (seleccionadas.length === 0) return null;
        return {
          figuras: actuales.map((f) => (seleccionadas.includes(f.id) ? moverFigura(f, dx, dy) : f)),
        };
      });
    },
    [operar, seleccionadas],
  );

  /**
   * EL COLOR SOBRE LO ELEGIDO.
   *
   * Devuelve si hizo algo, y de eso depende lo que hace la barra: con figuras
   * elegidas, elegir un color las REPINTA; sin nada elegido, ese color queda
   * como el del próximo trazo. Las dos cosas son razonables y hay que poder
   * distinguirlas desde afuera sin volver a mirar la selección.
   */
  const pintarSeleccion = useCallback(
    (color: string) => {
      // Una imagen no tiene color: si lo único elegido son imágenes, esto no es
      // un cambio y no tiene que gastar un paso de deshacer.
      const pintables = figuras.filter((f) => seleccionadas.includes(f.id) && f.clase !== 'imagen');
      if (pintables.length === 0) return false;

      operar((actuales) => ({
        figuras: actuales.map((f) => (seleccionadas.includes(f.id) ? conColor(f, color) : f)),
      }));
      return true;
    },
    [figuras, operar, seleccionadas],
  );

  const mudarDeCapa = useCallback(
    (desde: string, hacia: string) => {
      operar((actuales) => {
        const tocadas = actuales.filter((f) => f.capaId === desde);
        if (tocadas.length === 0) return null;
        return { figuras: actuales.map((f) => (f.capaId === desde ? { ...f, capaId: hacia } : f)) };
      });
    },
    [operar],
  );

  const opacarSeleccion = useCallback(
    (opacidad: number) => {
      // A diferencia del color, la opacidad SÍ vale para una imagen: atenuar una
      // captura pegada sobre el texto es justo lo que se quiere hacer con ella.
      if (seleccionadas.length === 0) return false;
      operar((actuales) => ({
        figuras: actuales.map((f) => (seleccionadas.includes(f.id) ? conOpacidad(f, opacidad) : f)),
      }));
      return true;
    },
    [operar, seleccionadas],
  );

  const reemplazar = useCallback(
    (nuevas: Figura[], seleccion?: string[]) => {
      operar(() => ({ figuras: nuevas, ...(seleccion !== undefined ? { seleccion } : {}) }));
    },
    [operar],
  );

  const ordenarSeleccion = useCallback(
    (a: Reordenamiento) => {
      operar((actuales) => (seleccionadas.length === 0 ? null : { figuras: reordenar(actuales, seleccionadas, a) }));
    },
    [operar, seleccionadas],
  );

  /**
   * Deshacer y rehacer sueltan la selección: los ids pueden no existir en el
   * estado al que se vuelve —una figura que se había pegado, por ejemplo—, y el
   * recuadro quedaría marcando algo que ya no está.
   */
  const deshacer = useCallback(() => {
    setHistorial((h) => {
      if (h.length === 0) return h;
      const previas = h[h.length - 1];
      setFiguras((actuales) => {
        setFuturo((f) => [...f, actuales]);
        return previas;
      });
      setSeleccionadas([]);
      setAviso(null);
      onGuardarRef.current(previas);
      return h.slice(0, -1);
    });
  }, []);

  const rehacer = useCallback(() => {
    setFuturo((f) => {
      if (f.length === 0) return f;
      const siguientes = f[f.length - 1];
      setFiguras((actuales) => {
        setHistorial((h) => [...h, actuales]);
        return siguientes;
      });
      setSeleccionadas([]);
      onGuardarRef.current(siguientes);
      return f.slice(0, -1);
    });
  }, []);

  const limpiar = useCallback(() => {
    operar((actuales) => (actuales.length === 0 ? null : { figuras: [], seleccion: [] }));
  }, [operar]);

  const elegidas = useMemo(
    () => figuras.filter((f) => seleccionadas.includes(f.id)),
    [figuras, seleccionadas],
  );

  return {
    figuras,
    seleccionadas,
    elegidas,
    elegir: setSeleccionadas,
    alternar,
    vistaPrevia,
    confirmar,
    agregar,
    borrarSeleccion,
    duplicarSeleccion,
    correrSeleccion,
    pintarSeleccion,
    opacarSeleccion,
    reemplazar,
    ordenarSeleccion,
    mudarDeCapa,
    deshacer,
    rehacer,
    limpiar,
    puedeDeshacer: historial.length > 0,
    puedeRehacer: futuro.length > 0,
    hayAlgo: figuras.length > 0,
    aviso,
    avisar: setAviso,
  };
}
