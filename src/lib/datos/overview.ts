import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, claves } from './cliente';
import type { CanalesResponse } from '../../features/canales/types';

/**
 * El estado de atención de una interacción, tal como lo guarda el servidor.
 *
 * `nuevo` es el único que significa "esto es trabajo pendiente". Todo lo demás ya se tocó.
 */
export type Status = 'nuevo' | 'contactado' | 'descartado' | 'convertido';

export type ItemBandeja = {
  id: number;
  canal: string;
  tipo: string;
  persona_nombre: string | null;
  texto: string | null;
  contexto_texto: string | null;
  occurred_at: string;
  status: Status;
};

/** ¿Meta sabe que vendimos? Es la razón de ser del sistema. */
export type Lazo = {
  /** Sale del registro de sincronización, NO de contar ventas. "No se midió" ≠ "es cero". */
  conectado: boolean;
  sincronizadoAt: string | null;
  /** Envíos a la pestaña de PRUEBAS: se ven en Meta pero no tocan la optimización. */
  reportadasPrueba: number;
  ventasConocidas: number;
  reportadas: number;
  /** El 17%: Tesorería confirmó tarde y Meta rechaza el evento. Antes fallaba en silencio. */
  perdidasPorVentana: number;
};

/** Lo que una persona puede trabajar HOY. Decenas, no 94.371. */
export type Accionable = {
  total: number;
  porCanal: { canal: string; n: number }[];
  horasRestantesMasUrgente: number | null;
};

/** Lo que Meta cerró. No es deuda: es audiencia. */
export type Cerrado = { total: number; mensajes: number; comentarios: number };

/** Qué escribe la gente. El dato que le sirve al creativo. */
export type Preguntas = {
  conTexto: number;
  precio: number;
  info: number;
  /** 1 de cada 5 escribe SOLO su teléfono. No es una pregunta: es una entrega. */
  soloTelefono: number;
};

/** Un día del flujo, partido por lo único que decide si se puede hacer algo: la ventana. */
export type DiaFlujo = {
  dia: string;
  respondidas: number;
  abiertas: number;
  cerradas: number;
};

/** La estación COMPRA: ventas reales por país del cliente, en USD, desde el espejo de Cerberus. */
export type VentaPais = { pais: string; ventasUsd: number; ventas: number };

/** El ROAS real por país: ventas (cliente) × gasto (audiencia), con el cerebro de decisiones. */
export type Accion = 'escalar' | 'recortar' | 'mantener' | 'observar' | 'sin_ventas' | 'sin_gasto';
/** El copiloto: motor de reglas determinista que responde las 4 preguntas del media buyer. */
export type Evidencia = { tipo: 'ok' | 'warn' | 'alert' | 'info'; texto: string };
export type Explicacion = {
  pregunta: string;
  /** 0-100, heurístico. La confianza lo MULTIPLICA: un 641× con 2 ventas no puede dar alto. */
  score: number;
  veredicto: string;
  evidencia: Evidencia[];
  recomendacion: string;
  quePasaSi: string;
  riesgos: string[];
  confianza: string;
};

export type RoasPais = {
  pais: string;
  gastoUsd: number;
  ventasUsd: number;
  ventas: number;
  /** null cuando no hay gasto: no medible ≠ cero. */
  roas: number | null;
  accion: Accion;
  confianza: 'alta' | 'media' | 'baja';
  /** La plata en juego. Es el criterio de orden, no el ROAS crudo. */
  oportunidadUsd: number;
  budgetSharePct: number;
  ventasSharePct: number;
  cacVenta: number | null;
  explicacion: Explicacion;
};

/** Un creativo rankeado: cómo se ve, qué dice, cuánto cuesta cada resultado, y el veredicto. */
export type Creativo = {
  clave: string;
  nombre: string;
  thumbnailUrl: string | null;
  copy: string | null;
  gastoUsd: number;
  resultados: number;
  costoPorResultadoUsd: number | null;
  anuncios: number;
  campana: string;
  veredicto: 'eficiente' | 'caro' | 'medio' | 'sin_resultados' | 'poco_gasto';
  /** ¿Se quemó? Frecuencia sube Y CTR baja: al mismo público se le muestra más y responde menos. */
  fatiga: boolean;
  ctr: number | null;
};

export type Overview = {
  rango: string;
  lazo: Lazo;
  /** El gráfico: la puerta cerrándose, día por día. */
  flujo: DiaFlujo[];
  accionable: Accionable;
  cerrado: Cerrado;
  preguntas: Preguntas;
  /** La misma forma que servía `/api/interactions/canales`. Los componentes no cambian. */
  canales: CanalesResponse;
  bandeja: ItemBandeja[];
  /** La estación COMPRA del embudo. Ordenada por plata. Vacía si Cerberus no se ingirió aún. */
  ventas: VentaPais[];
  /** El ROAS real por país. null hasta que la pauta se revise y traiga el gasto por país de Meta. */
  roasPais: RoasPais[] | null;
  /** La estación LEAD, ACUMULADA (no por rango): un lead viejo sin contactar sigue siendo trabajo. */
  leads: { total: number; sinContactar: number };
  pauta: {
    decisiones: unknown[];
    campanasAnalizadas: number;
    costo: unknown;
    /** Los creativos rankeados por plata: miniatura, copy, costo por resultado y veredicto. */
    creativos: Creativo[];
    errores: { accountId: string; message: string }[];
    revisadoAt: string;
    edadMinutos: number;
  } | null;
};

