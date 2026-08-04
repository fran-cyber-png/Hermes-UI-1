# La Libreta como vista propia — el espacio para anotar del vendedor

> **4-ago-2026.** Estado verificado en producción ese día.
> **Disparador**: los 6 vendedores nuevos necesitan un lugar donde anotar
> «cualquier cosa, tipo Notion».

---

## 1 · Lo primero: eso ya existe, y nadie lo usó

Antes de planear una pantalla nueva hay que decir lo que se encontró al revisar el repo.

**Hermes ya tiene la Libreta** (`src/features/notas/Libreta.tsx`), con:

- **editor rico de verdad** — BlockNote (`@blocknote/core`, `/mantine`, `/react` en
  `package.json`), el mismo motor que usa Notion: bloques, encabezados, listas, checklists;
- pantalla completa, con lista de notas al costado, **búsqueda** (índice GIN) y fijar;
- se abre con la tecla **`n`** y se cierra con Escape;
- persiste en la tabla `notas`: el documento rico en `doc` y el texto plano derivado en la
  **misma escritura**, para que la búsqueda funcione con notas viejas y nuevas sin una
  rama que las distinga.

Y el dato que ordena todo el plan: **verificado el 4-ago en producción, la tabla `notas`
no tiene ni una fila.** Nadie escribió nunca una nota.

Así que el problema **no es que falte la herramienta**. Eran dos hipótesis:

| | |
|---|---|
| **A · No se descubre** | se abre con una tecla que nadie enseñó y no tiene ícono en ningún lado |
| **B · No sirve** | es privada por vendedora, y lo que hace falta es algo compartido |

---

## 2 · Decisiones cerradas (4-ago, Estephano)

**Es A.** La libreta **sigue siendo privada por vendedora** y **pasa a ser la octava vista
del riel**.

### Por qué el riel y no la Agenda

Se consideró meterla en Agenda —la vendedora ya va ahí a planificar el día— y **se
descartó**, por una razón de fondo:

**La Agenda está organizada por tiempo.** Grilla del mes, seguimientos como chips dentro
de los días, vencidos en rojo arriba, y el oro reservado a una sola cosa: *tiempo que se
acaba*.

**Una nota no tiene tiempo.** No vence, no se agenda, no deriva nada (ADR 0012).

Meterla ahí obliga a anclarla a un día —el que se escribió— y entonces:

- buscar «el precio de México que anoté» exige recordar **qué día fue**. Eso es un archivo
  cronológico, no una libreta;
- en tres semanas alguien va a decir que su nota «desapareció», porque quedó en un día que
  ya pasó;
- y en esa pantalla **el oro significa que algo se acaba**, así que una nota ahí estaría
  diciendo que vence.

### Por qué se le da la excepción a ADR 0016

