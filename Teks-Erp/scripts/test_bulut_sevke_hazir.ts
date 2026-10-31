// =============================================================================
// BEKÇİ — PATRON BULUTU İŞ EMRİ SEVKE HAZIRLIĞI (D4-J5; tasarım DALGA4 §11.8 + §13 D4-J5)
// =============================================================================
//   §1 katalog — `is-emri.sevkeHazir` türetilmiş alanı `rolls`u okur, kök (İŞLEM) satırda, zamana bağlı değil;
//      `rolls` kaynağının kök eşlemesi topu PARTİSİNİN iş emrine de götürür (adımı olmayan top dahil)
//   §2 ⭐ statik "bulut türetmez" — türetici yüklemi kopyalamaz (ship-readiness.helper + computeReadyWorks
//      çağırır, durum kümesi tanımlamaz); patron/sunucu `src/`inde hazırlık alanına dokunan TEK dosya tel
//      sözleşmesi (`wire/api.ts`); uygulamada alanı yalnız `src/lib/ship-readiness.ts` okur ve orada
//      sayı karşılaştırması / aritmetik yok (görünüm yalnız etiketler)
//   §3 ⭐ canlı — 2 hazır + 1 işlemde top → KISMEN (hazirTop 2, hazirMetre = panel listesiyle aynı);
//      işlemdeki top depoya inince HAZIR; topu olmayan iş emrinde alan VAR ve null
//   §4 ⭐ (D4-MIG6) shipping.ready kural/tolerans yazımı canlı iş emrini `sync_marks` KIRLI yapar; aynı
//      politika yeniden yazılınca işaret yok. Parti/top tetikleyicileri: `test_bulut_silme_damgasi` §4f–h.
//      NEGATİF SONDA: ayar yolundaki `markReadyWorkOrdersDirty` çağrısı kaldırılınca §4a/§4d ❌.
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31): patron/sunucu/src/services/ altına `sevkeHazir` hesaplayan
//    yardımcı eklendi → §2b ❌ (exit 1); uygulama görünümüne `o.hazirTop > 0` yüklemi eklendi → §2c ❌;
//    geri alındı → yeşil.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar fotoğrafa döner.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";
import { SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { RECORD_PROJECTIONS } from "../src/cloud-sync/projections";
import { buildRecords } from "../src/cloud-sync/record-builder";
import { mapToRoots } from "../src/cloud-sync/change-scan";
import { listReadyWorks } from "../src/services/ready-works.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const TAG = `TEST-BSH-${process.pid}`;
const ROOT = path.resolve(__dirname, "../..");
const DERIVER = path.resolve(__dirname, "../src/cloud-sync/derived-ship-ready.ts");
const CLOUD_SRC = path.join(ROOT, "patron/sunucu/src");
const APP_DIRS = [path.join(ROOT, "patron/uygulama/src"), path.join(ROOT, "patron/uygulama/app")];
const APP_VIEW = path.join(ROOT, "patron/uygulama/src/lib/ship-readiness.ts");
const AYARLAR = [SETTING_KEYS.SHIPPING_READY_RULE, SETTING_KEYS.SHIPPING_READY_TOLERANCE_PCT];
const FIELD_RE = /\b(sevkeHazir|hazirTop|hazirMetre|SHIP_READINESS_LABELS|WorkOrderShipReadiness)\b/;

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

const ARITH_OPS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
]);
const NUMERIC_CALLS = new Set(["Number", "parseFloat", "parseInt", "Math"]);

/** Görünüm dosyasında sayı karşılaştırması / aritmetik / sayıya çevirme (AST; yorum ve metin sayılmaz). */
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
  const p = RECORD_PROJECTIONS.find((x) => x.name === "is-emri");
  const d = p?.derived.find((x) => x.wire === "sevkeHazir");
  check("§1a ⭐ is-emri.sevkeHazir rolls'u okur, kök (İŞLEM) satırda, zamana bağlı değil", !!d && d.reads.includes("rolls") && d.dataClass === "ISLEM" && !d.timeBound);
}

