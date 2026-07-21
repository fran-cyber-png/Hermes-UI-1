# Ontología Goberna — diseño

> Fecha: 2026-07-12 · Estado: **propuesto** (pendiente aprobación)
> Reemplaza a `2026-07-11-ontologia-columnas-vivas-design.md`, cuyas premisas centrales no
> sobrevivieron a la verificación empírica (ver §2.4, §2.7 y §2.8).
> Alcance: el modelo canónico de Goberna, poblado en v1 solo con la rebanada digital + Meta
> (Facebook, Instagram, WhatsApp, pauta, landings).

---

## 1. El principio rector

> **Este sistema no existe para tener una "vista 360" de las personas.
> Existe para saber quién compró y poder decírselo a Meta.**

Es lo único con evidencia causal dura. Un experimento aleatorizado con **más de 70.000
anunciantes** (NBER w32765 / *Marketing Science* 2025) midió el precio de no cerrar ese lazo:
el costo mediano por cliente incremental sube de **US$ 38,16 a US$ 49,93 — un 31% más caro**.
El mecanismo está documentado, no inferido: **el evento de conversión que le devuelves a Meta
se usa como la variable dependiente de su modelo de predicción de entrega.** No "ayuda al
algoritmo": *es* lo que el algoritmo intenta predecir.

Una investigación con 109 agentes y verificación adversarial contra fuentes primarias no
encontró **ningún otro mecanismo** de la industria (creative analytics, Triple Whale, Northbeam,
Hyros, ManyChat, speed-to-lead, lead scoring, identity resolution de CDPs, Palantir Foundry)
cuyas afirmaciones sobrevivieran el intento de refutación.

Todo lo demás —fichas de persona, semáforos, columnas vivas— es **interfaz para que un humano
trabaje**. Debe existir. Pero no es lo que hace ganar plata, y no puede gobernar el modelo.

---

## 2. Hechos verificados (probados, no supuestos)

Todo lo de esta sección se verificó contra la Graph API real con nuestro token, o contra
nuestros propios payloads crudos en Postgres. Lo que no se pudo probar está marcado.

### 2.1 Qué nos da Meta, por fuente

| Fuente | Volumen | ¿Sabemos QUIÉN? | ¿Sabemos QUÉ ANUNCIO? |
|---|---|---|---|
| Comentarios FB | 14.736 | **No.** 0 de 30 traen `from` en vivo; 0,6% histórico | Solo si el post está publicado (ver 2.3) |
| Comentarios IG | 2.766 | **Sí.** 99,7% con id + usuario (1.753 personas) | Difícil — solo trae `media_id` |
| Messenger | 76.869 msj | **Sí.** PSID (34.118 personas, `conversation_id` presente) | **Nunca** (ver 2.2) |
| Leads de formulario | 680 | **Sí.** 100% con correo **y** teléfono | **Sí.** 100% con `ad_id`, `adset_id`, `campaign_id` |
| Reacciones | — | **No.** `data: []` siempre; solo `summary.total_count` | — |

**Identidad y atribución son preguntas distintas.** En Meta casi nunca se responden juntas.
El modelo debe tratarlas como tablas separadas; mezclarlas fue el error central del doc anterior.

### 2.2 La atribución del histórico de Messenger está muerta

Ningún mensaje trae `ad_id` ni `referral` — verificado sobre los 76.869. No es un problema de
permisos: la Graph API **no expone `referral` en el objeto `Message`**. El `ad_id` llega
exclusivamente por el webhook `messaging_referrals`, en el momento del primer mensaje.

**Consecuencia: los 76.869 mensajes históricos no son atribuibles a ningún anuncio, nunca.**
Confirmado por cuatro investigaciones independientes. Se asume en el diseño; no se pelea.

### 2.3 El join comentario → post → anuncio

`AdCreative.effective_object_story_id` devuelve `{page_id}_{post_id}`, el mismo formato que el
`contexto_id` de nuestros comentarios. El join es **estructuralmente válido** (probado: los 8
anuncios de leads devuelven el campo con el formato correcto).

Pero dio **0 coincidencias**, porque nuestros anuncios de leads usan **dark posts**
(`is_published: false`, cero comentarios). Los 14.736 comentarios vienen de posts orgánicos o de
anuncios que promocionan posts publicados. **Pendiente de verificar:** barrer los anuncios de
las 19 cuentas y ver cuáles promocionan posts que sí tienen comentarios.

### 2.4 Nuestros dos permisos faltantes bloquean casi todo

`debug_token` sobre el system user real: 32 permisos concedidos. **Faltan dos:**

| Permiso | Qué bloquea |
|---|---|
| **`human_agent`** | La ventana de 7 días de Messenger. Sin él solo existe la ventana estándar de **24 horas** |
| **`page_events`** | El Dataset de Business Messaging → **no hay Conversions API para Messenger/WhatsApp** |

