// NEREDE / NE DURUMDA — depo, bağlı iş emri (tıklanınca İE detayı), bizim parti no, şu anki istasyon/adım.
// Raf/konum alanı modelde yok (çizilmez). Hiç satır yoksa bölüm çizilmez.
import { MapPin } from "lucide-react";
import type { Roll } from "../types";
import { CardLink, CardRow, CardSection, hasAny } from "./CardSection";

export function RollLocationSection({ roll }: { roll: Roll }) {
  const step = roll.currentStep ?? null;
  // Şu anki adımın İE'si önce (üretimdeki top), yoksa partinin İE'si (depoya inmiş top).
  const wo = step?.workOrder ?? roll.batch?.workOrder ?? null;
  const station = step?.station?.name ?? null;
  if (!hasAny(roll.warehouse?.name, wo, roll.batch?.batchNumber, station)) return null;
  return (
    <CardSection title="Nerede / ne durumda" icon={MapPin} testId="roll-card-location">
      <CardRow label="Depo" testId="roll-location-warehouse">{roll.warehouse?.name}</CardRow>
      <CardRow label="İş emri" testId="roll-location-wo">
        {wo && <CardLink to={`/operations/work-orders/${wo.id}`}>{wo.workOrderNumber}</CardLink>}
      </CardRow>
      <CardRow label="Parti no" testId="roll-location-batch">
        {roll.batch?.batchNumber ? <span className="font-mono">{roll.batch.batchNumber}</span> : null}
      </CardRow>
      <CardRow label="Bulunduğu istasyon" testId="roll-location-station">
        {station && (step?.stepSequence ? `${station} · ${step.stepSequence}. adım` : station)}
      </CardRow>
    </CardSection>
  );
}
