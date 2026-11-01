// =============================================================================
// BEKÇİ — PATRON BULUTU KÂRLILIK ÖZETİ (D4-G4; tasarım DALGA4 §8.8 + §13 D4-G4; kullanıcı kararı S15 a)
// =============================================================================
//   §1 katalog — `karlilik-ozet` ANLIK · GUNLUK · `bulut:maliyet:oku` · maliyet.enabled; bulut kataloğunda aynı izin ·
//      uzak rapor `maliyet/karlilik` aynı izinle iki uçta; bulut isteğinde "iş" kırılımı ve varyant 400
//   §2 ⭐ statik — kurucu tek kaynaktan okur (computeProfitability + panelin profitGroups/badgeOf; prisma/ham SQL/
//      fatura satırı/top YOK) · tel şeması anahtar kümesi İZİNLİ küme ile BİREBİR · patron/sunucu `src/`inde alanlara
//      yalnız tel sözleşmesi + katalog dokunur (bulut aritmetik yapmaz) · uygulamada alanları yalnız görünüm
//      (`lib/profitability-summary.ts`) + tel aynası okur; görünümde aritmetik/karşılaştırma/sıralama yok
//   §3 ⭐ saf — ilk 10 sıralaması FABRİKADA: 13 kârlı + 12 zararlı + 2 eksik müşteri → en kârlı 10 azalan, en zararlı
//      10 artan, eksik sayılır; eksik rozeti taşınır, katkı 0 yazılmaz; fatura no / top tele girmez; katı şema
//      yabancı anahtarı reddeder
//   §4 canlı — maliyet kapalı turda / GUNLUK dışı turda üretilmez; açıkken (modüller açıksa) şemadan geçer
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31): şemaya + kurucuya müşteri satırında `faturaNo` (ham fatura satırı alanı)
//    eklendi → §2b + §3f ❌; uygulama görünümüne `.sort(` → §2d ❌; geri alındı → yeşil.
// DB'ye YAZMAZ (yalnız okur).
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { z } from "zod";
import { Prisma, ServiceMeterBasis } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { SNAPSHOT_PROJECTIONS } from "../src/cloud-sync/projections";
import { SNAPSHOT_WIRE_SCHEMAS, buildSnapshots } from "../src/cloud-sync/snapshots";
import { findRemoteReport } from "../src/cloud-sync/report-requests";
import { PROFIT_SNAPSHOT_SCHEMA, profitSnapshotFromResult } from "../src/cloud-sync/snapshot-profitability";
import { computeProfitability, type ProfitabilityResult, type ProfitabilityRow } from "../src/services/helpers/profitability.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const NAME = "karlilik-ozet";
const REPORT = "maliyet/karlilik";
const PERM = "bulut:maliyet:oku";
const ROOT = path.resolve(__dirname, "../..");
const BUILDER = path.resolve(__dirname, "../src/cloud-sync/snapshot-profitability.ts");
const CLOUD_SRC = path.join(ROOT, "patron/sunucu/src");
const CLOUD_SUMMARY = path.join(CLOUD_SRC, "catalog/katalog-ozeti.json");
const APP_DIRS = [path.join(ROOT, "patron/uygulama/src"), path.join(ROOT, "patron/uygulama/app")];
const APP_VIEW = "patron/uygulama/src/lib/profitability-summary.ts";
const FIELD_RE = /\b(enKarli|enZararli|buAyIslemler|hesaplanamayanMusteri)\b/;
/** Telde izinli anahtar yolları — ay/işlem/müşteri ADI + TL + rozet; fatura no, top, satır, kişi YOK (S15 a). */
const MONEY = ["gelir", "katki", "net", "rozet"];
const ALLOWED_KEYS = [
  "buAy", "hesap", "hesaplanamayanMusteri",
  "donem", ...[...MONEY, "sarf", "makine", "disFason"].map((k) => `donem.${k}`),
  "aylar", "aylar.ay", ...MONEY.map((k) => `aylar.${k}`),
  "buAyIslemler", "buAyIslemler.etiket", "buAyIslemler.metre", ...MONEY.map((k) => `buAyIslemler.${k}`),
  "enKarli", "enKarli.etiket", ...MONEY.map((k) => `enKarli.${k}`),
  "enZararli", "enZararli.etiket", ...MONEY.map((k) => `enZararli.${k}`),
].sort();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (/\.tsx?$/.test(n)) out.push(f);
  }
  return out;
}

function unwrap(s: z.ZodType): z.ZodType {
  return s instanceof z.ZodNullable || s instanceof z.ZodOptional ? unwrap(s.unwrap() as z.ZodType) : s;
}

