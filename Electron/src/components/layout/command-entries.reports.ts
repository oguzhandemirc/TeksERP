import { BarChart3, Code2, FilePlus2, Filter, LayoutDashboard, Sigma, Sparkles } from "lucide-react";
import type { CommandEntry, CommandSection } from "./command-entries.types";
import { REPORT_CATALOG } from "@/lib/report-catalog";
import { isCenterEntryOpen } from "@/pages/Reports/_v2/center-model";
import { RELOCATED_TOOLS, relocatedHostOf } from "@/pages/Reports/_v2/legacy-model";
import { isRouteModuleOpen } from "@/lib/route-modules";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { reportTiles, reportCategoryTiles } from "@/pages/Reports/tile-config";
import { regimePredicate } from "@/lib/regime-predicate";
import { categoryHasOpenReport, reportKeyOfPath } from "@/lib/report-gate";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";

/**
 * Yaprak izni: v1 hub'ındaki v2 karosu yalnız kendi sayfalı v2 satırıdır (`test_rapor_katalogu §3`) ve route'u
 * katalog iznini ister (D4-G3 `maliyet/karlilik` → `cost:read`); diğer yapraklar kategori iznini taşır.
 */
export function leafPermission(to: string, categoryPermission: string | undefined): string | undefined {
  const key = reportKeyOfPath(to);
  const row = key ? REPORT_BY_KEY.get(key) : undefined;
  return row?.nesil === "v2" ? row.izin : categoryPermission;
}

/**
 * Raporlar bölümleri — kategori hub'ı + o kategorinin TÜM alt raporları.
 *
 * NEDEN AYRI DOSYA: `reportCategoryTiles` yedi alt-config'i toplar; palet
 * onları burada tek yerde açar. Elle liste tutulmaz — yeni bir rapor
 * `Reports/<Domain>/tile-config.ts`e eklendiği an palette de çıkar.
 *
 * ⚠️ MODÜL BAYRAĞI DA KATEGORİDEN TAŞINIR (2026-09-03). Eskiden taşınmıyordu ve
 * "Ön Muhasebe" rapor kategorisi hub'da gizliyken palette DURUYORDU; yalnız
 * izin süzgeci sayesinde görünmüyordu (bayrak kapalı bir kurulumda finans izni
 * de atanmamış olur). Üretim raporları bağlandığı an bu tesadüf biter: üretim
 * izni HER kurulumda atanmıştır, yani modül kapalıyken palet gizli kategoriye
 * derin bağlantı verirdi ("Kurşun Sırası" dersi). Kategori hub'ı ve ALT
 * raporları AYNI yüklemi taşır — alt rapor route'u da kategori kapısındadır.
 *
 * ⚠️ İZİN, KATEGORİNİN İZNİDİR. Alt rapor karoları (`HubTile`) izin alanı
 * taşımaz çünkü hub zaten kategori iznine göre süzülür; route ise her alt
 * sayfada `report:<domain>` ister. Palet girişine kategori iznini KOPYALAMAK
 * zorunlu: aksi halde giriş izinsiz kullanıcıya görünür, tıklayınca
 * `/forbidden`'a düşer ("kart/route hizası" kuralı).
 */
