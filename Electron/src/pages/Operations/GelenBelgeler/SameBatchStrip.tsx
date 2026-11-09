// Aynı müşteri partisi bilgisi: backend `sameBatch` (sahip + parti no; `customerBatchKeyOf`) — panel parti anahtarı
// kurmaz, yalnız basar. Bilgidir, onayı engellemez; eski backend göndermez ya da başka belge yoksa çizilmez.
import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import { fmtFactoryDate } from "@/lib/factory-time";
import { NOTE_STATUS_LABEL } from "./noteStatus";
import type { SameBatchNotes } from "./types";

const DETAIL_BASE = "/operations/gelen-belgeler";

/** Detayın "Dikkat" kutusu bu yüklemle karar verir (tek kaynak). */
export const hasSameBatch = (sameBatch: SameBatchNotes | null | undefined): boolean => !!sameBatch && sameBatch.total > 0;

/** `compact`: "Dikkat" kutusunda tek satır — başlık + belge bağlantıları, açıklama tooltip'te. */
export function SameBatchStrip({ sameBatch, compact = false }: { sameBatch: SameBatchNotes | null | undefined; compact?: boolean }) {
  if (!sameBatch || !hasSameBatch(sameBatch)) return null;
  const more = sameBatch.total - sameBatch.notes.length;
  if (compact) {
    return (
      <div role="status" className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-sky-900 dark:text-sky-200" data-testid="same-batch-strip" title="Aynı teslimat iki kez mi girildi kontrol edin; parti devamıysa sorun yok.">
        <span className="font-medium">Aynı partili ({sameBatch.batchNo}) {sameBatch.total} başka belge:</span>
        {sameBatch.notes.map((n) => (
          <Link key={n.id} to={`${DETAIL_BASE}/${n.id}`} className="underline-offset-2 hover:underline" data-testid="same-batch-note">{n.noteNo}</Link>
        ))}
        {more > 0 && <span className="text-muted-foreground">+{more}</span>}
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-1 rounded-md border border-sky-400 bg-sky-500/10 px-3 py-2 text-xs" data-testid="same-batch-strip">
      <div className="flex items-center gap-1.5 text-sm font-medium text-sky-800 dark:text-sky-300">
        <Info className="h-4 w-4 shrink-0" />
        Bu müşterinin aynı partili ({sameBatch.batchNo}) {sameBatch.total} başka belgesi var
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {sameBatch.notes.map((n) => (
          <li key={n.id} data-testid="same-batch-note">
            <Link to={`${DETAIL_BASE}/${n.id}`} className="font-medium underline-offset-2 hover:underline">{n.noteNo}</Link>
            <span className="text-muted-foreground"> · {NOTE_STATUS_LABEL[n.status]} · {fmtFactoryDate(n.createdAt)}</span>
          </li>
        ))}
        {more > 0 && <li className="text-muted-foreground">+{more} belge daha</li>}
      </ul>
      <p className="text-muted-foreground">Aynı teslimat iki kez mi girildi kontrol edin; parti devamıysa sorun yok.</p>
    </div>
  );
}
