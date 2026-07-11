import { useEffect, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { fetchPages } from './api';
import type { MetaPage } from './types';
import CampaignStep from './CampaignStep';
import AdsetStep from './AdsetStep';
import AdStep from './AdStep';
import { cardClass } from '../../lib/styles';

/**
 * Las tres etapas de Meta, en orden, porque cada una depende de la anterior:
 *   1. Campaña  — QUÉ quieres lograr (y el presupuesto)
 *   2. Conjunto — A QUIÉN le llega (público, países, optimización)
 *   3. Anuncio  — QUÉ VE la persona (imagen, texto, formulario)
 * Todo se crea PAUSADO. Nada sale al aire sin que tú lo prendas.
 */
const PASOS = [
  { n: 1, titulo: 'Campaña', sub: 'Qué quieres lograr' },
  { n: 2, titulo: 'Conjunto de anuncios', sub: 'A quién le llega' },
  { n: 3, titulo: 'Anuncio', sub: 'Qué ve la persona' },
];

interface Creado {
  accountId: string;
  campaignId: string;
  objective: string;
  hasBudget: boolean;
  adsetId?: string;
  pageId?: string;
}

export default function CampaignWizard() {
  const [paso, setPaso] = useState(1);
  const [creado, setCreado] = useState<Creado | null>(null);
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [final, setFinal] = useState<{ adId: string; adsManagerUrl: string } | null>(null);

  useEffect(() => {
    fetchPages().then(setPages);
  }, []);

  const page = pages.find((p) => p.pageId === creado?.pageId);

  if (final) {
    return (
      <div className="rounded-2xl border border-success/40 bg-success/10 p-6">
        <h2 className="font-heading text-lg font-bold text-success mb-1">Estructura completa creada</h2>
        <p className="text-sm text-foreground mb-4">
          Campaña, conjunto y anuncio — los tres en estado <strong>PAUSADO</strong>. Revisalos y prendelos tú.
        </p>
        <div className="mb-4 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
          <span>campaña · {creado?.campaignId}</span>
          <span>conjunto · {creado?.adsetId}</span>
          <span>anuncio · {final.adId}</span>
        </div>
        <a
          href={final.adsManagerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-meta-blue px-5 py-3 text-sm font-bold text-white hover:bg-meta-blue-hover"
        >
          Abrir en Ads Manager
          <ExternalLink size={14} />
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* El stepper. Los números son reales: es una secuencia con dependencias. */}
      <div className={`${cardClass} p-1`}>
        <div className="flex">
          {PASOS.map((p) => {
            const hecho = paso > p.n;
            const activo = paso === p.n;
            return (
              <div
                key={p.n}
                className={
                  'flex flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 ' +
                  (activo ? 'bg-accent' : '')
                }
              >
                <span
                  className={
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ' +
                    (hecho
                      ? 'bg-success text-white'
                      : activo
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground')
                  }
                >
                  {hecho ? <Check size={13} /> : p.n}
                </span>
                <div className="min-w-0">
                  <div
                    className={
                      'truncate text-sm font-bold ' + (activo || hecho ? 'text-foreground' : 'text-muted-foreground')
                    }
                  >
                    {p.titulo}
                  </div>
                  <div className="hidden truncate text-xs text-muted-foreground sm:block">{p.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {paso === 1 && (
        <CampaignStep
          onDone={(data) => {
            setCreado(data);
            setPaso(2);
          }}
        />
      )}

      {paso === 2 && creado && (
        <AdsetStep
          accountId={creado.accountId}
          campaignId={creado.campaignId}
          objective={creado.objective}
          campaignHasBudget={creado.hasBudget}
          pages={pages}
          onDone={(adsetId, pageId) => {
            setCreado({ ...creado, adsetId, pageId });
            setPaso(3);
          }}
        />
      )}

      {paso === 3 && creado?.adsetId && (
        <AdStep accountId={creado.accountId} adsetId={creado.adsetId} page={page} onDone={setFinal} />
      )}
    </div>
  );
}
