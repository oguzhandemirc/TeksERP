// =============================================================================
// Bekçi: dokuma işi (WeavingOrder) YAZMA YÜZEYİ — 2026-09-13
// Çalıştır: npx tsx scripts/run-all-tests.ts weaving_order
// =============================================================================
// NE ÖLÇÜYOR — ve NE ÖLÇMÜYOR:
//
//   §1 OLUŞTUR      DK+GGAAYY+NNNN sıralı numara · XOR 400 (SUBCONTRACTED ⇔
//                   fasoncu) · kumaş-dışı kart 400 · plannedM ≤ 0 400 · tarih sırası.
//   §2 REPLAY       `clientToken` dört durum: aynı yük → aynı kayıt; başka yük →
//                   409 CLIENT_TOKEN_COLLISION; iptal edilmiş → 409 WEAVING_ORDER_CANCELLED.
//   §3 DÜZENLE      yalnız açık durumda (kapanmış/iptal → 409 NOT_EDITABLE); XOR
//                   birleşik görünümde ölçülür.
//   §4 KAPANIŞ      açık koşum varken 409 HAS_OPEN_RUNS {machines[], runIds[]} ·
//                   koşum kapanınca COMPLETED · ikinci kapatma 409 NOT_OPEN ·
//                   plannedM'e ulaşmak KAPATMAZ.
//   §5 İPTAL        açık koşumla 409 · sebep zorunlu · defter satırlarına dokunmaz
//                   (koşum satırı birebir aynı) · ikinci iptal 409.
//   §6 LİSTE/DETAY  durum süzgeci sunucuda · cursor tekrarsız · openRunCount.
//   §7 AUDIT        her yazma `system_logs`a WEAVING_ORDER satırı (tx dışında).
//   §8 DB CHECK     `weaving_orders_party_ck` servisi ATLAYAN yazımı da reddeder.
//
//   ⛔ IN_PROGRESS DALI BUGÜN ERİŞİLEMEZ: `PLANNED → IN_PROGRESS` geçişi bu
//      yüzeyde YOK (sözleşme yazılı değil; sahibi P2b koşum-açma ucu). §0 bunu
//      ölçer: yazan yol 0. P2b o yolu açtığında §0 KIRMIZI verir ve o gün
//      "IN_PROGRESS'ten kapat/iptal" davranışı buraya YAZILIR — "basılmayan
//      dalın yeşili" sınıfı doğmasın diye.
//   ⛔ HTTP katmanı (Zod, izin, modül kapısı) burada ÖLÇÜLMEZ — statik kapılar
//      (`test_route_auth_coverage` · `test_permission_catalog` · `test_swagger_spec`)
//      ve d9'un HTTP sondaları.
//
// Fixture: TST-WVO-* business-key; finally'de FK sırasıyla temizlenir.
//
// Negatif sonda (2026-09-13, ölçüldü): close() açık-koşum kontrolü atlandı → 3 ❌
// (§4a §4b §4d); replay canlılık kontrolü atlandı → 1 ❌ (§2c); create PLANNED
// yerine IN_PROGRESS yazdı → 5 ❌ (§0b §1a §4d §6a §6b). sha256 ile geri yüklendi.
// =============================================================================

import { ItemUnit, WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import {
  cancelWeavingOrder,
  closeWeavingOrder,
  createWeavingOrder,
  getWeavingOrder,
  listWeavingOrders,
  updateWeavingOrder,
} from "../src/services/weaving-order.service";
import { ensureTestAdmin } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const ts = Date.now();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

type Err = { statusCode?: number; details?: Record<string, unknown> } | null;
async function catchErr(fn: () => Promise<unknown>): Promise<Err> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Err;
  }
}
const codeOf = (e: Err): string => String(e?.details?.code ?? "");

const woIds: string[] = [];
const ids = { station: "", machine: "", itemFabric: "", itemYarn: "", sub: "" };

async function cleanup(): Promise<void> {
  if (ids.machine) await prisma.machineRun.deleteMany({ where: { machineId: ids.machine } });
  if (woIds.length > 0) {
    await prisma.systemLog.deleteMany({ where: { tableName: "WEAVING_ORDER", recordId: { in: woIds } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: woIds } } });
  }
  if (ids.machine) await prisma.machine.deleteMany({ where: { id: ids.machine } });
  if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  await prisma.item.deleteMany({ where: { code: { startsWith: `TST-WVO-ITM-`, endsWith: `-${ts}` } } });
  await prisma.subcontractor.deleteMany({ where: { code: `TST-WVO-SUB-${ts}` } });
}

