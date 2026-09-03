import {
  Package,
  Users2,
  Factory,
  Cog,
  Route as RouteIcon,
  FlaskConical,
  AlertTriangle,
  Award,
  Palette,
  Sparkles,
  Tag,
  Building2,
  Settings2,
  Tags,
  Undo2,
  Warehouse,
  FileText,
  Printer,
  Ruler,
  LayoutTemplate,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react";
import type { DefinitionGroupKey } from "./groups-config";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { DOCUMENT_DESIGN_READ } from "@/lib/permissions";
// Paket D — görünürlük SAF katmanda (bkz. ItemPrices/regime.ts gerekçesi).
import { itemPricesTileVisible } from "./ItemPrices/regime";
// P5 (2026-09-03) — Tanımlar'ın ÜÇ üretim karosu `production.enabled`e bağlandı
// (çekirdek ana veri karoları bilerek dışarıda; gerekçe dosya başlığında).
import {
  isProductRecipesVisible,
  isRoutesVisible,
  isTravelerCardVisible,
} from "./production-regime";

export interface DefinitionTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  group: DefinitionGroupKey;
  /**
   * DURUMA bağlı görünürlük — Operasyon karolarıyla AYNI bağlam (komut paleti
   * de aynı yüklemi uygular; ayrı bir tip, paletle ayrışırdı).
   * ⚠️ İZİN kontrolünden BAĞIMSIZ uygulanır ve admin kısa devresi bunu
   * ATLAMAZ: rejim bir yetki değil kurulum türü sorusudur — admin de fabrika
   * kurulumunda Cariler karosunu görmemeli.
   */
  visibleWhen?: (ctx: OperationsVisibilityContext) => boolean;
  permission?: string;
  /**
   * Bunlardan HERHANGİ biri yeterli. `permission` ile birlikte verilmez —
   * route guard'ıyla (`ProtectedRoute requireAnyPermission`) aynı listeyi
   * taşımalı, yoksa kart görünür ama tıklayınca /forbidden'a düşer.
   */
  permissionAny?: string[];
}

