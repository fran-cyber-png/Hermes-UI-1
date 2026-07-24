# Trabajar con Hermes en VPS1

> Para quien tiene cuenta en el servidor y va a tocar Hermes. Qué podés hacer, dónde, y qué conviene
> no hacer. Escrito el **2026-07-24**, cuando se le dio acceso completo a `andreecito`.

---

## Lo primero: hay DOS Hermes en la misma máquina

Confundirlos es el error caro, así que va primero.

| | **Producción** | **Staging** |
|---|---|---|
| Quién lo usa | **las vendedoras, ahora mismo** | nadie |
| Carpeta | `/srv/hermes` | `/srv/hermes-staging` |
| Servicio | `hermes` | `hermes-staging` |
| Puerto | `:4110` | `:4111` |
| Base | `hermes_db` · `:5438` | `hermes_staging_db` · `:5440` |
| WhatsApp | **el número real** — manda mensajes a personas | falso: no sale nada |
| URL | `https://hermes-api.goberna.us` | no existe, solo local |

**Regla simple: probá en staging.** Está para eso. Romperlo no le cuesta nada a nadie, y se arregla
solo en el próximo push a `main`.

```bash
ssh deploy@161.132.39.165        # si entrás como deploy
ssh andreecito@161.132.39.165    # tu cuenta
```

---

## Qué podés hacer

### Leer y editar el código

`/srv/hermes` y `/srv/hermes-staging` son del grupo `hermes`, y vos estás adentro. Podés editar
directo, sin `sudo`.

> **Pero pensalo dos veces antes de editar producción a mano.** Cualquier cambio sin commitear hace
> que el próximo despliegue **se frene** («/srv/hermes tiene cambios locales sin commitear») — a
> propósito, para que nadie descarte sin querer un parche de emergencia. Si tocás algo, avisá.
>
> El camino normal es rama → PR → CI verde → merge. Tenés push en el repo.

### Ver qué está pasando

```bash
sudo journalctl -fu hermes            # log de producción, en vivo
sudo journalctl -u hermes -n 100      # las últimas 100 líneas
sudo journalctl -fu hermes-staging    # lo mismo para staging

sudo systemctl status hermes
curl -s localhost:4110/health         # {"ok":true} si está sano
curl -s localhost:4111/health         # staging
```

### Entrar a la base

```bash
# producción — MIRÁ, no escribas
sudo docker exec -it hermes_db psql -U <usuario> -d <base>

# staging — acá sí, rompé tranquilo
sudo docker exec -it hermes_staging_db psql -U hermes_staging -d hermes_staging
```

El usuario y la base salen del `DATABASE_URL` en `/srv/hermes/server/.env`, que podés leer.

### Reiniciar los servicios

```bash
sudo systemctl restart hermes-staging   # sin consecuencias
sudo systemctl restart hermes           # ⚠️ leé abajo antes
```

**Reiniciar producción no es gratis.** Corta el SSE de todas las pantallas abiertas, obliga a
WhatsApp a reconectar y —lo que más molesta— **tira las sesiones de Cerberus**: cada vendedora
logueada se encuentra un *«la sesión de Cerberus expiró»* la próxima vez que abra el formulario de
venta, posiblemente con una venta a medio cargar.

Si podés esperar, esperá a que no sea horario de atención.

### Desplegar

**El camino normal es Actions**, no SSH: `Actions → Desplegar server (con restart) → Run workflow`,
escribiendo `reiniciar` para confirmar.

Por SSH corre exactamente la misma pieza (no es un atajo distinto, es el mismo script):

```bash
sudo hermes-deploy --dry-run    # qué haría y qué migraciones traería. Empezá SIEMPRE por acá
sudo hermes-deploy              # promueve origin/main
sudo hermes-deploy <sha>        # un commit concreto
sudo hermes-deploy --rollback   # volver al último que estuvo sano
```

El script respalda la base si hay migraciones, migra, construye, reinicia, espera `/health`, corre el
smoke funcional y **si algo falla revierte solo** y verifica que lo revertido esté sano. No tenés que
acordarte de los pasos.

---

## Cómo llega tu código a las vendedoras

```
tu rama → PR → CI (N1, N2, N2b)  →  merge a main
                                        │
                                        ├─ N3  se despliega solo a STAGING y corre el smoke
                                        ├─ N4  si NO tocaste server/: el front sale solo a prod
                                        └─ N5  si tocaste server/: espera que alguien apriete el botón
```

O sea: **si tu cambio es solo de front, llega solo.** Si toca `server/`, el resumen del run te lo
dice y queda esperando el despliegue con restart.

Detalle completo en `docs/despliegue-continuo.md`.

---

## Cosas que conviene saber antes de que te muerdan

