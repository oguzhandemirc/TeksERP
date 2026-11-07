// =============================================================================
// MÜLKİYET KAPSAMI BEKÇİSİ — bizim stok ↔ emanet (genel fason F1, 2026-11-08)
// =============================================================================
// Koşum: npx tsx scripts/test_mulkiyet_kapsami.ts   (DB'li; TEST-MK fikstürü; emanet bayrağı fotoğrafa döner)
//
// Ölçer:
//   §0 AST — yüzeyler (envanter şeridi, Stok & Ölü Stok, kalem raporu, üretim bakiyesi) helper'dan okur;
//      `src`de helper DIŞINDA yeni `ownerCustomerId` null yüklemi yok (eski yerler gerekçeli muaf, iki yönlü)
//   §1 boğaz-ikiz — bellek `isConsignedRoll` · Prisma `CONSIGNED_WHERE`/`OWN_STOCK_WHERE` · SQL `consignedRollSql`
//      fikstürde AYNI kümeyi verir; OWN ∪ CONSIGNED = hepsi, kesişim boş
//   §2 `filter[mulkiyet]` — boş/ALL bugünkü sonuç (bayt-aynı), OWN emanet içermez, tanınmayan değer 400
//   §3 `/rolls/stats` — emanet KAPALI: `consigned` alanı YOK; AÇIK: bizim + emanet = toplam, kırılım CONSIGNED şeridine eşit
//   §4 Stok & Ölü Stok — KAPALI: fiziksel raf toplamı + emanet ölü stok SAYILIR (bugünkü davranış, alan yok);
//      AÇIK: bizim + emanet = kapalıyken toplam, siparişsiz eski emanet ölü stoktan DÜŞER
//   §5 kalem raporu karneyle aynı bölmeyi kullanır · §6 üretim bakiyesi kırılımı (toplam değişmez)
//   §7 bulut `stok-karnesi` — kapalıyken `emanet` alanı yok, açıkken var
//
// NEGATİF SONDA (B, 2026-11-08, her biri md5 ile birebir geri alındı; 41/0 → ):
//   N1 `splitByOwnership` bayrağı yok saydı (kapalıyken de böl) → §4a/§4b/§4d/§4e ❌ (37/4)
//   N2 `consignedRollSql` IS NOT NULL → IS NULL → §0e/§1b/§4c/§4e/§4f ❌ (36/5)
//   N3 inventory.service'e `{ ownerCustomerId: null }` yüklemi → §0b/§0c ❌ (39/2)
//   N4 buildRollWhere mülkiyet parçası düşürüldü → §2c/§2d/§3c/§3d ❌ (37/4)
// Gerekli mi: §4e doğuşta ölçtü — emanet kapalı davranışta (= F1 öncesi kod) siparişsiz eski emanet 40 m ölü stok sayılıyordu.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { Request } from "express";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { InventoryService } from "../src/services/inventory.service";
import { getStockScorecard } from "../src/services/reports/stock-scorecard.report.service";
import { getStockKalem } from "../src/services/reports/stock-kalem.report.service";
import { ProductionBalanceService } from "../src/services/production-balance.service";
import { buildSnapshots } from "../src/cloud-sync/snapshots";
import {
  CONSIGNED_WHERE, OWN_STOCK_WHERE, consignedRollSql, isConsignedRoll, readOwnershipScope,
} from "../src/services/helpers/stock-ownership.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const ROOT = path.join(__dirname, "..");
const HELPER = "src/services/helpers/stock-ownership.helper.ts";
const TAG = `TEST-MK-${Date.now().toString(36)}`;
const inventory = new InventoryService();
const balance = new ProductionBalanceService();
const fakeReq = (query: Record<string, unknown>) => ({ query }) as unknown as Request;

// ── §0 AST ───────────────────────────────────────────────────────────────────
/** Yüzey → helper'dan içe aktarması ZORUNLU adlar (kullanılmasa tsc/eslint yakalar). */
const SURFACES: Record<string, { from: string; names: string[] }> = {
  "src/services/inventory.service.ts": { from: "./helpers/stock-ownership.helper", names: ["CONSIGNED_WHERE", "readOwnershipScope", "ownershipScopeWhere"] },
  "src/services/reports/stock-scorecard.report.service.ts": { from: "../helpers/stock-ownership.helper", names: ["consignedRollSql", "splitByOwnership"] },
  "src/services/production-balance.service.ts": { from: "./helpers/stock-ownership.helper", names: ["isConsignedRoll"] },
  "src/services/reports/stock-kalem.report.service.ts": { from: "./stock-scorecard.report.service", names: ["loadShelfCellsByOwnership"] },
};
/**
 * F1 öncesi doğmuş, başka soruyu (sevke hazırlık, hizmet faturası, lot/irsaliye sahibi…) cevaplayan
 * owner-null yüklemleri. Yeni dosya buraya EKLENMEZ — helper'dan okur. Göç: sonraki fason dilimleri.
 */
