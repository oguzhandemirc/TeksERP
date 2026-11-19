// Kapanış diyaloğunun parçaları: kalem başına İADE / FİRE / DEVERECİDE KALIR editörü (iade satırında depo) + sunucu
// önizlemesi (iplik başına sarılan · iade · fire · kalır · fire %, tolerans rozeti). Önizleme sayıları sunucudan.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { cn } from "@/lib/utils";
import { yarnCode, yarnTitle, type YarnNames } from "./holding-model";
import { fmtKg, parseNum } from "./order-model";
import { fillLine, keepOf, pctText, type Bucket, type SettleLineDraft } from "./settle-model";
import { SourcePicker } from "./YarnSourcePickers";
import type { PickedRef } from "./dispatch-model";
import type { WarpingSettlePreview } from "./settle-types";

const num = "text-right tabular-nums";
const BUCKETS: Array<{ b: Bucket; label: string }> = [{ b: "return", label: "İade" }, { b: "keep", label: "Kalır" }, { b: "waste", label: "Fire" }];

function WarehouseCell({ d, exitName, onChange }: { d: SettleLineDraft; exitName: string; onChange: (w: PickedRef | null) => void }) {
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  if (!((parseNum(d.returnKg) ?? 0) > 0)) return <span className="text-muted-foreground">—</span>;
  if (!multiWarehouse) return <span>{exitName}</span>;
  return (
    <SourcePicker title="İade deposu" description="İade edilen iplik bu depoya girer." placeholder={exitName} ariaLabel={`${d.line.dispatchNo} iade deposu seç`}
      value={d.warehouse} onChange={onChange} clearable queryKey={["warping-settle", "warehouses", warehouses.length]} emptyText="Aktif depo yok."
      load={async () => warehouses.map((w) => ({ id: w.id, label: w.name, hint: w.code, balanceKg: null }))} />
  );
}

/** İplik hücresi: ADI birincil; stok kodu (+ sevk/lot) küçük ikincil satırda. */
function YarnNameCell({ names, yarnItemId, extra, fallbackCode }: { names?: YarnNames; yarnItemId: string; extra?: string; fallbackCode?: string }) {
  const t = names ? yarnTitle(names, yarnItemId) : { primary: fallbackCode ?? "iplik", secondary: null };
  const second = [t.secondary, extra].filter(Boolean).join(" · ");
  return (
    <div className="leading-tight">
      <div className="font-medium">{t.primary === "iplik" && fallbackCode ? fallbackCode : t.primary}</div>
      {second && <div className="text-xs text-muted-foreground">{second}</div>}
    </div>
  );
}

interface LinesProps { drafts: SettleLineDraft[]; names: YarnNames; exitNames: Map<string, string>; onChange: (d: SettleLineDraft[]) => void }

