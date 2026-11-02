// "Belge okut" kartının parti no + kurşun metresi bölümü — ARA SÜRÜM: P2 (`BatchNoPicker`, `KursunMetersCard`) inince
// bu gövde o bileşenlerle değişir. Şimdilik değerleri yalnız gösterir; düzeltme Gelen Belgeler detayındadır.
import type { DeliveryNoteDetail, HeaderPatch } from "./types";

interface Props {
  note: DeliveryNoteDetail;
  editable: boolean;
  onPatch: (p: HeaderPatch) => Promise<unknown>;
}

type PerDoc = { ourBatchNo?: string | null; kursunMeters?: string | number | null };

export function BelgeOkutFields({ note }: Props) {
  const v = note as DeliveryNoteDetail & PerDoc;
  return (
    <dl className="grid grid-cols-2 gap-1 text-sm" data-testid="belge-okut-fields">
      <dt className="text-muted-foreground">Parti no</dt>
      <dd>{v.ourBatchNo ?? "—"}</dd>
      <dt className="text-muted-foreground">Kurşun metresi</dt>
      <dd>{v.kursunMeters ?? "—"}</dd>
    </dl>
  );
}
