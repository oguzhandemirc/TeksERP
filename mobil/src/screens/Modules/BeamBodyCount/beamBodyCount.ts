// =============================================================================
// GÖVDE SAYIMI — saf mantık (ağ yok): okutma listesi · kapsam seçenekleri · kahraman sayı · düzeltme gövdesi
// =============================================================================
// Sayım DURUMSUZ: okunan kodlar yalnız tablette durur, her okutmada sunucu önizlemesi yeniden sınıflar.
// Aynı kodun tekrarı (harf farkı dahil) listeye ikinci kez girmez; esnek eşleşen ikizleri sunucu tek gövdeye indirir.
// =============================================================================
import type { CountContext, CountLine, CountPreview, CountScope, TransitionBody } from '../../../services/beamBodyCount.service';

export const ALL_STOCK = 'ALL';
export type CountTab = 'missing' | 'unexpected' | 'unknown' | 'matched';

/** Okunan kodu listeye ekler; boş ya da tekrar ise `added:false` (liste aynı). */
export function addCode(codes: readonly string[], raw: string): { codes: string[]; added: boolean } {
  const code = raw.trim();
  if (!code) return { codes: [...codes], added: false };
  const folded = code.toLowerCase();
  if (codes.some((c) => c.toLowerCase() === folded)) return { codes: [...codes], added: false };
  return { codes: [...codes, code], added: true };
}

export interface ScopeOption { value: string; label: string; sublabel: string }

/** Kapsam seçici: Bütün depolar · her depo · gövde bulunduran her devereci (beklenen sayısıyla). */
export function scopeOptions(ctx: CountContext | undefined): ScopeOption[] {
  if (!ctx) return [];
  return [
    { value: ALL_STOCK, label: 'Bütün depolar', sublabel: `${ctx.stockTotal} gövde bizde` },
    ...ctx.warehouses.map((w) => ({ value: `W:${w.id}`, label: w.name, sublabel: `Depo · ${w.expectedCount} gövde` })),
    ...ctx.subcontractors.map((s) => ({ value: `S:${s.id}`, label: s.name, sublabel: `Devereci · ${s.expectedCount} gövde` })),
  ];
}

export function scopeFromKey(key: string): CountScope {
  if (key.startsWith('W:')) return { warehouseId: key.slice(2) };
  if (key.startsWith('S:')) return { subcontractorId: key.slice(2) };
  return { warehouseId: null };
}

export function scopeLabel(key: string, ctx: CountContext | undefined): string {
  return scopeOptions(ctx).find((o) => o.value === key)?.label ?? 'Bütün depolar';
}

/** Kahraman sayı: okunan (eşleşen) / beklenen; fark yoksa ve hepsi okunduysa yeşil "tamam". */
export function heroFigure(p: CountPreview | undefined): { value: string; unit: string; done: boolean } {
  if (!p) return { value: '— / —', unit: 'okunan / beklenen', done: false };
  const done = p.expectedCount > 0 && p.missing.length === 0 && p.unexpected.length === 0 && p.unknown.length === 0;
  return { value: `${p.matched.length} / ${p.expectedCount}`, unit: 'okunan / beklenen', done };
}

export function tabCounts(p: CountPreview | undefined): Record<CountTab, number> {
  return { missing: p?.missing.length ?? 0, unexpected: p?.unexpected.length ?? 0, unknown: p?.unknown.length ?? 0, matched: p?.matched.length ?? 0 };
}

/** Önizleme gelince ilk açılacak sekme: önce sahada düzeltilecek olan (başka yerde), sonra eksik. */
export function firstTab(p: CountPreview | undefined): CountTab {
  const c = tabCounts(p);
  if (c.unexpected) return 'unexpected';
  if (c.unknown) return 'unknown';
  return 'missing';
}

export function linesFor(tab: CountTab, p: CountPreview | undefined): CountLine[] {
  if (!p || tab === 'unknown') return [];
  return p[tab];
}

/** Öneriden elle geçiş gövdesi (panelle aynı uç; kararı sunucu verir). */
export function fixBody(line: CountLine): TransitionBody | null {
  const s = line.suggestion;
  if (!s) return null;
  return { kind: s.kind, ...(s.subcontractorId ? { subcontractorId: s.subcontractorId } : {}), ...(s.warehouseId ? { warehouseId: s.warehouseId } : {}), ...(s.reason ? { reason: s.reason } : {}) };
}
