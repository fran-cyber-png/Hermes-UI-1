import type { MensajeWhatsapp, TransporteWhatsapp } from './transporte.js';
import { proyectarMensaje, type EventoProyectado, type InteraccionProyectada } from './proyectar.js';

/**
 * EL PUENTE ENTRE EL STREAM DE WHATSAPP Y EL EVENT STORE.
 *
 * Suscribe el `onMensaje` del transporte, proyecta cada mensaje al canónico (S1),
 * y lo entrega al repositorio. Su única responsabilidad de negocio es la
 * idempotencia: el mismo mensaje llegando dos veces —una reconexión, un reenvío
 * de WhatsApp— nunca produce dos filas. Esa garantía la da la clave
 * `(source, externalId)` del event store, y este puente la respeta contando
 * nuevos vs. duplicados en vez de asumir que todo lo que entra es nuevo.
 *
 * No sabe de Postgres: habla con un `RepositorioInteracciones`. Así el puente se
 * testea entero contra un repo en memoria, y la implementación real (Drizzle) es
 * intercambiable — el mismo patrón de costura que el transporte.
 */

/**
 * El puerto de persistencia. `persistir` es idempotente por `evento.externalId`:
 * devuelve `true` si la fila era nueva, `false` si ya existía.
 */
export interface RepositorioInteracciones {
  persistir(evento: EventoProyectado, interaccion: InteraccionProyectada): Promise<boolean>;
}

export interface ContadoresIngesta {
  nuevos: number;
  duplicados: number;
  descartados: number;
}

export class IngestaWhatsapp {
  readonly contadores: ContadoresIngesta = { nuevos: 0, duplicados: 0, descartados: 0 };

  constructor(
    private transporte: TransporteWhatsapp,
    private repo: RepositorioInteracciones,
  ) {}

  /** Engancha la ingesta al stream. A partir de acá, cada mensaje se persiste. */
  iniciar(): void {
    // onMensaje es fire-and-forget (callback sync); el trabajo real es async. Un
    // fallo persistiendo UN mensaje no puede tumbar la suscripción entera, así que
    // se aísla por mensaje. El crudo, si llegó a guardarse, queda; el resto se
    // reintenta cuando WhatsApp reenvíe (idempotencia mediante).
    this.transporte.onMensaje((m) => {
      void this.procesar(m).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[ingesta whatsapp] falló un mensaje:', (err as Error).message);
      });
    });
  }

  /** Proyecta y persiste UN mensaje. Público para poder testearlo sin el stream. */
  async procesar(m: MensajeWhatsapp): Promise<void> {
    const r = proyectarMensaje(m);
    if ('descarte' in r) {
      this.contadores.descartados += 1;
      return;
    }
    const nuevo = await this.repo.persistir(r.evento, r.interaccion);
    if (nuevo) this.contadores.nuevos += 1;
    else this.contadores.duplicados += 1;
  }
}
