// Tablet tanıtma durumu (panel `useTeach` ikizi): sayfanın kelimeleri, işaretleme, önizleme (gövdeye bağlı tazelik), kayıt (yeni | sürümlü güncelle).
// K30-A: rehberli kipte önizleme işaretleme durunca kendiliğinden koşar; Kaydet TEK dokunuş (bayat önizlemeyi tazeler);
// sunucu `benzerSablonlar` gönderirse kayıttan önce "aynı tip mi?" sorulur. ONLINE-ONLY: kuyruğa alınmaz.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { inboundDocService } from '../../../../services/inboundDoc.service';
import type { SimilarTemplate, SuggestBody, SuggestResult, UserTemplateDetail } from '../../../../types/inboundDocTeach';
import { suggestName } from './guided';
import { adoptTemplate, initialTeach, oldParts, suggestBody, teachProblems, templateKeywords, type TeachState } from './teachDraft';

export const teachWordsKey = (scanId: string | null) => ['gelen-belge', 'tanitma', 'kelimeler', scanId] as const;
export const USER_TEMPLATES_PREFIX = ['gelen-belge', 'sablonlar', 'ozel'] as const;
export const userTemplateKey = (code: string | null) => [...USER_TEMPLATES_PREFIX, code] as const;
/** Dokunuşlar durduktan sonra önizleme gecikmesi (her dokunuşta istek atılmasın). */
export const PREVIEW_DEBOUNCE_MS = 400;
// Öneri ucu ad ister (en az 2 karakter); ad henüz yazılmadıysa önizleme bu yer tutucuyla koşar, kayıtta gerçek ad şarttır.
const PREVIEW_NAME = 'Yeni belge tipi';

const errText = (e: unknown) => (e instanceof Error ? e.message : undefined);

/** Kayıt sonucu: çağıran (satır şeridi) formu bu şablonla yeniden doldurur. */
export interface TeachSaved {
  code: string;
  name: string;
  /** Kaydedilen şablonla bu belgeden okunan değerler (önizleme). */
  fields: Record<string, string | null>;
}

