// =============================================================================
// "Boyahaneye Geri Gönder" — plan-sapma kararının REWORK kolu (2026-08-19)
// =============================================================================
// Tambur plan kapısında operatörün önünde iki cevap vardı ("yine de bitir" /
// "vazgeç"); gerçek karar çoğu zaman üçüncüsüdür: mal geri gitsin, yeniden
// boyansın. Bu bekçi o üçüncü yolun sözleşmesini kilitler.
//
// EN KRİTİK KONTROL — §2 İÇ BOYAHANE: hedef adım KANONİK yüklemle çözülür
// (`stepCanApplyColor`: istasyon bayrağı VEYA adımda seçilmiş fason hizmeti).
// `WorkOrderManualMoveService`in kendi `colorStep`'i YALNIZ `requiredCategory`
// okur — oradan çözülseydi iç boyahaneli rotada tuş "rotada boya adımı yok"
// derdi. Bu senaryo o sapmayı mekanik yakalar.
//
// Diğer sözleşme noktaları: hedef mevcut adımdan ÖNCEKİ en yakın boya adımıdır
// (sonraki hedef DEĞİL — ileri atlama "geri gönderme" değildir); taşıma topu
// AT_SUBCONTRACTOR YAPMAZ (fason çıkışı ayrı bir iştir); kalite/kurşun kararı
// VOID olur; kesim yapılmış top geri gönderilemez (CUT hard-stop).
//
// Fixture TEST-SD prefix'li, kendi ürettiğini siler; fason firması paylaşılan
// fixture yardımcısından çözülür (pasif seed firması tuzağı — CLAUDE.md).
import { RollStatus, StationKind, StationType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { TamburManualService } from "../src/services/tambur-manual.service";
import { AppError } from "../src/utils/app-error";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}${d ? ` — ${d}` : ""}`);
  c ? pass++ : fail++;
};
async function expectAppError(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e : null;
  }
}

const rollIds: string[] = [];
const woIds: string[] = [];
const stationIds: string[] = [];
const colorIds: string[] = [];
const itemIds: string[] = [];

(async () => {
  const svc = new TamburManualService();
  const ts = `${process.pid}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  try {
    const dyeHouse = await ensureTestDyeHouse();
    const tamburStation = await prisma.station.findFirstOrThrow({
      where: { kind: StationKind.TAMBUR, isActive: true },
      select: { id: true },
    });
    const [mavi, gri] = await Promise.all([
      prisma.color.create({ data: { code: `TEST-SD-MAVI-${ts}`, name: `TEST SD MAVI ${ts}` }, select: { id: true } }),
      prisma.color.create({ data: { code: `TEST-SD-GRI-${ts}`, name: `TEST SD GRI ${ts}` }, select: { id: true } }),
    ]);
    colorIds.push(mavi.id, gri.id);
    const item = await prisma.item.create({
      data: { code: `TEST-SD-ITM-${ts}`, name: `TEST SD KUMAS ${ts}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    itemIds.push(item.id);

    /** İÇ boyahane istasyonu — `appliesColor` İSTASYON bayrağından gelir (kategori YOK). */
    const innerDye = await prisma.station.create({
      data: {
        code: `TEST-SD-IBOYA-${ts}`,
        name: `TEST SD IC BOYAHANE ${ts}`,
        type: StationType.INTERNAL,
        kind: StationKind.OTHER,
        appliesColor: true,
      },
      select: { id: true },
    });
    stationIds.push(innerDye.id);
    /** Renk VERMEYEN ara istasyon (yıkama) — "en yakın önceki" kuralının kanıtı. */
    const plainStation = await prisma.station.create({
      data: {
        code: `TEST-SD-YIKAMA-${ts}`,
        name: `TEST SD YIKAMA ${ts}`,
        type: StationType.INTERNAL,
        kind: StationKind.OTHER,
        appliesColor: false,
      },
      select: { id: true },
    });
    stationIds.push(plainStation.id);

    /**
     * WO + rota + Tambur adımında IN_PRODUCTION top.
     * `steps`: [{stationId, requiredCategoryId?}] — Tambur adımı SONA eklenir.
     */
    const makeWo = async (steps: Array<{ stationId: string; requiredCategoryId?: string }>) => {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `TEST-SD-IE-${ts}-${woIds.length}`,
          status: "IN_PROGRESS",
          targetItemId: item.id,
          targetColorId: gri.id,
        },
        select: { id: true },
      });
      woIds.push(wo.id);
      const created: { id: string; seq: number }[] = [];
      let seq = 1;
      for (const st of steps) {
        const row = await prisma.workOrderStep.create({
          data: {
            workOrderId: wo.id,
            stationId: st.stationId,
            stepSequence: seq,
            status: "COMPLETED",
            requiredCategoryId: st.requiredCategoryId ?? null,
          },
          select: { id: true },
        });
        created.push({ id: row.id, seq });
        seq++;
      }
      const tamburStep = await prisma.workOrderStep.create({
        data: { workOrderId: wo.id, stationId: tamburStation.id, stepSequence: seq, status: "ACTIVE" },
        select: { id: true },
      });
      const roll = await prisma.roll.create({
        data: {
          barcode: `TEST-SD-R-${ts}-${rollIds.length}`,
          itemId: item.id,
          colorId: mavi.id,
          initialQty: 100,
          currentQty: 100,
          status: RollStatus.IN_PRODUCTION,
          currentStepId: tamburStep.id,
          entrySource: "SUPPLIER_RECEIPT",
        },
        select: { id: true },
      });
      rollIds.push(roll.id);
      await prisma.rollMovement.create({
        data: { rollId: roll.id, workOrderStepId: tamburStep.id, qtyIn: 100 },
      });
      return { woId: wo.id, steps: created, tamburStepId: tamburStep.id, rollId: roll.id };
    };

    // ── §1. FASON boyahane rotası: pozitif yol ────────────────────────────────
    console.log("§1 Fason boyahane rotası");
    const f1 = await makeWo([{ stationId: plainStation.id, requiredCategoryId: dyeHouse.categoryId }]);
    const prev1 = (await svc.getSendToDyePreview({ rollId: f1.rollId })).data as {
      canApply: boolean;
      targetStep: { id: string; stationName: string; isExternal: boolean };
      warnings: string[];
      effects: { direction: string; qualityWillVoid: boolean } | null;
    };
    ok(prev1.canApply === true, "§1 önizleme uygulanabilir");
    ok(prev1.targetStep.id === f1.steps[0]!.id, "§1 hedef = rotadaki fason boya adımı");
    ok(prev1.targetStep.isExternal === true, "§1 hedef FASON olarak işaretli (sevk hatırlatması buna bağlı)");
    ok(
      prev1.warnings.some((w) => w.includes("Fason Sevk")),
      "§1 uyarılarda 'Fason Sevk' hatırlatması var",
      prev1.warnings.join(" | "),
    );
    ok(prev1.effects?.direction === "backward", "§1 yön geri (backward)", prev1.effects?.direction ?? "-");

    const res1 = (await svc.sendToDye({ rollId: f1.rollId, reason: "mal mavi geldi, gri olacakti" })).data as {
      targetStep: { stationName: string; isExternal: boolean };
    };
    const roll1 = await prisma.roll.findUniqueOrThrow({
      where: { id: f1.rollId },
      select: { status: true, currentStepId: true, qualityGrade: true },
    });
    ok(roll1.currentStepId === f1.steps[0]!.id, "§1 top boya adımına taşındı");
    ok(
      roll1.status === RollStatus.IN_PRODUCTION,
      "§1 statü IN_PRODUCTION — taşıma AT_SUBCONTRACTOR YAPMAZ (çıkış ayrı iş)",
      roll1.status,
    );
    ok(res1.targetStep.isExternal === true, "§1 cevap fason bilgisini taşır (toast ayrımı)");
    const auditRow = await prisma.systemLog.findFirst({
      where: { recordId: f1.rollId, newData: { path: ["event"], equals: "TAMBUR_SEND_TO_DYE" } },
      select: { newData: true },
    });
    ok(auditRow !== null, "§1 audit satırı yazıldı (TAMBUR_SEND_TO_DYE)");

    // ── §2. İÇ boyahane (KANONİK YÜKLEM KANITI) ──────────────────────────────
    // ⚠️ Paketin en kritik negatifi: hedef `station.appliesColor` bayrağından
    // çözülmeli. moveService'in requiredCategory-yalnız çözümü kullanılırsa
    // burada 400 NO_DYE_STEP_IN_ROUTE alınır ve test kırmızı verir.
    console.log("§2 İç boyahane (istasyon bayrağı)");
    const f2 = await makeWo([{ stationId: innerDye.id }]);
    const prev2 = (await svc.getSendToDyePreview({ rollId: f2.rollId })).data as {
      canApply: boolean;
      targetStep: { id: string; isExternal: boolean };
    };
    ok(prev2.targetStep.id === f2.steps[0]!.id, "§2 İÇ boyahane adımı BULUNDU (kanonik yüklem)");
    ok(prev2.targetStep.isExternal === false, "§2 iç adım fason DEĞİL (kuyruk mesajı)");
    ok(prev2.canApply === true, "§2 uygulanabilir");

    // ── §3. Çoklu boya adımı: mevcut adımdan ÖNCEKİ EN YAKIN ─────────────────
    console.log("§3 Çoklu boya adımı");
    const f3 = await makeWo([
      { stationId: innerDye.id }, // seq 1 — uzak boya
      { stationId: plainStation.id }, // seq 2 — renk vermez
      { stationId: plainStation.id, requiredCategoryId: dyeHouse.categoryId }, // seq 3 — YAKIN boya
    ]);
    const prev3 = (await svc.getSendToDyePreview({ rollId: f3.rollId })).data as {
      targetStep: { id: string };
    };
    ok(
      prev3.targetStep.id === f3.steps[2]!.id,
      "§3 en YAKIN önceki boya adımı seçildi (uzak olan değil)",
    );

    // ── §4. NEG: rotada boya adımı YOK ───────────────────────────────────────
    console.log("§4 Negatifler");
    const f4 = await makeWo([{ stationId: plainStation.id }]);
    const e4 = await expectAppError(() => svc.getSendToDyePreview({ rollId: f4.rollId }));
    ok(
      e4?.statusCode === 400 && e4?.details?.code === "NO_DYE_STEP_IN_ROUTE",
      "§4 rotada boya adımı yok → 400 NO_DYE_STEP_IN_ROUTE",
      e4?.message ?? "hata yok!",
    );

    // ── §5. NEG: boya adımı YALNIZ Tambur'dan SONRA ──────────────────────────
    // Sonraki boya adımı hedef DEĞİLDİR — ileri atlama "geri gönderme" değildir.
    const f5 = await makeWo([{ stationId: plainStation.id }]);
    await prisma.workOrderStep.create({
      data: {
        workOrderId: f5.woId,
        stationId: innerDye.id,
        stepSequence: 9,
        status: "PENDING",
      },
    });
    const e5 = await expectAppError(() => svc.getSendToDyePreview({ rollId: f5.rollId }));
    ok(
      e5?.details?.code === "NO_DYE_STEP_IN_ROUTE",
      "§5 yalnız SONRAKİ boya adımı varsa reddedilir (ileri atlama değil)",
      e5?.message ?? "hata yok!",
    );

    // ── §6. NEG: sebep kısa ──────────────────────────────────────────────────
    const f6 = await makeWo([{ stationId: innerDye.id }]);
    const e6 = await expectAppError(() => svc.sendToDye({ rollId: f6.rollId, reason: "ab" }));
    ok(
      e6?.statusCode === 400 && e6?.details?.code === "REASON_REQUIRED",
      "§6 sebep <3 karakter → 400 REASON_REQUIRED",
      e6?.message ?? "hata yok!",
    );

    // ── §7. NEG: top Tambur'da değil ─────────────────────────────────────────
    const strayRoll = await prisma.roll.create({
      data: {
        barcode: `TEST-SD-STRAY-${ts}`,
        itemId: item.id,
        colorId: mavi.id,
        initialQty: 50,
        currentQty: 50,
        status: RollStatus.WAREHOUSE,
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true },
    });
    rollIds.push(strayRoll.id);
    const e7 = await expectAppError(() => svc.getSendToDyePreview({ rollId: strayRoll.id }));
    ok(
      e7?.details?.code === "ROLL_NOT_AT_TAMBUR",
      "§7 depodaki top → 400 ROLL_NOT_AT_TAMBUR",
      e7?.message ?? "hata yok!",
    );

    // ── §8. NEG: hedef sonrası KESİM yapılmış top (CUT hard-stop) ────────────
    // Tambur'da doğmuş çocuk varsa moveService `movable=false` der; önizleme
    // bunu `canApply=false` olarak yansıtır, uygulama 409 verir.
    const f8 = await makeWo([{ stationId: innerDye.id }]);
    const childCut = await prisma.roll.create({
      data: {
        barcode: `TEST-SD-CHILD-${ts}`,
        itemId: item.id,
        colorId: mavi.id,
        initialQty: 20,
        currentQty: 20,
        status: RollStatus.WAREHOUSE,
        parentRollId: f8.rollId,
        producedInStepId: f8.tamburStepId,
        entrySource: "TAMBUR_SPLIT",
      },
      select: { id: true },
    });
    rollIds.push(childCut.id);
    const prev8 = (await svc.getSendToDyePreview({ rollId: f8.rollId })).data as {
      canApply: boolean;
      blockCode: string | null;
    };
    ok(prev8.canApply === false, "§8 kesim yapılmış topta önizleme uygulanamaz");
    ok(prev8.blockCode === "ROLL_NOT_MOVABLE", "§8 blockCode=ROLL_NOT_MOVABLE", prev8.blockCode ?? "-");
    const e8 = await expectAppError(() => svc.sendToDye({ rollId: f8.rollId, reason: "geri gonder" }));
    ok(e8?.statusCode === 409, "§8 uygulama 409 (CUT hard-stop)", String(e8?.statusCode));

    // ── §9. NEG: oturum başka istasyonda ─────────────────────────────────────
    const f9 = await makeWo([{ stationId: innerDye.id }]);
    const e9 = await expectAppError(() =>
      svc.getSendToDyePreview({ rollId: f9.rollId }, { stationId: plainStation.id }),
    );
    ok(
      e9?.statusCode === 409 && e9?.details?.code === "STATION_MISMATCH",
      "§9 oturum başka istasyonda → 409 STATION_MISMATCH",
      e9?.message ?? "hata yok!",
    );

    // ── §10. NEG: iptal edilmiş iş emri ──────────────────────────────────────
    const f10 = await makeWo([{ stationId: innerDye.id }]);
    await prisma.workOrder.update({ where: { id: f10.woId }, data: { status: "CANCELLED" } });
    const e10 = await expectAppError(() => svc.getSendToDyePreview({ rollId: f10.rollId }));
    ok(
      e10?.statusCode === 409 && e10?.details?.code === "WORKORDER_DEAD",
      "§10 iptal edilmiş iş emri → 409 WORKORDER_DEAD",
      e10?.message ?? "hata yok!",
    );
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.message : e);
  } finally {
    try {
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...woIds] } } }).catch(() => undefined);
      // RESTRICT dersi: top silen temizlik plan-sapma defterini de silmeli.
      await prisma.rollPlanDeviation.deleteMany({
        where: { OR: [{ rollId: { in: rollIds } }, { childRollId: { in: rollIds } }] },
      });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
      await prisma.station.deleteMany({ where: { id: { in: stationIds } } });
      await prisma.color.deleteMany({ where: { id: { in: colorIds } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      console.log("(temizlendi — TEST-SD fixture silindi)");
    } catch (e) {
      console.error("cleanup hata:", e instanceof Error ? e.message : e);
    }
    await prisma.$disconnect();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
