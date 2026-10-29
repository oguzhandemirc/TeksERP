// =============================================================================
// RAPORLAR v2 GEÇİŞ YÜZEYİ (R0-GECIS) — "yeni hâli" bandı, "Eski raporlar", taşınan araçlar, palet
// =============================================================================
// §1 band modeli: birlesti / tasindi / uzman / bayrak kapalı / hedef çizilmiyor · §2 band YALNIZ
// `ReportPageLayout`ta (36/36: 35 yaprak + diyalog), yönlendirme yok · §3 bayrak kapalıyken DOM
// bayt-eşit · §4 "Eski raporlar" bölümü + arama · §5 taşınan yedi araç katalogla eşit, karo/şerit ·
// §6 palet: kapalıyken ikiz/taşınan giriş görünmez, açıkken "Eski:" ikizi özgünün yerini alır.
//
// Negatif sondalar (2026-10-24, md5 ile geri alındı, 17/0): `legacyBannerModel`den bayrak denetimi
// kaldırıldı → ❌ 2 (§1 bayrak kapalı · §3 DOM eşitliği); hedef için `isCenterEntryVisible`
// (`isReportSurfaced` dahil) kaldırıldı → ❌ 1 (§1 "hedef çizilmiyorsa band yok").
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { REPORT_BY_KEY, REPORT_CATALOG, type ReportCatalogEntryV1, type ReportCatalogEntryV2 } from "@/lib/report-catalog";
import { isReportOpenWith } from "@/lib/report-gate";

let v2: boolean | undefined = true;
let perms: string[] | "all" = "all";
let closed: string[] | null = [];
const ctx = (): OperationsVisibilityContext => ({
  shipmentConfirmationEnabled: false,
  depoMultiEnabled: false,
  devereEnabled: true,
  dokumaEnabled: true,
  tezgahEnabled: true,
  financeEnabled: true,
  productionEnabled: true,
  ticaretEnabled: true,
  iplikEnabled: true,
  kaliteGuvenceEnabled: false, maliyetEnabled: false, gelenBelgeEnabled: false, emanetEnabled: false,
  reportsClosedKeys: closed,
  isReportOpen: (key: string) => isReportOpenWith(closed, key),
  ...(v2 === undefined ? {} : { reportsV2Enabled: v2 }),
  flagsReady: true,
  flagsFailed: false,
});
const hasPermission = (p: string) => perms === "all" || perms.includes(p);
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({ useOperationsVisibilityContext: () => ctx() }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: false, hasPermission, hasAnyPermission: (ps: string[]) => ps.some(hasPermission) }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));

import { ReportPageLayout } from "./ReportPageLayout";
import { LegacyReportBanner } from "./LegacyReportBanner";
import { RELOCATED_TOOLS, legacyBannerModel, legacyGroups, relocatedHostOf } from "../_v2/legacy-model";
import { RelocatedToolStrip, RelocatedToolsSection } from "../_v2/RelocatedTools";
import { reportTiles } from "../tile-config";
import { allCommandEntries } from "@/components/layout/command-entries";
import { foldedIncludes } from "@/lib/search-fold";

const access = () => ({ isAdmin: false, hasPermission, ctx: ctx() });
const v1Entries = REPORT_CATALOG.filter((e): e is ReportCatalogEntryV1 => e.nesil === "v1");
const MERGE_TARGET = "production/uretim-akisi";

// v2 satırlarının hepsi bugün `hazir:false` — "hedef çizilir" durumu için birini geçici açarız.
function setReady(key: string, value: boolean) {
  (REPORT_BY_KEY.get(key) as ReportCatalogEntryV2).hazir = value;
}

beforeEach(() => {
  v2 = true;
  perms = "all";
  closed = [];
});
afterEach(() => setReady(MERGE_TARGET, false));

