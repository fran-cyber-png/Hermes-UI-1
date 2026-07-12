# El mundo Goberna

> **Qué es esto.** Una descripción del mundo real de Goberna tal como se verificó el 2026-07-12,
> no como alguien lo imaginó. Cada hecho lleva **cómo se comprobó**. Lo que no se comprobó está
> marcado como hipótesis.
>
> **Qué NO es.** No es un plan, no es un spec, no es una propuesta. Es un mapa.
>
> **Para qué sirve.** Para que quien llegue después —persona o máquina— no vuelva a creer las
> mismas cosas falsas. La sección más valiosa de este documento no es §6 (lo que sabemos): es
> **§7 (lo que creíamos y era falso)**.

---

## 1. El negocio, en una frase

Goberna vende **cursos y diplomados de formación política** (marketing electoral, consultoría
política, inteligencia y contrainteligencia, oratoria, gestión parlamentaria) a adultos en
**seis países de LATAM** (Perú, México, Chile, Bolivia, Colombia, Ecuador), captando gente casi
enteramente por **Meta Ads**.

Es una compra de **alta consideración**: precio medio-alto, decisión lenta, mediada por
conversación humana. **No se vende sola.**

---

## 2. El camino del dinero (verificado)

```
Anuncio de Meta
      │
      ├─→ Comentario en un post          (14.736 FB · 2.766 IG)
      ├─→ Mensaje de Messenger           (76.869 msj · 34.118 personas)
      ├─→ Formulario de Lead Ads         (680 leads)
      ├─→ Landing propia                 (→ Google Sheet + Bravo)
      └─→ Tienda WooCommerce             (grupogoberna.com)
      │
      ▼
   WhatsApp  ←── el 61% de las ventas se cierra acá
      │
      ▼
   Cerberus (el ERP)  ←── acá vive la VENTA. 5.134 ventas · 4.729 pagadas
      │
      ├─→ Moodle / goberna-escuela  ←── acá vive "estudió"
      └─→ certificaciones-goberna    ←── acá vive "se certificó"
      │
      ▼
   ¿Meta se entera?  ──→ NO. Cero eventos `Purchase` en 24 h.
```

**El lazo está roto en el último paso.** Meta paga por traer gente y **nunca se entera de quién
compró**. Optimiza contra "alguien abrió un chat", no contra "alguien pagó".

---

## 3. Los objetos del mundo

Solo entran los que existen. Los que se inventaron y no existían están en §7.

| Objeto | Dónde vive | Volumen real | Identidad disponible |
|---|---|---|---|
| **Persona** | *No existe.* Es lo que hay que construir | — | Fragmentada en 6 sistemas |
| **Cliente** (compró) | Cerberus `tb_cliente` | 3.553–5.657 | Correo 99,5% · Teléfono 100% |
| **Venta** | Cerberus `tb_venta` | 5.134 (4.729 pagadas) | Ligada a Cliente |
| **Pago** | Cerberus `tb_pago` | 5.255 | Voucher + confirmación humana |
| **Cuota** | Cerberus `tb_cuotas` | 8.400 | 9,9% de las ventas son en cuotas |
| **Lead de formulario** | meta-escuela `leads` | 680 | Correo **y** teléfono, 100% |
| **Lead de landing** | Bravo + Google Sheet | ? | Correo + teléfono |
| **Mensaje de Messenger** | meta-escuela `interactions` | 76.869 | PSID (34.118 personas) |
| **Comentario FB** | meta-escuela `interactions` | 14.736 | **Anónimo (0,4%)** |
| **Comentario IG** | meta-escuela `interactions` | 2.766 | Usuario IG (99,7%) |
| **Reacción** | *No es un objeto.* Meta solo da el conteo | — | **Ninguna** |
| **Anuncio** | Meta Graph API | 12.100 en 24 cuentas | — |
| **Alumno** | Moodle + goberna-escuela | miles | `moodle_user_id`, correo |
| **Certificado** | certificaciones-goberna | cientos | `codigo_verificacion` |

**No hay ninguna clave común entre canales.** Ni PSID = correo, ni IG id = teléfono. La
unificación **no puede ser automática**.

**El único puente real** entre Messenger y las ventas: el **23,7% de las interacciones tiene un
teléfono escrito en el texto** (y 97 de cada 100 son teléfonos de verdad). La gente escribe su
número en el chat.

---

## 4. Los sistemas (diez, y tres están vivos y creciendo)

