// KALICI uyarı — `tambur.simulatedMeterEnabled` AÇIKKEN simüle Tambur metresi stoğa giriyor (DALGA4 §3.9,
// çekirdek ihlal adıyla görünür kılınır). Tam genişlik şerit yerine başlığın yanında kırmızı ünlem; metin ve
// "Ayarı aç" baloncukta (kullanıcı 2026-11-23: "boşuna satır kaplıyor"). Kapatma YOK; ayar kapanınca kalkar.
import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import type { FeatureFlags } from "@/services/featureFlagService";

export function shouldShowSimulatedMeterBanner(flags: Pick<FeatureFlags, "productionEnabled" | "tamburSimulatedMeterEnabled"> | undefined): boolean {
  return flags?.productionEnabled !== false && flags?.tamburSimulatedMeterEnabled === true;
}

/** `PageHeader titleExtra`ya konur. */
export function SimulatedMeterBanner() {
  const flags = useFeatureFlags().data?.data;
  const [open, setOpen] = useState(false);
  if (!shouldShowSimulatedMeterBanner(flags)) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="alert"
          data-testid="simulated-meter-banner"
          aria-label="Uyarı: simüle metre stoğa giriyor"
          onMouseEnter={() => setOpen(true)}
          className="grid h-6 w-6 place-items-center rounded-full bg-destructive text-destructive-foreground shadow-soft hover:opacity-90"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 space-y-2 text-sm" onMouseLeave={() => setOpen(false)}>
        <p className="font-semibold text-destructive">Simüle metre stoğa giriyor</p>
        <p className="text-xs text-muted-foreground">
          Tambur kesiminde simüle sayaç metresi kabul ediliyor; bu metre gerçek ölçüm değildir ve faturaya girmez. Kapatmak için Özellik
          Anahtarları › Üretim — Saha › Tambur › “Tambur kesiminde simüle sayaç metresi kabul edilsin”.
        </p>
        <Link to="/system/feature-flags" className="text-xs font-medium text-primary hover:underline" onClick={() => setOpen(false)}>
          Ayarı aç
        </Link>
      </PopoverContent>
    </Popover>
  );
}
