import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCheck,
  ChevronDown,
  Filter,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  Plus,
  Search,
  Send,
  ShoppingCart,
  Smile,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import "../../index.css";

/**
 * GALERÍA DE LA VISTA MENSAJES COMPLETA — los tres paneles integrados.
 *
 * Entry aparte: galeria-mensajes-completa.html
 *     npx vite --port 5199  →  http://localhost:5199/galeria-mensajes-completa.html
 *
 * El panel derecho es la copia del diseño V2 (rail sin cajas, meta sin card,
 * zona «Por completar», resumen IA colapsable): la galería es la referencia
 * visual de la review — ver docs/plan-correccion-panel-timeline.md.
 */

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Panel derecho — Timeline Inteligente (V2: rail, sin cajas)                */
/* ═══════════════════════════════════════════════════════════════════════════ */

type EstadoEvento = "confirmado" | "manual" | "ia" | "pendiente";
type Acento = "cliente" | "alerta" | "frio" | "neutro";

const COLOR: Record<EstadoEvento, { punto: string; tag: string }> = {
  confirmado: { punto: "bg-success", tag: "" },
  manual:     { punto: "bg-primary", tag: "Manual" },
  ia:         { punto: "bg-warning", tag: "IA" },
  pendiente:  { punto: "border-dashed", tag: "Pendiente" },
};

const BADGE_ACENTO: Record<Acento, string> = {
  cliente: "border-success/30 bg-success/10 text-success",
  alerta:  "border-warning/30 bg-warning/10 text-warning-foreground",
  frio:    "border-temp-frio/30 bg-temp-frio/10 text-temp-frio",
  neutro:  "border-border bg-muted text-muted-foreground",
};

function ParMeta({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="-mx-1 px-1">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="mt-0.5 block truncate text-[13px] font-medium text-foreground">{valor || "—"}</span>
    </div>
  );
}

