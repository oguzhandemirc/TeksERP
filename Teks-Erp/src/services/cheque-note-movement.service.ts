// =============================================================================
// ÇEK TESLİM BORDROSU — HAREKET KATMANI (K3, 2026-09-26)
// =============================================================================
// Bayrak `finance.chequeNoteMovementEnabled` AÇIKKEN bordro bir hareket fişidir (sektör: Logo/Mikro
// çek çıkış bordrosu; tasarım `docs/design/CEK-TESLIM-BORDROSU-TASARIM.md` §4 K3):
//   aldığımız çek + banka hedefi → bankaya verme · aldığımız çek + cari hedefi → ciro.
// Yeni defter ya da geçiş YOK: satırlar `chequeService`in tekil uçla ORTAK çekirdeklerinden geçer,
// olay `ChequeEvent.deliveryNoteId` ile bordroya bağlanır. Ters yolu bayrak değil bu bağ seçer.
//
// KİLİT SIRASI (tek tx): [8036 token — çağıranda, ilk ifade] → çek claim'leri CHEQUE_ORDER →
// bordro numarası (`docNo` tekil yuvası) → 8026 sıralı tek çağrı (`assertPeriodsOpenTx`) → yazımlar.
// Bütün çek yolları "satır → numara → 8026" sırasındadır; ters sıra tekil ciroyla kilitlenir.
// =============================================================================
import { ChequeEventType, ChequeKind, ChequeStatus, Prisma } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { assertPeriodsOpenTx } from "./helpers/period-guard.helper";
import {
  accountCurrencyRejection,
  chequeService,
  DEPOSIT_FROM,
  ENDORSE_FROM,
  endorseDrawerRejection,
  transitionRejection,
  type ChequeTransitionRow,
  type ForwardMove,
  type ReversalPlan,
} from "./cheque.service";

export type NoteMovementType = ForwardMove["type"];

/** Makine-okunur kodlar (`details.code`) — panel bunlarla eşleşir, mesaj metniyle değil. */
export const DELIVERY_ROWS_BLOCKED = "DELIVERY_ROWS_BLOCKED";
export const DELIVERY_NOTE_HAS_MOVEMENTS = "DELIVERY_NOTE_HAS_MOVEMENTS";
export const DELIVERY_ITEMS_ADVANCED = "DELIVERY_ITEMS_ADVANCED";

const ISSUED_TO_BANK =
  "Verdiğimiz çek/senet bankaya teslim edilmez: ödemeyi banka karşı tarafa yapar. Ödendiğini çekin kendi " +
  "ödeme işlemiyle kaydedin; bordroda hedef olarak çeklerin verildiği cariyi seçin ya da hedefi serbest metinle yazın.";

/** Hareketin geçiş sonrası durumu — önizleme "ne olacak" sorusunu buradan söyler. */
const MOVE_TO: Record<NoteMovementType, ChequeStatus> = {
  DEPOSIT: ChequeStatus.AT_BANK,
  ENDORSE: ChequeStatus.ENDORSED,
};

export interface NoteTarget {
  bankAccountId: string | null;
  cariId: string | null;
}

/**
 * KURAL TABLOSU — (yön × hedef) → geçiş. Serbest metin ya da hedefsiz bordro geçiş üretmez
 * (belge-only: avukat/noter teslimi gibi sistemde durumu olmayan teslimler). Tabloda olmayan
 * kombinasyon FAIL-CLOSED: verdiğimiz çekin bankaya "teslimi" 400. Verdiğimiz çek + cari geçiş
 * üretmez (verme doğuşta ISSUE ile yazıldı) ama cari çekin carisi olmalı (`assertIssuedTargetTx`).
 */
export function movementFor(kind: ChequeKind, target: NoteTarget): NoteMovementType | null {
  if (kind === ChequeKind.ISSUED) {
    if (target.bankAccountId) throw AppError.badRequest(ISSUED_TO_BANK);
    return null;
  }
  if (target.bankAccountId) return ChequeEventType.DEPOSIT;
  if (target.cariId) return ChequeEventType.ENDORSE;
  return null;
}

/** Verdiğimiz çekin bordrosu başka bir cariye kesilemez — kâğıt bir cariyi, defter başkasını gösterirdi. */
export async function assertIssuedTargetTx(
  tx: Prisma.TransactionClient,
  kind: ChequeKind,
  chequeIds: string[],
  cariId: string | null,
): Promise<void> {
  if (kind !== ChequeKind.ISSUED || !cariId) return;
  const others = await tx.cheque.findMany({
    where: { id: { in: chequeIds }, cariId: { not: cariId } },
    select: { docNo: true },
    orderBy: { docNo: "asc" },
  });
  if (others.length === 0) return;
  throw AppError.badRequest(
    `Bordronun carisi ile ${others.length} çek/senedin verildiği cari farklı (${others
      .map((o) => o.docNo)
      .join(", ")}): kâğıt bir cariye teslim derken defter başka bir cariyi gösterirdi. Bordroyu çeklerin verildiği cariye kesin.`,
  );
}

