# ADR 0017 — El puente entre la clave del CRM y la persona canónica, y el enlace manual

**Fecha**: 2026-07-25 · **Estado**: aceptada · **Issue**: #58 · **Rama**: `feat/enlazar-personas`

## El problema

El dueño lo dijo así:

> «Hay veces que son la misma persona pero nos habla de otro número — que la vendedora tenga
> la posibilidad de enlazar ese número a otro para que sepa que es la misma persona.»

Hermes tenía la maquinaria y no la usaba. El schema `ontologia` existe **en producción con
todas sus tablas y cero filas**: `personas`, `identidades`, `vinculos_identidad` —que ya
contemplaba `regla:'manual'`, `actor:'operador:{id}'` y `revocado_*` con su índice parcial—,
`identidades_bloqueadas`. La arista reversible estaba diseñada exactamente para esto y no la
había tocado nadie.

Lo que faltaba era **el puente**. El CRM cuelga todo de la clave por conversación
(`conv:<canal>:<persona>:<numeroPropio>`: intereses, gestiones, etiquetas, notas,
recordatorios). El grafo cuelga todo de `ontologia.personas.id`, y hoy se puebla solo desde
compradores de Cerberus y leads de formulario. Entre los dos no había nada — y sin ese algo,
«esta persona es la misma que aquella» no tiene dónde escribirse: **no hay a qué enlazar**.

## La decisión

### 1. El puente es una IDENTIDAD DE CANAL, con su tipo propio

`identidadDeClave(clave)` (`server/src/identidad/clave.ts`, puro) traduce:

| clave del CRM | identidad del grafo |
|---|---|
| `conv:whatsapp:51987654321:51986394450` | `wa_id:51987654321` |
| `conv:instagram:17841400000000:…` | `ig_user:17841400000000` |
| `conv:facebook:7654321098:…` | `psid:7654321098` |
| `int:8123` (comentario suelto) | *ninguna* — no es enlazable |

Dos cosas de esa tabla son la decisión, no un detalle de implementación:

**(a) El número propio de Goberna se cae del identificador.** La misma persona que le escribe
al 986… y al 987… son dos claves y **un solo humano**. Esa unión sale gratis, sin que nadie
enlace nada a mano, y la ficha unificada la muestra junta. Las claves concretas se
reconstruyen después desde `interactions`, con la MISMA expresión SQL que usan la cola, el
radar y el dashboard — escribirla distinto sería la divergencia silenciosa de #37 otra vez.

**(b) El tipo NUNCA es `email` ni `telefono`.** Un número de WhatsApp no se guarda como
`telefono` aunque lo sea: `telefono` es FUERTE (fusiona personas por sí solo) y el número con
el que alguien chatea es, en Perú, el celular de la cabina, del hermano o de la secretaria del
colegio. Las identidades de canal entran como **DÉBILes**, que es la regla que el propio
`db/ontologia.ts` ya documentaba. Lo que fusiona acá es la afirmación de una persona, y esa
queda firmada en el vínculo.

### 2. La persona se crea PEREZOSAMENTE, al enlazar

No se pobló nada por adelantado. Leer una ficha **jamás escribe en el grafo**: una clave que
nunca se enlazó devuelve `personaId: null` y se muestra sola, que es la verdad.

Por qué así y no poblando antes: poblar significaría fabricar decenas de miles de personas
—una por conversación— para que unas pocas decenas se enlacen alguna vez. Sale caro, hay que
mantenerlo sincronizado con cada mensaje nuevo, y no compra nada: el puente es una función
determinista, así que la persona se puede materializar el día que hace falta y el resultado es
el mismo.

### 3. Enlazar es una ESTRELLA, no un par

Enlazar A con B = las dos identidades apuntan a la misma `ontologia.personas`. Elegirlo así
resuelve de una tres cosas que si no habría que programar y probar una por una:

- **Simetría**: no existe «A enlazada a B»; existen «A→P» y «B→P». Desde B se ve A porque
  comparten P, no porque se haya escrito una segunda arista.
- **Idempotencia**: enlazar dos veces es un no-op — ya están las dos en P.
- **Ciclos**: no pueden existir. Un ciclo necesita aristas entre nodos del mismo tipo; acá van
  siempre identidad→persona. La forma del grafo lo prohíbe.

Lo único que hay que decidir a mano es el destino de una fusión de dos grupos, y la regla es la
que el poblador ya usaba para su `clave_raiz`: **gana el ancla más chica en orden
lexicográfico**. Si dependiera de en qué ficha estaba parada la vendedora, dos caminos hasta el
mismo grupo dejarían dos personas distintas en la base.

Hay techo: **10 identidades por persona**. No es estética. Es el mismo desastre que
`identidades_bloqueadas` ya anticipaba (un `informes@` colapsando 300 personas en una)
entrando por otra puerta: clics repetidos sobre la ficha equivocada.

### 4. Deshacer revoca, no borra

`revocado_at` / `revocado_por` / `revocado_motivo`. El índice parcial
`vinculos_identidad_activo_uq` hace que la arista revocada deje de contar **sin dejar de
existir**: «quién enlazó mal a quién y cuándo se deshizo» sigue siendo contestable meses
después. Segment lo dice en su FAQ («remain for the lifetime of the user profile») y Hightouch
también («there is no undo or unmerge button»); esta tabla puede, y este es el primer lugar de
Hermes que lo aprovecha.

