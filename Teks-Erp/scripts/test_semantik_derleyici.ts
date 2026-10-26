// =============================================================================
// SEMANTİK DERLEYİCİ — kimlik allowlist'i · izin/modül · parametreli değer · tavan + "Diğer"
// =============================================================================
// Raporlar v2 R1-SEMCEK (plan §3.1). Kullanıcı tanımından SQL üretilirken serbest metin SQL'e
// ASLA girmez: kimlikler yalnız sözlükte aranır (bilinmeyen → 400 `SEMANTIK_ALAN_BILINMIYOR`),
// izin/modül eksiği 403 `SEMANTIK_IZIN_YOK`, süzgeç değerleri yalnız bağlı parametredir.
// İlk küp `sevk` `_shipped.ts` boğazından okur — brüt toplam boğazla ve eski uçla
// (Yurtiçi/Yurtdışı Satış) EŞİT olmalı; toplam kırılım tavanından ÖNCE tam kümeden gelir.
//
// Fikstür (2096-03, başka bekçilerle çakışmaz): üç müşteri · iki yön · iade geri-eklemesi ·
// aralık dışı sevk. Brüt 240 = 100 + 50 + 30 + 20 + iade 40.
//
// NEGATİF SONDA (2026-10-24): derleyicide `compileQuery`in küp ve ölçü `canAccess` denetimi
// kaldırıldı → 3 ❌ (§2a küp 403 · §2b ölçü 403 · §2c modül 403); md5 ile birebir geri alındı. §6 (izin kodu devri): küp izni
// `report:salesX` yapıldı → yalnız §6a ❌; md5 ile geri alındı. §7 (R1-SEMKUP, 2026-10-25): derleyicide helperOnly
// boyut reddi kapatıldı → §7a ❌; `planlanan:` modül kapalı sayıldı → §7b ❌; ikisi de md5 ile geri alındı, 47/0.
//
// §8 (rapor küçükler, 2026-10-26): "veya" kökü, bir seviye iç grup (parantez), "arasında" (sıralı
// boyut, sondan başa sarma). NEGATİF SONDA: `suzgec-agaci.ts` `compileTreeSql` grup parantezi kaldırıldı → §8f ❌;
// `expandBetween` sınırları ters çevrildi → §8c + §8h ❌; md5 ile geri alındı.
//
// Koşum: npx tsx scripts/test_semantik_derleyici.ts
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import { AppError } from "../src/utils/app-error";
import { compileQuery, escapeLike, expandBetween, semanticQuerySchema, type SemanticQueryInput } from "../src/services/reports/semantik/derleyici";
import { runSemanticQuery, type RunDeps } from "../src/services/reports/semantik/calistirici";
import { PERMISSION_CATALOG, REPORT_PERMISSION_CODES } from "../src/constants/permission-catalog";
import { SEMANTIC_CUBES, buildCatalogTree, measureDictionaryEntry } from "../src/services/reports/semantik/katalog";
import { ResultCache } from "../src/services/reports/semantik/onbellek";
import { ReportSemaphore } from "../src/services/reports/semantik/semafor";
import type { AccessContext } from "../src/services/reports/semantik/izin";
import type { SemanticCube } from "../src/services/reports/semantik/tipler";
import { shipmentCube } from "../src/services/reports/semantik/kupler/sevk.kup";
import { shippedGrossTotal } from "../src/services/reports/_shipped";
import { getDestinationMix } from "../src/services/reports/destination-mix.report.service";
import { prepareCubes } from "../src/services/reports/semantik/calistirici";
import { isModuleOpen } from "../src/services/reports/semantik/izin";
import { helperOnlyDimension, hourDimension } from "../src/services/reports/semantik/boyutlar";
import { factoryHourSql } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const TAG = `TSD-${Date.now()}`;
const FROM = "2096-03-01T00:00:00.000Z";
const TO = "2096-03-31T20:59:59.999Z";
const ICERDE = new Date("2096-03-15T10:00:00.000Z");
const DISARDA = new Date("2096-06-15T10:00:00.000Z");

const ALL: AccessContext = { userId: "", permissions: ["*"], openModuleKeys: new Set() };
const q = (p: Partial<SemanticQueryInput> & Record<string, unknown>): SemanticQueryInput =>
  semanticQuerySchema.parse({ kup: "sevk", olculer: ["sevk.brutMetre"], dateFrom: FROM, dateTo: TO, ...p });

