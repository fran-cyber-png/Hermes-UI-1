# 28 — Plan de integración por API para la Fase C de Ivi (el modelo creativo)

> Nace del pedido de Estephano (2026-07-17/18): evaluar usar los USD 100 de AWS
> para un LLM por API (mencionó "GLM 5.2") en vez de hostear local con llama-swap.
> Basado en research verificado de esta sesión (Bedrock / Azure / GLM-Zhipu / fit).
> Ley I: cada precio con su fuente; lo no confirmado va marcado.

## 0. El veredicto en cuatro frases

1. **El crédito de AWS sí aplica a Bedrock** (pay-per-token dentro de tu cuenta), y
   Bedrock tiene Claude, Amazon Nova, DeepSeek, Mistral, Llama **y también GLM/Zhipu**.
2. **Tu "GLM 5.2" no existe como tal**: en Bedrock hay `zai.glm-5` ($1/$3,20) y
   `zai.glm-4.7` ($0,60/$2,20). Y su fuerte es **coding/agentic + chino-inglés, NO copy
   de marketing en español** → no es el mejor para el rol creativo de Ivi.
3. **A tu volumen (bajo), el costo es irrelevante**: USD 100 compran ~238.000
   generaciones en Nova Lite o ~12.500 en Claude Haiku — **años de runway** en
   cualquiera. **Decide la CALIDAD** (español idiomático + JSON del Brief fiable), no el precio.
4. **Recomendación**: el **rol creativo va a Bedrock** (Nova Lite como default barato,
   A/B ciego contra Claude Haiku 4.5, y gana el mejor español); el **rol BI se queda
   local** (qwen3, Ley I). Esto **simplifica** los planes 25/26: la Fase C ya no
   necesita llama-swap ni GPU para el modelo creativo.

## 1. Los dos roles, de nuevo (por qué la decisión no es una sola)

- **BI / análisis** (narrar tus ventas, P&L): **dato sensible**. Se queda **local**
  (qwen3:8b en la A4000). Si algún día va a API, exigir Bedrock **in-region** (São
  Paulo / us-east) y modelos Anthropic/Amazon — nunca pesos de origen chino por
  política, aunque en Bedrock corran dentro de AWS.
- **Creativo** (Ivi Studio, copy de campaña): **público, sin PII** → **API sin
  fricción**, y donde la calidad de español manda. **Este es el que movemos.**

## 2. Precios verificados en Bedrock (para el rol creativo)

Todos elegibles para el crédito de AWS. Precio por 1M de tokens (input / output).

| Modelo | in / out (USD/1M) | Ctx | Fuerte en | Nota |
|---|---|---|---|---|
| **Amazon Nova Lite** | **0,06 / 0,24** | 300K | español sólido, tool-use nativo (Converse) | default barato, casi gratis con el crédito |
| Amazon Nova Micro | 0,035 / 0,14 | 128K | texto puro, el más barato | copy simple |
| Amazon Nova Pro | 0,80 / 3,20 | 300K | mejor calidad creativa que Lite | escalón medio |
| **Claude Haiku 4.5** | **1,00 / 5,00** `[corregido]` | 200K | **español LATAM top + JSON/tool-use best-in-class** | ganador probable de calidad |
| Claude Sonnet 5 | 3,00 / 15,00 (promo 2/10 hasta 31-ago-2026) | 1M | la mejor prosa publicitaria | cuando la calidad mande |
| `zai.glm-5` (GLM-5) | 1,00 / 3,20 | 200K | agentic/coding, CN-EN (español NO es su fuerte) | **evitar para copy** |
| DeepSeek V3.2 | 0,62 / 1,85 | 128K | razonamiento/coding | español aceptable, no nativo |
| Mistral Large 3 | 0,50 / 1,50 | 128K | español bueno, function-calling | alternativa europea |

> Sourcing: Claude/DeepSeek/Mistral/GLM de la página oficial de pricing de AWS;
> Nova de agregadores terciarios (marcado). Haiku 4.5 **corregido a $1/$5** (la cifra
> $0,80/$4 fue refutada en verificación). Runway con ~3k in + 1k out por generación:
> Nova Lite ~238k gen; Haiku ~12.500 gen — ambos = años con USD 100.

## 3. La arquitectura de integración (el cambio real en Ivi)

