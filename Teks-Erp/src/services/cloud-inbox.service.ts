// =============================================================================
// Patron bulutu GELEN KUTUSU — fabrikada işleme (`PATRON-BULUTU-ESITLEME.md` §8.3)
// =============================================================================
// Bulut hiçbir fabrika satırını değiştiremez; tek yazma kanalı budur ve NORMAL servis yolundan geçer:
//   sipariş → `OrderService` (`prepareOrderCreate` kapıları + tx-alan dikiş; clientToken = mesajId)
//   cari    → `CustomerService` (`prepareCardCreate` + `createCardInTx`; kod fabrikada doğar)
// Tek boğaz (`tokenReplay`, K kipi): tx açılır → 8036 token kilidi mesajId üzerinde tx'in İLK ifadesi → makbuz
// VARSA saklı sonuç (iş kuralı yeniden koşmaz) → yoksa varlık + makbuz AYNI tx'te. Kesin 4xx ret de makbuz yazar
// (aynı mesaj ikinci kez gelirse aynı cevap); belirsiz hata (5xx/ağ/DB) makbuz YAZMAZ → bulut claim süresi dolunca
// yeniden dener. Kaynak künyesi makbuzda ve audit yükünde durur; Order/Customer'a kolon eklenmez.
// =============================================================================
import { CloudInboxKind, CloudInboxOutcome, Prisma, type CloudInboxReceipt } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { isClientTokenP2002 } from "../utils/p2002";
import { cardWireToFactory, inboxPayloadDigest, orderWireToFactory } from "../cloud-sync/inbox-wire";
import {
  CustomerMessageSchema,
  INBOX_RESULT_MESSAGE_MAX,
  OrderMessageSchema,
  type InboxKind,
  type InboxMessage,
  type InboxOutcome,
  type InboxRejectCode,
  type OrderMessage,
} from "../cloud-sync/wire";

/** Audit yükündeki kaynak künyesi — ayak izi; iş kararı buradan türetilmez. */
export const PATRON_CLOUD_SOURCE = "PATRON_BULUTU";

class InboxRejection extends Error {
  constructor(
    readonly code: InboxRejectCode,
    message: string,
  ) {
    // Bulut sonuç satırı mesajı en çok INBOX_RESULT_MESSAGE_MAX taşır; tek uzun mesaj bütün `sonuc` turunu 400'e düşürmesin.
    super(message.length > INBOX_RESULT_MESSAGE_MAX ? `${message.slice(0, INBOX_RESULT_MESSAGE_MAX - 1)}…` : message || "İşlenemedi.");
    this.name = "InboxRejection";
  }
}

function sourceStamp(msg: InboxMessage): Record<string, unknown> {
  return { kaynak: PATRON_CLOUD_SOURCE, bulutHesapId: msg.hesapId, bulutHesapAdi: msg.hesapAdi, mesajId: msg.mesajId };
}

function outcomeFromReceipt(r: CloudInboxReceipt): InboxOutcome {
  const res = (r.result ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    mesajId: r.messageId,
    durum: r.outcome,
    varlikId: r.entityId,
    belgeNo: str(res.belgeNo),
    kod: str(res.kod),
    mesaj: str(res.mesaj),
  };
}

/**
 * Makbuz replay'i: 4. durum YOK (makbuz ekleme-yalnız defterdir; varlığın sonraki iptali "bu mesaj işlendi" gerçeğini
 * değiştirmez) · kimlik = tür + gövde özeti (aynı mesajId başka içerikle = çakışma).
 */
function inboxReceiptReplay(kind: InboxKind, digest: string) {
  return tokenReplay<CloudInboxReceipt, InboxOutcome>({
    find: (db, messageId) => db.cloudInboxReceipt.findUnique({ where: { messageId } }),
    alive: { neverDies: "makbuz ekleme-yalnız defterdir; varlığın sonraki iptali işlenmiş mesajı geri almaz" },
    identity: (p) => [
      { ad: "tur", mevcut: p.kind, gelen: kind },
      { ad: "govdeOzeti", mevcut: p.payloadDigest, gelen: digest },
    ],
    collision: "Bu bulut mesajı daha önce farklı bir içerikle işlenmiş; aynı kimlikle ikinci içerik kabul edilmez.",
    respond: (p) => outcomeFromReceipt(p),
  });
}
type ReceiptReplay = ReturnType<typeof inboxReceiptReplay>;

interface ReceiptFields {
  readonly msg: InboxMessage;
  readonly kind: InboxKind;
  readonly digest: string;
}

function receiptData(f: ReceiptFields, outcome: CloudInboxOutcome, entityId: string | null, result: Record<string, unknown>): Prisma.CloudInboxReceiptCreateInput {
  return {
    messageId: f.msg.mesajId,
    kind: f.kind as CloudInboxKind,
    outcome,
    entityId,
    cloudAccountId: f.msg.hesapId,
    cloudAccountName: f.msg.hesapAdi,
    payloadDigest: f.digest,
    result: result as Prisma.InputJsonValue,
  };
}

