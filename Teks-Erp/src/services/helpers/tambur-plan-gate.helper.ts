// =============================================================================
// Tambur plan-gerçek sapma kapısı — ORTAK yüklem (2026-08-19)
// =============================================================================
// Üç depo-indiriş yolu da aynı kapıdan geçer:
//   • finalize            (kart kesim modeli — cuts[])
//   • cutOpenFabric       (per-cut model: çocuk KESİM ANINDA depoya iner)
//   • finalizeOpenFabric  (kalan kuyruk keep_* ile depoya inerken;
//                          scrap/discard KAPI DIŞI — fire depoya inmez)
// Kapsam + gerekçe: constants/tambur-plan-gate.ts başlığı. Kural TEK yerde
// yaşar; üç yola kopyalanırsa biri sessizce ayrışır (F221 dersi).
//
// ⚠️ İKİ İZ, İKİ AMAÇ (2026-08-19):
//   • `AuditService` satırı — "kim ne zaman imzaladı" (best-effort, tx DIŞI).
//   • `RollPlanDeviation` defteri — RAPORUN kaynağı (tx İÇİNDE, çağıran yazar).
// Audit tek başına yetmiyordu: 6 ayda arşive taşınıyor ve rapor katmanı arşivi
// okumuyor; `newData` JSON'u indekssiz; `recordId` PARENT topu gösteriyor.
// Bu yüzden `assertRollMatchesPlan` onaylı geçişte sapmaları DÖNDÜRÜR ve üç
// çağıran kendi tx'inde `recordPlanDeviationTx` ile deftere yazar.
//
// İstemci sözleşmesi: operatör bir topta sapmayı BİR KEZ onaylar; aynı topun
// sonraki kesim/bitirme istekleri `confirmMismatch: true` taşır (tablet
// oturum-içi hatırlar). Retry payload'ı birebir gittiği için offline replay
// de onaylı gider; onaysız kuyruk kaydı replay'de 409'a düşerse kalıcı-düşüş
// toast'ı sebebi söyler (kayıt yazılmadı — mal ekranda durur, tekrar denenir).
// =============================================================================
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import {
  FASON_RECEIPT_DEVIATION_SOURCE,
  PLAN_MISMATCH_CODE,
  TAMBUR_PLAN_WIDTH_TOLERANCE_CM,
  type PlanMismatchItem,
} from "../../constants/tambur-plan-gate";

interface GateRoll {
  id: string;
  barcode: string | null;
  colorId: string | null;
  /** Prisma Decimal | number | null — Number()'a çevrilebilir olmalı. */
  width: unknown;
}
interface GatePlan {
  workOrderId: string | null;
  targetColorId: string | null;
  width: unknown;
}

/**
 * Sapma varsa ve onay yoksa 409 `PLAN_MISMATCH` fırlatır; onay varsa imzalı
 * kararı audit'e düşürür. Sapma yoksa hiçbir şey yapmaz (sıcak yol tek
 * karşılaştırma — renk adları yalnız sapma dalında yüklenir).
 *
 * Pre-tx çağrılmalı (salt okuma; kilit süresi uzamaz). İdempotent-retry erken
 * dönüşlerinden SONRA çağrılırsa onaylanmış işin replay'i kapıya çarpmaz.
 *
 * @returns ONAYLANAN sapmalar (sapma yoksa boş dizi). Çağıran bunu kendi tx'i
 * içinde `recordPlanDeviationTx`e verir — defter satırı tx'e bağlı olmalı ki
 * iş geri sarılırsa (P2002 replay, claim kaybı) sapma kaydı da geri sarılsın.
 * ⚠️ Dönüşü YOK SAYAN bir çağıran TS'te uyarı ÜRETMEZ; bekçi
 * `test_tambur_plan_gate.ts` üç yolun da satır yazdığını mekanik doğrular.
 */
