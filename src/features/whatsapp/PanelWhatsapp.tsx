import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Phone, Plus, QrCode, Users, WifiOff } from 'lucide-react';
import type { LecturaWhatsapp, RespuestaTelefono } from './tipos';
import { particionDe, useCuentasWhatsapp, type CuentaWhatsapp } from './cuentas';

/**
 * WhatsApp Web, adentro de Hermes.
 *
 * ── Por qué embebido y no al lado ──
 * Es el único canal sin API disponible: Messenger, Instagram y los comentarios
 * entran por la Graph API oficial; WhatsApp todavía no (la Cloud API está en
 * trámite). Hasta que salga, la sesión real del vendedor es la única fuente, y
 * tenerla en la misma ventana es lo que permite que la ficha del contacto esté al
 * lado del chat en vez de en otra pantalla.
 *
 * ── Sesiones ──
 * Una partición por cuenta (ver `cuentas.ts`). El QR se escanea una vez y la
 * sesión sobrevive al cierre de la app. Hermes nunca ve ni guarda credenciales:
 * el código lo dibuja WhatsApp adentro del webview y lo escanea un humano.
 */

/**
 * React ya declara el elemento `<webview>`, pero no sus métodos de Electron.
 * `send` es el que importa: es cómo se le pide algo al adaptador de adentro.
 */
type WebviewEl = HTMLElement & {
  send: (canal: string) => void;
  reload: () => void;
};

export default function PanelWhatsapp() {
  const { cuentas, activa, setActivaId, agregar } = useCuentasWhatsapp();

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <SelectorCuentas cuentas={cuentas} activa={activa} onElegir={setActivaId} onAgregar={agregar} />
      {/* La `key` es deliberada: al cambiar de cuenta hay que MONTAR OTRO webview,
          no reusar el mismo con otra partición. Electron fija la partición en la
          creación; cambiarla en caliente no hace nada y dejaría la cuenta anterior
          en pantalla con el nombre de la nueva. */}
      <SesionWhatsapp key={activa.id} cuenta={activa} />
    </div>
  );
}

/** Las cuentas vinculadas en esta máquina. Cambiar de cuenta = cambiar de sesión. */
function SelectorCuentas({
  cuentas,
  activa,
  onElegir,
  onAgregar,
}: {
  cuentas: CuentaWhatsapp[];
  activa: CuentaWhatsapp;
  onElegir: (id: string) => void;
  onAgregar: (nombre: string) => void;
}) {
  const [agregando, setAgregando] = useState(false);
  const [nombre, setNombre] = useState('');

  function confirmar() {
    if (nombre.trim()) onAgregar(nombre);
    setNombre('');
    setAgregando(false);
  }

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/40 px-2 py-1.5">
      {cuentas.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onElegir(c.id)}
          className={
            'rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ' +
            (c.id === activa.id
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-card/60')
          }
        >
          {c.nombre}
        </button>
      ))}

      {agregando ? (
        <input
          autoFocus
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onBlur={confirmar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmar();
            if (e.key === 'Escape') setAgregando(false);
          }}
          placeholder="Nombre de la cuenta"
          className="w-40 rounded-lg border border-border bg-card px-2 py-1 text-xs"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAgregando(true)}
          title="Vincular otro número"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <Plus size={13} />
        </button>
      )}
    </div>
  );
}

/** Una sesión: su webview y la franja que dice quién está del otro lado. */
function SesionWhatsapp({ cuenta }: { cuenta: CuentaWhatsapp }) {
  const ref = useRef<WebviewEl | null>(null);
  const [lectura, setLectura] = useState<LecturaWhatsapp | null>(null);
  const [telefono, setTelefono] = useState<RespuestaTelefono | null>(null);
  const [buscando, setBuscando] = useState(false);

  const adaptador = window.hermes?.adaptadorWhatsapp;

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;

    const alMensaje = (e: Event) => {
      const { channel, args } = e as Event & { channel: string; args: unknown[] };
      if (channel === 'wa:chat') {
        setLectura(args[0] as LecturaWhatsapp);
        // El teléfono pertenece al chat que se estaba mirando. Si cambió el chat,
        // seguir mostrándolo sería atribuirle a alguien el número de otra persona.
        setTelefono(null);
      }
      if (channel === 'wa:telefono') {
        setTelefono(args[0] as RespuestaTelefono);
        setBuscando(false);
      }
    };

    wv.addEventListener('ipc-message', alMensaje);
    return () => wv.removeEventListener('ipc-message', alMensaje);
  }, []);

  function pedirTelefono() {
    setBuscando(true);
    ref.current?.send('wa:pedir-telefono');
  }

  // Fuera de Electron (el `npm run dev` en el navegador) no existe <webview>. Se
  // dice, en vez de renderizar un rectángulo roto.
  if (!adaptador) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
        <p className="max-w-xs text-sm text-muted-foreground">
          WhatsApp solo funciona dentro de la app de escritorio.
          <br />
          Abrila con <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npm run dev:app</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <BarraContacto lectura={lectura} telefono={telefono} buscando={buscando} onPedir={pedirTelefono} />
      <webview
        ref={ref as React.Ref<HTMLElement>}
        src="https://web.whatsapp.com"
        partition={particionDe(cuenta)}
        preload={adaptador}
        className="min-h-0 flex-1"
      />
    </>
  );
}

