# Subir la audiencia de valor a Meta: qué es, qué implica y qué esperar

**Fecha:** 2026-07-13
**Estado:** preparado, **NO ejecutado** — espera tu visto bueno explícito.
**Por qué no lo hice solo:** subirla implica enviar datos de tus clientes (hasheados) a Meta y crear
una audiencia en tu cuenta publicitaria. Es una acción hacia afuera, con datos personales. Eso no se
hace sin que vos lo autorices.

---

## 1. Qué es, en una frase

Hoy le enseñamos a Meta **"esta persona compró"** (el lazo / Conversions API, ya funcionando).
La audiencia de valor le enseña algo distinto: **"así es un cliente que vale mucho"** — para que Meta
salga a buscar gente parecida a tus mejores clientes, no a cualquiera que compre una vez.

Son dos piezas:

1. **Custom Audience (audiencia personalizada)** — la lista de tus clientes reales, subida a Meta con
   el correo y el teléfono **hasheados** (SHA-256). Meta la cruza contra sus usuarios y arma un grupo.
2. **Lookalike (audiencia similar)** — Meta toma esa lista como *semilla* y busca usuarios parecidos.
   Si la lista lleva además el **valor** de cada cliente (su LTV), Meta pondera: se parece más a los
   que valen $1.500 que a los que valen $50. Eso se llama **lookalike basada en valor**.

---

## 2. Qué datos salen de acá (y qué NO)

Lo que se envía, por persona:

| Campo | Cómo va | De dónde sale |
|---|---|---|
| Correo | **hasheado** SHA-256, normalizado (minúscula, sin espacios) | `ontologia.cliente.email` |
| Teléfono | **hasheado** SHA-256, normalizado (solo dígitos, E.164) | `ontologia.cliente.telefono` |
| País | en claro (código de 2 letras) — Meta lo pide para mejorar el match | `ontologia.venta.pais_cliente` |
| Valor (LTV) | número en USD, en claro | suma de `venta.monto_usd` cobradas por persona |

**NO se envía**: nombre, DNI, qué compró, cuánto debe, ni nada de Cerberus. Solo el hash del contacto
y su valor.

**El hash no es reversible**: Meta recibe una cadena tipo `a3f9c2…`, la compara contra el hash de sus
propios usuarios, y donde coincide arma el match. Meta no puede "des-hashear" para leer el correo.
El plumbing ya existe: es el mismo hasheo que el lazo usa hoy para mandar las conversiones.

---

## 3. El hallazgo importante: la semilla que propuse es DEMASIADO CHICA

Yo te ofrecí los segmentos **oro + plata**: 421 personas. Al analizarlo bien, **eso es un error**:

- Meta necesita **mínimo ~100 personas matcheadas** para armar un lookalike.
- Pero **recomienda entre 1.000 y 50.000** para que la semilla tenga señal de verdad.
- El *match rate* típico de una lista de correos ronda el **50-70%**.

Entonces: 421 personas × ~60% de match ≈ **250 matcheadas**. Pasa el mínimo técnico, pero está muy por
debajo de lo recomendable. Un lookalike sobre 250 personas es ruido con forma de audiencia.

### La forma correcta

Subir **TODOS los compradores (4.359 personas)** con su **valor (LTV)** adjunto, y dejar que Meta
pondere. Así:

| Opción | Semilla | Matcheadas (~60%) | Calidad |
|---|---|---|---|
| Solo oro + plata | 421 | ~250 | ⚠️ por debajo de lo recomendado |
| **Todos los compradores + valor (LTV)** | **4.359** | **~2.600** | ✅ semilla sólida, y el valor hace el trabajo de priorizar |

No hace falta filtrar a los mejores: **el campo `value` ya le dice a Meta a quién parecerse más**.
Filtrar de antemano te deja sin volumen y no agrega nada que el valor no haga mejor.

**Recomendación: subir los 4.359 compradores con su LTV.** Los segmentos oro/plata siguen sirviendo
para *leerlos vos* (y para campañas de retención), pero no como semilla.

---

## 4. Qué impacto esperar (honesto, sin humo)

Acá hay que separar lo que está probado de lo que es marketing de plataforma.

### Lo que SÍ tiene evidencia fuerte
El **lazo (Conversions API)** — que ya está funcionando. Quitarle a Meta la señal de conversión sube
el costo mediano por cliente incremental de US$38,16 a US$49,93: **31% más caro**. Es un experimento
controlado con más de 70.000 anunciantes (NBER w32765 / *Marketing Science* 2025). Esa es la palanca
grande, y ya la tenemos.

