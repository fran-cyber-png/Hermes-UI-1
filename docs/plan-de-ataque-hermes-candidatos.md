# Plan de ataque — el CRM de campaña

> Complemento operativo de [`plan-hermes-para-candidatos.md`](plan-hermes-para-candidatos.md) (el
> mapa y el planteo). Éste responde una sola pregunta: **en qué orden se ataca, qué empieza esta
> semana y qué no puede empezar todavía.** Escrito el 10-ago-2026.

---

## 0. 🔴 El reloj no es la arquitectura: es el **4 de octubre**

Medido en `goberna_web_dev` el 10-ago-2026:

| | |
|---|---|
| Candidaturas para **ERM2026** (`dia_eleccion = 2026-10-04`) | **67 de 69** |
| Días hasta el voto | **55** |
| Candidaturas con al menos un subservicio activo | **21** (177 selecciones) |
| Candidaturas con dato real de campo | **2** — la **75** (284 respuestas, **las 284 en los últimos 7 días**, la última **ayer**, 24 brigadistas) y la **57** (412 respuestas, 12 brigadistas, casi frenada) |

**Hay una campaña caminando el territorio hoy**, con dos docenas de brigadistas llenando formularios,
y ninguno de esos vecinos termina en una conversación con nadie.

### Lo que este reloj decide, y no es negociable

1. **No se construye un CRM de conversaciones para una campaña que vota en 55 días.** Y el que manda
   no es el código: es **Meta**. Verificar el Business del candidato, dar de alta el WABA, verificar
   el número y **aprobar plantillas** son semanas de trámite que no dependen de nosotros y no se
   pueden apurar con más horas de trabajo.
2. **No se toca el canal de un candidato en las últimas semanas.** Un número bloqueado a 20 días del
   voto no es un incidente: es el fin del contrato y probablemente un juicio.
3. **Pero sí llega algo al 4 de octubre**, y es justamente lo que **no manda un solo mensaje** (§2).
4. ⚠️ **Después del 4 de octubre la demanda se desploma sola.** Las 67 candidaturas dejan de ser
   campañas. O sea: **lo que se construya en noviembre se justifica por el ciclo siguiente, no por
   facturar en diciembre.** Decirlo ahora evita que en noviembre parezca que el proyecto se murió.

---

## 1. La regla que ordena el plan: **tres carriles que no comparten riesgo**

No es un plan secuencial. Son tres frentes que corren en paralelo **porque no comparten ni recurso ni
riesgo**, y cada uno tiene su propio reloj:

| Carril | Dónde | Riesgo para un candidato | Reloj | Depende de una decisión |
|---|---|---|---|---|
| **1 — La línea** | Hermes (plano A) | **Cero.** No lo toca | Vence solo (§2.1) | **Ninguna** |
| **2 — Octubre** | Centurión | **Cero de canal.** No manda nada | 4-oct, duro | **Ninguna** |
| **3 — El satélite** | Nuevo | Alto si se apura | Trámite de Meta | **D1, D5, D6** |

**El error que este plan existe para evitar**: postergar el carril 1 «hasta que se decida D1». El
carril 1 no depende de D1 y es el único que **caduca**.

---

## 2. CARRIL 1 — Dibujar la línea en Hermes · *empieza esta semana*

### 2.1 Por qué ahora y no después

Son **16 imports** en 11 pares (§1.3 del mapa). Es la medición de hoy. La misma medición en seis
meses no va a dar 16 — `dos-planos.md` §2.3 ya lo escribió hace dos semanas y por eso se midió.
**Una tarde de trabajo hoy, un trimestre dentro de un año.** Y todo pasa dentro del plano A, donde el
CI ya existe, los tests ya existen y el deploy ya existe.

### 2.2 Los tres tickets, en orden

