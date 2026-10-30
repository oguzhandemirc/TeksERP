// KALICI kırmızı şerit — `tambur.simulatedMeterEnabled` AÇIKKEN simüle Tambur metresi stoğa giriyor (DALGA4 §3.9,
// çekirdek ihlal adıyla görünür kılınır). Kapatma düğmesi YOK; ayar kapanınca (ya da üretim modülü kapalıyken) kalkar.
import { AlertTriangle } from "lucide-react";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import type { FeatureFlags } from "@/services/featureFlagService";

export function shouldShowSimulatedMeterBanner(flags: Pick<FeatureFlags, "productionEnabled" | "tamburSimulatedMeterEnabled"> | undefined): boolean {
  return flags?.productionEnabled !== false && flags?.tamburSimulatedMeterEnabled === true;
}

export function SimulatedMeterBanner({ className = "" }: { className?: string }) {
  const flags = useFeatureFlags().data?.data;
  if (!shouldShowSimulatedMeterBanner(flags)) return null;
  return (
    <div
      role="alert"
      data-testid="simulated-meter-banner"
      className={`flex items-start gap-2 border-b border-destructive bg-destructive px-4 py-2 text-sm text-destructive-foreground ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <strong className="font-semibold">Simüle metre stoğa giriyor</strong>
        <span className="block text-xs opacity-90 sm:inline sm:pl-2">
          Tambur kesiminde simüle sayaç metresi kabul ediliyor; bu metre gerçek ölçüm değildir ve faturaya girmez. Kapatmak için Özellik
          Anahtarları › Üretim — Saha › Tambur › “Tambur kesiminde simüle sayaç metresi kabul edilsin”.
        </span>
      </div>
    </div>
  );
}
