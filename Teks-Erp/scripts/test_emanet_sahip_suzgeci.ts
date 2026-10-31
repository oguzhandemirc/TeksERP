// =============================================================================
// EMANET SAHİP SÜZGECİ + İÇERİDEKİ İŞLER BEKÇİSİ (ister 3.2, P1a)
// =============================================================================
// Koşum: npx tsx scripts/test_emanet_sahip_suzgeci.ts   (DB'li; TEST- fikstürü; emanet bayrağı fotoğrafa döner)
//
// Ölçer:
//   §0 statik — `buildRollWhere` sahibi `readIdCondition`dan okur · `/api/consigned-work` `requireEmanetEnabled`
//      arkasında · K18_DEAD_STATUSES ⊆ NOT_INSIDE_STATUSES
//   §1 liste — sahip A süzgeci yalnız A'nın toplarını, CSV A,B ikisinin toplarını döner; süzgeçsiz sahipsiz top da gelir
//   §2 özet şeridi — `/rolls/stats` aynı where: sayı listeyle birebir
//   §3 cursor — sayfalarken süzgeç korunur (her sayfa yalnız A/B, mükerrer yok, toplam tam)
//   §4 emanet KAPALI — ölçülen davranış: liste süzgeci YİNE UYGULANIR (depo süzgeci emsali; sessiz düşme yok);
//      İçerideki İşler ucu (`/api/consigned-work`) 403 MODULE_DISABLED
//   §5 İçerideki İşler — ölü (K18) · SHIPPED · SCRAP dışlanır; kovalar (waiting/inProcess/ready/other);
//      metre = currentQty (initialQty DEĞİL); toplam, aynı sahip + canlı statü süzgeçli `/rolls/stats` ile birebir
//   §8 "Yalnız sevke hazır" (D4-KUC2 b) — süzme sunucuda; satırlar + totals tek WHERE; onlyReady=false bugünkü liste
//   §6 sahip lookup'ı — yalnız top sahibi müşteriler (A, B), satır {id,name,code}; emanet KAPALI → boş
//   §7 KOVA ↔ SEKME — her bağlantılı kova (waiting/waitingSemi/inProcess/ready) sayı+metre olarak, panelin
//      bağlandığı sekmenin rollScope'u + sahip + includeFire `/rolls/stats`ıyla birebir. Eşleme panelden OKUNUR
//      (Electron consigned-links.ts BUCKET_TAB + Rolls/service.ts sekme→rollScope). Fikstür gerçek Gülkesim
//      girişini (SEMI_FINISHED, gelen belge onayı) ve fire kaliteli canlı topu içerir.
//
// NEGATİF SONDA (kırmızı görülerek, 2026-10-29): `buildRollWhere`de `where.ownerCustomerId = …` ataması
//   düşürülünce §1a/§1b/§1d/§3/§4a/§5f ❌ (süzgeç sessizce düşer); `requireEmanetEnabled` bayrak kontrolü düşürülünce §4b ❌.
//   (2026-10-29 bitirici) BUCKET_TAB'da waitingSemi → "RAW_STOCK" yapılınca §7 waitingSemi ❌ (eski hata: Bekliyor
//   hücresi boş Ham Stok listesi açıyordu); lookup'taki emanet kapısı düşürülünce §6b ❌.
//   (2026-10-31, D4-KUC2 b) sunucu kapsamı (`consignedOwnerScope`) hep boş → §8a/§8b ❌; süzgeç istemciye taşındı
//   (ConsignedWorkPage `rows.filter(r => r.ready.count > 0)`) → §0e ❌ (28/1); ikisi de geri alındı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { InventoryService } from "../src/services/inventory.service";
import { K18_DEAD_STATUSES } from "../src/services/batch.service";
import { NOT_INSIDE_STATUSES, getConsignedWorkSummary, listRollOwnerCustomers } from "../src/services/roll-owner.service";
import { requireEmanetEnabled } from "../src/middlewares/module.middleware";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const ROOT = path.join(__dirname, "..");
const TAG = `TEST-EMS-${Date.now().toString(36)}`;
const inventory = new InventoryService();
const fakeReq = (query: Record<string, unknown>) => ({ query }) as unknown as Request;
type RollRow = { id: string; ownerCustomerId: string | null; ownerCustomer?: { id: string; name: string } | null };

