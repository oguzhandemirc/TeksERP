// B16: kart kaydı + süreç kümesi. CrudPage kendi create/update mutasyonunu koşar; süreçler aynı servisin ARDINDAN
// küme ucuyla yazılır. Yeni kartta süreç hatası kartı geri almaz (kart doğdu; tekrar "Kaydet" ikinci kart doğurur) →
// uyarı + listedeki Süreç hücresine yönlendirme. Düzenlemede hata form açık kalsın diye fırlatılır (409 metni apiClient'ta).
import { toast } from "sonner";
import type { CrudService } from "@/services/crudService";
import { putServiceItemProcesses } from "./serviceProcesses";
import type { ServiceItem } from "./types";

export function withProcessWrite(
  base: CrudService<ServiceItem>,
  takePending: () => string[] | null,
  onWritten: () => void,
): CrudService<ServiceItem> {
  return {
    ...base,
    create: async (data) => {
      const res = await base.create(data);
      const ids = takePending();
      if (ids && ids.length > 0 && res.data?.id) {
        try {
          await putServiceItemProcesses(res.data.id, ids);
          onWritten();
        } catch {
          toast.warning("Hizmet kartı kaydedildi ama süreçler yazılamadı. Listede kartın Süreç hücresinden yeniden eşleyin.");
        }
      }
      return res;
    },
    update: async (id, data) => {
      const res = await base.update(id, data);
      const ids = takePending();
      if (ids) {
        await putServiceItemProcesses(id, ids);
        onWritten();
      }
      return res;
    },
  };
}
