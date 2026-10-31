import { Cog, Copy, KeyRound, ServerCog, Settings2, Link2, FileText, CalendarRange, ListChecks } from "lucide-react";
import type { CommandEntry, CommandSection } from "./command-entries.types";
import { ROLL_TABS } from "@/pages/Operations/Rolls/tabs-config";
import { ETIKET_TABS } from "@/pages/Labels/tabs-config";
import {
  SETTINGS_ADMIN_PERMISSION,
  SETTINGS_CATEGORIES,
  categorySurface,
  settingsCategoryPath,
  SURFACE_LABEL,
} from "@/pages/GeneralSettings/settings-config";
import { settingsCategoryVisibleWhen } from "@/pages/GeneralSettings/settings-groups";
import { definitionGroups } from "@/pages/Definitions/groups-config";
import { isStationCapabilitiesVisible } from "@/pages/Definitions/production-regime";
import { operationGroups } from "@/pages/Operations/groups-config";
import { accessGroups } from "@/pages/Access/tile-config";
import { systemTileSections } from "@/pages/System/tile-config";

/**
 * "Alt başlıklar" — sayfa değil, sayfanın İÇİ: sekmeler, tek tek ayar satırları
 * ve hub bölüm başlıkları. Hepsi `deep: true` taşır → boş palette listelenmez,
 * arama yapıldığında çıkar (gerekçe: `CommandEntry.deep`).
 *
 * Hedefler DERİN BAĞLANTIDIR (`?tab=…`) — sayfa o parametreyi kendi tek-kaynak
 * config'inden okur (`tabs-config.ts`). Elle string yazılmaz; sekme silinirse
 * palet girişi de kendiliğinden kaybolur.
 */

/** Kumaş Stoğu sekmeleri — `/operations/rolls?tab=<key>`. */
const rollTabEntries: CommandEntry[] = ROLL_TABS.map((t) => ({
  key: `rolls-tab:${t.key}`,
  label: `Kumaş Stoğu · ${t.label}`,
  description: "Kumaş Stoğu sekmesi",
  icon: t.Icon,
  to: `/operations/rolls?tab=${t.key}`,
  permission: "roll:read",
  keywords: "envanter top rulo stok sekme",
  deep: true,
}));

/** Siparişler › Üretim planı sekmesi (SY-K2) — yeni menü yok, sekme derin bağlantıyla açılır. */
const orderTabEntries: CommandEntry[] = [
  {
    key: "orders-tab:plan",
    label: "Siparişler · Üretim planı",
    description: "Sipariş satırları renkli plan (iş açılmadı / üretimde / sevke hazır / termin geçti)",
    icon: ListChecks,
    to: "/operations/orders?view=plan",
    permission: "order:read",
    keywords: "sipariş plan üretim planı renk kuşak varyant termin satır",
    deep: true,
  },
];

/** Etiketler sekmeleri — `/definitions/labels?tab=<key>`. */
const labelTabEntries: CommandEntry[] = ETIKET_TABS.map((t) => ({
  key: `labels-tab:${t.key}`,
  label: `Etiketler · ${t.label}`,
  description: t.description,
  icon: t.icon,
  to: `/definitions/labels?tab=${t.key}`,
  permission: "station:read",
  keywords: "etiket barkod şablon stüdyo sekme",
  deep: true,
}));

/**
 * TEK TEK ayar satırları — hepsi kendi kategorisinin sekmesini açar. Kategori
 * girişinin `keywords`'ü zaten geniş ama ayarın KENDİ adıyla aranması
 * ("mükerrer", "parti no kısa", "sevk onayı") en doğal davranış.
 *
 * ⚠️ Adres `settingsCategoryPath`ten (2026-09-04 üç-ekran ayrımı); elle yazılan
 * `/system/settings?tab=` artık kategorilerin yarısı için YANLIŞ sayfadır.
 */
