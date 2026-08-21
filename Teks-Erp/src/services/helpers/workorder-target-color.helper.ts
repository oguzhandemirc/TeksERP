// =============================================================================
// Üretim rengi değişikliği — TEK BEKÇİ (2026-08-21)
// =============================================================================
// Renk değişikliğinin İKİ kapısı vardı ve ikisi farklı kural uyguluyordu:
//   • `WorkOrderService.update` (PATCH /work-orders/:id, "Düzenle")
//       → terminal statü reddi + boya-bitti kilidi + ürünün izinli renk listesi
//   • `WorkOrderLinkService.changeTargetColor` (PATCH …/target-color, "Rengi Değiştir")
//       → yalnız "renk var + aktif + sebep"; aynı izinle (workorder:write)
//         öbür kapının her korumasını atlıyordu, bitmiş iş emri dahil.
// Kullanıcı kararı (2026-08-21): iki kapı da AYNI bekçiden geçer. "Rengi
// Değiştir"in farkı yalnız sebep + audit izidir, kural farkı değil.
//
// KİLİT ADIMA DEĞİL MALA BAKAR (2026-08-21, 2. tur — kullanıcı kararı):
// İlk yazımda kilit "boya adımı COMPLETED mi" diye soruyordu. Bu iki şeyi
// birden yanlışlıyordu: (a) boya bitmiş ama toplar renksizse de kilitliyordu,
// (b) asıl istenen düzeltmeyi — "beyaz diye kaydedilmiş mal aslında ekru;
// planlamacı iş emrinin TÜM açık kumaşlarını ekruya çevirsin, Tambur renkle
// uğraşmasın" — boya bittiği için engelliyordu (Tambur süpervizör zinciri de
// aynı yüzden kilitlendi). Doğru soru: "bu değişiklikten SONRA plan ile
// eldeki mal uyuşuyor mu?" Üç sayı yeter:
//   • mismatch  = canlı, BOYANMIŞ (renkli) ve yeni renkte OLMAYAN toplar —
//                 bu istekle birlikte düzeltilecekler (`recolorRollIds`) HARİÇ
//   • pending   = henüz boyanmamış toplar (renksiz + yolda, ya da fasonda)
//   • mismatch = 0  → SERBEST (kayıt düzeltmesi: plan gerçeğe yetişiyor)
//     mismatch > 0 && pending > 0 → ONAYLA (409 COLOR_PARTIAL_CONFIRM — "N top
//                 zaten KIRMIZI, kalan M top MAVİ gelecek"; kısmi kabul penceresi)
//     mismatch > 0 && pending = 0 → KAPALI (409 COLOR_DYED_BLOCKED — "mal zaten
//                 KIRMIZI boyandı, boyanacak top kalmadı; bu iş emri KIRMIZI
//                 biter → Tebdil / yeni iş emri / topları da düzelt")
// Adım durumu (COMPLETED/ACTIVE) hesaba girmez. `computeWorkOrderLocks.targetColor`
// yalnız Düzenle formunun alanını pasifleştirmek için yaşamaya devam eder.
//
// Kontrol sırası (ucuzdan pahalıya, hepsi tek yerde):
//   1. Terminal statü (COMPLETED/CANCELLED/SUPERSEDED) → 409. Bitmiş iş emrinin
//      planını geriye dönük değiştirmenin meşru bir ihtiyacı yok.
//   2. Yeni renk var + aktif mi → 400.
//   3. Ürünün izinli renk listesi (`Item.allowedColors`, dolu ise) → 400.
//   4. MAL–PLAN uyumu (yukarıdaki üç sayı).
//   5. Rota kapsaması: rotada renk veren adım yoksa REDDETME, UYAR (kullanıcı
//      kararı) — `warnings[]` döner; istemci toast basar. Açılışta aynı soru
//      `assertRouteCoversTargets` ile 400 verir; sonradan eklenen renkte uyarı.
//
// ⚠️ Bu bekçi KİLİT ALTINDA da çağrılabilir (tx + `touchWorkOrderTx` sonrası
// taze kontrol) — `db` parametresi bu yüzden var.
// =============================================================================
import { Prisma, RollStatus, WorkOrderStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { STEP_CAPABILITY_SELECT, stepCanApplyColor } from "./step-capability.helper";
import { whereRollsOfWorkOrder } from "./workorder-rolls.helper";
import { K18_DEAD_STATUSES } from "../batch.service";

type Db = PrismaClient | Prisma.TransactionClient;

/** Plan değişikliğine (renk/en/uyumsuz-bağ override) KAPALI statüler. */
export const PLAN_CHANGE_FROZEN_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.COMPLETED,
  WorkOrderStatus.CANCELLED,
  WorkOrderStatus.SUPERSEDED,
];

