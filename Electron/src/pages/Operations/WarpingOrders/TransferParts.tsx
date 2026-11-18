// Aktarma diyaloğunun parçaları: tutma satırı başına kg tablosu + sunucu önizlemesinin etkilenen kalem listesi.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { checkKg, yarnCode, type TransferDraftRow, type YarnNames } from "./holding-model";
import { fmtKg } from "./order-model";
import type { WarpingTransferPreview } from "./holding-types";

const num = "text-right tabular-nums";
const kgText = (v: string) => String(Number(v)).replace(".", ",");

export function TransferDraftTable({ drafts, names, onChange }: { drafts: TransferDraftRow[]; names: YarnNames; onChange: (d: TransferDraftRow[]) => void }) {
  const set = (i: number, qtyKg: string) => onChange(drafts.map((d, j) => (j === i ? { ...d, qtyKg } : d)));
  if (drafts.length === 0) return <p className="text-muted-foreground">Deverecide aktarılabilecek iplik yok.</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>İplik</TableHead>
            <TableHead>Sevk · lot</TableHead>
            <TableHead className={num}>Deverecide kg</TableHead>
            <TableHead className="w-44 text-right">Aktarılacak kg</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {drafts.map((d, i) => {
            const h = d.holding;
            const code = yarnCode(names, h.yarnItemId);
            const c = d.qtyKg.trim() === "" ? null : checkKg(d.qtyKg, h.holdingKg);
            return (
              <TableRow key={h.dispatchItemId}>
                <TableCell>{code} <span className="text-muted-foreground">{names.get(h.yarnItemId)?.name}</span></TableCell>
                <TableCell>{h.dispatchNo}{h.own ? "" : " (aktarımla gelen)"} · {h.lotNo ?? "lotsuz"}</TableCell>
                <TableCell className={num}>{fmtKg(h.holdingKg)}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Input aria-label={`${code} ${h.dispatchNo} aktarılacak kg`} aria-invalid={c !== null && !c.ok} inputMode="decimal" className="h-8 w-24 text-right" value={d.qtyKg} onChange={(e) => set(i, e.target.value)} />
                    <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => set(i, kgText(h.holdingKg))}>Tümü</Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function TransferPreviewList({ p, names, targetNo }: { p: WarpingTransferPreview; names: YarnNames; targetNo: string }) {
  return (
    <ul className="space-y-1 rounded-md border p-3" aria-label="Etkilenen kayıtlar">
      <li><b>{fmtKg(p.totalKg)} kg</b> → {targetNo}</li>
      {p.allocations.map((a) => (
        <li key={a.dispatchItemId} className="text-muted-foreground">
          {yarnCode(names, a.yarnItemId)} · {a.dispatchNo} · {a.lotNo ? `lot ${a.lotNo}` : "lotsuz"} — {fmtKg(a.qtyKg)} kg {targetNo} siparişine sayılır
        </li>
      ))}
    </ul>
  );
}
