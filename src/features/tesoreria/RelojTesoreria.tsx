import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock } from 'lucide-react';
import { api } from '../../lib/datos/cliente';

/**
 * EL RELOJ DE TESORERÍA.
 *
 * ── Por qué existe ──
 * El 17% de las ventas nunca llega a Meta. No por un bug ni por un permiso: porque el voucher se
 * confirmó DESPUÉS de los 7 días que Meta acepta.
 *
 * Y la causa está en la bandeja de Cerberus:
 *
 *     queryset.order_by("-fecha_pago")     ← el pago MÁS RECIENTE primero
 *
 * Sin columna de antigüedad. Sin badge de "lleva X días". Sin notificación cuando entra un
 * voucher. Sin alerta cuando uno se pone viejo. Un pago viejo queda enterrado en la página 8 y
 * no vuelve a subir nunca.
 *
 * **No es que Tesorería sea lenta. Es que el sistema esconde lo viejo debajo de lo nuevo.**
 *
 * ── Qué hace esta pantalla ──
 * Da vuelta el orden. Lo más viejo arriba, con el reloj de Meta corriendo al lado.
 *
 * No escribe en Cerberus. La confirmación sigue ocurriendo allá, donde debe. Esto solo mira el
 * espejo y dice la verdad sobre el tiempo.
 *
 * **Es la única mejora que recupera plata sin permisos de Meta, sin migrar WhatsApp y sin esperar
 * a nadie. Y no la hace un programador: la hace Tesorería, mirando esto.**
 */

type PagoEsperando = {
  folio: string;
  cliente: string | null;
  monto: string;
  moneda: string | null;
  metodo: string | null;
  subidoAt: string;
  diasEsperando: number;
  /** Horas hasta que Meta ya no acepte el evento. Negativo = esa plata ya se perdió. */
  horasHastaPerderla: number;
};

type Reloj = {
  esperando: PagoEsperando[];
  yaPerdidos: number;
  urgentes: number;
  total: number;
  histograma: { dias: number; n: number }[];
};

/** El semáforo del reloj de Meta. Los colores salen de la escala de temperatura del sistema. */
function temperatura(horas: number) {
  if (horas <= 0) return { color: '#64748B', label: 'Meta ya no la va a ver', urgente: false };
  if (horas < 24) return { color: '#C2410C', label: `quedan ${horas} h`, urgente: true };
  const dias = Math.round(horas / 24);
  const txt = dias === 1 ? 'queda 1 día' : `quedan ${dias} días`;
  if (horas < 72) return { color: '#CAA106', label: txt, urgente: true };
  return { color: '#16A34A', label: txt, urgente: false };
}

export default function RelojTesoreria() {
  const { data, isPending } = useQuery({
    queryKey: ['tesoreria'],
    queryFn: () => api<Reloj>('/api/overview/tesoreria'),
    // El voucher lo sube una persona: refrescar cada 60 s alcanza y sobra.
    refetchInterval: 60_000,
  });

  if (isPending) {
    return (
      <p className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
        Cargando...
      </p>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No hay vouchers esperando confirmación.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          (O todavía no se sincronizó Cerberus — que no es lo mismo.)
        </p>
      </div>
    );
  }

  // Salvables: las que todavía tienen tiempo. Ordenadas por lo que MENOS les queda — actuar
  // sobre la de 9 horas antes que sobre la de 5 días.
  const salvables = data.esperando
    .filter((p) => p.horasHastaPerderla > 0)
    .sort((a, b) => a.horasHastaPerderla - b.horasHastaPerderla);

  // Perdidas para Meta, pero NO para el cliente: pagó y sigue esperando. Lo más viejo primero.
  const perdidos = data.esperando
    .filter((p) => p.horasHastaPerderla <= 0)
    .sort((a, b) => b.diasEsperando - a.diasEsperando);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Vouchers esperando</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Cada día que un voucher espera es un día más cerca de que Meta ya no acepte esa venta.
        </p>
      </div>

      {/* Los dos números que importan, y por qué. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Esperando
          </p>
          <p className="mt-1 text-3xl font-bold text-navy">{data.total}</p>
        </div>

        <div
          className={
            'rounded-2xl border px-5 py-4 ' +
            (data.urgentes > 0
              ? 'border-warning/40 bg-warning/5'
              : 'border-border bg-card')
          }
        >
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <Clock size={12} />
            Se vencen en menos de 48 h
          </p>
          <p className="mt-1 text-3xl font-bold text-navy">{data.urgentes}</p>
        </div>

        <div
          className={
            'rounded-2xl border px-5 py-4 ' +
            (data.yaPerdidos > 0
              ? 'border-destructive/40 bg-destructive/5'
              : 'border-border bg-card')
          }
        >
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <AlertTriangle size={12} />
            Meta ya no las va a ver
          </p>
          <p className="mt-1 text-3xl font-bold text-destructive">{data.yaPerdidos}</p>
          {data.yaPerdidos > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Se confirmen o no, ya pasaron los 7 días.
            </p>
          )}
        </div>
      </div>

      {/* DOS COLAS, no una.

          Hay dos urgencias distintas y mezclarlas hace que la pantalla mienta:

            · Para el LAZO  → la que tiene 9 horas antes de que Meta la rechace. Actuar HOY la salva.
            · Para el CLIENTE → la que lleva 12 días esperando su curso. Ya no se salva para Meta,
              pero la persona sigue esperando y hay que confirmarla igual.

          Si se ordena solo por antigüedad, lo primero que ve Tesorería es un muro de "ya es tarde"
          — y lo que sí se puede salvar queda enterrado abajo. Al revés de lo que hace falta. */}

      {salvables.length > 0 && (
        <Cola
          titulo="Todavía se pueden salvar"
          bajada="Confirmar estos hoy hace que Meta se entere de la venta. Ordenados por lo que les queda."
          pagos={salvables}
        />
      )}

      {perdidos.length > 0 && (
        <Cola
          titulo="Meta ya no las va a ver"
          bajada="Pasaron los 7 días. Igual hay que confirmarlas: el cliente pagó y está esperando."
          pagos={perdidos}
          apagada
        />
      )}

      <Histograma datos={data.histograma} />
    </div>
  );
}

