# La Libreta: qué debería tener — y por qué la pregunta estaba mal planteada

> **4-ago-2026.** Investigación de cinco frentes en paralelo (código, superficies vecinas,
> BlockNote, alternativas + patrones de la industria, datos de producción) y dos lentes de
> juicio independientes sobre 34 candidatos.
>
> **Disparador**: «tenemos que mejorar mucho esa libreta».

---

## 1 · El reencuadre: no hay dos hipótesis, hay tres — y la tercera es la que manda

ADR 0034 planteó dos: **A** no se descubre · **B** no sirve. Se atacó **A** poniéndola en el riel.

La investigación encontró una tercera, y no es una opinión:

> **C · La nota pegada a la conversación NO FUE RECHAZADA: NO EXISTE.**

`PanelNotas.tsx` —el componente que deja anotar sobre una conversación— **no lo monta nadie**.
Su único consumidor era `PanelContexto.tsx:181`, y a `PanelContexto` no lo importa ningún archivo
de `src/`. Quedó huérfano en `79b239b`, cuando el panel derecho se reescribió (ADR 0017).
`src/features/panel/pestanas.ts:46` declara una pestaña **«Notas»** que ningún componente
renderiza — y **CLAUDE.md la sigue documentando como viva**.

Consecuencia que cambia todo el análisis: **`notas_filas = 0` y `clave_general = 0` son UN solo
hecho, no dos.** No es que la gente prefiriera la libreta suelta sobre la nota del contacto: la
segunda nunca estuvo disponible.

### Y el patrón de la industria va en la misma dirección

Attio, Close, Intercom, Superhuman: **unánime**. Las notas viven **pegadas al registro** y son
**del equipo**. El cuaderno privado suelto es Apple Notes — que es exactamente lo que la gente
usa **fuera** del CRM, y por eso no compite: gana.

---

## 2 · Tres defectos silenciosos que un vendedor nuevo choca el primer día

Ninguno rompe. Los tres **mienten**, que en esta casa es peor.

### 2.1 🔴 El guardado que falla dice «Guardado»

`Libreta.tsx:216-219` se traga la excepción con un comentario que afirma «el error se ve en el
renglón de estado». Ese renglón solo puede emitir `Guardando…` o `Guardado`
(`Libreta.tsx:275-277`): no tiene rama de error. Peor — si la página ya se editó alguna vez
(`editadoAt != null`), después de un `400` la barra **vuelve a decir «Guardado»**.

**Vía de disparo garantizada**: pasarse de 2.000 caracteres. A partir de ahí *todos* los
autoguardados fallan y la vendedora sigue escribiendo, convencida de que se guarda.

### 2.2 🔴 Una página que es solo una imagen nunca se guarda

Los bloques `image`/`file`/`video`/`audio` de BlockNote tienen contenido `"none"`: su URL y su
caption viven en `props`. `aTextoPlano` no lee `props` (por diseño), así que la página aplana a
cadena vacía, `validarTexto` la rechaza por vacía, el server responde `400`… y lo tapa el
`catch` de arriba.

El ítem «Image» **aparece en el menú de `/`** aunque no haya `uploadFile`, y el file panel deja
pegar una URL. O sea: el camino está abierto y termina en pérdida silenciosa.

### 2.3 🔴 El editor está en INGLÉS dentro de una app 100 % en español

`useCreateBlockNote` solo recibe `initialContent` (`Libreta.tsx:79-84`), así que manda el default:
el menú de `/`, los placeholders y todos los menús salen en inglés. La locale `es` **viene
completa en el paquete**: es un import y una prop.

---

## 3 · El «espacio compartido con precios y objeciones» ya existe, está más lleno, y no se ve

| | `hechos` | `notas` |
|---|---|---|
| Filas en prod | **30** (27 activas) | **0** |
| ¿Compartida? | **sí, por construcción** (no tiene `vendedora_id`) | no, privada |
| Mantenimiento | editada **4 días distintos** entre el 27-jul y el 3-ago | — |
| Contenido | precios por país, dónde pagar en 8 países, cuotas, quién certifica, ponentes, horas académicas | — |

**Cuando el texto que se escribe sirve para mandar, la gente sí lo mantiene.**

Y acá está la inversión que duele:

> **El bot ve las 27 piezas. La vendedora ve 3.**

No hay **ninguna pantalla** para editar `hechos`: la API de edición existe entera
(`server/src/routes/hechos.ts:71-128`) y tiene **cero consumidores en el front**. Además el panel
muestra un tope de 3 chips y las 13 frases de plata tienen `orden = 100` (el default del schema),
así que **las 4 de precio y las 8 de dónde pagar no aparecen nunca**.

Ivi tampoco lo cubre: está vivo (contesta `200`, contra el `404` que dice CLAUDE.md), pero
preguntado por precio y cuotas responde `SIN_EVIDENCIA` con `fuentes: []` — su corpus es SQL de
ventas, no el playbook comercial.

**Conclusión de alcance: la Libreta NO se agranda hacia «lo compartido».** Duplicaría una fuente
de verdad que ya existe y está más llena que ella.

---

## 4 · La pregunta que todavía no está contestada

