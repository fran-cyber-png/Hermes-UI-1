"""Un fallo del modelo no se sirve como si fuera un análisis.

Antes (bug encontrado en prod el 2026-07-16, docs/18): cuando Ollama no
contestaba, `handle_chat` atrapaba la excepción y devolvía HTTP **200** con el
texto "Error al llamar a Ollama: timed out" metido dentro de `response`, seguido
del bloque "## Impacto Económico" que `format_response` agrega igual. Resultado:
ningún monitoreo por status code veía la caída, y el usuario leía un error
pegado a media respuesta.

    pytest tests/test_error_honesto.py
"""

import json
import threading
import urllib.error
import urllib.request

import ivi.server as srv


def test_call_ollama_levanta_en_vez_de_devolver_el_error_como_texto():
    """El puerto 1 no escucha: call_ollama debe LEVANTAR, no devolver un string."""
    original = srv.OLLAMA_URL
    srv.OLLAMA_URL = "http://127.0.0.1:1/api/generate"
    try:
        srv.call_ollama("hola")
    except srv.OllamaError:
        pass  # lo que queremos
    except Exception as e:
        raise AssertionError(f"levantó {type(e).__name__}, se esperaba OllamaError") from e
    else:
        raise AssertionError("call_ollama devolvió normalmente con Ollama caído")
    finally:
        srv.OLLAMA_URL = original


def _servidor_con_chat(fake):
    """Levanta el Handler real en un puerto libre, con handle_chat stubbeado."""
    import socketserver
    original = srv.handle_chat
    srv.handle_chat = fake
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), srv.Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, httpd.server_address[1], original


def _post(port, msg="ventas"):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/chat",
        data=json.dumps({"message": msg}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def test_ollama_caido_devuelve_503_y_no_200():
    def explota(message, sid="default"):
        raise srv.OllamaError("timed out")

    httpd, port, original = _servidor_con_chat(explota)
    try:
        code, body = _post(port)
        assert code == 503, f"se esperaba 503 con Ollama caído, vino {code}"
        # El front hace data.response.replace(...): si falta el campo, revienta.
        assert body.get("response"), "el payload de error debe traer `response` legible"
        # Y no puede afirmar que trae datos en vivo: no hubo análisis.
        assert body.get("live") is False, "un fallo no puede marcarse como dato en vivo"
        # Lo que mató a la request tiene que quedar diagnosticable.
        assert "timed out" in body.get("error", "")
    finally:
        httpd.shutdown()
        httpd.server_close()
        srv.handle_chat = original


def test_error_inesperado_devuelve_500_y_no_200():
    def explota(message, sid="default"):
        raise ValueError("el motor se rompió")

    httpd, port, original = _servidor_con_chat(explota)
    try:
        code, body = _post(port)
        assert code == 500, f"se esperaba 500 ante un error del motor, vino {code}"
        assert body.get("response"), "el payload de error debe traer `response` legible"
        assert body.get("live") is False
    finally:
        httpd.shutdown()
        httpd.server_close()
        srv.handle_chat = original


def test_respuesta_buena_sigue_siendo_200():
    def responde(message, sid="default"):
        return {"response": "## Resumen\nok", "live": True,
                "insights": [], "related": [], "impact": []}

    httpd, port, original = _servidor_con_chat(responde)
    try:
        code, body = _post(port)
        assert code == 200, f"una respuesta buena debe seguir siendo 200, vino {code}"
        assert body["live"] is True
    finally:
        httpd.shutdown()
        httpd.server_close()
        srv.handle_chat = original
