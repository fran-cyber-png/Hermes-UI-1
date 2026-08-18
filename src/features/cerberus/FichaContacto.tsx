import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, Mail, RefreshCw, ShoppingBag, UserPlus } from 'lucide-react';
import { fechaCorta } from '../../lib/formato';
import { sectionLabel } from '../../lib/styles';
import type { Conversacion } from '../../dominio/conversaciones';
import { Avatar } from '../../components/Avatar';
import { BloqueLeadForm, useLeadForm } from './BloqueLeadForm';
import { personaEsTelefono } from '../../dominio/canal';
import { quiereFoto } from '../../dominio/fotoVisible';
import { PersonaUnificada } from '../identidad/PersonaUnificada';
import { useFicha } from './useFicha';
import type { DestinoCorreo } from '../../lib/puente';

/**
 * LA FICHA DEL CONTACTO — el DETALLE de Cerberus, dentro de su pestaña.
 *
 * ── Qué cambió con el rediseño del panel ──
 * El veredicto («¿ya compró? ¿cuánto?») subió a la banda de estado: arriba de
 * todo, siempre visible, con color. Es lo que se lee en el primer segundo y lo
 * que cambia el tono de la conversación. Acá abajo queda el DETALLE que se
 * consulta cuando hace falta —código de cliente, DNI, correo, la lista de
 * compras con folio y fecha— más lo que declaró el formulario.
 *
 * Lo que esta pestaña YA NO pone (y por eso el panel dejó de repetirse):
 *   · el encabezado con el nombre → `panel/BandaEstado`
 *   · la cifra héroe de compras   → `panel/BandaEstado` (una línea, no un titular)
 *   · «Le interesa»               → `panel/BloqueInteres`, fuera de las pestañas
 *   · próxima acción y registrar venta → `panel/AccionesContacto`
 *
 * Ese último movimiento arregla un bug real: «Registrar venta» vivía adentro de
 * esta pestaña, así que abrir «Notas» hacía desaparecer el botón que cierra la
 * venta.
 *
 * Cuatro estados, porque colapsarlos miente: cliente / persona nueva / cargando /
 * Cerberus caído. JAMÁS mostrar «no figura» cuando lo que pasó es que la API
 * falló: son cosas opuestas.
 */

export type { Ficha, VentaFicha } from './ficha';


const CERBERUS = import.meta.env.VITE_CERBERUS_URL ?? 'https://app.goberna.us';

function claseEstadoVenta(estado: string): string {
  if (/pagad/i.test(estado)) return 'text-success';
  if (/anul/i.test(estado)) return 'text-destructive';
  return 'text-muted-foreground';
}

/**
 * EL VACÍO HONESTO — cuando de esta persona no sabemos nada: ni ficha de
 * Cerberus ni formulario. Un hueco en blanco haría pensar que algo no cargó.
 * Este dice las dos cosas que hacen falta: **que no hay nada** y **qué hacer**
 * —lo que averigües en el chat, anotalo, porque nadie más lo va a anotar—.
 * Si el formulario SÍ matcheó, esto no aparece: el bloque de abajo ya habla.
 */
function SinNadaQueMostrar({ telefono, pushname }: { telefono: string | null; pushname: string | null }) {
  const { data, isPending } = useLeadForm(telefono, true);
  if (isPending || data?.lead) return null;
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-3">
      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <UserPlus size={13} className="mt-0.5 shrink-0" />
        <span>
          De {pushname ? <span className="font-semibold text-foreground">{pushname}</span> : 'esta persona'} no
          sabemos nada más: no compró nunca y tampoco llenó un formulario. Todo lo que averigües en el
          chat —el curso, el nombre real, cuándo puede pagar— anotalo en <b>Notas</b>: es el único
          lugar donde va a quedar.
        </span>
      </p>
    </div>
  );
}

