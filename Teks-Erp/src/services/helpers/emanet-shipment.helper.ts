// =============================================================================
// KİLİTLİ CARİDE EMANET SEVKİ — TEK KARAR (D4-I1c, S11; tasarım DALGA4 K22 · §10.5 md. 6)
// =============================================================================
// Soru: "SHIPMENT kilitli carinin sevkinde, sevkteki emanet toplar kilidi aşar mı?" YALNIZ burada sorulur;
// kilit kapısı (`cari-hold.helper` `shipmentHoldNotice`) ve risk kapısı aynı kararı bu fonksiyondan alır.
// Ayar `finance.cariHold.emanetShipment` (hapis hakkı seçimi fabrikanındır, hukuki teyit önerilir):
//   EXEMPT (varsayılan, bugünkü) — sevkteki TÜM toplar sevk müşterisinin emanetiyse kilit ısırmaz
//   PROCESSED_HELD — tüm toplar emanet ∧ hiçbiri İŞLENMİŞ değilse geçer; işlenmiş emanet top tutulur
//   ALL_HELD — emanet de tutulur (kilit açılınca serbest)
// Karışık sevk (fabrikanın ya da başkasının topu var) her modda kilidin kendisine takılır.
// "İşlenmiş" yüklemi TEK yerde: `PROCESSED_ROLL_WHERE` (bekçi `test_cari_kilit_emanet_ayari` §0).
// =============================================================================
import { Prisma, RollEntrySource } from "@prisma/client";
import { ROLL_DISPLAY_ORDER } from "../../constants/roll-order";
import { readFinanceCariHoldEmanetShipment, type CariHoldEmanetShipment } from "../system-setting.service";
import { rollsAllOwnedByTx } from "./emanet-owner.helper";

type Db = Pick<Prisma.TransactionClient, "roll" | "systemSetting">;

/**
 * İŞLENMİŞ top = fabrikanın emeği değmiş: aktif işlem izi (kurşun · kalite · tambur · fason gönderim/dönüş; tambur
 * çocuğuna kalıtımla kopyalanan iz dahil) ∨ aktif makine ölçümü (kurşun/istasyon sayacı, tambur kesimi) ∨ işlemden
 * doğmuş top (tambur parçası/manuel tambur, fason dönüşü). Özellik satırı (`RollProperty`) SAYILMAZ: iş emri hedefi
 * de oraya yazılır, iş yapıldığını kanıtlamaz.
 */
export const PROCESSED_ROLL_WHERE: Prisma.RollWhereInput = {
  OR: [
    { operations: { some: { revokedAt: null } } },
    { meterReadings: { some: { revokedAt: null } } },
    { parentRollId: { not: null } },
    { entrySource: { in: [RollEntrySource.TAMBUR_SPLIT, RollEntrySource.TAMBUR_MANUAL, RollEntrySource.SUBCONTRACTOR_RETURN] } },
  ],
};

export type HeldEmanetReason = "PROCESSED" | "ALL_HELD";

export interface HeldEmanetRoll {
  rollId: string;
  barcode: string | null;
  reason: HeldEmanetReason;
}

/** Kapı/önizleme kararı: `exempt` → SHIPMENT kilidi bu sevki ısırmaz; değilse `heldRolls` tutulan emanet toplardır. */
export interface EmanetShipmentRelease {
  mode: CariHoldEmanetShipment;
  exempt: boolean;
  heldRolls: HeldEmanetRoll[];
}

/**
 * Kümedeki toplar için kararı verir — çağıran yalnız kilit VARSA çağırır (kilitsiz yol okumaz). Karışık küme →
 * `exempt:false, heldRolls:[]` (kilidin kendi metni yeter; bugünkü davranış).
 */
export async function emanetShipmentReleaseTx(db: Db, where: Prisma.RollWhereInput, customerId: string): Promise<EmanetShipmentRelease> {
  const mode = await readFinanceCariHoldEmanetShipment(db);
  if (!(await rollsAllOwnedByTx(db, where, customerId))) return { mode, exempt: false, heldRolls: [] };
  if (mode === "EXEMPT") return { mode, exempt: true, heldRolls: [] };
  const held = await db.roll.findMany({
    where: mode === "ALL_HELD" ? where : { AND: [where, PROCESSED_ROLL_WHERE] },
    select: { id: true, barcode: true },
    orderBy: ROLL_DISPLAY_ORDER,
  });
  const reason: HeldEmanetReason = mode === "ALL_HELD" ? "ALL_HELD" : "PROCESSED";
  return { mode, exempt: held.length === 0, heldRolls: held.map((r) => ({ rollId: r.id, barcode: r.barcode, reason })) };
}
