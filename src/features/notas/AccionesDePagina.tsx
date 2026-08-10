import { useState } from 'react';
import { Check, Copy, Link2, Link2Off, Lock, MoveRight, Users } from 'lucide-react';
import type { DondeEstoy, Espacio } from './espacios';
import type { Alcance, Nota, Permiso } from './notas';

/**
 * QUÉ SE PUEDE HACER CON UNA PÁGINA — mover de lugar y compartirla con un link
 * (ADR 0047).
 *
 * Va arriba del editor y no en la fila de la lista: las dos acciones se deciden
 * **con la página a la vista**, después de leer lo que dice. En la fila, «mover» y
 * «compartir» serían dos clics sobre un título de tres palabras.
 */

/**
 * EL AVISO QUE NADIE ESPERA.
 *
 * Traer una página del espacio a tu libreta privada **se la saca a todos los
 * demás**, y en la pantalla de ellos simplemente desaparece. Por eso se nombra a
 * la gente en vez de preguntar «¿estás segura?», que no dice nada.
 */
function ConfirmarSacarDelEquipo({
  espacio,
  vendedoraId,
  onSi,
  onNo,
}: {
  espacio: Espacio;
  vendedoraId?: string | null;
  onSi: () => void;
  onNo: () => void;
}) {
  const otros = espacio.miembros.filter((m) => m.trim().toLowerCase() !== (vendedoraId ?? '').trim().toLowerCase());

  return (
    <div role="alertdialog" className="rounded-lg border border-border bg-card p-3 text-sm">
      <p className="font-medium text-foreground">Traerla a tu libreta la saca del espacio</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {otros.length > 0
          ? `${otros.join(', ')} dejan de verla.`
          : 'Nadie más la está viendo, así que no le saca nada a nadie.'}
      </p>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={onSi}
          className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Traerla igual
        </button>
        <button type="button" onClick={onNo} className="rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted">
          Dejarla acá
        </button>
      </div>
    </div>
  );
}

