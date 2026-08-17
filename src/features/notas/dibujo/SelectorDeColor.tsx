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

/** El lado del cuadrado y el alto de la barra, en píxeles de CSS. */
const LADO = 176;
const ALTO_BARRA = 14;

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
  onAceptar,
  onCancelar,
}: {
  inicial: string;
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
        onCancelar();
      }
    };
    // En captura: el `keydown` de la capa de dibujo también escucha Escape, y
    // sin esto los dos responden y se sale del modo dibujo además de cerrar.
    document.addEventListener('keydown', alTeclear, true);
    return () => document.removeEventListener('keydown', alTeclear, true);
  }, [onCancelar]);

  // El foco entra al panel al abrirlo, para que el teclado sirva sin un clic más.
  useEffect(() => cajaRef.current?.focus(), []);

  const cuadrado = useArrastre((x, y) => setHsv((h) => ({ ...h, s: x, v: 1 - y })));
  const barra = useArrastre((x) => setHsv((h) => ({ ...h, h: x * 360 })));

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
      {/* EL CUADRADO: saturación en X, valor en Y, sobre el matiz elegido.
          Dos degradados encima del color puro es la forma clásica y no necesita
          un canvas — el navegador los compone y se redibujan solos. */}
      <div
        {...cuadrado}
        role="slider"
        tabIndex={0}
        aria-label="Saturación y brillo"
        aria-valuetext={`saturación ${Math.round(hsv.s * 100)}%, brillo ${Math.round(hsv.v * 100)}%`}
        className="relative cursor-crosshair touch-none rounded"
        style={{
          height: LADO,
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
        }}
      >
        <span
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: hex }}
        />
      </div>

      {/* LA BARRA DE MATIZ, con el espectro completo. */}
      <div
        {...barra}
        role="slider"
        tabIndex={0}
        aria-label="Matiz"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        className="relative mt-2 cursor-crosshair touch-none rounded"
        style={{
          height: ALTO_BARRA,
          background:
            'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
        }}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        />
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
          onClick={onCancelar}
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
