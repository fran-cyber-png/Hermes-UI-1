import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Mail, Send, Settings2, X } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { tokenGuardado } from '../../lib/datos/token';
import { kicker } from '../../lib/styles';
import { hace } from '../../lib/formato';
import { nombreCorto } from '../../dominio/dueno';
import { quienDiceSer } from '../auth/sesion';
import { mismoUsuario } from '../notas/espacios';
import { AdminRemitentes } from './AdminRemitentes';
import { LecturaDeCorreo } from './LecturaDeCorreo';
import {
  agruparPorDia,
  conMiles,
  lecturaDeError,
  motivoParaNoEnviar,
  resumenDelSobre,
  techoQuemado,
  TOPE_CUERPO,
} from './correos';
import type { CorreoEnLista, EstadoDeCorreos } from './tipos';

/**
 * CORREOS — mandarle un mail a una persona sin salir de Hermes.
 *
 * Un correo = una vendedora, un destinatario, una acción humana (la misma
 * filosofía que WhatsApp: sin listas, sin campañas). Abajo, los últimos enviados
 * del equipo: coordinación a la vista, incluidos los fallidos.
 *
 * ══ 🔴 ESTA PANTALLA MINTIÓ DURANTE UN MES, Y ASÍ ES COMO SE ARREGLA ═════════
 *
 * Desde el 21-jul-2026 el pie del composer decía **«Se envía solo a esta persona,
 * con tu nombre»** y el placeholder **«(va en texto plano, con tu firma de
 * siempre)»**. Las dos frases eran falsas al mismo tiempo: el `From` era
 * `Escuela Goberna <escuela@goberna.us>` para las nueve vendedoras, no había
 * `Reply-To` —o sea que la respuesta del lead caía en un buzón que nadie de
 * ventas lee— y no existía **una sola línea de código** que agregara una firma.
 * Nadie lo descubrió operando porque la tabla tiene tres filas y las tres son
 * pruebas.
 *
 * El server ahora sí hace las dos cosas. Lo que cambia acá es más fuerte que
 * volver ciertas esas frases: **se borran**. Una promesa no se puede verificar
 * mirando la pantalla; el sobre dibujado —`Luz · Escuela Goberna
 * <escuela@goberna.us>`, «las respuestas te llegan a vos»— sí, y se rompe a la
 * vista el día que el server cambie de opinión. Todo lo que esta vista afirma
 * sobre lo que va a salir lo arma `resumenDelSobre` (`correos.ts`), que es el
 * gemelo declarado de `armarSobre` del server.
 *
 * ⚠️ **El corolario para quien agregue algo acá**: si querés escribir una frase
 * que empieza con «se envía…» o «va con…», lo que hace falta no es la frase, es
 * el dato al lado del campo.
 */

/**
 * Dónde se recuerda con qué remitente sale cada una.
 *
 * ⚠️ **Va por vendedora y en minúsculas.** En producción el mismo humano tiene dos
 * grafías vivas del `vendedora_id` (`Luz` y `luz`, `Usuario1` y `usuario1`): sin
 * normalizar, entrar tipeando la otra forma le devuelve la pantalla como si nunca
 * hubiera elegido nada — el mismo defecto mudo que `mismoUsuario` evita en la
 * Libreta, acá en su versión barata.
 */
function claveDelRemitente(vendedoraId: string): string {
  return `hermes.correos.remitente.${vendedoraId.trim().toLowerCase()}`;
}

/**
 * ⚠️ Las dos puertas a `localStorage` van con `try`: en la app de escritorio y
 * detrás de un modo privado el acceso puede tirar, y perder la preferencia de un
 * desplegable no puede llevarse puesta la vista entera de Correos.
 */
