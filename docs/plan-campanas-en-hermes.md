# Campañas en Hermes — dónde va y cómo va

> Plan del 5-ago-2026. Sale de enfrentar tres diseños rivales contra jueces adversarios
> (reglas de la casa · la persona que lo usa · costo y deuda). Los tres compartían el
> MISMO defecto fatal, y ese defecto es lo que ordena las fases.

## La recomendación

Arreglar primero lo que ya está saliendo —el veto se pregunta al SALIR, no al planificar— y recién después ponerle pantalla: cinco fases sobre server/src/campana/, con ADR 0036 autorizando el lote bajo cinco condiciones exactas, y la superficie como tercera solapa de Contactos más un chip que frena desde donde estés. Nunca como novena vista del riel.

**Dónde:** Server: server/src/campana/ (hoy un solo archivo) + server/src/routes/campana.ts + server/src/ritmo/ocupacion.ts. Front: tercera solapa «Campañas» en la vista Contactos — src/features/vistas/VistaPersonas.tsx:126, el `modo: 'padron' | 'telefono'` pasa a `| 'campanas'`, y el componente Solapa ya vive ahí (:148-167) — más un chip en la cabecera (src/App.tsx:508, al lado de InterruptorAutoRespuesta), en src/features/campana/. NO se toca VISTAS (src/App.tsx:82-98), no se gasta el noveno atajo, no hay tecla suelta nueva, no hay listener de Escape nuevo, y src/App.test.tsx:104-117 no rompe.

## Por qué

El punto de partida no es «¿construimos campañas?» sino «ya salieron 88 y el sistema que las mandó rompe una regla que juramos». scripts/campana.ts está en main desde el 4-ago, sin ADR, sin un solo test, y le pasa a huboRechazo ÚNICAMENTE primerMensaje (:229-232) cuando la firma acepta lista y su doc dice «vale para toda la conversación». Quien dijo que no en el quinto mensaje hoy recibe promoción. Eso no espera una pantalla.

El defecto que mató a las tres propuestas es el mismo y es de plomería: el público se congela al autorizar y nunca se vuelve a preguntar. Con un lote de horas, la foto del rechazo envejece — alguien contesta «sacame de esta lista» a las 15:00 y recibe el flyer a las 17:30. autorespuesta/repositorio.ts:100,160 (cancelarPorRespuestaHumana / cancelarDeConversacion) tiene esa garantía con test propio y ninguna de las tres la copió. Por eso la Fase 1 no es UI: es campana/vetoAlSalir.ts, preguntado dentro del bucle, justo antes de cada envío, cancelando con motivo. Es además lo que sostiene el ADR: el humano no puede juzgar a las 17:30 lo que pasó a las 15:00; la máquina sí.

Dónde va la superficie: la prueba literal de ADR 0034:160-162 la deja fuera del riel por dos caminos. Es una tarea con ventana (lo que ADR 0016:117-120 ya rechazó por escrito) y es supervisor-only sobre un riel que comparten cinco vendedoras: un ícono que a Luz-vendedora le responde 403 no es un mapa diluido, es una promesa incumplida. Y el precedente exacto es el más reciente: el padrón (ADR 0035) también es supervisor-only, también es gente en bulto, y entró como solapa de Contactos con la frontera en el WHERE. La objeción de que Contactos es «los que nunca escribieron» se contesta con dato dibujado, no con cartel: la solapa encabeza con su universo («1.997 conversaciones · gente que ya escribió») y no ofrece ni una faceta del padrón.

La objeción de ADR 0002:23-24 se contesta recortando: la solapa dibuja DESPACHO (cuántos salieron, cuántos faltan, cuántos topeó Meta) y ni una tasa. Respondió / avanzó / hubo venta después viven en el lazo (ADR 0022) y ahí se quedan.

Y la razón por la que las fases están en este orden: cinco de las seis mejores partes del trabajo no necesitan ni el ADR ni la pantalla. El cambio de referencia a conv: es UNA línea y hoy los 88 envíos son invisibles para GET /api/resultados/piezas con la procedencia perfectamente estampada (consultarResultados.ts:84 filtra LIKE 'conv:%').

## El recorrido de la supervisora

