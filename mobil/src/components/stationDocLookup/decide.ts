// İstasyonda belgeden iş emri bulma (K17) — sunucu sonucunun ekranda ne yapacağı (saf; jest sınar).
// Çok İE (2026-11-06): sunucu ekran bilgisini aldıysa her İE "burada bekliyor mu" (`atStation`) ile gelir.
import type { StationLookupResult, StationLookupWorkOrder } from '../../services/stationDocLookup.service';

export type LookupDecision =
  /** `siblings`: aynı belgenin bütün İE'leri (şerit için); tek İE'de boş. */
  | { kind: 'open'; workOrder: StationLookupWorkOrder; siblings: StationLookupWorkOrder[] }
  | { kind: 'choose'; workOrders: StationLookupWorkOrder[]; message: string }
  /** Doğrulama eşiği geçilemedi: kendiliğinden AÇILMAZ; görevli "Eminim, aç" derse açılır, değilse elle arar. */
  | { kind: 'unsure'; workOrders: StationLookupWorkOrder[]; message: string }
  | { kind: 'empty'; message: string };

/** "Burada" sayılır: burada bekliyor YA DA rotasız ve burada başlatılabilir (açılınca okutmayla rota adımı ekler). */
export const isHere = (w: StationLookupWorkOrder): boolean => w.atStation === 'HERE' || w.atStation === 'STARTABLE_HERE';

/**
 * Tek İE → doğrudan aç · çok İE'de burada bekleyen TEK İE → onu aç (+ şerit) · birden çoğu burada → seçtir (burada
 * olanlar üstte) · hiçbiri burada → seçtir (her satır nerede olduğunu söyler) · eski sunucu (alan yok) → bugünkü liste.
 */
export function decideLookup(r: StationLookupResult): LookupDecision {
  const all = r.workOrders;
  const unverified = r.unverifiedWorkOrders ?? [];
  if (all.length === 0 && unverified.length > 0) return { kind: 'unsure', workOrders: unverified, message: unsureMessage(r.verification?.bestScore ?? null, r.verification?.bestStrong ?? true) };
  // İki FARKLI belge eşiği geçtiyse (toleranslı eşleşme) hiçbiri kendiliğinden açılmaz.
  if (new Set(all.map((w) => w.verification?.targetKey ?? '')).size > 1) return { kind: 'choose', workOrders: all, message: r.message };
  if (all.length === 1) return { kind: 'open', workOrder: all[0]!, siblings: [] };
  if (all.length === 0) return { kind: 'empty', message: r.message };
  const known = all.some((w) => w.atStation != null);
  if (!known) return { kind: 'choose', workOrders: all, message: r.message };
  const here = all.filter(isHere);
  if (here.length === 1) return { kind: 'open', workOrder: here[0]!, siblings: all };
  const where = r.station?.label ? ` (${r.station.label})` : '';
  if (here.length === 0) {
    return { kind: 'choose', workOrders: all, message: `Bu belgede ${all.length} parti var; hiçbiri bu istasyonda${where} beklemiyor. Nerede olduklarına bakıp yine de açabilirsiniz.` };
  }
  return {
    kind: 'choose',
    workOrders: [...here, ...all.filter((w) => !isHere(w))],
    message: `Bu belgede ${all.length} parti var; ${here.length} tanesi bu istasyonda${where} açılabilir. Açılacak olanı seçin.`,
  };
}

/** Satırın büyük yazısı: parti no (bizim) → müşteri partisi → İE no. */
export function partyLabel(w: StationLookupWorkOrder): string {
  if (w.batchNumbers.length > 0) return w.batchNumbers.join(', ');
  const customer = w.documents.map((d) => d.customerBatchNo).find((v) => !!v);
  return customer ?? w.workOrderNumber;
}

/** Satır ayrıntısı: işlem · top/metre · müşteri İE no · İE no (eski sunucuda yalnız bugünkü alt metin). */
export function rowDetail(w: StationLookupWorkOrder): string {
  if (w.rollCount === undefined) return workOrderSubtitle(w);
  const orders = [...new Set(w.documents.map((d) => d.customerOrderNo).filter((v): v is string => !!v))];
  return [
    w.processText ?? '',
    `${w.rollCount} top · ${formatMeters(w.meters ?? 0)} m`,
    orders.length > 0 ? `Müşteri İE ${orders.join(', ')}` : '',
    w.workOrderNumber,
  ].filter(Boolean).join(' · ');
}

