// İplik planı tablosu — iplik başına tel · denye · formül (firesiz) kg · fireli öneri kg (yalnız fire varken) · depoda kg
// (yalnız önizlemede, iplik modülü açıkken). Sayılar sunucudan; burada yalnız biçim ve sütun görünürlüğü.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatQty } from "@/lib/format";
import { wasteSourceText, yarnOwnWasteNote } from "@/pages/Operations/WarpPlan/yarn-waste-note";
import { fmtKg } from "./order-model";
import type { WarpingPlanYarn } from "./types";

export type PlanRow = WarpingPlanYarn & { letter?: string; depoKg?: string | null };

interface Props {
  yarns: PlanRow[];
  hasWaste: boolean;
  /** `endsCount` yalnız kayıtlı siparişte (sunucu toplar); önizlemede boş kalır — istemci toplamaz. */
  totals: { netKg: string; grossKg: string; endsCount?: number };
  /** Depo sütunu: önizlemede iplik modülü açıksa (`stock.known`). */
  showStock?: boolean;
  /** Kayıtlı siparişte fire kaynağı (sipariş saklamaz; `useOrderWasteSource`); önizlemede satırın `wasteSource`u. */
  sourceOf?: (y: PlanRow) => string | null;
}

/** Görünür sütunlar — tek kaynak; test de buradan ölçer. Fire sütunu fireli öneriyle birlikte görünür. */
export function planColumns(p: Pick<Props, "hasWaste" | "showStock" | "yarns">) {
  return { gross: p.hasWaste, waste: p.hasWaste, stock: Boolean(p.showStock), letter: p.yarns.some((y) => y.letter) };
}

/** B6: satırın fire hücresi — yüzde · kaynak · (iplik kendi firesini taşıyorsa) uygulanmayan çözgü firesi notu. */
export function planWasteCell(y: PlanRow, sourceOf?: (y: PlanRow) => string | null): { pct: string; source: string | null; note: string | null } {
  if (Number(y.wastePct) <= 0) return { pct: "—", source: null, note: null };
  return {
    pct: `%${formatQty(y.wastePct, 2, 0)}`,
    source: sourceOf ? sourceOf(y) : wasteSourceText(y.wasteSource, y.wastePct),
    note: yarnOwnWasteNote(y.wasteSource, y.wastePct, y.specWastePct),
  };
}

/** Depodaki serbest stok fireli öneriden az mı — renk ve altındaki açıklama aynı yüklemden. */
export function isStockShort(y: PlanRow, stockShown: boolean): boolean {
  return stockShown && y.depoKg !== null && y.depoKg !== undefined && Number(y.depoKg) < Number(y.grossKg);
}

function WasteCell({ y, sourceOf }: { y: PlanRow; sourceOf?: (y: PlanRow) => string | null }) {
  const c = planWasteCell(y, sourceOf);
  return (
    <TableCell className="text-right tabular-nums" title={c.note ?? undefined}>
      {c.pct}
      {c.source && <span className={cn("block text-xs", c.note ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{c.source}</span>}
    </TableCell>
  );
}

export function PlanTable({ yarns, hasWaste, totals, showStock, sourceOf }: Props) {
  const col = planColumns({ hasWaste, showStock, yarns });
  const num = "text-right tabular-nums";
  const anyShort = yarns.some((y) => isStockShort(y, col.stock));
  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto rounded-md border bg-card">
        <Table aria-label="İplik planı">
          <TableHeader>
            <TableRow>
              {col.letter && <TableHead className="w-10">Grup</TableHead>}
              <TableHead>İplik</TableHead>
              <TableHead className={num}>Tel</TableHead>
              <TableHead className={num}>Denye</TableHead>
              <TableHead className={num} title="Formül: tel × denye × metre ÷ 9.000.000 — fire katılmadan">
                Firesiz kg
              </TableHead>
              {col.waste && (
                <TableHead className={num} title="Uygulanan fire yüzdesi ve kaynağı: iplik kartında fire varsa o, yoksa çözgü kartının firesi">
                  Fire
                </TableHead>
              )}
              {col.gross && (
                <TableHead className={num} title="Fireli öneri: kart/iplik fire yüzdesi ve sabit fire metresiyle">
                  Fireli kg
                </TableHead>
              )}
              {col.stock && <TableHead className={num}>Depoda kg</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {yarns.map((y) => {
              const short = isStockShort(y, col.stock);
              return (
                <TableRow key={`${y.yarnItemId}-${y.sourceWarpSpecId}`}>
                  {col.letter && <TableCell className="font-mono font-semibold">{y.letter}</TableCell>}
                  <TableCell>
                    <span className="font-medium">{y.name}</span>
                    <span className="block text-xs text-muted-foreground">{y.code}</span>
                  </TableCell>
                  <TableCell className={num}>{y.endsCount}</TableCell>
                  <TableCell className={num}>{Number(y.denier)}</TableCell>
                  <TableCell className={num}>{fmtKg(y.netKg)}</TableCell>
                  {col.waste && <WasteCell y={y} sourceOf={sourceOf} />}
                  {col.gross && <TableCell className={num}>{fmtKg(y.grossKg)}</TableCell>}
                  {col.stock && (
                    <TableCell
                      className={cn(num, short && "font-medium text-destructive")}
                      title={short ? "Depodaki serbest stok plandan az" : undefined}
                    >
                      {y.depoKg === null || y.depoKg === undefined ? "bilinmiyor" : fmtKg(y.depoKg)}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            <TableRow className="font-medium">
              {col.letter && <TableCell />}
              <TableCell>Toplam</TableCell>
              <TableCell className={num}>{totals.endsCount ?? ""}</TableCell>
              <TableCell />
              <TableCell className={num}>{fmtKg(totals.netKg)}</TableCell>
              {col.waste && <TableCell />}
              {col.gross && <TableCell className={num}>{fmtKg(totals.grossKg)}</TableCell>}
              {col.stock && <TableCell />}
            </TableRow>
          </TableBody>
        </Table>
      </div>
      {col.waste &&
        yarns.map((y) => {
          const note = planWasteCell(y, sourceOf).note;
          return note ? (
            <p key={`n-${y.yarnItemId}-${y.sourceWarpSpecId}`} className="text-xs text-amber-700 dark:text-amber-400" data-testid="plan-waste-note">
              {y.letter ? `${y.letter} · ` : ""}{y.name}: {note}
            </p>
          ) : null;
        })}
      {anyShort && (
        <p className="text-xs text-destructive">
          Kırmızı: depodaki serbest stok fireli öneriden az. Sipariş yine açılır; eksik iplik sevkten önce
          tamamlanmalı.
        </p>
      )}
    </div>
  );
}
