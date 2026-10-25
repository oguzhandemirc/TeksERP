import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAttemptToken } from "@/lib/attemptToken";
import { errorCodeOf } from "@/pages/Operations/LoomAlarms/alarm-access";
import { customReportApi, type DefinitionDetail, type DefinitionIssue } from "../custom-api";
import { normalizedBody, type DefinitionBody } from "./layout-model";

export const VERSION_CONFLICT_MESSAGE = "Rapor başka biri tarafından değiştirildi, yeniden yükleyin.";
const PREVIEW_DELAY_MS = 600;

/** Önizleme yalnız İÇERİK değişince yeniden koşar; düzen (sıra/genişlik/sayfa) sayıyı değiştiremez. */
export const contentKeyOf = (body: DefinitionBody | null) => (body ? JSON.stringify({ p: body.parametreler ?? [], b: body.bloklar }) : "");

function issuesOf(e: unknown): DefinitionIssue[] {
  return (e as { response?: { data?: { details?: { hatalar?: DefinitionIssue[] } } } }).response?.data?.details?.hatalar ?? [];
}

/** Taslak gövde + kirli bayrağı + gecikmeli önizleme + kayıt (her kayıt YENİ sürüm; eskisi değişmez). */
export function useLayoutEditor(existing: DefinitionDetail | undefined) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [draft, setDraft] = useState<DefinitionBody | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<DefinitionIssue[]>([]);
  const [conflict, setConflict] = useState(false);
  const leaving = useRef(false);

  useEffect(() => {
    if (!existing) return;
    setDraft(normalizedBody(existing.govde as DefinitionBody));
    setDirty(false);
  }, [existing]);

  const contentKey = contentKeyOf(draft);
  const draftRef = useRef<DefinitionBody | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const [previewBody, setPreviewBody] = useState<DefinitionBody | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setPreviewBody(draftRef.current), PREVIEW_DELAY_MS);
    return () => clearTimeout(t);
  }, [contentKey]);
  const preview = useQuery({
    queryKey: ["custom-report-layout-preview", contentKeyOf(previewBody)],
    queryFn: () => customReportApi.preview(previewBody),
    enabled: previewBody !== null,
    retry: false,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const apply = (fn: (b: DefinitionBody) => DefinitionBody | null) => {
    if (!draft) return false;
    const next = fn(draft);
    if (!next || next === draft) return false;
    setDraft(next);
    setDirty(true);
    return true;
  };

  const save = async () => {
    if (!existing?.aktifSurum || !draft) return;
    setBusy(true);
    setIssues([]);
    setConflict(false);
    try {
      await customReportApi.saveVersion(existing.id, { govde: normalizedBody(draft), beklenenSurumId: existing.aktifSurum.id, clientToken: attempt.token() });
      attempt.onSuccess();
      leaving.current = true;
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["custom-report", existing.id] });
      await qc.invalidateQueries({ queryKey: ["custom-report-run", existing.id] });
      toast.success("Düzen yeni sürüm olarak kaydedildi.");
      void navigate(`/reports/ozel/${existing.id}`);
    } catch (e) {
      attempt.onFailure(e);
      if (errorCodeOf(e) === "RAPOR_SURUM_CAKISMASI") setConflict(true);
      else setIssues(issuesOf(e));
    } finally {
      setBusy(false);
    }
  };

  return { draft, dirty, busy, issues, conflict, preview, apply, save, leaving };
}
