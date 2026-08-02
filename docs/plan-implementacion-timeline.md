# Plan de implementación — Timeline Inteligente a producción

> Panel real en `PanelDerecho.tsx`.
> Sin nuevos endpoints. Sin IA. Solo reorganizar lo que ya existe.

---

## 1. Qué NO cambia

Los 6 hooks que `PanelDerecho.tsx` ya dispara se quedan exactamente igual:

| Hook | Endpoint | Qué devuelve |
|---|---|---|
| `useFicha(telefono)` | `GET /api/contactos/ficha` | Ficha Cerberus: estado, nombre, compras |
| `useLeadForm(telefono)` | `GET /api/contactos/lead` | Formulario Meta/web: nombre, email, campaña |
| `useSenales([clave])` | `GET /api/senales` | Señales: enfriamiento, cotización, etiquetas |
| `useIntereses(clave)` | `GET /api/gestiones/intereses` | Intereses registrados + propuesta derivada |
| `useSugerencias(clave)` | `GET /api/sugerencias` | 2 secuencias sugeridas |
| `useHechos(clave)` | `GET /api/hechos` | Datos recomendados (frases sueltas) |

**Cero cambios en el server.** Solo cambia cómo se renderizan esos datos.

---

## 2. Archivos a crear

### 2.1 `src/features/panel/timeline.ts` — tipos y ensamblado (puro, con tests)

Define los tipos del timeline y una función pura que toma los datos de los hooks y los ensambla en eventos ordenados.

```ts
// Tipo de evento del timeline
export type TipoEvento = 'llegada' | 'identidad' | 'mensaje' | 'interes_detectado' 
  | 'interes_registrado' | 'compra' | 'cotizacion' | 'enfriamiento' | 'pendiente';

export interface EventoLinea {
  tipo: TipoEvento;
  icono: string;       // clave del icono (no un ReactNode: es dato, no markup)
  rotulo: string;
  valor?: string;
  fuente?: string;
  confianza?: number;
  timestamp?: string;  // ISO
  estado: 'confirmado' | 'manual' | 'ia' | 'pendiente';
}

export interface CampoPendiente {
  campo: string;
}

export function ensamblarTimeline(datos: {
  ficha?: Ficha;
  intereses?: InteresRegistrado[];
  senales?: Senal;
  leadForm?: { campana?: string; fecha?: string };
  conversacion?: { persona_nombre?: string; lead_nombre?: string };
}): { eventos: EventoLinea[]; pendientes: CampoPendiente[]; progreso: number }
```

**Reglas de ensamblado:**
1. Eventos confirmados primero (de fuentes reales: Cerberus, formulario, mensajes)
2. Eventos de IA después (intereses detectados por el server, señales)
3. Pendientes al final (campos que faltan)
4. Progreso = eventos confirmados / (eventos confirmados + pendientes)

### 2.2 `src/features/panel/EncabezadoTimeline.tsx` — el header (componente)

Migra el `Encabezado` de la galería pero con props reales. Recibe `EventoLinea[]` y `progreso` en vez de datos mock.

### 2.3 `src/features/panel/EventoLinea.tsx` — un evento del timeline (componente)

Migra `Evento` y `Pendiente` de la galería. Recibe `EventoLinea` y renderiza con iconos reales de lucide-react, colores por estado, y acciones de hover (editar/borrar/corregir).

### 2.4 `src/features/panel/PieAccionTimeline.tsx` — el botón de acción (componente)

Migra `PieAccion` de la galería. Decide qué acción mostrar según `EstadoContacto.tono`.

---

## 3. Archivos a modificar

### 3.1 `src/features/panel/PanelDerecho.tsx` — reescritura completa

**Antes** (155 líneas, 5 secciones):
```
PanelDerecho
├── BandaEstado
├── TimelineContacto
├── Intereses
├── DosRespuestas
└── BloqueHechos
```

**Después** (estructura nueva):
```
PanelDerecho
├── EncabezadoTimeline    ← avatar, nombre, teléfono, estado, progreso, chips
├── Timeline (scrollable)
│   ├── EventoLinea × N   ← compras, intereses, señales, llegada, identidad
│   └── Pendiente × N     ← campos faltantes
└── PieAccionTimeline     ← "Registrar venta" o "Marcar como interesado"
```

