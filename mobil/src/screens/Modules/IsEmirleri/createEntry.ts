// İş Emirleri — oluşturma girişi (SAF): "Belge Okut" tuşundaki rota, formun ön seçili rotası, rota çelişki uyarısı,
// "Malın sahibi" kartı. Ayar KAPALIYKEN tuştaki (saklı) rota forma ve oluşturma yüküne HİÇ girmez.
import type { ProductionRoute } from '../../../services/route.service';
import type { WoCreateKind } from '../../../store/woCreateKinds';
import { SCAN_ROUTE, isScanRoute } from '../GelenBelge/woCreate/woFromDoc';
import type { WoType } from '../GelenBelge/woCreate/woForm';
import { TERIM } from '../../../lib/terim';

/** Tuştan forma geçen rota: ayar kapalıysa null (saklı seçim hiç kullanılmaz). */
export function buttonRouteFor(showOnButton: boolean, picked: ProductionRoute | null): ProductionRoute | null {
  return showOnButton ? picked : null;
}

/**
 * Formun ilk rotası: tuştaki açık seçim > kart rotası > "Sahada belirlenir" (yalnız Okutmayla kipinde; sıralıda null =
 * formda seçilir). Tuştaki "Sahada belirlenir" açık seçim sayılmaz: kart rotası gelirse o uygulanır.
 */
export function initialFormRoute(a: { buttonRoute: ProductionRoute | null; cardRoute: ProductionRoute | null; scanMode: boolean }): ProductionRoute | null {
  const explicit = a.buttonRoute && !isScanRoute(a.buttonRoute) ? a.buttonRoute : null;
  return explicit ?? a.cardRoute ?? (a.scanMode ? SCAN_ROUTE : null);
}

/** Kart rotası henüz kullanıcı seçmemişken ve form rotasızken uygulanır. */
export function shouldApplyCardRoute(route: ProductionRoute | null, touched: boolean, cardRoute: ProductionRoute | null): boolean {
  return !touched && !!cardRoute && (route === null || isScanRoute(route));
}

/** Kartın rotası seçilenden farklıysa sarı uyarı metni (engellemez); yoksa null. */
export function routeConflict(cardRoute: ProductionRoute | null, chosen: ProductionRoute | null): string | null {
  if (!cardRoute || !chosen || isScanRoute(chosen) || chosen.id === cardRoute.id) return null;
  return `Kartın rotası ${cardRoute.name}, seçilen rota farklı.`;
}

/** Saklı tuş rotası operatöre bağlıdır: `<userId>|<routeId>`; başka operatörün kaydı geçersizdir. */
export const encodeStoredRoute = (userId: string, routeId: string): string => `${userId}|${routeId}`;
export function storedRouteFor(raw: string | null, userId: string | null): string | null {
  if (!raw || !userId) return null;
  const i = raw.indexOf('|');
  return i > 0 && raw.slice(0, i) === userId && raw.length > i + 1 ? raw.slice(i + 1) : null;
}

export interface OwnerKindCardState {
  /** Cihazda iki tür de açıksa kart görünür; tek türde gizli ve tür sabit. */
  visible: boolean;
  value: WoCreateKind | null;
  /** Ön seçim nedeni (otomatik seçildiyse). */
  reason: string | null;
}

/**
 * Kartın ilk durumu. `fasonOwner`: belgedeki / seçilen müşteri fason müşterisiyse adı. Sistemde böyle bir rol bugün
 * yok (master veri: rol bayraktır, uydurulmaz) — çağıran null verir, kart boş gelir ve seçim zorunludur.
 */
export function ownerKindCard(kinds: readonly WoCreateKind[], fasonOwner: string | null): OwnerKindCardState {
  if (kinds.length <= 1) return { visible: false, value: kinds[0] ?? 'STANDARD', reason: null };
  if (fasonOwner) return { visible: true, value: 'CUSTOMER_GOODS', reason: `${fasonOwner} fason müşterisi, otomatik seçildi` };
  return { visible: true, value: null, reason: null };
}

/** Kart seçimi → İE türü: Müşteri malı = Fason; Bizim mal = bugünkü türetme (null) ya da formda seçilen stok/sipariş. */
export function woTypeForOwnerKind(kind: WoCreateKind | null, current: WoType | null): WoType | null {
  if (kind === 'CUSTOMER_GOODS') return 'CUSTOMER_GOODS_SERVICE';
  return current === 'CUSTOMER_GOODS_SERVICE' ? null : current;
}

/** Formdaki tür seçicisi değişince kart da izler. */
export const ownerKindForWoType = (t: WoType | null): WoCreateKind => (t === 'CUSTOMER_GOODS_SERVICE' ? 'CUSTOMER_GOODS' : 'STANDARD');

/**
 * Oluşturma formu başlığı: Fason seçiliyken "Fason <İE> · …", kendi üretimde / seçim yokken "<İE> · …". Ölçüt yalnız
 * mal sahibi türü (kaydedilecek `CUSTOMER_GOODS_SERVICE`); İE adı rejimden (`TERIM`).
 */
export function createFormTitle(kind: WoCreateKind | null, manual: boolean): string {
  const base = kind === 'CUSTOMER_GOODS' ? `Fason ${TERIM.terbiyeIsEmri.tekil}` : TERIM.terbiyeIsEmri.tekil;
  return `${base} · ${manual ? 'Elle oluştur' : 'Belge okut'}`;
}
