# ADR 0063 — Hermes son DOS módulos de CRM: ventas y campañas

**Fecha**: 19-ago-2026 · **Estado**: aceptada (fase 1 implementada) ·
**Amplía**: ADR 0061 · **Enmienda**: la decisión del 13-ago sobre «un producto, N instancias»
**Medición que la origina**: `docs/auditoria-frontera-campana-escuela.md`

## Qué se decidió

Decisión del dueño: **Hermes maneja los dos negocios, con entornos separados adentro**, y son
**dos módulos de CRM**:

- **`ventas`** — hoy la Escuela de Goberna, con Cerberus como verdad. Mañana, otros clientes.
- **`campana`** — hoy la candidatura de Betto. Mañana, otras campañas.

Ninguno es la excepción del otro. ADR 0061 trató a la campaña como una excepción de la Escuela
—una línea con `proposito = 'campana'` y cuatro superficies que su operador no tiene— y eso
alcanzaba con un solo candidato. Con N clientes de cada lado, «lo normal» tiene que pasar a ser
**un módulo con nombre**, para que una ruta nueva tenga que decidir a cuál pertenece en vez de
heredar la Escuela por no decir nada.

## Por qué hacía falta

ADR 0061 cerró **una** dirección: la línea de campaña ya no se le sirve a nadie de la Escuela. La
contraria estaba abierta, y medida contra producción (`febf7b8`) el 19-ago-2026:

- **Once rutas** servían Cerberus o icarus a cualquier token de vendedora, campaña incluida: la
  ficha con documento y compras, el formulario que **escribe** una venta en el ERP, el catálogo de
  productos, los argumentos de venta, el lazo de piezas, el cerebro RAG del negocio.
- 🔴 **Y el rol cruzaba los dos planos.** `centurion:betto.romero` está cargado como **admin** y
  `centurion:angie` como **supervisor** en la misma tabla `equipo` que la Escuela, y `cargarRol`
  resuelve por `persona_id` y nada más. Con eso `mandaEnElEquipo` les abría el padrón de **73.091**
  contactos de icarus (71.516 con teléfono, 61.471 con correo) —y `POST /habilitar-recorte` para
  **repartirlos**—, la facturación por curso y las campañas por plantilla.

La asimetría es el argumento: la campaña aporta **240 de 15.898** conversaciones (1,5 %) y el plano
al que accedía concentra el padrón, la facturación y el playbook de venta de Goberna.

## Cómo se implementó (fase 1)

`server/src/modulos/`:

- **`modulo.ts`** — el tipo `Modulo`, `moduloDe(lineas)` y `SUPERFICIES`, el mapa
  `prefijo → módulo` con las dieciséis superficies de `ventas`.
- **`deEsteModulo.ts`** — el middleware, que generaliza `numeros/soloEscuela.ts` (borrado). El
  mismo sirve a los dos lados: lo que cambia es el módulo con el que se construye.

Front: `PanelDerecho` recibe `esDeCampana` y **apaga las consultas**, no sólo el dibujo; la vista
**Contactos** sale del riel; `estadoDelContacto` gana una rama honesta (`sinCerberus`).

### Las decisiones que tienen filo

- 🔴 **El default del mapa es «compartido», al revés de un perímetro.** El motor de Hermes —la
  cola, el hilo, el envío, el reparto, los ✓✓, la agenda, el tiempo real— sirve igual a los dos
  módulos, y son las más. Lo que compensa ese default es el **barrido del árbol**: un test cruza
  cada router contra sus `import` de `cerberus/` e icarus y se pone rojo si aparece uno sin
  declarar. Vigila lo que todavía no se decidió, que es como nacieron las once.
- 🔴 **`moduloDe` sale de las LÍNEAS, no del namespace de la identidad.** Hoy los datos coinciden
  al 100 % (17 identidades `centurion:*` y ninguna de Cerberus atienden la campaña), pero hasta el
  15-ago la atendía `usuario2`, que es de Cerberus. Un segundo criterio que hoy da lo mismo decide
  distinto mañana sin que nada falle (#37).
- 🔴 **Fail-closed en el middleware, no en `moduloDe`.** Esa función tiene un default (`ventas`)
  que existe para la vendedora sin líneas; ante un error de lectura el middleware **no la llama**:
  contesta 500 y no deja pasar. Confundir los dos casos es cómo un fail-closed se vuelve fail-open
  sin que cambie una línea.
- ⚠️ **Dos subrutas, y van montadas ANTES que su router padre.** `/api/gestiones/intereses` y
  `/api/dashboard/negocio`: el resto de esos routers es CRM genérico. `app.use` matchea en orden,
  así que el padre montado primero atiende la subruta y el candado no corre nunca — sin error y sin
  log. Hay test.

## Lo que esto NO resuelve, y hay que decirlo

- 🔴 **NO aísla una campaña de OTRA campaña.** Separa `ventas` de `campana`; dos candidatos rivales
  caerían los dos en `campana` y se verían entre sí. Ese recorte es por **entorno** y va en el
  `WHERE` de las consultas compartidas. **Es la fase 3.**
- 🔴 **El rol sigue cruzando los planos.** Las once rutas quedaron cerradas por superficie, así que
  el agujero grande está tapado — pero `mandaEnElEquipo` le sigue diciendo `true` a un admin de
  campaña. **Es la fase 2**, y hay que hacerla igual: mientras el rol no conozca el módulo, la
  próxima ruta de supervisor nace abierta.
- ⚠️ **`eventos.ts` es residuo conocido**: `POST /` consulta el catálogo de Cerberus si el evento
  trae `curso`. No se veda el router entero porque el timeline es genérico. Se cierra con el
  vocabulario de campaña.
- **El embudo sigue siendo el de ventas.** Deriva sus etapas de haber mandado un precio y de que
  exista una venta en Cerberus (ADR 0044), dos hechos que del lado de campaña no ocurren nunca.

🔴 **Y el embudo de campaña no se va a poder DERIVAR como el de la Escuela** — invierte la regla de
ADR 0044. Allá funciona porque el comprador deja huellas verificables: un precio enviado, una venta.
Un votante no deja ninguna; que alguien «se comprometió» sólo lo puede afirmar quien habló con él.
Es un embudo **declarado**, y esa asimetría es la decisión de diseño de la fase siguiente.

## El costo que se acepta

La decisión de un solo Hermes con entornos adentro **convierte el aislamiento en un `WHERE`**,
cuando la decisión del 13-ago lo había puesto en instancias separadas justamente porque dos
candidatos pueden ser rivales. Es viable y es lo decidido; lo que cambia es dónde vive la garantía:
en que ninguna consulta se olvide del recorte. Por eso la forma tiene que ser **un seam único con
gemelo SQL, test de paridad y un candado que rompa el arranque** si una ruta nueva no declara nada
— nunca parchear ruta por ruta, que es como se llegó a las 82 fugas de la auditoría del 17-ago.
