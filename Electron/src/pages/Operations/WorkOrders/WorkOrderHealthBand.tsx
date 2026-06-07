import { AlertTriangle, CalendarClock, Flame } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { AnimatedProgress } from "@/components/motion";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WorkOrder } from "./types";

type Tone = "success" | "warning" | "destructive" | "primary";

/** Sol-kenar aksan rengi (tema token'ları — abartmadan). */
const ACCENT: Record<Tone, string> = {
  success: "border-l-success",
  warning: "border-l-warning",
  destructive: "border-l-destructive",
  primary: "border-l-primary",
};

function Chip({
  tone,
  icon: Icon,
  children,
}: {
  tone: "warning" | "destructive";
  icon: typeof Flame;
  children: React.ReactNode;
}) {
  const cls =
    tone === "destructive"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-warning/40 bg-warning/10 text-warning";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", cls)}>
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

/**
 * İş emri "sağlık" şeridi — tek bakışta "yolunda mı?": üretim ilerlemesi (çıkan/
 * giren, hero), termin durumu ve dikkat gerektiren sinyaller (gecikme / fire).
 * Sol-kenar aksanı genel duruma göre renklenir (tema semantik token'ları).
 */
export function WorkOrderHealthBand({ wo }: { wo: WorkOrder }) {
  // İlerleme = üretimden ÇIKAN (bitmiş depo) ÷ üretime GİREN (ham). Hedef metraj
  // %99 girilmediğinden hedef-bazlı çubuk kullanılmaz; çıkan/giren her zaman anlamlı.
  const input = wo.inputRolls?.totalMeters ?? 0;
  const output = wo.producedRolls?.warehouse.totalMeters ?? 0;
  const hasFlow = input > 0;
  const pct = hasFlow ? Math.min(100, Math.round((output / input) * 100)) : 0;
  const fireCount = wo.producedRolls?.fire.count ?? 0;

  const overdue =
    wo.plannedEndDate != null &&
    new Date(wo.plannedEndDate).getTime() < Date.now() &&
    wo.status !== "COMPLETED" &&
    wo.status !== "CANCELLED";

  const tone: Tone =
    wo.status === "COMPLETED"
      ? "success"
      : overdue
        ? "destructive"
        : fireCount > 0
          ? "warning"
          : "primary";

  return (
    <Card className={cn("border-l-4", ACCENT[tone])}>
      <CardContent className="flex flex-wrap items-start gap-x-8 gap-y-3 p-4">
        {/* Üretim ilerlemesi (hero) — % öne çıkar, altında çıkan/giren detayı. */}
        <div className="min-w-[240px] flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Üretim İlerlemesi
          </div>
          {hasFlow ? (
            <>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-bold leading-none text-primary">%{pct}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  çıkan {formatNumber(output, 0)} / giren {formatNumber(input, 0)} m
                </span>
              </div>
              <AnimatedProgress value={pct} className="mt-2 h-2" />
            </>
          ) : (
            <div className="mt-1 text-sm text-muted-foreground">Üretime giren mal yok.</div>
          )}
        </div>

        {/* Termin */}
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Termin
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <DeadlineBadge deadline={wo.plannedEndDate} />
          </div>
        </div>

        {/* Durum — uyarılar (yalnızca varsa) */}
        {(overdue || fireCount > 0) && (
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Durum
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {overdue && (
                <Chip tone="destructive" icon={AlertTriangle}>
                  Termin geçti
                </Chip>
              )}
              {fireCount > 0 && (
                <Chip tone="warning" icon={Flame}>
                  Fire: {fireCount} top
                </Chip>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
