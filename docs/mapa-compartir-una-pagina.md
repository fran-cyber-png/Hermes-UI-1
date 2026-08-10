# Compartir una página — el flujo completo, y por qué lo de hoy se siente verde

> **10-ago-2026.** Disparador: *«el compartir link tiene que ser más avanzado… aún siento que está
> muy verde»*. Tiene razón, y abajo está el porqué medido, no intuido.
>
> Lo de hoy (ADR 0047) está **vivo en producción** y no está roto: es **la mitad de abajo** de un
> modelo que tiene tres pisos. Este mapa dibuja los tres.

---

## 1 · El diagnóstico, en una frase

> **Hay DOS destinatarios posibles y el link trata a los dos igual: como desconocidos.**

| Quién | Qué necesita | Qué le damos hoy |
|---|---|---|
| **Un lead** (afuera, llega por WhatsApp) | Abrir un precio sin instalar ni entrar a nada | ✅ exactamente esto |
| **Una compañera** (adentro, con sesión) | Ver —o editar— una página sin entrar al espacio entero | ❌ la tratamos como a un desconocido: la ve sin poder editar, y Hermes no sabe que fue ella |

Eso es lo que se siente verde. No es que falte una función: es que **falta un eje**. Hoy el link tiene
un solo modo (público-anónimo) cuando necesita dos, y el modelo de acceso tiene dos niveles (privado ·
espacio) cuando necesita tres.

---

## 2 · Los seis agujeros, verificados

### 🔴 A · El link sobrevive a que te saquen del espacio

`nota_link` guarda `creado_por` y **nadie lo mira después**. Sacás a alguien del espacio —lo que ADR
0046 promete que le saca las páginas— y **el link que esa persona abrió sigue sirviendo la página del
equipo al mundo entero**. No aparece en ninguna alerta y solo lo corta un miembro actual que se
acuerde de ir a mirar esa página.

Es el agujero más serio, porque **contradice una garantía que ya dimos**.

### 🔴 B · No hay inventario: nadie puede contestar «¿qué tenemos publicado?»

El 🔗 aparece en la lista, pero **solo del lugar donde estás parada**. No hay una pantalla que diga
«estas 4 páginas están afuera». Un supervisor no puede auditarlo, y quien comparte no tiene dónde
revisar lo que dejó abierto hace tres semanas.

### 🔴 C · Ruta anónima sin rate limit — verificado en nginx Y en el server

`/n/<token>` es la única ruta de Hermes sin credencial, y **ni nginx (`limit_req` no existe en
`/etc/nginx/`) ni Express tienen límite**. El token de 128 bits no se adivina por fuerza bruta, así
que **no es un riesgo de fuga** — es de **disponibilidad**: martillar `/n/` cuesta un proceso Node por
request. La guarda de forma (regex antes de tocar la base) evita que llegue a Postgres, que es lo más
caro, pero no evita el resto.

### ⚠️ D · No se sabe si el link se usó nunca

Ni una vez, ni cien. Sin eso no se puede contestar la única pregunta que decide si esto sirve —**«¿se
usó más de una vez?»**— ni «este link de hace un mes, ¿lo corto?».

### ⚠️ E · No hay vencimiento, ni contraseña, ni «solo Goberna»

Se decidió a propósito no poner vencimiento (§6 de ADR 0047: el link se moriría justo cuando el lead
vuelve a preguntar). Sigue valiendo **para el link de un lead**. No vale para el de una compañera.

### ⚠️ F · El link es de la PÁGINA, no del espacio

No se puede compartir «los precios» como conjunto. Con 6 páginas en la base no duele; con 40 sí.

---

## 3 · El modelo que propongo: TRES pisos, no dos

```
🔒  PRIVADA          solo yo                        (espacio_id IS NULL)
👥  EL ESPACIO       los miembros                   (espacio_id = E)      ← ver o editar
🔗  CON LINK         afuera del espacio                                    ← y acá el eje que falta:
        ├── 🏢  solo gente de Goberna con sesión     → ve (y opcionalmente edita)
        └── 🌍  cualquiera con el link               → ve, y nada más
```

**Lo que esto agrega y hoy no existe** es el renglón `🏢`: un link que **exige sesión de Hermes**.
Resuelve el caso que hoy no tiene camino —«que Sindy vea esta página sin meterla al espacio»— y de
paso resuelve el pedido anterior (*«modo visualización o edición»*) sin inventar un modelo de permisos
por fila.

⚠️ **Los dos modos son la MISMA tabla y el mismo token**, con una columna `alcance`. No son dos
features: es un `if` en la ruta pública que, cuando el alcance es `goberna`, pide el Bearer y cae al
login si no está.

