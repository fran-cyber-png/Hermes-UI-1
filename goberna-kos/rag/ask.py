"""ask(pregunta, usuario) — el punto de entrada ÚNICO del cerebro de Ivi (primer corte).

Capa 1 (ROUTER): clasifica estructurada | semántica | mixta con señales DETERMINISTAS
  - señal estructurada: el scorer de 19 intents de Ivi (ivi.intent_analyzer) — las "herramientas
    actuales" del motor.
  - señal semántica: la mejor similitud de buscar_docs sobre pgvector.
Capa 2/3: consultar_bi (catálogo SDK governa.*, read-only, allowlist) + buscar_docs (pgvector).

Ley I: los NÚMEROS los calcula el backend/SDK (determinista) y se marcan HECHO con su fuente;
los docs son CONTEXTO citado; si no hay nada, SIN_EVIDENCIA. El LLM (si se configura) solo
REDACTA — nunca inventa ni recalcula. Dato sensible se resuelve local (todo local en este corte).

Uso:  python3 -m rag.ask "¿cuál es el ROAS por país?"
      python3 -m rag.ask "¿por qué Cerberus no ve Meta?"      # semántica
"""

import datetime
import json
import sys
import urllib.error
import urllib.request

from . import config
from .buscar import buscar_docs

try:
    from ivi import intent_analyzer  # el scorer canónico de intents del motor
    _HAY_INTENTS = True
except Exception:  # noqa: BLE001 — el RAG no debe caerse si el paquete ivi no está en el path
    _HAY_INTENTS = False

# ── Umbrales del router (tuneables). Calibrados al rango de bge-m3 (coseno ~0.45-0.65 relevante). ──
BI_MIN = 1.5    # score de intent que cuenta como "señal estructurada fuerte"
SEM_MIN = 0.50  # similitud top que cuenta como "señal semántica fuerte"
SEM_PISO = 0.42  # bajo esto, no hay evidencia documental que valga
TOOL_MIN = 1.0  # score mínimo del intent para INVOCAR su herramienta (evita HECHOs espurios)

# Mapa intent -> herramienta SDK con params por defecto SEGUROS (sin params requeridos que haya
# que adivinar). Es slot-filling-lite: el primer corte no llena fechas; la capa siguiente sí.
_INTENT_TOOL = {
    "atribucion": ("governa.atribucion.roasPorPais", {"rango": "90d"}),
    "roas":       ("governa.atribucion.roasPorPais", {"rango": "90d"}),
    "rendimiento":("governa.atribucion.roasPorPais", {"rango": "90d"}),
    "ventas":     ("governa.ventas.estados", {}),
    "comercial":  ("governa.ventas.estados", {}),
    "embudo":     ("governa.ventas.estados", {}),
    "lazo":       ("governa.lazo.estado", {}),
    "capi":       ("governa.lazo.estado", {}),
    "tesoreria":  ("governa.tesoreria.reloj", {}),
    "cartera":    ("governa.tesoreria.latencia", {}),
    "tendencia":  ("governa.historia.resumen", {}),
    "campanas":   ("governa.historia.resumen", {}),
}


def _http(method: str, url: str, payload: dict | None = None, timeout: int = 20) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        # El SDK devuelve el motivo real (entrada_invalida/fallo_ejecucion/...) en el cuerpo con
        # status 4xx/5xx; urlopen lo lanzaría. Lo leemos para no perder el diagnóstico.
        try:
            return json.loads(e.read().decode())
        except Exception:  # noqa: BLE001
            raise


_CATALOGO: set[str] | None = None


def catalogo_nombres() -> set[str]:
    """La ALLOWLIST del SDK. Se cachea SOLO si trae herramientas — un vacío (backend caído al
    arrancar) NO se cachea, así un blip transitorio no deja la ruta estructurada muda para siempre
    en un proceso de larga vida (ivi.service)."""
    global _CATALOGO
    if _CATALOGO:
        return _CATALOGO
    try:
        data = _http("GET", f"{config.BACKEND}/api/sdk/herramientas")
        nombres = set(data.get("herramientas", []))
    except Exception:  # noqa: BLE001
        return set()
    if nombres:
        _CATALOGO = nombres
    return nombres