export const COLOR_PARTIAL_CONFIRM_CODE = "COLOR_PARTIAL_CONFIRM";
/** Mal zaten boyandı, boyanacak top kalmadı, yeni renk eldekiyle uyuşmuyor. */
export const COLOR_DYED_BLOCKED_CODE = "COLOR_DYED_BLOCKED";
export const WO_PLAN_FROZEN_CODE = "WO_PLAN_FROZEN";

export interface TargetColorChangeWo {
  id: string;
  workOrderNumber: string;
  status: WorkOrderStatus;
  targetItemId: string | null;
  targetColorId: string | null;
}

export interface TargetColorChangeResult {
  /** Engel olmayan ama istemcinin göstermesi gereken notlar (rota kapsaması vb.). */
  warnings: string[];
  /** Kısmi boya durumu (onaylı geçildiyse dolu; sapma yoksa null). */
  partial: { dyedCount: number; pendingCount: number } | null;
}

function statusLabel(s: WorkOrderStatus): string {
  if (s === WorkOrderStatus.COMPLETED) return "tamamlanmış";
  if (s === WorkOrderStatus.CANCELLED) return "iptal edilmiş";
  if (s === WorkOrderStatus.SUPERSEDED) return "devredilmiş";
  return s;
}

/** Yalnız terminal statü kontrolü — en/override zinciri de bunu kullanır. */
export function assertPlanChangeAllowed(wo: { status: WorkOrderStatus; workOrderNumber: string }): void {
  if (PLAN_CHANGE_FROZEN_STATUSES.includes(wo.status)) {
    throw AppError.conflict(
      `${wo.workOrderNumber} ${statusLabel(wo.status)} — planı değiştirilemez. ` +
        "Toplar yanlış kaydedildiyse 'Düzelt' ile top düzeltilir, plan değil.",
      { code: WO_PLAN_FROZEN_CODE, status: wo.status },
    );
  }
}

/**
 * Üretim rengi değişikliğinin TÜM kurallarını uygular. Başarıda uyarıları döner,
 * engelde fırlatır. Aynı renge "değişiklik" çağıranın sorumluluğundadır
 * (update: no-op, changeTargetColor: 400) — burada yalnız gerçek değişiklik gelir.
 *
 * @param opts.recolorRollIds Bu istekle birlikte yeni renge DÜZELTİLECEK toplar
 *   ("toplara da uygula" seçimi). Uyum hesabında yeni renkte sayılırlar — böylece
 *   "hepsini düzelt" bir kayıt düzeltmesi olarak serbest geçer.
 */
