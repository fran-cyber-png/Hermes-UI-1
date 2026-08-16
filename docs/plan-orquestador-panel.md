# Orquestador — Panel funcional completo

> ⚠️ **Al 16-ago-2026:** el panel se corrigió por `docs/plan-correccion-panel-timeline.md` y los
> nombres de acá quedaron viejos. Lo que este plan llama `BarraMetaContacto` se construyó como
> `src/features/panel/BloqueMeta.tsx` (definition list, sin card). La **Fase 3 no se hizo**: no
> existe ninguna hoja de sugerencias, y `src/features/sugerencias/DosRespuestas.tsx` y
> `src/features/hechos/BloqueHechos.tsx` siguen sin un solo consumidor.

> **Rol:** este documento es el prompt del orquestador. No toca código directamente.
> Delega cada tarea a un subagente con el contexto preciso, verifica resultados,
> y coordina las dependencias entre fases.
>
> **Repositorio:** `/Users/milaa/goberna/hermes`
> **Stack:** React 19 + Tailwind 4 + TanStack Query + TypeScript (strict)
> **Idioma:** español

---

## 0. Estado actual

El panel derecho (`PanelDerecho.tsx`, 134 líneas) pinta datos reales de 5 fuentes pero ninguna
acción funciona. El resultado: la vendedora ve información correcta pero no puede hacer nada con
ella.

### Lo que SÍ funciona

| Componente | Estado |
|---|---|
| `EncabezadoTimeline` — avatar, nombre, teléfono, estado, Meta bar, chips | ✅ Renderiza con datos reales |
| `EventoLinea` / `LineaPendiente` — timeline de eventos | ✅ Renderiza con datos reales |
| `BarraMetaContacto` — barra horizontal icono+dato (hoy `src/features/panel/BloqueMeta.tsx`) | ✅ Renderiza, carga skeleton |
| `estadoDelContacto` / `nombreDelContacto` / `ensamblarTimeline` (puros) | ✅ 45+ tests pasan |

### Lo que NO funciona (6 issues críticos)

| # | Issue | Causa raíz |
|---|---|---|
| C1 | Botón "Registrar venta" no hace nada | `onAccion={() => {}}` en `PanelDerecho:131` |
| C2 | Botón "Marcar como interesado" no hace nada | Ídem |
| C3 | Contactos con tono `'alto'` no tienen footer | `PieAccionTimeline` solo maneja `cliente` y `nuevo` |
| C4 | `onCorreo` y `onAgendarBienvenida` descartados | PanelDerecho los recibe como `_onCorreo`, `_onAgendarBienvenida` |
| C5 | Meta bar: 4 bloques no son clickeables | `onOrigenClick` etc. se aceptan como props pero nunca se pasan |
| C6 | Resumen IA es un string hardcodeado | `PanelDerecho:116` |

---

## 1. Arquitectura — lo que el orquestador necesita saber

### Flujo de datos en PanelDerecho

```
App.tsx
├── useSesion() → { vendedora: { id, nombre }, ... }
├── mandarCorreoA(para) → setPuente({ tipo:'correo', para }) + cambiarVista('correos')
├── agendarBienvenida(telefono) → setPuente({ tipo:'agenda', telefono, nota:'Bienvenida al curso' })
│
└── <PanelDerecho
      conversacion={abierta}
      onCorreo={mandarCorreoA}
      onAgendarBienvenida={agendarBienvenida}
    />
```

**PanelDerecho** recibe `onCorreo` y `onAgendarBienvenida` pero **los descarta** (prefijo `_`).

### Funciones puras ya existentes (usarlas, no reescribirlas)

| Módulo | Exporta | Tests |
|---|---|---|
| `panel/estadoContacto.ts` | `estadoDelContacto(datos) → EstadoContacto` | 17 tests |
| `panel/identidad.ts` | `nombreDelContacto(datos) → { principal, alias, fuente }` | 7 tests |
| `panel/timeline.ts` | `ensamblarTimeline(datos) → { eventos, pendientes, progreso }` | 11 tests |
| `panel/resumenInteres.ts` | `resumirIntereses(lista) → string` (una línea) | 6 tests |
| `panel/pestanas.ts` | `pestanasDe(canal)`, `pestanaInicial()` | 6 tests |

