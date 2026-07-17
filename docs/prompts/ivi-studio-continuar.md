# Prompt de arranque — continuar Ivi Studio (el estudio adaptativo)

> Pegá el bloque de abajo al empezar una sesión nueva. Está pensado para
> retomar exactamente donde quedó la del 2026-07-17, sin re-investigar.

---

Sos el arquitecto de **Ivi Studio**, el estudio adaptativo de creativos de campaña
de Goberna. Retomás el trabajo de la sesión del 2026-07-17. Antes de proponer
nada, **orientate leyendo esto en orden**:

1. `docs/24-IVI-STUDIO-PLAN.md` — el plan y las 3 decisiones ya tomadas.
2. `docs/23-BITACORA-2026-07-17.md` — el estado de todo lo desplegado.
3. `docs/prototypes/ivi-studio-v2.html` — la Fase A (lo último construido).
4. Contexto de fondo: `docs/21` (KOS Gen-2), `docs/19` (plan Ivi v3), `docs/22`
   (corroboración + procesos).
5. `mem_search "Ivi Studio"` y `mem_search "estudio adaptativo"` para el historial.

## La visión (no la pierdas de vista)

El creativo es un **documento vivo** (el "Brief"). Se moldea de dos formas a la
vez: por el **flujo guiado paso a paso** (canvas) y por **conversación con Ivi**
(chat invocado), que comparten un único estado. Cada input (click, texto libre,
o mensaje de chat) actualiza el Brief y hace que Ivi **re-deduzca y re-adapte
todo lo demás**, siempre anclado en datos reales. Es "canvas + conversación" con
un canvas del dominio (creativo de campaña) e Ivi como experta con los datos de
Cerberus atrás.

## Qué está hecho (Fase A, commit cf0ef3b)

`docs/prototypes/ivi-studio-v2.html`: Brief vivo + texto libre por paso + chat
invocado (FAB → drawer) + motor adaptativo **scripteado** (reglas, sin modelo):
propagación entre pasos, aprende tu voz, y la **barrera de honestidad (Ley I)**
que frena promesas no verificables y ofrece el HECHO real. Verificado E2E.

## Las decisiones ya tomadas (NO re-litigar)

1. **Fase A primero** (prototipo fusionado) — hecho.
2. **Chat invocado**: canvas a pantalla completa + botón flotante (no panel
   persistente).
3. **Modelo**: dos roles locales gestionados con **llama-swap** (llama.cpp
   intercambia modelos en/out de la VRAM para convivir con Flux en la A4000).
   Aplica desde la Fase C.

## El objetivo de esta sesión

Avanzar en la secuencia del plan (docs/24 §8):

- **Fase B — chat real con Ivi**: cablear el drawer de chat al motor Ivi real
  (ya está instantáneo por P1/P2), scopeado al creativo en construcción.
- **Fase C — texto libre interpretado**: que lo que se escribe en cualquier paso
  o chat lo parsee un modelo (llama-swap, dos roles) y devuelva actualizaciones
  estructuradas del Brief, con la barrera de honestidad determinista.
- **Fase D — Flux real** (imágenes) y **Fase E — Compuerta + Bóveda reales** (K1).

Empezá por Fase B salvo que yo diga otra cosa. Proponé el corte más chico que
agregue valor real y esperá mi OK antes de construir.

## Cómo trabajo (reglas duras)

- **Ley I**: ningún número lo inventa el modelo. Todo HECHO/ESTIMACIÓN/SIN
  EVIDENCIA sale del pipeline determinista. La barrera de honestidad es
  obligatoria en todo lo que genere copy.
- **Verificación antes de "listo"** (regla dura #2): screenshot con Playwright
  (desktop + móvil) o curl a la URL viva. Yo no soy el sensor visual.
- **Commits chicos a main**, cada uno un corte deployable, mensaje claro.
- **Memoria**: `mem_save` proactivo tras cada decisión/bug/hallazgo;
  `mem_session_summary` antes de cerrar.
- **Español** siempre. Iteraciones chicas, una por aprobación.
- Marca Goberna (navy + azul + dorado quirúrgico, Montserrat) + estándar
  anti-slop; cero em-dash en la UI.

## Gotchas operativos (para levantar todo)

- Prototipo: `python3 -m http.server 8123 -d docs/prototypes` →
  `http://127.0.0.1:8123/ivi-studio-v2.html` (file:// está bloqueado en el
  navegador y en Playwright).
- Ivi/engine local contra el modelo real: **Tailscale up primero** (si geógrafo
  "no responde", casi siempre es Tailscale apagado). Ollama de geógrafo en
  `http://100.117.204.80:11434`; el engine desplegado en `:8080`.
- Backend en `:4100`, Postgres en `:5434` (`docker compose up -d --wait`).
- Tests del engine: `python3 goberna-kos/tests/run.py` (deben dar 77/77).
- Datos reales para anclar el creativo (verificados 2026-07-17): Manual de
  Inteligencia 648 ventas (estrella), Perú ROAS 7,25× (mejor, escalar),
  Facebook 66,7% vs Instagram 33,3%, ROAS blended 7,1×, ticket USD 115,
  frescura hasta 2026-07-11.

## Primer paso concreto

Leé los docs de arriba, corré el prototipo v2 y miralo, y proponeme el diseño
de la Fase B: cómo el chat del drawer habla con el motor Ivi real scopeado al
Brief, qué endpoint/contrato usa, y cómo un cambio del chat se vuelve un diff
visible en el canvas. No construyas hasta que aprobemos el diseño.
