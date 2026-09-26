// =============================================================================
// TEST: İŞ EMRİ HAREKET DEFTERİ — durum boğazları satır yazar (D1)
// Çalıştır: npx tsx scripts/test_workorder_event_ledger.ts
// =============================================================================
// Tasarım: docs/design/IS-EMRI-HAREKET-DEFTERI.md §4, §12. Fikstür GERÇEK yazma
// yollarından geçer (create · lockWorkOrder · completeWorkOrder · softDelete ·
// hardDelete · ensureWorkOrderInProgress · completeWorkOrderIfStepsDone ·
// reopenWorkOrderTx):
//   §1 doğuş: create → CREATED (fromValue null, etiket = iş emri no)
//   §2 kilit: PLANNED→IN_PROGRESS tek satır, tekrarı satır YAZMAZ (idempotent)
//   §3 elle kapanış: IN_PROGRESS→COMPLETED, sebep + tetik
//   §4 yeniden açma: COMPLETED→IN_PROGRESS KARŞI KAYIT (from/to takaslı), tekrarı yok
//   §5 otomatik kapanış: adımlar bitince COMPLETED, tetik çağırandan
//   §6 iptal: →CANCELLED, sebep hem kolonda hem satırda
//   §7 arşiv: isActive true→false FIELD_CHANGED
//   §8 kanal: istek bağlamında tablet cihazı → TABLET + cihaz kimliği; bağlamsız → SYSTEM
//   §9 mühür: satır UPDATE edilemez; iş emri silinince kaskat geçer (teardown).
//      Doğrudan DELETE reddi: ortak fonksiyonun bekçisi + `test_db_invariants` zamanlaması
//   §10 saat: iş emrinin olayları KESİN ARTAN damga taşır — son olay gelecekte olsa da yenisi ondan
//       sonra damgalanır; aynı tx'te ardışık yazımlar da ayrışır (Prisma'nın ms'lik istemci saatinde
//       ardışık iki yazımın 600 komşudan 108–212'si aynı ms'e düşüyordu; zaman çizelgesi (an, id)
//       sıralı olduğu için sıra rastgele UUID'e kalıyordu — ölçüldü 2026-09-26). Tx geri alınır.
//   NEGATİF SONDA (2026-09-26, md5 ile geri alındı): yazar damgayı vermez (Prisma varsayılanı) →
//       §10 ❌ · "son olay + 1 ms" terimi kalkar → §10 ❌
// NEGATİF SONDA (elle, 2026-09-25): `claimWorkOrderStatusTx` içindeki defter
// yazımı yoruma alındı → §2/§3/§4/§5/§6/§8 kırmızı; md5 ile geri alındı.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import {
  completeWorkOrderIfStepsDone,
  ensureWorkOrderInProgress,
} from "../src/services/helpers/roll-step.helper";
import { randomUUID } from "node:crypto";
import {
  claimWorkOrderStatusTx,
  recordWorkOrderFieldChangesTx,
  reopenWorkOrderTx,
} from "../src/services/helpers/workorder-event.helper";
import { runWithRequestContext } from "../src/lib/request-context";
import { StepStatus, WorkOrderStatus } from "@prisma/client";
import type { Request } from "express";
import { ensureTestAdmin } from "./fixture-test-user";

const svc = new WorkOrderService();
class GeriAl extends Error {}

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let ITEM = "", ADMIN = "", ST_KURSUN = "", ST_TAMBUR = "";
const woIds: string[] = [];

async function fikstur(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed' + 'seed:fixtures')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  ADMIN = (await ensureTestAdmin()).id;
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
}

async function yeniWo(): Promise<string> {
  const res = await svc.create(
    {
      type: "STOCK_PRODUCTION",
      targetItemId: ITEM,
      width: 180,
      steps: [{ stationId: ST_KURSUN }, { stationId: ST_TAMBUR }],
    },
    ADMIN,
  );
  const id = (res.data as { id: string }).id;
  woIds.push(id);
  return id;
}

const olaylar = (workOrderId: string) =>
  prisma.workOrderEvent.findMany({ where: { workOrderId }, orderBy: { createdAt: "asc" } });

const statuOlaylari = async (workOrderId: string) =>
  (await olaylar(workOrderId)).filter((e) => e.type === "STATUS_CHANGED").map((e) => `${e.fromValue}→${e.toValue}`);

/** İstek bağlamında koşar — tablet cihazıyla gelen bir HTTP isteğinin taklidi. */
function tabletIstegi<T>(fn: () => Promise<T>): Promise<T> {
  const req = {
    device: { id: "d-row", deviceId: "TST-WOE-TABLET", name: "tablet", machineId: null, kind: "TABLET" },
    user: { userId: ADMIN },
    ip: "127.0.0.1",
  } as unknown as Request;
  return new Promise<T>((resolve, reject) => {
    runWithRequestContext(req, () => { fn().then(resolve, reject); });
  });
}

