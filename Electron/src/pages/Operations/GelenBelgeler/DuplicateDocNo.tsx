// Gülkesim K27 aynı gönderen belge no (WARN kipi): taslak detayında bilgi şeridi + onay diyaloğunda 409 kutusu.
// Hüküm sunucuda (`helpers/gelen-belge-mukerrer.helper.ts`); panel eş kümesini kurmaz, yalnız basar. Eski backend
// alanı göndermez / BLOCK kipinde kod gelmez → çizilmez (bugünkü genel hata metni kalır).
import axios from "axios";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NOTE_STATUS_LABEL } from "./noteStatus";
import { errorCode } from "./approveFlow";
import { SameBatchStrip } from "./SameBatchStrip";
import type { DocNoPeer, DuplicateDocNoDetailFields, DuplicateDocNoNotice } from "./mukerrerTypes";
import type { SameBatchNotes } from "./types";

const DETAIL_BASE = "/operations/gelen-belgeler";
export const DUPLICATE_DOC_NO_ACTIVE = "DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE";

/** 409 `DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE` künyesi (`details.senderDocNo` + `details.peers`); başka hata → null. */
export function duplicateDocNoConflict(error: unknown): DuplicateDocNoNotice | null {
  if (errorCode(error) !== DUPLICATE_DOC_NO_ACTIVE || !axios.isAxiosError(error)) return null;
  const d = (error.response?.data as { details?: { senderDocNo?: unknown; peers?: unknown } } | undefined)?.details;
  const peers = Array.isArray(d?.peers) ? (d.peers as DocNoPeer[]) : [];
  return { senderDocNo: typeof d?.senderDocNo === "string" ? d.senderDocNo : "", peers };
}

function PeerList({ peers }: { peers: readonly DocNoPeer[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {peers.map((p) => (
        <li key={p.id} data-testid="duplicate-doc-no-peer">
          <Link to={`${DETAIL_BASE}/${p.id}`} className="font-medium underline-offset-2 hover:underline">{p.noteNo}</Link>
          <span className="text-muted-foreground"> · {NOTE_STATUS_LABEL[p.status] ?? p.status}{p.workOrderNumbers.length ? ` · ${p.workOrderNumbers.join(", ")}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

/** Taslak detayı şeridi (sunucu yalnız WARN kipinde ve işi süren eş varken gönderir). */
export function DuplicateDocNoStrip({ notice }: { notice: DuplicateDocNoNotice | null | undefined }) {
  if (!notice || notice.peers.length === 0) return null;
  return (
    <div role="status" className="flex flex-col gap-1 rounded-md border border-amber-400 bg-amber-500/10 px-3 py-2 text-xs" data-testid="duplicate-doc-no-strip">
      <div className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Bu belge no ({notice.senderDocNo}) işi süren başka belgede de kayıtlı
      </div>
      <PeerList peers={notice.peers} />
      <p className="text-muted-foreground">Aynı kâğıt ikinci kez mi okutuldu kontrol edin; onayda ayrıca sorulur.</p>
    </div>
  );
}

/** Detaydaki "başka belgeler" şeritleri: aynı müşteri partisi (bilgi) + aynı belge no'lu işi süren eş (K27 WARN). */
export function NotePeerStrips({ note }: { note: DuplicateDocNoDetailFields & { sameBatch?: SameBatchNotes | null } }) {
  return (
    <>
      <SameBatchStrip sameBatch={note.sameBatch} />
      <DuplicateDocNoStrip notice={note.duplicateDocNo} />
    </>
  );
}

/** Onay diyaloğundaki 409 kutusu: önceki belgeyi aç ya da "Yine de onayla". */
export function DuplicateDocNoConfirm({ conflict, busy, onConfirm }: { conflict: DuplicateDocNoNotice; busy: boolean; onConfirm: () => void }) {
  const first = conflict.peers[0];
  const label = conflict.peers.map((p) => p.noteNo).join(", ") || "başka bir belge";
  return (
    <div role="alert" className="flex flex-col gap-2 rounded border border-amber-400 bg-amber-500/10 p-2 text-sm" data-testid="duplicate-doc-no-confirm">
      <p className="text-amber-900 dark:text-amber-200">
        Bu belge no{conflict.senderDocNo ? ` (${conflict.senderDocNo})` : ""} {label} olarak zaten kayıtlı (iş sürüyor). Aynı kâğıdı ikinci kez mi okutuyorsunuz?
      </p>
      <PeerList peers={conflict.peers} />
      <div className="flex flex-wrap gap-2">
        {first && (
          <Button variant="outline" size="sm" asChild>
            <Link to={`${DETAIL_BASE}/${first.id}`} data-testid="duplicate-doc-no-open">Önceki belgeyi aç</Link>
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={busy} onClick={onConfirm} data-testid="duplicate-doc-no-force">Yine de onayla</Button>
      </div>
    </div>
  );
}
