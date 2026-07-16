"""Entrypoint so the engine can run as `python3 -m ivi` or `python3 ivi/`."""
import ivi.server as _s

if __name__ == "__main__":
    _s.main()
