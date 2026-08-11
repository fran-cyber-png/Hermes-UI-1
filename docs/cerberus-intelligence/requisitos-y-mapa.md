# Base de requisitos y mapa de implementación

> **Qué es este archivo.** El puente entre la auditoría (`architecture.md`) y el teclado. Cada
> requisito dice **qué**, **por qué con una cifra medida**, **en qué archivo vive**, **qué ya existe**,
> **qué falta** y **cómo se sabe que está listo**. Si un requisito no tiene cifra, no está acá.
>
> **Fecha**: 2026-08-11. **Estado**: R1 en curso (ver §5).

---

## 0. Las cuatro invariantes

Valen para todo lo de abajo. Si una implementación las rompe, está mal aunque pase los tests.

| # | Invariante | Por qué |
|---|---|---|
| **I1** | **Una regla vive UNA vez.** Si tiene que vivir dos (pura + SQL), hay test de paridad. | Cicatriz #37. Ya costó: dos regex de precio, dos lecturas de `platform`, cinco rótulos de etapa. |
| **I2** | **Degradar hacia MENOS, nunca hacia más.** Sin la migración, sin el dato o sin el modelo, el sistema muestra menos — nunca inventa. | ADR 0023: para una persona degradar es honesto; para un índice que cachea es mentir. |
| **I3** | **Nada se manda solo.** El motor prioriza; la acción la firma una persona. | Regla dura #7 de Goberna + ADR 0018. |
| **I4** | **Ningún número sin procedencia.** Toda cifra que el sistema muestre tiene que poder decir de qué consulta salió. | Es lo que permitió refutar 6 de 11 hallazgos de la auditoría. |

---

## 1. R1 · La identidad telefónica (EN CURSO)

**Qué.** Que dos filas de dos tablas distintas se unan si y sólo si hablan de la misma persona.

**Por qué, medido.** Sobre los 448 cruces reales `interactions` ↔ `leads` en producción:
373 (83,3 %) mismo número · 27 (6,0 %) uno es sufijo del otro · 34 (7,6 %) mismo país largo distinto ·
14 (3,1 %) prefijos que no coinciden. Un lead colgado de la persona equivocada arrastra su curso y su
campaña, y **en pantalla se ve igual que uno correcto**.

🔴 **Lo que la regla nueva arregla de verdad, corrido contra producción: 3 pares, no 14.**

```
pares con la regla VIEJA (sufijo de 9) : 448
pares con la regla NUEVA (local+país)  : 445
  dejan de unirse                      :   3   ← Perú↔Chile ×2, Perú↔Ecuador
  empiezan a unirse                    :   0
```

De los 14 «prefijos distintos», sólo **3 tienen los dos lados parseables y con países que se
contradicen**. En los otros 11 un lado no se deja leer como E.164, así que la guarda **se abstiene**
y siguen uniéndose — degradación honesta, y deuda declarada en §7.
**Y 0 falsos negativos**: ningún par correcto se pierde. Ése es el invariante que importaba.

⚠️ **El beneficio grande está en otro cruce.** El **14,5 %** de las conversaciones son de países con
local de 8 dígitos (Panamá 5,6 % · Guatemala 5,0 % · Bolivia 3,9 %), donde el sufijo de 9 arranca
adentro del código de país. Contra `leads` no se nota (los dos lados guardan E.164 y se equivocan
igual); se nota contra **Cerberus**, que guarda el local suelto. **Ese cruce no está medido.**

Además, en `leads` hay **292 sufijos con más de un número detrás**, y el reparto de prefijos
(`{593,5930}` 79 · `{51,5151}` 35 · `{593,593593}` 14) dice que **casi toda esa colisión no es
ambigüedad entre países: es el mismo número escrito mal**. La normalización baja esas llaves
colisionadas de **292 a 284** — mejora chica, y se dice chica.

**Dónde vive.**

