import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAttemptToken } from "@/lib/attemptToken";
import { errorCodeOf } from "@/pages/Operations/LoomAlarms/alarm-access";
import { customReportApi, type DefinitionDetail, type DefinitionIssue, type RunResult } from "./custom-api";

/** Oluşturucunun sunucu işleri: önizle, kaydet (yeni rapor ya da yeni sürüm). Token deneme başınadır. */
export function useBuilderSave(existing: DefinitionDetail | null) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [issues, setIssues] = useState<DefinitionIssue[]>([]);
  const [preview, setPreview] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);

  const readIssues = (e: unknown) => {
    const details = (e as { response?: { data?: { details?: { hatalar?: DefinitionIssue[] } } } }).response?.data?.details;
    setIssues(details?.hatalar ?? []);
  };

  const runPreview = async (body: unknown) => {
    setBusy(true);
    setIssues([]);
    try {
      setPreview(await customReportApi.preview(body));
    } catch (e) {
      setPreview(null);
      readIssues(e);
      if (errorCodeOf(e) !== "RAPOR_TANIMI_BOZUK") toast.error("Önizleme çalıştırılamadı.");
    } finally {
      setBusy(false);
    }
  };

  const save = async (body: unknown, meta: { ad: string; kategoriId?: string }) => {
    setBusy(true);
    setIssues([]);
    try {
      const token = attempt.token();
      let id: string;
      if (existing?.aktifSurum) {
        await customReportApi.saveVersion(existing.id, { govde: body, beklenenSurumId: existing.aktifSurum.id, clientToken: token });
        id = existing.id;
        if (meta.ad !== existing.ad || (meta.kategoriId && meta.kategoriId !== existing.kategori.id)) await customReportApi.updateMeta(id, meta);
      } else {
        id = (await customReportApi.create({ ...meta, govde: body, clientToken: token })).id;
      }
      attempt.onSuccess();
      await qc.invalidateQueries({ queryKey: ["custom-reports"] });
      await qc.invalidateQueries({ queryKey: ["custom-report", id] });
      toast.success(existing ? "Yeni sürüm kaydedildi." : "Rapor kaydedildi.");
      void navigate(`/reports/ozel/${id}`);
    } catch (e) {
      attempt.onFailure(e);
      readIssues(e);
    } finally {
      setBusy(false);
    }
  };

  return { issues, preview, busy, runPreview, save, clearPreview: () => setPreview(null) };
}