**El schema no se toca con `db:push`.** Van migraciones versionadas: `npm run db:generate`, después
`goberna-journal-set-when`, y commitear `server/drizzle/` completo. Si te salteás el paso del `when`,
drizzle **saltea tu migración en silencio** y el deploy sale verde con la tabla sin crear. CI lo
atrapa. Todo en `docs/migraciones.md`.

**Nada de borrar o renombrar columnas en el mismo PR que las deja de usar.** CI lo rechaza. Va en dos
deploys — el porqué está en `docs/migraciones.md`.

**Los secretos se referencian, no se pegan.** Podés leer `/srv/hermes/server/.env`; no lo copies a un
chat, a un issue ni a un archivo del repo. CI falla si aparece un `.env` versionado.

**Nada de automatizar WhatsApp.** No hay envío masivo, ni auto-respuesta, ni warmup. Un envío es una
acción humana. Esto no es una preferencia técnica: es política de la casa.

**La sesión de WhatsApp es la credencial de la cuenta.** Vive en `/srv/hermes/server/.wa-sessions/`.
No la copies, no la muevas, no la commitees.

**`main` es producción.** No se pushea directo — hay un hook que lo bloquea.

---

## Cuando algo se rompe

| Síntoma | Qué hacer |
|---|---|
| El front se ve roto | `cd /srv/hermes && mv dist dist.roto && mv dist.anterior dist` — segundos, sin restart |
| El server no levanta | `sudo hermes-deploy --rollback` |
| «cambios locales sin commitear» | `git -C /srv/hermes status --short -uno && git -C /srv/hermes diff` — **mirá qué son antes de descartarlos** |
| Una migración «se aplicó» pero la tabla no está | Es el `when`. Ver `docs/migraciones.md` § «Cuando algo sale mal» |
| No sé si prod está viva | `curl -s https://hermes-api.goberna.us/health` |

Un despliegue fallido **abre un issue solo** con el estado del servidor y los logs. No hace falta que
lo reconstruyas de memoria.

---

## El resto de Hermes en producción: también es tuyo

No solo el servicio. Todo el borde de Hermes está en tu `sudo`:

```bash
# La unidad de systemd: cómo arranca, no solo arrancarlo
sudoedit /etc/systemd/system/hermes.service
sudo systemctl daemon-reload && sudo systemctl restart hermes

# nginx: el TLS de hermes-api.goberna.us y el proxy al 4110 (que no se expone).
# Acá viven el timeout del SSE y el client_max_body_size de los adjuntos.
sudoedit /etc/nginx/sites-available/hermes-api
sudo nginx -t              # ⚠️ SIEMPRE antes de recargar
sudo systemctl reload nginx

# El certificado
sudo certbot certificates
sudo certbot renew --dry-run --cert-name hermes-api.goberna.us

# El runner que ejecuta el pipeline: si se cuelga, no hay despliegue
sudo systemctl restart actions.runner.Goberna-Lab-hermes.vps1-hermes
```

> **`nginx -t` no es opcional.** `reload`/`restart` de nginx afectan a **todos** los sitios de VPS1,
> no solo a Hermes. Con la config rota, un `reload` falla sin consecuencias (nginx se queda con la
> anterior), pero un `restart` deja todo abajo. Verificá primero, siempre.

`sudoedit` en vez de abrir el archivo con `sudo vim`: edita una copia con tus permisos y la mueve de
vuelta al final, así tu editor —con los plugins que tenga— nunca corre como root.

## Lo que queda afuera

Los **otros productos** de VPS1: geovisor, certificaciones, assets, nexus, el correo. No es
desconfianza — es que un comando fuera de Hermes debería ser una decisión consciente y no un resbalón
de tab a las 2 AM.

La lista completa vive versionada en `deploy/vps1/sudoers-hermes-andreecito`. Si necesitás algo que
no está, se agrega ahí, en un PR — se lee y se revisa como cualquier otro cambio.

---

## Los cuatro documentos que valen la pena

| | |
|---|---|
| `CLAUDE.md` | el mapa rápido: stack, deploy, reglas |
| `docs/arquitectura.md` | cómo está hecho por dentro y qué está desconectado |
| `docs/despliegue-continuo.md` | cómo llega el código a las vendedoras |
| `docs/migraciones.md` | cómo cambiar el schema sin romper nada |

Y un aviso que ahorra horas: **este repo tiene dos mitades.** Conviven el CRM que se usa y el
dashboard de pauta del que salió, que está desconectado. Los comentarios de `server/src/index.ts`
describen la arquitectura vieja y **engañan**. Ver `docs/arquitectura.md` §2 antes de perseguir código
que nadie ejecuta.