/** Una cola de vouchers. `apagada` = las que Meta ya no va a ver: siguen importando, pero menos. */
function Cola({
  titulo,
  bajada,
  pagos,
  apagada = false,
}: {
  titulo: string;
  bajada: string;
  pagos: PagoEsperando[];
  apagada?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className={'font-heading text-sm font-bold ' + (apagada ? 'text-muted-foreground' : 'text-navy')}>
          {titulo} <span className="font-normal text-muted-foreground">({pagos.length})</span>
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{bajada}</p>
      </div>

      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-bold">{apagada ? 'Esperando' : 'Reloj de Meta'}</th>
            <th className="px-4 py-2.5 font-bold">{apagada ? 'Reloj de Meta' : 'Esperando'}</th>
            <th className="px-4 py-2.5 font-bold">Folio</th>
            <th className="px-4 py-2.5 font-bold">Cliente</th>
            <th className="px-4 py-2.5 text-right font-bold">Monto</th>
            <th className="px-4 py-2.5 font-bold">Método</th>
          </tr>
        </thead>
        <tbody className={apagada ? 'opacity-60' : ''}>
          {pagos.map((p) => {
            const t = temperatura(p.horasHastaPerderla);
            const reloj = (
              <span className="flex items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                <span className={'text-xs ' + (t.urgente ? 'font-bold text-foreground' : 'text-muted-foreground')}>
                  {t.label}
                </span>
              </span>
            );
            const espera = (
              <>
                <span className="font-bold tabular-nums text-navy">{p.diasEsperando}</span>
                <span className="ml-1 text-xs text-muted-foreground">
                  {p.diasEsperando === 1 ? 'día' : 'días'}
                </span>
              </>
            );

            return (
              <tr key={p.folio + p.subidoAt} className="border-b border-border last:border-0">
                {/* Lo que más importa va primero, y depende de la cola. */}
                <td className="whitespace-nowrap px-4 py-3">{apagada ? espera : reloj}</td>
                <td className="whitespace-nowrap px-4 py-3">{apagada ? reloj : espera}</td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                  {p.folio}
                </td>
                <td className="px-4 py-3">{p.cliente ?? '—'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {Number(p.monto).toLocaleString('es')}{' '}
                  <span className="text-xs text-muted-foreground">{p.moneda}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                  {p.metodo ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * La CAUSA, no el resultado.
 *
 * La home muestra cuántas ventas se perdieron. Esto muestra POR QUÉ: la distribución real de
 * cuánto tarda Tesorería en confirmar un voucher, con la línea de los 7 días de Meta dibujada.
 *
 * Todo lo que cae a la derecha de esa línea es plata que Meta nunca va a ver.
 * Y no se arregla programando: se arregla confirmando más rápido.
 */
function Histograma({ datos }: { datos: { dias: number; n: number }[] }) {
  if (datos.length === 0) return null;

  const maximo = Math.max(...datos.map((d) => d.n));
  const total = datos.reduce((s, d) => s + d.n, 0);
  const tarde = datos.filter((d) => d.dias > 7).reduce((s, d) => s + d.n, 0);
  const maxDia = Math.max(...datos.map((d) => d.dias));

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="font-heading text-sm font-bold text-navy">
        Cuánto tarda un voucher en confirmarse
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        De {total.toLocaleString('es')} pagos confirmados,{' '}
        <strong className="text-foreground">
          {tarde.toLocaleString('es')} ({((100 * tarde) / total).toFixed(0)}%) tardaron más de 7
          días
        </strong>
        . Meta rechaza esos eventos sin avisar.
      </p>

      <div className="relative mt-5 flex h-32 items-end gap-[3px]">
        {/* La línea de los 7 días. Es la misma gramática visual que "La puerta cerrándose". */}
        <div
          className="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-dashed border-destructive/50"
          style={{ left: `${(7 / (maxDia + 1)) * 100}%` }}
        >
          <span className="absolute -top-4 left-1.5 whitespace-nowrap text-[10px] font-bold text-destructive">
            7 días — Meta deja de aceptar
          </span>
        </div>

        {Array.from({ length: maxDia + 1 }, (_, dia) => {
          const d = datos.find((x) => x.dias === dia);
          const n = d?.n ?? 0;
          const tardio = dia > 7;
          return (
            <div
              key={dia}
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${dia} ${dia === 1 ? 'día' : 'días'} — ${n} pagos`}
            >
              <div
                className="w-full rounded-t-sm transition-opacity group-hover:opacity-70"
                style={{
                  height: `${(n / maximo) * 100}%`,
                  backgroundColor: tardio ? '#64748B' : '#16A34A',
                  minHeight: n > 0 ? '2px' : 0,
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex justify-between text-[10px] font-semibold text-muted-foreground">
        <span>mismo día</span>
        <span>{maxDia}+ días</span>
      </div>
    </div>
  );
}
