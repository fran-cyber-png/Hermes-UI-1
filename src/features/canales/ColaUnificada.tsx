import { useMemo, useState } from 'react';
import { MessageSquarePlus, Search, X } from 'lucide-react';
import { useLocalStorage } from '../../lib/useLocalStorage';
import { useSesionWa } from '../whatsapp/conversacionWa';
import type { Intencion } from './types';
import { useConversaciones, type Conversacion } from './conversaciones';
import { FilaConversacion } from './FilaConversacion';

const FILTROS: { valor: Intencion; label: string; vacio: string }[] = [
  { valor: 'puedo-escribirle', label: 'Les puedo escribir', vacio: 'Nadie tiene la ventana abierta ahora mismo. Estás al día.' },
  { valor: 'pide-info', label: 'Piden info', vacio: 'Nadie pidió información todavía.' },
  { valor: '', label: 'Todo', vacio: 'No entró nada por ningún canal.' },
];

/**
 * LA COLA UNIFICADA — el corazón de Hermes.
 *
 * Una sola lista con los cuatro canales mezclados (comentarios FB/IG, DMs de
 * Messenger, chats de WhatsApp), ordenada por el servidor según la urgencia de
 * dos niveles: primero lo que EXPIRA (ventana de Meta), después lo que ESPERA
 * (mensajes sin responder), y al final el resto. El canal es una insignia, no una
 * columna: nadie decide a quién responder según por dónde le escribieron.
 *
 * Sucede a `Bandeja`: mismo esqueleto (filtros por intención, "Ver más", vacíos
 * honestos) pero contra `/api/conversaciones` — una fila por conversación.
 */
export function ColaUnificada({
  seleccionada,
  onSeleccionar,
}: {
  seleccionada: string | null;
  onSeleccionar: (c: Conversacion) => void;
}) {
  const [intencion, setIntencion] = useLocalStorage<Intencion>('hermes.colaFiltro', 'puedo-escribirle');
  const { items, total, hayMas, cargando, cargandoMas, cargarMas } = useConversaciones(intencion);
  const filtro = FILTROS.find((f) => f.valor === intencion) ?? FILTROS[0];

  // Búsqueda: filtra lo YA cargado (nombre, teléfono, texto). Si no aparece,
  // "Ver más" trae más historia — honesto: busca en lo que hay, no en toda la base.
  const [busqueda, setBusqueda] = useState('');
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) =>
      [c.persona_nombre, c.persona_id, c.texto, c.contexto_texto].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [items, busqueda]);

  // Chat nuevo: hablarle a alguien que NO está en la cola (un lead de landing
  // con teléfono, un referido). Abre el hilo vacío; el envío sigue pasando por
  // EnvioControlado — esto no manda nada solo.
  const { data: sesion } = useSesionWa();
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [nuevoTel, setNuevoTel] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const conectado = sesion?.estado === 'conectado';

  function abrirChatNuevo() {
    const tel = nuevoTel.replace(/\D/g, '');
    if (tel.length < 8 || sesion?.estado !== 'conectado') return;
    const numeroPropio = sesion.telefono;
    onSeleccionar({
      clave: `conv:whatsapp:${tel}:${numeroPropio}`,
      canal: 'whatsapp',
      tipo: 'mensaje',
      persona_id: tel,
      persona_nombre: nuevoNombre.trim() || null,
      numero_propio: numeroPropio,
      texto: null,
      contexto_texto: null,
      respondida: false,
      ventana_abierta: false,
      pide_info: false,
      n: 0,
      referencia: new Date().toISOString(),
      ultimo_at: new Date().toISOString(),
      dias: 0,
      nivel: 2,
    });
    setNuevoAbierto(false);
    setNuevoTel('');
    setNuevoNombre('');
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
      <div className="shrink-0 border-b border-border p-2">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1.5 transition-all focus-within:border-primary focus-within:bg-card">
            <Search size={13} className="shrink-0 text-muted-foreground" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar nombre, teléfono o texto…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            {busqueda && (
              <button type="button" onClick={() => setBusqueda('')} className="text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>
          <button
            type="button"
            title={conectado ? 'Chat nuevo (a un número que no está en la cola)' : 'WhatsApp no está conectado'}
            disabled={!conectado}
            onClick={() => setNuevoAbierto((v) => !v)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_2px_10px_-2px_rgba(37,99,235,0.5)] transition-all hover:bg-primary-hover active:scale-[0.95] disabled:opacity-40 disabled:shadow-none"
          >
            <MessageSquarePlus size={15} />
          </button>
        </div>

        {nuevoAbierto && (
          <div className="mt-2 rounded-xl border border-border bg-muted/30 p-2">
            <div className="flex gap-1.5">
              <input
                value={nuevoTel}
                onChange={(e) => setNuevoTel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && abrirChatNuevo()}
                autoFocus
                inputMode="tel"
                placeholder="Teléfono con país, ej. 51 986…"
                className="w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 font-mono text-xs outline-none focus:border-primary placeholder:font-sans"
              />
              <input
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && abrirChatNuevo()}
                placeholder="Nombre (opcional)"
                className="w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={abrirChatNuevo}
                disabled={nuevoTel.replace(/\D/g, '').length < 8}
                className="rounded-lg bg-navy px-3 text-xs font-bold text-white transition-all hover:bg-navy/90 active:scale-[0.97] disabled:opacity-40"
              >
                Abrir
              </button>
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">
              Abre el hilo vacío. El mensaje lo escribís vos — nada sale solo.
            </p>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-2">
        <div className="flex gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setIntencion(f.valor)}
              className={
                'rounded-md px-2.5 py-1 text-xs font-bold transition-colors ' +
                (intencion === f.valor ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        {!cargando && total > 0 && (
          <span className="pr-1 text-xs font-semibold tabular-nums text-muted-foreground">
            {total.toLocaleString('es')}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {cargando ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : visibles.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            {busqueda ? 'Nada matchea en lo cargado. “Ver más” trae más historia.' : filtro.vacio}
          </p>
        ) : (
          <>
            {visibles.map((c) => (
              <FilaConversacion
                key={c.clave}
                c={c}
                seleccionada={seleccionada === c.clave}
                onAbrir={onSeleccionar}
              />
            ))}
            {hayMas && (
              <div className="p-3">
                <button
                  type="button"
                  onClick={cargarMas}
                  disabled={cargandoMas}
                  className="w-full rounded-lg border border-border py-2 text-xs font-bold text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                >
                  {cargandoMas ? 'Cargando…' : 'Ver más'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
