import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { imagenDelPortapapeles, medidaAlPegar, subirImagen, traerBitmap } from './adjuntos';
import { dibujaAlgo, type Herramienta } from './BarraDeDibujo';
import {
  type Caja,
  type Esquina,
  type Figura,
  type Punto,
  CAJA_POR_DEFECTO,
  archivosDeFiguras,
  cajaDeFigura,
  duplicar,
  figuraTocada,
  figurasEnCaja,
  moverFigura,
  nuevaBase,
  redimensionarCaja,
  redimensionarImagen,
  tiradorTocado,
} from './figuras';
import { CajaFlotante } from './CajaFlotante';
import { type Capa, seleccionables, visibles } from './capas';
import { LADO_TIRADOR, pintar } from './pintar';
import type { Anotaciones } from './useAnotaciones';

/**
 * LA CAPA TRANSPARENTE — un canvas sin fondo, apoyado sobre el documento.
 *
 * ══ CÓMO SE PARA ENCIMA DEL TEXTO SIN TAPARLO ═══════════════════════════════
 *
 * Va `absolute inset-0` adentro del contenedor del documento, que es `relative`.
 * Eso le da **exactamente** el alto y el ancho del contenido —no de la ventana—,
 * y es lo que hace que todo lo demás funcione solo:
 *
 *  · **El scroll no necesita una línea de código.** El canvas es parte del
 *    contenido que scrollea, así que un círculo alrededor de una palabra se va
 *    con esa palabra. Si en cambio la capa estuviera fija al viewport, habría
 *    que restarle el `scrollTop` a cada figura en cada rueda del mouse, y
 *    cualquier desincronización se vería como el dibujo despegándose del texto.
 *
 *  · **Las coordenadas del puntero son las del documento.** `getBoundingClientRect`
 *    ya descuenta el scroll, así que `clientX - caja.left` cae directo en el
 *    sistema de coordenadas en el que se guardan las figuras. No hay conversión.
 *
 *  · **El canvas crece con la página.** Un `ResizeObserver` sobre el contenedor
 *    reajusta el buffer cuando el texto se hace más largo.
 *
 * ══ LO QUE DECIDE SI ESTO ES USABLE: `pointer-events` ═══════════════════════
 *
 * 🔴 Con el modo texto activo la capa lleva `pointer-events: none`, y sin eso
 * NADA de la Libreta funciona: el canvas cubre el documento entero, así que se
 * comería cada clic, cada selección de texto y cada tecla. La página se vería
 * perfecta y sería de solo lectura, sin un solo error en la consola.
 *
 * Al elegir una herramienta pasa a `auto` y la capa captura el puntero. Volver
 * al puntero la vuelve a apagar.
 */

/** El radio del borrador y del agarre, en píxeles del documento. */
const RADIO_TOQUE = 8;

/** Cuánto corren las flechas del teclado, sueltas y con Shift. */
const PASO_FLECHA = 1;
const PASO_FLECHA_LARGO = 10;

/** El tamaño del rótulo sale del grosor elegido: una perilla menos en la barra. */
function tamanoDeRotulo(grosor: number): number {
  return 12 + grosor * 4;
}

/**
 * Tope de píxeles del buffer antes de bajar a densidad 1.
 *
 * Una página larga puede medir varios miles de píxeles de alto. A densidad 2 eso
 * son cuatro bytes por cada píxel de un buffer que crece con el cuadrado: una
 * hoja de 700 × 8.000 pasaría de los 200 MB de textura. Preferimos un trazo un
 * poco menos nítido en una página larguísima antes que quedarnos sin memoria.
 */
const TOPE_PIXELES = 4_000_000;

/** Lo que se llevó el último ⌘C. De módulo: se pega entre páginas distintas. */
let portapapelesInterno: Figura[] = [];

