# Los leads del viernes, sábado y domingo — quiénes son y qué se les puede mandar

> **4-ago-2026.** Medido en producción (`hermes_db`, solo lectura).
> Días: **viernes 31-jul · sábado 1-ago · domingo 2-ago** (hoy es martes 4).

---

## 1 · Quiénes son: 147 personas, y son DOS públicos distintos

| Línea | Personas | Qué preguntaron | Ya tienen precio |
|---|---:|---|---:|
| **51984429504** (el bot, Cloud API) | **91** | 50 Diploma de Inteligencia · 30 «¿más información?» · 11 solo «Hola» | **83 / 91** |
| **51941654039** (vendedora, whatsmeow) | **58** | **36 «servicio de Consultoría»** + coordinación de reuniones | **6 / 58** |

**Ninguno compró todavía** (0 en `conversiones_wa`).

### 🔴 Esos dos grupos no son el mismo negocio

Los 36 de la segunda línea preguntaron por **Consultoría** — el otro plano de Goberna
(Centurión, despacho, clientes que pueden ser rivales entre sí), no la Escuela. Varios de
los mensajes de esa línea son coordinación de reunión («En 15 minutos», «Si se puede hoy a
las 3 pm»), no gente esperando información de un diploma.

**Mandarles una campaña de la Escuela cruzaría los dos planos.** Es un público aparte, y su
mensaje —si va— lo escribe quien lleva consultoría.

---

## 2 · Ya se les contestó: 146 de 147

Solo **1 persona** de las 147 quedó sin respuesta. Este no es el caso de «llegaron fuera de
horario y nadie los atendió» — ése era el problema de #125 y está cubierto.

Y en la línea del bot, **83 de 91 ya recibieron el precio**. Entonces el mensaje correcto
no es «te paso la información»: es un **seguimiento sobre una cotización que ya tienen**.
Mandarles información de nuevo dice, sin querer, que no se registró lo que ya pasó.

---

## 3 · 🔴 Lo que decide todo: la ventana de 24 horas

```
personas: 147   ventana_abierta: 9   ventana_cerrada: 138   promedio: 76 horas
```

**138 de 147 tienen la ventana cerrada.** Eso no es un detalle de implementación: es la
regla de WhatsApp. Fuera de las 24 horas desde el último mensaje de la persona, **no se
puede mandar texto libre** — solo una **plantilla aprobada por Meta** (HSM).

### Y hoy Hermes no puede mandar plantillas

Verificado en el código: `TransporteCloudApi` manda **texto y media, y nada más**. No hay
`enviarPlantilla` ni ningún camino que arme un mensaje `type: "template"`.

| Línea | ¿Se puede mandar hoy? |
|---|---|
| 51984429504 (Cloud API) | **No.** Meta rechaza el texto libre fuera de la ventana. Necesita HSM aprobada **y** soporte en el transporte, que no existe. |
| 51941654039 (whatsmeow) | **Técnicamente sale, y no se debe.** Es texto libre a 58 personas que no escriben hace días. |

Lo segundo choca de frente con la regla escrita del repo — *«no envío masivo, no warmup, no
anti-ban; un envío = una acción humana»* — y con la de Goberna: cualquier envío masivo
necesita dry-run con la lista de destinatarios a la vista. Y el costo no es teórico: es el
número de una vendedora, que es su herramienta de trabajo.

---

## 4 · Entonces, qué SÍ se puede hacer

**a) Los 9 con ventana abierta** — se les puede escribir hoy, texto libre, desde la app.
Son pocos: es una tarde de trabajo de una persona, no una campaña.

**b) Los 138 con ventana cerrada** — hace falta una **plantilla aprobada por Meta** en la
línea del bot. Eso es: registrar la HSM en Meta (24–48 h de aprobación) y agregarle a
`TransporteCloudApi` la capacidad de mandarla. Es un frente chico y bien delimitado.

**c) Mientras tanto** — las plantillas de abajo sirven igual como **mensajes predeterminados**
(`plantillas`), para que la vendedora las mande de a una desde el chat. Es lo que el repo
llama «un envío = una acción humana», y no necesita nada nuevo.

---

## 5 · Las plantillas

Escritas con las reglas de la casa: **ninguna se anuncia como automática** (regla del dueño
del 27-jul), ninguna promete lo que no controlamos, y ninguna usa el oro ni la urgencia
falsa. `{nombre}` y `{precio}` los resuelve el server al enviar.

### A · Los 50 del Diploma de Inteligencia, que ya tienen el precio

> Hola {nombre}, soy Sofía de Goberna. Te escribí el fin de semana por el **Diploma de
> Inteligencia y Contrainteligencia** y quedamos ahí.
>
> ¿Te quedó alguna duda que pueda resolverte? Las dos que más me preguntan son si se puede
> pagar en partes —sí, en 2 cuotas— y cuánto dura el acceso: el campus te queda habilitado
> **un año completo**, así que podés cursar a tu ritmo.
>
> Si querés te reservo el cupo y seguimos.

*Por qué así:* no repite el precio (ya lo tienen), y sale al frente con las dos objeciones
que el catálogo mide como las que más destraban.

### B · Los 30 que llegaron por el anuncio genérico

> Hola {nombre}, soy Sofía de Goberna. Escribiste el fin de semana pidiendo información y
> quiero asegurarme de no haberte dejado a medias.
>
> ¿Sobre cuál de nuestros programas querés que te cuente? El que más consultan es el
> **Diploma de Inteligencia y Contrainteligencia** — 120 horas académicas, con certificado
> y clases grabadas.
>
> Decime y te paso el temario completo.

*Por qué así:* estos no dijeron qué querían. Preguntar es más honesto que asumir, y el
temario es un motivo real para que contesten.

### C · Los 11 que solo dijeron «Hola»

> Hola {nombre}, soy Sofía de Goberna. Me escribiste el fin de semana y no llegamos a
> conversar.
>
> ¿Querés que te cuente sobre alguno de nuestros diplomas? Si me decís qué área te interesa,
> te paso la información puntual y no te lleno de mensajes.

### D · Los 58 de Consultoría — **no van con estas**

Es el otro negocio. Su mensaje lo escribe quien lleva consultoría, y no debería salir de la
línea de la Escuela.

---

## 6 · Antes de mandar cualquiera de estas

- [ ] **Dry-run con la lista de destinatarios a la vista** (regla dura de Goberna).
- [ ] Excluir a quien ya dijo que no: el criterio ya existe y está medido en
      `server/src/autorespuesta/rechazo.ts` (rechazo explícito, «no me sirve», y la
      despedida cortés). No hay que inventarlo.
- [ ] Excluir a los que ya compraron (hoy son 0, pero el chequeo va igual).
- [ ] Decidir si el remitente es **Sofía Rodríguez** — es la identidad del bot por decisión
      del dueño. Si lo manda una vendedora con su nombre, hay que cambiar la firma.
- [ ] Si sale por la línea del bot: **la HSM tiene que estar aprobada por Meta primero**, y
      el texto aprobado es el que sale. No se puede editar al vuelo.
