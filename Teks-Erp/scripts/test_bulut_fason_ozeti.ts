// =============================================================================
// BEKÇİ — PATRON BULUTU FASON · EMANET ANLIKLARI (genel fason PB1, 2026-11-08)
// =============================================================================
//   §1 katalog — `emanet-bakiye` (bulut:stok:oku) · `fason-acik` (bulut:uretim:oku) · `hizmet-geliri` (bulut:fatura:oku,
//      finance.enabled) ANLIK + SAATLIK; bulut kataloğunda (üretilmiş özet) aynı ad + izin
//   §2 ⭐ statik — kurucu TEK kaynakları çağırır (getConsignedWorkSummary · consignedMaterialByOwner ·
//      getSubcontractorCockpit) ve kokpitin termin/açıklık çözücüsünü YENİDEN KURMAZ · tel şemalarının anahtar kümesi
//      İZİNLİ kümeyle BİREBİR (barkod/belge no/kişi eklenirse kırmızı) · patron/sunucu `src/`inde alanlara yalnız tel
//      sözleşmesi, anlık adlarına yalnız katalog + tel dokunur (bulut hesap yapmaz) · uygulamada alanları yalnız görünüm
//      (`lib/fason-summary.ts`) + tel aynası okur; görünümde (AST) aritmetik/karşılaştırma/toplama yok
//   §3 ⭐ canlı — fason-acik = kokpit özeti birebir (TAG dokuma sevki, termini dün → geciken ≥ 1) · emanet-bakiye TAG
//      müşteri satırı = İçerideki İşler + lot defteri (iplik 50 kg), toplam top = getConsignedWorkSummary toplamı ·
//      hizmet-geliri yalnız ONAYLI SATIŞ; iptal/taslak/alış girmez; döviz satırı damgalı kurla TL · ozet.stok.emanet =
//      karnenin emanet toplamı · emanet KAPALIYKEN emanet-bakiye üretilmez ve ozet.stok'ta emanet alanı yok ·
//      finans kapalıyken hizmet-geliri üretilmez
// ⭐ NEGATİF SONDA (ölçüldü 2026-11-08, 27/0 taban): iptal fatura gelire dahil → §3e ❌ · emanet şemasına `barkod` →
//    §2b + §3i ❌ · emanet bayrağı yok sayıldı → §3j ❌ · geciken ← yaklaşan → §3a + §3b ❌ · kurucuda `expectedReturnAt`
//    → §2a2 ❌ · görünümde `Number(x) + 0` → §2d ❌ · iplik defter yerine sıfır → §3c ❌; geri alındı → yeşil.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; TAG'li veri `finally`de silinir, bayraklar birebir geri yüklenir.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { z } from "zod";
import { Currency, InvoiceStatus, Prisma, RollStatus, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SNAPSHOT_PROJECTIONS } from "../src/cloud-sync/projections";
import { SNAPSHOT_WIRE_SCHEMAS, buildSnapshots } from "../src/cloud-sync/snapshots";
import { consignedTotal } from "../src/cloud-sync/overview";
import { getConsignedWorkSummary } from "../src/services/roll-owner.service";
import { getSubcontractorCockpit } from "../src/services/subcontractor-cockpit.service";
import { getStockScorecard } from "../src/services/reports/stock-scorecard.report.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { fixtureWarehouseId } from "./fixture-warehouse";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const NAMES = { emanet: "emanet-bakiye", fason: "fason-acik", gelir: "hizmet-geliri" } as const;
const TAG = `TEST-BFO-${process.pid}`;
const ROOT = path.resolve(__dirname, "../..");
const BUILDER = path.resolve(__dirname, "../src/cloud-sync/snapshot-fason.ts");
const CLOUD_SRC = path.join(ROOT, "patron/sunucu/src");
const CLOUD_SUMMARY = path.join(CLOUD_SRC, "catalog/katalog-ozeti.json");
const APP_DIRS = [path.join(ROOT, "patron/uygulama/src"), path.join(ROOT, "patron/uygulama/app")];
const APP_VIEW = "patron/uygulama/src/lib/fason-summary.ts";
/** Yalnız bu anlıklara özgü alan adları; başka telde de yaşayan adlar (cariKartId, tutarTl, geciken…) §2c2 ad kontrolüyle kapanır. */
const FIELD_RE = /\b(topAdet|topMiktar|iplikKg|leventAdet|acikSevk|kirpildi|fasonFirmaId|toplamTl|hizmetId)\b/;
const BALANCE = ["topAdet", "topMiktar", "iplikKg", "leventAdet"];
const ALLOWED: Record<string, string[]> = {
  [NAMES.emanet]: [...BALANCE.map((k) => `toplam.${k}`), "toplam", "cariler", "cariler.cariKartId", "cariler.etiket", ...BALANCE.map((k) => `cariler.${k}`)].sort(),
  [NAMES.fason]: ["acikSevk", "geciken", "yaklasan", "kalanMiktar", "kirpildi", "firmalar",
    ...["fasonFirmaId", "etiket", "acikSevk", "geciken", "kalanMiktar", "iplikKg", "leventAdet"].map((k) => `firmalar.${k}`)].sort(),
  [NAMES.gelir]: ["bugun", "buAy", "gecenAy", "son30Gun"].flatMap((p) => [p, `${p}.toplamTl`, `${p}.kalemler`,
    ...["hizmetId", "etiket", "miktar", "birim", "tutarTl"].map((k) => `${p}.kalemler.${k}`)]).sort(),
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (/\.(tsx?|json)$/.test(n)) out.push(f);
  }
  return out;
}

