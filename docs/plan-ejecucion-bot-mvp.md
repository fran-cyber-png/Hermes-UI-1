# Plan de ejecución — Asesor Comercial IA (MVP)

> ⚠️ **Al 16-ago-2026:** el bot se construyó (56 archivos en `server/src/bot/`), pero **§C.2 ya no
> describe lo que corre**: el monolito `procesarClaim()` del despachador se partió en un pipeline
> de 16 pasos en `server/src/bot/orquestador.ts`, con el claim atómico en `claim.ts` y los efectos
> en `ejecutar.ts`. `despachador.ts` quedó como el loop que llama a eso y al reenganche.
> El spike `responder.ts` que varios tickets mandan leer ya no existe: lo borró **ADR 0033**.

> **Base**: `docs/arquitectura-bot-comercial.md` (leer primero)  
> **Decisión**: ADR 0028, ADR 0029–0032  
> **Deadline MVP**: domingo 3-ago a las 23:59  
> **Deadline P0**: hoy (mié 30-jul) a las 18:00

---

## Estructura de agentes

Tres roles de subagente + un orquestador humano (Estephano). Cada subagente recibe un prompt
autocontenido: lee los archivos que necesita, construye lo que le toca, escribe los tests, y
devuelve el diff listo para revisión.

```
┌─────────────────────────────────────────────────┐
│              ORQUESTADOR (Estephano)             │
│  Revisa diffs · Decide merge · Deploy · Smoke    │
└──────┬──────────────────┬───────────────────────┘
       │                  │
       ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  AGENTE A    │  │  AGENTE B    │  │  AGENTE C    │
│  Cimientos   │  │  Lógica pura │  │  Integración │
│              │  │              │  │              │
│ IAM + token  │  │ decision.ts  │  │ despachador  │
│ Migraciones  │  │ acciones.ts  │  │ ingesta.ts   │
│ Schema DB    │  │ tools.ts     │  │ refactor     │
│              │  │ chunker.ts   │  │ webhook      │
│              │  │ prompt.ts    │  │              │
│              │  │ contexto.ts  │  │              │
│              │  │ agente.ts    │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Regla de oro**: un subagente NUNCA toca archivos que no le fueron asignados. Si necesita algo de
otro agente, lo documenta y sigue. El orquestador resuelve dependencias al mergear.

---

## Agente A — Cimientos (infra + schema)

**Contexto**: sabe de AWS IAM, Meta Business, Postgres, Drizzle, migraciones versionadas, VPS1.

**Objetivo**: destrabar lo que bloquea (credenciales) y crear las tablas.

### A.1 — IAM user permanente en AWS

**Leer primero**: `docs/bot-spike-flujo-completo.md` §5 (modelos Bedrock disponibles, cuenta 177914733251).

**Hacer**:
1. Entrar a la consola AWS, cuenta `177914733251`, región `us-east-1`.
2. Crear usuario IAM `hermes-bot-bedrock` con política:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": "bedrock:InvokeModel",
       "Resource": "*"
     }]
   }
   ```
3. Generar access key + secret key. Guardarlas.
4. Cargar en VPS1 `/srv/hermes/server/.env`:
   ```bash
   AWS_ACCESS_KEY_ID=AKIA...
   AWS_SECRET_ACCESS_KEY=...
   # ELIMINAR AWS_SESSION_TOKEN si existe
   ```
5. Cargar lo mismo en `/srv/hermes-staging/server/.env`.
6. Reiniciar Hermes en staging: `sudo systemctl restart hermes-staging`.
7. **Verificar**: mandar WhatsApp de prueba, esperar respuesta. Esperar 1 hora y 5 minutos. Volver a mandar. Debe responder.

**Prohibido**: commitear las credenciales; usar `aws login` en VPS1; tocar el código.

### A.2 — Token permanente de WhatsApp Cloud API

**Leer primero**: `server/src/whatsapp/transporteCloudApi.ts` (cómo se autentica el envío).

**Hacer**:
1. En Meta Business App → Configuración → System Users → Crear/editar `hermes-bot`.
2. Asignar activos: la WABA y el número `+51 984 429 504`.
3. Generar token con permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Cargar en VPS1 `/srv/hermes/server/.env`:
   ```bash
   WHATSAPP_CLOUD_API_TOKEN=EAA...  # reemplazar el temporal
   ```
5. Cargar lo mismo en staging.
6. **Verificar**: mandar WhatsApp al número del bot, confirmar que responde.

**Prohibido**: generar el token desde "API Setup" (eso es temporal 24h). Tiene que ser System User.

### A.3 — Migración: las 5 tablas del bot

**Leer primero**:
- `server/src/db/schema.ts` (cómo se declaran tablas en Drizzle)
- `server/src/db/bot.ts` (si existe; si no, se crea)
- `docs/migraciones.md` (el flujo de migraciones versionadas)
- `server/drizzle/meta/_journal.json` (el journal actual)
- `docs/arquitectura-bot-comercial.md` §9 (el DDL de las 5 tablas)

