# Repartir los leads de una línea entre varios vendedores

> **4-ago-2026.** Estado verificado en producción ese día.
> **Disparador**: entran vendedores nuevos y a todos se les da **una sola línea**,
> la del bot: `51984429504`.
>
> ✅ **VIVO EN PRODUCCIÓN desde el 4-ago-2026, 15:25 UTC.** VPS1 corre `9f33b5e`, las dos
> tablas están creadas y la rueda tiene a los cinco. Desde ese momento, cada lead nuevo que
> escribe a `51984429504` sale con dueño. Ver §10 para lo que se verificó y lo que queda por
> mirar en los próximos días.
>
> ⚠️ **Son 5 vendedores, no 6** (confirmado por Estephano el 4-ago). Todo lo escrito acá vale
> igual: la rueda no tiene número fijo.

---

## 1 · El problema

Hasta hoy cada vendedora tenía **su** número. Desde hoy **siete personas comparten uno**
(las 6 nuevas + Luz, que ya lo tiene asignado en Cerberus), y no hay nada en Hermes que
reparta: los 91 leads que ya escribieron —y los que lleguen— aparecen igual para todos,
sin dueño.

Sin reparto pasan las dos cosas de siempre:

- **dos personas contestan al mismo lead** — el tell más obvio de que atrás hay desorden;
- **nadie contesta a otro**, porque todos asumen que lo agarró alguien más.

---

## 2 · El contexto, verificado

| Hecho | Detalle |
|---|---|
| **La línea es Cloud API**, no whatsmeow | los mensajes entran por el webhook de Meta (`webhook/whatsapp.ts` → `events`), no por una sesión con QR |
| **91 personas** ya escribieron a esa línea | medido el 3-ago |
| `numero_vendedora` mapea **línea → vendedora** | hoy: `504→Luz`, `450→Luz`, `039→Walter`, `711→Sindy` |
| **No existía asignación de conversación** | se buscó: no había tabla, columna ni concepto |
| «Las mías» es un **filtro, no un permiso** | decisión del 24-jul. `cola/lineas.ts`, **fail-open** |
| **Hermes no tiene modelo de permisos** | `requiereVendedora` dice «es una vendedora», no «cuál» |
| El bot está **en sombra** en esa línea | piensa y guarda, no manda (`bot_estado`, 3-ago) |
| **Cerberus** administra los números | `whatsapp_links` → `PUT /api/admin/numeros/:numero` con `{vendedoras:[…]}` |

### 🔴 Por qué `numero_vendedora` NO alcanza

Es el error fácil: «agrego las 6 filas en Cerberus y listo». **No reparte.** Con siete
filas para el mismo número, el filtro «Las mías» le devuelve a **cada uno la línea
entera**: los seis ven las mismas 91 conversaciones y ninguna tiene dueño.

Ese mapa responde *«¿quién atiende este número?»*. La pregunta nueva es
***«¿de quién es esta conversación?»*** — otra pregunta, otra tabla.

---

## 3 · Decisiones cerradas (4-ago, Estephano)

1. **Round-robin, no azar.**
   Round-robin es repartir por turnos, en orden, dando la vuelta —como repartir cartas—.
   Con 6 personas y 10 leads: los primeros seis van uno a cada uno, el séptimo vuelve al
   primero. **La diferencia entre el que más y el que menos recibe es siempre 1.**
   Al azar, esos mismos 10 pueden caer 4 en una persona y 0 en otra; con seis personas que
   entran hoy, esa varianza **se lee como favoritismo** aunque sea mala suerte. Además
   round-robin es **auditable**: cualquiera verifica que le tocó lo que le tocaba.

2. **Solo los 6 nuevos entran a la rueda.** Luz queda afuera: sigue viendo la cola
   completa y atendiendo lo que venía, pero no recibe asignados.