const settingsFlagEntries: CommandEntry[] = SETTINGS_CATEGORIES.flatMap((cat) =>
  (cat.flags ?? []).map((flag) => ({
    key: `setting-flag:${flag.key}`,
    label: flag.title,
    description: `${SURFACE_LABEL[categorySurface(cat)]} · ${cat.label}`,
    icon: cat.icon,
    to: settingsCategoryPath(cat),
    permissionAny: cat.permissionAny ?? [SETTINGS_ADMIN_PERMISSION],
    // Satıcı yüzeyinin satırları paletten de gizlenir (kategori girişiyle aynı).
    superadminOnly: categorySurface(cat) === "vendor",
    // Kategori girişiyle AYNI rejim yüklemi — fabrikada gizli olan bir bölümün
    // TEK TEK ayar satırları da paletten düşer (aksi halde palet, sayfada
    // olmayan bir sekmeye götürürdü).
    visibleWhen: settingsCategoryVisibleWhen(cat),
    keywords: `ayar ${cat.label} ${flag.group ?? ""} ${cat.keywords ?? ""}`,
    deep: true,
  })),
);

/**
 * Hub bölüm başlıkları — hub'ın kendisine götürür. "Ürün Kataloğu" ya da
 * "Depo & Paketleme" gibi bir başlığı hatırlayan kullanıcı, altındaki ekranın
 * adını hatırlamadan da doğru hub'a ulaşır.
 */
const hubGroupEntries: CommandEntry[] = [
  ...definitionGroups.map((g) => ({
    key: `def-group:${g.key}`,
    label: `Tanımlar · ${g.title}`,
    description: g.description,
    icon: g.icon,
    to: "/definitions",
    keywords: "tanım hub bölüm",
    deep: true,
  })),
  ...operationGroups.map((g) => ({
    key: `ops-group:${g.key}`,
    label: `Operasyon · ${g.title}`,
    description: g.description,
    icon: g.icon,
    to: "/operations",
    keywords: "operasyon hub bölüm",
    deep: true,
  })),
  ...accessGroups.map((g) => ({
    key: `access-group:${g.key}`,
    label: `Yetkilendirme · ${g.title}`,
    description: g.description,
    icon: g.icon,
    to: "/access",
    adminOnly: true,
    keywords: "yetki hub bölüm",
    deep: true,
  })),
  // Cihaz eşleme v2 (D3): Tabletler sayfasının üst bölümü — aynı donanımdan gelen yeni kurulumlar.
  {
    key: "access-devices:rebind-requests",
    label: "Tabletler · Yeniden bağlama talepleri",
    description: "Aynı donanımdan gelen yeni kurulumları eski kayda bağla",
    icon: Link2,
    to: "/access/devices",
    permission: "admin:settings",
    keywords: "cihaz eşleme yeniden bağlama talep onay donanım kurulum masaüstü tablet",
    deep: true,
  },
  // Kopya birleştirme (D4): aynı tabletin yeniden kurulumla doğmuş kayıtları — şerit açık gelir.
  {
    key: "access-devices:merge-duplicates",
    label: "Tabletler · Kopyaları birleştir",
    description: "Aynı cihazın tekrar kayıtlarını önizleyip ana kayda birleştir",
    icon: Copy,
    to: "/access/devices?kopya=1",
    permission: "admin:settings",
    keywords: "cihaz kopya tekrar kayıt birleştir birleştirme mükerrer çift tablet telefon kurulum",
    deep: true,
  },
  // Anahtar halkası kaybı (D5): kimliği doğrulanamayan cihazlar — süzgeç ve bant açık gelir.
  {
    key: "access-devices:proof-lost",
    label: "Tabletler · Anahtar kaybı / toplu yeniden bağla",
    description: "Kimlik anahtarı kaybolan cihazları gör, yedekten geri yükle ya da toplu yeniden bağla",
    icon: KeyRound,
    to: "/access/devices?kanit=1",
    permission: "admin:settings",
    keywords: "cihaz anahtar kaybı halka kanıt doğrulanamıyor yeniden bağla toplu tablet emanet yedek",
    deep: true,
  },
  ...systemTileSections.map((s) => ({
    key: `sys-group:${s.group}`,
    label: `Sistem · ${s.title}`,
    description: s.description,
    icon: ServerCog,
    to: "/system",
    permission: "admin:settings",
    keywords: "sistem hub bölüm",
    deep: true,
  })),
];

