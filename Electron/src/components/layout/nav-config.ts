import {
  LayoutDashboard,
  Library,
  ShieldCheck,
  BadgeCheck,
  ScrollText,
  ServerCog,
  ClipboardList,
  Calculator,
  FileText,
  Coins,
  type LucideIcon,
} from "lucide-react";
import { TERIM_AD } from "@/lib/terim";
import { DOCUMENTS_HUB_ACCESS, QUALITY_HUB_ACCESS, SYSTEM_HUB_ACCESS } from "@/lib/permissions";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
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
   * ⚠️ MENÜDE BUGÜN ÜRETİM SATIRI YOK: üretim ekranlarına "Operasyon" ve
   * "Tanımlar" hub'larından giriliyor ve o iki satır ÇEKİRDEKTİR (bayrağa
   * bağlanamaz — bağlansaydı üretim kapalı bir kurulumda depo/sipariş/sevkiyat
   * karoları da menüden kaybolurdu). Üretim kapısı bu yüzden HUB KAROLARINDA
   * uygulanır (`Operations/production-regime.ts` · `Definitions/production-regime.ts`),
   * menü satırında değil.
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
}

export const navGroups: NavGroup[] = [
  {
    label: "Genel",
    items: [
      { label: "Anasayfa", to: "/", icon: LayoutDashboard },
      { label: "Operasyon", to: "/operations", icon: ClipboardList },
      {
        // UX-2: kalite karoları Operasyon'dan ayrı kök; bayrak kapalıyken satır soluk + ayar yolu (K3).
        label: TERIM_AD.kaliteGuvence,
        to: "/quality",
        icon: BadgeCheck,
        permissionAny: QUALITY_HUB_ACCESS,
        featureFlag: "kaliteGuvenceEnabled",
        keywords: "kalite muayene laboratuvar test sertifika 4 puan kusur",
      },
      {
        // MAL-3: hub + alt ekranlar `cost/*` bu satırın bayrağını miras alır (test_screen_catalog §9 nav-miras).
        label: "Maliyet & Teklif",
        to: "/cost",
        icon: Coins,
        // MAL-5: teklif/fiyat listesi okuyan da girer (satış rolü maliyet görmez); karolar kendi izniyle süzülür.
        permissionAny: ["cost:read", "quote:read", "price-list:read", "report:yarn-need"],
        featureFlag: "maliyetEnabled",
        keywords: "maliyet teklif fiyat teklifi revizyon siparişe dönüştür fiyat listesi standart maliyet iplik fiyatı fason tarife terbiye parametre hesaplayıcı kâr iplik ihtiyacı eksik iplik",
      },
      {
        label: TERIM_AD.onMuhasebe,
        to: "/finance",
        icon: Calculator,
        permission: "finance:read",
        featureFlag: "financeEnabled",
        keywords: "muhasebe",
      },
      { label: "Raporlar", to: "/reports", icon: ScrollText },
      { label: "Tanımlar", to: "/definitions", icon: Library },
      {
        // UX-2: belge/etiket/refakat çıktıları Tanımlar'dan ayrı kök.
        label: TERIM_AD.belgeler,
        to: "/documents",
        icon: FileText,
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
        permissionAny: SYSTEM_HUB_ACCESS,
      },
      {
        label: "Yetkilendirme",
        to: "/access",
        icon: ShieldCheck,
        adminOnly: true,
      },
    ],
  },
];