3. **El reparto arranca con lo nuevo.** Las 91 conversaciones viejas **no se reparten**.
   > ⚠️ **Consecuencia asumida**: esas 91 quedan sin dueño en la misma cola donde entran
   > las asignadas. El riesgo es que se atienda lo que tiene nombre y lo viejo se muera.
   > Si en unos días se ve que pasa, repartirlas es un script, no un rediseño.

4. **Sigue siendo un filtro, no una frontera.** Cualquiera puede abrir cualquier
   conversación. No se inventa un permiso porque Hermes no tiene con qué sostenerlo, y
   presentar un recorte como frontera sería una frontera imaginaria — peor que ninguna,
   porque se le cree.

5. **Cerberus no se toca** para esto (ver §7).

---

## 4 · Cómo está construido

```
server/src/reparto/rueda.ts        ← la decisión, PURA (a quién le toca)
server/src/reparto/destino.ts      ← a quién se le PUEDE pasar, PURA (la red anti-dedazo)
server/src/reparto/asignar.ts      ← el seam con la base
server/src/db/reparto.ts           ← las dos tablas
server/drizzle/0015_*.sql          ← la migración
server/src/cola/asignadaSql.ts     ← el dueño en la fila + el predicado de «Míos»
server/src/routes/reparto.ts       ← GET /rueda · PUT /asignacion
server/src/scripts/repartoRueda.ts ← `npm run reparto:rueda` (ver · agregar · sacar)
src/features/canales/dueno.ts      ← qué dice la píldora, PURA
src/features/reparto/              ← «pasar la conversación» + la galería de evidencia
```

### Las dos tablas

**`reparto_rueda`** — quiénes participan, por línea.
`numero_propio` · `vendedora_id` · `orden` · `activa` · `agregada_en`

Es tabla propia y **no se deriva de `numero_vendedora`** a propósito: derivarla metería a
Luz sin que nadie lo pida, y como Cerberus empuja ese mapa, un cambio allá movería el
reparto acá **en silencio**.

**`conversacion_asignada`** — de quién es cada conversación.
`clave` (PK) · `vendedora_id` · `numero_propio` · `motivo` · `asignada_por` · `asignada_en`

La `clave` es la de siempre (`conv:<canal>:<persona>:<numeroPropio>`): no se inventa
identidad nueva.

### Se elige por CARGA, no con un puntero

Lo obvio sería guardar «a quién le tocó último» y avanzar. **No se hace**: un puntero se
desincroniza —alguien entra, otro sale, se borra una asignación— y queda apuntando a
alguien que ya no está, sin que nadie lo note hasta que el reparto está torcido.

Acá se le da **al que menos tiene**. Es equivalente a round-robin desde cero y además
**se auto-corrige**: quien se suma tarde recibe hasta emparejar, sin reiniciar nada.

### Fail-open

Sin tabla migrada o sin nadie en la rueda, **no asigna y devuelve `null`** — la
conversación queda sin dueño, que es el comportamiento de antes. Lo que **no** puede hacer
es tumbar la ingesta: un lead perdido por un fallo del reparto es infinitamente peor que
un lead sin repartir.

### Un defecto que el test atrapó, y conviene no repetir

La primera versión de `leerRueda` usaba un **subquery correlacionado** y drizzle **no lo
correlacionaba**: el `count(*)` devolvía el total de la tabla para todos, las seis
parecían tener la misma carga y **todo caía en la primera**. El test lo destapó (la suma
dio 120 con 20 asignaciones = 20 × 6). Hoy usa `LEFT JOIN` + `GROUP BY`.

---

## 5 · Lo que faltaba implementar — hecho el 4-ago

- [x] **Conectar la asignación a la entrada de mensajes** (`webhook/whatsapp.ts`). Va
      **después** de persistir el mensaje y **después** de notificar al bot: el despachador
      es lo único de ese bloque con una persona esperando del otro lado. `asignarSiHaceFalta`
      ya atrapa todo adentro, y el `.catch` del call-site es una segunda línea a propósito —
      el reparto nunca puede hacer perder un lead.
