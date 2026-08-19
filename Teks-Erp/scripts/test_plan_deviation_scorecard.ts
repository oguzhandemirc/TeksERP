// =============================================================================
// PLAN-SAPMA KARNESİ bekçisi (2026-08-19)
// =============================================================================
// EN KRİTİK KONTROL — §2 ÇİFT SAYIM: renk VE en birlikte sapan bir onay deftere
// İKİ satır yazar (alan başına bir) ama BİR imzadır ve mal depoya BİR KEZ iner.
// Karne `COUNT(DISTINCT confirmationId)` ve imza başına TEK `qtyM` ile saymak
// ZORUNDA; naif `COUNT(*)`/`SUM(qtyM)` o topu iki kez sayar ve rakam sessizce
// şişer. Bu bekçi tam o sapmayı ölçer (negatif sonda ile kırmızı verdiği
// doğrulanmalı).
//
// Diğer sözleşme noktaları: dönem süzgeci (aralık dışı satır girmez), compare
// dönemi (`previous`), alan kırılımının SATIR bazlı olması (aynı imzada iki
// olay gerçekten iki olaydır), operatör/kumaş kırılımlarının imza bazlı olması.
//
// Fixture defter satırlarını DOĞRUDAN yazar (kapıdan geçmeye gerek yok — kapı
// zaten `test_tambur_plan_gate.ts`te ölçülüyor): karne bir OKUMA katmanıdır ve
// bekçisi de okuma sözleşmesini ölçmeli.
import { randomUUID } from "node:crypto";
import { RollStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { getPlanDeviationScorecard } from "../src/services/reports/plan-deviation-scorecard.report.service";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}${d ? ` — ${d}` : ""}`);
  c ? pass++ : fail++;
};

const rollIds: string[] = [];
const woIds: string[] = [];
const itemIds: string[] = [];
const colorIds: string[] = [];
const userIds: string[] = [];

(async () => {
  const ts = `${process.pid}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  // Dönem: fixture satırları BUGÜNE yazılır; aralık dünden yarına.
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 3600 * 1000);
  const to = new Date(now.getTime() + 24 * 3600 * 1000);
  // Karşılaştırma dönemi: önceki 2 gün (fixture'da 1 imza var).
  const prevFrom = new Date(now.getTime() - 72 * 3600 * 1000);
  const prevTo = new Date(now.getTime() - 48 * 3600 * 1000);

  try {
    const color = await prisma.color.create({
      data: { code: `TEST-PDS-MAVI-${ts}`, name: `TEST PDS MAVI ${ts}` },
      select: { id: true, name: true },
    });
    colorIds.push(color.id);
    const item = await prisma.item.create({
      data: { code: `TEST-PDS-ITM-${ts}`, name: `TEST PDS KUMAS ${ts}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true, name: true },
    });
    itemIds.push(item.id);
    const user = await prisma.user.create({
      data: {
        username: `test-pds-${ts}`,
        fullName: `TEST PDS OPERATOR ${ts}`,
        passwordHash: "test-only-not-a-real-hash",
      },
      select: { id: true, fullName: true },
    });
    userIds.push(user.id);
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-PDS-IE-${ts}`, status: "IN_PROGRESS" },
      select: { id: true, workOrderNumber: true },
    });
    woIds.push(wo.id);
    const makeRoll = async (n: number) => {
      const r = await prisma.roll.create({
        data: {
          barcode: `TEST-PDS-R-${ts}-${n}`,
          itemId: item.id,
          colorId: color.id,
          initialQty: 100,
          currentQty: 100,
          status: RollStatus.WAREHOUSE,
          entrySource: "SUPPLIER_RECEIPT",
        },
        select: { id: true },
      });
      rollIds.push(r.id);
      return r.id;
    };
    const rollA = await makeRoll(1);
    const rollB = await makeRoll(2);
    const rollOld = await makeRoll(3);

    /** Tek imza (confirmationId) — alan başına satır. */
    const writeConfirmation = async (opts: {
      rollId: string;
      fields: ("color" | "width")[];
      qtyM: number;
      when?: Date;
      userId?: string | null;
    }) => {
      const confirmationId = randomUUID();
      await prisma.rollPlanDeviation.createMany({
        data: opts.fields.map((f) => ({
          confirmationId,
          rollId: opts.rollId,
          childRollId: null,
          workOrderId: wo.id,
          workOrderStepId: null,
          field: f,
          rollValue: f === "color" ? "MAVİ" : "345",
          planValue: f === "color" ? "GRİ" : "330",
          qtyM: opts.qtyM,
          source: "finalize",
          confirmedById: opts.userId === undefined ? user.id : opts.userId,
          ...(opts.when ? { createdAt: opts.when } : {}),
        })),
      });
      return confirmationId;
    };

    // ① renk+en birlikte sapan TEK imza, 100 m
    await writeConfirmation({ rollId: rollA, fields: ["color", "width"], qtyM: 100 });
    // ② yalnız renk sapan imza, 40 m
    await writeConfirmation({ rollId: rollB, fields: ["color"], qtyM: 40 });
    // ③ ÖNCEKİ dönemde bir imza (dönem süzgeci + compare kanıtı), 999 m
    await writeConfirmation({
      rollId: rollOld,
      fields: ["color"],
      qtyM: 999,
      when: new Date(now.getTime() - 60 * 3600 * 1000),
    });

    const card = await getPlanDeviationScorecard({ from, to }, { from: prevFrom, to: prevTo });

    // ── §1. Başlık metrikleri ────────────────────────────────────────────────
    console.log("§1 Başlık");
    ok(card.summary.confirmations === 2, "§1 imza sayısı 2 (3 satır ama 2 onay)", String(card.summary.confirmations));
    // ⚠️ §2 ÇİFT SAYIM: naif SUM(qtyM) 100+100+40 = 240 verirdi.
    console.log("§2 Çift sayım kilidi");
    ok(
      card.summary.deviatedQtyM === 140,
      "§2 plan-dışı metraj 140 (imza başına TEK qtyM — naif SUM 240 verirdi)",
      String(card.summary.deviatedQtyM),
    );
    ok(card.summary.affectedRolls === 2, "§2b etkilenen top sayısı 2", String(card.summary.affectedRolls));

    // ── §3. Alan kırılımı SATIR bazlı (aynı imzada iki olay = iki olay) ──────
    console.log("§3 Alan kırılımı");
    ok(
      card.summary.byField.color.events === 2 && card.summary.byField.width.events === 1,
      "§3 olay sayıları renk=2 en=1 (satır bazlı — meşru)",
      `renk=${card.summary.byField.color.events} en=${card.summary.byField.width.events}`,
    );

    // ── §4. Dönem süzgeci ────────────────────────────────────────────────────
    console.log("§4 Dönem");
    ok(
      !card.detail.some((d) => d.qtyM === 999),
      "§4 dönem DIŞI satır (999 m) karneye girmedi",
    );
    ok(
      card.previous?.confirmations === 1 && card.previous?.deviatedQtyM === 999,
      "§4b compare dönemi doldu (1 imza / 999 m)",
      JSON.stringify(card.previous),
    );

    // ── §5. Kırılımlar imza bazlı ────────────────────────────────────────────
    console.log("§5 Kırılımlar");
    const opRow = card.byOperator.find((r) => r.label.includes("TEST PDS OPERATOR"));
    ok(
      opRow?.confirmations === 2 && opRow?.qtyM === 140,
      "§5 operatör kırılımı imza bazlı (2 imza / 140 m)",
      JSON.stringify(opRow),
    );
    const icRow = card.byItemColor.find((r) => r.label.includes("TEST PDS KUMAS"));
    ok(
      icRow?.confirmations === 2 && icRow?.qtyM === 140,
      "§5b kumaş+renk kırılımı imza bazlı",
      JSON.stringify(icRow),
    );

    // ── §6. Gün serisi ───────────────────────────────────────────────────────
    console.log("§6 Gün serisi");
    const dayTotal = card.daily.reduce((a, d) => a + d.qtyM, 0);
    const dayConfs = card.daily.reduce((a, d) => a + d.confirmations, 0);
    ok(
      Math.abs(dayTotal - 140) < 0.001 && dayConfs === 2,
      "§6 gün serisi toplamı başlıkla tutarlı (140 m / 2 imza)",
      `qty=${dayTotal} conf=${dayConfs}`,
    );

    // ── §7. Detay satırı alanları ────────────────────────────────────────────
    console.log("§7 Detay");
    const detailRow = card.detail.find((d) => d.field === "width");
    ok(
      detailRow?.rollValue === "345" && detailRow?.planValue === "330" && detailRow?.workOrderNumber === wo.workOrderNumber,
      "§7 detay satırı değerleri + iş emri no taşır",
      JSON.stringify(detailRow),
    );
    ok(
      card.detail.every((d) => d.confirmedBy?.includes("TEST PDS OPERATOR")),
      "§7b onaylayan adı çözüldü",
    );

    // ── §8. Compare istenmezse ikinci sorgu koşmaz ───────────────────────────
    const noCompare = await getPlanDeviationScorecard({ from, to }, null);
    ok(noCompare.previous === null, "§8 compare yoksa previous null");
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.message : e);
  } finally {
    try {
      await prisma.rollPlanDeviation.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      await prisma.color.deleteMany({ where: { id: { in: colorIds } } });
      console.log("(temizlendi — TEST-PDS fixture silindi)");
    } catch (e) {
      console.error("cleanup hata:", e instanceof Error ? e.message : e);
    }
    await prisma.$disconnect();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
