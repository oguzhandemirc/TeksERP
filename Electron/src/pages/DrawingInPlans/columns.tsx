// Tahar planları — tablo sütunları (sunucu düz liste, sıralama sunucuda: ada göre).
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DrawingInPreview } from "./DrawingInPreview";
import type { DrawingInPlan } from "./types";

export const drawingInPlanColumns: ColumnDef<DrawingInPlan>[] = [
  { id: "code", header: "Kod", meta: { label: "Kod" }, accessorFn: (r) => r.code, cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
  { id: "name", header: "Tahar planı", size: 200, meta: { label: "Tahar planı" }, accessorFn: (r) => r.name },
  { id: "frames", header: "Çerçeve", meta: { label: "Çerçeve", align: "right" }, accessorFn: (r) => r.frameCount },
  { id: "notation", header: "Tahar dizisi", size: 220, meta: { label: "Tahar dizisi" }, accessorFn: (r) => r.notation, cell: ({ row }) => <span className="font-mono text-xs">{row.original.notation}</span> },
  { id: "ends", header: "Tel (rapor)", meta: { label: "Tel (rapor)", align: "right" }, accessorFn: (r) => r.threading.length },
  {
    id: "preview",
    header: "Görünüm",
    enableSorting: false,
    meta: { label: "Görünüm", exportValue: (r) => r.notation },
    cell: ({ row }) => <DrawingInPreview compact frameCount={row.original.frameCount} threading={row.original.threading} />,
  },
  { id: "fabrics", header: "Kumaş", meta: { label: "Kumaş", align: "right" }, accessorFn: (r) => r._count?.fabricItems ?? 0 },
  {
    id: "active",
    header: "Durum",
    meta: { label: "Durum", exportValue: (r) => (r.isActive ? "Aktif" : "Pasif") },
    accessorFn: (r) => r.isActive,
    cell: ({ row }) => (row.original.isActive ? <Badge variant="default">Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];
