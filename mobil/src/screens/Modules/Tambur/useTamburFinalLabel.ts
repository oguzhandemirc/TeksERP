// Tambur final etiket ayarları (Gülkesim S5): müşteri tartım/bölme/en + fabrika basım zamanı.
// Uç yoksa ya da hata verirse bugünkü davranış (DEFAULT_LABEL_SETTINGS) — kesim asla kilitlenmez.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import {
  tamburService, type TamburLabelPreviewFields, type TamburLabelSettings, type TamburLabelSuggestions,
} from '../../../services/tambur.service';
import { DEFAULT_LABEL_SETTINGS, kgSource, parseKg, parseWidthCm, weightError, type KgStamp } from './finalLabel';
import { ownerLockOf, type OwnerRef } from './ownerTarget';
import { useTamburLabelBatch, type TamburLabelBatch } from './useTamburLabelBatch';
import {
  initialLabelTexts, labelTextsBody, withConsignee, withSeed, withTexts, withTextsScope, type LabelTextsBody, type LabelTextsState,
} from './labelTexts';

export interface TamburFinalLabelState {
  settings: TamburLabelSettings;
  kgText: string;
  setKgText: (t: string) => void;
  /** Gövdeye giden kg (boş/bozuk → undefined; bozuk metni `error()` yakalar). */
  weightKg: () => number | undefined;
  /** Gönderim öncesi denetim: hata metni ya da null. */
  error: () => string | null;
  /** `error()` varsa "Tartım" toast'ı basar ve true döner (gönderim durur). */
  blocked: () => boolean;
  /** Müşteri parti no (etiket) — ayar açıksa şerit gösterir, gövdeye gider. */
  batch: TamburLabelBatch;
  /** Etikete basılacak kumaş adı / renk — yapışkan, her kesime gider (boşsa alan gitmez). */
  texts: TamburLabelTexts;
  /** Öneri ucunun anahtarı (pencere aynı sorguyu tazeler). */
  suggestionParams: { workOrderId?: string | null; rollId?: string | null; consigneeId?: string | null };
  /** Emanet topun sahibi (sahip kilidi) — null = kendi topumuz, Kime? bugünkü gibi. */
  owner: OwnerRef | null;
  /** Basılacak şablonun alanları; eski backend / çözülemeyen şablon → null (özet satırı). */
  preview: TamburLabelPreviewFields | null;
  /** "Tart" okuması: kutuya yazar ve kaynağı damgalar (elle düzeltilirse ELLE olur). */
  stampKg: (read: KgStamp) => void;
  /** Ölçülen en (cm) metni — boş = atadan miras / gelen belge. */
  widthText: string;
  setWidthText: (t: string) => void;
}

export interface TamburLabelTexts {
  itemName: string;
  colorName: string;
  set: (v: { itemName: string; colorName: string }) => void;
  /** Etiket alıcısı (yalnız emanet); null = malın sahibi. */
  consigneeId: string | null;
  consigneeName: string | null;
  setConsignee: (c: { id: string; name: string } | null) => void;
  /** Gövdeye eklenecek alanlar (`...texts.body()`): ad/renk + alıcı + kg kaynağı + ölçülen en. */
  body: () => LabelTextsBody;
}

export const labelSuggestionsKey = (p: { workOrderId?: string | null; rollId?: string | null; consigneeId?: string | null }) =>
  ['tambur', 'label-suggestions', p.workOrderId ?? null, p.workOrderId ? null : (p.rollId ?? null), p.consigneeId ?? null] as const;

/** Öneri sorgusu — eski backend (404) ya da ağ hatasında boş liste; kesim asla kilitlenmez. */
export function useTamburLabelSuggestions(p: { workOrderId?: string | null; rollId?: string | null; consigneeId?: string | null }, enabled = true) {
  return useQuery<TamburLabelSuggestions>({
    queryKey: labelSuggestionsKey(p),
    queryFn: () => tamburService.labelSuggestions(p),
    enabled: enabled && !!(p.workOrderId || p.rollId),
    staleTime: 30_000,
    retry: false,
  });
}

