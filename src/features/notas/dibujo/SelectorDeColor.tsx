import { useEffect, useRef, useState } from 'react';
import { type Hsv, aByte, aHex, desdeHex, hexAHsv, hsvAHex, hsvARgb, rgbAHsv, tintaSobre } from './color';

/**
 * EL SELECTOR AVANZADO — el cuadrado, la barra de matiz, RGB y HEX.
 *
 * ══ POR QUÉ EL ESTADO INTERNO ES HSV Y NO EL HEX ════════════════════════════
 *
 * 🔴 Porque el HEX **pierde información que el selector necesita**. Un negro es
 * `#000000` y de ahí no se puede recuperar sobre qué matiz estaba parado el
 * usuario: al llevar el cuadrado hasta abajo, la barra de matiz saltaría al rojo
 * sola y el color siguiente saldría de otro lado. Lo mismo con cualquier gris.
 *
 * Guardando HSV, el matiz sobrevive a pasar por el negro y por el blanco. El HEX
 * se DERIVA en cada render y solo se convierte de vuelta cuando entra un color
 * de afuera (el que traía la herramienta, o uno pegado en el campo).
 *
 * ══ POR QUÉ HAY UN «ACEPTAR» ════════════════════════════════════════════════
 *
 * Se podría aplicar en vivo, y es tentador. Pero con figuras seleccionadas el
 * color se APLICA a lo elegido, y en vivo eso serían cien pasos de deshacer
 * mientras se arrastra por el cuadrado. Aceptar/Cancelar convierte la elección
 * en un solo cambio, que es lo que la vendedora entiende por «cambié el color».
 */

/** El diámetro de la rueda, en píxeles de CSS. */
const RUEDA = 150;
/** Qué tan gruesa es la corona de la rueda. */
const GROSOR_RUEDA = 16;
/** El cuadrado inscripto en el hueco: lado = radio interior × √2. */
const LADO_INTERIOR = Math.floor(((RUEDA - GROSOR_RUEDA * 2) / 2) * Math.SQRT2);

function recortar(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * ARRASTRAR SOBRE UN ÁREA. Devuelve la posición relativa en 0–1.
 *
 * Captura el puntero para que el arrastre siga funcionando al salirse del
 * cuadrado: sin eso, mover rápido hacia una esquina suelta el gesto en el borde
 * y el color se queda a medio camino de donde se apuntaba.
 */
function useArrastre(alMover: (x: number, y: number) => void) {
  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const caja = e.currentTarget.getBoundingClientRect();
      alMover(recortar((e.clientX - caja.left) / caja.width, 0, 1), recortar((e.clientY - caja.top) / caja.height, 0, 1));
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.buttons === 0) return;
      const caja = e.currentTarget.getBoundingClientRect();
      alMover(recortar((e.clientX - caja.left) / caja.width, 0, 1), recortar((e.clientY - caja.top) / caja.height, 0, 1));
    },
  };
}

/**
 * LA RUEDA DE MATIZ.
 *
 * ══ POR QUÉ UN CONO CÓNICO Y NO UN CANVAS ═══════════════════════════════════
 *
 * `conic-gradient` con los seis vértices del espectro produce exactamente la
 * rueda, la pinta el navegador y se redibuja sola al cambiar de tamaño. Un
 * canvas pediría recorrer 360 sectores a mano en cada render y quedaría pixelado
 * al escalar. El agujero del medio lo hace un `radial-gradient` de máscara: así
 * el cuadrado de saturación puede vivir adentro de la corona.
 *
 * El ángulo se saca con `atan2` desde el centro. `+90` porque el gradiente
 * cónico de CSS arranca arriba (las 12) y el matiz 0 —el rojo— tiene que quedar
 * ahí; sin ese corrimiento, la rueda se ve bien y el color que devuelve está a
 * un cuarto de vuelta de donde se apuntó.
 */
