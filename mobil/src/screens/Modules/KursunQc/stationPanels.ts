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

export interface StationPanelInput {
  /** undefined = eski backend → bugünkü düzen (kalite paneli açık). */
  inspectionEnabled?: boolean;
  properties: readonly { mode: 'AUTO' | 'OPTIONAL' | 'REQUIRED' }[];
}

export interface StationPanels {
  qualityPanel: boolean;
  processPanel: boolean;
  /** `TAP_VALUE` (tek dokunuş = top bitti) dalını D5 açar; bu sürüm hep `BUTTON`. */
  completion: StationCompletion;
  completeLabel: string;
}

export function composeStationPanels(input: StationPanelInput): StationPanels {
  const qualityPanel = input.inspectionEnabled !== false;
  return {
    qualityPanel,
    processPanel: input.properties.length > 0,
    completion: 'BUTTON',
    completeLabel: qualityPanel ? 'KK2 Tamamla' : 'Tamamla',
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

export function dativeTr(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const tail = spokenTail(trimmed.split(/\s+/).pop() ?? trimmed);
  let vowel = '';
  for (const c of tail) if (BACK.includes(c) || FRONT.includes(c)) vowel = c;
  const suffix = BACK.includes(vowel) ? 'a' : 'e';
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
