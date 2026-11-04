// =============================================================================
// Test: İş emri listesi "şu an hangi fasonda" süzgeci
// Çalıştır: npx tsx scripts/test_wo_place_filter.ts
// =============================================================================
// `filter[fasonFirma]` = topu ŞU AN o firmaya giden açık sevkte dönmemiş (planda
// yazılı firma YETMEZ). Yüklem tek kaynak (`roll-place.helper`, sipariş "Nerede?" ile
// ortak); firma bağı sevkin iş emri (`dispatch.workOrderId`). Aşama sorusu mevcut
// `filter[konumIstasyon]`undur (ikinci seçici yok); burada yalnız AND'i ölçülür.
// Sayım listeyle aynı where'den; UUID değil / kayıt yok → 400 INVALID_FILTER_VALUE;
// seçenek ucu (`GET /where-options`) aynı yüklemle sayar.
// Temizlik: finally bloğunda, yalnız kendi ürettiklerini siler.
// =============================================================================
import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { WorkOrderController } from "../src/controllers/workorder.controller";
import { ensureTestSubcontractor, TEST_DYE_HOUSE, TEST_SANDING } from "./fixture-subcontractor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

interface CaughtError {
  message: string;
  statusCode?: number;
  code?: unknown;
  field?: unknown;
}
async function expectError(fn: () => Promise<unknown>): Promise<CaughtError | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    const e = err as { message?: string; statusCode?: number; details?: { code?: unknown; field?: unknown } };
    return { message: e.message ?? String(err), statusCode: e.statusCode, code: e.details?.code, field: e.details?.field };
  }
}
const errStr = (e: CaughtError | null): string => (e ? `${e.statusCode} ${String(e.code)} ${e.message}` : "hata yok");

interface WoResult {
  data: Array<{ id: string }>;
  pagination: { total: number };
}
interface Opt {
  id: string;
  name: string;
  workOrderCount: number;
}
interface Options {
  firms: Opt[];
}

/** Controller köprüsü dahil: yanıt zarfı `{success, data}` ve durum kodu. */
async function callWhereOptions(): Promise<{ status: number; body: { success: boolean; data: Options } }> {
  const ctrl = new WorkOrderController();
  let status = 0;
  let body: unknown;
  let error: unknown;
  const res = {
    status(c: number) {
      status = c;
      return this;
    },
    json(b: unknown) {
      body = b;
      return this;
    },
  } as unknown as Response;
  const handler = ctrl.whereOptions;
  await handler({ query: {} } as Request, res, (e?: unknown) => {
    error = e;
  });
  if (error) throw error;
  return { status, body: body as { success: boolean; data: Options } };
}

