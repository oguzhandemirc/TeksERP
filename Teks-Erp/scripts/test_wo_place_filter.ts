// =============================================================================
// Test: İş emri listesi "şu an hangi fasonda / hangi aşamada" süzgeçleri (2.11.5)
// Çalıştır: npx tsx scripts/test_wo_place_filter.ts
// =============================================================================
// `filter[fasonFirma]` = topu ŞU AN o firmaya giden açık sevkte dönmemiş (planda
// yazılı firma YETMEZ); `filter[asama]` = topu ŞU AN o istasyonda IN_PRODUCTION.
// Yüklem tek kaynak (`roll-place.helper`), İE↔top bağı `fasonda` süzgeciyle aynı.
// Sayım listeyle aynı where'den; UUID değil / kayıt yok → 400 INVALID_FILTER_VALUE;
// seçenek ucu (`GET /where-options`) listenin süzgeçlerini AYNEN alır ve FACETED
// sayar (kendi anahtarı hariç süzgeçler + o seçenek) → seçenek sayısı = seçilince
// liste toplamı; fason (EXTERNAL) istasyonu aşama değildir.
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
}
async function expectError(fn: () => Promise<unknown>): Promise<CaughtError | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    const e = err as { message?: string; statusCode?: number; details?: { code?: unknown } };
    return { message: e.message ?? String(err), statusCode: e.statusCode, code: e.details?.code };
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
  stages: Opt[];
}

