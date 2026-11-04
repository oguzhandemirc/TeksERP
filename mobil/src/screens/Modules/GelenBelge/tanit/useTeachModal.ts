// Tablet tanıtma durumu (panel `useTeach` ikizi): sayfanın kelimeleri, işaretleme, önizleme (gövdeye bağlı tazelik), kayıt (yeni | sürümlü güncelle).
// K30-A: rehberli kipte önizleme işaretleme durunca kendiliğinden koşar; Kaydet TEK dokunuş (bayat önizlemeyi tazeler).
// Gelişmiş kipte bayat önizlemeyle Kaydet önce önizlemeyi tazeleyip gösterir, kayıt ikinci dokunuşta (görmeden kayıt yok);
// sunucu `benzerSablonlar` gönderirse kayıttan önce "aynı tip mi?" sorulur. ONLINE-ONLY: kuyruğa alınmaz.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { inboundDocService } from '../../../../services/inboundDoc.service';
import type { SimilarTemplate, SuggestBody, SuggestResult, UserTemplateDetail } from '../../../../types/inboundDocTeach';
import { suggestName } from './guided';
import { adoptTemplate, initialTeach, locateKept, oldParts, suggestBody, teachErrText, teachProblems, templateFieldKeys, templateKeywords, type TeachState } from './teachDraft';

export const teachWordsKey = (scanId: string | null) => ['gelen-belge', 'tanitma', 'kelimeler', scanId] as const;
export const USER_TEMPLATES_PREFIX = ['gelen-belge', 'sablonlar', 'ozel'] as const;
export const userTemplateKey = (code: string | null) => [...USER_TEMPLATES_PREFIX, code] as const;
/** Dokunuşlar durduktan sonra önizleme gecikmesi (her dokunuşta istek atılmasın). */
export const PREVIEW_DEBOUNCE_MS = 400;
// Öneri ucu ad ister (en az 2 karakter); ad henüz yazılmadıysa önizleme bu yer tutucuyla koşar, kayıtta gerçek ad şarttır.
const PREVIEW_NAME = 'Yeni belge tipi';

const errText = teachErrText;

/** Kayıt sonucu: çağıran (satır şeridi) formu bu şablonla yeniden doldurur. */
/** Önizlenen şablonu kaydeder (yeni POST | sürümlü PUT). Token yalnız bu GERÇEK kayıt denemesinde yapışır. */
async function persistTemplate(ex: UserTemplateDetail | null, template: SuggestResult['template'], name: string, token: () => string) {
  return ex
    ? // Önizleme sunucuda birleşik şablonla koştu (`base`) — önizlenen şablon aynen kaydedilir.
      inboundDocService.updateUserTemplate(ex.code, { expectedVersion: ex.version, template, name })
    : inboundDocService.createUserTemplate({ name, template, clientToken: token() });
}

export interface TeachSaved {
  code: string;
  name: string;
  /** Kaydedilen şablonla bu belgeden okunan değerler (önizleme). */
  fields: Record<string, string | null>;
}

/** Hata bildirimi verip null döndüren `.catch` işleyicisi. */
const failToast = (text1: string, fallback?: string) => (e: unknown): null => {
  Toast.show({ type: 'error', text1, text2: errText(e) ?? fallback });
  return null;
};

/** Kayıt öncesi kapı: false → durdu (bildirim verildi; benzer şablon varsa soru açılır). */
function passesSaveGate(result: SuggestResult, decided: boolean, mustShowPreview: boolean, ask: (s: SimilarTemplate[]) => void): boolean {
  if (mustShowPreview) {
    Toast.show({ type: 'info', text1: 'Önizleme tazelendi', text2: 'Okunan değerleri kontrol edip yeniden kaydedin.' });
    return false;
  }
  if (!result.preview || result.errors.length > 0) {
    Toast.show({ type: 'error', text1: 'Kaydedilemedi', text2: result.errors[0] ?? 'Bu işaretlemeyle belge okunamadı.' });
    return false;
  }
  if (!decided && (result.benzerSablonlar?.length ?? 0) > 0) {
    ask(result.benzerSablonlar!);
    return false;
  }
  return true;
}

