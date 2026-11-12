// Detayın TEK "Dikkat" kutusu: cari kilidi · toplam TUTMUYOR · okuma bandı · tanınmayan tip · okuma uyarıları · mükerrer/aynı parti.
// Her biri tek satır (+ eylem); hiçbiri yoksa kutu çizilmez. Kararlar bileşenlerin kendi yüklemlerinden (tek kaynak).
import { AlertTriangle, Lock } from "lucide-react";
import { ScanReadBanner } from "./ScanReadBanner";
import { scanBannerRows } from "./scanBanner";
import { NoticesStrip } from "./NoticesStrip";
import { SameBatchStrip, hasSameBatch } from "./SameBatchStrip";
import { DuplicateDocNoStrip } from "./DuplicateDocNo";
import { totalsAttentionText } from "./reviewView";
import { isApprovable } from "./noteStatus";
import { UnknownTypeStrip } from "./tanit/TeachEntry";
import { isUnrecognized } from "./tanit/teachScans";
import type { DeliveryNoteDetail } from "./types";

interface Ctx {
  editable: boolean;
  canRequeue: boolean;
  canTeach: boolean;
}

/** Kutuya girecek kalemler; boş dizi = kutu yok. Sıra = önem (onayı kilitleyen önce). */
export function attentionKinds(n: DeliveryNoteDetail, ctx: Pick<Ctx, "canTeach">): string[] {
  const kinds: string[] = [];
  if (isApprovable(n.status) && n.cariHold?.message) kinds.push("cari");
  if (n.status !== "CANCELLED" && totalsAttentionText(n.totalsCheck, isApprovable(n.status))) kinds.push("totals");
  if (n.status === "DRAFT" && scanBannerRows(n.scans, n.lines).length > 0) kinds.push("scan");
  if (n.status !== "CANCELLED" && ctx.canTeach && isUnrecognized(n)) kinds.push("type");
  if (n.notices?.length) kinds.push("notices");
  if (n.duplicateDocNo && n.duplicateDocNo.peers.length > 0) kinds.push("docNo");
  if (hasSameBatch(n.sameBatch)) kinds.push("sameBatch");
  return kinds;
}

export function DetailAttentionBox({ note: n, editable, canRequeue, canTeach, onRequeued }: Ctx & { note: DeliveryNoteDetail; onRequeued: () => void }) {
  const kinds = new Set(attentionKinds(n, { canTeach }));
  if (kinds.size === 0) return null;
  const totals = totalsAttentionText(n.totalsCheck, isApprovable(n.status));
  return (
    <section role="region" aria-label="Dikkat" className="flex flex-col gap-2 rounded-lg border border-amber-400/70 bg-amber-500/5 px-4 py-3" data-testid="detail-attention">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        Dikkat
      </h2>
      <div className="flex flex-col gap-1.5">
        {kinds.has("cari") && (
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-amber-900 dark:text-amber-200" title={n.cariHold?.message} data-testid="attention-cari">
            <Lock className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate"><strong>Cari kilitli — onaylanamaz.</strong> {n.cariHold?.message}</span>
          </p>
        )}
        {kinds.has("totals") && <p className="truncate text-sm font-medium text-destructive" data-testid="attention-totals">{totals}</p>}
        {kinds.has("scan") && <ScanReadBanner compact scans={n.scans} lines={n.lines} editable={editable} canRequeue={canRequeue} onRequeued={onRequeued} serverOcrOff={n.serverOcrEnabled === false} />}
        {kinds.has("type") && <UnknownTypeStrip compact note={n} />}
        {kinds.has("notices") && <NoticesStrip compact notices={n.notices} />}
        {/* Mükerrer belge no şeridi kendi bileşeninde (başka işin dosyası); kutuya kutusuz sığsın diye sarmalanır. */}
        {kinds.has("docNo") && (
          <div className="[&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&_p]:hidden">
            <DuplicateDocNoStrip notice={n.duplicateDocNo} />
          </div>
        )}
        {kinds.has("sameBatch") && <SameBatchStrip compact sameBatch={n.sameBatch} />}
      </div>
    </section>
  );
}
