// Taslak → tel biçimi (K4P): boyut sınıfı S1–S4 ↔ sunucu `FourPointSize`. Önizleme ve konak
// yazma yolu AYNI dönüşümü kullanır; ikisi ayrışırsa öneri yazılan muayeneden sapardı.
import type { InspectionWireSize } from '../../services/qualityInspection.service';
import type { InspectionDraft } from './inspectionDraft';
import type { InspectionSizeClass } from './inspectionModel';

export const WIRE_SIZE: Record<InspectionSizeClass, InspectionWireSize> = {
  S1: 'UP_TO_3IN',
  S2: 'IN_3_TO_6',
  S3: 'IN_6_TO_9',
  S4: 'OVER_9IN',
};

export interface WireDefect {
  defectTypeId: string;
  sizeClass: InspectionWireSize | null;
  startMeter: number | null;
}

export function draftToWireDefects(draft: InspectionDraft): WireDefect[] {
  return draft.defects.map((d) => ({
    defectTypeId: d.defectTypeId,
    sizeClass: d.sizeClass ? WIRE_SIZE[d.sizeClass] : null,
    startMeter: d.meter,
  }));
}