**Hacer**:
1. Crear `server/src/db/bot.ts` con las 5 tablas en Drizzle:
   - `botEstado` — `numeroPropio` text PK, `modo` text, `frenadoMotivo` text, `actualizadoEn` timestamp, `actualizadoPor` text
   - `botPendientes` — `clave` text PK, `numeroPropio` text, `ultimoEntranteEn` timestamp, `procesarDesde` timestamp, `enProcesoDesde` timestamp, `creadoEn` timestamp. Índice parcial WHERE `enProcesoDesde IS NULL`.
   - `botRespuestas` — `id` bigserial PK, `clave` text, `numeroPropio` text, `texto` text, `textoCompleto` text, `acciones` jsonb, `estado` text, `motivo` text, `modelo` text, `tokensEntrada` int, `tokensSalida` int, `tokensCacheEscritura` int, `tokensCacheLectura` int, `revision` text, `creadoEn` timestamp. Índices por `(estado, creadoEn)` y `(clave, creadoEn)`.
   - `botPausas` — `clave` text PK, `motivo` text, `hasta` timestamp, `creadoEn` timestamp
   - `botCalificaciones` — `clave` text PK, `temperatura` text, `motivo` text, `escalada` boolean, `actualizadoEn` timestamp
2. Exportar las tablas desde un barrel `db/index.ts` (si hay barrel). ⚠️ **No lo hay ni lo hubo**:
   `drizzle.config.ts` toma `./src/db/!(client).ts` por glob, así que `db/bot.ts` entra solo y no
   hay índice que tocar. El cliente vive en `server/src/db/client.ts`, que es de donde todo el bot
   importa `db`.
3. Generar migración:
   ```bash
   cd server && npm run db:generate
   ```
4. Fijar `when` monótono:
   ```bash
   JOURNAL_FILE=server/drizzle/meta/_journal.json goberna-journal-set-when
   ```
5. Verificar que `journal.test.ts` pasa:
   ```bash
   cd server && npx tsx --test src/**/journal.test.ts
   ```
6. Commitear `server/drizzle/` completo (migración + journal + meta).

**Migración en VPS1**:
7. Staging primero: `ssh deploy@161.132.39.165 'cd /srv/hermes-staging && sudo hermes-deploy --dry-run'` — verificar que la migración aparece.
8. Ejecutar migración en staging.
9. Verificar con `npm run db:estado` desde staging que las 5 tablas existen.
10. Producción: MISMO procedimiento (la migración es idempotente).

**Tests**: no requiere tests propios (las tablas se testean cuando el despachador las usa). Pero:
- `db:check` debe pasar.
- `journal.test.ts` debe pasar.
- `npx tsc --noEmit` debe pasar.

**Prohibido**: `db:push` en producción o staging; tocar tablas existentes; crear las tablas sin migración versionada.

### A.4 — Refrescar credenciales y verificar end-to-end

**Hacer**:
1. SSH a VPS1 staging.
2. Verificar `.env` tiene las 4 vars nuevas: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `WHATSAPP_CLOUD_API_TOKEN`, `BOT_LINEAS`.
3. Reiniciar: `sudo systemctl restart hermes-staging`.
4. Logs: `sudo journalctl -u hermes-staging -f --no-pager`.
5. Mandar WhatsApp de prueba desde `955135507` al `+51 984 429 504`.
6. Confirmar en logs: `[bot spike] respondiendo: ...`
7. Esperar 15 min, mandar otro mensaje: debe responder otra vez.
8. Si no responde: `sudo journalctl -u hermes-staging --no-pager | grep -i error | tail -20`.

**Entregable**: captura de pantalla del log mostrando respuesta del bot.

---

## Agente B — Lógica pura (decision, acciones, tools, chunker, prompt, agente)

**Contexto**: TypeScript estricto, funciones puras, node:test, cero I/O.

**Objetivo**: todo lo que se puede testear sin base de datos ni red. El 80 % del bot.

### B.1 — Tipos compartidos (`acciones.ts`)

**Leer primero**: `server/src/bot/guardrails.ts` (el tipo `Veredicto`, cómo se modelan los resultados), `server/src/catalogo/armar.ts` (el tipo `Pieza`), `server/src/hechos/` (el tipo `Hecho`).

**Crear**: `server/src/bot/acciones.ts`

```ts
/** Lo que el agente decide hacer. NUNCA ejecuta efectos: el despachador lo hace después. */
export type Accion =
  | { tipo: 'mandar_pieza'; clase: 'plantilla' | 'hecho' | 'gancho'; id: string }
  | { tipo: 'registrar_interes'; familia: string }
  | { tipo: 'calificar'; temperatura: 'caliente' | 'tibio' | 'frio'; motivo: string }
  | { tipo: 'escalar'; motivo: EscaladaMotivo }
  | { tipo: 'pausar'; motivo: 'rechazo' | 'despedida' };

export type EscaladaMotivo =
  | 'pidio_humano'
  | 'pregunto_si_es_bot'
  | 'por_cerrar'
  | 'sin_respuesta_en_catalogo'
  | 'frustrado'
  | 'error_bot';

export interface Turno {
  rol: 'lead' | 'nosotros';
  texto: string;
}

export interface ResumenPieza {
  clase: 'plantilla' | 'hecho' | 'gancho' | 'acuse';
  id: string;
  descripcion: string;
  enviable: boolean;
}

export interface RespuestaBot {
  texto: string | null;
  acciones: Accion[];
  uso: {
    entrada: number;
    salida: number;
    cacheEscritura: number;
    cacheLectura: number;
    modelo: string;
  };
}

export interface ErrorBot {
  error: string;
  codigo: string;
  reintentable: boolean;
}
```

