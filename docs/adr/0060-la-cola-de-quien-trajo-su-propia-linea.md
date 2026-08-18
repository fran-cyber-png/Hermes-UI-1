# ADR 0060 — La cola de quien trajo su propia línea

**Fecha**: 18-ago-2026
**Estado**: aceptado — toca `server/`, así que las dos mitades salen por **N5**
**Reemplaza**: nada.
**Enmienda**: la frontera de la cola (**D4** del plan de roles, `server/src/cola/asignadaSql.ts`) —
le quita **una rama** a un caso, no la reescribe. Y **ADR 0051** queda intacto a propósito: los leads
de formulario siguen entrando, y eso está decidido acá abajo, no olvidado.

---

## El pedido

Del dueño, textual (18-ago-2026):

> «los que se enlazan con qr también deberían poder el ventas meta, solo los 2 — pero de ventas meta
> solo los que le asignaron a ellos».

**Traducido, y así se acordó con él**: quien tiene **línea propia** —la trajo escaneando el QR desde
Hermes, `server/src/routes/miLinea.ts`— ve **su línea entera** más **las conversaciones asignadas a
él en cualquier otra línea**, y **nada más**.

---

## Lo que había

La frontera de la cola (`fronteraDeAsignacionSql`) sirve una fila si:

```
lower(btrim(dueño)) = yo
OR (dueño IS NULL AND lineaAlcanzable)
```

y `lineaAlcanzable` tenía **tres ramas**:

| rama | qué deja pasar |
|---|---|
| `todo.numero_propio IS NULL` | lo que no entró por ninguna línea nuestra: leads de formulario y comentarios de FB/IG |
| la línea es MÍA | `numero_vendedora` me la declara |
| **la línea no tiene dueña** | nadie la declaró en `numero_vendedora`, así que es de todos |

**La tercera rama es de donde salía todo el problema.** Medido con
`cd server && npm run frontera:preflight` contra producción el 18-ago-2026:

| quién | rol | ve | suyas | huérfanas | sus líneas |
|---|---|---:|---:|---:|---|
| `walter` | vendedora | 2.930 | 51 | **2.879** | `51941654039` |
| `usuario1` | **admin** | 5.628 | 51 | **5.577** | `51955135507` |
| `luz` | vendedora | 4.996 | 2.428 | 2.568 | `51984429504` |

Esas 2.879 y 5.577 son **el archivo de las líneas apagadas** —`51986394450` sin un entrante desde el
28-jul, `51944531711` sin tráfico nunca—: como nadie las declara en `numero_vendedora`, quedan
alcanzables para cualquiera. O sea que a quien trajo su propio número le caía encima la historia de
líneas que no atiende nadie, y su propia línea era el 1,7 % de lo que veía.

---

## Las decisiones

### 1 · No es una regla nueva: es **una rama menos**, condicionada

Con `conLineaPropia` en `true`, `lineaAlcanzableSql` deja de agregar la tercera rama y queda:

```
lower(btrim(dueño)) = yo                      ← «de ventas meta solo lo que me asignaron»
OR (dueño IS NULL AND ( numero_propio IS NULL      ← los formularios y comentarios
                        OR la línea es mía ))      ← «su línea entera»
```

