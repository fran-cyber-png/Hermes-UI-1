"""Chunking semántico de markdown: parte por encabezados, empaqueta párrafos con solape, y
antepone el rastro de encabezados a cada fragmento (le da contexto al embedding).

Un chunk = {"texto": str, "headings": list[str], "posicion": int}. `texto` es lo que se embebe
y se guarda en rag.documentos.chunk; incluye el rastro de encabezados como prefijo de contexto.
"""

import re

from . import config

_H = re.compile(r"^(#{1,6})\s+(.*)$")
_FENCE = re.compile(r"^\s*(```|~~~)")  # apertura/cierre de bloque de código


def _secciones(md: str):
    """Parte el markdown en (rastro_de_encabezados, cuerpo). El rastro es la pila de H1..Hn
    vigente para ese cuerpo, así cada fragmento sabe 'dónde' está.

    Trackea bloques de código (```/~~~): un `# comentario` DENTRO de un fence NO es un encabezado
    — matchearlo sacaría el comentario del chunk, contaminaría el rastro y partiría el código."""
    pila: list[tuple[int, str]] = []  # (nivel, título)
    buffer: list[str] = []
    trail_actual: list[str] = []
    en_fence = False

    def rastro() -> list[str]:
        return [t for _, t in pila]

    for linea in md.splitlines():
        if _FENCE.match(linea):
            en_fence = not en_fence
            buffer.append(linea)
            continue
        m = None if en_fence else _H.match(linea)
        if m:
            # cierra el cuerpo acumulado bajo el rastro anterior
            if any(l.strip() for l in buffer):
                yield (list(trail_actual), "\n".join(buffer).strip())
            buffer = []
            nivel = len(m.group(1))
            titulo = m.group(2).strip()
            while pila and pila[-1][0] >= nivel:
                pila.pop()
            pila.append((nivel, titulo))
            trail_actual = rastro()
        else:
            buffer.append(linea)
    if any(l.strip() for l in buffer):
        yield (list(trail_actual), "\n".join(buffer).strip())


def _partir_largo(texto: str, tam: int, solape: int) -> list[str]:
    """Corta un bloque más grande que `tam` en trozos con solape, prefiriendo cortes en
    frontera de párrafo/oración/espacio para no partir palabras."""
    trozos: list[str] = []
    i, n = 0, len(texto)
    while i < n:
        fin = min(i + tam, n)
        if fin < n:
            ventana = texto[i:fin]
            corte = max(ventana.rfind("\n\n"), ventana.rfind(". "), ventana.rfind("\n"))
            if corte > tam * 0.5:  # solo si el corte no achica demasiado el trozo
                fin = i + corte + 1
        trozos.append(texto[i:fin].strip())
        if fin >= n:
            break
        i = max(fin - solape, i + 1)
    return [t for t in trozos if t]


def chunk_markdown(md: str) -> list[dict]:
    """Devuelve la lista de chunks de un documento markdown."""
    tam, solape, minimo = config.CHUNK_CHARS, config.CHUNK_OVERLAP, config.CHUNK_MIN
    salida: list[dict] = []
    pos = 0

    for headings, cuerpo in _secciones(md):
        prefijo = (" › ".join(headings) + "\n\n") if headings else ""
        # empaqueta párrafos hasta `tam`; los que se pasan solos, se sub-parten
        parrafos = [p.strip() for p in re.split(r"\n\s*\n", cuerpo) if p.strip()]
        acc = ""
        bloques: list[str] = []
        for p in parrafos:
            if len(p) > tam:
                if acc:
                    bloques.append(acc)
                    acc = ""
                bloques.extend(_partir_largo(p, tam, solape))
            elif len(acc) + len(p) + 2 <= tam:
                acc = (acc + "\n\n" + p) if acc else p
            else:
                if acc:
                    bloques.append(acc)
                # arranca el nuevo bloque con un solape del anterior (continuidad)
                cola = acc[-solape:] if acc else ""
                acc = ((cola + "\n\n") if cola else "") + p
        if acc:
            bloques.append(acc)

        for b in bloques:
            texto = (prefijo + b).strip()
            if len(texto) < minimo:
                continue
            salida.append({"texto": texto, "headings": headings, "posicion": pos})
            pos += 1
    return salida
