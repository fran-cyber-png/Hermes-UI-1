# ADR 0048 — El link deja de tratar a todos como desconocidos

- **Fecha**: 2026-08-10
- **Estado**: aceptada
- **Decide**: Estephano (*«el compartir link tiene que ser más avanzado… aún siento que está muy
  verde»*). Las tres decisiones, en §2.
- **Amplía**: **ADR 0047** (el link público). No lo revierte: lo que existía sigue siendo el modo
  `publico`.
- **Mapa**: `docs/mapa-compartir-una-pagina.md`

## 1 · El diagnóstico

> **Había dos destinatarios posibles y el link trataba a los dos igual: como desconocidos.**

Para un **lead** —afuera, llega por WhatsApp— el link de ADR 0047 es exactamente lo correcto. Para una
**compañera** —adentro, con sesión— era la respuesta equivocada: la veía sin poder editar, y Hermes no
sabía que había sido ella.

No faltaba una función: faltaba **un eje**.

## 2 · Las tres decisiones del dueño

1. **Sin sesión solo se lee.** Editar exige estar logueado en Hermes **y** tener permiso.
2. **Cortar es automático** al sacar a alguien del espacio.
3. **Vencimiento opcional.**

## 3 · Los dos ejes, y la invariante que los ata

```
ALCANCE   quién lo puede abrir     publico · goberna
PERMISO   qué puede hacer          ver · editar
```

🔴 **`editar` exige `goberna`, y eso lo garantiza el TIPO, no una validación.**
`ConfiguracionDeLink` es una unión de dos ramas que **hace imposible construir**
`{ alcance: 'publico', permiso: 'editar' }`. El motivo por el que no puede ser un `if` que alguien
mueva: **sin identidad no hay autoría.** Una página del equipo que un anónimo puede reescribir no
tiene a quién atribuirle el cambio, no se puede auditar, y si el link se reenvía a un grupo, todo el
grupo la edita.

⚠️ Y un `permiso: 'editar'` sobre alcance público **se rechaza con 400, no se degrada a `ver`**:
degradar le daría a la vendedora un link que hace menos de lo que la pantalla le dijo.

## 4 · 🔴 El link interno NO sirve contenido por la ruta anónima

Éste es el hallazgo que cambió el diseño para mejor.

**Una navegación del navegador no lleva el token de Hermes**: la sesión vive en `localStorage`, no en
una cookie (`lib/datos/token.ts`). O sea que en `/n/<token>` el server **no sabe quién está del otro
lado** — y servir la página «porque el link dice que es interno» sería confiar en el link en vez de en
la identidad.

Así que no lo hace:

```
GET /n/<token>  ·  alcance goberna
   → una página PUENTE sin una letra del contenido, ni el título, ni el espacio
   → «Esta página es del equipo. Entrá a Hermes para verla.» → /#n=<token>

La app, que sí tiene el Bearer → GET /api/notas/por-link/<token>  (detrás del perímetro)
```

**La garantía que sale de ahí: el contenido de un link interno nunca sale por la ruta anónima.**

⚠️ Leer el hash **no convierte a Hermes en una app con router** (ADR 0002). Se lee **una vez, en el
primer render**, y se limpia enseguida — porque el token es una credencial de lectura y dejarlo en la
barra hace que se copie con la URL, quede en el historial y viaje en cualquier captura de pantalla.

## 5 · Cortar automático: el agujero que contradecía una garantía

ADR 0046 promete que **sacar a alguien de un espacio le saca las páginas**. Le sacaba las de adentro
**y le dejaba abierta la puerta que había dejado al mundo**: el link seguía sirviendo la página del
equipo, no aparecía en ninguna alerta, y solo lo cortaba un miembro actual que se acordara de ir a
mirar esa página.

- **Sacar a un miembro** borra los links **que esa persona abrió sobre páginas de ESE espacio** — en
  la **misma transacción** que la baja: si se hiciera después y fallara, quedaría afuera con su link
  vivo, que es el estado exacto que esto viene a impedir.
- ⚠️ **El corte es quirúrgico**: no toca los links de los demás (echar a una persona rompería lo que
  repartieron las otras cuatro) ni los de **su libreta privada** (sus páginas propias no son del
  espacio).
- **Archivar el espacio** corta todos sus links, por lo mismo. **Es el único caso en que archivar
  destruye algo — y destruye la puerta, no el contenido**: las páginas quedan intactas.
- Las dos funciones **devuelven cuántos cortaron**, para que la pantalla pueda decirlo en vez de
  hacerlo en silencio.

## 6 · Lo demás

- **Vencimiento opcional.** `null` = no vence, y es el default: el link de un lead no puede morirse
  justo cuando vuelve a preguntar el precio (ADR 0047 §6). ⚠️ Una fecha que no se entiende **se
  rechaza**, no se ignora: ignorarla crearía un link eterno cuando se pidió uno que vence. Y **vencido
  se ve igual que inexistente** — decir «esto venció» le confirma a un desconocido que el token
  existió.
- **«Se abrió por última vez el…»** Un solo timestamp, **sin quién ni cuántas veces**: contar visitas
  sería analítica sobre gente que no dio su consentimiento, y para decidir «¿esto se usó?» y «¿lo
  corto?» alcanza con la última. `null` = **nunca lo abrió nadie**, que es la respuesta más útil de
  todas. Se anota **sin esperar**: si falla, se pierde un dato de higiene, no la página.
- **Reconfigurar conserva el token.** Cambiar de público a interno surte efecto sobre **el link que ya
  se repartió**. Crear uno nuevo dejaría el viejo vivo con las reglas viejas — justo lo que alguien
  intenta arreglar cuando toca esto.

## 7 · Lo que sigue afuera

**Rate limit en `/n/`.** Verificado: **ni nginx (`limit_req` no existe en `/etc/nginx/`) ni Express**
tienen. Con 128 bits **no es riesgo de fuga, es de disponibilidad**, y la guarda de forma ya evita que
llegue a Postgres. Es un cambio a mano en producción (regla dura #6), así que va aparte y avisado.

También quedan afuera, con su porqué en el mapa: contraseña en el link, contar visitas, permisos por
página y persona, y compartir un espacio entero.

## 8 · Cómo se sabe si estuvo bien

```sql
SELECT alcance, permiso, count(*) AS links,
       count(*) FILTER (WHERE ultimo_acceso_at IS NOT NULL) AS usados,
       count(*) FILTER (WHERE vence_at IS NOT NULL)         AS con_vencimiento
FROM nota_link GROUP BY 1, 2;
```

La pregunta sigue siendo la de ADR 0047: **¿se usó más de una vez?** Ahora se puede contestar.