- [x] **Filtro «Míos» en la cola.** `GET /api/conversaciones?mios=1`, con el `vendedoraId`
      resuelto **en el server** desde el token. Recorta la página, el total, **los conteos de
      los otros chips** y el desglose: con «Míos» puesto, «Piden info · 12» dice 12 *de las
      mías*. El conteo del propio chip se calcula **con el filtro apagado**, que es cuando se
      lo mira.
- [x] **El dueño en la fila** (`asignada_a` + `canales/dueno.ts`): «Vos» en navy, el nombre
      de la otra persona en neutro, y **nada** si no tiene dueño.
- [x] **Cómo se carga la rueda**: `npm run reparto:rueda`. Ver §6 — reemplaza al SQL a mano.
- [x] **Pasar una conversación a otra persona** desde la UI: `PasarConversacion`, en la
      `BarraGestion` del chat (no en el menú ▼ de la fila, que es solo para marcas
      personales). Muestra la carga de cada uno al elegir.

### Tres cosas que se decidieron al implementar, y no estaban en el plan

1. **🔴 `?mios=1` y `?mias=1` se escriben con una vocal de diferencia**, viven en la misma
   ruta y **confundirlos no rompe nada visible: devuelve otra cola**. `mias` = mis LÍNEAS
   (`numero_vendedora`); `mios` = mis CONVERSACIONES asignadas. Adentro se llaman
   `misLineas` y `misAsignadas` —que no se parecen—, se leen juntos y comentados en la ruta,
   y hay un test que los cruza a propósito (`consultarCola.mios.test.db.ts`).

2. **El destino de una reasignación se VERIFICA** (`reparto/destino.ts`). El
   `vendedora_id` es el username de Cerberus y Hermes **no tiene padrón** contra el cual
   chequearlo, así que un dedazo escribía una fila válida y la conversación desaparecía de
   la cola de todos, sin un solo síntoma. Ahora un destino que no está ni en la rueda ni en
   `numero_vendedora` es un **409 que enumera a quién sí se puede** — nunca un 200.

   🔴 **Y midiendo eso contra producción apareció el mismo fallo por la otra puerta.** En
   VPS1, el 4-ago: `numero_vendedora` dice **`Luz`** (lo empuja Cerberus) y
   `sesiones_cerberus` dice **`luz`** (lo que ella tipea al entrar); en `gestiones` conviven
   `Usuario1` y `luz`. El `vendedoraId` del token es lo tipeado, así que **el mismo humano
   tiene dos grafías vivas** y una conversación asignada como `Luz` era **invisible para su
   propia dueña, para siempre y sin síntoma**. Se corrigió comparando normalizado **de los
   dos lados** —`lower()` en `cola/asignadaSql.ts`, `mismaVendedora` en `reparto/destino.ts`
   y en `canales/dueno.ts`—, guardando siempre la grafía que vino. Dos tests que afirmaban
   lo contrario **se dieron vuelta**: lo que reabre el agujero es normalizar de UN lado, no
   normalizar. El script además avisa si se agregan dos grafías de la misma persona, que
   crearían dos participantes con media parte cada uno.

3. **«Míos» NO es fail-open**, y ahí se separa de «Las mías». Aquél degrada en «ves de más»
   porque el mapa lo empuja Cerberus y puede estar incompleto; acá, cero asignadas es un
   hecho verdadero («todavía no te tocó ninguna»). Lo que evita la cola vacía sin
   explicación es otra cosa: **el chip lleva su número**, así que no se entra a ciegas, y con
   el filtro puesto queda encendido con su ✕ a un click. Lo único que sí se apaga solo es
   «Míos» sin la migración aplicada (`sinAsignacion`): ahí el 0 mentiría sobre el motivo.

### Queda abierto, no bloquea

**¿Qué pasa si alguien no atiende lo suyo?** Un lead asignado y sin respuesta es **peor**
que uno sin asignar: ahora tiene a quién culpar y sigue sin contestarse. Propuesta: que la
cola muestre los asignados sin responder hace más de X, **visible para todos**.

---

## 6 · Cómo se opera