**Tests**: no necesita (son tipos). Pero `npx tsc --noEmit` debe pasar.

### B.2 — Motor de decisión (`decision.ts`)

**Leer primero**: `server/src/bot/config.ts` (los topes y modos), `server/src/bot/guardrails.ts` (`esRepetido`, `esDespedida`, `huboRechazo`), `server/src/autorespuesta/` (el patrón de decisión pura).

**Crear**: `server/src/bot/decision.ts`

```ts
export interface HechosParaDecidir {
  modo: 'apagado' | 'sombra' | 'automatico';
  lineaHabilitada: boolean;
  pausa: { motivo: string; hasta: Date | null } | null;
  huboSalienteHumanoDespuesDe: Date | null;
  entranteEsRepetido: boolean;
  turnosHoy: number;
  maxTurnosDia: number;
  respuestasUltimaHoraLinea: number;
  maxRespuestasHoraLinea: number;
  transporteConectado: boolean;
  frenado: boolean;
}

export type MotivoSalto =
  | 'apagado'
  | 'linea_no_habilitada'
  | 'frenado'
  | 'pausado'
  | 'vendedora_activa'
  | 'spam'
  | 'tope_turnos'
  | 'tope_linea'
  | 'desconectado';

export type Decision =
  | { accion: 'responder' }
  | { accion: 'saltar'; motivo: MotivoSalto };

/** Evalúa en ORDEN FIJO (del más barato al más caro). El test recorre el orden entero. */
export function decidir(h: HechosParaDecidir): Decision {
  if (h.modo === 'apagado') return { accion: 'saltar', motivo: 'apagado' };
  if (!h.lineaHabilitada) return { accion: 'saltar', motivo: 'linea_no_habilitada' };
  if (h.frenado) return { accion: 'saltar', motivo: 'frenado' };
  if (h.pausa && (h.pausa.hasta === null || h.pausa.hasta > new Date())) {
    return { accion: 'saltar', motivo: 'pausado' };
  }
  if (h.huboSalienteHumanoDespuesDe) return { accion: 'saltar', motivo: 'vendedora_activa' };
  if (h.entranteEsRepetido) return { accion: 'saltar', motivo: 'spam' };
  if (h.turnosHoy >= h.maxTurnosDia) return { accion: 'saltar', motivo: 'tope_turnos' };
  if (h.respuestasUltimaHoraLinea >= h.maxRespuestasHoraLinea) {
    return { accion: 'saltar', motivo: 'tope_linea' };
  }
  if (!h.transporteConectado) return { accion: 'saltar', motivo: 'desconectado' };
  return { accion: 'responder' };
}
```

**Tests**: `server/src/bot/decision.test.ts`
- Un caso por cada motivo de salto (9 casos).
- El caso feliz (todo OK → responder).
- **El orden**: construir hechos con DOS motivos válidos (ej. `pausado` y `tope_turnos`). Verificar que gana `pausado` (el primero en el orden fijado).

**Prohibido**: importar base de datos, `process.env`, o cualquier I/O.

### B.3 — Chunker (`chunker.ts`)

**Crear**: `server/src/bot/chunker.ts`

```ts
/**
 * Parte un texto en 1 a 3 burbujas.
 * Corta primero por párrafos (doble salto de línea), después por oraciones
 * (punto, signo de exclamación/interrogación + espacio + mayúscula).
 * Si el texto es muy corto (< 300 chars) va en una sola burbuja.
 */
export function trocear(texto: string, maxBurbujas = 3): string[] {
  const trimado = texto.trim();
  if (!trimado) return [];

  // Una sola burbuja si es corto
  if (trimado.length < 300) return [trimado];

  // Intentar por párrafos
  const parrafos = trimado
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  if (parrafos.length > 1 && parrafos.length <= maxBurbujas) {
    return parrafos;
  }

  // Si hay más párrafos que burbujas, juntar los últimos
  if (parrafos.length > maxBurbujas) {
    const resultado = parrafos.slice(0, maxBurbujas - 1);
    resultado.push(parrafos.slice(maxBurbujas - 1).join('\n\n'));
    return resultado;
  }

  // Un solo párrafo largo: cortar por oraciones
  const oraciones = trimado
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/)
    .filter(Boolean);

  if (oraciones.length <= 1) return [trimado];

  const tamanoBurbuja = Math.ceil(oraciones.length / maxBurbujas);
  const resultado: string[] = [];
  for (let i = 0; i < oraciones.length; i += tamanoBurbuja) {
    resultado.push(oraciones.slice(i, i + tamanoBurbuja).join(' '));
  }
  return resultado.slice(0, maxBurbujas);
}
```

**Tests**: `server/src/bot/chunker.test.ts`
- Texto corto (< 300 chars) → una burbuja.
- Dos párrafos → dos burbujas.
- Cinco párrafos, max 3 → tres burbujas (últimos párrafos juntos).
- Un párrafo largo → cortado por oraciones.
- Texto vacío → [].
- Texto solo espacios → [].

### B.4 — Tools declarativas (`tools.ts`)

**Leer primero**: `server/src/bot/acciones.ts` (los tipos), `server/src/catalogo/` (el tipo Pieza), `server/src/cursos/` (familias de curso), `server/src/sugerencias/estado.ts` (momentos de venta).