function Evento({ e, esUltimo }: { e: { rotulo: string; tag?: string; hora: string; valor?: string; estado: EstadoEvento; editable?: boolean }; esUltimo: boolean }) {
  const c = COLOR[e.estado];
  const esIa = e.estado === "ia";
  const esManual = e.estado === "manual" || e.editable;
  return (
    <li className="group/ev relative flex gap-3 py-1.5 pl-1">
      <span aria-hidden className={"relative z-10 mt-1 size-2.5 shrink-0 rounded-full " + (e.estado === "pendiente" ? "border-2 border-dashed border-muted-foreground/40 bg-card" : c.punto)} />
      <span aria-hidden data-ultimo={esUltimo || undefined} className="absolute bottom-[-0.375rem] left-2 top-4 w-px bg-border data-[ultimo]:hidden" />
      <div className="min-w-0 flex-1 pb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-foreground">{e.rotulo}</span>
          {c.tag && <span className="text-[10px] font-semibold uppercase tracking-wide text-warning">{c.tag}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover/ev:opacity-100 group-focus-within/ev:opacity-100">
            {esIa && (
              <button type="button" aria-label="Corregir lo que la IA detectó" className="grid min-h-6 min-w-6 place-items-center rounded-md bg-warning/10 text-warning transition-colors hover:bg-warning/20">
                <Pencil size={12} aria-hidden />
              </button>
            )}
            {esManual && (
              <>
                <button type="button" aria-label="Editar evento" className="grid min-h-6 min-w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <Pencil size={12} aria-hidden />
                </button>
                <button type="button" aria-label="Borrar del timeline" className="grid min-h-6 min-w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 size={12} aria-hidden />
                </button>
              </>
            )}
          </span>
          <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{e.hora}</time>
        </div>
        {e.valor && <p className="mt-0.5 truncate text-xs text-muted-foreground">{e.valor}</p>}
      </div>
    </li>
  );
}

function Encabezado({ iniciales, nombre, telefono, canal, acento, tituloEstado, compras, chips, campos, resumen }: {
  iniciales: string; nombre: string; telefono: string; canal: string;
  acento: Acento; tituloEstado: string; compras: string;
  chips: string[]; campos: [string, string][]; resumen: string | null;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="shrink-0 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-navy font-heading text-[11px] font-bold text-white">{iniciales}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-heading text-[17px] font-bold leading-tight text-foreground">{nombre}</h2>
            <span className={"shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold " + BADGE_ACENTO[acento]}>{tituloEstado}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[11px] text-slate-500">{telefono}{canal ? ` · ${canal}` : ""}</p>
            {compras && <span className="shrink-0 text-[11px] font-semibold text-success">{compras}</span>}
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        {campos.map(([label, valor]) => <ParMeta key={label} label={label} valor={valor} />)}
      </div>
      <div className="mt-2">
        <button
          type="button"
          aria-expanded={abierto}
          aria-label="Mostrar u ocultar resumen"
          onClick={() => setAbierto((a) => !a)}
          className="flex h-7 w-full items-center gap-1.5 text-left"
        >
          <Sparkles size={14} aria-hidden className="shrink-0 text-primary" />
          <span className="text-xs font-semibold text-foreground">Resumen IA</span>
          <ChevronDown size={14} aria-hidden className={"ml-auto shrink-0 text-muted-foreground transition-transform " + (abierto ? "rotate-180" : "")} />
        </button>
        {abierto && resumen && (
          <div className="mt-2 rounded-lg border border-border bg-muted/50 p-3 text-xs leading-relaxed text-foreground">{resumen}</div>
        )}
      </div>
      {chips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{c}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ZonaPendiente({ campos }: { campos: string[] }) {
  return (
    <section aria-label="Por completar" className="mb-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Por completar</h3>
        <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">50%</span>
      </div>
      <ul className="mt-1.5">
        {campos.map((c) => (
          <li key={c} className="flex items-center gap-2 py-0.5">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{c}</span>
            <button type="button" aria-label={`Agregar ${c}`} className="grid min-h-6 min-w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Plus size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Cola izquierda — lista de conversaciones                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface FilaConv {
  iniciales: string;
  nombre: string;
  ultimoMensaje: string;
  hora: string;
  canal: "whatsapp" | "instagram" | "facebook";
  estado?: "cliente" | "frio" | "normal";
  activa?: boolean;
}

const FILAS: FilaConv[] = [
  { iniciales:"LR", nombre:"Lenin Ramirez", ultimoMensaje:"¿Cuánto cuesta la campaña de 3 meses?", hora:"09:15", canal:"whatsapp", estado:"cliente", activa: true },
  { iniciales:"AG", nombre:"Alejandro García", ultimoMensaje:"Quiero saber del diplomado en Ciberseguridad", hora:"08:12", canal:"whatsapp", estado:"cliente" },
  { iniciales:"MC", nombre:"María Castillo", ultimoMensaje:"Me interesa el diplomado", hora:"10:47", canal:"instagram" },
  { iniciales:"JP", nombre:"José Pérez", ultimoMensaje:"Gracias por la información", hora:"Ayer", canal:"whatsapp", estado:"frio" },
  { iniciales:"RV", nombre:"Ricardo Vega", ultimoMensaje:"¿Tienen cursos de marketing político?", hora:"Ayer", canal:"facebook" },
  { iniciales:"CG", nombre:"Carmen Gutiérrez", ultimoMensaje:"Sí, me interesa la consultoría", hora:"28 jul", canal:"whatsapp", estado:"cliente" },
  { iniciales:"LM", nombre:"Luis Mendoza", ultimoMensaje:"¿Cuándo empieza el próximo diplomado?", hora:"27 jul", canal:"whatsapp" },
  { iniciales:"ST", nombre:"Sofía Torres", ultimoMensaje:"Ok, lo reviso y te aviso", hora:"26 jul", canal:"instagram" },
  { iniciales:"DH", nombre:"Diego Huamán", ultimoMensaje:"Imagen", hora:"25 jul", canal:"whatsapp" },
];

function ColaConversaciones({ onSeleccionar }: { onSeleccionar?: (idx: number) => void }) {
  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="shrink-0 border-b border-slate-100 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h1 className="font-heading text-[14px] font-bold text-slate-900">Mensajes</h1>
          <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><Filter size={14} /></button>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
          <Search size={12} className="shrink-0 text-slate-400" />
          <input placeholder="Buscar…" className="w-full bg-transparent text-[12px] text-slate-700 outline-none placeholder:text-slate-400" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {FILAS.map((f, i) => {
          const acento = f.estado === "cliente" ? "border-l-emerald-400" : f.estado === "frio" ? "border-l-amber-400" : f.activa ? "border-l-slate-800" : "border-l-transparent";
          const bg = f.activa ? "bg-slate-50" : "";
          return (
            <button key={i} onClick={() => onSeleccionar?.(i)} className={"flex w-full items-start gap-2 border-l-[3px] px-3 py-2 text-left transition-colors hover:bg-slate-50 " + acento + " " + bg}>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-200 font-heading text-[10px] font-bold text-slate-500">{f.iniciales}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-1.5">
                  <span className="truncate text-[12px] font-semibold text-slate-900">{f.nombre}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{f.hora}</span>
                </div>
                <p className="truncate text-[11px] text-slate-500">{f.ultimoMensaje}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Chat central                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

function ChatCentral() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#efeae2]">
      {/* Header del chat */}
      <div className="shrink-0 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-slate-800 font-heading text-[11px] font-bold text-white">LR</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-slate-900">Lenin Ramirez</span>
            <span className="size-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] text-slate-400">en línea</span>
          </div>
          <p className="text-[10px] text-slate-400">+51 987 654 321</p>
        </div>
        <div className="flex items-center gap-0.5">
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><Phone size={15} /></button>
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><Star size={15} /></button>
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><Pin size={15} /></button>
        </div>
      </div>

      {/* Burbujas */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
          {/* Entrantes */}
          <div className="flex items-end gap-2">
            <div className="max-w-[75%] rounded-lg rounded-bl-none bg-white px-3 py-2 shadow-sm">
              <p className="text-[13px] leading-relaxed text-slate-800">Hola, quiero información sobre la consultoría política</p>
              <span className="mt-1 block text-right text-[10px] text-slate-400">14:22</span>
            </div>
          </div>
          {/* Saliente */}
          <div className="flex items-end gap-2 self-end">
            <div className="max-w-[75%] rounded-lg rounded-br-none bg-[#d9fdd3] px-3 py-2 shadow-sm">
              <p className="text-[13px] leading-relaxed text-slate-800">¡Hola Lenin! Claro, te cuento. Tenemos dos modalidades: consultoría integral que incluye campaña, estrategia y vocería, y consultoría táctica solo para campaña. ¿Cuál te interesa más?</p>
              <span className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400"><CheckCheck size={11} className="text-sky-500" />14:24</span>
            </div>
          </div>
          {/* Entrante */}
          <div className="flex items-end gap-2">
            <div className="max-w-[75%] rounded-lg rounded-bl-none bg-white px-3 py-2 shadow-sm">
              <p className="text-[13px] leading-relaxed text-slate-800">Me interesa la campaña de 3 meses. ¿Cuánto cuesta?</p>
              <span className="mt-1 block text-right text-[10px] text-slate-400">09:15</span>
            </div>
          </div>
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-end gap-2">
          <button className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Smile size={18} /></button>
          <button className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Paperclip size={18} /></button>
          <div className="min-h-[38px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-[13px] text-slate-400">Escribí un mensaje…</span>
          </div>
          <button className="shrink-0 rounded-xl bg-slate-800 p-2 text-white hover:bg-slate-900"><Send size={16} /></button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Panel derecho — Timeline completo                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

function PanelTimeline() {
  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-white">
      <Encabezado
        iniciales="LR" nombre="Lenin Ramirez" telefono="+51 987 654 321" canal="WhatsApp"
        acento="cliente" tituloEstado="Cliente" compras="2 compras · S/ 7 200"
        chips={["VIP"]}
        campos={[
          ["Origen", "Meta Ads"],
          ["Campaña", "Diplomados 2026"],
          ["Primer contacto", "28 jul · 14:22"],
          ["Asignada", "—"],
        ]}
        resumen="Lenin llegó por el anuncio de julio, preguntó precio tres veces y ya compró la consultoría Premium."
      />

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
        <div className="px-4 py-2.5">
          <ZonaPendiente campos={["País", "Presupuesto"]} />

          <h3 className="text-xs font-semibold text-muted-foreground">Timeline</h3>
          <ol className="mt-1">
            <li>
              <h4 className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Hoy</h4>
              <ol className="mt-0.5">
                <Evento e={{ rotulo: "Preguntó precio", hora: "09:15", valor: "¿Cuánto cuesta la campaña de 3 meses?", estado: "confirmado" }} esUltimo={false} />
                <Evento e={{ rotulo: "Enfriamiento", tag: "IA", hora: "09:16", valor: "Sin respuesta desde hace 1 día", estado: "ia" }} esUltimo={true} />
              </ol>
            </li>
            <li>
              <h4 className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ayer</h4>
              <ol className="mt-0.5">
                <Evento e={{ rotulo: "Compra", hora: "18:02", valor: "S/ 4 800 · Consultoría Política Premium", estado: "confirmado" }} esUltimo={true} />
              </ol>
            </li>
            <li>
              <h4 className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">28 jul</h4>
              <ol className="mt-0.5">
                <Evento e={{ rotulo: "Llegó desde anuncio", hora: "14:22", valor: "Campaña [JUL] Consultoría LATAM", estado: "confirmado", editable: true }} esUltimo={false} />
                <Evento e={{ rotulo: "Nombre identificado", hora: "14:22", valor: "Lenin Ramirez", estado: "confirmado", editable: true }} esUltimo={false} />
                <Evento e={{ rotulo: "Primer mensaje", hora: "14:23", valor: "Hola, quiero información sobre la consultoría política", estado: "confirmado", editable: true }} esUltimo={false} />
                <Evento e={{ rotulo: "Interés detectado", tag: "IA", hora: "14:24", valor: "Consultoría Política", estado: "ia" }} esUltimo={false} />
                <Evento e={{ rotulo: "Producto registrado", tag: "Manual", hora: "14:30", valor: "Consultoría Política Premium", estado: "manual", editable: true }} esUltimo={true} />
              </ol>
            </li>
          </ol>
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-4 py-3">
        <button className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-[background-color,transform] hover:bg-primary-hover active:scale-[0.99]">
          <ShoppingCart size={15} aria-hidden /> Registrar venta
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Vista completa                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

function MensajesCompleta() {
  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <div className="flex h-10 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4">
        <span className="font-heading text-[13px] font-bold text-slate-900">Hermes</span>
        <div className="flex items-center gap-1">
          <button className="rounded-md px-2.5 py-1 text-[12px] font-medium text-slate-500 hover:text-slate-700">Dashboard</button>
          <button className="rounded-md bg-slate-100 px-2.5 py-1 text-[12px] font-bold text-slate-700">Mensajes</button>
          <button className="rounded-md px-2.5 py-1 text-[12px] font-medium text-slate-500 hover:text-slate-700">Contactos</button>
          <button className="rounded-md px-2.5 py-1 text-[12px] font-medium text-slate-500 hover:text-slate-700">Agenda</button>
        </div>
        <div className="ml-auto grid size-7 place-items-center rounded-lg bg-slate-800 font-heading text-[10px] font-bold text-white">A</div>
      </div>
      <div className="min-h-0 flex-1">
        <div className="flex h-full">
          <ColaConversaciones />
          <ChatCentral />
          <PanelTimeline />
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById("galeria");
if (root) createRoot(root).render(<StrictMode><MensajesCompleta /></StrictMode>);
