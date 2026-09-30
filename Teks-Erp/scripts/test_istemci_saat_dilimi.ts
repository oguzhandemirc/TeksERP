// =============================================================================
// İSTEMCİ SAAT DİLİMİ — panel · tablet · patron uygulaması tarih/saati FABRİKANIN diliminden basar
// (`src/lib/factory-time.ts`, sunucu `GET /api/feature-flags` → factoryTimezone / bulut ANLIK `tesis`),
// istemcinin bilgisayar/telefon diliminden DEĞİL (kullanıcı kararı 2026-09-30; docs/design/FABRIKA-SAAT-DILIMI.md).
//   §1 biçimleyici (`factory-time.ts` + dönem durumu `factory-time-zone.ts`) üç projede BAYT-EŞİT (sha256; eksik
//      dosya ÖLÇÜLEMEDİ → kırmızı)
//   §2 biçimleyici DIŞINDA ham yerel-dilim API'si yasak (AST, sözdizimsel):
//      a toLocaleDateString/toLocaleTimeString · b Intl.DateTimeFormat · c tarih toLocaleString (seçenekte tarih
//      anahtarı · alıcı `new Date(...)` · tarih adlı alıcı · `instanceof Date` daraltması) · d date-fns
//      biçimleyici/takvim içe aktarımı (izinli: göreli süre + ayrıştırma) · e dayjs/moment · f "Europe/Istanbul"
//      dizgesi · g yerel saat okuyucu/yazıcı (getHours… setHours…)
//      İstisna BEYANLI ve SAYILI (dosya → kural → adet + gerekçe); beyan fazlası da kırmızı (çürümesin).
//   §1c dönem test vektörleri (`factory-time-periods.test.ts`) üç istemcide birebir aynı
//   §3 bağ: üç istemci dilim DÖNEMLERİNİ sunucudan uygular (panel/tablet bayrak ucu · patron `tesis` projeksiyonu)
// ÖLÇMEDİĞİ: tip bilgisi (c'nin sezgisel yüklemi 2026-09-30'da tip denetimli taramayla karşılaştırıldı:
//   panel 78/78 · tablet 6/6, sızan yok) · `new Date(y, m, d)` yerel kurucusu · render dışı biçim kütüphaneleri.
// ⭐ KALICI SONDA ✓K (her koşumda): her kural sentetik ihlalde ısırır, biçimleyici çağrısında susar.
// Koşum: npx tsx scripts/test_istemci_saat_dilimi.ts   (DB GEREKMEZ)
// =============================================================================
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { DEFAULT_FACTORY_TIMEZONE } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const KOK = path.resolve(__dirname, "..", "..");
// Biçimleyici iki dosyadır: `factory-time.ts` (biçim/gün) + `factory-time-zone.ts` (dönem durumu); ikisi de üç projede bayt-eşit.
const AYNA_DOSYA = ["factory-time.ts", "factory-time-zone.ts"];
const AYNA_KOK = ["Electron/src/lib", "mobil/src/lib", "patron/uygulama/src/lib"];
const AYNA = AYNA_DOSYA.flatMap((f) => AYNA_KOK.map((k) => `${k}/${f}`));
const TARAMA = ["Electron/src", "mobil/src", "patron/uygulama/src", "patron/uygulama/app"];

export type Rule = "a" | "b" | "c" | "d" | "e" | "f" | "g";
const DATE_OPTION_KEYS = new Set(["dateStyle", "timeStyle", "year", "month", "day", "weekday", "hour", "minute", "second", "timeZone", "hourCycle", "hour12", "era", "dayPeriod"]);
const DATE_RECEIVER = /(^d$|^dt$|^at$|^now$|^date$|^when$|^ts$|Date$|date$|At$|Time$|time$|^start$|^end$|stamp|Stamp)/;
const DATE_FNS_ALLOWED = new Set(["formatDistanceToNow", "formatDistance", "parseISO", "isValid"]);
const LOCAL_CLOCK = new Set(["getHours", "getMinutes", "getSeconds", "getDate", "getMonth", "getFullYear", "getDay", "setHours", "setDate", "setMonth", "setFullYear"]);