/**
 * La franja que dice quién está del otro lado.
 *
 * Cada estado se ve DISTINTO a propósito, y los dos que más importan son los que
 * es tentador colapsar en uno solo:
 *
 *   · `sin-sesion` → lo arregla el vendedor, escaneando un QR con su teléfono.
 *   · `lector-offline` → lo arregla un programador, tocando selectores.
 *
 * Si los dos dijeran "algo anda mal", el vendedor esperaría a alguien de sistemas
 * para escanear un código que podía escanear solo.
 */
function BarraContacto({
  lectura,
  telefono,
  buscando,
  onPedir,
}: {
  lectura: LecturaWhatsapp | null;
  telefono: RespuestaTelefono | null;
  buscando: boolean;
  onPedir: () => void;
}) {
  const base = 'flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-2.5 text-xs';

  if (!lectura) {
    return <div className={`${base} text-muted-foreground`}>Conectando con WhatsApp Web…</div>;
  }

  if (lectura.estado === 'sin-sesion') {
    return (
      <div className={`${base} bg-secondary text-secondary-foreground`}>
        <QrCode size={14} className="shrink-0" />
        <span>
          <b>Cuenta sin vincular.</b> Escaneá el código de abajo desde el teléfono: WhatsApp → Ajustes →
          Dispositivos vinculados. Se hace una sola vez.
        </span>
      </div>
    );
  }

  if (lectura.estado === 'lector-offline') {
    return (
      <div className={`${base} bg-destructive/10 text-destructive`}>
        <WifiOff size={14} className="shrink-0" />
        <span>
          <b>Lector fuera de servicio.</b> {lectura.motivo} No confíes en la ficha hasta que vuelva.
        </span>
      </div>
    );
  }

  if (lectura.estado === 'sin-chat') {
    return <div className={`${base} text-muted-foreground`}>Abrí un chat para ver la ficha del contacto.</div>;
  }

  if (lectura.estado === 'grupo') {
    return (
      <div className={`${base} text-muted-foreground`}>
        <Users size={14} className="shrink-0" />
        Es un grupo: no hay un contacto único que registrar.
      </div>
    );
  }

  const numero = telefono?.ok ? telefono.telefonoVisible : lectura.telefonoVisible;

  return (
    <div className={`${base} justify-between`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="truncate font-bold text-foreground">
          {lectura.nombre ?? lectura.telefonoVisible ?? 'Contacto'}
        </span>
        {numero && (
          <span className="flex items-center gap-1 font-semibold tabular-nums text-muted-foreground">
            <Phone size={11} />
            {numero}
          </span>
        )}
        {telefono && !telefono.ok && (
          <span className="flex items-center gap-1 text-destructive">
            <AlertTriangle size={11} />
            {telefono.motivo}
          </span>
        )}
      </div>

      {/* El contacto guardado esconde el número en el panel de info. Se pide a
          pedido y no en cada cambio de chat: abrir paneles solos sobre la sesión
          de alguien que está trabajando es ruido. */}
      {lectura.requiereDrawer && !telefono?.ok && (
        <button
          type="button"
          onClick={onPedir}
          disabled={buscando}
          className="shrink-0 rounded-lg border border-border px-2.5 py-1 font-bold text-primary transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {buscando ? 'Leyendo…' : 'Ver teléfono'}
        </button>
      )}
    </div>
  );
}
