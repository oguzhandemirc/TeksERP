// Sayfa çatısı parçaları: "Örnek veri" rozeti, renk/şekil anahtarı ve tam ekran başlığı.
import { FlaskConical, Minimize2, WifiOff } from "lucide-react";
import { formatFactory } from "@/lib/factory-time";
import { Button } from "@/components/ui/button";
import { StatusShape } from "./Markers";
import { STATUS_LABEL, hsl, type StatusKey } from "./palette";

export function SampleDataBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold"
      style={{ background: hsl("var(--ds-over)", 0.16), color: hsl("var(--ds-over)") }}
      title="Bu ekran tezgahlardan veri almıyor; gördüğünüz her şey örnek veridir."
    >
      <FlaskConical className="h-3.5 w-3.5" />
      Örnek veri
    </span>
  );
}

const LEGEND: StatusKey[] = ["RUN", "UNPLANNED", "SETUP", "PLANNED", "NON_SCHEDULED", "UNMONITORED"];

/** Renk + şekil anahtarı ve iki yüzdenin tanımı — tek satır, yazı yalnız burada. */
export function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8em] text-muted-foreground">
      {LEGEND.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <StatusShape status={s} className="h-3.5 w-3.5" />
          {STATUS_LABEL[s]}
        </span>
      ))}
      {/* İki yüzde farklı şeyi ölçer: biri süre, biri adet — anahtarda açıkça ayrılır. */}
      <span className="whitespace-nowrap">
        <b>bugün %</b> = bugün çalışılan süre payı · <b>şu an %</b> = çalışan tezgah payı (adet)
      </span>
    </div>
  );
}

interface FullscreenHeaderProps {
  now: number;
  /** Önizleme verisi mi — "Örnek veri" rozeti yalnız o zaman. */
  sampleData: boolean;
  /** Son veri tazelemesinin anı — TV'ye bakan ekranın canlı olduğunu görsün. */
  updatedAt: number;
  /** Veri tazelenemiyor — "Canlı" damgası bayatlar, uyarı başlıkta (TV'de kaydırma yok). */
  stale?: boolean;
  /** Yoksa (TV kipi) çıkış düğmesi çizilmez. */
  onExit?: () => void;
  legend?: React.ReactNode;
}

export function FullscreenHeader({ now, sampleData, updatedAt, stale = false, onExit, legend }: FullscreenHeaderProps) {
  return (
    <div className="flex items-center gap-4 px-6 pt-4">
      <h1 className="whitespace-nowrap text-[1.6em] font-extrabold" style={{ color: hsl("var(--ds-ink)") }}>
        Tezgah Salonu
      </h1>
      {sampleData && <SampleDataBadge />}
      <div className="min-w-0 flex-1">{legend}</div>
      {stale ? (
        <span
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-destructive px-3 py-1 text-[0.9em] font-bold tabular-nums text-destructive-foreground"
          role="alert"
          data-testid="live-stamp"
        >
          <WifiOff className="h-[1em] w-[1em]" aria-hidden />
          Bağlantı yok · son veri {formatFactory(updatedAt, "HH:mm:ss")}
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.8em] font-semibold tabular-nums text-muted-foreground"
          title="Ekran kendini tazeler"
          data-testid="live-stamp"
        >
          <span className="h-2 w-2 rounded-full" style={{ background: hsl("var(--ds-run)") }} aria-hidden />
          Canlı · {formatFactory(updatedAt, "HH:mm:ss")}
        </span>
      )}
      <span className="whitespace-nowrap text-[1.1em] font-bold tabular-nums text-muted-foreground">{formatFactory(now, "dd.MM.yyyy")}</span>
      {onExit && (
        <Button variant="outline" size="sm" onClick={onExit}>
          <Minimize2 className="mr-1.5 h-4 w-4" />
          Tam ekrandan çık
        </Button>
      )}
    </div>
  );
}
