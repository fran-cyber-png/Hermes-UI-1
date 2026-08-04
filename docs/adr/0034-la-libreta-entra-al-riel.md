# ADR 0034 — La Libreta entra al riel: es un LUGAR, y la evidencia se dio vuelta

- **Fecha**: 2026-08-04
- **Estado**: aceptada
- **Decide**: Estephano (`docs/plan-espacio-de-notas.md`, §2 «Decisiones cerradas»)
- **Issue**: #197 (el mapa) · **revierte la resolución de #198**
- **Reemplaza**: la decisión escrita en el comentario de resolución de **#198**
  («el riel se queda en seis; la Libreta es una superficie por atajo, sin ícono»), y el bloque
  «POR QUÉ NO ES UNA VISTA DEL RIEL» del docblock de `src/features/notas/Libreta.tsx`.
- **Enmienda**: **ADR 0002** (ver §5 — la deuda que #198 dejó anotada y que este cambio paga).

## 1 · Contexto: la herramienta existía entera y nadie la usó

Hermes tiene la Libreta desde #47, y desde el espacio de páginas tiene editor rico de verdad
(BlockNote — el mismo motor que Notion), pantalla completa, lista de páginas, búsqueda por
índice GIN y fijar. Se abre con la tecla **`n`**.

**Medido el 4-ago-2026 contra la base de producción** (`hermes_db` en VPS1, que ese día corre
`d015928`), con `psql` de solo lectura:

```
notas_filas=0  personas=0
clave_general=0
gestiones_con_nota=2
```

**Cero filas. Nadie escribió nunca una nota.** Y el `2` de la última línea no es ruido: son las
notas que quedaron del **viejo textarea de `RegistrarGestion`**, que estaba en el camino de algo
que la vendedora ya iba a hacer. Poco, pero no cero — la diferencia entre las dos cifras es la
única señal de uso que hay, y apunta a *dónde está la cosa*, no a *qué tan buena es*.

**La ventana, dicha con precisión para que nadie la lea de más**: la tecla `n` existe desde el
**23-jul** (`be595ca`, #47) y la pantalla completa desde el **27-jul** (`fe6b9c9`). Son **12 días**
de libreta y **8** de libreta grande, con tres vendedoras. No es una eternidad, y el argumento no
necesita que lo sea: no es que se use poco, es que **no se usó ni una vez**.

El disparador es que entran **seis vendedores nuevos** y necesitan un lugar donde anotar
«cualquier cosa, tipo Notion».

## 2 · Las dos hipótesis, y por qué gana la primera

|  | |
|---|---|
| **A · No se descubre** | se abre con una tecla que nadie enseñó y no tiene ícono en ningún lado |
| **B · No sirve** | lo que ofrece no alcanza para lo que hace falta anotar |

La resolución de #198 se apoyó en **B**, y lo dijo con una lista concreta: sin título, sin
archivos, sin páginas, tope de 2.000 caracteres, y la búsqueda ignorando lo anotado en
conversaciones. De esa lista, **título, páginas y pantalla completa ya se construyeron** — y el
contador siguió en cero.

Lo que **no** se construyó importa para no exagerar el argumento, así que va escrito: el tope de
2.000 caracteres sigue vivo (`server/src/notas/notas.ts:18`) y la búsqueda sigue clavada a
`clave = 'general'` (`:191`), o sea que todavía no encuentra lo anotado dentro de una
conversación. **Pero ninguna de las dos puede explicar el cero**: son límites que se chocan
*después* de escribir la primera página. Con cero filas, nadie llegó a tener un problema con el
instrumento — no llegó a abrirlo.

Eso es lo que mueve a **A** de corazonada a la explicación que queda en pie.

> **El costo, dicho:** es la octava vista, y un riel que crece sin criterio termina siendo un
> menú. Por eso lo que sigue no dice «hacía falta»: dice **por qué es un lugar**.

## 3 · Decisión

**La Libreta pasa a ser la octava vista del riel (⌘8), con ícono propio. Sigue siendo privada por
vendedora. La tecla `n` sigue andando.**

### 3.1 · El criterio de ADR 0016 no se rompe: se cumple

ADR 0016 rechazó una séptima vista con la regla **«el riel es para LUGARES»**, y esa regla es la
que hace entrar a la Libreta:

- La **Cabina** (`?`) e **Ivi** (`i`) no son lugares: son **consultas** — abrís, mirás, cerrás, y
  volvés a lo que estabas haciendo. Por eso ninguna de las dos está en el riel, y siguen sin
  estarlo.
- Una **libreta es un lugar**: entrás, estás un rato, volvés. Es donde se trabaja, no algo que se
  consulta sobre lo que estás trabajando.

El otro argumento de 0016 —«un ícono apagado 23 horas y 58 minutos»— era sobre una **tarea de dos
minutos por día** (aprobar acuses). Anotar no es una tarea con horario.

### 3.2 · La acción primaria única (regla 3 de ADR 0002)

**Escribir una página.** La regla pide que si no se puede nombrar una, no es vista; acá se puede,
y es la que ocupa el botón primario de la pantalla vacía.

### 3.3 · La objeción de `0002:24`, contestada de frente

ADR 0002 dice que las vistas son «**ángulos de los mismos datos, nunca secciones con vida
propia**», y #198 marcó —con razón— que un espacio de documentos es por definición una sección con
vida propia, y que **esa objeción hay que contestarla, no rodearla**.

La respuesta es que la regla protege un riesgo que acá no existe. Lo que 0002 estaba evitando es
la **redundancia**: los mismos números en tres lugares, el anti-patrón que nombra su propio
contexto. Una nota no es otro ángulo de la cola porque **no es un dato del sistema**: no se deriva
de ella ninguna etapa, ningún recordatorio y ningún envío (ADR 0012), no aparece en ninguna otra
pantalla y no hay ninguna cifra suya que se pueda contradecir con otra. No compite con ninguna
vista por ser la fuente de verdad de nada.

Dicho al revés: la regla existe para que dos vistas no cuenten la misma historia distinta. La
Libreta no cuenta ninguna historia del sistema — guarda la de la vendedora.

### 3.4 · Por qué no va dentro de la Agenda

Se consideró (la vendedora ya va ahí a planificar el día) y se descartó: **la Agenda está
organizada por tiempo** y **una nota no tiene tiempo** — no vence, no se agenda, no deriva nada.
Anclarla a un día obligaría a recordar *qué día* se escribió «el precio de México», que es un
archivo cronológico y no una libreta; y en esa pantalla el **oro significa que algo se acaba**, así
que una nota ahí estaría diciendo que vence.

## 4 · Lo que se sigue de la decisión (y la trampa que hereda)

- **`n` NAVEGA, no alterna.** Como hoja se abría y cerraba con la misma tecla. Como vista, alternar
  significaría que la tecla de *ir* a la libreta te *saca* de la libreta, y sin un destino obvio al
  volver. Se sale como de cualquier vista: ⌘1..⌘8 o el riel.
- **Escape sale de la cascada.** De una vista no se sale con Escape —de Dashboard tampoco—, así que
  la rama `if (libreta)` de `App.tsx` desaparece. **La cascada se acortó por arriba, no por el
  medio**: cabina → revisión → conversación siguen exactamente en ese orden.
- ⚠️ **La trampa de ADR 0024 cambia de forma pero no desaparece.** Antes el riesgo era que una
  superficie montada-siempre registrara `useEscape` sin su condición de abierta y **se comiera el
  Escape de toda la app** (pasó con `ConsultaIvi`: dejaron de andar cerrar la conversación, cerrar
  la Cabina y cerrar la libreta). Ahora la Libreta vive montada mientras su vista está adelante, y
  el riesgo sigue siendo el mismo: **no registrar un listener propio**.
  Y como el defecto de 0024 estaba en el **cableado** —cosa que ningún test puro ve—, el candado es
  un test de componente: `src/App.test.tsx` monta el shell entero, con su listener real sobre
  `window`, y le tira teclas que viajan. Está verificado por mutación: se comprobó que falla al
  sacar la vista de `VISTAS`, al romper `n`, al caerse la guarda de «estás tecleando» y —el caso de
  0024— **al hacer que la Libreta se coma el Escape en captura**.
- **Sigue cargándose perezosa.** BlockNote son 269 KB gzip medidos; que ahora sea una vista no
  cambia que la mayoría de los días nadie entre a escribir.
- **La primera vez enseña qué poner**, con un estado de pantalla y no con una fila sembrada en la
  base: leer no escribe (la regla de toda la casa), no puede resucitar después de archivarla, y
  desaparece sola en cuanto hay una página de verdad.
- **Al irse, lo que estaba por guardarse se guarda.** El autoguardado espera 800 ms y el desmontaje
  solo limpiaba el temporizador: escribir y salir dentro de esa ventana perdía lo escrito, en
  silencio. Como hoja había que apretar Escape justo; como vista se sale con ⌘1..⌘8 y con un clic
  en cualquier ícono del riel, así que **el mismo defecto pasa de raro a probable**. Se adelanta el
  guardado pendiente en el desmontaje.

## 5 · La enmienda a ADR 0002 que #198 dejó pendiente

#198 lo anotó explícitamente: enmendar 0002 «**o el mismo agujero queda abierto para la octava**».
Este cambio **es** la octava, así que la deuda se paga acá.

ADR 0002 decidió «4 vistas» y su enmienda del 21-jul lo subió a «**5 vistas, ni una más**». Desde
entonces entraron tres sin tocar el ADR:

| Vista | Cuándo | ¿Enmendó 0002? |
|---|---|---|
| **Correos** | `49b26b9` | no |
| **Entrenar bot** | `9162ca1` (#256) | no |
| **Libreta** | este PR | **sí — acá** |

(Verificado el 4-ago-2026: `grep` de «entrenamiento» y «Correos» sobre `docs/adr/` no da un solo
resultado — ninguna de las dos dejó ADR ni enmienda.)

**Las tres quedan regularizadas por esta ADR**, y la regla numérica se retira: «N vistas, ni una
más» no sobrevivió a tres contactos con la realidad y no informó ninguna de las tres decisiones.
**Lo que queda como techo es el criterio, no el número**: entra al riel lo que es un **LUGAR** (ADR
0016) y tiene una **acción primaria nombrable** (regla 3 de 0002). Lo que se consulta y se cierra
—Cabina, Ivi— no entra, y esta ADR no las mueve.

La regla que sí sigue en pie sin cambios es la 1 de 0002: **la Bandeja es la casa**, la vista por
defecto y el 90 % del tiempo. Ninguna de las tres nuevas le disputa eso.

## 6 · Cómo se sabe si esto estuvo bien

Acá el test no dice lo que importa: **la métrica es que se use.**

```sql
SELECT vendedora_id, count(*) FROM notas GROUP BY 1 ORDER BY 2 DESC;
```

A la semana: cuántas notas hay y **de cuántas personas distintas**. Si sigue en cero, el problema
**no era el que se arregló** —no era que no se descubriera— y corresponde volver a preguntar antes
de agregarle funciones. Con el ícono a la vista y sin filas nuevas, **B vuelve a la mesa con la
lista que quedó sin construir**: el tope de 2.000 caracteres, los archivos, y la búsqueda que
todavía no ve lo anotado en las conversaciones.

## 7 · Lo que esta decisión NO hace

- **No reescribe la Libreta**: se mueve, no se rehace.
- **No hace un espacio compartido del equipo.** Arrastraría una decisión que hoy no hace falta
  tomar: Hermes **no tiene modelo de permisos**, así que sería «todos editan todo» o inventar
  permisos, que es otro frente entero.
- **No mezcla notas con el CRM** (ADR 0012). **No tiene botón de mandar, y no se lo pongan**: si se
  pareciera a una respuesta rápida rompería «un envío = una acción humana».
- **Sin oro.** El dorado significa tiempo que se acaba, y acá no se acaba nada.
