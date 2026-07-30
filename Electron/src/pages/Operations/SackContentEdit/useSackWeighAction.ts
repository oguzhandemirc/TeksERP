import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMachineScale } from "@/hooks/useMachineScale";
import { readWeightFromScale, type WeighSource } from "@/lib/scale-read";
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
    // `source`: tartının KAYNAĞI — backend simüle kantar korumasının girdisi.
    mutationFn: ({ sackId, kg, source }: { sackId: string; kg: number; source: WeighSource }) =>
      sackHubService.weighSack(sackId, kg, source),
    onSuccess: () => invalidateSackHub(qc),
  });

  /** Oku → doğrudan kaydet. Kantar okunamazsa hiçbir yazma yapılmaz. */
  const weigh = async (sack: { id: string; sackNo: string }): Promise<void> => {
    if (busyRef.current) return; // kantar meşgul — sessizce yok say
    busyRef.current = true;
    setWeighingSackId(sack.id);
    try {
      const read = await readWeightFromScale(scale);
      if (read == null) return; // hata toast'ı readWeightFromScale içinde verildi
      // Simülasyon UYARISI artık okuma anında (readWeightFromScale) veriliyor —
      // eskiden buradaydı, yani uydurma değer ÖNCE DB'ye yazılıp SONRA uyarılıyordu.
      // Backend `shipping.simulatedWeightEnabled` kapalıyken bu çağrıyı 400'ler ve
      // Türkçe mesajı aşağıdaki catch gösterir.
      await mut.mutateAsync({ sackId: sack.id, kg: read.kg, source: read.source });
      toast.success(`${sack.sackNo} tartıldı — ${read.kg.toLocaleString("tr-TR")} kg`);
    } catch (e) {
      // 409 = çuval bu sırada bir sevkiyata atandı (touchWarehouseSackTx guard'ı).
      // 400 = simüle kantar reddi (backend'in Türkçe yönlendirmesi gösterilir).
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