function statik(): void {
  console.log("── §2 Statik (bulut türetmez) ──");
  const s = readFileSync(DERIVER, "utf8");
  check("§2a ⭐ türetici tek kaynağı çağırır, durum kümesi tanımlamaz",
    s.includes("effectiveShipReadyPolicy(") && s.includes("computeReadyWorks(") && !/RollStatus|WAREHOUSE|IN_PRODUCTION|classifyShipReadiness/.test(s));
  const cloud = walk(CLOUD_SRC).filter((f) => FIELD_RE.test(readFileSync(f, "utf8")));
  const cloudExtra = cloud.map((f) => path.relative(ROOT, f)).filter((f) => f !== "patron/sunucu/src/wire/api.ts");
  check("§2b ⭐ patron/sunucu hazırlık alanına yalnız tel sözleşmesinde dokunur (hesap/süzme yok)", cloudExtra.length === 0, cloudExtra.join(", ") || "temiz");
  const app = APP_DIRS.flatMap(walk).filter((f) => /\bsevkeHazir\b|\bhazir(Top|Metre)\b/.test(readFileSync(f, "utf8")));
  // Tel aynası (bayt-eşit kopya) tip/etiket taşır; görünüm dışında alanı okuyan dosya yok.
  const allowed = new Set([path.relative(ROOT, APP_VIEW), "patron/uygulama/src/api/wire.ts"]);
  const appExtra = app.map((f) => path.relative(ROOT, f)).filter((f) => !allowed.has(f));
  const arith = arithmeticIn(readFileSync(APP_VIEW, "utf8"));
  check("§2c ⭐ uygulamada alanı yalnız görünüm okur; görünümde sayı karşılaştırması/aritmetik yok", appExtra.length === 0 && arith.length === 0, [...appExtra, ...arith].join(", ") || "temiz");
}