function schemaKeys(s: z.ZodType, prefix = ""): string[] {
  if (s instanceof z.ZodNullable || s instanceof z.ZodOptional) return schemaKeys(s.unwrap() as z.ZodType, prefix);
  if (s instanceof z.ZodArray) return schemaKeys(s.element as z.ZodType, prefix);
  if (s instanceof z.ZodObject) {
    return Object.entries(s.shape as Record<string, z.ZodType>).flatMap(([k, v]) => [`${prefix}${k}`, ...schemaKeys(v, `${prefix}${k}.`)]);
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
  ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
]);
const NUMERIC_CALLS = new Set(["Number", "parseFloat", "parseInt", "Math", "reduce", "sort"]);

/** Görünümde aritmetik/karşılaştırma/toplama (AST). `+` yalnız iki tarafı da sayı DIŞI (metin şablonu) değilse sayılır. */
function arithmeticIn(src: string): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile("v.ts", src, ts.ScriptTarget.Latest, true);
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && (ARITH_OPS.has(n.operatorToken.kind) || n.operatorToken.kind === ts.SyntaxKind.PlusToken)) out.push(`işleç ${n.getText(sf)}`);
    if (ts.isPrefixUnaryExpression(n) && (n.operator === ts.SyntaxKind.MinusToken || n.operator === ts.SyntaxKind.PlusToken)) out.push(`işleç ${n.getText(sf)}`);
    if (ts.isIdentifier(n) && NUMERIC_CALLS.has(n.text)) out.push(`çağrı ${n.text}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function katalog(): void {
  console.log("── §1 Katalog ──");
  const cloud = JSON.parse(readFileSync(CLOUD_SUMMARY, "utf8")) as { ROOT_PROJECTIONS: Array<{ name: string; kind: string; permissions: string[] }> };
  const want: Array<[string, string, string | undefined]> = [
    [NAMES.emanet, "bulut:stok:oku", undefined], [NAMES.fason, "bulut:uretim:oku", undefined], [NAMES.gelir, "bulut:fatura:oku", "finance.enabled"],
  ];
  for (const [name, perm, mod] of want) {
    const p = SNAPSHOT_PROJECTIONS.find((x) => x.name === name);
    check(`§1a ⭐ ${name} ANLIK · SAATLIK · ${perm} · modül ${mod ?? "yok"}`, !!p && p.cadence === "SAATLIK" && p.permission === perm && p.module === mod, JSON.stringify(p));
    const c = cloud.ROOT_PROJECTIONS.find((x) => x.name === name);
    check(`§1b bulut kataloğunda ${name} ANLIK + ${perm}`, !!c && c.kind === "ANLIK" && JSON.stringify(c.permissions) === JSON.stringify([perm]), JSON.stringify(c));
  }
}

function statik(): void {
  console.log("── §2 Statik ──");
  const b = readFileSync(BUILDER, "utf8");
  const calls = ["getConsignedWorkSummary(", "consignedMaterialByOwner(", "getSubcontractorCockpit("];
  check("§2a ⭐ kurucu tek kaynakları çağırır (İçerideki İşler · emanet malzeme · F10 kokpit)", calls.every((c) => b.includes(c)), calls.filter((c) => !b.includes(c)).join(",") || "üçü de");
  // Kokpitin açıklık/termin çözücüsü burada yeniden kurulmaz: ne yüklemi, ne termin alanı, ne sevk tablosu okunur.
  const rebuilt = b.match(/OPEN_OUTSTANDING|COCKPIT_OPEN_WHERE|expectedReturnStateOf|overdueDaysOf|expectedReturnAt|subcontractorDispatch|subcontractor_dispatch|ownerCustomerId\s*:/g) ?? [];
  check("§2a2 ⭐ kurucu kokpit/İçerideki İşler yüklemini yeniden kurmaz", rebuilt.length === 0, rebuilt.join(",") || "temiz");
  for (const name of Object.values(NAMES)) {
    const keys = [...new Set(schemaKeys(SNAPSHOT_WIRE_SCHEMAS[name]!))].sort();
    const extra = keys.filter((k) => !ALLOWED[name]!.includes(k));
    const missing = ALLOWED[name]!.filter((k) => !keys.includes(k));
    check(`§2b ⭐ ${name} tel şeması anahtarları izinli kümeyle BİREBİR (barkod/belge no/kişi yok)`, extra.length === 0 && missing.length === 0,
      [extra.length ? `fazla: ${extra.join(",")}` : "", missing.length ? `eksik: ${missing.join(",")}` : ""].filter(Boolean).join(" · ") || `${keys.length} anahtar`);
  }
  const cloudFiles = walk(CLOUD_SRC).filter((f) => !f.endsWith(".json"));
  const cloudExtra = cloudFiles.filter((f) => FIELD_RE.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f)).filter((f) => f !== "patron/sunucu/src/wire/api.ts");
  check("§2c ⭐ patron/sunucu alanlara yalnız tel sözleşmesinde dokunur (bulut hesap/süzme yapmaz)", cloudExtra.length === 0, cloudExtra.join(", ") || "temiz");
  const nameAllowed = new Set(["patron/sunucu/src/wire/api.ts", "patron/sunucu/src/catalog/projections.ts", "patron/sunucu/src/catalog/katalog-ozeti.json"]);
  const nameRe = new RegExp(`"(${Object.values(NAMES).join("|")})"`);
  const nameExtra = walk(CLOUD_SRC).filter((f) => nameRe.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f)).filter((f) => !nameAllowed.has(f));
  check("§2c2 ⭐ patron/sunucu'da anlık adları yalnız katalog + tel dosyalarında geçer", nameExtra.length === 0, nameExtra.join(", ") || "temiz");
  const allowedApp = new Set([APP_VIEW, "patron/uygulama/src/api/wire.ts"]);
  const appExtra = APP_DIRS.flatMap(walk).filter((f) => FIELD_RE.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f)).filter((f) => !allowedApp.has(f));
  const arith = arithmeticIn(readFileSync(path.join(ROOT, APP_VIEW), "utf8"));
  check("§2d ⭐ uygulamada alanları yalnız görünüm okur; görünümde aritmetik/karşılaştırma/toplama yok",
    appExtra.length === 0 && arith.length === 0, [...appExtra, ...arith].join(", ") || "temiz");
}

interface Ids { customer: string; svc: string; invoices: string[]; rolls: string[]; yarnItem: string; lot: string; weaving: string; dispatch: string }
type Flags = Array<{ key: string; foto: { value: Prisma.JsonValue } | null }>;

const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });

async function snaps(now: Date, financeOn = true) {
  return buildSnapshots({ now, productionOn: true, financeOn, cadences: new Set(["SAATLIK", "HER_TUR"]) });
}

async function canli(ids: Ids): Promise<void> {
  console.log("\n── §3 Canlı ──");
  const now = new Date();
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_ENABLED]) await setFlag(k, true);
  const wh = await fixtureWarehouseId();
  const patos = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  if (!patos) throw new Error("Seed fixture eksik (PATOS) — önce 'npm run seed'");
  const dye = await ensureTestDyeHouse();

  // Fikstür: emanet müşteri (2 top + 50 kg iplik) · TAG hizmet kartı + 5 fatura · açık dokuma sevki (termini dün)
  ids.customer = (await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} Emanet Müşteri` }, select: { id: true } })).id;
  for (const [n, qty] of [["1", 100], ["2", 23.5]] as const) {
    ids.rolls.push((await prisma.roll.create({ data: { barcode: `${TAG}-R${n}`, itemId: patos.id, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, warehouseId: wh, ownerCustomerId: ids.customer }, select: { id: true } })).id);
  }
  ids.yarnItem = (await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } })).id;
  ids.lot = (await prisma.yarnLot.create({ data: { itemId: ids.yarnItem, lotNo: `${TAG}-L1`, ownerCustomerId: ids.customer }, select: { id: true } })).id;
  await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: ids.yarnItem, warehouseId: wh, kind: YarnMovementKind.IN, qtyKg: 50, lotId: ids.lot, reason: `${TAG} emanet giriş` }));

  const cari = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: ids.customer, subcontractorId: null }));
  ids.svc = (await prisma.serviceItem.create({ data: { code: `${TAG}-S`.slice(0, 32), name: `${TAG} Kurşun hizmeti` }, select: { id: true } })).id;
  const inv = async (no: string, status: InvoiceStatus, type: "SALES" | "PURCHASE", qty: string, total: string, currency: Currency = Currency.TRY, rate = "1") => {
    ids.invoices.push((await prisma.invoice.create({
      data: {
        docNo: `${TAG}-${no}`, type, status, cariId: cari.id, currency, exchangeRate: rate, issueDate: now, confirmedAt: status === InvoiceStatus.DRAFT ? null : now,
        ...(status === InvoiceStatus.CANCELLED ? { cancelledAt: now, cancelReason: TAG } : {}),
        lines: { create: [{ lineNo: 1, lineType: "SERVICE", serviceItemId: ids.svc, description: TAG, qty, unit: "m", unitPrice: new Prisma.Decimal(total).div(qty), lineTotal: total, vatAmount: "0" }] },
      },
      select: { id: true },
    })).id);
  };
  await inv("A", InvoiceStatus.CONFIRMED, "SALES", "10", "100.00");
  await inv("B", InvoiceStatus.CONFIRMED, "SALES", "5", "10.00", Currency.USD, "30.5");
  await inv("C", InvoiceStatus.CANCELLED, "SALES", "7", "999.00");
  await inv("D", InvoiceStatus.DRAFT, "SALES", "3", "777.00");
  await inv("E", InvoiceStatus.CONFIRMED, "PURCHASE", "2", "555.00");

  ids.weaving = (await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-DO`, itemId: patos.id, executionKind: "SUBCONTRACTED", subcontractorId: dye.id }, select: { id: true } })).id;
  ids.dispatch = (await prisma.subcontractorDispatch.create({
    data: { dispatchNo: `${TAG}-DW`, weavingOrderId: ids.weaving, subcontractorId: dye.id, expectedReturnAt: new Date(now.getTime() - 2 * 86_400_000) },
    select: { id: true },
  })).id;

  const all = await snaps(now);
  const get = (n: string) => all.find((s) => s.projection === n)?.data as unknown;

  // fason-acik = kokpit özeti birebir
  const f = get(NAMES.fason) as { acikSevk: number; geciken: number; yaklasan: number; kalanMiktar: string; kirpildi: boolean; firmalar: Array<Record<string, unknown>> } | undefined;
  const k = await getSubcontractorCockpit({ limit: "1" }, now);
  const s = k.data!.summary;
  const firms = s.firms.map((x) => ({ fasonFirmaId: x.subcontractor.id, etiket: x.subcontractor.name, acikSevk: x.openDispatchCount, geciken: x.overdueCount, kalanMiktar: x.outstandingQty, iplikKg: x.yarnOutstandingKg, leventAdet: x.beamOutstandingCount }));
  check("§3a ⭐ fason-acik = kokpit özeti birebir (açık · geciken · yaklaşan · kalan · firma şeridi)",
    !!f && f.acikSevk === s.openDispatchCount && f.geciken === s.overdueCount && f.yaklasan === s.dueSoonCount && f.kalanMiktar === s.outstandingQty &&
    JSON.stringify(f.firmalar) === JSON.stringify(firms) && f.kirpildi === ((k.warnings?.length ?? 0) > 0), `${f?.acikSevk}/${s.openDispatchCount} · ${f?.geciken}/${s.overdueCount}`);
  const mine = f?.firmalar.find((x) => x.fasonFirmaId === dye.id);
  check("§3b körlük zemini: TAG dokuma sevki fason firma satırında, termini geçmiş → geciken ≥ 1", !!mine && Number(mine.acikSevk) >= 1 && Number(mine.geciken) >= 1 && f!.geciken >= 1, JSON.stringify(mine));

  // emanet-bakiye
  const e = get(NAMES.emanet) as { toplam: { topAdet: number; topMiktar: number; iplikKg: string | null; leventAdet: number | null }; cariler: Array<{ cariKartId: string; etiket: string; topAdet: number; topMiktar: number; iplikKg: string | null; leventAdet: number | null }> } | undefined;
  const cws = (await getConsignedWorkSummary()).data!;
  const row = e?.cariler.find((c) => c.cariKartId === ids.customer);
  const cwsRow = cws.rows.find((r) => r.ownerCustomerId === ids.customer);
  check("§3c ⭐ emanet-bakiye TAG müşteri: top = İçerideki İşler (2 top · 123,5 m), iplik lot defterinden 50 kg, levent 0 (devere açık)",
    !!row && !!cwsRow && row.topAdet === cwsRow.total.count && row.topMiktar === cwsRow.total.qty && row.topAdet === 2 && row.topMiktar === 123.5 &&
    row.iplikKg === "50.000" && row.leventAdet === 0 && row.etiket === `${TAG} Emanet Müşteri`, JSON.stringify(row));
  check("§3d emanet-bakiye toplam top = getConsignedWorkSummary toplamı", !!e && e.toplam.topAdet === cws.totals.total.count && e.toplam.topMiktar === cws.totals.total.qty,
    `${e?.toplam.topAdet}/${cws.totals.total.count}`);

  // hizmet-geliri: yalnız onaylı satış; USD 10 × 30,5 = 305 TL; A 100 TL → 405 TL, 15 m
  const g = get(NAMES.gelir) as Record<string, { toplamTl: string; kalemler: Array<{ hizmetId: string; miktar: string; tutarTl: string; birim: string }> }> | undefined;
  const line = g?.bugun?.kalemler.find((x) => x.hizmetId === ids.svc);
  check("§3e ⭐ hizmet-geliri bugün: yalnız ONAYLI SATIŞ (iptal/taslak/alış yok), döviz damgalı kurla TL → 15 m · 405,00 TL",
    !!line && line.miktar === "15.000" && line.tutarTl === "405.00" && line.birim === "m", JSON.stringify(line));
  const sum = g ? g.bugun!.kalemler.reduce((a, x) => a.plus(x.tutarTl), new Prisma.Decimal(0)).toFixed(2) : "";
  check("§3f dönem toplamı fabrikada = kalem toplamı; bu ay da TAG satırını taşır", !!g && g.bugun!.toplamTl === sum && !!g.buAy!.kalemler.find((x) => x.hizmetId === ids.svc), `${g?.bugun?.toplamTl}/${sum}`);

  // ozet.stok.emanet = karne emanet toplamı (F1 aynası)
  const o = get("ozet.stok") as { emanet?: { adet: number; miktar: number } } | undefined;
  const card = await getStockScorecard();
  const ct = card.summary.consigned ? consignedTotal(card.summary.consigned) : null;
  check("§3g ⭐ ozet.stok.emanet = stok karnesinin emanet toplamı (ham+yarı+bitmiş)", !!o?.emanet && !!ct && o.emanet.adet === ct.count && o.emanet.miktar === ct.qty && ct.count >= 2,
    `${JSON.stringify(o?.emanet)} / ${JSON.stringify(ct)}`);

  // Tel: yalnız izinli anahtarlar, katı şema yabancı alanı reddeder
  for (const n of Object.values(NAMES)) {
    const keys = [...new Set(dataKeys(get(n)))];
    check(`§3h ${n} teli yalnız izinli anahtarlar`, keys.length > 0 && keys.every((x) => ALLOWED[n]!.includes(x)), keys.filter((x) => !ALLOWED[n]!.includes(x)).join(",") || `${keys.length}`);
  }
  check("§3i katı şema satıra barkod eklenmesini reddeder", !SNAPSHOT_WIRE_SCHEMAS[NAMES.emanet]!.safeParse({ ...(e as object), cariler: [{ ...row, barkod: `${TAG}-R1` }] }).success);

  // Kapalı modüller
  await setFlag(SETTING_KEYS.EMANET_ENABLED, false);
  const off = await snaps(now, false);
  const offStock = off.find((x) => x.projection === "ozet.stok")?.data as { emanet?: unknown } | undefined;
  check("§3j ⭐ emanet KAPALI: emanet-bakiye üretilmez, ozet.stok'ta emanet alanı yok (bayt-eski)", !off.some((x) => x.projection === NAMES.emanet) && !!offStock && !("emanet" in offStock));
  check("§3k finans kapalı: hizmet-geliri üretilmez; fason-acik yine üretilir", !off.some((x) => x.projection === NAMES.gelir) && off.some((x) => x.projection === NAMES.fason));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== PATRON BULUTU FASON · EMANET BEKÇİSİ ===\n");
  katalog();
  statik();
  const flags: Flags = [];
  for (const key of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_ENABLED]) {
    flags.push({ key, foto: await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } }) });
  }
  const ids: Ids = { customer: "", svc: "", invoices: [], rolls: [], yarnItem: "", lot: "", weaving: "", dispatch: "" };
  try {
    await canli(ids);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    const q = async (p: Promise<unknown>) => { try { await p; } catch (e) { console.log(`⚠️ temizlik: ${e instanceof Error ? e.message : String(e)}`); } };
    if (ids.dispatch) await q(prisma.subcontractorDispatch.deleteMany({ where: { id: ids.dispatch } }));
    if (ids.weaving) await q(prisma.weavingOrder.deleteMany({ where: { id: ids.weaving } }));
    await q(prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: ids.invoices } } }));
    await q(prisma.invoice.deleteMany({ where: { id: { in: ids.invoices } } }));
    if (ids.svc) await q(prisma.serviceItem.deleteMany({ where: { id: ids.svc } }));
    if (ids.lot) {
      await q(prisma.yarnMovement.deleteMany({ where: { lotId: ids.lot } }));
      await q(prisma.yarnLot.deleteMany({ where: { id: ids.lot } }));
    }
    if (ids.yarnItem) {
      await q(prisma.yarnStock.deleteMany({ where: { itemId: ids.yarnItem } }));
      await q(prisma.item.deleteMany({ where: { id: ids.yarnItem } }));
    }
    await q(prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } }));
    if (ids.customer) {
      await q(prisma.cariAccount.deleteMany({ where: { customerId: ids.customer } }));
      await q(prisma.customer.deleteMany({ where: { id: ids.customer } }));
    }
    for (const { key, foto } of flags) {
      if (foto) await prisma.systemSetting.update({ where: { key }, data: { value: foto.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