export interface MovementPlanRow {
  chequeId: string;
  docNo: string;
  action: NoteMovementType;
  fromStatus: ChequeStatus;
  toStatus: ChequeStatus;
  /** Doluysa bu satır geçemez; kayıt hiçbir şey yazmadan 409 döner. */
  blockedReason: string | null;
}

const PLAN_ROW_SELECT = {
  id: true,
  docNo: true,
  kind: true,
  docType: true,
  status: true,
  currency: true,
  cariId: true,
} satisfies Prisma.ChequeSelect;

/**
 * SATIR KAPISI — BÜTÜN satırlar ölçülür, ilk hatada durulmaz. Yüklemler tekil ucunkilerdir
 * (`transitionRejection` · `accountCurrencyRejection` · `endorseDrawerRejection`); kopya yok.
 * Satırlar verilen sırada döner (çağıran CHEQUE_ORDER verir).
 */
export async function planMovementTx(
  tx: Prisma.TransactionClient,
  chequeIds: string[],
  movement: NoteMovementType,
  target: NoteTarget,
): Promise<MovementPlanRow[]> {
  const rows = await tx.cheque.findMany({ where: { id: { in: chequeIds } }, select: PLAN_ROW_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const bank = target.bankAccountId
    ? await tx.bankAccount.findUnique({ where: { id: target.bankAccountId }, select: { name: true, currency: true } })
    : null;
  const isDeposit = movement === ChequeEventType.DEPOSIT;

  return chequeIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const rejection = transitionRejection(
      row,
      isDeposit ? DEPOSIT_FROM : ENDORSE_FROM,
      ChequeKind.RECEIVED,
      isDeposit ? "bankaya verme" : "ciro",
    );
    const reason =
      rejection?.message ??
      (isDeposit
        ? bank && accountCurrencyRejection(bank.name, bank.currency, row.currency)
        : target.cariId && endorseDrawerRejection(row, target.cariId));
    return [{
      chequeId: row.id,
      docNo: row.docNo,
      action: movement,
      fromStatus: row.status,
      toStatus: MOVE_TO[movement],
      blockedReason: reason || null,
    }];
  });
}

/** Satır kapısının reddi — bütün engelli satırlar tek listede (`details.rows`). */
export function assertNoBlockedRows(plan: MovementPlanRow[]): void {
  const blocked = plan.filter((r) => r.blockedReason);
  if (blocked.length === 0) return;
  throw AppError.conflict(
    `Seçimdeki ${blocked.length} kıymet bu bordroyla hareket edemez; bordro kaydedilmedi, hiçbir çek değişmedi.`,
    {
      code: DELIVERY_ROWS_BLOCKED,
      rows: blocked.map((r) => ({
        chequeId: r.chequeId,
        docNo: r.docNo,
        status: r.fromStatus,
        reason: r.blockedReason,
      })),
    },
  );
}

/** Olay notu — bordro numarası eski panelin çek geçmişinde de görünsün. */
export function movementEventNotes(noteDocNo: string, notes: string | null | undefined): string {
  return [noteDocNo, notes?.trim()].filter(Boolean).join(" — ");
}

/** Hazırlanıp claim'lenmiş satır — bordro numarası alındıktan SONRA yazılır. */
export interface ClaimedMove {
  row: ChequeTransitionRow;
  move: ForwardMove;
}

/**
 * ① BÜTÜN satırlar hazırlanır ve claim'lenir (CHEQUE_ORDER — deterministik satır kilidi). Bordro
 * numarası (tekil `docNo` yuvası) BUNDAN SONRA alınır: tekil yol da önce çeki claim'ler, sonra numara
 * alır; ters sıra, aynı numarayı hesaplayan iki istekte satır ↔ numara kilitlenmesi kurar (ölçüldü).
 */
export async function claimMovementTx(
  tx: Prisma.TransactionClient,
  args: { movement: NoteMovementType; target: NoteTarget; chequeIds: string[] },
): Promise<ClaimedMove[]> {
  const target =
    args.movement === ChequeEventType.DEPOSIT
      ? { type: ChequeEventType.DEPOSIT, bankAccountId: requireId(args.target.bankAccountId) }
      : { type: ChequeEventType.ENDORSE, toCariId: requireId(args.target.cariId) };
  const claimed: ClaimedMove[] = [];
  for (const id of args.chequeIds) {
    const step = await chequeService.prepareForwardTx(tx, id, target);
    await chequeService.claimForwardTx(tx, step.row, step.move);
    claimed.push(step);
  }
  return claimed;
}

