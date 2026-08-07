# Hermes

La mesa del vendedor: una sola pantalla donde se atiende todo lo que llega por Facebook, Instagram,
Messenger y WhatsApp — con la ficha del contacto al lado del chat.

Extraído de [meta-escuela](https://github.com/Goberna-Lab/meta-escuela) preservando su historia git
(ver `docs/adr/0001`). El concepto completo está en `docs/concepto.md`.

## Correr en local

```bash
docker compose up -d --wait      # Postgres (el event store)
cd server && npm install && npm run dev    # API en :4100
npm install && npm run dev:app            # Vite :5173 + la app de escritorio
```

`npm run dev` solo (sin `:app`) abre el front en el navegador: la bandeja funciona. `dev:app`
levanta la cáscara Tauri encima (`tauri dev` arranca Vite solo).

## Refrescar los datos

```bash
cd server && npm run ingest:interactions
```

La app avisa sola cuando la captura se atrasó — la barra de arriba se pone ámbar.
