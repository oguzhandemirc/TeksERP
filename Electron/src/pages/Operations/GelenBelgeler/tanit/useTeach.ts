// Tanıtma ekranının durumu: kelimeler (sayfa başına), işaretleme, önizleme (gövdeye bağlı tazelik) ve kayıt (yeni | sürümlü güncelle).
// K30-T: rehberli kipte önizleme kendiliğinden (debounce); kaydet tek tık (bayatsa önce tazeler); benzer şablon varsa önce sorulur.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAttemptToken } from "@/lib/attemptToken";
import { INCOMING_DOCUMENT_QUERY_KEY } from "../service";
import { createUserTemplate, getScanWords, getUserTemplate, TEACH_QUERY_KEY, updateUserTemplate, USER_TEMPLATES_QUERY_KEY } from "./service";
import { adoptTemplate, initialTeach, oldParts, suggestBody, teachProblems, templateKeywords, type TeachState } from "./teachDraft";
import { saveDecision, suggestName, type SaveChoice } from "./guidedTeach";
import { useTeachPreview } from "./useTeachPreview";
import type { SimilarTemplate, UserTemplateDetail, UserTemplateView } from "./types";

/** Ad henüz yokken önizleme bu geçici adla koşar (sunucu ad ister; kayıt gerçek adı bekler). */
const PREVIEW_NAME = "Yeni belge tipi";
const savedText = (v: UserTemplateView, updated: boolean) =>
  updated ? `"${v.name}" şablonu güncellendi (sürüm ${v.version}).` : `"${v.name}" belge tipi kaydedildi. Bundan sonra okunan bu tip belgeler bu şablonla okunur.`;

export function useTeach(scanId: string | null, existing: UserTemplateDetail | null, onSaved: () => void, opts: { auto?: boolean } = {}) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const words = useQuery({ queryKey: [...TEACH_QUERY_KEY, "kelimeler", scanId], queryFn: () => getScanWords(scanId as string), enabled: Boolean(scanId), staleTime: Infinity });
  const [state, setState] = useState<TeachState | null>(null);
  // Sayfa değişince işaretleme o sayfanın kelimeleriyle yeniden başlar (kutu indeksleri sayfaya özgü); ad yoksa başlıktan önerilir.
  useEffect(() => {
    if (words.data) setState(initialTeach(words.data, existing?.name ?? suggestName(words.data), templateKeywords(existing?.template), oldParts(existing?.template)));
  }, [words.data, existing]);
  const body = useMemo(() => (state && scanId && words.data ? suggestBody(state, words.data.words, scanId, existing?.code ?? null) : null), [state, scanId, words.data, existing?.code]);
  const previewBody = useMemo(() => (body && body.name.length < 2 ? { ...body, name: PREVIEW_NAME } : body), [body]);
  const [saving, setSaving] = useState(false);
  const [similar, setSimilar] = useState<SimilarTemplate[] | null>(null);
  const problems = state ? teachProblems(state) : [];
  const previewProblems = state ? teachProblems({ ...state, name: PREVIEW_NAME }) : [];
  const pv = useTeachPreview(previewBody, opts.auto === true && previewProblems.length === 0 && !saving);
  const { fetchPreview } = pv;
  const runPreview = () => {
    if (previewBody && previewProblems.length === 0 && !saving) fetchPreview(previewBody).catch(() => undefined);
  };

  const done = (v: UserTemplateView, updated: boolean) => {
    attempt.onSuccess();
    toast.success(savedText(v, updated));
    // Detay (staleTime Infinity) + liste tazelenir: ikinci güncelleme bayat sürümle 409 almasın, yeni tip listede görünsün.
    for (const queryKey of [[INCOMING_DOCUMENT_QUERY_KEY], USER_TEMPLATES_QUERY_KEY]) void qc.invalidateQueries({ queryKey });
    onSaved();
  };

  /** "Aynı tip": işaretleme korunur, o şablonun adı/kimlikleri/yapıları eklenir → base ile önizlenip sürümlü kaydedilir. */
  const saveIntoOther = async (s: TeachState, code: string) => {
    const ex = await qc.fetchQuery({ queryKey: [...USER_TEMPLATES_QUERY_KEY, code], queryFn: () => getUserTemplate(code), staleTime: 0 });
    const adopted = adoptTemplate(s, ex);
    setState(adopted);
    const r = await fetchPreview(suggestBody(adopted, words.data!.words, scanId!, code));
    if (!r.preview || r.errors.length > 0) return void toast.error(r.errors[0] ?? "Bu işaretlemeyle belge okunamadı.");
    done(await updateUserTemplate(code, { expectedVersion: ex.version, template: r.template, name: ex.name }), true);
  };

  /** Tek tık: bayat önizlemeyi tazele → benzer şablon varsa sor → yeni POST | sürümlü PUT. */
  const save = async (choice?: SaveChoice) => {
    if (!state || !body || problems.length > 0 || saving) return;
    setSimilar(null);
    setSaving(true);
    try {
      const result = pv.fresh && pv.result && previewBody === body ? pv.result : await fetchPreview(body);
      if (!result.preview || result.errors.length > 0) return void toast.error(result.errors[0] ?? "Bu işaretlemeyle belge okunamadı.");
      const d = saveDecision(result, existing?.code ?? null, choice);
      if (d.kind === "ask") return void setSimilar(d.similar);
      const name = state.name.trim();
      if (d.kind === "create") return done(await createUserTemplate({ name, template: result.template, clientToken: attempt.token() }), false);
      // Güncelle kipinde önizleme sunucuda birleşik şablonla koştu (`base`) — önizlenen şablon aynen kaydedilir.
      if (existing && d.code === existing.code) return done(await updateUserTemplate(existing.code, { expectedVersion: existing.version, template: result.template, name }), true);
      await saveIntoOther(state, d.code);
    } catch (e) {
      // Hata cümlesini apiClient tek toast'la basar; burada yalnız deneme jetonu kararı.
      attempt.onFailure(e);
    } finally {
      setSaving(false);
    }
  };

  return {
    words,
    state,
    setState: (fn: (s: TeachState) => TeachState) => setState((s) => (s ? fn(s) : s)),
    problems,
    previewProblems,
    preview: pv.result,
    previewFresh: pv.fresh,
    previewError: pv.error,
    previewing: pv.previewing,
    runPreview,
    canSave: Boolean(state && body) && problems.length === 0 && !saving,
    saving,
    save,
    similar,
    closeSimilar: () => setSimilar(null),
  };
}
export type TeachHook = ReturnType<typeof useTeach>;