**Qué desaparece:**
- `BandaEstado` → reemplazado por `EncabezadoTimeline`
- `TimelineContacto` → absorbido por `EventoLinea`
- `Intereses` (sección separada) → absorbido por el timeline como evento
- `DosRespuestas` (sección "Enviar rápido") → **sale del panel** (decisión del dueño: el panel es información, no acción; las sugerencias van en otra superficie)
- `BloqueHechos` → ídem

### 3.2 `src/features/panel/timeline.test.ts` — tests del ensamblado

Cubre:
- Cliente con compras + intereses → eventos ordenados cronológicamente
- Lead nuevo sin datos → solo eventos de llegada + pendientes
- Cerberus caído → eventos con estado 'pendiente' para los datos de Cerberus
- Cálculo de progreso correcto

---

## 4. Orden de implementación (5 pasos)

### Paso 1 — Tipos y ensamblado puro
Crear `timeline.ts` con `EventoLinea`, `CampoPendiente`, `ensamblarTimeline()`.
Crear `timeline.test.ts` con todos los casos.
**No toca nada de UI. No rompe nada.**

### Paso 2 — Componentes puros
Crear `EncabezadoTimeline.tsx`, `EventoLinea.tsx`, `PieAccionTimeline.tsx`.
Migrar el markup de la galería, reemplazando datos mock por props tipadas.
**No se montan en ningún lado todavía. No rompe nada.**

### Paso 3 — Rewrite de PanelDerecho.tsx
Reemplazar el contenido actual por la nueva estructura.
Los 6 hooks siguen igual, pero ahora alimentan `ensamblarTimeline()`.
El resultado se pasa a los nuevos componentes.
**Este es el único paso que cambia lo que la vendedora ve.**

### Paso 4 — Limpiar imports y remover dependencias muertas
Una vez que `PanelDerecho` no importa más `BandaEstado`, `TimelineContacto`, `DosRespuestas`, `BloqueHechos`, `Intereses`:
- Verificar que ningún otro archivo los importa
- Si no, marcar como deprecated (o borrar si no se usan en otro lado)

### Paso 5 — Verificación visual (regla dura #2)
Con la app corriendo en dev, abrir 3 conversaciones reales:
- Un cliente con compras
- Un lead nuevo
- Un lead con precio enviado y enfriado

Captura de los 3 estados. Comparar contra la galería.

---

## 5. Lo que NO entra en esta etapa

- **Eventos de IA** (interés detectado, intención, preguntó precio). Cuando el detector exista, se agrega un nuevo paso: nuevo endpoint `GET /api/conversaciones/:clave/timeline` que el server devuelva con eventos de IA incluidos. El front solo agrega esos eventos al array.
- **Pendientes configurables por tipo de lead**. Por ahora, lista fija de ~6 campos. Cuando exista la configuración, `ensamblarTimeline` recibe un parámetro extra.
- **Animaciones**. CSS transitions cuando un evento nuevo aparece.
- **Edición inline**. Los botones de hover (lápiz, papelera) son visuales por ahora. La funcionalidad real requiere mutations.
- **Panel de sugerencias**. `DosRespuestas` y `BloqueHechos` se van del panel pero no desaparecen: van a una superficie propia (tecla, botón flotante, o integrados al composer).

---

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| El ensamblado produce eventos vacíos si los hooks fallan | `ensamblarTimeline` es puro y testeable — cada rama de error tiene su test |
| Romper la vista de Mensajes en prod | Los pasos 1-2 no tocan `PanelDerecho`. El paso 3 es un solo archivo, fácil de revertir |
| Perder funcionalidad que las vendedoras usan | `DosRespuestas` y `BloqueHechos` se mueven, no se borran — buscar dónde van antes de sacarlos |
| El nuevo diseño no gusta en datos reales | La galería ya se validó visualmente. El paso 5 verifica con datos reales antes de mergear |
