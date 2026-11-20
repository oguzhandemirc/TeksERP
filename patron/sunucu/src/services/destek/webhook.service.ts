// ETKİLİ DESTEK WEBHOOK'u (merkez → bulut; YALNIZ bulutta — fabrikaya gelen port açılmaz). Kılavuz §6'ya birebir:
// HAM gövdeyle imza doğrulaması (`verifyWebhook`: HMAC-SHA256(sır, `${ts}.${sha256hex(gövde)}`), sabit zamanlı
// karşılaştırma), zaman penceresi ±300 sn, `eventId` tekilleştirmesi (ikinci gelişte İŞLEMEDEN 2xx). Yanıt hemen döner;
// push bildirimi yanıttan SONRA koşar ve başarısızlığı yanıtı etkilemez (merkez 10 sn içinde 2xx bekler).
//
// Bildirim: yalnız `ticket.replied` (ekip yanıtı) push üretir; `ticket.status_changed` ve `ping` yalnız onaylanır
// (yanıtla birlikte gelen durum değişimi ikinci bir bildirim doğurmasın; güncel durum uygulamada `GET` ile okunur).
// Alıcı: YALNIZ `externalTenantId` = tesis kimliği olan hazır tesisin AKTİF patron hesapları (tesis başına DB; başka tesise gitmez) — hepsi firma yöneticisidir (`isTenantAdmin: true`) ve firmanın bütün
// taleplerini görür; talebi açan (`externalUserId`) bunların içindeyse o da alır. Hesabın bildirim tercihi uyulur:
// bildirimler kapalıysa ya da sessiz saatteyse gönderilmez (kuyruğa girmez — destek türü bildirim kataloğunda yoktur,
// rozet uygulamada yine görünür). Native push İÇERİKSİZDİR (yalnız başlık; `transports.ts` F5) — gövde web push'a gider.
import { randomUUID } from "node:crypto";
import type { DevicePlatform } from "@prisma/client";
import { DestekWebhookError, verifyWebhook, type DestekTicketEvent, type DestekWebhookEvent } from "../../integrations/destek";
import { CloudError } from "../../lib/errors";
import { FACILITY_TIMEZONE_SOURCE, facilityTimeZoneAt, quietUntil } from "../../lib/facility-clock";
import { listReadyFacilities, withTesis } from "../../lib/tenant";
import type { PushOutcome, PushTransport } from "../../push/transports";
import type { CloudContext } from "../context";
import { loadFacilitySettings, resolveSettings } from "../notification-settings.service";
import { tesisIdFromTenant } from "./config";

export const PUSH_TITLE = "Destek yanıtı";
const EXCERPT_MAX = 100;

export interface WebhookResult {
  readonly data: { readonly alindi: true; readonly yinelenen: boolean; readonly tur: string };
  /** Yanıttan sonra koşacak push işi (yoksa null). */
  readonly push: (() => Promise<PushSummary>) | null;
}

export interface PushSummary {
  readonly hesap: number;
  readonly gonderilen: number;
  readonly atlanan: number;
  readonly pasife: number;
}

type HeaderBag = Record<string, string | string[] | undefined>;

/** Doğrula + tekilleştir. Sır yoksa 404 (uç kapalı); imza/zaman 401; gövde 400. Sır ve gövde günlüğe GİRMEZ. */
export function receiveWebhook(ctx: CloudContext, raw: Buffer, headers: HeaderBag): WebhookResult {
  const rt = ctx.destek ?? null;
  if (!rt?.webhookSecret) throw new CloudError(404, "BULUNAMADI", "Bulunamadı");
  let event: DestekWebhookEvent;
  try {
    event = verifyWebhook(raw, headers, rt.webhookSecret, { nowMs: ctx.now() });
  } catch (e) {
    if (!(e instanceof DestekWebhookError)) throw e;
    console.warn(`[patron] destek webhook reddedildi: ${e.code}`);
    throw new CloudError(e.code === "INVALID_PAYLOAD" ? 400 : 401, e.code, e.code === "INVALID_PAYLOAD" ? "Webhook gövdesi okunamadı." : "Webhook imzası doğrulanamadı.");
  }
  const eventId = event.eventId.slice(0, 200);
  if (!rt.events.firstSeen(eventId, ctx.now())) return { data: { alindi: true, yinelenen: true, tur: event.type }, push: null };
  const tesisId = event.type === "ticket.replied" && isTicketEvent(event) ? tesisIdFromTenant(event.data.externalTenantId) : null;
  const push = tesisId ? () => pushReply(ctx, event as DestekTicketEvent, tesisId) : null;
  return { data: { alindi: true, yinelenen: false, tur: event.type }, push };
}

function isTicketEvent(e: DestekWebhookEvent): e is DestekTicketEvent {
  const d = (e as DestekTicketEvent).data as Partial<DestekTicketEvent["data"]> | undefined;
  return !!d && typeof d.ticketId === "string" && typeof d.number === "string" && typeof d.subject === "string";
}

