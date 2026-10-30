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
import { cariAccountWhereForCard } from "./cari-card-where.helper";

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
  return db.cariHold.findFirst({
    where: {
      releasedAt: null,
      ...(scope ? { [SCOPE_COLUMN[scope]]: true } : {}),
      cari: cariAccountWhereForCard({ customerId, subcontractorId: null }),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: ACTIVE_HOLD_SELECT,
  });
}

/**
 * KAPI: müşterinin aktif kilidi `scope`u kapsıyorsa 409 `CARI_HOLD` (+ holdId, sebep, koyan, tarih). Kilit yoksa
 * ya da kapsam dışıysa geçer. Okuma READ COMMITTED; yeni kilit uzayı açmaz (tasarım §10.5 md. 3).
 */
export async function assertCariNotHeldTx(
  db: HoldReader & Pick<Prisma.TransactionClient, "user">,
  customerId: string,
  scope: CariHoldScope,
): Promise<void> {
  const hold = await activeHoldByCustomer(db, customerId, scope);
  if (!hold) return;
  const placer = await db.user.findUnique({ where: { id: hold.placedById }, select: { fullName: true, username: true } });
  const placedBy = placer?.fullName || placer?.username || "bilinmeyen kullanıcı";
  const at = factoryDateTimeTr(hold.createdAt);
  throw AppError.conflict(
    `Bu müşterinin carisi kilitli (${reasonLabel(hold.reasonCode)}) — ${SCOPE_LABEL[scope]} durduruldu. ` +
      `Kilidi ${placedBy} ${at} tarihinde koydu. Kilidi yalnız "Cari kilidini aç" yetkisi olan kişi (Muhasebe) açabilir.`,
    {
      code: "CARI_HOLD",
      holdId: hold.id,
      scope,
      sebep: hold.reasonCode,
      koyan: placedBy,
      tarih: hold.createdAt.toISOString(),
    },
  );
}