export function useTamburFinalLabel(
  rollId: string | null | undefined,
  customerId: string | null | undefined,
  /** Parti no yapışkanlığının kapsamı (iş emri id); yoksa çözülen müşteri. */
  batchScopeKey?: string | null,
): TamburFinalLabelState {
  const q = useQuery({
    queryKey: ['tambur', 'label-settings', rollId ?? null, customerId ?? null],
    queryFn: () => tamburService.labelSettings({ rollId, customerId }),
    enabled: !!rollId,
    staleTime: 60_000,
    retry: false,
  });
  const settings = q.data ?? DEFAULT_LABEL_SETTINGS;
  const m = useTamburMeasuredInputs(rollId, settings);
  const owner = ownerLockOf(settings);
  const scopeKey = batchScopeKey ?? settings.customerId ?? null;
  const batch = useTamburLabelBatch(settings.labelBatchEnabled === true, scopeKey);
  // Ad/renk yapışkanlığı parti no ile AYNI kapsamda; İE'de saklanmaz, sunucunun `last`ından bir kez dolar.
  const [texts, setTexts] = useState<LabelTextsState>(() => initialLabelTexts(scopeKey));
  useEffect(() => {
    if (scopeKey != null) setTexts((t) => withTextsScope(t, scopeKey));
  }, [scopeKey]);
  const consigneeId = owner ? texts.consigneeId : null;
  const suggestionParams = { ...(batchScopeKey ? { workOrderId: batchScopeKey } : { rollId: rollId ?? null }), consigneeId };
  // Tohum alıcısız (kapsamın son değeri) sorgudan gelir; alıcı seçilince öneri listesi o alıcınınkine döner.
  const sugg = useTamburLabelSuggestions({ ...suggestionParams, consigneeId: null });
  const previewQ = useTamburLabelPreview(rollId, customerId, consigneeId);
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (scopeKey == null || !sugg.data || seededFor.current === scopeKey) return;
    seededFor.current = scopeKey;
    const last = sugg.data.last;
    setTexts((t) => withSeed(withTextsScope(t, scopeKey), last));
    if (settings.labelBatchEnabled === true && last?.batchNo && batch.value === '') batch.autoSeed(last.batchNo);
    // batch nesnesi her render yenidir; tohum yalnız kapsam + veri gelince bir kez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, sugg.data, settings.labelBatchEnabled]);
  // Parti no varsayılanı = topun gelen belge partisi (sunucu tek çözücüden); elle girilen değeri ezmez.
  const dnBatch = settings.labelBatchEnabled === true ? (settings.deliveryNoteBatchNo ?? null) : null;
  useEffect(() => {
    if (dnBatch) batch.autoSeed(dnBatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId, dnBatch, scopeKey]);
  return {
    settings,
    batch,
    suggestionParams,
    owner,
    preview: previewQ.data ?? null,
    texts: {
      itemName: texts.itemName,
      colorName: texts.colorName,
      set: (v) => setTexts((t) => withTexts(t, v)),
      consigneeId,
      consigneeName: owner ? texts.consigneeName : null,
      setConsignee: (c) => setTexts((t) => withConsignee(t, c)),
      body: () => ({
        ...labelTextsBody(texts),
        ...(consigneeId ? { labelConsigneeId: consigneeId } : {}),
        ...m.extras(),
      }),
    },
    stampKg: m.stampKg,
    widthText: m.widthText,
    setWidthText: m.setWidthText,
    kgText: m.kgText,
    setKgText: m.setKgText,
    weightKg: m.weightKg,
    error: m.error,
    blocked: () => {
      const err = m.error();
      if (err) Toast.show({ type: 'error', text1: 'Etiket', text2: err });
      return err != null;
    },
  };
}

/**
 * Fabrika basım zamanı (tambur.labelPrintTiming) — topa bağlı değil; ekran açılınca okunur ki
 * ilk kesimde ve iş bittiğinde (seçili top yokken) de doğru karar verilsin.
 */
export function useTamburPrintTiming(): TamburLabelSettings['printTiming'] {
  const q = useQuery({
    queryKey: ['tambur', 'label-settings', null, null],
    queryFn: () => tamburService.labelSettings({}),
    staleTime: 60_000,
    retry: false,
  });
  return q.data?.printTiming ?? DEFAULT_LABEL_SETTINGS.printTiming;
}

/** Basılacak şablonun alanları (K4 sırası sunucuda); eski backend 404 → null. */
function useTamburLabelPreview(rollId: string | null | undefined, customerId: string | null | undefined, consigneeId: string | null) {
  return useQuery({
    queryKey: ['tambur', 'label-preview-fields', rollId ?? null, customerId ?? null, consigneeId],
    queryFn: () => tamburService.labelPreviewFields({ rollId: rollId as string, customerId, consigneeId }),
    enabled: !!rollId,
    staleTime: 60_000,
    retry: false,
  });
}

/** Tartım (kaynak damgalı) + ölçülen en; yeni top = boş kutular (önceki topun değeri sızmaz). */
function useTamburMeasuredInputs(rollId: string | null | undefined, settings: TamburLabelSettings) {
  const [kgText, setKgTextState] = useState('');
  const [widthText, setWidthText] = useState('');
  // Kg okuyucuları ref'ten: otomatik kg'de tartı damgası ile kesim AYNI olayda (render beklenmeden) gider.
  const kgRef = useRef<{ text: string; stamp: KgStamp | null }>({ text: '', stamp: null });
  const setKgText = (t: string) => {
    kgRef.current = { ...kgRef.current, text: t };
    setKgTextState(t);
  };
  useEffect(() => {
    kgRef.current = { text: '', stamp: null };
    setKgTextState('');
    setWidthText('');
  }, [rollId]);
  const widthError = (): string | null => (Number.isNaN(parseWidthCm(widthText)) ? 'En 0–1000 cm arası bir sayı olmalı.' : null);
  return {
    kgText,
    setKgText,
    widthText,
    setWidthText,
    stampKg: (read: KgStamp) => {
      const text = String(read.kg).replace('.', ',');
      kgRef.current = { text, stamp: read };
      setKgTextState(text);
    },
    weightKg: () => {
      const kg = parseKg(kgRef.current.text);
      return kg == null || Number.isNaN(kg) ? undefined : kg;
    },
    error: () => weightError(settings, kgRef.current.text) ?? widthError(),
    extras: (): Pick<LabelTextsBody, 'weightSource' | 'widthCm'> => {
      const src = kgSource(kgRef.current.stamp, kgRef.current.text);
      const w = parseWidthCm(widthText);
      return { ...(src ? { weightSource: src } : {}), ...(w != null && !Number.isNaN(w) ? { widthCm: w } : {}) };
    },
  };
}