/**
 * TODO el dashboard en una llamada.
 *
 * Antes eran 4 llamadas desde 4 componentes distintos, una de ellas de 2 a 4 minutos porque
 * hablaba con Meta en vivo. Ahora es una, contra Postgres, en ~37 ms.
 */
export function useOverview(rango: string) {
  return useQuery({
    queryKey: claves.overview(rango),
    queryFn: () => api<Overview>(`/api/overview?rango=${rango}`),
  });
}

/**
 * ¿Esta interacción ya se atendió?
 *
 * ── EL BUG QUE ESTO MATA ──
 * El backend SIEMPRE persistió esto (`responder.ts` escribe `status = 'contactado'`) y la API
 * SIEMPRE lo devolvió. Pero el frontend tenía tres `useState<number[]>([])` independientes
 * (Bandeja, BandejaResumen, CanalPage) y nunca leía la columna.
 *
 * Resultado: respondías desde la home, entrabas a la bandeja, y la misma persona figuraba como
 * sin responder. Un F5 y TODO volvía a verse sin responder — aunque la respuesta ya se había
 * enviado a Meta.
 *
 * No era un problema de duplicación de estado. Era que la fuente de verdad estaba llegando por
 * HTTP y se tiraba a la basura.
 *
 * La solución no es guardarlo mejor. Es NO GUARDARLO: se deriva.
 */
export function fueAtendida(item: { status: Status }): boolean {
  return item.status !== 'nuevo';
}

/**
 * Responder, con actualización optimista.
 *
 * La fila cambia de color al instante (no se espera al servidor), y si el envío falla se
 * revierte sola. Al terminar, se invalida el caché: las OTRAS pantallas que muestran esa
 * interacción se actualizan sin saber nada la una de la otra.
 */
export function useResponder(rango: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: { id: number; publica?: string; privada?: string }) =>
      api(`/api/responder/${vars.id}`, {
        method: 'POST',
        body: JSON.stringify({ publica: vars.publica, privada: vars.privada }),
      }),

    // Optimista: pintamos antes de que el servidor conteste.
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: claves.overview(rango) });
      const previo = qc.getQueryData<Overview>(claves.overview(rango));

      qc.setQueryData<Overview>(claves.overview(rango), (v) =>
        v
          ? {
              ...v,
              bandeja: v.bandeja.map((i) =>
                i.id === id ? { ...i, status: 'contactado' as const } : i,
              ),
            }
          : v,
      );
      return { previo };
    },

    // Si falla, la fila vuelve a como estaba. Nunca mostramos como hecho algo que no se hizo.
    onError: (_err, _vars, ctx) => {
      if (ctx?.previo) qc.setQueryData(claves.overview(rango), ctx.previo);
    },

    // Pase lo que pase, revalidamos contra el servidor: él tiene la última palabra.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['overview'] });
      void qc.invalidateQueries({ queryKey: ['bandeja'] });
      void qc.invalidateQueries({ queryKey: ['canal'] });
    },
  });
}

/**
 * Las cuentas de pauta que el equipo eligió revisar.
 *
 * Vivían en el localStorage de UN navegador. Eso tenía dos problemas: dos personas veían cosas
 * distintas sin saberlo, y el JOB DE FONDO no tiene localStorage — no podía saber qué revisar.
 *
 * Es configuración compartida del equipo, no una preferencia de UI. Va al servidor.
 */
export function useCuentasPauta() {
  return useQuery({
    queryKey: claves.cuentasPauta(),
    queryFn: () => api<{ cuentas: string[] }>('/api/config/cuentas-pauta'),
  });
}

export function useGuardarCuentasPauta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cuentas: string[]) =>
      api<{ cuentas: string[]; refrescando: boolean }>('/api/config/cuentas-pauta', {
        method: 'PUT',
        body: JSON.stringify({ cuentas }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: claves.cuentasPauta() });
      // Si cambiaron las cuentas, el snapshot viejo revisaba OTRA COSA. Se refresca solo.
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

/**
 * "Revisar ahora": el ÚNICO camino por el que el usuario dispara una llamada a Meta.
 *
 * Nunca al cargar una pantalla. Siempre porque alguien lo pidió.
 */
export function useRefrescarPauta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/api/decisions/refrescar', { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['overview'] }),
  });
}