export function FichaContacto({
  conversacion,
  onCorreo,
  embebida = false,
}: {
  conversacion: Conversacion;
  /**
   * Puente a Correos: prellena el Para con el correo de la ficha. **Sin esto la
   * acción no se muestra**, y eso fue exactamente lo que pasó durante casi un
   * mes — nadie pasaba esta prop (el porqué, en `PanelDerecho.tsx`).
   *
   * ⚠️ **Manda un objeto y no el `para` suelto**: un correo que sale de una
   * ficha viene de una conversación, y esa `clave` es lo que después lo ata al
   * timeline y a la medición (`lib/puente.ts`). La ficha la conoce porque tiene
   * la conversación entera; mandarla acá evita que cada llamador se acuerde.
   */
  onCorreo?: (destino: DestinoCorreo) => void;
  /**
   * Dentro del panel multifunción: el marco y el encabezado con la persona los
   * pone el panel. `false` = con su propia tarjeta (uso suelto).
   */
  embebida?: boolean;
}) {
  /**
   * La ficha se resuelve POR TELÉFONO — y ésa es la única pregunta que hay que
   * hacerle al canal acá. Decía `canal === 'whatsapp'`, que es una respuesta
   * correcta a otra pregunta: en un comentario de Meta el `persona_id` es un id
   * y no un número, pero en un lead de landing **es el teléfono**
   * (`cola/leadsCte.ts`). Con la versión vieja, la ficha de un lead salía vacía
   * y encima decía «este canal no lo trae» al lado de su propio número.
   */
  const esTelefono = personaEsTelefono(conversacion.canal, conversacion.persona_id);
  const telefono = conversacion.persona_id;
  /**
   * 🔴 **LA FOTO ES OTRA PREGUNTA, Y ACÁ NO SE COLAPSA.** Pedirle a WhatsApp la
   * foto de perfil de alguien a quien **nunca le escribimos** es exactamente lo
   * que #59 evita. Un lead de landing tiene teléfono y no tiene hilo: se le
   * busca la ficha, no la foto. Vive en `canales/fotoVisible.ts`.
   */
  const conFotoDePerfil = quiereFoto(conversacion.canal);
  const { data, isPending, isError } = useFicha(telefono, esTelefono);
  const qc = useQueryClient();

  return (
    <div
      className={
        embebida
          ? 'flex h-full min-h-0 flex-col'
          : 'flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel'
      }
    >
      {!embebida && (
        <header className="shrink-0 border-b border-border px-4 py-3">
          <div className={sectionLabel}>Ficha del contacto</div>
          <div className="mt-1 flex items-center gap-2.5">
            <Avatar
              nombre={conversacion.persona_nombre ?? telefono}
              telefono={conFotoDePerfil ? telefono : null}
              numeroPropio={conversacion.numero_propio}
              conFoto={conFotoDePerfil}
              className="size-8 shrink-0 rounded-[11px] bg-secondary text-xs font-bold text-navy"
            />
            <div className="min-w-0 truncate text-sm font-bold text-foreground">
              {conversacion.persona_nombre ?? telefono ?? 'Contacto'}
            </div>
          </div>
        </header>
      )}

      <div className={embebida ? 'min-h-0 flex-1 overflow-y-auto' : 'min-h-0 flex-1 overflow-y-auto p-4'}>
        {!esTelefono ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            La ficha de Cerberus se busca por teléfono, y este canal no trae uno.
          </p>
        ) : isPending ? (
          // Skeleton con la anatomía de la ficha — nunca un flash de «no es cliente».
          <div className="space-y-3">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="flex gap-2">
              <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-11 animate-pulse rounded-lg bg-muted" />
            <div className="h-11 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : isError || data?.estado === 'error' ? (
          // La banda de arriba ya dijo QUÉ pasó. Repetir la frase acá sería
          // gritar dos veces; lo que falta es la salida, así que acá va la salida.
          <div className="flex flex-col items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-[11px] leading-relaxed text-warning-foreground">
            <span className="flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Cerberus cortó la consulta a los 12 segundos. Suele ser pasajero.
            </span>
            <button
              type="button"
              onClick={() => void qc.invalidateQueries({ queryKey: ['ficha', telefono] })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-warning/50 bg-card px-2 py-1 text-[11px] font-bold text-warning-foreground transition-colors hover:bg-warning/10"
            >
              <RefreshCw size={11} /> Buscar de nuevo
            </button>
          </div>
        ) : data?.estado === 'nuevo' ? (
          // La banda de arriba ya dijo «Lead nuevo»: repetirlo acá sería llenar
          // el panel con la misma frase dos veces. Lo que agrega esta pestaña es
          // lo ÚNICO que sí sabemos de ella — el formulario, abajo. Si tampoco
          // hay, `SinNadaQueMostrar` dice qué hacer en vez de dejar el hueco.
          <SinNadaQueMostrar telefono={telefono} pushname={conversacion.persona_nombre} />
        ) : data?.estado === 'cliente' ? (
          <div className="flex flex-col gap-3.5">
            <div>
              {!embebida && (
                <div className="text-sm font-bold leading-snug text-foreground">{data.nombre}</div>
              )}
              {/* El nombre legal ya está en la banda de estado: acá van los datos
                  que la banda no puede llevar. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                <span>{data.codigo}</span>
                {data.dni && <span>DNI {data.dni}</span>}
                {data.pais && <span>{data.pais}</span>}
              </div>
              {data.correo && (
                <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate font-mono text-[11px] text-foreground">{data.correo}</span>
                  {onCorreo && (
                    <button
                      type="button"
                      onClick={() =>
                        onCorreo({
                          para: data.correo,
                          clave: conversacion.clave,
                          nombre: data.nombre ?? conversacion.persona_nombre ?? undefined,
                        })
                      }
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-secondary"
                    >
                      <Mail size={10} /> Escribirle
                    </button>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className={'mb-1.5 flex items-center gap-1.5 ' + sectionLabel}>
                <ShoppingBag size={12} /> Compras ({data.ventasCount})
              </div>
              {data.ventas.length === 0 ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Figura como cliente pero no tiene ventas cargadas. Suele pasar cuando la venta se
                  cargó a otro documento: revisala en Cerberus antes de cotizarle de cero.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {data.ventas.map((v) => (
                    <li
                      key={v.folio}
                      className="flex items-baseline gap-2 border-b border-border/60 py-1.5 text-[11px] last:border-0"
                    >
                      <span className="font-mono font-semibold text-foreground">{v.folio}</span>
                      <span className={'font-medium ' + claseEstadoVenta(v.estado)}>{v.estado}</span>
                      <span className="ml-auto shrink-0 font-mono tabular-nums text-muted-foreground">
                        {fechaCorta(v.fecha)}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-navy">
                        {v.moneda} {v.monto}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* El link a Cerberus vive en la banda de estado, siempre visible.
                Acá solo cuando esta ficha se usa suelta, fuera del panel. */}
            {!embebida && (
              <a
                href={`${CERBERUS}/clientes/${data.id}/`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 self-start text-[11px] font-bold text-primary transition-colors hover:text-primary-hover hover:underline"
              >
                Ver la ficha completa en Cerberus <ExternalLink size={10} />
              </a>
            )}
          </div>
        ) : null}

        {/* Lo que Meta o la landing web ya sabía, por match de teléfono (#113):
            nombre real, EMAIL y campaña, marcados por origen. Va SIEMPRE (es dato
            de Hermes, no de Cerberus); se auto-oculta si el teléfono no matcheó
            ningún lead. */}
        <BloqueLeadForm
          telefono={telefono}
          activo={esTelefono}
          pushname={conversacion.persona_nombre}
          // ⚠️ EL CASO DEL LEAD DE LANDING (ADR 0051) NO PASA POR EL BLOQUE DE
          // ARRIBA: ahí `estado` es «nuevo», no «cliente», así que no hay
          // `data.correo` y el botón de Cerberus no existe. Su correo vive acá,
          // en lo que llenó el formulario —`/api/contactos/lead` lo devuelve— y
          // es el único canal con el que se le puede hablar hoy. Cablear solo
          // la mitad de Cerberus habría dejado «Escribirle» justo en la ficha
          // donde MÁS falta. La clave va también: un lead tiene conversación en
          // la cola aunque nadie le haya escrito.
          onCorreo={
            onCorreo
              ? (destino) => onCorreo({ ...destino, clave: destino.clave ?? conversacion.clave })
              : undefined
          }
          // Dentro del panel el nombre real ya encabeza la banda de estado: acá
          // sería la tercera vez que se lee el mismo nombre en la misma columna.
          sinNombre={embebida}
        />

        {/* «Es la misma persona que…» (#58): une la FICHA con la de otro número u
            otra red. Los hilos siguen separados. Vive en su propio archivo. */}
        <PersonaUnificada
          clave={conversacion.clave}
          nombreActual={conversacion.persona_nombre ?? telefono ?? 'este contacto'}
        />
      </div>
    </div>
  );
}