async function main(): Promise<void> {
  console.log("=== İş emri hareket defteri — durum boğazları ===");
  await fikstur();
  try {
    // §1 doğuş
    const a = await yeniWo();
    const dogus = (await olaylar(a)).filter((e) => e.type === "CREATED");
    const aNo = (await prisma.workOrder.findUniqueOrThrow({ where: { id: a }, select: { workOrderNumber: true } })).workOrderNumber;
    check("§1 create → tek CREATED satırı", dogus.length === 1, `${dogus.length}`);
    check("§1b doğuşta fromValue yok, etiket iş emri no, tetik WO_CREATE, aktör fikstür kullanıcısı",
      dogus[0]?.fromValue === null && dogus[0]?.toLabel === aNo && dogus[0]?.trigger === "WO_CREATE" && dogus[0]?.createdById === ADMIN);
    check("§1c bağlamsız çağrı kanalı SYSTEM", dogus[0]?.channel === "SYSTEM", dogus[0]?.channel ?? "-");

    // §2 kilit + idempotent
    await svc.lockWorkOrder(a, ADMIN);
    await prisma.$transaction((tx) => ensureWorkOrderInProgress(tx, a));
    check("§2 kilit PLANNED→IN_PROGRESS tek satır; tekrarı satır yazmaz",
      JSON.stringify(await statuOlaylari(a)) === JSON.stringify(["PLANNED→IN_PROGRESS"]), (await statuOlaylari(a)).join(","));

    // §3 elle kapanış
    await svc.completeWorkOrder(a, { reason: "TST-WOE elle kapanış" }, ADMIN);
    const kapanis = (await olaylar(a)).find((e) => e.toValue === "COMPLETED");
    check("§3 elle kapanış IN_PROGRESS→COMPLETED, tetik MANUAL_COMPLETE, sebep satırda",
      kapanis?.fromValue === "IN_PROGRESS" && kapanis?.trigger === "MANUAL_COMPLETE" && kapanis?.reason === "TST-WOE elle kapanış"
        && kapanis?.fromLabel === "Devam Ediyor" && kapanis?.toLabel === "Tamamlandı");

    // §4 yeniden açma — karşı kayıt, ikincisi no-op
    const acildi = await prisma.$transaction((tx) => reopenWorkOrderTx(tx, a, { trigger: "TST_REOPEN" }));
    const ikinci = await prisma.$transaction((tx) => reopenWorkOrderTx(tx, a, { trigger: "TST_REOPEN" }));
    const st = await statuOlaylari(a);
    check("§4 yeniden açma COMPLETED→IN_PROGRESS KARŞI KAYIT; ikinci deneme satır yazmaz",
      acildi && !ikinci && st.join(",") === "PLANNED→IN_PROGRESS,IN_PROGRESS→COMPLETED,COMPLETED→IN_PROGRESS", st.join(","));
    check("§4b ileri satır DEĞİŞMEDİ (kapanış satırı hâlâ COMPLETED'e)",
      (await olaylar(a)).some((e) => e.id === kapanis?.id && e.toValue === "COMPLETED"));

    // §5 otomatik kapanış — adımlar bitince, tetik çağırandan
    await prisma.workOrderStep.updateMany({ where: { workOrderId: a }, data: { status: StepStatus.COMPLETED } });
    await prisma.$transaction((tx) => completeWorkOrderIfStepsDone(tx, a, { trigger: "TAMBUR_FINALIZE" }));
    const oto = (await olaylar(a)).filter((e) => e.trigger === "TAMBUR_FINALIZE");
    check("§5 otomatik kapanış satırı, tetik TAMBUR_FINALIZE", oto.length === 1 && oto[0].toValue === "COMPLETED");
    await prisma.$transaction((tx) => completeWorkOrderIfStepsDone(tx, a, { trigger: "TAMBUR_FINALIZE" }));
    check("§5b zaten COMPLETED iş emrinde ikinci satır YOK",
      (await olaylar(a)).filter((e) => e.trigger === "TAMBUR_FINALIZE").length === 1);

    // §6 iptal
    const b = await yeniWo();
    await svc.softDelete(b, ADMIN, { reason: "TST-WOE iptal sebebi" });
    const iptal = (await olaylar(b)).find((e) => e.toValue === "CANCELLED");
    const bRow = await prisma.workOrder.findUniqueOrThrow({ where: { id: b }, select: { status: true, cancelReason: true } });
    check("§6 iptal PLANNED→CANCELLED, sebep kolonda ve satırda, tetik WO_CANCEL",
      bRow.status === WorkOrderStatus.CANCELLED && bRow.cancelReason === "TST-WOE iptal sebebi"
        && iptal?.fromValue === "PLANNED" && iptal?.reason === "TST-WOE iptal sebebi" && iptal?.trigger === "WO_CANCEL");

    // §7 arşiv
    await svc.hardDelete(b, ADMIN);
    const arsiv = (await olaylar(b)).find((e) => e.type === "FIELD_CHANGED" && e.field === "isActive");
    check("§7 arşiv isActive true→false FIELD_CHANGED", arsiv?.fromValue === "true" && arsiv?.toValue === "false");

    // §8 kanal — tablet isteği
    const c = await yeniWo();
    await tabletIstegi(() => prisma.$transaction((tx) => ensureWorkOrderInProgress(tx, c, { trigger: "STEP_ACTIVE" })));
    const tab = (await olaylar(c)).find((e) => e.type === "STATUS_CHANGED");
    check("§8 tablet isteği → kanal TABLET, cihaz kimliği ve aktör bağlamdan",
      tab?.channel === "TABLET" && tab?.deviceId === "TST-WOE-TABLET" && tab?.createdById === ADMIN,
      `${tab?.channel} · ${tab?.deviceId}`);

    // §9 mühür
    const satir = (await olaylar(c))[0];
    let guncellendi = true;
    try { await prisma.workOrderEvent.update({ where: { id: satir.id }, data: { reason: "kurcalama" } }); }
    catch { guncellendi = false; }
    // Doğrudan DELETE reddi burada SINANMAZ: fonksiyonun davranışı ortak
    // `defter_block_tamper`ın kendi bekçisinde, bu tabloya DELETE zamanlamasıyla
    // bağlı olduğu `test_db_invariants`te ölçülür (silme sondası cırcırı büyütmez).
    check("§9 defter satırı UPDATE edilemez (mühür bu tabloya bağlı)", !guncellendi);

    // §10 saat — gelecekteki bir olay elle konur; yeni olay ondan SONRA damgalanmalı. Prisma'nın istemci
    // saati (ya da yalnız clock_timestamp()) yeniyi ondan ÖNCEYE ya da AYNI ana koyardı. Tx geri alınır.
    const d = await yeniWo();
    let saat: { gelecek: Date; yeni: Date; ardisik: Date[] } | null = null;
    await prisma.$transaction(async (tx) => {
      const [gelecek] = await tx.$queryRaw<Array<{ at: Date }>>`
        INSERT INTO "work_order_events" ("id","workOrderId","type","groupId","field","fromValue","toValue","trigger","channel","createdAt")
        VALUES (${randomUUID()}::uuid, ${d}::uuid, 'FIELD_CHANGED', ${randomUUID()}::uuid, 'notes', 'a', 'b', 'TST_FUTURE', 'SYSTEM',
          now() + interval '1 hour') -- tz-ok: timestamptz, sonda olayı bilerek gelecekte
        RETURNING "createdAt" AS at`;
      await claimWorkOrderStatusTx(tx, d, { from: [WorkOrderStatus.PLANNED], to: WorkOrderStatus.IN_PROGRESS, ctx: { trigger: "TST_SAAT" } });
      for (let i = 0; i < 20; i++) {
        await recordWorkOrderFieldChangesTx(tx, d, [{ field: "notes", from: `n${i}`, to: `n${i + 1}` }], { trigger: "TST_SAAT" });
      }
      const yazilan = await tx.workOrderEvent.findMany({ where: { workOrderId: d, trigger: "TST_SAAT" }, select: { type: true, createdAt: true } });
      saat = {
        gelecek: gelecek!.at,
        yeni: yazilan.find((e) => e.type === "STATUS_CHANGED")!.createdAt,
        ardisik: yazilan.filter((e) => e.type === "FIELD_CHANGED").map((e) => e.createdAt),
      };
      throw new GeriAl();
    }).catch((e: unknown) => { if (!(e instanceof GeriAl)) throw e; });
    const s10 = saat as { gelecek: Date; yeni: Date; ardisik: Date[] } | null;
    check("§10 yeni olay iş emrinin son (gelecekteki) olayından SONRA damgalanır",
      !!s10 && s10.yeni.getTime() > s10.gelecek.getTime(), s10 ? `${s10.gelecek.toISOString()} → ${s10.yeni.toISOString()}` : "-");
    const sirali = s10 ? [s10.yeni, ...s10.ardisik].map((x) => x.getTime()).sort((x, y) => x - y) : [];
    check("§10b aynı tx'te 21 ardışık olay KESİN ARTAN (eşit an yok)",
      sirali.length === 21 && sirali.every((t, i) => i === 0 || t > sirali[i - 1]!), `${new Set(sirali).size} farklı an`);
  } finally {
    await temizle();
  }
  // §9c kaskat: teardown iş emrini sildi, satırlar da gitti (teardown'u kilitlemez).
  const kalan = await prisma.workOrderEvent.count({ where: { workOrderId: { in: woIds } } });
  check("§9c iş emri silinince satırlar kaskatla gider", kalan === 0, `${kalan}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  const cards = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cards.map((c) => c.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  await prisma.systemLog.deleteMany({ where: { tableName: "WORK_ORDER", recordId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  process.exit(1);
});