async function main(): Promise<void> {
  const ts = Date.now();
  const P = `TEST-WOYER-${ts}`;
  const items: string[] = [];
  const wos: string[] = [];
  const stations: string[] = [];
  const batches: string[] = [];
  const rolls: string[] = [];
  const dispatches: string[] = [];
  const svc = new WorkOrderService();

  try {
    const firmX = await ensureTestSubcontractor(TEST_DYE_HOUSE);
    const firmY = await ensureTestSubcontractor(TEST_SANDING);
    const before = (await callWhereOptions()).body.data;
    const firmCountBefore = (id: string): number => before.firms.find((f) => f.id === id)?.workOrderCount ?? 0;

    const item = await prisma.item.create({
      data: { code: `${P}-IT`, name: `${P} KUMAS`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    items.push(item.id);
    const mkStation = async (suffix: string, external: boolean): Promise<string> => {
      const s = await prisma.station.create({
        data: external
          ? { code: `${P}-${suffix}`, name: `${P} ${suffix}`, type: "EXTERNAL", kind: "SUBCONTRACTOR" }
          : { code: `${P}-${suffix}`, name: `${P} ${suffix}`, type: "INTERNAL", kind: "OTHER" },
        select: { id: true },
      });
      stations.push(s.id);
      return s.id;
    };
    const stF = await mkStation("FSN", true);
    const stS1 = await mkStation("S1", false);
    const stS2 = await mkStation("S2", false);

    /** İE: [fason adım, S1 adım]; adım kimlikleri istasyona göre. */
    const mkWo = async (suffix: string, planned?: string): Promise<{ id: string; batchId: string; step: Record<string, string> }> => {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `${P}-IE-${suffix}`,
          status: "IN_PROGRESS",
          type: "STOCK_PRODUCTION",
          targetItemId: item.id,
          width: 300,
          steps: {
            create: [
              { stationId: stF, stepSequence: 1, plannedSubcontractorId: planned ?? null },
              { stationId: stS1, stepSequence: 2 },
            ],
          },
        },
        select: { id: true, steps: { select: { id: true, stationId: true } } },
      });
      wos.push(wo.id);
      const b = await prisma.batch.create({ data: { batchNumber: `${P}-B-${suffix}`.slice(0, 60), workOrderId: wo.id }, select: { id: true } });
      batches.push(b.id);
      return { id: wo.id, batchId: b.id, step: Object.fromEntries(wo.steps.map((s) => [s.stationId, s.id])) };
    };
    const mkRoll = async (w: { batchId: string }, stepId: string, status: "AT_SUBCONTRACTOR" | "IN_PRODUCTION" | "WAREHOUSE"): Promise<string> => {
      const r = await prisma.roll.create({
        data: { itemId: item.id, initialQty: 50, currentQty: 50, width: 300, status, batchId: w.batchId, currentStepId: stepId },
        select: { id: true },
      });
      rolls.push(r.id);
      return r.id;
    };
    const mkDispatch = async (
      w: { id: string; batchId: string },
      stepId: string,
      firmId: string,
      rollId: string,
      opts: { cancelled?: boolean; remainderClosed?: boolean } = {},
    ): Promise<void> => {
      const d = await prisma.subcontractorDispatch.create({
        data: {
          dispatchNo: `${P}-SD-${dispatches.length}`,
          workOrderId: w.id,
          batchId: w.batchId,
          stepId,
          subcontractorId: firmId,
          totalQty: 50,
          cancelledAt: opts.cancelled ? new Date() : null,
          items: { create: [{ rollId, dispatchedQty: 50, remainderClosedAt: opts.remainderClosed ? new Date() : null }] },
        },
        select: { id: true },
      });
      dispatches.push(d.id);
    };

    // W1: bir top X'te (açık sevk, dönmemiş) + bir top S1'de üretimde.
    const w1 = await mkWo("1");
    await mkDispatch(w1, w1.step[stF]!, firmX.id, await mkRoll(w1, w1.step[stF]!, "AT_SUBCONTRACTOR"));
    await mkRoll(w1, w1.step[stS1]!, "IN_PRODUCTION");
    // W2: top AT_SUBCONTRACTOR ama X'e sevki İPTAL edilmiş → X'te değil.
    const w2 = await mkWo("2");
    await mkDispatch(w2, w2.step[stF]!, firmX.id, await mkRoll(w2, w2.step[stF]!, "AT_SUBCONTRACTOR"), { cancelled: true });
    // W3: X'ten dönmüş (kalan kapatılmış) top, fason adımında üretimde → X'te değil.
    const w3 = await mkWo("3");
    await mkDispatch(w3, w3.step[stF]!, firmX.id, await mkRoll(w3, w3.step[stF]!, "IN_PRODUCTION"), { remainderClosed: true });
    // W4: yalnız planda X yazılı, sevk yok → X'te değil.
    const w4 = await mkWo("4", firmX.id);
    await mkRoll(w4, w4.step[stF]!, "IN_PRODUCTION");
    // W5: top S1'de üretimde (fason yok).
    const w5 = await mkWo("5");
    await mkRoll(w5, w5.step[stS1]!, "IN_PRODUCTION");
    // W6: top S1 adımına bağlı ama depoda; fasonla ilgisiz.
    const w6 = await mkWo("6");
    await mkRoll(w6, w6.step[stS1]!, "WAREHOUSE");
    // W7: X'e açık sevkte dönmemiş kalem ama top fabrikada (IN_PRODUCTION) → X'te değil.
    const w7 = await mkWo("7");
    await mkDispatch(w7, w7.step[stF]!, firmX.id, await mkRoll(w7, w7.step[stF]!, "IN_PRODUCTION"));

    const list = async (q: Record<string, string>): Promise<WoResult> =>
      (await svc.findAll({ query: { search: `${P}-IE`, pageSize: "200", ...q } } as unknown as Request)) as WoResult;
    const ids = (r: WoResult): string => r.data.map((w) => wos.indexOf(w.id) + 1).sort().join(",");
    const only = (r: WoResult, ...exp: Array<{ id: string }>): boolean =>
      r.data.length === exp.length && exp.every((e) => r.data.some((w) => w.id === e.id)) && r.pagination.total === exp.length;

    const all = await list({});
    check("süzgeçsiz: 7 İE listede", all.data.length === 7, ids(all));

    // ── fasonFirma ──────────────────────────────────────────────────────────
    const fx = await list({ "filter[fasonFirma]": firmX.id });
    check("firma X: yalnız açık sevkte dönmemiş topu olan W1", only(fx, w1), ids(fx));
    check("firma X: sevki iptal edilmiş AT_SUBCONTRACTOR top (W2) görünmez", !fx.data.some((w) => w.id === w2.id));
    check("firma X: dönmüş top (W3) görünmez", !fx.data.some((w) => w.id === w3.id));
    check("firma X: yalnız planda yazılı (W4) görünmez", !fx.data.some((w) => w.id === w4.id));
    check("firma X: kalemi açık ama topu fabrikada (W7) görünmez", !fx.data.some((w) => w.id === w7.id));
    check("firma X: sayım = liste", fx.pagination.total === fx.data.length, `${fx.pagination.total}/${fx.data.length}`);
    const fy = await list({ "filter[fasonFirma]": firmY.id });
    check("firma Y (topu yok): boş", fy.data.length === 0 && fy.pagination.total === 0, ids(fy));
    const fxy = await list({ "filter[fasonFirma]": `${firmX.id},${firmY.id}` });
    check("firma X,Y (CSV): W1", only(fxy, w1), ids(fxy));

    // ── AND (mevcut "şu an nerede" süzgeçleriyle) ───────────────────────────
    const and1 = await list({ "filter[fasonFirma]": firmX.id, "filter[konumIstasyon]": stS1 });
    check("firma X + konumIstasyon S1: W1", only(and1, w1), ids(and1));
    const and2 = await list({ "filter[fasonFirma]": firmX.id, "filter[konumSinifi]": "FASONDA_EN_AZ_BIR" });
    check("firma X + Fasonda (en az bir top): W1", only(and2, w1), ids(and2));
    const and3 = await list({ "filter[fasonFirma]": firmX.id, "filter[konumIstasyon]": stS2 });
    check("firma X + konumIstasyon S2 (topu yok): boş", and3.data.length === 0 && and3.pagination.total === 0, ids(and3));
    const and4 = await list({ "filter[fasonFirma]": firmY.id, "filter[konumIstasyon]": stS1 });
    check("firma Y + konumIstasyon S1: boş", and4.data.length === 0, ids(and4));
    const cur = (await svc.findAll({
      query: { search: `${P}-IE`, limit: "1", cursor: "", "filter[fasonFirma]": firmX.id },
    } as unknown as Request)) as { data: Array<{ id: string }> };
    check("cursor yolu da süzgeci uygular", cur.data.length === 1 && cur.data[0]!.id === w1.id, String(cur.data.length));

    // ── fail-closed ─────────────────────────────────────────────────────────
    for (const [key, bad] of [
      ["fasonFirma", "abc"],
      ["fasonFirma", `${firmX.id},x`],
      ["fasonFirma", randomUUID()],
      ["fasonFirma", `${firmX.id},${randomUUID()}`],
    ] as const) {
      const e = await expectError(() => list({ [`filter[${key}]`]: bad }));
      check(`${key}=${bad.length > 40 ? "…" + bad.slice(-6) : bad} → 400 INVALID_FILTER_VALUE`, e?.statusCode === 400 && e.code === "INVALID_FILTER_VALUE", errStr(e));
    }
    const eStAsFirm = await expectError(() => list({ "filter[fasonFirma]": stS1 }));
    check("firma süzgecine istasyon kimliği → 400 (yanlış tablo kabul edilmez)", eStAsFirm?.statusCode === 400 && eStAsFirm.code === "INVALID_FILTER_VALUE", errStr(eStAsFirm));
    const eField = await expectError(() => list({ "filter[fasonFirma]": "abc" }));
    check("400 yanıtı alanı adlandırır (details.field=fasonFirma)", eField?.field === "fasonFirma", errStr(eField));

    // ── seçenek ucu ─────────────────────────────────────────────────────────
    const opt = await callWhereOptions();
    check("where-options: 200 + success", opt.status === 200 && opt.body.success === true, String(opt.status));
    const o = opt.body.data;
    const fxOpt = o.firms.find((f) => f.id === firmX.id);
    check("where-options: firma X sayısı +1 (yalnız W1)", (fxOpt?.workOrderCount ?? -1) - firmCountBefore(firmX.id) === 1, `${firmCountBefore(firmX.id)}→${fxOpt?.workOrderCount}`);
    const fyOpt = o.firms.find((f) => f.id === firmY.id);
    check("where-options: firma Y sayısı değişmedi", (fyOpt?.workOrderCount ?? 0) === firmCountBefore(firmY.id), `${fyOpt?.workOrderCount}`);
    // Seçenek sayısı = süzgeçli liste toplamı (arşivsiz, aynı yüklem).
    const fxAll = (await svc.findAll({ query: { pageSize: "1", "filter[fasonFirma]": firmX.id } } as unknown as Request)) as WoResult;
    check("where-options firma X sayısı = süzgeçli liste toplamı", fxAll.pagination.total === fxOpt?.workOrderCount, `${fxAll.pagination.total}/${fxOpt?.workOrderCount}`);
    const sorted = o.firms.every(
      (f, k) => k === 0 || o.firms[k - 1]!.workOrderCount > f.workOrderCount ||
        (o.firms[k - 1]!.workOrderCount === f.workOrderCount && o.firms[k - 1]!.name.localeCompare(f.name, "tr") <= 0),
    );
    check("where-options: firmalar sayıya göre azalan, sonra ad (0'lar sonda)", sorted);
    const shape = o.firms.every((x) => typeof x.id === "string" && typeof x.name === "string" && Number.isInteger(x.workOrderCount));
    check("where-options: biçim {firms:[{id,name,workOrderCount}]}, aşama listesi yok", shape && !("stages" in o), Object.keys(o).join(","));

    // Arşivlenmiş İE sayılmaz (liste varsayılanıyla aynı).
    await prisma.workOrder.update({ where: { id: w1.id }, data: { isActive: false } });
    const o2 = (await callWhereOptions()).body.data;
    const fx2 = o2.firms.find((f) => f.id === firmX.id)?.workOrderCount ?? 0;
    check("where-options: arşivli W1 sayılmaz (firma X öncekine döner)", fx2 === firmCountBefore(firmX.id), `${fx2}`);
  } finally {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...wos, ...rolls] } } }).catch(() => {});
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatches } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatches } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rolls } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rolls } } });
    await prisma.batch.deleteMany({ where: { id: { in: batches } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: wos } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: wos } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: wos } } });
    await prisma.station.deleteMany({ where: { id: { in: stations } } });
    await prisma.item.deleteMany({ where: { id: { in: items } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (err) => {
  console.error("Beklenmeyen hata:", err);
  await prisma.$disconnect();
  process.exitCode = 1;
});
