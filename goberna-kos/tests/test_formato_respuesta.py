"""Golden harness — la respuesta se adapta a la pregunta (2026-07-17).

Queja real del usuario: "hola cómo vamos este mes" recibía un informe de 9
secciones (~2.400 chars) con cada cifra repetida hasta 5 veces. La decisión:
el FORMATO lo elige el motor (determinista), no el modelo — corto por default,
informe solo cuando se pide. Y el response_formatter no puede re-inyectar el
bloque entero de impacto en formato corto (desharía el formato por atrás):
la verdad del motor viaja completa en los campos JSON `impact` y `related`.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ivi.kpi_engine import KPIs
from ivi.analytics_engine import analyze
from ivi.impact_engine import compute_impact, ImpactItem, HECHO
from ivi.intent_analyzer import analyze as analyze_intent
from ivi.prompt_builder import build, formato_de_respuesta
from ivi.response_formatter import format_response


def _prompt(pregunta):
    k = KPIs()
    a = analyze(k)
    intent = analyze_intent(pregunta)
    return build(intent, k, a, [], [], ["ventas por sede", "ROAS por país"],
                 compute_impact(k))


def test_conversacional_es_corto_por_default():
    for p in ["hola como vamos este mes", "ventas por semana", "¿y solo Lima?",
              "riesgos comerciales", "ticket promedio"]:
        assert formato_de_respuesta(p) == "corto", p


def test_pedir_informe_activa_el_informe():
    for p in ["dame el informe completo", "resumen ejecutivo de ventas",
              "auditoría comercial", "análisis completo del mes",
              "quiero un reporte completo detallado"]:
        assert formato_de_respuesta(p) == "informe", p


def test_prompt_corto_no_manda_las_9_secciones():
    prompt = _prompt("hola como vamos este mes")
    assert "FORMATO DE SALIDA: CORTO" in prompt
    # el mandato del informe ("responde usando EXACTAMENTE estas secciones") no viaja
    assert "Responde usando EXACTAMENTE estas secciones" not in prompt
    assert "## Próximas Investigaciones" not in prompt
    assert "cifra aparece UNA sola vez" in prompt
    # el cierre ofrece profundizar con las preguntas relacionadas del motor
    assert "ventas por sede" in prompt and "informe completo" in prompt


def test_prompt_informe_conserva_las_9_secciones():
    prompt = _prompt("dame el informe completo de ventas")
    assert "FORMATO DE SALIDA: INFORME" in prompt
    assert "## Resumen Ejecutivo" in prompt
    assert "## Próximas Investigaciones" in prompt
    assert "FORMATO DE SALIDA: CORTO" not in prompt


def test_formatter_corto_no_reinyecta_el_bloque_entero():
    impact = [ImpactItem(label="Δ ventas", kind=HECHO, value=34, unit="ventas")]
    out = format_response("Vamos bien: +34 ventas.", [], ["ventas por sede"],
                          impact, live=True, formato="corto")
    assert "Impacto Económico" not in out["response"]
    assert "Próximas Investigaciones" not in out["response"]
    # la verdad del motor no se pierde: viaja en los campos JSON
    assert out["impact"] and "34" in out["impact"][0]
    assert out["related"] == ["ventas por sede"]


def test_formatter_informe_sigue_garantizando_las_secciones():
    impact = [ImpactItem(label="Δ ventas", kind=HECHO, value=34, unit="ventas")]
    out = format_response("## Resumen Ejecutivo\ntodo bien", [], ["ventas por sede"],
                          impact, live=True, formato="informe")
    assert "Impacto Económico" in out["response"]
    assert "Próximas Investigaciones" in out["response"]


if __name__ == "__main__":
    tests = [v for name, v in sorted(globals().items())
             if name.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL  {t.__name__}: {e}")
        except Exception as e:
            failed += 1
            print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
