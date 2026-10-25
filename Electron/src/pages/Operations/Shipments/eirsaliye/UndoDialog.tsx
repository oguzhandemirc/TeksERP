// Gönderim ya da yanıt kaydını geri al (yalnız dışa aktar; `eirsaliye:undo`). Hangi ucun
// çağrılacağını sunucu önizlemesi söyler (`islem`) — panel durumdan tahmin etmez.
import { PreviewConfirmDialog } from "./PreviewConfirmDialog";
import { eIrsaliyeService } from "./service";
import type { EIrsaliyeRecord } from "./types";

export function UndoDialog({ record, onClose, onDone }: { record: EIrsaliyeRecord | null; onClose: () => void; onDone: () => void }) {
  return (
    <PreviewConfirmDialog
      record={record}
      title="Kaydı geri al"
      confirmLabel="Geri al"
      previewKey="undo-preview"
      loadPreview={eIrsaliyeService.undoPreview}
      execute={(pv) => {
        if (pv.islem === "undo-sent") return eIrsaliyeService.undoSent(pv.kayit.id);
        if (pv.islem === "undo-response") return eIrsaliyeService.undoResponse(pv.kayit.id);
        return Promise.reject(new Error("Bu durumda geri alınacak kayıt yok."));
      }}
      successText="Kayıt geri alındı; geçmişe karşı satır eklendi."
      onClose={onClose}
      onDone={onDone}
    />
  );
}