export const reportCommandSections: CommandSection[] = reportTiles.map((cat) => {
  const hub: CommandEntry = {
    key: `report:${cat.key}`,
    label: cat.title,
    description: cat.description,
    icon: cat.icon,
    to: cat.to,
    permission: cat.permission,
    // Modül VE en az bir açık rapor — karo ile aynı yüklem (K5; palet üçüncü yol).
    visibleWhen: (ctx: OperationsVisibilityContext) =>
      (cat.featureFlag ? regimePredicate(cat.featureFlag)(ctx) : true) && categoryHasOpenReport(ctx.reportsClosedKeys, cat.key),
    keywords: "rapor raporlar analiz",
  };

  const subs: CommandEntry[] = (reportCategoryTiles[cat.key] ?? []).map((tile) => ({
    key: `report:${cat.key}:${tile.key}`,
    label: tile.title,
    description: tile.description,
    icon: tile.icon,
    to: tile.to,
    permission: leafPermission(tile.to, cat.permission),
    visibleWhen: (ctx: OperationsVisibilityContext) => {
      const key = reportKeyOfPath(tile.to);
      // Yaprak rejimi (D4-A4 `ROUTE_REGIME`) karo ve route ile aynı yüklemden.
      return (cat.featureFlag ? regimePredicate(cat.featureFlag)(ctx) : true) && key !== null && ctx.isReportOpen(key) && isRouteModuleOpen(tile.to, ctx);
    },
    keywords: `rapor ${cat.title}`,
  }));

  // Raporlar v2 açıkken eski yapraklar "Eski:" önekli İKİZLE görünür, özgün giriş gizlenir. İkiz
  // SONDA durur: aynı hedefin ilk girişi (sekme başlığı) özgün ad kalır; bayrak kapalıyken
  // ikizlerin hiçbiri görünmez → palet çıktısı bayt-eşit.
  const legacyTwins: CommandEntry[] = subs.map((sub) => ({
    ...sub,
    key: `${sub.key}:legacy`,
    label: `Eski: ${sub.label}`,
    visibleWhen: (ctx: OperationsVisibilityContext) => ctx.reportsV2Enabled === true && sub.visibleWhen!(ctx),
    keywords: `${sub.keywords} eski geçiş`,
  }));
  const currentSubs = subs.map((sub) => ({
    ...sub,
    visibleWhen: (ctx: OperationsVisibilityContext) => ctx.reportsV2Enabled !== true && sub.visibleWhen!(ctx),
  }));

  return {
    heading: `Raporlar · ${cat.title}`,
    // Alt raporun breadcrumb'ı kategori hub'ına çıkar (eskiden hiç yoktu —
    // rapor sayfasından geri dönüş yalnız sekme/geçmiş ile mümkündü).
    parent: { label: cat.title, to: cat.to },
    entries: [hub, ...currentSubs, ...legacyTwins],
  };
});

/**
 * Raporlar v2 yaprakları — Rapor Merkezi ile AYNI yüklem (`isCenterEntryOpen`) + bayrak; izin
 * girişin `permission`ında (satırın `izin`i = kategori izni). Bayrak kapalıyken hiçbiri görünmez.
 */
const reportV2Entries: CommandEntry[] = REPORT_CATALOG.filter((e) => e.nesil === "v2").map((e) => ({
  key: `report-v2:${e.key}`,
  label: e.baslik,
  description: e.soru,
  icon: BarChart3,
  to: `/${e.panelYolu}`,
  permission: e.izin,
  visibleWhen: (ctx: OperationsVisibilityContext) => ctx.reportsV2Enabled === true && isCenterEntryOpen(e, ctx),
  keywords: "rapor raporlar rapor merkezi",
}));

reportCommandSections.push({
  heading: "Raporlar · Rapor Merkezi",
  parent: { label: "Raporlar", to: "/reports" },
  entries: reportV2Entries,
});

