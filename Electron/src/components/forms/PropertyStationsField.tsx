import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MultiSelectCheckboxList, type MultiSelectItem } from "./MultiSelectCheckboxList";
import { stationCapabilityService } from "@/pages/StationCapabilities/service";
import { stationKindLabels } from "@/types/enums";

/**
 * "Bu özelliği hangi istasyon(lar) uygular?" seçicisi — kumaş özelliği DOĞARKEN
 * istasyonuna bağlansın diye (2026-08-02). Backend `stationIds`'i ZORUNLU tutar.
 *
 * Neden: özellik seçmenin tek yolu iş emri rotasındaki istasyon chip'leri; hiçbir
 * istasyona bağlanmamış özellik hiçbir iş emrinde görünmez. `ZIMPARALI` tam bu
 * yüzden iki hafta boyunca kullanılamadı. Alanı opsiyonel yapma — kayıt
 * "tanımlandı ama kullanılamaz" durumunda doğabildiği sürece unutulmaya devam eder.
 *
 * Liste yalnız `canApplyProperty` istasyonları gösterir (kategorisi 'özellik veren'
 * olmayan fason istasyonu backend'de de reddedilir).
 */
export function PropertyStationsField({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const stationsQ = useQuery({
    queryKey: ["station-capabilities"],
    queryFn: () => stationCapabilityService.list(),
    staleTime: 60_000,
  });

  const items = useMemo<MultiSelectItem[]>(
    () =>
      (stationsQ.data?.data ?? [])
        .filter((s) => s.canApplyProperty)
        .map((s) => ({
          id: s.stationId,
          label: s.stationName,
          hint: `${s.stationCode} · ${stationKindLabels[s.stationKind] ?? s.stationKind}`,
        })),
    [stationsQ.data?.data],
  );

  return (
    <MultiSelectCheckboxList
      items={items}
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder="İstasyon ara..."
      emptyHint={
        stationsQ.isLoading
          ? "İstasyonlar yükleniyor..."
          : "Özellik kazandırabilen aktif istasyon yok."
      }
    />
  );
}
