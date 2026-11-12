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
 * Liste `canApplyProperty` istasyonları gösterir (kategorisi 'özellik veren' olmayan fason istasyonu backend'de de
 * reddedilir); zaten seçili olanlar uygun olmasa da görünür.
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

  // Seçili ama artık uygun olmayan (yeteneği kapanmış / pasif) istasyon listeden DÜŞMEZ: "2/2 seçili" yazıp hiçbirini
  // göstermemek yerine işaretli satır + nedeni görünür; kullanıcı kaldırabilir.
  const items = useMemo<MultiSelectItem[]>(() => {
    const all = stationsQ.data?.data ?? [];
    const chosen = new Set(value);
    const rows: MultiSelectItem[] = all
      .filter((s) => s.canApplyProperty || chosen.has(s.stationId))
      .map((s) => ({
        id: s.stationId,
        label: s.stationName,
        hint: `${s.stationCode} · ${stationKindLabels[s.stationKind] ?? s.stationKind}${s.canApplyProperty ? "" : " · özellik vermiyor"}`,
      }));
    const known = new Set(all.map((s) => s.stationId));
    for (const id of value) if (!known.has(id)) rows.push({ id, label: "Pasif istasyon", hint: "Listede yok (pasif) — kaldırabilirsiniz" });
    return rows;
  }, [stationsQ.data?.data, value]);

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
