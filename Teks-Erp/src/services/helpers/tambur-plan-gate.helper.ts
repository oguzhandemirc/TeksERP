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
// İstemci sözleşmesi: operatör bir topta sapmayı BİR KEZ onaylar; aynı topun
// sonraki kesim/bitirme istekleri `confirmMismatch: true` taşır (tablet
// oturum-içi hatırlar). Retry payload'ı birebir gittiği için offline replay
// de onaylı gider; onaysız kuyruk kaydı replay'de 409'a düşerse kalıcı-düşüş
// toast'ı sebebi söyler (kayıt yazılmadı — mal ekranda durur, tekrar denenir).
// =============================================================================
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import {
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
 */
export async function assertRollMatchesPlan(
  roll: GateRoll,
  plan: GatePlan,
  confirmMismatch: boolean | undefined,
  userId: string | undefined,
  /** Audit'te hangi yoldan onaylandığı okunsun ("finalize" | "cut" | "finalize-open-fabric"). */
  source: string,
): Promise<void> {
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
    mismatches.push({
      field: "color",
      message: roll.colorId
        ? `Top ${rollName}, iş emri ${planName} istiyor`
        : `Top RENKSİZ, iş emri ${planName} istiyor`,
      rollValue: rollName,
      planValue: planName,
    });
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
  if (mismatches.length === 0) return;

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
}
