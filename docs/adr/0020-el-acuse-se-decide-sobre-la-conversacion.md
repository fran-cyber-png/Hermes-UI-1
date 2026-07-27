# ADR 0020 — El acuse se decide sobre la conversación, no sobre el reloj; y no dice que es una máquina

**Fecha**: 2026-07-27 · **Estado**: aceptada · **Issue**: #166 · **Corrige**: ADR 0015 (§«las
plantillas dicen que son automáticas»), ADR 0016 y ADR 0018 (el lote por campaña).

## El contexto: 40 borradores que se veían impecables

El 27-jul a la 01:03 el dueño puso la auto-respuesta en **supervisada** por primera vez con
volumen real. La cola preparó **40 borradores**. Ninguno salió —para eso existe el modo— y a
las 01:10 se apagó de nuevo. Revisándolos aparecieron **siete defectos**, y lo importante no
es la lista sino que **el simulacro los había impreso a todos sin que se notara**: 33 renglones
ordenados, con su hora de salida y su plantilla, que se leían como un plan sano.

Los números, medidos sobre esos 40:

| | |
|---|---|
| escribieron **dentro** del horario de atención (9, 10, 16 h…) | **25 de 40 (62 %)** |
| esperas | de **57 a 72 horas** |
| conversaciones que la persona ya había **cerrado** | al menos 1, verificada a mano |

## Las decisiones

### 1 · La franja se pregunta DOS veces, y una es sobre el mensaje

`decidir.ts` preguntaba una sola vez, y sobre `ahora`: «¿estamos fuera de horario?». A la 1 de
la mañana eso es cierto para todo el mundo, así que calificaba cualquier conversación sin
responder **sin importar cuándo había llegado**.

Son dos preguntas distintas y las dos tienen que dar que sí:

- sobre **`ahora`** — *¿hace falta?* Adentro del horario contesta la vendedora, en 10 minutos
  (mediana medida). Motivo `en_horario`, el de siempre.
- sobre **`ultimoEntranteEn`** — *¿corresponde?* El acuse es para quien nos escribió con la
  puerta cerrada. Motivo nuevo: **`escribio_en_horario`**.

**Por qué no alcanzaba con cambiar la frase de la plantilla.** La tentación era escribir un
texto que no mencione el horario y mandarlo igual. No: a quien escribió a las 10 de la mañana
y no fue atendida, el problema no es de horario sino de atención, y **un acuse automático lo
tapa**. Esa conversación tiene que aparecer en la cola de una persona, no en la de una máquina.

### 2 · Hay un techo de antigüedad, no solo un piso

Había mínimo (30 min) y no había máximo. La feature se diseñó para el hueco de la madrugada
—llega a las 2 a. m., se le acusa a las 7:30 (ADR 0015)—, no para vaciar un atraso de días. Un
«gracias por escribirnos» a los tres días no acusa recibo: **confirma que nadie miró**.

`AUTO_RESPUESTA_MAX_ESPERA_H`, **12 h** por defecto — la que escribió a las 21:00 todavía
alcanza el reparto de las 7:30 de la mañana siguiente, la de anteayer no. Motivo nuevo:
**`espera_excesiva`**.

### 3 · Ninguna plantilla dice que es automática — **se revierte ADR 0015**

ADR 0015 lo puso por escrito como decisión de diseño: «las plantillas dicen que son
automáticas… un mensaje que no finge ser humano no tiene nada que disimular». El argumento no
era falso. **El dueño lo revirtió el 27-jul: el lead todavía no puede saber que hay un
automatismo detrás.** Perdió contra el criterio comercial, y lo que queda escrito en el código
es la decisión vigente, no la que preferiríamos.

Lo que la reemplaza **no es un disfraz**, y esa diferencia es lo único que hace defendible el
cambio: el mensaje **deja de hablar de sí mismo**, no empieza a mentir. Sigue sin fingir una
conversación —no pregunta de vuelta, no improvisa, no dice «te escribo yo»—, sigue siendo un
acuse de recibo, y las frases que quedan son las tres que podemos sostener siempre: *estamos
fuera del horario*, *atendemos desde tal hora*, *tu mensaje quedó registrado*.

