/**
 * Hızlı İş Emri — eksik ve boş alan kararı TEK yerde (saf, DB'siz sınanır).
 *
 * Eskiden iki ayrı kural kümesi vardı (görünümdeki adım engeli + hook'taki başlatma
 * engeli) ve ayrıştılar: kat tipi görünümde koşulsuz isteniyordu, Tambur'suz rotada
 * alan gizli olduğu için operatör 2. adımda kilitli kalıyordu.
 *
 * İki sınıf: `blocking` başlatmayı durdurur; `empty` isteğe bağlı ama boş bırakılmış
 * alanlardır — engel değil, ONAY adımında bilgi olarak gösterilir.
 */

export type QuickWoStep = 0 | 1 | 2;

export interface QuickWoIssue {
  field: 'rolls' | 'route' | 'fold' | 'width' | 'routeApply';
  step: QuickWoStep;
  /** Alanın altında / altbilgide gösterilen tam cümle. */
  message: string;
  /** "Eksik: …" özet satırındaki kısa ad. */
  short: string;
}

export interface QuickWoEmptyField {
  field: 'width' | 'color' | 'order';
  step: QuickWoStep;
  message: string;
}

export interface QuickWoIssueInput {
  rollCount: number;
  routeTemplateId: string | null;
  hasTambur: boolean;
  foldType: string | null;
  foldNotConfigured: boolean;
  applyMissing: string | null;
  /** En alanının HAM metni — geçersiz giriş sessizce düşmesin diye sayıya çevrilmeden gelir. */
  width: string;
  canApplyColor: boolean;
  /** Hedef renk belirli mi (elle seçilmiş ya da siparişten gelmiş). */
  hasColor: boolean;
  orderLinked: boolean;
}

export const parsePositiveNumber = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function collectQuickWoIssues(i: QuickWoIssueInput): {
  blocking: QuickWoIssue[];
  empty: QuickWoEmptyField[];
} {
  const blocking: QuickWoIssue[] = [];
  const empty: QuickWoEmptyField[] = [];

  if (i.rollCount === 0) {
    blocking.push({ field: 'rolls', step: 0, short: 'Top', message: 'En az bir top okutun veya listeden seçin.' });
  }
  if (!i.routeTemplateId) {
    blocking.push({ field: 'route', step: 1, short: 'Rota', message: 'Bir rota seçin.' });
  }
  // Kat yalnız Tambur'lu rotada sorulur ve istenir (alan başka rotada görünmez).
  if (i.routeTemplateId && i.hasTambur && !i.foldType) {
    blocking.push({
      field: 'fold',
      step: 1,
      short: 'Kat tipi',
      message: i.foldNotConfigured
        ? 'Kat değeri tanımlı değil — panelden Kumaş Özellikleri → KAT ekleyin.'
        : 'Kat tipi seçin.',
    });
  }
  const widthText = i.width.trim();
  if (widthText && parsePositiveNumber(widthText) == null) {
    blocking.push({ field: 'width', step: 1, short: 'En', message: 'En sıfırdan büyük bir sayı olmalı (örn. 150).' });
  }
  if (i.applyMissing) {
    blocking.push({
      field: 'routeApply',
      step: 1,
      short: 'Rota',
      message: `Seçili rota ${i.applyMissing} uygulayacak bir fason adımı içermiyor. Uygun bir rota seçin.`,
    });
  }

  if (!widthText) {
    empty.push({ field: 'width', step: 1, message: 'En girilmedi' });
  }
  if (i.canApplyColor && !i.hasColor) {
    empty.push({ field: 'color', step: 1, message: 'Hedef renk seçilmedi — ham (renksiz) açılacak' });
  }
  if (!i.orderLinked) {
    empty.push({ field: 'order', step: 0, message: 'Sipariş bağlanmadı — stok üretimi olarak açılacak' });
  }

  return { blocking, empty };
}

/** O adımda çözülmesi gereken engeller; son adım (ONAY) bütün engelleri görür. */
export function blockingForStep(blocking: QuickWoIssue[], step: number, lastStep: number): QuickWoIssue[] {
  return step >= lastStep ? blocking : blocking.filter((b) => b.step === step);
}

/** Tek satır özet: "Eksik: Rota · Kat tipi" — aynı kısa ad bir kez. */
export function summarizeMissing(issues: QuickWoIssue[]): string | null {
  if (issues.length === 0) return null;
  const names = [...new Set(issues.map((b) => b.short))];
  return `Eksik: ${names.join(' · ')}`;
}