export async function assertRollMatchesPlan(
  roll: GateRoll,
  plan: GatePlan,
  confirmMismatch: boolean | undefined,
  userId: string | undefined,
  /** Audit'te hangi yoldan onaylandığı okunsun ("finalize" | "cut" | "finalize-open-fabric"). */
  source: string,
): Promise<PlanMismatchItem[]> {
  const mismatches: PlanMismatchItem[] = [];
  if (plan.targetColorId && roll.colorId !== plan.targetColorId) {
    const [rollColor, planColor] = await Promise.all([
      roll.colorId
        ? prisma.color.findUnique({ where: { id: roll.colorId }, select: { name: true } })
        : Promise.resolve(null),
      prisma.color.findUnique({ where: { id: plan.targetColorId }, select: { name: true } }),
    ]);
    const rollName = roll.colorId ? (rollColor?.name ?? "bilinmeyen renk") : null;
    const planName = planColor?.name ?? "bilinmeyen renk";
    // KABULDE ONAYLANMIŞ SAPMA (2026-08-21): operatör fason kabulde "plandan
    // farklı renk — sadece bu toplar" dediyse defterde bu topun satırı vardır ve
    // aynı soru Tambur'da TEKRAR SORULMAZ ("sapma bir kez onaylanır"). Değerler
    // de eşleşmeli: plan sonradan değiştiyse o onay bu duruma ait değildir.
    const confirmedAtReceipt = await prisma.rollPlanDeviation.findFirst({
      where: {
        // ⚠️ GERİ ALINMIŞ ONAY SORUYU BASTIRMAZ (2026-09-13): kabul iptal edilip
        // doğan top diriltilirse satır topa geri yapışıyordu ve Tambur soruyu bir
        // daha SORMUYORDU — onayı üreten kabul artık yokken.
        ...ACTIVE_DEVIATION,
        rollId: roll.id,
        field: "color",
        source: FASON_RECEIPT_DEVIATION_SOURCE,
        rollValue: rollName,
        planValue: planName,
      },
      select: { id: true },
    });
    if (!confirmedAtReceipt) {
      mismatches.push({
        field: "color",
        message: roll.colorId
          ? `Top ${rollName}, iş emri ${planName} istiyor`
          : `Top RENKSİZ, iş emri ${planName} istiyor`,
        rollValue: rollName,
        planValue: planName,
      });
    }
  }
  const rollWidth = roll.width == null ? null : Number(roll.width);
  const planWidth = plan.width == null ? null : Number(plan.width);
  if (
    rollWidth != null &&
    planWidth != null &&
    Math.abs(rollWidth - planWidth) > TAMBUR_PLAN_WIDTH_TOLERANCE_CM
  ) {
    mismatches.push({
      field: "width",
      message: `Top ${rollWidth} cm, iş emri ${planWidth} cm istiyor (eşik ±${TAMBUR_PLAN_WIDTH_TOLERANCE_CM} cm)`,
      rollValue: rollWidth,
      planValue: planWidth,
    });
  }
  if (mismatches.length === 0) return [];

  if (!confirmMismatch) {
    throw AppError.conflict(
      `Plan ile top uyuşmuyor: ${mismatches.map((m) => m.message).join(" · ")}. Yine de devam etmek için onaylayın.`,
      {
        code: PLAN_MISMATCH_CODE,
        mismatches,
        toleranceCm: TAMBUR_PLAN_WIDTH_TOLERANCE_CM,
      },
    );
  }
  // İmzalı karar — audit best-effort (tx dışı, proje kuralı). Sapmanın kendisi
  // topun kaydını DEĞİŞTİRMEZ: mal neyse o olarak depoya iner; düzeltme ayrı
  // ve bilinçli bir işlemdir (Düzelt / Rengi Değiştir / override zinciri).
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "ROLL",
    recordId: roll.id,
    newData: {
      event: "TAMBUR_PLAN_MISMATCH_CONFIRMED",
      source,
      barcode: roll.barcode,
      workOrderId: plan.workOrderId,
      mismatches: mismatches as unknown as Record<string, unknown>[],
    },
  });
  return mismatches;
}

/**
 * Onaylanan sapmaları KALICI deftere yazar (`roll_plan_deviations`).
 *
 * ⚠️ ÇAĞIRANIN TX'İ İÇİNDE çağrılmalı: iş geri sarılırsa (aynı `clientToken`
 * ile kesim replay'i → P2002 → rollback; finalize claim kaybı) defter satırı da
 * geri sarılmalıdır. Aksi halde "hiç olmamış" bir kesim raporda sapma olarak
 * görünür ve rakam sessizce şişer.
 *
 * Satır granülerliği = onaylı kapı-geçişi × sapan alan; `confirmationId` tek
 * geçişin satırlarını gruplar. Renk+en birlikte sapan top İKİ satır üretir ama
 * BİR imzadır — karne `COUNT(DISTINCT confirmationId)` ve confirmationId başına
 * TEK `qtyM` ile sayar (naif `SUM(qtyM)` metrajı çift sayardı).
 *
 * Boş `mismatches` → no-op (sıcak yol maliyeti sıfır).
 */
