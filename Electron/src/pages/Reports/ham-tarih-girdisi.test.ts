// =============================================================================
// "HİÇBİR YAPRAK KENDİ TARİH GİRDİSİNİ ÇİZMEZ" — `pages/Reports/**` tarayıcısı (R4 / K7)
// =============================================================================
// Kapsam `pages/Reports/**` BÜTÜNÜ, diyaloglar dahil (1e hükmü ③). Dört kol:
//   §1 ham `type="date"` yalnız `_components/ReportDateFilter.tsx`te (yorumlar ayıklanır)
//   §2 tarih hook'ları SAYI/sabit değil KATALOG ANAHTARI alır (çift yazım imkânsız);
//      yaprak `defaultDays=` / `showDateRange=` yazmaz — kaldırılan prop geri gelmez
//   §3 yaprak ↔ anahtar: route'taki her yaprak `reportKey="<kendi anahtarı>"` taşır ve
//      dosyada BAŞKA bir katalog anahtarı geçmez; tarihli sözleşmede `filters=` veren
//      yaprak bileşeni kendisi gömer (yoksa tarih girdisi sessizce kaybolur — 5e'nin
//      Randıman/Pareto süzgeç şeridinde tam bu oldu)
//   §4 düzen `defaultDays` fallback'i taşımaz (katalog dışı bir "30" yaşamasın)
//
// Negatif sondalar (bir kezlik, geri alındı — sha commit mesajında): OrderIntakePage'e ham
// `<input type="date" />` + `useReportDateRange(30)` → §1 ❌ ve §2 ❌ · anahtarı başka rapora çevrildi
// → §3 "başka anahtar da var" ❌ · Randıman'dan gömülü bileşen silindi → §3 "gömmüyor" ❌.
// =============================================================================
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPORT_CATALOG } from "@/lib/report-catalog";

const ROOT = join(__dirname, "..", "..");
const REPORTS = join(ROOT, "pages", "Reports");
const ALLOWED_RAW = "pages/Reports/_components/ReportDateFilter.tsx";
const DATE_HOOKS = ["useReportDateRange", "useFactoryRange", "useFactoryDay", "useAsOfDay", "useForwardWindow"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Yorumları ayıklar — yorumdaki `type="date"` bir girdi değildir (statementExport emsali). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const files = walk(REPORTS);
const rel = (p: string): string => relative(ROOT, p).replaceAll("\\", "/");
const KEYS = REPORT_CATALOG.map((r) => r.key);

describe("Reports: tarih girdisi tek bileşenden, sözleşme katalogdan", () => {
  it("§0 körlük zemini: yaprak dosyaları ve katalog dolu", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => rel(f) === ALLOWED_RAW)).toBe(true);
    expect(KEYS.length).toBeGreaterThan(25);
  });

  it("§1 ham `type=\"date\"` yalnız ReportDateFilter.tsx'te", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (rel(f) === ALLOWED_RAW) continue;
      const src = stripComments(readFileSync(f, "utf8"));
      const m = src.match(/type\s*=\s*(?:\{\s*)?["']date["']/g);
      if (m) offenders.push(`${rel(f)} (${m.length})`);
    }
    expect(offenders, offenders.join(" · ")).toEqual([]);
  });

  it("§2 tarih hook'ları KATALOG ANAHTARI alır; yaprakta defaultDays/showDateRange yok", () => {
    const offenders: string[] = [];
    const hookCall = new RegExp(`\\b(${DATE_HOOKS.join("|")})\\(([^)]*)\\)`, "g");
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      const isHookFile = /pages\/Reports\/_hooks\//.test(rel(f));
      for (const m of src.matchAll(hookCall)) {
        const arg = m[2]!.trim();
        // Tanım ve geçiş çağrıları (`reportKey` tanımlayıcısı) serbest — yaprağın kendi anahtarını §3 ölçer.
        if (/^reportKey(: ReportKey)?(, "[a-z-]+")?$/.test(arg)) continue;
        const lit = arg.match(/^"([^"]+)"$/);
        if (!lit) offenders.push(`${rel(f)}: ${m[1]}(${arg}) — anahtar değil`);
        else if (!KEYS.includes(lit[1]!)) offenders.push(`${rel(f)}: ${m[1]}("${lit[1]}") katalogda yok`);
      }
      if (/\bdefaultDays\s*=/.test(src) && !isHookFile) offenders.push(`${rel(f)}: defaultDays prop'u geri gelmiş`);
      if (/\bshowDateRange\s*=/.test(src)) offenders.push(`${rel(f)}: showDateRange prop'u geri gelmiş`);
    }
    expect(offenders, offenders.join(" · ")).toEqual([]);
  });

  it("§3 route'taki her yaprak KENDİ anahtarını taşır; başka anahtar geçmez; filters= veren tarihli yaprak bileşeni gömer", () => {
    const routes = readFileSync(join(ROOT, "routes", "content-routes.tsx"), "utf8");
    const componentPath = new Map<string, string>();
    for (const m of routes.matchAll(/import\s+\{?\s*(\w+)\s*\}?\s+from\s+"(@\/pages\/Reports\/[^"]+)"/g)) componentPath.set(m[1]!, m[2]!);
    const routeComponent = new Map<string, string>();
    for (const m of routes.matchAll(/path:\s*"(reports\/[^"]+)",\s*element:\s*\(([\s\S]{0,400}?)\n {4}\)/g)) {
      const el = m[2]!.match(/<(\w+)\s*\/>/);
      if (el) routeComponent.set(m[1]!, el[1]!);
    }
    expect(routeComponent.size, "route→bileşen zinciri çözülmedi").toBeGreaterThan(20);
    const offenders: string[] = [];
    let measured = 0;
    for (const r of REPORT_CATALOG) {
      if (r.panelYolu === "") continue;
      const comp = routeComponent.get(r.panelYolu);
      const path = comp ? componentPath.get(comp) : undefined;
      if (!path) { offenders.push(`${r.key}: ÖLÇÜLEMEDİ — route/bileşen çözülmedi`); continue; }
      const src = stripComments(readFileSync(join(ROOT, `${path.slice(2)}.tsx`), "utf8"));
      measured++;
      const keysInFile = new Set(KEYS.filter((k) => src.includes(`"${k}"`)));
      if (!keysInFile.has(r.key)) offenders.push(`${r.key}: yaprak kendi anahtarını taşımıyor`);
      if (keysInFile.size > 1) offenders.push(`${r.key}: yaprakta başka anahtar da var (${[...keysInFile].join(", ")})`);
      if (!/reportKey=\{?"[a-z/-]+"/.test(src)) offenders.push(`${r.key}: düzene reportKey verilmemiş`);
      if (r.tarih !== "yok" && /\bfilters=/.test(src) && !src.includes("<ReportDateFilter")) {
        offenders.push(`${r.key}: filters= veriyor ama ReportDateFilter gömmüyor — tarih girdisi kaybolur`);
      }
    }
    expect(measured).toBe(REPORT_CATALOG.filter((r) => r.panelYolu !== "").length);
    expect(offenders, offenders.join(" · ")).toEqual([]);
  });

  it("§4 düzen katalog dışı bir varsayılan gün taşımaz", () => {
    const layout = readFileSync(join(REPORTS, "_components", "ReportPageLayout.tsx"), "utf8");
    expect(layout).not.toMatch(/defaultDays/);
    expect(layout).toMatch(/<ReportDateFilter reportKey=\{reportKey\}/);
  });
});
