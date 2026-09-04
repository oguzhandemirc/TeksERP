import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";

/**
 * Sipariş filtreleri — TEK SATIR + yatay kaydırma (2026-09-04, kullanıcı kararı).
 *
 * Sipariş ekranında yedi filtre var (durum · iş emri · müşteri · şube · kumaş ·
 * renk · tarih). Ortak `FilterBar` satırı `flex-wrap` olduğu için dar pencerede
 * İKİ-ÜÇ satıra taşıyor ve listeye kalan dikey alanı yiyordu; özet şeridi de
 * üste alınınca bu kayıp iyice görünür oldu. Çözüm dikeyde büyümek yerine
 * yatayda kaydırmak: satır tek kalır, taşan filtreler sağa kayar.
 *
 * ⚠️ ORTAK BİLEŞENE DOKUNULMADI — kural `FilterBar`ın kendisine değil, YALNIZ
 * sipariş ekranındaki örneğine uygulanır. `[&>div]` seçicisi `FilterBar`ın kök
 * `div`'ini hedefler; arbitrary-variant'ın özgüllüğü (0,1,1) kökteki
 * `flex-wrap` sınıfını (0,1,0) yener. `[&>div>*]:shrink-0` ise filtre
 * kontrollerinin `min-w-[140px]` tabanının altına ezilmesini engeller.
 *
 * ⚠️ Radix popover/select içerikleri PORTAL'a (document.body) çizilir; bu
 * yüzden `overflow-x-auto` kabı açılır listeleri KIRPMAZ.
 *
 * ⚠️ Kapsayıcıdaki `shrink-0` LOAD-BEARING: `PageShell` bir dikey flex kabıdır
 * ve `overflow` görünür olmayan bir flex çocuğunda `min-height: auto` SIFIRA
 * düşer — yani dikey alan daralınca bu satır ezilip kaybolabilirdi (eski çıplak
 * `FilterBar` görünür overflow'lu olduğu için bu riski taşımıyordu).
 *
 * Bekçi: `orders-layout.guard.test.tsx`.
 */
export const ORDERS_FILTER_ROW_CLASS =
  "shrink-0 overflow-x-auto [&>div]:flex-nowrap [&>div>*]:shrink-0";

export function OrdersFilterRow({ filters }: { filters: FilterDef[] }) {
  return (
    <div data-testid="orders-filter-row" className={ORDERS_FILTER_ROW_CLASS}>
      <FilterBar filters={filters} />
    </div>
  );
}
