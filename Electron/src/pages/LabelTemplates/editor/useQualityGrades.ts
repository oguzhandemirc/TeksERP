// =============================================================================
// Etiket Stüdyosu — kalite kataloğu (koşullu basım için)
// =============================================================================
// Koşullu basım ("kaliteyi yalnız 2. kalitede yaz") kullanıcıya kaliteleri ADIYLA
// gösterir, şablona KODU yazar (`QualityGrade.code` = `Roll.qualityGrade` snapshot'ı;
// ad panelden düzenlenebilir, kod kimliktir). Uç `quality:read` YA DA
// `label-template:read` ister — tasarımcının ayrıca kalite yetkisi olması gerekmez.
//
// PASİFLER DE ÇEKİLİR (`isActive` filtresi yok): eski bir şablon pasife alınmış bir
// kaliteye koşullanmış olabilir; yalnız aktifleri çekersek panelde koşul "bilinmeyen
// kod" olarak görünür ve tasarımcı sebebini anlamaz.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadAllForPicker } from "@/lib/picker-loader";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import type { QualityGrade } from "@/pages/QualityGrades/types";

export interface QualityCatalog {
  grades: QualityGrade[];
  /** code → görünen ad (rozet/ipucu metni). Bilinmeyen kod → undefined. */
  nameByCode: (code: string) => string | undefined;
  isLoading: boolean;
}

export function useQualityGrades(): QualityCatalog {
  const q = useQuery({
    queryKey: ["quality-grades", "label-studio"],
    queryFn: () => loadAllForPicker(qualityGradeService, { filters: {}, sortBy: "sortOrder" }),
    staleTime: 5 * 60_000,
  });
  const grades = useMemo(() => q.data?.data ?? [], [q.data?.data]);
  const map = useMemo(() => new Map(grades.map((g) => [g.code, g.name] as const)), [grades]);
  return {
    grades,
    nameByCode: (code: string) => map.get(code),
    isLoading: q.isLoading,
  };
}