| # | Ticket | Qué es | Tamaño |
|---|---|---|---|
| **1.1** | **Test de dependencia motor→adaptador** | Un test que recorre los imports y falla si el motor importa del adaptador. Nace con los **16 cruces como allowlist explícita**, cada uno con su archivo y su fecha de caducidad. Verde desde el día 1: no arregla nada, **congela el problema** | ~1 día |
| **1.2** | **Parametrizar `sugerencias/estado.ts`** | `EstadoDeVenta` (con `curso`, `cotizada`, `precio`) deja de ser el enum de la Escuela y pasa a ser **vocabulario del tenant**. Desbloquea 5 de los 16 cruces de un saque (`procedencia` ×3, `catalogo` ×1, `autorespuesta` ×1) | ~3 días |
| **1.3** | **`kernel-hermes@0.1.0`** | Extraer lo verde de §5 del mapa + sus tests. **Preservando historia git** (regla dura #4), no con un commit | ~1 sprint |

**GATE del carril**: la allowlist llega a **0** *y* la Escuela sigue vendiendo con el kernel importado
(CI verde + N5 aplicado + las vendedoras trabajando). Si la Escuela se rompe, el motor no era un motor.

> ⚠️ **1.1 antes que 1.2, siempre.** Sin el test, la parametrización «arregla» cinco cruces y no hay
> nada que impida que vuelvan la semana siguiente.

---

## 3. CARRIL 2 — Lo que SÍ llega al 4 de octubre · *empieza esta semana*

**La regla del carril: nada de acá manda un solo mensaje.** Ni Cloud API, ni plantillas, ni envío.
Todo es leer, atribuir y devolver.

### 3.1 Los cuatro tickets

| # | Ticket | Qué desbloquea | Tamaño |
|---|---|---|---|
| **2.1** | **Prender `captacion`** — aplicar la migración, dar de alta el subservicio en `fase_3` (lo hace apolo), imprimir QRs para la candidatura **75** | La atribución territorial. **Es un redirect: no toca ninguna API de Meta** | ~1 día + la operación |
| **2.2** | **Que la libreta del brigadista reciba dato** — `territorio.contacto` tiene **0 filas** con 24 brigadistas en la calle | Sin esto no hay a quién vincular. Es el insumo del nudo | a medir primero (§3.2) |
| **2.3** | **El nudo de LECTURA** — la ficha del vecino que junta QR + formulario + visita, con la resolución de identidad de `identidad/` + `telefono/paises.ts` | Es §3.5 del mapa, **la mitad que solo lee**. Ya es producto vendible sin mandar nada | ~1 sprint |
| **2.4** | **La lista de puertas** — devolverle a territorio a quién ir a visitar | El lazo que hoy no existe: el campo alimenta al digital y el digital no devuelve nada | ~3 días |

### 3.2 ⚠️ Antes de 2.2 hay que medir por qué la libreta está vacía

`territorio.contacto` = 0 con 24 brigadistas activos tiene **tres causas que en pantalla se ven
igual**: (a) la app móvil nunca se apuntó al endpoint (guarda local, como dice el comentario del
propio archivo), (b) los brigadistas no usan esa pantalla, (c) el endpoint falla en silencio.
**Es media hora de diagnóstico y decide si 2.2 es un día o un mes.** No se estima antes de mirarlo.

### 3.3 🔴 El gate honesto del carril, con fecha

**Si al 25 de agosto `captacion.escaneo` sigue en 0, el carril 2 se cancela y todo se va a
post-octubre.** No se empuja contra un no. Un QR impreso que nadie escanea no es un problema de
software y no se arregla con más software.

---

## 4. CARRIL 3 — El satélite · *el trámite empieza ya, el código no*

### 4.1 Lo que hay que empezar **esta semana** aunque no se escriba una línea

El camino crítico del carril 3 **no es nuestro**:

1. Elegir **un** candidato piloto (la **75** es la candidata obvia: es la única con operación viva).
2. **Meta Business verificado** a nombre de quien corresponda (→ **D5**).
3. Alta del **WABA** + número del comando (**nunca el celular personal del candidato**).
4. Redactar y mandar a aprobar las **primeras plantillas**. Se aprueban, no se inventan, y tardan.

**Esto es semanas de calendario y cero horas de programación.** Si no empieza ahora, el carril 3 no
arranca en noviembre: arranca en enero.

### 4.2 El código, después del 4 de octubre

Peldaños 2 → 3 → 3b → 4 → 5 del mapa, en ese orden y con sus gates. El de arranque:

> **GATE del peldaño 2** — el de ADR 0042, literal: **contá filas en `events`.** Sin filas, el
> peldaño no está hecho aunque la UI se vea. Nunca por un 200.

### 4.3 Lo que se lleva de octubre: la calibración

Los 55 días no son tiempo perdido para el carril 3. Lo que dejan escrito:
cuántos escaneos por QR, cuántos vecinos con ≥2 fuentes resueltas, y **cuál de los seis compromisos
de §4.2 del mapa se puede observar de verdad**. Eso es exactamente lo que hace falta para que
`resultados/` mida algo en la campaña siguiente en vez de medir cero.

---

## 5. El orden de las decisiones — cuál bloquea qué **de verdad**

| Decisión | Bloquea | Se necesita |
|---|---|---|
| **D5** — ¿de quién es el WABA/Business de Meta? | El trámite entero del carril 3 | 🔴 **esta semana** |
| **D6** — el nombre / `codigo` del subservicio | El alta en `fase_3` (y es el rótulo que el candidato lee) | 🔴 **esta semana**, va con 2.1 |
| **D3** — la ranura se llama «Alcance masivo» y el producto no manda masivo | La **venta**, no el código | Antes de prometérselo al candidato 2 |
| **D1** — instancia por candidatura vs. base por tenant | **Solo el carril 3** | Antes del peldaño 2 (octubre) |
| **D1b** — de quién es el vecino (custodio de la identidad) | El ticket **2.3** | Antes del nudo, o nace con cuatro verdades |
| **D2** — ¿dos candidatos de la misma elección? | La forma de D1 | Con D1 |
| **D4** — de quién es el dato del vecino post-elección | El contrato, no el código | Antes de firmar el primer piloto |

**Ninguna decisión bloquea el carril 1.** Ninguna bloquea 2.1 salvo D6, que es elegir una palabra.

---

## 6. Cómo se sigue — **abierto el 10-ago-2026**

| Carril | Épica | Tickets |
|---|---|---|
| **1 — La línea** | `hermes` **#341** | **#338** test de dependencia · **#339** parametrizar `estado.ts` · **#340** `kernel-hermes@0.1.0` |
| **2 — Octubre** | `centurion` **#119** | **#115** prender `captacion` · **#116** diagnóstico de `territorio.contacto` · **#117** el nudo de lectura · **#118** la lista de puertas |
| **3 — El satélite** | `centurion` **#120** | Sin tickets de código todavía: la épica lleva el **checklist del trámite de Meta**, que es lo que arranca esta semana |

- **Tracker**: GitHub Issues. Carril 1 → `Goberna-Lab/hermes`. Carriles 2 y 3 →
  `Goberna-Lab/centurion` (⚠️ `apolo/centurion` es el checkout canónico; hay 10 clones y **solo ése
  cuenta**).
- **El gate está escrito en cada épica**, no en la cabeza de nadie.
- Flujo de siempre: rama + PR + CI verde + rebase. ⚠️ El runner de VPS1 **es uno y serializa**:
  encolado ≠ colgado, y N5 puede esperar 15+ minutos.
- ⚠️ Antes del primer PR del carril 2, mirar el drift: `ssh deploy@161.132.39.165 'cd /srv/hermes &&
  git status --porcelain -uno'`. Un checkout sucio pone roja la corrida entera y el PR se ve verde.

---

## 7. Las tres formas de que este plan fracase

1. **Empujar el carril 3 contra octubre.** Es la tentación obvia —hay 21 candidaturas activas y una
   ranura ya cobrada— y termina con un candidato sin WhatsApp en la última semana. **El carril 3 no
   tiene una versión apurada: tiene una versión y una catástrofe.**
2. **Que el carril 2 no tenga campaña real detrás.** Es el error de ADR 0036: se midió que prender el
   Dashboard personal sin repartir la cola antes dejaba a cuatro vendedoras con una fila. **Acá el
   equivalente es imprimir QRs que nadie pega.** Es operación, no código, y sin la candidatura 75
   caminando no hay carril 2.
3. **Postergar el carril 1 «hasta que se decida D1».** No depende de D1, no toca a ningún candidato, y
   es **lo único de los tres que caduca solo**.

---

## 8. Qué necesito de vos esta semana

1. **D5** — ¿el WABA a nombre de Goberna o del candidato? (arranca el trámite de Meta)
2. **D6** — la palabra que el candidato va a leer en su launcher
3. **El sí operativo de la candidatura 75** — que acepten pegar QRs y que los brigadistas los usen
4. Luz verde para abrir las tres épicas y los siete tickets

Con eso, los carriles 1 y 2 empiezan el lunes y el trámite del 3 arranca en paralelo.
