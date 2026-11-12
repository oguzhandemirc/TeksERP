// Tek İE formunun Belge şeridi dili: durum hapı + en çok iki kısa, eylemli ileti. Sunucu `reason` metni AYRIŞTIRILMAZ
// (o metin panele yazılmıştır); karar yapısal alanlardan. Gülkesim: belge satırsız okunur ama müşteri/parti/metre dolar →
// "satır çıkmadı" bir hata DEĞİLDİR, ileti çıkmaz.
import type { PillTone } from '../../../../components/form/tone';
import type { ReadSummary } from '../../../../services/inboundDoc.service';
import type { ReadWatch } from '../readResult';

export type NoticeAction = 'reread' | 'recheck';
export interface DocNotice {
  key: string;
  tone: 'info' | 'warn' | 'danger';
  text: string;
  action?: NoticeAction;
  /** Sunucu uyarı kodu (çapraz doğrulama) — tek formun uyarı modalı başlığı bundan. */
  code?: string;
  /** "Belgede bulunamadı" alan etiketleri. */
  fields?: string[];
}
export interface DocReadPill {
  tone: PillTone;
  icon: 'check' | 'progress-clock' | 'alert-outline' | 'alert-circle-outline' | 'information-outline';
  text: string;
}
export interface DocReadInput {
  watch: ReadWatch | null;
  /** Formda belgeden gelen bir değer var mı (müşteri / metre …) — özet alanları gelmeden de doluluk görülür. */
  formFilled?: boolean;
  detailFailed?: boolean;
}

const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';

/** Okuma en az bir form alanını doldurdu mu (sahip / parti / metre / form alanları). */
export function readFilledAny(s: ReadSummary): boolean {
  const fields = Object.values(s.formFields ?? {});
  return [s.ownerCustomerId, s.ownerSuggestion, s.ownerUnmatched, s.customerBatchNo, s.ourBatchNo, s.kursunMeters, ...fields].some(has);
}

const PILL_OK: DocReadPill = { tone: 'ok', icon: 'check', text: 'Okundu' };
const PILL_BUSY: DocReadPill = { tone: 'busy', icon: 'progress-clock', text: 'Okunuyor…' };
const PILL_CHECK: DocReadPill = { tone: 'warn', icon: 'alert-outline', text: 'Kontrol et' };
const PILL_FAILED: DocReadPill = { tone: 'missing', icon: 'alert-circle-outline', text: 'Okunamadı' };
const PILL_MANUAL: DocReadPill = { tone: 'info', icon: 'information-outline', text: 'Elle doldurun' };

const emptyRead = (s: ReadSummary, i: DocReadInput) => s.state === 'READ' && s.lineCount === 0 && !i.formFilled && !readFilledAny(s);

export function docReadPill(i: DocReadInput): DocReadPill {
  const w = i.watch;
  if (!w || w.phase === 'polling') return PILL_BUSY;
  if (w.phase !== 'done') return PILL_CHECK;
  const s = w.summary;
  if (s.state === 'READING') return PILL_BUSY;
  if (s.state === 'FAILED') return PILL_FAILED;
  if (s.state === 'NO_SERVICE' || s.state === 'NO_PAGES') return PILL_MANUAL;
  if (s.state === 'PARTIAL' || emptyRead(s, i)) return PILL_CHECK;
  return PILL_OK;
}

const STATE_NOTICE: Partial<Record<ReadSummary['state'], DocNotice>> = {
  PARTIAL: { key: 'kismi', tone: 'warn', text: 'Bazı sayfalar okunamadı. Eksikleri kontrol edin.', action: 'reread' },
  FAILED: { key: 'okunamadi', tone: 'danger', text: 'Belge okunamadı. Tekrar okutun ya da elle doldurun.', action: 'reread' },
  NO_SERVICE: { key: 'servis-yok', tone: 'info', text: 'Otomatik okuma kapalı; bilgileri elle girin.' },
  NO_PAGES: { key: 'sayfa-yok', tone: 'info', text: 'Belgede okunacak fotoğraf yok; bilgileri elle girin.' },
};

/** Şablonda tanımlı olup okumada değeri çıkmayan alanların etiketleri (GENEL şablonda / eski sunucuda boş). */
export function missingTemplateFields(s: ReadSummary): string[] {
  return (s.templateFields ?? []).filter((f) => !has(f.value)).map((f) => f.label);
}

/** Sunucunun çapraz doğrulama uyarı kodları — formda sarı iletiyle gösterilir (diğer okuma uyarıları panelde). */
export const CROSS_CHECK_CODES: ReadonlySet<string> = new Set(['METER_VALUES_DIFFER', 'KG_METER_RATIO']);

/** Belge şeridi altındaki iletiler (§2c tablosu); "panel" geçen metin yok — eleman paneli görmez. */
export function docReadNotices(i: DocReadInput): DocNotice[] {
  const out: DocNotice[] = [];
  const w = i.watch;
  if (w?.phase === 'timeout') out.push({ key: 'zaman-asimi', tone: 'warn', text: 'Okuma uzun sürdü.', action: 'recheck' });
  if (w?.phase === 'error') out.push({ key: 'hata', tone: 'danger', text: 'Okuma durumu alınamadı.', action: 'recheck' });
  if (w?.phase === 'done') {
    const s = w.summary;
    const byState = STATE_NOTICE[s.state];
    if (byState) out.push(byState);
    else if (emptyRead(s, i)) out.push({ key: 'bos', tone: 'warn', text: 'Belgeden bilgi çıkmadı. Tekrar okutun ya da elle doldurun.', action: 'reread' });
    // Şablonda olup okunamayan alanlar (eski "Belge okundu" kartının kırmızı karoları) formda sarı iletiyle kalır.
    const missing = missingTemplateFields(s);
    if (missing.length > 0) out.push({ key: 'eksik-alan', tone: 'warn', text: `Belgede bulunamadı: ${missing.join(', ')} — formda kontrol edin.`, fields: missing });
    // Çapraz doğrulama (sunucu `cross-check.ts`): değer değişmez, yalnız karşılaştırma iletisi.
    for (const n of s.notices ?? []) if (CROSS_CHECK_CODES.has(n.code)) out.push({ key: `capraz-${n.code}`, tone: 'warn', text: n.detail, code: n.code });
  }
  if (i.detailFailed) out.push({ key: 'detay', tone: 'info', text: 'Belge ayrıntısı alınamadı; özet bilgilerle dolduruldu.' });
  return out;
}
