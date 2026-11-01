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
import { Prisma } from "@prisma/client";
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

/** Kapsamların okunur metni ("sevk, fatura onayı") — bildirim yükü ve görüntü için. */
export function holdScopeText(h: Pick<ActiveCariHold, "blocksIntake" | "blocksShipment" | "blocksInvoice">): string {
  return holdScopes(h).map((s) => SCOPE_LABEL[s]).join(", ");
}

export function reasonLabel(code: string): string {
  return CARI_HOLD_REASON_LABELS[code as CariHoldReasonCode] ?? code;
}

/** Hesabın AKTİF kilidi (kısmi unique sayesinde en çok bir); yoksa null. */
export async function activeHoldByCari(db: HoldReader, cariId: string): Promise<ActiveCariHold | null> {
  return db.cariHold.findFirst({ where: { cariId, releasedAt: null }, select: ACTIVE_HOLD_SELECT });
}

/** D4-I3: "Kilitli" cari listesi süzgeci — liste ve sayım AYNI where'e bu parçayı koyar (tek yüklem). */
export const HELD_CARI_ACCOUNT_WHERE = { holds: { some: { releasedAt: null } } } as const satisfies Prisma.CariAccountWhereInput;
/** D4-I3: cari liste satırının aktif kilidi (include parçası; kısmi unique → en çok bir satır). */
export const ACTIVE_HOLD_INCLUDE = { where: { releasedAt: null }, select: ACTIVE_HOLD_SELECT, take: 1 } as const;

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

/**
 * LİSTE İKİZİ (D4-I4) — `activeHoldByCustomer`ın SQL ikizi: bir liste sorgusuna `LEFT JOIN LATERAL … ON TRUE` olarak
 * girer, ek sorgu açmaz (sorgu bütçesi `test_sevk_kapisi_cari_kilit` §3). Kart hesabı YA DA eski fason bacağı (K3a);
 * onarılmamış çiftte iki kilidin kapsamları birleşir. Kolonlar: `hold_intake`/`hold_shipment`/`hold_invoice` (kilit yoksa NULL).
 */
export function activeHoldFlagsLateralSql(customerIdCol: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`LEFT JOIN LATERAL (
    SELECT bool_or(ch."blocksIntake") AS hold_intake,
           bool_or(ch."blocksShipment") AS hold_shipment,
           bool_or(ch."blocksInvoice") AS hold_invoice
    FROM cari_holds ch
    JOIN cari_accounts ca ON ca.id = ch."cariId"
    LEFT JOIN subcontractors sc ON sc.id = ca."subcontractorId"
    WHERE ch."releasedAt" IS NULL AND (ca."customerId" = ${customerIdCol} OR sc."customerId" = ${customerIdCol})
  ) hold ON TRUE`;
}

/** Lateral kolonlarının satır görünümü. */
export interface HoldFlagRow {
  hold_intake: boolean | null;
  hold_shipment: boolean | null;
  hold_invoice: boolean | null;
}

/** Liste satırının kilit alanları — eski istemci yok sayar; `holdText` tablet çipinin TEK metin kaynağı. */
export interface ListHoldView {
  held: boolean;
  holdScopes: CariHoldScope[];
  holdText: string | null;
}

/**
 * Lateral satırından liste görünümü. `emanetMode` (`finance.cariHold.emanetShipment`) yalnız SEVK kapsamlı kilitte
 * metne girer: emanet sevkinin bu kilitte geçip geçmediğini söyler (K22 / D4-I1c).
 */
export function listHoldView(row: HoldFlagRow, emanetMode: string): ListHoldView {
  const flags = { blocksIntake: row.hold_intake === true, blocksShipment: row.hold_shipment === true, blocksInvoice: row.hold_invoice === true };
  const scopes = holdScopes(flags);
  if (scopes.length === 0) return { held: false, holdScopes: [], holdText: null };
  const tail = !flags.blocksShipment
    ? "sevk serbest"
    : emanetMode === "ALL_HELD"
      ? "emanet dahil sevk durur"
      : emanetMode === "PROCESSED_HELD"
        ? "yalnız işlenmemiş emanet sevk edilir"
        : "müşterinin kendi emaneti sevk edilir";
  return { held: true, holdScopes: scopes, holdText: `Cari kilitli (${holdScopeText(flags)}) — ${tail}` };
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
  /** K22: SHIPMENT kilidi, ayara göre emanet sevki aşıyorsa ısırmaz (önizlemede bilgi). */
  exempt?: boolean;
  /** D4-I1c: emanet sevki ayarı (`finance.cariHold.emanetShipment`) — yalnız SHIPMENT görünümünde. */
  emanetShipment?: string;
  /** D4-I1c: ayar yüzünden TUTULAN emanet toplar (barkod + sebep); karışık sevkte boş. */
  heldRolls?: HeldRollView[];
}