describe("§1 band modeli", () => {
  it("birlesti → hedefin başlığı ve adresi (hedef çizilirken)", () => {
    setReady(MERGE_TARGET, true);
    expect(legacyBannerModel("production/wip", access())).toEqual({ kind: "merged", targetTitle: "Üretim nerede takıldı?", to: "/reports/production/uretim-akisi" });
  });
  it("⭐ hedef çizilmiyorsa (hazir:false · kapalı · izinsiz) band yok — ölü bağlantı verilmez", () => {
    expect(legacyBannerModel("production/wip", access())).toBeNull();
    setReady(MERGE_TARGET, true);
    closed = [MERGE_TARGET];
    expect(legacyBannerModel("production/wip", access())).toBeNull();
    closed = [];
    perms = ["report:sales"];
    expect(legacyBannerModel("production/wip", access())).toBeNull();
  });
  it("⭐ bayrak kapalı (false ya da yok) → band yok", () => {
    setReady(MERGE_TARGET, true);
    v2 = false;
    expect(legacyBannerModel("production/wip", access())).toBeNull();
    v2 = undefined;
    expect(legacyBannerModel("production/wip", access())).toBeNull();
  });
  it("uzman → band yok (muhasebe aracı olarak kalır)", () => {
    for (const k of ["finance/cash-book", "finance/vat-summary", "finance/fx-diff"]) expect(legacyBannerModel(k, access())).toBeNull();
  });
  it("tasindi → yeni yerin adı ve adresi; yer bu kişiye açılmıyorsa band yok", () => {
    expect(legacyBannerModel("audit/user-activity", access())).toEqual({
      kind: "moved", place: "Kullanıcı aktivitesi ekranı", hostLabel: "Etkinlik", to: "/system/activity",
    });
    perms = ["report:audit"];
    expect(legacyBannerModel("audit/user-activity", access())).toBeNull();
  });
  it("bileşen: metin + bağlantı, yönlendirme yok", () => {
    setReady(MERGE_TARGET, true);
    renderWithProviders(<LegacyReportBanner reportKey="production/wip" />);
    expect(screen.getByRole("note").textContent).toContain("Bu raporun yeni hâli:");
    expect(screen.getByRole("link", { name: /Üretim nerede takıldı\?/ }).getAttribute("href")).toBe("/reports/production/uretim-akisi");
  });
});

const REPORTS_DIR = resolve(__dirname, "..");
function sources(dir: string): Array<{ path: string; text: string }> {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx$/.test(n) && !/\.test\./.test(n) ? [{ path: p, text: readFileSync(p, "utf8") }] : [];
  });
}

describe("§2 band yalnız ReportPageLayout'ta — 36/36", () => {
  const files = sources(REPORTS_DIR);
  it("⭐ her v1 yaprak `ReportPageLayout`u kendi anahtarıyla çizer; adressiz diyalog bandı kendisi bağlar", () => {
    const missing = v1Entries.filter((e) => {
      if (e.yuzey === "diyalog") return !files.some((f) => f.text.includes(`<LegacyReportBanner reportKey="${e.key}"`));
      return !files.some((f) => f.text.includes("<ReportPageLayout") && f.text.includes(`reportKey="${e.key}"`));
    });
    expect(v1Entries).toHaveLength(36);
    expect(missing.map((e) => e.key)).toEqual([]);
  });
  it("band sayfa sayfa elle eklenmez; bileşen yönlendirme yapmaz", () => {
    const users = files.filter((f) => f.text.includes("<LegacyReportBanner")).map((f) => f.path.slice(REPORTS_DIR.length + 1)).sort();
    expect(users).toEqual(["Finance/CariStatementDialog.tsx", "_components/ReportPageLayout.tsx"]);
    const src = readFileSync(resolve(__dirname, "LegacyReportBanner.tsx"), "utf8");
    expect(src).not.toMatch(/useNavigate|<Navigate|location\.(assign|replace|href)/);
  });
});

describe("§3 bayrak kapalıyken DOM bayt-eşit", () => {
  const page = () => (
    <ReportPageLayout title="Duruş Pareto" reportKey="dokuma/durus-pareto" filters={<div />}>
      <p>içerik</p>
    </ReportPageLayout>
  );
  it("⭐ undefined ve false aynı DOM; band yok", () => {
    setReady("dokuma/duruslar", true);
    try {
      v2 = undefined;
      const a = renderWithProviders(page()).container.innerHTML;
      v2 = false;
      const b = renderWithProviders(page()).container.innerHTML;
      expect(b).toBe(a);
      expect(a).not.toContain("yeni hâli");
      v2 = true;
      expect(renderWithProviders(page()).container.innerHTML).toContain("Bu raporun yeni hâli:");
    } finally {
      setReady("dokuma/duruslar", false);
    }
  });
  it("taşınan araç karosu/şeridi bayrak kapalıyken çizilmez", () => {
    v2 = false;
    const { container } = renderWithProviders(<><RelocatedToolsSection host="/operations" title="İz sürme" /><RelocatedToolStrip host="/system/logs" /></>);
    expect(container.innerHTML).toBe("");
  });
});

