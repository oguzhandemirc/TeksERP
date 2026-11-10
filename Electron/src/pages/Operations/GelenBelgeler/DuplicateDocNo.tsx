// Mükerrer kapıları (K27 aynı gönderen belge no · aynı müşteri parti no): taslak şeridi + onay/kayıt 409 kutusu (TEK desen).
// Hüküm sunucuda (`helpers/gelen-belge-mukerrer.helper.ts`); panel eş kümesini kurmaz, yalnız basar. Belge no BLOCK kodu
// burada yakalanmaz (bugünkü genel hata); parti no BLOCK'u yalnız bilgi kutusudur (onay düğmesi yok).
import axios from "axios";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NOTE_STATUS_LABEL } from "./noteStatus";
import { errorCode } from "./approveFlow";
import { SameBatchStrip } from "./SameBatchStrip";
import type { BatchNoPeer, DocNoPeer, DuplicateConfirms, DuplicateDocNoDetailFields, DuplicateDocNoNotice, DuplicateGateConflict } from "./mukerrerTypes";
import type { SameBatchNotes } from "./types";

const DETAIL_BASE = "/operations/gelen-belgeler";
export const DUPLICATE_DOC_NO_ACTIVE = "DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE";
export const DUPLICATE_BATCH_NO = "DELIVERY_NOTE_DUPLICATE_BATCH_NO";
export const DUPLICATE_BATCH_NO_ACTIVE = "DELIVERY_NOTE_DUPLICATE_BATCH_NO_ACTIVE";

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
export function DuplicateDocNoConfirm({ conflict, busy, onConfirm, confirmLabel = "Yine de onayla" }: { conflict: DuplicateDocNoNotice; busy: boolean; onConfirm: () => void; confirmLabel?: string }) {
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
        <Button size="sm" variant="secondary" disabled={busy} onClick={onConfirm} data-testid="duplicate-doc-no-force">{confirmLabel}</Button>
      </div>
    </div>
  );
}

/** Onay/kayıt hatasının mükerrer künyesi (belge no WARN · parti no WARN/BLOCK); başka hata → null. */
export function duplicateGateConflict(error: unknown): DuplicateGateConflict | null {
  const notice = duplicateDocNoConflict(error);
  if (notice) return { gate: "docNo", confirmable: true, notice };
  const code = errorCode(error);
  if ((code !== DUPLICATE_BATCH_NO_ACTIVE && code !== DUPLICATE_BATCH_NO) || !axios.isAxiosError(error)) return null;
  const peers = (error.response?.data as { details?: { peers?: unknown } } | undefined)?.details?.peers;
  return { gate: "batchNo", confirmable: code === DUPLICATE_BATCH_NO_ACTIVE, peers: Array.isArray(peers) ? (peers as BatchNoPeer[]) : [] };
}

/** "Yine de" sonrası bayraklar: öncekiler korunur (iki kapı art arda 409 verebilir), çakışan kapınınki eklenir. */
export function withDuplicateConfirm(prev: DuplicateConfirms | undefined, c: DuplicateGateConflict): DuplicateConfirms {
  return { ...prev, ...(c.gate === "docNo" ? { confirmDuplicateDocNo: true as const } : { confirmDuplicateBatchNo: true as const }) };
}

/** "ISM1439770 → IE0911260003" (İE yoksa eşin GB no'su). */
export const batchPeerLine = (p: BatchNoPeer): string => `${p.customerBatchNo} → ${p.workOrderNumber ?? p.noteNo}`;

/** Toast gibi tek satırlık yüzeyler için kısa metin. */
export function duplicateGateText(c: DuplicateGateConflict): string {
  if (c.gate === "docNo") return `Bu belge no (${c.notice.senderDocNo}) işi süren başka bir belgede de var.`;
  return `BU PARTİ ZATEN VAR: ${c.peers.map(batchPeerLine).join(", ")}${c.confirmable ? "" : " (fabrika ayarı ikinci kez açılmasına izin vermiyor)"}`;
}

function DuplicateBatchNoConfirm({ conflict, busy, onConfirm, onCancel }: { conflict: Extract<DuplicateGateConflict, { gate: "batchNo" }>; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded border border-amber-400 bg-amber-500/10 p-2 text-sm" data-testid="duplicate-batch-no-confirm" data-confirmable={conflict.confirmable ? "1" : "0"}>
      <p className="font-semibold text-amber-900 dark:text-amber-200">BU PARTİ ZATEN VAR</p>
      <ul className="flex flex-col gap-0.5">
        {conflict.peers.map((p) => (
          <li key={`${p.id}-${p.customerBatchNo}`} className="text-base font-semibold" data-testid="duplicate-batch-no-peer">{batchPeerLine(p)}</li>
        ))}
      </ul>
      {!conflict.confirmable && <p className="text-xs text-muted-foreground">Fabrika ayarı aynı partinin ikinci kez açılmasına izin vermiyor.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel} data-testid="duplicate-batch-no-cancel">{conflict.confirmable ? "Vazgeç" : "Tamam"}</Button>
        {conflict.confirmable && <Button size="sm" variant="secondary" disabled={busy} onClick={onConfirm} data-testid="duplicate-batch-no-force">Yine de aç</Button>}
      </div>
    </div>
  );
}

/** Mükerrer 409 kutusu — onay diyaloğu, tekli ve toplu İE formu aynı bileşeni kullanır. */
export function DuplicateGateConfirm({ conflict, busy, onConfirm, onCancel }: { conflict: DuplicateGateConflict; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  if (conflict.gate === "docNo") return <DuplicateDocNoConfirm conflict={conflict.notice} busy={busy} onConfirm={onConfirm} />;
  return <DuplicateBatchNoConfirm conflict={conflict} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />;
}