1. ⌘3 Contactos → solapa «Campañas». Si su vendedora_id no está en HERMES_SUPERVISORES la solapa no existe, y GET /api/campana/* responde 403 no_es_supervisor. Vacía, el botón primario dice «Armar una corrida» (y recién después de la Fase 5, «Armar una campaña» — el verbo no promete más de lo que la app puede hacer).

2. Paso 1, qué se manda: elige la plantilla y ve el veredicto de Meta consultado en vivo — «coincide con Meta · APROBADA · idioma en». Si difiere, o el estado es PAUSED/DISABLED, o no se pudo preguntar: no hay botón y se lee el motivo. Arrastra el flyer; se sube (POST /api/campana/flyer) y se hashean sus BYTES para la versión de la pieza.

3. Paso 2, a quiénes: línea (solo las Cloud API; las de las vendedoras salen apagadas con el motivo, whatsmeow no manda plantillas), rango de fechas de cuándo ESCRIBIÓ la persona, y tres exclusiones tildadas por default y feas de destildar: dijeron que no · ya recibieron esta pieza · ya compraron. El pie dice «85 entran · 41 dijeron que no · 71 ya la recibieron · 14 no vinieron de anuncio».

4. Paso 3, el simulacro: la tabla de CONDICIONES, no de resultados (lección de #166). Teléfono · cuándo escribió, hora de Lima · hace cuántas horas · si ya se le mandó precio · por qué anuncio llegó · quién es su dueña hoy. Cada fila destildable. Debajo, los descartados de a cinco por motivo. Y el plan real que devolvió programar(): «empieza 9:12 · el último sale 11:40 · 40/hora».

5. Si el techo del número no deja entrar a todos, la pantalla lo DICE antes de autorizar: «85 elegidos, 60 entran hoy, 25 quedan para mañana» con estado propio (no_entro_por_techo). El número que se muestra es el que la acción usa.

6. Autorizar: el botón dice «Autorizar el envío a 60», la confirmación escribe la cifra, nombra la línea (51984429504), nombra a quién quedan asignadas, dice cuánto dura, y dice la contracara literal de la frase del padrón: «Esto SÍ manda mensajes a 60 personas». Viaja {confirmo: 60}; si no coincide con lo resuelto en el server, 409.

7. Sale. Aparece el chip en la cabecera para las cinco: «Campaña · 6 de 60 · 11:40 · Frenar». Un clic apaga, sin modal. Si Meta topea a alguien con 131049 lo cuenta aparte y sigue; cualquier otro error frena el lote entero con el motivo escrito y no vuelve solo. Quien frenó queda escrito (frenada_por).

8. Mientras despacha, cada envío se vuelve a preguntar: ¿dijo que no desde que autorizamos? ¿se despidió? ¿nos contestó y hay una conversación viva? ¿la vendedora ya le escribió? Si sí, se cancela esa fila con su motivo y no sale. El resto sigue.

9. Al día siguiente abre la corrida: «60 salieron (Meta los aceptó)», y desde la Fase 3, entregados / leídos / fallidos de verdad. Las tasas no están acá: están en npm run piezas:resultados y npm run medir:atencion -- --campana promo_3x1_cursos, con su n, su base y Wilson.


## Las fases — cada una útil aunque las siguientes nunca se hagan

### Fase 1 — El veto se pregunta al salir, y el lazo ve las 88 (server puro, sin UI)

**Qué entrega:** La próxima campaña —que hoy se puede mandar igual— deja de escribirle a quien dijo que no en el quinto mensaje, a quien se despidió, a quien ya compró y a quien contestó mientras el lote corría. Y las 88 que ya salieron aparecen por primera vez en npm run piezas:resultados. La supervisora todavía necesita a un ingeniero para disparar, pero lo que salga ya no es indefendible.

**Piezas:**

- ADR 0036 en docs/adr/0036-campanas-por-plantilla-aprobada.md (ver reglas). Sin él, --enviar no se vuelve a usar.
- server/src/campana/publico.ts — PURO, con reloj inyectado y tests. Saca los cuatro .filter() de adentro de main() (scripts/campana.ts:229-265) y devuelve {elegibles, descartados: [{motivo, quienes}]}. Motivos: rechazo · despedida · ya_compro · sin_anuncio · ya_le_llego. huboRechazo recibe TODOS los mensajes; esDespedida mira el último. `ya_compro` cruza clientes_padron (el EXISTS sobre icarus.sales, nunca n_purchases).
- server/src/campana/candidatos.ts — el SQL de traerCandidatos() con `base` inyectado (patrón ADR 0008), sin un CASE. Arregla la ventana de 24 h: se calcula POR LÍNEA (hoy ultimo_entrante_global cruza números propios). Dedup con test: (telefono, pieza_clase='hsm', pieza_ref sin prefijo, estado='enviado').
- server/src/campana/vetoAlSalir.ts — EL ARREGLO FATAL. Puro + un lector inyectado; se pregunta dentro del bucle, justo antes de cada envío: ¿rechazo nuevo? ¿despedida? ¿entrante posterior a la autorización? ¿saliente humano posterior? Devuelve {sale} o {cancelada, motivo}. Test con base.
- La referencia pasa a conv:whatsapp:<telefono>:<linea> (hoy campana:<plantilla>:<telefono>, campana.ts:380) + backfill acotado de las 88 filas con el conteo impreso. Test que lo fija.
- server/src/campana/plantillasAprobadas.ts — contenidoDe(p, flyer) hashea los BYTES del archivo, no su nombre. Vector literal en piezas/vectores.ts.
- server/src/campana/verificarContraMeta.ts — la guarda que plantillasAprobadas.ts:28 promete y no existe. Falla cerrado. Comparación normalizada (CRLF, espacios de cola) para no bloquear por una diferencia cosmética.
- dashboard/equipo.ts: ACTORES_DE_SISTEMA += 'campana' (hoy son dos, y el archivo dice «si aparece un tercero se agrega acá y en ningún otro lado»). Actualizar equipo.test.ts:101.
- Migración 0018: tabla `campana` (plantilla_ref, plantilla_version, idioma, media_id, flyer_sha, linea, filtros jsonb, autorizada_por, autorizada_en, estado, frenada_por, frenada_motivo). El script exige --autorizada-por <username> verificado contra reparto/destino.ts::destinosPosibles.
- scripts/campana.ts adelgazado: deja de leer process.argv en el tope del módulo y de usar el singleton db; consume candidatos.ts + publico.ts + vetoAlSalir.ts. Asigna con asignarSiEstaLibre (no reasignar, que pisa) y verifica el destino.

**Por qué este orden:** Es lo único que hoy está mal y ya está en producción. No depende de ninguna pantalla, no depende de que el dueño quiera una solapa, y cada pieza es verde sola. Además desbloquea la medición: sin la referencia conv:, cualquier cosa que se construya después mide cero y se lee como «no se usó».

### Fase 2 — El freno que ella aprieta, y un ritmo que no es el del acuse

**Qué entrega:** Cualquiera de las cinco ve en la cabecera que hay una campaña saliendo y la frena con un clic. Hoy eso solo se para con Ctrl-C en un SSH, o sea que solo lo puede hacer un ingeniero despierto. Y el lote deja de ser un for con setTimeout fijo: sale con jitter, dentro de una ventana, con techo por número.

**Piezas:**

- Migración 0019: `campana_destinatario` (PK (campana_id, telefono), clave, numero_propio, programado_para, estado programado|tomado|resuelto|cancelado|no_entro_por_techo, motivo, envio_id → envios_wa.id) + `campana_estado` (el interruptor, misma forma que auto_respuesta_estado). Tabla propia y no la del acuse: auto_respuestas_una_por_dia_uq (clave, dia_lima) dropearía campañas en silencio.
- server/src/ritmo/ocupacion.ts — ocupacionDelNumero(base, numero, desde, hasta) leída de envios_wa. Esto NO es cosmético: autorespuesta/repositorio.ts:336 lee solo auto_respuestas_pendientes, y quien de verdad comparte 51984429504 todo el día es el BOT (vendedora_id='bot'). Un techo que no ve al bot no protege el canal.
- server/src/campana/config.ts — CAMPANA_TECHO_HORA / CAMPANA_TECHO_DIA / ventana, propios y con tope duro (nunca Infinity, que es lo que hoy vale --tope). NO se hereda techoPorDia: 60 de autorespuesta/config.ts: ese 60 está derivado de 150 minutos nocturnos y con 88 destinatarios deja 28 afuera con un motivo que dice «auto-respuestas».
- server/src/campana/despachador.ts — el molde de autorespuesta/despachador.ts (cerrojo enVuelo, una por tick, freno total con motivo, no vuelve solo) PERO con política propia: NO cancela la cola al empezar el horario de atención (despachador.ts:140 lo hace, y calcado la campaña se autodestruye a las 9:00). Llama programar() —que ya recibe `ocupadas` y `ventanas`— y le pasa la ocupación de envios_wa.
- transporteCloudApi.ts + envioControlado.ts: el error de Cloud API lleva `codigo` parseado del cuerpo de Meta (hoy es /131049/.test sobre el JSON serializado). Cambio mínimo y con test: el mensaje no cambia, se agrega un campo.
- routes/campana.ts (primeras dos rutas): GET /api/campana/estado y PUT /api/campana/interruptor — esta última detrás de requiereVendedora a secas, como PUT /api/autorespuesta/modo, porque frenar tiene que costar menos que dudar. Guarda frenada_por.
- src/features/campana/ChipCampana.tsx + estadoCampana.ts (puro, con test) montado en src/App.tsx:508. Sin oro (acá no se acaba nada); rojo con el motivo si se frenó. Solo se dibuja con campaña corriendo — el chip apareciendo ES el aviso. Galería en /galeria-campana.html.

**Por qué este orden:** El chip es la única parte del front que sirve a las cinco vendedoras y que un script no puede dar. Y el ritmo tiene que existir antes que el botón de autorizar: si primero se hace la pantalla, se le da a un no-técnico un disparador sobre un despachador sin techo.

### Fase 3 — El sensor: leer value.statuses

**Qué entrega:** Por primera vez Hermes sabe si un mensaje se entregó, se leyó, falló o si la bloquearon. El chip deja de decir «6 aceptados» y dice «6 entregados · 2 fallidos». Y aparece la única señal temprana de que Meta está bajando la calidad del número — hoy nos enteraríamos cuando la plantilla ya está pausada.

**Piezas:**

- webhook/whatsapp.ts: una rama más en el for que ya recorre changes (:93-98) y una lectura de value.statuses junto a value.contacts/value.messages (:102-130). Grep confirma cero apariciones de statuses en todo server/src.
- Migración 0020: `envio_estado_wa` (id_externo, estado sent|delivered|read|failed, codigo_error, ocurrido_en, recibido_en; único por (id_externo, estado)). Se liga por envios_wa.id_externo, sin tocar envios_wa.
- server/src/whatsapp/estadosEntrega.ts — lectura pura: el estado más avanzado por mensaje, y null ≠ false («no lo sabemos» no se dibuja como «no llegó»).
- El chip y (después) la ficha de la corrida lo consumen.

**Por qué este orden:** Cuesta ~150 líneas y es el 5 % del costo total del frente, pero es el único instrumento que ve el modo de falla más caro: perder 51984429504, que es a la vez la única Cloud API, la línea del bot y la del reparto de cinco vendedoras. Poner un botón cómodo delante de un canal ciego es la inversión al revés. Va ANTES de la pantalla, a propósito.

### Fase 4 — Armar una corrida desde la app

**Qué entrega:** La supervisora arma, previsualiza y autoriza sola, sin SSH: elige línea y rango, ve la tabla de condiciones fila por fila, destilda a quien no corresponde, y autoriza con la cifra escrita. Es la fase que hace verdadera la frase del ADR: «la persona vio la lista y pudo sacar filas».

**Piezas:**

- routes/campana.ts completo: GET /plantillas (catálogo + veredicto de Meta) · POST /flyer · POST /simulacro (no escribe nada) · POST /autorizar ({confirmo:N} → 409 si no coincide; LOTE_MAX = 500 con el patrón LIMIT tope+1 → 409 con cuantos y maximo) · POST /sacar · GET /:id. Todo lo que escribe, detrás de esSupervisor(req.vendedoraId, process.env) con 403 no_es_supervisor y sinSupervisores fail-closed (patrón routes/padron.ts:190-198).
- whatsapp/mediaCloudApi.ts — la subida del flyer extraída y con UNA versión de Graph pinneada (hoy el script va a v23.0 y el transporte a v25.0, en el mismo flujo).
- src/features/campana/: PantallaCampanas.tsx (los tres pasos) · TablaSimulacro.tsx · Autorizar.tsx · FichaCorrida.tsx · campana.ts (cliente + lecturas puras con test; un motivo desconocido cae en una lectura conservadora, nunca en un throw) · galeria.tsx con ?simulacro=1 ?confirmar=1 ?despachando=1 ?frenada=1.
- La solapa en VistaPersonas.tsx, dibujada solo para el supervisor.
- docs/evidencia/campana-*.png con Playwright (regla dura #2) + test de componente en jsdom (src/pruebas/dom.tsx) verificando que el chip NO registra Escape en captura y que Escape sigue cerrando la conversación y la Cabina (cicatriz de ADR 0024).
- Se apaga --enviar del script en el mismo PR. Dos puertas al mismo envios_wa con distintos frenos es exactamente lo que el ADR no puede prometer; el script queda como simulacro de consola (regla dura #7), leyendo los mismos módulos.

**Por qué este orden:** Es la fase cara y la única que depende de que el dueño firme el ADR. Llega cuando los frenos, el ritmo y el sensor ya existen, así que lo que el botón dispara es algo que ya sabemos parar y medir.

### Fase 5 — El catálogo de plantillas en la base

**Qué entrega:** La supervisora carga la plantilla que Meta le acaba de aprobar sin que nadie despliegue. Recién acá el botón se puede llamar «Armar una campaña»: hasta entonces se llama «Armar una corrida», porque PLANTILLAS_APROBADAS es un const con UN elemento y el precio ($150 USD) y el link de pago viven adentro del cuerpo compilado.

**Piezas:**

- Migración 0021: tabla `plantillas_hsm` (nombre, idioma, cuerpo, header_de_imagen, estado, activo) sembrada con PROMO_3X1, idempotente. El módulo en código queda como semilla, igual que cursos/alias.ts::ALIAS_SEMILLA.
- plantillaPorNombre / contenidoDe pasan a leer de base con el mismo armado (una sola función, como catalogo/armar.ts).
- Pantalla de alta en src/features/campana/, molde de src/features/hechos/PantallaHechos.tsx — que existe exactamente por esto: «lo que cierra ventas cambia, y agregarlo no puede costar un deploy».
- verificarContraMeta pasa a ser el puente: se puede listar desde GET /{WABA_ID}/message_templates y dar de alta lo que Meta ya aprobó, en la misma request que hoy solo se usaría para el veredicto.
- El rótulo del botón primario cambia de «Armar una corrida» a «Armar una campaña», y ahí sí es verdad.

**Por qué este orden:** Es lo que convierte la superficie de «re-correr el mismo flyer doce veces al año» en una herramienta. Va al final porque la Fase 4 es honesta sin ella (nombra la acción por lo que hace) y porque es la única pieza que no arregla ningún defecto vivo.

## Las reglas que hay que escribir

- ADR 0036 — «Campañas por plantilla aprobada: la segunda excepción acotada a un envío = una acción humana». REVIERTE, solo para server/src/campana/ y server/src/routes/campana.ts: §38 de ADR 0015 («no hay envío masivo») y §41 («no insiste»). NO revierte §37: el público son personas que escribieron primero — no es contacto en frío.

- ADR 0036 — cómo enmienda ADR 0020 §6, sin el argumento que 0020 ya refutó. NO se dice «los 88 mensajes son los mismos bytes» (0020 contestó eso por escrito: a quién, qué preguntó y si se despidió cambian de fila en fila). Se dice: eso que hay que mirar por fila SE MIRA por fila — en el simulacro, con sus condiciones y con la fila destildable — y además se vuelve a mirar EN EL INSTANTE DEL ENVÍO, que es algo que 88 clics humanos no pueden hacer. Lo que se autoriza es el recorte; el tope de 500 es lo que mantiene verdadera la frase «vi la lista».

- ADR 0036 — las CINCO condiciones que compran la excepción, sin las cuales no hay excepción: (1) el veto se re-pregunta antes de cada envío y cancela con motivo; (2) el ritmo sale de programar.ts con jitter y con la ocupación del NÚMERO leída de envios_wa; (3) ventana horaria fija; (4) kill-switch en base a un clic para cualquier vendedora, apagado por default, con freno total y motivo escrito ante cualquier error que no sea 131049; (5) queda escrito quién autorizó y quién frenó.

- ADR 0036 — QUÉ QUEDA EN PIE, enumerado (molde de ADR 0028; lo que no se enumera se pierde): EnvioControlado es la única puerta y de a UNO; TransporteWhatsapp sigue sin enviarA(lista); nada de warmup ni anti-ban; nada de texto libre, solo HSM verificada contra Meta; el padrón (ADR 0035) queda explícitamente fuera de alcance; los dos planos de Goberna no se cruzan; todo marcado en envios_wa y visible en la burbuja; el lead no sabe que hay automatismo. Y la salvedad honesta: el freno por temporary_ban NO se puede disparar en esta línea, porque TransporteCloudApi solo emite conectando/conectado/desconectado.

- Regla nueva (vale para toda cola con destinatarios humanos, no solo campañas): un veto sobre una persona se evalúa en el INSTANTE DEL ENVÍO, nunca al planificar. Condición: si entre la decisión y el envío puede pasar más de un minuto, hay que re-preguntar. Generaliza cancelarPorRespuestaHumana y se fija con test.

- Regla nueva: envios_wa.vendedora_id es un ACTOR, no necesariamente una persona. La campaña firma 'campana' y se agrega a ACTORES_DE_SISTEMA (dashboard/equipo.ts:67, hoy dos actores); el «quién autorizó» vive en campana.autorizada_por y se lee en la burbuja. Condición: poner ahí el id de una supervisora le sumaría +88 mensajes_hoy en el cuadro que el equipo lee como ranking (dashboard/porVendedora.ts:45-86 no filtra automatico ni pieza_via) y ya no habría forma de filtrarlo.

- Regla nueva: los techos de ritmo son del NÚMERO y se leen de envios_wa, jamás de la tabla de una feature. Condición: dos features leyendo cada una su tabla habilitan dos presupuestos completos sobre el mismo número, y ninguna de las dos ve al bot.

- Regla nueva: la referencia de todo envío empieza con conv: — es la llave del lazo (consultarResultados.ts:84) y de la regla del último mensaje (:106-110). Test que falla si alguien escribe otra cosa.

- Regla nueva: una versión de pieza que incluya archivo hashea los BYTES del archivo, nunca su nombre ni su media_id. Condición: dos flyers de Canva llamados flyer.jpg colisionan, y el mismo flyer renombrado parte la pieza en dos versiones falsas.

- Enmienda a CLAUDE.md §WhatsApp: «Nada de automatización, con UNA excepción escrita» pasa a DOS, y se enumeran. Enmienda al bullet de ADR 0035: «Repartir NO manda nada» sigue siendo verdad, y hay que decir que campañas vive en la solapa de al lado y por qué NO sale del padrón.

- Nota en docs/arquitectura.md: /api/campana (español) NO es /api/campaigns (inglés, las campañas de pauta de la mitad desconectada). Misma trampa que ?mios vs ?mias.


## Lo descartado, con nombre y con el juez que lo mató

- La novena vista del riel (⌘9). La mató el juez de reglas: es una tarea con ventana, que es lo que ADR 0016:117-120 ya rechazó por escrito, y es supervisor-only sobre un riel que comparten cinco vendedoras. Y el juez de costo remató: para 5 de 6 usuarias «entra, lee 12 esperando, sale» es la definición literal de CONSULTA (ADR 0034:73-78), o sea el criterio que deja afuera a Ivi.

- vendedora_id = el username de la supervisora. Lo mató el juez de reglas: dashboard/porVendedora.ts:45-86 agrupa envios_wa sin filtrar automatico ni pieza_via, y ACTORES_DE_SISTEMA es la lista cerrada donde va 'campana'. Ponerle una persona le suma +88 al ranking de su propio equipo por apretar un botón, y ya no se puede filtrar. Se guarda en campana.autorizada_por.

- Heredar techoPorDia: 60 y techoPorHora: 20 de autorespuesta/config.ts «tal cual». Lo mataron los tres jueces con la misma aritmética: de 88 entran 60 y 28 quedan afuera, en silencio, con un motivo que la supervisora leería como «techo diario del número (60 auto-respuestas)». Ese 60 está derivado de 150 minutos nocturnos (config.ts:85-91), no es una constante de seguridad de la casa.

- Calcar autorespuesta/despachador.ts. Lo mató el juez de reglas: :140 cancela la cola entera al empezar el horario de atención, así que la campaña se autodestruiría a las 9:00 y solo saldrían los de 07:30–09:00.

- ocupacionDesde (autorespuesta/repositorio.ts:336) como fuente del techo. Lo mató el juez de costo: lee solo auto_respuestas_pendientes. Blindaba una colisión hipotética (el acuse corre en whatsmeow) y dejaba abierta la real: el bot, que manda por el mismo número todo el día.

- Hashear el flyer por el nombre del archivo subido. Lo mató el juez de la persona: flyer.jpg y flyer.jpg de dos campañas distintas hashean igual —el defecto que decía arreglar— y el mismo flyer renombrado parte la pieza. Van los bytes.

- Congelar el público y no volver a preguntar. Es el defecto FATAL que los tres compartían. Lo mató el juez de reglas: el punto «a quien dijo que no, nunca» queda falso desde el segundo mensaje del lote, y la legitimidad entera del ADR descansa en que lo enumerado se cumpla.

- Prometer «entregado» o «leído» antes de la Fase 3. Lo mató el juez de costo: el webhook descarta value.statuses (webhook/whatsapp.ts:93-130, cero apariciones en todo server/src) y no es reconstruible hacia atrás. envios_wa.estado='enviado' significa que Meta aceptó el POST.

- Reusar padron/donde.ts para armar el público de una campaña. Descartado por universo: donde.ts es sobre icarus.contacts (los 72.923 que NUNCA escribieron), la campaña es sobre interactions (los que sí). Dos bases sin JOIN; «reusarlo» sería el segundo armador de recortes, o sea #37.

- Mantener ADR 0020 §6 tal cual (aprobar de a una las 88). Descartado con argumento explícito en el ADR, no con la excusa del espaciado, que 0020 ya cerró.

- Un botón «mandale esta HSM» dentro de una conversación abierta. Descartado: es la puerta por la que la excepción se estira sola.

- Dejar --enviar vivo en el script después de la Fase 4. Lo mató el juez de reglas: la segunda puerta se queda sin los cinco frenos y el ADR estaría jurando garantías que una de las dos puertas no cumple — y la brakeless es justamente la que ya mandó.

- Verificar contra Meta comparando el cuerpo literal, sin normalizar. Lo mató el juez de la persona: emojis, saltos y formato que Meta normaliza harían fallar la guarda por diferencias cosméticas, y la supervisora quedaría bloqueada sin ninguna acción salvo llamar a un ingeniero. Se normaliza CRLF y espacios de cola, y el mensaje dice QUÉ difiere.


## Lo que decide el dueño, no el ingeniero

- ¿Se firma ADR 0036? Es la pregunta cero y no la contesta un ingeniero: autoriza que Hermes mande un lote. Si la respuesta es no, --enviar muere hoy, la Fase 1 se hace igual (los arreglos valen aunque no salga otra campaña) y el resto no se construye.

- ¿Cuántos mensajes por hora y por día puede sacar 51984429504? El único dato es que 88 en ~90 minutos salieron sin queja de Meta. Elegir 20/hora, 40/hora o 60/hora es apetito de riesgo sobre el número que también es el bot, el reparto y la única Cloud API — no es una decisión técnica.

- ¿Cada cuánto puede una persona recibir una campaña? La dedup de hoy es «alguna vez esta pieza». La propuesta es «una campaña cada 30 días, sea cual sea la plantilla», porque sin eso «no insiste» no queda en pie de ninguna forma.

- ¿La ventana de despacho es la de atención (09:00–18:00, para que haya quién conteste lo que la campaña despierta) o la ancha del acuse (07:30–21:00, para que entren más en un día)? Las dos son defendibles y dicen cosas distintas sobre qué es una campaña.

- ¿Se excluye siempre a quien ya compró, o va a haber campañas dirigidas a clientes? Hoy se propone excluirlos por default; si alguna vez el público son clientes, el motivo ya_compro tiene que ser destildable y eso cambia el diálogo.

- Mientras Hermes no lea statuses (Fases 1 y 2), ¿cuántas campañas se permiten? La recomendación del ingeniero es UNA por mes por línea hasta la Fase 3. Aceptar o no esa espera es del dueño.

- La campaña asigna dueña ANTES de mandar. ¿Puede pisar a una dueña existente? Hoy reasignar pisa siempre (reparto/asignar.ts:268-293) y sin verificar el destino. La propuesta es NO pisar por default, con casilla explícita para lo contrario.

- Los leads de consultoría (51941654039): ¿quedan fuera para siempre por política, o es un frente propio con su propio mensaje escrito por quien lleva consultoría?