/**
 * Hub'da karosu OLMAYAN ama route'u yaşayan sayfalar. İkisi de "Üretim
 * İstasyonları" ekranına birleştirildi (makine kartları + yetenek sheet'i orada)
 * ama tekil listeleri duruyor. Karo AÇILMAZ — aynı veriyi iki kapıdan yönetmek
 * hub'ın anlamını bozar; yine de adresi/ekranı bilen kullanıcı aramayla ulaşsın.
 */
const orphanPageEntries: CommandEntry[] = [
  {
    key: "def:machines",
    label: "Makineler (ayrı liste)",
    description: "Makine tablosu — normalde Üretim İstasyonları ekranından yönetilir",
    icon: Cog,
    to: "/definitions/machines",
    permission: "station:read",
    keywords: "makine tezgah cihaz istasyon liste",
    deep: true,
  },
  {
    key: "def:station-capabilities",
    label: "İstasyon Yetenekleri (ayrı liste)",
    description: "Renk/özellik yetenekleri — normalde Üretim İstasyonları ekranından yönetilir",
    icon: Settings2,
    to: "/definitions/station-capabilities",
    permission: "station:read",
    keywords: "istasyon yetenek renk özellik kabiliyet",
    deep: true,
    // ⚠️ Karosu YOK → palet tek keşif yolu ve kapıyı ELLE taşımak zorunda
    // (gerekçe yüklemin kendi JSDoc'unda). P5 doğrulamasının bulgusu.
    visibleWhen: isStationCapabilitiesVisible,
  },
  {
    // K4P-RAPOR: sevkiyat seçici modal doğrudan açılır (`?report=1`); belge Sevkiyat detayında da var.
    key: "quality:inspection-report",
    label: "Muayene Raporu (Yazdır / PDF)",
    description: "Sevk toplarının 4 puan muayene raporu — sevkiyat seç, PDF veya Excel al",
    icon: FileText,
    to: "/quality/inspections?report=1",
    permission: "inspection:read",
    keywords: "muayene raporu 4 puan kalite sevk pdf excel yazdır müşteri",
    deep: true,
    visibleWhen: (ctx) => ctx.kaliteGuvenceEnabled,
  },
  {
    // H8: Faturalar ekranındaki dönem sonu hizmet faturası diyaloğu doğrudan açılır (`?donemSonu=1`).
    key: "finance:service-period-draft",
    label: "Faturalar · Dönem sonu hizmet faturası",
    description: "Ayın emanet işlerini (kurşun vb.) önizle, tek hizmet faturası taslağında topla",
    icon: CalendarRange,
    to: "/finance/invoices?donemSonu=1",
    permission: "finance:write",
    keywords: "dönem sonu ay sonu hizmet fatura taslak emanet kurşun işçilik toplu aylık",
    deep: true,
  },
];

export const deepCommandSections: CommandSection[] = [
  { heading: "Sayfa İçi · Kumaş Stoğu", entries: rollTabEntries },
  { heading: "Sayfa İçi · Etiketler", entries: labelTabEntries },
  { heading: "Sayfa İçi · Siparişler", entries: orderTabEntries },
  { heading: "Ayar Satırları", entries: settingsFlagEntries },
  { heading: "Hub Bölümleri", entries: hubGroupEntries },
  { heading: "Diğer Sayfalar", entries: orphanPageEntries },
];
