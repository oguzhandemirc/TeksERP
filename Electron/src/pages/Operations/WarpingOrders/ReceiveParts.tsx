// Levent kabulü diyaloğunun parçaları: levent satır editörü + sunucu önizlemesi (metre, iplik başına tüketim,
// devirden kullanılan, etkilenen her sevk kalemi, tartı). Önizlemedeki her sayı sunucudan; burada yalnız biçim.
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtKg, fmtM } from "./order-model";
import { emptyBeamDraft, MAX_RECEIVE_BEAMS, receiveYarnRows, signedKg, type ReceiveBeamDraft } from "./receive-model";
import type { WarpingReceivePreview } from "./receive-types";

const num = "text-right tabular-nums";
type Field = keyof ReceiveBeamDraft;

export function ReceiveBeamsTable({ drafts, onChange }: { drafts: ReceiveBeamDraft[]; onChange: (d: ReceiveBeamDraft[]) => void }) {
  const set = (i: number, k: Field, v: string) => onChange(drafts.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const cell = (i: number, k: Field, label: string, decimal = true) => (
    <Input aria-label={`${i + 1}. levent ${label}`} className={cn("h-8", decimal && "text-right")} inputMode={decimal ? "decimal" : undefined}
      maxLength={decimal ? 12 : 32} value={drafts[i]?.[k] ?? ""} onChange={(e) => set(i, k, e.target.value)} />
  );
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead title="Leventin üzerindeki numara (isteğe bağlı)">Gövde no</TableHead>
              <TableHead className="w-32 text-right">Metre</TableHead>
              <TableHead className="w-28 text-right" title="İsteğe bağlı tartı — tüketimi değiştirmez">Brüt kg</TableHead>
              <TableHead className="w-28 text-right" title="Boş levent ağırlığı (isteğe bağlı)">Dara kg</TableHead>
              <TableHead className="w-10"><span className="sr-only">Sil</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drafts.map((_, i) => (
              <TableRow key={i}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell>{cell(i, "physicalBeamNo", "gövde no", false)}</TableCell>
                <TableCell>{cell(i, "lengthM", "metre")}</TableCell>
                <TableCell>{cell(i, "grossKg", "brüt kg")}</TableCell>
                <TableCell>{cell(i, "tareKg", "dara kg")}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`${i + 1}. leventi sil`} disabled={drafts.length === 1}
                    onClick={() => onChange(drafts.filter((_row, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Button size="sm" variant="outline" disabled={drafts.length >= MAX_RECEIVE_BEAMS} onClick={() => onChange([...drafts, emptyBeamDraft(drafts.at(-1)?.lengthM ?? "")])}>
        <Plus className="mr-1 h-4 w-4" /> Levent ekle
      </Button>
    </div>
  );
}

function MetreLine({ p }: { p: WarpingReceivePreview }) {
  const m = p.before.metre;
  return (
    <p>
      Hedef <b>{fmtM(m.targetM)} m</b> ({m.planBeamCount} levent) · şimdiye kadar {fmtM(m.receivedM)} m · bu kabul <b>{fmtM(p.incoming.lengthM)} m</b> ({p.incoming.beamCount} levent)
      {" → "}gelen <b>{fmtM(p.after.receivedM)} m</b>, fark <span className={cn(Number(p.after.diffM) < 0 && "text-amber-700 dark:text-amber-400")}>{signedKg(p.after.diffM, fmtM)} m</span>
    </p>
  );
}

function YarnTable({ p }: { p: WarpingReceivePreview }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table aria-label="İplik başına tüketim">
        <TableHeader>
          <TableRow>
            <TableHead>İplik</TableHead>
            <TableHead className={num} title="Bu kabulün leventlerine sarılan (tel × denye × metre)">Bu kabulde sarılan</TableHead>
            <TableHead className={num} title="Başka (kapanmış) siparişin deverecide kalan ipliğinden düşen kısım">Devirden kullanılan</TableHead>
            <TableHead className={num} title="Deverecideki iplikten fazla tüketim — hiçbir sevke düşülemedi">Dağıtılamayan (sonra)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {receiveYarnRows(p).map((y) => (
            <TableRow key={y.yarnItemId}>
              <TableCell><span className="font-medium">{y.name}</span> <span className="text-xs text-muted-foreground">{y.code}</span></TableCell>
              <TableCell className={num}>{fmtKg(y.woundKg)}</TableCell>
              <TableCell className={num}>{y.carryOverKg > 0 ? fmtKg(y.carryOverKg) : "—"}</TableCell>
              <TableCell className={cn(num, Number(y.unallocatedAfterKg) > 0 && "font-medium text-destructive")}>{Number(y.unallocatedAfterKg) > 0 ? fmtKg(y.unallocatedAfterKg) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AllocationList({ p }: { p: WarpingReceivePreview }) {
  if (p.allocations.length === 0) return null;
  const name = new Map(p.before.yarns.map((y) => [y.yarnItemId, y.name]));
  return (
    <ul className="space-y-0.5 rounded-md border p-3 text-xs text-muted-foreground" aria-label="Etkilenen sevk kalemleri">
      {p.allocations.map((a, i) => (
        <li key={i}>
          {a.beamIndex + 1}. levent · {name.get(a.yarnItemId) ?? "iplik"} — {fmtKg(a.kg)} kg {a.dispatchNo} ({a.lotNo ? `lot ${a.lotNo}` : "lotsuz"}) sevkinden düşer
          {a.carryOver && <b className="text-foreground"> · devir: {a.holderOrderNo ?? "başka sipariş"}</b>}
        </li>
      ))}
    </ul>
  );
}

function WeighTable({ p }: { p: WarpingReceivePreview }) {
  if (!p.beams.some((b) => b.weighedNetKg !== null)) return null;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table aria-label="Tartı">
        <TableHeader>
          <TableRow>
            <TableHead>Levent</TableHead>
            <TableHead className={num}>Metre</TableHead>
            <TableHead className={num} title="Tel × denye × metre">Hesap kg</TableHead>
            <TableHead className={num} title="Brüt − dara">Tartı net kg</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.beams.map((b) => (
            <TableRow key={b.index}>
              <TableCell>{b.index + 1}.</TableCell>
              <TableCell className={num}>{fmtM(b.lengthM)}</TableCell>
              <TableCell className={num}>{fmtKg(b.nominalKg)}</TableCell>
              <TableCell className={num}>{b.weighedNetKg === null ? "—" : fmtKg(b.weighedNetKg)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ReceivePreviewView({ p }: { p: WarpingReceivePreview }) {
  return (
    <div className="space-y-2" aria-label="Kabul önizlemesi">
      <MetreLine p={p} />
      <YarnTable p={p} />
      <AllocationList p={p} />
      <WeighTable p={p} />
      {p.warnings.length > 0 && (
        <Callout tone="warning" title="Kontrol edin">
          <ul className="list-disc space-y-0.5 pl-4" aria-label="Uyarılar">{p.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Callout>
      )}
      <p className="text-xs text-muted-foreground">Tüketim tel × denye × metreden hesaplanır; tartı yalnız bilgi olarak saklanır.</p>
    </div>
  );
}
