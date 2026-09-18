// =============================================================================
// EMANET (KONSİNYE MÜLKİYET) — tek helper: yazma kapısı · kalıtım · sevk sahiplik kapısı (G3, 2026-09-15)
// =============================================================================
// Sahiplik (`ownerCustomerId`) bir DOĞUM niteliğidir (top · levent · iplik lotu); ayrı defter yok,
// sahiplik değişimi = yeni doğum (1e hükmü E2). Üç kapı:
//   ① `assertEmanetWritableTx` — `emanet.enabled` KAPALIYKEN owner yazılamaz (403 MODULE_DISABLED, gövde kapısı;
//      ekransız modül, adlandırılmış middleware yok). Kapalı kurulumda hiç owner satırı doğmaz ⇒ ②③ hiç ısırmaz.
//   ② `resolveOwnerFromLotsTx` / `resolveOwnerFromBeamsTx` — KALITIM: sarımda çıkış lotlarının, fason dokuma
//      makbuzunda sevkteki leventlerin owner'ı TEK ise çocuk onu alır; karışık ⇒ 409 OWNER_MISMATCH (bir levent
//      iki müşterinin ipliğinden sarılamaz — kime ait olduğu belirsiz kalırdı); ownersız satırlar owner'ı düşürmez.
//   ③ `assertOwnerMatchesTx` — MALIN ÇIKTIĞI HER YOL (müşteriye sevk üç yolu `performDispatchTx` · fason doğrudan
//      sevk `executeDirectShip`; kartela/kalan kapanışı müşteriye çıkış değildir — ölçüldü) bu kapıdan geçer:
//      çuvaldaki/sevkteki topun owner'ı dolu ∧ ≠ sevk müşterisi ⇒ 409, etkilenen HER top barkoduyla listelenir.
//      Bayraktan BAĞIMSIZ: veri varsa çalışır (bayrak sonradan kapatılsa emanet mal yanlış müşteriye gitmez).
//      Aynı soruyu sevk ÖNİZLEMESİ de sorar (`findOwnerMismatches`, red değil uyarı + `ownerMismatches[]`) —
//      yüklem TEK yerde yaşar ki önizleme "geçer" derken dispatch 409 vermesin.
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { readEmanetEnabled } from "../system-setting.service";

type Tx = Prisma.TransactionClient;

/** ① Owner verildiyse emanet modülü AÇIK olmalı — kapalıyken 403 (levent/iplik satırı gövde kapısı emsali). */
export async function assertEmanetWritableTx(tx: Pick<Tx, "systemSetting">, ownerCustomerId: string | null | undefined, nesne: string): Promise<void> {
  if (!ownerCustomerId) return;
  if (!(await readEmanetEnabled(tx))) {
    throw AppError.forbidden(`Emanet modülü bu kurulumda kapalı — ${nesne} için sahip müşteri yazılamaz. Genel Ayarlar → Modüller bölümünden açılabilir.`, { code: "MODULE_DISABLED", modul: "emanet" });
  }
  const c = await (tx as Tx).customer.findUnique({ where: { id: ownerCustomerId }, select: { id: true, isActive: true } });
  if (!c || !c.isActive) throw AppError.badRequest("Sahip müşteri bulunamadı ya da pasif", { code: "OWNER_CUSTOMER_INVALID", ownerCustomerId });
}

/** Tek owner ya da null; birden çok farklı owner ⇒ 409 (`nesne` mesaj için). */
function singleOwner(owners: Array<string | null>, nesne: string): string | null {
  const distinct = [...new Set(owners.filter((o): o is string => o !== null))];
  if (distinct.length > 1) {
    throw AppError.conflict(`${nesne} birden çok müşterinin emanet malını karıştırıyor — sahiplik belirsiz kalır, ayrı işlem yapın`, { code: "OWNER_MISMATCH", owners: distinct });
  }
  return distinct[0] ?? null;
}

/** ② Sarım: iplik çıkış lotlarının owner'ı → leventin owner'ı (lotsuz/ownersız satır düşürmez). */
export async function resolveOwnerFromLotsTx(tx: Pick<Tx, "yarnLot">, lotIds: string[]): Promise<string | null> {
  const ids = [...new Set(lotIds)];
  if (ids.length === 0) return null;
  const lots = await tx.yarnLot.findMany({ where: { id: { in: ids } }, select: { ownerCustomerId: true } });
  return singleOwner(lots.map((l) => l.ownerCustomerId), "Levent");
}