export function CapaDeAnotaciones({
  anotaciones,
  herramienta,
  color,
  grosor,
  opacidad,
  capaId,
  capas,
  pedirImagen,
  onSubiendo,
  onSalirDelDibujo,
}: {
  anotaciones: Anotaciones;
  herramienta: Herramienta;
  color: string;
  grosor: number;
  /** 0–1, la que llevarán las figuras nuevas. */
  opacidad: number;
  /** En qué capa caen las figuras nuevas. */
  capaId: string;
  /** Las capas de la página: deciden qué se ve y qué se puede agarrar. */
  capas: Capa[];
  /**
   * Registra el abridor del buscador de archivos, para que el botón «Imagen» de
   * la barra —que vive en otro componente— pueda dispararlo. Se pasa hacia
   * arriba una función en vez de bajar el `<input>`: el input tiene que estar
   * ACÁ, donde se sabe dónde soltar la imagen.
   */
  pedirImagen?: (abrir: (() => void) | null) => void;
  /** Le avisa a la barra que hay una subida en curso, para apagar el botón. */
  onSubiendo?: (subiendo: boolean) => void;
  /** Para que Escape devuelva la página al modo texto sin ir hasta la barra. */
  onSalirDelDibujo(): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const [medida, setMedida] = useState({ ancho: 0, alto: 0 });
  const [enCurso, setEnCurso] = useState<Figura | null>(null);
  const [lazo, setLazo] = useState<Caja | null>(null);
  const [escribiendo, setEscribiendo] = useState<{ en: Punto; valor: string } | null>(null);
  /**
   * QUÉ CAJA SE ESTÁ EDITANDO, o `null`.
   *
   * 🔴 Es el interruptor entre «modo edición de texto» y «modo selección de
   * objetos». Con una caja abierta, su `contenteditable` se queda el teclado
   * entero: ⌘A selecciona SU texto y Suprimir borra caracteres. Sin ninguna, el
   * teclado es de la capa. Ver `CajaFlotante`.
   */
  const [editandoCaja, setEditandoCaja] = useState<string | null>(null);
  const [subiendo, setSubiendoLocal] = useState(false);
  const onSubiendoRef = useRef(onSubiendo);
  onSubiendoRef.current = onSubiendo;
  // Un solo lugar cambia la bandera y avisa hacia arriba: con dos `setState`
  // sueltos en cada rama del `try/finally`, el botón se queda apagado el día que
  // alguien agregue un `return` temprano.
  const setSubiendo = useCallback((v: boolean) => {
    setSubiendoLocal(v);
    onSubiendoRef.current?.(v);
  }, []);
  /** Sube cuando termina de bajar un bitmap, para forzar el repintado. */
  const [imagenesListas, setImagenesListas] = useState(0);

  /** Lo que había al empezar el gesto, para poder apilarlo al cerrarlo. */
  const previas = useRef<Figura[] | null>(null);
  /** El arrastre de figuras elegidas: desde dónde y cómo estaban. */
  const arrastre = useRef<{ desde: Punto; originales: Figura[] } | null>(null);
  /** El arrastre de un tirador: qué esquina y cuál era la imagen. */
  const escalado = useRef<{ esquina: Esquina; original: Figura } | null>(null);

  const activa = dibujaAlgo(herramienta);
  const { figuras, seleccionadas, elegidas } = anotaciones;

  /**
   * 🔴 LAS DOS LISTAS DERIVADAS, y no da igual cuál se use.
   *
   * `paraVer` es lo que se pinta (capa visible). `paraTocar` es lo que el clic,
   * el borrador y el lazo pueden agarrar (visible Y no bloqueada). Toda búsqueda
   * de figuras pasa por `paraTocar` — es lo que hace que «bloqueada» sea una
   * regla y no un estilo. Ver `capas.ts`.
   */
  const paraVer = visibles(figuras, capas);
  const paraTocar = seleccionables(figuras, capas);

  /* ── Medir ─────────────────────────────────────────────────────────────── */

  useLayoutEffect(() => {
    const caja = canvasRef.current?.parentElement;
    if (!caja) return;

    const medir = () => setMedida({ ancho: caja.clientWidth, alto: caja.clientHeight });
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    // Observa al PADRE y no al canvas: el canvas está `absolute`, así que su
    // tamaño lo dicta el contenedor — observarse a sí mismo sería un lazo.
    const observador = new ResizeObserver(medir);
    observador.observe(caja);
    return () => observador.disconnect();
  }, []);

  /* ── Traer las imágenes ────────────────────────────────────────────────── */

  /**
   * Las imágenes se bajan cuando aparecen en la capa, y el contador fuerza un
   * repintado al llegar cada una. Sin esto, una página con imágenes se abre
   * mostrando los huecos punteados y no se rellenan hasta que algo más provoque
   * un render.
   */
  useEffect(() => {
    let vivo = true;
    for (const archivo of archivosDeFiguras(figuras)) {
      void traerBitmap(archivo).then((b) => {
        if (b && vivo) setImagenesListas((n) => n + 1);
      });
    }
    return () => {
      vivo = false;
    };
  }, [figuras]);

  /* ── Pintar ────────────────────────────────────────────────────────────── */

  const dpr = medida.ancho * medida.alto > TOPE_PIXELES ? 1 : Math.min(window.devicePixelRatio || 1, 2);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || medida.ancho === 0) return;
    pintar(ctx, enCurso ? [...paraVer, enCurso] : paraVer, {
      ancho: medida.ancho,
      alto: medida.alto,
      dpr,
      seleccionadas,
      lazo,
      // Los recuadros y tiradores solo con la herramienta de selección: con el
      // lápiz en la mano serían cajas azules que no hacen nada.
      conAdornos: herramienta === 'seleccion',
    });
  }, [paraVer, enCurso, medida, dpr, seleccionadas, lazo, herramienta, imagenesListas]);

  /* ── Puntero ───────────────────────────────────────────────────────────── */

  const puntoDe = useCallback((e: { clientX: number; clientY: number }): Punto => {
    const caja = canvasRef.current?.getBoundingClientRect();
    if (!caja) return [0, 0];
    // `getBoundingClientRect` ya descuenta el scroll: esto cae directo en
    // coordenadas del documento, que es donde viven las figuras.
    return [e.clientX - caja.left, e.clientY - caja.top];
  }, []);

  function cerrarRotulo(confirmando: boolean) {
    if (!escribiendo) return;
    const texto = escribiendo.valor.trim();
    const base = previas.current ?? figuras;
    setEscribiendo(null);
    previas.current = null;
    if (!confirmando || texto === '') return;
    anotaciones.confirmar(
      [
        ...base,
        { ...nuevaBase({ opacidad, capaId }), clase: 'rotulo', color, tamano: tamanoDeRotulo(grosor), en: escribiendo.en, texto },
      ],
      base,
    );
  }

  const alBajar = (e: React.PointerEvent) => {
    if (!activa) return;
    // Tocar el lienzo cierra la caja que se estaba escribiendo: es «hacer clic
    // afuera», y devuelve el teclado a la capa.
    if (editandoCaja) setEditandoCaja(null);
    // Un rótulo a medio escribir se cierra al tocar otra parte: es lo que hace
    // cualquier editor, y evita dejarlo colgado sin saber cómo salir.
    if (escribiendo) {
      cerrarRotulo(true);
      return;
    }

    const p = puntoDe(e);
    previas.current = figuras;
    e.currentTarget.setPointerCapture(e.pointerId);

    /**
     * LA HERRAMIENTA TEXTO CREA UNA CAJA Y LA ABRE PARA ESCRIBIR.
     *
     * Nace con texto de arranque en vez de vacía, y no es un capricho: `parsear`
     * descarta las cajas sin texto (un objeto invisible que ocupa lugar es peor
     * que ninguno), así que una caja vacía guardada desaparecería al recargar.
     * Con el texto puesto y seleccionado, la primera tecla lo reemplaza.
     */
    if (herramienta === 'caja') {
      const nueva: Figura = {
        ...nuevaBase({ opacidad, capaId }),
        clase: 'caja',
        x: p[0],
        y: p[1],
        ancho: CAJA_POR_DEFECTO.ancho,
        alto: CAJA_POR_DEFECTO.alto,
        texto: 'Anotación',
        fuente: CAJA_POR_DEFECTO.fuente,
        tamano: CAJA_POR_DEFECTO.tamano,
        negrita: CAJA_POR_DEFECTO.negrita,
        cursiva: CAJA_POR_DEFECTO.cursiva,
        subrayado: CAJA_POR_DEFECTO.subrayado,
        alineacion: CAJA_POR_DEFECTO.alineacion,
        color,
      };
      anotaciones.agregar([nueva]);
      setEditandoCaja(nueva.id);
      previas.current = null;
      return;
    }

    if (herramienta === 'rotulo') {
      setEscribiendo({ en: p, valor: '' });
      return;
    }

    if (herramienta === 'borrador') {
      const victima = paraTocar[figuraTocada(paraTocar, p, RADIO_TOQUE)];
      if (victima) anotaciones.vistaPrevia(figuras.filter((f) => f.id !== victima.id));
      return;
    }

    if (herramienta === 'seleccion') {
      // 1) ¿Un tirador? Va PRIMERO: los tiradores caen sobre el borde de la
      //    imagen, así que preguntar por la figura antes se llevaría el gesto.
      if (elegidas.length === 1 && (elegidas[0].clase === 'imagen' || elegidas[0].clase === 'caja')) {
        const c = cajaDeFigura(elegidas[0]);
        const esquina = tiradorTocado(
          { x1: c.x1 - 6, y1: c.y1 - 6, x2: c.x2 + 6, y2: c.y2 + 6 },
          p,
          LADO_TIRADOR,
        );
        if (esquina) {
          escalado.current = { esquina, original: elegidas[0] };
          return;
        }
      }

      // 2) ¿Una figura? Con ⇧ se suma o se saca de la selección.
      const tocada = paraTocar[figuraTocada(paraTocar, p, RADIO_TOQUE)];
      if (tocada) {
        const id = tocada.id;
        let ids = seleccionadas;
        // `Ctrl`/`⌘` suma o saca de la selección — lo pedido. `Shift` hace lo
        // mismo porque es lo que la mano espera en cualquier lista.
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          ids = seleccionadas.includes(id) ? seleccionadas.filter((x) => x !== id) : [...seleccionadas, id];
          anotaciones.elegir(ids);
        } else if (!seleccionadas.includes(id)) {
          // Tocar algo que NO estaba elegido reemplaza la selección; tocar algo
          // que sí estaba la conserva, para poder arrastrar el grupo entero.
          ids = [id];
          anotaciones.elegir(ids);
        }
        arrastre.current = { desde: p, originales: figuras.filter((f) => ids.includes(f.id)) };
        return;
      }

      // 3) Nada debajo: empieza el lazo. Sin sumar, se limpia lo que había.
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) anotaciones.elegir([]);
      setLazo({ x1: p[0], y1: p[1], x2: p[0], y2: p[1] });
      return;
    }

    // ⚠️ La herramienta NO es la clase de la figura: el `lapiz` produce un
    // `trazo`. Escribir `clase: herramienta` guardaba figuras con una clase que
    // `parsear` no conoce — se dibujaban en la sesión y desaparecían al recargar.
    if (herramienta === 'lapiz' || herramienta === 'resaltador') {
      setEnCurso({
        ...nuevaBase({ opacidad, capaId }),
        clase: herramienta === 'lapiz' ? 'trazo' : 'resaltador',
        color,
        grosor,
        puntos: [p],
      });
      return;
    }
    setEnCurso({ ...nuevaBase({ opacidad, capaId }), clase: herramienta, color, grosor, desde: p, hasta: p });
  };

  const alMover = (e: React.PointerEvent) => {
    // `e.buttons === 0` es «se soltó afuera y volvió»: sin esto el trazo sigue
    // dibujándose al pasar el mouse por encima después de haber soltado.
    if (!activa || e.buttons === 0) return;
    const p = puntoDe(e);

    if (herramienta === 'borrador' && previas.current) {
      const victima = paraTocar[figuraTocada(paraTocar, p, RADIO_TOQUE)];
      if (victima) anotaciones.vistaPrevia(figuras.filter((f) => f.id !== victima.id));
      return;
    }

    if (herramienta === 'seleccion') {
      const esc = escalado.current;
      if (esc) {
        // Una caja de texto solo cambia de ANCHO: el alto lo pone el contenido
        // con word-wrap. Una imagen cambia las dos, y Shift libera su proporción.
        const nueva =
          esc.original.clase === 'caja'
            ? redimensionarCaja(esc.original, esc.esquina, p)
            : esc.original.clase === 'imagen'
              ? redimensionarImagen(esc.original, esc.esquina, p, e.shiftKey)
              : esc.original;
        anotaciones.vistaPrevia(figuras.map((f) => (f.id === nueva.id ? nueva : f)));
        return;
      }

      const arr = arrastre.current;
      if (arr) {
        const dx = p[0] - arr.desde[0];
        const dy = p[1] - arr.desde[1];
        const porId = new Map(arr.originales.map((f) => [f.id, f]));
        anotaciones.vistaPrevia(
          figuras.map((f) => {
            const original = porId.get(f.id);
            return original ? moverFigura(original, dx, dy) : f;
          }),
        );
        return;
      }

      if (lazo) setLazo({ ...lazo, x2: p[0], y2: p[1] });
      return;
    }

    setEnCurso((actual) => {
      if (!actual) return actual;
      if (actual.clase === 'trazo' || actual.clase === 'resaltador') {
        return { ...actual, puntos: [...actual.puntos, p] };
      }
      if (actual.clase === 'rotulo' || actual.clase === 'imagen') return actual;
      return { ...actual, hasta: p };
    });
  };

  const alSoltar = () => {
    if (!activa) return;
    const base = previas.current;

    if (herramienta === 'borrador') {
      // El borrador no apila un paso por figura: arrastrar sobre cinco trazos es
      // UN borrado, y un solo «deshacer» los devuelve a los cinco.
      if (base && base !== figuras) anotaciones.confirmar(figuras, base);
      previas.current = null;
      return;
    }

    if (herramienta === 'seleccion') {
      if (lazo) {
        anotaciones.elegir(figurasEnCaja(paraTocar, lazo));
        setLazo(null);
      } else if ((arrastre.current || escalado.current) && base && base !== figuras) {
        // Solo se apila si de verdad cambió algo: un clic para elegir no es un
        // cambio y no tiene por qué gastar un paso de deshacer.
        anotaciones.confirmar(figuras, base);
      }
      arrastre.current = null;
      escalado.current = null;
      previas.current = null;
      return;
    }

    if (herramienta === 'rotulo') return; // lo cierra su propio input

    const terminada = enCurso;
    setEnCurso(null);
    previas.current = null;
    if (!terminada || !base) return;

    // Un clic sin arrastrar con una forma no deja nada: un rectángulo de área
    // cero es una figura invisible que después hay que borrar a ciegas.
    if ('desde' in terminada) {
      const largo = Math.hypot(terminada.hasta[0] - terminada.desde[0], terminada.hasta[1] - terminada.desde[1]);
      if (largo < 2) return;
    }

    anotaciones.confirmar([...base, terminada], base);
  };

  /* ── Imágenes ──────────────────────────────────────────────────────────── */

  /**
   * MONTA UNA IMAGEN EN LA CAPA.
   *
   * `donde` es opcional: cuando se pega con el teclado no hay puntero, así que
   * cae en el CENTRO DE LO QUE SE ESTÁ VIENDO. Ponerla en el origen del
   * documento la dejaría fuera de pantalla en una página larga — pegar algo y no
   * verlo aparecer se lee como que no funcionó.
   */
  const montarImagen = useCallback(
    async (datos: Blob, donde?: Punto) => {
      setSubiendo(true);
      anotaciones.avisar(null);
      try {
        const subido = await subirImagen(datos);
        const { ancho, alto } = medidaAlPegar(
          { ancho: subido.ancho, alto: subido.alto },
          medida.ancho || 700,
        );

        let centro = donde;
        if (!centro) {
          const caja = canvasRef.current?.getBoundingClientRect();
          // `-caja.top` es cuánto de la página quedó por encima del viewport:
          // sumarle media ventana da el centro de lo que se ve, en coordenadas
          // del documento.
          const y = caja ? -caja.top + window.innerHeight / 2 : (medida.alto || 400) / 2;
          centro = [(medida.ancho || 700) / 2, Math.max(alto / 2, y)];
        }

        anotaciones.agregar([
          {
            ...nuevaBase({ opacidad, capaId }),
            clase: 'imagen',
            archivo: subido.archivo,
            x: centro[0] - ancho / 2,
            y: centro[1] - alto / 2,
            ancho,
            alto,
            naturalAncho: subido.ancho,
            naturalAlto: subido.alto,
          },
        ]);
      } catch (e) {
        anotaciones.avisar(e instanceof Error ? e.message : 'No se pudo pegar la imagen.');
      } finally {
        setSubiendo(false);
      }
    },
    [anotaciones, medida.ancho, medida.alto],
  );

  /** Le da a la barra el abridor del buscador de archivos. */
  useEffect(() => {
    if (!pedirImagen) return;
    pedirImagen(activa || herramienta === 'puntero' ? () => archivoRef.current?.click() : null);
    return () => pedirImagen(null);
  }, [pedirImagen, activa, herramienta]);

  /* ── Portapapeles ──────────────────────────────────────────────────────── */

  /**
   * ⌘V CON UNA IMAGEN ADENTRO.
   *
   * Va en `document` y no en el canvas, y hace falta: un `paste` solo llega al
   * elemento con foco, y al pegar recién llegado de otra aplicación el foco
   * puede estar en cualquier parte. Se filtra por «hay una página abierta y una
   * imagen en el portapapeles», y **solo entonces** se cancela el evento — si no,
   * pegar texto en la Libreta dejaría de funcionar.
   */
  useEffect(() => {
    const alPegar = (e: ClipboardEvent) => {
      const archivo = imagenDelPortapapeles(e.clipboardData);
      if (archivo) {
        e.preventDefault();
        void montarImagen(archivo);
        return;
      }
      // Sin imagen en el sistema: si hay algo copiado ACÁ y estamos en modo
      // dibujo, se pega eso. Con el modo texto puesto no se toca nada — pegar
      // texto en el editor tiene que seguir siendo lo normal.
      if (activa && portapapelesInterno.length > 0) {
        e.preventDefault();
        anotaciones.agregar(duplicar(portapapelesInterno));
      }
    };
    document.addEventListener('paste', alPegar);
    return () => document.removeEventListener('paste', alPegar);
  }, [activa, anotaciones, montarImagen]);

  /* ── Cajas de texto ────────────────────────────────────────────────────── */

  /**
   * ESCRIBIR EN UNA CAJA SE GUARDA COMO UN GESTO, no tecla por tecla.
   *
   * `vistaPrevia` mientras se teclea y `confirmar` recién al cerrar la edición:
   * con un paso de deshacer por carácter, un ⌘Z borraría una letra y escribir un
   * párrafo llenaría la pila con cien entradas inútiles.
   */
  const textoDeCaja = useCallback(
    (id: string, texto: string) => {
      anotaciones.vistaPrevia(figuras.map((f) => (f.id === id && f.clase === 'caja' ? { ...f, texto } : f)));
    },
    [anotaciones, figuras],
  );

  /**
   * El alto MEDIDO del contenido. No pasa por la pila ni por el guardado: es una
   * consecuencia del texto, no una decisión de nadie. Apilarlo metería un paso
   * de deshacer por cada línea que aparece al angostar la caja.
   */
  const altoDeCaja = useCallback(
    (id: string, alto: number) => {
      anotaciones.vistaPrevia(figuras.map((f) => (f.id === id && f.clase === 'caja' ? { ...f, alto } : f)));
    },
    [anotaciones, figuras],
  );

  const cerrarEdicion = useCallback(() => {
    setEditandoCaja(null);
    // Lo tecleado se baja al guardado en un solo paso. `previas` es lo que había
    // antes de abrir la caja, o lo actual si nunca se tocó nada.
    anotaciones.confirmar(figuras, previas.current ?? figuras);
    previas.current = null;
  }, [anotaciones, figuras]);

  /* ── Teclado ───────────────────────────────────────────────────────────── */

  const alTeclear = (e: React.KeyboardEvent) => {
    // 🔴 Con una caja abierta el teclado es SUYO. La caja ya frena la
    // propagación, pero esta guarda es la que sostiene la regla aunque el foco
    // termine en otra parte: sin ella, ⌘A adentro de una caja seleccionaría
    // todas las figuras en vez de su texto.
    if (!activa || editandoCaja) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onSalirDelDibujo();
      return;
    }

    // Las flechas corren lo elegido. Shift corre más — el paso fino sirve para
    // encajar una flecha contra una palabra, el largo para reacomodar.
    const flechas: Record<string, Punto> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direccion = flechas[e.key];
    if (direccion && seleccionadas.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      const paso = e.shiftKey ? PASO_FLECHA_LARGO : PASO_FLECHA;
      anotaciones.correrSeleccion(direccion[0] * paso, direccion[1] * paso);
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && seleccionadas.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      anotaciones.borrarSeleccion();
      return;
    }

    if (!(e.metaKey || e.ctrlKey)) return;
    const tecla = e.key.toLowerCase();

    if (tecla === 'z') {
      // 🔴 Se frena la propagación: sin esto BlockNote deshace ADEMÁS su propio
      // paso y se pierden dos cosas distintas de un solo tecleo.
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) anotaciones.rehacer();
      else anotaciones.deshacer();
      return;
    }
    if (tecla === 'y') {
      e.preventDefault();
      e.stopPropagation();
      anotaciones.rehacer();
      return;
    }
    if (tecla === 'a') {
      e.preventDefault();
      e.stopPropagation();
      anotaciones.elegir(paraTocar.map((f) => f.id));
      return;
    }
    if (seleccionadas.length === 0) return;

    if (tecla === 'c') {
      e.preventDefault();
      e.stopPropagation();
      portapapelesInterno = elegidas;
      return;
    }
    if (tecla === 'x') {
      e.preventDefault();
      e.stopPropagation();
      portapapelesInterno = elegidas;
      anotaciones.borrarSeleccion();
      return;
    }
    if (tecla === 'd') {
      e.preventDefault();
      e.stopPropagation();
      anotaciones.duplicarSeleccion();
    }
  };

  const cursor =
    herramienta === 'rotulo' ? 'cursor-text' : herramienta === 'seleccion' ? 'cursor-default' : 'cursor-crosshair';

  return (
    <>
      <canvas
        ref={canvasRef}
        width={Math.max(1, Math.round(medida.ancho * dpr))}
        height={Math.max(1, Math.round(medida.alto * dpr))}
        style={{ width: medida.ancho || '100%', height: medida.alto || '100%' }}
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        onKeyDown={alTeclear}
        // El `tabIndex` es lo que deja que Suprimir, las flechas y ⌘Z lleguen
        // acá; solo cuando la capa está activa, o robaría el tabulador.
        tabIndex={activa ? 0 : undefined}
        // 🔴 LA LÍNEA QUE DECIDE TODO. Ver el docblock: sin el `none`, la capa se
        // come cada clic del editor de texto que hay debajo.
        className={'absolute inset-0 z-10 outline-none ' + (activa ? `touch-none ${cursor}` : 'pointer-events-none')}
        // No es una imagen con contenido propio: es una capa sobre el documento.
        role="application"
        aria-label={
          activa
            ? `Capa de anotaciones activa (${herramienta}). Escape vuelve al texto.`
            : 'Capa de anotaciones en reposo'
        }
      />

      {/* El buscador de archivos. Oculto: lo dispara el botón de la barra. */}
      <input
        ref={archivoRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          // El valor se limpia para que elegir DOS VECES el mismo archivo
          // vuelva a disparar `change` — si no, la segunda vez no pasa nada.
          e.target.value = '';
          if (archivo) void montarImagen(archivo);
        }}
      />

      {/*
        LAS CAJAS DE TEXTO. Van FUERA del canvas —son DOM de verdad— pero adentro
        del mismo contenedor, así que comparten coordenadas y scrollean igual.
        Solo se dibujan las de una capa visible.
      */}
      {paraVer
        .filter((f): f is Extract<Figura, { clase: 'caja' }> => f.clase === 'caja')
        .map((f) => (
          <CajaFlotante
            key={f.id}
            figura={f}
            editando={editandoCaja === f.id}
            elegida={seleccionadas.includes(f.id)}
            // Con la capa en reposo, la caja deja pasar el clic al editor.
            interactiva={activa}
            onTexto={(t) => textoDeCaja(f.id, t)}
            onAlto={(alto) => altoDeCaja(f.id, alto)}
            onEmpezarAEditar={() => {
              previas.current = figuras;
              setEditandoCaja(f.id);
            }}
            onTerminarDeEditar={cerrarEdicion}
            onPointerDown={(e) => {
              // Como objeto, el puntero de la caja es el de la capa: así se la
              // arrastra y se la suma a una selección con las mismas reglas que
              // un trazo, sin una segunda implementación.
              if (herramienta === 'seleccion') alBajar(e);
            }}
          />
        ))}

      {escribiendo && (
        <input
          autoFocus
          value={escribiendo.valor}
          onChange={(e) => setEscribiendo({ ...escribiendo, valor: e.target.value })}
          onBlur={() => cerrarRotulo(true)}
          onKeyDown={(e) => {
            // El teclado del rótulo NO sube: una `Enter` que llegue a BlockNote
            // parte la página en dos mientras se escribe sobre el dibujo.
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              cerrarRotulo(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cerrarRotulo(false);
            }
          }}
          aria-label="Texto de la anotación"
          placeholder="Escribí y Enter"
          className="absolute z-20 rounded border border-dashed border-primary bg-card/90 px-1 outline-none"
          style={{
            left: escribiendo.en[0],
            top: escribiendo.en[1],
            color,
            fontSize: tamanoDeRotulo(grosor),
            width: Math.max(140, (escribiendo.valor.length + 2) * tamanoDeRotulo(grosor) * 0.6),
          }}
        />
      )}

      {(anotaciones.aviso || subiendo) && (
        <p
          className={
            'sticky bottom-2 z-20 mx-2 rounded px-2 py-1 text-xs ' +
            (anotaciones.aviso
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-secondary text-secondary-foreground')
          }
          role={anotaciones.aviso ? 'alert' : 'status'}
        >
          {anotaciones.aviso ?? 'Subiendo la imagen…'}
        </p>
      )}
    </>
  );
}