/** Toast: yeni tip | sürümlü güncelleme. */
function savedToast(updated: boolean, v: { name: string; version: number }) {
  Toast.show({
    type: 'success',
    text1: updated ? `"${v.name}" şablonu güncellendi (sürüm ${v.version}).` : `"${v.name}" belge tipi kaydedildi.`,
    text2: updated ? undefined : 'Bundan sonra okunan bu tip belgeler bu şablonla okunur.',
  });
}

/** Tanıtmanın kaynağı: şablon kodu ("Aynı tip" ekran içinde değiştirir; açılış kodu prop'tan), mevcut şablon, kelimeler, işaretleme. */
function useTeachSource(scanId: string | null, initialCode: string | null) {
  const [code, setCode] = useState(initialCode);
  const adoptRef = useRef(false);
  const [pendingSave, setPendingSave] = useState(false);
  useEffect(() => {
    setCode(initialCode);
    adoptRef.current = false;
    setPendingSave(false);
  }, [initialCode, scanId]);
  const existing = useQuery({ queryKey: userTemplateKey(code), queryFn: () => inboundDocService.getUserTemplate(code!), enabled: !!code, retry: false, staleTime: Infinity });
  const ex: UserTemplateDetail | null = existing.data ?? null;
  // Güncelle kipinde şablon gelmeden işaretleme başlamaz (eski kimlik yazıları hazır seçili gelir).
  const wordsEnabled = !!scanId && (!code || !!ex);
  const words = useQuery({ queryKey: teachWordsKey(scanId), queryFn: () => inboundDocService.scanWords(scanId!), enabled: wordsEnabled, retry: false, staleTime: Infinity });
  const [state, setState] = useState<TeachState | null>(null);
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
    setState(words.data ? initialTeach(words.data, ex?.name ?? suggestName(words.data), templateKeywords(ex?.template), { keepOld: oldParts(ex?.template), kept: templateFieldKeys(ex?.template) }) : null);
  }, [words.data, ex]);

  return { code, setCode, existing, ex, words, state, setState, adoptRef, pendingSave, setPendingSave };
}

