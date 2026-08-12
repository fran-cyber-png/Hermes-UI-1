# Qué chats no puede ver Luz, y si el Pipeline la está ayudando

**Medido el 11-ago-2026 contra producción** (`/srv/hermes` en `3a077d3`, base `meta_escuela` en el
contenedor `hermes_db` de VPS1). Todo read-only.

⚠️ **Los números del embudo NO están reimplementados en SQL**: salen de correr el seam real
(`consultarCola`) contra la base viva con `tsx --env-file=.env`, que es la única forma de medir *lo que
la pantalla muestra* y no *lo que yo creo que muestra* (#37). El SQL crudo se usó solo para los
volúmenes y para el origen de las filas.

---

## Respuesta corta

**Luz no tiene ningún chat oculto. Tiene el problema opuesto: ve 4.143 conversaciones y solo 1.083 son
suyas.** De esas 1.083, ninguna se la dio el reparto — se las colgó una difusión el 5-ago.

Y el Pipeline no le está ayudando, pero no porque esté mal hecho: **de las 4.143 tarjetas que le
muestra, 25 se pueden trabajar hoy.** El resto es inventario.

Aparte, midiendo esto aparecieron **dos defectos reales**, uno de ellos serio.

---

## 1. Qué ve Luz — medido

| Modo | Lo que devuelve la cola | ¿Correcto? |
|---|---|---|
| Sin filtros (lo que abre) | **4.143** | sí (es supervisora y no está en la rueda) |
| Chip **«Míos»** (sus asignadas) | **1.229** | sí |
| Chip **«Mías»** (sus líneas) | **4.143** ⚠️ | **NO — no filtra nada** |

Por qué ve todo, y está bien que así sea:

- **Es supervisora.** `HERMES_SUPERVISORES` la incluye (`ventas10@…, alan, Usuario1, luz`), así que el
  Dashboard y el padrón le salen enteros. Esa parte funciona.
- **No está en la rueda del reparto.** `reparto_rueda` tiene `ventas10@`…`ventas14@` y `Tracy`; Luz
  quedó afuera a propósito. Por eso `enElReparto = false` y no se le aplica el recorte automático. Es
  el fail-open documentado, y es correcto.

### El universo, por línea (ventana de 30 días)

| Línea | Etiqueta | Propósito | Conversaciones | Salientes |
|---|---|---|---|---|
| `51986394450` | Ventas Perú | vendedora | **2.564** | 6.623 |
| `51984429504` | Ventas Meta | vendedora | 1.100 | 1.769 |
| `51941654039` | Walter Ventas | vendedora | 311 | 1.388 |
| `51963139984` | **Betto** | **campana** | 20 | 69 |
| `51944531711` | Venta Peru (Sindy) | vendedora | **0** | 0 |

Dos cosas que saltan solas:

- 🔴 **`51986394450` es el 62 % del universo y no tiene ninguna vendedora en `numero_vendedora`.** Es la
  línea con más tráfico de Hermes y está huérfana en el mapa.
- **La línea de Sindy no tiene un solo mensaje en 30 días.**

---

## 2. Los dos defectos que aparecieron

### 🔴 Defecto A — El operador de la campaña política puede estar viendo toda la Escuela

Este es el serio, y no es sobre Luz.

`cola/lineas.ts` tiene un recorte que se llama **exclusivo**: quien atiende una línea con
`proposito = 'campana'` ve **solo** sus líneas. Su propio comentario dice por qué: *«un operador del
comando de un candidato no tiene nada que hacer en la cola de la Escuela, y al revés tampoco»*. Eso es
el aislamiento entre los dos planos de Goberna.

El recorte se resuelve con `lineasDeVendedoraConProposito` (`server/src/numeros/repositorio.ts:88`), y
esa función compara así:

```ts
.where(eq(schema.numeroVendedora.vendedoraId, vendedoraId));  // ← comparación EXACTA
```

**Es la única función del frente que compara `vendedora_id` sin normalizar.** `esMiaSql`,
`estaEnAlgunaRueda`, `mismaVendedora`, `mismoUsuario` y el índice de `espacio_miembro` ya usan
`lower(btrim(...))` de los dos lados, justo por esto.

Y en producción el mismo humano tiene dos grafías vivas:

- `numero_vendedora` dice **`usuario2`** (lo empuja Cerberus).
- `sesiones_cerberus` tiene **`usuario2` y `Usuario2`**.
- `envios_wa` registra **19 envíos bajo `Usuario2`** por la línea de Betto — o sea que **ese token está
  en uso**.

Corriendo el seam real contra prod:

```
token=usuario2   total=   20     ← el recorte de campaña funciona
token=Usuario2   total= 4143     ← ve TODA la cola de la Escuela
```

**El aislamiento entre la Escuela y el comando de campaña depende hoy de una mayúscula.**

No puedo afirmar desde acá con qué grafía inicia sesión esa persona cada vez —`sesiones_cerberus`
guarda las dos—, así que lo que está medido es esto: *el token que aparece mandando mensajes por la
línea de campaña es el que rompe el recorte*. Eso alcanza para tratarlo como abierto.

### ⚠️ Defecto B — El chip «Mías» de Luz no filtra

El mismo `eq()` de arriba, del lado de Luz:

```sql
select count(*) from numero_vendedora where vendedora_id = 'luz'                → 0
select count(*) from numero_vendedora where lower(btrim(vendedora_id)) = 'luz'  → 1
```

`numero_vendedora` dice **`Luz`**; ella entra como **`luz`** (`sesiones_cerberus`, y sus 1.083
asignaciones están en minúscula). Con el match exacto, el mapa le devuelve `[]` → `sinLineasPropias`
→ **fail-open: se sirve todo**.

Confirmado con el seam: `misLineas: true` devuelve **4.143** con `sinLineasPropias: true`, en vez de las
1.100 de su línea.

Este degrada hacia *ver de más*, y la respuesta lo dice en voz alta — el diseño fail-open funcionó
exactamente como está escrito. Pero el chip está muerto: Luz no tiene forma de acotarse a su línea.

### Y el aislamiento falta en el otro sentido

Aun con la grafía arreglada, **las 20 conversaciones de la campaña de Betto siguen entrando a la cola de
la Escuela** — aparecieron hoy, 11-ago. `soloSusLineas` recorta a *quien tiene* la línea de campaña,
pero no saca esa línea del universo de los demás. El comentario promete el «y al revés tampoco»; el
código solo hace la mitad.

---

## 3. El Pipeline de Luz — los números

### El embudo que ve

| Etapa | Todo lo que ve | Sus asignadas | «Para seguir» | Ventana abierta |
|---|---|---|---|---|
| Te esperan (`interesado`) | 528 | 146 | 0 | 5 |
| Nunca contestaron (`sin_respuesta`) | **2.575** | **971** | 1.088 | 0 |
| Contestaron (`contactado`) | 236 | **0** | 133 | 19 |
| Saben el precio (`cotizado`) | 791 | 112 | 101 | 1 |
| Compraron (`cierre`) | 13 | **0** | 0 | 0 |
| Dijeron que no (`perdido`) | 0 | 0 | 0 | 0 |
| **Total** | **4.143** | **1.229** | | **25** |

### 🔴 De 4.143 tarjetas, 25 se pueden trabajar hoy

`puedoEscribirle = 25`. Es el **0,6 %**. En sus propias asignadas: **1 de 1.229**.

El resto tiene la ventana de conversación cerrada. En las tres líneas whatsmeow eso no es un rechazo de
Meta, es el riesgo de ban (regla dura #7) — o sea que abrirlas en frío no es «hacer un esfuerzo», es la
vía corta al bloqueo de la línea.

### 🔴 Las 1.083 conversaciones de Luz no se las dio el reparto: se las colgó una difusión

```
asignada_por | motivo |    dia     | count
campana      | manual | 2026-08-05 |  1083
```

Las 1.083 se escribieron **el 5-ago, todas de una, por `campana`**. Ese mismo día salieron **1.093
envíos automáticos** de campaña por la línea `51984429504`.

Y el resultado:

- **969 de 1.083 (89,5 %) nunca contestaron.**
- **941 de sus tarjetas son de gente que ya compró** (`yaCompraron`) — fue una campaña de reenganche a
  la base de clientes, no leads nuevos.
- **0 en «Contestaron». 0 en «Compraron».**

O sea: el tablero personal de Luz es, en un 89 %, el eco de una difusión que ella no mandó.

### El Pipeline no se usa como Pipeline

| Registro manual | Total en TODA la base | De Luz |
|---|---|---|
| `gestiones` (declarar etapa / arrastrar) | **39** | **1** (3-ago) |
| `eventos_contacto` | **2** | **0** |
| `intereses` | 29 | — |
| `estado_conversacion.fijada` | **0** | 0 |

Luz declaró una etapa **una vez en toda la historia**. Nadie fijó nunca una conversación.

Esto por sí solo no condena nada — ADR 0044 hizo el embudo **derivado** justamente para no depender de
esos clics. Pero sí dice que el Pipeline no está funcionando como mesa de trabajo: es una pantalla que
se mira, no una en la que se opera.

### Y la mitad del negocio no pasa por Hermes

| Línea | Salientes en `interactions` | Envíos en `envios_wa` |
|---|---|---|
| `51986394450` (Ventas Perú) | **6.623** | **4** |
| `51984429504` (Ventas Meta) | 1.769 | 1.766 |

**Los 6.623 mensajes de la línea más grande no salieron por Hermes.** whatsmeow los captura del
dispositivo, así que se ven en el hilo — pero quien atiende esa línea escribe desde el WhatsApp del
teléfono. Hermes ahí es un espejo, no una herramienta.

Luz, en 30 días, mandó **72 mensajes** por Hermes: 33 el 5-ago, 30 el 6-ago, 1 el 10 y 8 el 11.

---

## 4. Conclusión

**¿El Pipeline está ayudando? Hoy no puede.** No por cómo está construido —el embudo derivado de ADR
0044 es correcto y los números cierran— sino porque **lo que le muestra a Luz no es su trabajo**:

1. El 62 % del universo viene de una línea que no se opera desde Hermes.
2. El 89 % de lo suyo es el residuo de una difusión del 5-ago a ex-clientes.
3. De 4.143 tarjetas, 25 son accionables — y el tablero las presenta con el mismo peso que las 2.575
   que nunca contestaron.

El Pipeline está midiendo bien una realidad en la que casi nada es accionable. **El problema no es el
tablero: es que la pregunta «¿a quién le hablo ahora?» tiene 25 respuestas y hay que buscarlas entre
4.143 tarjetas.**

---

## 5. Qué haría

En orden de lo que más duele por lo que menos cuesta.

### 1. Normalizar la grafía en `lineasDeVendedoraConProposito` — una línea, y cierra el defecto A

```ts
.where(sql`lower(btrim(${schema.numeroVendedora.vendedoraId})) = ${vendedoraId.trim().toLowerCase()}`);
```

Es exactamente el candado que ya tienen `esMiaSql` y `estaEnAlgunaRueda`. Arregla las dos cosas de una:
el aislamiento del comando de campaña deja de depender de una mayúscula, y el chip «Mías» de Luz vuelve
a filtrar.

⚠️ **Tiene un efecto colateral que hay que decir en voz alta**: hoy Luz ve 4.143 por el fail-open. Con
esto arreglado, el día que toque «Mías» va a ver 1.100. Es lo correcto, pero es un cambio visible.

Y hay que dejarlo fijado con un test, porque este agujero ya se cerró en cinco lugares y se reabrió en
el sexto.

### 2. Sacar las líneas de campaña del universo de la Escuela

El complemento del punto 1: que `proposito = 'campana'` no entre a la cola de quien no tiene ninguna
línea de campaña. Hoy son 20 conversaciones; el día que la campaña arranque en serio son las que le
tapan la mesa a las vendedoras — y son de otro negocio, con otros clientes, que la memoria de Goberna
dice que **no deben cruzarse**.

### 3. Decidir qué son las 1.083 asignaciones de `campana`

No son reparto: son el rastro de una difusión, escritas con `motivo = 'manual'` y `asignada_por =
'campana'`. Mientras estén ahí, «Míos» de Luz seguirá siendo una lista de 971 personas que nunca
contestaron.

Es una decisión del dueño, no mía. Las opciones que veo: darlas de baja y dejar «Míos» para lo que el
reparto asigne de verdad, o dejarlas y aceptar que ese chip mide campañas y no cartera.

### 4. Poner `51986394450` en el mapa y decidir si se opera desde Hermes

La línea del 62 % del tráfico no tiene dueña en `numero_vendedora`, y sus 6.623 salientes salieron por
fuera. Cualquier medición del Pipeline que la incluya está midiendo trabajo que Hermes no ve.

### 5. Que el Pipeline abra por lo accionable

Esto es lo único que es cambio de producto y no de datos, y por eso va último: cuando 25 de 4.143
tarjetas son trabajables, el default correcto no es el inventario completo. El recorte «Para seguir» y
el chip «Puedo escribirle» ya existen y ya llevan su número — hoy hay que acordarse de encenderlos.

⚠️ Con los datos de hoy, **«Puedo escribirle» en «Te esperan» da 5 y en «Compraron» da 0**, así que la
regla del cero (ADR 0044) escondería el chip en la mitad de las columnas. Antes de tocar el default hay
que mirar la captura, no el test: es el mismo error que ya encontró la evidencia y no el CI.

---

## Cómo reproducir

```bash
# Volúmenes y origen de las filas
ssh deploy@161.132.39.165 "docker exec -i hermes_db psql -U meta_escuela -d meta_escuela" < consulta.sql

# El embudo REAL (el seam, no una reimplementación)
scp embudo.mts deploy@161.132.39.165:/tmp/
ssh deploy@161.132.39.165 "cd /srv/hermes/server && ./node_modules/.bin/tsx --env-file=.env /tmp/embudo.mts"
```

El script importa `consultarCola` y `db` por ruta absoluta desde `/srv/hermes/server/src/...`, vive en
`/tmp` (**nunca en el checkout**: un archivo suelto en `/srv/hermes` bloquea N4 por la regla dura #6) y
necesita extensión `.mts` para que tsx no lo trate como CJS.
