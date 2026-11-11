import {
  LayoutDashboard,
  Library,
  ShieldCheck,
  BadgeCheck,
  ScrollText,
  ServerCog,
  ShoppingCart,
  Factory,
  Warehouse,
  Truck,
  Calculator,
  FileText,
  Coins,
  type LucideIcon,
} from "lucide-react";
import { TERIM_AD } from "@/lib/terim";
import { DOCUMENTS_HUB_ACCESS, QUALITY_HUB_ACCESS, SYSTEM_HUB_ACCESS } from "@/lib/permissions";
import type { IconTileTone } from "@/components/ui/icon-tile";
import type { OperationGroupKey } from "@/pages/Operations/groups-config";

/** Bölüm kökünün alt öğesi — Sidebar çalışma anında bölüm karolarından üretir. */
export interface NavChild {
  label: string;
  to: string;
  icon: LucideIcon;
  offHint?: string;
}

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Menü simge karesinin tonu (verilmezse yoldan belirlenimli ton). */
  tone?: IconTileTone;
  /** Üst çubukta bölüm başlığının altındaki tek satır açıklama. */
  description?: string;
  /**
   * T5 menü bölümü: kökün alt listesi bu bölümün karolarıdır (`pages/Operations/sections.ts`; bölüm
   * sayfasıyla AYNI liste ve süzgeç). Görünür alt öğesi olmayan bölüm kökü çizilmez.
   */
  section?: OperationGroupKey;
  /** Bölümün GÖRÜNÜR karoları (Sidebar doldurur; statik katalogda boş). */
  children?: NavChild[];
  permission?: string;
  /** İzinlerden BİRİ yeter — route'un `requireAnyPermission`ıyla AYNI küme. */
  permissionAny?: string[];
  adminOnly?: boolean;
  /** Komut paletinde aranacak ek sözcükler. */
  keywords?: string;
  /** UX-2 K3: satır KAPALI (modül bayrağı kapalı) — soluk çizilir, gezinmez, tıkta bu ipucunu verir. Sidebar hesaplar. */
  offHint?: string;
  /** Opsiyonel sayısal rozet (bekleyen iş / uyarı). Veri bağlandığında dolar. */
  badge?: number;
  /**
   * Bu satırın bağlı olduğu MODÜL anahtarı. Bayrak KAPALIYSA satır soluk
   * çizilir ve gezinmez (UX-2 K3); bayrak yüklenene kadar gizli kalır.
   *
   * ⚠️ Bayrak bir GÖRÜNÜRLÜK süsü değil REJİM kapısıdır: backend de aynı
   * bayrağa bakıp 403 döner (`requireFinanceEnabled` · `requireTicaretEnabled` …).
   * İki taraf ayrışırsa kullanıcı menüde göremediği ama adresle açabildiği bir
   * modül bulur.
   *
   * ⚠️ DEĞER `OperationsVisibilityContext` ALAN ADIDIR ve karar O BAĞLAMDAN
   * okunur (`Sidebar.visible` · komut paleti). Union 2026-09-03'te beş modüle
   * genişledi; genişletmenin ÖN KOŞULU Sidebar'daki jenerik `?? false`
   * varsayılanının kaldırılmasıydı: `productionEnabled`ın backend varsayılanı
   * AÇIK, yani `?? false` ile okunsaydı fabrikada üretim menüsü bayrak
   * yüklenene kadar KAYBOLUR ve gözle görülür bir titreme doğardı ("sıfır
   * görünür fark" kuralının doğrudan ihlali).
   *
   * ⚠️ BÖLÜM KÖKLERİ (Satış · Üretim · Depo · Sevkiyat) BAYRAĞA BAĞLANMAZ: kapı
   * karolardadır (`Operations/production-regime.ts` …) ve kök, görünür alt öğesi
   * kalmayınca kendiliğinden çizilmez. Bayrak satıra konsaydı ekran kataloğunda
   * `/sales` gibi yolların ön ek mirası doğardı.
   */
  featureFlag?:
    | "financeEnabled"
    | "productionEnabled"
    | "ticaretEnabled"
    | "iplikEnabled"
    | "depoMultiEnabled"
    | "maliyetEnabled"
    | "kaliteGuvenceEnabled";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  /** K19 "Gelişmiş" grubu: başlığa tıklayınca açılır, varsayılan KAPALI. */
  collapsible?: boolean;
}

/** K19 menü düzeni — teknik ekranların toplandığı kenar menü grubu (ayar açıkken çizilir). */
export const ADVANCED_GROUP_LABEL = "Gelişmiş";

