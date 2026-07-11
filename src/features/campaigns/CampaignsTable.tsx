import { useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CampaignRow } from './campaignRows';
import StatusBadge from './StatusBadge';
import { cardClass, cardHeaderClass } from '../../lib/styles';

const numberFmt = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const columnHelper = createColumnHelper<CampaignRow>();

const columns = [
  columnHelper.accessor('name', {
    header: 'Campaña',
    cell: (info) => (
      <Link to={`/campanas/${info.row.original.id}`} className="block min-w-0 group">
        <div className="truncate font-semibold text-foreground group-hover:text-primary group-hover:underline">
          {info.getValue()}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {info.row.original.accountName} · {info.row.original.objectiveLabel}
        </div>
      </Link>
    ),
  }),
  columnHelper.accessor('status', {
    header: 'Estado',
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  columnHelper.accessor('spend', {
    header: 'Gasto',
    cell: (info) => <span className="font-mono">{numberFmt(info.getValue())}</span>,
  }),
  columnHelper.accessor('resultCount', {
    header: 'Resultados',
    cell: (info) => (
      <div>
        <div className="font-mono">{info.getValue() ?? '—'}</div>
        <div className="text-xs text-muted-foreground">{info.row.original.resultLabel}</div>
      </div>
    ),
  }),
  columnHelper.accessor('costPerResult', {
    header: 'Costo/resultado',
    cell: (info) => <span className="font-mono">{numberFmt(info.getValue())}</span>,
  }),
];

interface Props {
  rows: CampaignRow[];
  loading: boolean;
}

export default function CampaignsTable({ rows, loading }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'spend', desc: true }]);
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      const needle = String(filterValue).toLowerCase();
      return (
        row.original.name.toLowerCase().includes(needle) || row.original.accountName.toLowerCase().includes(needle)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  });

  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div className={cardClass}>
      <div className={`${cardHeaderClass} flex items-center justify-between`}>
        <span>{loading ? 'Cargando campañas...' : `${filteredCount} campañas`}</span>
      </div>

      <div className="border-b border-border p-3">
        <div className="relative max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Buscar campaña o cuenta..."
            className="w-full rounded-lg border border-border bg-muted py-1.5 pl-8 pr-3 text-sm text-foreground"
          />
        </div>
      </div>

      {!loading && rows.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">No hay campañas en las cuentas elegidas.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-border">
                  {headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        onClick={header.column.getToggleSortingHandler()}
                        className="cursor-pointer select-none whitespace-nowrap px-4 py-2 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground"
                      >
                        <span className="inline-flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' && <ChevronUp size={12} />}
                          {sorted === 'desc' && <ChevronDown size={12} />}
                          {!sorted && <ChevronsUpDown size={12} className="opacity-40" />}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="rounded-lg border border-border p-1.5 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="rounded-lg border border-border p-1.5 disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