Hoy el engine (`goberna-kos/ivi`) tiene UN gateway de modelo: `call_ollama()` →
Ollama local. La Fase C creativa suma un **segundo gateway: Bedrock (Converse API)**.

```
Ivi engine
├─ rol BI (narración de datos)  → call_ollama()  → qwen3:8b LOCAL  (Ley I)   [sin cambio]
└─ rol CREATIVO (Ivi Studio)    → call_bedrock() → Nova Lite / Haiku 4.5     [NUEVO]
                                   (Converse API + tool-use para los
                                    updates ESTRUCTURADOS del Brief)
```

- **Converse API + tool-use / JSON**: el rol creativo no solo redacta copy, devuelve
  **updates estructurados del Brief** (producto, ángulo, titular, cuerpo, CTA). Bedrock
  Converse con `toolConfig` fuerza el schema → el modelo devuelve JSON válido, no texto
  a parsear. Nova y Claude Haiku lo soportan nativo.
- **La barrera de honestidad (Ley I) sigue siendo determinista**: el modelo redacta y
  propone; los números salen del pipeline (como en Fase A/B). El `contexto` del creativo
  (ya cableado en Fase B) es lo que se le pasa.
- **Auth/config**: credenciales AWS por env (nunca en el repo); `IVI_CREATIVO_BACKEND=bedrock`
  con fallback a Ollama. Región in-region si algún día entra dato sensible.

**Esto reemplaza, para el rol creativo, el plan de llama-swap de docs/25/26.** La voz
(Piper/whisper) y Flux siguen locales; la A4000 deja de tener que malabarear un LLM
creativo en su VRAM. Más simple, y el crédito lo cubre.

## 4. AWS vs Azure vs GLM directo — por qué AWS

- **AWS Bedrock**: el crédito de USD 100 aplica; tiene Claude (top español) y Nova
  (baratísimo AWS-nativo); un solo SDK (Converse). **Elegido.**
- **Azure** (OpenAI GPT-4o-mini con Structured Outputs es excelente para JSON+español):
  **pierde el crédito de AWS** (son proveedores distintos, créditos aparte). Vale como
  plan B si el español de Bedrock decepciona.
- **GLM directo (Zhipu)**: la API propia es barata, pero **no usa el crédito AWS** y
  suma un proveedor chino con dato saliendo. En Bedrock, GLM corre dentro de AWS pero
  **no es el mejor para copy español** de todos modos. Sin ventaja acá.

## 5. El corte más chico para arrancar

1. **Habilitar Bedrock** en la cuenta AWS (aplicar el crédito) + acceso a Nova Lite y
   Claude Haiku 4.5 en una región (us-east-1 o sa-east-1).
2. **`call_bedrock()`** en el engine (Converse API), detrás de un flag, con tool-use
   para un update del Brief de prueba. Sin tocar el rol BI.
3. **A/B ciego Nova Lite vs Claude Haiku 4.5** en 5-10 prompts reales de copy (Manual,
   diplomados) evaluando: español idiomático de campaña + adherencia del JSON del Brief.
   Como el costo es centavos, **gana la calidad**.
4. Cablear el ganador al **texto libre del Studio (Fase C)**: lo que escribís se
   interpreta y devuelve updates del Brief, con la barrera determinista.

## 6. Decisiones abiertas para vos

1. **¿AWS Bedrock confirmado** para el rol creativo (aprovechar el crédito)?
2. **¿El rol BI queda local** (recomendado, Ley I) o querés probarlo también en Bedrock
   in-region?
3. **¿Arranco por el `call_bedrock()` + el A/B Nova Lite vs Haiku**, o preferís primero
   que dejemos lista la cuenta AWS (crédito + acceso a modelos) de tu lado?

## Apéndice — respaldo

Verificado (20/23 cifras): el crédito AWS aplica a Bedrock (USD 100 signup + 100 por
actividades, vencen 6 meses); GLM está en Bedrock (`zai.glm-5`/`zai.glm-4.7`); Haiku 4.5
= $1/$5 (corregido); "GLM 5.2" no existe (es GLM-5). No confirmado / reverificar: precios
de Nova y Llama (fuentes terciarias); el ID exacto si Zhipu saca un release posterior a
`zai.glm-5`; GPT-4o-mini pricing (histórico). Runway de USD 100: cálculo propio con
~3k+1k tokens/gen, órdenes de magnitud (miles a cientos de miles de generaciones).