/** "Burada bekliyor" / "Buraya henüz gelmedi · Şu an: Tambur 1 (3 top)". */
export function rowWhere(w: StationLookupWorkOrder): string {
  return [w.atStationText ?? '', w.locationText ?? ''].filter(Boolean).join(' · ');
}

function formatMeters(m: number): string {
  return Number.isInteger(m) ? String(m) : m.toFixed(1).replace('.', ',');
}

/** Şerit metni: "Bu belgede 3 parti var · açılan: P1 (YIKAMA)". */
export function siblingStripText(siblings: StationLookupWorkOrder[], opened: StationLookupWorkOrder): string {
  const process = opened.processText ? ` (${opened.processText})` : '';
  return `Bu belgede ${siblings.length} parti var · açılan: ${partyLabel(opened)}${process}`;
}

/** Liste satırının alt metni (eski sunucu): parti no'ları · belge no'ları (fiş no öncelikli). */
export function workOrderSubtitle(w: StationLookupWorkOrder): string {
  const docs = w.documents.map((d) => d.senderDocNo ?? d.noteNo);
  return [w.batchNumbers.join(', '), docs.length ? `Belge ${docs.join(', ')}` : ''].filter(Boolean).join(' · ');
}

/** Elle arama sunucuya en az 2 karakterle gider (sunucu kapısıyla aynı). */
export const MIN_SEARCH_LENGTH = 2;
export function searchable(q: string): boolean {
  return q.trim().length >= MIN_SEARCH_LENGTH;
}

/** "Belge tam eşleşmedi (%62) — listeden seçin" · puan yoksa nedeni. */
export function unsureMessage(best: number | null, strong = true): string {
  if (best === null || !strong) return 'Belge doğrulanamadı (top listesi okunamadı) — listeden seçin ya da fiş no ile arayın.';
  return `Belge tam eşleşmedi (%${best}) — listeden seçin ya da fiş no ile arayın.`;
}

/** Ne tuttu / ne tutmadı: "%62 · Top no ✗ 3/16 · Müşteri ✓". */
export function verifyText(w: StationLookupWorkOrder): string {
  const v = w.verification;
  if (!v) return '';
  const parts = v.components.map((c) => `${c.label} ${c.matched ? '✓' : '✗'}${c.detail && c.detail !== 'tuttu' ? ` ${c.detail}` : ''}`);
  return [v.score === null ? 'Puan yok' : `%${v.score}`, ...parts].join(' · ');
}

/** Rozet tonu: tuttu · kısmen tuttu (ör. 14/16, OCR-benzer) · tutmadı. */
export type VerifyTone = 'ok' | 'partial' | 'miss';

export interface VerifyBadge {
  key: string;
  label: string;
  tone: VerifyTone;
  /** "3/16" · "okunan 56967"; tutan alanda ("tuttu") boş. */
  detail: string | null;
}

/** Bileşen → rozet: `matched` tuttu; 0 < oran < 1 kısmi (yanlış ✗ değil); oran 0 tutmadı. */
export function verifyBadges(w: StationLookupWorkOrder): VerifyBadge[] {
  return (w.verification?.components ?? []).map((c) => ({
    key: c.key,
    label: c.label,
    tone: c.matched ? 'ok' : c.ratio > 0 ? 'partial' : 'miss',
    detail: c.detail && c.detail !== 'tuttu' ? c.detail : null,
  }));
}

/** Puan rozeti: puan yoksa "Puan yok"; eşik verilmişse "eşik %80" eki. */
export function verifyScoreText(w: StationLookupWorkOrder): string | null {
  const v = w.verification;
  if (!v) return null;
  if (v.score === null) return 'Puan yok';
  return v.threshold > 0 ? `%${v.score} · eşik %${v.threshold}` : `%${v.score}`;
}
