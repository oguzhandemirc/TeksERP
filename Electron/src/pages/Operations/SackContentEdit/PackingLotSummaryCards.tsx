import { Boxes, Lock, PackageOpen, Ruler, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PackingLotCustomerSummary } from "./types";

const fmtQty = (n: number): string => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });

/**
 * CARİ ÖZETİ — dört kart (cheque `ChequeSummaryCards` kalıbı): Açık parti · Havuz ·
 * Havuz metrajı · Havuz kg. Havuz kartı TIKLANIR ve "Partisiz" listesini açar; kg
 * tartısız çuval yoksa "—" (uydurulmaz). Tek satır metin yerine kart: sayı büyük,
 * etiket küçük — operatör uzaktan okur (saha 2026-09-22: "anlaşılır ve estetik").
 */
export function PackingLotSummaryCards({
  s,
  onOpenPool,
}: {
  s: PackingLotCustomerSummary | undefined;
  onOpenPool: () => void;
}) {
  const u = s?.ungrouped;
  const cards = [
    {
      key: "open",
      icon: Boxes,
      title: "Açık parti",
      value: s ? String(s.openLotCount) : "…",
      hint: s && s.closedLotCount > 0 ? `${s.closedLotCount} sevk edildi` : "sevk edilmiş parti yok",
      tone: "text-primary",
      onClick: undefined as (() => void) | undefined,
    },
    {
      key: "pool",
      icon: PackageOpen,
      title: "Havuzda (partisiz)",
      value: u ? `${u.sackCount} çuval` : "…",
      hint: u ? (u.sackCount > 0 ? `${u.rollCount} top · partiye alınmayı bekliyor` : "sahipsiz çuval yok") : "",
      tone: u && u.sackCount > 0 ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground",
      onClick: onOpenPool,
    },
    {
      key: "meters",
      icon: Ruler,
      title: "Havuz metrajı",
      value: u ? `${fmtQty(u.totalQty)} m` : "…",
      hint: "sevk edilmemiş, partisiz",
      tone: "text-sky-600 dark:text-sky-400",
      onClick: undefined,
    },
    {
      key: "kg",
      icon: Scale,
      title: "Havuz ağırlığı",
      value: u ? (u.weightKg != null ? `${fmtQty(u.weightKg)} kg` : "—") : "…",
      hint: u && u.weightKg == null && u.sackCount > 0 ? "tartılmamış" : "brüt, tartılı çuvallar",
      tone: "text-emerald-600 dark:text-emerald-500",
      onClick: undefined,
    },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        const body = (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className={cn("h-3.5 w-3.5", c.tone)} />
              <span>{c.title}</span>
              {c.key === "open" && s && s.closedLotCount > 0 && <Lock className="ml-auto h-3 w-3 opacity-50" />}
            </div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums leading-tight", c.tone)}>{c.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{c.hint}</div>
          </>
        );
        // Tıklanmayan kart `div` — hiçbir şey yapmayan buton, olmayan bir yolu vaat eder.
        return c.onClick ? (
          <button
            key={c.key}
            type="button"
            onClick={c.onClick}
            className="rounded-md border p-3 text-left transition-colors hover:bg-muted/50"
            title="Partisiz çuvalları aç"
          >
            {body}
          </button>
        ) : (
          <div key={c.key} className="rounded-md border p-3">
            {body}
          </div>
        );
      })}
    </div>
  );
}
