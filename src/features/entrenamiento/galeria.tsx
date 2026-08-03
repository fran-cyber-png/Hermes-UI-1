import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Bot, ShieldCheck, User } from 'lucide-react';
import '../../index.css';
import { queryClient } from '../../lib/datos/cliente';
import { lecturaDeSilencio, type TurnoDePrueba } from './entrenamiento';
import {
  compararRespuesta,
  LECTURA_CAMBIO,
  resumirCorrida,
  type Cambio,
  type RespuestaDeCorrida,
  compararReglas,
  ROTULO_REGLA,
} from './corridas';

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

/**
 * El diff de una Corrida (#257). Los cuatro casos que importan, y sobre todo el
 * que un `===` a secas escondería: que el bot **deje de hablar** donde antes
 * hablaba. Mezclarlo en «cambió» haría que una regla que enmudece al bot se vea
 * igual que una que lo mejora.
 */
const DIFF: RespuestaDeCorrida[] = [
  {
    id: 1,
    clave: 'conv:whatsapp:51986993401:51984429504',
    textoOriginal: 'Hola, soy Kathy Alva, asesora académica de Goberna. ¿Cuál es tu nombre?',
    estadoOriginal: 'enviada',
    texto: 'Hola, te saluda Sofía Rodríguez, asesora comercial de Goberna. Antes de todo, ¿cuál es tu nombre?',
    estado: 'enviada',
    motivo: null,
    acciones: [],
  },
  {
    id: 2,
    clave: 'conv:whatsapp:51966628980:51984429504',
    textoOriginal:
      'El precio regular es de $199 USD y hoy está en promoción a $150 USD. Decile SOLO el precio de SU país, que viene en <contacto>: Perú S/ 500 · México $2,800…',
    estadoOriginal: 'enviada',
    texto: 'Dame un momento y te paso el precio en tu moneda local para que no tengas sorpresas con el cambio.',
    estado: 'enviada',
    motivo: null,
    acciones: [],
  },
  {
    id: 3,
    clave: 'conv:whatsapp:51946497307:51984429504',
    textoOriginal: 'Entiendo que te interesa saber sobre la primera conferencia internacional…',
    estadoOriginal: 'enviada',
    texto: null,
    estado: 'bloqueada',
    motivo: 'sin_respuesta_en_catalogo',
    acciones: [],
  },
  {
    id: 4,
    clave: 'conv:whatsapp:51902801736:51984429504',
    textoOriginal: 'Perfecto. ¿Hay algo específico del diploma que quieras saber?',
    estadoOriginal: 'enviada',
    texto: 'Perfecto. ¿Hay algo específico del diploma que quieras saber?',
    estado: 'enviada',
    motivo: null,
    acciones: [],
  },
];

const COLOR_CAMBIO: Record<Cambio, string> = {
  igual: 'text-muted-foreground',
  cambio: 'text-foreground',
  'ahora-calla': 'text-destructive',
  'antes-callaba': 'text-foreground',
  'sin-datos': 'text-muted-foreground',
};

const CONTEO_REGLAS = {
  antes: { identidad: 39, pregunta_pais: 9, anuncia_otra_persona: 3, cifra_de_precio: 0, dice_ser_bot: 0, sede_inexistente: 1 },
  ahora: { identidad: 0, pregunta_pais: 1, anuncia_otra_persona: 0, cifra_de_precio: 2, dice_ser_bot: 0, sede_inexistente: 0 },
};

