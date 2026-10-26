// Tanımlar › Ürün Kataloğu karoları (sıra = hub sırası).
import { Package, Award, Palette, Sparkles, Tag } from "lucide-react";
import { itemPricesTileVisible } from "../ItemPrices/regime";
import type { DefinitionTile } from "../tile-config";

export const catalogTiles: DefinitionTile[] = [
  {
    key: "items",
    title: "Ürünler",
    description: "Kumaş, iplik ve sarf tanımları",
    icon: Package,
    to: "/definitions/items",
    group: "catalog",
    permission: "item:read",
  },
  // Paket D (2026-08-14) — ticaret paketi; fabrikada `finance.enabled` KAPALI
  // olduğu için bu karo orada HİÇ çizilmez. Görüntüleme kapısı `item:read`
  // (kalemi seçebilen fiyatını da görebilmeli); YAZMA ayrı bir yetkidir
  // (`price:write`) ve sayfanın İÇİNDE ayrılır — route'a yazma iznini koymak,
  // fiyatı görmesi gereken satışçıyı ekrandan tamamen dışarıda bırakırdı.
  {
    key: "item-prices",
    title: "Kalem Fiyatları",
    description: "Alış/satış fiyatı: kart varsayılanı + müşteriye özel istisnalar",
    icon: Tag,
    to: "/definitions/item-prices",
    group: "catalog",
    permission: "item:read",
    visibleWhen: itemPricesTileVisible,
  },
  {
    key: "fabric-properties",
    title: "Kumaş Özellikleri",
    description: "Yanmazlık, su geçirmezlik gibi kazanımlar",
    icon: Sparkles,
    to: "/definitions/fabric-properties",
    group: "catalog",
    permission: "property:read",
  },
  {
    key: "colors",
    title: "Renkler",
    description: "Boyahane renk kataloğu",
    icon: Palette,
    to: "/definitions/colors",
    group: "catalog",
    permission: "property:read", // Y7 fix: backend color.routes property:read ister
  },
  {
    key: "quality-grades",
    title: "Kalite Sınıfları",
    description: "Sistem sabit kalite kademeleri (salt okunur)",
    icon: Award,
    to: "/definitions/quality-grades",
    group: "catalog",
    permission: "quality:read",
  },
];