**Todo con `npm run reparto:rueda`, desde `server/`.** El SQL a mano que este plan proponía
se retiró: cargar cinco usernames con `psql` contra la base viva es exactamente el momento
en que se escribe `ventas11@grupogoberna` sin el `.com`, y **ese dedazo no tiene síntoma**.
El script es **dry-run por default**, como todo lo que escribe en esta casa.

### Ver cómo va (read-only, es el default)

```bash
cd server && npm run reparto:rueda            # la línea del bot es el default
npm run reparto:rueda -- --linea 51941654039  # otra línea
```

Imprime quién está en la rueda, cuántas tiene cada uno, quién quedó fuera, **cuántas
conversaciones no tienen dueño**, y verifica la propiedad que el reparto promete: si la
diferencia entre el que más y el que menos recibe pasa de 1, lo dice en rojo.

### Cargar la rueda

```bash
npm run reparto:rueda -- --agregar usuario1,usuario2,usuario3   # dry-run: no escribe
npm run reparto:rueda -- --agregar usuario1,usuario2,usuario3 --aplicar
```

⚠️ El `vendedora_id` es el **username de Cerberus**, la misma clave que usa el resto de
Hermes. **Hermes no lo puede verificar**: el login es un handshake contra Django y lo único
que vuelve es «entró» o «no entró». Lo que el script sí hace es avisar cuáles **nunca
entraron a Hermes** (`sesiones_cerberus`) — para gente que recién arranca eso va a ser
«todos», así que **la verificación de verdad es humana, contra el panel de Cerberus**. Y hay
una comprobación gratis: después de que entren una vez, `npm run reparto:rueda` los muestra
como conocidos.

### Sacar a alguien de la rueda

```bash
npm run reparto:rueda -- --sacar usuario --aplicar
```

Es **baja lógica**: deja de recibir nuevas y **conserva las que tenía**. Borrar la fila
dejaría conversaciones sin dueño y sin rastro de quién las tenía. Volver a agregarlo lo
reactiva sin perder su lugar (conserva su `orden`).

### Repartir las viejas, si se decide

Las conversaciones anteriores al reparto **no se reparten** (decisión 3). El script cuenta
cuántas son en cada corrida. Cuando alguna vuelva a escribir, ahí sí le toca dueño — que es
el caso en que importa. Si se decidiera repartir el resto de una, es un script sobre el
mismo seam (`asignarSiHaceFalta`), no un rediseño.

---

## 7 · Cerberus: qué NO hay que cambiar (y qué sí, después)

**Para el reparto no hace falta tocar Cerberus.** La rueda vive en Hermes, y las 6
personas entran a Hermes con su usuario de Cerberus (el login es contra Django; cualquier
usuario suyo entra).

Dos cosas para más adelante, cada una su propio PR:

1. **Falta el número del bot en el panel de Cerberus.** Su lista muestra 3 números y
   `51984429504` no está: se creó directo en Hermes el 1-ago. No rompe nada, pero el panel
   **miente por omisión** — el día que alguien busque ahí quién atiende esa línea, no la
   encuentra.
2. **Si se quiere administrar la rueda desde Cerberus**, hace falta un «participa del
   reparto» junto a `vendedoras`, y eso es **un contrato nuevo entre los dos repos**.

> 🔴 **La trampa**: cargar el número en Cerberus y asignarle los 6 vendedores **no
> reparte**. Le da a cada uno el filtro «Las mías» con la línea entera. Se puede hacer
> igual (deja el panel honesto), pero el reparto lo hace la rueda de Hermes.

---

## 8 · Cómo se verifica

- **Tests puros**: `rueda.test.ts` fija la propiedad prometida —entre el que más y el que
  menos recibe **nunca hay más de 1**, para 1, 5, 6, 7, 10, 23 y 100 leads—; `destino.test.ts`
  fija que el dedazo se rechaza y que con la lista vacía **no vale cualquiera**;
  `dueno.test.ts` (front) fija que sin dueño no se dibuja nada.