**Crear**: `server/src/bot/tools.ts`

Implementar con `@anthropic-ai/sdk` → `tool()` (no `betaZodTool` — verificar versión instalada). Si el SDK no tiene helpers de tool, definir las tools como objetos planos con `name`, `description`, `input_schema` (JSON Schema).

Cada tool:
1. Valida el input (el id existe en el catálogo, la familia es conocida).
2. Si es inválido: devuelve error al modelo (no acumula acción).
3. Si es válido: acumula la `Accion` en el array `recolector` y devuelve confirmación.

**5 tools**:

1. **`mandar_pieza({ id })`** — busca en `catalogo` (array de `ResumenPieza`). Si no existe → "esa pieza no existe; elegí de la lista". Si existe → acumula `{ tipo: 'mandar_pieza', clase, id }` y devuelve "pieza agendada".

2. **`registrar_interes({ familia })`** — valida contra lista de familias conocidas (hardcodeada de `cursos/alias.ts`, las que tienen `familia` no nula). Si no existe → "esa familia no es válida". Si existe → acumula `{ tipo: 'registrar_interes', familia }` y devuelve "interés registrado".

3. **`calificar({ temperatura, motivo })`** — acumula `{ tipo: 'calificar', temperatura, motivo }`. Si ya hay una calificación previa en el array, la reemplaza (la última gana).

4. **`escalar_a_vendedora({ motivo })`** — acumula `{ tipo: 'escalar', motivo }`. Validar que `motivo` es uno de `EscaladaMotivo`.

5. **`pausar_conversacion({ motivo })`** — acumula `{ tipo: 'pausar', motivo: 'rechazo' | 'despedida' }`.

**Contrato**: `crearTools(recolector: Accion[], catalogo: ResumenPieza[]) → Record<string, ToolDefinition>`

**Tests**: `server/src/bot/tools.test.ts`
- `mandar_pieza` con id existente → acumula, devuelve confirmación.
- `mandar_pieza` con id inexistente → no acumula, devuelve error.
- `calificar` dos veces → queda la última.
- `registrar_interes` con familia inválida → error.
- `escalar_a_vendedora` con motivo inválido → error.

### B.5 — System prompt y contexto (`prompt.ts` + `contexto.ts`)

**Leer primero**: 
- el spike `responder.ts` del bot (el prompt actual de Kathy Alva, para no perder lo bueno)
  — **borrado por ADR 0033**, así que ya no se puede leer: lo que se rescató de ese prompt vive
  hoy en `server/src/bot/prompt.ts`
- `docs/concepto.md` (el negocio)
- `server/src/hechos/catalogo.ts` (los hechos aprobados)
- `server/src/catalogo/` (las piezas)
- `docs/arquitectura-bot-comercial.md` §5 (reglas duras)

**Crear**: `server/src/bot/contexto.ts`

```ts
/** 
 * Contexto inmutable del negocio. Se lee UNA VEZ al armar el prompt.
 * REVISAR: el dueño debe validar este texto.
 */
export const CONTEXTO_NEGOCIO = `La Escuela de Goberna es una institución de formación política 
con sede en Perú y alcance en toda Latinoamérica. Ofrece diplomados, cursos, especializaciones,
maestrías, eventos y certificaciones en áreas como inteligencia, contrainteligencia, comunicación
política, análisis electoral, gestión pública y ciberdefensa.

Modalidad: 100% virtual, clases en vivo por Zoom (quedan grabadas), campus virtual disponible 24/7.
Se estudia desde cualquier país. Los precios se manejan en moneda local del participante.

Programas destacados:
- Inteligencia y Contrainteligencia (DIPCINTE)
- Foro de Estado
- Diplomados en formación política
- Comunicación política
- Análisis electoral
- Ciberinteligencia y Ciberdefensa

No tenemos sedes físicas fuera de Perú. No ofrecemos programas gratuitos. 
No damos certificaciones universitarias (son certificaciones de Goberna).`;
```

**Crear**: `server/src/bot/prompt.ts`

```ts
import { CONTEXTO_NEGOCIO } from './contexto.js';
import type { Hecho } from '../hechos/index.js'; // ajustar ruta real
import type { ResumenPieza } from './acciones.js';

interface EntradaPrompt {
  hechos: Hecho[];
  piezas: ResumenPieza[];
  lecciones: string[];
}

/** 
 * El system prompt GRANDE (se cachea). Determinista: mismos inputs → mismo string.
 * Las secciones van en este orden fijo para que el caché pegue siempre.
 */
export function armarSystemPrompt(entrada: EntradaPrompt): string {
  const partes: string[] = [];

  // ── ROL ──
  partes.push(`<rol>
Eres Kathy Alva, asesora académica de la Escuela de Goberna (formación política, LATAM).
Atendés por WhatsApp. Tu misión: ayudar a cada persona a encontrar el programa que necesita,
con eficiencia y calidez, sin inventar nunca.

Estilo: español cálido y profesional. Respuestas de 2 a 4 oraciones.
UNA pregunta por mensaje. Cero emojis salvo ✓ para confirmar una acción.
</rol>`);

  // ── CONTEXTO DEL NEGOCIO ──
  partes.push(`<contexto_negocio>
