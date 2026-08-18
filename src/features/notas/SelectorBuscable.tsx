import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { usePopover } from '../../lib/teclado/usePopover';

/**
 * EL COMBO DE WORD — el campo Y el desplegable son la misma caja.
 *
 * ══ QUÉ SE COPIA, EXACTAMENTE ═══════════════════════════════════════════════
 *
 * En Word el control de fuente **no es un botón**: es un campo editable que
 * muestra el valor actual. Se toca, se selecciona solo lo que dice, se escribe
 * encima y la lista de abajo se va achicando. Las flechas recorren, Enter
 * aplica, Escape deja todo como estaba.
 *
 * La primera versión de esto tenía un botón arriba y un buscador APARTE adentro
 * del panel. Funcionaba y no era lo mismo: obligaba a un clic de más y ponía el
 * valor actual y la búsqueda en dos lugares distintos, así que mirando el panel
 * abierto no se sabía con qué se estaba escribiendo.
 *
 * ══ LAS TRES COSAS QUE HACEN QUE SE SIENTA COMO WORD ════════════════════════
 *
 * 1. **Al abrir se selecciona todo el texto** (`select()`), así la primera tecla
 *    reemplaza en vez de agregarse al final. Sin eso, tocar «Arial» y escribir
 *    «geo» deja «Arialgeo» y la lista vacía.
 * 2. **Escape RESTAURA**, no solo cierra. Lo que se estaba tecleando se descarta
 *    y vuelve el valor que había — es lo que espera quien probó algo y se
 *    arrepintió. Cerrar dejando escrito a medias sería un tercer estado.
 * 3. **Las flechas recorren la lista filtrada** y Enter aplica lo resaltado. Sin
 *    esto hay que soltar el teclado e ir al mouse justo después de escribir.
 *
 * ══ EL ESCAPE, QUE ACÁ TIENE UNA VUELTA ════════════════════════════════════
 *
 * `usePopover` es la puerta de la casa para «Escape + clic afuera» (#12: nueve
 * copias a mano, cuatro divergidas). Pero **ignora el Escape cuando el foco está
 * en un campo**, y eso es correcto y deliberado: quien escribe el nombre de una
 * etiqueta y aprieta Escape espera perder la palabra, no el formulario.
 *
 * Acá el campo ES el control, así que Escape tiene que cerrarlo. Se maneja en el
 * `onKeyDown` —el mismo patrón del buscador de curso de `Intereses.tsx`— y se
 * sigue usando `usePopover` para el clic afuera. Las dos mitades, sin
 * reimplementar la que ya existe.
 */

export interface OpcionBuscable {
  /** Lo que se lee y contra lo que se busca. */
  nombre: string;
  /** Lo que se guarda. */
  valor: string;
}

