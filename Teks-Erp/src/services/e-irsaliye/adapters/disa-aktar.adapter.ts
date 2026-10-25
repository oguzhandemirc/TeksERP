// =============================================================================
// `disaAktar` — XML indirilir, entegratör portalına ELLE yüklenir (v1 varsayılanı).
// Hiçbir yeteneği yok: gönderim/yanıt kullanıcı beyanıyla kaydedilir (mark-sent ·
// response). `gonder`/`durumSorgula` çağrısı motorun yetenek kapısını atlamak
// demektir — programcı hatası, 400.
// =============================================================================
import { AppError } from "../../../utils/app-error";
import type { EIrsaliyeAdapter } from "./adapter.types";

const yetenekYok = (): never => {
  throw AppError.badRequest("Dışa aktar yönteminde gönderim ve durum sorgusu elle kaydedilir.", {
    code: "EIRSALIYE_ADAPTER_CAPABILITY",
  });
};

export const disaAktarAdapter: EIrsaliyeAdapter = {
  kod: "disaAktar",
  etiket: "Dışa aktar (portala elle yükleme)",
  yetenek: { gonder: false, durumSorgula: false, yanitAl: false },
  gonder: async () => yetenekYok(),
  durumSorgula: async () => yetenekYok(),
};