Probado en vivo: `GET /{PAGE_ID}/dataset` → `403: "App does not have page_events permission on the Page"`.

**Consecuencia operativa, y es la más importante de todo el documento:**
de las **34.118 conversaciones de Messenger no le podemos escribir a ninguna**. No por falta de
tiempo ni de gente: porque Meta cerró la ventana y no tenemos la llave. El backlog no es una
cola de trabajo. Es un archivo.

**Lo que sí sigue abierto:** la **respuesta privada a un comentario** (7 días desde su creación,
un solo intento) **no depende de `human_agent`**, y no requiere saber quién es la persona — la
API acepta el `comment_id`. Los comentarios recientes son el único canal con volumen que
realmente podemos trabajar hoy.

### 2.5 El lazo hacia Meta: qué se puede cerrar hoy

| Vía | Requiere | ¿Disponible hoy? |
|---|---|---|
| **CAPI estándar con `lead_id`** | Solo el token actual. `lead_id` va **sin hashear** | **Sí** |
| CAPI Business Messaging (Messenger) | `page_events` + Dataset. Clave: `page_id` + `page_scoped_user_id` | No |
| CAPI Business Messaging (WhatsApp) | `page_events` + Dataset + webhooks. Clave: `ctwa_clid` | No |

Los 680 leads pueden cerrar el círculo **esta semana, sin App Review, sin hashear nada.**

### 2.6 Otros hechos que corrigen al doc anterior

- **La retención de Custom Audiences no es 365 días uniformes.** Página de Facebook: **730 días**.
  Instagram: **730**. **Lead Ads: 90.** Likes de página: **0**.
- **La Offline Conversions API está muerta** (sunset mayo 2025). Su página de documentación
  sigue viva y sin aviso de deprecación.
- **La Conversations API solo devuelve detalle de los 20 mensajes más recientes** por conversación.
  Nuestro máximo observado es 25, lo cual se explica por ingestas sucesivas que fueron
  acumulando. **Pendiente de verificar:** si una conversación larga se ingesta por primera vez,
  perdemos todo lo anterior a sus últimos 20 mensajes.
- **Las reacciones y comentarios requieren Page Access Token**, no basta el system user token
  ("new Pages experience"). El código ya lo hace bien.

### 2.7 El bug que nadie vio: tiramos nuestras propias respuestas

`interactionsIngestor.ts:111-113` descarta explícitamente los mensajes salientes de la página
antes de guardarlos. Verificado: **cero filas con `from.id` = page_id**.

La base **no sabe si alguna vez le respondimos a alguien**. Todo relato sobre "N personas
esperando respuesta" es hoy indemostrable con nuestros datos.

### 2.8 Lo que se cayó del doc anterior

- **El "×21 del speed-to-lead" es folklore.** Rastrea a InsideSales.com (un vendedor de software
  de ventas). El estudio serio (HBR 2011) es correlacional, no peer-reviewed, y no descarta la
  causalidad inversa. **Cero réplicas académicas independientes.** No existe ningún estudio
  sobre WhatsApp o redes sociales.
  → **La urgencia sigue siendo real, pero por una razón verificable: la ventana de Meta se cierra.**
- **El event sourcing no tiene respaldo.** Fowler: *"for most systems CQRS adds risky complexity"*.
  Ninguna de las cuatro plataformas de referencia (Chatwoot, Zulip, Mattermost, Discourse) lo usa.

---

## 3. La frontera legal (leer antes de escribir código)

**Platform Terms 3.a.v** prohíbe:
> *"Processing Platform Data without valid User consent in order to build or augment user
> profiles for any purpose."*

**Developer Policies 10.7.e**: *"Don't use Meta's data to build or augment any user profiles."*

Una tabla `personas` que agrega gente sacada de la API de Meta **es la actividad que esa
cláusula describe**. La línea pasa por el **consentimiento y la relación de negocio**:

| Grupo | Situación | Veredicto |
|---|---|---|
| Los 680 leads | Entregaron correo y teléfono en un formulario, con política de privacidad | **Permitido.** Es dato de primera parte; es el propósito literal de Lead Ads |
| Los 34.118 de Messenger | Nos escribieron. Hay relación de negocio | **Defendible.** Es el uso previsto del Business Messaging |
| Comentaristas y reaccionantes | Solo comentaron un post público. Nunca nos hablaron | **Prohibido** construirles un perfil persistente |

**Reglas que se derivan y son vinculantes para el modelo:**

1. **No se crea `persona` a partir de un comentario o una reacción.** El comentarista de FB es
   anónimo de todos modos; el de Instagram **no se promueve a persona** salvo que también nos
   escriba en privado o entregue sus datos.
2. **El backlog frío no se perfila.** Las Engagement Custom Audiences las construye Meta desde
   sus propios datos: le decimos "gente que interactuó con la página en los últimos N días" y las
   arma sola. **No necesitamos guardar a esas personas para retargetearlas.**