function track<T extends { data: { id: string } }>(r: T): T {
  if (!woIds.includes(r.data.id)) woIds.push(r.data.id);
  return r;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`❌ ${engel}`);
    process.exit(1);
  }
  const admin = await ensureTestAdmin();
  const uid = admin.id;

  try {
    const station = await prisma.station.create({
      data: { name: `TST-WVO-IST-${ts}`, code: `TST-WVO-S-${ts}`.slice(0, 32), type: "INTERNAL", kind: "PROCESS_QC", isActive: true },
      select: { id: true },
    });
    ids.station = station.id;
    const machine = await prisma.machine.create({
      data: { stationId: station.id, name: `Tezgah WVO ${ts}`, code: `TST-WVO-M-${ts}`.slice(0, 32), isActive: true },
      select: { id: true },
    });
    ids.machine = machine.id;
    const itemFabric = await prisma.item.create({
      data: { code: `TST-WVO-ITM-F-${ts}`, name: `WVO Kumaş ${ts}`, itemType: "FABRIC", unit: ItemUnit.MT },
      select: { id: true },
    });
    ids.itemFabric = itemFabric.id;
    const itemYarn = await prisma.item.create({
      data: { code: `TST-WVO-ITM-Y-${ts}`, name: `WVO İplik ${ts}`, itemType: "YARN", unit: ItemUnit.KG },
      select: { id: true },
    });
    ids.itemYarn = itemYarn.id;
    const sub = await prisma.subcontractor.create({
      data: { code: `TST-WVO-SUB-${ts}`, name: `WVO Fasoncu ${ts}` },
      select: { id: true },
    });
    ids.sub = sub.id;

    // ── §0 IN_PROGRESS dalı erişilemez (statik) ─────────────────────────────
    console.log("=== §0 IN_PROGRESS dalı ===");
    {
      const SRC = path.resolve(__dirname, "..", "src");
      const walk = (d: string, out: string[] = []): string[] => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p, out);
          else if (p.endsWith(".ts")) out.push(p);
        }
        return out;
      };
      const files = walk(SRC);
      const writers = files.filter((f) => /status:\s*WeavingOrderStatus\.IN_PROGRESS\b/.test(fs.readFileSync(f, "utf8")));
      const closers = files.filter((f) => /status:\s*WeavingOrderStatus\.COMPLETED\b/.test(fs.readFileSync(f, "utf8")));
      check("§0a pozitif kontrol: desen COMPLETED yazarını görüyor (≥1)", closers.length >= 1, `${closers.length}`);
      check(
        "§0b IN_PROGRESS yazan yol 0 — dal bugün ERİŞİLEMEZ; P2b açınca bu ölçüm KIRMIZI verir ve davranış buraya yazılır",
        writers.length === 0,
        writers.map((f) => path.relative(SRC, f)).join(", "),
      );
    }

    // ── §1 oluştur ──────────────────────────────────────────────────────────
    console.log("\n=== §1 oluştur ===");
    const a = track(await createWeavingOrder({ itemId: itemFabric.id, executionKind: WeavingExecutionKind.IN_HOUSE, plannedM: 500 }, uid));
    check("§1a IN_HOUSE oluştu → PLANNED", a.data.status === WeavingOrderStatus.PLANNED, a.data.status);
    check("§1b numara DK+GGAAYY+NNNN", /^DK\d{6}\d{4}$/.test(a.data.weavingOrderNumber), a.data.weavingOrderNumber);
    const b = track(await createWeavingOrder({ itemId: itemFabric.id, executionKind: WeavingExecutionKind.SUBCONTRACTED, subcontractorId: sub.id }, uid));
    const seqA = Number(a.data.weavingOrderNumber.slice(-4));
    const seqB = Number(b.data.weavingOrderNumber.slice(-4));
    check("§1c ikinci iş numarası ardışık (+1)", seqB === seqA + 1, `${a.data.weavingOrderNumber} → ${b.data.weavingOrderNumber}`);
    check("§1d openRunCount 0 doğar", a.data.openRunCount === 0);
    const e1 = await catchErr(() => createWeavingOrder({ itemId: itemFabric.id, executionKind: WeavingExecutionKind.SUBCONTRACTED }, uid));
    check("§1e SUBCONTRACTED + fasoncu yok → 400", e1?.statusCode === 400, String(e1?.statusCode));
    const e2 = await catchErr(() => createWeavingOrder({ itemId: itemFabric.id, executionKind: WeavingExecutionKind.IN_HOUSE, subcontractorId: sub.id }, uid));
    check("§1f IN_HOUSE + fasoncu → 400", e2?.statusCode === 400, String(e2?.statusCode));
    const e3 = await catchErr(() => createWeavingOrder({ itemId: itemYarn.id, executionKind: WeavingExecutionKind.IN_HOUSE }, uid));
    check("§1g iplik kartına dokuma işi → 400", e3?.statusCode === 400, String(e3?.statusCode));
    const e4 = await catchErr(() => createWeavingOrder({ itemId: itemFabric.id, executionKind: WeavingExecutionKind.IN_HOUSE, plannedM: 0 }, uid));
    check("§1h plannedM 0 → 400", e4?.statusCode === 400, String(e4?.statusCode));
    const e5 = await catchErr(() =>
      createWeavingOrder(
        { itemId: itemFabric.id, executionKind: WeavingExecutionKind.IN_HOUSE, plannedStartDate: "2026-09-20T00:00:00Z", plannedEndDate: "2026-09-19T00:00:00Z" },
        uid,
      ),
    );
    check("§1i bitiş < başlangıç → 400", e5?.statusCode === 400, String(e5?.statusCode));

    // ── §2 replay ───────────────────────────────────────────────────────────
    console.log("\n=== §2 replay ===");
    const token = randomUUID();
    const payload = { itemId: itemFabric.id, executionKind: WeavingExecutionKind.IN_HOUSE, plannedM: 120, clientToken: token };
    const r1 = track(await createWeavingOrder(payload, uid));
    const r2 = await createWeavingOrder(payload, uid);
    check("§2a aynı token + aynı yük → aynı kayıt (idempotent)", r2.data.id === r1.data.id && /zaten/.test(r2.message ?? ""), r2.message);
    const e6 = await catchErr(() => createWeavingOrder({ ...payload, plannedM: 999 }, uid));
    check("§2b aynı token + BAŞKA yük → 409 CLIENT_TOKEN_COLLISION", e6?.statusCode === 409 && codeOf(e6) === "CLIENT_TOKEN_COLLISION", `${e6?.statusCode} ${codeOf(e6)}`);
    await cancelWeavingOrder(r1.data.id, "replay sondası", uid);
    const e7 = await catchErr(() => createWeavingOrder(payload, uid));
    check("§2c token'lı iş İPTAL edilmişse replay → 409 WEAVING_ORDER_CANCELLED", e7?.statusCode === 409 && codeOf(e7) === "WEAVING_ORDER_CANCELLED", `${e7?.statusCode} ${codeOf(e7)}`);

    // ── §3 düzenle ──────────────────────────────────────────────────────────
    console.log("\n=== §3 düzenle ===");
    const u1 = await updateWeavingOrder(a.data.id, { notes: "  deneme  ", plannedM: "750.5" }, uid);
    check("§3a açık işte notes/plannedM güncellendi", u1.data.notes === "deneme" && u1.data.plannedM === 750.5, JSON.stringify({ n: u1.data.notes, m: u1.data.plannedM }));
    const e8 = await catchErr(() => updateWeavingOrder(r1.data.id, { notes: "x" }, uid));
    check("§3b iptal edilmiş iş düzenlenemez → 409 WEAVING_ORDER_NOT_EDITABLE", e8?.statusCode === 409 && codeOf(e8) === "WEAVING_ORDER_NOT_EDITABLE", `${e8?.statusCode} ${codeOf(e8)}`);
    const e9 = await catchErr(() => updateWeavingOrder(a.data.id, { executionKind: WeavingExecutionKind.SUBCONTRACTED }, uid));
    check("§3c XOR birleşik görünümde: kind→SUBCONTRACTED, fasoncu yok → 400", e9?.statusCode === 400, String(e9?.statusCode));
    const e10 = await catchErr(() => updateWeavingOrder(a.data.id, {}, uid));
    check("§3d boş yama → 400", e10?.statusCode === 400, String(e10?.statusCode));

    // ── §4 kapanış ──────────────────────────────────────────────────────────
    console.log("\n=== §4 kapanış ===");
    const run = await prisma.machineRun.create({
      data: { machineId: machine.id, productionLineNo: 1, startedAt: new Date(ts - 3_600_000), weavingOrderId: a.data.id },
      select: { id: true },
    });
    const e11 = await catchErr(() => closeWeavingOrder(a.data.id, uid));
    const d11 = (e11?.details ?? {}) as { machines?: Array<{ machineName?: string; runId?: string }>; runIds?: string[] };
    check("§4a açık koşumla kapatma → 409 WEAVING_ORDER_HAS_OPEN_RUNS", e11?.statusCode === 409 && codeOf(e11) === "WEAVING_ORDER_HAS_OPEN_RUNS", `${e11?.statusCode} ${codeOf(e11)}`);
    check(
      "§4b 409 koşumları ADIYLA söyler (machines[] + runIds[])",
      d11.machines?.[0]?.machineName === `Tezgah WVO ${ts}` && d11.runIds?.includes(run.id) === true,
      JSON.stringify(d11),
    );
    const g1 = await getWeavingOrder(a.data.id);
    check("§4c detay openRunCount 1", g1.data.openRunCount === 1, String(g1.data.openRunCount));
    // plannedM'e ULAŞILDI (750.5 planlı, koşum 900 m üretti) — iş KAPANMAZ.
    await prisma.machineRun.update({ where: { id: run.id }, data: { endedAt: new Date(), producedM: 900 } });
    const g2 = await getWeavingOrder(a.data.id);
    check("§4d plannedM aşıldı ama durum PLANNED kaldı (kapanış türetilmez)", g2.data.status === WeavingOrderStatus.PLANNED && g2.data.openRunCount === 0, g2.data.status);
    const c1 = await closeWeavingOrder(a.data.id, uid);
    check("§4e koşum kapanınca kapatma → COMPLETED + closedAt", c1.data.status === WeavingOrderStatus.COMPLETED && c1.data.closedAt !== null, c1.data.status);
    const e12 = await catchErr(() => closeWeavingOrder(a.data.id, uid));
    check("§4f ikinci kapatma → 409 WEAVING_ORDER_NOT_OPEN (atomik claim)", e12?.statusCode === 409 && codeOf(e12) === "WEAVING_ORDER_NOT_OPEN", `${e12?.statusCode} ${codeOf(e12)}`);
    const e13 = await catchErr(() => closeWeavingOrder(randomUUID(), uid));
    check("§4g olmayan iş → 404", e13?.statusCode === 404, String(e13?.statusCode));

    // ── §5 iptal ────────────────────────────────────────────────────────────
    console.log("\n=== §5 iptal ===");
    const run2 = await prisma.machineRun.create({
      data: { machineId: machine.id, productionLineNo: 1, startedAt: new Date(ts - 1_800_000), weavingOrderId: b.data.id },
      select: { id: true },
    });
    const e14 = await catchErr(() => cancelWeavingOrder(b.data.id, "yanlış açıldı", uid));
    check("§5a açık koşumla iptal → 409 WEAVING_ORDER_HAS_OPEN_RUNS", e14?.statusCode === 409 && codeOf(e14) === "WEAVING_ORDER_HAS_OPEN_RUNS", `${e14?.statusCode} ${codeOf(e14)}`);
    await prisma.machineRun.update({ where: { id: run2.id }, data: { endedAt: new Date(), producedM: 40 } });
    const e15 = await catchErr(() => cancelWeavingOrder(b.data.id, "   ", uid));
    check("§5b boş sebep → 400", e15?.statusCode === 400, String(e15?.statusCode));
    const runBefore = await prisma.machineRun.findUniqueOrThrow({ where: { id: run2.id } });
    const x1 = await cancelWeavingOrder(b.data.id, "yanlış açıldı", uid);
    check("§5c iptal → CANCELLED + sebep + cancelledAt", x1.data.status === WeavingOrderStatus.CANCELLED && x1.data.cancelReason === "yanlış açıldı" && x1.data.cancelledAt !== null, x1.data.status);
    const runAfter = await prisma.machineRun.findUniqueOrThrow({ where: { id: run2.id } });
    check(
      "§5d iptal DEFTER SATIRINA DOKUNMADI (koşum birebir: weavingOrderId · endedAt · producedM · updatedAt)",
      runAfter.weavingOrderId === b.data.id &&
        runAfter.endedAt?.getTime() === runBefore.endedAt?.getTime() &&
        String(runAfter.producedM) === String(runBefore.producedM) &&
        runAfter.updatedAt.getTime() === runBefore.updatedAt.getTime(),
    );
    const e16 = await catchErr(() => cancelWeavingOrder(b.data.id, "tekrar", uid));
    check("§5e ikinci iptal → 409 WEAVING_ORDER_NOT_OPEN", e16?.statusCode === 409 && codeOf(e16) === "WEAVING_ORDER_NOT_OPEN", `${e16?.statusCode} ${codeOf(e16)}`);
    const e17 = await catchErr(() => cancelWeavingOrder(a.data.id, "kapanmışı iptal", uid));
    check("§5f kapanmış iş iptal edilemez → 409 WEAVING_ORDER_NOT_OPEN", e17?.statusCode === 409 && codeOf(e17) === "WEAVING_ORDER_NOT_OPEN", `${e17?.statusCode} ${codeOf(e17)}`);

    // ── §6 liste / detay ────────────────────────────────────────────────────
    console.log("\n=== §6 liste ===");
    const c2 = track(await createWeavingOrder({ itemId: itemFabric.id, executionKind: WeavingExecutionKind.IN_HOUSE }, uid));
    const l1 = await listWeavingOrders({ itemId: itemFabric.id, status: [WeavingOrderStatus.PLANNED], withTotal: true });
    check("§6a durum süzgeci SUNUCUDA: yalnız PLANNED (c2), kapanmış/iptal yok", l1.data.length === 1 && l1.data[0]?.id === c2.data.id, `${l1.data.length}`);
    check("§6b totalEstimate aynı where'den = 1", l1.pagination.totalEstimate === 1, String(l1.pagination.totalEstimate));
    const p1 = await listWeavingOrders({ itemId: itemFabric.id, limit: 2 });
    const p2 = p1.pagination.nextCursor ? await listWeavingOrders({ itemId: itemFabric.id, limit: 2, cursor: p1.pagination.nextCursor }) : null;
    const seen = new Set([...p1.data.map((r) => r.id), ...(p2?.data.map((r) => r.id) ?? [])]);
    check("§6c cursor: 2+2 sayfa, tekrarsız (4 iş: a · b · r1 · c2)", p1.data.length === 2 && p1.pagination.hasMore && p2 !== null && seen.size === 4, `${p1.data.length} + ${p2?.data.length ?? "-"} → ${seen.size}`);
    const s1 = await listWeavingOrders({ search: a.data.weavingOrderNumber });
    check("§6d numara ile arama", s1.data.some((r) => r.id === a.data.id));

    // ── §7 audit ────────────────────────────────────────────────────────────
    console.log("\n=== §7 audit ===");
    const logsA = await prisma.systemLog.findMany({ where: { tableName: "WEAVING_ORDER", recordId: a.data.id }, select: { action: true } });
    check("§7a a: CREATE + UPDATE(düzenle) + UPDATE(kapat) = 3 audit satırı", logsA.length === 3 && logsA.filter((l) => l.action === "CREATE").length === 1, JSON.stringify(logsA));
    const logsB = await prisma.systemLog.count({ where: { tableName: "WEAVING_ORDER", recordId: b.data.id, action: "UPDATE" } });
    check("§7b b: iptal audit UPDATE satırı yazdı", logsB >= 1, String(logsB));

    // ── §8 DB CHECK (servisi atlayan yazım) ─────────────────────────────────
    console.log("\n=== §8 DB CHECK ===");
    const e18 = await catchErr(() =>
      prisma.weavingOrder.create({
        data: { weavingOrderNumber: `DK-PROBE-${ts}`, itemId: itemFabric.id, executionKind: WeavingExecutionKind.SUBCONTRACTED },
      }),
    );
    check("§8a servisi atlayan SUBCONTRACTED+fasoncusuz INSERT DB'de reddedilir (weaving_orders_party_ck)", e18 !== null && /weaving_orders_party_ck/.test(String((e18 as { message?: string }).message ?? "")), String((e18 as { message?: string })?.message ?? "").slice(0, 80));
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Beklenmeyen hata:", err);
  await cleanup().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
