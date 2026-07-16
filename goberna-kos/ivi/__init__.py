"""Ivi — Analytical Intelligence Engine for Goberna (Cerberus) sales.

Modular pipeline that turns a natural-language sales question into a
senior-BI-style analysis:

    Usuario
      -> IntentAnalyzer      (what does the user want?)
      -> DataPlanner        (which endpoints are needed?)
      -> DataCollector      (fetch + normalize + merge, cached)
      -> KPIEngine         (derive metrics from raw data)
      -> AnalyticsEngine    (variations, rolling, trend, ranking, anomalies)
      -> InsightEngine      (detect risks / opportunities)
      -> RecommendationEngine (prioritized actions)
      -> PromptBuilder      (analytical narrative skeleton)
      -> LLM (narrative)  (interpret / compare / explain / recommend)
      -> ResponseFormatter (parse + attach insights & related questions)

The LLM never does arithmetic. Every number is precomputed by the engines.
"""

from .config import BACKEND, OLLAMA_URL, MODEL, PORT

__all__ = ["BACKEND", "OLLAMA_URL", "MODEL", "PORT"]
