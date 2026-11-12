import {
  Factory,
  PackageCheck,
  AlertTriangle,
} from "lucide-react";
import { memo, useMemo } from "react";
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { workOrderStatusLabels, type WorkOrderStatus } from "@/types/enums";
import type { BalanceGroup, BalanceSpecRow } from "./types";
import { TERIM } from "@/lib/terim";
import { formatQty } from "@/lib/format";

/** Metre — binlik ayırıcısız (lib/format kuralı). */
export const fmt = (n: number) =>
  formatQty(n, 0);

export const widthLabel = (w: number | null) => (w == null ? "en —" : `${w}cm`);

/** Kumaş+renk grubunun Ham hücresi — yarı mamul varsa AYNI satırda (ikisi de gerçek arz; ayrı stok türü). */
export function BalanceHamCell({ group: g }: { group: BalanceGroup }) {
  return (
    <span title="Ham havuzu — kumaş+renk için ortak (eni önemsiz). En'lere bölünmez. Yarı mamul ayrı; ham açığı ikisini birden düşer." className="text-muted-foreground">
      {fmt(g.ham)}
      {g.yariMamul > 0 && <span className="ml-1 text-[10px] text-cyan-700 dark:text-cyan-400">+ {fmt(g.yariMamul)} yarı mamul</span>}
    </span>
  );
}

/** Üretilecek hücresi — karşılanıyorsa yeşil, değilse metre + (varsa) ham açığı aynı satırda. */
export function BalanceNeedCell({ group: g }: { group: BalanceGroup }) {
  if (g.uretilecek <= 0) {
    return (
      <span className="inline-flex items-center justify-end gap-1 font-medium text-emerald-600 dark:text-emerald-400">
        <PackageCheck className="h-3.5 w-3.5" /> Karşılanıyor
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="font-semibold text-amber-600 dark:text-amber-400">{fmt(g.uretilecek)} m</span>
      {g.malzemeAcigi > 0 && (
        <span className="inline-flex items-center gap-1 text-[10px] text-amber-600/80 dark:text-amber-400/80">
          <AlertTriangle className="h-3 w-3" /> ham açığı {fmt(g.malzemeAcigi)}
        </span>
      )}
    </span>
  );
}

/** Tek en → başlıkta hızlı iş emri düğmesi; çok en → satırı açıp en seçilir. */
export function BalanceWoButton({ group: g, onOpenWo }: { group: BalanceGroup; onOpenWo: (group: BalanceGroup, spec: BalanceSpecRow) => void }) {
  const singleSpec = g.specs[0];
  if (g.uretilecek <= 0 || g.specs.length > 1 || !singleSpec) return null;
  return (
    <PermissionGate permission="workorder:write">
      <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => onOpenWo(g, singleSpec)}>
        <Factory className="h-3.5 w-3.5" /> {TERIM.terbiyeIsEmri.tekil} Aç
      </Button>
    </PermissionGate>
  );
}

interface DetailProps {
  group: BalanceGroup;
  /** Belirli bir en alt-satırı için iş emri aç (grup + spec). */
  onOpenWo: (group: BalanceGroup, spec: BalanceSpecRow) => void;
}

/** Açılan ayrıntı: en kırılımı + talep eden siparişler + üretimdeki iş emirleri (DataTable `renderExpanded`). */
export const ProductBalanceDetail = memo(function ProductBalanceDetail({ group: g, onOpenWo }: DetailProps) {
  const multiWidth = g.specs.length > 1;
  // Drill-down: tüm en alt-satırlarının siparişleri/WO'ları, termin sıralı.
  const allLines = useMemo(
    () =>
      g.specs
        .flatMap((s) => s.lines)
        .sort((a, b) => {
          const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
          const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
          return ad - bd;
        }),
    [g.specs],
  );
  const allWos = useMemo(() => g.specs.flatMap((s) => s.wos), [g.specs]);

  return (
    <div className="px-4 py-3">
              <div className="mb-3">
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  En kırılımı{multiWidth ? ` (${g.specs.length})` : ""}
                </div>
                <div className="overflow-x-auto rounded border bg-background">
                  <table className="w-full text-xs tabular-nums">
                    <thead className="text-muted-foreground">
                      <tr className="[&>th]:px-2.5 [&>th]:py-1.5 [&>th]:font-medium">
                        <th className="text-left">En</th>
                        <th className="text-right">Talep</th>
                        <th className="text-right">Depo</th>
                        <th className="text-right">Üretimde</th>
                        <th className="text-right">Üretilecek</th>
                        <th className="text-right" />
                      </tr>
                    </thead>
                    <tbody>
                      {g.specs.map((s) => (
                        <tr key={s.key} className="border-t [&>td]:px-2.5 [&>td]:py-1.5">
                          <td className="text-left font-medium">{widthLabel(s.width)}</td>
                          <td className="text-right">{fmt(s.talep)}</td>
                          <td className="text-right text-muted-foreground">{fmt(s.depo)}</td>
                          <td className="text-right text-muted-foreground">
                            {fmt(s.uretimde)}
                          </td>
                          <td className="text-right font-medium">
                            {s.uretilecek > 0 ? (
                              <span className="text-amber-600 dark:text-amber-400">
                                {fmt(s.uretilecek)} m
                              </span>
                            ) : (
                              <span className="text-emerald-600 dark:text-emerald-400">
                                karşılanıyor
                              </span>
                            )}
                          </td>
                          <td className="text-right">
                            {s.uretilecek > 0 && (
                              <PermissionGate permission="workorder:write">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 gap-1.5 text-[11px]"
                                  onClick={() => onOpenWo(g, s)}
                                >
                                  <Factory className="h-3 w-3" /> {TERIM.terbiyeIsEmri.tekil}
                                </Button>
                              </PermissionGate>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Ham {fmt(g.ham)} m
                  {g.yariMamul > 0 ? ` + yarı mamul ${fmt(g.yariMamul)} m` : ""} bu
                  en'ler arasında ortaktır — yukarıdaki üretilecek toplamı{" "}
                  {fmt(g.uretilecek)} m, ham açığı {fmt(g.malzemeAcigi)} m.
                </p>
              </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Talep eden siparişler ({allLines.length})
                </div>
                {allLines.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Açık sipariş yok.</p>
                ) : (
                  <ul className="space-y-1">
                    {allLines.map((l) => (
                      <li
                        key={l.lineId}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono">{l.orderNumber}</span>
                          <span className="text-muted-foreground">{l.customerName}</span>
                          {multiWidth && (
                            <span className="text-muted-foreground">
                              · {widthLabel(l.width)}
                            </span>
                          )}
                          <DeadlineBadge deadline={l.deadline} />
                        </span>
                        <span className="tabular-nums font-medium">
                          {fmt(l.remaining)} m
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Üretimdeki {TERIM.terbiyeIsEmri.cogulKucuk} ({allWos.length})
                </div>
                {allWos.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Bu kumaş için canlı {TERIM.terbiyeIsEmri.tekilKucuk} yok.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {allWos.map((w) => (
                      <li
                        key={w.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono">{w.batchNumber}</span>
                          <Badge variant="muted" className="text-[10px]">
                            {workOrderStatusLabels[w.status as WorkOrderStatus] ?? w.status}
                          </Badge>
                        </span>
                        <span className="tabular-nums font-medium">
                          {fmt(w.inFlight)} m
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
    </div>
  );
});
