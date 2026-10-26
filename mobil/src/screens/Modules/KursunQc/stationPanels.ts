// =============================================================================
// İstasyon ekranının PANEL BİLEŞİMİ (KQ-D3) — saf fonksiyon
// =============================================================================
// Ekran istasyon TÜRÜNDEN seçilir (`constants/stationScreens.ts`, bijektif);
// ekranın İÇİ yetenekten kurulur: kalite paneli `inspectionEnabled`'dan, işlem
// paneli (özellik/gramaj) istasyon özelliklerinden. Eski backend alanı
// göndermez → kalite paneli açık (bugünkü ekran).
// =============================================================================

import { lowerTr } from '../../../utils/trCase';

export type StationCompletion = 'BUTTON' | 'TAP_VALUE';

type PanelMode = 'AUTO' | 'OPTIONAL' | 'REQUIRED';

export interface StationPanelProperty {
  mode: PanelMode;
  propertyId?: string;
  valueType?: 'FLAG' | 'CHOICE';
  variantOfPropertyId?: string | null;
  values?: readonly { code: string; name: string }[];
}

export interface StationPanelInput {
  /** undefined = eski backend → bugünkü düzen (kalite paneli açık). */
  inspectionEnabled?: boolean;
  properties: readonly StationPanelProperty[];
}

/** Tek dokunuş düzeninin girdisi: dokunulacak çeşit (gramaj) + bağlı bayrak (KURSUN). */
export interface TapValueConfig {
  variantPropertyId: string;
  variantMode: PanelMode;
  flagPropertyId: string | null;
  flagMode: PanelMode | null;
}

export interface StationPanels {
  qualityPanel: boolean;
  processPanel: boolean;
  /** `TAP_VALUE` = tek dokunuş top bitirir (KQ-D5, K9); aksi `BUTTON` (bugünkü). */
  completion: StationCompletion;
  completeLabel: string;
  tap: TapValueConfig | null;
}

/** Tek çeşit (değerli SEÇİM) + en çok onun bayrağı işaret ister → dokunuş yeter.
 *  Başka OPTIONAL/REQUIRED özellik varsa ek dokunuş gerekir → null (BUTTON). */
export function resolveTapValueConfig(properties: readonly StationPanelProperty[]): TapValueConfig | null {
  const variants = properties.filter((p) => !!p.variantOfPropertyId && !!p.propertyId);
  if (variants.length !== 1) return null;
  const v = variants[0];
  if (v.mode === 'AUTO' || v.valueType === 'FLAG' || (v.values ?? []).length === 0) return null;
  const flag = properties.find((p) => p.propertyId === v.variantOfPropertyId) ?? null;
  const others = properties.filter((p) => p !== v && p !== flag && p.mode !== 'AUTO');
  if (others.length > 0) return null;
  return {
    variantPropertyId: v.propertyId as string,
    variantMode: v.mode,
    flagPropertyId: flag?.propertyId ?? null,
    flagMode: flag?.mode ?? null,
  };
}

export function composeStationPanels(input: StationPanelInput): StationPanels {
  const qualityPanel = input.inspectionEnabled !== false;
  // Kalite paneli varken değer düğmesi yalnız SEÇİMDİR (birleşik düzen c).
  const tap = qualityPanel ? null : resolveTapValueConfig(input.properties);
  return {
    qualityPanel,
    processPanel: input.properties.length > 0,
    completion: tap ? 'TAP_VALUE' : 'BUTTON',
    completeLabel: qualityPanel ? 'KK2 Tamamla' : tap ? 'Değere dokun' : 'Tamamla',
    tap,
  };
}

// Türkçe yönelme eki ("Tambur'a", "KK Masa 2'ye"): son sesli uyumu + sesliyle
// bitende kaynaştırma "y". Rakam okunuşuyla, sessiz kısaltma harf adıyla çekilir.
const BACK = 'aıou';
const FRONT = 'eiöü';
const DIGIT_WORD: Record<string, string> = {
  '0': 'sıfır', '1': 'bir', '2': 'iki', '3': 'üç', '4': 'dört',
  '5': 'beş', '6': 'altı', '7': 'yedi', '8': 'sekiz', '9': 'dokuz',
};
const TENS_WORD: Record<string, string> = {
  '1': 'on', '2': 'yirmi', '3': 'otuz', '4': 'kırk', '5': 'elli',
  '6': 'altmış', '7': 'yetmiş', '8': 'seksen', '9': 'doksan',
};

function spokenTail(word: string): string {
  const m = /(\d+)$/.exec(word);
  if (m) {
    const n = m[1];
    const last = n[n.length - 1];
    if (last !== '0') return DIGIT_WORD[last];
    if (n.length >= 2 && n[n.length - 2] !== '0') return TENS_WORD[n[n.length - 2]];
    if (n.length >= 4 && /000$/.test(n)) return 'bin';
    if (n.length >= 3) return 'yüz';
    return 'sıfır';
  }
  const lower = lowerTr(word);
  if (![...lower].some((c) => BACK.includes(c) || FRONT.includes(c))) {
    // Sesli harfsiz kısaltma (KK, MTR): son harfin adı — "ka" kalın, diğerleri ince.
    return lower.endsWith('k') ? 'ka' : 'e';
  }
  return lower;
}

// Ünlü uyumuna uymayan alıntılar (ince "l"/"t"): son kalın sesliye rağmen ek ince
// ("Kontrol'e", "Saat'e"). Yalnız SON sözcük TAM eşleşir — "Kanal'a" etkilenmez.
const FRONT_SUFFIX_LOANS = new Set([
  'kontrol', 'rol', 'gol', 'alkol', 'sembol', 'protokol', 'petrol', 'metropol',
  'saat', 'kabul', 'usul', 'hal', 'ideal', 'final', 'normal', 'sinyal', 'total',
  'metal', 'spiral', 'meal', 'hayal', 'dikkat', 'seyahat', 'kalp',
]);

export function dativeTr(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const lastWord = trimmed.split(/\s+/).pop() ?? trimmed;
  const tail = spokenTail(lastWord);
  let vowel = '';
  for (const c of tail) if (BACK.includes(c) || FRONT.includes(c)) vowel = c;
  const loan = FRONT_SUFFIX_LOANS.has(lowerTr(lastWord));
  const suffix = !loan && BACK.includes(vowel) ? 'a' : 'e';
  const endsVowel = BACK.includes(tail[tail.length - 1]) || FRONT.includes(tail[tail.length - 1]);
  return `${trimmed}'${endsVowel ? 'y' : ''}${suffix}`;
}

/** Sonraki istasyon metni: undefined (eski backend) → bugünkü "Tambur";
 *  null (son adım) → null (çağıran yönsüz metin kurar). */
export function nextStationLabel(nextStepName: string | null | undefined): string | null {
  if (nextStepName === undefined) return 'Tambur';
  return nextStepName;
}

/** "Adımı Kapat — Toplar Tambur'a" ya da son adımda "Adımı Kapat". */
export function finishStepLabel(nextStepName: string | null | undefined): string {
  const next = nextStationLabel(nextStepName);
  return next ? `Adımı Kapat — Toplar ${dativeTr(next)}` : 'Adımı Kapat';
}

/** "Top seçilmedi" ipucu düzene göre: tablette kuyruk sağ sütunda, telefonda
 *  (dikey) üst şeritteki "Açık İşler" çekmecesinde. */
export function emptyRollHint(compact: boolean): string {
  return compact
    ? "Yukarıdaki «Açık İşler»e dokunup top kuyruğundan birini seçin"
    : 'Sağdaki top kuyruğundan birini seçin';
}