Las dos mitades del pedido ya existían: la primera condición de la frontera —que **no mira la
línea**— es exactamente «lo asignado a él en otra línea», y la rama de «la línea es mía» es «su línea
entera». **No hizo falta escribir un predicado nuevo, y por eso no se escribió uno**: las ramas se
componen con `sql.join` y las dos primeras son *el mismo fragmento* para los dos casos. Con un `if`
que devolviera dos ``sql`` `` enteros, el día que alguien toque «la línea es mía» tendría que
acordarse de tocarlo dos veces, y la copia que quedaría vieja es la del caso `false` — que es lo que
ven Luz, Sindy y las cinco `ventas1X`, o sea casi todo el equipo (#37).

Está fijado por un test que no compara texto sino **la diferencia**: el predicado sin línea propia
menos esa rama tiene que dar, carácter por carácter, el predicado con línea propia
(`server/src/cola/asignadaSql.test.ts`).

### 2 · 🔴 Quién tiene línea propia se ata al HECHO, nunca a una lista de nombres

Hoy alcanza a dos personas y mañana a quien vincule, **sin tocar código**. Es el mismo criterio con
el que el repo ya resuelve el aislamiento de campaña (`server/src/cola/lineas.ts`): se pregunta por
lo que el mapa de líneas dice, no por un CSV que hay que acordarse de actualizar. Una segunda lista
es una lista que se desincroniza, y cuando se desincroniza la persona ve de más o de menos **sin un
solo síntoma**.

La regla vive pura y en un solo lugar: `server/src/cola/lineaPropia.ts`.

### 3 · 🔴 El **propósito solo no alcanzaba**, y el conteo solo tampoco

Lo medido el 18-ago-2026 sobre `numeros_wa` × `numero_vendedora`:

| numero | etiqueta | proposito | personas |
|---|---|---|---:|
| 51984429504 | Ventas Meta | **vendedora** | **7** |
| 51941654039 | Walter Ventas | vendedora | 1 |
| 51955135507 | Usuario1 | vendedora | 1 |
| 51963139984 | Betto | campana | 2 |
| 51986394450 | Ventas Perú | escuela | 0 |
| 51944531711 | Venta Peru | vendedora | **0** |

**«Ventas Meta» también dice `vendedora`.** Atar la regla a ese campo se la habría aplicado a Luz, a
Sindy y a las cinco `ventas1X` — o sea a **todo el equipo de la Escuela**, que es exactamente lo
contrario de lo pedido: a cada una se le habría caído el archivo huérfano de golpe, en la misma
pantalla donde hoy trabajan. Lo que discrimina es **cuántas personas comparten el número**: una línea
traída por QR tiene UNA (`miLinea.ts` escribe `proposito: "vendedora"` y `vendedoras: [quien vinculó]`).

**Y el conteo solo tampoco alcanza**, por el lado espejo: el día que Ventas Meta quede con una sola
persona —una baja, o un `PUT /api/admin/numeros/:numero` de Cerberus con `vendedoras` incompleto, que
**vacía el mapa de ese número sin un log** (CLAUDE.md §Administración de números)— el conteo pelado la
marcaría como línea propia y le daría **la línea entera de la Escuela** a quien haya quedado.

Por eso se piden **las dos**, y cada una tiene su test con el caso real que la justifica
(`server/src/cola/lineaPropia.test.ts`).

⚠️ **`personas: 0` no es línea propia** (`51944531711`, «Venta Peru»): un número dado de alta que
nadie declara suyo no lo trajo nadie escaneando un QR. En la práctica esa fila no llega nunca a la
regla —`lineasDeVendedoraConProposito` sólo devuelve líneas donde la persona tiene fila— y la guarda
está igual, porque el preflight arma la lista por otro camino.

### 4 · 🔴 El conteo sale de una **subconsulta**, y ahí está todo el filo

`lineasDeVendedoraConProposito` (`server/src/numeros/repositorio.ts`) ya filtra por `vendedora_id`,
así que cualquier conteo sobre sus propias filas —un `count(*)` agrupado, un `OVER (PARTITION BY)`—
daría **1 para todas**, incluida Ventas Meta. Y `1` es justo el valor que la regla lee como «línea
propia»: el conteo equivocado **no rompe nada ni tira un error**, le regala la regla al equipo
entero. Por eso `personas` es una subconsulta que cuenta el mapa **entero** de ese número, con su
test contra base (`server/src/numeros/repositorio.test.db.ts`).

### 5 · ⚠️ Los leads de formulario **se conservan**, y es una decisión escrita

Es lo primero que uno saca al leer «ve su línea entera más lo asignado»: un formulario no está en
ninguna de las dos bolsas. Pero **ADR 0051 exime a los leads del reparto a propósito** —«la pelota es
nuestra»: nadie les escribió todavía, así que no pueden tener dueño y no hay a quién asignárselos—,
y sacarlos acá le apagaría los formularios a las dos personas del pedido sin que nadie lo pidiera.
Son ~154 tarjetas de trabajo real en la ventana de 30 días. Hay un test cuyo único fin es que
quitarlos cueste discutirlo.

### 6 · La pantalla **dice** por qué la cola es corta

`consultarCola` devuelve `conLineaPropia: true` — y **sólo cuando además aplicó la frontera**, no por
el hecho de tener una línea: un cartel que afirme un recorte que el `WHERE` no hizo es la frontera
imaginaria que este repo no acepta. Con eso:

- el rótulo de la cabecera cambia **su explicación**, no su palabra (`src/features/canales/RotuloDeLaCola.tsx`
  + `src/features/canales/explicacionDeLaCola.ts`): sigue diciendo «para vos», y el `title` deja de
  prometer «lo que todavía no tiene dueña» — que para esta persona es **justo lo único que ya no ve**;
- el vacío deja de decir «no entró nada» (que sería falso: entró, no es suyo) y explica las dos
  fuentes de su cola (`src/features/canales/VacioDeLineaPropia.tsx`);
- y **no se festeja** «estás al día» sobre una mesa que nunca tuvo trabajo, salvo que la cifra de
  atendidas de hoy lo respalde (`src/features/canales/ColaUnificada.tsx`).

Es la misma forma que el Dashboard usa con `soloMisAsignadas` (ADR 0036) y por el mismo motivo: un
vacío sin motivo en este repo se lee «se perdieron las conversaciones».

### 7 · Fail-open cuando no se sabe

`undefined` (no se pudo leer el mapa) y `[]` (no tiene ninguna) contestan lo mismo: **false**, o sea
«comportate como hoy». `true` **quita** una rama, así que afirmarlo sin estar seguro es esconderle
trabajo a alguien. En el front el campo se lee **opcional** y `=== true`: ausente es «no se sabe» —un
server viejo (el front sale por N4 y el server por N5) o una página rehidratada del caché de IndexedDB,
ADR 0007—, nunca «no tiene línea propia».

---

## Lo que este cambio **no** es

🔴 **Sigue siendo un recorte de la LISTA, no aislamiento.** `docs/auditoria-aislamiento-de-chats-2026-08-17.md`
lo midió: la cola es la **única** superficie con recorte — el hilo, la ficha y el envío siguen
sirviendo cualquier conversación a cualquier token, porque Hermes no tiene modelo de permisos
(`requiereVendedora` dice «es una vendedora», no «cuál»). Lo que esto garantiza es **qué aparece en
la cola de quien mira**, no qué se puede pedir. Decir más sería prometer una frontera imaginaria:
peor que ninguna, porque se le cree.

⚠️ **`usuario1` es ADMIN, y `veTodo` gana primero.** `fronteraDeAsignacionSql` sale por `null` antes
de mirar la línea propia, así que esta regla **no lo va a tocar** aunque tenga su línea del QR. Es
correcto y no se fuerza: recortarle la mesa a quien reparte haría falso a **D4** —la frontera es
propiedad del ROL— y no se puede repartir lo que no se ve. Acotarlo es **cambiarle el rol**, que es
operación y no código. Hay test de esa precedencia, y el preflight tiene la misma exclusión (si no,
saldría en rojo hoy contra producción por un motivo falso).

⚠️ **Nadie fue agregado a la rueda del reparto**, por decisión del dueño: él asigna a mano después.
Medido el 18-ago-2026: `conversacion_asignada` sólo tiene filas de `luz` (2.355), `Sindy` (192),
`ventas10`–`ventas14` y `Tracy` — **ni Walter ni Usuario1 tienen una sola**. O sea que el efecto
visible del frente el día del deploy es *casi todo resta*: la cola de Walter baja a su línea y a sus
formularios, y de Ventas Meta no le llega nada **hasta que el dueño asigne**. Eso no es un defecto
del recorte, es el estado del reparto — y es exactamente por eso que la pantalla lo explica.

---

## Lo que queda abierto (medido, no supuesto)

- 🔴 **Estar en el mapa de una línea compartida sigue dando esa línea ENTERA.** La rama de «la línea
  es mía» no distingue propia de compartida: verificado contra base, si a alguien con línea propia se
  lo agrega a `numero_vendedora` de `51984429504`, empieza a ver **también lo huérfano de Ventas
  Meta**, no sólo lo asignado. Hoy no muerde —ninguna de las dos personas está en ese mapa— y **el
  camino operativo natural para «darle Ventas Meta» es justamente ese**, así que hay que saberlo: lo
  que el pedido quiere se consigue **asignando conversaciones**, nunca agregándolo al mapa de la
  línea.
- ⚠️ **La misma persona cargada dos veces en su propia línea apaga la regla, en silencio.**
  `personas` es un `count(*)` crudo, así que `walter` + `Walter` —o una identidad federada
  `centurion:…` de la misma persona— cuenta 2 y la línea deja de ser propia: verificado contra base,
  vuelve a ver el archivo. Falla hacia el lado seguro (ve de más) y **el preflight lo detecta** porque
  ahí se cuenta `DISTINCT lower(btrim(...))` y se cruza contra lo que el server dijo.
- ⚠️ **El Dashboard no acompaña**: para quien no supervisa recorta a `conversacion_asignada`
  (`server/src/dashboard/personal.ts`, ADR 0036), así que la línea propia —cuyas conversaciones no
  están asignadas a nadie— **no aparece ahí**. La cola le dice «tu línea es tuya» y el Dashboard le
  muestra cero. Es anterior a este frente y no se tocó; es el primer candidato a revisar.
- ⚠️ **El tiempo real tampoco**: `server/src/realtime/visibilidad.ts` es fail-closed por dueña (ADR
  0059), así que a una conversación **sin dueña de su propia línea no le suena la campanita**. La fila
  aparece igual en la cola; falta el sonido.

---

## Los candados

| archivo | qué fija |
|---|---|
| `server/src/cola/lineaPropia.test.ts` | la REGLA pura, con los seis números de producción y los dos casos que hacen que ninguna condición alcance sola |
| `server/src/numeros/repositorio.test.db.ts` | que `personas` cuente **el mapa entero** del número y no las filas de quien pregunta |
| `server/src/cola/asignadaSql.test.ts` | que la diferencia entre los dos predicados sea **exactamente una rama**, que los leads sobrevivan en los dos, y que `veTodo` gane antes |
| `server/src/cola/consultarCola.lineaPropia.test.db.ts` | el **cableado**: de `numeros_wa` hasta las filas servidas, el total, los conteos, el desglose y la bandera de la respuesta |
| `server/src/cola/preflightFrontera.test.ts` | que un deploy donde la regla **no surtió efecto** no pase en verde |
| `src/features/canales/RotuloDeLaCola.test.tsx` | que la explicación cambie y **no** siga prometiendo lo huérfano |

**Antes del N5**: `cd server && npm run frontera:preflight` contra producción. Frena por tres lados
—alguien en cero, alguien arrastrando el archivo, y ahora «no pasó nada»— y esa última pregunta es la
que este frente necesitaba: la regla puede estar escrita, testeada y **no cableada**, y ahí la cola
sale idéntica sin un solo error (la lección de ADR 0024).

**Evidencia**: `docs/evidencia/cola-linea-propia-rotulo.png` — los cuatro rótulos con el texto del
`title` impreso al lado (en una captura ese atributo no se ve) y el vacío abajo. Sin server:
`npx vite --port 5199` → `/galeria-cola-recortada.html`.