### 5. Solo la ficha. Los hilos no.

La clave `conv:*` **no se toca**, la cola no cambia, los chats no se mezclan. Se unifica la
ficha —quién es esta persona— y nada más. Es la decisión del dueño y la UI la dice en voz
alta en la pantalla de confirmación, no solo en este documento.

## Por qué el rebuild del poblador ya no puede pisar un enlace manual

`ontologia/poblarIdentidad.ts` tenía escrito, textual: *«el día que haya des-fusiones manuales,
esto pasa a incremental; hoy está vacío, así que rehacerlo entero es limpio»*. Ese día es hoy.
Su `DELETE FROM ontologia.vinculos_identidad` habría borrado el trabajo de las vendedoras **sin
un error y sin un log**, en la próxima corrida de un script de mantenimiento que nadie asocia
con la ficha del contacto.

Hay **dos** defensas, y la segunda es la que importa:

**Defensa 1 — el SQL.** Se rehace lo que ese poblador fabricó y nada más:

- las aristas se borran con `WHERE regla <> 'manual'` (las manuales sobreviven, revocadas o no);
- las identidades se borran **por orfandad** (`NOT EXISTS` un vínculo que las referencie), no
  por lista: la que sostiene un enlace conserva su fila y su id;
- las personas sin ancla, solo si además no cuelga nadie de ellas;
- al escribir los vínculos derivados, `ON CONFLICT DO NOTHING` sobre el índice activo: si una
  identidad ya tiene un vínculo que una persona afirmó, **el derivado cede** — quien lo afirmó
  tiene nombre, la regla no. Y se cuenta (`derivadosCedidos`): ceder en silencio es cómo se
  fabrica un dato que miente sin que nadie se entere.

**Defensa 2 — los espacios de nombres son DISJUNTOS**, y esto es estructural, no disciplina:

| | poblador (derivado) | enlace manual |
|---|---|---|
| identidades | `email`, `telefono` (fuertes) | `wa_id`, `ig_user`, `psid` (débiles) |
| `personas.clave_raiz` | `email:…`, `telefono:…` | `wa_id:…`, `ig_user:…`, `psid:…` |
| aristas | `regla='correo_telefono'`, `actor='sistema'` | `regla='manual'`, `actor='operador:…'` |

**No hay una sola fila que los dos quieran escribir.** Un test con base lo fija
(`poblarIdentidad.test.db.ts`): el poblador, corrido sobre una base con enlaces manuales, solo
produce tipos `email` y `telefono`, y el enlace sigue vivo con la misma persona canónica
después de dos rebuilds seguidos.

`poblarIdentidad` pasa a recibir la base inyectada (ADR 0008). Sin eso, «el rebuild no borra
los enlaces manuales» no se podía probar — y una garantía que no se puede probar es una
intención.

## Lo que deliberadamente NO se hizo

- **Sugerencias automáticas de duplicados.** Fuera de la v1 por decisión del dueño. Lo honesto
  sobre la pregunta que hizo («¿no se puede saber que es la misma persona por sus redes?»):
  **WhatsApp no expone la identidad social de nadie**, y los ids de usuario de Meta son
  *scoped* por plataforma — la misma persona tiene un id en Facebook y otro en Instagram, y no
  hay forma de unirlos. Lo único que cruza de verdad es el **teléfono** (ya se usa contra
  `leads`) y el **correo** del formulario. Con eso se podría *sugerir*; confirmarlo siempre
  sería de una persona. Queda para la v2.
- **Fusionar hilos o filas de la cola.** Nunca (decisión dura del dueño).
- **Cualquier enlace automático-silencioso.** Prohibido por la regla de la casa.
- **Enlazar un comentario suelto** (`int:<id>`). Meta oculta al autor en el 99% de los
  comentarios de Facebook: enlazar «el comentario 8123» sería atar el lazo a una fila, no a
  alguien. El bloque no se muestra ahí — un botón que rebota es peor que ninguno.

## Consecuencias

- La ficha del panel de Meta deja de ser un callejón: un DM de Instagram no trae teléfono, y
  unirlo al WhatsApp de la misma persona es la única forma de que esa ficha llegue a Cerberus.
- `ontologia` deja de estar vacío en producción, pero **solo con lo que una persona afirmó**.
  El grafo derivado sigue siendo derivado.
- **No hay cambio de schema**: `db/ontologia.ts` no se tocó. Las tablas ya existen en VPS1.
  No hace falta `db:push` para este PR.
- El cambio en la ficha son **dos líneas** (`FichaContacto`, `PanelContexto`); todo el bloque
  vive en `src/features/identidad/`. Hay dos ramas tocando la ficha en paralelo
  (`feat/panel-multifuncion`, `feat/interes-derivado`) y esto tiene que poder mergearse sin
  pelear con ninguna.

## Archivos

- `server/src/identidad/clave.ts` — el puente, puro · `decidir.ts` — qué significa enlazar, puro
- `server/src/identidad/enlazar.ts` — las escrituras y el grupo · `unificado.ts` — el 360 y el buscador
- `server/src/routes/enlaces.ts` — `GET` / `POST` / `DELETE`, detrás de `requiereVendedora`
- `server/src/ontologia/poblarIdentidad.ts` — el rebuild, desarmado
- `src/features/identidad/` — el bloque de la ficha, el buscador y la confirmación
