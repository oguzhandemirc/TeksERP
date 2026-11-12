// Tek İE formunun "Kendi üretim" kipi (SAF; testli): mal sahibi Kendi üretim (STANDARD) iken gelen belge taslağı
// açılmaz, sol sütun yerine isteğe bağlı "Toplar" bölümü gelir ve kayıt `POST /work-orders/quick-start` + `ownGoods`
// ile gider (topsuz da açılır). Uygunluğun son sözü sunucuda (emanet top 400 WO_OWN_GOODS_CONSIGNED_ROLL).
import type { ProductionRoute } from '../../../../services/route.service';
import type { QuickStartRequest } from '../../../../services/workOrder.service';
import type { WoCreateKind } from '../../../../store/woCreateKinds';
import { isScanRoute } from './woFromDoc';
import type { ExtraBody } from './woForm';

/**
 * Form kendi üretim kipinde mi: yalnız İş Emirleri girişinde (`kinds` verilmiş) — tek tür STANDARD ya da iki türde
 * kartta STANDARD seçili. Kart boşken / Fason seçiliyken / başka girişte (gelen belge formu) bugünkü belge kipi.
 */
export function isOwnGoodsMode(kinds: readonly WoCreateKind[] | undefined, chosen: WoCreateKind | null): boolean {
  if (!kinds || kinds.length === 0) return false;
  if (kinds.length === 1) return kinds[0] === 'STANDARD';
  return chosen === 'STANDARD';
}

/** Okutma anı ön süzgeci: müşteri malı (emanet) top kendi üretime girmez (sunucu aynısını reddeder). */
export function ownGoodsRollReject(roll: { ownerCustomerId?: string | null; ownerCustomer?: { id: string; name?: string } | null }): string | null {
  const id = roll.ownerCustomerId ?? roll.ownerCustomer?.id ?? null;
  if (!id) return null;
  const name = roll.ownerCustomer?.name?.trim();
  return `Müşteri malı (emanet${name ? ` · ${name}` : ''}) — kendi üretime girmez`;
}

/**
 * Kayıt gövdesi: formun ek alanları (yalnız dolu olanlar) + rota + okutulan toplar. `notes` gitmez — iş emrinde not
 * kolonu yok (quick-start şeması siler). Rotasız seçimde `scanRouted`, şablonda `routeTemplateId` (düzenlenmiş adımlar
 * `steps` olarak ek alanlardan gelir).
 */
export function buildOwnGoodsBody(extra: ExtraBody, route: ProductionRoute | null, barcodes: readonly string[], clientToken: string): QuickStartRequest {
  const { notes: _notes, ...rest } = extra;
  const routePart: Pick<QuickStartRequest, 'routeTemplateId' | 'scanRouted'> = !route ? {} : isScanRoute(route) ? { scanRouted: true } : { routeTemplateId: route.id };
  return { ...rest, ...routePart, clientToken, ownGoods: true, rollBarcodes: [...barcodes] };
}

/** İstek anahtarının kimliği: aynı içerik = aynı mantıksal deneme (token yalnız belirsiz hatada yapışır). */
export function ownGoodsAttemptKey(body: QuickStartRequest): string {
  const { clientToken: _t, ...rest } = body;
  return JSON.stringify(rest);
}

/** Sonuç satırı: "IE… oluşturuldu · 3 top ilk istasyona gönderildi" / topsuzda "Parti Ekle" yönlendirmesi. */
export function ownGoodsResultText(r: { workOrderNumber: string; attached: number; batchNumber?: string | null }): string {
  if (r.attached === 0) return `${r.workOrderNumber} oluşturuldu · top okutulmadı — topları İE detayında "Parti Ekle" ile okutun.`;
  return `${r.workOrderNumber} oluşturuldu · ${r.attached} top ilk istasyona gönderildi${r.batchNumber ? ` (Parti ${r.batchNumber})` : ''}.`;
}