/** ② Fason dokuma makbuzu: iş adına iptal edilmemiş sevklerdeki leventlerin owner'ı → doğan topun owner'ı. */
export async function resolveOwnerFromBeamsTx(tx: Pick<Tx, "subcontractorDispatchItem">, weavingOrderId: string): Promise<string | null> {
  const items = await tx.subcontractorDispatchItem.findMany({
    where: { kind: "WARP_BEAM", dispatch: { weavingOrderId, cancelledAt: null } },
    select: { warpBeam: { select: { ownerCustomerId: true } } },
  });
  return singleOwner(items.map((i) => i.warpBeam?.ownerCustomerId ?? null), "Fason dokuma makbuzu");
}

export interface OwnerMismatchRow {
  barcode: string | null;
  owner: string | null;
}

/**
 * ③ Sahiplik uyuşmazlığı — TEK YÜKLEM: owner dolu ∧ ≠ sevk müşterisi. Kapı (409) ve önizleme (uyarı) aynı listeyi
 * okur; `customerId` null ise (müşteri henüz seçilmedi) owner'lı her top listelenir — sahibi dışında kimseye gidemez.
 */
export async function findOwnerMismatches(
  db: Pick<Tx, "roll">,
  input: { rollIds?: string[]; sackIds?: string[]; customerId: string | null },
): Promise<OwnerMismatchRow[]> {
  const scope: Prisma.RollWhereInput[] = [];
  if (input.rollIds && input.rollIds.length > 0) scope.push({ id: { in: input.rollIds } });
  if (input.sackIds && input.sackIds.length > 0) scope.push({ sackId: { in: input.sackIds } });
  if (scope.length === 0) return [];
  const clash = await db.roll.findMany({
    where: { OR: scope, ownerCustomerId: { not: null }, ...(input.customerId ? { NOT: { ownerCustomerId: input.customerId } } : {}) },
    select: { barcode: true, ownerCustomer: { select: { name: true } } },
    orderBy: { barcode: "asc" },
  });
  return clash.map((r) => ({ barcode: r.barcode, owner: r.ownerCustomer?.name ?? null }));
}

/** Uyuşmazlık listesinin operatör cümlesi — kapı mesajı ve önizleme uyarısı aynı metni basar. */
export function ownerMismatchText(rows: OwnerMismatchRow[], belge: string): string {
  const clashText = rows.map((r) => `${r.barcode ?? "?"} (${r.owner ?? "?"})`).join(", ");
  return `${rows.length} top başka müşterinin emanet malı — ${belge} bu müşteriye açılamaz: ${clashText}`;
}

/**
 * Önizleme ikizi: aynı liste, RED DEĞİL uyarı — operatör "Sevk Et"e basmadan görsün. Müşteri seçilmemişse owner'lı
 * her top "yalnız sahibine" diye listelenir. `warnings` önekli metin (`[OWNER_MISMATCH] …`), eski istemci onu basar.
 */
export async function previewOwnerMismatches(
  db: Pick<Tx, "roll">,
  input: { sackIds: string[]; customerId: string | null },
): Promise<{ ownerMismatches: OwnerMismatchRow[]; warnings: string[] }> {
  const ownerMismatches = await findOwnerMismatches(db, { sackIds: input.sackIds, customerId: input.customerId });
  if (ownerMismatches.length === 0) return { ownerMismatches, warnings: [] };
  const warning = input.customerId
    ? `[OWNER_MISMATCH] ${ownerMismatchText(ownerMismatches, "sevkiyat")} — Sevk Et reddedilir.`
    : `[OWNER_MISMATCH] ${ownerMismatches.length} top müşterinin EMANET malı (${ownerMismatches.map((r) => `${r.barcode ?? "?"} (${r.owner ?? "?"})`).join(", ")}) — yalnız sahibine sevk edilebilir.`;
  return { ownerMismatches, warnings: [warning] };
}

/** ③ Sevk sahiplik kapısı — etkilenen HER top listelenir (soyut sayı yetmez). */
export async function assertOwnerMatchesTx(tx: Pick<Tx, "roll">, input: { rollIds: string[]; customerId: string; belge: string }): Promise<void> {
  if (input.rollIds.length === 0) return;
  const clash = await findOwnerMismatches(tx, { rollIds: input.rollIds, customerId: input.customerId });
  if (clash.length === 0) return;
  throw AppError.conflict(ownerMismatchText(clash, input.belge), { code: "OWNER_MISMATCH", rolls: clash });
}
