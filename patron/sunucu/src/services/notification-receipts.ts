// BİLDİRİM MAKBUZU — Expo push'un İKİNCİ aşaması: gönderim bilet döner, asıl teslim sonucu makbuzdadır
// (`DeviceNotRegistered` çoğu kez burada gelir). Bilet alınmış bildirim `receipt_due_at` taşır; tur ATOMİK
// CLAIM ile alır (`FOR UPDATE SKIP LOCKED`), ağ çağrısı tx DIŞINDA, sonuç yalnız claim hâlâ bizdeyse yazılır.
// Kayıtsız cihaz pasife çekilir; hazır olmayan makbuz sonra yeniden sorulur, 24 saatte vazgeçilir (Expo
// makbuzu bir gün tutar). Bildirimin durumu değişmez (bilet kabul edildi = GONDERILDI); makbuz teslim kaydına eklenir.
import type { Prisma } from "@prisma/client";
import { withTesis } from "../lib/tenant";
import { RECEIPT_BATCH, type PushOutcome, type PushTransport, type ReceiptBatch } from "../push/transports";
import type { CloudContext } from "./context";

export const RECEIPT_DELAY_MS = 15 * 60_000;
export const RECEIPT_GIVE_UP_MS = 24 * 3_600_000;
const CLAIM_MS = 2 * 60_000;
const BATCH = 100;

export interface Delivery {
  readonly cihazId: string;
  readonly sonuc: string;
  readonly bilet?: string;
  readonly makbuz?: string;
}

export interface ReceiptTotals {
  checked: number;
  invalid: number;
}

interface Claimed {
  id: string;
  deliveries: unknown;
  sent_at: Date | null;
}

export function readDeliveries(v: unknown): Delivery[] {
  if (!Array.isArray(v)) return [];
  return v.filter((d): d is Delivery => typeof d === "object" && d !== null && typeof (d as Delivery).cihazId === "string" && typeof (d as Delivery).sonuc === "string");
}

const pending = (d: Delivery): boolean => typeof d.bilet === "string" && d.makbuz === undefined;
const label = (o: PushOutcome): string => (o.kind === "OK" ? "OK" : `${o.kind}:${o.code}`);

async function claim(ctx: CloudContext, tesisId: string, nowMs: number, until: Date): Promise<Claimed[]> {
  const now = new Date(nowMs);
  return withTesis(ctx.app, { tesisId }, (tx) =>
    tx.$queryRaw<Claimed[]>`
      WITH due AS (
        SELECT id FROM notifications
         WHERE tesis_id = ${tesisId}::uuid AND receipt_due_at <= ${now}::timestamptz
         ORDER BY receipt_due_at, id LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED)
      UPDATE notifications n SET receipt_due_at = ${until}::timestamptz, updated_at = now()
        FROM due WHERE n.id = due.id
      RETURNING n.id, n.deliveries, n.sent_at`,
  );
}

async function fetchAll(transport: PushTransport, tickets: readonly string[]): Promise<ReceiptBatch> {
  const results = new Map<string, PushOutcome>();
  for (let i = 0; i < tickets.length; i += RECEIPT_BATCH) {
    const r = await transport.receipts!(tickets.slice(i, i + RECEIPT_BATCH));
    if (r.kind !== "OK") return r;
    for (const [k, v] of r.results) results.set(k, v);
  }
  return { kind: "OK", results };
}

/** Bir tesisin vadesi gelen makbuzlarını yokla. */
export async function checkReceipts(ctx: CloudContext, transport: PushTransport, tesisId: string, nowMs: number): Promise<ReceiptTotals> {
  const t: ReceiptTotals = { checked: 0, invalid: 0 };
  const until = new Date(nowMs + CLAIM_MS);
  const claimed = await claim(ctx, tesisId, nowMs, until);
  if (claimed.length === 0) return t;
  const tickets = claimed.flatMap((n) => readDeliveries(n.deliveries).filter(pending).map((d) => d.bilet!));
  const batch: ReceiptBatch = !transport.receipts || tickets.length === 0 ? { kind: "OK", results: new Map() } : await fetchAll(transport, tickets);
  for (const n of claimed) {
    const expired = !n.sent_at || nowMs - n.sent_at.getTime() >= RECEIPT_GIVE_UP_MS;
    const invalid: string[] = [];
    const next = readDeliveries(n.deliveries).map((d): Delivery => {
      if (!pending(d)) return d;
      const r = batch.kind === "OK" ? batch.results.get(d.bilet!) : undefined;
      if (r) {
        if (r.kind === "GECERSIZ_CIHAZ") invalid.push(d.cihazId);
        return { ...d, makbuz: label(r) };
      }
      if (!transport.receipts) return { ...d, makbuz: "YOKLANAMADI" };
      return expired ? { ...d, makbuz: "ZAMAN_ASIMI" } : d;
    });
    const due = next.some(pending) ? new Date(nowMs + RECEIPT_DELAY_MS) : null;
    const written = await withTesis(ctx.app, { tesisId }, async (tx) => {
      const r = await tx.notification.updateMany({ where: { id: n.id, tesisId, receiptDueAt: until }, data: { deliveries: next as unknown as Prisma.InputJsonValue, receiptDueAt: due } });
      if (r.count === 1 && invalid.length > 0) await tx.pushDevice.updateMany({ where: { tesisId, id: { in: invalid }, active: true }, data: { active: false } });
      return r.count === 1;
    });
    if (written) {
      t.checked++;
      t.invalid += invalid.length;
    }
  }
  return t;
}