| Sistema | Qué es | Estado real |
|---|---|---|
| **Cerberus** | ERP en Django/MySQL. **10 apps**: ventas, cuotas, pagos, facturación, notas de crédito, matrículas, despacho físico, inventario multi-local, campañas de correo, notificaciones | **Vivo.** Corre el negocio |
| **goberna-dashboard** | BI en Django sobre la MySQL **de Cerberus**. Cruza ventas × Meta Ads | **Vivo.** Y **crea sus propias tablas dentro de la base de Cerberus** |
| **Icarus** | Contactos unificados (59k leads + 6.1k clientes), campañas, espejo del ERP, SPA de admin | **Vivo.** Commit hace 2 días. Marcado para deprecar |
| **goberna-crm** | WhatsApp (**Baileys, no oficial**) + leads + bot de IA | **Vivo.** Riesgo de baneo |
| **goberna-escuela** | LMS propio. **Reemplazo declarado de Moodle** | **Vivo.** Commits diarios, 37 tests |
| **certificaciones-goberna** | Emite y valida certificados. Sincroniza Moodle cada 30 min | **Vivo.** Cron corriendo |
| **Moodle** (`campus.grupogoberna.com`) | El LMS histórico | **Vivo.** Hosteado por **un tercero (Dongee)** |
| **Bravo** | CRM de leads de landings | Vivo |
| **WordPress + WooCommerce** | `grupogoberna.com`. Tienda con Culqi | **Vivo. Vende.** |
| **meta-escuela** | La capa de Meta. 94.371 interacciones. **La ontología** | En construcción |

### El problema que no es técnico

**Tres sistemas se están desarrollando activamente y cada uno se declara, de alguna forma, "la
plataforma".** Icarus, goberna-escuela y meta-escuela. Cada uno tiene su propia noción de quién
es una persona.

**Ninguna arquitectura resuelve eso.** Se resuelve con una conversación.

---

## 5. Las leyes del mundo (no se negocian)

### 5.1 Las ventanas de Meta

| Regla | Valor | Consecuencia |
|---|---|---|
| Ventana estándar de Messenger | **24 h** desde el último mensaje de la persona | Sin el permiso `human_agent`, **a las 34.118 conversaciones históricas no se les puede escribir jamás** |
| Tag `HUMAN_AGENT` | 7 días. **Requiere App Review** | **No lo tenemos** (verificado con `debug_token`) |
| Respuesta privada a comentario | **7 días, un solo intento.** No requiere `human_agent` | **El único canal con volumen que se puede trabajar hoy** |
| `event_time` de CAPI | **7 días hacia atrás** | El 17% de las ventas llega tarde (p90 de Tesorería: 10 días) |
| Retención de audiencias | Página/IG: **730 días** · Lead Ads: **90** · Likes: **0** | No son 365 uniformes |
| Offline Conversions API | **Muerta** desde mayo 2025 | Su página de doc sigue viva sin aviso |

### 5.2 La frontera legal

**Platform Terms 3.a.v**, textual:
> *"Processing Platform Data without valid User consent in order to build or augment user
> profiles for any purpose."*

| Grupo | Veredicto |
|---|---|
| Leads de formulario | **Permitido.** Dato de primera parte |
| Gente que nos escribió (Messenger) | **Defendible.** Relación de negocio |
| Comentaristas y reaccionantes | **Prohibido** perfilarlos |

**Salida limpia:** las Engagement Custom Audiences las construye Meta desde sus propios datos.
**No necesitamos guardar a esa gente para retargetearla.**

### 5.3 La física del negocio

- **Las ventas se confirman a mano.** El asesor sube la foto del voucher; Tesorería la valida.
  Mediana: 1,8 días. **p90: 10 días. p99: 27.**
- **Cerberus considera "vendido" solo cuando se pagan TODAS las cuotas.** El 9,9% paga en cuotas.
- **El 61% de las ventas se cierra por WhatsApp**, con la API no oficial.

---

## 6. Los hechos verificados

Cada uno con cómo se comprobó.

### 6.1 Sobre Meta (probado contra la API real, con nuestro token)

