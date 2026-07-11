import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import StructureTree from '../features/campaigns/StructureTree';
import DateRangePicker from '../features/campaigns/DateRangePicker';
import type { DatePreset } from '../features/campaigns/types';

export default function CampaignStructurePage() {
  const { campaignId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const datePreset = (params.get('rango') as DatePreset) ?? 'last_30d';

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to="/campanas"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Campañas
      </Link>

      <h1 className="font-heading text-2xl font-bold text-navy mb-1">Las tres etapas</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Campaña, conjuntos y anuncios — con la plata en cada nivel. Tocá un conjunto para abrirlo.
      </p>

      <div className="mb-5">
        <DateRangePicker
          value={datePreset}
          onChange={(v) => setParams({ rango: v }, { replace: true })}
        />
      </div>

      <StructureTree campaignId={campaignId} datePreset={datePreset} />
    </div>
  );
}
