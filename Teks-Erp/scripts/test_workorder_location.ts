// =============================================================================
// Test: Terbiye iş emri "Şu an nerede" — konum özeti + süzgeçler (2026-10-24)
// Çalıştır: npx tsx scripts/test_workorder_location.ts
// Kaynak: `src/services/helpers/workorder-location.helper.ts` (WorkOrderService.findAll).
// Kurulum: 3 TEST istasyonu (Kurşun iç · Tambur iç · Boyahane dış) + TEST fasoncu +
//   altı iş emri: BAS (PLANNED, topsuz) · TEK (2 top Kurşun'da) · BOL (3 Kurşun · 2 fasonda
//   Boyahane · 1 Tambur) · FAS (2 top fasonda) · BIT (COMPLETED; top depoda + TAMBUR_CONSUMED
//   ölü top Tambur adımında) · OLU (1 Kurşun canlı + CANCELLED ölü top Tambur adımında).
// Doğrulananlar:
//   §1 özet: beş sınıf + dağılım sırası (çok top → az) + metre + fasoncu adı; ölü top sayılmaz.
//   §2 BOĞAZ İKİZİ: her sınıf süzgecinin döndürdüğü fikstür kümesi == özette o sınıfı taşıyanlar
//      (bellek-içi `classifyWorkOrderLocation` ↔ Prisma/SQL `workOrderLocationClassWhere`); CSV = VEYA.
//   §3 `konumIstasyon`: "en az bir CANLI topu bu istasyonda" — ölü/depodaki top eşleşmez; CSV.
//   §4 fail-closed: tanınmayan sınıf / uuid olmayan istasyon → 400 INVALID_FILTER_VALUE.
//   §5 tek where: cursor sayfaları + `totalEstimate` + offset `total` aynı küme.
//   §6 saf sınıflayıcı: ölü statü grubu yok sayılır; fason+iç karışık → BOLUNMUS.
// NEGATİF SONDA (2026-10-24, kırmızı görüldü, tek tek): `LOCATION_LIVE_STATUSES`e CANCELLED
//   eklendi → §1h §3a §3c §3d §6a ❌ (5) · FASONDA süzgecinden `NOT: HAS_INHOUSE_LIVE` düştü →
//   §2 FASONDA §2b ❌ (2) · SQL `>= 2` → `>= 1` → §2 TEK_ISTASYON §2 BOLUNMUS §3d ❌ (3).
// =============================================================================
import { Request } from "express";
import { RollStatus, StationKind, StationType, WorkOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import {
  WORK_ORDER_LOCATION_CLASSES,
  classifyWorkOrderLocation,
  type WorkOrderLocation,
  type WorkOrderLocationClass,
} from "../src/services/helpers/workorder-location.helper";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

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

function makeReq(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

interface Row {
  id: string;
  workOrderNumber: string;
  konum: WorkOrderLocation;
}
interface ListResult {
  data: Row[];
  pagination: { total?: number; totalEstimate?: number; nextCursor?: string | null; hasMore?: boolean };
}

async function main(): Promise<void> {
  const ts = Date.now();
  const tag = `TEST-WOLOC-${ts}`;
  const short = String(ts).slice(-8);
  const svc = new WorkOrderService();
  const dye = await ensureTestDyeHouse();

  const created = {
    stations: [] as string[],
    wos: [] as string[],
    rolls: [] as string[],
    dispatches: [] as string[],
    batches: [] as string[],
  };
  const item = await prisma.item.create({
    data: { code: `${tag}-ITM`, name: `TEST WOLOC KUMAS ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const mkStation = async (suffix: string, name: string, type: StationType, kind: StationKind) => {
    const s = await prisma.station.create({
      data: { code: `TWL-${suffix}-${short}`, name: `${name} ${short}`, type, kind },
      select: { id: true, name: true },
    });
    created.stations.push(s.id);
    return s;
  };

  try {
    const sK = await mkStation("K", "TEST Kurşun", StationType.INTERNAL, StationKind.PROCESS_QC);
    const sT = await mkStation("T", "TEST Tambur", StationType.INTERNAL, StationKind.TAMBUR);
    const sB = await mkStation("B", "TEST Boyahane", StationType.EXTERNAL, StationKind.SUBCONTRACTOR);

    const mkWo = async (suffix: string, status: WorkOrderStatus, stations: { id: string }[]) => {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `${tag}-${suffix}`,
          status,
          steps: { create: stations.map((s, i) => ({ stationId: s.id, stepSequence: i + 1 })) },
        },
        select: { id: true, steps: { select: { id: true, stationId: true }, orderBy: { stepSequence: "asc" } } },
      });
      created.wos.push(wo.id);
      const stepOf = (st: { id: string }) => wo.steps.find((x) => x.stationId === st.id)!.id;
      return { id: wo.id, no: `${tag}-${suffix}`, stepOf };
    };
    let seq = 0;
    const mkRolls = async (n: number, status: RollStatus, currentStepId: string | null, qty = 50) => {
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const r = await prisma.roll.create({
          data: {
            barcode: `${tag}-R${++seq}`,
            itemId: item.id,
            initialQty: qty,
            currentQty: qty,
            status,
            currentStepId,
          },
          select: { id: true },
        });
        created.rolls.push(r.id);
        ids.push(r.id);
      }
      return ids;
    };
    const mkDispatch = async (woId: string, stepId: string, rollIds: string[]) => {
      const batch = await prisma.batch.create({ data: { batchNumber: `${tag}-P${++seq}`, workOrderId: woId }, select: { id: true } });
      created.batches.push(batch.id);
      const d = await prisma.subcontractorDispatch.create({
        data: { dispatchNo: `${tag}-SD${++seq}`, workOrderId: woId, batchId: batch.id, stepId, subcontractorId: dye.id, totalQty: 50 * rollIds.length },
        select: { id: true },
      });
      created.dispatches.push(d.id);
      for (const rollId of rollIds) {
        await prisma.subcontractorDispatchItem.create({ data: { dispatchId: d.id, rollId, dispatchedQty: 50 } });
      }
    };

    const BAS = await mkWo("BAS", WorkOrderStatus.PLANNED, [sK]);
    const TEK = await mkWo("TEK", WorkOrderStatus.IN_PROGRESS, [sK, sT]);
    await mkRolls(2, RollStatus.IN_PRODUCTION, TEK.stepOf(sK), 40);
    const BOL = await mkWo("BOL", WorkOrderStatus.IN_PROGRESS, [sB, sK, sT]);
    await mkRolls(3, RollStatus.IN_PRODUCTION, BOL.stepOf(sK), 30);
    await mkDispatch(BOL.id, BOL.stepOf(sB), await mkRolls(2, RollStatus.AT_SUBCONTRACTOR, BOL.stepOf(sB)));
    await mkRolls(1, RollStatus.IN_PRODUCTION, BOL.stepOf(sT), 25);
    const FAS = await mkWo("FAS", WorkOrderStatus.IN_PROGRESS, [sB, sT]);
    await mkDispatch(FAS.id, FAS.stepOf(sB), await mkRolls(2, RollStatus.AT_SUBCONTRACTOR, FAS.stepOf(sB)));
    const BIT = await mkWo("BIT", WorkOrderStatus.COMPLETED, [sT]);
    await mkRolls(1, RollStatus.WAREHOUSE, null);
    await mkRolls(1, RollStatus.TAMBUR_CONSUMED, BIT.stepOf(sT));
    const OLU = await mkWo("OLU", WorkOrderStatus.IN_PROGRESS, [sK, sT]);
    await mkRolls(1, RollStatus.IN_PRODUCTION, OLU.stepOf(sK));
    await mkRolls(1, RollStatus.CANCELLED, OLU.stepOf(sT));

    const list = async (extra: Record<string, string> = {}): Promise<ListResult> =>
      (await svc.findAll(makeReq({ search: tag, pageSize: "200", ...extra }))) as ListResult;
    const byNo = (r: ListResult) => new Map(r.data.map((w) => [w.workOrderNumber, w]));
    const nos = (r: ListResult) => new Set(r.data.map((w) => w.workOrderNumber));

    // ── §1 özet ─────────────────────────────────────────────────────────────
    const all = byNo(await list());
    const k = (no: string) => all.get(no)?.konum;
    check("§1a BAS (PLANNED, topsuz) → BASLAMADI, istasyon yok", k(BAS.no)?.sinif === "BASLAMADI" && k(BAS.no)?.istasyonlar.length === 0);
    const tek = k(TEK.no);
    check("§1b TEK → TEK_ISTASYON, Kurşun · 2 top · 80 m", tek?.sinif === "TEK_ISTASYON" && tek.istasyonlar.length === 1 &&
      tek.istasyonlar[0].istasyonId === sK.id && tek.istasyonlar[0].topSayisi === 2 && tek.istasyonlar[0].metre === 80 && tek.canliTop === 2,
      JSON.stringify(tek?.istasyonlar));
    const bol = k(BOL.no);
    check("§1c ⭐ BOL → BOLUNMUS, sıra Kurşun(3) · Boyahane(2) · Tambur(1), canlı 6",
      bol?.sinif === "BOLUNMUS" && bol.canliTop === 6 && bol.istasyonlar.map((e) => e.istasyonId).join() === [sK.id, sB.id, sT.id].join() &&
      bol.istasyonlar.map((e) => e.topSayisi).join() === "3,2,1", JSON.stringify(bol?.istasyonlar.map((e) => [e.ad, e.topSayisi])));
    const bolB = bol?.istasyonlar.find((e) => e.istasyonId === sB.id);
    check("§1d BOL Boyahane girdisi dış + fasondaTop 2 + fasoncu adı (açık sevkten), tür SUBCONTRACTOR",
      !!bolB && bolB.dis && bolB.fasondaTop === 2 && bolB.fasoncular.includes(dye.name) && bolB.tur === "SUBCONTRACTOR",
      JSON.stringify(bolB));
    check("§1e BOL iç istasyon girdisinde fasondaTop 0, fasoncu yok",
      !!bol && bol.istasyonlar.filter((e) => !e.dis).every((e) => e.fasondaTop === 0 && e.fasoncular.length === 0));
    const fas = k(FAS.no);
    check("§1f FAS → FASONDA, Boyahane · 2 top, fasoncu adı", fas?.sinif === "FASONDA" && fas.istasyonlar.length === 1 && fas.istasyonlar[0].fasoncular.includes(dye.name));
    check("§1g ⭐ BIT (depodaki top + TAMBUR_CONSUMED ölü top adımda) → BITTI, canlı 0", k(BIT.no)?.sinif === "BITTI" && k(BIT.no)?.canliTop === 0);
    const olu = k(OLU.no);
    check("§1h ⭐ OLU (CANCELLED ölü top Tambur adımında) → TEK_ISTASYON Kurşun · 1 top; Tambur görünmez",
      olu?.sinif === "TEK_ISTASYON" && olu.istasyonlar.length === 1 && olu.istasyonlar[0].istasyonId === sK.id && olu.canliTop === 1,
      JSON.stringify(olu?.istasyonlar.map((e) => e.ad)));

    // ── §2 boğaz ikizi: süzgeç kümesi == özet sınıfı ───────────────────────────
    const fixtureNos = [BAS, TEK, BOL, FAS, BIT, OLU].map((w) => w.no);
    for (const cls of WORK_ORDER_LOCATION_CLASSES) {
      const got = nos(await list({ "filter[konumSinifi]": cls }));
      const expected = new Set(fixtureNos.filter((no) => k(no)?.sinif === cls));
      const same = got.size === expected.size && [...got].every((n) => expected.has(n));
      check(`§2 ${cls}: süzgeç ↔ özet aynı küme`, same && expected.size > 0, `süzgeç=[${[...got].map((n) => n.slice(-3))}] özet=[${[...expected].map((n) => n.slice(-3))}]`);
    }
    const csv = nos(await list({ "filter[konumSinifi]": "FASONDA,BASLAMADI" }));
    check("§2b CSV VEYA: FASONDA,BASLAMADI → FAS + BAS", csv.size === 2 && csv.has(FAS.no) && csv.has(BAS.no));

    // ── §3 konumIstasyon ───────────────────────────────────────────────────
    const atT = nos(await list({ "filter[konumIstasyon]": sT.id }));
    check("§3a ⭐ Tambur → yalnız BOL (BIT/OLU'nun Tambur adımındaki top ÖLÜ)", atT.size === 1 && atT.has(BOL.no), [...atT].join());
    const atK = nos(await list({ "filter[konumIstasyon]": sK.id }));
    check("§3b Kurşun → TEK, BOL, OLU", atK.size === 3 && [TEK, BOL, OLU].every((w) => atK.has(w.no)));
    const atBT = nos(await list({ "filter[konumIstasyon]": `${sB.id},${sT.id}` }));
    check("§3c CSV Boyahane,Tambur → BOL, FAS", atBT.size === 2 && atBT.has(BOL.no) && atBT.has(FAS.no));
    const both = nos(await list({ "filter[konumIstasyon]": sK.id, "filter[konumSinifi]": "BOLUNMUS" }));
    check("§3d istasyon + sınıf VE: Kurşun ∧ BOLUNMUS → yalnız BOL", both.size === 1 && both.has(BOL.no));

    // ── §4 fail-closed ─────────────────────────────────────────────────────
    const code400 = async (q: Record<string, string>): Promise<string> => {
      try {
        await list(q);
        return "200";
      } catch (e) {
        const err = e as { statusCode?: number; details?: { code?: string } };
        return `${err.statusCode}:${err.details?.code}`;
      }
    };
    check("§4a tanınmayan sınıf → 400 INVALID_FILTER_VALUE", (await code400({ "filter[konumSinifi]": "UZAYDA" })) === "400:INVALID_FILTER_VALUE");
    check("§4b uuid olmayan istasyon → 400 INVALID_FILTER_VALUE", (await code400({ "filter[konumIstasyon]": "kursun" })) === "400:INVALID_FILTER_VALUE");
    check("§4c küçük harf sınıf da tanınmaz (sessiz eşleme yok)", (await code400({ "filter[konumSinifi]": "fasonda" })) === "400:INVALID_FILTER_VALUE");

    // ── §5 tek where: cursor + totalEstimate + offset total ──────────────────
    const q = { search: tag, "filter[konumSinifi]": "TEK_ISTASYON,BOLUNMUS,FASONDA" };
    const off = (await svc.findAll(makeReq({ ...q, pageSize: "200" }))) as ListResult;
    const seen: string[] = [];
    let cursor: string | undefined;
    let estimate: number | undefined;
    for (let i = 0; i < 10; i++) {
      const page = (await svc.findAll(makeReq({ ...q, cursor: cursor ?? "", limit: "1", withTotal: "true" }))) as ListResult;
      estimate ??= page.pagination.totalEstimate;
      seen.push(...page.data.map((w) => w.workOrderNumber));
      if (!page.pagination.nextCursor) break;
      cursor = page.pagination.nextCursor;
    }
    check("§5 cursor sayfaları (limit 1) + totalEstimate + offset total aynı küme (4: TEK, BOL, FAS, OLU)",
      off.pagination.total === 4 && estimate === 4 && seen.length === 4 && new Set(seen).size === 4 && seen.every((n) => nos(off).has(n)),
      `offset=${off.pagination.total} tahmin=${estimate} cursor=${seen.length}`);

    // ── §6 saf sınıflayıcı ──────────────────────────────────────────────────
    const c = (s: WorkOrderStatus, g: Array<[string, RollStatus, number]>): WorkOrderLocationClass =>
      classifyWorkOrderLocation(s, g.map(([stationId, status, count]) => ({ stationId, status, count })));
    check("§6a ölü statü grubu yok sayılır (CANCELLED x5 + 1 canlı → TEK)", c("IN_PROGRESS", [["a", "CANCELLED", 5], ["b", "IN_PRODUCTION", 1]]) === "TEK_ISTASYON");
    check("§6b fason + iç karışık iki istasyon → BOLUNMUS", c("IN_PROGRESS", [["a", "AT_SUBCONTRACTOR", 1], ["b", "IN_PRODUCTION", 1]]) === "BOLUNMUS");
    check("§6c iki fason istasyonunda tamamı dışarıda → FASONDA", c("IN_PROGRESS", [["a", "AT_SUBCONTRACTOR", 1], ["b", "AT_SUBCONTRACTOR", 1]]) === "FASONDA");
    check("§6d aynı istasyonda fasonda + sevk bekleyen → TEK", c("IN_PROGRESS", [["a", "AT_SUBCONTRACTOR", 1], ["a", "IN_PRODUCTION", 1]]) === "TEK_ISTASYON");
    check("§6e canlı yok: PLANNED → BASLAMADI, CANCELLED → BITTI", c("PLANNED", []) === "BASLAMADI" && c("CANCELLED", []) === "BITTI");
  } finally {
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: created.dispatches } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: created.dispatches } } });
    await prisma.roll.deleteMany({ where: { id: { in: created.rolls } } });
    await prisma.batch.deleteMany({ where: { id: { in: created.batches } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: created.wos } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: created.wos } } });
    await prisma.station.deleteMany({ where: { id: { in: created.stations } } });
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