/** Beyanlı istisnalar: dosya → kural → [adet, gerekçe]. Adet ölçülenle BİREBİR olmalı (fazla da eksik de kırmızı). */
const ISTISNA: Record<string, Partial<Record<Rule, [number, string]>>> = {
  "Electron/src/components/forms/DatePickerInput.tsx": {
    d: [1, "tarih seçici TAKVİM GÜNÜ modelidir (yerel gece yarısı ↔ yyyy-MM-dd); an değil, dilim uygulanmaz"],
  },
  "Electron/src/lib/import/parse.ts": { g: [3, "Excel hücre tarihi dilimsiz takvim değeridir (SheetJS yerel kurucuyla verir)"] },
  "Electron/src/pages/Operations/Yarn/qty.ts": { g: [3, "`parseYmdLocal` yalnız yyyy-MM-dd geçerliliğini denetler (31 Şubat taşması)"] },
  "Electron/src/pages/Finance/Cheques/dates.ts": { g: [3, "`parseYmdLocal` yalnız yyyy-MM-dd geçerliliğini denetler (31 Şubat taşması)"] },
  "Electron/src/pages/Operations/WorkOrders/OrderPickerDialog.tsx": { g: [2, "termin penceresi aritmetiği (an + 7/30 gün); gösterim değil"] },
  "Electron/src/pages/Finance/StatementDialog.tsx": { g: [2, "varsayılan aralık aritmetiği (an − 3 ay); gün anahtarı sonra fabrika diliminden"] },
  "Electron/src/pages/Reports/Finance/CariStatementDialog.tsx": { g: [2, "varsayılan aralık aritmetiği (an − 3 ay); gün anahtarı sonra fabrika diliminden"] },
  "mobil/src/components/filters/rollHistoryFilter.ts": {
    g: [10, "takvim modeli (seçicinin yerel gece yarısı); ana çeviri sorgu sınırında factoryDayStartIso/EndIso ile"],
  },
  "mobil/src/components/filters/DateRangeSheet.tsx": { g: [23, "takvim ızgarası (ay/gün hücreleri) takvim modelidir; 'bugün' factoryTodayNaive"] },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== "node_modules" && e !== "__tests__" && e !== "test") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
}

function narrowedToDate(node: ts.Node, name: string): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isIfStatement(p) || ts.isConditionalExpression(p)) {
      const cond = ts.isIfStatement(p) ? p.expression : p.condition;
      if (new RegExp(`\\b${name}\\s+instanceof\\s+Date\\b`).test(cond.getText())) return true;
    }
  }
  return false;
}

export interface Violation { rule: Rule; line: number; text: string }

