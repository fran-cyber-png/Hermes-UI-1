import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Mail, X } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import { useEscape } from '../../lib/teclado/useEscape';
import { fechaCorta, hace } from '../../lib/formato';
import { nombreCorto } from '../../dominio/dueno';
import type { CorreoCompleto, CorreoEnLista } from './tipos';

/**
 * LEER UN CORREO QUE YA SALIÓ — el cuerpo se PIDE, de a uno.
 *
 * ══ POR QUÉ ESTE COMPONENTE EXISTE ══════════════════════════════════════════
 *
 * 🔴 **Sacarle el cuerpo a la lista sin cablear esto habría dejado a Hermes sin
 * NINGUNA forma de leer lo que se mandó.** Hasta este frente `GET /api/correos`
 * servía el cuerpo completo de todos los correos del equipo en cada carga de la
 * vista —el texto que Sindy le escribió a un lead viajaba al navegador de las otras
 * ocho sin que nadie lo pidiera ni lo mostrara—, así que el arreglo fue partirlo en
 * dos: la lista sin cuerpo y `GET /api/correos/:id` con él. Pero **una ruta que
 * ningún componente llama no es una ruta: es código muerto que se ve vivo desde el
 * server**, y este repo ya lo pagó dos veces con la pestaña «Notas»
 * (`PanelDerecho.tsx`) y con `onCorreo` en `FichaContacto` — meses de una acción que
 * la pantalla dibujaba y que no existía. El síntoma es siempre el mismo: ninguno.
 *
 * ⚠️ Y hay un motivo de operación además del arquitectónico: la lista muestra el
 * ASUNTO, y dos correos con el mismo asunto —«probando», «probando»— son
 * indistinguibles. La pregunta real de la vendedora no es «¿le mandé algo?» sino
 * «¿qué le mandé?», y esa recién se contesta acá.
 *
 * ══ 🔴 CÓMO SE MONTA ════════════════════════════════════════════════════════
 *
 * 🔴 **Sólo mientras está abierto: `{leyendo && <LecturaDeCorreo … />}`.** Igual que
 * `AdminRemitentes`, y por el mismo motivo: `useEscape` registra en **captura sobre
 * `window`** y hace `stopPropagation()`, así que un listener registrado de más apaga
 * el Escape de TODA la app en silencio (la cicatriz es `ConsultaIvi`, ADR 0024). La
 * firma no acepta un `abierto` a propósito — acá el montaje ES la apertura.
 */
export function LecturaDeCorreo({
  /**
   * La fila que ya está en la lista. **No es un atajo para evitar el `fetch`**: es lo
   * que permite dibujar el encabezado —quién, a quién, asunto, cuándo— desde el
   * primer frame. Sin esto, abrir un correo mostraría una hoja en blanco con un
   * spinner y la vendedora no sabría ni cuál abrió.
   */
  fila,
  onCerrar,
}: {
  fila: CorreoEnLista;
  onCerrar: () => void;
}) {
  useEscape(onCerrar);

  /**
   * ⚠️ **La clave lleva el `id`.** Con `['correos','uno']` a secas, abrir el segundo
   * correo mostraría el cuerpo del primero mientras viaja la consulta — y como los
   * asuntos se repiten («probando», «probando»), eso no se ve como un error: se ve
   * como que los dos decían lo mismo.
   */
  const detalle = useQuery({
    queryKey: ['correos', 'uno', fila.id],
    queryFn: () => api<{ correo: CorreoCompleto }>(`/api/correos/${fila.id}`),
  });

  const correo = detalle.data?.correo;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-navy/20 sm:p-4"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label={`Correo: ${fila.asunto}`}
    >
      <div
        className="flex h-dvh w-full flex-col overflow-hidden bg-card shadow-panel animate-entrar sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[34rem] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <Mail size={16} strokeWidth={2.1} className="shrink-0 text-navy-ink" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-heading text-sm font-bold leading-tight text-navy-ink" title={fila.asunto}>
              {fila.asunto}
            </h2>
            <p className="truncate text-[11px] leading-tight text-muted-foreground" title={fila.vendedoraId}>
              {/* Quién, con el mismo criterio que la fila de la lista: el nombre
                  corto, y el `vendedora_id` completo en el `title` del renglón.
                  ⚠️ Y la fecha ABSOLUTA **además** del «hace 11 días»: lo relativo ya
                  lo dice la lista, y para pegar un correo en una conversación con un
                  lead lo que sirve es el día. */}
              {nombreCorto(fila.vendedoraId)} → <span className="font-mono">{fila.para}</span> ·{' '}
              {fechaCorta(fila.creadoAt)} · {hace(fila.creadoAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-200 ease-house hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {/* ── El sobre con el que SALIÓ ──
              ⚠️ Se dibuja sólo si existe. Las filas anteriores a la migración no
              tienen `desde` ni `responderA`, no hay backfill posible, y **un
              remitente inventado es peor que un hueco** — el criterio de los ✓✓. */}
          {(fila.desde ?? fila.responderA) && (
            <dl className="rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-relaxed">
              {fila.desde && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 font-semibold text-muted-foreground">Salió de</dt>
                  <dd className="min-w-0 flex-1 break-all font-mono text-foreground">{fila.desde}</dd>
                </div>
              )}
              {fila.responderA && (
                <div className="mt-0.5 flex gap-2">
                  <dt className="w-20 shrink-0 font-semibold text-muted-foreground">Responde a</dt>
                  <dd className="min-w-0 flex-1 break-all font-mono text-foreground">{fila.responderA}</dd>
                </div>
              )}
            </dl>
          )}

          {fila.estado === 'fallido' && (
            /* 🔴 El fallo se dice ARRIBA del texto, no debajo. Quien abre un correo
               fallido viene a ver qué decía; leerlo entero y enterarse al final de
               que nunca salió es la forma de que se lo dé por mandado. */
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] leading-relaxed text-destructive">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <p className="min-w-0">
                Este correo <span className="font-semibold">no llegó a salir</span>
                {fila.motivo ? <> — {fila.motivo}</> : null}. Lo de abajo es lo que se había escrito.
              </p>
            </div>
          )}

          {detalle.isPending ? (
            <p className="flex items-center gap-2 px-1 py-6 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" />
              Trayendo el texto…
            </p>
          ) : detalle.isError ? (
            /* ⚠️ «No se pudo traer» NUNCA se puede leer como «está vacío»: son dos
               hechos opuestos y el segundo cierra la pregunta. Es la misma cicatriz
               que «No se pudo cargar la lista — no es que no haya correos». */
            <div className="rounded-xl border border-border p-4 text-center text-xs text-foreground">
              <p>No se pudo traer el texto de este correo — no es que esté vacío.</p>
              <button
                type="button"
                onClick={() => void detalle.refetch()}
                className="mt-2.5 rounded-lg border border-border px-3 py-1.5 font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
              >
                Reintentar
              </button>
            </div>
          ) : (correo?.cuerpo ?? '').trim() === '' ? (
            // Un cuerpo vacío es un hecho raro pero posible, y **se dice**: dejar el
            // espacio en blanco sin una palabra se lee como que la consulta falló.
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              Este correo salió sin texto en el cuerpo.
            </p>
          ) : (
            /* 🔴 `whitespace-pre-wrap` y NO `dangerouslySetInnerHTML`: el correo sale
               en texto plano, así que renderizarlo como HTML no agregaría formato —
               agregaría una superficie para que lo que alguien tipeó en el composer
               se ejecute en el navegador de otra vendedora. Los saltos de línea se
               respetan con CSS, que es todo lo que hace falta. */
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
              {correo?.cuerpo}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