3. **Prohibido exportar fuera de Meta** (10.7.c: no retargeting fuera de la plataforma;
   10.7.d: no mezclar datos de Meta con campañas de otras plataformas).
4. **Data Deletion Callback obligatorio** (3.d). Hoy no existe. Hay que implementarlo.
5. **Prohibido re-identificar o de-anonimizar** (3.a.vi).

---

## 4. Las tres capas

| Capa | Qué contiene | Regla |
|---|---|---|
| **0 — Bitácora de ingesta** | El JSON crudo de Meta, tal como llegó | Inmutable. Nunca se lee para operar, solo para auditar y re-derivar |
| **1 — Hechos** | Lo que pasó: timestamps, textos, direcciones, conteos | Inmutable, sin opinión. *"El 3/3 a las 14:02 escribió: ¿cuánto cuesta?"* |
| **2 — Inferencias** | Lo que un modelo cree: etapa, score, intención, objeción | Tabla aparte, **con versión de modelo, confianza y fecha**. Se reescribe sin tocar el hecho |

**Esta separación no es negociable.** Si se mezclan, en seis meses nadie puede distinguir qué
pasó de lo que un modelo creyó que pasaba — y ese es el mecanismo exacto por el que alguien que
sí quería comprar termina enterrado en una columna que dice "no calificado".

**Aclaración importante:** la capa 0 **no es event sourcing**. El estado no se deriva
reproduciendo eventos; vive en tablas normales, como en cualquier sistema sano. La capa 0 es un
archivo, no una arquitectura. Se queda porque es barata y porque es lo que nos permitió auditar
la verdad hoy.

---

## 5. Modelo de datos

### 5.1 Capa 0 — Ingesta

```sql
-- Ya existe. Se mantiene tal cual (source, external_id, occurred_at, payload jsonb,
-- UNIQUE(source, external_id)). Se renombra conceptualmente a "bitácora", no a "event store".
-- ÚNICO CAMBIO: la ingesta deja de descartar los mensajes salientes de la página (§2.7).
```

### 5.2 El camino del dinero — la pauta

```sql
-- Hoy se lee en vivo de Meta en cada carga de pantalla. Pasa a estar proyectado en Postgres.
CREATE TABLE cuentas_ads (
  id            text PRIMARY KEY,          -- act_XXXX
  nombre        text NOT NULL,
  pais          text,                      -- se infiere del nombre; verificable
  actualizado_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campanas (
  id            text PRIMARY KEY,
  cuenta_id     text NOT NULL REFERENCES cuentas_ads(id),
  nombre        text NOT NULL,
  objetivo      text,
  estado        text,                      -- estado OPERATIVO de Meta: ACTIVE|PAUSED|...
  actualizado_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conjuntos (
  id            text PRIMARY KEY,
  campana_id    text NOT NULL REFERENCES campanas(id),
  nombre        text NOT NULL,
  estado        text,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE anuncios (
  id            text PRIMARY KEY,
  conjunto_id   text NOT NULL REFERENCES conjuntos(id),
  nombre        text NOT NULL,
  estado        text,
  -- El puente hacia los comentarios (§2.3):
  post_id       text,                      -- effective_object_story_id: {page_id}_{post_id}
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON anuncios (post_id);

-- La publicación: contexto de los comentarios Y objeto que un anuncio promociona.
CREATE TABLE publicaciones (
  id                text PRIMARY KEY,      -- {page_id}_{post_id}
  page_id           text NOT NULL,
  publicado         boolean,               -- false = dark post (no recibe comentarios)
  permalink         text,
  -- Reacciones: NO son entidades. Meta no dice quién. Son un contador. (§2.1)
  reacciones_total  int,
  comentarios_total int,
  contadores_at     timestamptz,           -- cuándo se refrescaron los contadores
  creado_at         timestamptz
);
```

**Nota sobre reacciones:** probado en vivo sobre 3 posts (30, 6.134 y 13.867 reacciones):
`data` viene siempre vacío. **Una reacción es un número en `publicaciones`, no una fila con
identidad.** No hay tabla `reacciones` y no la va a haber.

### 5.3 Personas e identidad

