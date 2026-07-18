# Backend meta-escuela (Express + Drizzle) para deploy always-on en VPS1.
# Incluye devDeps a propósito: las tareas de operación (db:push con drizzle-kit,
# cerberus:ingestar/proyectar/hechos con tsx) corren dentro del contenedor.
FROM node:22-alpine
WORKDIR /app

# Deps primero (capa cacheable)
COPY package.json package-lock.json* ./
RUN npm install

# Código + build a dist/
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4100

# El reloj de pauta arranca PRENDIDO (refresca el gasto de Meta cada ~6h). El reloj del lazo y
# DECISIONES_MODO quedan en su default seguro (apagado/simulacion) — se activan por env a propósito.
CMD ["node", "dist/index.js"]