function statik(): void {
  const inv = readFileSync(path.join(ROOT, "src/services/inventory.service.ts"), "utf8");
  check("§0a buildRollWhere sahibi readIdCondition'dan okur", /readIdCondition\(f\["ownerCustomerId"\]\)/.test(inv));
  const routes = readFileSync(path.join(ROOT, "src/routes/consigned-work.routes.ts"), "utf8");
  check("§0b /api/consigned-work requireEmanetEnabled arkasında", /router\.use\(verifyToken, requireEmanetEnabled\)/.test(routes));
  check("§0d uç süzgeci sıkı şemayla (tanınmayan parametre 400) okur ve servise geçirir",
    /onlyReady: z\.enum\(\["true", "false"\]\)\.optional\(\) \}\)\.strict\(\)/.test(routes) && /getConsignedWorkSummary\(\{ onlyReady: parsed\.data\.onlyReady === "true" \}\)/.test(routes));
  const page = readFileSync(path.join(ROOT, "../Electron/src/pages/Operations/ConsignedWork/ConsignedWorkPage.tsx"), "utf8");
  const svc = readFileSync(path.join(ROOT, "../Electron/src/pages/Operations/ConsignedWork/service.ts"), "utf8");
  check("§0e panel süzgeci sunucuya yollar (onlyReady parametresi); sayfada satır süzmesi YOK",
    /onlyReady/.test(svc) && !/rows\??\.filter\(/.test(page) && !/\.ready\.count\s*>\s*0/.test(page));
  check("§0c K18_DEAD_STATUSES ⊆ NOT_INSIDE_STATUSES (+SHIPPED, SCRAP)",
    K18_DEAD_STATUSES.every((s) => NOT_INSIDE_STATUSES.includes(s)) && NOT_INSIDE_STATUSES.includes(RollStatus.SHIPPED) && NOT_INSIDE_STATUSES.includes(RollStatus.SCRAP));
}

