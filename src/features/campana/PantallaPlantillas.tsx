import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Plus, X } from 'lucide-react';
import { sectionLabel } from '../../lib/styles';
import {
  CATEGORIAS,
  useCrearPlantilla,
  usePlantillas,
  usePlantillasEnvios,
  useRevisarPlantilla,
  type BorradorPlantilla,
  type PlantillaConEstado,
  type Reparo,
} from './plantillas';
import { avisarMuestraChica, comparacion, queDibujar, respuestas, resumen, salvedad } from './envios';

/**
 * LAS PLANTILLAS: el catálogo con su salud, y el formulario de creación.
 *
 * ══ POR QUÉ EL FORMULARIO REVISA MIENTRAS SE ESCRIBE ════════════════════════
 *
 * Porque **el ciclo con Meta es de 24 horas**. Mandar una plantilla con una
 * variable al final del texto y enterarse mañana —con `INVALID_FORMAT` por toda
 * explicación— es el peor lazo posible para algo que se corrige en dos segundos.
 *
 * La revisión la hace el SERVER (`nombrePlantilla.ts`, puro y con tests): son
 * las reglas de Meta, y una segunda copia en el navegador se desincroniza el día
 * que Meta cambie un largo. Acá sólo se muestran.
 *
 * ══ EL NOMBRE SE SUGIERE, NO SE RECHAZA ═════════════════════════════════════
 *
 * Meta sólo acepta minúsculas, números y guiones bajos. Rechazar «Promo 3x1
 * Agosto» por eso, cuando la corrección es mecánica, es hacerle hacer al humano
 * el trabajo de la máquina. Se propone `promo_3x1_agosto` y se aplica de un clic.
 */