export function SettleLinesTable({ drafts, names, exitNames, onChange }: LinesProps) {
  const set = (i: number, patch: Partial<SettleLineDraft>) => onChange(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  if (drafts.length === 0) return <p className="text-muted-foreground">Deverecide bu siparişe ait iplik kalmadı — yalnız sipariş kapanır.</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table aria-label="Kalan iplik">
        <TableHeader>
          <TableRow>
            <TableHead>İplik · sevk · lot</TableHead>
            <TableHead className={num}>Deverecide</TableHead>
            <TableHead className="w-36">Tümü</TableHead>
            <TableHead className="min-w-24 text-right">İade kg</TableHead>
            <TableHead className="min-w-24 text-right">Fire kg</TableHead>
            <TableHead className={cn(num, "whitespace-nowrap")} title="Deverecide kalır, sonraki siparişe devreder">Kalır kg</TableHead>
            <TableHead className="whitespace-nowrap">İade deposu</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {drafts.map((d, i) => {
            const keep = keepOf(d);
            const label = `${yarnCode(names, d.line.yarnItemId)} ${d.line.dispatchNo}`;
            return (
              <TableRow key={d.line.dispatchItemId}>
                <TableCell className="min-w-0">
                  <YarnNameCell names={names} yarnItemId={d.line.yarnItemId} extra={`${d.line.dispatchNo} · ${d.line.lotNo ? `lot ${d.line.lotNo}` : "lotsuz"}${d.line.own ? "" : " · aktarımla gelen"}`} />
                </TableCell>
                <TableCell className={num}>{fmtKg(d.line.holdingKg)}</TableCell>
                <TableCell>
                  <div className="flex gap-1" role="group" aria-label={`${label} tümünü`}>
                    {BUCKETS.map((x) => (
                      <Button key={x.b} size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => set(i, fillLine(d, x.b))}>{x.label}</Button>
                    ))}
                  </div>
                </TableCell>
                <TableCell><Input aria-label={`${label} iade kg`} className="h-8 min-w-20 text-right" inputMode="decimal" value={d.returnKg} onChange={(e) => set(i, { returnKg: e.target.value })} /></TableCell>
                <TableCell><Input aria-label={`${label} fire kg`} className="h-8 min-w-20 text-right" inputMode="decimal" value={d.wasteKg} onChange={(e) => set(i, { wasteKg: e.target.value })} /></TableCell>
                <TableCell className={cn(num, (keep === null || keep < 0) && "text-destructive")}>{keep === null ? "?" : fmtKg(keep)}</TableCell>
                <TableCell><WarehouseCell d={d} exitName={exitNames.get(d.line.dispatchItemId) ?? "çıkış deposu"} onChange={(w) => set(i, { warehouse: w })} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

const OverBadge = ({ text }: { text: string }) => <Badge className="bg-amber-100 font-normal text-amber-800 dark:bg-amber-950 dark:text-amber-300">{text}</Badge>;

export function SettlePreviewView({ p, names }: { p: WarpingSettlePreview; names?: YarnNames }) {
  const plan = p.plan;
  return (
    <div className="space-y-2" aria-label="Kapanış önizlemesi">
      <p>
        Fire genel <b>{pctText(plan.wastePct)}</b>{plan.tolerancePct !== null && Number(plan.tolerancePct) > 0 ? ` · tolerans ${pctText(plan.tolerancePct)}` : " · tolerans denetimi yok"}{" "}
        {plan.overTolerance && <OverBadge text={plan.yarns.some((y) => y.overTolerance) ? `Toleransı aşan iplik: ${plan.yarns.filter((y) => y.overTolerance).map((y) => (names && names.get(y.yarnItemId)?.name) || y.code).join(", ")}` : "Tolerans aşıldı"} />}
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="İplik başına kapanış">
          <TableHeader>
            <TableRow>
              <TableHead>İplik</TableHead>
              <TableHead className={num} title="Dönen leventlere sarılan (hesap)">Sarılan</TableHead>
              <TableHead className={num}>Deverecide</TableHead>
              <TableHead className={num}>İade</TableHead>
              <TableHead className={num}>Fire</TableHead>
              <TableHead className={num}>Kalır</TableHead>
              <TableHead className={num} title="Fire / (sarılan + fire)">Fire %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.yarns.map((y) => (
              <TableRow key={y.yarnItemId}>
                <TableCell><YarnNameCell names={names} yarnItemId={y.yarnItemId} fallbackCode={y.code} /></TableCell>
                <TableCell className={num}>{fmtKg(y.woundKg)}</TableCell>
                <TableCell className={num}>{fmtKg(y.holdingKg)}</TableCell>
                <TableCell className={num}>{fmtKg(y.returnKg)}</TableCell>
                <TableCell className={num}>{fmtKg(y.wasteKg)}</TableCell>
                <TableCell className={num}>{fmtKg(y.keepKg)}</TableCell>
                <TableCell className={cn(num, y.overTolerance && "font-medium text-amber-700 dark:text-amber-400")}>{pctText(y.wastePct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