| Hecho | Cómo se comprobó |
|---|---|
| Las **reacciones no traen identidad**. Solo `summary.total_count` | `GET /{post}/reactions` en 3 posts (30, 6.134 y 13.867 reacciones): `data: []` siempre |
| Los **comentarios de FB son anónimos** | 0 de 30 traen `from` en vivo. 0,4% histórico |
| **Faltan `human_agent` y `page_events`** | `debug_token`: 32 permisos, esos dos no están |
| **No hay Dataset de Business Messaging** | `GET /{PAGE_ID}/dataset` → `403: "App does not have page_events permission"` |
| **El 31,6% de los comentarios FB SÍ es atribuible a un anuncio** | 12.100 anuncios enumerados en 24 cuentas → 11.071 posts promocionados → 4.661 de 14.736 comentarios coinciden |
| **Instagram: 0% atribuible** | Los posts IG más comentados son sorteos orgánicos de 2020, nunca promocionados |
| **El histórico de Messenger no tiene atribución, y nunca la tendrá** | Cero `ad_id`/`referral` en 76.869 mensajes. La Graph API **no expone `referral` en el objeto `Message`** — solo llega por webhook, en el momento |

### 6.2 El lazo con Meta (el hallazgo central)

**Pixel `513556103518928`** — nuestro, propiedad de "Goberna Analytics", **activo desde 2022**.

Últimas 24 horas:

| Evento | Cantidad |
|---|---|
| PageView | 1.309 |
| ViewContent | 124 |
| Lead | 25 |
| AddToCart | 23 |
| InitiateCheckout | 7 |
| **`Purchase`** | **0** |

**Origen de los eventos:** `SERVER` 630 · `BROWSER` 574.
→ **El CAPI server-side YA está corriendo** (PixelYourSite Pro, desde WordPress).

**Claves de matching** de esos ~1.200 eventos:

| Clave | Eventos |
|---|---|
| `external_id` (cookie hasheada) | 835 |
| Cookies de Facebook | ~400 |
| **`email`** | **3** |
| **`phone`** | **1** |

> **La tubería hacia Meta ya está construida y funcionando. Solo transporta la carga equivocada.**
> No manda **quién** (3 correos de 1.200) y no manda **qué pasó** (cero compras).

Y hay un campo oculto en la landing de consultor-político:
```html
<input type="hidden" name="form_fields[fbclid]" value="ORGANICO">
```
**Se llama `fbclid` y su valor está hardcodeado en la palabra "ORGANICO".**
No falta la captura: **hay una captura que miente**, en producción.

### 6.3 Qué pregunta realmente la gente (leído: 200 textos reales)

De lo que **sí es sobre el curso** (66 de 200; el resto es política, spam, saludos):

| | % |
|---|---|
| **Precio** | 27,3% |
| **"Información", a secas** | 30,3% |
| Interés genérico | 15,2% |
| Dónde inscribirse | 7,6% |
| Modalidad, fechas, pago | ~20% |

> **Precio + "info" = 57,6%.** Y "Información" en LATAM casi siempre significa "¿cuánto cuesta?".
> **El anuncio no muestra el precio, y por eso la gente escribe.**

**La categoría más común de TODAS (37% del total): la gente simplemente escribe su número de
teléfono.** Sin pregunta, sin saludo. `"9XXXXXXXX"`.

**No es una pregunta. Es una entrega.** Alguien te está dando la llave y se está yendo.

### 6.4 Cifras del mundo

| | |
|---|---|
| Interacciones capturadas | 94.371 |
| Personas distintas (Messenger) | 34.118 |
| Ventas | 5.134 (4.729 pagadas) |
| Ventas por WhatsApp | **61%** |
| Ventas con `medio = pagado` | 36,9% |
| Cuentas publicitarias | 24 (19 con actividad) |
| Anuncios | 12.100 |
| Monedas | 7 (USD, MXN, PEN, BOB, DOP, COP, CLP) |
| Precio de un diplomado | Perú 350 USD · Bolivia 1.350 Bs · México 6.500 MXN · Colombia 1.400.000 COP |
| Interacciones sin trabajar | **94.370 de 94.371** |
| Respuestas registradas en toda la historia | **1** |

---

## 7. Lo que creíamos y era falso

**Esta es la sección más importante del documento.** Un motor que aprenda de este mundo debe
aprender, sobre todo, a no repetir estos errores.

### 7.1 Errores sobre el propio sistema

