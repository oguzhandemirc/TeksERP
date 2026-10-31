// Sayaç kalibrasyon süresi (D4-B5k) — backend `isCalibrationExpired` ikizi: fabrika günü vadeden SONRAYSA geçmiş
// (vade günü dahil geçerli). Rozet yalnız `tambur.kalibrasyonKontrolu` = UYAR iken çizilir (KAPALI = bugünkü liste).
import { Badge } from "@/components/ui/badge";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { factoryDayKey, fmtFactoryDate } from "@/lib/factory-time";
import type { PeripheralDevice } from "./types";

export function isCalibrationExpired(dueAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!dueAt) return false;
  const due = factoryDayKey(dueAt);
  return due !== "" && factoryDayKey(now) > due;
}

export function CalibrationBadge({ device }: { device: Pick<PeripheralDevice, "kind" | "calibrationDueAt"> }) {
  const mode = useFeatureFlags().data?.data?.tamburCalibrationCheck;
  if (mode !== "UYAR" || device.kind !== "METER" || !isCalibrationExpired(device.calibrationDueAt)) return null;
  return (
    <Badge variant="destructive" className="mt-0.5" title={`Geçerlilik sonu ${fmtFactoryDate(device.calibrationDueAt)}`}>
      Kalibrasyon süresi geçti
    </Badge>
  );
}
