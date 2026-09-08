import { lazy, Suspense, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pencil,
} from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useAppStore } from "@/lib/store";
import { useSettings } from "@/lib/settings";
import { assetRows, filterAssetRows, type AssetRow } from "@/lib/asset-view";
import { refKey } from "@/lib/operations";
import { KIND_LABEL } from "@/lib/status";
import { t, getLocale, intlLocale } from "@/lib/i18n";
import { formatDate, formatUsd } from "@/lib/utils";
import { openFromEvent } from "./asset-card";
import { Button } from "./ui/button";
import { Select } from "./ui/input";
import { StatusBadge } from "./ui/status-badge";

const AssetGraph = lazy(() => import("./asset-graph"));

export function AssetWorkspace() {
  const s = useAppStore();
  const layout = useSettings((state) => state.assetLayout);
  const rows = useMemo(
    () => filterAssetRows(assetRows(s), s.view, s.query, s.filter === "attention", s.tagFilter),
    [s],
  );
  return (
    <div className="asset-workspace">
      <div className="workspace-summary">
        <span>{t("{0} 项资产", rows.length.toLocaleString(intlLocale()))}</span>
      </div>
      {rows.length === 0 ? (
        <p className="workspace-empty">{t("没有匹配的资产")}</p>
      ) : layout === "graph" ? (
        <Suspense
          fallback={
            <p className="workspace-empty" role="status">
              {t("读取中…")}
            </p>
          }
        >
          <AssetGraph rows={rows} links={s.links} />
        </Suspense>
      ) : (
        <AssetTable rows={rows} />
      )}
    </div>
  );
}

function AssetTable({ rows }: { rows: AssetRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const locale = getLocale();
  const columns = useMemo<ColumnDef<AssetRow>[]>(() => {
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    return [
      {
        accessorKey: "name",
        header: t("名称"),
        sortingFn: (a, b) => collator.compare(a.original.name, b.original.name),
        cell: ({ row }) => (
          <button
            className="asset-name"
            onClick={(e) => openFromEvent(e, row.original.kind, row.original.id)}
          >
            <span>{row.original.name}</span>
            <small>{row.original.detail}</small>
          </button>
        ),
      },
      {
        accessorKey: "kind",
        header: t("类型"),
        cell: ({ row }) => t(KIND_LABEL[row.original.kind]),
      },
      {
        accessorKey: "status",
        header: t("状态"),
        sortingFn: (a, b) =>
          ({ offline: 0, warning: 1, online: 2 })[a.original.status] -
          { offline: 0, warning: 1, online: 2 }[b.original.status],
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "expires",
        header: t("到期 / 续费"),
        sortUndefined: "last",
        cell: ({ row }) => (row.original.expires ? formatDate(row.original.expires) : "-"),
      },
      {
        accessorKey: "cpu",
        header: "CPU",
        sortUndefined: "last",
        cell: ({ row }) => percent(row.original.cpu),
      },
      {
        accessorKey: "memory",
        header: t("内存"),
        sortUndefined: "last",
        cell: ({ row }) => percent(row.original.memory),
      },
      {
        accessorKey: "monthlyUsd",
        header: t("月费"),
        sortUndefined: "last",
        cell: ({ row }) =>
          row.original.monthlyUsd === undefined ? "-" : formatUsd(row.original.monthlyUsd),
      },
      {
        id: "tags",
        header: t("标签"),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="table-tags">
            {row.original.tags.map((tag) => (
              <button key={tag} title={tag} onClick={() => useAppStore.getState().toggleTag(tag)}>
                {tag}
              </button>
            ))}
          </div>
        ),
      },
      {
        id: "actions",
        header: t("操作"),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center">
            <Button
              size="icon-sm"
              variant="ghost"
              title={t("资产详情")}
              aria-label={t("查看 {0}", row.original.name)}
              onClick={(e) => openFromEvent(e, row.original.kind, row.original.id)}
            >
              <ExternalLink className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title={t("编辑")}
              aria-label={t("编辑 {0}", row.original.name)}
              onClick={() =>
                useAppStore.getState().openComposer(row.original.kind, row.original.id)
              }
            >
              <Pencil className="size-4" />
            </Button>
          </div>
        ),
      },
    ];
  }, [locale]);
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getRowId: refKey,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  return (
    <>
      <div className="asset-table-scroll" tabIndex={0} role="region" aria-label={t("资产表格")}>
        <table className="asset-table">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : "none"
                    }
                  >
                    {header.column.getCanSort() ? (
                      <button onClick={header.column.getToggleSortingHandler()}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === "asc" ? (
                          <ArrowUp />
                        ) : header.column.getIsSorted() === "desc" ? (
                          <ArrowDown />
                        ) : (
                          <ArrowUpDown />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} data-asset-id={row.original.id} data-asset-kind={row.original.kind}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-pagination">
        <Select
          className="w-36 text-meta"
          aria-label={t("每页条数")}
          value={String(pagination.pageSize)}
          onValueChange={(value) => table.setPageSize(Number(value))}
          options={[25, 50, 100].map((n) => ({ value: String(n), label: t("每页 {0} 项", n) }))}
        />
        <span className="ml-auto" aria-live="polite">
          {t("第 {0} / {1} 页", pagination.pageIndex + 1, table.getPageCount())}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          title={t("上一页")}
          aria-label={t("上一页")}
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title={t("下一页")}
          aria-label={t("下一页")}
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </>
  );
}

function percent(value?: number) {
  return value === undefined
    ? "-"
    : `${value.toLocaleString(intlLocale(), { maximumFractionDigits: 1 })}%`;
}