export async function recordPlanDeviationTx(
  tx: Prisma.TransactionClient,
  input: {
    mismatches: PlanMismatchItem[];
    rollId: string;
    /** Bu geçişte depoya inen çocuk; `finalize` yolunda null (bkz. şema notu). */
    childRollId: string | null;
    workOrderId: string;
    workOrderStepId: string | null;
    /** Plan-dışı kimlikle depoya inen metraj. */
    qtyM: number;
    source: string;
    confirmedById: string | undefined;
  },
): Promise<void> {
  if (input.mismatches.length === 0) return;
  const confirmationId = randomUUID();
  await tx.rollPlanDeviation.createMany({
    data: input.mismatches.map((m) => ({
      confirmationId,
      rollId: input.rollId,
      childRollId: input.childRollId,
      workOrderId: input.workOrderId,
      workOrderStepId: input.workOrderStepId,
      field: m.field,
      // Değerler İNSAN-OKUR metin olarak donar: renk adı sonradan değişse bile
      // o günkü karar olduğu gibi okunur (donmuş belge ilkesinin defter hâli).
      rollValue: m.rollValue == null ? null : String(m.rollValue),
      planValue: m.planValue == null ? null : String(m.planValue),
      qtyM: input.qtyM,
      source: input.source,
      confirmedById: input.confirmedById ?? null,
    })),
  });
}

/** Yürürlükteki (geri alınmamış) sapma imzası — okuyan HER yol bundan geçer. */
export const ACTIVE_DEVIATION = { revokedAt: null } as const;

export interface RevokePlanDeviationArgs {
  /** Damgalanacak kapı-geçişi(leri). Kapsam BURADAN gelir, çağıran ne bulduysa. */
  confirmationIds: string[];
  /** `TAMBUR_UNDO` / `TAMBUR_UNDO_SINGLE` / `FASON_KABUL_IPTAL` gibi. */
  reason: string;
  userId?: string | null;
}

/**
 * Sapma imzasını GERİ ALIR — satırı SİLMEZ, içeriğini DEĞİŞTİRMEZ.
 *
 * ⚠️ TANECİK `confirmationId`, SATIR DEĞİL. Renk+en birlikte sapan bir geçiş İKİ
 * satır ama BİR imzadır; tek satırı damgalamak imzayı YARIM geri alır ve yarım
 * geri alınmış bir imza hiç geri alınmamıştan KÖTÜDÜR — karne onu tutarlı görür
 * (`COUNT(DISTINCT confirmationId)` yine sayar, `qtyM` yine tek okunur).
 *
 * `revokedAt: null` yüklemi ŞART: çift geri alma ikinci kez damgalamaz ve
 * undo→yeniden-finalize→undo döngüsünde ESKİ imza yeni damgayı yemez.
 *
 * @returns damgalanan SATIR sayısı (imza sayısı değil — bir imza 1–2 satırdır).
 */
export async function revokePlanDeviationsTx(
  tx: Prisma.TransactionClient,
  args: RevokePlanDeviationArgs,
): Promise<number> {
  if (args.confirmationIds.length === 0) return 0;
  const res = await tx.rollPlanDeviation.updateMany({
    where: { ...ACTIVE_DEVIATION, confirmationId: { in: args.confirmationIds } },
    data: {
      revokedAt: new Date(),
      revokedById: args.userId ?? null,
      revokeReason: args.reason,
    },
  });
  return res.count;
}

/**
 * Bir kapanışın imzalarını bulur — damgalamadan ÖNCEKİ adım (tanecik iki adımlı).
 *
 * ⚠️ `revokedAt: null` süzgeci döngüyü KENDİLİĞİNDEN çözer: geri al → yeniden
 * finalize → tekrar geri al senaryosunda ilk kapanışın imzaları zaten damgalıdır
 * ve yüklemin dışında kalır. Ek bir zaman/sıra koşuluna gerek YOKTUR.
 */
export async function findPlanDeviationConfirmationsTx(
  tx: Prisma.TransactionClient,
  where: Prisma.RollPlanDeviationWhereInput,
): Promise<string[]> {
  const rows = await tx.rollPlanDeviation.findMany({
    where: { ...ACTIVE_DEVIATION, ...where },
    select: { confirmationId: true },
    distinct: ["confirmationId"],
  });
  return rows.map((r) => r.confirmationId);
}