/** Tek kaynağın ihlalleri (sözdizimsel). Biçimleyicinin kendisi taranmaz. */
export function findViolations(src: string, fileName = "x.tsx"): Violation[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Violation[] = [];
  const add = (rule: Rule, node: ts.Node) =>
    out.push({ rule, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: node.getText(sf).slice(0, 90) });
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const mod = node.moduleSpecifier.text;
      if (mod === "dayjs" || mod.startsWith("dayjs/") || mod === "moment") add("e", node);
      if (mod === "date-fns") {
        const names = node.importClause?.namedBindings;
        const bad = names && ts.isNamedImports(names) ? names.elements.filter((e) => !DATE_FNS_ALLOWED.has((e.propertyName ?? e.name).text)) : [node];
        for (const b of bad) add("d", b);
      }
    }
    if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) && node.text.includes(DEFAULT_FACTORY_TIMEZONE)) add("f", node);
    if (ts.isPropertyAccessExpression(node) && node.name.text === "DateTimeFormat" && node.expression.getText(sf) === "Intl") add("b", node);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const recv = node.expression.expression;
      if (name === "toLocaleDateString" || name === "toLocaleTimeString") add("a", node);
      else if (name === "toLocaleString") {
        const opt = node.arguments[1];
        const last = ts.isPropertyAccessExpression(recv) ? recv.name.text : ts.isIdentifier(recv) ? recv.text : null;
        const dateOpt = !!opt && ts.isObjectLiteralExpression(opt) && opt.properties.some((p) => !!p.name && ts.isIdentifier(p.name) && DATE_OPTION_KEYS.has(p.name.text));
        const newDate = ts.isNewExpression(recv) && recv.expression.getText(sf) === "Date";
        if (dateOpt || newDate || (last && (DATE_RECEIVER.test(last) || (ts.isIdentifier(recv) && narrowedToDate(node, last))))) add("c", node);
      } else if (LOCAL_CLOCK.has(name) && (node.arguments.length > 0 || name.startsWith("get"))) add("g", node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ── §1 ayna ──────────────────────────────────────────────────────────────────
console.log("── §1 biçimleyici üç projede bayt-eşit ──");
for (const dosya of AYNA_DOSYA) {
  const grup = AYNA_KOK.map((k) => `${k}/${dosya}`);
  const hashes = grup.map((f) => {
    const p = path.join(KOK, f);
    return existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null;
  });
  check(`§1a ${dosya}: üç dosya da VAR (yoksa ÖLÇÜLEMEDİ)`, hashes.every((h) => h !== null), grup.filter((_, i) => hashes[i] === null).join(", "));
  check(
    `§1b ${dosya}: sha256 birebir (düzeltme: Electron'da değiştir, sonra \`cp -p\` mobil + patron/uygulama)`,
    hashes.every((h) => h !== null && h === hashes[0]),
    grup.map((f, i) => `${f}=${(hashes[i] ?? "yok").slice(0, 10)}`).join(" · "),
  );
}

// ── §2 ham API yasağı ────────────────────────────────────────────────────────
console.log("── §2 biçimleyici dışında ham yerel-dilim API'si ──");
const counts = new Map<string, Map<Rule, Violation[]>>();
let scanned = 0;
for (const dir of TARAMA) {
  const abs = path.join(KOK, dir);
  check(`§2 tarama dizini var: ${dir}`, existsSync(abs), "yoksa ÖLÇÜLEMEDİ");
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = path.relative(KOK, file).split(path.sep).join("/");
    if (AYNA.includes(rel)) continue;
    scanned++;
    for (const v of findViolations(readFileSync(file, "utf8"), file)) {
      const byRule = counts.get(rel) ?? new Map<Rule, Violation[]>();
      byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v]);
      counts.set(rel, byRule);
    }
  }
}
check("§2 taranan dosya sayısı anlamlı (≥ 500)", scanned >= 500, `${scanned} dosya`);
const undeclared: string[] = [];
for (const [file, byRule] of counts) {
  for (const [rule, vs] of byRule) {
    const decl = ISTISNA[file]?.[rule];
    if (!decl || decl[0] !== vs.length) {
      undeclared.push(`${file} [${rule}] ${vs.length}${decl ? ` (beyan ${decl[0]})` : ""}: ${vs.map((v) => `${v.line}:${v.text}`).join(" | ")}`);
    }
  }
}
const stale: string[] = [];
for (const [file, rules] of Object.entries(ISTISNA)) {
  for (const rule of Object.keys(rules) as Rule[]) if (!counts.get(file)?.get(rule)) stale.push(`${file} [${rule}]`);
}
check("§2a–g beyansız ihlal YOK (biçimleyiciye çevir: lib/factory-time)", undeclared.length === 0, undeclared.join("\n    "));
check("§2' beyanlı istisna çürümedi (ihlal kalkınca beyan da silinir)", stale.length === 0, stale.join(" · "));

// ── §1c dönem vektörleri üç istemcide AYNI (içe aktarma bloğu hariç bayt-eşit) ─────────────
console.log("── §1c dönem test vektörleri üç istemcide aynı ──");
const PERIOD_TESTS = ["Electron/src/lib/factory-time-periods.test.ts", "mobil/src/lib/factory-time-periods.test.ts", "patron/uygulama/__tests__/factory-time-periods.test.ts"];
const periodBodies = PERIOD_TESTS.map((f) => {
  const p = path.join(KOK, f);
  if (!existsSync(p)) return null;
  const src = readFileSync(p, "utf8");
  const cut = src.indexOf("\n// Saat dilimi DÖNEMLERİ");
  return cut < 0 ? null : src.slice(cut);
});
check("§1c dönem test dosyaları var ve gövde başlığı bulundu", periodBodies.every((b) => b !== null), PERIOD_TESTS.filter((_, i) => periodBodies[i] === null).join(", ") || "3/3");
check("§1c dönem vektörleri üç istemcide birebir", periodBodies.every((b) => b !== null && b === periodBodies[0]), "gövdeler farklı — Electron'dakini kopyala");

