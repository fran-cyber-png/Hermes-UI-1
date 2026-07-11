import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import CampaignWizard from '../features/campaigns/CampaignWizard';

export default function NewCampaignPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to="/campanas"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Campañas
      </Link>
      <h1 className="font-heading text-2xl font-bold text-navy mb-1">Crear anuncio</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Las tres etapas de Meta, de una sola vez. Todo se crea pausado.
      </p>
      <div className="max-w-2xl">
        <CampaignWizard />
      </div>
    </div>
  );
}
