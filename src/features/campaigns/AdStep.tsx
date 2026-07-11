import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { createAd, fetchAdImages } from './api';
import type { AdImage, MetaPage } from './types';
import { cardClass, cardHeaderClass, fieldClass, sectionLabel } from '../../lib/styles';

const CALL_TO_ACTIONS = [
  { value: 'SIGN_UP', label: 'Registrarte' },
  { value: 'LEARN_MORE', label: 'Más información' },
  { value: 'DOWNLOAD', label: 'Descargar' },
  { value: 'APPLY_NOW', label: 'Postularte' },
  { value: 'GET_QUOTE', label: 'Solicitar información' },
];

interface Props {
  accountId: string;
  adsetId: string;
  page: MetaPage | undefined;
  onDone: (result: { adId: string; adsManagerUrl: string }) => void;
}

export default function AdStep({ accountId, adsetId, page, onDone }: Props) {
  const [images, setImages] = useState<AdImage[]>([]);
  const [name, setName] = useState('');
  const [imageHash, setImageHash] = useState('');
  const [message, setMessage] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [leadFormId, setLeadFormId] = useState('');
  const [callToAction, setCallToAction] = useState('SIGN_UP');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    fetchAdImages(accountId).then(setImages);
  }, [accountId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!page) return;
    setSubmitting(true);
    setErrors([]);

    const res = await createAd({
      accountId,
      adsetId,
      name,
      pageId: page.pageId,
      instagramId: page.instagramId,
      imageHash,
      message,
      headline,
      description,
      leadFormId,
      callToAction,
    });
    setSubmitting(false);

    if (res.type === 'success') onDone({ adId: res.adId, adsManagerUrl: res.adsManagerUrl });
    else if (res.type === 'validation_error') setErrors(res.errors);
    else setErrors([res.message]);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className={cardClass}>
        <div className={`${cardHeaderClass} flex items-center justify-between`}>
          <span>La imagen</span>
          <span className="text-xs font-normal text-navy-muted">{images.length} ya subidas a la cuenta</span>
        </div>
        <div className="p-5">
          {images.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Esta cuenta no tiene imágenes cargadas. Subí una desde Ads Manager y volvé.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {images.map((img) => (
                <button
                  type="button"
                  key={img.hash}
                  onClick={() => setImageHash(img.hash)}
                  title={`${img.name} · ${img.width}×${img.height}`}
                  className={
                    'aspect-square overflow-hidden rounded-lg border-2 transition-colors ' +
                    (imageHash === img.hash ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50')
                  }
                >
                  <img src={img.url} alt={img.name} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={cardClass}>
        <div className={cardHeaderClass}>Qué dice el anuncio</div>
        <div className="flex flex-col gap-4 p-5">
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Texto principal</span>
            <textarea
              className={`${fieldClass} min-h-24 resize-y`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Lo primero que lee la persona. Contale qué gana."
              required
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={sectionLabel}>Titular</span>
              <input className={fieldClass} value={headline} onChange={(e) => setHeadline(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={sectionLabel}>Descripción</span>
              <input
                className={fieldClass}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>

      <div className={cardClass}>
        <div className={cardHeaderClass}>A dónde va la persona</div>
        <div className="flex flex-col gap-4 p-5">
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Formulario</span>
            <select className={fieldClass} value={leadFormId} onChange={(e) => setLeadFormId(e.target.value)} required>
              <option value="">— Elige el formulario que se abre —</option>
              {(page?.leadForms ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.leadsCount > 0 ? ` · ${f.leadsCount} leads` : ''}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              Los que ya tienen leads son formularios probados: sabes que la gente los completa.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Botón</span>
            <select
              className={fieldClass}
              value={callToAction}
              onChange={(e) => setCallToAction(e.target.value)}
            >
              {CALL_TO_ACTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Nombre del anuncio</span>
            <input
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Temario, Ponentes, flyer..."
              required
            />
            <span className="text-xs text-muted-foreground">
              Este nombre es el que después vas a ver en el costo por lead. Ponele algo que distinga la pieza.
            </span>
          </label>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <ul className="list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !imageHash}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
      >
        {submitting ? 'Creando anuncio...' : 'Crear anuncio'}
        {!submitting && <ExternalLink size={14} />}
      </button>
    </form>
  );
}