def consultar_bi(herramienta: str, params: dict) -> dict:
    """Invoca una herramienta del catálogo SDK (read-only). Allowlist por construcción: si el
    nombre no está en el catálogo, no se llama."""
    if herramienta not in catalogo_nombres():
        return {"ok": False, "error": "no_permitida", "herramienta": herramienta}
    try:
        r = _http("POST", f"{config.BACKEND}/api/sdk/invocar/{herramienta}", params)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": "backend_no_disponible", "detalle": str(e)}
    if isinstance(r, dict) and r.get("ok"):
        return r
    # Fallo CON cuerpo del SDK: preservar el motivo real (no aplanar a "backend_no_disponible").
    motivo = (r.get("error") or r.get("motivo") or r.get("tipo") or r.get("detalle")) \
        if isinstance(r, dict) else None
    return {"ok": False, "error": motivo or "fallo_sdk", "sdk": r}


def _senal_estructurada(pregunta: str):
    if not _HAY_INTENTS:
        return None, 0.0
    ir = intent_analyzer.analyze(pregunta)
    score = max(ir.scores.values()) if ir.scores else 0.0
    return ir, score


_MESES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
          "septiembre", "setiembre", "octubre", "noviembre", "diciembre")

_MES_NUM = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
            "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11,
            "diciembre": 12}


def _mes_yyyymm(p: str) -> str | None:
    """Nombre de mes en la pregunta → 'YYYY-MM' de su ocurrencia MÁS RECIENTE (mes <= mes actual → año
    actual; si no, año anterior). Para enrutar 'por qué enero...' al mes correcto."""
    hoy = datetime.date.today()
    for nombre, num in _MES_NUM.items():
        if nombre in p:
            anio = hoy.year if num <= hoy.month else hoy.year - 1
            return f"{anio:04d}-{num:02d}"
    return None


# Nombres de país (normalizados sin acentos) — para detectar "¿quién factura más México o Perú?",
# donde no aparece la palabra "país" sino el nombre. Sin esto caía a retrieval semántico y respondía mal.
_PAISES = ("peru", "mexico", "ecuador", "bolivia", "colombia", "chile", "argentina", "paraguay",
           "uruguay", "venezuela", "guatemala", "honduras", "salvador", "nicaragua", "costa rica",
           "panama", "dominicana", "estados unidos", "eeuu", " usa", "espana", "brasil")


def _menciona_pais(p: str) -> bool:
    return "pais" in p or "paises" in p or any(x in p for x in _PAISES)


# Métricas que NO existen en los datos (hay ingresos, NO costos). Devolver honestidad, NUNCA un snippet
# de pauta como sustituto (era el fallo grave que el crítico marcó en "margen neto").
def _metrica_inexistente(p: str) -> str | None:
    p = _norm(p)
    if any(w in p for w in ("margen", "utilidad", "ganancia neta", "rentabilidad neta", "profit")):
        return ("El sistema tiene INGRESOS y ventas, pero NO tiene los COSTOS cargados, así que no se "
                "puede calcular margen ni utilidad neta. Puedo darte facturación, ticket y ROAS de pauta.")
    if "ltv" in p or "valor de vida" in p or "lifetime" in p or "valor del cliente" in p:
        return ("No tengo LTV calculado: haría falta modelar recompra y horizonte de vida del cliente, "
                "que no está en los datos. Sí tengo clientes nuevos, ticket promedio y facturación.")
    return None


def _pregunta_de_plata(p: str) -> bool:
    """¿Pide una CIFRA de negocio (facturación, ventas, ingresos, crecimiento, 'cuánto…')? Backstop: si
    es de plata y NINGÚN tool enganchó, es mejor ser honesto que arriesgar un número de un doc de pauta.
    Esto ataca la raíz que marcó el crítico: 'pasa gasto de pauta como facturación con grounding_ok=true'."""
    p = _norm(p)
    tiene_cuanto = any(w in p for w in ("cuanto", "cuantos", "cuantas"))
    verbo_num = any(w in p for w in ("factur", "ingreso", "vend", "recaud", "cobr", "gane", "ganamos",
                                     "cerr", "llevo", "hice", "vale", "cuesta", "recaud"))
    return (tiene_cuanto and verbo_num) or "facturacion" in p or "crecimiento" in p or "voy a cerrar" in p


def _norm(t: str) -> str:
    t = t.lower()
    for a, b in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"), ("ñ", "n")):
        t = t.replace(a, b)
    return t


