import { useState } from 'react';
import { AlertTriangle, Boxes, Check, FileText, Megaphone, Search, Undo2, X } from 'lucide-react';
import { useEscape } from '../../lib/teclado/useEscape';
import { leerId, type Pieza } from './piezas';
import {
  porQueEsteProducto,
  useCorregirProducto,
  useProductosElegibles,
  type FamiliaElegible,
} from './routing';

/**
 * A QUÉ PRODUCTO PERTENECE ESTA PIEZA — y cómo cambiarlo.
 *
 * ══ QUÉ PROBLEMA CIERRA ══════════════════════════════════════════════════════
 *
 * El producto de una campaña o un formulario se INFIERE de las palabras de su
 * nombre, y la inferencia se equivoca. Medido en producción el 18-ago-2026:
 * **4 de los 22 cursos de formulario están enlazados a un producto que no es el
 * suyo** —«Programa Premium ChatGPT Pro para consultoría política 4×4» cae en el
 * Consultor Político porque el alias dice «consultoria politica»— y **70 de las
 * 153 campañas no resuelven ninguno**.
 *
 * Hasta hoy eso solo se podía mirar. Acá se corrige.
 *
 * ══ 🔴 EL «POR QUÉ» ES LA MITAD QUE HACE ÚTIL A ESTA HOJA ════════════════════
 *
 * «Consultor Político» a secas no se puede juzgar. Los tres orígenes se ven
 * idénticos en la lista y **solo uno puede estar mal**:
 *
 *   · **Lo decidió alguien** — ya está corregido a mano, no lo toques.
 *   · **Lo dice el código del nombre** — el SKU `[DIPCIBE004]` que escribió quien
 *     armó la pauta. Es una afirmación, no una adivinanza.
 *   · **Coincidió con «ciberdefensa»** — una coincidencia de palabras, y el único
 *     de los tres que hay que revisar. Va marcado.
 *
 * Sin esa línea, corregir sería probar de a una a ver cuál estaba mal.
 *
 * ══ SE SUPERPONE, NO EMPUJA — el molde de `HojaContacto` ═════════════════════
 *
 * A 1280 el lienzo tiene ~912 px y sus columnas piden 736: empujando 360 px no
 * entra y aparecería scroll horizontal, que en Hermes no existe. Va encima.
 *
 * **Sin scrim**, y eso es deliberado: se puede tocar otra pieza de la lista y la
 * hoja cambia sin cerrarse — que es como se revisa una lista de piezas mal
 * enlazadas, una tras otra.
 *
 * ⚠️ **Tapa la columna de vendedoras mientras está abierta, y está bien**:
 * corregir a qué producto pertenece algo y decidir a quién le cae son dos tareas
 * distintas, y la primera CAMBIA el lienzo (la pieza se muda de producto), así
 * que igual hay que volver a mirarlo después.
 *
 * ══ EL ESCAPE, Y POR QUÉ EL LLAMADOR APAGA EL SUYO ═══════════════════════════
 *
 * `useEscape` registra en CAPTURA y corta la propagación (ADR 0024). `VistaRouting`
 * ya tiene un listener de Escape para cerrar la campaña abierta dentro del nodo:
 * con los dos vivos, un Escape cerraría **las dos cosas de una**. Por eso la
 * vista apaga el suyo mientras esta hoja está montada.
 *
 * **Sin oro**: el dorado significa tiempo que se acaba y acá no corre nada.
 */
const ICONO = { producto: Boxes, campana: Megaphone, formulario: FileText, vendedora: Boxes };