/** Özel raporlar (R1-KAYIT): oluşturucu `report:builder`; liste Rapor Merkezi'nin "Özel raporlarım" bölümü. */
reportCommandSections.push({
  heading: "Raporlar · Özel raporlar",
  parent: { label: "Raporlar", to: "/reports" },
  entries: [
    {
      key: "report-custom:new",
      label: "Yeni özel rapor",
      description: "Ölçü ve kırılım seçerek kendi raporunuzu kurun; kaydedin, paylaşın",
      icon: FilePlus2,
      to: "/reports/ozel/yeni",
      permission: "report:builder",
      visibleWhen: (ctx: OperationsVisibilityContext) => ctx.reportsV2Enabled === true,
      keywords: "özel rapor raporlarım kayıtlı rapor oluşturucu ölçü kırılım paylaş",
    },
    {
      key: "report-custom:layout",
      label: "Özel rapor düzeni ve PDF",
      description: "Özel raporlarım'dan bir rapor açın → 'Düzeni düzenle': bölümleri sürükleyin, PDF/Excel alın",
      icon: LayoutDashboard,
      to: "/reports",
      permission: "report:builder",
      visibleWhen: (ctx: OperationsVisibilityContext) => ctx.reportsV2Enabled === true,
      keywords: "düzen sürükle bırak blok bölüm sayfa kesmesi pdf excel grafik özel rapor tasarım",
    },
    {
      key: "report-custom:data",
      label: "Özel rapor veri alanları ve süzgeç",
      description: "Özel raporlarım'dan bir rapor açın → 'Düzeni düzenle' → bölüm seçin: soldaki ağaçtan ölçü/boyutu kuyulara sürükleyin, süzgeç kurun",
      icon: Filter,
      to: "/reports",
      permission: "report:builder",
      visibleWhen: (ctx: OperationsVisibilityContext) => ctx.reportsV2Enabled === true,
      keywords: "veri ağacı alan ölçü boyut kuyu satır sütun süzgeç filtre koşul varyant önerilen grafik özel rapor oluşturucu",
    },
    {
      key: "report-custom:code",
      label: "Özel rapor kod modu",
      description: "Özel raporlarım'dan bir rapor açın → 'Düzeni düzenle' → üstteki 'Kod' sekmesi: tanımı JSON olarak düzenleyin, hatalar altı çizili",
      icon: Code2,
      to: "/reports",
      permission: "report:builder",
      visibleWhen: (ctx: OperationsVisibilityContext) => ctx.reportsV2Enabled === true,
      keywords: "kod json tanım düzenleyici editör codemirror tamamlama doğrula hata özel rapor oluşturucu",
    },
    {
      key: "report-custom:analysis",
      label: "Özel raporda analiz bölümü",
      description: "Özel raporlarım'dan bir rapor açın → 'Düzeni düzenle' → Bölüm ekle → Analiz: gruplar arasında fark var mı, iki ölçü birlikte mi değişiyor",
      icon: Sigma,
      to: "/reports",
      permission: "report:builder",
      visibleWhen: (ctx: OperationsVisibilityContext) => ctx.reportsV2Enabled === true,
      keywords: "analiz ilişki fark kanıt vardiya karşılaştır örneklem neden birlikte değişiyor özel rapor",
    },
    {
      key: "report-template:shift-warp",
      label: "Vardiyaya göre çözgü hatası",
      description: "Hazır şablon — Rapor Merkezi → Özel raporlarım → Hazır şablonlar; çözgü hatası gece vardiyasında mı fazla?",
      icon: Sparkles,
      to: "/reports",
      permission: "report:quality",
      visibleWhen: (ctx: OperationsVisibilityContext) => ctx.reportsV2Enabled === true,
      keywords: "çözgü hata vardiya gece sabah akşam şablon kalite analiz tezgah",
    },
  ],
});

/**
 * Rapor menüsünden çıkan yedi araç — YENİ yerlerinin adıyla aranır ("Operasyon · İz Sürme · Parti").
 * Hedef aracın bugünkü adresi, izin o adresin route izni (yeni izin yok). Bayrak kapalıyken gizli.
 */
const relocatedEntries: CommandEntry[] = RELOCATED_TOOLS.map((t) => {
  const entry = REPORT_BY_KEY.get(t.reportKey);
  const host = relocatedHostOf(t.reportKey);
  return {
    key: `relocated:${t.reportKey}`,
    label: `${t.hostLabel} · ${t.title}`,
    description: t.description,
    icon: t.icon,
    to: t.to,
    permission: t.permission,
    visibleWhen: (ctx: OperationsVisibilityContext) =>
      ctx.reportsV2Enabled === true && entry !== undefined && host !== null && isCenterEntryOpen(entry, ctx) && isRouteModuleOpen(host, ctx),
    keywords: `rapor araç ${t.hostLabel} ${entry?.baslik ?? ""}`,
  };
});

reportCommandSections.push({
  heading: "Taşınan araçlar",
  entries: relocatedEntries,
});
