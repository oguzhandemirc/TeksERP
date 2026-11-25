// Saklı tarak numarasını (diş/10 cm) firma biriminde basar — liste hücreleri gibi hook'suz yerler için.
import { useReedUnit } from "@/hooks/useReedUnit";
import { formatReedNo } from "@/lib/reed-unit";

export function ReedNoText({ stored, prefix = "" }: { stored: string | number | null | undefined; prefix?: string }) {
  const text = formatReedNo(stored, useReedUnit());
  return <>{text === null ? "—" : `${prefix}${text}`}</>;
}