async function middlewareError(): Promise<AppError | null> {
  let got: unknown = undefined;
  await requireEmanetEnabled({} as Request, {} as Response, (e?: unknown) => { got = e ?? null; });
  return got instanceof AppError ? got : null;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exitCode = 2; await pool.end(); return; }
  console.log("=== EMANET SAHİP SÜZGECİ + İÇERİDEKİ İŞLER BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: SETTING_KEYS.EMANET_ENABLED }, select: { key: true, value: true } });
  const setFlag = (v: boolean) => prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.EMANET_ENABLED }, create: { key: SETTING_KEYS.EMANET_ENABLED, value: String(v) }, update: { value: String(v) } });
  const ids = { item: "", custA: "", custB: "", st: "", wo: "", grade: "", rolls: [] as string[] };

  try {
    const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} Kumaş`, itemType: "FABRIC" }, select: { id: true } });
    ids.item = item.id;
    const custA = await prisma.customer.create({ data: { code: `${TAG}-A`, name: `${TAG} Sahip A` }, select: { id: true } });
    ids.custA = custA.id;
    const custB = await prisma.customer.create({ data: { code: `${TAG}-B`, name: `${TAG} Sahip B` }, select: { id: true } });
    ids.custB = custB.id;
    const st = await prisma.station.create({ data: { code: `${TAG}-S`, name: `${TAG} İstasyon`, type: "INTERNAL" }, select: { id: true } });
    ids.st = st.id;
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${TAG}-WO`, type: "STOCK_PRODUCTION", targetItemId: item.id, steps: { create: [{ stationId: st.id, stepSequence: 1 }] } },
      select: { id: true, steps: { select: { id: true } } },
    });
    ids.wo = wo.id;
    const stepId = wo.steps[0]!.id;

    let seq = 0;
    const fireGrade = await prisma.qualityGrade.create({ data: { code: `${TAG}-F`.slice(0, 32), name: `${TAG} Fire`, targetStatus: RollStatus.SCRAP }, select: { id: true, code: true } });
    ids.grade = fireGrade.id;
    const mk = async (owner: string | null, status: RollStatus, current: number, extra: Partial<Prisma.RollUncheckedCreateInput> = {}) => {
      const r = await prisma.roll.create({
        data: { barcode: `${TAG}-R${++seq}`, itemId: item.id, status, initialQty: current + 20, currentQty: current, entrySource: "SUPPLIER_RECEIPT", ownerCustomerId: owner, ...extra },
        select: { id: true },
      });
      ids.rolls.push(r.id);
      return r.id;
    };
    // A: waiting 100 · inProcess 30 · ready 50 · other 10 · dışlananlar SHIPPED/CANCELLED/TAMBUR_CONSUMED/SCRAP
    await mk(custA.id, RollStatus.STOCK, 100);
    await mk(custA.id, RollStatus.IN_PRODUCTION, 30, { currentStepId: stepId });
    await mk(custA.id, RollStatus.WAREHOUSE, 50);
    await mk(custA.id, RollStatus.AT_KARTELA, 10);
    await mk(custA.id, RollStatus.SHIPPED, 70);
    await mk(custA.id, RollStatus.CANCELLED, 20);
    await mk(custA.id, RollStatus.TAMBUR_CONSUMED, 40);
    await mk(custA.id, RollStatus.SCRAP, 5);
    // A: gelen belge onayının doğurduğu YARI MAMUL emanet (waitingSemi 40) · fire KALİTELİ canlı depo topu (ready +15)
    await mk(custA.id, RollStatus.STOCK, 40, { entrySource: "SEMI_FINISHED" });
    await mk(custA.id, RollStatus.WAREHOUSE, 15, { qualityGrade: fireGrade.code });
    // B: ready 25 (A1_STOCK) · inProcess 60
    const bReadyRoll = await mk(custB.id, RollStatus.A1_STOCK, 25);
    await mk(custB.id, RollStatus.IN_PRODUCTION, 60, { currentStepId: stepId });
    // sahipsiz
    await mk(null, RollStatus.STOCK, 80);

    const base = { "filter[status]": "ALL", "filter[itemId]": item.id, "filter[includeFire]": "true", pageSize: "100" };
    const list = async (q: Record<string, string>) => ((await inventory.findAllRolls(fakeReq({ ...base, ...q }))) as unknown as { data: RollRow[] }).data;
    const stats = async (q: Record<string, string>) => (await inventory.getRollStats(fakeReq({ ...base, ...q }))).data!;

    // §1 liste
    await setFlag(true);
    const onlyA = await list({ "filter[ownerCustomerId]": custA.id });
    check("§1a sahip A süzgeci yalnız A'nın 10 topu", onlyA.length === 10 && onlyA.every((r) => r.ownerCustomerId === custA.id), `n=${onlyA.length}`);
    const ab = await list({ "filter[ownerCustomerId]": `${custA.id},${custB.id}` });
    check("§1b çoklu süzgeç A,B → 12 top, sahipsiz yok", ab.length === 12 && ab.every((r) => r.ownerCustomerId === custA.id || r.ownerCustomerId === custB.id), `n=${ab.length}`);
    const all = await list({});
    check("§1c süzgeçsiz 13 top (sahipsiz dahil)", all.length === 13, `n=${all.length}`);
    check("§1d liste satırı \"Sahibi\" adını taşır (ownerCustomer {id,name})", onlyA.every((r) => r.ownerCustomer?.id === custA.id && r.ownerCustomer.name === `${TAG} Sahip A`));

    // §2 özet şeridi
    const sA = await stats({ "filter[ownerCustomerId]": custA.id });
    const sAB = await stats({ "filter[ownerCustomerId]": `${custA.id},${custB.id}` });
    check("§2 /stats aynı where: A=10, A+B=12 (listeyle birebir)", sA.totalCount === onlyA.length && sAB.totalCount === ab.length, `A=${sA.totalCount} AB=${sAB.totalCount}`);

    // §3 cursor
    const seen: RollRow[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: Record<string, unknown> = { ...base, "filter[ownerCustomerId]": `${custA.id},${custB.id}`, mode: "cursor", limit: "3" };
      if (cursor) q.cursor = cursor;
      const res = (await inventory.findAllRolls(fakeReq(q))) as unknown as { data: RollRow[]; pagination: { nextCursor: string | null } };
      seen.push(...res.data);
      cursor = res.pagination.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    check("§3 cursor sayfalamada süzgeç korunur: 12 top, ≥4 sayfa, mükerrer yok, hepsi A/B",
      seen.length === 12 && pages >= 4 && new Set(seen.map((r) => r.id)).size === 12 && seen.every((r) => r.ownerCustomerId === custA.id || r.ownerCustomerId === custB.id),
      `n=${seen.length} sayfa=${pages}`);

    // §5 İçerideki İşler (modül açık)
    check("§5a middleware AÇIK → geçer", (await middlewareError()) === null);
    const sum = (await getConsignedWorkSummary()).data!;
    const rA = sum.rows.find((r) => r.ownerCustomerId === custA.id);
    const rB = sum.rows.find((r) => r.ownerCustomerId === custB.id);
    check("§5b A: ölü/sevkli/hurda DIŞLANIR, fire kaliteli canlı top SAYILIR → 6 top · 245 m (currentQty; initialQty olsaydı 365)", rA?.total.count === 6 && rA.total.qty === 245, JSON.stringify(rA?.total));
    check("§5c A kovaları: waiting 1/100 · waitingSemi 1/40 · inProcess 1/30 · ready 2/65 · other 1/10",
      rA?.waiting.count === 1 && rA.waiting.qty === 100 && rA.waitingSemi.count === 1 && rA.waitingSemi.qty === 40 && rA.inProcess.count === 1 && rA.inProcess.qty === 30 && rA.ready.count === 2 && rA.ready.qty === 65 && rA.other.count === 1 && rA.other.qty === 10,
      JSON.stringify(rA));
    check("§5d B: ready 1/25 (A1_STOCK) · inProcess 1/60 · toplam 2/85 · ad", rB?.ready.count === 1 && rB.ready.qty === 25 && rB.inProcess.qty === 60 && rB.total.count === 2 && rB.total.qty === 85 && rB.ownerName === `${TAG} Sahip B`);
    check("§5e sahipsiz top hiçbir satırda yok", sum.rows.every((r) => r.ownerCustomerId === custA.id || r.ownerCustomerId === custB.id || !r.ownerName.startsWith(TAG)));
    const live = Object.values(RollStatus).filter((s) => !NOT_INSIDE_STATUSES.includes(s)).join(",");
    const sLive = await stats({ "filter[ownerCustomerId]": custA.id, "filter[statusIn]": live });
    check("§5f İçerideki İşler A toplamı = /stats (sahip A + canlı statüler) — sayı ve metre", sLive.totalCount === rA?.total.count && sLive.totalQty === rA.total.qty, `stats=${sLive.totalCount}/${sLive.totalQty}`);

    // §8 "Yalnız sevke hazır" (D4-KUC2 b): süzme SUNUCUDA; satırlar ve özet şeridi (totals) aynı WHERE'den.
    await prisma.roll.update({ where: { id: bReadyRoll }, data: { status: RollStatus.STOCK } });
    const ready = (await getConsignedWorkSummary({ onlyReady: true })).data!;
    const sumOf = (rows: typeof ready.rows) => rows.reduce((a, r) => ({ count: a.count + r.total.count, qty: a.qty + r.total.qty }), { count: 0, qty: 0 });
    check("§8a onlyReady: hazırı olan A VAR, hazırı kalmayan B YOK", ready.rows.some((r) => r.ownerCustomerId === custA.id) && !ready.rows.some((r) => r.ownerCustomerId === custB.id),
      ready.rows.filter((r) => r.ownerName.startsWith(TAG)).map((r) => r.ownerName).join(","));
    const tot = sumOf(ready.rows);
    check("§8b ⭐ özet şeridi = Σ süzülü satır (tek where; istemcide süzme yok)", ready.totals.total.count === tot.count && Math.abs(ready.totals.total.qty - tot.qty) < 1e-9 && ready.rows.every((r) => r.ready.count > 0),
      `totals=${ready.totals.total.count}/${ready.totals.total.qty} Σ=${tot.count}/${tot.qty}`);
    const plain = (await getConsignedWorkSummary({ onlyReady: false })).data!;
    check("§8c onlyReady=false = süzgeçsiz (bugünkü liste; B görünür)", JSON.stringify(plain) === JSON.stringify((await getConsignedWorkSummary()).data) && plain.rows.some((r) => r.ownerCustomerId === custB.id));
    await prisma.roll.update({ where: { id: bReadyRoll }, data: { status: RollStatus.A1_STOCK } });

    // §6 lookup
    const owners = (await listRollOwnerCustomers()).data!;
    const oA = owners.find((o) => o.id === custA.id);
    check("§6 sahip lookup'ı A ve B'yi içerir; satır {code,id,name}", !!oA && owners.some((o) => o.id === custB.id) && Object.keys(oA).sort().join(",") === "code,id,name");

    // §7 kova ↔ sekme birebirliği (eşleme panelden okunur — ayrışırsa hücre boş/eksik liste açar)
    const links = readFileSync(path.join(ROOT, "../Electron/src/pages/Operations/ConsignedWork/consigned-links.ts"), "utf8");
    const rollsSvc = readFileSync(path.join(ROOT, "../Electron/src/pages/Operations/Rolls/service.ts"), "utf8");
    const tabBlock = /BUCKET_TAB[^=]*=\s*\{([^}]*)\}/.exec(links)?.[1] ?? "";
    const bucketTab = new Map([...tabBlock.matchAll(/(\w+):\s*"(\w+)"/g)].map((m) => [m[1]!, m[2]!]));
    const tabScope = new Map([...rollsSvc.matchAll(/if \(tab === "(\w+)"\) return \{ rollScope: "(\w+)"/g)].map((m) => [m[1]!, m[2]!]));
    const linked = ["waiting", "waitingSemi", "inProcess", "ready"] as const;
    check("§7a panel eşlemesi okunur: dört bağlantılı kovanın hepsi bir sekmeye, her sekme bir rollScope'a bağlı",
      linked.every((k) => bucketTab.has(k) && tabScope.has(bucketTab.get(k)!)), JSON.stringify([...bucketTab]));
    for (const k of linked) {
      const scope = tabScope.get(bucketTab.get(k) ?? "") ?? "?";
      const sc = scope === "?" ? null : await stats({ "filter[ownerCustomerId]": custA.id, "filter[rollScope]": scope });
      check(`§7 ${k} → ${bucketTab.get(k)} (${scope}): sekme listesi = kova (sayı + metre)`,
        !!sc && sc.totalCount === rA?.[k].count && sc.totalQty === rA[k].qty, `kova=${JSON.stringify(rA?.[k])} sekme=${sc?.totalCount}/${sc?.totalQty}`);
    }

    // §4 emanet KAPALI
    await setFlag(false);
    const offA = await list({ "filter[ownerCustomerId]": custA.id });
    check("§4a KAPALI: liste süzgeci YİNE uygulanır (sessiz düşme yok) — 10 top", offA.length === 10 && offA.every((r) => r.ownerCustomerId === custA.id), `n=${offA.length}`);
    const err = await middlewareError();
    check("§4b KAPALI: İçerideki İşler 403 MODULE_DISABLED (modul emanet)", err?.statusCode === 403 && err.details?.code === "MODULE_DISABLED", `${err?.statusCode} ${String(err?.details?.code)}`);
    const offOwners = (await listRollOwnerCustomers()).data!;
    check("§6b KAPALI: sahip lookup'ı boş (cari adı sızmaz)", offOwners.length === 0, `n=${offOwners.length}`);
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.wo) { await prisma.workOrderStep.deleteMany({ where: { workOrderId: ids.wo } }); await prisma.workOrder.deleteMany({ where: { id: ids.wo } }); }
    if (ids.st) await prisma.station.deleteMany({ where: { id: ids.st } });
    if (ids.grade) await prisma.qualityGrade.deleteMany({ where: { id: ids.grade } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } });
    await prisma.customer.deleteMany({ where: { id: { in: [ids.custA, ids.custB].filter(Boolean) } } });
    const f = foto[0];
    if (f) await prisma.systemSetting.update({ where: { key: f.key }, data: { value: f.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.EMANET_ENABLED } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exitCode = 1;
});
