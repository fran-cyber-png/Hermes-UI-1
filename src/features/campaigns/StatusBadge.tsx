const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-success/10 text-success',
  PAUSED: 'bg-muted text-muted-foreground',
  DELETED: 'bg-destructive/10 text-destructive',
  ARCHIVED: 'bg-destructive/10 text-destructive',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activa',
  PAUSED: 'Pausada',
  DELETED: 'Eliminada',
  ARCHIVED: 'Archivada',
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ' +
        (STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground')
      }
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