export function HojaDeLaPieza({
  pieza,
  onCerrar,
}: {
  pieza: Pieza;
  onCerrar: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const elegibles = useProductosElegibles(true);
  const corregir = useCorregirProducto();
  useEscape(onCerrar);

  const { tipo, clave } = leerId(pieza.id);
  const esCampana = tipo === 'campana';
  const Icono = ICONO[pieza.icono] ?? Megaphone;
  const porQue = porQueEsteProducto(pieza.origenFamilia, pieza.aliasFamilia);

  const familias = elegibles.data?.familias ?? [];
  const actual = familias.find((f) => f.familia === pieza.familia);
  const q = busqueda.trim().toLowerCase();
  const visibles = q
    ? familias.filter((f) => f.nombre.toLowerCase().includes(q) || f.familia.toLowerCase().includes(q))
    : familias;

  function mandar(familia: string | null) {
    corregir.mutate({ tipo: esCampana ? 'campana' : 'curso', clave, familia });
  }

  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 flex w-[22.5rem] flex-col border-l border-border bg-background shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.18)]"
      aria-label="Producto de esta pieza"
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
        <Icono size={15} strokeWidth={1.9} className="mt-0.5 shrink-0 text-navy" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium leading-snug text-foreground">{pieza.titulo}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {esCampana ? 'Campaña de Meta' : 'Formulario'} · {pieza.pie}
          </p>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors duration-200 ease-house hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ── DE QUÉ PRODUCTO ES HOY, y por qué ─────────────────────────────── */}
        <section className="border-b border-border px-4 py-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Producto
          </h3>
          {pieza.familia ? (
            <>
              <p className="mt-1.5 text-xs font-medium text-foreground">
                {actual?.nombre ?? pieza.familia}
              </p>
              {porQue && (
                <p
                  className={
                    'mt-1 flex items-start gap-1.5 text-[11px] ' +
                    (porQue.sospechoso ? 'text-amber-700' : 'text-muted-foreground')
                  }
                >
                  {porQue.sospechoso && (
                    <AlertTriangle size={12} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
                  )}
                  <span>{porQue.texto}</span>
                </p>
              )}
            </>
          ) : (
            /**
             * ⚠️ **«No pertenece a ninguno» NO es un error y se dice así.** Son 70
             * de 153 campañas: los nombres de pauta llevan meses, canales y promos
             * adentro, y ninguna palabra del curso. Se puede cablear igual, suelta.
             */
            <p className="mt-1.5 text-xs text-muted-foreground">
              No pertenece a ningún producto. Se puede cablear igual, suelta.
            </p>
          )}

          {pieza.origenFamilia === 'manual' && (
            <button
              type="button"
              onClick={() => mandar(null)}
              disabled={corregir.isPending}
              className="mt-2 flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-[color,border-color] duration-200 ease-house hover:border-navy/40 hover:text-navy disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Undo2 size={12} strokeWidth={2} aria-hidden />
              Volver al automático
            </button>
          )}
        </section>

        {/* ── CAMBIARLO ─────────────────────────────────────────────────────── */}
        <section className="px-4 py-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Mandarla a otro producto
          </h3>

          {/**
           * 🔴 **LO QUE ESTO CAMBIA NO SE QUEDA EN ESTA PANTALLA, y hay que
           * decirlo ANTES de que elija.** La corrección se guarda en el
           * diccionario que también leen el chip de curso de la cola, el
           * Dashboard y el bot. Un cambio con ese alcance no se anuncia después,
           * en el acuse.
           */}
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Cambia también el curso que se ve en la cola y en el Dashboard.
          </p>

          <div className="mt-2 flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
            <Search size={13} strokeWidth={2} className="shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar un producto…"
              aria-label="Buscar un producto"
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          {elegibles.isLoading && (
            <div className="mt-2 space-y-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-7 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          )}

          {elegibles.isError && (
            <p className="mt-2 text-[11px] text-destructive">
              No se pudo traer la lista de productos. {elegibles.error?.message}
            </p>
          )}

          {/**
           * ⚠️ **«La lista está corta» se dice, no se esconde.** Con Cerberus
           * caído se ofrecen solo las familias que Hermes ya sabe nombrar; una
           * lista incompleta que no lo avisa se lee como «ese producto no existe».
           */}
          {elegibles.data?.catalogoCaido && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
              <AlertTriangle size={12} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
              <span>
                Cerberus no contestó: la lista trae solo los productos que Hermes ya conoce.
              </span>
            </p>
          )}

          <ul className="mt-2 space-y-0.5">
            {visibles.map((f) => (
              <Opcion
                key={f.familia}
                familia={f}
                actual={f.familia === pieza.familia}
                guardando={corregir.isPending}
                onElegir={() => mandar(f.familia)}
              />
            ))}
          </ul>

          {!elegibles.isLoading && visibles.length === 0 && (
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              {q ? 'Ningún producto coincide.' : 'No hay productos para elegir.'}
            </p>
          )}
        </section>
      </div>

      {corregir.isError && (
        <p className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-destructive">
          {(corregir.error as Error).message}
        </p>
      )}
    </aside>
  );
}

/**
 * ⚠️ **El producto actual se dibuja igual y NO se puede volver a elegir**: un
 * botón que guarda lo que ya está guardado se lee como que algo cambió.
 */
function Opcion({
  familia,
  actual,
  guardando,
  onElegir,
}: {
  familia: FamiliaElegible;
  actual: boolean;
  guardando: boolean;
  onElegir: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onElegir}
        disabled={actual || guardando}
        aria-current={actual}
        className={
          'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-200 ease-house focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
          (actual
            ? 'bg-navy/5 text-navy'
            : 'text-foreground hover:bg-secondary disabled:opacity-50')
        }
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs">{familia.nombre}</span>
          {/**
           * ⚠️ El código de familia va abajo y en mono: es un SKU interno y no
           * sirve para elegir, pero es lo único que permite reconocer dos
           * productos con nombres comerciales parecidos.
           */}
          <span className="block truncate font-mono text-[10px] text-muted-foreground">
            {familia.familia}
          </span>
        </span>
        {actual && <Check size={13} strokeWidth={2.2} className="shrink-0" aria-hidden />}
      </button>
    </li>
  );
}