El criterio del riel es **«el riel es para LUGARES»**, y por eso la Libreta quedó afuera
(ticket #197). Ese criterio no se rompe acá — **se cumple**:

- La **Cabina** (`?`) e **Ivi** (`i`) no son lugares: son **consultas** que abrís, usás y
  cerrás.
- Una **libreta es un lugar**: entrás, estás un rato, volvés. Es donde se trabaja.

Y la decisión previa se tomó cuando la libreta era chica, personal y no entraba gente
nueva. Hoy entran seis el mismo día y **la tabla tiene cero filas**: la evidencia de que
«está bien donde está» no existe, y la de que no se descubre es total.

> **El costo, dicho:** es la octava vista, y un riel que crece sin criterio termina siendo
> un menú. Por eso el ADR tiene que decir **entra porque es un lugar**, no «porque hacía
> falta».

---

## 3 · Lo que hay que construir

- [ ] **La octava vista** (`⌘8`), con ícono propio, en `VISTAS` de `App.tsx`.
      **La Libreta ya existe entera: es moverla, no reescribirla.**
- [ ] **El atajo `n` sigue andando.** Quien ya lo usa no pierde nada.
- [ ] **Revisar la cascada de Escape.** 🔴 Ver abajo — es donde esto se rompe.
- [ ] **Que no arranque en blanco**: nace con una nota de bienvenida que muestre para qué
      sirve. Una libreta vacía no enseña qué poner.
- [ ] **Verificación visual** (regla dura #2): captura desktop y mobile.

### 🔴 El Escape es el riesgo real de este cambio

Hoy la Libreta es **una hoja encima de la app** y `App.tsx` la cierra **primero** en su
cascada de Escape. Como vista del riel **deja de ser una hoja**, y ese orden cambia.

Es exactamente donde ADR 0024 dice que se rompen las cosas: el defecto no estaba en la
decisión sino **en el CABLEADO**, y **ningún test puro lo ve**. Ya pasó con `ConsultaIvi`,
que se comió el Escape de toda la app y dejaron de andar cerrar la conversación, cerrar la
Cabina y cerrar la libreta.

**Cómo se cuida**: test de componente con DOM — archivo `*.test.tsx` con
`// @vitest-environment jsdom` en la **primera línea**, usando el andamio de
`src/pruebas/dom.tsx` (`montar`, `teclear('Escape')`, `await reposar()`), que existe
justamente porque una regresión de teclado no la puede ver ningún test puro.

### El atajo ⌘8 ya funciona solo

El rango de `⌘1..N` **se deriva de `VISTAS`** desde el PR de la vista de entrenamiento —
antes era un `'6'` escrito a mano que se quedó corto sin que nada lo dijera. Agregar la
octava al array alcanza.

---

## 4 · Lo que este plan NO hace

- **No reescribe la Libreta.** Funciona, tiene editor rico y búsqueda. Lo que falte se le
  agrega.
- **No hace un espacio compartido del equipo** (la hipótesis B: cómo se vende acá, precios,
  objeciones). Si más adelante se quiere, arrastra una decisión que hoy no hace falta
  tomar: Hermes **no tiene modelo de permisos**, así que sería «todos editan todo» o
  inventar permisos, que es otro frente entero.
- **No mezcla notas con el CRM.** De una nota no se deriva nada —ni etapa, ni recordatorio,
  ni envío (ADR 0012)—: si se pareciera a una respuesta rápida rompería «un envío = una
  acción humana». **No tiene botón de mandar, y no se lo pongan.**
- **Sin oro.** El dorado significa tiempo que se acaba, y acá no se acaba nada.

---

## 5 · Cómo se verifica

Esto es de las pocas cosas donde el test no dice lo que importa: **la métrica es que se
use.**

```sql
SELECT vendedora_id, count(*) FROM notas GROUP BY 1 ORDER BY 2 DESC;
```

A la semana: cuántas notas hay y **de cuántas personas distintas**. Si sigue en cero, el
problema no era el que arreglamos —no era que no se descubriera— y conviene volver a
preguntar antes de agregarle funciones.

Lo que sí se fija con test:

- la vista aparece en el riel y `⌘8` la abre;
- **Escape sigue cerrando lo que cerraba antes** en toda la app (el test con DOM);
- el atajo `n` sigue funcionando.

---

## 6 · Cómo se sube a producción

Igual que todo acá (`CLAUDE.md`). **`main` es producción: rama + PR + CI verde.**

```bash
# 1 · rama desde main actualizado
git checkout main && git pull --ff-only
git checkout -b feat/libreta-en-el-riel

# 2 · verificar (este frente NO toca el schema: no hay migración)
npx tsc --noEmit -p tsconfig.app.json
npm test                      # incluye el test con DOM del Escape

# 3 · verificación visual — regla dura #2, no se salta
#     la app real pide login contra Cerberus, así que la captura se hace
#     con una galería aparte, como `galeria-entrenamiento.html`
npm run dev
#     → capturar desktop (1280×720) y mobile (390×844) en docs/evidencia/

# 4 · commit, push y PR
git add -A && git commit && git push -u origin feat/libreta-en-el-riel
gh pr create --repo Goberna-Lab/hermes --base main

# 5 · merge con rebase
gh pr merge <n> --repo Goberna-Lab/hermes --rebase --delete-branch
```

### Este frente sí llega solo a producción

**Es puro front.** Al mergear a `main`, **N4 despliega el front sin restart y con cero
downtime**. No hace falta N5 —que es el server— ni hay migraciones que aplicar.

Es la diferencia con el plan del reparto: aquel toca schema y server, y necesita el botón.

### Verificar que llegó

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://hermes-api.goberna.us/
```

Y en la app: que el riel muestre ocho lugares y que `⌘8` abra la Libreta.

> ⚠️ **Ojo con el caché del navegador.** El front se sirve como estáticos; si alguien no
> ve la vista nueva, que recargue forzado antes de reportar que no salió.
