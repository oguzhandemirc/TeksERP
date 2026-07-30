import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMachineScale } from "@/hooks/useMachineScale";
import { readWeightFromScale } from "@/lib/scale-read";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";

/**
 * Çuval tartısı — TEK DOKUNUŞ (mobil `hooks/useSackWeigh.ts` deseninin masaüstü
 * karşılığı). "Tart"a basılınca bu PC'nin seri kantarından okunur ve sonuç
 * DOĞRUDAN kaydedilir; diyalog/input AÇILMAZ. Elle giriş ayrı bir yol
 * ("Elle kg gir" → WeighSackDialog).
 *
 * Fail-closed: kantar tanımsız / okunamadı / değer ≤ 0 → `readWeightFromScale`
 * NET Türkçe toast verir ve null döner; `weighSack` HİÇ ÇAĞRILMAZ (sessiz sahte
 * değer yok). Çift-tık `busyRef` ile engellenir (seri okuma ~1sn sürer).
 */
export function useSackWeighAction() {
  const qc = useQueryClient();
  const { scale } = useMachineScale();
  const [weighingSackId, setWeighingSackId] = useState<string | null>(null);
  const busyRef = useRef(false);

  const mut = useMutation({
    mutationFn: ({ sackId, kg }: { sackId: string; kg: number }) =>
      sackHubService.weighSack(sackId, kg),
    onSuccess: () => invalidateSackHub(qc),
  });

  /** Oku → doğrudan kaydet. Kantar okunamazsa hiçbir yazma yapılmaz. */
  const weigh = async (sack: { id: string; sackNo: string }): Promise<void> => {
    if (busyRef.current) return; // kantar meşgul — sessizce yok say
    busyRef.current = true;
    setWeighingSackId(sack.id);
    try {
      const kg = await readWeightFromScale(scale);
      if (kg == null) return; // hata toast'ı readWeightFromScale içinde verildi
      await mut.mutateAsync({ sackId: sack.id, kg });
      // Simülasyon cihazında değer UYDURULUR ve doğrudan kaydedilir → açıkça uyar.
      if (scale?.simulate) {
        toast.warning(`${sack.sackNo}: ${kg.toLocaleString("tr-TR")} kg (SİMÜLASYON)`, {
          description: "Gerçek ölçüm değil — Cihaz Kaydı'nda “simulate” açık.",
        });
      } else {
        toast.success(`${sack.sackNo} tartıldı — ${kg.toLocaleString("tr-TR")} kg`);
      }
    } catch (e) {
      // 409 = çuval bu sırada bir sevkiyata atandı (touchWarehouseSackTx guard'ı).
      toast.error("Tartı kaydedilemedi", { description: (e as Error).message });
    } finally {
      busyRef.current = false;
      setWeighingSackId(null);
    }
  };

  return {
    weigh,
    weighingSackId,
    busy: weighingSackId !== null || mut.isPending,
    /** Kantar tanımlı mı — UI ipucu (yoksa tek yol "Elle kg gir"). */
    hasScale: scale != null,
  };
}
