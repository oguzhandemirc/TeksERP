// Yükleme modalının durumu: dosyalar, başlık alanları, gönderim ilerlemesi ve başlık deneme token'ı.
// Token mantıksal deneme başına; sahip/belge no değişince yenilenir; deneme nesnesi bu birimden çıkmaz.
import { useState } from "react";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { createUploadNote, uploadScan } from "./service";
import { addPickedFiles, splitAcceptedFiles, type UploadPage } from "./uploadPrep";
import { EMPTY_UPLOAD_PROGRESS, pageLimitError, submitUpload, UploadError, type UploadProgress } from "./submitUpload";

export type UploadTarget = { kind: "new" } | { kind: "pages"; noteId: string; noteNo: string; firstPageNo: number };

const api = { createDraftNote: createUploadNote, uploadScan };
const startProgress = (t: UploadTarget): UploadProgress =>
  t.kind === "pages" ? { note: { id: t.noteId, noteNo: t.noteNo }, uploaded: new Set() } : EMPTY_UPLOAD_PROGRESS;

export function useUploadForm(target: UploadTarget, onSent: (note: { id: string; noteNo: string }) => void) {
  const attempt = useAttemptToken();
  const [pages, setPages] = useState<UploadPage[]>([]);
  const [owner, setOwnerState] = useState<string | null>(null);
  const [docNo, setDocNoState] = useState("");
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress>(() => startProgress(target));

  const clearFields = () => {
    setPages([]);
    setOwnerState(null);
    setDocNoState("");
    setNotices([]);
    setError(null);
    setProgress(startProgress(target));
  };
  const setOwner = (id: string | null) => {
    if (id !== owner) attempt.renew();
    setOwnerState(id);
  };
  const setDocNo = (v: string) => {
    if (v !== docNo) attempt.renew();
    setDocNoState(v);
  };
  // Seçici ve bırakma aynı yoldan: tanınmayan türler TEK uyarıda toplanır, kalanlar sihirli baytla hazırlanır.
  const pick = async (files: File[]) => {
    if (!files.length) return;
    const { accepted, notice } = splitAcceptedFiles(files);
    setBusy(true);
    const r = await addPickedFiles(pages, accepted);
    setPages(r.pages);
    setNotices(notice ? [notice, ...r.notices] : r.notices);
    setBusy(false);
  };
  const send = async () => {
    if (busy || !pages.length) return;
    const limitError = pageLimitError(target.kind === "pages" ? target.firstPageNo : 1, pages.length);
    if (limitError) {
      setError(limitError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = { pages, ownerCustomerId: owner, senderDocNo: docNo.trim() || null, firstPageNo: target.kind === "pages" ? target.firstPageNo : 1 };
      const binding = { token: () => attempt.token(), onFailure: (e: unknown) => attempt.onFailure(e), onSuccess: () => attempt.onSuccess() };
      const r = await submitUpload(api, input, binding, progress);
      clearFields();
      onSent(r.note);
    } catch (e) {
      if (e instanceof UploadError) setProgress(e.progress);
      setError(apiErrorText(e instanceof UploadError ? e.original : e, "Gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };
  const discard = (sha256: string) => setPages(pages.filter((p) => p.sha256 !== sha256));
  const remaining = pages.filter((p) => !progress.uploaded.has(p.sha256)).length;
  return { pages, owner, docNo, notices, error, busy, progress, remaining, headerLocked: progress.note !== null, setOwner, setDocNo, pick, send, discard, clearFields };
}