function leerRemitenteGuardado(vendedoraId: string): number | null {
  try {
    const crudo = window.localStorage.getItem(claveDelRemitente(vendedoraId));
    const n = Number(crudo);
    return crudo !== null && Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

function guardarRemitente(vendedoraId: string, id: number): void {
  try {
    window.localStorage.setItem(claveDelRemitente(vendedoraId), String(id));
  } catch {
    // Bloqueado: la próxima vez arranca sin preferencia. No es motivo para frenar nada.
  }
}

interface VistaCorreosProps {
  /** El puente desde la ficha: llega con el «Para» ya lleno. */
  correoInicial?: string | null;
  /**
   * La conversación de la que salió el puente.
   *
   * 🔴 **Sin esto el correo no existe para el resto de Hermes.** `correos.clave` es
   * lo que ata el mail a su conversación: sin ella no aparece en ningún timeline,
   * no entra en ninguna medición y no se cruza con la venta — las tres filas que
   * hay en producción la tienen en `NULL`, y por eso son invisibles salvo en esta
   * lista.
   */
  claveInicial?: string | null;
  /** Cómo se llama esa persona: se usa para el asunto y para el acuse, nunca se manda. */
  nombreInicial?: string | null;
  /** Avisa al shell que el puente ya se consumió, para que lo limpie. */
  onConsumido?: () => void;
}

type TonoDeAviso = 'ok' | 'error' | 'techo';

export function VistaCorreos({ correoInicial, claveInicial, nombreInicial, onConsumido }: VistaCorreosProps) {
  const qc = useQueryClient();

  /**
   * 🔴 **Quién escribe se lee del TOKEN, que es la misma fuente que va a usar el
   * server.** No es una comodidad para evitar una prop: el `Reply-To` lo decide el
   * server a partir del `vendedora_id` que viene firmado en el Bearer, así que
   * dibujar el sobre con un id que llegó por otro camino sería justamente la forma
   * de que la pantalla anuncie un buzón y salga otro. Se lee **una vez** (lazy
   * init) porque el shell desmonta el árbol entero al cambiar de sesión: un token
   * nuevo llega con un componente nuevo.
   */
  const [vendedoraId] = useState(() => quienDiceSer(tokenGuardado() ?? '')?.id ?? '');

  const [para, setPara] = useState('');
  const [asunto, setAsunto] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [remitenteId, setRemitenteId] = useState<number | null>(null);
  const [firmaAbierta, setFirmaAbierta] = useState(false);
  const [adminAbierto, setAdminAbierto] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: TonoDeAviso; texto: string } | null>(null);
  /** El remitente que esta vendedora venía usando ya no está activo. Se DICE. */
  const [remitenteRetirado, setRemitenteRetirado] = useState(false);
  /**
   * Qué correo está abierto para leerlo. **Se guarda la FILA, no el id**: con el id
   * habría que buscarla en la lista para dibujar el encabezado, y esa lista puede
   * refrescarse mientras la hoja está abierta — ahí el `find` devuelve `undefined` y
   * la hoja se cierra sola en la cara de quien estaba leyendo.
   *
   * ⚠️ Y la hoja se monta SÓLO con esto en algo distinto de `null`: `useEscape`
   * registra en captura sobre `window`, así que montarla siempre con un
   * `if (!abierto) return null` adentro apaga el Escape de toda la app (ADR 0024).
   */
  const [leyendo, setLeyendo] = useState<CorreoEnLista | null>(null);

  // ── Lo que trajo el puente, y que viaja con el envío (H7) ──
  const [clave, setClave] = useState<string | null>(null);
  const [nombre, setNombre] = useState<string | null>(null);
  /** Contra qué destinatario se pactó esa clave. Ver `escribirPara`. */
  const [paraDelPuente, setParaDelPuente] = useState<string | null>(null);

  /**
   * ⚠️ **Sin `correoInicial` no se hace nada, aunque venga la clave.** Un puente sin
   * dirección no es un correo a medio escribir: es una persona de la que no tenemos
   * mail, y prellenar la conversación sin destinatario dejaría una clave colgada
   * esperando a que alguien tipee cualquier dirección para colgarse de ese hilo.
   */
  useEffect(() => {
    if (!correoInicial) return;
    setPara(correoInicial);
    setParaDelPuente(correoInicial);
    setClave(claveInicial ?? null);
    setNombre(nombreInicial ?? null);
    onConsumido?.();
  }, [correoInicial, claveInicial, nombreInicial, onConsumido]);

  const estado = useQuery({
    queryKey: ['correos', 'estado'],
    queryFn: () => api<EstadoDeCorreos>('/api/correos/estado'),
  });
  const enviados = useQuery({
    queryKey: ['correos', 'lista'],
    queryFn: () => api<{ correos: CorreoEnLista[] }>('/api/correos'),
  });

  /**
   * Todo campo nuevo se lee OPCIONAL. El front sale por N4 (automático) y el server
   * por N5 (un botón que aprieta una persona), así que hay horas en que esta app le
   * habla a un server que no emite nada de esto; y el caché de IndexedDB (ADR 0007)
   * rehidrata respuestas de ayer antes del primer render. El precedente exacto es
   * `soloMisAsignadas ?? true` en `VistaDashboard.tsx:221`.
   */
  const remitentes = estado.data?.remitentes ?? [];
  const supervisor = estado.data?.supervisor ?? false;
  const ritmo = estado.data?.ritmo;
  /** Cuál ventana del ritmo está llena. Es la misma pregunta que apaga el botón. */
  const quemado = techoQuemado(ritmo);
  /**
   * ⚠️ **`sinRemitentes` no es `remitentes.length === 0`, aunque hoy coincidan.**
   * Dice «el frente no está montado y se manda por el `SMTP_FROM` de siempre», y por
   * eso el `??` cae en la longitud: un server viejo no emite ninguno de los dos
   * campos y tiene que comportarse exactamente como antes, no pedir que se elija un
   * remitente que no existe.
   */
  const sinRemitentes = estado.data?.sinRemitentes ?? remitentes.length === 0;

  /**
   * ⚠️ **Lo guardado se VALIDA contra la lista que llegó.** Dar de baja un remitente
   * es lógico (`activo = false`), así que sin este chequeo el desplegable seguiría
   * mostrando el de siempre —guardado hace tres semanas en esta máquina— y el envío
   * moriría en un 400 del server hablando de un id que la vendedora nunca eligió.
   * Cuando el suyo desapareció **no se elige otro por ella**: se apaga el botón (vía
   * `motivoParaNoEnviar`) y se dice qué pasó.
   */
  useEffect(() => {
    const lista = estado.data?.remitentes ?? [];
    if (lista.length === 0) return;

    const guardado = leerRemitenteGuardado(vendedoraId);
    const guardadoVive = guardado !== null && lista.some((r) => r.id === guardado);

    setRemitenteId((actual) => {
      if (actual !== null && lista.some((r) => r.id === actual)) return actual;
      if (guardadoVive) return guardado;
      // Con uno solo no hay nada que elegir: pedir una elección de una sola opción
      // es un trámite. Con dos o más, la elección la hace ella.
      return lista.length === 1 ? lista[0].id : null;
    });
    setRemitenteRetirado(guardado !== null && !guardadoVive);
  }, [estado.data, vendedoraId]);

  const remitenteElegido = remitentes.find((r) => r.id === remitenteId) ?? null;
  const sobre = resumenDelSobre(remitenteElegido, vendedoraId, estado.data?.desde ?? null);
  /**
   * Por dónde sale — es a dónde caen las respuestas cuando no hay `Reply-To`.
   *
   * ⚠️ **No siempre es un buzón pelado, y por eso el nombre no promete eso.** Con
   * remitente elegido es `direccion` a secas; sin ninguno se cae al `SMTP_FROM` de
   * compatibilidad, que en producción viene como cabecera completa
   * (`Escuela Goberna <escuela@goberna.us>`). Cualquier cosa que se quiera hacer con
   * esto —un `mailto:`, una comparación contra otra dirección— tiene que partirlo
   * primero; hoy sólo se muestra, y mostrarlo tal cual es lo honesto.
   */
  const buzonDeSalida = remitenteElegido?.direccion ?? estado.data?.desde ?? null;
  /**
   * ¿El `Reply-To` es SU casilla, o un buzón compartido? Las dos cosas se dicen
   * distinto, y por eso esta comparación decide qué frase sale.
   *
   * 🔴 **Estaba escrita exacta (`=== vendedoraId.trim()`) y HOY no muerde — verificado
   * corriendo el test de DOM contra la versión vieja, que pasa igual.** No muerde por
   * un accidente: cuando el `Reply-To` es de ella, `resumenDelSobre` lo devuelve
   * **literalmente derivado de `vendedoraId.trim()`**, así que las dos cadenas son la
   * misma por construcción. O sea que la corrección no arregla un síntoma: **saca una
   * trampa armada**. El día que alguien normalice el `Reply-To` de un lado —bajarlo a
   * minúsculas al armar el sobre es lo primero que uno haría, y las cabeceras de
   * correo no distinguen mayúsculas— la igualdad se rompe **sin error y sin log**, y
   * lo que se apaga es la buena noticia: a `Ventas11@grupogoberna.com` la pantalla le
   * diría «cae en un buzón compartido, no en tu casilla» sobre un buzón que es suyo.
   * En este repo esa comparación ya costó cuatro bugs mudos (reparto, espacios de la
   * Libreta, eventos, cola), y cinco de los nueve `vendedora_id` son correos enteros.
   *
   * ⚠️ Es `mismoUsuario` de la Libreta a propósito, **no un normalizador nuevo**: ya
   * hay cuatro (`mismaVendedora` en el server, `mismoUsuario` acá, `esMio` en
   * eventos) y el quinto es el que se olvida de un `trim`.
   */
  const respondeAElla = mismoUsuario(sobre.respondeA, vendedoraId);

  const enviar = useMutation({
    mutationFn: () =>
      api<{ ok: true }>('/api/correos/enviar', {
        method: 'POST',
        // `JSON.stringify` se come las claves `undefined`, así que un server que
        // todavía no conoce `remitenteId` ni `clave` recibe exactamente el cuerpo
        // que sabe leer.
        body: JSON.stringify({
          remitenteId: remitenteId ?? undefined,
          para: para.trim(),
          asunto,
          cuerpo,
          clave: clave ?? undefined,
        }),
      }),
    onMutate: () => {
      setAviso(null);
    },
    onSuccess: () => {
      setAviso({ tipo: 'ok', texto: `Enviado a ${nombre ? `${nombre} (${para.trim()})` : para.trim()}.` });
      setPara('');
      setAsunto('');
      setCuerpo('');
      // 🔴 **La clave se suelta con el envío, y esto no es higiene.** Es del PUENTE,
      // no del composer: si sobreviviera, el próximo correo —escrito a mano, a otra
      // persona— quedaría colgado del timeline del lead anterior. Un correo en la
      // conversación equivocada no se ve roto: se ve como un correo más.
      setClave(null);
      setNombre(null);
      setParaDelPuente(null);
      void qc.invalidateQueries({ queryKey: ['correos', 'lista'] });
      // El ritmo lo lleva el server y acaba de moverse: sin esto el contador de la
      // cabecera diría «3 de 20» hasta el próximo montaje de la vista.
      void qc.invalidateQueries({ queryKey: ['correos', 'estado'] });
    },
    onError: (err) => {
      const lectura = lecturaDeError(err);
      // 🔴 **Un 429 NO es una falla: es un techo, y se ve distinto.** Pintado de rojo
      // como los demás, lo que dice la pantalla es «se rompió» y lo que hace quien lo
      // lee es volver a apretar Enviar — contra un server que ya decidió que no.
      const esTecho = err instanceof ErrorApi && err.status === 429;
      setAviso({ tipo: esTecho ? 'techo' : 'error', texto: lectura.texto });
      if (esTecho) void qc.invalidateQueries({ queryKey: ['correos', 'estado'] });
    },
  });

  /**
   * 🔴 **El botón y `⌘↵` preguntan lo MISMO, una sola vez.** Cada uno con su copia
   * de la condición fue exactamente el bug de Ivi (#169): el botón apagado por el
   * tope y el acorde mandando igual. La regla vive pura en `correos.ts`.
   */
  const veredicto = motivoParaNoEnviar(
    { para, asunto, cuerpo, remitenteId, enVuelo: enviar.isPending },
    estado.data,
  );

  /** Cambiar el destinatario a mano SUELTA la conversación que trajo el puente. */
  function escribirPara(v: string) {
    setPara(v);
    if (clave !== null && v.trim() !== (paraDelPuente ?? '').trim()) {
      setClave(null);
      setNombre(null);
    }
  }

  function elegirRemitente(id: number) {
    setRemitenteId(id);
    setRemitenteRetirado(false);
    setFirmaAbierta(false);
    if (vendedoraId !== '') guardarRemitente(vendedoraId, id);
  }

  const grupos = agruparPorDia(enviados.data?.correos ?? []);
  /** El contador aparece cuando falta poco, no siempre: un número que no corre peligro es ruido. */
  const cercaDelTope = cuerpo.length > TOPE_CUERPO * 0.9;

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto p-5">
      <div className="w-full max-w-2xl">
        {/* ── El composer ── */}
        <section className="rounded-2xl bg-card p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-navy" />
            <h1 className="font-heading text-lg font-bold text-foreground">Nuevo correo</h1>
            <div className="ml-auto flex items-center gap-3">
              {/* 🔴 **El contador se dibujaba IDÉNTICO quemado que sano.** «20/20 esta
                  hora» salía en el mismo `text-muted-foreground` que «3/20», o sea que
                  el único momento en que ese número importa era el único en que no se
                  distinguía: la vendedora escribe el correo entero, aprieta Enviar y
                  recién ahí se entera, con el freno al lado del botón. Ahora el estado
                  se ve **sin leer las cifras** — fondo tenido y el mismo ámbar del aviso
                  de techo, que es el color con el que esta pantalla ya dice «esto no es
                  una falla, es un tope». **Sin oro**: el dorado significa tiempo que se
                  acaba y acá no corre ningún plazo — lo que se acabó es el cupo.
                  ⚠️ Quién está quemado lo dice `techoQuemado`, la MISMA función que apaga
                  el botón: con un `>=` propio acá el número podría gritar sobre un botón
                  que anda, o quedarse gris sobre uno apagado. */}
              {ritmo && (
                <span
                  className={
                    'rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums ' +
                    (quemado
                      ? 'bg-warning/15 font-semibold text-warning-foreground'
                      : 'text-muted-foreground')
                  }
                  title={
                    quemado
                      ? 'El cupo de esta ventana está lleno. Los techos los aplica el server: el corte de verdad es el 429.'
                      : 'Los techos los aplica el server; esto es para no enterarte con el correo escrito.'
                  }
                >
                  {ritmo.usadoHora}/{ritmo.techoHora} esta hora · {ritmo.usadoDia}/{ritmo.techoDia} hoy
                </span>
              )}
              {supervisor && (
                <button
                  type="button"
                  onClick={() => setAdminAbierto(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
                >
                  <Settings2 size={12} />
                  Administrar remitentes
                </button>
              )}
            </div>
          </div>

          {estado.isError ? (
            <div className="mt-4 rounded-xl bg-muted/50 p-3.5 text-xs leading-relaxed text-foreground">
              <p>No se pudo consultar el estado del canal de correo — reintentá en un momento.</p>
              <button
                type="button"
                onClick={() => void estado.refetch()}
                className="mt-2.5 rounded-lg border border-border px-3 py-1.5 font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
              >
                Reintentar
              </button>
            </div>
          ) : estado.data?.conectado === false ? (
            /* 🔴 Acá decía «la cuenta vive en mail.goberna.us» y era falso: el SMTP es
               Amazon SES y el MX de goberna.us es Google Workspace. Un dato inventado
               en la pantalla de una falla manda a sistemas a revisar un host que no
               existe — y encima suena a que quien escribe la pantalla sabe. */
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-xs leading-relaxed text-warning-foreground">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p>
                  El canal de correo no está configurado en este servidor: no hay por dónde mandarlo. Es un
                  paso de sistemas — dos minutos — y esta pantalla se enciende sola cuando esté.
                </p>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                  para sistemas: SMTP_HOST · SMTP_USER · SMTP_PASS en el .env
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-2.5">
              {/* ── Desde: con qué correo sale ──
                  ⚠️ **Todo este bloque espera a que `estado.data` exista.** Mientras la
                  consulta viaja, `remitentes` es `[]` y `sinRemitentes` da `true`: sin
                  esta guarda la pantalla afirmaría «todavía no hay remitentes cargados»
                  —y dibujaría un sobre vacío— durante el segundo que tarda en llegar la
                  respuesta. Es el mismo error que este frente vino a corregir, en
                  chiquito: decir algo que no se sabe todavía. */}
              {!estado.data ? (
                <p className="rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                  Viendo por dónde sale…
                </p>
              ) : sinRemitentes ? (
                /* ⚠️ Una lista vacía se lee «se rompió», no «falta configurarlo»: el
                   mismo criterio que `sinLineasPropias` y `sinPadron`. Así que no se
                   dibuja un desplegable sin opciones — se dice qué está pasando. */
                /* ⚠️ **Acá NO se repite por dónde sale.** Decía «— sale por
                   escuela@goberna.us» y el bloque del sobre, dos renglones más abajo,
                   dice exactamente lo mismo: dos frases pegadas afirmando el mismo
                   hecho se leen como dos hechos, y la vendedora busca en qué se
                   diferencian. Lo que este renglón tiene que aportar es lo que el
                   sobre NO puede decir: que la lista está vacía y qué se hace con
                   eso. */
                <p className="rounded-lg bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  Todavía no hay remitentes cargados: sale por el buzón de siempre, el de acá abajo.
                  {supervisor ? ' Podés darlos de alta en «Administrar remitentes».' : ''}
                </p>
              ) : (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="w-12 shrink-0 font-semibold">Desde</span>
                  <select
                    value={remitenteId === null ? '' : String(remitenteId)}
                    onChange={(e) => {
                      if (e.target.value !== '') elegirRemitente(Number(e.target.value));
                    }}
                    aria-label="Desde qué correo sale"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-200 focus:border-primary focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
                  >
                    {remitenteId === null && <option value="">Elegí con qué correo sale…</option>}
                    {remitentes.map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.nombre} · {r.direccion}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {remitenteRetirado && (
                <p className="text-[11px] leading-relaxed text-warning-foreground">
                  El remitente que venías usando ya no está activo. Elegí con cuál sale este correo.
                </p>
              )}

              {/* ── EL SOBRE: lo que va a salir, no lo que prometemos que va a salir ── */}
              {estado.data && (
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                <p className="truncate" title={sobre.de}>
                  <span className="font-semibold">De:</span>{' '}
                  <span className="font-mono text-foreground">{sobre.de || '—'}</span>
                </p>
                <p className="mt-0.5 truncate">
                  {sobre.respondeA === null ? (
                    /* ⚠️ **No se repite la cabecera que el renglón «De:» acaba de
                       imprimir.** Sin remitente elegido `buzonDeSalida` ES `sobre.de`
                       —los dos caen al `SMTP_FROM`, que en producción viene entero
                       (`Escuela Goberna <escuela@goberna.us>`)—, así que la frase salía
                       con un display name y unos picos metidos en el medio de la prosa,
                       diciendo por segunda vez y peor lo que el renglón de arriba ya
                       decía bien. Dos frases pegadas afirmando el mismo hecho se leen
                       como dos hechos, y la vendedora busca en qué se diferencian; es
                       la misma razón por la que el aviso de «sin remitentes» no vuelve
                       a nombrar el buzón. Con remitente elegido sí son distintos (arriba
                       el nombre, acá el buzón pelado) y ahí decirlo aporta. */
                    <>
                      Las respuestas caen{' '}
                      {buzonDeSalida !== null && buzonDeSalida !== sobre.de ? (
                        <>
                          en <span className="font-mono">{buzonDeSalida}</span>
                        </>
                      ) : (
                        'en ese mismo buzón'
                      )}{' '}
                      — no en tu casilla.
                    </>
                  ) : respondeAElla ? (
                    <>
                      Las respuestas te llegan a vos (
                      <span className="font-mono">{sobre.respondeA}</span>)
                    </>
                  ) : (
                    <>
                      Las respuestas caen en <span className="font-mono">{sobre.respondeA}</span>, que es un
                      buzón compartido — no en tu casilla.
                    </>
                  )}
                </p>

                {/* 🔴 La firma se MUESTRA, nunca se pega en el textarea: el server la
                    agrega al final del cuerpo, así que pegarla acá la manda dos veces. */}
                {remitenteElegido?.firma && (
                  <div className="mt-1">
                    <button
                      type="button"
                      onClick={() => setFirmaAbierta((v) => !v)}
                      className="rounded font-semibold underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {firmaAbierta ? 'ocultar firma' : 'ver firma'}
                    </button>
                    {firmaAbierta && (
                      <pre className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-2 font-sans text-[11px] text-foreground">
                        {remitenteElegido.firma}
                      </pre>
                    )}
                  </div>
                )}
              </div>
              )}

              {clave && (
                <p className="text-[11px] text-muted-foreground">
                  Queda anotado en la conversación de {nombre ?? 'esta persona'}.
                </p>
              )}

              <input
                value={para}
                onChange={(e) => escribirPara(e.target.value)}
                type="email"
                aria-label="Para"
                placeholder="Para: persona@correo.com"
                className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-sans focus:border-primary focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
              />
              <input
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
                aria-label="Asunto"
                /* ⚠️ El nombre va en el PLACEHOLDER y no prellenado. Un asunto que la
                   app escribe sola es texto que sale hacia un lead sin que nadie lo
                   haya leído, y el asunto es lo primero —a veces lo único— que se lee. */
                placeholder={nombre ? `Asunto — lo primero que lee ${nombre}` : 'Asunto'}
                className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-200 focus:border-primary focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
              />
              <textarea
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (veredicto.puede) enviar.mutate();
                  }
                }}
                rows={8}
                aria-label="Cuerpo del correo"
                placeholder="Escribí el correo…"
                className="resize-y rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm leading-relaxed outline-none transition-[border-color,box-shadow] duration-200 focus:border-primary focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
              />

              {cercaDelTope && (
                <p
                  className={
                    'text-right font-mono text-[11px] tabular-nums ' +
                    (cuerpo.length > TOPE_CUERPO ? 'text-destructive' : 'text-muted-foreground')
                  }
                >
                  {conMiles(cuerpo.length)} de {conMiles(TOPE_CUERPO)} caracteres
                </p>
              )}

              {aviso && (
                <div
                  role="status"
                  className={
                    'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ' +
                    (aviso.tipo === 'ok'
                      ? 'bg-success/10 text-success'
                      : aviso.tipo === 'techo'
                        ? 'border border-warning/40 bg-warning/10 text-warning-foreground'
                        : 'bg-destructive/10 text-destructive')
                  }
                >
                  {aviso.tipo === 'ok' ? (
                    <Check size={13} className="shrink-0" />
                  ) : (
                    <AlertTriangle size={13} className="shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">{aviso.texto}</span>
                  <button
                    type="button"
                    onClick={() => setAviso(null)}
                    aria-label="Cerrar aviso"
                    className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => enviar.mutate()}
                  disabled={!veredicto.puede}
                  className="flex shrink-0 items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-primary-foreground shadow-[0_4px_16px_-4px_rgba(37,99,235,0.5)] transition-[background-color,transform] duration-200 ease-house hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
                >
                  {enviar.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Enviar
                </button>
                {/* Un botón gris SIN explicación se lee como que la app se colgó, y lo
                    que hace quien lo mira es apretarlo de nuevo. Por eso el motivo va
                    al lado, y sale de la misma función que apagó el botón. */}
                <p className="min-w-0 text-[11px] leading-relaxed text-muted-foreground">
                  {veredicto.puede ? (
                    <>
                      <span className="font-mono">⌘↵</span> para enviar.
                    </>
                  ) : (
                    veredicto.motivo
                  )}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ── Los últimos enviados del equipo ── */}
        <section className="mt-4">
          <h2 className={'mb-2 ' + kicker}>Últimos enviados</h2>
          {enviados.isPending ? (
            <div className="overflow-hidden rounded-2xl bg-card shadow-panel">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 border-b border-border/70 px-4 py-3 last:border-b-0">
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-muted" />
                  <span className="h-3 w-24 shrink-0 animate-pulse rounded bg-muted" />
                  <span className="h-3 w-48 shrink-0 animate-pulse rounded bg-muted" />
                  <span className="h-3 min-w-0 flex-1 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : enviados.isError ? (
            <div className="rounded-2xl border border-border bg-card p-5 text-center text-xs text-foreground">
              <p>No se pudo cargar la lista — no es que no haya correos.</p>
              <button
                type="button"
                onClick={() => void enviados.refetch()}
                className="mt-2.5 rounded-lg border border-border px-3 py-1.5 font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
              >
                Reintentar
              </button>
            </div>
          ) : grupos.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
              Todavía no salió ningún correo desde Hermes. El primero se escribe acá arriba.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-card shadow-panel">
              {grupos.map((g) => (
                <Fragment key={g.dia}>
                  <div className="border-b border-border/70 bg-muted/30 px-4 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {g.etiqueta}
                  </div>
                  {g.correos.map((c) => (
                    /* 🔴 **La fila es un BOTÓN, y ahí se cierra el único agujero que
                       dejó sacarle el cuerpo a la lista.** `GET /api/correos/:id`
                       existe justamente porque el cuerpo dejó de viajar de prepo; sin
                       este clic esa ruta nace huérfana —ningún componente la llama— y
                       Hermes se queda sin NINGUNA forma de leer lo que mandó. En este
                       repo eso no es hipotético: `PanelNotas` y `onCorreo` estuvieron
                       meses así, dibujados y muertos, sin un solo síntoma. */
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => setLeyendo(c)}
                      title="Ver el correo"
                      className="flex w-full items-center gap-3 border-b border-border/70 px-4 py-2.5 text-left text-xs transition-colors last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                    >
                      {c.estado === 'enviado' ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-success" title="enviado" />
                      ) : (
                        <span aria-hidden className="size-1.5 shrink-0" />
                      )}
                      {/* 🔴 **El `vendedora_id` CRUDO no se pinta**, y no es un gusto:
                          es la lección de ADR 0049 —cuatro componentes pintando el
                          identificador con un `capitalize` de CSS, que se veía bien
                          de casualidad—. Acá se veía peor que de casualidad: los
                          `ventas1X@grupogoberna.com` entran en `w-24` como
                          «ventas10@gru…», o sea que **las cinco de la rueda se leen
                          igual salvo por un dígito**. Y dos renglones más arriba el
                          sobre ya dice «Luz · …» con `nombreCorto`: el mismo humano
                          escrito de dos formas en la misma pantalla. El id completo
                          no se pierde — vive en el `title`, que es donde hace falta
                          cuando lo que se está haciendo es auditar. */}
                      <span
                        className="hidden w-24 shrink-0 truncate font-semibold text-foreground sm:block"
                        title={c.vendedoraId}
                      >
                        {nombreCorto(c.vendedoraId)}
                      </span>
                      {/* ⚠️ Con varios remitentes, «quién mandó desde dónde» es la pregunta
                          nueva del equipo — y es dato de auditoría, así que se dibuja solo
                          cuando existe: las filas anteriores al frente no lo tienen y un
                          remitente inventado sería peor que el hueco (criterio de los ✓✓). */}
                      {c.desde && (
                        <span
                          className="hidden w-40 shrink-0 truncate font-mono text-muted-foreground lg:block"
                          title={c.responderA ? `De ${c.desde} · responde a ${c.responderA}` : `De ${c.desde}`}
                        >
                          {c.desde}
                        </span>
                      )}
                      <span className="min-w-0 shrink basis-48 truncate font-mono text-muted-foreground">{c.para}</span>
                      <span className="min-w-0 flex-1 truncate text-foreground">{c.asunto}</span>
                      {c.estado === 'fallido' && (
                        <span className="max-w-48 shrink-0 truncate rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                          falló{c.motivo ? ` · ${c.motivo}` : ''}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {hace(c.creadoAt)}
                      </span>
                    </button>
                  ))}
                </Fragment>
              ))}
            </div>
          )}
        </section>
      </div>

      {adminAbierto && <AdminRemitentes onCerrar={() => setAdminAbierto(false)} />}
      {leyendo && <LecturaDeCorreo fila={leyendo} onCerrar={() => setLeyendo(null)} />}
    </div>
  );
}