function RuedaDeMatiz({ matiz, onMatiz }: { matiz: number; onMatiz: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  const desdeElPuntero = (e: React.PointerEvent) => {
    const caja = ref.current?.getBoundingClientRect();
    if (!caja) return;
    const dx = e.clientX - (caja.left + caja.width / 2);
    const dy = e.clientY - (caja.top + caja.height / 2);
    onMatiz((((Math.atan2(dy, dx) * 180) / Math.PI + 90) % 360 + 360) % 360);
  };

  const radio = (RUEDA - GROSOR_RUEDA) / 2;
  const rad = ((matiz - 90) * Math.PI) / 180;

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        desdeElPuntero(e);
      }}
      onPointerMove={(e) => e.buttons !== 0 && desdeElPuntero(e)}
      role="slider"
      tabIndex={0}
      aria-label="Rueda de matiz"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(matiz)}
      className="relative cursor-crosshair touch-none rounded-full"
      style={{
        width: RUEDA,
        height: RUEDA,
        background:
          'conic-gradient(from 0deg, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)',
        // La corona: transparente en el centro para que entre el cuadrado.
        WebkitMaskImage: `radial-gradient(circle, transparent ${radio - GROSOR_RUEDA / 2}px, #000 ${radio - GROSOR_RUEDA / 2 + 1}px)`,
        maskImage: `radial-gradient(circle, transparent ${radio - GROSOR_RUEDA / 2}px, #000 ${radio - GROSOR_RUEDA / 2 + 1}px)`,
      }}
    >
      <span
        className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
        style={{
          left: RUEDA / 2 + radio * Math.cos(rad),
          top: RUEDA / 2 + radio * Math.sin(rad),
          backgroundColor: `hsl(${matiz} 100% 50%)`,
        }}
      />
    </div>
  );
}

function CampoNumero({
  rotulo,
  valor,
  onCambio,
}: {
  rotulo: string;
  valor: number;
  onCambio: (n: number) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-0.5">
      <span className="text-[0.625rem] font-medium uppercase text-muted-foreground">{rotulo}</span>
      <input
        type="number"
        min={0}
        max={255}
        value={valor}
        onChange={(e) => {
          // Un campo vacío no se puede convertir a color: se ignora y el input
          // se queda como está, en vez de saltar a 0 mientras se tipea.
          if (e.target.value === '') return;
          onCambio(aByte(Number(e.target.value)));
        }}
        aria-label={rotulo}
        className="w-full rounded border border-input bg-card px-1.5 py-1 text-xs tabular-nums outline-none focus:border-ring"
      />
    </label>
  );
}

