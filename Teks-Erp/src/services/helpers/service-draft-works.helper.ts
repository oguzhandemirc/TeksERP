// =============================================================================
// HİZMET TASLAĞI KIRILIMI — top işleri → `ServiceDraftWorkRow` (genel fason F4)
// =============================================================================
// "Satır neden bu miktar": çözücünün kartlı işleri tel sözleşmesine çevrilir (fiyat çözmez; kurşun kaynağı
// `LEAD` adını taşır, bkz. sözleşme). Levent satırları `service-winding-work`te.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { ServiceRollWork } from "./service-pricing.helper";
import type { ServiceDraftWorkRow } from "../service-billing/types";

type Db = Prisma.TransactionClient | typeof prisma;

const ROLL_SOURCE: Record<ServiceRollWork["source"], ServiceDraftWorkRow["source"]> = { TABLET: "LEAD", KAGIT: "LEAD", PROPERTY: "FLAG", STEP: "STEP", WEAVING: "WEAVING" };

/** Top işleri → F4 kırılım satırları (kartlı işler; top barkodu tek sorguyla). */
export async function toDraftWorkRows(works: ServiceRollWork[], db: Db): Promise<ServiceDraftWorkRow[]> {
  const priced = works.filter((w) => w.serviceItemId !== null);
  if (priced.length === 0) return [];
  const codes = new Map((await db.roll.findMany({ where: { id: { in: [...new Set(priced.map((w) => w.rollId))] } }, select: { id: true, barcode: true } })).map((r) => [r.id, r.barcode]));
  return priced.map((w) => ({
    source: ROLL_SOURCE[w.source], subjectKind: "ROLL", subjectId: w.rollId, subjectCode: codes.get(w.rollId) ?? "barkodsuz top",
    serviceItemId: w.serviceItemId!, processLabel: w.source === "WEAVING" ? `Dokuma · ${w.valueName}` : ROLL_SOURCE[w.source] === "LEAD" ? `Kurşun ${w.valueName}` : w.valueName,
    workOrderStepId: w.workOrderStepId, qty: (w.quantity ?? w.meters).toFixed(3), unit: w.qtyUnit, meterBasis: w.meterBasis,
    unitPrice: (w.unitPrice ?? new Prisma.Decimal(0)).toFixed(4), excludedReason: null,
  }));
}