describe("§4 Eski raporlar bölümü", () => {
  it("⭐ açıkken 36 v1 rapor eski kategorilerinde; kapalıyken boş", () => {
    const groups = legacyGroups(reportTiles, access());
    expect(groups.reduce((n, g) => n + g.cards.length, 0)).toBe(36);
    v2 = false;
    expect(legacyGroups(reportTiles, access())).toEqual([]);
  });
  it("izinsiz / kapalı rapor çizilmez; arama başlık + soruyu kapsar; uzman işaretli", () => {
    perms = ["report:finance", "finance:read"];
    closed = ["finance/fx-diff"];
    const cards = legacyGroups(reportTiles, access()).flatMap((g) => g.cards);
    expect(cards.map((c) => c.entry.key).sort()).toEqual(["finance/aging", "finance/cash-book", "finance/cheque-due", "finance/statement", "finance/vat-summary"]);
    expect(cards.find((c) => c.entry.key === "finance/statement")?.to).toBe("/finance/cari");
    expect(cards.find((c) => c.entry.key === "finance/cash-book")?.expert).toBe(true);
    const hit = legacyGroups(reportTiles, access(), { term: "kdv", includes: foldedIncludes }).flatMap((g) => g.cards);
    expect(hit.map((c) => c.entry.key)).toEqual(["finance/vat-summary"]);
  });
});

describe("§5 taşınan yedi araç", () => {
  it("⭐ liste katalogdaki `tasindi` satırlarıyla bire bir; yer katalogdan, adres/izin değişmez", () => {
    const moved = v1Entries.filter((e) => e.yeniHali.tur === "tasindi").map((e) => e.key).sort();
    expect(RELOCATED_TOOLS.map((t) => t.reportKey).sort()).toEqual(moved);
    expect(moved).toHaveLength(7);
    for (const t of RELOCATED_TOOLS) {
      const e = REPORT_BY_KEY.get(t.reportKey)!;
      expect(relocatedHostOf(t.reportKey)).not.toBeNull();
      if (e.panelYolu) {
        expect(t.to).toBe(`/${e.panelYolu}`);
        expect(t.permission).toBe(e.izin);
      }
    }
  });
  it("Operasyon hub'ında iz sürme karoları; Sistem Kayıtları'nda şerit", () => {
    renderWithProviders(<RelocatedToolsSection host="/operations" title="İz sürme" />);
    expect(screen.getByRole("region", { name: "İz sürme" }).textContent).toMatch(/İz Sürme · Parti.*İz Sürme · Top/);
    renderWithProviders(<RelocatedToolStrip host="/system/logs" />);
    expect(screen.getByRole("link", { name: /Denetim Kaydı Özeti/ }).getAttribute("href")).toBe("/reports/audit/system-log-summary");
  });
  it("rapor izni yoksa yeni yerde de çizilmez (yeni izin açılmaz)", () => {
    perms = ["admin:settings"];
    const { container } = renderWithProviders(<RelocatedToolStrip host="/system/logs" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("§6 palet", () => {
  const visible = () => allCommandEntries.filter((e) => !e.visibleWhen || e.visibleWhen(ctx()));
  it("⭐ kapalıyken ikiz ve taşınan girişlerin hiçbiri görünmez; undefined = false", () => {
    v2 = undefined;
    const a = visible().map((e) => `${e.key}|${e.label}|${e.to}`);
    v2 = false;
    expect(visible().map((e) => `${e.key}|${e.label}|${e.to}`)).toEqual(a);
    expect(a.some((s) => s.includes(":legacy|") || s.startsWith("relocated:") || s.includes("|Eski: "))).toBe(false);
  });
  it("açıkken eski yaprak 'Eski:' ikiziyle görünür, özgünü gizlenir; taşınan araç yeni yerinin adıyla", () => {
    const keys = new Set(visible().map((e) => e.key));
    expect(keys.has("report:production:wip")).toBe(false);
    expect(keys.has("report:production:wip:legacy")).toBe(true);
    expect(allCommandEntries.find((e) => e.key === "report:production:wip:legacy")?.label).toBe("Eski: Nerede Takıldı (WIP)");
    const moved = visible().filter((e) => e.key.startsWith("relocated:"));
    expect(moved).toHaveLength(7);
    expect(moved.find((e) => e.key === "relocated:dokuma/karne")?.label).toBe("Tezgah Salonu · Karne Listesi ve Mühür");
  });
});