// ── §3 bağ: dilim sunucudan uygulanır ────────────────────────────────────────
console.log("── §3 dilim sunucudan uygulanır ──");
const BAG: [string, RegExp, string][] = [
  ["Electron/src/services/featureFlagService.ts", /applyServerFactoryTimezone\(r\.data\?\.data\)/, "panel bayrak ucu → dönemler (applyServerFactoryTimezone)"],
  ["Electron/src/App.tsx", /<FactoryTimezoneLoader \/>/, "panel girişten sonra bayrakları yükler"],
  ["Electron/src/App.tsx", /key=\{factoryTimezone\}/, "panel dilim değişince kabuğu yeniden kurar"],
  ["mobil/src/services/featureFlag.service.ts", /applyServerFactoryTimezone\(flags\)/, "tablet bayrak ucu → dönemler (applyServerFactoryTimezone)"],
  ["mobil/src/hooks/useFactoryTimezone.ts", /applyServerFactoryTimezone\(flags\)/, "tablet kalıcı önbellekteki dönemleri uygular"],
  ["mobil/src/navigation/RootNavigator.tsx", /key=\{factoryTimezone\}/, "tablet kalıcı önbellekteki dilimi uygular ve yeniden kurar"],
  ["patron/uygulama/src/state/session.tsx", /api\.snapshot\("tesis"\)[\s\S]*donemler[\s\S]*applyServerFactoryTimezone\(\{ factoryTimezone: veri\?\.saatDilimi, factoryTimezoneBase: veri\?\.tabanDilim, factoryTimezonePeriods: donemler \}\)/, "patron uygulaması ANLIK tesis dönemleri"],
];
for (const [file, re, what] of BAG) {
  const p = path.join(KOK, file);
  check(`§3 ${what}`, existsSync(p) && re.test(readFileSync(p, "utf8")), existsSync(p) ? file : `${file} YOK (ÖLÇÜLEMEDİ)`);
}

// ── ✓K kalıcı sondalar ───────────────────────────────────────────────────────
console.log("── ✓K kalıcı sondalar (sentetik) ──");
const rulesOf = (src: string): string => [...new Set(findViolations(src).map((v) => v.rule))].sort().join("");
const PROBES: [string, string, string][] = [
  ["a", 'const t = new Date(x).toLocaleDateString("tr-TR");', 'const t = factoryLocaleDateString(x, "tr-TR");'],
  ["b", 'const f = new Intl.DateTimeFormat("tr-TR", { day: "2-digit" });', 'const f = factoryDateTimeFormat("tr-TR", { day: "2-digit" });'],
  ["c", 'const t = row.createdAt.toLocaleString("tr-TR");', 'const t = factoryLocaleString(row.createdAt, "tr-TR");'],
  ["c", 'if (v instanceof Date) return v.toLocaleString("tr-TR");', 'const n = qty.toLocaleString("tr-TR");'],
  ["d", 'import { format } from "date-fns";', 'import { formatDistanceToNow } from "date-fns";'],
  ["e", "import dayjs from 'dayjs';", "import { formatFactory } from './factory-time';"],
  ["f", 'const tz = "Europe/Istanbul";', "const tz = getFactoryTimezone();"],
  ["f", 'const note = "Gün fabrika günüdür (Europe/Istanbul).";', "const note = `Gün fabrika günüdür (${getFactoryTimezone()}).`;"],
  // Sonda metni parçalı: kendi satırı `test_gun_anahtari_kaynagi` yerel-erişimci cırcırına sayılmasın.
  ["g", `const h = d.get${"Hours"}();`, "const h = formatFactory(d, 'HH');"],
];
for (const [rule, bad, good] of PROBES) {
  check(`✓K ${rule}: ihlal ısırır · biçimleyici susar`, rulesOf(bad) === rule && rulesOf(good) === "", `${bad} → '${rulesOf(bad)}' · ${good} → '${rulesOf(good)}'`);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
