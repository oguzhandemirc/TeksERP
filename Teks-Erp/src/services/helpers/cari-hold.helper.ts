// =============================================================================
// CARİ KİLİDİ — TEK YÜKLEM (D4-I1, ister 4.7; tasarım DALGA4 §10.5)
// =============================================================================
// "Bu carinin şu kapsamda aktif kilidi var mı" sorusu YALNIZ burada sorulur: `activeHoldByCari`,
// `activeHoldByCustomer`, `assertCariNotHeldTx`. Yüklemi başka dosyada yazmak AST bekçisinde kırmızıdır
// (`test_cari_kilit` §0). Kapı modülden bağımsızdır: kilit satırı yoksa hiçbir yol değişmez.
//
// ⚠️ YALNIZ `cariHold` (+ kişi adı için `user`) okur; finans servisi / `finance.helper` IMPORT ETMEZ.
// Kapı çekirdek boğazlardan (gelen belge, sipariş, sevk) çağrılacak (D4-I1b); bu dosya ticaret modeline
// transitif dokunursa o router'lar `test_finance_regime_gate`te kapısız sayılırdı (§4 ölçer).
// Kart → hesap, hesap tablosuna erişmeden ilişki süzgeciyle çözülür (K3a where'i, tek kaynak).
// =============================================================================
import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { factoryDateTimeTr } from "../../constants/time";
import { cariAccountWhereForCard, type CardRef } from "./cari-card-where.helper";

export type CariHoldScope = "INTAKE" | "SHIPMENT" | "INVOICE";
export const CARI_HOLD_SCOPES: readonly CariHoldScope[] = ["INTAKE", "SHIPMENT", "INVOICE"];

/** Sebep kodu kataloğu (kod kalıcı, etiket görünür). Rapor/patron anahtarı koddur; serbest metin ayrı kolonda. */
export const CARI_HOLD_REASON_CODES = ["BORC", "RISK", "ANLASMAZLIK", "DIGER"] as const;
export type CariHoldReasonCode = (typeof CARI_HOLD_REASON_CODES)[number];
export const CARI_HOLD_REASON_LABELS: Record<CariHoldReasonCode, string> = {
  BORC: "Borç",
  RISK: "Risk",
  ANLASMAZLIK: "Anlaşmazlık",
  DIGER: "Diğer",
};

const SCOPE_COLUMN = {
  INTAKE: "blocksIntake",
  SHIPMENT: "blocksShipment",
  INVOICE: "blocksInvoice",
} as const satisfies Record<CariHoldScope, keyof Prisma.CariHoldWhereInput>;

const SCOPE_LABEL: Record<CariHoldScope, string> = {
  INTAKE: "yeni iş kabulü",
  SHIPMENT: "sevk",
  INVOICE: "fatura onayı",
};

export const ACTIVE_HOLD_SELECT = {
  id: true,
  cariId: true,
  blocksIntake: true,
  blocksShipment: true,
  blocksInvoice: true,
  reasonCode: true,
  reasonText: true,
  placedById: true,
  createdAt: true,
} as const satisfies Prisma.CariHoldSelect;
export type ActiveCariHold = Prisma.CariHoldGetPayload<{ select: typeof ACTIVE_HOLD_SELECT }>;

type HoldReader = Pick<Prisma.TransactionClient, "cariHold">;

/** Kilidin kapsam listesi (görüntü/yanıt için). */
export function holdScopes(h: Pick<ActiveCariHold, "blocksIntake" | "blocksShipment" | "blocksInvoice">): CariHoldScope[] {
  return CARI_HOLD_SCOPES.filter((s) => h[SCOPE_COLUMN[s]]);
}

export function reasonLabel(code: string): string {
  return CARI_HOLD_REASON_LABELS[code as CariHoldReasonCode] ?? code;
}

/** Hesabın AKTİF kilidi (kısmi unique sayesinde en çok bir); yoksa null. */
export async function activeHoldByCari(db: HoldReader, cariId: string): Promise<ActiveCariHold | null> {
  return db.cariHold.findFirst({ where: { cariId, releasedAt: null }, select: ACTIVE_HOLD_SELECT });
}

/**
 * Kartın AKTİF kilidi — kart hesabı YA DA eski fason bacağı hesabı (K3a where'i). Onarılmamış çiftte iki
 * hesapta ayrı kilit olabilir: `scope` verilirse o kapsamı kapsayan kilit WHERE'de aranır (fail-closed);
 * sıra eşitlik bozucuyla belirlenimli.
 */
export async function activeHoldByCustomer(
  db: HoldReader,
  customerId: string,
  scope?: CariHoldScope,
): Promise<ActiveCariHold | null> {
  return activeHoldByCard(db, { customerId, subcontractorId: null }, scope);
}

