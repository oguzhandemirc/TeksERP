// Desen kartları — tablo sütunları (ortak DataTable).
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { WEAVE_KIND_LABEL } from "./types";
import type { weaveDesignApi } from "./service";

type WeaveDesignRow = Awaited<ReturnType<typeof weaveDesignApi.list>>[number];
const right = (label: string) => ({ label, align: "right" as const });

export const WEAVE_DESIGN_COLUMNS: ColumnDef<WeaveDesignRow>[] = [
  { id: "code", header: "Kod", meta: { label: "Kod" }, accessorFn: (r) => r.code, cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
  { id: "name", header: "Ad", size: 220, meta: { label: "Ad" }, accessorFn: (r) => r.name },
  { id: "kind", header: "Örgü", meta: { label: "Örgü" }, accessorFn: (r) => WEAVE_KIND_LABEL[r.kind] ?? r.kind },
  { id: "family", header: "Aile", meta: { label: "Aile" }, accessorFn: (r) => r.familyLabel ?? "—" },
  { id: "frames", header: "Çerçeve", meta: right("Çerçeve"), accessorFn: (r) => r.frameCount ?? "—" },
  { id: "repeat", header: "Desen boyu (cm)", meta: right("Desen boyu (cm)"), accessorFn: (r) => r.repeatCm ?? "—" },
  {
    id: "active",
    header: "Durum",
    meta: { label: "Durum", exportValue: (r) => (r.isActive ? "Aktif" : "Pasif") },
    accessorFn: (r) => r.isActive,
    cell: ({ row }) => (row.original.isActive ? <Badge variant="default">Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];