En el mismo viaje se fue **«una asesora te responde personalmente a partir de las 9:00»**. De
los leads que llegan fuera de horario, el 44 % nunca recibe respuesta (#125): prometerla por
escrito le mentía a uno de cada dos. Lo que queda es lo que controlamos.

Lo que sigue prohibido no cambió (ADR 0015 §«Lo que deliberadamente no se hizo»): generar
texto libre, iniciar conversaciones, y cualquier mecanismo cuyo fin sea que el tráfico no se
detecte. **Sacar una frase no es esconder el tráfico**; agregar warmup o aleatorización de
huella, sí — y sigue afuera.

El guardarraíl se dio vuelta con la decisión: el test que **exigía** la palabra «automático»
ahora la **prohíbe**, junto con «bot», «sistema» y la promesa de una persona a hora fija.
Volver atrás cuesta romper un test, no pasar desapercibido en un diff.

### 4 · Que el último mensaje sea suyo no significa que esté esperando

La guarda `ya_respondida` solo comparaba timestamps. El caso que lo mostró (Morita, 22/36):

```
10:01  nosotros → seguimiento del Foro de Estado, ¿te interesa participar?
10:45  ella     → «Hola, ya revise toda la información»
10:46  ella     → «Soy abogada, y no me es de mucha utilidad»
10:47  nosotros → «Entiendo»
10:47  ella     → «Agradezco mucho la atención prestada»
```

El último mensaje es de ella, así que pasaba. Pero **una despedida no es una consulta**. Motivo
nuevo: **`conversacion_cerrada`**, y exige que le hayamos escrito alguna vez — sin un solo
saliente no hubo atención que agradecer.

### 5 · El detector de rechazo ve las tres formas de decir que no

Tenía 26 frases, todas explícitas. Ahora son tres familias, y son **dos funciones** porque no
significan lo mismo:

| forma | ejemplo | dónde vive | alcance |
|---|---|---|---|
| el no **explícito** | «no me interesa» | `FRASES_DE_RECHAZO` | toda la conversación, para siempre |
| el no **con motivo** | «soy abogada, y no me es de mucha utilidad» | `FRASES_DE_NO_CON_MOTIVO` | igual, pero **cede si el mensaje pide algo** |
| el **cierre cortés** | «agradezco mucho la atención prestada» | `esDespedida` | **solo el último mensaje** |

Los dos cuidados que evitan el falso positivo caro:

- **«gracias» a secas NO es una despedida.** Es lo que contesta quien acaba de recibir el flyer
  y sigue leyendo. Todas las frases de cierre llevan un objeto —la atención, el tiempo, todo—.
- **El no con motivo cede ante un pedido.** «Ese horario no me sirve, ¿hay otro grupo?» lleva la
  misma frase adentro y significa lo contrario: es alguien que quiere comprar.

Y una regla para el que agregue una palabra a `PIDE_ALGO`: no puede ser una que aparezca dentro
de una frase de rechazo. «necesito» parece obvia y no puede estar — «no es lo que necesito»
dejaría de ser un no.

### 6 · Aprobar en lote no existe en ningún nivel — **se corrige ADR 0016 y ADR 0018**

ADR 0016 lo defendió con un argumento razonable: mismo texto, misma promesa, misma gente; leer
el texto una vez alcanza para el grupo. ADR 0018 lo conservó («el lote es de primera clase»).

El grupo que lo desarmó se llamaba **«Sin campaña»** y ofrecía **«Aprobar 32»**: 32 personas
juntas por no tener nada en común. Y aun con campaña de verdad, **el texto es lo único igual**:
a quién se le manda, qué preguntó y si ya se despidió cambian de fila en fila — que es
exactamente lo que hay que mirar. La regla de la casa no admite el matiz: **un envío = una
acción humana**. Que después salgan espaciados no cambia que la decisión fue una sola para 32.

Donde estaba el atajo hay una **puerta**: «Revisar 8 ›» abre la primera del grupo —la que más
esperó— y de ahí se recorre con `⌘↵`. La cabecera no pierde su función, pierde la de saltearse
el recorrido.

**Queda «Descartar todo», y la asimetría es deliberada**: descartar no le llega a nadie; se
paga con trabajo perdido, no con un mensaje que no debía salir.

### 7 · El simulacro muestra la hora en que escribió cada persona y su antigüedad

Es el arreglo que hace visibles a los otros seis. El plan mostraba la hora a la que **saldría**
cada mensaje y nunca la hora a la que **había llegado** el de la persona, así que «25 de estos
escribieron en horario» era invisible justo en la pantalla que existe para verlo.

Ahora «escribió» y «espera» son las dos primeras columnas, las descartadas se listan de a cinco
por motivo con lo mismo, y arriba de un día la espera se dice en días («2 d 09 h», no «57 h»).
La hora sale de `franja.ts` —el mismo módulo con el que se decide—: un formateador propio en el
script sería una segunda verdad.

Antes y después sobre los tres casos del issue, sembrados en `--demo`:

```
ANTES     PLAN DE DESPACHO — 14 mensaje(s)          NO CALIFICAN — 4
            02:30  3 d 00 h    …17  ← 3 días
            10:47  16 h 13 min …16  ← escribió en horario
            22:10  4 h 50 min  …18  ← ya se había despedido

DESPUÉS   PLAN DE DESPACHO — 11 mensaje(s)          NO CALIFICAN — 7
            1 × escribio_en_horario   10:47  «escribió 10:47, dentro del horario (09:00–20:00)»
            1 × espera_excesiva       02:30  «esperó 72 h y el techo son 12»
            1 × conversacion_cerrada  22:10  «ya la atendimos y se despidió»
```

## Lo que NO se hizo, y por qué

**Derivar el curso de lo que ya se dijo en el hilo.** El panel mostró «nadie anotó qué curso
quiere» en una conversación donde nosotros mismos escribimos «Foro de Estado». Es cierto y es
molesto, pero el arreglo no cabe acá: la precedencia del curso vive **una vez**
(`cursos/precedencia.ts` + su gemelo SQL `cola/cursoSql.ts`, atados por un test de paridad, ADR
0019) y la alimentan **cuatro pantallas**. Agregar un cuarto eslabón —«lo que se nombró en el
hilo»— es tocar la función pura, el SQL, el test de paridad, la propuesta de la ficha, el chip
de la cola, el Dashboard por curso y el acuse nocturno, con una pregunta de producto sin
responder: **¿qué mandamos nosotros cuenta como lo que ELLA quiere?** Un flyer que le mandamos
al voleo no es una declaración suya, y ADR 0019 dice explícitamente «no se infiere leyendo el
mensaje».

Es un frente propio, con su issue. Meterlo acá habría convertido un PR de guardarraíles en uno
que le cambia el significado al chip de curso de cuatro pantallas.

## Consecuencias

- Menos acuses, y eso es el objetivo: sobre las 40 del 27-jul, **las 40 quedan afuera** (25 por
  `escribio_en_horario`, el resto por `espera_excesiva`). Lo que queda son las de esta noche.
- **Las 40 filas `preparada` que hay en producción no se tocan.** Caducan solas (`caducidad.ts`,
  3 h de gracia) o las descarta una persona. Este PR no corre nada contra la base.
- `MotivoNoElegible` pasa de 7 a 10 valores. Es un tipo interno (no viaja a la UI ni a la API),
  así que no rompe contratos; sí aparece en el simulacro, que es donde tiene que aparecer.
- El techo de 12 h y la franja sobre el mensaje **no cambian el schema**: son decisión pura. No
  hace falta ningún `db:push` para este PR.