```sql
-- Delgada a propósito. El id es estable: /persona/:id nunca se rompe.
CREATE TABLE personas (
  id             bigserial PRIMARY KEY,
  nombre_display text,                     -- derivado: lead.full_name > nombre Messenger > usuario IG
  creado_at      timestamptz NOT NULL DEFAULT now()
);

-- Una fila por rastro conocido. Fuentes nuevas = tipos nuevos, sin remodelar.
CREATE TABLE identidades (
  id            bigserial PRIMARY KEY,
  tipo          text NOT NULL,             -- 'email'|'telefono'|'psid'|'ig_user'|'wa_id'|'lead_id'
  valor         text NOT NULL,             -- YA NORMALIZADO (ver 6.1)
  fuerza        text NOT NULL,             -- 'fuerte' | 'debil'  (ver 6.2)
  UNIQUE (tipo, valor)
);

-- LA ARISTA REVERSIBLE. Esto es lo que Segment no tiene.
CREATE TABLE vinculos_identidad (
  id            bigserial PRIMARY KEY,
  identidad_id  bigint NOT NULL REFERENCES identidades(id),
  persona_id    bigint NOT NULL REFERENCES personas(id),
  regla         text NOT NULL,             -- 'lead_form' | 'telefono_en_texto' | 'manual' ...
  evidencia     jsonb NOT NULL,            -- el dato exacto que lo justificó
  actor         text NOT NULL,             -- 'sistema' | 'operador:{id}'
  confianza     text NOT NULL,             -- 'alta' | 'media' | 'baja'
  creado_at     timestamptz NOT NULL DEFAULT now(),
  revocado_at   timestamptz,               -- des-fusionar = revocar, no borrar
  revocado_por  text,
  revocado_motivo text
);
CREATE UNIQUE INDEX ON vinculos_identidad (identidad_id) WHERE revocado_at IS NULL;

-- Claves basura que NUNCA fusionan (un solo informes@ puede fusionar 300 personas).
CREATE TABLE identidades_bloqueadas (
  tipo   text NOT NULL,
  valor  text NOT NULL,
  motivo text NOT NULL,
  PRIMARY KEY (tipo, valor)
);
```

**Por qué la arista reversible no es opcional para nosotros:** Segment, textual, en su FAQ:
*"No. As the Identity Graph uses external IDs, they remain for the lifetime of the user profile."*
Hightouch: *"There is no undo or unmerge button."* Ninguno de los CDPs líderes puede des-fusionar.
Y nosotros **vamos a fusionar mal, garantizado**: en Perú el teléfono compartido en familia, la
cabina de internet y la secretaria de un colegio escribiendo por varios postulantes son el día a
día, no la excepción. Nuestro único puente entre canales es un número tipeado a mano en un chat.

### 5.4 Conversaciones

La unidad de trabajo es el **hilo**, no el mensaje. Los 76.869 mensajes de Messenger son 34.118
conversaciones (mediana: 2 mensajes por persona). Poner el estado de atención en cada mensaje
—como hacía el doc anterior— infla la cola por diseño y hace que ningún contador diga la verdad.

```sql
CREATE TABLE operadores (
  id       bigserial PRIMARY KEY,
  nombre   text NOT NULL,
  activo   boolean NOT NULL DEFAULT true
);

CREATE TABLE hilos (
  id              bigserial PRIMARY KEY,
  canal           text NOT NULL,           -- 'messenger'|'ig_dm'|'whatsapp'|'comentarios_fb'|'comentarios_ig'
  external_id     text NOT NULL,           -- conversation_id | comment_id raíz | wa_id
  persona_id      bigint REFERENCES personas(id),   -- NULL en comentarios de FB (§3.1)
  publicacion_id  text REFERENCES publicaciones(id), -- solo hilos de comentarios

  -- LA VENTANA: calculada del mecanismo REAL de Meta, no de una regla inventada.
  mecanismo_ventana text,                  -- 'estandar_24h' | 'respuesta_privada_7d' | 'human_agent_7d'
  ventana_cierra_at timestamptz,
  intentos_privados_restantes int,         -- respuesta privada a comentario: exactamente 1

  estado          text NOT NULL DEFAULT 'nuevo',  -- nuevo|en_proceso|resuelto|cerrado_por_ventana
  asignado_a      bigint REFERENCES operadores(id), -- advisory, sin locking (ver 7.3)
  ultima_actividad_at timestamptz NOT NULL,
  creado_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canal, external_id)
);
CREATE INDEX ON hilos (estado, ventana_cierra_at);
CREATE INDEX ON hilos (persona_id);

CREATE TABLE mensajes (
  id            bigserial PRIMARY KEY,
  hilo_id       bigint NOT NULL REFERENCES hilos(id),
  external_id   text NOT NULL UNIQUE,
  tipo          text NOT NULL,             -- 'mensaje_privado'|'comentario_publico'|'respuesta_privada'
  direccion     text NOT NULL,             -- 'entrante' | 'saliente'   ← el bug de §2.7
  -- LA VARIABLE DE MAYOR IMPACTO DOCUMENTADO, y hoy nadie la registra:
  autor         text NOT NULL,             -- 'persona' | 'operador' | 'bot'
  operador_id   bigint REFERENCES operadores(id),
  texto         text,
  occurred_at   timestamptz NOT NULL
);
CREATE INDEX ON mensajes (hilo_id, occurred_at);
```

