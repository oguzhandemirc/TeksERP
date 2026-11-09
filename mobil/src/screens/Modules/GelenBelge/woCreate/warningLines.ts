// Tek İE formunun okuma UYARILARI (kullanıcı 2026-11-09): belge başlığı altındaki sarı şerit yerine başlık çubuğunda sarı
// ünlem + ortada modal. Modal dili fabrikada bir bakışta okunur: BÜYÜK HARFLİ kısa başlık + iki nokta + değer, açıklama yok.
// Başlıklar sabit büyük harf metindir (yerel ayara bağlı büyütme yasak). Eylemli iletiler (Yeniden okut / bak) şeritte kalır.
import type { DocNotice } from './docReadNotice';

export interface WarningLine {
  key: string;
  /** Sabit BÜYÜK HARFLİ kısa başlık. */
  title: string;
  /** Değer (sayılar / alan adları); yoksa boş. */
  value: string;
}

/** Uyarı türü → modal başlığı (sunucu kodu `cross-check.ts` + istemci "eksik alan"). */
export const WARNING_TITLE: Readonly<Record<string, string>> = {
  METER_VALUES_DIFFER: 'İKİ FARKLI METRE TESPİT EDİLDİ',
  KG_METER_RATIO: 'GRAMAJ ARALIK DIŞI',
  'eksik-alan': 'BELGEDE BULUNAMADI',
};
export const OTHER_WARNING_TITLE = 'OKUMA UYARISI';
/** Bilinmeyen türde değer bu uzunlukta kesilir. */
export const OTHER_VALUE_MAX = 60;

/** Modala giden iletiler: eylemsiz sarı okuma uyarıları (çapraz doğrulama + şablonda olup okunamayan alanlar). */
export const isWarningNotice = (n: DocNotice): boolean => n.key === 'eksik-alan' || n.key.startsWith('capraz-');

/** Açıklama kuyruğu (" — kaynak metreyi…") düşer. */
const head = (t: string) => t.split(' — ')[0]!.trim();

function valueOf(n: DocNotice): string {
  if (n.key === 'eksik-alan') return (n.fields ?? []).join(', ');
  const t = head(n.text);
  if (n.code === 'METER_VALUES_DIFFER') {
    const m = /(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)\s*$/.exec(t);
    if (m) return `${m[1]} / ${m[2]}`;
  }
  if (n.code === 'KG_METER_RATIO') {
    // "734 kg / 241 m, en 150 cm → 203 g/m² (makul 15–1500)" → "203 g/m² (makul 15–1500)"
    const arrow = t.lastIndexOf('→');
    if (arrow >= 0) return t.slice(arrow + 1).trim();
  }
  return t.length > OTHER_VALUE_MAX ? `${t.slice(0, OTHER_VALUE_MAX - 1).trimEnd()}…` : t;
}

/** Modal satırları; tür bilinmiyorsa genel başlık + kısaltılmış metin. */
export function warningLines(notices: readonly DocNotice[]): WarningLine[] {
  return notices.filter(isWarningNotice).map((n) => ({
    key: n.key,
    title: WARNING_TITLE[n.code ?? n.key] ?? OTHER_WARNING_TITLE,
    value: valueOf(n),
  }));
}
