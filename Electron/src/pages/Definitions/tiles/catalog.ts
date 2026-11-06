// Tanımlar › Ürün Kataloğu karoları (sıra = hub sırası).
import { Package, Award, Palette, Sparkles, Tag, Table2 } from "lucide-react";
import { itemPricesTileVisible } from "../ItemPrices/regime";
import { servicePricesTileVisible } from "../ServicePrices/regime";
import { flagOffHint } from "@/lib/flag-setting-path";
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
    offHint: flagOffHint("ticaretEnabled"),
  },
  // Hizmet fiyat tablosu (2026-11-06, K6): aynı ekran Ön Muhasebe hub'ında da karodur.
  {
    key: "service-prices",
    title: "Hizmet Fiyat Tablosu",
    description: "Hizmetin kademe fiyatları: genel, müşteriye özel ve ileri tarihli",
    icon: Table2,
    to: "/definitions/service-prices",
    group: "catalog",
    permission: "item:read",
    visibleWhen: servicePricesTileVisible,
    offHint: flagOffHint("financeEnabled"),
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
