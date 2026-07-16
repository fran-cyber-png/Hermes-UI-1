"""Runner del harness — sin pytest (no está instalado ni acá ni en geógrafo).

Corre todos los tests/test_*.py en un solo proceso:

    python3 tests/run.py

Existe porque los archivos del harness son funciones `test_*` planas: casi
todos traen su propio bloque __main__, pero el runner es la corrida canónica
(resuelve sys.path para los que no lo hacen, y da un total único).
"""

import importlib.util
import os
import sys
import traceback

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


def main() -> int:
    carpeta = os.path.join(ROOT, "tests")
    archivos = sorted(f for f in os.listdir(carpeta)
                      if f.startswith("test_") and f.endswith(".py"))
    total = passed = 0
    fallas = []
    for archivo in archivos:
        ruta = os.path.join(carpeta, archivo)
        spec = importlib.util.spec_from_file_location(archivo[:-3], ruta)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception:
            print(f"── {archivo}: ERROR al importar")
            traceback.print_exc()
            fallas.append(f"{archivo} (import)")
            continue
        tests = [v for k, v in sorted(vars(mod).items())
                 if k.startswith("test_") and callable(v)]
        print(f"── {archivo}")
        for t in tests:
            total += 1
            try:
                t()
                passed += 1
                print(f"  PASS  {t.__name__}")
            except AssertionError as e:
                print(f"  FAIL  {t.__name__}: {e}")
                fallas.append(f"{archivo}::{t.__name__}")
            except Exception as e:
                print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
                fallas.append(f"{archivo}::{t.__name__}")
    print(f"\n{passed}/{total} passed"
          + (f" — fallas: {', '.join(fallas)}" if fallas else ""))
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.exit(main())