export function SelectorDeColor({
  inicial,
  onVistaPrevia,
  onAceptar,
  onCancelar,
}: {
  inicial: string;
  /**
   * Se llama en CADA movimiento: el color se ve aplicado mientras se elige.
   * `Cancelar` restaura `inicial` por este mismo camino, así que quien lo reciba
   * no necesita recordar nada.
   */
  onVistaPrevia(color: string): void;
  onAceptar(color: string): void;
  onCancelar(): void;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexAHsv(inicial) ?? { h: 0, s: 0, v: 0 });
  /**
   * El texto del campo HEX vive aparte del color, y hace falta: mientras se
   * escribe «#3b8» el valor todavía no es un color válido. Con un solo estado,
   * el campo se reescribiría solo en cada tecla y sería imposible tipear.
   */
  const [textoHex, setTextoHex] = useState(inicial);
  const cajaRef = useRef<HTMLDivElement>(null);

  const hex = hsvAHex(hsv);
  const rgb = hsvARgb(hsv);

  // El campo sigue al color mientras no se lo esté editando a mano. Se compara
  // normalizado para no pisar «#3B82F6» con «#3b82f6» mientras alguien tipea.
  useEffect(() => {
    setTextoHex((actual) => (desdeHex(actual) && aHex(desdeHex(actual)!) === hex ? actual : hex));
  }, [hex]);

  /** Escape cancela y Enter acepta: el popup no puede ser una trampa sin salida. */
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancelarRef.current();
      }
    };
    // En captura: el `keydown` de la capa de dibujo también escucha Escape, y
    // sin esto los dos responden y se sale del modo dibujo además de cerrar.
    document.addEventListener('keydown', alTeclear, true);
    return () => document.removeEventListener('keydown', alTeclear, true);
  }, []);

  // El foco entra al panel al abrirlo, para que el teclado sirva sin un clic más.
  useEffect(() => cajaRef.current?.focus(), []);

  /**
   * LA VISTA PREVIA EN VIVO. Cada cambio del color se aplica ya, sin esperar al
   * «Aceptar» — es lo que deja elegir mirando el dibujo y no la muestra.
   *
   * ⚠️ El efecto NO depende de `onVistaPrevia`: quien lo pasa suele armarlo
   * inline, así que su identidad cambia en cada render y el efecto se dispararía
   * en bucle. Se lee de una `ref`, que es la técnica que el resto del módulo ya
   * usa para los avisos hacia arriba.
   */
  const vistaPreviaRef = useRef(onVistaPrevia);
  vistaPreviaRef.current = onVistaPrevia;
  useEffect(() => {
    vistaPreviaRef.current(hex);
  }, [hex]);

  /** Cancelar devuelve el color de antes de abrir, no solo cierra el panel. */
  const cancelar = () => {
    vistaPreviaRef.current(inicial);
    onCancelar();
  };
  // Mismo motivo que arriba: el listener de Escape se registra una sola vez y
  // no puede quedarse con la primera versión de esta función.
  const cancelarRef = useRef(cancelar);
  cancelarRef.current = cancelar;

  const cuadrado = useArrastre((x, y) => setHsv((h) => ({ ...h, s: x, v: 1 - y })));

  const aplicarRgb = (canal: 'r' | 'g' | 'b', n: number) => {
    const nuevo = { ...rgb, [canal]: n };
    const convertido = rgbAHsv(nuevo);
    // El matiz viejo se conserva cuando el color nuevo es un gris: ver el
    // docblock de `rgbAHsv`. Sin esto, bajar los tres canales a 0 salta la barra.
    setHsv((h) => ({ ...convertido, h: convertido.s === 0 ? h.h : convertido.h }));
  };

  return (
    <div
      ref={cajaRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Selector de color"
      className="w-56 rounded-lg border border-border bg-card p-3 shadow-lg outline-none"
      // El popup vive adentro de la barra de herramientas; sin esto, cada clic
      // acá dentro también cuenta como un clic en la barra.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/*
        LA RUEDA CON EL CUADRADO ADENTRO. El matiz se elige en la corona y la
        saturación/luminosidad en el cuadrado del centro — la disposición de la
        referencia, y la que deja las dos manos de la elección a la vista sin
        gastar dos bloques de alto.
      */}
      <div className="relative mx-auto" style={{ width: RUEDA, height: RUEDA }}>
        <RuedaDeMatiz matiz={hsv.h} onMatiz={(h) => setHsv((v) => ({ ...v, h }))} />

        <div
          {...cuadrado}
          role="slider"
          tabIndex={0}
          aria-label="Saturación y brillo"
          aria-valuetext={`saturación ${Math.round(hsv.s * 100)}%, brillo ${Math.round(hsv.v * 100)}%`}
          className="absolute cursor-crosshair touch-none rounded"
          style={{
            // Inscripto en el hueco de la corona: el lado de un cuadrado dentro
            // de un círculo de radio r es r·√2.
            width: LADO_INTERIOR,
            height: LADO_INTERIOR,
            left: (RUEDA - LADO_INTERIOR) / 2,
            top: (RUEDA - LADO_INTERIOR) / 2,
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
          }}
        >
          <span
            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: hex }}
          />
        </div>
      </div>

      {/* LA VISTA PREVIA con su HEX encima. La tinta se elige por contraste, o
          sobre el blanco y sobre el negro el texto desaparecería. */}
      <div
        className="mt-2 flex h-8 items-center justify-center rounded border border-border font-mono text-xs"
        style={{ backgroundColor: hex, color: tintaSobre(hex) }}
        aria-label={`Color elegido ${hex}`}
      >
        {hex}
      </div>

      <div className="mt-2 flex gap-1.5">
        <CampoNumero rotulo="R" valor={rgb.r} onCambio={(n) => aplicarRgb('r', n)} />
        <CampoNumero rotulo="G" valor={rgb.g} onCambio={(n) => aplicarRgb('g', n)} />
        <CampoNumero rotulo="B" valor={rgb.b} onCambio={(n) => aplicarRgb('b', n)} />
      </div>

      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[0.625rem] font-medium uppercase text-muted-foreground">Hex</span>
        <input
          value={textoHex}
          onChange={(e) => {
            setTextoHex(e.target.value);
            // Se aplica solo cuando lo escrito YA es un color. Mientras se tipea
            // «#3b8», el cuadrado no se mueve — y pegar un valor completo lo
            // mueve de una, que es lo que se espera al pegar.
            const rgbPegado = desdeHex(e.target.value);
            if (rgbPegado) {
              const convertido = rgbAHsv(rgbPegado);
              setHsv((h) => ({ ...convertido, h: convertido.s === 0 ? h.h : convertido.h }));
            }
          }}
          onKeyDown={(e) => {
            // El teclado no sube: una Enter acá no puede llegar al documento.
            e.stopPropagation();
            if (e.key === 'Enter') onAceptar(hex);
          }}
          spellCheck={false}
          aria-label="Código hexadecimal"
          placeholder="#FFFFFF"
          className="w-full rounded border border-input bg-card px-1.5 py-1 font-mono text-xs uppercase outline-none focus:border-ring"
        />
      </label>

      <div className="mt-3 flex gap-1.5">
        <button
          type="button"
          onClick={cancelar}
          className="flex-1 rounded-lg border border-border px-2 py-1.5 text-xs text-foreground transition hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => onAceptar(hex)}
          className="flex-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover"
        >
          Aceptar
        </button>
      </div>
    </div>
  );
}