async function auditReceipt(r: CloudInboxReceipt, actorUserId: string): Promise<void> {
  await AuditService.log({
    userId: actorUserId,
    action: "CREATE",
    tableName: "CLOUD_INBOX_RECEIPT",
    recordId: r.id,
    newData: { messageId: r.messageId, kind: r.kind, outcome: r.outcome, entityId: r.entityId, cloudAccountId: r.cloudAccountId, cloudAccountName: r.cloudAccountName, result: r.result },
  });
}

/** Kesin ret: makbuz AYRI tx'te (varlık tx'i geri alındı); kilit yine ilk ifade — eşzamanlı ikinci deneme aynı makbuzu görür. */
async function writeRejection(f: ReceiptFields, replay: ReceiptReplay, rej: InboxRejection, actorUserId: string): Promise<InboxOutcome> {
  const r = await prisma.$transaction(async (tx) => {
    const replayed = await replay.inTx(tx, f.msg.mesajId);
    if (replayed) return { replay: true as const, replayed };
    const receipt = await tx.cloudInboxReceipt.create({
      data: receiptData(f, CloudInboxOutcome.REDDEDILDI, null, { varlikId: null, belgeNo: null, kod: rej.code, mesaj: rej.message }),
    });
    return { replay: false as const, receipt };
  });
  if (r.replay) return r.replayed;
  await auditReceipt(r.receipt, actorUserId);
  return outcomeFromReceipt(r.receipt);
}

/** Servisin hatası → kesin ret mi (kod + TR mesaj), belirsiz mi (null: makbuz yok, bulut yeniden dener)? */
function classifyError(err: unknown, kind: InboxKind): InboxRejection | null {
  if (err instanceof InboxRejection) return err;
  // Makbuzsuz ama aynı token'lı sipariş (fabrikada elle aynı token'la yaratılmış) — kesin ret, belirsiz değil.
  if (isClientTokenP2002(err)) return new InboxRejection("IS_KURALI", "Bu mesaj kimliğiyle fabrikada zaten bir sipariş var; aynı kimlik ikinci kez kullanılamaz.");
  if (err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500) {
    const code = typeof err.details?.code === "string" ? err.details.code : null;
    if (code === "CUSTOMER_NAME_DUPLICATE") return new InboxRejection("CARI_AD_MUKERRER", err.message);
    if (code === "MODULE_DISABLED") return new InboxRejection("MODUL_KAPALI", err.message);
    if (code === "CLIENT_TOKEN_COLLISION") return new InboxRejection("MESAJ_CAKISMASI", err.message);
    return new InboxRejection(kind === "CARI" && err.statusCode === 404 ? "CARI_BULUNAMADI" : "IS_KURALI", err.message);
  }
  return null;
}

/** Tel gövdesinin işaret ettiği kayıtlar fabrikada var mı — ret kodu sınıflaması için (iş kuralı servisindedir). */
async function assertOrderReferencesExist(w: OrderMessage): Promise<void> {
  const customer = await prisma.customer.findUnique({ where: { id: w.cariKartId }, select: { id: true } });
  if (!customer) throw new InboxRejection("CARI_BULUNAMADI", "Siparişin cari kartı fabrikada bulunamadı.");
  const itemIds = [...new Set(w.kalemler.map((k) => k.urunId))];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true } });
  if (items.length !== itemIds.length) throw new InboxRejection("URUN_BULUNAMADI", "Siparişteki bir ürün fabrikada bulunamadı.");
  const colorIds = [...new Set(w.kalemler.map((k) => k.renkId).filter((v): v is string => typeof v === "string"))];
  if (colorIds.length > 0) {
    const colors = await prisma.color.findMany({ where: { id: { in: colorIds } }, select: { id: true } });
    if (colors.length !== colorIds.length) throw new InboxRejection("RENK_BULUNAMADI", "Siparişteki bir renk fabrikada bulunamadı.");
  }
}

async function orderService() {
  return (await import("../routes/order.routes")).orderService;
}
async function customerService() {
  return (await import("../routes/customer.routes")).customerService;
}

