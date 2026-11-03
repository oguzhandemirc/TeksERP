// Tanıtma ekranının durumu: kelimeler (sayfa başına), işaretleme, önizleme (gövdeye bağlı tazelik) ve kayıt (yeni | sürümlü güncelle).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAttemptToken } from "@/lib/attemptToken";
import { INCOMING_DOCUMENT_QUERY_KEY } from "../service";
import { createUserTemplate, getScanWords, suggestTemplate, TEACH_QUERY_KEY, updateUserTemplate } from "./service";
import { initialTeach, oldParts, suggestBody, teachProblems, templateKeywords, type TeachState } from "./teachDraft";
import type { UserTemplateDetail } from "./types";

export function useTeach(scanId: string | null, existing: UserTemplateDetail | null, onSaved: () => void) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const words = useQuery({ queryKey: [...TEACH_QUERY_KEY, "kelimeler", scanId], queryFn: () => getScanWords(scanId as string), enabled: Boolean(scanId), staleTime: Infinity });
  const [state, setState] = useState<TeachState | null>(null);
  // Sayfa değişince işaretleme o sayfanın kelimeleriyle yeniden başlar (kutu indeksleri sayfaya özgü).
  useEffect(() => {
    if (words.data) setState(initialTeach(words.data, existing?.name ?? "", templateKeywords(existing?.template), oldParts(existing?.template)));
  }, [words.data, existing]);
  const body = useMemo(() => (state && scanId && words.data ? suggestBody(state, words.data.words, scanId, existing?.code ?? null) : null), [state, scanId, words.data, existing?.code]);
  const bodyKey = body ? JSON.stringify(body) : "";
  const preview = useMutation({ mutationFn: suggestTemplate });
  const previewFresh = Boolean(preview.data && preview.variables && JSON.stringify(preview.variables) === bodyKey);
  const save = useMutation({
    mutationFn: async () => {
      const r = preview.data;
      if (!r || !state) throw new Error("Önce önizleyin.");
      // Güncelle kipinde önizleme sunucuda birleşik şablonla koştu (`base`) — önizlenen şablon aynen kaydedilir.
      if (existing) return updateUserTemplate(existing.code, { expectedVersion: existing.version, template: r.template, name: state.name.trim() });
      return createUserTemplate({ name: state.name.trim(), template: r.template, clientToken: attempt.token() });
    },
    onError: (e) => attempt.onFailure(e),
    onSuccess: (v) => {
      attempt.onSuccess();
      toast.success(existing ? `"${v.name}" şablonu güncellendi (sürüm ${v.version}).` : `"${v.name}" belge tipi kaydedildi. Bundan sonra okunan bu tip belgeler bu şablonla okunur.`);
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] });
      onSaved();
    },
  });
  const problems = state ? teachProblems(state) : [];
  return {
    words,
    state,
    setState: (fn: (s: TeachState) => TeachState) => setState((s) => (s ? fn(s) : s)),
    problems,
    preview,
    previewFresh,
    runPreview: () => body && problems.length === 0 && preview.mutate(body),
    canSave: previewFresh && Boolean(preview.data?.preview) && (preview.data?.errors.length ?? 1) === 0 && problems.length === 0 && !save.isPending,
    save,
  };
}
export type TeachHook = ReturnType<typeof useTeach>;
