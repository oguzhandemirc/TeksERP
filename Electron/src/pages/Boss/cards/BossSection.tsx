import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Patron ekranındaki bölüm kabı — başlık + opsiyonel "detaya in" bağlantısı.
 *
 * ⚠️ MOBILE-FIRST. Bu ekran öncelikle TELEFON tarayıcısında açılıyor; masaüstü
 * genişliği bir bonus. Bu yüzden varsayılan tek kolon, `sm:` üstünde genişler —
 * tersi (masaüstü tasarlayıp daraltmak) mevcut panel ekranlarında denendi ve
 * telefonda okunmuyor.
 */
export interface BossSectionProps {
  title: string;
  icon: LucideIcon;
  /** Sağ üstte küçük bağlam (ör. "son 30 gün"). */
  meta?: string;
  /** Verilirse başlık tıklanabilir olur ve detay ekranına iner. */
  onDrill?: () => void;
  drillLabel?: string;
  children: ReactNode;
  className?: string;
}

export function BossSection({
  title,
  icon: Icon,
  meta,
  onDrill,
  drillLabel = "Detay",
  children,
  className,
}: BossSectionProps) {
  return (
    <Card className={cn("overflow-hidden p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h2 className="truncate text-sm font-semibold">{title}</h2>
        </div>
        {onDrill ? (
          <button
            type="button"
            onClick={onDrill}
            className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            {drillLabel}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ) : meta ? (
          <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      {children}
    </Card>
  );
}

/**
 * Bölüm içi tek ölçü. `MetricCard` yerine bunun olmasının sebebi yoğunluk:
 * telefonda beş bölüm × dört ölçü = yirmi kart, kaydırmaktan okunmaz hâle gelir.
 */
export function BossStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn" | "bad";
}) {
  const TONE: Record<string, string> = {
    neutral: "text-foreground",
    ok: "text-success",
    warn: "text-warning",
    bad: "text-destructive",
  };
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("truncate text-lg font-semibold tabular-nums", TONE[tone])}>{value}</p>
    </div>
  );
}

/** Basit yatay çubuk listesi — kırılımlar için (en büyük değere göre oranlanır). */
export function BossBars({ rows, unit }: { rows: Array<{ label: string; qty: number }>; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.qty));
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">Kayıt yok.</p>;
  }
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {r.qty.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} {unit}
            </span>
          </div>
          <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary/60" style={{ width: `${(r.qty / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