| Lo que creíamos | La verdad | Cómo se descubrió |
|---|---|---|
| "El estado de atención no existe, vive en React" | **Sí se persiste** (`responder.ts:38`). El bug es que **el frontend nunca lee la columna** | Leyendo el código, no el doc |
| "La verdad vive en el event store, las proyecciones se rehacen" | **No hay proyector.** Los ingestors escriben todo inline. No hay replay | Leyendo el código |
| "El backlog son 28.000 personas esperando respuesta" | **Indemostrable.** El ingestor **descarta nuestros propios mensajes salientes** (`interactionsIngestor.ts:111`). La base no sabe a quién le respondimos | Mirando los payloads crudos |
| "Guardamos todos los comentarios" | **`comments.limit(50)` hardcodeado**, y nunca se sigue la paginación anidada. **Todo post con más de 50 comentarios se trunca en silencio** | Cruzando anuncios contra comentarios |
| "Icarus está viejo" | **Commit hace 2 días.** El clon local estaba **14 commits atrás** | `git fetch` |
| "goberna-escuela es chico" | 551 commits, 37 tests, deploy diario. El clon local estaba **53 commits atrás** | `git fetch` |
| "No hay lazo con Meta" | **El CAPI lleva años corriendo.** Solo le falta la carga | Consultando las stats del pixel |

> **Tres clones locales mintieron.** Regla nueva: **`git fetch` antes de leer cualquier repo.**
> Un repositorio local no es el mundo. Es una foto vieja del mundo.

### 7.2 Errores sobre Meta

| Lo que creíamos | La verdad |
|---|---|
| La ventana de Messenger es de 7 días | **24 horas**, sin `human_agent` — que no tenemos |
| Las audiencias retienen 365 días | Página/IG: **730**. Lead Ads: **90**. Likes: **0** |
| El `ad_id` de Messenger se puede recuperar | **Jamás.** Solo llega por webhook, en el momento |
| Las reacciones tienen identidad | **No.** Meta solo da el conteo |
| El join comentario→anuncio no funciona | **Funciona para el 31,6%.** El "0%" era artefacto de mirar solo 8 anuncios de leads (dark posts) |

### 7.3 Errores sobre la industria (la más cara)

Una investigación con 109 agentes y **verificación adversarial contra fuentes primarias**
encontró que **casi todo lo que la industria vende no sobrevive el intento de refutación**.

| Lo que todos repiten | La evidencia |
|---|---|
| **"Responder en 5 min multiplica ×21 la calificación del lead"** | Folklore. Rastrea a **InsideSales.com**, un vendedor de software de ventas. El estudio serio (HBR 2011) es **correlacional, no peer-reviewed, y no descarta la causalidad inversa**. **Cero réplicas académicas en 10 años. Ningún estudio sobre WhatsApp o redes** |
| **"Los nudges funcionan" (d=0.43)** | Reanalizados **los mismos datos** corrigiendo sesgo de publicación: **d=0.04**. Textual: *"no evidence remains that nudges are effective"* (*PNAS*, 2022) |
| **Los 6 principios de Cialdini** | Sobreviven, pero con r ≈ .08–.16. Señales débiles, no palancas. "Simpatía" casi no tiene prueba de que mueva la compra |
| **"Demasiadas opciones paralizan"** | Metaanálisis de 50 estudios: **efecto promedio ≈ cero** |
| **El embudo AIDA / TOFU-MOFU-BOFU** | Sus propios defensores admiten que **no es un proceso observable** |
| **La atribución multi-touch** | Contra 15 experimentos aleatorizados en Facebook (500M observaciones): los métodos observacionales **se equivocan por un factor de ~3×** (Gordon et al., *Marketing Science* 2019) |
| **El event sourcing** | Fowler: *"for most systems CQRS adds risky complexity"*. **Ninguna** de las 4 plataformas de bandeja de referencia (Chatwoot, Zulip, Mattermost, Discourse) lo usa |
| **La ontología tipo Palantir** | **Cero casos públicos** de un equipo chico que la haya replicado y reportado si valió la pena |

### 7.4 El único mecanismo que sobrevivió

**NBER w32765 / *Marketing Science* 2025** — experimento aleatorizado, **70.000+ anunciantes**:

> Quitarle a Meta la señal de conversión sube el costo mediano por cliente incremental de
> **US$ 38,16 a US$ 49,93 — un 31% más caro.**

Y el mecanismo está documentado, no inferido: **el evento de conversión que le devuelves a Meta
se usa como la variable dependiente de su modelo de predicción de entrega.** No "ayuda al
algoritmo": **es lo que el algoritmo intenta predecir.**

> **Todo el resto de la industria —creative analytics, Triple Whale, Northbeam, Hyros, ManyChat,
> speed-to-lead, lead scoring, CDPs, Palantir— no produjo un solo claim con fuente primaria que
> sobreviviera la verificación.**