export function PantallaPlantillas() {
  const { data, isPending, isError, error } = usePlantillas();
  const [creando, setCreando] = useState(false);

  if (isPending) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    /** Un fallo de Meta NUNCA se dibuja como «no hay plantillas» (ADR 0023). */
    const msg = error instanceof Error ? error.message : 'No se pudo preguntar a Meta.';
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center p-8">
        <div className="flex max-w-md items-start gap-2.5 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold">No se pudo leer el catálogo</p>
            <p className="mt-1 text-xs leading-relaxed opacity-90">{msg}</p>
            <p className="mt-1 text-xs opacity-75">
              No quiere decir que no haya plantillas: quiere decir que no pudimos preguntar.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">{data.resumen.enviables}</strong> se pueden usar de{' '}
          {data.resumen.total}
          {data.resumen.conProblema > 0 && (
            <span className="ml-2 font-semibold text-destructive">
              · {data.resumen.conProblema} con problema
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={() => setCreando(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-navy px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-navy/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Plus size={13} /> Crear una plantilla
        </button>
      </div>

      {creando && <Formulario onCerrar={() => setCreando(false)} />}

      <ul className="space-y-2">
        {data.plantillas.map((p) => (
          <Fila key={`${p.nombre}:${p.idioma}`} p={p} />
        ))}
      </ul>
    </div>
  );
}

function Fila({ p }: { p: PlantillaConEstado }) {
  const tinta =
    p.lectura.tono === 'problema'
      ? 'border-destructive/30 bg-destructive/5'
      : p.lectura.tono === 'espera'
        ? 'border-warning/30 bg-warning/5'
        : 'border-border bg-card';

  return (
    <li className={`rounded-xl border p-3 ${tinta}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-bold text-foreground">{p.nombre}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {p.idioma}
        </span>
        {p.categoria && (
          <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[11px] font-semibold text-navy-ink">
            {p.categoria}
          </span>
        )}
        {p.headerDeImagen && (
          <span
            className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            title="Meta exige una imagen en CADA envío. Sin ella el envío falla con 132012."
          >
            🖼 pide imagen
          </span>
        )}
        <span
          className={`ml-auto inline-flex items-center gap-1 text-xs font-bold ${
            p.enviable ? 'text-success' : 'text-destructive'
          }`}
        >
          {p.enviable ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {p.lectura.titulo}
        </span>
      </div>

      {p.lectura.detalle && <p className="mt-1.5 text-xs text-muted-foreground">{p.lectura.detalle}</p>}

      <p className="mt-1 text-[11px] text-muted-foreground">
        calidad: <strong className={p.calidad.tono === 'problema' ? 'text-destructive' : ''}>{p.calidad.texto}</strong>
        {p.calidad.texto.startsWith('Sin medir') && (
          <span
            className="ml-1 opacity-75"
            title="Meta aplica «pacing» a las plantillas sin calidad medida: retiene parte de los mensajes para juntar feedback, y si las señales salen mal descarta los siguientes."
          >
            — Meta puede retener parte de los envíos
          </span>
        )}
      </p>

      {p.cuerpo && (
        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 font-sans text-xs text-muted-foreground">
          {p.cuerpo}
        </pre>
      )}

      <Envios nombre={p.nombre} />
    </li>
  );
}

/**
 * CUÁNTO SE MANDÓ CON ESTA PLANTILLA.
 *
 * ══ POR QUÉ ACÁ Y NO EN «QUIÉN MANDÓ QUÉ» ═══════════════════════════════════
 *
 * Porque esa pantalla lee `corridas_campana`, o sea **quién autorizó**, y la
 * campaña del foro salió por script: no tiene firma y no puede tenerla —
 * inventarle una fila sería falsificar la auditoría—. El hecho de los 1.004
 * envíos vive en `envios_wa`, y la pregunta «¿cuánto se mandó esto?» se hace
 * mirando la plantilla, que es donde está parada la vendedora cuando se la hace.
 *
 * ══ LOS TRES ESTADOS SE DIBUJAN DISTINTO, Y ESO ES EL PUNTO ═════════════════
 *
 *   · **no se pudo contar** → no se dibuja NADA. Un «0 envíos» ahí invitaría a
 *     mandar de nuevo una campaña que ya salió.
 *   · **no se mandó nunca** → se dice con todas las letras. Es un cero de
 *     verdad, y distinguirlo del anterior es toda la diferencia.
 *   · **se mandó** → cuántos, cuándo, qué no salió, y cuántos contestaron
 *     contra la línea de base.
 */
function Envios({ nombre }: { nombre: string }) {
  const { data } = usePlantillasEnvios();
  const que = queDibujar(data, nombre);

  // Sin respuesta —cargando, 502, 403— no se afirma nada sobre esta plantilla.
  if (que.tipo === 'nada') return null;

  if (que.tipo === 'nunca') {
    return (
      <p className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
        Todavía no se mandó ninguna vez.
      </p>
    );
  }

  const e = que.e;
  const base = comparacion(data?.lineaDeBase ?? null);

  return (
    <div className="mt-2 space-y-0.5 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
      <p>
        <strong className="text-foreground">{resumen(e)}</strong>
        {e.versiones > 1 && (
          <span
            className="ml-1.5"
            title="Se mandó con más de un texto bajo el mismo nombre. El porcentaje de acá los mezcla; el reporte por pieza los separa."
          >
            · con {e.versiones} textos distintos
          </span>
        )}
      </p>
      <p>
        {respuestas(e)}
        {avisarMuestraChica(e) && (
          <span className="ml-1 opacity-75" title="Con esta muestra el porcentaje existe pero no decide nada.">
            — muestra chica
          </span>
        )}
      </p>
      {salvedad(e) && <p className="opacity-75">{salvedad(e)}</p>}
      {base && e.medibles > 0 && <p className="opacity-75">{base}</p>}
    </div>
  );
}

const VACIO: BorradorPlantilla = { nombre: '', idioma: 'es_PE', categoria: 'MARKETING', cuerpo: '' };

function Formulario({ onCerrar }: { onCerrar: () => void }) {
  const [b, setB] = useState<BorradorPlantilla>(VACIO);
  const [reparos, setReparos] = useState<Reparo[]>([]);
  const [sugerido, setSugerido] = useState('');
  const revisar = useRevisarPlantilla();
  const crear = useCrearPlantilla();

  /**
   * Se revisa 500 ms después de la última tecla. Sin el debounce sería una
   * request por letra; con más, el reparo llega cuando ya seguiste escribiendo.
   */
  useEffect(() => {
    if (!b.nombre && !b.cuerpo) {
      setReparos([]);
      return;
    }
    const t = setTimeout(() => {
      revisar.mutate(b, {
        onSuccess: (r) => {
          setReparos(r.reparos);
          setSugerido(r.nombreSugerido);
        },
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.nombre, b.idioma, b.categoria, b.cuerpo, b.headerTexto, b.pie]);

  const deCampo = (c: Reparo['campo']) => reparos.find((r) => r.campo === c);
  const listaParaMandar = reparos.length === 0 && b.nombre.length > 0 && b.cuerpo.length > 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="font-heading text-sm font-bold">Crear una plantilla</h3>
        <p className="text-[11px] text-muted-foreground">
          Meta la revisa en hasta 24 h. Crear no le manda nada a nadie.
        </p>
        <button
          type="button"
          onClick={onCerrar}
          className="ml-auto rounded-full p-1 text-muted-foreground hover:bg-muted"
          aria-label="Cerrar"
        >
          <X size={15} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nombre" reparo={deCampo('nombre')}>
          <input
            value={b.nombre}
            onChange={(e) => setB({ ...b, nombre: e.target.value })}
            placeholder="promo_agosto"
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm"
          />
          {/* El nombre se SUGIERE. Rechazar por una mayúscula, cuando la
              corrección es mecánica, es hacerle hacer al humano el trabajo
              de la máquina. */}
          {sugerido && sugerido !== b.nombre && (
            <button
              type="button"
              onClick={() => setB({ ...b, nombre: sugerido })}
              className="mt-1 text-[11px] font-bold text-navy-ink hover:underline"
            >
              usar «{sugerido}»
            </button>
          )}
        </Campo>

        <Campo rotulo="Idioma" reparo={deCampo('idioma')}>
          <input
            value={b.idioma}
            onChange={(e) => setB({ ...b, idioma: e.target.value })}
            placeholder="es_PE"
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Es una etiqueta, no una promesa sobre el texto — al mandar tiene que coincidir exacto.
          </p>
        </Campo>

        <Campo rotulo="Categoría" reparo={deCampo('categoria')}>
          <select
            value={b.categoria}
            onChange={(e) => setB({ ...b, categoria: e.target.value })}
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm"
          >
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.rotulo}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {CATEGORIAS.find((c) => c.valor === b.categoria)?.ayuda}
          </p>
        </Campo>

        <Campo rotulo="Pie (opcional)" reparo={deCampo('pie')}>
          <input
            value={b.pie ?? ''}
            onChange={(e) => setB({ ...b, pie: e.target.value })}
            placeholder="Goberna"
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm"
          />
        </Campo>
      </div>

      <div className="mt-3">
        <Campo rotulo="Mensaje" reparo={deCampo('cuerpo')}>
          <textarea
            value={b.cuerpo}
            onChange={(e) => setB({ ...b, cuerpo: e.target.value })}
            rows={6}
            placeholder="Hola {{1}}, te invitamos al Foro de Estado…"
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm"
          />
          <p className="mt-1 flex justify-between text-[11px] text-muted-foreground">
            <span>Las variables se escriben {'{{1}}'}, {'{{2}}'}… y no pueden ir al principio ni al final.</span>
            <span className="tabular-nums">{b.cuerpo.length}/1024</span>
          </p>
        </Campo>
      </div>

      {crear.isError && (
        <p className="mt-3 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
          {crear.error instanceof Error ? crear.error.message : 'Meta rechazó la plantilla.'}
        </p>
      )}
      {crear.isSuccess && (
        <p className="mt-3 rounded-lg bg-success/10 p-2 text-xs font-semibold text-success">
          Creada. Meta la está revisando ({crear.data.estado}) — puede tardar hasta 24 h.
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!listaParaMandar || crear.isPending}
          onClick={() => crear.mutate(b)}
          className="inline-flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
        >
          {crear.isPending && <Loader2 size={13} className="animate-spin" />}
          Mandarla a revisión
        </button>
        {revisar.isPending && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
        {!listaParaMandar && reparos.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {reparos.length} cosa{reparos.length > 1 ? 's' : ''} que Meta va a rechazar
          </span>
        )}
      </div>
    </section>
  );
}

function Campo({
  rotulo,
  reparo,
  children,
}: {
  rotulo: string;
  reparo?: Reparo;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={sectionLabel}>{rotulo}</span>
      {children}
      {/* El reparo va PEGADO al campo y trae su arreglo: un reparo sin salida
          es un reproche. */}
      {reparo && (
        <p className="mt-1 text-[11px] text-destructive">
          <strong>{reparo.problema}</strong> {reparo.arreglo}
        </p>
      )}
    </label>
  );
}