**Sobre `autor = 'bot'`:** revelar que un interlocutor es un bot **reduce las compras un 79,7%**
(Luo, Tong, Fang & Qu, 2019, *Marketing Science* — experimento de campo, 6.200 clientes reales,
datos transaccionales). Es el efecto más grande y mejor identificado de toda la literatura de
conversión. **Sin registrar quién respondió, ni siquiera podemos medir el costo de nuestra propia
honestidad.** El campo es obligatorio; qué se hace con él es una decisión de negocio, no técnica.

### 5.5 Leads

```sql
-- Entidad TRANSITORIA (patrón Dataverse): tiene sus PROPIOS email/teléfono, no una FK.
-- La persona se resuelve después. Un lead llega con datos sueltos antes de que sepamos quién es.
ALTER TABLE leads ADD COLUMN persona_id bigint REFERENCES personas(id);
-- (leads ya tiene: lead_id UNIQUE, email, phone, full_name, ad_id, adset_id, campaign_id, platform)
```

### 5.6 Atribución — tabla propia, separada de identidad

```sql
CREATE TABLE atribuciones (
  id            bigserial PRIMARY KEY,
  sujeto_tipo   text NOT NULL,             -- 'lead' | 'hilo' | 'persona'
  sujeto_id     bigint NOT NULL,
  anuncio_id    text REFERENCES anuncios(id),

  mecanismo     text NOT NULL,             -- ver tabla abajo
  confianza     text NOT NULL,             -- 'exacta' | 'inferida'
  evidencia     jsonb NOT NULL,
  creado_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON atribuciones (anuncio_id);
CREATE INDEX ON atribuciones (sujeto_tipo, sujeto_id);
```

| Mecanismo | Confianza | Disponibilidad |
|---|---|---|
| `lead_form` | exacta | **Hoy.** Meta lo da en el lead |
| `referral_webhook` | exacta | Solo hacia adelante, con webhooks (Messenger/IG) |
| `ctwa_clid` | exacta | Solo hacia adelante, con webhooks (WhatsApp). **Falta seguido**, por diseño |
| `post_promocionado` | **inferida** | Comentario → post → anuncio. Requiere post publicado |
| *(ninguno)* | — | El histórico de Messenger. **No se inventa atribución.** |

**No hay mecanismo probabilístico.** No hay modelo multi-touch. La razón es dura: Gordon,
Zettelmeyer, Bhargava & Chapsky (2019, *Marketing Science*) compararon los métodos
observacionales —la familia que sustenta toda la atribución multi-touch— contra 15 experimentos
aleatorizados en Facebook (500M de observaciones): **se equivocan por un factor de ~3× en la
mitad de los casos.** Un dashboard de atribución multi-touch da números precisos y falsos.

**Esto simplifica el diseño en vez de complicarlo:** el lazo de CAPI **no necesita atribución**.
Le decimos a Meta *"esta persona compró"* y su optimizador —que sí tiene el experimento
aleatorizado adentro— hace el resto.

### 5.7 Conversiones — la tabla que justifica el proyecto

```sql
CREATE TABLE conversiones (
  id              bigserial PRIMARY KEY,
  persona_id      bigint REFERENCES personas(id),
  lead_id         text,                    -- para el atajo de CAPI (va SIN hashear)
  hilo_id         bigint REFERENCES hilos(id),

  tipo            text NOT NULL,           -- 'LeadSubmitted'|'QualifiedLead'|'Purchase'
  valor           numeric,
  moneda          text,                    -- 'PEN'|'MXN'|'USD'...
  ocurrido_en     timestamptz NOT NULL,
  registrado_por  text NOT NULL,           -- 'operador:{id}' | 'sistema'

  -- El envío a Meta:
  dataset_id      text,                    -- pixel_id (estándar) o dataset_id (messaging)
  idempotency_key text NOT NULL UNIQUE,    -- también sirve como event_id para dedup
  enviado_at      timestamptz,
  meta_respuesta  jsonb,
  intentos        int NOT NULL DEFAULT 0,
  ultimo_error    text
);
CREATE INDEX ON conversiones (enviado_at) WHERE enviado_at IS NULL;
```

Esta es la razón de ser del sistema. Todo lo demás la alimenta.

### 5.8 Capa 1 — El log de hechos

```sql
-- Append-only. Registra el CAMINO, no solo el punto. Ninguna columna `estado` puede darte esto.
CREATE TABLE hechos (
  id            bigserial PRIMARY KEY,
  persona_id    bigint REFERENCES personas(id),
  hilo_id       bigint REFERENCES hilos(id),
  actividad     text NOT NULL,             -- verbo_sustantivo, desde la perspectiva de la persona
  ocurrido_en   timestamptz NOT NULL,
  actor         text NOT NULL,             -- 'persona' | 'operador:{id}' | 'sistema' | 'bot'
  anuncio_id    text REFERENCES anuncios(id),
  payload       jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ON hechos (persona_id, ocurrido_en);
CREATE INDEX ON hechos (actividad, ocurrido_en);
```