### Hooks de datos ya existentes

| Hook | Query key | Endpoint | Timeout |
|---|---|---|---|
| `useFicha(telefono, activo)` | `['ficha', telefono]` | `GET /api/contactos/ficha` | 12s, retry:false |
| `useLeadForm(telefono, activo)` | `['lead-form', telefono]` | `GET /api/contactos/lead` | default |
| `useSenales([clave])` | `['senales', ...]` | `GET /api/senales` | staleTime: 60s |
| `useIntereses(clave)` | `['intereses', clave]` | `GET /api/gestiones/intereses` | default |
| `useSugerencias(clave, nombre, activo)` | `['sugerencias', clave]` | `GET /api/sugerencias` | 12s, retry:false |
| `useHechos(clave, activo)` | `['hechos', clave]` | `GET /api/hechos` | 12s, retry:false |

### Componentes existentes que están fuera del panel

| Componente | Archivo | Qué hace |
|---|---|---|
| `FormularioVenta` | `venta/FormularioVenta.tsx` | Modal de venta: necesita `clienteId`, `clienteNombre`, `telefono`, `canal`, `clave?`, `numeroPropio?`, `onAgendarBienvenida?`, `onCerrar` |
| `DosRespuestas` | `sugerencias/DosRespuestas.tsx` | 2 secuencias sugeridas con botón Enviar |
| `BloqueHechos` | `hechos/BloqueHechos.tsx` | Hasta 3 datos recomendados, click → composer |

### Puente (cross-view communication)

```ts
type Puente =
  | { tipo: 'chat'; telefono: string }
  | { tipo: 'persona'; telefono: string }
  | { tipo: 'correo'; para: string }
  | { tipo: 'agenda'; telefono: string | null; nota?: string };
```

App.tsx tiene `const [puente, setPuente] = useState<Puente | null>(null)`.

### Convenciones del repo