def _tool_por_keywords(pregunta: str) -> tuple[str, dict] | None:
    """Slot-filling-lite por keywords, ANTES del mapa de intents. Enruta preguntas específicas a la
    tool correcta (p.ej. ventas por país por mes, que el intent 'ventas' mandaría a estados).
    Orden: de lo MÁS específico (producto, país×mes) a lo más general (pulso)."""
    p = _norm(pregunta)
    pais = _menciona_pais(p)
    temporal = ("mes" in p or "mensual" in p or " vs " in p or "compar" in p or "pasado" in p
                or "anterior" in p or any(m in p for m in _MESES))
    negocio = any(w in p for w in ("venta", "vendi", "vendimos", "facturac", "ingreso", "nos fue",
                                    "como va", "como nos", "como estamos", "rindi", "resultado",
                                    "negocio", "cerramos", "plata", "dolar", "factur"))

    # 0. EXPLICAR MES — "por qué enero fue el mejor mes", "qué pasó en enero", "a qué se debe el pico".
    #    Gate en una intención de CAUSA + un mes concreto (o "mejor/peor mes"), para no robar otras.
    if any(w in p for w in ("por que", "porque", "que paso", "que hubo", "a que se debe",
                            "explicame el mes", "a que se debio")) and \
       (_mes_yyyymm(p) or "mejor mes" in p or "peor mes" in p or "pico" in p):
        mm = _mes_yyyymm(p)
        return ("governa.ventas.explicarMes", {"mes": mm} if mm else {})

    # 0b. CLIENTES / ALUMNOS NUEVOS — "cuántos alumnos nuevos este mes".
    if ("nuevos" in p or "nuevas" in p or "nuevo" in p) and \
       any(w in p for w in ("alumno", "cliente", "estudiante", "matricul", "inscri", "gente")):
        return ("governa.ventas.clientesNuevos", {"meses": 6})

    # 0c. PAUTA POR CAMPAÑA — "en qué campaña gasto más", "qué campaña rinde" ('campaña'→'campana').
    if "campana" in p or "campanas" in p:
        return ("governa.pauta.porCampana", {"limite": 8})

    # 0d. SERIE MENSUAL / MEJOR MES — "cuál fue mi mejor mes", "tendencia mes a mes" (sin país).
    if not pais and any(w in p for w in ("mejor mes", "peor mes", "mes a mes", "tendencia mensual",
                                         "por mes", "cada mes", "mensualmente", "mes mas fuerte")):
        return ("governa.ventas.serieMensual", {"meses": 12})

    # 0e. FACTURACIÓN DEL AÑO — "¿cuánto facturé este año / en 2026 / acumulado?" (total determinista).
    #     `not pais`: "cuánto facturó ECUADOR este año" NO es serie mensual — va a porPais (abajo). Sin
    #     esto, el crítico vio que preguntas de país+año caían acá y Ivi negaba un dato que sí tiene.
    if negocio and not pais and any(w in p for w in ("este ano", "del ano", "en el ano", "por ano",
                                    "anual", "2026", "2025", "acumulado", "en total", "todo el ano",
                                    "en el 2026")):
        return ("governa.ventas.serieMensual", {"meses": 12})

    # 1. PRODUCTO — "qué producto vende más", "qué promocionar", "top de cursos/diplomas".
    producto = any(w in p for w in ("producto", "curso", "diploma", "programa"))
    if producto and any(w in p for w in ("vend", "promocion", "mas ", " mejor", "top", "ingreso",
                                          "factur", "rankea", "ranking", "cual", "que ")):
        return ("governa.ventas.porProducto", {"dias": 90, "limite": 8})

    # 2. VENTAS POR PAÍS × MES — "cómo nos fue por país ESTE MES vs el pasado" (comparación de meses).
    if pais and temporal and negocio:
        return ("governa.ventas.porPaisMes", {"meses": 3})

    # 2a. TICKET POR PAÍS — "qué país deja el ticket más alto" → porPais (agregado histórico con guarda
    #     de n mínimo), NO porPaisMes (que daría la celda país×mes: un outlier de 4 ventas → $359 vs $146).
    if "ticket" in p and pais:
        return ("governa.ventas.porPais", {"rango": "todo"})

    # 2a-bis. QUIÉN FACTURA MÁS / FACTURACIÓN POR PAÍS (sin comparar meses) — "¿quién factura más, México
    #     o Perú?", "qué país vende/factura más". Determinista: NUNCA por retrieval semántico (confundía
    #     facturación con GASTO de pauta y respondía al revés, según verificó el crítico).
    if pais and negocio:
        return ("governa.ventas.porPais", {"rango": "anio"})

    # 2b. TICKET PROMEDIO (global) — "cuál es mi ticket promedio" (el pulso trae el ticket real del
    #     mes, en vez del benchmark congelado de los docs).
    if "ticket" in p or "valor promedio" in p or "promedio de venta" in p or "promedio por venta" in p:
        return ("governa.ventas.pulso", {})

    # 2c. PIPELINE / POR COBRAR — ventas en proceso (registradas, aún no cobradas).
    if any(w in p for w in ("en proceso", "sin cobrar", "sin confirmar", "por confirmar", "pipeline",
                            "pendiente de cobro", "pendientes de cobro", "por cobrar")):
        return ("governa.ventas.pipeline", {})

    # 3. PULSO DEL NEGOCIO — la pregunta-paraguas del dueño: "cómo va el negocio / resumime cómo
    #    estamos / panorama general / cómo vamos este mes" (sin desglose por país).
    pulso = any(w in p for w in ("resum", "como estamos", "como vamos", "como va el negocio",
                                 "como va todo", "como venimos", "parados", "pulso", "panorama",
                                 "vista general", "situacion general", "estado del negocio",
                                 "en general", "como viene", "como va el mes", "vamos bien",
                                 "vamos mal", "estamos bien", "estamos mal", "como cerramos",
                                 "voy a cerrar", "vamos a cerrar", "que tal el mes", "como venimos"))
    if pulso and not pais:
        return ("governa.ventas.pulso", {})
    # "cómo va el negocio este mes" / "cómo vamos este mes" (negocio + temporal, sin país ni desglose)
    if negocio and temporal and not pais and ("mes" in p):
        return ("governa.ventas.pulso", {})

    return None