### 7.5 El error de modelo que casi cometimos

Inventé cinco categorías de "qué pregunta la gente", sacadas de papers académicos.
Después leímos 200 mensajes reales:

| Categoría inventada | ¿Existe? |
|---|---|
| `pregunto_precio` | ✅ 9% |
| `pregunto_fechas` | Rara, 1% |
| `pregunto_certificacion` | **0 de 200** |
| `expreso_compromiso` | **0 de 200** |
| `menciono_objecion` | 0,5% |

**Tres de cinco eran fantasmas. Y la categoría dominante —el 37%— no está en ningún paper.**

> No hay literatura que te diga que tu gente te tira el número de teléfono y se va.
> **Eso solo se sabe leyendo lo que escribieron.**

---

## 8. Las leyes del método

Cómo se aprendió todo lo anterior.

### 8.1 Las dos leyes

> **1. Nunca diseñes el transporte antes de encontrar aquello que va a transportar.**
>
> *(Se diseñó una tubería completa hacia Meta —normalización, hasheo, idempotencia, reintentos—
> antes de verificar que el dato de "compra" existiera en algún lado. Existía. Pero podría no
> haber existido.)*

> **2. El modelo no crece por imaginación. Crece por evidencia.**
>
> *La arquitectura no crece cuando tenemos una buena idea. Crece cuando ya no podemos explicar
> la realidad sin introducir un concepto nuevo. Cada pieza tiene que ser **inevitable**.*

### 8.2 El orden

```
Observar  →  Nombrar  →  Modelar  →  Automatizar
```

Nunca al revés.

### 8.3 Reality Gap

Cada vez que el modelo afirma algo que no fue observado, es una **deuda epistemológica**.
No es un bug. No es un TODO.

**Dos clases, y confundirlas produce dos errores opuestos:**

| Clase | Qué es | Regla |
|---|---|---|
| **Tipo A** | Hechos del mundo. *¿Existe una venta? ¿Existe un community manager? ¿Meta nos dio el permiso?* | **Se verifican ANTES de programar.** Un Tipo A crítico sin resolver **bloquea** |
| **Tipo B** | Propiedades emergentes. *¿Qué pregunta la gente? ¿Cómo se ve una fusión mal hecha?* | **Se descubren USANDO el sistema.** Se construyen baratos y se corrigen mirando |

Exigirle evidencia previa a un Tipo B es lo que impide que nazcan conceptos nuevos.
Dársela por sentada a un Tipo A es lo que construye tuberías vacías.

### 8.4 Estados del conocimiento

```
UNKNOWN → HYPOTHESIS → OBSERVED → VERIFIED → MODELED → IMPLEMENTED → MONITORED
```

**La regla con dientes:** *el modelo solo acepta entidades en estado `VERIFIED`.*

Aplicada retroactivamente al primer spec: **de 13 suposiciones, cero estaban verificadas.**
La tabla central del diseño era una hipótesis.

### 8.5 Lo que funcionó, medido

Un ciclo observado (N=1). Los agentes se organizaron **por fuente de evidencia**, no por rol:

| Fuente | ¿Encontró evidencia? | ¿Cambió el modelo? |
|---|---|---|
| **Nuestra propia base de datos** | ✅ | ✅✅ |
| **La API real de Meta** | ✅ | ✅✅ |
| Documentación oficial | ✅ | ✅ |
| Papers académicos | ✅ | ✅ (matando hipótesis) |
| Repos open source | ✅ | ✅ |
| Foros | ⚠️ parcial | ⚠️ |
| **Observación humana** | ❓ **sin hacer** | ❓ |

**Lecturas:**
1. **Las dos fuentes más baratas fueron las decisivas.** Consultar nuestra propia base y llamar a
   la API real cambiaron **la operación**, no solo el diseño.
2. **La investigación externa sirvió sobre todo para MATAR hipótesis, no para construirlas.** Es
   un rol distinto y hay que nombrarlo: no es un buscador de evidencia, es un **verdugo de
   hipótesis**.
3. **La fuente que falta es la única que no se puede automatizar.** *¿Cómo trabaja realmente un
   community manager?* No lo cierra ningún agente, ningún `grep`, ninguna API. Se cierra
   **sentándose dos horas al lado de una persona y mirando**.

### 8.6 Las prohibiciones

Baratas de aplicar, caras de omitir.

