import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  Factory,
  PackageCheck,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { productBalanceService } from "./service";
import { ProductBalanceWoDialog } from "./ProductBalanceWoDialog";
import type { BalanceSpec } from "./types";

const QUERY_KEY = "product-balance";
const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });

export function ProductBalancePage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [woSpec, setWoSpec] = useState<BalanceSpec | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: productBalanceService.getBalance,
    staleTime: 15_000,
  });
  const specs = data?.data ?? [];

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Ürün Dengesi"
        description="Ürün bazında talep ↔ depo + üretim dengesi. Açık varsa eksik kadar iş emri aç."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Hesaplanıyor…</p>
        ) : specs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Açık talep veya üretimde ürün yok.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                  <th className="text-left">Ürün</th>
                  <th className="text-right" title="Açık siparişler (istenen − sevk)">
                    Talep
                  </th>
                  <th className="text-right" title="Depoda hazır (sevksiz)">Depo</th>
                  <th className="text-right" title="Canlı iş emirlerinde">Üretimde</th>
                  <th className="text-right" title="İşlenecek ham kumaş stoğu">Ham</th>
                  <th className="text-right" title="Talep − Depo − Üretimde">Üretilecek</th>
                  <th className="text-right" />
                </tr>
              </thead>
              <tbody>
                {specs.map((s) => {
                  const isOpen = expanded.has(s.key);
                  const covered = s.uretilecek <= 0;
                  return (
                    <SpecRows
                      key={s.key}
                      spec={s}
                      isOpen={isOpen}
                      covered={covered}
                      onToggle={() => toggle(s.key)}
                      onOpenWo={() => setWoSpec(s)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Üretilecek = Talep − Depo − Üretimde. Fabrika kumaş üretmez, işler —
          ham stok yetmiyorsa "ham açığı" kadar kumaş tedariki gerekir. Renksiz
          ham, boyanacağı için aynı ürün+en'deki her renge sayılır.
        </p>
      </div>

      <ProductBalanceWoDialog
        spec={woSpec}
        open={woSpec !== null}
        onOpenChange={(o) => !o && setWoSpec(null)}
      />
    </div>
  );
}

interface SpecRowsProps {
  spec: BalanceSpec;
  isOpen: boolean;
  covered: boolean;
  onToggle: () => void;
  onOpenWo: () => void;
}

function SpecRows({ spec: s, isOpen, covered, onToggle, onOpenWo }: SpecRowsProps) {
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
            {s.colorHex && (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border"
                style={{ backgroundColor: s.colorHex }}
              />
            )}
            <span className="font-medium">{s.itemName}</span>
            {s.colorName && (
              <span className="text-muted-foreground">· {s.colorName}</span>
            )}
            {s.width != null && (
              <span className="text-muted-foreground">· {s.width}cm</span>
            )}
          </button>
        </td>
        <td className="text-right text-foreground">{fmt(s.talep)}</td>
        <td className="text-right text-muted-foreground">{fmt(s.depo)}</td>
        <td className="text-right text-muted-foreground">{fmt(s.uretimde)}</td>
        <td className="text-right text-muted-foreground">{fmt(s.ham)}</td>
        <td className="text-right">
          {covered ? (
            <span className="inline-flex items-center justify-end gap-1 font-medium text-emerald-600 dark:text-emerald-400">
              <PackageCheck className="h-3.5 w-3.5" /> Karşılanıyor
            </span>
          ) : (
            <div className="flex flex-col items-end leading-tight">
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                {fmt(s.uretilecek)} m
              </span>
              {s.malzemeAcigi > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-amber-600/80 dark:text-amber-400/80">
                  <AlertTriangle className="h-3 w-3" /> ham açığı{" "}
                  {fmt(s.malzemeAcigi)}
                </span>
              )}
            </div>
          )}
        </td>
        <td className="text-right">
          {!covered && (
            <PermissionGate permission="workorder:write">
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={onOpenWo}>
                <Factory className="h-3.5 w-3.5" /> İş Emri Aç
              </Button>
            </PermissionGate>
          )}
        </td>
      </tr>

      {isOpen && (
        <tr className="border-t bg-muted/20">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Talep eden siparişler ({s.lines.length})
                </div>
                {s.lines.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Açık sipariş yok.</p>
                ) : (
                  <ul className="space-y-1">
                    {s.lines.map((l) => (
                      <li
                        key={l.lineId}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono">{l.orderNumber}</span>
                          <span className="text-muted-foreground">
                            {l.customerName}
                          </span>
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
                  Üretimdeki iş emirleri ({s.wos.length})
                </div>
                {s.wos.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Bu ürün için canlı iş emri yok.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {s.wos.map((w) => (
                      <li
                        key={w.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono">{w.batchNumber}</span>
                          <Badge variant="muted" className="text-[10px]">
                            {w.status}
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
