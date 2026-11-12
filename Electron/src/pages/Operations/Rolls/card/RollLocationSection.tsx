// NEREDE / NE DURUMDA — bağlı iş emri (tıklanınca İE detayı) ve şu anki istasyon/adım; depo ve bizim parti
// "Top bilgileri" tablosundadır.
// Raf/konum alanı modelde yok (çizilmez). Hiç satır yoksa bölüm çizilmez.
import { MapPin } from "lucide-react";
import type { Roll } from "../types";
import { CardLink, CardRow, CardSection, hasAny } from "./CardSection";
import { TERIM } from "@/lib/terim";

export function RollLocationSection({ roll }: { roll: Roll }) {
  const step = roll.currentStep ?? null;
  // Şu anki adımın İE'si önce (üretimdeki top), yoksa partinin İE'si (depoya inmiş top).
  const wo = step?.workOrder ?? roll.batch?.workOrder ?? null;
  const station = step?.station?.name ?? null;
  if (!hasAny(wo, station)) return null;
  return (
    <CardSection title="Nerede / ne durumda" icon={MapPin} testId="roll-card-location">
      <CardRow label={TERIM.terbiyeIsEmri.cumleBasi.yalin} testId="roll-location-wo">
        {wo && <CardLink to={`/operations/work-orders/${wo.id}`}>{wo.workOrderNumber}</CardLink>}
      </CardRow>
      <CardRow label="Bulunduğu istasyon" testId="roll-location-station">
        {station && (step?.stepSequence ? `${station} · ${step.stepSequence}. adım` : station)}
      </CardRow>
    </CardSection>
  );
}