export function AccionesDePagina({
  nota,
  donde,
  espacios,
  vendedoraId,
  onMover,
  onAbrirLink,
  onCortarLink,
}: {
  nota: Nota;
  donde: DondeEstoy;
  espacios: Espacio[];
  vendedoraId?: string | null;
  onMover: (destino: DondeEstoy) => void;
  onAbrirLink: (v: { alcance: Alcance; permiso: Permiso; venceAt: string | null }) => void;
  onCortarLink: () => void;
}) {
  const [abierto, setAbierto] = useState<'mover' | 'link' | null>(null);
  const [confirmar, setConfirmar] = useState<DondeEstoy | 'no'>('no');
  const [copiado, setCopiado] = useState(false);
  // Arrancan en lo que el link YA es; si no tiene, en lo más cerrado que sirve
  // para el caso más común (mandárselo a un lead).
  const [alcance, setAlcance] = useState<Alcance>(nota.alcance ?? 'publico');
  const [permiso, setPermiso] = useState<Permiso>(nota.permiso ?? 'ver');
  const [vence, setVence] = useState(nota.venceAt ? nota.venceAt.slice(0, 10) : '');

  const hayCambios =
    Boolean(nota.token) &&
    (alcance !== (nota.alcance ?? 'publico') ||
      permiso !== (nota.permiso ?? 'ver') ||
      vence !== (nota.venceAt ? nota.venceAt.slice(0, 10) : ''));

  const espacioActual = espacios.find((e) => e.id === donde) ?? null;
  const token = nota.token ?? null;

  /**
   * La URL se compone ACÁ, con el origen del navegador.
   *
   * ⚠️ El server manda **el token**, no la URL: no conoce el origen público (la
   * UI viaja por OTA y la cáscara puede estar en otro lado), y armarla allá con
   * una env sería un lugar más donde puede quedar mal — y el síntoma sería un
   * link repartido que no abre.
   */
  const url = token ? `${window.location.origin}/n/${token}` : null;

  function pedirMover(destino: DondeEstoy) {
    // Sacar del equipo es lo único que se pregunta. Compartir hacia un espacio no
    // le quita nada a nadie, así que preguntarlo sería un clic de peaje.
    if (donde !== null && destino === null) {
      setConfirmar(destino);
      return;
    }
    onMover(destino);
    setAbierto(null);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setAbierto(abierto === 'mover' ? null : 'mover')}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <MoveRight className="size-3.5" />
        Mover
      </button>

      <button
        type="button"
        onClick={() => setAbierto(abierto === 'link' ? null : 'link')}
        aria-pressed={Boolean(token)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition ${
          token
            ? // Compartida: se dice, y se dice siempre. Una página que está afuera y
              // no lo parece es la peor forma de tener esta función.
              'border-primary bg-secondary text-foreground'
            : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <Link2 className="size-3.5" />
        {token ? 'Compartida con link' : 'Compartir con link'}
      </button>

      {confirmar !== 'no' && espacioActual && (
        <div className="w-full">
          <ConfirmarSacarDelEquipo
            espacio={espacioActual}
            vendedoraId={vendedoraId}
            onSi={() => {
              onMover(confirmar);
              setConfirmar('no');
              setAbierto(null);
            }}
            onNo={() => setConfirmar('no')}
          />
        </div>
      )}

      {abierto === 'mover' && confirmar === 'no' && (
        <div className="w-full rounded-lg border border-border bg-card p-2">
          <p className="mb-1 px-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            Llevarla a
          </p>
          <div className="space-y-0.5">
            {/* La libreta privada va primera y siempre existe, como en el selector. */}
            <button
              type="button"
              disabled={donde === null}
              onClick={() => pedirMover(null)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <Lock className="size-3.5 shrink-0" />
              <span className="flex-1 truncate">Mi libreta</span>
              {donde === null && <Check className="size-3.5" />}
            </button>

            {espacios.map((e) => (
              <button
                key={e.id}
                type="button"
                disabled={donde === e.id}
                onClick={() => pedirMover(e.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Users className="size-3.5 shrink-0" />
                <span className="flex-1 truncate">{e.nombre}</span>
                {donde === e.id && <Check className="size-3.5" />}
              </button>
            ))}

            {espacios.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                Todavía no tenés espacios. Creá uno para compartir páginas.
              </p>
            )}
          </div>
        </div>
      )}

      {abierto === 'link' && (
        <div className="w-full space-y-2.5 rounded-lg border border-border bg-card p-2.5">
          {/* QUIÉN LO ABRE. Es la primera pregunta porque cambia todo lo demás:
              con «cualquiera» no se puede editar, y punto. */}
          <div>
            <p className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
              Quién lo abre
            </p>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { v: 'goberna' as const, t: 'Solo gente de Goberna', d: 'entra con su cuenta' },
                  { v: 'publico' as const, t: 'Cualquiera con el link', d: 'sin cuenta, solo lectura' },
                ]
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  aria-pressed={alcance === o.v}
                  onClick={() => {
                    setAlcance(o.v);
                    // 🔴 Pasar a público APAGA el permiso de editar, y no es una
                    // cortesía: sin identidad no hay autoría, así que esa
                    // combinación no existe. Dejarla marcada mostraría un estado
                    // que el server va a rechazar.
                    if (o.v === 'publico') setPermiso('ver');
                  }}
                  className={`rounded-lg border px-2 py-1 text-left text-xs transition ${
                    alcance === o.v
                      ? 'border-primary bg-secondary text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span className="block font-medium">{o.t}</span>
                  <span className="block text-[0.6875rem] text-muted-foreground">{o.d}</span>
                </button>
              ))}
            </div>
          </div>

          {/* QUÉ PUEDE HACER. Solo aparece con «solo Goberna»: con público no hay
              nada que elegir, y un control deshabilitado invita a preguntarse por
              qué. */}
          {alcance === 'goberna' && (
            <div>
              <p className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                Qué puede hacer
              </p>
              <div className="flex gap-1">
                {(
                  [
                    { v: 'ver' as const, t: 'Solo ver' },
                    { v: 'editar' as const, t: 'Ver y editar' },
                  ]
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    aria-pressed={permiso === o.v}
                    onClick={() => setPermiso(o.v)}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                      permiso === o.v
                        ? 'border-primary bg-secondary text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {o.t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* VENCIMIENTO opcional. Vacío = no vence, que es el default y lo que
              corresponde al link de un lead. */}
          <div>
            <label className="mb-1 block text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
              Vence (opcional)
            </label>
            <input
              type="date"
              value={vence}
              onChange={(e) => setVence(e.target.value)}
              className="h-7 rounded border border-input bg-card px-2 text-xs outline-none focus:border-ring"
            />
          </div>

          {url ? (
            <>
              <div className="flex items-center gap-1.5">
                <input
                  readOnly
                  value={url}
                  aria-label="Link público de la página"
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-7 min-w-0 flex-1 rounded border border-input bg-muted px-2 text-xs text-foreground outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(url);
                    setCopiado(true);
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  <Copy className="size-3" />
                  {copiado ? 'Copiado' : 'Copiar'}
                </button>
              </div>

              {/* Lo que la pantalla TIENE que decir antes de que alguien lo pegue
                  en un chat. Cambia con el alcance, porque el riesgo es otro. */}
              <p className="text-[0.6875rem] text-muted-foreground">
                {alcance === 'publico'
                  ? 'Lo abre cualquiera que tenga el link, sin entrar a Hermes. Se lee, no se edita.'
                  : permiso === 'editar'
                    ? 'Solo gente de Goberna con su cuenta. Quien lo abra puede editar, y queda registrado quién fue.'
                    : 'Solo gente de Goberna con su cuenta. Se lee, no se edita.'}
              </p>

              <p className="text-[0.6875rem] text-muted-foreground">
                {nota.ultimoAccesoAt
                  ? `Se abrió por última vez el ${new Date(nota.ultimoAccesoAt).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}.`
                  : 'Todavía no lo abrió nadie.'}
              </p>

              <div className="flex gap-2">
                {hayCambios && (
                  <button
                    type="button"
                    onClick={() => onAbrirLink({ alcance, permiso, venceAt: vence || null })}
                    className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                  >
                    Guardar cambios
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onCortarLink();
                    setCopiado(false);
                  }}
                  className="flex items-center gap-1 text-xs font-medium text-destructive hover:underline"
                >
                  <Link2Off className="size-3.5" />
                  Cortar el link
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onAbrirLink({ alcance, permiso, venceAt: vence || null })}
              className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Crear el link
            </button>
          )}
        </div>
      )}
    </div>
  );
}