Vocabulario inicial (se amplía, nunca se renombra):
`comento_publicacion`, `envio_mensaje`, `compartio_telefono`, `compartio_email`,
`envio_formulario`, `recibio_respuesta`, `pregunto_precio`, `pregunto_fechas`,
`pregunto_certificacion`, `expreso_compromiso`, `menciono_objecion`, `se_matriculo`.

Los hechos de contenido (`pregunto_precio`, `menciono_objecion`) guardan **el texto literal** en
`payload`, no una interpretación. *"Está caro"* se guarda como el texto que dijo, no como
"objeción de precio" — eso es inferencia y va en la capa 2.

### 5.9 Capa 2 — Inferencias

```sql
CREATE TABLE inferencias (
  id            bigserial PRIMARY KEY,
  sujeto_tipo   text NOT NULL,             -- 'persona' | 'hilo' | 'mensaje'
  sujeto_id     bigint NOT NULL,
  tipo          text NOT NULL,             -- 'intencion' | 'objecion' | 'score' | 'etapa'
  valor         jsonb NOT NULL,
  modelo        text NOT NULL,             -- qué lo produjo
  modelo_version text NOT NULL,
  confianza     numeric,
  creado_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON inferencias (sujeto_tipo, sujeto_id, tipo);
```

Ninguna inferencia tiene autoridad sobre un hecho. La UI debe mostrarlas como lo que son.

### 5.10 Infraestructura

```sql
CREATE TABLE configuracion (            -- deja de vivir en localStorage
  clave  text PRIMARY KEY,
  valor  jsonb NOT NULL,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sincronizaciones (         -- los `fetch failed` dejan de perderse en un log
  fuente        text PRIMARY KEY,
  cursor        text,
  ultima_ok     timestamptz,
  ultimo_error  text,
  duracion_ms   int
);
```

---

## 6. Resolución de identidad

### 6.1 Normalización (antes de cualquier comparación)

| Tipo | Normalización |
|---|---|
| `email` | trim + minúsculas |
| `telefono` | E.164, con código de país. Sin espacios, guiones, paréntesis ni ceros iniciales |
| `psid`, `ig_user`, `wa_id`, `lead_id` | tal cual (son opacos) |

**Nunca se compara un valor sin normalizar.** La normalización es parte de la clave.

### 6.2 Fuerza de la identidad — la regla que evita el desastre

| Fuerza | Tipos | Puede fusionar sola |
|---|---|---|
| **Fuerte** | `email` y `telefono` provenientes de un **formulario** (lead o landing), `lead_id` | **Sí** |
| **Débil** | `psid`, `ig_user`, `wa_id`, y **`telefono`/`email` extraídos del texto de un mensaje** | **No, nunca** |

Una identidad débil **vincula pero no fusiona**: crea persona si no existe ninguna, pero **jamás
une dos personas preexistentes**. Solo una identidad fuerte tiene autoridad para colapsar dos
fichas en una.

### 6.3 El puente cross-canal (y su peligro)

No existe ninguna clave dura común entre Messenger (PSID), Instagram (IG id) y los leads
(correo/teléfono). El **único** puente real: el **23,7%** de las interacciones (22.325) tiene un
patrón de teléfono escrito en el texto, y el **4,4%** un correo.

**Ese puente es de fuerza débil, y con razón.** El regex de teléfono va a capturar DNI, precios,
años y códigos de curso. Un teléfono extraído de un texto:
- **puede** crear una persona nueva y adjuntarse a ella,
- **puede** proponer una fusión que un operador confirma,
- **no puede** fusionar dos personas automáticamente.

Toda fusión propuesta y no confirmada vive como sugerencia, no como hecho.

### 6.4 Des-fusión

Revocar la arista (`vinculos_identidad.revocado_at`), no borrar filas. Las identidades y el
historial quedan; solo se corta el vínculo. Es reversible y auditable por construcción.

### 6.5 Quién NO es persona

- **Comentarista de Facebook**: `persona_id = NULL`. Es anónimo (0 de 30 en vivo). Sin personas fantasma.
- **Comentarista de Instagram**: **no se promueve a persona** solo por comentar (§3, regla 1).
  Se guarda su `ig_user` como identidad *huérfana*; se convierte en persona si además nos escribe
  en privado o entrega sus datos.
- **Quien reacciona**: no existe. Meta no nos dice quién.
- **La propia página**: se excluye explícitamente.

---

## 7. Ventanas, estados y trabajo

### 7.1 Las ventanas son de Meta, no nuestras

