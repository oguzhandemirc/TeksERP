// =============================================================================
// YENİDEN İŞLEM SINIFI — tek kaynak (genel fason F9, patron kararı FK2)
// =============================================================================
// Soru: "bu hizmet işi bizim hatamızdan dönen bir yeniden işlemden mi doğdu?"
// Sınıf (`ReasonPreset.billable`) fatura anında CANLI OKUNMAZ: yeniden işlem İE'si doğarken
// (`parameters.rework.reasonCode`) `WorkOrder.reworkBillable`a DONAR (`freezeReworkBillableTx`);
// katalog sonradan değişse geçmiş İE değişmez. NULL/true = ücretli (bugünkü) · false = faturasız.
// İşin İE'si: adımlı iş → adımın İE'si; adımsız iş (bayrak DECLARED) → işin anında topun aktif
// hareketindeki İE, yoksa topun doğduğu adımın İE'si. Kapsam adım · bayrak · kurşun işinin HEPSİ.
// =============================================================================
import { Prisma, ReasonPresetKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { ACTIVE_MOVEMENT } from "./roll-movement.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** Taslakta dışlanan işin gerekçe kodu (tel `ServiceDraftWorkRow.excludedReason`). */
export const REWORK_OUR_FAULT = "REWORK_OUR_FAULT" as const;

/** `parameters.rework.reasonCode` — dolu metin değilse null (eski/sebepsiz İE). */
export function readReworkReasonCode(parameters: unknown): string | null {
  if (!parameters || typeof parameters !== "object") return null;
  const rework = (parameters as { rework?: unknown }).rework;
  if (!rework || typeof rework !== "object") return null;
  const code = (rework as { reasonCode?: unknown }).reasonCode;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

/**
 * DONMA: İE doğarken sebebin `billable`ı. Kod yoksa ya da katalogda yoksa null (= ücretli, bugünkü);
 * gizlenmiş (`isActive=false`) sebep de okunur — gizleme görünürlük kararıdır, geçerlilik değil.
 */
export async function freezeReworkBillableTx(db: Db, parameters: unknown): Promise<boolean | null> {
  const code = readReworkReasonCode(parameters);
  if (!code) return null;
  const row = await db.reasonPreset.findUnique({
    where: { kind_code: { kind: ReasonPresetKind.WORK_ORDER_REWORK, code } },
    select: { billable: true },
  });
  return row?.billable ?? null;
}

/** Taslak/önizleme uyarısı — dışlanan iş sessiz düşmez; bekçi aynı cümleyi arar. */
export function reworkOurFaultWarning(count: number): string {
  return `${count} iş bizim hatamızdan yeniden işlem — faturaya alınmadı.`;
}

/**
 * Verilen adımlardan İE'si DONMUŞ `reworkBillable = false` olanlar. Kanıt seçen okuyucular (bayrak işi)
 * bununla ücretli kanıtı öne alır: faturasız yeniden işlem okuması ücretli eski işi yutmamalı.
 */
export async function loadOurFaultStepIds(stepIds: (string | null)[], db: Db = prisma): Promise<Set<string>> {
  const ids = [...new Set(stepIds.filter((v): v is string => v !== null))];
  if (ids.length === 0) return new Set();
  const rows = await db.workOrderStep.findMany({ where: { id: { in: ids }, workOrder: { reworkBillable: false } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

type WorkRef = { rollId: string; workOrderStepId: string | null; serviceAt: Date };

/**
 * İşleri ikiye ayırır: İE'si DONMUŞ `reworkBillable = false` olanlar `excluded`, gerisi `billable`.
 * Sorgular kümeye toplu (N+1 yok); faturasız İE yoksa sonuç girdinin kendisidir (bayt-aynı).
 */
export async function splitReworkOurFaultWorks<T extends WorkRef>(works: T[], db: Db = prisma): Promise<{ billable: T[]; excluded: T[] }> {
  if (works.length === 0) return { billable: works, excluded: [] };
  const freeSteps = await loadOurFaultStepIds(works.map((w) => w.workOrderStepId), db);

  const stepless = works.filter((w) => w.workOrderStepId === null);
  const freeStepless = new Set<T>();
  if (stepless.length > 0) {
    const rollIds = [...new Set(stepless.map((w) => w.rollId))];
    const latest = new Date(Math.max(...stepless.map((w) => w.serviceAt.getTime())));
    const moves = await db.rollMovement.findMany({
      where: { rollId: { in: rollIds }, ...ACTIVE_MOVEMENT, enteredAt: { lte: latest } },
      select: { rollId: true, enteredAt: true, step: { select: { workOrder: { select: { reworkBillable: true } } } } },
      orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
    });
    const born = new Map((await db.roll.findMany({
      where: { id: { in: rollIds } },
      select: { id: true, createdAt: true, producedInStep: { select: { workOrder: { select: { reworkBillable: true } } } } },
    })).map((r) => [r.id, r]));
    const movesOf = new Map<string, typeof moves>();
    for (const m of moves) movesOf.set(m.rollId, [...(movesOf.get(m.rollId) ?? []), m]);
    for (const w of stepless) {
      const hit = (movesOf.get(w.rollId) ?? []).filter((m) => m.enteredAt <= w.serviceAt).at(-1);
      const roll = born.get(w.rollId);
      const flag = hit ? hit.step.workOrder.reworkBillable
        : roll && roll.createdAt <= w.serviceAt ? roll.producedInStep?.workOrder.reworkBillable ?? null : null;
      if (flag === false) freeStepless.add(w);
    }
  }
  if (freeSteps.size === 0 && freeStepless.size === 0) return { billable: works, excluded: [] };
  const isFree = (w: T) => (w.workOrderStepId !== null ? freeSteps.has(w.workOrderStepId) : freeStepless.has(w));
  return { billable: works.filter((w) => !isFree(w)), excluded: works.filter(isFree) };
}
