"""response_formatter — finalize the answer for the chat (Ivi v2.0).

The model follows the canonical v2.0 structure. Here we only GUARANTEE the two
sections that carry engine-computed truth and must never get lost if the model
skips them:

  - ## Impacto Económico     (the precomputed impact_engine chain)
  - ## Próximas Investigaciones (the engine's related questions)

The old "Insights Detectados" / "Preguntas Relacionadas" guarantees are gone:
insights now surface as Hallazgos / Causas Probables / Riesgos inside the model's
narrative, so re-injecting them here would duplicate content. We never inject a
block whose heading is already present.
"""

from typing import List

from .insight_engine import Insight
from .impact_engine import ImpactItem, render_impact_lines


def _impacto_block(impact: List[ImpactItem]) -> str:
    lines = render_impact_lines(impact)
    body = "\n".join(lines) if lines else "(sin cifras de impacto derivables con la evidencia actual)"
    return "## Impacto Económico\n" + body


def _proximas_block(related: List[str]) -> str:
    return "## Próximas Investigaciones\n" + "\n".join(f"- {q}" for q in related)


def format_response(llm_text: str, insights: List[Insight], related: List[str],
                    impact: List[ImpactItem], live: bool) -> dict:
    text = (llm_text or "").strip()

    # Guarantee the engine's Impacto Económico section (only if there is a chain
    # and the model omitted it — never duplicate an existing heading).
    if impact and "Impacto Económico" not in text:
        text = text + "\n\n" + _impacto_block(impact)

    # Guarantee the Próximas Investigaciones section.
    if related and "Próximas Investigaciones" not in text:
        text = text + "\n\n" + _proximas_block(related)

    return {
        "response": text,
        "live": live,
        "insights": [i.text for i in insights],
        "related": related,
        "impact": render_impact_lines(impact),
    }