```
hilo de Messenger        → ventana estándar: 24 h desde el último mensaje ENTRANTE
                           (7 días SOLO si Meta aprueba `human_agent`)
hilo de comentarios FB   → respuesta privada: 7 días desde la creación del comentario,
                           UN solo intento. No requiere `human_agent`.
lead (correo/teléfono)   → sin ventana. El correo y el teléfono no expiran.
```

`ventana_cierra_at` se calcula del mecanismo, no de una regla inventada. Cuando pasa, el hilo va
a `cerrado_por_ventana` — que no es una acusación, es un hecho de Meta.

### 7.2 Estados

```
hilo:  nuevo ──▶ en_proceso ──▶ resuelto
         │            │
         └────────────┴──▶ cerrado_por_ventana   (automático, cuando Meta cierra la puerta)
```

**El filtro para cualquier estado nuevo:**
> *Si la etapa puede avanzar sin que la persona se haya comprometido, no es una etapa.*

"Le mandamos un mensaje" no es progreso. "Nos dio su teléfono" sí.

**La cola accionable** = hilos con `estado IN ('nuevo','en_proceso')` **y** `ventana_cierra_at > now()`,
ordenados por vencimiento. Por la aritmética de §2.4, esa cola va a ser **chica** — decenas, no
decenas de miles. No porque escondamos nada, sino porque Meta ya cerró casi todo.

### 7.3 Asignación: advisory, sin locking

Ninguna de las cuatro plataformas de referencia usa locking. El `assignee` de Chatwoot es
puramente advisory (issue #12079 abierto: cualquier agente puede responder una conversación
asignada a otro). La industria vive con la carrera de condición.

**Con 1-2 personas atendiendo, asignación advisory + UI en vivo (polling 30 s) alcanza.**
El locking real es sobreingeniería hasta demostrar lo contrario.

---

## 8. El lazo hacia Meta

### 8.1 Fase 1 — Los 680 leads (sin permisos nuevos)

```
POST /{pixel-id}/events
{ "event_name": "QualifiedLead" | "Purchase",
  "event_time": <unix>,
  "action_source": "system_generated",
  "event_id": <idempotency_key>,
  "user_data": { "lead_id": "<lead_id de Meta>" },     ← SIN hashear. Meta correlaciona server-side.
  "custom_data": { "value": 1200, "currency": "PEN" } }
```

Se puede hacer **hoy**. Es lo único con valor causal probado.

### 8.2 Fase 2 — Mensajería (requiere `page_events`)

```
POST /{PAGE_ID}/dataset          → una vez, obtiene DATASET_ID
POST /{DATASET_ID}/events
{ "action_source": "business_messaging",
  "messaging_channel": "messenger",
  "user_data": { "page_id": "...", "page_scoped_user_id": "<PSID>" },
  "custom_data": { "value": 1200, "currency": "PEN" } }
```

Para WhatsApp la clave es **`ctwa_clid`**, no el teléfono. Va sin hashear.

### 8.3 Reglas del envío

- **Idempotencia obligatoria.** `idempotency_key` es también el `event_id` (dedup de 48 h en Meta).
- **Nunca se manda una conversión sin `enviado_at` registrado.** Si Meta falla, se reintenta;
  el estado del envío es un hecho, no una suposición.
- **El Event Match Quality no es un KPI de tablero.** La comunidad técnica lo trata como señal
  diagnóstica gameable, no como objetivo a maximizar. Se registra, no se persigue.

---

## 9. Acciones (la única idea que se roba de Palantir)

Toda mutación pasa por una **acción nombrada**: una función que valida, ejecuta, escribe el
hecho y registra al actor. No hay `UPDATE` sueltos en las rutas.

| Acción | Valida | Escribe |
|---|---|---|
| `responderHilo` | ventana abierta; intentos restantes > 0 | mensaje (saliente, con `autor`), hecho, estado |
| `resolverHilo` | hilo no cerrado por ventana | estado, hecho |
| `registrarConversion` | persona o lead existe; valor > 0 | conversión, hecho; encola envío a Meta |
| `fusionarPersonas` | **identidad fuerte** de por medio | vínculos, hecho, auditoría |
| `desfusionarPersonas` | vínculo existe y no está revocado | revocación, hecho |
| `archivarPorVentana` | ventana vencida | estado, hecho (job, no manual) |

Esto es disciplina, no infraestructura. Es gratis y es lo más valioso del modelo de Foundry.

---

## 10. Lo que NO se modela (y por qué)

**Por evidencia negativa:**
- **Atribución multi-touch / modelos probabilísticos** — se equivocan por ~3× (§5.6).
- **Lead scoring como campo capturado** — es inferencia. Va en capa 2, si acaso.
- **Etapas de embudo (TOFU/MOFU/BOFU)** — sus propios defensores admiten que no son un proceso
  observable, sino una narrativa impuesta después.