export function SelectorBuscable({
  opciones,
  valorActual,
  etiquetaActual,
  alElegir,
  estiloDeOpcion,
  ancho,
  permiteLibre,
  titulo,
}: {
  opciones: readonly OpcionBuscable[];
  valorActual: string | undefined;
  /** Lo que se ve cuando no se está escribiendo. Lo decide el llamador. */
  etiquetaActual: string;
  alElegir: (valor: string) => void;
  estiloDeOpcion?: (o: OpcionBuscable) => React.CSSProperties | undefined;
  ancho: string;
  /**
   * Si lo tecleado no matchea ninguna opción, ¿vale igual? Devuelve el valor a
   * guardar, o `null` si no. Es lo que separa el tamaño (poner 15 es razonable)
   * de la fuente (inventar un nombre que no está instalado no haría nada visible).
   */
  permiteLibre?: (texto: string) => string | null;
  titulo: string;
}) {
  const [abierto, setAbierto] = useState(false);
  /** `null` = se está mostrando el valor actual. Un string = la persona escribió. */
  const [q, setQ] = useState<string | null>(null);
  const [resaltado, setResaltado] = useState(0);
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);

  const { propsOverlay } = usePopover(abierto, cerrar, { z: 'z-20' });

  function cerrar() {
    setAbierto(false);
    setQ(null);
    setResaltado(0);
  }

  const filtradas = useMemo(() => {
    const t = (q ?? '').trim().toLowerCase();
    if (!t) return opciones;
    return opciones.filter((o) => o.nombre.toLowerCase().includes(t));
  }, [opciones, q]);

  // El resaltado tiene que seguir existiendo después de filtrar: si la lista se
  // achicó, un índice viejo apunta afuera y Enter no haría nada.
  useEffect(() => {
    setResaltado((r) => (r < filtradas.length ? r : 0));
  }, [filtradas.length]);

  // Traer a la vista lo resaltado, o navegar con flechas se pierde apenas la
  // lista pasa de ocho renglones.
  useEffect(() => {
    if (!abierto) return;
    lista.current?.children[resaltado]?.scrollIntoView({ block: 'nearest' });
  }, [abierto, resaltado]);

  function aplicar(valor: string) {
    alElegir(valor);
    cerrar();
  }

  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      // `usePopover` no lo ve: el foco está en un campo. Ver el docblock.
      e.stopPropagation();
      cerrar();
      campo.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!abierto) {
        setAbierto(true);
        return;
      }
      const paso = e.key === 'ArrowDown' ? 1 : -1;
      setResaltado((r) => {
        if (filtradas.length === 0) return 0;
        return (r + paso + filtradas.length) % filtradas.length;
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const elegida = filtradas[resaltado];
      const libre = q === null ? null : permiteLibre?.(q);
      // La opción de la lista gana sobre lo tecleado: si escribís «14» y ese
      // tamaño existe, es ése — no uno inventado que se escribe igual.
      if (elegida) aplicar(elegida.valor);
      else if (libre != null) aplicar(libre);
      return;
    }
    if (e.key === 'Tab') cerrar();
  }

  return (
    <div className="relative" style={{ width: ancho }}>
      <div className="flex items-center rounded border border-transparent hover:border-border">
        <input
          ref={campo}
          value={q ?? etiquetaActual}
          title={titulo}
          aria-label={titulo}
          onChange={(e) => {
            setQ(e.target.value);
            if (!abierto) setAbierto(true);
          }}
          onFocus={() => {
            setAbierto(true);
            // Como Word: se selecciona todo, así la primera tecla reemplaza.
            campo.current?.select();
          }}
          onKeyDown={alTeclear}
          className="w-full min-w-0 bg-transparent px-2 py-1 text-xs text-foreground outline-none"
        />
        <button
          type="button"
          tabIndex={-1}
          // No es un destino propio: abre el MISMO panel que el campo de al
          // lado. Sin esto, el recorrido con flechas de la Ribbon lo cuenta como
          // una parada más y el control queda dos veces en la fila.
          data-roving-omitir
          aria-label={`Abrir ${titulo.toLowerCase()}`}
          onClick={() => {
            if (abierto) cerrar();
            else campo.current?.focus();
          }}
          className="px-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="size-3" />
        </button>
      </div>

      {abierto && (
        <>
          <div {...propsOverlay} />
          <div className="absolute left-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-card shadow-panel">
            <div ref={lista} className="max-h-64 overflow-y-auto py-1">
              {filtradas.map((o, i) => (
                <button
                  key={o.valor}
                  type="button"
                  // `onMouseDown` y no `onClick`: el clic normal llega DESPUÉS
                  // del blur del campo, y para entonces el panel ya se cerró.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    aplicar(o.valor);
                  }}
                  onMouseEnter={() => setResaltado(i)}
                  style={estiloDeOpcion?.(o)}
                  className={`flex w-full items-center px-2 py-1.5 text-left text-sm ${
                    i === resaltado ? 'bg-muted' : ''
                  } ${o.valor === valorActual ? 'font-medium' : ''}`}
                >
                  <span className="truncate">{o.nombre}</span>
                </button>
              ))}
              {filtradas.length === 0 && (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  {permiteLibre ? 'Escribí un número y apretá Enter.' : 'Ninguna instalada coincide.'}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