${CONTEXTO_NEGOCIO}
</contexto_negocio>`);

  // ── DATOS QUE PODÉS AFIRMAR ──
  if (entrada.hechos.length > 0) {
    const lineas = entrada.hechos.map(h => `- [${h.id}] ${h.texto}`);
    partes.push(`<datos_que_podes_afirmar>
Solo esto se afirma como dato del negocio. Lo que no está acá no se sabe: se escala.
${lineas.join('\n')}
</datos_que_podes_afirmar>`);
  } else {
    partes.push(`<datos_que_podes_afirmar>
No hay datos afirmables configurados todavía. Para cualquier pregunta sobre precios,
fechas, docentes o certificaciones, usá escalar_a_vendedora.
</datos_que_podes_afirmar>`);
  }

  // ── PIEZAS ENVIABLES ──
  const enviables = entrada.piezas.filter(p => p.enviable);
  if (enviables.length > 0) {
    const lineas = enviables.map(p => `- [${p.clase}:${p.id}] ${p.descripcion}`);
    partes.push(`<piezas_enviables>
Para mandar una pieza usá la tool mandar_pieza con su id.
${lineas.join('\n')}
</piezas_enviables>`);
  }

  // ── REGLAS DURAS ──
  partes.push(`<reglas_duras>
1. NUNCA escribas cifras de precio, promociones ni descuentos en el texto.
   El precio se manda con mandar_pieza (la pieza correcta ya lo trae).
2. NUNCA inventes datos: sedes, fechas, certificaciones, docentes, formas de pago
   que no estén en <datos_que_podes_afirmar>. Si te preguntan algo que no está:
   escalar_a_vendedora con motivo sin_respuesta_en_catalogo.
3. NUNCA digas ni insinúes que sos un bot, un sistema o una IA — y NUNCA afirmes
   ser humana. Si te preguntan si sos un bot o una persona: escalar_a_vendedora
   con motivo pregunto_si_es_bot, sin responder la pregunta.
4. Si piden hablar con una persona, un asesor, "alguien": escalar_a_vendedora
   con motivo pidio_humano.
5. Si dicen que no les interesa o se despiden: pausar_conversacion y un cierre
   cortés de UNA oración, sin insistir.
6. Si muestran intención de compra (quieren pagar, piden el link, preguntan cómo
   inscribirse): calificar caliente + escalar_a_vendedora con motivo por_cerrar.
   El cierre de venta es humano.
7. En cada conversación, cuando identifiques el curso de interés: registrar_interes.
8. No prometas nada que no controlás ("te llamamos en 5 minutos").
</reglas_duras>`);

  // ── LECCIONES (flywheel) ──
  if (entrada.lecciones.length > 0) {
    partes.push(`<lecciones>
${entrada.lecciones.map(l => `- ${l}`).join('\n')}
</lecciones>`);
  }

  return partes.join('\n\n');
}

/** 
 * El bloque CHICO y volátil (sin caché). Datos de ESTA conversación.
 */
export function armarContextoContacto(entrada: {
  nombre?: string;
  procedenciaNombre?: string;
  interes?: string;
  senales?: string[];
}): string {
  const partes: string[] = [];
  if (entrada.nombre) {
    partes.push(`Estás hablando con ${entrada.nombre}`);
    if (entrada.procedenciaNombre) {
      partes.push(`(nombre de ${entrada.procedenciaNombre})`);
    }
  }
  if (entrada.interes) partes.push(`Interés registrado: ${entrada.interes}`);
  if (entrada.senales?.length) partes.push(`Señales: ${entrada.senales.join(', ')}`);
  return partes.length > 0 ? `<contacto>\n${partes.join('. ')}.\n</contacto>` : '';
}
```

**Tests**: `server/src/bot/prompt.test.ts`
- Determinismo: mismos inputs → mismo string exacto.
- Las 8 reglas duras están presentes (grep por fragmentos clave).
- Una pieza no enviable NO aparece en `<piezas_enviables>`.
- Cero hechos → sección dice explícitamente que no hay datos.
- El orden de secciones es fijo (rol → contexto → hechos → piezas → reglas → lecciones).

### B.6 — El agente (`agente.ts`)

**Leer primero**:
- `server/src/bot/guardrails.ts` (`validarSalida`, `Veredicto`)
- `server/src/bot/acciones.ts` (`Accion`, `RespuestaBot`, `Turno`)
- `server/src/bot/prompt.ts` (`armarSystemPrompt`, `armarContextoContacto`)
- `server/src/bot/tools.ts` (`crearTools`)
- `server/src/ivi/cliente.ts` (el patrón de la casa para cliente externo con seam)
- `@anthropic-ai/sdk` docs (toolRunner, mensajes, cache control)

**Crear**: `server/src/bot/agente.ts`

