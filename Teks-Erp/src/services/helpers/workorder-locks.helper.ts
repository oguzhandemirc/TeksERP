// =============================================================================
// İş emri düzenleme kilitleri
// =============================================================================
// Kural: fiziksel taahhüt (rulo işlenmeye başlandı veya sevk gitti) WO'nun
// fiziksel niteliklerini sabitler — kâğıt üzerinde değiştirilemez.
//
// Tetikleyici (materialCommitted):
//   - Herhangi bir step.status !== "PENDING", VEYA
//   - Aktif (cancelledAt=null) bir SubcontractorDispatch var.
//
// Kilitlenen alanlar:
//   materialCommitted ⇒ targetItemId, width, route (zaten smart-merge step
//   deletion'da kısmen) sabit. **targetQuantity sertçe kilitli değil** —
//   kullanıcı kasıtlı olarak yeni hedef girebilir; frontend sevk edilen >
//   yeni hedef ise uyarı gösterir, fazla dönen Tambur'da stok olarak kalır.
//
// Renk: WO'nun targetColorId'sini uygulayabilecek bir istasyon (StationColor
// pivot) WO rotasında VARSA ve o adımın status'u COMPLETED ise — boya kazana
// indi, renk değişmez. Aksi halde renk editable (telefonla değiştirilebilir).
//
// Özellik (per property): StationProperty pivot'una göre o özelliği
// uygulayabilecek istasyon WO rotasında VARSA ve o adımın status'u COMPLETED
// ise — özellik fiziksel olarak kazanıldı, değişmez. Kalan tüm durumlarda
// editable.
//
// Kat tipi: kind=TAMBUR adımı PENDING değilse kilitli (kesim başladıysa).
// =============================================================================

import type { Prisma, PrismaClient, StepStatus } from "@prisma/client";

export interface WorkOrderLocks {
  /** Rota+sevk durumuna göre fiziksel taahhüt var mı. */
  materialCommitted: boolean;
  targetItem: boolean;
  width: boolean;
  targetQuantity: boolean;
  targetColor: boolean;
  foldType: boolean;
  /** Halen kilitli olan özellik ID'leri (kaldırılamaz). */
  lockedPropertyIds: string[];
  /**
   * Bu rotanın hâlâ uygulayabileceği (status COMPLETED olmayan istasyon
   * bulunan) özellik ID'leri. Yeni özellik eklenmek istenirse bu sette
   * olmalı; aksi halde "kim uygulayacak?" hatası.
   */
  applicablePropertyIds: string[];
  reasons: Partial<{
    materialCommitted: string;
    targetItem: string;
    width: string;
    targetQuantity: string;
    targetColor: string;
    foldType: string;
    /** propertyId → kilit sebebi */
    properties: Record<string, string>;
  }>;
}

type Db = PrismaClient | Prisma.TransactionClient;

