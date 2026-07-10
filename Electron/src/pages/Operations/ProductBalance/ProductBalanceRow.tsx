import {
  ChevronRight,
  ChevronDown,
  Factory,
  PackageCheck,
  AlertTriangle,
} from "lucide-react";
import { useMemo } from "react";
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { workOrderStatusLabels, type WorkOrderStatus } from "@/types/enums";
import type { BalanceGroup, BalanceSpecRow } from "./types";

const fmt = (n: number) =>
  n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 0 });

const widthLabel = (w: number | null) => (w == null ? "en —" : `${w}cm`);

interface Props {
  group: BalanceGroup;
  isOpen: boolean;
  onToggle: () => void;
  /** Belirli bir en alt-satırı için iş emri aç. */
  onOpenWo: (spec: BalanceSpecRow) => void;
}

/** Ürün Dengesi tablosunda tek (ürün+renk) grubu + (açıksa) en kırılımı + drill-down. */
export function ProductBalanceRow({ group: g, isOpen, onToggle, onOpenWo }: Props) {
  const covered = g.uretilecek <= 0;
  const multiWidth = g.specs.length > 1;
  const singleSpec = g.specs[0];

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
    <>
      <tr className="border-t [&>td]:px-3 [&>td]:py-2">
        <td className="text-left">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1.5 text-left hover:text-primary"
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
            {g.colorHex && (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border"
                style={{ backgroundColor: g.colorHex }}
              />
            )}
            <span className="font-medium">{g.itemName}</span>
            {g.colorName && (
              <span className="text-muted-foreground">· {g.colorName}</span>
            )}

          </button>
        </td>
        <td className="text-left text-muted-foreground">
          {multiWidth ? (
            <span className="text-xs">{g.specs.length} en</span>
          ) : (
            <span className="text-xs">{singleSpec ? widthLabel(singleSpec.width) : "—"}</span>
          )}
        </td>
        <td className="text-right text-foreground">{fmt(g.talep)}</td>
        <td className="text-right text-muted-foreground">{fmt(g.depo)}</td>
        <td className="text-right text-muted-foreground">{fmt(g.uretimde)}</td>
        <td
          className="text-right text-muted-foreground"
          title="Ham havuzu — ürün+renk için ortak (eni önemsiz). En'lere bölünmez."
        >
          {fmt(g.ham)}
        </td>
        <td className="text-right">
          {covered ? (
            <span className="inline-flex items-center justify-end gap-1 font-medium text-emerald-600 dark:text-emerald-400">
              <PackageCheck className="h-3.5 w-3.5" /> Karşılanıyor
            </span>
          ) : (
            <div className="flex flex-col items-end leading-tight">
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                {fmt(g.uretilecek)} m
              </span>
              {g.malzemeAcigi > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-amber-600/80 dark:text-amber-400/80">
                  <AlertTriangle className="h-3 w-3" /> ham açığı{" "}
                  {fmt(g.malzemeAcigi)}
                </span>
              )}
            </div>
          )}
        </td>
        <td className="text-right">
          {/* Tek en → başlıkta hızlı buton; çok en → açıp en seç. */}
          {!covered && !multiWidth && singleSpec && (
            <PermissionGate permission="workorder:write">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5"
                onClick={() => onOpenWo(singleSpec)}
              >
                <Factory className="h-3.5 w-3.5" /> İş Emri Aç
              </Button>
            </PermissionGate>
          )}
        </td>
      </tr>

      {isOpen && (
        <tr className="border-t bg-muted/20">
          <td colSpan={8} className="px-4 py-3">
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
                                  onClick={() => onOpenWo(s)}
                                >
                                  <Factory className="h-3 w-3" /> İş Emri
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
                  Ham {fmt(g.ham)} m bu en'ler arasında ortaktır — yukarıdaki
                  üretilecek toplamı {fmt(g.uretilecek)} m, ham açığı{" "}
                  {fmt(g.malzemeAcigi)} m.
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
                  Üretimdeki iş emirleri ({allWos.length})
                </div>
                {allWos.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Bu ürün için canlı iş emri yok.
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
          </td>
        </tr>
      )}
    </>
  );
}