```ts
import Anthropic from '@anthropic-ai/sdk';
import { validarSalida } from './guardrails.js';
import { armarSystemPrompt, armarContextoContacto } from './prompt.js';
import { crearTools } from './tools.js';
import type { Accion, RespuestaBot, Turno, ResumenPieza } from './acciones.js';
import type { Hecho } from '../hechos/index.js'; // ajustar

export interface ClienteAnthropic {
  messages: Anthropic['messages'];
}

interface EntradaAgente {
  historial: Turno[];
  contactoCtx: string;
  hechos: Hecho[];
  piezas: ResumenPieza[];
  lecciones: string[];
  modelo: string;
}

export function crearAgente(cliente: ClienteAnthropic) {
  return {
    async responder(entrada: EntradaAgente): Promise<RespuestaBot | { error: string }> {
      const sistemaGrande = armarSystemPrompt({
        hechos: entrada.hechos,
        piezas: entrada.piezas,
        lecciones: entrada.lecciones,
      });

      const acciones: Accion[] = [];
      const tools = crearTools(acciones, entrada.piezas);

      // Mapear historial a user/assistant
      const messages: Anthropic.MessageParam[] = entrada.historial
        .filter(t => t.texto)
        .map(t => ({
          role: t.rol === 'lead' ? 'user' : 'assistant',
          content: t.texto,
        }));

      try {
        const runner = cliente.messages.toolRunner({
          model: entrada.modelo,
          max_tokens: 2000,
          system: [
            {
              role: 'system',
              content: sistemaGrande,
              // @ts-expect-error providerOptions es parte del SDK
              providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
            },
            ...(entrada.contactoCtx
              ? [{ role: 'system' as const, content: entrada.contactoCtx }]
              : []),
          ],
          messages,
          tools: Object.values(tools),
          max_iterations: 4,
        });

        // Esperar el resultado (el runner es thenable)
        const resultado = await runner;

        const texto = resultado.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n')
          .trim();

        // Post-proceso: validar salida
        if (texto) {
          const veredicto = validarSalida(texto);
          if (!veredicto.ok) {
            return {
              texto: null,
              acciones: [{ tipo: 'escalar', motivo: 'error_bot' }],
              uso: calcularUso(resultado, entrada.modelo),
            };
          }
        }

        return {
          texto: texto || null,
          acciones,
          uso: calcularUso(resultado, entrada.modelo),
        };
      } catch (err) {
        return {
          error: `El agente falló: ${(err as Error).message}`,
        };
      }
    },
  };
}

function calcularUso(resultado: any, modelo: string) {
  // Acumular usage de todas las steps
  let entrada = 0, salida = 0, cacheEscritura = 0, cacheLectura = 0;
  for (const step of resultado.steps || []) {
    const u = step.usage;
    entrada += u?.input_tokens ?? 0;
    salida += u?.output_tokens ?? 0;
    cacheEscritura += u?.cache_creation_input_tokens ?? 0;
    cacheLectura += u?.cache_read_input_tokens ?? 0;
  }
  return { entrada, salida, cacheEscritura, cacheLectura, modelo };
}
```

**Tests**: `server/src/bot/agente.test.ts`
- Con cliente fake que devuelve texto limpio: respuesta con texto y sin acciones.
- Cliente fake que llama a `mandar_pieza`: la acción aparece en el array.
- Cliente fake que responde con un precio en el texto: guardrail bloquea → texto null + escalar error_bot.
- Cliente fake que dice "soy un bot": guardrail bloquea → texto null + escalar error_bot.
- Cliente fake que lanza error: `{ error }`, nunca throw.

**Prohibido**: llamar a la red en tests; catch silencioso; reintentar por fuera del SDK.

---

## Agente C — Integración (despachador, ingesta, refactor webhook)

**Contexto**: Express, Postgres, Drizzle, `EnvioControlado`, `whatsapp/enviarYProyectar.ts`, el loop de `autorespuesta/`.

**Objetivo**: conectar las piezas puras del Agente B con el mundo real.

### C.1 — Ingesta (`ingesta.ts`)

**Leer primero**: `server/src/db/bot.ts` (las tablas nuevas), `server/src/bot/config.ts` (`ConfigBot`), `server/src/bot/decision.ts` (sin usar aún, es para el despachador).

**Crear**: `server/src/bot/ingesta.ts`

```ts
import { db } from '../db/client.js';
import { botPendientes } from '../db/bot.js';
import type { ConfigBot } from './config.js';
import { eq, sql } from 'drizzle-orm';

/**
 * El webhook llama a esto DESPUÉS de guardar el crudo y entregar al transporte.
 * Solo hace upsert de bot_pendientes con la ventana de debounce.
 * Si la línea no está en la config, no hace nada.
 */
export async function notificarEntrante(
  clave: string,
  numeroPropio: string,
  ahora: Date,
  cfg: ConfigBot,
): Promise<void> {
  if (!cfg.lineas.includes(numeroPropio)) return;

  const procesarDesde = new Date(ahora.getTime() + cfg.bufferSegundos * 1000);

  await db
    .insert(botPendientes)
    .values({
      clave,
      numeroPropio,
      ultimoEntranteEn: ahora,
      procesarDesde,
      creadoEn: ahora,
    })
    .onConflictDoUpdate({
      target: botPendientes.clave,
      set: {
        ultimoEntranteEn: ahora,
        procesarDesde,           // cada mensaje nuevo EMPUJA la ventana
        enProcesoDesde: null,    // si estaba en proceso, se re-encola
      },
    });
}
```

### C.2 — Despachador (`despachador.ts`)

**Leer primero**:
- TODO lo del Agente B (decision.ts, agente.ts, acciones.ts, chunker.ts, prompt.ts)
- `server/src/whatsapp/enviarYProyectar.ts` (cómo se manda un mensaje)
- `server/src/whatsapp/EnvioControlado` (la puerta única)
- `server/src/whatsapp/hilo.ts` (leer historial)
- `server/src/whatsapp/wiring.ts` (gestorWhatsappSiActivo)
- `server/src/autorespuesta/despachador.ts` (el patrón de loop con setInterval)
- `server/src/db/bot.ts` (las 5 tablas)