export const navGroups: NavGroup[] = [
  {
    label: "Genel",
    items: [
      { label: "Anasayfa", to: "/", icon: LayoutDashboard, tone: "violet", description: "Fabrikanın bugünkü durumu" },
      // T5: eski "Operasyon" kökü dört bölüme ayrıldı; ekran adresleri `/operations/...` kalır.
      { label: "Satış", to: "/sales", icon: ShoppingCart, tone: "blue", section: "planning", description: "Siparişler, teklifler ve talep–üretim dengesi", keywords: "sipariş teklif kumaş dengesi" },
      { label: "Üretim", to: "/production", icon: Factory, tone: "orange", section: "production", description: "İş emirleri, dokuma, kurşun, kartela ve fason", keywords: "iş emri dokuma kurşun fason kartela tezgah" },
      { label: "Depo", to: "/warehouse", icon: Warehouse, tone: "teal", section: "warehouse", description: "Stok, paketleme, mal kabul ve gelen belgeler", keywords: "stok top iplik sarf çuval mal kabul sayım" },
      { label: "Sevkiyat", to: "/shipping", icon: Truck, tone: "green", section: "shipping", description: "Sevk çıkışı, sevk edilenler ve iadeler", keywords: "sevk irsaliye iade" },
      {
        // UX-2: kalite karoları Operasyon'dan ayrı kök; bayrak kapalıyken satır yalnız modülü açabilene soluk (`off-module-visibility`).
        label: TERIM_AD.kaliteGuvence,
        to: "/quality",
        icon: BadgeCheck,
        tone: "sky",
        description: "Muayene, laboratuvar ve sertifikalar",
        permissionAny: QUALITY_HUB_ACCESS,
        featureFlag: "kaliteGuvenceEnabled",
        keywords: "kalite muayene laboratuvar test sertifika 4 puan kusur",
      },
      {
        // MAL-3: hub + alt ekranlar `cost/*` bu satırın bayrağını miras alır (test_screen_catalog §9 nav-miras).
        // T5: Teklifler menüde Satış'ta (adres `/cost/quotes` kalır, miras buradan sürer).
        label: "Maliyet",
        to: "/cost",
        icon: Coins,
        tone: "rose",
        description: "Metre maliyeti, tarifeler ve fiyat listeleri",
        // MAL-5: teklif/fiyat listesi okuyan da girer (satış rolü maliyet görmez); karolar kendi izniyle süzülür.
        // Teklif okuyan (yalnız `quote:read`) Satış'tan girer; route kapısı eski listeyi korur.
        permissionAny: ["cost:read", "price-list:read", "report:yarn-need"],
        featureFlag: "maliyetEnabled",
        keywords: "maliyet teklif fiyat teklifi revizyon siparişe dönüştür fiyat listesi standart maliyet iplik fiyatı fason tarife terbiye parametre hesaplayıcı kâr iplik ihtiyacı eksik iplik",
      },
      {
        label: TERIM_AD.onMuhasebe,
        to: "/finance",
        icon: Calculator,
        tone: "teal",
        description: "Cari, fatura, kasa ve banka",
        permission: "finance:read",
        featureFlag: "financeEnabled",
        keywords: "muhasebe",
      },
      { label: "Raporlar", to: "/reports", icon: ScrollText, tone: "violet", description: "Üretim, satış ve stok raporları" },
      { label: "Tanımlar", to: "/definitions", icon: Library, tone: "amber", description: "Ürünler, iş ortakları ve üretim tanımları" },
      {
        // UX-2: belge/etiket/refakat çıktıları Tanımlar'dan ayrı kök.
        label: TERIM_AD.belgeler,
        to: "/documents",
        icon: FileText,
        tone: "blue",
        description: "Belge, etiket ve refakat kartı şablonları",
        permissionAny: DOCUMENTS_HUB_ACCESS,
        keywords: "belge şablon etiket refakat kartı yazdır çıktı",
      },
    ],
  },
  {
    label: "Yönetim",
    items: [
      {
        // Karolarından birini açabilen herkes (ekran başına ayar izni taşıyan
        // personel dahil) — route kapısıyla aynı küme.
        label: "Sistem",
        to: "/system",
        icon: ServerCog,
        tone: "blue",
        description: "Sunucu, cihazlar, ayarlar ve bakım",
        permissionAny: SYSTEM_HUB_ACCESS,
      },
      {
        label: "Yetkilendirme",
        to: "/access",
        icon: ShieldCheck,
        tone: "rose",
        description: "Kullanıcılar, roller ve izinler",
        adminOnly: true,
      },
    ],
  },
];
