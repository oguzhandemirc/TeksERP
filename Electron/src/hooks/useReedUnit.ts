// Firma ayarındaki tarak numarası birimi; bayraklar yüklenene dek varsayılan (diş/10 cm = bugünkü gösterim).
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { DEFAULT_REED_UNIT, type ReedUnit } from "@/lib/reed-unit";

export function useReedUnit(): ReedUnit {
  const q = useFeatureFlags();
  return q.data?.data?.devereReedNumberUnit === "DENTS_PER_CM" ? "DENTS_PER_CM" : DEFAULT_REED_UNIT;
}