def _elegir_tool(ir, pregunta: str = "") -> tuple[str, dict] | None:
    """Keywords específicos primero (ventas por país×mes, etc.); si no, el intent mejor rankeado que
    (a) tiene herramienta mapeada y (b) supera TOOL_MIN — el gate de score evita invocar una tool BI
    por un intent secundario débil y presentar cifras como HECHO confiadamente equivocado."""
    kw = _tool_por_keywords(pregunta)
    if kw:
        return kw
    if ir is None:
        return None
    for intent in ir.intents:  # ranked
        if intent in _INTENT_TOOL and ir.scores.get(intent, 0) >= TOOL_MIN:
            return _INTENT_TOOL[intent]
    return None


def _rutar(bi_score: float, sem_top: float) -> str:
    fuerte_bi = bi_score >= BI_MIN
    fuerte_sem = sem_top >= SEM_MIN
    if fuerte_bi and fuerte_sem:
        return "mixta"
    if fuerte_bi:
        return "estructurada"
    if fuerte_sem:
        return "semantica"
    # Ninguna señal fuerte: preferí docs si hay algo. NUNCA rutees a estructurada con señal débil —
    # invocaría una herramienta BI y devolvería cifras como HECHO sin fundamento. Sin doc → nada.
    return "semantica" if sem_top >= SEM_PISO else "sin_evidencia"


