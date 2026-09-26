// =============================================================================
// ÇEK / SENET TESLİM BORDROSU SERVİSİ (2026-08-15, J2 #18)
// =============================================================================
// Çek/senet teslim bordrosunun TEK resmî belgesi (K1, 2026-09-26). Panelin eski
// "anlık bordrosu" artık ayrı bir kâğıt değil, bu belgenin numarasız TASLAĞIdır
// (`draft`): aynı seçim kuralları, aynı doc kurucusu, aynı renderer.
//
// ⚠️⚠️ BAYRAK KAPALIYKEN (`finance.chequeNoteMovementEnabled`, varsayılan) BELGE-ONLY: bordro
// çekin durumuna ve deftere DOKUNMAZ, yalnız KÂĞIT üretir (dönem kilidi yok, bakiye oynamaz).
// AÇIKKEN HAREKET FİŞİ (K3): aldığımız çek + banka → bankaya verme, + cari → ciro; tekil bankaya
// verme/ciro da tek satırlı bordro keser ki aynı fiziksel olay İKİ bağımsız yoldan tetiklenmesin.
// Kural tablosu, satır kapısı ve ters yol `cheque-note-movement.service`te; ters yolu bayrak değil
// `ChequeEvent.deliveryNoteId` bağı seçer (bayrak sonradan kapansa da hareketli bordro hareketiyle döner).
// KİLİT SIRASI: 8036 (token, ilk ifade) → çek claim'leri CHEQUE_ORDER → docNo → 8026 sıralı → yazımlar.
//
// H6'DAN AYNALANAN ÜÇ KURAL (üçü de burada FAIL-CLOSED):
//   ① BİR BORDRO TEK YÖN TAŞIR (aldığımız ⊻ verdiğimiz). Karışık seçimde TOPLAM
//      iki ayrı şey demeye başlar ve "teslim alan" imzası neyin teslim
//      alındığını söylemez olur; ayrıca iki yön farklı karşı tarafa gider.
//   ② İPTAL EDİLMİŞ KAYIT BORDROYA GİREMEZ. Resmen "yok" sayılmış bir kâğıdı
//      teslim edilenler listesine yazmak, karşı tarafa var olmayan bir kıymet
//      için imza attırmaktır.
//   ③ FARKLI PARA BİRİMLERİ TOPLANMAZ — tek TOPLAM yalnız liste tek para
//      birimindeyken; her durumda para birimi bazlı ara toplam basılır.
// H6'da ① ve ② ekran katmanında da yaşar (`selectionBlockReason`); orası bir
// NEZAKETTİR, kuralı koruyan taraf üreticidir — burada da öyle.
//
// ⚠️ `clientToken` (K1): ağ zaman aşımından sonraki ikinci gönderim ikinci BRD
// açmaz; replay dört durumlu (`helpers/token-replay.helper`).
// =============================================================================
import {
  ChequeDeliveryNoteStatus,
  ChequeEventType,
  ChequeKind,
  ChequeStatus,
  Currency,
  Prisma,
  PrintedDocType,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { isClientTokenP2002 } from "../utils/p2002";
import { assertChequeDeliveryNoteReplayAlive, lockClientTokenTx } from "./helpers/token-replay.helper";
import { RBAC_DENIED_CODE } from "../middlewares/rbac.middleware";
import { resolveChequeNoteMovementEnabled } from "./system-setting.service";
import {
  CHEQUE_STATUS_LABEL,
  chequeService,
  type ChequeEventInput,
  type ChequeMoveResult,
  type ChequeTransitionRow,
  type ForwardTarget,
} from "./cheque.service";
import {
  assertIssuedTargetTx,
  assertNoBlockedRows,
  auditChequeMovements,
  claimMovementTx,
  DELIVERY_ITEMS_ADVANCED,
  DELIVERY_NOTE_HAS_MOVEMENTS,
  inspectReversalsTx,
  liveChequeIds,
  movementEventNotes,
  movementFor,
  noteMovementStateTx,
  planMovementTx,
  reverseMovementsTx,
  writeMovementTx,
  type ClaimedMove,
  type MovementPlanRow,
  type NoteMovementType,
  type ReversalCheck,
} from "./cheque-note-movement.service";
import { nextSeriesNo } from "./number-series.service";
import { buildTurkishSearch } from "../utils/query-parser";
import { D, D0 } from "./helpers/finance.helper";
import { printedDocumentService, registerPrintedDocBuilder } from "./printed-document.service";
import {
  renderChequeDeliveryNoteHtml,
  renderChequeDeliveryNoteTables,
  type ChequeDeliveryLine,
  type ChequeDeliveryNoteDoc,
  type ChequeDeliveryTotal,
} from "./document-render/finance-doc.html";
import type { DocTablesPayload } from "./document-render/doc-model";
import type { ApiResponse } from "../types/api.types";

/** Bordro ön eki — BRD + GGAAYY + NNNN. */
const DOC_PREFIX = "BRD";

/** Taslağın numarası yoktur; kâğıtta "Belge No" satırı bunu basar (TASLAK filigranıyla). */
const DRAFT_DOC_NO = "TASLAK";

/** Yön etiketi — belgenin BAŞLIĞINA girer (H6 `KIND_LABEL` aynası). */
export const BORDRO_KIND_LABEL: Record<ChequeKind, string> = {
  RECEIVED: "Alınan",
  ISSUED: "Verilen",
};

/**
 * Günlük sıralı belge numarası — `nextInvoiceNoTx`/`nextChequeNo` kanıtlı deseni
 * (JS'te sayısal max; `orderBy` glibc collation'da 9→10 geçişinde bozulur).
 * Çağıran `withBarcodeRetry` ile sarmalar.
 */
async function nextNoteNo(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  return nextSeriesNo("chequeDeliveryNote", async (full) => {
    const rows = await tx.chequeDeliveryNote.findMany({
      where: { docNo: { gte: full, startsWith: full } },
      select: { docNo: true, createdAt: true },
    });
    return rows.map((r) => ({ code: r.docNo, createdAt: r.createdAt }));
  }, date);
}

/** Para birimi bazlı adet + toplam — `Currency` beyan sırasında (deterministik). */
const CURRENCY_ORDER: Currency[] = Object.values(Currency);

export function totalsByCurrency(
  rows: ReadonlyArray<{ currency: Currency; amount: Prisma.Decimal }>,
): Array<{ currency: Currency; count: number; amount: Prisma.Decimal }> {
  const map = new Map<Currency, { count: number; amount: Prisma.Decimal }>();
  for (const r of rows) {
    const cur = map.get(r.currency) ?? { count: 0, amount: D0() };
    map.set(r.currency, { count: cur.count + 1, amount: cur.amount.plus(D(r.amount)) });
  }
  return [...map]
    .map(([currency, v]) => ({ currency, count: v.count, amount: v.amount }))
    .sort((a, b) => CURRENCY_ORDER.indexOf(a.currency) - CURRENCY_ORDER.indexOf(b.currency));
}

export interface CreateChequeDeliveryNoteInput {
  chequeIds: string[];
  /** Teslim tarihi — verilmezse BUGÜN (belge numarasının GGAAYY çıpası). */
  deliveryDate?: Date;
  /** Hedef: banka hesabı ⊻ cari; ikisi de opsiyonel. */
  bankAccountId?: string | null;
  cariId?: string | null;
  /** Serbest hedef metni (H6 `place`). Yapılandırılmış hedefle birlikte de olabilir. */
  targetLabel?: string | null;
  notes?: string | null;
  /**
   * "Bu çekler zaten AKTİF bir bordroda" uyarısını GEÇ (kullanıcı gördü, onayladı).
   * Varsayılan `false` → uyarı 409 ile döner. Bkz. `assertNotAlreadyDelivered`.
   */
  confirmDuplicate?: boolean;
  /** Mantıksal deneme kimliği (uuid) — aynı token ikinci BRD açmaz. */
  clientToken?: string | null;
}

/** Taslak girdisi — kaydın alanları; token ve mükerrer onayı taslakta anlamsız. */
export type ChequeDeliveryNoteDraftInput = Omit<
  CreateChequeDeliveryNoteInput,
  "confirmDuplicate" | "clientToken"
>;

/** Aktif bir bordroda duran çek uyarısının makine-okunur kodu (panel bunu yakalar). */
export const ALREADY_IN_ACTIVE_NOTE = "ALREADY_IN_ACTIVE_NOTE";

/**
 * BORDRO SATIR SIRASI — TEK KAYNAK (2026-08-15).
 *
 * ⚠️⚠️ `orderBy: { createdAt: "asc" }` BURADA HİÇBİR ŞEY SIRALAMAZ. Pivot
 * satırları tek `createMany` ile, tek transaction içinde doğuyor ve kolonun
 * DEFAULT'u `CURRENT_TIMESTAMP` — PostgreSQL'de bu TRANSACTION BAŞLANGICIDIR,
 * yani bütün satırlarda BİREBİR AYNI değerdir (ölçüldü: 3 satır → 1 farklı
 * damga; `invoice_lines`ta da aynı desen). Tüm anahtarlar eşit olunca `ORDER BY`
 * bir garanti VERMEZ (PG tuplesort kararlı/stable değildir; girdi sırası plana
 * göre değişir). Somut sonucu: 5 çekli bir bordro v1 olarak donar, karşı taraf
 * "SIRA 1..5" numaralı kâğıdı imzalar, aylar sonra `reissue` ile üretilen v2
 * aynı çekleri BAŞKA sırada ve başka SIRA numaralarıyla basabilir — ya da detay
 * ekranı imzalanmış kâğıttan farklı sırada listeler.
 *
 * ⚠️ Sıra ANLAMLI seçildi, keyfî değil: VADE — `Cheque.dueDate` zaten "portföyün
 * birinci sıralama anahtarı"dır (şema), yani teslim tutanağını imzalayan kişi
 * kâğıdı kendi listesiyle satır satır karşılaştırabilir. `docNo` (@unique) TAM
 * SIRA sağlar; `chequeId` mutlak son eşitlik bozucudur (aynı docNo iki kez
 * olamaz — o kolon bekçi, bu satır sigorta).
 *
 * ⚠️ BUILDER İLE DETAY UCU AYNI DİZİYİ KULLANIR. Ayrışırlarsa ekran ile kâğıt
 * aynı bordro için farklı sıra gösterir; emsal `traveler-card.buildPlan`ın
 * deterministik sıralama kuralı.
 */
const ITEM_ORDER = [
  { cheque: { dueDate: "asc" } },
  { cheque: { docNo: "asc" } },
  { chequeId: "asc" },
] satisfies Prisma.ChequeDeliveryNoteItemOrderByWithRelationInput[];

/** `ITEM_ORDER`in çek tablosundaki ikizi — taslak (henüz pivot yok) kâğıtla AYNI sırayı basar. */
const CHEQUE_ORDER = [
  { dueDate: "asc" },
  { docNo: "asc" },
  { id: "asc" },
] satisfies Prisma.ChequeOrderByWithRelationInput[];

/** Belge satırı için gereken çek alanları — TEK yerde (liste + builder aynı şekli okur). */
const CHEQUE_LINE_SELECT = {
  id: true,
  docNo: true,
  kind: true,
  docType: true,
  status: true,
  serialNo: true,
  issueDate: true,
  dueDate: true,
  drawerName: true,
  bankName: true,
  currency: true,
  amount: true,
} satisfies Prisma.ChequeSelect;

type ChequeLineRow = Prisma.ChequeGetPayload<{ select: typeof CHEQUE_LINE_SELECT }>;

/**
 * Seçimin tekilleştirilmesi — aynı çek iki kez gönderilirse pivot `@@unique`ine
 * çarpar ve kullanıcı ham bir P2002 görürdü; mükerrer satır zaten anlamsızdır.
 */
function normalizeChequeIds(ids: readonly string[] | undefined): string[] {
  const chequeIds = [...new Set((ids ?? []).filter(Boolean))];
  if (chequeIds.length === 0) {
    throw AppError.badRequest("Bordro için en az bir çek/senet seçin.");
  }
  return chequeIds;
}

/**
 * SEÇİMİN KENDİ TUTARLILIĞI — kayıt ile taslağın TEK kapısı (çekler var mı · iptal mi ·
 * tek yön mü). Satırlar kâğıttaki sırayla (`CHEQUE_ORDER`) döner.
 */
async function loadSelectionTx(
  tx: Prisma.TransactionClient,
  chequeIds: string[],
): Promise<{ cheques: ChequeLineRow[]; kind: ChequeKind }> {
  const cheques = await tx.cheque.findMany({
    where: { id: { in: chequeIds } },
    select: CHEQUE_LINE_SELECT,
    orderBy: CHEQUE_ORDER,
  });

  if (cheques.length !== chequeIds.length) {
    const found = new Set(cheques.map((c) => c.id));
    const missing = chequeIds.filter((id) => !found.has(id));
    throw AppError.badRequest(
      `Seçimdeki ${missing.length} çek/senet bulunamadı — listeyi yenileyip tekrar deneyin.`,
    );
  }

  const cancelled = cheques.filter((c) => c.status === ChequeStatus.CANCELLED);
  if (cancelled.length > 0) {
    throw AppError.badRequest(
      `Seçimde ${cancelled.length} iptal edilmiş kayıt var (${cancelled
        .map((c) => c.docNo)
        .join(", ")}) — iptal edilen çek/senet teslim bordrosuna giremez.`,
    );
  }

  const kinds = new Set(cheques.map((c) => c.kind));
  if (kinds.size > 1) {
    throw AppError.badRequest(
      "Bir teslim bordrosu TEK YÖN taşır: aldığımız çek/senetler ile verdiğimiz çek/senetler aynı bordroya giremez.",
    );
  }
  return { cheques, kind: cheques[0]!.kind };
}

/**
 * HEDEF — en fazla bir yapılandırılmış hedef (ikisi birden dolu bir bordro, aynı
 * kâğıdın iki yere teslim edildiğini iddia ederdi). Kâğıda basılacak adlar da döner.
 */
async function resolveTargetTx(
  tx: Prisma.TransactionClient,
  input: { bankAccountId?: string | null; cariId?: string | null },
): Promise<{ bankAccountId: string | null; cariId: string | null; bankName: string | null; cariName: string | null }> {
  const bankAccountId = input.bankAccountId ?? null;
  const cariId = input.cariId ?? null;
  if (bankAccountId && cariId) {
    throw AppError.badRequest(
      "Bordronun hedefi banka hesabı VEYA cari olabilir (ikisi birden değil).",
    );
  }
  let bankName: string | null = null;
  let cariName: string | null = null;
  if (bankAccountId) {
    const acc = await tx.bankAccount.findUnique({
      where: { id: bankAccountId },
      select: { name: true, isActive: true },
    });
    if (!acc) throw AppError.badRequest("Banka hesabı bulunamadı.");
    if (!acc.isActive) throw AppError.badRequest(`"${acc.name}" hesabı pasif durumda.`);
    bankName = acc.name;
  }
  if (cariId) {
    const cari = await tx.cariAccount.findUnique({
      where: { id: cariId },
      select: {
        isActive: true,
        customer: { select: { name: true } },
        subcontractor: { select: { name: true } },
      },
    });
    if (!cari) throw AppError.badRequest("Cari hesap bulunamadı.");
    if (!cari.isActive) throw AppError.badRequest("Seçilen cari hesap pasif durumda.");
    cariName = cari.customer?.name ?? cari.subcontractor?.name ?? null;
  }
  return { bankAccountId, cariId, bankName, cariName };
}

/**
 * Belgenin `doc`u — donmuş bordro (`fresh`) ile taslağın (`draft`) TEK kurucusu.
 * Hedef ÜÇ biçimden biri; serbest metin yapılandırılmış hedefin YANINA yazılır
 * (ör. "Ziraat — Kadıköy Şb.").
 */
function buildChequeDeliveryDoc(i: {
  documentNo: string;
  kind: ChequeKind;
  deliveryDate: Date;
  bankName: string | null;
  cariName: string | null;
  targetLabel: string | null;
  createdBy: string | null;
  notes: string | null;
  cheques: ChequeLineRow[];
}): ChequeDeliveryNoteDoc {
  const structured = i.bankName ?? i.cariName;
  const targetName = [structured, i.targetLabel].filter(Boolean).join(" — ") || null;
  const targetKindLabel = i.bankName
    ? "Teslim Edilen Banka"
    : i.cariName
      ? "Teslim Edilen Cari"
      : i.targetLabel
        ? "Teslim Edilen"
        : null;

  const lines: ChequeDeliveryLine[] = i.cheques.map((c) => ({
    docNo: c.docNo,
    serialNo: c.serialNo,
    issueDate: c.issueDate.toISOString(),
    dueDate: c.dueDate.toISOString(),
    drawerName: c.drawerName,
    bankName: c.bankName,
    currency: c.currency,
    amount: c.amount.toString(),
  }));
  const totals: ChequeDeliveryTotal[] = totalsByCurrency(i.cheques).map((t) => ({
    currency: t.currency,
    count: t.count,
    amount: t.amount.toString(),
  }));

  return {
    header: {
      documentNo: i.documentNo,
      date: i.deliveryDate.toISOString(),
      kind: i.kind,
      kindLabel: BORDRO_KIND_LABEL[i.kind],
      targetName,
      targetKindLabel,
      createdBy: i.createdBy,
    },
    lines,
    totals,
    notes: i.notes,
  };
}

async function userDisplayName(db: Prisma.TransactionClient, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const u = await db.user.findUnique({ where: { id: userId }, select: { fullName: true, username: true } });
  return u?.fullName ?? u?.username ?? null;
}

/** Token'la bulunan önceki kayıt — replay kararı için gereken tek şekil. */
const REPLAY_SELECT = {
  id: true,
  docNo: true,
  status: true,
  deliveryDate: true,
  bankAccountId: true,
  cariId: true,
  targetLabel: true,
  notes: true,
  items: { select: { chequeId: true } },
} satisfies Prisma.ChequeDeliveryNoteSelect;
type ReplayRow = Prisma.ChequeDeliveryNoteGetPayload<{ select: typeof REPLAY_SELECT }>;

/**
 * Token'lı önceki kayıt, token KİLİDİ altında — kilit tx'in İLK ifadesidir. Kilitsiz okuma
 * yarışta token'ı kaçırır ve iş kuralı (②) kazananın commit'ini görüp replay yerine 409 döner.
 */
async function lockedPriorByTokenTx(tx: Prisma.TransactionClient, clientToken: string): Promise<ReplayRow | null> {
  await lockClientTokenTx(tx, clientToken);
  return tx.chequeDeliveryNote.findUnique({ where: { clientToken }, select: REPLAY_SELECT });
}

/**
 * Replay'in üç dalı (① hiç yazılmadıysa çağrılmaz): iptal edilmişse 409 · aynı yük →
 * aynı BRD · başka yük → 409 `CLIENT_TOKEN_COLLISION`. Aynı yük = aynı çek kümesi +
 * aynı hedef + aynı not; teslim tarihi YALNIZ istemci gönderdiyse karşılaştırılır
 * (verilmezse "şimdi"dir ve iki denemede farklıdır).
 */
function resolveReplay(
  prior: ReplayRow,
  input: CreateChequeDeliveryNoteInput,
  chequeIds: string[],
): { id: string; docNo: string; count: number } {
  assertChequeDeliveryNoteReplayAlive(prior);
  const priorIds = prior.items.map((i) => i.chequeId).sort();
  const incomingIds = [...chequeIds].sort();
  const same =
    priorIds.length === incomingIds.length &&
    priorIds.every((id, k) => id === incomingIds[k]) &&
    prior.bankAccountId === (input.bankAccountId ?? null) &&
    prior.cariId === (input.cariId ?? null) &&
    prior.targetLabel === (input.targetLabel?.trim() || null) &&
    prior.notes === (input.notes?.trim() || null) &&
    (!input.deliveryDate || prior.deliveryDate.getTime() === input.deliveryDate.getTime());
  if (same) return { id: prior.id, docNo: prior.docNo, count: priorIds.length };
  throw AppError.conflict(
    `Bu form daha önce kaydedilmiş: ${prior.docNo}. Yeni bordro için formu kapatıp yeniden açın.`,
    { code: "CLIENT_TOKEN_COLLISION", noteId: prior.id, docNo: prior.docNo },
  );
}

/**
 * "BU ÇEKLER ZATEN AKTİF BİR BORDRODA" — ENGEL DEĞİL, ONAYLATMA (2026-08-15).
 *
 * ⚠️ NEDEN BLOK DEĞİL: aynı fiziksel çek hayatı boyunca BİRDEN FAZLA KEZ teslim
 * edilebilir (tahsile ver → karşılıksız dön → tedarikçiye ciro et) ve her teslim
 * KENDİ tutanağını hak eder — şema bunu açıkça öngörüyor (`Cheque.deliveryNoteItems`
 * çoğuldur). Sert bir guard, meşru ikinci teslimin kâğıdını imkânsız kılardı.
 *
 * ⚠️ NEDEN SESSİZ DE DEĞİL: aynı denemenin tekrarını `clientToken` tek bordroya
 * indirir, ama düzeltmek isteyen kullanıcı YENİ bir deneme açar: eski bordro
 * ACTIVE kalır ve aynı çekler için karşı tarafa imzalatılmış İKİ tutanak dolaşır;
 * hangisinin geçerli olduğunu söyleyen hiçbir kayıt yoktur. "Sessiz doğru cevap ≠
 * görünmez cevap" — kullanıcı görmeden karar veremez.
 *
 * DESEN: KK1 mükerrer tuzağının aynısı (409 + `confirm` ile geç). BAYRAK YOK
 * (bilinçli): bu bir onay adımıdır, engel değil; maliyeti nadir ve meşru bir
 * yolda tek tıktır, bayrak ise sahada açılması unutulacak ikinci bir şeydir.
 */
async function assertNotAlreadyDelivered(
  tx: Prisma.TransactionClient,
  chequeIds: string[],
  confirmed: boolean,
): Promise<void> {
  if (confirmed) return;
  const clashes = await tx.chequeDeliveryNoteItem.findMany({
    where: {
      chequeId: { in: chequeIds },
      note: { status: ChequeDeliveryNoteStatus.ACTIVE },
    },
    select: { chequeId: true, cheque: { select: { docNo: true } }, note: { select: { docNo: true } } },
  });
  if (clashes.length === 0) return;

  // İptal EDİLMİŞ bordrolar buraya hiç girmez (`status: ACTIVE` süzgeci): iptal
  // edilmiş bir tutanak "yok" sayılmıştır ve yenisini kesmek tam da beklenen yol.
  const notes = [...new Set(clashes.map((c) => c.note.docNo))].sort();
  const cheques = [...new Set(clashes.map((c) => c.cheque.docNo))].sort();
  throw AppError.conflict(
    `Seçimdeki ${cheques.length} kıymet zaten AKTİF bir teslim bordrosunda (${notes.join(", ")}). ` +
      "Düzeltme yapıyorsanız önce o bordroyu iptal edin; gerçekten yeniden teslim ediyorsanız onaylayın.",
    { code: ALREADY_IN_ACTIVE_NOTE, noteDocNos: notes, chequeDocNos: cheques },
  );
}

/** Hareket izni reddi — rota kapısıyla AYNI biçim (`details.code` + `required`). */
function chequePermissionDenied(): AppError {
  return AppError.forbidden("Bu işlem için 'finance:cheque' yetkisi gerekli.", {
    code: RBAC_DENIED_CODE,
    required: "finance:cheque",
  });
}

/** Kaydın yeni-yazım dalının sonucu — replay dalı yalnız kimlik + adet taşır. */
interface CreateOutcome {
  replay: boolean;
  id: string;
  docNo: string;
  count: number;
  kind?: ChequeKind;
  movement?: NoteMovementType | null;
  moved?: ChequeTransitionRow[];
}

interface CreateCtx {
  input: CreateChequeDeliveryNoteInput;
  chequeIds: string[];
  deliveryDate: Date;
  clientToken: string | null;
  movementOn: boolean;
  canMoveCheques: boolean;
  userId?: string;
}

/** Ters kaydın sonucu — tekil storno cevabı ve bordro iptali aynı şekli okur. */
interface ReverseOutcome {
  note: { id: string; docNo: string };
  cancelled: boolean;
  reversed: Array<{ id: string; docNo: string; type: NoteMovementType; backTo: ChequeStatus }>;
}

/** İptal önizlemesinin kalemi — geri alınamayanın NEDENİ tekil storno mesajıyla aynıdır. */
export interface CancelPreviewItem {
  chequeId: string;
  docNo: string;
  amount: string;
  currency: Currency;
  status: ChequeStatus;
  /** Bu bordronun çeke yaptığı hareket; belge-only bordroda `null`. */
  action: NoteMovementType | null;
  reversed: boolean;
  reversible: boolean;
  reason: string | null;
}

/** Geri alınamayan kalem varsa hiçbir şey yazılmaz; tek kalemde tekil stornonun mesajı aynen döner. */
function assertAllReversible(checks: ReversalCheck[], docNoOf: Map<string, string>): void {
  const failed = checks.filter((c) => !c.plan);
  if (failed.length === 0) return;
  const items = failed.map((c) => ({ chequeId: c.chequeId, docNo: docNoOf.get(c.chequeId) ?? "", reason: c.reason }));
  const message =
    failed.length === 1 && failed[0]?.reason
      ? failed[0].reason
      : `Seçimdeki ${failed.length} kıymet bu bordrodan sonra başka işlem gördü; hiçbiri geri alınmadı. Önce o işlemleri geri alın.`;
  throw AppError.conflict(message, { code: DELIVERY_ITEMS_ADVANCED, items });
}

export class ChequeDeliveryNoteService {
  /**
   * Bordro keser + belgeyi AYNI transaction'da dondurur; bayrak açıkken hareketi de aynı tx'te yapar.
   *
   * SIRA SÖZLEŞMESİ: önce SEÇİMİN KENDİ tutarlılığı (çekler var mı · iptal mi ·
   * tek yön mü), sonra MÜKERRER TESLİM onayı, sonra HEDEF çözümü. Ters sırada,
   * karışık yön gönderen istemci önce "banka hesabı bulunamadı" alır, düzeltir ve
   * asıl hatasını İKİ TUR SONRA öğrenirdi (`tambur-manual` SIRA sözleşmesinin
   * aynısı). Mükerrer onayı da seçim tutarlılığından SONRA gelir: kullanıcı önce
   * gerçek bir hatayı düzeltmeli, "yine de kes" onayını ondan sonra vermeli.
   */
  async create(
    input: CreateChequeDeliveryNoteInput,
    userId?: string,
    opts: { canMoveCheques?: boolean } = {},
  ): Promise<ApiResponse<{ id: string; docNo: string; count: number; replayed?: true; movement?: NoteMovementType | null }>> {
    const chequeIds = normalizeChequeIds(input.chequeIds);
    const deliveryDate = input.deliveryDate ?? new Date();
    const clientToken = input.clientToken ?? null;
    const movementOn = await resolveChequeNoteMovementEnabled();
    const ctx: CreateCtx = {
      input, chequeIds, deliveryDate, clientToken, movementOn, canMoveCheques: opts.canMoveCheques === true, userId,
    };

    let outcome: CreateOutcome;
    try {
      outcome = await withBarcodeRetry(
        async () =>
          prisma.$transaction(async (tx) => {
            // ⚠️ TOKEN ÖNCE (8036 ilk ifade): ilk deneme yazıldıysa çekler artık AKTİF bir bordrodadır
            // ve mükerrer onayı (②) replay'i "zaten bordroda" 409'una çevirirdi. Replay hareketi
            // yeniden KOŞMAZ.
            if (clientToken) {
              const prior = await lockedPriorByTokenTx(tx, clientToken);
              if (prior) return { replay: true, ...resolveReplay(prior, input, chequeIds) };
            }
            return { replay: false, ...(await this.createTx(tx, ctx)) };
          }),
        undefined,
        // Token P2002'si retry EDİLMEZ (retry aynı token'ı yazar) — aşağıda replay'e döner.
        (err) => !isClientTokenP2002(err),
      );
    } catch (err) {
      // Token kilidi aynı denemeleri serileştirir; bu dal kilidi atlayan bir yazara karşı savunmadır.
      if (!clientToken || !isClientTokenP2002(err)) throw err;
      const prior = await prisma.chequeDeliveryNote.findUnique({
        where: { clientToken },
        select: REPLAY_SELECT,
      });
      if (!prior) throw err;
      outcome = { replay: true, ...resolveReplay(prior, input, chequeIds) };
    }

    if (outcome.replay) {
      return {
        success: true,
        data: { id: outcome.id, docNo: outcome.docNo, count: outcome.count, replayed: true },
        message: `${outcome.docNo} zaten düzenlenmiş (aynı gönderim).`,
      };
    }

    const movement = outcome.movement ?? null;
    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CHEQUE_DELIVERY_NOTE",
      recordId: outcome.id,
      newData: {
        docNo: outcome.docNo, kind: outcome.kind, count: outcome.count, chequeIds, ...(movement ? { movement } : {}),
      },
    });
    if (movement && outcome.moved) {
      auditChequeMovements({
        userId,
        noteDocNo: outcome.docNo,
        rows: outcome.moved,
        event: movement,
        extra: movement === ChequeEventType.DEPOSIT ? { bankAccountId: input.bankAccountId } : {},
      });
    }
    const moveText = movement === ChequeEventType.DEPOSIT ? " — çekler bankaya verildi" : movement ? " — çekler ciro edildi" : "";
    return {
      success: true,
      data: { id: outcome.id, docNo: outcome.docNo, count: outcome.count, ...(movementOn ? { movement } : {}) },
      message: `${outcome.docNo} düzenlendi (${outcome.count} kıymet)${moveText}.`,
    };
  }

  /** Kaydın yeni-yazım dalı (token kilidi ve replay çağıranda). */
  private async createTx(tx: Prisma.TransactionClient, c: CreateCtx): Promise<Omit<CreateOutcome, "replay">> {
    // ── ① SEÇİMİN KENDİ TUTARLILIĞI ─────────────────────────────────────────
    const { cheques, kind } = await loadSelectionTx(tx, c.chequeIds);
    // Hareket kuralı hedefin KİMLİĞİNE bakar (serbest metin geçiş üretmez); tablo dışı kombinasyon 400.
    const movement = c.movementOn
      ? movementFor(kind, { bankAccountId: c.input.bankAccountId ?? null, cariId: c.input.cariId ?? null })
      : null;

    // ── ② MÜKERRER TESLİM ONAYI — yalnız belge-only bordroda ───────────────
    // ⚠️ SORGU TX İÇİNDE ama ADVISORY LOCK YOK ve bu BİLİNÇLİ: bu bir INVARIANT değil ONAY
    // adımıdır. Hareketli bordroda koruma durum makinesidir (claim), onay adımı gürültü olurdu.
    if (!movement) await assertNotAlreadyDelivered(tx, c.chequeIds, c.input.confirmDuplicate === true);

    // ── ③ HEDEF + HAREKETİN SATIR KAPISI ────────────────────────────────────
    const target = await resolveTargetTx(tx, c.input);
    if (c.movementOn) await assertIssuedTargetTx(tx, kind, c.chequeIds, target.cariId);
    const orderedIds = cheques.map((ch) => ch.id);
    let claimed: ClaimedMove[] = [];
    if (movement) {
      if (!c.canMoveCheques) throw chequePermissionDenied();
      assertNoBlockedRows(await planMovementTx(tx, orderedIds, movement, target));
      // Satırlar bordro numarasından ÖNCE claim'lenir (tekil yolla aynı sıra — bkz. `claimMovementTx`).
      claimed = await claimMovementTx(tx, { movement, target, chequeIds: orderedIds });
    }

    const docNo = await nextNoteNo(tx, c.deliveryDate);
    const notes = c.input.notes?.trim() || null;
    const note = await tx.chequeDeliveryNote.create({
      data: {
        docNo,
        clientToken: c.clientToken,
        kind,
        deliveryDate: c.deliveryDate,
        bankAccountId: target.bankAccountId,
        cariId: target.cariId,
        targetLabel: c.input.targetLabel?.trim() || null,
        notes,
        createdById: c.userId ?? null,
      },
      select: { id: true, docNo: true },
    });

    // ⚠️ `createMany` — tek tek `create` 10-50x yavaş (perf kuralı 9) ve
    // `tx.*` ile `Promise.all` YASAK (kural 11).
    await tx.chequeDeliveryNoteItem.createMany({
      data: cheques.map((ch) => ({ noteId: note.id, chequeId: ch.id })),
    });

    if (claimed.length > 0) {
      await writeMovementTx(tx, claimed, {
        noteId: note.id, noteDocNo: note.docNo, eventDate: c.deliveryDate, notes, userId: c.userId,
      });
    }

    // Belge OLUŞTURMADA donar (makbuz emsali): kâğıt teslim anında verilir,
    // "onay" diye ikinci bir adım yoktur. Freeze tx'in İÇİNDE — bordro ile
    // belgesi ya birlikte doğar ya hiç.
    await printedDocumentService.freezeForSource(tx, PrintedDocType.CHEQUE_DELIVERY_NOTE, note.id, c.userId);
    return { ...note, count: cheques.length, kind, movement, moved: claimed.map((m) => m.row) };
  }

  /**
   * TEK YOL (bayrak açık): tekil bankaya verme / ciro tek satırlı bordro keser. Sıra tekil uçla aynı
   * (ön koşul → claim → dönem kilidi yazımda) ki hata mesajları ve kilit sırası değişmesin.
   */
  async moveSingleCheque(
    id: string,
    target: ForwardTarget,
    input: ChequeEventInput,
    userId?: string,
  ): Promise<ApiResponse<ChequeMoveResult>> {
    const eventDate = input.eventDate ?? new Date();
    const out = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const { row, move } = await chequeService.prepareForwardTx(tx, id, target);
        await chequeService.claimForwardTx(tx, row, move);
        const note = await tx.chequeDeliveryNote.create({
          data: {
            docNo: await nextNoteNo(tx, eventDate),
            kind: row.kind,
            deliveryDate: eventDate,
            bankAccountId: move.type === ChequeEventType.DEPOSIT ? move.bankAccountId : null,
            cariId: move.type === ChequeEventType.ENDORSE ? move.toCariId : null,
            notes: input.notes?.trim() || null,
            createdById: userId ?? null,
          },
          select: { id: true, docNo: true },
        });
        await tx.chequeDeliveryNoteItem.create({ data: { noteId: note.id, chequeId: row.id } });
        await chequeService.writeForwardTx(tx, row, move, {
          eventDate, notes: movementEventNotes(note.docNo, input.notes), deliveryNoteId: note.id, userId,
        });
        await printedDocumentService.freezeForSource(tx, PrintedDocType.CHEQUE_DELIVERY_NOTE, note.id, userId);
        return { cheque: { id: row.id, docNo: row.docNo }, move, note };
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CHEQUE_DELIVERY_NOTE",
      recordId: out.note.id,
      newData: { docNo: out.note.docNo, count: 1, chequeIds: [out.cheque.id], movement: out.move.type, single: true },
    });
    const isDeposit = out.move.type === ChequeEventType.DEPOSIT;
    auditChequeMovements({
      userId,
      noteDocNo: out.note.docNo,
      rows: [out.cheque],
      event: out.move.type,
      extra: out.move.type === ChequeEventType.DEPOSIT ? { bankAccountId: out.move.bankAccountId } : {},
    });
    return {
      success: true,
      data: { ...out.cheque, deliveryNote: out.note },
      message: `${out.cheque.docNo} ${isDeposit ? "bankaya verildi" : "ciro edildi"} (${out.note.docNo}).`,
    };
  }

  /**
   * TASLAK — kayıtsız seçimden numarasız önizleme (PDF'in HTML'i + Excel'in tabloları).
   * Kayıtla AYNI seçim/hedef kapıları ve AYNI doc kurucusu; hiçbir şey yazmaz, mükerrer
   * teslim onayı sorulmaz (o, kaydın adımıdır). Bayrak açıkken `movement` "kaydedince ne olacak"
   * sorusunu satır satır cevaplar; kapalıyken cevap bugünküyle aynıdır.
   */
  async draft(
    input: ChequeDeliveryNoteDraftInput,
    userId?: string,
  ): Promise<ApiResponse<{
    html: string;
    tables: DocTablesPayload;
    movement?: { type: NoteMovementType | null; rows: MovementPlanRow[] };
  }>> {
    const chequeIds = normalizeChequeIds(input.chequeIds);
    const { cheques, kind } = await loadSelectionTx(prisma, chequeIds);
    const movementOn = await resolveChequeNoteMovementEnabled();
    const movement = movementOn
      ? movementFor(kind, { bankAccountId: input.bankAccountId ?? null, cariId: input.cariId ?? null })
      : null;
    const target = await resolveTargetTx(prisma, input);
    if (movementOn) await assertIssuedTargetTx(prisma, kind, chequeIds, target.cariId);
    const doc = buildChequeDeliveryDoc({
      documentNo: DRAFT_DOC_NO,
      kind,
      deliveryDate: input.deliveryDate ?? new Date(),
      bankName: target.bankName,
      cariName: target.cariName,
      targetLabel: input.targetLabel?.trim() || null,
      createdBy: await userDisplayName(prisma, userId),
      notes: input.notes?.trim() || null,
      cheques,
    });
    const data = await printedDocumentService.renderDraftWithTables(
      PrintedDocType.CHEQUE_DELIVERY_NOTE,
      doc as unknown as Record<string, unknown>,
    );
    if (!movementOn) return { success: true, data };
    const rows = movement ? await planMovementTx(prisma, cheques.map((c) => c.id), movement, target) : [];
    return { success: true, data: { ...data, movement: { type: movement, rows } } };
  }

  /**
   * İptal — kayıt SİLİNMEZ, belge VOIDED'a çekilir; PİVOT SATIRLARI DA KALIR
   * ("hangi çekler bu bordrodaydı" sorusunun cevabı iptalden sonra da gerekir).
   * Belge-only bordroda çekin durumu hiç değişmemişti → geri alınacak bir şey yok. Hareketli
   * bordroda (olayı bağlı) iptal çekleri geri alır: sebep + satır seçimi ZORUNLU, izin `finance:cheque`.
   */
  async cancel(
    id: string,
    reason: string | undefined,
    userId?: string,
    opts: { chequeIds?: string[]; canMoveCheques?: boolean } = {},
  ): Promise<ApiResponse<{ id: string; docNo: string; cancelled?: boolean; reversed?: number }>> {
    const moved = await prisma.chequeEvent.findFirst({ where: { deliveryNoteId: id }, select: { id: true } });
    if (moved) return this.cancelWithMovements(id, reason, userId, opts);
    if (opts.chequeIds?.length) {
      throw AppError.badRequest("Bu bordro çek hareketi taşımıyor; satır seçimi yalnız hareketli bordroda yapılır.");
    }

    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.chequeDeliveryNote.updateMany({
        where: { id, status: ChequeDeliveryNoteStatus.ACTIVE },
        data: {
          status: ChequeDeliveryNoteStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
      if (claimed.count === 0) {
        const cur = await tx.chequeDeliveryNote.findUnique({
          where: { id },
          select: { docNo: true },
        });
        if (!cur) throw AppError.notFound("Teslim bordrosu bulunamadı.");
        throw AppError.conflict(`${cur.docNo} zaten iptal edilmiş.`);
      }

      const row = await tx.chequeDeliveryNote.findUniqueOrThrow({
        where: { id },
        select: { id: true, docNo: true },
      });

      await printedDocumentService.voidForSource(
        tx,
        PrintedDocType.CHEQUE_DELIVERY_NOTE,
        row.id,
        reason?.trim() || "Teslim bordrosu iptal edildi",
      );
      return row;
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE_DELIVERY_NOTE",
      recordId: id,
      newData: { event: "CHEQUE_DELIVERY_NOTE_CANCELLED", docNo: result.docNo, reason },
    });
    return { success: true, data: result, message: `${result.docNo} iptal edildi.` };
  }

  /** Hareketli bordronun iptali — eski panel körlemesine ters kayıt atamasın diye seçim zorunlu (409). */
  private async cancelWithMovements(
    id: string,
    reason: string | undefined,
    userId: string | undefined,
    opts: { chequeIds?: string[]; canMoveCheques?: boolean },
  ): Promise<ApiResponse<{ id: string; docNo: string; cancelled: boolean; reversed: number }>> {
    if (!opts.canMoveCheques) throw chequePermissionDenied();
    const why = reason?.trim();
    if (!why) {
      throw AppError.badRequest("Hareketli bordronun iptali çekleri geri alır — ters kayıt için sebep zorunludur.");
    }
    if (!opts.chequeIds?.length) {
      throw AppError.conflict(
        "Bu bordro çek hareketi taşıyor: iptal, çekleri geri alır. Geri alınacak çekleri iptal önizlemesinden seçin (panel güncel olmalı).",
        { code: DELIVERY_NOTE_HAS_MOVEMENTS, noteId: id },
      );
    }
    const out = await this.reverseNote(id, why, opts.chequeIds, userId);
    return {
      success: true,
      data: { id: out.note.id, docNo: out.note.docNo, cancelled: out.cancelled, reversed: out.reversed.length },
      message: out.cancelled
        ? `${out.note.docNo} iptal edildi — ${out.reversed.length} kıymetin hareketi geri alındı.`
        : `${out.note.docNo} bordrosundan ${out.reversed.length} kıymetin hareketi geri alındı; bordro geçerli kalan kıymetlerle duruyor.`,
    };
  }

  /** Tekil storno bağlı bir olayda bordronun kalemini geri alır (son canlı kalemse bordro iptal olur). */
  async reverseSingleCheque(
    noteId: string,
    chequeId: string,
    why: string,
    userId?: string,
  ): Promise<ApiResponse<ChequeMoveResult>> {
    const out = await this.reverseNote(noteId, why, [chequeId], userId);
    const r = out.reversed[0];
    if (!r) throw AppError.internal("Geri alınan kıymet bulunamadı.");
    const what = r.type === ChequeEventType.DEPOSIT
      ? "bankaya verme stornosu yapıldı — para oynamadı"
      : "ciro stornosu yapıldı — ciro carisine ters kayıt yazıldı";
    const noteText = out.cancelled ? `${out.note.docNo} iptal edildi` : `${out.note.docNo} bordrosundan geri alındı`;
    return {
      success: true,
      data: { id: r.id, docNo: r.docNo, deliveryNote: out.note },
      message: `${r.docNo} ${what}, çek ${CHEQUE_STATUS_LABEL[r.backTo]} durumuna döndü (${noteText}).`,
    };
  }

  /**
   * Seçili kalemlerin ters kaydı. Bordro satırı ACTIVE şartıyla dokunularak claim'lenir (iki iptal
   * sırayla yürür); canlı kalemler DEFTERDEN taze okunur; geri alınamayan varsa hiçbir şey yazılmaz.
   * Bütün canlı kalemler geri alındıysa bordro CANCELLED + belge VOIDED; alt kümede donmuş belge
   * DEĞİŞMEZ (imzalanan kâğıt o anın gerçeğidir).
   */
  private async reverseNote(id: string, why: string, chequeIds: string[], userId?: string): Promise<ReverseOutcome> {
    const now = new Date();
    const out = await prisma.$transaction(async (tx) => {
      const touched = await tx.chequeDeliveryNote.updateMany({
        where: { id, status: ChequeDeliveryNoteStatus.ACTIVE },
        data: { updatedAt: now },
      });
      const note = await tx.chequeDeliveryNote.findUnique({ where: { id }, select: { id: true, docNo: true } });
      if (!note) throw AppError.notFound("Teslim bordrosu bulunamadı.");
      if (touched.count === 0) throw AppError.conflict(`${note.docNo} zaten iptal edilmiş.`);

      const state = await noteMovementStateTx(tx, id);
      const live = liveChequeIds(state);
      const selected = [...new Set(chequeIds)];
      const stray = selected.filter((c) => !live.includes(c));
      if (stray.length > 0) {
        throw AppError.badRequest(
          `Seçimdeki ${stray.length} kıymet bu bordroda geri alınacak hareket taşımıyor (bordroda yok ya da zaten geri alınmış). Önizlemeyi yenileyin.`,
        );
      }
      const ordered = await tx.cheque.findMany({
        where: { id: { in: selected } },
        select: { id: true, docNo: true },
        orderBy: CHEQUE_ORDER,
      });
      const checks = await inspectReversalsTx(tx, id, ordered.map((o) => o.id), state);
      assertAllReversible(checks, new Map(ordered.map((o) => [o.id, o.docNo])));
      const plans = checks.flatMap((c) => (c.plan ? [c.plan] : []));
      await reverseMovementsTx(tx, { noteId: id, plans, why, now, userId });

      const cancelled = selected.length === live.length;
      if (cancelled) await this.cancelNoteTx(tx, note, why, userId);
      return {
        note,
        cancelled,
        reversed: plans.map((p) => ({ id: p.row.id, docNo: p.row.docNo, type: p.type, backTo: p.event.fromStatus })),
      };
    });

    for (const r of out.reversed) {
      auditChequeMovements({
        userId,
        noteDocNo: out.note.docNo,
        rows: [r],
        event: r.type === ChequeEventType.DEPOSIT ? "DEPOSIT_CANCEL" : "ENDORSE_CANCEL",
        extra: { reason: why },
      });
    }
    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE_DELIVERY_NOTE",
      recordId: id,
      newData: {
        event: out.cancelled ? "CHEQUE_DELIVERY_NOTE_CANCELLED" : "CHEQUE_DELIVERY_NOTE_ITEMS_REVERSED",
        docNo: out.note.docNo,
        reason: why,
        chequeIds: out.reversed.map((r) => r.id),
      },
    });
    return out;
  }

  /** Bordronun kendisi — son canlı kalemle birlikte CANCELLED + belge VOIDED (tx içinde). */
  private async cancelNoteTx(
    tx: Prisma.TransactionClient,
    note: { id: string; docNo: string },
    why: string,
    userId?: string,
  ): Promise<void> {
    await tx.chequeDeliveryNote.updateMany({
      where: { id: note.id, status: ChequeDeliveryNoteStatus.ACTIVE },
      data: {
        status: ChequeDeliveryNoteStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledById: userId ?? null,
        cancelReason: why,
      },
    });
    await printedDocumentService.voidForSource(tx, PrintedDocType.CHEQUE_DELIVERY_NOTE, note.id, why);
  }

  /**
   * İPTAL ÖNİZLEMESİ (okuma) — etkilenen HER kıymet: hareketi, geri alınabilir mi, değilse neden.
   * Kapı iptalinkiyle aynı yoldan (`inspectReversalsTx`), yani önizleme "geçer" deyip iptal reddetmez.
   */
  async cancelPreview(id: string): Promise<ApiResponse<{
    id: string;
    docNo: string;
    status: ChequeDeliveryNoteStatus;
    hasMovements: boolean;
    items: CancelPreviewItem[];
  }>> {
    const note = await prisma.chequeDeliveryNote.findUnique({
      where: { id },
      select: {
        id: true,
        docNo: true,
        status: true,
        items: {
          orderBy: ITEM_ORDER,
          select: { cheque: { select: { id: true, docNo: true, amount: true, currency: true, status: true } } },
        },
      },
    });
    if (!note) throw AppError.notFound("Teslim bordrosu bulunamadı.");
    const state = await noteMovementStateTx(prisma, id);
    const live = note.status === ChequeDeliveryNoteStatus.ACTIVE ? liveChequeIds(state) : [];
    const liveOrdered = note.items.map((i) => i.cheque.id).filter((cid) => live.includes(cid));
    const checks = new Map((await inspectReversalsTx(prisma, id, liveOrdered, state)).map((c) => [c.chequeId, c]));

    const items: CancelPreviewItem[] = note.items.map(({ cheque }) => {
      const check = checks.get(cheque.id);
      return {
        chequeId: cheque.id,
        docNo: cheque.docNo,
        amount: cheque.amount.toString(),
        currency: cheque.currency,
        status: cheque.status,
        action: state.forward.get(cheque.id) ?? null,
        reversed: state.reversed.has(cheque.id),
        reversible: Boolean(check?.plan),
        reason: check?.reason ?? null,
      };
    });
    return {
      success: true,
      data: { id: note.id, docNo: note.docNo, status: note.status, hasMovements: state.forward.size > 0, items },
    };
  }

  /** Liste — OFFSET sayfalama (düşük hacim; gerekçe mutabakat servisinde). */
  async list(params: {
    page?: number;
    pageSize?: number;
    kind?: ChequeKind;
    status?: ChequeDeliveryNoteStatus;
    cariId?: string;
    bankAccountId?: string;
    from?: Date;
    to?: Date;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const where: Prisma.ChequeDeliveryNoteWhereInput = {};
    if (params.kind) where.kind = params.kind;
    if (params.status) where.status = params.status;
    if (params.cariId) where.cariId = params.cariId;
    if (params.bankAccountId) where.bankAccountId = params.bankAccountId;
    if (params.from || params.to) {
      where.deliveryDate = {
        ...(params.from ? { gte: params.from } : {}),
        ...(params.to ? { lte: params.to } : {}),
      };
    }
    if (params.search?.trim()) {
      // ⚠️ TÜRKÇE-DUYARLI: `targetLabel` serbest metindir (banka/cari adı).
      where.OR = buildTurkishSearch(params.search, ["docNo", "targetLabel"]);
    }

    const [data, total] = await Promise.all([
      prisma.chequeDeliveryNote.findMany({
        where,
        select: {
          id: true,
          docNo: true,
          kind: true,
          status: true,
          deliveryDate: true,
          targetLabel: true,
          notes: true,
          createdAt: true,
          bankAccount: { select: { id: true, name: true } },
          cari: {
            select: {
              id: true,
              customer: { select: { code: true, name: true } },
              subcontractor: { select: { code: true, name: true } },
            },
          },
          // Liste satırında "kaç kıymet" — snapshot JSON'u ÇEKMEDEN (perf kuralı 13).
          _count: { select: { items: true } },
        },
        orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.chequeDeliveryNote.count({ where }),
    ]);
    return {
      data,
      pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /** Detay — bordronun çekleri CANLI okunur (portföydeki güncel durumlarıyla). */
  async findById(id: string): Promise<ApiResponse<unknown>> {
    const row = await prisma.chequeDeliveryNote.findUnique({
      where: { id },
      select: {
        id: true,
        docNo: true,
        kind: true,
        status: true,
        deliveryDate: true,
        targetLabel: true,
        notes: true,
        createdAt: true,
        cancelledAt: true,
        cancelReason: true,
        bankAccount: { select: { id: true, name: true } },
        cari: {
          select: {
            id: true,
            customer: { select: { code: true, name: true } },
            subcontractor: { select: { code: true, name: true } },
          },
        },
        items: {
          // ⚠️ Kâğıtla AYNI sıra (`ITEM_ORDER`) — ayrışırsa ekran, imzalanmış
          // tutanaktan farklı bir liste gösterir.
          orderBy: ITEM_ORDER,
          select: { id: true, cheque: { select: CHEQUE_LINE_SELECT } },
        },
      },
    });
    if (!row) throw AppError.notFound("Teslim bordrosu bulunamadı.");

    const totals = totalsByCurrency(row.items.map((i) => i.cheque));
    return {
      success: true,
      data: {
        ...row,
        totals: totals.map((t) => ({
          currency: t.currency,
          count: t.count,
          amount: t.amount.toString(),
        })),
      },
    };
  }
}

export const chequeDeliveryNoteService = new ChequeDeliveryNoteService();

// ---------------------------------------------------------------------------
// BELGE BUILDER — çek/senet teslim bordrosu
// ---------------------------------------------------------------------------
// ⚠️ Kayıt IMPORT YAN ETKİSİYLE oluşur (routes → bu servis). Bekçilerde import
// satırı yoksa registry boş kalır ve testler vakumen yeşile döner.

registerPrintedDocBuilder(PrintedDocType.CHEQUE_DELIVERY_NOTE, {
  fresh: async (db, sourceId) => {
    const note = await db.chequeDeliveryNote.findUnique({
      where: { id: sourceId },
      select: {
        id: true,
        docNo: true,
        kind: true,
        status: true,
        deliveryDate: true,
        targetLabel: true,
        notes: true,
        createdById: true,
        cancelledAt: true,
        cancelReason: true,
        bankAccount: { select: { name: true } },
        cari: {
          select: {
            customer: { select: { code: true, name: true } },
            subcontractor: { select: { code: true, name: true } },
          },
        },
        items: {
          // Kâğıttaki SIRA — VADE, sonra belge no (gerekçe: `ITEM_ORDER`).
          // ⚠️ "Bordroya yazılma sırası" DEĞİL: pivotun `createdAt`i tüm
          // satırlarda aynıdır ve hiçbir şey sıralamaz.
          orderBy: ITEM_ORDER,
          select: { cheque: { select: CHEQUE_LINE_SELECT } },
        },
      },
    });
    if (!note) return null;

    const doc = buildChequeDeliveryDoc({
      documentNo: note.docNo,
      kind: note.kind,
      deliveryDate: note.deliveryDate,
      bankName: note.bankAccount?.name ?? null,
      cariName: note.cari?.customer?.name ?? note.cari?.subcontractor?.name ?? null,
      targetLabel: note.targetLabel,
      createdBy: await userDisplayName(db, note.createdById),
      notes: note.notes,
      cheques: note.items.map((i) => i.cheque),
    });

    return {
      documentNo: note.docNo,
      doc: doc as unknown as Record<string, unknown>,
      voidInfo:
        note.status === ChequeDeliveryNoteStatus.CANCELLED
          ? { reason: note.cancelReason, at: note.cancelledAt ?? new Date() }
          : null,
    };
  },
  renderHtml: renderChequeDeliveryNoteHtml,
  renderTables: renderChequeDeliveryNoteTables,
});
