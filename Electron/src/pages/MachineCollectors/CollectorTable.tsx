// Kart listesi — ad · tip · bağlı tezgahlar · durum · sır veriliş · son görülme. İptal edilmiş kartta eylem yok
// (sunucu da 409 `COLLECTOR_REVOKED` der). Saatler fabrika diliminden (`formatFactory`).
import { KeyRound, Pencil, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { formatFactory } from "@/lib/factory-time";
import { machineList } from "./collector-model";
import type { MachineCollector } from "./types";

interface Props {
  rows: MachineCollector[];
  busy: boolean;
  onEdit: (c: MachineCollector) => void;
  onRotate: (c: MachineCollector) => void;
  onRevoke: (c: MachineCollector) => void;
}

function StatusBadge({ c }: { c: MachineCollector }) {
  if (c.revokedAt) return <Badge variant="muted">İptal</Badge>;
  if (c.silentSince) return <Badge variant="destructive">Sessiz</Badge>;
  return <Badge>Etkin</Badge>;
}

const ts = (v: string | null) => formatFactory(v, "dd.MM.yyyy HH:mm");

export function CollectorTable({ rows, busy, onEdit, onRotate, onRevoke }: Props) {
  if (rows.length === 0) return <p className="py-16 text-center text-muted-foreground">Kayıtlı kart yok. Yeni kart kaydıyla başlayın.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="border-b text-left text-xs text-muted-foreground">
        <tr>
          <th className="px-3 py-2">Kart</th><th className="px-3 py-2">Kart tipi</th><th className="px-3 py-2">Tezgahlar</th>
          <th className="px-3 py-2">Durum</th><th className="px-3 py-2">Sır verildi</th><th className="px-3 py-2">Son görülme</th><th />
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="border-b last:border-0">
            <td className="px-3 py-2 font-medium">{c.name}</td>
            <td className="px-3 py-2 font-mono text-xs">{c.collectorType ?? "—"}</td>
            <td className="px-3 py-2 text-xs">{machineList(c)}</td>
            <td className="px-3 py-2"><StatusBadge c={c} /></td>
            <td className="px-3 py-2 text-xs">{ts(c.secretIssuedAt)}</td>
            <td className="px-3 py-2 text-xs">{ts(c.lastSeenAt)}</td>
            <td className="px-3 py-2 text-right">
              {!c.revokedAt && (
                <PermissionGate permission="loom:spec-manage">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onEdit(c)} title="Düzenle"><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRotate(c)} title="Sırrı yenile"><KeyRound className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRevoke(c)} title="Kartı iptal et"><Ban className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </PermissionGate>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