/** `emanet-shipment.helper` kararının bu dosyanın gördüğü yapısal yüzü (top tablosu okunmaz, import yok). */
export interface HeldRollView {
  rollId: string;
  barcode: string | null;
  reason: "PROCESSED" | "ALL_HELD";
}
export interface EmanetReleaseView {
  mode: string;
  exempt: boolean;
  heldRolls: HeldRollView[];
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
  return AppError.conflict(n.message, {
    code: "CARI_HOLD",
    holdId: n.holdId,
    scope: n.scope,
    sebep: n.sebep,
    koyan: n.koyan,
    tarih: n.tarih,
    ...(n.heldRolls && n.heldRolls.length > 0 ? { emanetShipment: n.emanetShipment, heldRolls: n.heldRolls } : {}),
  });
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

/** Tutulan emanet topların cümlesi — kapı mesajı ve önizleme uyarısı aynı metni basar. */
function heldRollsText(rolls: HeldRollView[]): string {
  // Toast okunur kalsın: ilk 10 barkod + kalan sayısı; tam liste `details.heldRolls`ta.
  const shown = rolls.slice(0, 10).map((r) => r.barcode ?? "?").join(", ");
  const list = rolls.length > 10 ? `${shown} +${rolls.length - 10} top daha` : shown;
  return rolls[0]?.reason === "ALL_HELD"
    ? ` Fabrika ayarı gereği müşterinin emanet malı da kilit açılana dek sevk edilmez (${rolls.length} top: ${list}).`
    : ` Fabrika ayarı gereği işlenmiş emanet top kilit açılana dek sevk edilmez (${rolls.length} işlenmiş top: ${list}); işlenmemiş emanet ayrı sevkle iade edilebilir.`;
}

/**
 * SEVK KAPISI (SHIPMENT) — `emanetRelease` yalnız kilit VARSA sorulur (kilitsiz yol tek okuma). Karar çağırandan gelir
 * (`emanet-shipment.helper` `emanetShipmentReleaseTx`, ayar + "işlenmiş" yüklemi orada); bu dosya top tablosunu okumaz.
 */
export async function shipmentHoldNotice(
  db: HoldReader & Pick<Prisma.TransactionClient, "user">,
  customerId: string,
  emanetRelease: () => Promise<EmanetReleaseView>,
): Promise<CariHoldNotice | null> {
  const notice = await cariHoldNotice(db, customerId, "SHIPMENT");
  if (!notice) return null;
  const release = await emanetRelease();
  // EXEMPT görünümü D4-I1b ile bayt-aynı kalır; yalnız PROCESSED_HELD muafiyeti modunu söyler.
  if (release.exempt) return release.mode === "EXEMPT" ? { ...notice, exempt: true } : { ...notice, exempt: true, emanetShipment: release.mode };
  if (release.heldRolls.length === 0) return notice;
  return { ...notice, emanetShipment: release.mode, heldRolls: release.heldRolls, message: notice.message + heldRollsText(release.heldRolls) };
}

export async function assertShipmentNotHeldTx(
  db: HoldReader & Pick<Prisma.TransactionClient, "user">,
  customerId: string,
  emanetRelease: () => Promise<EmanetReleaseView>,
): Promise<void> {
  const notice = await shipmentHoldNotice(db, customerId, emanetRelease);
  if (notice && !notice.exempt) throw holdError(notice);
}

/** Önizleme uyarı metni (warnings[] satırı) — kapı metniyle aynı kaynak. */
export function cariHoldWarning(n: CariHoldNotice): string {
  if (!n.exempt) return n.message;
  const why = n.emanetShipment === "PROCESSED_HELD" ? "müşterinin kendi emaneti ve hiçbiri işlenmemiş" : "müşterinin kendi emaneti";
  return `Bu müşterinin carisi sevke kilitli (${n.sebepEtiketi}), ancak sevkteki tüm toplar ${why} olduğu için sevk durdurulmaz.`;
}
