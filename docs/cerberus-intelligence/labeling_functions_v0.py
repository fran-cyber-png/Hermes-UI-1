"""Labeling functions v0 — weak supervision para el corpus de Goberna.

⚠️ LEER PRIMERO. Estas funciones NO son un clasificador. Son fuentes de
etiqueta débiles y deliberadamente parciales: cada una vota o se ABSTIENE, y
el agregado se resuelve después (ver `evaluation_plan.md` §4).

**La decisión que ordena este archivo**: el 68 % de los entrantes vivos de
WhatsApp no tiene intención que inferir — es texto que Meta prellena en el
anuncio, un saludo, o un adjunto sin texto (medido el 11-ago-2026 sobre 3.219
entrantes: 845 sin texto + 817 prellenados + 516 saludos cortos). Por eso las
funciones de PROCEDENCIA corren PRIMERO y son determinísticas. Lo que llega al
clasificador es el resto.

Cobertura y precisión esperada de cada LF están declaradas en su docstring y
se re-miden contra el conjunto dorado; los números de acá son los MEDIDOS al
escribirlas, no aspiraciones.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Optional

ABSTAIN: None = None


# ─────────────────────────────────────────────────────────────────────────────
# 0. PROCEDENCIA — determinística, corre antes que todo lo demás
# ─────────────────────────────────────────────────────────────────────────────
# No es una intención: es de dónde salió el texto. Confundirlas es el error
# que ya cometió el chip «Piden info» de Hermes, que contaba como pregunta el
# texto que escribe Meta (`cola/urgenciaSql.ts`, PIDE_INFO_REGEX_SQL).

# Medido en prod: 568 apariciones idénticas de la primera, 152 de la segunda.
PRELLENADO_ANUNCIO = re.compile(
    r"^\s*(¡?hola[.,!]?\s*)?("
    r"quiero m[áa]s informaci[óo]n"
    r"|me gustar[íi]a conseguir m[áa]s informaci[óo]n"
    r"|¿?puedo obtener m[áa]s informaci[óo]n"
    r"|quiero m[áa]s detalles"
    r"|estoy interesado en uno de sus"
    r"|quiero chatear con alguien"
    r")",
    re.I,
)

# Botones del árbol viejo de Messenger. El emoji inicial es la marca fiable.
PAYLOAD_DE_BOTON = re.compile(
    r"^\s*("
    r"empezar|desuscribirme|recibir (notificaciones|actualizaciones)"
    r"|volver al men[úu]|contactar un asesor"
    r"|[^\x00-\x7F¿¡áéíóúñÁÉÍÓÚÑüÜ]\s*\w"          # arranca con emoji
    r")",
    re.I,
)

VOLCADO_DE_FORMULARIO = re.compile(r"Country:\s*\w+.*Full name:", re.S)

SISTEMA_META = re.compile(
    r"(Facebook cre[óo] este chat|Ver comentario\(|respondi[óo] un comentario)", re.I
)

# 134 de 3.200 mensajes libres recientes (4,2 %) son phishing suplantando a Meta.
RUIDO_PHISHING = re.compile(
    r"(soy del equipo de soporte de Facebook"
    r"|su p[áa]gina .{0,40}(eliminad|desactivad)"
    r"|derechos de autor.{0,60}(24|48) horas"
    r"|confirme aqu[íi]"
    r"|Sup-?Team)",
    re.I,
)


# ─────────────────────────────────────────────────────────────────────────────
# 1. ENTIDADES — extracción, no clasificación
# ─────────────────────────────────────────────────────────────────────────────

TELEFONO = re.compile(r"(?<!\d)(\+?\d[\d ()\-.]{7,17}\d)(?!\d)")
CORREO = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

# Emergió del clustering de WhatsApp (cluster 0, n=34): la persona se presenta
# como candidato. Es el puente al OTRO negocio de Goberna (Centurión), y hoy
# ninguna pantalla lo captura.
CARGO_POLITICO = re.compile(
    r"\b(alcald[ea]|regidor|gobernador|congresista|candidat[oa]|consejer[oa]"
    r"|teniente alcalde|presidente regional)\b",
    re.I,
)
PARTIDO = re.compile(
    r"\b(partido (pol[íi]tico )?[\w áéíóúñ]{3,30}|podemos per[úu]|fuerza popular"
    r"|per[úu] primero|alianza para el progreso|acci[óo]n popular)\b",
    re.I,
)


# ─────────────────────────────────────────────────────────────────────────────
# 2. LABELING FUNCTIONS de acción
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class LF:
    nombre: str
    etiqueta: str
    fn: Callable[[str], Optional[str]]
    cobertura_medida: str
    precision_esperada: str
    conflictos_conocidos: str


def _lf(nombre, etiqueta, cobertura, precision, conflictos):
    def deco(fn):
        return LF(nombre, etiqueta, fn, cobertura, precision, conflictos)
    return deco


@_lf("lf_entrega_contacto", "entrega_contacto",
     cobertura="MEDIDA: 27,2 % del texto libre de Messenger · 0,7 % del de WhatsApp",
     precision="alta si el mensaje es CORTO; baja si es largo (el número puede ser incidental)",
     conflictos="soporte_postventa — una queja también puede traer el número")
def lf_entrega_contacto(t: str) -> Optional[str]:
    """La acción más frecuente del canal Messenger: pasar el contacto para
    seguir en WhatsApp. No es una intención de compra — es un cambio de canal.
    Se exige mensaje corto para no marcar cualquier texto que mencione un número.
    """
    if not t:
        return ABSTAIN
    tiene = TELEFONO.search(t) or CORREO.search(t)
    if tiene and len(t) <= 120:
        return "entrega_contacto"
    return ABSTAIN


@_lf("lf_pide_precio", "pide_precio",
     cobertura="MEDIDA: 9,4 % del texto libre de Messenger · 4,6 % del de WhatsApp",
     precision="alta — el vocabulario de precio es poco ambiguo en español",
     conflictos="pregunta_proceso_pago — «cómo pago» no es «cuánto cuesta»")
def lf_pide_precio(t: str) -> Optional[str]:
    """⚠️ NO reimplementar: Hermes ya tiene el criterio de precio en
    `server/src/cola/precio.ts` y `senales/cotizacion.ts`. Esta LF debe
    IMPORTARLO cuando se conecte, no mantener una segunda redacción (#37).
    """
    if not t:
        return ABSTAIN
    if re.search(r"\b(precio|costo|cu[áa]nto (cuesta|sale|vale|es)|valor|tarifa"
                 r"|cu[áa]l es el (precio|costo))\b", t, re.I):
        return "pide_precio"
    return ABSTAIN


@_lf("lf_pide_info_generica", "pide_info_generica",
     cobertura="MEDIDA: 11,7 % del texto libre de Messenger · 3,9 % del de WhatsApp",
     precision="media — es la clase basurero, se solapa con todo",
     conflictos="pide_info_producto — si nombra el producto, gana el otro")
def lf_pide_info_generica(t: str) -> Optional[str]:
    """«Información por favor» sin nada más. Es una clase real y grande, y su
    valor de negocio es justamente que NO dice qué quiere: obliga a preguntar.
    """
    if not t:
        return ABSTAIN
    if re.search(r"\b(informaci[óo]n|informes|info)\b", t, re.I) and len(t) < 90:
        return "pide_info_generica"
    return ABSTAIN


@_lf("lf_soporte_postventa", "soporte_postventa",
     cobertura="MEDIDA: 0,3 % Messenger · 0,9 % WhatsApp — baja, y la de mayor costo si se ignora",
     precision="alta — el vocabulario es específico",
     conflictos="ninguno relevante")
def lf_soporte_postventa(t: str) -> Optional[str]:
    """Ya compró y algo no funciona: no entra al campus, no llegó el diploma,
    perdió el acceso. Hoy cae en la misma cola que un lead frío y compite con
    él por atención, cuando es una persona que YA pagó.
    """
    if not t:
        return ABSTAIN
    if re.search(r"\b(no me (lleg[óo]|deja)|no puedo (entrar|ingresar|acceder|conectar)"
                 r"|perd[íi] (el )?acceso|usuario no v[áa]lido|mi (diploma|certificado)"
                 r"|ya (compr[ée]|pagu[ée]|hice el pago)|reclamo)\b", t, re.I):
        return "soporte_postventa"
    return ABSTAIN


@_lf("lf_rechazo_o_aplazamiento", "rechazo_o_aplazamiento",
     cobertura="MEDIDA: 0,2 % Messenger · 1,5 % WhatsApp (el informe del negocio dice que el aplazamiento es la objeción #1, 13 %: la brecha es la deuda)",
     precision="alta — Hermes ya tiene las tres formas de decir que no",
     conflictos="ninguno; es terminal")
def lf_rechazo_o_aplazamiento(t: str) -> Optional[str]:
    """⚠️ NO reimplementar: `server/src/autorespuesta/rechazo.ts` ya lo resuelve
    y su test prohíbe que «gracias» a secas cuente como despedida. Importarlo.
    """
    if not t:
        return ABSTAIN
    if re.search(r"\b(ya no (estoy interesad|me interesa)|por ahora no|m[áa]s adelante"
                 r"|este mes no|no puedo (ahora|este)|lo tendr[ée] (en cuenta|presente)"
                 r"|no gracias)\b", t, re.I):
        return "rechazo_o_aplazamiento"
    return ABSTAIN


@_lf("lf_ruido_no_lead", "ruido_no_lead",
     cobertura="MEDIDA: 0,1 % sobre el corpus deduplicado — pero 4,2 % del texto libre RECIENTE sin deduplicar; el phishing es repetitivo y el filtro rep<20 lo esconde",
     precision="muy alta — el phishing tiene firma léxica propia",
     conflictos="ninguno")
def lf_ruido_no_lead(t: str) -> Optional[str]:
    """No es un lead: es phishing suplantando a Meta, spam de terceros, o un
    mensaje en otro idioma dirigido al administrador de la página.
    """
    if t and RUIDO_PHISHING.search(t):
        return "ruido_no_lead"
    return ABSTAIN


LFS_ACCION = [
    lf_ruido_no_lead,            # primero: si es ruido, nada más importa
    lf_soporte_postventa,        # antes que precio: «ya pagué» no es «cuánto cuesta»
    lf_rechazo_o_aplazamiento,
    lf_entrega_contacto,
    lf_pide_precio,
    lf_pide_info_generica,
]


# ─────────────────────────────────────────────────────────────────────────────
# 3. LA COMPUERTA — lo que hace barato todo lo demás
# ─────────────────────────────────────────────────────────────────────────────

def procedencia(texto: Optional[str]) -> str:
    """Determinística y PRIMERA. Devuelve de dónde salió el texto.

    Sobre los entrantes vivos de WhatsApp esto sólo deja pasar ~21 % al
    clasificador. Es la diferencia entre un sistema que razona sobre 683
    mensajes por semana y uno que razona sobre 3.219.
    """
    if texto is None or not texto.strip():
        return "sin_texto"                       # 26,3 % — audio/imagen
    if SISTEMA_META.search(texto):
        return "sistema_meta"
    if VOLCADO_DE_FORMULARIO.search(texto):
        return "volcado_de_formulario"
    if PRELLENADO_ANUNCIO.match(texto):
        return "prellenado_anuncio"              # 25,4 % — lo escribe Meta
    if PAYLOAD_DE_BOTON.match(texto):
        return "payload_de_boton"
    if len(texto.strip()) <= 12:
        return "cortesia_o_acuse"                # 16,0 %
    return "humano_libre"                        # ~21 % — lo único a clasificar


def etiquetar(texto: Optional[str]) -> dict:
    """Punto de entrada. Devuelve procedencia, votos y entidades.

    NO devuelve una etiqueta final: la resolución de votos y el umbral de
    confianza viven fuera, porque son la parte que hay que poder cambiar sin
    tocar las reglas.
    """
    proc = procedencia(texto)
    salida = {"procedencia": proc, "votos": {}, "entidades": {}}
    if proc != "humano_libre":
        # No se le pregunta la intención a un texto que no escribió la persona.
        return salida

    for lf in LFS_ACCION:
        v = lf.fn(texto)
        if v is not ABSTAIN:
            salida["votos"][lf.nombre] = v

    ents = {}
    if m := TELEFONO.search(texto or ""):
        ents["telefono"] = m.group(1)
    if m := CORREO.search(texto or ""):
        ents["correo"] = m.group(0)
    if m := CARGO_POLITICO.search(texto or ""):
        ents["cargo_politico"] = m.group(0)
    if m := PARTIDO.search(texto or ""):
        ents["partido"] = m.group(0)
    salida["entidades"] = ents
    return salida