function errorOf(fn: () => unknown): { status: number; code?: string; alan?: string } | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) {
      const d = e.details as { code?: string; alan?: string } | undefined;
      return { status: e.statusCode, code: d?.code, alan: d?.alan };
    }
    return { status: 500 };
  }
}

const ids = { rolls: [] as string[], returns: [] as string[], shipments: [] as string[], items: [] as string[], customers: [] as string[], user: "" };

async function fixture(): Promise<{ c1: string; c2: string; c3: string }> {
  const user = await prisma.user.create({ data: { username: `${TAG}-u`.toLowerCase(), passwordHash: "x", fullName: `${TAG} kullanıcı` }, select: { id: true } });
  ids.user = user.id;
  const mkItem = async (k: string) => {
    const it = await prisma.item.create({ data: { code: `${TAG}-${k}`, name: `${TAG} ${k}`, itemType: "FABRIC" }, select: { id: true } });
    ids.items.push(it.id);
    return it.id;
  };
  const mkCustomer = async (k: string) => {
    const c = await prisma.customer.create({ data: { code: `${TAG}-${k}`, name: `${TAG} ${k}` }, select: { id: true } });
    ids.customers.push(c.id);
    return c.id;
  };
  const mkShipment = async (k: string, customerId: string, destination: "DOMESTIC" | "EXPORT", at: Date) => {
    const s = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-${k}`, customerId, destination, status: "DISPATCHED", dispatchedAt: at }, select: { id: true } });
    ids.shipments.push(s.id);
    return s.id;
  };
  const mkRoll = async (itemId: string, qty: number, shipmentId: string | null) => {
    const r = await prisma.roll.create({
      data: { itemId, initialQty: qty, currentQty: qty, status: shipmentId ? "SHIPPED" : "WAREHOUSE", entrySource: "SUPPLIER_RECEIPT", shipmentId, barcode: `${TAG}-R${ids.rolls.length}` },
      select: { id: true },
    });
    ids.rolls.push(r.id);
    return r.id;
  };
  const [i1, i2] = [await mkItem("I1"), await mkItem("I2")];
  const [c1, c2, c3] = [await mkCustomer("C1"), await mkCustomer("C2"), await mkCustomer("C3")];
  const s1 = await mkShipment("S1", c1, "DOMESTIC", ICERDE);
  const s2 = await mkShipment("S2", c2, "EXPORT", ICERDE);
  const s3 = await mkShipment("S3", c3, "DOMESTIC", ICERDE);
  const s4 = await mkShipment("S4", c1, "DOMESTIC", DISARDA);
  await mkRoll(i1, 100, s1);
  await mkRoll(i1, 50, s1);
  await mkRoll(i2, 30, s2);
  await mkRoll(i1, 20, s3);
  await mkRoll(i1, 999, s4);
  const returned = await mkRoll(i1, 40, null);
  const rr = await prisma.rollReturn.create({ data: { rollId: returned, customerId: c1, itemId: i1, qty: 40, receivedById: user.id, fromShipmentId: s1, createdAt: ICERDE }, select: { id: true } });
  ids.returns.push(rr.id);
  return { c1, c2, c3 };
}

function sectionCompile(): void {
  console.log("\n§1 kimlik allowlist'i (DB'siz)");
  const cases: Array<[string, Partial<SemanticQueryInput> & Record<string, unknown>, string]> = [
    ["bilinmeyen küp", { kup: "sevk2" }, "sevk2"],
    ["bilinmeyen ölçü", { olculer: ["sevk.yok"] }, "sevk.yok"],
    ["sözlükte var ama küpte yok ölçü", { olculer: ["siparis.metre"] }, "siparis.metre"],
    ["bilinmeyen boyut", { boyutlar: ["tezgah"] }, "tezgah"],
    ["bilinmeyen süzgeç alanı", { suzgec: [{ alan: "kisi", islec: "=", deger: "x" }] }, "kisi"],
    ["enjeksiyon kimlik (ölçü)", { olculer: ["sevk.brutMetre) FROM users; --"] }, "sevk.brutMetre) FROM users; --"],
    ["enjeksiyon kimlik (boyut)", { boyutlar: ["musteri\"; DROP TABLE customers; --"] }, "musteri\"; DROP TABLE customers; --"],
  ];
  for (const [label, p, alan] of cases) {
    const e = errorOf(() => compileQuery(q(p), ALL));
    check(`§1 ${label} → 400 SEMANTIK_ALAN_BILINMIYOR (adıyla)`, e?.status === 400 && e.code === "SEMANTIK_ALAN_BILINMIYOR" && e.alan === alan, JSON.stringify(e));
  }
  const helperDay = errorOf(() => compileQuery(q({ olculer: ["sevk.tutar"], boyutlar: ["gun"] }), ALL));
  check("§1 helper ölçünün beyan etmediği boyut → 400", helperDay?.status === 400 && helperDay.code === "SEMANTIK_ALAN_DESTEKLENMIYOR", JSON.stringify(helperDay));
  const helperMix = errorOf(() => compileQuery(q({ olculer: ["sevk.tutar", "sevk.brutMetre"] }), ALL));
  check("§1 helper ölçü başka ölçüyle → 400", helperMix?.status === 400 && helperMix.code === "SEMANTIK_OLCU_BIRLESMEZ");
  const badUuid = errorOf(() => compileQuery(q({ suzgec: [{ alan: "musteri", islec: "=", deger: "1 OR 1=1" }] }), ALL));
  check("§1 uuid boyutuna uuid olmayan değer → 400", badUuid?.status === 400 && badUuid.code === "SEMANTIK_SUZGEC_GECERSIZ");
  const strict = errorOf(() => semanticQuerySchema.parse({ kup: "sevk", olculer: ["sevk.brutMetre"], sql: "SELECT 1" }));
  check("§1 şemada tanımsız anahtar (`sql`) reddedilir (strict)", strict !== null);
}

function sectionAccess(): void {
  console.log("\n§2 izin ve modül");
  const noSales: AccessContext = { userId: "", permissions: ["report:production"], openModuleKeys: new Set() };
  const e1 = errorOf(() => compileQuery(q({}), noSales));
  check("§2a `report:sales` yok → küp 403 SEMANTIK_IZIN_YOK", e1?.status === 403 && e1.code === "SEMANTIK_IZIN_YOK" && e1.alan === "sevk", JSON.stringify(e1));
  // Ölçü düzeyi: küp açık, ölçü dar izinli (sentetik küp — gerçek kayıt değişmez).
  const narrow: SemanticCube = {
    ...shipmentCube,
    permission: "report:production",
    measures: shipmentCube.measures.map((m) => (m.id === "sevk.brutMetre" ? { ...m, permission: "report:finance" } : m)),
    dimensions: shipmentCube.dimensions.map((d) => (d.id === "renk" ? { ...d, permission: "report:finance" } : d)),
  };
  const e2 = errorOf(() => compileQuery(q({}), noSales, [narrow]));
  check("§2b ölçü izni yok → 403 (ölçü adıyla)", e2?.status === 403 && e2.alan === "sevk.brutMetre", JSON.stringify(e2));
  const moduled: SemanticCube = { ...shipmentCube, module: "productionEnabled" };
  const e3 = errorOf(() => compileQuery(q({}), ALL, [moduled]));
  check("§2c modül kapalı → 403", e3?.status === 403 && e3.code === "SEMANTIK_IZIN_YOK", JSON.stringify(e3));
  const opened: AccessContext = { ...ALL, openModuleKeys: new Set(["production.enabled"]) };
  check("§2c' modül açıkken aynı sorgu derlenir", errorOf(() => compileQuery(q({}), opened, [moduled])) === null);
  const prodOnly: AccessContext = { userId: "", permissions: ["report:production", "report:finance"], openModuleKeys: new Set() };
  const e4 = errorOf(() => compileQuery(q({ boyutlar: ["renk"] }), { ...prodOnly, permissions: ["report:production"] }, [{ ...narrow, measures: shipmentCube.measures.map((m) => ({ ...m, permission: "report:production" })) }]));
  check("§2d boyut izni yok → 403 (boyut adıyla)", e4?.status === 403 && e4.alan === "renk", JSON.stringify(e4));
  const tree = buildCatalogTree(noSales);
  const treeAll = buildCatalogTree(ALL);
  check("§2e izinsiz kullanıcının kataloğunda küp YOK (kapsam dışı dönmez)", tree.length === 0 && treeAll.some((c) => c.kimlik === "sevk"), `${tree.length}/${treeAll.length}`);
}

function sectionSqlText(): void {
  console.log("\n§3 değer yalnız parametre");
  const evil = "x'; DROP TABLE customers; --";
  const c = compileQuery(q({ boyutlar: ["musteri"], suzgec: [{ alan: "musteri", islec: "contains", deger: evil }] }), ALL);
  const sql = c.sql!;
  check("§3a enjeksiyon dizesi SQL METNİNDE yok", !sql.sql.includes("DROP TABLE") && !sql.sql.includes(evil));
  check("§3b enjeksiyon dizesi bağlı PARAMETREDE (kaçışlı desen)", sql.values.some((v) => typeof v === "string" && v.includes("DROP TABLE")));
  check("§3c `contains` kaçışı: % _ \\ düz metin", escapeLike("a%_\\b") === "a\\%\\_\\\\b" && sql.sql.includes("ESCAPE '\\'"), escapeLike("a%_\\b"));
  const emptyIn = compileQuery(q({ suzgec: [{ alan: "musteri", islec: "in", deger: [] as unknown as string }] }), ALL).sql!;
  const emptyNotIn = compileQuery(q({ suzgec: [{ alan: "musteri", islec: "notIn", deger: [] as unknown as string }] }), ALL).sql!;
  check("§3d boş `in` listesi `IN ()` üretmez (FALSE)", !/IN\s*\(\s*\)/.test(emptyIn.sql) && emptyIn.sql.includes("FALSE"));
  check("§3e boş `notIn` listesi `NOT IN ()` üretmez (TRUE)", !/IN\s*\(\s*\)/.test(emptyNotIn.sql) && !emptyNotIn.sql.includes("NOT IN"));
  const tz = compileQuery(q({ boyutlar: ["hafta"] }), ALL).sql!.sql;
  // Regex derlenmiş SQL METNİNİ okur (dilimli ifade arıyor) — SQL üretmez.
  // eslint-disable-next-line no-restricted-syntax
  check("§3f hafta boyutu `factoryWeekSql`ten (dilimli; çıplak DATE_TRUNC yok)", /DATE_TRUNC\('week', .*AT TIME ZONE/.test(tz));
}

function sectionRegistry(): void {
  console.log("\n§4 küp kaydı");
  const issues: string[] = [];
  for (const cube of SEMANTIC_CUBES) {
    for (const m of cube.measures) {
      if (!measureDictionaryEntry(m.id)) issues.push(`${m.id}: sözlükte yok`);
      if (!("exempt" in m.parity) && !m.parity.report) issues.push(`${m.id}: eşitlik hedefi boş`);
      if ("exempt" in m.parity && m.parity.exempt.trim().length < 10) issues.push(`${m.id}: muafiyet gerekçesiz`);
      if (m.kind === "sum" && !m.sql) issues.push(`${m.id}: sql yok`);
      if (m.kind === "helper") for (const d of m.helper!.dimensions) if (!cube.dimensions.some((x) => x.id === d)) issues.push(`${m.id}: helper boyutu ${d} küpte yok`);
    }
  }
  check("§4 her ölçü sözlükte, eşitlik hedefli ya da gerekçeli muaf; helper boyutları küpte", issues.length === 0, issues.join(" · "));
}

async function sectionDb(f: { c1: string; c2: string; c3: string }): Promise<void> {
  console.log("\n§5 DB — brüt eşitliği, tavan + Diğer, kapsam");
  const ctx: AccessContext = { ...ALL, userId: ids.user };
  const deps: RunDeps = { cubes: SEMANTIC_CUBES, semaphore: new ReportSemaphore(), cache: new ResultCache(), readTimeoutSec: async () => 15 };
  const run = (p: Partial<SemanticQueryInput> & Record<string, unknown>) => runSemanticQuery(q(p), ctx, undefined, deps);
  const range = { from: new Date(FROM), to: new Date(TO) };

  const total = await run({});
  const gross = await shippedGrossTotal(range);
  const mix = await getDestinationMix(range, null);
  const legacy = mix.buckets.reduce((a, b) => a + b.meters, 0);
  check("§5a ⭐ brüt toplam = `_shipped` boğazı (240, iade geri-eklemesi dahil)", total.toplam.degerler["sevk.brutMetre"] === gross && Math.abs(gross - 240) < 1e-9, `${total.toplam.degerler["sevk.brutMetre"]} / ${gross}`);
  check("§5b ⭐ brüt toplam = eski uç (Yurtiçi/Yurtdışı Satış kovaları)", Math.abs((total.toplam.degerler["sevk.brutMetre"] ?? -1) - legacy) < 0.05, `eski ${legacy}`);

  const capped = await run({ boyutlar: ["musteri"], tavan: 2 });
  const other = capped.satirlar.find((r) => r.anahtarlar.musteri!.diger);
  const named = capped.satirlar.filter((r) => !r.anahtarlar.musteri!.diger);
  const rowSum = capped.satirlar.reduce((a, r) => a + (r.degerler["sevk.brutMetre"] ?? 0), 0);
  check("§5c tavan 2 → iki adlı satır + 'Diğer' (en küçük müşteri)", named.length === 2 && other?.degerler["sevk.brutMetre"] === 20 && other.anahtarlar.musteri!.etiket === "Diğer", JSON.stringify(capped.satirlar.map((r) => [r.anahtarlar.musteri!.etiket, r.degerler["sevk.brutMetre"]])));
  check("§5d toplam tavandan ÖNCE tam kümeden (satırlar + Diğer = toplam = 240)", rowSum === 240 && capped.toplam.degerler["sevk.brutMetre"] === 240 && capped.uyarilar.length > 0);

  const scoped = await run({ boyutlar: ["musteri"], suzgec: [{ alan: "musteri", islec: "in", deger: [f.c1] }] });
  check("§5e kapsam: `in [C1]` süzgecinde başka müşteri satırı DÖNMEZ (190)", scoped.satirlar.length === 1 && scoped.satirlar[0]!.anahtarlar.musteri!.deger === f.c1 && scoped.toplam.degerler["sevk.brutMetre"] === 190);
  const notIn = await run({ suzgec: [{ alan: "musteri", islec: "notIn", deger: [f.c1, f.c2] }] });
  check("§5f `notIn [C1,C2]` → yalnız C3 (20)", notIn.toplam.degerler["sevk.brutMetre"] === 20);
  const emptyIn = await run({ suzgec: [{ alan: "musteri", islec: "in", deger: [] }] });
  check("§5g boş `in` → 0 (hiçbir satır)", emptyIn.toplam.degerler["sevk.brutMetre"] === 0);
  const like = await run({ suzgec: [{ alan: "musteri", islec: "contains", deger: `${TAG} C` }] });
  const pct = await run({ suzgec: [{ alan: "musteri", islec: "contains", deger: "%" }] });
  check("§5h `contains` adı bulur; `%` desen değil düz metin (0)", like.toplam.degerler["sevk.brutMetre"] === 240 && pct.toplam.degerler["sevk.brutMetre"] === 0, `${like.toplam.degerler["sevk.brutMetre"]} / ${pct.toplam.degerler["sevk.brutMetre"]}`);
  const evil = await run({ suzgec: [{ alan: "musteri", islec: "contains", deger: "x'); DROP TABLE customers; --" }] });
  const still = await prisma.customer.count({ where: { id: { in: [f.c1, f.c2, f.c3] } } });
  check("§5i enjeksiyon değeri sorguya girmez (0 satır, tablo yerinde)", evil.toplam.degerler["sevk.brutMetre"] === 0 && still === 3);
  const exp = await run({ boyutlar: ["yon"], suzgec: [{ alan: "yon", islec: "=", deger: "EXPORT" }] });
  const expBucket = mix.buckets.find((b) => b.bucket === "EXPORT")!.meters;
  check("§5j yön süzgeci = eski uç EXPORT kovası (30)", exp.toplam.degerler["sevk.brutMetre"] === expBucket && expBucket === 30, `${exp.toplam.degerler["sevk.brutMetre"]}`);
  const byMonth = await run({ boyutlar: ["ay"] });
  check("§5k ay boyutu fabrika ayı anahtarı (2096-03-01)", byMonth.satirlar.length === 1 && byMonth.satirlar[0]!.anahtarlar.ay!.deger === "2096-03-01", JSON.stringify(byMonth.satirlar.map((r) => r.anahtarlar.ay)));
  const periods = await run({ donemler: { birim: "ay", adet: 4 }, dateFrom: undefined, dateTo: "2096-06-20T10:00:00.000Z" });
  const per = Object.fromEntries((periods.toplam.donemler ?? []).map((d) => [d.donem, d.degerler["sevk.brutMetre"]]));
  check("§5l çok dönem (4 ay) tek sorguda dönem anahtarıyla: mart 240 · haziran 999", per["2096-03-01"] === 240 && per["2096-06-01"] === 999 && periods.aralik.dateFrom.startsWith("2096-02-29"), JSON.stringify(per) + " " + periods.aralik.dateFrom);
  const cmp = await run({ compare: "prev" });
  check("§5m kıyas `resolveCompareRange`ten (önceki dönem toplamı 0)", cmp.kiyas?.toplam.degerler["sevk.brutMetre"] === 0);
  const money = await run({ olculer: ["sevk.tutar"], boyutlar: ["musteri"] });
  check("§5n tutar helper ölçüsü koşar (fiyatsız fikstür → para birimi yok, 0 uydurulmaz)", Array.isArray(money.toplam.paraBirimleri) && money.toplam.paraBirimleri.length === 0);
  const runs = await prisma.reportRun.count({ where: { userId: ids.user, status: "TAMAM" } });
  check("§5o her koşu `ReportRun` TAMAM satırı bıraktı", runs >= 12, `${runs}`);
  void Prisma;
}

/** §6 izin kodları katalogda — `test_permission_catalog` dinamik kaynak devri buraya (küp/ölçü/boyut + uç kapısı). */
function sectionPermissionCodes(): void {
  const known = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));
  const used: string[] = [];
  for (const c of SEMANTIC_CUBES) {
    used.push(c.permission);
    for (const m of c.measures) if (m.permission !== undefined) used.push(m.permission);
    for (const d of c.dimensions) if (d.permission !== undefined) used.push(d.permission);
  }
  const unknown = [...new Set(used)].filter((code) => !known.has(code));
  check("§6a küp/ölçü/boyut izin kodlarının hepsi PERMISSION_CATALOG'da", used.length > 0 && unknown.length === 0, unknown.join(", ") || `${used.length} kullanım`);
  const badGate = REPORT_PERMISSION_CODES.filter((code) => !known.has(code) || !code.startsWith("report:"));
  check("§6b uç kapısı REPORT_PERMISSION_CODES boş değil ve yalnız katalogdaki report:* kodları", REPORT_PERMISSION_CODES.length > 0 && badGate.length === 0, badGate.join(", ") || `${REPORT_PERMISSION_CODES.length} kod`);
}

/** R1-SEMKUP çekirdek uzantıları: helperOnly boyut · `planlanan:` modül · prepare kancası · yüzde oran · fabrika saati. */
async function sectionCoreExtensions(f: { c1: string }): Promise<void> {
  console.log("\n§7 çekirdek uzantılar (R1-SEMKUP)");
  const hx = helperOnlyDimension("hx", "Yalnız helper", "uuid");
  const withHelperDim: SemanticCube = { ...shipmentCube, dimensions: [...shipmentCube.dimensions, hx] };
  const dimErr = errorOf(() => compileQuery(q({ boyutlar: ["hx"] }), ALL, [withHelperDim]));
  const filterErr = errorOf(() => compileQuery(q({ suzgec: [{ alan: "hx", islec: "=", deger: f.c1 }] }), ALL, [withHelperDim]));
  check("§7a helperOnly boyut SQL ölçüde (boyut ve süzgeç) → 400", dimErr?.status === 400 && filterErr?.status === 400, `${JSON.stringify(dimErr)} · ${JSON.stringify(filterErr)}`);
  const none: AccessContext = { userId: "", permissions: ["*"], openModuleKeys: new Set() };
  check("§7b `planlanan:` modül açık; tanınmayan modül anahtarı kapalı (fail-closed)", isModuleOpen("planlanan:fason", none) && !isModuleOpen("yokEnabled", none) && !isModuleOpen("financeEnabled", none));

  let prepared = 0;
  const other: SemanticCube = { ...shipmentCube, id: "baska", prepare: async () => { prepared += 100; return other; } };
  const target: SemanticCube = { ...shipmentCube, prepare: async () => { prepared += 1; return { ...shipmentCube, name: "hazırlandı" }; } };
  const out = await prepareCubes([target, other], "sevk");
  check("§7c prepareCubes yalnız istenen küpü hazırlar ve yerine koyar", prepared === 1 && out[0]!.name === "hazırlandı" && out[1] === other, `çağrı ${prepared}`);

  // Yüzde oran: pay/payda kümeden YENİDEN, ×100; payda 0 → null (K-KUP).
  const ratioCube: SemanticCube = {
    ...shipmentCube,
    measures: [
      { id: "kalite.birinciMetre", permission: "report:sales", module: shipmentCube.module, kind: "sum", sql: Prisma.sql`SUM(p.qty) FILTER (WHERE p."customerId" = ${f.c1}::uuid)`, parity: { exempt: "bekçi içi sentetik küp — sayı eşitliği yok" } },
      { id: "kalite.bitenMetre", permission: "report:sales", module: shipmentCube.module, kind: "sum", sql: Prisma.sql`SUM(p.qty)`, parity: { exempt: "bekçi içi sentetik küp — sayı eşitliği yok" } },
      { id: "kalite.birinciYuzde", permission: "report:sales", module: shipmentCube.module, kind: "ratio", numerator: "kalite.birinciMetre", denominator: "kalite.bitenMetre", percent: true, parity: { exempt: "bekçi içi sentetik küp — sayı eşitliği yok" } },
    ],
  };
  const deps: RunDeps = { cubes: [ratioCube], semaphore: new ReportSemaphore(), cache: new ResultCache(), readTimeoutSec: async () => 15 };
  const ctx: AccessContext = { ...ALL, userId: ids.user };
  const rq = (p: Record<string, unknown>) => runSemanticQuery(q({ olculer: ["kalite.birinciMetre", "kalite.bitenMetre", "kalite.birinciYuzde"], ...p }), ctx, undefined, deps);
  const r = await rq({});
  const [num, den, pct] = ["kalite.birinciMetre", "kalite.bitenMetre", "kalite.birinciYuzde"].map((k) => r.toplam.degerler[k] ?? null);
  check("§7d yüzde oran = 100 × pay / payda (kümelenmiş, ortalanmamış)", num !== null && den !== null && den > 0 && pct !== null && Math.abs(pct - (100 * num) / den) < 1e-9, `${num}/${den} → ${pct}`);
  const empty = await rq({ suzgec: [{ alan: "musteri", islec: "=", deger: "00000000-0000-4000-8000-000000000000" }] });
  check("§7e boş paydada oran null (0'a çökmez)", empty.toplam.degerler["kalite.birinciYuzde"] === null, JSON.stringify(empty.toplam.degerler));

  const hourText = factoryHourSql("x.t").sql;
  const [h] = await prisma.$queryRaw<Array<{ h: number }>>(Prisma.sql`SELECT ${factoryHourSql("x.t")} AS h FROM (SELECT ${new Date("2096-03-15T21:30:00.000Z")}::timestamptz AS t) x`);
  check("§7f factoryHourSql fabrika saatini verir (21:30Z → İstanbul 00)", /EXTRACT\(HOUR/.test(hourText) && h?.h === 0, `${hourText} → ${h?.h}`);
}

/** §8 süzgeç ağacı: "veya" · iç grup parantezi · "arasında". */
async function sectionFilterTree(f: { c1: string; c2: string; c3: string }): Promise<void> {
  console.log("\n§8 süzgeç ağacı — veya · iç grup · arasında");
  const parse = (p: Record<string, unknown>) => semanticQuerySchema.safeParse({ kup: "sevk", olculer: ["sevk.brutMetre"], ...p });
  const deep = parse({ suzgec: [{ baglac: "ve", kurallar: [{ baglac: "veya", kurallar: [{ alan: "yon", islec: "=", deger: "EXPORT" }] }] }] });
  const many = parse({ suzgec: [{ baglac: "veya", kurallar: Array.from({ length: 6 }, () => ({ alan: "yon", islec: "=", deger: "EXPORT" })) }, ...Array.from({ length: 5 }, () => ({ alan: "yon", islec: "=", deger: "EXPORT" }))] });
  check("§8a grup içinde grup ve 10'dan fazla koşul şemada reddedilir (bir seviye iç grup)", !deep.success && !many.success);
  const orSql = compileQuery(q({ suzgecBaglaci: "veya", suzgec: [{ alan: "yon", islec: "=", deger: "EXPORT" }, { alan: "musteri", islec: "=", deger: f.c3 }] }), ALL).sql!.sql;
  check("§8b kök 'veya' WHERE'de parantezli OR üretir", /WHERE \(.+ OR .+\)/.test(orSql));
  const hour = hourDimension("p.at");
  check(
    "§8c 'arasında' sıralı listede açılır; baş > son sondan başa sarar (22–2)",
    JSON.stringify(expandBetween(hour, "8", "10")) === JSON.stringify(["8", "9", "10"]) && JSON.stringify(expandBetween(hour, "22", "2")) === JSON.stringify(["22", "23", "0", "1", "2"]),
    `${expandBetween(hour, "8", "10").join(",")} · ${expandBetween(hour, "22", "2").join(",")}`,
  );
  const notOrdered = errorOf(() => compileQuery(q({ suzgec: [{ alan: "musteri", islec: "between", deger: [f.c1, f.c2] }] }), ALL));
  const withHour: SemanticCube = { ...shipmentCube, dimensions: [...shipmentCube.dimensions, hour] };
  const oneBound = errorOf(() => compileQuery(q({ suzgec: [{ alan: "saat", islec: "between", deger: ["8"] }] }), ALL, [withHour]));
  const badBound = errorOf(() => compileQuery(q({ suzgec: [{ alan: "saat", islec: "between", deger: ["8", "24"] }] }), ALL, [withHour]));
  check("§8d 'arasında' sırasız boyutta, tek sınırda, liste dışı sınırda 400", notOrdered?.status === 400 && oneBound?.status === 400 && badBound?.status === 400, JSON.stringify([notOrdered, oneBound, badBound]));
  const helperOr = errorOf(() => compileQuery(q({ olculer: ["sevk.tutar"], suzgecBaglaci: "veya", suzgec: [{ alan: "yon", islec: "=", deger: "EXPORT" }, { alan: "musteri", islec: "=", deger: f.c3 }] }), ALL));
  const helperAnd = errorOf(() => compileQuery(q({ olculer: ["sevk.tutar"], suzgec: [{ baglac: "ve", kurallar: [{ alan: "yon", islec: "=", deger: "EXPORT" }] }] }), ALL));
  check("§8e bellek-içi (helper) ölçüde 'veya' 400 (sessiz düşürme yok); 've' grubu geçer", helperOr?.status === 400 && helperAnd === null, `${JSON.stringify(helperOr)} · ${JSON.stringify(helperAnd)}`);

  const ctx: AccessContext = { ...ALL, userId: ids.user };
  const deps: RunDeps = { cubes: [withHour], semaphore: new ReportSemaphore(), cache: new ResultCache(), readTimeoutSec: async () => 15 };
  const run = async (p: Record<string, unknown>) => (await runSemanticQuery(q(p), ctx, undefined, deps)).toplam.degerler["sevk.brutMetre"];
  // C1 yurtiçi 190 (iade dahil) · C2 yurtdışı 30 · C3 yurtiçi 20. Parantezsiz `C1,C2 AND EXPORT OR C3` 50 verirdi.
  const nested = await run({ suzgec: [{ alan: "musteri", islec: "in", deger: [f.c1, f.c2] }, { baglac: "veya", kurallar: [{ alan: "yon", islec: "=", deger: "EXPORT" }, { alan: "musteri", islec: "=", deger: f.c3 }] }] });
  check("§8f ⭐ iç grup parantezi: (C1 ∨ C2) ∧ (yurtdışı ∨ C3) = 30", nested === 30, String(nested));
  const orTop = await run({ suzgecBaglaci: "veya", suzgec: [{ alan: "musteri", islec: "=", deger: f.c3 }, { baglac: "ve", kurallar: [{ alan: "yon", islec: "=", deger: "EXPORT" }, { alan: "musteri", islec: "=", deger: f.c2 }] }] });
  check("§8g kök 'veya': C3 ∨ (yurtdışı ∧ C2) = 50", orTop === 50, String(orTop));
  // Fikstür sevkleri 10:00Z = fabrika saati 13.
  const around = await run({ suzgec: [{ alan: "saat", islec: "between", deger: ["12", "14"] }] });
  const wrapped = await run({ suzgec: [{ alan: "saat", islec: "between", deger: ["14", "12"] }] });
  check("§8h ⭐ 'arasında' 12–14 → 240; ters sınır 14–12 (gece sarması) 13'ü dışlar → 0", around === 240 && wrapped === 0, `${around} / ${wrapped}`);
}

async function main(): Promise<void> {
  console.log("\n=== Semantik derleyici ===");
  sectionCompile();
  sectionAccess();
  sectionSqlText();
  sectionRegistry();
  sectionPermissionCodes();
  const f = await fixture();
  await sectionDb(f);
  await sectionCoreExtensions(f);
  await sectionFilterTree(f);
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    if (ids.user) await prisma.reportRun.deleteMany({ where: { userId: ids.user } });
    if (ids.returns.length) await prisma.rollReturn.deleteMany({ where: { id: { in: ids.returns } } });
    if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.shipments.length) await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
    if (ids.customers.length) await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
    if (ids.items.length) await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