### Lo que es razonable, pero con evidencia más floja
La **lookalike basada en valor**. Es práctica estándar y la lógica se sostiene (le das a la máquina un
objetivo mejor definido), pero los números de lift que publican las plataformas son de estudios
propios, no de experimentos independientes. **No te voy a prometer un % de mejora.**

Lo honesto de esperar:

- **Mejor calidad de audiencia que el interés/demográfico** que se usa hoy: el targeting deja de ser
  "políticos de 25-55" y pasa a ser "gente que se parece a los que te compraron $1.500".
- **Un piso más alto en campañas de prospección** (público frío), que es donde más se desperdicia.
- **Retención / recompra**: con la audiencia de clientes podés (a) excluirlos de campañas de captación
  —dejás de pagar por gente que ya te compró— y (b) hacerles campañas específicas. El **26% recompra**,
  así que esto no es teórico.
- **Lo que NO va a pasar**: no arregla el ROAS por sí solo, no compensa un creativo malo, y no
  reemplaza al lazo.

### La forma correcta de medirlo
No mires el ROAS del mes y digas "funcionó". Corré la lookalike **contra tu targeting actual**, en
conjuntos separados, con el mismo creativo y presupuesto, y comparalos con el **costo por venta real**
(que ya lo tenemos, cruzando con Cerberus). Sin eso, cualquier conclusión es una anécdota.

---

## 5. Lo que hay que mirar antes (privacidad y legal)

Esto **no es una decisión técnica, es tuya**:

1. **Base legal**: estás enviando datos de contacto de personas reales (hasheados, pero identificables
   por Meta) a un tercero, para publicidad. En Perú aplica la **Ley 29733 de Protección de Datos
   Personales** (y equivalentes en México, Colombia, Bolivia, Ecuador…). Necesitás una base legal:
   consentimiento en el momento de la compra, o interés legítimo bien documentado.
2. **Los términos de Meta**: al subir una lista, Meta te hace aceptar las *Custom Audience Terms*, donde
   declarás que tenés derecho a usar esos datos. Esa declaración la firmás vos, no yo.
3. **Qué dicen tus formularios y tu política de privacidad hoy**: si no mencionan que los datos pueden
   usarse para publicidad en plataformas de terceros, conviene actualizarlos antes.
4. **Derecho de baja**: si alguien pide que lo borres, hay que sacarlo también de la audiencia en Meta.

**Mi recomendación**: que alguien con criterio legal mire el punto 1 y 3 antes de subir nada. Es barato
hacerlo bien ahora y caro arreglarlo después.

---

## 6. Cómo se ejecuta (cuando digas que sí)

Está todo listo para armarse; son tres pasos:

1. **Crear la Custom Audience** en la cuenta publicitaria
   (`POST /act_<id>/customaudiences`, `subtype: CUSTOM`, `customer_file_source: USER_PROVIDED_ONLY`).
2. **Subir los usuarios** (`POST /<audience_id>/users`) en lotes, con el esquema
   `[EMAIL, PHONE, COUNTRY, LOOKALIKE_VALUE]` — correo y teléfono ya hasheados con SHA-256.
   4.359 personas ≈ 5 lotes. Meta tarda unas horas en procesar el match.
3. **Crear la Lookalike** (`POST /act_<id>/customaudiences`, `subtype: LOOKALIKE`) desde esa semilla,
   con `type: value_based`, país y ratio (1% = los más parecidos; 1-3% suele ser el punto dulce).

Después: usarla en un conjunto de anuncios **nuevo**, contra tu targeting actual, para poder comparar.

### Qué necesito de vos para ejecutarlo
- Tu **visto bueno explícito** para enviar los datos (hasheados) a Meta.
- **En qué cuenta publicitaria** crearla (hay 24; el lookalike es por país, así que probablemente
  convenga la cuenta del país que más vende: México o Perú).
- Confirmación de que el punto 5 (legal) está mirado.

---

## 7. Resumen en tres líneas

- **Qué**: subir tus 4.359 compradores con su LTV, hasheados, para que Meta busque gente parecida a
  los que más valen (no a los 421 "mejores" — esa semilla es demasiado chica y sería peor).
- **Impacto realista**: mejor prospección y poder excluir/retener a los que ya compraron (el 26%
  recompra). No es la palanca grande — la palanca grande es el lazo, y ya está andando.
- **Costo de hacerlo mal**: mandar datos de personas a un tercero sin base legal. Por eso el paso 5 va
  antes que el 6.