/** SİPARİŞ (K): kapılar `prepareOrderCreate`ten; sipariş + makbuz aynı tx; 8036 mesajId üzerinde tx'in ilk ifadesi. */
async function createOrderFromMessage(f: ReceiptFields, w: OrderMessage, replay: ReceiptReplay, actorUserId: string): Promise<InboxOutcome> {
  const svc = await orderService();
  const data = orderWireToFactory(w, f.msg.mesajId);
  const prepared = await svc.prepareOrderCreate(data, f.msg.mesajId, { userId: actorUserId });
  const r = await withBarcodeRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const replayed = await replay.inTx(tx, f.msg.mesajId);
        if (replayed) return { replay: true as const, replayed };
        const order = await svc.insertPreparedOrderTx(tx, prepared);
        const receipt = await tx.cloudInboxReceipt.create({
          data: receiptData(f, CloudInboxOutcome.ISLENDI, order.id as string, {
            varlikId: order.id,
            belgeNo: order.orderNumber ?? null,
            kod: null,
            mesaj: "Sipariş oluşturuldu",
          }),
        });
        return { replay: false as const, order, receipt };
      }),
    undefined,
    (err) => !isClientTokenP2002(err),
  );
  if (r.replay) return r.replayed;
  await svc.finishOrderCreate(r.order, data, prepared, { auditExtra: sourceStamp(f.msg) });
  await auditReceipt(r.receipt, actorUserId);
  return outcomeFromReceipt(r.receipt);
}

/** CARİ (K): `prepareCardCreate` bir kez; kart (+ cari hesap) + makbuz aynı tx; kod çakışmasında taze sıra no. */
async function createCardFromMessage(f: ReceiptFields, data: Record<string, unknown>, replay: ReceiptReplay, actorUserId: string): Promise<InboxOutcome> {
  const svc = await customerService();
  const plan = svc.prepareCardCreate(data);
  const r = await svc.withCardCreateRetry(data, () =>
    prisma.$transaction(async (tx) => {
      const replayed = await replay.inTx(tx, f.msg.mesajId);
      if (replayed) return { replay: true as const, replayed };
      const born = await svc.createCardInTx(tx, plan, actorUserId);
      const receipt = await tx.cloudInboxReceipt.create({
        data: receiptData(f, CloudInboxOutcome.ISLENDI, born.card.id as string, {
          varlikId: born.card.id,
          belgeNo: born.card.code ?? null,
          kod: null,
          mesaj: "Cari kart oluşturuldu",
        }),
      });
      return { replay: false as const, born, receipt };
    }),
  );
  if (r.replay) return r.replayed;
  await svc.finishCardCreate(r.born, actorUserId, { finance: null, auditExtra: sourceStamp(f.msg) });
  await auditReceipt(r.receipt, actorUserId);
  return outcomeFromReceipt(r.receipt);
}

/**
 * Bir bulut mesajını işler. Dönüş: kesin sonuç (ISLENDI | REDDEDILDI — buluta bildirilir) ya da `null` (belirsiz:
 * makbuz yok, bulut claim süresi dolunca yeniden verir). Aynı mesaj ikinci kez gelirse iş kuralı koşmaz, makbuz cevaplar.
 */
export async function processInboxMessage(msg: InboxMessage, actorUserId: string): Promise<InboxOutcome | null> {
  const kind = msg.tur;
  const f: ReceiptFields = { msg, kind, digest: inboxPayloadDigest(kind, msg.govde) };
  const replay = inboxReceiptReplay(kind, f.digest);
  try {
    // Hız yolu (kapı değil): işlenmiş mesaj iş kurallarına hiç girmeden makbuzdan cevaplanır.
    const fast = await replay.replayIfAny(msg.mesajId);
    if (fast) return fast;
    if (kind === "SIPARIS") {
      const parsed = OrderMessageSchema.safeParse(msg.govde);
      if (!parsed.success) throw new InboxRejection("GOVDE_GECERSIZ", "Sipariş gövdesi sözleşmeye uymuyor.");
      await assertOrderReferencesExist(parsed.data);
      return await createOrderFromMessage(f, parsed.data, replay, actorUserId);
    }
    const parsed = CustomerMessageSchema.safeParse(msg.govde);
    if (!parsed.success) throw new InboxRejection("GOVDE_GECERSIZ", "Cari gövdesi sözleşmeye uymuyor.");
    return await createCardFromMessage(f, cardWireToFactory(parsed.data), replay, actorUserId);
  } catch (err) {
    // Kaybeden deneme hangi hatayla düşerse düşsün cevap önce makbuzdan (kök `tokenReplay` sözleşmesi).
    const prior = err instanceof InboxRejection ? null : await replay.replayIfAny(msg.mesajId).catch(() => null);
    if (prior) return prior;
    const rej = classifyError(err, kind);
    if (!rej) return null;
    // Çakışma: makbuz ZATEN var (başka içerikle) — ikinci makbuz yazılmaz, yalnız ret bildirilir.
    if (rej.code === "MESAJ_CAKISMASI") return { mesajId: msg.mesajId, durum: "REDDEDILDI", varlikId: null, belgeNo: null, kod: rej.code, mesaj: rej.message };
    try {
      return await writeRejection(f, replay, rej, actorUserId);
    } catch (again) {
      const second = classifyError(again, kind);
      if (second?.code === "MESAJ_CAKISMASI") return { mesajId: msg.mesajId, durum: "REDDEDILDI", varlikId: null, belgeNo: null, kod: second.code, mesaj: second.message };
      return null;
    }
  }
}
