// Kart listesi sütunları — ad · tip · bağlı tezgahlar · durum · sır veriliş · son görülme. İptal edilmiş kartta eylem yok
// (sunucu da 409 `COLLECTOR_REVOKED` der). Saatler fabrika diliminden (`formatFactory`).
import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound, Pencil, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { formatFactory } from "@/lib/factory-time";
import { machineList } from "./collector-model";
import type { MachineCollector } from "./types";

interface Actions {
  busy: boolean;
  onEdit: (c: MachineCollector) => void;
  onRotate: (c: MachineCollector) => void;
  onRevoke: (c: MachineCollector) => void;
}

const statusText = (c: MachineCollector) => (c.revokedAt ? "İptal" : c.silentSince ? "Sessiz" : "Etkin");
function StatusBadge({ c }: { c: MachineCollector }) {
  if (c.revokedAt) return <Badge variant="muted">İptal</Badge>;
  if (c.silentSince) return <Badge variant="destructive">Sessiz</Badge>;
  return <Badge>Etkin</Badge>;
}

const ts = (v: string | null) => formatFactory(v, "dd.MM.yyyy HH:mm");

const BASE: ColumnDef<MachineCollector>[] = [
  { id: "name", header: "Kart", meta: { label: "Kart" }, accessorFn: (c) => c.name, cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
  { id: "type", header: "Kart tipi", meta: { label: "Kart tipi" }, accessorFn: (c) => c.collectorType ?? "—", cell: ({ row }) => <span className="font-mono text-xs">{row.original.collectorType ?? "—"}</span> },
  { id: "machines", header: "Tezgahlar", size: 220, meta: { label: "Tezgahlar" }, accessorFn: machineList, cell: ({ row }) => <span className="text-xs">{machineList(row.original)}</span> },
  { id: "status", header: "Durum", meta: { label: "Durum", exportValue: statusText }, accessorFn: statusText, cell: ({ row }) => <StatusBadge c={row.original} /> },
  { id: "secretIssuedAt", header: "Sır verildi", meta: { label: "Sır verildi", exportValue: (c) => ts(c.secretIssuedAt) }, accessorFn: (c) => c.secretIssuedAt, cell: ({ row }) => <span className="text-xs">{ts(row.original.secretIssuedAt)}</span> },
  { id: "lastSeenAt", header: "Son görülme", meta: { label: "Son görülme", exportValue: (c) => ts(c.lastSeenAt) }, accessorFn: (c) => c.lastSeenAt, cell: ({ row }) => <span className="text-xs">{ts(row.original.lastSeenAt)}</span> },
];

export function collectorColumns({ busy, onEdit, onRotate, onRevoke }: Actions): ColumnDef<MachineCollector>[] {
  return [
    ...BASE,
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      meta: { label: "İşlem", align: "right" },
      cell: ({ row: { original: c } }) =>
        c.revokedAt ? null : (
          <PermissionGate permission="loom:spec-manage">
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => onEdit(c)} title="Düzenle"><Pencil className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => onRotate(c)} title="Sırrı yenile"><KeyRound className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => onRevoke(c)} title="Kartı iptal et"><Ban className="h-4 w-4 text-destructive" /></Button>
            </div>
          </PermissionGate>
        ),
    },
  ];
}