/** ② Ciroda dönem kilitleri (8026) sıralı TEK çağrıyla, sonra defter + bordroya bağlı olaylar. */
export async function writeMovementTx(
  tx: Prisma.TransactionClient,
  claimed: ClaimedMove[],
  args: { noteId: string; noteDocNo: string; eventDate: Date; notes: string | null; userId?: string },
): Promise<void> {
  const endorseKeys = claimed.flatMap(({ row, move }) =>
    move.type === ChequeEventType.ENDORSE ? [{ cariId: move.toCariId, currency: row.currency, txnDate: args.eventDate }] : [],
  );
  if (endorseKeys.length > 0) await assertPeriodsOpenTx(tx, endorseKeys);

  const notes = movementEventNotes(args.noteDocNo, args.notes);
  for (const { row, move } of claimed) {
    await chequeService.writeForwardTx(tx, row, move, {
      eventDate: args.eventDate,
      notes,
      deliveryNoteId: args.noteId,
      userId: args.userId,
    });
  }
}

function requireId(id: string | null): string {
  if (!id) throw AppError.internal("Bordro hareketi hedefsiz çağrıldı.");
  return id;
}

// -----------------------------------------------------------------------------
// TERS YOL — bordro iptali ve tekil storno aynı kapıdan
// -----------------------------------------------------------------------------

export interface NoteMovementState {
  /** İleri olayı bu bordroya bağlı çekler → geçiş tipi. */
  forward: Map<string, NoteMovementType>;
  /** Ters olayı bu bordroya bağlı çekler. */
  reversed: Set<string>;
}

/** Bordronun hareket durumu DEFTERDEN okunur — kalemde durum kolonu yok. */
export async function noteMovementStateTx(tx: Prisma.TransactionClient, noteId: string): Promise<NoteMovementState> {
  const events = await tx.chequeEvent.findMany({
    where: { deliveryNoteId: noteId },
    select: { chequeId: true, type: true },
  });
  const forward = new Map<string, NoteMovementType>();
  const reversed = new Set<string>();
  for (const e of events) {
    if (e.type === ChequeEventType.DEPOSIT || e.type === ChequeEventType.ENDORSE) forward.set(e.chequeId, e.type);
    else reversed.add(e.chequeId);
  }
  return { forward, reversed };
}

export function liveChequeIds(state: NoteMovementState): string[] {
  return [...state.forward.keys()].filter((id) => !state.reversed.has(id));
}

export interface ReversalCheck {
  chequeId: string;
  plan: ReversalPlan | null;
  /** `plan` yoksa neden geri alınamadığı — tekil storno ile aynı mesaj. */
  reason: string | null;
}

/**
 * İptalin satır kapısı ile önizlemenin TEK yolu: her kalem ters çekirdeğin ön koşullarından geçer
 * (durum ileri olayın `toStatus`u VE en yeni ileri olay bu bordronun). İş kuralı reddi toplanır,
 * altyapı hatası fırlar.
 */
export async function inspectReversalsTx(
  tx: Prisma.TransactionClient,
  noteId: string,
  chequeIds: string[],
  state: NoteMovementState,
): Promise<ReversalCheck[]> {
  const checks: ReversalCheck[] = [];
  for (const chequeId of chequeIds) {
    const type = state.forward.get(chequeId);
    if (!type) {
      checks.push({ chequeId, plan: null, reason: "Bu kıymet bu bordroyla hareket etmedi." });
      continue;
    }
    try {
      checks.push({ chequeId, plan: await chequeService.prepareReversalTx(tx, chequeId, type, noteId), reason: null });
    } catch (e) {
      if (!(e instanceof AppError) || e.statusCode >= 500) throw e;
      checks.push({ chequeId, plan: null, reason: e.message });
    }
  }
  return checks;
}

/** Ters kayıt: önce bütün claim'ler, sonra ciro stornolarında 8026 sıralı, en son ters defter + olaylar. */
export async function reverseMovementsTx(
  tx: Prisma.TransactionClient,
  args: { noteId: string; plans: ReversalPlan[]; why: string; now: Date; userId?: string },
): Promise<void> {
  for (const plan of args.plans) await chequeService.claimReversalTx(tx, plan);

  const endorseKeys = args.plans.flatMap((p) =>
    p.type === ChequeEventType.ENDORSE ? [{ cariId: p.endorsee, currency: p.row.currency, txnDate: args.now }] : [],
  );
  if (endorseKeys.length > 0) await assertPeriodsOpenTx(tx, endorseKeys);

  for (const plan of args.plans) {
    await chequeService.writeReversalTx(tx, plan, {
      why: args.why,
      now: args.now,
      deliveryNoteId: args.noteId,
      userId: args.userId,
    });
  }
}

/** Hareketin çek başına izi (tx DIŞINDA, best-effort) — tekil uçla aynı `CHEQUE` kaydı + bordro no. */
export function auditChequeMovements(a: {
  userId: string | undefined;
  noteDocNo: string;
  rows: ReadonlyArray<{ id: string; docNo: string }>;
  event: string;
  extra?: Record<string, unknown>;
}): void {
  for (const row of a.rows) {
    void AuditService.log({
      userId: a.userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: row.id,
      newData: { event: a.event, docNo: row.docNo, deliveryNoteDocNo: a.noteDocNo, ...a.extra },
    });
  }
}