export const definitionTiles: DefinitionTile[] = [
  {
    key: "items",
    title: "Kumaşlar",
    description: "Stok kalemleri ve varyantlar",
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
  {
    key: "return-reasons",
    title: "İade Nedenleri",
    description: "Müşteri iadesi neden kataloğu",
    icon: Undo2,
    to: "/definitions/return-reasons",
    // Ürün niteliği değil, kalite/iade olay kodu — Hata Tipleri ile aynı grupta.
    group: "production",
    permission: "return:read",
  },
  {
    key: "warehouses",
    title: "Depolar",
    description: "Fiziksel depo tanımları + varsayılan depo",
    icon: Warehouse,
    to: "/definitions/warehouses",
    group: "production",
    // ⚠️ İzin route ile BİREBİR (`content-routes.tsx`): ayrışırsa kart görünür,
    // tıklayınca /forbidden'a düşer.
    permission: "warehouse:read",
  },
  {
    // Birleşik görünüm (2026-08-14): müşteri + tedarikçi + fason TEK listede,
    // rol rozetiyle. Kartlar kendi tablolarında/formlarında yaşamaya devam
    // eder — bu bir GÖRÜNÜM birleştirmesi, tablo birleştirmesi değil.
    // ⚠️ Karo ile route AYNI izin listesini taşır (content-routes aynası).
    key: "cariler",
    title: "Cariler",
    description: "Müşteri, tedarikçi ve fason kartları — tek liste, rol rozetiyle",
    icon: Users2,
    to: "/definitions/cariler",
    group: "partners",
    permissionAny: ["customer:read", "subcontractor:read"],
    // TİCARET REJİMİ (2026-08-14, kullanıcı kararı): bayrak açıkken TEK cari
    // listesi bu; Müşteriler + Fason karoları gizlenir (üç örtüşen liste
    // karışıklığı). Fabrikada (bayrak kapalı) bu karo HİÇ görünmez.
    visibleWhen: (ctx) => ctx.financeEnabled,
  },
  {
    key: "customers",
    title: "Müşteriler",
    description: "Müşteri ve tedarikçi firmalar",
    icon: Users2,
    to: "/definitions/customers",
    group: "partners",
    permission: "customer:read",
    // Ticaret rejiminde Cariler'in içinde — karo gizlenir, ROUTE DURUR
    // (derin bağlantı/favori kırılmaz).
    visibleWhen: (ctx) => !ctx.financeEnabled,
  },
  {
    key: "subcontractors",
    title: "Fason Firmalar",
    description: "Dış hizmet sağlayan firmalar ve verdikleri hizmetler",
    icon: Building2,
    to: "/definitions/subcontractors",
    group: "partners",
    permission: "subcontractor:read",
    // Ticaret rejiminde Cariler'in içinde (Müşteriler karosuyla aynı kural).
    visibleWhen: (ctx) => !ctx.financeEnabled,
  },
  {
    key: "subcontractor-categories",
    title: "Fason Kategorileri",
    description: "Boyahane, baskı, yıkama gibi hizmet türleri",
    icon: Tag,
    to: "/definitions/subcontractor-categories",
    group: "partners",
    permission: "subcontractor:read",
  },
  {
    key: "stations",
    title: "Üretim İstasyonları",
    description: "İstasyonlar + makineleri + (fason) renk/özellik yetenekleri — tek yerde, bilgi",
    icon: Factory,
    to: "/definitions/stations",
    group: "production",
    permission: "station:read",
  },
  {
    key: "peripherals",
    title: "Donanım",
    description: "Yazıcı + kantar/metraj cihazları (ağ/Bluetooth/USB/seri) — tür, dil/komut, adres",
    icon: Printer,
    to: "/definitions/peripherals",
    group: "production",
    permission: "station:read",
  },
  {
    key: "labels",
    title: "Etiketler",
    description: "Etiket boyutları (mm) + düzenleri (alan yerleşimi / uzman yazıcı kodu).",
    icon: Tags,
    to: "/definitions/labels",
    group: "cikti",
    // ⚠️ İZİN HİZASI (2026-08-14, persona denetimi bulgusu): kart yalnız
    // `station:read` isterken etiket şablonu tanımlamak isteyen ticaret
    // kullanıcısı (label:read/print + label-template:read taşır ama İSTASYON
    // kavramıyla hiç işi yok) kartı GÖREMİYORDU. Rol şablonu kataloğunda
    // "bilinen hizasızlık" diye yazılıydı. Route ile AYNI liste.
    permissionAny: ["station:read", "label-template:read"],
  },
  {
    key: "routes",
    title: "Üretim Rotaları",
    description: "Şablon iş akışları ve istasyon sıraları",
    icon: RouteIcon,
    to: "/definitions/routes",
    group: "production",
    permission: "station:read",
    // Backend ikizi `route.routes` → `requireProductionEnabled`.
    visibleWhen: isRoutesVisible,
  },
  {
    key: "product-recipes",
    title: "İş Emri Şablonları",
    description: "Kumaş + renk + özellik + en + rota — hazır iş emri şablonları",
    icon: FlaskConical,
    to: "/definitions/product-recipes",
    group: "production",
    permission: "station:read",
    visibleWhen: isProductRecipesVisible,
  },
  {
    // TEK KART, DÖRT SEKME — dört ayrı kart menüyü kalabalıklaştırırdı ve
    // dördü de aynı şeyin (operatöre gösterilen hazır mesaj) bağlamları.
    key: "reason-presets",
    title: "Hazır Sebepler",
    description: "Fire · kayıt düzeltmesi · elle top ekleme · iptal ekranlarındaki hazır mesajlar",
    icon: MessageSquareText,
    to: "/definitions/reason-presets",
    group: "production",
    // ⚠️ Kart ile route AYNI izni taşımalı — ayrışırsa kullanıcı kartı görür,
    // tıklar, /forbidden'a düşer. Düzenleme ayrıca `roll:manual-adjust` ister
    // ve o kontrol sayfanın İÇİNDE yapılır (tuşlar çizilmez).
    permission: "roll:read",
  },
  {
    key: "defect-types",
    title: "Hata Tipleri",
    description: "Kalite kontrol hata tanımları",
    icon: AlertTriangle,
    to: "/definitions/defect-types",
    group: "production",
    permission: "quality:read",
  },
  {
    key: "document-templates",
    title: "Belge Şablonları",
    description: "İrsaliye/çeki içeriği: bölüm aç-kapa, başlık, künye, imza, alt not (canlı önizleme)",
    icon: FileText,
    to: "/definitions/document-templates",
    group: "cikti",
    permissionAny: DOCUMENT_DESIGN_READ,
  },
  {
    key: "traveler-card",
    title: "Refakat Kartı",
    description: "Refakat kartında basılan firma adı/künyesi ve görünecek bölümler",
    icon: Printer,
    to: "/definitions/traveler-card",
    group: "cikti",
    permissionAny: DOCUMENT_DESIGN_READ,
    // ⚠️ KARTIN AYARI üretim nesnesidir (manifestoda `productionEnabled`);
    // hemen altındaki "Refakat Kartı Şablonları" ise BELGE nesnesidir ve
    // koşulsuz kalır. İkisini aynı kefeye koymak, üretim kapalı bir kurulumda
    // belge tasarımcısını da kilitlerdi.
    visibleWhen: isTravelerCardVisible,
  },
  {
    key: "traveler-card-studio",
    title: "Refakat Kartı Şablonları",
    description: "Bölümleri sırala/aç-kapa ya da uzman modunda kartın tüm HTML'ini kendin yaz",
    icon: LayoutTemplate,
    to: "/definitions/traveler-card-studio",
    group: "cikti",
    permissionAny: DOCUMENT_DESIGN_READ,
  },
  {
    key: "free-documents",
    title: "Serbest Belgeler",
    description: "Sisteme bağlı olmayan serbest belgeler — üst yazı, tutanak, dekont, duyuru",
    icon: FileText,
    to: "/definitions/free-documents",
    group: "cikti",
    permissionAny: DOCUMENT_DESIGN_READ,
  },
];