export function useTeachModal(scanId: string | null, initialCode: string | null, onSaved: (r: TeachSaved) => void, opts: { auto?: boolean } = {}) {
  const attempt = useAttemptToken();
  const qc = useQueryClient();
  // "Aynı tip (güncelle)" kodu ekran içinde değiştirir; açılış kodu prop'tan.
  const [code, setCode] = useState(initialCode);
  useEffect(() => setCode(initialCode), [initialCode]);
  const existing = useQuery({ queryKey: userTemplateKey(code), queryFn: () => inboundDocService.getUserTemplate(code!), enabled: !!code, retry: false, staleTime: Infinity });
  const ex: UserTemplateDetail | null = existing.data ?? null;
  // Güncelle kipinde şablon gelmeden işaretleme başlamaz (eski kimlik yazıları hazır seçili gelir).
  const wordsEnabled = !!scanId && (!code || !!ex);
  const words = useQuery({ queryKey: teachWordsKey(scanId), queryFn: () => inboundDocService.scanWords(scanId!), enabled: wordsEnabled, retry: false, staleTime: Infinity });
  const [state, setState] = useState<TeachState | null>(null);
  const adoptRef = useRef(false);
  const [pendingSave, setPendingSave] = useState(false);
  // Sayfa değişince işaretleme o sayfanın kelimeleriyle yeniden başlar (kutu indeksleri sayfaya özgü);
  // benzer şablon benimsenince işaretleme korunur, yalnız şablonun kimlik/ad/yapıları eklenir.
  useEffect(() => {
    if (adoptRef.current) {
      if (!ex) return;
      adoptRef.current = false;
      setState((s) => (s ? adoptTemplate(s, ex) : s));
      setPendingSave(true);
      return;
    }
    setState(words.data ? initialTeach(words.data, ex?.name ?? suggestName(words.data), templateKeywords(ex?.template), oldParts(ex?.template)) : null);
  }, [words.data, ex]);

  const body = useMemo(() => (state && scanId && words.data ? suggestBody(state, words.data.words, scanId, ex?.code ?? null) : null), [state, scanId, words.data, ex?.code]);
  const previewBody = useMemo(() => (body && body.name.length < 2 ? { ...body, name: PREVIEW_NAME } : body), [body]);
  const [preview, setPreview] = useState<{ body: string; result: SuggestResult } | null>(null);
  const [previewError, setPreviewError] = useState<{ body: string; text: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [similar, setSimilar] = useState<SimilarTemplate[] | null>(null);
  const seq = useRef(0);
  const bodyKey = previewBody ? JSON.stringify(previewBody) : '';
  const previewFresh = !!preview && preview.body === bodyKey;
  const problems = state ? teachProblems(state) : [];
  const previewProblems = state ? teachProblems({ ...state, name: PREVIEW_NAME }) : [];

  /** Önizleme isteği; yalnız EN SON isteğin yanıtı ekrana yazılır (hızlı dokunuşta eski yanıt yenisini ezmesin). */
  const fetchPreview = useCallback(async (sent: SuggestBody): Promise<SuggestResult> => {
    const my = ++seq.current;
    const key = JSON.stringify(sent);
    setPreviewing(true);
    try {
      const result = await inboundDocService.suggestTemplate(sent);
      if (my === seq.current) {
        setPreview({ body: key, result });
        setPreviewError(null);
      }
      return result;
    } catch (e) {
      if (my === seq.current) setPreviewError({ body: key, text: errText(e) ?? 'Önizleme alınamadı.' });
      throw e;
    } finally {
      if (my === seq.current) setPreviewing(false);
    }
  }, []);

  const runPreview = async () => {
    if (!previewBody || previewProblems.length > 0 || saving) return;
    try {
      await fetchPreview(previewBody);
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Önizlenemedi', text2: errText(e) });
    }
  };

  // Rehberli kip: işaretleme durunca önizleme kendiliğinden (debounce); bayat değilse ya da eksik varsa koşmaz.
  const auto = opts.auto === true;
  const previewRef = useRef(previewBody);
  previewRef.current = previewBody;
  const autoReady = auto && !!previewBody && previewProblems.length === 0 && !previewFresh && previewError?.body !== bodyKey && !saving;
  useEffect(() => {
    if (!autoReady) return undefined;
    const t = setTimeout(() => {
      if (previewRef.current) fetchPreview(previewRef.current).catch(() => undefined);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [autoReady, bodyKey, fetchPreview]);

  const canSave = !!state && !!body && problems.length === 0 && !saving;

  /** Tek dokunuş: bayat önizlemeyi tazele → benzer şablon varsa sor (decided=false) → yeni POST | sürümlü PUT. */
  const save = async (decided = false) => {
    if (!canSave || !body) return;
    setSaving(true);
    try {
      const result = previewFresh && preview ? preview.result : await fetchPreview(body);
      if (!result.preview || result.errors.length > 0) {
        Toast.show({ type: 'error', text1: 'Kaydedilemedi', text2: result.errors[0] ?? 'Bu işaretlemeyle belge okunamadı.' });
        return;
      }
      if (!decided && (result.benzerSablonlar?.length ?? 0) > 0) {
        setSimilar(result.benzerSablonlar!);
        return;
      }
      const name = state!.name.trim();
      const v = ex
        ? // Önizleme sunucuda birleşik şablonla koştu (`base`) — önizlenen şablon aynen kaydedilir.
          await inboundDocService.updateUserTemplate(ex.code, { expectedVersion: ex.version, template: result.template, name })
        : await inboundDocService.createUserTemplate({ name, template: result.template, clientToken: attempt.token() });
      attempt.onSuccess();
      // Detay (staleTime Infinity) + liste tazelenir: aynı tablette ikinci güncelleme bayat sürümle 409 almasın, yeni tip listede görünsün.
      void qc.invalidateQueries({ queryKey: USER_TEMPLATES_PREFIX });
      Toast.show({
        type: 'success',
        text1: ex ? `"${v.name}" şablonu güncellendi (sürüm ${v.version}).` : `"${v.name}" belge tipi kaydedildi.`,
        text2: ex ? undefined : 'Bundan sonra okunan bu tip belgeler bu şablonla okunur.',
      });
      onSaved({ code: v.code, name: v.name, fields: result.preview.fields });
    } catch (e) {
      attempt.onFailure(e);
      Toast.show({ type: 'error', text1: 'Kaydedilemedi', text2: errText(e) });
    } finally {
      setSaving(false);
    }
  };

  // "Aynı tip (güncelle)" seçildi: şablon gelince işaretleme benimsenir, sonra base ile önizlenip sürümlü kaydedilir.
  useEffect(() => {
    if (!pendingSave || !ex || !state) return;
    setPendingSave(false);
    void save(true);
    // save her çizimde yeni kapanış; tetik yalnız pendingSave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSave, ex, state]);

  const chooseSimilar = (kod: string) => {
    setSimilar(null);
    if (kod === ex?.code) return void save(true);
    adoptRef.current = true;
    setCode(kod);
  };

  return {
    existing: ex,
    existingLoading: !!code && existing.isLoading,
    existingError: existing.isError,
    words,
    state,
    setState: (fn: (s: TeachState) => TeachState) => setState((s) => (s ? fn(s) : s)),
    problems,
    preview: preview?.result ?? null,
    previewFresh,
    previewError: previewError && previewError.body === bodyKey ? previewError.text : null,
    previewing,
    runPreview,
    canSave,
    save: () => save(false),
    busy: saving ? ('save' as const) : previewing ? ('preview' as const) : null,
    similar,
    chooseSimilar,
    saveAsNew: () => {
      setSimilar(null);
      void save(true);
    },
    dismissSimilar: () => setSimilar(null),
  };
}
export type TeachModalState = ReturnType<typeof useTeachModal>;