| Archivo | Estado |
|---|---|
| `server/src/telefono/paises.ts` | **YA EXISTE** — tabla de países, `partirE164`, `mismoTelefono` |
| `server/src/telefono/identidad.ts` | **NUEVO** — `claveTelefono`, `normalizarE164`, `mismaClave` |
| `server/src/telefono/identidadSql.ts` | **NUEVO** — gemelo SQL **generado desde `PAISES`** |
| `server/src/telefono/identidad.test.ts` | **NUEVO** — 21 casos: los pares que chocan por sufijo, los aciertos que no se pueden perder, y Guatemala |
| `server/src/telefono/identidad.paridad.test.db.ts` | **NUEVO** — el candado (I1) |

**Qué falta: los seis consumidores.** `cola/clienteSql.ts` **ya tiene la guarda de país**; los demás
siguen con el sufijo pelado.

| Consumidor | Qué cruza | Guarda hoy |
|---|---|---|
| `cola/clienteSql.ts` | conversación ↔ `clientes_padron` | ✅ `codigo_pais IS NULL OR …` |
| `cola/leadsCte.ts` | conversación ↔ `leads` (tarjetas de formulario) | ❌ |
| `cola/cursoSql.ts` | conversación ↔ `leads` (chip de curso) | ❌ |
| `gente/leadDeTelefono.ts` | ficha ↔ `leads` | ❌ |
| `autorespuesta/candidatos.ts` | candidato ↔ `leads` | ❌ |
| `atribucion/resolverConversacion.ts` | venta ↔ conversación | ❌ |

⚠️ **`atribucion/resolverConversacion.ts` es el más delicado**: ahí un falso positivo no pinta un
chip, **atribuye una venta a la conversación equivocada**. Va último y con su propio test.

**Criterio de aceptación.**
1. `identidad.paridad.test.db.ts` en verde — SQL ≡ TS para el banco entero y su producto cartesiano.
2. Los 3 pares que hoy chocan por sufijo dejan de unirse **en la base**.
3. Los 5 pares que hoy aciertan siguen uniéndose (la guarda quita falsos positivos; **no puede**
   agregar falsos negativos).
4. Guatemala: `50212345678` y `12345678` se encuentran — hoy es imposible («393 clientes invisibles»).
5. `npm test` y `npx tsc --noEmit` en verde.

**Riesgo declarado.** Cuando el número no se deja leer como E.164, `codigoPais` es `null` y la guarda
se salta. Es la misma degradación que `clientes_padron` ya usa. **Quita falsos positivos, no los
elimina** — y decirlo es parte del requisito (I2).

---

## 2. R2 · La compuerta de procedencia

**Qué.** Que cada mensaje entrante lleve, escrito al ingresar, de dónde salió su texto.

**Por qué, medido.** Sobre 3.219 entrantes vivos de WhatsApp: **845 sin texto (26,3 %) + 817
prellenados por Meta (25,4 %) + 516 saludos de ≤12 caracteres (16,0 %) = 67,7 % sin intención que
inferir**. 568 de esos 817 son **la misma cadena literal**. Sin esta capa, el sistema le atribuye
intención a su propio anuncio — que es lo que el chip «Piden info» ya hace hoy
(`cola/urgenciaSql.ts`, `PIDE_INFO_REGEX_SQL`).

**Dónde vive.** `server/src/procedencia/` (nuevo) · migración `mensaje_procedencia` ·
`webhook/whatsapp.ts` y `webhook/meta.ts` como escritores.
Las reglas ya están escritas y corridas: `docs/cerberus-intelligence/labeling_functions_v0.py` →
portar a TS.

**Criterio de aceptación.** La distribución medida en producción reproduce ±2 puntos las cifras de
arriba · un tablero muestra la distribución por semana · el chip «Piden info» deja de contar el texto
del anuncio, y el número que muestra **cambia** (si no cambia, no se enchufó).

**Depende de**: nada. **Es la primera pieza que se puede construir hoy.**

---

## 3. R3 · La alarma de frescura por fuente

**Qué.** Filas nuevas por día por almacén y por línea, con alarma cuando una fuente calla.