- **TypeScript strict**: `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`
- **Imports**: type-only con `import type { ... }`
- **CSS**: `text-[15px]` para tamaños custom, `text-xs` = 12px, `text-sm` = 14px
- **Colores**: `text-slate-500` (#64748B), `text-slate-800` (casi negro), `text-slate-400` (iconos)
- **Tailwind v4**: usa `@theme inline` en `index.css`, border-color con `border-border/60`
- **No comentarios** nuevos innecesarios
- **Tests**: `npm test` (vitest), typecheck: `npx tsc --noEmit -p tsconfig.app.json`

---

## 2. Fase 1 — Acciones del footer (P0)

> **Objetivo:** que los botones del pie del panel funcionen.
> **Dependencias:** ninguna. Son independientes entre sí.
> **Verificación:** `npx tsc --noEmit -p tsconfig.app.json` + `npx vitest run src/features/panel/`

---

### Tarea 1.1 — Conectar "Registrar venta"

**Archivos a tocar:**
- `src/features/panel/PanelDerecho.tsx` — pasar `onAccion` real
- `src/App.tsx` — agregar estado para el modal de venta + pasarlo como prop

**Agente:** `general`

**Contexto preciso para el agente:**

```
TAREA: Conectar el botón "Registrar venta" de PieAccionTimeline a FormularioVenta.

ARCHIVOS CLAVE (leer completos antes de tocar nada):
- src/features/panel/PanelDerecho.tsx
- src/features/panel/PieAccionTimeline.tsx
- src/features/venta/FormularioVenta.tsx
- src/App.tsx (líneas 174-195: estado, 396-404: mandarCorreoA/agendarBienvenida, 578-595: PanelDerecho)

LO QUE HAY QUE HACER:

1. En App.tsx, agregar un nuevo estado:
   const [ventaAbierta, setVentaAbierta] = useState<{
     clienteId: number;
     clienteNombre: string;
     telefono: string;
     canal: string;
     clave?: string | null;
     numeroPropio?: string | null;
   } | null>(null);

2. Crear una función `abrirVenta(datos)` que setea ventaAbierta.

3. Pasar `abrirVenta` como prop nueva a PanelDerecho:
   interface PanelDerechoProps agregar: `onRegistrarVenta?: (datos: {...}) => void`

4. En PanelDerecho, en el `onAccion` de PieAccionTimeline (línea 131), llamar a la prop nueva.
   Para el estado 'cliente': necesitás fichaDeCliente con clienteId, clienteNombre, telefono.
   La función `fichaDeCliente(ficha.data)` ya existe en PanelDerecho (línea 15-16).
   El `clienteId` sale de `cliente?.id`, `clienteNombre` de `cliente?.nombre`.

5. En App.tsx, renderizar FormularioVenta cuando ventaAbierta tenga datos:
   {ventaAbierta && (
     <FormularioVenta
       clienteId={ventaAbierta.clienteId}
       clienteNombre={ventaAbierta.clienteNombre}
       telefono={ventaAbierta.telefono}
       canal={ventaAbierta.canal}
       clave={ventaAbierta.clave}
       numeroPropio={ventaAbierta.numeroPropio}
       onAgendarBienvenida={agendarBienvenida}
       onCerrar={() => setVentaAbierta(null)}
     />
   )}

6. En PanelDerecho, para el caso 'cliente': solo abrir venta si hay fichaDeCliente.
   Si `cliente` es null, no llamar a onRegistrarVenta (el botón no debería mostrarse,
   PieAccionTimeline ya maneja esto con estado.tono === 'cliente').

RESTRICCIONES:
- No cambiar la interfaz de FormularioVenta
- No tocar PieAccionTimeline.tsx (ya recibe onAccion, solo falta pasarlo)
- El typecheck debe pasar SIN errores
- No agregar comentarios nuevos

VERIFICACIÓN:
- npx tsc --noEmit -p tsconfig.app.json
- npx vitest run src/features/panel/
```

---

### Tarea 1.2 — Conectar "Marcar como interesado"

**Archivos a tocar:**
- `src/features/panel/PanelDerecho.tsx` — pasar `onAccion` real

**Agente:** `general`

**Contexto preciso para el agente:**

```
TAREA: Conectar el botón "Marcar como interesado" de PieAccionTimeline para que
registre un interés derivado de la campaña del lead.

ARCHIVOS CLAVE:
- src/features/panel/PanelDerecho.tsx (línea 131: onAccion actual)
- src/features/gestion/Intereses.tsx (hook useIntereses + POST /api/gestiones/intereses/derivado)
- server/src/cursos/precedencia.ts (determina el curso desde la campaña; la precedencia
  vive en el SERVER, nunca hubo copia en src/features/cursos/)

LO QUE HAY QUE HACER:

1. En PanelDerecho, crear una función `marcarInteresado` que:
   - Tome el interés derivado de `intereses?.propuesta` (devuelto por useIntereses)
   - Si existe propuesta.curso, hacer POST a /api/gestiones/intereses/derivado
   - Pista: el hook useIntereses ya devuelve `propuesta` con `{ curso, fuente, familia }`
   - Usar `useMutation` de TanStack Query para el POST
   - Tras éxito, invalidar la query de intereses: `queryClient.invalidateQueries({ queryKey: ['intereses', conversacion.clave] })`

2. Pasar `marcarInteresado` como `onAccion` en PieAccionTimeline para el caso 'nuevo'.

3. Para el caso 'alto' (que actualmente no tiene footer), agregar el mismo botón
   "Marcar como interesado" en PieAccionTimeline. Para esto:

   EN PieAccionTimeline.tsx:
   - Agregar un caso para `estado.tono === 'alto'` que muestre el mismo botón
     que 'nuevo' ("Marcar como interesado" con icono Sparkles)
   - 'alto' no está en el tipo TonoContacto — mapearEstado en PanelDerecho lo
     convierte de cualquier tono no-cliente con intereses/padrón.
   - Solución más limpia: PieAccionTimeline recibe un enum extendido, o
     simplemente agregar el caso 'alto' al switch.

RESTRICCIONES:
- Usar la API existente de useIntereses (ya tiene el POST para derivados)
- No crear nuevos endpoints
- No tocar el hook useIntereses (ya funciona)

VERIFICACIÓN:
- npx tsc --noEmit -p tsconfig.app.json
- npx vitest run src/features/panel/
```

---

### Tarea 1.3 — Conectar onCorreo y onAgendarBienvenida

**Archivos a tocar:**
- `src/features/panel/PanelDerecho.tsx` — usar los callbacks en vez de descartarlos

**Agente:** `general`

**Contexto preciso para el agente:**

```
TAREA: Conectar los callbacks onCorreo y onAgendarBienvenida que App.tsx ya pasa
pero PanelDerecho descarta con el prefijo _.

ARCHIVOS CLAVE:
- src/features/panel/PanelDerecho.tsx (líneas 35-41: props, 36-37: descarte con _)
- src/features/panel/PieAccionTimeline.tsx (footer actual)
- src/features/panel/EncabezadoTimeline.tsx (cabecera)

LO QUE HAY QUE HACER:

OPCIÓN A (recomendada): Agregar botones en el EncabezadoTimeline, al lado del nombre
o debajo del teléfono, como iconos pequeños:

  📧 Enviar correo  |  📅 Agendar

OPCIÓN B: Agregarlos como acciones secundarias en PieAccionTimeline, debajo del
botón principal, con estilo más tenue (variante outline).

OPCIÓN C: Agregarlos como chips/iconos en la cabecera del panel, a la derecha
del badge de estado.

ELEGIR LA OPCIÓN A (menos intrusiva, no compite con la acción primaria).

IMPLEMENTACIÓN:

1. En PanelDerecho, quitar el prefijo _ de onCorreo y onAgendarBienvenida.

2. Pasar onCorreo y onAgendarBienvenida a EncabezadoTimeline como props nuevas:
   - onCorreoClick?: () => void
   - onAgendarClick?: () => void

3. En EncabezadoTimeline, si están presentes, mostrar dos iconos pequeños
   (Mail, CalendarPlus de lucide-react) a la derecha del badge de estado.
   Cada uno llama a su handler. Estilo: icono 15px, text-slate-400, hover:text-slate-600.

4. Para onCorreo: necesita un email. Si el lead form tiene email, usarlo.
   Si no, onCorreoClick se ocupa (abre Correos sin pre-llenar).
   En PanelDerecho:
   const onCorreoClick = lead.data?.lead?.email
     ? () => onCorreo!(lead.data!.lead!.email!)
     : undefined;
   Solo mostrar el icono si hay handler.

5. Para onAgendarBienvenida: siempre disponible si el callback existe.
   En PanelDerecho:
   const onAgendarClick = onAgendarBienvenida
     ? () => onAgendarBienvenida(telefono)
     : undefined;

RESTRICCIONES:
- No cambiar la interfaz de PieAccionTimeline
- Los iconos deben ser sutiles, no competir con el badge de estado
- No mostrar iconos si sus handlers son undefined

VERIFICACIÓN:
- npx tsc --noEmit -p tsconfig.app.json
- npx vitest run src/features/panel/
```

---

### Tarea 1.4 — Arreglar footer para tono 'alto'

**Archivos a tocar:**
- `src/features/panel/PieAccionTimeline.tsx` — agregar caso 'alto'

**Agente:** `general`

**Contexto preciso para el agente:**

```
TAREA: PieAccionTimeline no maneja el tono 'alto' — los contactos con intereses
o padrón pero sin ficha Cerberus se quedan sin footer.

ARCHIVO A TOCAR:
- src/features/panel/PieAccionTimeline.tsx

LO QUE HAY QUE HACER:

Agregar un tercer caso en el switch de PieAccionTimeline (línea 29, antes del
fallthrough de mensajes). El tono 'alto' debe mostrar el mismo botón que 'nuevo'
("Marcar como interesado" con icono Sparkles en bg-slate-800).

El código actual tiene:
  if (estado.tono === 'cliente') { return <Registrar venta> }
  if (estado.tono === 'nuevo') { return <Marcar como interesado> }
  const mensaje = MENSAJE_TONO[estado.tono] ?? null;
  if (!mensaje) return null;  // ← 'alto' cae acá y devuelve null

Agregar antes del fallthrough:
  if (estado.tono === 'alto') {
    return (
      <div className="shrink-0 border-t border-slate-100 px-4 py-3">
        <button
          type="button"
          onClick={onAccion}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-2.5 text-sm font-bold text-white shadow-[0_4px_16px_-4px_rgba(0,0,0,0.2)] transition-all hover:bg-slate-900 active:scale-[0.98]"
        >
          <Sparkles size={15} /> Marcar como interesado
        </button>
      </div>
    );
  }

RESTRICCIONES:
- El tipo EstadoContacto.tono NO incluye 'alto'. mapearEstado() en PanelDerecho
  convierte otros tonos a 'alto'. Agregar 'alto' como string literal válido.
- Si el typecheck falla porque 'alto' no está en TonoContacto, agregar al union type.

VERIFICACIÓN:
- npx tsc --noEmit -p tsconfig.app.json
```

---

## 3. Fase 2 — Datos reales (P1)

> **Objetivo:** reemplazar placeholders con datos reales.
> **Dependencias:** ninguna (independiente de Fase 1).
> **Verificación:** typecheck + tests.

---

### Tarea 2.1 — Quitar placeholder del resumen IA

**Archivos a tocar:**
- `src/features/panel/PanelDerecho.tsx` — línea 116

**Agente:** `general`

**Contexto preciso para el agente:**

```
TAREA: El resumen IA muestra un string hardcodeado. Reemplazarlo por un estado
honesto: si no hay endpoint, no mostrar nada.

ARCHIVO A TOCAR:
- src/features/panel/PanelDerecho.tsx (línea 116)

LO QUE HAY QUE HACER:

1. Quitar la línea 116: resumenIa="Vista previa del resumen IA..."

2. Agregar una prop opcional `resumenIa?: string | null` a EncabezadoTimelineProps
   (ya existe, verificar).

3. En PanelDerecho, pasar `resumenIa={undefined}`.

4. En EncabezadoTimeline, la condición `{resumenIa && (...)}` ya maneja el caso
   donde resumenIa es undefined/null: no renderiza el bloque verde.

El resultado: el bloque de resumen IA desaparece del panel hasta que exista el
endpoint real. Es un estado honesto: "no tenemos este dato todavía".

VERIFICACIÓN:
- npx tsc --noEmit -p tsconfig.app.json
- El bloque verde con Sparkles NO debe aparecer en el panel
```

---

### Tarea 2.2 — Wire Meta bar click handlers (básico)

**Archivos a tocar:**
- `src/features/panel/PanelDerecho.tsx` — pasar handlers a EncabezadoTimeline
- `src/features/panel/EncabezadoTimeline.tsx` — acepta los handlers pero no se usan

**Agente:** `general`

**Contexto preciso para el agente:**

```
TAREA: Los 4 bloques de BarraMetaContacto son botones pero ningún handler está
conectado. Conectar los que tienen sentido hoy.

ARCHIVOS CLAVE:
- src/features/panel/PanelDerecho.tsx
- src/features/panel/EncabezadoTimeline.tsx
- src/features/panel/BloqueMeta.tsx (lo que este plan llama BarraMetaContacto)

LO QUE HAY QUE HACER:

1. "Asignado a" (User icon, chevron): por ahora NO tiene handler.
   El dato viene de `lead.data?.lead.vendedora` o similar — verificar si el
   campo existe en la respuesta de useLeadForm. Si no existe, dejar sin handler.
   En el futuro se conectará a GET /api/admin/numeros.

2. "Origen" (Megaphone): si `lead.data?.lead.fuente === 'meta'`, abrir URL externa.
   El ad_id está en `lead.data?.lead.adId` o similar. Pero es frágil.
   Por ahora, definir el handler como no-op y dejar documentado.

3. "Campaña" (Target): si hay campaña, filtrar la cola por esa campaña.
   Esto requeriría un puente o callback desde App.tsx.
   Por ahora, no-op.

4. "Primer contacto" (Calendar): scroll al primer mensaje de la conversación.
   Esto requiere acceso al contenedor de mensajes (ref o DOM query).
   Por ahora, no-op.

IMPLEMENTACIÓN MÍNIMA:
- Pasar `undefined` para los 4 handlers en PanelDerecho (ya se hace implícitamente).
- Los bloques se renderizan como botones disabled (cursor-default), que es el
  comportamiento actual de BarraMetaContacto cuando onClick es undefined.
- Documentar en el código (sin comentarios) que los handlers están pendientes.

VERIFICACIÓN:
- Los bloques deben verse igual pero sin cursor-pointer
- npx tsc --noEmit -p tsconfig.app.json
```

---

## 4. Fase 3 — Recuperar funcionalidad (P2)

> **Objetivo:** DosRespuestas y BloqueHechos existen, están probados, pero no se
> muestran en ningún lado. Darles una superficie.
> **Dependencias:** Fase 1 y 2 completadas.
> **Verificación:** typecheck + tests + ver visualmente en el navegador.

---

### Tarea 3.1 — Hoja de sugerencias (DosRespuestas)

**Archivos a tocar:**
- `src/features/panel/PanelDerecho.tsx` — disparar useSugerencias
- `src/App.tsx` — montar la hoja (mismo patrón que Ivi)
- Nuevo archivo: una `HojaSugerencias` que este plan proponía **y no se construyó** — wrapper

**Agente:** `general`

**Contexto preciso para el agente:**

```
TAREA: DosRespuestas.tsx existe en src/features/sugerencias/ pero no se muestra.
Crear una hoja lateral (overlay derecho) que se abra con la tecla 'r' o un botón,
usando el mismo patrón que Ivi (useState en App.tsx + tecla global + hoja overlay).

PATRÓN A SEGUIR (Ivi en App.tsx):
- Estado: const [ivi, setIvi] = useState(false)
- Tecla: useTeclaGlobal('i', callback) → abre/cierra
- Hoja: se monta SIEMPRE (<IviConsulta ... abierta={ivi} />) pero con display condicional
- El hook de datos (useSugerencias) se dispara en PanelDerecho o en la hoja

ARQUITECTURA:

1. En App.tsx, agregar:
   const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
   useTeclaGlobal('r', () => setSugerenciasAbiertas(p => !p));

2. Crear HojaSugerencias.tsx en src/features/panel/:
   - Recibe: clave, nombre, abierta, onCerrar
   - Usa useSugerencias(clave, nombre, true)
   - Renderiza DosRespuestas con los datos
   - Overlay a la derecha (mismo ancho que el panel: w-[22.5rem])
   - Fondo blanco, sombra sutil, z-30
   - Transición: translate-x (abierta: 0, cerrada: 100%)

3. Montar HojaSugerencias en App.tsx:
   {abierta && (
     <HojaSugerencias
       clave={abierta.clave}
       nombre={nombreDelContacto({...}).principal ?? null}
       abierta={sugerenciasAbiertas}
       onCerrar={() => setSugerenciasAbiertas(false)}
     />
   )}

4. Agregar botón en EncabezadoTimeline (ícono Zap o similar) que abra la hoja.
   Prop nueva: onSugerenciasClick?: () => void

5. En PanelDerecho, pasar el handler:
   onSugerenciasClick={onAbrirSugerencias}  // recibido como prop de App.tsx

RESTRICCIONES:
- DosRespuestas.tsx NO se toca (ya funciona, solo necesita datos)
- La hoja se cierra con Escape (mismo patrón que Ivi)
- La hoja se cierra al hacer clic fuera (backdrop)

VERIFICACIÓN:
- npx tsc --noEmit -p tsconfig.app.json
- Abrir localhost:5199, seleccionar conversación, presionar 'r'
```

---

### Tarea 3.2 — Datos recomendados en el composer (BloqueHechos)

**Archivos a tocar:**
- `src/features/panel/PanelDerecho.tsx` — disparar useHechos
- `src/features/whatsapp/HiloWhatsapp.tsx` — mostrar chips debajo del composer

**Agente:** `general`

**Contexto preciso para el agente:**

```
TAREA: BloqueHechos.tsx existe pero no se muestra. En lugar de una hoja aparte,
integrar los hechos como chips clickeables debajo del compositor de mensajes.

El concepto: la vendedora está escribiendo y abajo del input ve 1-3 frases cortas
("Se puede en 2 cuotas", "Acceso por 1 año"). Toca una y cae en el composer.

ARQUITECTURA:

1. PanelDerecho ya tiene useHechos disponible (solo necesita importarlo).
   Agregar:
   const { data: hechos } = useHechos(conversacion.clave, esWa);

2. Pasar los hechos hacia el chat. Esto requiere una prop nueva en el flujo:
   PanelDerecho → App.tsx → componente de chat (HiloWhatsapp / HiloMessenger).

   OPCIÓN MÁS SIMPLE: agregar una prop `hechos` al componente de mensajes.
   App.tsx ya tiene el estado `abierta`. PanelDerecho puede comunicarse hacia
   arriba con un callback `onHechosListos(hechos)`.

3. En App.tsx, guardar los hechos en un estado:
   const [datosRecomendados, setDatosRecomendados] = useState<HechoRecomendado[]>([]);

4. Pasar `onHechosListos={setDatosRecomendados}` a PanelDerecho.

5. En PanelDerecho, usar useEffect para llamar a onHechosListos cuando hechos.data cambie.

6. Pasar `datosRecomendados` al componente de chat (HiloWhatsapp).

7. En HiloWhatsapp, debajo del composer, mostrar los hechos como chips:
   <div className="flex gap-1.5 px-3 pb-2">
     {hechos.map(h => (
       <button
         key={h.clave}
         onClick={() => insertarEnComposer(h.texto)}
         className="rounded-full border border-border px-3 py-1 text-xs text-slate-600 hover:bg-accent"
       >
         {h.rotulo}
       </button>
     ))}
   </div>

RESTRICCIONES:
- BloqueHechos.tsx tiene su propio diseño (tarjetas con categoría). Para los chips
  en el composer, usar un diseño más compacto (chips, no tarjetas).
- No tocar BloqueHechos.tsx (puede reutilizarse en otro contexto)
- La inserción en el composer debe usar el mecanismo existente (setMensaje o similar)

VERIFICACIÓN:
- npx tsc --noEmit -p tsconfig.app.json
```

---

## 5. Orden de ejecución

```
Fase 1 (independientes entre sí):
  ├── Tarea 1.4 (arreglar footer 'alto')  ← 1 archivo, sin dependencias
  ├── Tarea 1.1 (Registrar venta)         ← 2 archivos, App.tsx + PanelDerecho
  ├── Tarea 1.2 (Marcar como interesado)  ← 2 archivos, necesita mutation
  └── Tarea 1.3 (onCorreo/onAgendar)      ← 2 archivos, necesita EncabezadoTimeline

Fase 2 (independientes, pueden correr en paralelo con Fase 1):
  ├── Tarea 2.1 (quitar placeholder IA)   ← trivial, 1 línea
  └── Tarea 2.2 (Meta bar handlers)       ← documentar, sin código nuevo

Fase 3 (depende de Fase 1 completa):
  ├── Tarea 3.1 (HojaSugerencias)         ← archivo nuevo + App.tsx
  └── Tarea 3.2 (Hechos en composer)      ← App.tsx + HiloWhatsapp
```

---

## 6. Verificación final

Después de completar todas las fases, ejecutar:

```bash
# Typecheck
npx tsc --noEmit -p tsconfig.app.json

# Tests del panel
npx vitest run src/features/panel/

# Todos los tests
npx vitest run

# Vite dev (si no está corriendo)
VITE_API_URL=https://hermes-api.goberna.us npx vite --port 5199 --host 0.0.0.0
```

**Checklist manual:**
- [ ] Abrir conversación de un cliente → botón "Registrar venta" abre FormularioVenta
- [ ] Abrir conversación de un lead nuevo → botón "Marcar como interesado" funciona
- [ ] Contacto con intereses pero sin ficha → tiene botón "Marcar como interesado"
- [ ] Resumen IA no aparece (placeholder eliminado)
- [ ] Iconos de correo/agenda visibles en el header (si aplica)
- [ ] Meta bar: 4 bloques visibles, sin cursor-pointer (handlers pendientes)
