# Plan de evaluación — Cerberus Intelligence

> Todo número de este archivo está **medido** contra producción el 11-ago-2026, o dice
> `UNKNOWN — REQUIERE DATOS`. Nada está estimado.

## 0. La pregunta que ordena el plan

No es «¿qué F1 saca el clasificador?». Es:

> **¿Qué decisión cambia, y cuánta plata mueve ese cambio?**

Se mide en ese orden y no al revés, porque el sistema previo ya alcanzó un clasificador
funcionando —86 reglas, 31 intents, 512 mensajes ruteados, un router LLM en producción— y
lo que le faltó no fue precisión: fue que **`ai_feedback` tenía cero filas con el shadow
mode prendido**. Nunca se midió si servía.

---

## 1. Lo que NO se puede evaluar hoy, y por qué

| Pregunta | Estado | Cifra medida |
|---|---|---|
| ¿La clasificación predice la venta? | **NO EVALUABLE** | 16 ventas posteriores al primer mensaje en toda la base de Hermes (1,1 % de 1.464) |
| ¿El clasificador acierta? | **NO EVALUABLE** | 49 conversaciones con etiqueta humana de 3.998 (1,2 %), y el 74 % de un usuario de prueba |
| ¿Mejora respecto de la línea de base? | **NO EVALUABLE** | no hay línea de base registrada |
| ¿La clasificación predice la respuesta? | **EVALUABLE** | 1.129 pares saliente→entrante (11,42 %) |
| ¿El formulario predice la venta? | **EVALUABLE** | 1.002 positivos sobre 19.670 contactos (5,09 %) |

**Consecuencia:** las dos últimas filas son el plan de evaluación. Las tres primeras son
trabajo de instrumentación que hay que hacer *antes* de poder evaluar nada.

---

## 2. La línea de base que hay que registrar primero

Antes del primer modelo, se corre y se guarda:

1. **Mayoría** — etiquetar todo con la clase más frecuente. Da el piso que hay que superar.
2. **Sólo procedencia** — sin clasificar nada, sólo la compuerta determinística.
   Ya sabemos que resuelve el **67,7 %** de los entrantes vivos. *Cualquier modelo que no le
   gane a esto no vale su latencia.*
3. **Sólo labeling functions** — cobertura medida: **47,1 % en Messenger, 11,5 % en WhatsApp**.
4. **Sólo el diccionario de curso existente** (`alias_curso`, 57 filas).

⚠️ El paso 2 es el que más se olvida y el más importante: buena parte del valor que un
clasificador *parece* aportar ya lo aporta una regex sobre el texto que escribe Meta.

---

## 3. Métricas, por familia

### 3.1 Clasificación
`precision`, `recall`, `F1` **por clase**, `macro-F1` y `micro-F1`.
Se reporta **macro-F1 como número principal**: el micro lo domina la clase mayoritaria y
esconde exactamente lo que importa (`soporte_postventa` es 0,3–0,9 % y es la clase de mayor
valor por unidad).

### 3.2 Desbalance
`recall de la clase minoritaria` con su intervalo de Wilson al 95 %.
Con 0,9 % de `soporte_postventa` sobre 937 mensajes libres, hay **8 casos**: un recall
reportado sin intervalo sobre 8 casos es ruido con formato de métrica.

### 3.3 Calibración
`Brier`, `ECE` (10 bins), y la curva de fiabilidad.
**Confianza ≠ similitud ≠ probabilidad.** El umbral de delegación se fija sobre la
confianza *calibrada*, y la calibración se ajusta aparte (Platt o isotónica sobre el
conjunto de validación), nunca a ojo.

### 3.4 Detección de lo desconocido
`falso conocido` (le puso clase a algo que no la tenía) y `falso desconocido`.
El número que importa es **falso conocido**, porque es el que produce una acción equivocada.

### 3.5 Ranking — la que decide el trabajo diario
`Precision@K`, `Recall@K`, `NDCG`, `MRR`, y sobre todo **`conversion@K`**.
K = lo que una vendedora atiende por día. **Medido: el Pipeline muestra 4.143 tarjetas y
25 son accionables.** Ahí `Precision@40` es la métrica del negocio, no el F1.

### 3.6 Negocio (las únicas que se reportan hacia arriba)
- tasa de respuesta (línea de base **11,42 %**)
- tiempo hasta la primera respuesta humana (línea de base **p50 22,5 min** en líneas humanas)
- conversión formulario→venta (línea de base **5,09 %**)
- % de `soporte_postventa` atendido en < 24 h (línea de base **UNKNOWN — no se distingue hoy**)
- tasa de escalada del bot que **efectivamente llega a una persona**
  (línea de base del sistema previo: **0 de 7**)

---

## 4. Cómo se agregan las fuentes débiles

Cada mensaje recibe votos de: LFs · vecino por embedding · LLM · campo del CRM · outcome.

- Ninguna es ground truth. **El LLM tampoco** — es una fuente débil más.
- El agregado empieza siendo **mayoría con desempate por precisión estimada de cada fuente**,
  no un modelo generativo de etiquetas. Con 512 ejemplos con etiqueta, un modelo tipo Snorkel
  no tiene con qué estimar sus parámetros: es complejidad sin sustento.
- **Los desacuerdos no se resuelven: se guardan.** Son la cola de revisión humana.

**Regla de conflicto medida:** sólo el **1,8 %** de los mensajes de Messenger y el **0,1 %**
de los de WhatsApp reciben más de un voto. El agregado casi no tiene trabajo que hacer — el
problema real es la **abstención** (52,9 % y 88,5 % sin ningún voto), no el conflicto.