/** Önizleme durumu; yalnız EN SON isteğin yanıtı ekrana yazılır (hızlı dokunuşta eski yanıt yenisini ezmesin). */
function usePreview() {
  const [preview, setPreview] = useState<{ body: string; result: SuggestResult } | null>(null);
  const [previewError, setPreviewError] = useState<{ body: string; text: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const seq = useRef(0);
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

  return { preview, previewError, previewing, fetchPreview };
}

/** Rehberli kip: işaretleme durunca önizleme kendiliğinden (debounce); bayat değilse ya da eksik varsa `ready` false. */
function useAutoPreview(ready: boolean, body: SuggestBody | null, bodyKey: string, fetchPreview: (b: SuggestBody) => Promise<SuggestResult>) {
  const bodyRef = useRef(body);
  bodyRef.current = body;
  useEffect(() => {
    if (!ready) return undefined;
    const t = setTimeout(() => {
      if (bodyRef.current) fetchPreview(bodyRef.current).catch(() => undefined);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [ready, bodyKey, fetchPreview]);
}

function useLocated(state: TeachState | null, words: Parameters<typeof locateKept>[1] | undefined, rects: Parameters<typeof locateKept>[2]) {
  return useMemo(() => (state && words ? locateKept(state, words, rects) : {}), [state, words, rects]);
}

export function useTeachModal(scanId: string | null, initialCode: string | null, onSaved: (r: TeachSaved) => void, opts: { auto?: boolean } = {}) {
  const attempt = useAttemptToken();
  const qc = useQueryClient();
  const { code, setCode, existing, ex, words, state, setState, adoptRef, pendingSave, setPendingSave } = useTeachSource(scanId, initialCode);

  const body = useMemo(() => (state && scanId && words.data ? suggestBody(state, words.data.words, scanId, ex?.code ?? null) : null), [state, scanId, words.data, ex?.code]);
  const previewBody = useMemo(() => (body && body.name.length < 2 ? { ...body, name: PREVIEW_NAME } : body), [body]);
  const [saving, setSaving] = useState(false);
  const [similar, setSimilar] = useState<SimilarTemplate[] | null>(null);
  const bodyKey = previewBody ? JSON.stringify(previewBody) : '';
  const { preview, previewError, previewing, fetchPreview } = usePreview();
  const previewFresh = !!preview && preview.body === bodyKey;
  const problems = state ? teachProblems(state) : [];
  const previewProblems = state ? teachProblems({ ...state, name: PREVIEW_NAME }) : [];

  const runPreview = async () => {
    if (!previewBody || previewProblems.length > 0 || saving) return;
    await fetchPreview(previewBody).catch(failToast('Önizlenemedi'));
  };

  const auto = opts.auto === true;
  // Güncelle kipinde ilk önizleme Gelişmiş'te de kendiliğinden: kayıtlı alanların değeri + belge üstündeki yeri ondan gelir.
  useAutoPreview((auto || (!!ex && !preview)) && !!previewBody && previewProblems.length === 0 && !previewFresh && previewError?.body !== bodyKey && !saving, previewBody, bodyKey, fetchPreview);

  const canSave = !!state && !!body && problems.length === 0 && !saving;

  /** Tek dokunuş: bayat önizlemeyi tazele → benzer şablon varsa sor (decided=false) → yeni POST | sürümlü PUT. */
  const save = async (decided = false) => {
    if (!canSave || !body) return;
    setSaving(true);
    try {
      // Önizleme kayıt denemesi değildir: hatası token'a dokunmaz.
      const result = previewFresh && preview ? preview.result : await fetchPreview(body).catch(failToast('Kaydedilemedi', 'Önizleme alınamadı.'));
      if (!result || !passesSaveGate(result, decided, !decided && !auto && !previewFresh, setSimilar)) return;
      const v = await persistTemplate(ex, result.template, state!.name.trim(), attempt.token).catch((e: unknown) => {
        attempt.onFailure(e);
        throw e;
      });
      attempt.onSuccess();
      // Detay (staleTime Infinity) + liste tazelenir: aynı tablette ikinci güncelleme bayat sürümle 409 almasın, yeni tip listede görünsün.
      void qc.invalidateQueries({ queryKey: USER_TEMPLATES_PREFIX });
      savedToast(!!ex, v);
      onSaved({ code: v.code, name: v.name, fields: result.preview!.fields });
    } catch (e) {
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

  // Şablon ÖNCE çekilir, sonra kod değişir: çekilemezse benimseme yarım kalmaz (ekran "yükleniyor"da takılmaz).
  const chooseSimilar = async (kod: string) => {
    setSimilar(null);
    if (kod === ex?.code) return void save(true);
    const fetched = qc.fetchQuery({ queryKey: userTemplateKey(kod), queryFn: () => inboundDocService.getUserTemplate(kod), staleTime: Infinity, retry: false });
    if (!(await fetched.catch(failToast('Belge tipi açılamadı', 'İşaretlemeniz korunuyor; yeniden deneyin.')))) return;
    adoptRef.current = true;
    setCode(kod);
  };

  return {
    existing: ex,
    /** Kayıtlı (korunan) alanların belge üstündeki kelimeleri — son önizlemenin okuduğu kutudan. */
    located: useLocated(state, words.data?.words, preview?.result.preview?.fieldRects),
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
    /** Önizlemeyi engelleyen ilk eksik (ad hariç); null → önizleme istenebilir. */
    previewBlocked: previewProblems[0] ?? null,
    runPreview,
    canSave,
    save: () => save(false),
    busy: saving ? ('save' as const) : previewing ? ('preview' as const) : null,
    similar,
    chooseSimilar: (kod: string) => void chooseSimilar(kod),
    saveAsNew: () => {
      setSimilar(null);
      void save(true);
    },
    dismissSimilar: () => setSimilar(null),
  };
}
export type TeachModalState = ReturnType<typeof useTeachModal>;