- **Tests con base**: `asignar.test.db.ts` (carga por línea, dos mensajes casi simultáneos,
  sacar a alguien sin dejar huérfanos, degradar sin tabla) y `consultarCola.mios.test.db.ts`
  (el recorte, los conteos, el desglose, la degradación, y el cruce `mios` ≠ `mias`).
- **Un choque real que el test destapó**: `conversacion_asignada.numero_propio` colisiona con
  el `numero_propio` de la cola, y `LEFT JOIN conversacion_asignada` a secas rompía la
  consulta entera con `42702`. El join proyecta dos columnas, no la tabla.
- **La UI, con captura** (regla dura #2): `npx vite --port 5199` →
  `http://localhost:5199/galeria-reparto.html`, sin server ni base. Evidencia en
  `docs/evidencia/reparto-cola.png`. Ahí se decidió que **el dueño va en el renglón 1**: abajo,
  con el chip del bot al lado, el preview quedaba en «Bue…» — y eso pasa justo en la línea del
  bot, que es la que se reparte.
- **En producción**, después de prender: `npm run reparto:rueda`. Diferencia máxima 1.

---

## 10 · Cómo quedó en producción

Se prendió el 4-ago-2026. El código está verificado con 1.619 tests puros + 404 con base del
lado server, 580 del front, lint sin errores y captura de la UI.

### Los 5 usernames — resueltos

**Son 5, no 6**, y el `vendedora_id` **ES el correo completo**. Verificado en el panel de
permisos de Cerberus el 4-ago: el usuario se llama `ventas10@grupogoberna.com` y el campo de
email está vacío («Sin email registrado») — o sea que el correo ocupa el lugar del username.
Es distinto de las vendedoras viejas (`luz`, `alan`, `Usuario1`), y por eso había que mirarlo
en vez de suponerlo.

```
ventas10@grupogoberna.com
ventas11@grupogoberna.com
ventas12@grupogoberna.com
ventas13@grupogoberna.com
ventas14@grupogoberna.com
```

> ⚠️ En la primera lista que se pasó, el segundo venía como `ventas11@grupogoberna`, **sin el
> `.com`**. Cargado así, esa persona no vería ni uno de sus asignados y nada avisaría: es el
> ejemplo exacto del fallo silencioso contra el que existen `reparto/destino.ts` y el
> dry-run del script. La lista de arriba es la corregida.

En la píldora de la fila eso se lee **«Ventas10»**, no el correo entero: `nombreCorto()` corta
en el `@`.

### Paso 1 — desplegar ✅

Hecho por el camino de la casa (§9): PR **#273** → N1/N2/N2b verdes → merge con rebase → N5.
Verificado en VPS1 después del deploy: commit `9f33b5e`, `systemctl is-active hermes` → `active`,
`/health` → `{"ok":true}`, y **las dos tablas creadas** (`reparto_rueda`, `conversacion_asignada`).
Las rutas nuevas responden **401** sin token —montadas y detrás del perímetro, no 404— y el bundle
del front que sirve producción ya trae «Míos», `asignada_a` y el puente a `/api/reparto/rueda`.

### Paso 2 — cargar la rueda ✅

Corrido **en VPS1**, que es donde vive el `.env` de producción — no en la máquina de nadie:

```bash
ssh deploy@161.132.39.165 'cd /srv/hermes/server && npm run reparto:rueda -- \
  --agregar ventas10@grupogoberna.com,…,ventas14@grupogoberna.com [--aplicar]'
```

Cómo quedó, leído de vuelta:

```
Línea 51984429504 — la rueda del reparto
  · ventas10@grupogoberna.com    0 asignadas
  · ventas11@grupogoberna.com    0 asignadas
  · ventas12@grupogoberna.com    0 asignadas
  · ventas13@grupogoberna.com    0 asignadas
  · ventas14@grupogoberna.com    0 asignadas
  ✓ Reparto parejo: la diferencia entre el que más y el que menos es 0.
  0 conversaciones con dueño · 91 sin dueño (últimos 30 días)
```

Las **91 sin dueño** coinciden con el censo del 3-ago que abre este documento: es la señal de
que el script está mirando la línea correcta.

**Luz queda afuera de la rueda** (decisión 2): sigue viendo la cola completa y se le puede
pasar una conversación a mano, pero no recibe asignados.

### Lo que hay que mirar en los próximos días

1. **Que los cinco usernames sean los correctos.** El script avisó que **ninguno entró a Hermes
   todavía** —normal, los crearon ese día—, y ése es el único chequeo que Hermes puede hacer.
   Después de que cada una entre una vez, `npm run reparto:rueda` las marca como conocidas: **esa
   es la confirmación**. Si alguna sigue apareciendo como desconocida después de haber entrado,
   el username está mal y sus leads no le aparecen en «Míos» (siguen visibles para todos en la
   cola compartida — no se pierde ninguno).
2. **Que el reparto salga parejo**: `npm run reparto:rueda`. Si la diferencia entre el que más y
   el que menos pasa de 1, algo anda mal — es la propiedad que los tests fijan.
3. **Las 91 sin dueño.** No se reparten solas (decisión 3). El riesgo asumido es que se atienda
   lo que tiene nombre y lo viejo se muera. Si en unos días se ve que pasa, repartirlas es un
   script sobre el mismo seam, no un rediseño.

---

## 9 · Cómo se sube a producción

Es el flujo de la casa (`CLAUDE.md` §Flujo de trabajo y §Deploy). **`main` es producción:
no se commitea ni se pushea directo.**

```bash
# 1 · rama desde main actualizado
git checkout main && git pull --ff-only
git checkout -b feat/reparto-de-leads

# 2 · al tocar el schema: generar la migración y FIJAR EL `when`
cd server && npm run db:generate
cd .. && JOURNAL_FILE=server/drizzle/meta/_journal.json goberna-journal-set-when
cd server && npx tsx --test src/pruebas/journal.test.ts   # el guard
```

> 🔴 **El paso del `when` no es opcional.** Drizzle genera un `when` que puede quedar
> **anterior** al de la migración previa, y entonces **saltea la migración sin error**: el
> deploy sale verde con la tabla sin crear. Pasó en las tres migraciones de esta semana —
> las tres vinieron atrasadas y las tres hubo que corregirlas.

```bash
# 3 · verificar todo antes de subir
cd server && npx tsc --noEmit && npm test
docker compose -f ../docker-compose.test.yml up -d --wait
DATABASE_URL='postgresql://hermes_test:hermes_test@127.0.0.1:5439/postgres' npm run test:db
cd .. && npx tsc --noEmit -p tsconfig.app.json && npm test

# 4 · commit, push y PR (CI verde: N1, N2, N2b)
git add -A && git commit && git push -u origin feat/reparto-de-leads
gh pr create --repo Goberna-Lab/hermes --base main

# 5 · merge con REBASE (historia lineal)
gh pr merge <n> --repo Goberna-Lab/hermes --rebase --delete-branch
```

### El deploy del server es un botón aparte

Mergear **no** pone el server en producción: N3 y N4 despliegan staging y el **front**.
El server es **N5**, manual:

```bash
gh workflow run desplegar-server.yml --repo Goberna-Lab/hermes -f confirmar=reiniciar
```

El script versionado (`deploy/vps1/hermes-deploy.sh`) **respalda la base** → migra →
construye → reinicia → espera `/health` → corre el smoke, y **revierte solo si falla**.

### Verificar en el servidor, no en el workflow

```bash
ssh deploy@161.132.39.165 'cd /srv/hermes && git log --oneline -1 && systemctl is-active hermes'
curl -s https://hermes-api.goberna.us/health
```

Y que las tablas existan:

```sql
SELECT tablename FROM pg_tables
 WHERE tablename IN ('reparto_rueda','conversacion_asignada');
```

**Recién después** cargar la rueda (§6) — antes de eso, el sistema se comporta como hoy.
