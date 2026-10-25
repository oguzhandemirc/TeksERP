// Yerel iptal (GİB'e gitmemiş kayıt). Önizleme numara boşluğunu somut söyler.
import { PreviewConfirmDialog } from "./PreviewConfirmDialog";
import { eIrsaliyeService } from "./service";
import type { EIrsaliyeRecord } from "./types";

export function CancelDialog({ record, onClose, onDone }: { record: EIrsaliyeRecord | null; onClose: () => void; onDone: () => void }) {
  return (
    <PreviewConfirmDialog
      record={record}
      title="e-İrsaliyeyi iptal et"
      confirmLabel="İptal et"
      previewKey="cancel-preview"
      loadPreview={eIrsaliyeService.cancelPreview}
      execute={(pv) => eIrsaliyeService.cancel(pv.kayit.id)}
      successText="e-İrsaliye iptal edildi."
      onClose={onClose}
      onDone={onDone}
    />
  );
}