export async function computeWorkOrderLocks(
  db: Db,
  workOrderId: string,
): Promise<WorkOrderLocks> {
  // Tek round-trip'te WO + adımlar + targetProperties + dispatch sayısı.
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      targetColorId: true,
      targetProperties: { select: { propertyId: true } },
      steps: {
        select: {
          id: true,
          status: true,
          stationId: true,
          station: {
            select: {
              id: true,
              kind: true,
              colorCapabilities: { select: { colorId: true } },
              propertyCapabilities: { select: { propertyId: true } },
            },
          },
        },
      },
      _count: {
        select: {
          dispatches: { where: { cancelledAt: null } },
        },
      },
    },
  });

  if (!wo) {
    return {
      materialCommitted: false,
      targetItem: false,
      width: false,
      targetQuantity: false,
      targetColor: false,
      foldType: false,
      lockedPropertyIds: [],
      applicablePropertyIds: [],
      reasons: {},
    };
  }

  const anyStepStarted = wo.steps.some((s) => s.status !== "PENDING");
  const hasActiveDispatch = wo._count.dispatches > 0;
  const materialCommitted = anyStepStarted || hasActiveDispatch;

  const reasons: WorkOrderLocks["reasons"] = {};
  if (materialCommitted) {
    const parts: string[] = [];
    if (anyStepStarted) parts.push("üretim adımı başladı");
    if (hasActiveDispatch) parts.push("fason sevk yapıldı");
    reasons.materialCommitted = `Fiziksel taahhüt var (${parts.join(" / ")})`;
    reasons.targetItem = "Sevk/işlem başladıktan sonra kumaş değiştirilemez";
    reasons.width = "Sevk/işlem başladıktan sonra en değiştirilemez";
  }

  // ── Renk kilidi ────────────────────────────────────────────────────────
  // WO targetColor'unu uygulayabilen herhangi bir istasyon route'ta varsa ve
  // o adım COMPLETED ise renk sabit.
  let targetColor = false;
  if (wo.targetColorId) {
    const dyedSteps = wo.steps.filter(
      (s) =>
        s.station?.colorCapabilities.some(
          (cc) => cc.colorId === wo.targetColorId,
        ) ?? false,
    );
    if (dyedSteps.length > 0 && dyedSteps.every((s) => s.status === "COMPLETED")) {
      // Tüm renk uygulayan adımlar bittiyse: artık değiştirilemez. (Birden fazla
      // varsa son tamamlanan da kâr getirmediği için "tüm" şartı.)
      targetColor = true;
      reasons.targetColor = "Boya adımı tamamlandı, renk artık değiştirilemez";
    } else if (
      dyedSteps.length > 0 &&
      dyedSteps.some((s) => s.status === "COMPLETED") &&
      dyedSteps.some((s) => s.status !== "COMPLETED")
    ) {
      // Karma durum — bazıları bitti bazıları açık. Genelde tek dye step olur,
      // bu dal pratik olarak nadir. Güvenli yol: editable bırak.
    }
  }

  // ── Kat tipi kilidi ────────────────────────────────────────────────────
  const tamburStep = wo.steps.find((s) => s.station?.kind === "TAMBUR");
  let foldType = false;
  if (tamburStep && tamburStep.status !== "PENDING") {
    foldType = true;
    reasons.foldType = "Tambur adımı başladı, kat tipi sabitlendi";
  }

  // ── Özellik kilitleri ──────────────────────────────────────────────────
  // applicablePropertyIds: route'ta var ve henüz COMPLETED olmamış istasyon
  // hangi propertyleri verebilir. Yeni eklenebilecek property kümesi bu.
  const applicablePropertyIds = new Set<string>();
  for (const step of wo.steps) {
    if (step.status === "COMPLETED") continue;
    for (const pc of step.station?.propertyCapabilities ?? []) {
      applicablePropertyIds.add(pc.propertyId);
    }
  }

  const propertyReasons: Record<string, string> = {};
  const lockedPropertyIds: string[] = [];
  for (const tp of wo.targetProperties) {
    // Bu özelliği uygulayabilecek adımlardan herhangi biri COMPLETED ise
    // → fiziksel olarak rulolarda yerini aldı, kaldırılamaz.
    const propStepStatuses: StepStatus[] = wo.steps
      .filter(
        (s) =>
          s.station?.propertyCapabilities.some(
            (pc) => pc.propertyId === tp.propertyId,
          ) ?? false,
      )
      .map((s) => s.status);
    if (propStepStatuses.some((st) => st === "COMPLETED")) {
      lockedPropertyIds.push(tp.propertyId);
      propertyReasons[tp.propertyId] =
        "Bu özelliği uygulayan istasyon adımı tamamlandı, özellik artık kaldırılamaz";
    }
  }
  if (Object.keys(propertyReasons).length > 0) {
    reasons.properties = propertyReasons;
  }

  return {
    materialCommitted,
    targetItem: materialCommitted,
    width: materialCommitted,
    // targetQuantity sertçe kilitli değil — bilinçli "fazla gönderdik / az
    // kaldı" senaryolarına izin ver. Frontend bilgi amaçlı uyarı gösterir.
    targetQuantity: false,
    targetColor,
    foldType,
    lockedPropertyIds,
    applicablePropertyIds: Array.from(applicablePropertyIds),
    reasons,
  };
}