**Crear**: `server/src/bot/despachador.ts`

Responsabilidades:
1. Loop `setInterval` cada 5 segundos (solo si `cfg.lineas.length > 0`).
2. Claim atómico: `SELECT ... FROM bot_pendientes WHERE procesar_desde <= now() AND en_proceso_desde IS NULL LIMIT 3 FOR UPDATE SKIP LOCKED`.
3. Por cada claim:
   a. Armar `HechosParaDecidir` consultando la DB (pausas, turnos hoy, etc.).
   b. Llamar `decidir()`.
   c. Si `saltar`: borrar pendiente, guardar `bot_respuestas(estado: 'cancelada', motivo)`.
   d. Si `responder`: 
      - Armar historial (últimos 20 del hilo).
      - Armar contexto de contacto (nombre, señales, interés).
      - Armar catálogo (piezas vigentes) + hechos.
      - Llamar `agente.responder()`.
      - Guardar `bot_respuestas` con estado según modo:
        - `sombra`: estado `'sombra'`.
        - `automatico`: re-chequeo → chunker → `EnvioControlado` → estado `'enviada'`.
      - Ejecutar acciones (calificar → upsert `bot_calificaciones`, escalar → pausa + flag, etc.).

**Tests**: el `despachador.test.db.ts` que este plan pedía no se escribió con ese nombre — lo que
cubre estas tres garantías hoy es `server/src/bot/claim.test.ts` (el claim, puro) y
`server/src/bot/orquestador.deps.test.db.ts` (el pipeline contra base, sin transporte).
- Dos claims concurrentes sobre la misma fila → uno solo gana.
- Entrante nuevo durante el proceso → `enProcesoDesde` se resetea y vuelve a encolar.
- Modo sombra: escribe `bot_respuestas` con estado `'sombra'` y NO llama al transporte.

### C.3 — Refactor del webhook (`webhook/whatsapp.ts`)

**Leer primero**: el archivo actual completo.

**Hacer**: modificar `webhook/whatsapp.ts`:

1. **ELIMINAR** líneas 107-148 (todo el bloque del spike bot dentro del webhook).
2. **AGREGAR** después de la entrega al transporte (`linea.transporte.recibirEntrante`):

```ts
// Notificar al despachador del bot (si la línea está habilitada)
import { notificarEntrante } from '../bot/ingesta.js';
import { configDesdeEnv } from '../bot/config.js';

const cfgBot = configDesdeEnv();
if (cfgBot.lineas.includes(numeroLinea)) {
  for (const m of value.messages ?? []) {
    if (!m?.id || !m?.from) continue;
    const clave = `conv:whatsapp:${m.from}:${numeroLinea}`;
    notificarEntrante(clave, numeroLinea, new Date(), cfgBot).catch(err =>
      console.error('[bot] notificarEntrante falló:', (err as Error).message),
    );
  }
}
```

3. ~~**ELIMINAR** el filtro hardcodeado `endsWith('955135507')`. El bot responde a TODOS los mensajes de las líneas en `BOT_LINEAS` (modo sombra por ahora).~~ **HECHO (a7dc724)**: el filtro por remitente no existe; el bot responde a quien sea que escriba a las líneas de `BOT_LINEAS`.

4. **AGREGAR** al contexto del primer mensaje: leer `m.referral.source_id` y/o `m.referral.ctwa_clid` del payload, cruzar con `alias_curso` (tabla que ya existe) para obtener la familia de curso, e inyectarla al texto.

**Prohibido**: 
- Llamar al LLM desde el webhook.
- Enviar respuestas desde el webhook.
- Mantener el código viejo comentado (borrar, no comentar).

### C.4 — Arranque del despachador (`server/src/index.ts`)

**Leer primero**: `server/src/index.ts` (dónde se montan los módulos), `server/src/autorespuesta/` (cómo arranca su loop).

**Hacer**: agregar al `index.ts`:

```ts
import { arrancarDespachador } from './bot/despachador.js';
import { anunciarConfig, configDesdeEnv } from './bot/config.js';

// ... después de montar rutas y antes del listen ...
const cfgBot = configDesdeEnv();
anunciarConfig(cfgBot);
if (cfgBot.lineas.length > 0) {
  arrancarDespachador(cfgBot);
}
```

---

## Plan de ejecución día por día

### HOY — Miércoles 30-jul (quedan ~6 horas)

| Hora | Qué | Quién |
|---|---|---|
| **14:00** | Leer `docs/arquitectura-bot-comercial.md` completo | Orquestador |
| **14:30** | **Agente A.1**: Crear IAM user + cargar credenciales en VPS1 | Orquestador (es trabajo de consola, no de código) |
| **15:00** | **Agente A.2**: Obtener token permanente Cloud API + cargar en VPS1 | Orquestador |
| **15:30** | Verificar: WhatsApp → bot responde. Esperar 1h, volver a probar | Orquestador |
| **16:00** | **Agente A.3**: Migración de las 5 tablas | Subagente Infra |
| **16:30** | Deploy staging → verificar tablas creadas | Orquestador |
| **17:00** | **Agente B.1**: `acciones.ts` (tipos) | Subagente Lógica |
| **17:30** | **Agente B.2**: `decision.ts` + tests | Subagente Lógica |
| **18:00** | Revisar diffs de A.3 y B.1-B.2. Mergear si pasan tests | Orquestador |