`notas` sigue en **0 filas**, pero eso **no dice nada todavía**: el front con la vista nueva se
desplegó a las **11:10** y la medición fue a las **11:47**. **37 minutos**, con **una sola
vendedora** habiendo abierto la app después.

Dato de contexto, medido: el corpus histórico de texto libre escrito por un humano en **todo
Hermes** es **una frase de 18 caracteres** («llamar para cerrar»), del usuario de prueba `alan`.
Las otras dos filas las generó el flujo de agendar.

Y una señal fuerte en contra de construir para compartir: **`lecciones` ya existe, tiene UI
completa, y tiene 0 filas.**

---

## 5 · Lo que NO hay que hacer, con el porqué

- **No migrar de editor.** BlockNote 0.52.1 **YA ES Tiptap 3 + ProseMirror** por dentro
  (`@blocknote/core` depende de `@tiptap/core ^3.13.0`). «Migrar a Tiptap» es sacarse una capa,
  no cambiar de motor: se pagarían 2-4 días reescribiendo el slash-menu, el drag de bloques y la
  serialización para quedar funcionalmente igual. Los tres paquetes usados son MPL-2.0.
- 🔴 **Nunca instalar `@blocknote/xl-*`** (PDF, DOCX, ODT, email, multi-columna, IA). En 0.52.1
  declaran **`GPL-3.0 OR PROPRIETARY`**, y Hermes es privado y se distribuye empaquetado
  (DMG/EXE a las vendedoras). Si algún día hace falta PDF: `blocksToFullHTML()` + `window.print()`.
- **No colaboración en vivo ni comentarios.** Arrastra infraestructura (provider con servidor
  propio; en 0.52 `yjs` se desacopló y ni siquiera está instalado) **y permisos** — y Hermes no
  tiene modelo de permisos.
- **No subir el tope de 2.000 caracteres todavía.** Cero casos medidos en contra: de 617 envíos
  con texto, **ninguno** supera 2.000; el p95 de lo escrito a mano es 943. Lo que hay que
  arreglar no es el número, es que **choque en silencio**.
- **No historial de versiones, no papelera, no semilla de arranque.** Sin una sola observación
  de uso.

---

## 6 · El orden propuesto

### Tanda 1 — «que no mienta» (todo chico, sin schema, sin infra)

Se puede hacer ya, sin esperar ninguna medición, porque no apuesta a ninguna hipótesis: son
defectos verificados por lectura.

1. **El fallo de guardado se ve**, con su motivo. Mata el `catch` vacío y el «Guardado» falso.
2. **Los bloques de archivo salen del menú `/`** mientras no haya `uploadFile` — y una página que
   aplana a vacío deja de rechazarse en silencio.
3. **El editor en español** (`dictionary: es`).
4. **«Deshacer» al archivar** — regresión conocida: el review del PR #47 lo exigió y el arreglo
   quedó en `PanelNotas`, el componente que ya no se monta.
5. **La doble creación de «Nueva página»** (dos disparos antes de que resuelva el POST).
6. **Corregir CLAUDE.md**: la pestaña «Notas» del panel derecho es código muerto.
7. **Verificar con screenshot** que el drag handle y el «+» se ven (`src/index.css:301-303` pisa a
   `0` el `padding-inline: 54px` que BlockNote reserva para dibujarlos).

### Tanda 2 — «que se vea lo que ya existe» (el mayor retorno medido)

8. **Las frases de precio y de dónde pagar, alcanzables.** Hoy `orden = 100` + tope de 3 las deja
   invisibles. Es dato, no schema.
9. **Una pantalla para editar `hechos`.** Es lo que el pedido de «espacio compartido» realmente
   describe, la API ya existe entera, y no toca permisos (la tabla es del equipo por construcción).
   **No es la Libreta: es otro frente.**

### Tanda 3 — solo después de medir

10. **Reconectar la nota pegada a la conversación** (hipótesis C). Es lo que dice el patrón de la
    industria y lo único que la vendedora abre *en medio* de un chat. Arrastra una decisión de
    diseño: dónde entra en un panel de 360 px ordenado por lo que decide una venta (ADR 0017).
11. **La búsqueda deja de estar clavada a `clave='general'`** (`notas.ts:191`). Hoy el conjunto
    que oculta tiene tamaño cero; con el punto 10 pasa a ser real.

### Antes de la tanda 3: medir de verdad

La métrica de ADR 0034 §6, **con desglose por `clave`**, y una decisión sobre si vale instrumentar
la **apertura** de la vista: con 0 filas, «la abrió y no supo qué poner» y «nunca la abrió» son
indistinguibles y llevan a rediseños opuestos. Hermes **no tiene telemetría de front** hoy, y como
no hay router (ADR 0002), abrir una vista tampoco deja rastro en el access log de nginx.

---

## 7 · Los dos huecos de esta investigación

- **El lente «la vendedora»** se cayó por un error de API: los 34 candidatos fueron juzgados por
  dos lentes (evidencia y costo), no tres.
- **Un agente leyó más de lo que se le pidió**: además de contar filas, consultó
  `sesiones_cerberus`. Todo fue de lectura y nada se escribió, pero el prompt debía haber
  limitado las tablas. Vale para la próxima: enumerar qué se puede leer, no solo qué no se puede
  escribir.