def ask(pregunta: str, usuario: str | None = None, *, k: int = 5,
        incluir_sensibles: bool = True) -> dict:
    """El cerebro: rutea, junta evidencia, y devuelve un resultado tipado y CITADO."""
    # Métricas que NO existen en los datos (margen, LTV): cortar ANTES del retrieval, para no engancharse
    # a un snippet de pauta y contestar otra cosa con seguridad. Honestidad directa, sin docs.
    inexistente = _metrica_inexistente(pregunta)
    if inexistente:
        return {
            "pregunta": pregunta, "usuario": usuario, "modo": "sin_evidencia",
            "router": {"bi_score": 0.0, "intent": None, "sem_top": 0.0},
            "evidencia": [{"tipo": "SIN_EVIDENCIA", "fuente": None, "motivo": inexistente}],
            "fuentes": [], "tipo": "SIN_EVIDENCIA",
        }
    ir, bi_score = _senal_estructurada(pregunta)
    docs = buscar_docs(pregunta, k, incluir_sensibles=incluir_sensibles)
    # sem_top = mejor similitud COSENO disponible (las filas solo-texto del hybrid no la tienen)
    sem_top = max([d.get("similitud") or 0.0 for d in docs], default=0.0)
    modo = _rutar(bi_score, sem_top)
    # Si hay una tool específica por keywords (p.ej. ventas por país×mes, "por qué enero"), es una
    # pregunta de datos sí o sí → forzar la ruta estructurada aunque ni el scorer de intents ni la
    # búsqueda semántica hayan prendido. OJO: cubrir también 'sin_evidencia' — preguntas como "por qué
    # enero fue el mejor mes" no tienen doc que las respalde (sem_top < PISO) y caían en SIN_EVIDENCIA
    # con la tool sin llamar; se van a 'estructurada' (tool sola, sin docs ruidosos de baja similitud).
    if _tool_por_keywords(pregunta):
        if modo == "semantica":
            modo = "mixta"
        elif modo == "sin_evidencia":
            modo = "estructurada"

    evidencia: list[dict] = []
    fuentes: list[str] = []

    # ── Ruta estructurada: consultar_bi (números = HECHO) ──
    if modo in ("estructurada", "mixta"):
        elegido = _elegir_tool(ir, pregunta)
        if elegido:
            nombre, params = elegido
            r = consultar_bi(nombre, params)
            if r.get("ok"):
                evidencia.append({"tipo": "HECHO", "fuente": f"SDK:{nombre}",
                                  "sensible": True, "salida": r.get("salida")})
                fuentes.append(f"SDK:{nombre}")
            else:
                evidencia.append({"tipo": "SIN_EVIDENCIA", "fuente": f"SDK:{nombre}",
                                  "motivo": r.get("error", "desconocido")})
        elif modo == "estructurada":
            evidencia.append({"tipo": "SIN_EVIDENCIA", "fuente": "SDK",
                              "motivo": "no hay herramienta parametrizada para esta pregunta"})

    # ── Ruta semántica: buscar_docs (docs = CONTEXTO citado) ──
    if modo in ("semantica", "mixta") and docs:
        for d in docs:
            evidencia.append({"tipo": "CONTEXTO", "fuente": d["cita"],
                              "sensible": d["sensible"],
                              "similitud": round(d["similitud"], 3) if d.get("similitud") is not None else None,
                              "rrf": d.get("rrf"), "extracto": d["chunk"][:400]})
            if d["cita"] not in fuentes:
                fuentes.append(d["cita"])

    # ── BACKSTOP LEY I: pregunta de PLATA sin HECHO ──
    # El crítico probó que, al reformular, las preguntas de facturación caen a la ruta semántica y el
    # redactor contesta con NÚMEROS de un doc de pauta (gasto 6.001/4.087) como si fueran facturación,
    # con grounding_ok=true. La cura de raíz: si es una pregunta de cifras de negocio y NINGÚN tool
    # entregó un HECHO, se DESCARTA la evidencia documental (sus números no responden la pregunta) y se
    # corta a honesto. Preferimos "pedímelo más preciso" antes que un número confiado y equivocado.
    if _pregunta_de_plata(pregunta) and not any(e["tipo"] == "HECHO" for e in evidencia):
        evidencia = [{"tipo": "SIN_EVIDENCIA", "fuente": None,
                      "motivo": ("Es una pregunta de cifras de negocio y ningún tool exacto la cubrió. "
                                 "NO uses números de documentos de pauta para responderla. Pedí que la "
                                 "reformule (p.ej. 'facturación por país', 'cuánto facturé este año', "
                                 "'pulso del mes') para dar el número real.")}]
        fuentes = []
        modo = "sin_evidencia"

    if not evidencia or modo == "sin_evidencia":
        if not any(e["tipo"] == "SIN_EVIDENCIA" for e in evidencia):
            evidencia.append({"tipo": "SIN_EVIDENCIA", "fuente": None,
                              "motivo": "ni señal estructurada ni documental suficiente"})

    return {
        "pregunta": pregunta,
        "usuario": usuario,
        "modo": modo,
        "router": {"bi_score": round(bi_score, 2),
                   "intent": ir.dominant() if ir else None,
                   "sem_top": round(sem_top, 3)},
        "evidencia": evidencia,
        "fuentes": fuentes,
        # Ley I: el tipo global de la respuesta. HECHO si hubo número; CONTEXTO si solo docs.
        "tipo": next((e["tipo"] for e in evidencia if e["tipo"] == "HECHO"),
                     "CONTEXTO" if any(e["tipo"] == "CONTEXTO" for e in evidencia) else "SIN_EVIDENCIA"),
    }


def _cli(argv: list[str]) -> int:
    if not argv:
        print('uso: python3 -m rag.ask "tu pregunta"')
        return 2
    res = ask(argv[0])
    r = res["router"]
    print(f"\n▶ modo: {res['modo'].upper()}  (bi={r['bi_score']} intent={r['intent']} sem={r['sem_top']})")
    print(f"  tipo global: {res['tipo']}")
    for e in res["evidencia"]:
        if e["tipo"] == "HECHO":
            sal = json.dumps(e["salida"], ensure_ascii=False)
            print(f"  · HECHO [{e['fuente']}]: {sal[:300]}{'…' if len(sal) > 300 else ''}")
        elif e["tipo"] == "CONTEXTO":
            print(f"  · CONTEXTO [{e['similitud']}] {e['fuente']}")
            print(f"      {e['extracto'][:160].strip().replace(chr(10),' ')}…")
        else:
            print(f"  · SIN_EVIDENCIA [{e.get('fuente')}]: {e.get('motivo')}")
    return 0


if __name__ == "__main__":
    sys.exit(_cli(sys.argv[1:]))
