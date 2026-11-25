// Ürün kartı "Ticari" sekmesi (D4 aşama a) — SALT OKUNUR: satış/alış fiyat özeti, iplikte tedarikçi kalem kodları,
// kumaşta kalite bağlantıları. Hiçbir alan buradan yazılmaz; her bölüm kendi ekranına "… ekranında aç" ile gider.
import { useFeatureFlags, useKaliteGuvenceEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useItemPricesAccess } from "@/pages/Definitions/ItemPrices/useItemPricesAccess";
import { anyCommercialSection, commercialSections, type CommercialAccess } from "./itemCommercial";
import { ItemPriceSummary } from "./ItemPriceSummary";
import { ItemSupplierCodes } from "./ItemSupplierCodes";
import { ItemQualityLinks } from "./ItemQualityLinks";

/** Kartın tipine ve kullanıcının erişimine göre çizilecek bölümler; yeni (kaydedilmemiş) kartta sekme yok. */
export function useItemCommercialSections(item: { id: string; itemType: string } | null | undefined): CommercialAccess | null {
  const prices = useItemPricesAccess();
  const ticaret = useFeatureFlags().data?.data?.ticaretEnabled ?? false;
  const kalite = useKaliteGuvenceEnabled();
  const { hasPermission } = useRoleAccess();
  if (!item) return null;
  const s = commercialSections(item.itemType, {
    prices: prices.visible,
    supplierCodes: ticaret && (hasPermission("goods-receipt:read") || hasPermission("goods-receipt:write")),
    labSpecs: kalite && hasPermission("certificate:read") && hasPermission("labtest:read"),
    ruleSets: kalite && hasPermission("inspection:read"),
  });
  return anyCommercialSection(s) ? s : null;
}

export function ItemCommercialSection({ item, sections }: { item: { id: string; unit: string }; sections: CommercialAccess }) {
  return (
    <div className="space-y-4" data-testid="item-commercial">
      <p className="text-xs text-muted-foreground">Bu sekme yalnız gösterir; değişiklik ilgili ekranda yapılır.</p>
      {sections.prices && <ItemPriceSummary itemId={item.id} unit={item.unit} />}
      {sections.supplierCodes && <ItemSupplierCodes itemId={item.id} />}
      {(sections.labSpecs || sections.ruleSets) && <ItemQualityLinks itemId={item.id} labSpecs={sections.labSpecs} ruleSets={sections.ruleSets} />}
    </div>
  );
}