---

## 4 · El flujo, paso a paso

### Cuando comparto

```
[ Compartir ]
   │
   ├─ ¿Quién lo abre?     ( ) Cualquiera con el link      ← default para un lead
   │                      ( ) Solo gente de Goberna       ← default si el destino es interno
   │
   ├─ ¿Qué puede hacer?   (•) Solo ver
   │                      ( ) Ver y editar    ← SOLO disponible con «solo Goberna»
   │                                             (editar sin identidad no se ofrece nunca)
   │
   └─ [ Crear el link ]  →  se copia solo, y la pantalla dice qué acaba de pasar
```

🔴 **«Ver y editar» no se ofrece con alcance público, y no es una opción de configuración**: sin
identidad no hay autoría, y una página del equipo editable por un anónimo no tiene forma de auditarse.
El tipo lo impide, no un `disabled`.

### Cuando alguien abre el link

```
GET /n/<token>
   │
   ├─ ¿tiene forma de token?        no → 404  (sin tocar la base)
   ├─ ¿existe? ¿página viva?        no → 404  (mismo HTML: no se dice cuál de las tres)
   ├─ ¿el link sigue siendo válido? no → 404  ← § A: su creador ya no es miembro
   │
   ├─ alcance 🌍 público   → HTML mínimo, sin JS, noindex
   └─ alcance 🏢 Goberna   → ¿hay sesión?
                              sí → la app real, con permiso de ver o editar
                              no → el login, y vuelve acá después
```

### Cuando algo cambia

| Pasa esto | Y el link… |
|---|---|
| Editan la página | muestra lo nuevo (es un espejo, no una foto) |
| **Archivan la página** | **deja de servir** ✅ ya implementado |
| Mueven la página a otro espacio | sigue vivo — pero la pantalla **avisa**, porque lo público no es obvio |
| **Sacan del espacio a quien lo creó** | **tiene que morir** ← § A, hoy NO pasa |
| Archivan el espacio | tiene que morir, por lo mismo |

---

## 5 · Lo que hay que decidir (y no decido yo)

1. **¿El link «solo Goberna» permite EDITAR, o solo ver?** Editar por link es cómodo y hace que el
   espacio deje de ser el único lugar donde se colabora — o sea, dos caminos para lo mismo.
2. **¿Cortar los links es automático al sacar a alguien, o se avisa y decide una persona?**
   Automático es coherente con lo prometido; avisar respeta que un link puede estar en manos de un
   lead que no tiene la culpa.
3. **¿Vencimiento opcional?** Mi recomendación: **sí, pero apagado por default** y solo ofrecido en
   los links `🏢` — el de un lead no debería morirse solo (ADR 0047 §6).

---

## 6 · El orden que propongo

| | Qué | Por qué acá |
|---|---|---|
| **1** | 🔴 **Matar el link cuando su creador deja el espacio** + **inventario de lo publicado** | Cierra una garantía que ya dimos y que hoy no se cumple. Nada nuevo que aprender para la vendedora |
| **2** | 🔗 **El alcance `solo Goberna`** (+ ver/editar si se decide) | Es el eje que falta y el que resuelve el pedido anterior |
| **3** | **«Se abrió por última vez el…»** | Un solo `timestamp`, sin trackear personas: contesta «¿esto se usó?» y «¿lo corto?» |
| **4** | **Rate limit en `/n/`** | Disponibilidad, no fuga. Barato (nginx `limit_req`), y conviene hacerlo antes de repartir muchos links |
| **5** | Vencimiento opcional · compartir un espacio entero | Cuando 1–4 estén en uso |

**El 1 y el 2 son «que deje de estar verde».** El resto es maduración.

---

## 7 · Lo que NO propongo, y por qué

| | |
|---|---|
| **Contraseña en el link** | Se manda por el mismo WhatsApp que el link. Es fricción sin seguridad. |
| **Contar visitas / quién abrió** | Analítica sobre gente que no dio consentimiento. «Última vez» alcanza para decidir. |
| **Permisos por página y por persona** | Sería la primera vez que Hermes tiene permisos a nivel de fila. El alcance `🏢` cubre el caso sin ese modelo — y si igual hace falta, se decide con casos reales, no antes. |
| **Marca fuerte de Goberna en la página** | Una página que parece un documento oficial invita a reenviarla como si lo fuera (ADR 0047). |
| **Que el link muestre el `doc` rico** | Renderizar BlockNote en el server mete su runtime dentro de la ruta anónima. El texto plano conserva los renglones, que es lo que un precio necesita. |
