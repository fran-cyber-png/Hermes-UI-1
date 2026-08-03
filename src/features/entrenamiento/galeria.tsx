import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Bot, ShieldCheck, User } from 'lucide-react';
import '../../index.css';
import { queryClient } from '../../lib/datos/cliente';
import { lecturaDeSilencio, type TurnoDePrueba } from './entrenamiento';

/**
 * LA GALERÍA DE LA VISTA DE ENTRENAMIENTO — la evidencia, sin nada vivo detrás.
 *
 * Entry APARTE de Vite (`galeria-entrenamiento.html` en la raíz): **no entra al
 * bundle de la app** —`vite build` toma solo `index.html`— y no habla con ningún
 * server. Se abre a mano:
 *
 *     npx vite --port 5199   →   http://localhost:5199/galeria-entrenamiento.html
 *
 * Existe por la regla dura #2 (nada de UI se reporta listo sin captura) y porque
 * la app real exige login contra Cerberus: sin esto, ver la pantalla obligaría a
 * levantar el server entero apuntando al ERP vivo, que es exactamente lo que no
 * se hace desde el hallazgo del 29-jul. Mismo molde que `galeria-ivi.html`.
 *
 * Los turnos de abajo son los CASOS QUE IMPORTAN, no una conversación bonita:
 * uno donde el bot habla y decide, y uno donde **no habla** — que es el que
 * suele quedar sin dibujar y es el que manda a mirar el freno correcto.
 */

const CONVERSACION: TurnoDePrueba[] = [
  { de: 'persona', texto: 'Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia' },
  {
    de: 'bot',
    texto: 'Hola, te saluda Sofía Rodríguez, asesora comercial de Goberna. Antes de todo, ¿cuál es tu nombre?',
    detalle: {
      estado: 'enviada',
      motivo: null,
      acciones: [],
      modelo: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      tokensEntrada: 4013,
      tokensSalida: 28,
    },
  },
  { de: 'persona', texto: 'Neil. Cuál es el precio?' },
  {
    de: 'bot',
    texto: 'Dame un momento y te paso el precio en tu moneda local para que no tengas sorpresas con el cambio.',
    detalle: {
      estado: 'enviada',
      motivo: null,
      acciones: [
        { tipo: 'registrar_interes', familia: 'DIPICOT' },
        { tipo: 'calificar', temperatura: 'caliente', motivo: 'Preguntó por precio' },
        { tipo: 'mandar_pieza', clase: 'hecho', id: 'precio-peru' },
      ],
      modelo: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      tokensEntrada: 4180,
      tokensSalida: 43,
    },
  },
  // EL CASO QUE IMPORTA: el bot no habló. Se dibuja como información, no como
  // error — es exactamente lo que la persona real habría recibido: nada.
  {
    de: 'bot',
    texto: '',
    detalle: {
      estado: 'bloqueada',
      motivo: 'pausado',
      acciones: [],
      modelo: null,
      tokensEntrada: null,
      tokensSalida: null,
    },
  },
];

function Burbuja({ turno }: { turno: TurnoDePrueba }) {
  const esPersona = turno.de === 'persona';
  const sinTexto = !esPersona && turno.texto.trim() === '';
  return (
    <div className={esPersona ? 'flex justify-end' : 'flex justify-start'}>
      <div className={esPersona ? 'max-w-[80%]' : 'max-w-[85%]'}>
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          {esPersona ? <User className="size-3" /> : <Bot className="size-3" />}
          {esPersona ? 'La persona' : 'El bot'}
        </div>
        {sinTexto ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            {lecturaDeSilencio(turno.detalle!)}
          </p>
        ) : (
          <p
            className={
              esPersona
                ? 'whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                : 'whitespace-pre-wrap rounded-lg border border-border bg-card px-3 py-2 text-sm'
            }
          >
            {turno.texto}
          </p>
        )}
        {turno.detalle && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded border border-border px-1.5 py-0.5">{turno.detalle.estado}</span>
            {(turno.detalle.acciones as { tipo?: string; motivo?: string; familia?: string; id?: string }[]).map(
              (a, i) => (
                <span key={i} className="rounded bg-muted px-1.5 py-0.5">
                  {a.tipo}
                  {a.familia || a.id || a.motivo ? ` · ${a.familia ?? a.id ?? a.motivo}` : ''}
                </span>
              ),
            )}
            {turno.detalle.tokensSalida !== null && (
              <span className="ml-auto tabular-nums">
                {turno.detalle.tokensEntrada ?? 0}→{turno.detalle.tokensSalida} tok
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Galeria() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">Entrenamiento del bot</h1>
          <p className="text-sm text-muted-foreground">
            Escribile como si fueras una persona y mirá qué contesta.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Línea</span>
          <select className="rounded-md border border-border bg-background px-2 py-1 text-sm">
            <option>Bot DIPICOT</option>
          </select>
        </label>
      </header>

      <p className="flex items-center gap-2 border-b border-border bg-muted/40 px-6 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0" />
        Esta conversación no le llega a nadie: el motor corre sin transporte, así que no hay a dónde
        mandar. Tampoco entra al historial con el que se mide al bot.
      </p>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {CONVERSACION.map((t, i) => (
            <Burbuja key={i} turno={t} />
          ))}
        </div>
      </div>

      <div className="border-t border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <textarea
            rows={2}
            defaultValue=""
            placeholder="Escribí como si fueras la persona…"
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">⌘↵ para mandar</span>
            <button className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground opacity-40">
              Mandar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Galeria />
    </QueryClientProvider>
  </StrictMode>,
);