export async function assertTargetColorChange(
  db: Db,
  wo: TargetColorChangeWo,
  newColorId: string | null,
  opts: { confirmPartial?: boolean; recolorRollIds?: readonly string[] } = {},
): Promise<TargetColorChangeResult> {
  // 1) Terminal statü
  assertPlanChangeAllowed(wo);

  // 2) Renk var + aktif
  let newColorName: string | null = null;
  if (newColorId) {
    const color = await db.color.findUnique({
      where: { id: newColorId },
      select: { name: true, isActive: true },
    });
    if (!color || !color.isActive) throw AppError.badRequest("Hedef renk bulunamadı veya pasif");
    newColorName = color.name;
  }

  // 3) Ürünün izinli renk listesi (dolu = bu listeden; boş = sınırsız — create/replace ile aynı)
  if (newColorId && wo.targetItemId) {
    const item = await db.item.findUnique({
      where: { id: wo.targetItemId },
      select: { allowedColors: { select: { colorId: true } } },
    });
    const allowed = new Set((item?.allowedColors ?? []).map((c) => c.colorId));
    if (allowed.size > 0 && !allowed.has(newColorId)) {
      throw AppError.badRequest("Hedef renk bu ürünün izinli renk listesinde değil");
    }
  }

  // 4) MAL–PLAN uyumu
  const scope = whereRollsOfWorkOrder(wo.id);
  const recolor = [...new Set(opts.recolorRollIds ?? [])];
  // Boyanmış ve yeni renkte olmayan canlı toplar — fasondakiler hariç (onlar
  // yeniden boyanır = pending), düzeltilecekler hariç.
  const mismatchRows = await db.roll.findMany({
    where: {
      AND: [
        scope,
        { colorId: { not: null } },
        ...(newColorId ? [{ colorId: { not: newColorId } }] : []),
        { status: { notIn: [...K18_DEAD_STATUSES, RollStatus.AT_SUBCONTRACTOR] } },
        ...(recolor.length > 0 ? [{ id: { notIn: recolor } }] : []),
      ],
    },
    select: { color: { select: { name: true } } },
  });
  const mismatchCount = mismatchRows.length;
  let partial: TargetColorChangeResult["partial"] = null;
  if (mismatchCount > 0) {
    // Henüz boyanmamış: renksiz + yolda (fasonda / üretimde / ham stokta) YA DA
    // fasonda bekleyen (rengi ne olursa olsun — yeniden boyanır).
    const pendingCount = await db.roll.count({
      where: {
        AND: [
          scope,
          { status: { notIn: K18_DEAD_STATUSES } },
          {
            OR: [
              { status: RollStatus.AT_SUBCONTRACTOR },
              { colorId: null, status: { in: [RollStatus.IN_PRODUCTION, RollStatus.STOCK] } },
            ],
          },
        ],
      },
    });
    const dyedNames = [...new Set(mismatchRows.map((r) => r.color?.name ?? "bilinmeyen renk"))];
    const dyedLabel = dyedNames.join(" / ");
    const newName = newColorName ?? "renksiz";
    partial = { dyedCount: mismatchCount, pendingCount };
    if (pendingCount === 0) {
      throw AppError.conflict(
        `Mal zaten ${dyedLabel} boyandı (${mismatchCount} top) ve boyanacak top kalmadı — bu iş emri ${dyedLabel} olarak biter. ` +
          `Yeniden boyanacaksa Tebdil, müşteri ${newName} istiyorsa yeni iş emri; kayıt yanlışsa topları da düzeltin.`,
        {
          code: COLOR_DYED_BLOCKED_CODE,
          dyedCount: mismatchCount,
          dyedColorNames: dyedNames,
          newColorId,
          newColorName: newName,
        },
      );
    }
    if (!opts.confirmPartial) {
      throw AppError.conflict(
        `${mismatchCount} top zaten ${dyedLabel} olarak boyandı; kalan ${pendingCount} top ${newName} gelecek. ` +
          "Devam etmek için onaylayın ya da boyanmışları Tebdil ile ayırın.",
        {
          code: COLOR_PARTIAL_CONFIRM_CODE,
          dyedCount: mismatchCount,
          pendingCount,
          dyedColorNames: dyedNames,
          currentColorId: wo.targetColorId,
          newColorId,
          newColorName: newName,
        },
      );
    }
  }

  // 5) Rota kapsaması — REDDETME, UYAR
  const warnings: string[] = [];
  if (newColorId) {
    const steps = await db.workOrderStep.findMany({
      where: { workOrderId: wo.id },
      select: {
        station: { select: STEP_CAPABILITY_SELECT },
        requiredCategory: { select: { appliesColor: true } },
      },
    });
    const covered = steps.some((s) => stepCanApplyColor(s.station, s.requiredCategory));
    if (!covered) {
      warnings.push(
        "Rotada renk veren adım (boyahane) yok — toplar bu rengi kendiliğinden almayacak.",
      );
    }
  }

  return { warnings, partial };
}
