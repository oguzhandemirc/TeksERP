// =============================================================================
// Çuvalsız sevk (dökme / araba) — SAF mantık. Ekran ve hook buradan okur; sunucu
// kararı (uygunluk, tekillik, yetki) sunucudadır, burası yalnız ÖN kontrol + gövde.
// =============================================================================
import type { LocatedRoll } from '../../../services/packing.service';

/** Yükleme biçimi: BULK = kamyon kasasına dökme, CART = top taşıma arabası. */
export type LoadMode = 'BULK' | 'CART';

export interface LooseRoll {
  id: string;
  barcode: string;
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
  /** Araba kipinde topun yüklendiği arabanın no'su; dökmede null. */
  cartLabel: string | null;
}

export interface CartGroup {
  label: string;
  rolls: LooseRoll[];
  meters: number;
}

/** Sunucudaki `unitLabel` sütunu ile aynı tavan. */
export const CART_LABEL_MAX = 32;

/** Araba no — serbest metin (kullanıcı kararı 2026-11-06): kenar boşluğu ve çift boşluk atılır. */
export function normalizeCartLabel(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, CART_LABEL_MAX);
}

/** Okutulan topun listeye girebilir mi olduğu — ret sebebi operatör diliyle. */
export function checkScannedRoll(
  r: Pick<LocatedRoll, 'id' | 'status' | 'sack' | 'shipment'>,
  existingIds: readonly string[],
): { ok: true } | { ok: false; duplicate: boolean; reason: string } {
  if (existingIds.includes(r.id)) return { ok: false, duplicate: true, reason: 'Zaten listede' };
  if (r.shipment) return { ok: false, duplicate: false, reason: 'Bu top zaten bir sevkiyatta' };
  if (r.sack) return { ok: false, duplicate: false, reason: `Çuvalın içinde (${r.sack.sackNo}) — önce çuvaldan çıkarın` };
  if (r.status === 'SHIPPED') return { ok: false, duplicate: false, reason: 'Bu top sevk edilmiş' };
  return { ok: true };
}

/** Arabaya göre gruplar — ilk okutulan arabanın grubu önce (ekleme sırası korunur). */
export function groupByCart(rolls: readonly LooseRoll[]): CartGroup[] {
  const map = new Map<string, CartGroup>();
  for (const r of rolls) {
    const label = r.cartLabel ?? '';
    const g = map.get(label) ?? { label, rolls: [], meters: 0 };
    g.rolls.push(r);
    g.meters += r.qty;
    map.set(label, g);
  }
  return [...map.values()];
}

export function totalMeters(rolls: readonly LooseRoll[]): number {
  return Math.round(rolls.reduce((s, r) => s + r.qty, 0) * 100) / 100;
}

/** Gönderim öncesi engel — yoksa null. */
export function validateLoad(mode: LoadMode, rolls: readonly LooseRoll[]): string | null {
  if (rolls.length === 0) return 'Önce top okutun';
  if (mode === 'CART') {
    if (rolls.some((r) => !r.cartLabel)) return 'Arabası seçilmemiş top var — her top bir arabaya yüklenmeli';
  }
  return null;
}

/** İrsaliyede yük satırının metni: "Dökme – 12 top" / "Araba A-12 – 5 top". */
export function loadLine(mode: LoadMode, label: string | null, rollCount: number): string {
  return mode === 'BULK' ? `Dökme – ${rollCount} top` : `Araba ${label ?? '?'} – ${rollCount} top`;
}

/** Sunucuya gidecek yük birimleri — dökmede tek birim, arabada araba başına bir birim. */
export function buildLoadUnits(
  mode: LoadMode,
  rolls: readonly LooseRoll[],
): { kind: LoadMode; label?: string; rollIds: string[] }[] {
  if (mode === 'BULK') return [{ kind: 'BULK', rollIds: rolls.map((r) => r.id) }];
  return groupByCart(rolls).map((g) => ({ kind: 'CART' as const, label: g.label, rollIds: g.rolls.map((r) => r.id) }));
}

/** Kip değişince araba bilgisini düşür (dökme) ya da aktif arabaya ata (arabasız toplar). */
export function applyMode(rolls: readonly LooseRoll[], mode: LoadMode, activeCart: string | null): LooseRoll[] {
  if (mode === 'BULK') return rolls.map((r) => (r.cartLabel ? { ...r, cartLabel: null } : r));
  return rolls.map((r) => (r.cartLabel ? r : { ...r, cartLabel: activeCart }));
}