| Rol | **No puede** |
|---|---|
| El que busca gaps | Proponer soluciones. Solo identificar incertidumbre |
| El que busca evidencia | Interpretar. Solo traer lo que encontró, con su ruta y su cita |
| El que valida | Buscar evidencia nueva. Solo evaluar la que ya está |
| El que modela | Inventar conceptos. Solo incorporar lo que la evidencia hizo **inevitable** |
| El que planifica | Tocar el modelo. Solo convertir conocimiento validado en trabajo |

Y una que aplica a todos:

> **Si no encontraste, decilo.** Una búsqueda negativa reportada honestamente vale más que un
> hallazgo inventado para no volver con las manos vacías.

*(Funcionó: un agente reportó que Reddit y Stack Overflow estaban bloqueados en vez de rellenar
con humo. Otro se negó a citar una cifra de Gartner que no pudo verificar. Esas dos confesiones
valen más que veinte párrafos de relleno — son la razón por la que se puede confiar en el resto.)*

### 8.7 La distinción que evita la sobreingeniería

> **¿Estoy anticipando una estructura, o comprimiendo una que ya observé?**

| | |
|---|---|
| **Anticipada** | *"Creo que van a existir estos siete agentes."* → Predicción disfrazada de diseño |
| **Comprimida** | *"Observamos seis investigaciones. Este patrón apareció siempre. Lo nombramos."* → Nace de la realidad |

Las mejores arquitecturas son **compresiones de patrones repetidos**, no predicciones de patrones
futuros.

### 8.8 La recursividad

**Toda metodología debe poder investigarse con su propia metodología.**
Si se exceptúa a sí misma, deja de ser método y pasa a ser dogma.

*(Aplicado: la propuesta de construir un "motor de agentes que descubren" entró como Reality Gap
—`RG-M001`, N=1— en vez de como plan. La evidencia del único ciclo observado sugería lo contrario
de lo que la propuesta asumía.)*

---

## 9. Lo que sigue sin saberse

| | Clase | Por qué importa |
|---|---|---|
| **¿Cómo trabaja realmente un community manager?** | A · Comportamiento | **Una** respuesta en 94.371 interacciones. Se modelaron bandejas, colas y semáforos **para un oficio que nadie observó** |
| ¿Meta aprueba `human_agent`? | A | Si no, el histórico de Messenger es inalcanzable **para siempre** |
| ¿La tienda web vende y el `Purchase` no se dispara, o el checkout está roto? | A | 23 carritos y 7 checkouts en un día, cero compras vistas. **Es plata cayéndose hoy** |
| ¿Cuánto tarda Tesorería, hoy, en confirmar un voucher? | A · Temporalidad | Decide el 17% de ventas que Meta rechaza. **Se arregla con gente, no con código** |
| ¿Se pueden unir los alumnos de Moodle con los clientes de Cerberus? | A · Relación | Habilita la señal de valor más alta: *"compró Y terminó el curso"* |
| ¿Existe un proceso estable para convertir incertidumbre en conocimiento? | B | N=1. **No ponerle nombre todavía** |

---

## 10. La conclusión operativa

Después de todo lo anterior, **tres cosas que se pueden hacer mañana** y que no dependen de
ninguna decisión pendiente:

1. **Poner el precio en el anuncio.** El 57% de las preguntas reales desaparece. **Cuesta cero.**
2. **Darle la carga correcta a la tubería que ya existe.** Las 4.729 ventas pagadas de Cerberus
   (correo 99,5%, teléfono 100%) → `Purchase` por CAPI. No requiere `human_agent`, ni
   `page_events`, ni App Review, ni migrar WhatsApp.
3. **Borrar el `value="ORGANICO"`.** Es una línea.

Y una que no es de software:

4. **Que Tesorería confirme los vouchers más rápido.** Cada día que un voucher espera es un día
   más cerca de que Meta rechace el evento. **Ese 17% se recupera con gente.**

---

## 11. La frase que resume el mundo

> **Goberna paga por traer gente, y nunca le dice a Meta quién compró.**
>
> Todo lo demás —las nueve plataformas, las 94.371 interacciones, los diez sistemas, las dos
> ontologías compitiendo— es consecuencia de ese silencio.

---

*Documento verificado el 2026-07-12. Cada hecho es trazable. Lo que no se pudo verificar está
marcado como hipótesis. Si algo de acá resulta falso, **la falla es del documento, no de quien
lo creyó** — y hay que corregirlo acá, con la evidencia al lado.*
