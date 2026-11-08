// Emanet çıkış listesi tablosu — satır tıklaması detayı açar. Sayılar sunucudan (string), istemci toplamaz.
import { Badge } from "@/components/ui/badge";
import { formatFactory } from "@/lib/factory-time";
import { fmtNum } from "./consignmentText";
import type { ConsignmentDispatchListRow } from "./types";

export function ConsignmentDispatchTable({
  rows,
  onOpen,
}: {
  rows: ConsignmentDispatchListRow[];
  onOpen: (id: string) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase text-muted-foreground">
        <tr>
          <th className="p-3 text-left">Belge No</th>
          <th className="p-3 text-left">Tarih</th>
          <th className="p-3 text-left">Müşteri</th>
          <th className="p-3 text-right">Levent</th>
          <th className="p-3 text-right">Levent metre</th>
          <th className="p-3 text-right">İplik kg</th>
          <th className="p-3 text-left">Durum</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onOpen(r.id)}>
            <td className="p-3 font-mono text-xs">{r.dispatchNo}</td>
            <td className="p-3">{formatFactory(r.dispatchedAt, "dd MMM yyyy HH:mm")}</td>
            <td className="p-3">{r.ownerCustomer.name}</td>
            <td className="p-3 text-right tabular-nums">{r.beamCount}</td>
            <td className="p-3 text-right tabular-nums">{fmtNum(r.beamLengthM)}</td>
            <td className="p-3 text-right tabular-nums">{fmtNum(r.yarnKg)}</td>
            <td className="p-3">
              {r.cancelledAt ? <Badge variant="outline">İptal</Badge> : <Badge>Geçerli</Badge>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