function schemaKeys(s: z.ZodType, prefix = ""): string[] {
  const u = unwrap(s);
  if (u instanceof z.ZodArray) return schemaKeys(u.element as z.ZodType, prefix);
  if (u instanceof z.ZodObject) {
    return Object.entries(u.shape as Record<string, z.ZodType>).flatMap(([k, v]) => [`${prefix}${k}`, ...schemaKeys(v, `${prefix}${k}.`)]);
  }
  return [];
}

function dataKeys(v: unknown, prefix = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => dataKeys(x, prefix));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [`${prefix}${k}`, ...dataKeys(x, `${prefix}${k}.`)]);
  return [];
}

const ARITH_OPS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
]);
const NUMERIC_CALLS = new Set(["Number", "parseFloat", "parseInt", "Math", "reduce", "sort", "toSorted", "localeCompare"]);

/** Görünümde sayı karşılaştırması / aritmetik / toplama-sıralama (AST; yorum ve metin sayılmaz). */
function arithmeticIn(src: string): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile("v.ts", src, ts.ScriptTarget.Latest, true);
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && ARITH_OPS.has(n.operatorToken.kind)) out.push(`işleç ${n.getText(sf)}`);
    if (ts.isPrefixUnaryExpression(n) && (n.operator === ts.SyntaxKind.MinusToken || n.operator === ts.SyntaxKind.PlusToken)) out.push(`işleç ${n.getText(sf)}`);
    if (ts.isIdentifier(n) && NUMERIC_CALLS.has(n.text)) out.push(`çağrı ${n.text}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function katalog(): void {
  console.log("── §1 Katalog ──");
  const p = SNAPSHOT_PROJECTIONS.find((x) => x.name === NAME);
  check("§1a ⭐ karlilik-ozet ANLIK · GUNLUK · bulut:maliyet:oku · maliyet.enabled",
    !!p && p.cadence === "GUNLUK" && p.permission === PERM && p.module === "maliyet.enabled" && p.reads.includes("service_billing_links"), JSON.stringify(p));
  const cloud = JSON.parse(readFileSync(CLOUD_SUMMARY, "utf8")) as {
    ROOT_PROJECTIONS: Array<{ name: string; kind: string; permissions: string[] }>; REPORT_KEY_PERMISSION: Record<string, string>;
  };
  const c = cloud.ROOT_PROJECTIONS.find((x) => x.name === NAME);
  check("§1b bulut kataloğunda aynı ad ANLIK + bulut:maliyet:oku", !!c && c.kind === "ANLIK" && JSON.stringify(c.permissions) === `["${PERM}"]`, JSON.stringify(c));
  const r = findRemoteReport(REPORT);
  check("§1c uzak rapor maliyet/karlilik: fabrika ve bulut izni bulut:maliyet:oku, modül maliyet + ön muhasebe kapısı",
    !!r && r.permission === PERM && r.module === "maliyet.enabled" && !!r.gate && cloud.REPORT_KEY_PERMISSION[REPORT] === PERM,
    `${r?.permission} / ${cloud.REPORT_KEY_PERMISSION[REPORT]}`);
  const ok = r?.params.safeParse({ from: "2026-09-01", to: "2026-10-31", kirilim: "musteri" });
  const work = r?.params.safeParse({ from: "2026-09-01", to: "2026-10-31", kirilim: "is" });
  const variant = r?.params.safeParse({ from: "2026-09-01", to: "2026-10-31", varyant: "musteri" });
  check("§1d bulut isteğinde 'iş' kırılımı (top/belge no) ve varyant REDDEDİLİR; müşteri kırılımı geçer",
    !!ok?.success && work?.success === false && variant?.success === false);
}

function statik(): void {
  console.log("── §2 Statik ──");
  const b = readFileSync(BUILDER, "utf8");
  check("§2a ⭐ kurucu tek kaynaktan okur (computeProfitability + profitGroups); prisma / ham SQL / fatura satırı / top yok",
    b.includes("computeProfitability(") && b.includes("profitGroups(") && !/lib\/prisma|\$queryRaw|invoice_lines|docNo|rollId|barcode|invoiceId/.test(b));
  const keys = [...new Set(schemaKeys(SNAPSHOT_WIRE_SCHEMAS[NAME]!))].sort();
  const extra = keys.filter((k) => !ALLOWED_KEYS.includes(k));
  const missing = ALLOWED_KEYS.filter((k) => !keys.includes(k));
  check("§2b ⭐ tel şeması anahtarları izinli kümeyle BİREBİR (ham fatura satırı/top/kişi yok)", extra.length === 0 && missing.length === 0,
    [extra.length ? `fazla: ${extra.join(",")}` : "", missing.length ? `eksik: ${missing.join(",")}` : ""].filter(Boolean).join(" · ") || `${keys.length} anahtar`);
  const allowedCloud = new Set(["patron/sunucu/src/wire/api.ts"]);
  const cloudExtra = walk(CLOUD_SRC).filter((f) => FIELD_RE.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f)).filter((f) => !allowedCloud.has(f));
  check("§2c ⭐ patron/sunucu alanlara yalnız tel sözleşmesinde dokunur (bulut hesap/sıralama yapmaz)", cloudExtra.length === 0, cloudExtra.join(", ") || "temiz");
  const nameAllowed = new Set(["patron/sunucu/src/wire/api.ts", "patron/sunucu/src/catalog/projections.ts", "patron/sunucu/src/catalog/katalog-ozeti.json"]);
  const nameExtra = walk(CLOUD_SRC).filter((f) => readFileSync(f, "utf8").includes(NAME)).map((f) => path.relative(ROOT, f)).filter((f) => !nameAllowed.has(f));
  check("§2c2 ⭐ patron/sunucu'da anlık adı yalnız katalog + tel dosyalarında geçer", nameExtra.length === 0, nameExtra.join(", ") || "temiz");
  const allowedApp = new Set([APP_VIEW, "patron/uygulama/src/api/wire.ts"]);
  const appExtra = APP_DIRS.flatMap(walk).filter((f) => FIELD_RE.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f)).filter((f) => !allowedApp.has(f));
  const arith = arithmeticIn(readFileSync(path.join(ROOT, APP_VIEW), "utf8"));
  check("§2d ⭐ uygulamada alanları yalnız görünüm okur; görünümde aritmetik/karşılaştırma/sıralama yok",
    appExtra.length === 0 && arith.length === 0, [...appExtra, ...arith].join(", ") || "temiz");
}

const D = (v: number | string) => new Prisma.Decimal(v);

function row(customerId: string, contribution: number | null, month: string, i: number): ProfitabilityRow {
  const revenue = D(1000);
  const cost = contribution === null ? null : revenue.minus(contribution);
  return {
    month, kind: "INVOICED", invoiceId: `INV-${i}`, docNo: `GIZLI-FATURA-${i}`, linkId: `L-${i}`, customerId, rollId: `GIZLI-TOP-${i}`,
    serviceItemId: "S-KURSUN", workOrderStepId: null, machineId: null, meterBasis: ServiceMeterBasis.OUT, meters: D(100),
    revenueTry: revenue, consumableTry: cost, subcontractTry: contribution === null ? null : D(0), subcontractEstimated: false,
    machineAttributed: false, machineHours: null, machineTry: contribution === null ? null : D(0),
    contributionTry: contribution === null ? null : D(contribution), laborTry: D(0), overheadTry: D(0),
    netTry: contribution === null ? null : D(contribution), missing: contribution === null ? ["SARF_NORMU"] : [],
  };
}

function saf(): void {
  console.log("\n── §3 Saf (ilk 10 fabrikada) ──");
  const rows: ProfitabilityRow[] = [];
  const names = new Map<string, string>();
  let i = 0;
  // Kârlılar karışık sırada (1..13 × 10 TL); zararlılar −1..−12 × 10; iki müşterinin katkısı eksik.
  for (const k of [7, 3, 13, 1, 9, 11, 5, 2, 12, 4, 10, 6, 8]) { names.set(`P${k}`, `Kârlı ${k}`); rows.push(row(`P${k}`, k * 10, "2026-10", i++)); }
  for (const k of [4, 12, 1, 9, 6, 3, 11, 2, 8, 5, 10, 7]) { names.set(`Z${k}`, `Zararlı ${k}`); rows.push(row(`Z${k}`, -k * 10, "2026-09", i++)); }
  for (const k of [1, 2]) { names.set(`E${k}`, `Eksik ${k}`); rows.push(row(`E${k}`, null, "2026-10", i++)); }
  const result: ProfitabilityResult = {
    fromMonth: "2025-11", toMonth: "2026-10",
    settings: { subcontractSource: "FATURA_ONCE", consumablePriceSource: "ALIS_FIYATI", machineTime: "OTURUM", overheadKey: "YOK", categoryClasses: {} } as ProfitabilityResult["settings"],
    rows, draftRows: [], months: [], idleMachineDays: [],
  };
  const data = profitSnapshotFromResult(result, { customers: names, serviceItems: new Map([["S-KURSUN", "Kurşun dikimi"]]), machines: new Map(), rolls: new Map() }, "2026-10");
  check("§3a ⭐ en kârlı ilk 10, katkı azalan (130 … 40)", JSON.stringify(data.enKarli.map((x) => x.etiket)) === JSON.stringify([13, 12, 11, 10, 9, 8, 7, 6, 5, 4].map((k) => `Kârlı ${k}`)),
    data.enKarli.map((x) => x.etiket).join(","));
  check("§3b ⭐ en zararlı ilk 10, katkı artan (−120 … −30)", JSON.stringify(data.enZararli.map((x) => x.etiket)) === JSON.stringify([12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map((k) => `Zararlı ${k}`))
    && data.enZararli[0]?.katki === "-120.00", data.enZararli.map((x) => `${x.etiket}=${x.katki}`).join(","));
  check("§3c eksik katkılı müşteri sıralamaya girmez, sayısı taşınır", data.hesaplanamayanMusteri === 2 && ![...data.enKarli, ...data.enZararli].some((x) => x.etiket.startsWith("Eksik")));
  check("§3d ⭐ eksik rozeti taşınır, dönem katkısı 0 yazılmaz (null)", data.donem.katki === null && data.donem.rozet.includes("sarf normu") && data.aylar.length === 12,
    `${data.donem.katki} · ${data.donem.rozet} · ${data.aylar.length} ay`);
  const ekim = data.aylar.find((a) => a.ay === "2026-10");
  const eylul = data.aylar.find((a) => a.ay === "2026-09");
  check("§3e ay toplamları fabrikada (Eylül katkısı −780; Ekim eksikli → null + rozet); bu ay işlem kırılımı adıyla",
    eylul?.katki === "-780.00" && ekim?.katki === null && data.buAyIslemler.length === 1 && data.buAyIslemler[0]!.etiket === "Kurşun dikimi" && data.buAyIslemler[0]!.metre === "1500.00",
    `${eylul?.katki} · ${ekim?.katki} · ${JSON.stringify(data.buAyIslemler)}`);
  const parsed = PROFIT_SNAPSHOT_SCHEMA.parse(data);
  const keys = [...new Set(dataKeys(parsed))].sort();
  const raw = JSON.stringify(parsed);
  check("§3f ⭐ tel yalnız izinli anahtarlar; fatura no ve top kimliği GİTMEZ", keys.every((k) => ALLOWED_KEYS.includes(k)) && !raw.includes("GIZLI-"),
    keys.filter((k) => !ALLOWED_KEYS.includes(k)).join(",") || "temiz");
  const bad = PROFIT_SNAPSHOT_SCHEMA.safeParse({ ...parsed, satirlar: [{ faturaNo: "X" }] });
  check("§3g katı şema yabancı anahtarı (ham fatura satırı) reddeder", !bad.success);
}

async function canli(): Promise<void> {
  console.log("\n── §4 Canlı ──");
  const now = new Date();
  const off = await buildSnapshots({ now, productionOn: true, financeOn: true, cadences: new Set(["GUNLUK"]) });
  const hourly = await buildSnapshots({ now, productionOn: true, financeOn: true, maliyetOn: true, cadences: new Set(["SAATLIK", "HER_TUR"]) });
  check("§4a maliyet kapalı turda ve GUNLUK dışı turda üretilmez", !off.some((s) => s.projection === NAME) && !hourly.some((s) => s.projection === NAME));
  const on = await buildSnapshots({ now, productionOn: true, financeOn: true, maliyetOn: true, cadences: new Set(["GUNLUK"]) });
  const snap = on.find((s) => s.projection === NAME);
  // Ön muhasebe ya da maliyet ayarı DB'de kapalıysa hesap null → anlık yok; açıksa katı şemadan geçmiş olmalı.
  const computed = await computeProfitability({ fromMonth: "2026-01", toMonth: "2026-01" });
  check("§4b maliyet açık turda: modüller açıksa üretilir ve şemadan geçer, kapalıysa üretilmez",
    computed === null ? !snap : !!snap && PROFIT_SNAPSHOT_SCHEMA.safeParse(snap.data).success, computed === null ? "modül kapalı" : `${(snap?.data as { aylar?: unknown[] })?.aylar?.length} ay`);
}

async function main(): Promise<void> {
  console.log("=== PATRON BULUTU KÂRLILIK ÖZETİ BEKÇİSİ ===\n");
  katalog();
  statik();
  try {
    saf();
    await canli();
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