**Cierre del día**: credenciales permanentes funcionando + tablas creadas + decision engine con tests verdes.

### JUEVES — 31-jul

| Hora | Qué | Quién |
|---|---|---|
| **09:00** | **Agente B.3**: `chunker.ts` + tests | Subagente Lógica |
| **10:00** | **Agente B.4**: `tools.ts` + tests | Subagente Lógica |
| **11:00** | **Agente B.5**: `prompt.ts` + `contexto.ts` + tests | Subagente Lógica |
| **12:00** | **Agente B.6**: `agente.ts` + tests | Subagente Lógica |
| **13:00** | Revisar todos los diffs del Agente B. Mergear | Orquestador |
| **14:00** | **Agente C.1**: `ingesta.ts` | Subagente Integración |
| **15:00** | **Agente C.3**: Refactor `webhook/whatsapp.ts` | Subagente Integración |
| **16:00** | **Agente C.2**: `despachador.ts` (primera versión, sin EnvioControlado) | Subagente Integración |
| **17:00** | **Agente C.4**: Arranque en `index.ts` | Subagente Integración |
| **18:00** | Deploy staging. Verificar loop + sombra | Orquestador |

**Cierre del día**: el bot corre en staging en modo SOMBRA. Cada mensaje entrante → buffer 25s → el agente piensa → guarda `bot_respuestas`. NADA sale al lead.

### VIERNES — 1-ago

| Hora | Qué | Quién |
|---|---|---|
| **09:00** | Integrar `EnvioControlado` al despachador (modo automático) | Subagente Integración |
| **10:00** | el `despachador.test.db.ts` de C.2 (salió como `claim.test.ts` + `orquestador.deps.test.db.ts`) | Subagente Integración |
| **11:00** | Simulacro `--demo`: 8 casos canónicos | Orquestador |
| **12:00** | Deploy staging. Modo automático en línea de prueba | Orquestador |
| **13:00** | **Sanity check**: mandar 8 mensajes de prueba, verificar respuestas | Orquestador |
| **14:00** | Ajustar prompt/contexto según resultados | Orquestador |
| **15:00** | Deploy producción en modo SOMBRA | Orquestador |
| **16:00** | Dejar corriendo en sombra con tráfico real | — |

**Cierre del día**: bot en producción en modo sombra. La línea de Cloud API recibe mensajes reales, el bot piensa y guarda. Mañana se revisan las respuestas.

### SÁBADO — 2-ago

- Revisar `bot_respuestas` con tráfico real (mínimo 30).
- Clasificar: "está bien" / "está mal" / "bloqueado por guardrail".
- Ajustar prompt y contexto según hallazgos.
- Correr simulacro de nuevo con los ajustes.

### DOMINGO — 3-ago

- Si las métricas de sombra son buenas (< 10 % mal, 0 guardrail violations):
  - Decisión del dueño: ¿prendemos automático?
  - Si sí: UNA línea (Cloud API) a automático.
  - Monitorear 24h.

---

## Verificaciones por agente

Cada subagente, antes de dar su trabajo por terminado:

```bash
# Agente B (lógica pura)
cd server && npx tsc --noEmit && npm test

# Agente A (schema)
cd server && npx tsc --noEmit && npm run db:check && npx tsx --test src/**/journal.test.ts

# Agente C (integración)
cd server && npx tsc --noEmit && npm test && npm run test:db
```

El orquestador, antes de mergear a `main`:
```bash
cd server && npx tsc --noEmit && npm test && npm run test:db
```

---

## Lo que NO se toca (bajo ninguna circunstancia)

- `cola/urgenciaSql.ts` ni tests de paridad
- `autorespuesta/` (salvo para importar `rechazo.ts` y `config.ts`)
- La mitad desconectada del repo (`analisis`, `canales`, `decisions`, `pauta`, `ontologia`, `fuentes`, `sdk`)
- `whatsapp/transporte.ts` (la interfaz `TransporteWhatsapp`)
- `whatsapp/wiring.ts` (el montaje de transportes)
- `EnvioControlado` (se USA, no se modifica)
- `senales/cotizacion.ts` (se USA `montosDelTexto`, no se modifica)
- Tablas existentes en `db/schema.ts`

---

## Variables de entorno (resumen)

```bash
# /srv/hermes/server/.env — lo NUEVO para el bot:

# AWS Bedrock (PERMANENTE — IAM user hermes-bot-bedrock)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
# SIN AWS_SESSION_TOKEN

# WhatsApp Cloud API (PERMANENTE — System User)
WHATSAPP_CLOUD_API_NUMERO_PROPIO=51984429504
WHATSAPP_CLOUD_API_PHONE_NUMBER_ID=1293736303812393
WHATSAPP_CLOUD_API_TOKEN=EAA...  # System user token, no temporal

# Bot
BOT_LINEAS=51984429504
BOT_MODELO=us.anthropic.claude-haiku-4-5-20251001-v1:0  # haiku, no opus (más barato para MVP)
BOT_BUFFER_SEGUNDOS=25
BOT_MAX_TURNOS_DIA=40
BOT_MAX_RESPUESTAS_HORA_LINEA=60
```