**Por límite técnico probado:**
- **Reacciones como entidad** — Meta no dice quién (§2.1).
- **Personas a partir de comentarios de Facebook** — son anónimos.
- **Atribución retroactiva de Messenger** — no existe y no va a existir (§2.2).

**Por frontera legal (§3):**
- Perfiles de gente que solo comentó o reaccionó.
- Exportación de datos de Meta fuera de Meta.

**Por YAGNI:**
- TikTok, referidos, eventos presenciales, email marketing. *"Because the model describes
  reality, teams are tempted to model all of it before shipping anything. Those projects tend to
  die after a year."* (Thoughtworks)
- **Venta, Alumno y Curso**: el modelo los absorbe como tipos nuevos sin remodelar (`conversiones`
  ya tiene el hueco). Se construyen cuando se conecte la fuente, no antes.

**Con reserva explícita:**
- **Comment-to-DM automatizado.** Técnicamente posible, pero el riesgo de ban está documentado
  (foro oficial de ManyChat, ocho hilos, cuentas de Instagram deshabilitadas por
  *"bot-like behavior"*). El propio límite de ManyChat —12 solicitudes cada 60 segundos— **no
  alcanzó** en varios casos reportados. Si se construye, con límites más conservadores y con la
  conciencia de que se está apostando la cuenta de Instagram.

---

## 11. Orden de construcción

El orden anterior empezaba por la bandeja. Con lo que sabemos, eso es empezar por el cementerio.

| # | Qué | Por qué primero | Bloqueado por |
|---|---|---|---|
| **1** | **Cerrar el lazo con los 680 leads** (CAPI + `lead_id`) | Único mecanismo con valor causal probado. No requiere permisos nuevos | — |
| **2** | **Pedir `human_agent` y `page_events`** (App Review + Business Verification) | Es trámite, no código, y bloquea casi todo lo demás. Empezar hoy | Meta |
| **3** | **Arreglar la ingesta**: guardar los mensajes salientes | Sin esto no sabemos a quién le respondimos (§2.7) | — |
| **4** | **Webhooks** (Messenger, IG, WhatsApp) | La atribución **solo existe hacia adelante**. Cada día sin webhooks son conversaciones que nacen huérfanas | — |
| **5** | Personas + identidades + vínculos reversibles | La base del resto | — |
| **6** | Hilos + mensajes + ventanas reales | La bandeja que sí se puede trabajar | (2) para Messenger |
| **7** | Publicaciones + join comentario→anuncio | Qué creativo genera conversación | Verificar §2.3 |
| **8** | UI: bandeja, ficha de persona, tablero | Interfaz. Va última a propósito | — |

---

## 12. Verificación

**Antes de dar por buena cualquier pieza:**

- **Normalización e identidad** (`node:test`, funciones puras): E.164 con los 6 países;
  identidad débil **no** fusiona dos personas preexistentes (test que debe fallar si alguien lo
  relaja); identidades bloqueadas nunca fusionan; des-fusión restaura el estado previo.
- **Ventanas** (reloj inyectado): 23 h abre / 25 h cierra en Messenger; 6 días abre / 8 cierra en
  respuesta privada; el segundo intento de respuesta privada **falla**; los leads nunca vencen.
- **Idempotencia del lazo**: mandar la misma conversión dos veces produce un solo evento en Meta.
- **Contra la realidad**: cada número de pantalla contrastado contra SQL directo. Cada afirmación
  sobre lo que Meta devuelve, probada contra la API real — **como se hizo para este documento.**

**Criterios de éxito del incremento:**
1. Una conversión registrada en el sistema **aparece en el Events Manager de Meta**.
2. La cola accionable es **finita y verdadera**: solo hilos con ventana abierta.
3. Se puede responder a alguien y **el estado sobrevive a recargar la página** (hoy no).
4. Se puede ver, de una persona, todo lo que dijo — **incluyendo lo que le respondimos** (hoy no).
5. **Cero llamadas a Meta al cargar cualquier pantalla.**
6. Una fusión equivocada **se puede deshacer** sin perder datos.

---

## 13. Preguntas abiertas (honestas)

1. **¿Meta aprueba `human_agent`?** Si no, el 100% del histórico de Messenger es inalcanzable de
   forma permanente y la única salida es publicidad. Todo el plan de bandeja depende de esto.
2. **¿Cuántos de los 14.736 comentarios están sobre posts promocionados?** Define si el join
   comentario→anuncio sirve de algo (§2.3). Es un barrido de las 19 cuentas.
3. **¿Qué hacemos con el bot?** Revelarlo cuesta el 79,7% de las ventas; no revelarlo es engañar.
   El sistema registra el campo de cualquier forma. La decisión es del negocio.
4. **¿Sirve responder rápido en nuestro canal?** No hay evidencia científica para WhatsApp ni
   redes. **Tenemos los datos para medirlo nosotros** — y eso vale más que citar a un vendedor.