/** Bildirim metni: başlık sabit; gövde talep no + konu + yanıt özeti (≤ 100 karakter). */
export function replyMessage(e: DestekTicketEvent, tesisId: string) {
  const excerpt = (e.data.lastMessage?.excerpt ?? "").replace(/\s+/g, " ").trim();
  const short = excerpt.length > EXCERPT_MAX ? `${excerpt.slice(0, EXCERPT_MAX - 1)}…` : excerpt;
  const head = `${e.data.number} · ${e.data.subject}`.slice(0, 160);
  return { id: randomUUID(), title: PUSH_TITLE, body: short ? `${head}\n${short}` : head, route: `/destek/${encodeURIComponent(e.data.ticketId)}`, tesisId };
}

interface Target {
  readonly accountId: string;
  readonly devices: readonly { id: string; platform: DevicePlatform; token: string }[];
}

/** Tesisin bildirim alacak hesapları ve etkin cihazları (tercih + sessiz saat burada süzülür). */
async function targets(ctx: CloudContext, tesisId: string, nowMs: number): Promise<{ accounts: number; skipped: number; list: Target[] }> {
  return withTesis(ctx.app, { tesisId, projections: [FACILITY_TIMEZONE_SOURCE] }, async (tx) => {
    const active = await tx.facility.findFirst({ where: { tesisId, status: "AKTIF" }, select: { tesisId: true } });
    if (!active) return { accounts: 0, skipped: 0, list: [] };
    const accounts =await tx.account.findMany({ where: { tesisId, status: "AKTIF" }, select: { id: true }, orderBy: { id: "asc" } });
    const cfg = await loadFacilitySettings(tx, tesisId);
    const tesis = await tx.projectionRow.findFirst({ where: { tesisId, projection: FACILITY_TIMEZONE_SOURCE, deletedAt: null }, select: { data: true } });
    const tz = facilityTimeZoneAt(tesis?.data ?? null, nowMs);
    const open = accounts.filter((a) => {
      const st = resolveSettings(cfg.byAccount.get(a.id) ?? null, cfg.facility).settings;
      return st.acik && quietUntil(st.sessiz, nowMs, tz) === null;
    });
    const ids = open.map((a) => a.id);
    const devices = ids.length ? await tx.pushDevice.findMany({ where: { tesisId, accountId: { in: ids }, active: true }, select: { id: true, accountId: true, platform: true, token: true }, orderBy: { id: "asc" } }) : [];
    const list = ids.map((accountId) => ({ accountId, devices: devices.filter((d) => d.accountId === accountId) })).filter((t) => t.devices.length > 0);
    return { accounts: accounts.length, skipped: accounts.length - open.length, list };
  });
}

async function sendTo(transport: PushTransport, t: Target, msg: ReturnType<typeof replyMessage>): Promise<{ id: string; outcome: PushOutcome }[]> {
  const out: { id: string; outcome: PushOutcome }[] = [];
  for (const d of t.devices) {
    let outcome: PushOutcome;
    try {
      outcome = await transport.send({ platform: d.platform, token: d.token }, msg);
    } catch {
      outcome = { kind: "GECICI", code: "TASIYICI_HATASI" };
    }
    out.push({ id: d.id, outcome });
  }
  return out;
}

/** `ticket.replied` → patron hesaplarının cihazlarına push. Hata yutulur (webhook yanıtı çoktan döndü). */
export async function pushReply(ctx: CloudContext, e: DestekTicketEvent, targetTesisId: string): Promise<PushSummary> {
  const sum = { hesap: 0, gonderilen: 0, atlanan: 0, pasife: 0 };
  const transport = ctx.notifications?.transport ?? null;
  if (!transport) return sum; // BILDIRIM_KIPI=kapali: gönderim yok (bugünkü davranış)
  const nowMs = ctx.now();
  const ready = await listReadyFacilities(ctx.app);
  for (const tesisId of ready.filter((id) => id.toLowerCase() === targetTesisId)) {
    const t = await targets(ctx, tesisId, nowMs);
    sum.hesap += t.accounts;
    sum.atlanan += t.skipped;
    const msg = replyMessage(e, tesisId);
    for (const target of t.list) {
      const results = await sendTo(transport, target, msg);
      sum.gonderilen += results.filter((r) => r.outcome.kind === "OK").length;
      const invalid = results.filter((r) => r.outcome.kind === "GECERSIZ_CIHAZ").map((r) => r.id);
      if (invalid.length === 0) continue;
      const r = await withTesis(ctx.app, { tesisId }, (tx) => tx.pushDevice.updateMany({ where: { tesisId, id: { in: invalid }, active: true }, data: { active: false } }));
      sum.pasife += r.count;
    }
  }
  console.log(`[patron] destek bildirimi: ${sum.hesap} hesap · ${sum.gonderilen} cihaza gitti · ${sum.atlanan} hesap tercihle atlandı · ${sum.pasife} cihaz pasife`);
  return sum;
}