function GaleriaCorridas() {
  const resumen = resumirCorrida(DIFF);
  const cambios = compararReglas(CONTEO_REGLAS);
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Entrenamiento del bot</h1>
        <p className="text-sm text-muted-foreground">Corridas sobre conversaciones reales</p>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* El veredicto de las reglas ARRIBA: es la lectura de la Corrida. */}
        <div className="mb-5 rounded-md border border-border">
          <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
            Reglas duras — antes → ahora
          </div>
          <ul className="divide-y divide-border">
            {cambios.map((c) => (
              <li key={c.regla} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span>{ROTULO_REGLA[c.regla]}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {c.antes} → {c.ahora}
                </span>
                <span
                  className={`w-16 text-right font-medium tabular-nums ${
                    c.delta > 0
                      ? 'text-destructive'
                      : c.delta < 0
                        ? 'text-emerald-600'
                        : 'text-muted-foreground'
                  }`}
                >
                  {c.delta > 0 ? `+${c.delta}` : c.delta === 0 ? '=' : c.delta}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mb-5 flex flex-wrap gap-2 text-xs">
          {(Object.keys(resumen) as Cambio[])
            .filter((k) => resumen[k] > 0)
            .map((k) => (
              <span key={k} className={`rounded border border-border px-2 py-1 ${COLOR_CAMBIO[k]}`}>
                {LECTURA_CAMBIO[k]}: <strong className="tabular-nums">{resumen[k]}</strong>
              </span>
            ))}
          <span className="ml-auto text-muted-foreground">4 conversaciones · ~US$0.01</span>
        </div>
        <div className="flex flex-col gap-5">
          {DIFF.map((r) => {
            const cambio = compararRespuesta(r);
            return (
              <div key={r.id} className="rounded-lg border border-border">
                <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
                  <span className={COLOR_CAMBIO[cambio]}>{LECTURA_CAMBIO[cambio]}</span>
                  <span className="ml-auto font-mono text-muted-foreground">
                    {r.clave.split(':')[2]}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2">
                  <div className="bg-card px-3 py-2">
                    <div className="mb-1 text-xs text-muted-foreground">Dijo entonces</div>
                    <p className="whitespace-pre-wrap text-sm">{r.textoOriginal}</p>
                  </div>
                  <div className="bg-card px-3 py-2">
                    <div className="mb-1 text-xs text-muted-foreground">Diría ahora</div>
                    <p className="whitespace-pre-wrap text-sm">
                      {r.texto ?? (
                        <span className="text-muted-foreground">— no habla — ({r.motivo})</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GaleriaLecciones() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Entrenamiento del bot</h1>
        <p className="text-sm text-muted-foreground">Lecciones</p>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <div className="rounded-md border border-border p-4">
            <h2 className="mb-1 text-sm font-medium">Enseñarle algo</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Queda en borrador: el bot no la lleva puesta hasta que la publiques. Probala antes con una corrida.
            </p>
            <textarea rows={2} defaultValue="" placeholder="Cuando pregunten por la fecha de inicio, decí el día exacto y no «en agosto»." className="mb-2 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm" />
            <input defaultValue="" placeholder="Por qué: qué le viste hacer" className="mb-3 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm" />
            <button className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground opacity-40">Guardar como borrador</button>
          </div>
          <div className="rounded-md border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
              <span className="rounded border border-dashed border-border px-1.5 py-0.5">Borrador — el bot no la ve</span>
              <span className="ml-auto text-muted-foreground">escrita por estephano</span>
            </div>
            <div className="px-3 py-2">
              <p className="text-sm">Cuando pregunten si es presencial, aclara que es 100% virtual ANTES de ofrecer el temario.</p>
              <p className="mt-1 text-xs text-muted-foreground">Se le vio mandar el temario a alguien que preguntaba por la modalidad.</p>
            </div>
            <div className="flex items-center gap-2 border-t border-border px-3 py-2">
              <span className="text-amber-600">⚠</span>
              <span className="text-sm">El bot va a llevar esto puesto en todas sus conversaciones. ¿Seguro?</span>
              <button className="ml-auto rounded-md bg-primary px-2.5 py-1 text-sm text-primary-foreground">Sí, publicar</button>
              <button className="rounded-md border border-border px-2.5 py-1 text-sm">No</button>
            </div>
          </div>
          <div className="rounded-md border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
              <span className="rounded bg-emerald-600/10 px-1.5 py-0.5 text-emerald-700">El bot la lleva puesta</span>
              <span className="ml-auto text-muted-foreground">publicada por estephano</span>
            </div>
            <div className="px-3 py-2">
              <p className="text-sm">No repitas el saludo si ya te presentaste en la conversación.</p>
            </div>
            <div className="flex items-center gap-2 border-t border-border px-3 py-2">
              <button className="rounded-md border border-border px-2.5 py-1 text-sm">Retirar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GaleriaAgujeros() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Entrenamiento del bot</h1>
        <p className="text-sm text-muted-foreground">Qué no supo</p>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <div>
            <h2 className="text-sm font-medium">Lo que no supo contestar</h2>
            <p className="text-xs text-muted-foreground">Cada vez que el bot escala porque le falta un dato, queda anotado acá. Son 2 huecos del catálogo y 1 donde el que sobra es el escalado.</p>
          </div>
          <div className="rounded-md border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
              <span className="text-amber-700">No tenía el dato: falta en el catálogo</span>
              <span className="ml-auto font-mono text-muted-foreground">51946497307</span>
            </div>
            <div className="px-3 py-2">
              <p className="text-sm font-medium">La primera conferencia internacional</p>
              <p className="pl-0 text-xs text-muted-foreground">Contestó: «Entiendo que te interesa saber sobre la primera conferencia internacional…»</p>
            </div>
            <div className="border-t border-border px-3 py-2">
              <button className="rounded-md border border-border px-2.5 py-1 text-sm">Enseñarle esto</button>
            </div>
          </div>
          <div className="rounded-md border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
              <span className="text-amber-700">No tenía el dato: falta en el catálogo</span>
              <span className="ml-auto font-mono text-muted-foreground">5213921662088</span>
            </div>
            <div className="px-3 py-2">
              <p className="text-sm font-medium">Ya me habían mandado información</p>
            </div>
            <div className="border-t border-border px-3 py-2">
              <div className="flex flex-col gap-2">
                <textarea rows={2} defaultValue="" placeholder="El dato que le faltaba, tal como querés que lo diga." className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Queda en borrador: probalo con una corrida antes de publicarlo.</span>
                  <button className="ml-auto rounded-md bg-primary px-2.5 py-1 text-sm text-primary-foreground">Guardar borrador</button>
                  <button className="rounded-md border border-border px-2.5 py-1 text-sm">Cancelar</button>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-md border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">Contestó y escaló igual: el que sobra es el escalado, no el dato</span>
              <span className="ml-auto font-mono text-muted-foreground">51966172067</span>
            </div>
            <div className="px-3 py-2">
              <p className="text-sm font-medium">Horarios del curso.  PRESENCIAL</p>
              <p className="text-xs text-muted-foreground">Contestó: «Te aclaro que el diplomado es 100% virtual: clases en vivo por Zoom.»</p>
            </div>
            <div className="border-t border-border px-3 py-2">
              <button className="rounded-md border border-border px-2.5 py-1 text-sm">Enseñarle esto</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Galeria() {
  const q = new URLSearchParams(location.search);
  if (q.get('agujeros') === '1') return <GaleriaAgujeros />;
  if (q.get('lecciones') === '1') return <GaleriaLecciones />;
  if (q.get('corridas') === '1') {
    return <GaleriaCorridas />;
  }
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