**Por qué, medido.** **Tres de las cuatro sesiones whatsmeow están muertas y las tres siguen
declaradas con `activo = true`.** La línea que aportaba el 66 % del tráfico calló el 28-jul y nadie lo
notó; `meta_lead_ad` está muerto desde el 19-may; Messenger, desde el 11-jul.
⚠️ **`max(occurred_at)` mide cuándo Hermes dejó de INGERIR, no cuándo la línea dejó de operar** — se
distingue mirando la fecha del archivo `.wa-sessions/<numero>.db`.

**Criterio de aceptación.** Apagar una sesión en staging dispara la alarma en < 1 h · la alarma
distingue «la línea no recibe» de «Hermes no ingiere».

**Prioridad: la más alta de todo el documento.** Un motor sobre un caño cerrado reporta métricas
estables sobre nada.

---

## 4. R4 · Que la escalada llegue a una persona

**Qué.** Que cuando el bot pide ayuda, alguien se entere.

**Por qué, medido.** En el sistema previo, **las 7 escalaciones tienen `notify_status = 'failed'`.**
7 de 7. En Hermes hoy existe el chip de filtro (`?intencion=bot-escalada`), que es mejor que nada
pero es **pull**: alguien tiene que ir a mirar.

**Criterio de aceptación.** Una escalada de prueba llega a un humano y queda registrado que llegó ·
la tasa «escaladas que llegaron / escaladas» es una métrica visible, y su línea de base es 0/7.

---

## 5. Orden de implementación, y por qué

```
R3 frescura ──┐
              ├──► R2 procedencia ──► R5 clasificación de texto
R1 identidad ─┘                             (LLM, ~230/semana)
              └──► R6 scoring tabular  (formulario→venta, 1.002 positivos)
R4 escalada  ─── independiente, se puede hacer en paralelo
```

- **R3 primero** porque sin ingesta no hay nada que medir.
- **R1 y R2 son independientes entre sí** y las dos son determinísticas: cero modelo, cero costo,
  cero latencia. Son el 100 % del valor que se puede entregar sin etiquetar un solo mensaje.
- **R5 va último** aunque sea lo que se pidió primero: necesita R2 (para no clasificar el texto de
  Meta) y necesita un conjunto dorado que hoy tiene **18 conversaciones**.

---

## 6. Lo que NO se construye, y por qué

| No se construye | Motivo medido |
|---|---|
| Un almacén de contactos nuevo | GOBERNACRM ya demostró que un tercer padrón aporta **333 personas** y un problema de sincronización. Está contenido **al 100,0 %** en LEADSCRM. |
| Un motor de estados | `etapaEfectivaSql` (ADR 0044/0050) ya deriva las cinco etapas con tests de paridad. |
| Un clasificador de producto | `alias_curso` (57 filas) + `cursos/precedencia.ts` con su gemelo SQL. |
| Destilación LLM → modelo chico | Ahorra **$20/mes** medidos y cuesta meses. |
| Multi-etiqueta en la taxonomía | Sólo **1,8 %** de los mensajes recibe más de un voto. |
| Una sexta columna en el tablero | El GRID ya está en 1.060 px de mínimos sobre ~1.256 (ADR 0050). |

---

## 7. Deuda que este trabajo NO paga

Se declara para que no se descubra después:

1. **Los 34.118 PSIDs siguen huérfanos.** La clave telefónica no los alcanza: un PSID no es un
   teléfono. Sólo **918 (2,69 %)** se atan a un cliente, por el texto que la persona tipeó.
2. **El 65,3 % de quien conversa no está en ICARUS.** El scoring tabular de R6 no los puntúa.
   Es la limitación más seria del plan y hay que decirla al presentarlo.
3. **`icarus.sales` no cubre antes de 2025.** Cualquier análisis histórico de compras arranca ahí.
4. **`sales` es multimoneda sin normalizar** (USD 2.541 · PEN 1.773 · MXN 1.722 · BOB 945 …).
5. **El cruce por correo no está medido.** La matriz de solapamiento de `architecture.md` es sólo
   por teléfono.