/** Controller köprüsü dahil: yanıt zarfı `{success, data}` ve durum kodu. */
async function callWhereOptions(query: Record<string, string> = {}): Promise<{ status: number; body: { success: boolean; data: Options } }> {
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
  await handler({ query } as unknown as Request, res, (e?: unknown) => {
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
    // W6: top S1 adımına bağlı ama depoda (IN_PRODUCTION değil) → aşamada değil.
    const w6 = await mkWo("6");
    await mkRoll(w6, w6.step[stS1]!, "WAREHOUSE");
    // W7: top Y'de (açık sevk) — faceted sayımda karşı firma ayrımı için. Liste
    // tarih süzgeci senaryosu için açılışı 60 gün önce; W5 PLANNED (durum süzgeci).
    const w7 = await mkWo("7");
    await mkDispatch(w7, w7.step[stF]!, firmY.id, await mkRoll(w7, w7.step[stF]!, "AT_SUBCONTRACTOR"));
    await prisma.workOrder.update({ where: { id: w7.id }, data: { createdAt: new Date(Date.now() - 60 * 86_400_000) } });
    await prisma.workOrder.update({ where: { id: w5.id }, data: { status: "PLANNED" } });

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
    check("firma X: sayım = liste", fx.pagination.total === fx.data.length, `${fx.pagination.total}/${fx.data.length}`);
    const fy = await list({ "filter[fasonFirma]": firmY.id });
    check("firma Y: yalnız W7", only(fy, w7), ids(fy));
    const fxy = await list({ "filter[fasonFirma]": `${firmX.id},${firmY.id}` });
    check("firma X,Y (CSV): W1 + W7", only(fxy, w1, w7), ids(fxy));

    // ── asama ───────────────────────────────────────────────────────────────
    const s1 = await list({ "filter[asama]": stS1 });
    check("aşama S1: üretimdeki topu olan W1 + W5", only(s1, w1, w5), ids(s1));
    check("aşama S1: depodaki top (W6) görünmez", !s1.data.some((w) => w.id === w6.id));
    const s2 = await list({ "filter[asama]": stS2 });
    check("aşama S2 (topu yok): boş", s2.data.length === 0, ids(s2));
    const eF = await expectError(() => list({ "filter[asama]": stF }));
    check("aşama = fason (EXTERNAL) istasyon → 400 (fason aşama değildir)", eF?.statusCode === 400 && eF.code === "INVALID_FILTER_VALUE", errStr(eF));

    // ── AND ─────────────────────────────────────────────────────────────────
    const and1 = await list({ "filter[fasonFirma]": firmX.id, "filter[asama]": stS1 });
    check("firma X + aşama S1: W1", only(and1, w1), ids(and1));
    const and2 = await list({ "filter[fasonFirma]": firmX.id, "filter[asama]": stS1, "filter[fasonda]": "1" });
    check("firma X + aşama S1 + fasonda: W1", only(and2, w1), ids(and2));
    const and3 = await list({ "filter[fasonda]": "1", "filter[asama]": stS1 });
    check("fasonda + aşama S1: W1 (W2 fasonda ama S1'de değil, W5 S1'de ama fasonda değil)", only(and3, w1), ids(and3));
    const and4 = await list({ "filter[fasonFirma]": firmY.id, "filter[asama]": stS1 });
    check("firma Y + aşama S1: boş", and4.data.length === 0, ids(and4));
    const cur = (await svc.findAll({
      query: { search: `${P}-IE`, limit: "1", cursor: "", "filter[asama]": stS1 },
    } as unknown as Request)) as { data: Array<{ id: string }> };
    check("cursor yolu da süzgeci uygular", cur.data.length <= 1 && cur.data.every((w) => w.id === w1.id || w.id === w5.id), String(cur.data.length));

    // ── fail-closed ─────────────────────────────────────────────────────────
    for (const [key, bad] of [
      ["fasonFirma", "abc"],
      ["asama", "abc"],
      ["fasonFirma", `${firmX.id},x`],
      ["fasonFirma", randomUUID()],
      ["asama", randomUUID()],
      ["asama", `${stS1},${randomUUID()}`],
    ] as const) {
      const e = await expectError(() => list({ [`filter[${key}]`]: bad }));
      check(`${key}=${bad.length > 40 ? "…" + bad.slice(-6) : bad} → 400 INVALID_FILTER_VALUE`, e?.statusCode === 400 && e.code === "INVALID_FILTER_VALUE", errStr(e));
    }
    const eFirmAsStage = await expectError(() => list({ "filter[asama]": firmX.id }));
    check("aşama süzgecine firma kimliği → 400 (yanlış tablo kabul edilmez)", eFirmAsStage?.statusCode === 400 && eFirmAsStage.code === "INVALID_FILTER_VALUE", errStr(eFirmAsStage));

    // ── seçenek ucu ─────────────────────────────────────────────────────────
    const scope = { search: `${P}-IE` };
    const opt = await callWhereOptions(scope);
    check("where-options: 200 + success", opt.status === 200 && opt.body.success === true, String(opt.status));
    const o = opt.body.data;
    const st = (id: string): Opt | undefined => o.stages.find((s) => s.id === id);
    check("where-options: S1 sayısı 2 (W1, W5)", st(stS1)?.workOrderCount === 2, JSON.stringify(st(stS1)));
    check("where-options: fason (EXTERNAL) istasyonu aşama seçeneğinde YOK", st(stF) === undefined, JSON.stringify(st(stF)));
    check("where-options: S2 aktif + 0 sayılı listede (üretim aşaması 0'da da kalır)", st(stS2)?.workOrderCount === 0, JSON.stringify(st(stS2)));
    const fxOpt = o.firms.find((f) => f.id === firmX.id);
    check("where-options: kapsamda firma X sayısı 1 (W1)", fxOpt?.workOrderCount === 1, JSON.stringify(fxOpt));
    const sorted = o.stages.every((s, i) => i === 0 || o.stages[i - 1]!.workOrderCount >= s.workOrderCount);
    check("where-options: aşamalar sayıya göre azalan", sorted);
    const shape = [...o.firms, ...o.stages].every((x) => typeof x.id === "string" && typeof x.name === "string" && Number.isInteger(x.workOrderCount));
    check("where-options: biçim {id,name,workOrderCount}", shape);
    // Kapsamsız (global) da seçenek = liste toplamı.
    const gx = (await callWhereOptions()).body.data.firms.find((f) => f.id === firmX.id)?.workOrderCount;
    const fxAll = (await svc.findAll({ query: { pageSize: "1", "filter[fasonFirma]": firmX.id } } as unknown as Request)) as WoResult;
    check("where-options (süzgeçsiz) firma X sayısı = süzgeçli liste toplamı", fxAll.pagination.total === gx, `${fxAll.pagination.total}/${gx}`);

    // ── FACETED: her süzgeç birleşiminde seçenek sayısı = o seçenek seçilince liste toplamı ──
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const combos: Array<[string, Record<string, string>]> = [
      ["yalnız kapsam", {}],
      ["tarih aralığı (son 30 gün)", { dateField: "createdAt", dateFrom: since30 }],
      ["durum IN_PROGRESS", { "filter[status]": "IN_PROGRESS" }],
      ["karşı anahtar fasonFirma=X", { "filter[fasonFirma]": firmX.id }],
      ["karşı anahtar asama=S1", { "filter[asama]": stS1 }],
      ["tarih + durum + fasonda", { dateField: "createdAt", dateFrom: since30, "filter[status]": "IN_PROGRESS", "filter[fasonda]": "1" }],
      ["tarih + firma X + aşama S1", { dateField: "createdAt", dateFrom: since30, "filter[fasonFirma]": firmX.id, "filter[asama]": stS1 }],
    ];
    for (const [label, q] of combos) {
      const oc = (await callWhereOptions({ ...scope, ...q })).body.data;
      const mism: string[] = [];
      for (const [key, opts, pick] of [
        ["fasonFirma", oc.firms, [firmX.id, firmY.id]],
        ["asama", oc.stages, [stS1, stS2]],
      ] as const) {
        for (const id of pick) {
          const n = opts.find((x) => x.id === id)?.workOrderCount ?? 0;
          const l = await list({ ...q, [`filter[${key}]`]: id });
          if (l.pagination.total !== n) mism.push(`${key}:${id.slice(0, 6)} seçenek ${n} ≠ liste ${l.pagination.total}`);
        }
      }
      check(`faceted [${label}]: seçenek sayısı = liste toplamı`, mism.length === 0, mism.join(" · ") || "ok");
    }
    // Somut beklentiler (sondaların gücü): tarih süzgeci W7'yi düşürür; durum W5'i;
    // karşı anahtar kendi anahtarını yok sayar.
    const oDate = (await callWhereOptions({ ...scope, dateField: "createdAt", dateFrom: since30 })).body.data;
    check("faceted tarih: firma Y 0 (W7 60 gün önce)", (oDate.firms.find((f) => f.id === firmY.id)?.workOrderCount ?? 0) === 0);
    const oSt = (await callWhereOptions({ ...scope, "filter[status]": "IN_PROGRESS" })).body.data;
    check("faceted durum: S1 1 (W5 PLANNED düşer)", oSt.stages.find((s) => s.id === stS1)?.workOrderCount === 1, JSON.stringify(oSt.stages.find((s) => s.id === stS1)));
    const oFx = (await callWhereOptions({ ...scope, "filter[fasonFirma]": firmX.id })).body.data;
    check("faceted kendi anahtarı hariç: fasonFirma=X iken firma Y yine 1", oFx.firms.find((f) => f.id === firmY.id)?.workOrderCount === 1, JSON.stringify(oFx.firms.find((f) => f.id === firmY.id)));
    check("faceted karşı anahtar: fasonFirma=X iken S1 1 (W1)", oFx.stages.find((s) => s.id === stS1)?.workOrderCount === 1);

    // ── seçenek ucu fail-closed: liste ile AYNI hata ───────────────────────
    for (const [key, bad] of [
      ["fasonFirma", "abc"],
      ["asama", "abc"],
      ["fasonFirma", randomUUID()],
      ["asama", randomUUID()],
      ["asama", stF],
    ] as const) {
      const q = { ...scope, [`filter[${key}]`]: bad };
      const eo = await expectError(() => callWhereOptions(q));
      const el = await expectError(() => list(q));
      check(
        `where-options ${key}=${bad.slice(-6)} → listeyle aynı 400`,
        eo?.statusCode === 400 && eo.code === "INVALID_FILTER_VALUE" && eo.message === el?.message,
        `${errStr(eo)} | ${errStr(el)}`,
      );
    }

    // Arşivlenmiş İE sayılmaz (liste varsayılanıyla aynı); withArchived ile sayılır.
    await prisma.workOrder.update({ where: { id: w5.id }, data: { isActive: false } });
    const o2 = (await callWhereOptions(scope)).body.data;
    check("where-options: arşivli W5 sayılmaz (S1 → 1)", o2.stages.find((s) => s.id === stS1)?.workOrderCount === 1, JSON.stringify(o2.stages.find((s) => s.id === stS1)));
    const o3 = (await callWhereOptions({ ...scope, withArchived: "true" })).body.data;
    check("where-options: withArchived=true ile W5 sayılır (S1 → 2)", o3.stages.find((s) => s.id === stS1)?.workOrderCount === 2);
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
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