const LEGACY: ReadonlySet<string> = new Set([
  "src/services/roll-owner.service.ts",
  "src/services/yarn-lot.service.ts",
  "src/services/workorder-scan-route.service.ts",
  "src/services/helpers/ship-readiness.helper.ts",
  "src/services/helpers/work-order-customers.helper.ts",
  "src/services/helpers/emanet-owner.helper.ts",
  "src/services/helpers/ready-works-sql.helper.ts",
  "src/services/helpers/service-billing-gate.helper.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "generated") walk(p, out); }
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const isOwnerKey = (n: ts.PropertyName): boolean =>
  (ts.isIdentifier(n) || ts.isStringLiteral(n)) && n.text === "ownerCustomerId";
const isNull = (e: ts.Expression): boolean => e.kind === ts.SyntaxKind.NullKeyword;

/** Dosyadaki owner-null yüklem sayısı: `ownerCustomerId: null` · `ownerCustomerId: { not: null }` · SQL `"ownerCustomerId" IS [NOT] NULL`. */
export function ownerNullPredicates(src: string, file = "x.ts"): number {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && isOwnerKey(node.name)) {
      const init = node.initializer;
      if (isNull(init)) n++;
      else if (ts.isObjectLiteralExpression(init) && init.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "not" && isNull(p.initializer))) n++;
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (/"ownerCustomerId"\s+IS\s+(NOT\s+)?NULL/i.test(node.text)) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

function statik(): void {
  console.log("── §0 AST: yüzeyler helper'dan okur; helper dışı owner-null yüklemi yok ──");
  for (const [rel, want] of Object.entries(SURFACES)) {
    const sf = ts.createSourceFile(rel, readFileSync(path.join(ROOT, rel), "utf8"), ts.ScriptTarget.Latest, true);
    const imported = new Set<string>();
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === want.from) {
        const nb = st.importClause?.namedBindings;
        if (nb && ts.isNamedImports(nb)) nb.elements.forEach((e) => imported.add(e.name.text));
      }
    }
    const missing = want.names.filter((x) => !imported.has(x));
    check(`§0a ${path.basename(rel)} helper'dan içe aktarır`, missing.length === 0, missing.join(", "));
    check(`§0b ${path.basename(rel)} kendi owner-null yüklemini yazmaz`, ownerNullPredicates(readFileSync(path.join(ROOT, rel), "utf8"), rel) === 0);
  }
  const files = walk(path.join(ROOT, "src"));
  check("§0 körlük zemini: src'de > 300 dosya tarandı", files.length > 300, `${files.length}`);
  const offenders: string[] = [];
  const legacySeen = new Set<string>();
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join("/");
    if (rel === HELPER) continue;
    const n = ownerNullPredicates(readFileSync(f, "utf8"), rel);
    if (n === 0) continue;
    if (LEGACY.has(rel)) legacySeen.add(rel);
    else offenders.push(`${rel} (${n})`);
  }
  check("§0c helper dışında yeni owner-null yüklemi yok", offenders.length === 0, offenders.join(", "));
  const dead = [...LEGACY].filter((r) => !legacySeen.has(r));
  check("§0d muaf listesinde ölü satır yok (göç eden dosya listeden düşer)", dead.length === 0, dead.join(", "));
  check("§0e helper'ın kendisi üç biçimi taşır", ownerNullPredicates(readFileSync(path.join(ROOT, HELPER), "utf8")) >= 2
    && /IS NOT NULL/.test(readFileSync(path.join(ROOT, HELPER), "utf8")));
  // Tarayıcı öz-sınaması: üç kalıbı da sayar, düz atamayı saymaz.
  check("§0f tarayıcı öz-sınaması", ownerNullPredicates(`const a = { ownerCustomerId: null }; const b = { ownerCustomerId: { not: null } }; const c = sql\`r."ownerCustomerId" IS NULL\`; const d = { ownerCustomerId: x ?? null };`) === 3);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    check("§hedef DB yazılabilir", false, engel);
    return;
  }
  console.log("=== MÜLKİYET KAPSAMI BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: SETTING_KEYS.EMANET_ENABLED }, select: { key: true, value: true } });
  const setFlag = (v: boolean) => prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.EMANET_ENABLED }, create: { key: SETTING_KEYS.EMANET_ENABLED, value: String(v) }, update: { value: String(v) } });
  const ids = { item: "", cust: "", order: "", rolls: [] as string[] };
  try {
    const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} Kumaş`, itemType: "FABRIC" }, select: { id: true } });
    ids.item = item.id;
    const cust = await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} Sahip` }, select: { id: true } });
    ids.cust = cust.id;
    let seq = 0;
    const mk = async (status: RollStatus, qty: number, owner: string | null, extra: Partial<Prisma.RollUncheckedCreateInput> = {}, agedDays?: number) => {
      const r = await prisma.roll.create({
        data: { barcode: `${TAG}-R${++seq}`, itemId: item.id, status, initialQty: qty, currentQty: qty, entrySource: "SUPPLIER_RECEIPT", ownerCustomerId: owner, ...extra },
        select: { id: true },
      });
      ids.rolls.push(r.id);
      // Trigger INSERT'te now() yazar → yaşı geri çek (Stok & Ölü Stok çıpası).
      if (agedDays !== undefined) await prisma.$executeRaw`UPDATE rolls SET "statusChangedAt" = now() - make_interval(days => ${agedDays}::int) WHERE id = ${r.id}::uuid`;
      return r.id;
    };
    const ownWh = await mk(RollStatus.WAREHOUSE, 100, null, {}, 120);
    const consWh = await mk(RollStatus.WAREHOUSE, 40, cust.id, {}, 150); // siparişsiz Fason İE'nin hazır emaneti
    const ownRaw = await mk(RollStatus.STOCK, 30, null);
    const consRaw = await mk(RollStatus.STOCK, 20, cust.id);
    const consSemi = await mk(RollStatus.STOCK, 7, cust.id, { entrySource: "SEMI_FINISHED" });
    const fixture = [ownWh, consWh, ownRaw, consRaw, consSemi];
    const consSet = new Set([consWh, consRaw, consSemi]);

    // ── §1 boğaz-ikiz ─────────────────────────────────────────────────────────
    console.log("\n── §1 bellek ↔ Prisma ↔ SQL aynı küme ──");
    const rows = await prisma.roll.findMany({ where: { id: { in: fixture } }, select: { id: true, ownerCustomerId: true } });
    const mem = new Set(rows.filter(isConsignedRoll).map((r) => r.id));
    const prs = new Set((await prisma.roll.findMany({ where: { id: { in: fixture }, ...CONSIGNED_WHERE }, select: { id: true } })).map((r) => r.id));
    const own = new Set((await prisma.roll.findMany({ where: { id: { in: fixture }, ...OWN_STOCK_WHERE }, select: { id: true } })).map((r) => r.id));
    const sqlRows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT r.id::text AS id FROM rolls r WHERE r.id = ANY(${fixture}::uuid[]) AND ${consignedRollSql("r")}`);
    const sql = new Set(sqlRows.map((r) => r.id));
    const eq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
    check("§1a bellek = beklenen emanet kümesi", eq(mem, consSet), `${mem.size}`);
    check("§1b SQL ikizi = bellek", eq(sql, mem), `${sql.size}`);
    check("§1c Prisma CONSIGNED = bellek", eq(prs, mem), `${prs.size}`);
    check("§1d OWN ∪ CONSIGNED = hepsi, kesişim boş", own.size + prs.size === fixture.length && [...own].every((x) => !prs.has(x)));
    let threw = false;
    try { consignedRollSql("r; DROP"); } catch { threw = true; }
    check("§1e SQL ikizi geçersiz takma adı reddeder", threw);

    // ── §2 filter[mulkiyet] ───────────────────────────────────────────────────
    console.log("\n── §2 filter[mulkiyet] ──");
    check("§2a okuyucu: boş/ALL/own", readOwnershipScope(undefined) === "ALL" && readOwnershipScope("ALL") === "ALL" && readOwnershipScope("own") === "OWN");
    const base = { "filter[status]": "ALL", "filter[itemId]": item.id, pageSize: "100" };
    const list = async (q: Record<string, string>) => ((await inventory.findAllRolls(fakeReq({ ...base, ...q }))) as unknown as { data: Array<{ id: string }> }).data.map((r) => r.id).sort();
    const stats = async (q: Record<string, string>) => (await inventory.getRollStats(fakeReq({ ...base, ...q }))).data!;
    await setFlag(false);
    const lAll = await list({});
    check("§2b ALL = süzgeçsiz liste (bayt-aynı)", JSON.stringify(await list({ "filter[mulkiyet]": "ALL" })) === JSON.stringify(lAll) && lAll.length === 5);
    const lOwn = await list({ "filter[mulkiyet]": "OWN" });
    check("§2c OWN emanet içermez", lOwn.length === 2 && lOwn.every((x) => !consSet.has(x)), `${lOwn.length}`);
    check("§2d CONSIGNED yalnız emanet", (await list({ "filter[mulkiyet]": "CONSIGNED" })).every((x) => consSet.has(x)));
    let code: unknown = null;
    try { await stats({ "filter[mulkiyet]": "BIZIM" }); } catch (e) { code = e instanceof AppError ? `${e.statusCode}:${(e.details as { code?: string } | undefined)?.code}` : String(e); }
    check("§2e tanınmayan değer 400 OWNERSHIP_SCOPE_INVALID", code === "400:OWNERSHIP_SCOPE_INVALID", String(code));

    // ── §3 /rolls/stats ───────────────────────────────────────────────────────
    console.log("\n── §3 /rolls/stats ──");
    const sOff = await stats({});
    check("§3a emanet KAPALI: `consigned` alanı yok", !("consigned" in sOff), JSON.stringify(Object.keys(sOff)));
    await setFlag(true);
    const sOn = await stats({});
    const sOwn = await stats({ "filter[mulkiyet]": "OWN" });
    const sCons = await stats({ "filter[mulkiyet]": "CONSIGNED" });
    const { consigned: kir, ...sOnRest } = sOn;
    check("§3b AÇIK: toplam alanlar kapalıyla aynı", JSON.stringify(sOnRest) === JSON.stringify(sOff));
    check("§3c bizim + emanet = toplam (adet, metre)", sOwn.totalCount + sCons.totalCount === sOn.totalCount && sOwn.totalQty + sCons.totalQty === sOn.totalQty, `${sOwn.totalQty}+${sCons.totalQty}/${sOn.totalQty}`);
    check("§3d kırılım = CONSIGNED şeridi", !!kir && kir.count === sCons.totalCount && kir.qty === sCons.totalQty && kir.qty === 67, JSON.stringify(kir));

    // ── §4 Stok & Ölü Stok ────────────────────────────────────────────────────
    console.log("\n── §4 Stok & Ölü Stok ──");
    await setFlag(false);
    const cOff = await getStockScorecard();
    const phys = await prisma.roll.aggregate({ where: { status: { in: [RollStatus.WAREHOUSE, RollStatus.A1_STOCK] }, shipmentId: null, sackId: null }, _count: { _all: true } });
    check("§4a KAPALI: `consigned` yok, bitmiş = fiziksel raf (emanet dahil, bugünkü)", !("consigned" in cOff.summary) && cOff.summary.finishedCount === phys._count._all, `${cOff.summary.finishedCount}/${phys._count._all}`);
    const itemOff = cOff.byItem.find((r) => r.key === item.id);
    check("§4b KAPALI: kumaş satırı emanetle birlikte (140 m) — bugünkü davranış", itemOff?.qty === 140, JSON.stringify(itemOff));
    await setFlag(true);
    const cOn = await getStockScorecard();
    const c = cOn.summary.consigned;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    check("§4c AÇIK: emanet satırı fikstürü içerir", !!c && c.finishedCount >= 1 && c.rawCount >= 1 && c.semiCount >= 1, JSON.stringify(c));
    check("§4d bizim + emanet = kapalıyken toplam (bitmiş/ham/yarı mamul)", !!c
      && cOn.summary.finishedCount + c.finishedCount === cOff.summary.finishedCount && r1(cOn.summary.finishedQty + c.finishedQty) === cOff.summary.finishedQty
      && cOn.summary.rawCount + c.rawCount === cOff.summary.rawCount && r1(cOn.summary.rawQty + c.rawQty) === cOff.summary.rawQty
      && cOn.summary.semiCount + c.semiCount === cOff.summary.semiCount && r1(cOn.summary.semiQty + c.semiQty) === cOff.summary.semiQty);
    check("§4e siparişsiz eski emanet ölü stoktan düşer (40 m)", r1(cOff.summary.deadQty - cOn.summary.deadQty) === 40, `${cOff.summary.deadQty} → ${cOn.summary.deadQty}`);
    check("§4f kumaş satırı ve en eski listesi bizim stok", cOn.byItem.find((r) => r.key === item.id)?.qty === 100 && !cOn.oldest.some((o) => o.rollId === consWh));

    // ── §5 kalem raporu ───────────────────────────────────────────────────────
    console.log("\n── §5 kalem raporu karneyle aynı bölme ──");
    const kOn = await getStockKalem();
    check("§5a AÇIK: kalem toplamı = karne (bizim)", kOn.totals.bitmisCount === cOn.summary.finishedCount && kOn.totals.hamQty === cOn.summary.rawQty);
    check("§5b AÇIK: kalem emanet = karne emanet", !!kOn.consignedTotals && !!c && kOn.consignedTotals.bitmisQty === c.finishedQty && kOn.consignedTotals.hamCount === c.rawCount);
    await setFlag(false);
    const kOff = await getStockKalem();
    check("§5c KAPALI: `consignedTotals` yok, toplam = karne", !("consignedTotals" in kOff) && kOff.totals.bitmisCount === cOff.summary.finishedCount);

    // ── §6 üretim bakiyesi ────────────────────────────────────────────────────
    console.log("\n── §6 üretim bakiyesi kırılımı ──");
    // Talep kalemi §4'ten SONRA kurulur (ölü stok ölçümünü etkilemesin); satır ancak talep varken doğar.
    const order = await prisma.order.create({
      data: { orderNumber: `${TAG}-ORD`, customerId: cust.id, status: "APPROVED", lines: { create: [{ itemId: item.id, quantity: 500 }] } },
      select: { id: true },
    });
    ids.order = order.id;
    const bOff = await balance.getBalance({ itemId: item.id });
    await setFlag(true);
    const bOn = await balance.getBalance({ itemId: item.id });
    const strip = (g: unknown) => JSON.parse(JSON.stringify(g, (k, v) => (/Emanet$/.test(k) ? undefined : v)));
    check("§6a AÇIK: kırılım dışı alanlar kapalıyla aynı", JSON.stringify(strip(bOn.data)) === JSON.stringify(bOff.data));
    check("§6b KAPALI: *Emanet alanı yok", !/Emanet"/.test(JSON.stringify(bOff.data)) && (bOff.data?.length ?? 0) === 1);
    const g = bOn.data?.[0];
    const n = (d: unknown) => Number(d ?? NaN);
    check("§6c AÇIK: depo 140 / emanet 40 · ham 50 / emanet 20 · yarı mamul 7 / emanet 7",
      !!g && n(g.depo) === 140 && n(g.depoEmanet) === 40 && n(g.specs[0]?.depoEmanet) === 40 && n(g.ham) === 50 && n(g.hamEmanet) === 20 && n(g.yariMamul) === 7 && n(g.yariMamulEmanet) === 7,
      g ? `${g.depo}/${g.depoEmanet} ${g.ham}/${g.hamEmanet} ${g.yariMamul}/${g.yariMamulEmanet}` : "satır yok");

    // ── §7 bulut stok-karnesi ─────────────────────────────────────────────────
    console.log("\n── §7 bulut stok-karnesi ──");
    const snap = async () => (await buildSnapshots({ now: new Date(), productionOn: true, financeOn: false, cadences: new Set(), extra: new Set(["stok-karnesi"]) }))
      .find((s) => s.projection === "stok-karnesi");
    const snOn = await snap();
    await setFlag(false);
    const snOff = await snap();
    check("§7a AÇIK: tel şemasından geçer, `emanet` satırı var", !!snOn && /"emanet"/.test(JSON.stringify(snOn.data)));
    check("§7b KAPALI: `emanet` alanı yok", !!snOff && !/"emanet"/.test(JSON.stringify(snOff.data)));
  } finally {
    if (ids.order) {
      await prisma.orderLine.deleteMany({ where: { orderId: ids.order } });
      await prisma.order.deleteMany({ where: { id: ids.order } });
    }
    if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } });
    if (ids.cust) await prisma.customer.deleteMany({ where: { id: ids.cust } });
    // Bayrak fotoğrafa birebir döner; satır yoksa satırsız.
    if (foto.length) await prisma.systemSetting.update({ where: { key: SETTING_KEYS.EMANET_ENABLED }, data: { value: foto[0]!.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.EMANET_ENABLED } });
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ beklenmeyen hata:", e);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
