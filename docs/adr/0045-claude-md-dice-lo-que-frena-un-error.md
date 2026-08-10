# ADR 0045 — `CLAUDE.md` dice lo que frena un error; el fundamento vive en el ADR

- **Fecha**: 2026-08-09
- **Estado**: aceptada
- **Decide**: Estephano (eligió el «trim quirúrgico por sección» sobre partir el archivo en dos o
  recortar solo lo justo para bajar del límite)
- **Reemplaza**: `CLAUDE.md` de **156.323 caracteres** (en `36e7693`) por uno de **102.942** (−34 %)
- **Archiva**: el predecesor completo en `docs/claude-md-2026-08-09-completo.md` (regla dura #3)

## 1 · Por qué ahora

`CLAUDE.md` se pasó del límite de 150.000 caracteres que Claude Code carga por sesión, con **156.323**.
El aviso es la ocasión, no el motivo: el motivo es **cómo** llegó ahí.

Cada frente nuevo agregó su sección con la narrativa entera —lo medido, el día, cómo se encontró—, y
las diez secciones más pesadas sumaban **82 KB**. Las diez citan un ADR que ya existe. Medido antes de
tocar nada:

| | |
|---|---|
| `CLAUDE.md` | 156 KB |
| `docs/adr/` (49 archivos) | **384 KB** |
| ADR 0044 solo | 10 KB · su sección en `CLAUDE.md`, otros 9 KB contando casi lo mismo |

O sea: el fundamento estaba escrito **dos veces**, y la copia que se paga en cada sesión era la peor de
las dos (más corta, sin la alternativa descartada, sin la evidencia).

Antes de recortar se verificó por grep que los ADR cargan de verdad lo que se saca — `2.252` y
`ETAPAS_CONSULTABLES` en 0044, `65.535`/frontera en 0035, `sha256` en 0022, `catalogo_vacio` en 0023,
`webviews` en 0043, «EN POSITIVO» en 0041, `is_echo` en 0042. **El único hueco real** era el corte del
INSERT en tandas de 5.000 por el tope de parámetros de Postgres, que no está en ADR 0035 — y por eso se
quedó en `CLAUDE.md`, que es donde tenía que estar.

## 2 · La regla

**`CLAUDE.md` dice lo que frena un error antes de que lo cometas**: la trampa, el archivo donde vive la
regla, el comando, el env var, la galería. **El fundamento —por qué se decidió así, qué se descartó,
qué se midió— vive en el ADR**, y cada sección dice cuál.

Un frente sin ADR propio apunta al archivo del predecesor. Son siete y se sabe cuáles: la costura de
WhatsApp (incluidas las llamadas de voz), las reacciones, «abrir un chat lo marca leído», los ✓✓, los
límites de media, el bot en la cola y los leads de formulario en el radar. Si alguno gana su ADR, se
borra su sección de `docs/claude-md-2026-08-09-completo.md`.

**Al agregar un frente: escribí el ADR, y dejá en `CLAUDE.md` solo los 🔴.**

## 3 · El 🔴 es un presupuesto, no un adorno

La primera pasada de este recorte marcó **88** líneas con 🔴 donde el original tenía **43**. El archivo
quedaba más corto y **peor**: con 88, ninguno resalta, y un lector que no puede distinguir la trampa que
ya mordió de la observación interesante termina tratando a las dos igual — o sea, salteando las dos.

Se revirtió a los 43 originales (quedaron 45: los dos nuevos son el build de Windows roto y la escalera
de tres peldaños del navegador, los dos ya pagados). Lo demás bajó a ⚠️ o a viñeta común.

**🔴 es para lo que YA mordió o muerde en silencio.** Todo lo demás es ⚠️.

## 4 · Cómo se verificó que no se perdió nada

No alcanza con leer el resultado y que «se vea completo» — es exactamente el error que este repo ya
pagó con la galería que servía el caso ideal. Se verificó con una lista, mecánicamente:

- Se extrajeron **las 43 líneas 🔴** del predecesor, se eligió una palabra distintiva de cada una
  (`STATUS_ENTRYPOINT_NOT_FOUND`, `ventaPosteriorCteSql`, `CADENA VACÍA`, `?mios=1`…) y se comprobó que
  las 43 aparecen en el archivo nuevo. **Las 43 están.**
- Rutas de archivo citadas: 200 → 174 · comandos `npm run`: 18 → 20 · las 13 rutas a documentos que el
  archivo nuevo promete (`docs/arquitectura.md`, `docs/plan-reparto-de-leads.md`, `CONTEXT.md`…)
  existen todas.

Las 26 rutas de archivo que no sobrevivieron son las de las narrativas que se movieron al ADR, no
reglas: el ADR las lleva.

## 5 · Lo que esto NO logró

**No llegó a los ~55 KB que se estimaron al proponerlo.** Quedó en 103 KB, un 34 % menos y no un 65 %.
Se dice acá porque la diferencia es informativa: lo que ocupa el archivo no es narrativa de sobra, es
**una regla con su motivo en la misma línea**. Sacar el motivo deja una prohibición sin defensa, y una
prohibición sin defensa es la que el próximo frente borra por incómoda.

Margen que queda contra el límite: ~40 KB, o sea unos diez frentes al ritmo nuevo (~1,5 KB cada uno)
contra los tres que quedaban al ritmo viejo.

## 6 · Consecuencias

- Un agente que abre el repo lee **~26.000 tokens menos** por sesión, y lo que lee es accionable.
- **Cuesta un salto**: entender *por qué* una regla es así ahora pide abrir el ADR. Es el intercambio
  aceptado — la regla se aplica mucho más seguido de lo que se discute.
- `docs/claude-md-2026-08-09-completo.md` **no se edita**. Lo que sigue vivo se mantiene en `CLAUDE.md`.
- La sección «Estado» dejó de llevar la foto: apunta a `docs/estado.md`, que es donde ya vivía y donde
  no envejece dos veces.