async function telSatiri(woId: string): Promise<Record<string, unknown> | undefined> {
  const p = RECORD_PROJECTIONS.find((x) => x.name === "is-emri")!;
  const built = await buildRecords(p, [woId], Date.now());
  for (const [, rows] of built.rows) for (const r of rows) if (r.id === woId && "isEmriNo" in r) return r as Record<string, unknown>;
  return undefined;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== PATRON BULUTU SEVKE HAZIRLIK BEKÇİSİ ===\n");
  katalog();
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const ids = { item: "", wo: "", woEmpty: "", batch: "", rolls: [] as string[] };
  try {
    await prisma.systemSetting.deleteMany({ where: { key: { in: AYARLAR } } });
    ids.item = (await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} Kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
    ids.wo = (await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, type: "STOCK_PRODUCTION", targetItemId: ids.item, targetQuantity: 300 }, select: { id: true } })).id;
    ids.woEmpty = (await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO0`, type: "STOCK_PRODUCTION", targetItemId: ids.item, targetQuantity: 100 }, select: { id: true } })).id;
    ids.batch = (await prisma.batch.create({ data: { batchNumber: `${TAG}-B1`, workOrderId: ids.wo }, select: { id: true } })).id;
    let seq = 0;
    const mk = async (status: RollStatus, qty: number): Promise<string> => {
      const r = await prisma.roll.create({
        data: { barcode: `${TAG}-R${++seq}`, itemId: ids.item, batchId: ids.batch, status, initialQty: qty, currentQty: qty, entrySource: "SEMI_FINISHED" },
        select: { id: true },
      });
      ids.rolls.push(r.id);
      return r.id;
    };
    await mk(RollStatus.WAREHOUSE, 100.5);
    await mk(RollStatus.WAREHOUSE, 99.25);
    const open = await mk(RollStatus.IN_PRODUCTION, 80);

    console.log("\n── §1 Kök eşleme ──");
    const src = RECORD_PROJECTIONS.find((x) => x.name === "is-emri")!.sources.find((s) => s.table === "rolls")!;
    const roots = await mapToRoots(src.root, [open]);
    check("§1b ⭐ adımsız top değişimi partisinin iş emrini kirletir", roots.includes(ids.wo), JSON.stringify(roots));

    console.log("\n── §3 Canlı ──");
    const t1 = (await telSatiri(ids.wo))?.sevkeHazir as Record<string, unknown> | null | undefined;
    const panel = (await listReadyWorks({ groupBy: "workOrder" })).data.items.find((r) => r.id === ids.wo);
    check("§3a ⭐ 2 hazır + 1 işlemde → KISMEN, hazirTop 2",
      t1?.durum === "KISMEN" && t1.hazirTop === 2, JSON.stringify(t1));
    check("§3b ⭐ hazirMetre panel listesiyle aynı sayı (199.75)",
      !!panel && panel.state === "PARTIAL" && t1?.hazirMetre != null && new Prisma.Decimal(String(t1.hazirMetre)).eq(panel.readyMeters) && panel.readyMeters === 199.75,
      `${String(t1?.hazirMetre)} / ${panel?.readyMeters}`);
    const tel = JSON.stringify(t1);
    check("§3c tel alanı yalnız durum + hazır top/metre taşır", Object.keys(t1 ?? {}).sort().join(",") === "durum,hazirMetre,hazirTop", tel);
    await prisma.roll.update({ where: { id: open }, data: { status: RollStatus.WAREHOUSE } });
    const t2 = (await telSatiri(ids.wo))?.sevkeHazir as Record<string, unknown> | null | undefined;
    check("§3d işlemdeki top depoya inince HAZIR, hazirTop 3", t2?.durum === "HAZIR" && t2.hazirTop === 3, JSON.stringify(t2));
    const row0 = await telSatiri(ids.woEmpty);
    check("§3e topu olmayan iş emrinde alan VAR ve null", !!row0 && "sevkeHazir" in row0 && row0.sevkeHazir === null, JSON.stringify(row0?.sevkeHazir));

    console.log("\n── §4 Politika yazımı kirletir (D4-MIG6) ──");
    const actor = await testActorId();
    const marks = async (since: Date, woId: string) =>
      prisma.syncMark.count({ where: { tableName: "work_orders", rowId: woId, kind: "DIRTY", createdAt: { gte: since } } });
    const t4 = new Date();
    await systemSettingService.setFeatureFlags({ shippingReadyRule: "METER_THRESHOLD", shippingReadyTolerancePct: 5 }, actor);
    check("§4a ⭐ shipping.ready kuralı değişince canlı iş emri KIRLI", (await marks(t4, ids.wo)) === 1, String(await marks(t4, ids.wo)));
    check("§4b topu olmayan iş emri işaretlenmez (alan null kalır)", (await marks(t4, ids.woEmpty)) === 0);
    const t4c = new Date();
    await systemSettingService.setFeatureFlags({ shippingReadyRule: "METER_THRESHOLD", shippingReadyTolerancePct: 5 }, actor);
    check("§4c aynı politika yeniden yazılınca işaret YOK (değişim ölçülür)", (await marks(t4c, ids.wo)) === 0);
    const t4d = new Date();
    await systemSettingService.setFeatureFlags({ shippingReadyTolerancePct: 7 }, actor);
    check("§4d ⭐ yalnız tolerans değişimi de kirletir", (await marks(t4d, ids.wo)) === 1);
    await prisma.syncMark.deleteMany({ where: { rowId: { in: [ids.wo, ids.woEmpty] }, createdAt: { gte: t4 } } });
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.batch) await prisma.batch.deleteMany({ where: { id: ids.batch } });
    await prisma.workOrder.deleteMany({ where: { id: { in: [ids.wo, ids.woEmpty].filter(Boolean) } } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } });
    await prisma.systemSetting.deleteMany({ where: { key: { in: AYARLAR } } });
    for (const f of foto) await prisma.systemSetting.create({ data: { key: f.key, value: f.value as Prisma.InputJsonValue } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