/** Kart (ya da bağsız fason profili) kimliğiyle aktif kilit — fatura onayı hesabın kartından sorar (K3a where'i). */
export async function activeHoldByCard(db: HoldReader, card: CardRef, scope?: CariHoldScope): Promise<ActiveCariHold | null> {
  return db.cariHold.findFirst({
    where: {
      releasedAt: null,
      ...(scope ? { [SCOPE_COLUMN[scope]]: true } : {}),
      cari: cariAccountWhereForCard(card),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: ACTIVE_HOLD_SELECT,
  });
}

/** Kapının ve önizlemenin ORTAK görünümü — 409 `details`ı ve önizleme `cariHold{}`i aynı alanları taşır. */
export interface CariHoldNotice {
  holdId: string;
  scope: CariHoldScope;
  scopes: CariHoldScope[];
  sebep: string;
  sebepEtiketi: string;
  koyan: string;
  tarih: string;
  message: string;
  /** K22: SHIPMENT kilidi, sevkteki TÜM toplar sevk müşterisinin emanetiyse ısırmaz (önizlemede bilgi). */
  exempt?: boolean;
}

/** Müşterinin `scope`u kapsayan aktif kilidi varsa görünümü; yoksa null (önizleme bunu uyarıya çevirir). */
export async function cariHoldNotice(
  db: HoldReader & Pick<Prisma.TransactionClient, "user">,
  customer: string | CardRef,
  scope: CariHoldScope,
): Promise<CariHoldNotice | null> {
  const card: CardRef = typeof customer === "string" ? { customerId: customer, subcontractorId: null } : customer;
  const hold = await activeHoldByCard(db, card, scope);
  if (!hold) return null;
  const placer = await db.user.findUnique({ where: { id: hold.placedById }, select: { fullName: true, username: true } });
  const placedBy = placer?.fullName || placer?.username || "bilinmeyen kullanıcı";
  const at = factoryDateTimeTr(hold.createdAt);
  return {
    holdId: hold.id,
    scope,
    scopes: holdScopes(hold),
    sebep: hold.reasonCode,
    sebepEtiketi: reasonLabel(hold.reasonCode),
    koyan: placedBy,
    tarih: hold.createdAt.toISOString(),
    message:
      `Bu müşterinin carisi kilitli (${reasonLabel(hold.reasonCode)}) — ${SCOPE_LABEL[scope]} durduruldu. ` +
      `Kilidi ${placedBy} ${at} tarihinde koydu. Kilidi yalnız "Cari kilidini aç" yetkisi olan kişi (Muhasebe) açabilir.`,
  };
}

function holdError(n: CariHoldNotice): AppError {
  return AppError.conflict(n.message, { code: "CARI_HOLD", holdId: n.holdId, scope: n.scope, sebep: n.sebep, koyan: n.koyan, tarih: n.tarih });
}

/**
 * KAPI: müşterinin aktif kilidi `scope`u kapsıyorsa 409 `CARI_HOLD` (+ holdId, sebep, koyan, tarih). Kilit yoksa
 * ya da kapsam dışıysa geçer. Okuma READ COMMITTED; yeni kilit uzayı açmaz (tasarım §10.5 md. 3).
 */
export async function assertCariNotHeldTx(
  db: HoldReader & Pick<Prisma.TransactionClient, "user">,
  customer: string | CardRef,
  scope: CariHoldScope,
): Promise<void> {
  const notice = await cariHoldNotice(db, customer, scope);
  if (notice) throw holdError(notice);
}

/**
 * K22: kilit altında emanetin SAHİBİNE sevki — S11 (TBK hapis hakkı) cevabına kadar kod sabiti, ayar DEĞİL (yasal karar).
 * EXEMPT: sevkteki TÜM toplar sevk müşterisinin emanetiyse SHIPMENT kilidi ısırmaz; karışık sevk kesilir.
 */
export const CARI_HOLD_EMANET_SHIPMENT: "EXEMPT" | "BLOCK" = "EXEMPT";

/**
 * SEVK KAPISI (SHIPMENT) — `ownEmanetOnly` yalnız kilit VARSA sorulur (kilitsiz yol tek okuma). Emanet verisi
 * çağırandan gelir (`emanet-owner.helper` `rollsAllOwnedByTx`); bu dosya top tablosunu okumaz.
 */
export async function shipmentHoldNotice(
  db: HoldReader & Pick<Prisma.TransactionClient, "user">,
  customerId: string,
  ownEmanetOnly: () => Promise<boolean>,
): Promise<CariHoldNotice | null> {
  const notice = await cariHoldNotice(db, customerId, "SHIPMENT");
  if (!notice) return null;
  if (CARI_HOLD_EMANET_SHIPMENT === "EXEMPT" && (await ownEmanetOnly())) return { ...notice, exempt: true };
  return notice;
}

export async function assertShipmentNotHeldTx(
  db: HoldReader & Pick<Prisma.TransactionClient, "user">,
  customerId: string,
  ownEmanetOnly: () => Promise<boolean>,
): Promise<void> {
  const notice = await shipmentHoldNotice(db, customerId, ownEmanetOnly);
  if (notice && !notice.exempt) throw holdError(notice);
}

/** Önizleme uyarı metni (warnings[] satırı) — kapı metniyle aynı kaynak. */
export function cariHoldWarning(n: CariHoldNotice): string {
  return n.exempt
    ? `Bu müşterinin carisi sevke kilitli (${n.sebepEtiketi}), ancak sevkteki tüm toplar müşterinin kendi emaneti olduğu için sevk durdurulmaz.`
    : n.message;
}