---

## 5. Umbrales: se miden, no se eligen

No se escribe `0,85`. Se construye la curva confianza↔precisión sobre validación y se fijan
dos cortes por el **costo del error**, que es asimétrico y medible:

- Mandarle a una alumna que reclama su diploma una plantilla de venta: **caro** (es una
  persona que ya pagó).
- No detectar un `pide_precio`: **barato** (la vendedora lo ve igual en el chat).

Por eso `soporte_postventa` va a llevar un umbral más permisivo (preferimos revisar de más) y
`pide_info_generica` uno más exigente. **Un solo umbral global para todas las clases es la
decisión por defecto y es la equivocada.**

---

## 6. Slices que existen de verdad

Se evalúa por rebanada, no sólo en global. Las que el dato sostiene:

| Slice | Valores medidos |
|---|---|
| canal | whatsapp · messenger · instagram · landing |
| línea propia | 4 números; uno aporta el 66 % del tráfico |
| autor | bot vs humana — **poblaciones opuestas, nunca promediarlas** (ver la advertencia de abajo) |
| país | PE · MX · CO · GT · BO · EC · US (de `partirE164` y de los formularios) |
| moneda | USD 2.541 · PEN 1.773 · MXN 1.722 · BOB 945 · DOP 111 · COP 70 |
| año | 2016–2026, con línea de producto distinta por tramo |
| fuente del contacto | crm_import 1,95 % · landing 5,52 % · google_contacts 4,56 % |
| longitud | ≤49 car. es el 90,9 % de Messenger |
| primer contacto vs recurrente | 47,58 % de Messenger escribió UNA sola vez |

⚠️ **La rebanada `autor` no es opcional — y es también la trampa mejor documentada de este
informe.** La primera lectura fue «el bot contesta en 21 s y la humana en 22,5 min, 64× de
brecha». La verificación adversarial lo refutó: **las dos poblaciones casi no coexisten en el
tiempo.** La línea humana grande sólo tiene entrantes del 21 al 28-jul; la del bot arranca el
1-ago. Comparar sus p50 globales compara **julio contra agosto**, no bot contra humana — el mismo
pecado que la rebanada existe para evitar.

Sobre los **5 días en que las dos están vivas (1–5 ago)**: humanas p50 **140 s** · bot p50
**21,3 s**. La brecha real es **6,6×, no 64×**. Y el 21 s del bot también es una ráfaga: 71 % de
sus entrantes caen en 2 días; del 3 al 11-ago sus p50 diarios van de 224 s a 224.408 s.

> **Regla que sale de acá y aplica a todo el plan**: antes de comparar dos grupos, verificá que
> coexisten en la ventana. Un slice sobre poblaciones que no se solapan mide el calendario.

---

## 7. Análisis de error

Automático en cada corrida: top falsos positivos, top falsos negativos, los 5 pares de
confusión más pesados, clusters de baja confianza, clusters de `OTRO`.

Cada error se clasifica por **causa raíz**, y la distribución de causas manda más que el F1:

`taxonomia_mala` · `etiqueta_mala` · `contexto_insuficiente` · `limite_del_modelo` ·
`senal_faltante` · `entidad_faltante` · `calidad_de_dato` · `solape_de_clases` · `intent_nuevo`

Si `taxonomia_mala` + `solape_de_clases` supera el 30 %, **el problema no es el modelo y
entrenar más es tirar el tiempo**.

---

## 8. Detección de deriva

- **Deriva de datos**: distribución de `procedencia` por semana. Si `prellenado_anuncio` salta,
  cambió una campaña, no el negocio.
- **Deriva de concepto**: macro-F1 sobre una ventana móvil de 30 días contra el conjunto de test fijo.
- **Deriva de taxonomía**: `OTRO` como % del texto libre. Si crece dos semanas seguidas, hay una
  clase nueva pidiendo nacer.
- 🔴 **Deriva de existencia**: filas nuevas por día por almacén. **Es la primera alarma, no la última.**
  Medido: la línea que aportaba el 66 % del tráfico de Hermes calló el 28-jul y nadie lo notó;
  `meta_lead_ad` está muerto desde el 19-may; Messenger, desde el 11-jul. *Un tablero que no
  avisa que la fuente se apagó va a reportar métricas estables sobre un caño cerrado.*

---

## 9. Champion / challenger

Sólo cuando exista conjunto dorado. Antes, no hay con qué comparar.
El challenger corre en sombra sobre el mismo tráfico y se compara con **macro-F1 + conversion@K**,
no con accuracy. La promoción la firma una persona.

---

## 10. Criterio de salida de cada fase

Ninguna fase avanza sin esto:

| Fase | Sale cuando |
|---|---|
| 0 · Auditoría | ✅ HECHA — este documento y sus hermanos |
| 1 · Instrumentar | `procedencia` se escribe en cada mensaje entrante y hay tablero de frescura por almacén |
| 2 · Conjunto dorado | 300 mensajes etiquetados por una persona, estratificados por clase y canal, con acuerdo entre 2 anotadores ≥ 0,7 (Cohen κ) |
| 3 · Línea de base | las 4 líneas de base de §2 corridas y guardadas |
| 4 · Clasificador | macro-F1 supera la mejor línea de base en el test **temporal**, con intervalo que no toca el cero |
| 5 · Producción | `conversion@K` no empeora y la tasa de escalada-que-llega-a-una-persona es > 90 % |
