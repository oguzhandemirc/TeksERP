// PUSH KÖPRÜSÜ (ERP kipi) — fabrika telefonun Expo belirtecini kendinde tutar; bulut yalnız (kurulum, belirteç ÖZETİ)
// bağını bilir ve push'u tek merkezden gönderir (Expo erişim belirteci yalnız bulutta). Kişi, hesap, tesis DB'si YOK.
//   · kaydet/bırak: bağ yazılır/silinir (idempotent). Bağ silmesi YALNIZ bu dosyada (`test_patron_kapilari` §4k).
//   · dürt: her ham belirtecin özeti BU kuruluma bağlı olmalı (değilse BAGSIZ, gönderilmez); metin temizlenir + kırpılır,
//     yalnız İLETİLİR — DB'ye, günlüğe, hata iletisine GİRMEZ (bekçi `test_bildirim_koprusu` sentinel ile ölçer).
//   · Expo iki aşamalı: bilet alındı = GONDERILDI; makbuzdaki `DeviceNotRegistered` bağa `invalidated_at` yazar,
//     sonraki dürt o özeti `gecersiz` döner ve bağı siler (fabrika kendi satırını siler).
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { CloudError, badRequest } from "../lib/errors";
import { withCentral } from "../lib/tenant";
import { bridgeGateState } from "../push/native-gate";
import { bridgeSoundOf, ExpoTransport, RECEIPT_BATCH, RecordingTransport, type BridgeTransport, type PushOutcome, type ReceiptBatch } from "../push/transports";
import type { z } from "zod";
import {
  ENVELOPE_VERSION,
  PUSH_BODY_MAX,
  PUSH_DEFAULT_SOUND,
  PUSH_SOUNDS,
  PUSH_TITLE_MAX,
  type PushNudgeOutcome,
  type PushNudgeRequestSchema,
  type PushNudgeResponseSchema,
  type PushRegisterRequestSchema,
  type PushReleaseRequestSchema,
  type PushSound,
} from "../wire/esitleme";

type PushRegisterRequest = z.infer<typeof PushRegisterRequestSchema>;
type PushReleaseRequest = z.infer<typeof PushReleaseRequestSchema>;
type PushNudgeRequest = z.infer<typeof PushNudgeRequestSchema>;
type PushNudgeResponse = z.input<typeof PushNudgeResponseSchema>;
import type { CloudContext } from "./context";
import { RECEIPT_DELAY_MS, RECEIPT_GIVE_UP_MS } from "./notification-receipts";
import type { BridgeCaller } from "./push-bridge-auth";
import { sendWithBudget } from "./push-bridge-send";

/** Kurulum başına bağ tavanı (sızmış bir kurulum anahtarı merkez tabloyu şişiremesin). */
export const PUSH_BRIDGE_MAX_LINKS = 200;
export const tokenDigestOf = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

// ---------------------------------------------------------------- gönderim kapısı

const expoByCtx = new WeakMap<CloudContext, ExpoTransport>();

/**
 * Köprünün taşıyıcısı ya da null (= gönderim KAPALI; uçlar çalışır, sonuç `KAPALI`). Kapı `bridgeGateState`: `sahte`
 * kipte kayıtlı sahte gönderici; aksi hâlde `acik` + belirteçle kendi Expo taşıyıcısı (`BILDIRIM_KIPI`den bağımsız).
 */
export function bridgeTransport(ctx: CloudContext): BridgeTransport | null {
  if (ctx.pushBridge !== undefined) return ctx.pushBridge;
  const gate = bridgeGateState(ctx.config);
  if (gate.kip === "sahte") return ctx.notifications?.transport instanceof RecordingTransport ? ctx.notifications.transport : null;
  if (gate.kip !== "gercek") return null;
  let expo = expoByCtx.get(ctx);
  if (!expo) {
    expo = new ExpoTransport(ctx.config);
    expoByCtx.set(ctx, expo);
  }
  return expo;
}

// ---------------------------------------------------------------- metin temizliği

// C0/C1 denetim karakterleri (sekme ve satır sonu ayrı ele alınır) + yön/biçim karakterleri: çift yönlü denetim
// (U+200E/F, U+202A–202E, U+2066–2069, U+061C) kilit ekranında metni ters çevirip yanıltabilir; sıfır genişlikli
// (U+200B–200D, U+FEFF) ve satır/paragraf ayırıcı (U+2028/2029) metni gizler ya da tek satır kuralını deler.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g;

/** Denetim karakteri temizliği + kırpma (kod noktası; vekil çift bölünmez). Başlık tek satır, gövde en çok çift boş satır. */
export function cleanPushText(text: string, max: number, multiline: boolean): string {
  let t = text.replace(CONTROL, "");
  t = multiline ? t.replace(/\t/g, " ").replace(/\n{3,}/g, "\n\n") : t.replace(/[\t\n]+/g, " ");
  t = t.replace(/ {2,}/g, " ").trim();
  const points = Array.from(t);
  return points.length > max ? `${points.slice(0, max - 1).join("").trimEnd()}…` : t;
}

// ---------------------------------------------------------------- uçlar

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

// Hız sınırı kapıda (`push-bridge-limits.ts`, nonce'tan önce); uçlar yalnız işi yapar.
export async function registerTokens(ctx: CloudContext, caller: BridgeCaller, req: PushRegisterRequest): Promise<{ v: 1; bagli: string[] }> {
  const digests = unique(req.ozetler);
  const installationId = caller.installationId;
  await withCentral(ctx.sync, {}, async (tx) => {
    // Tavan yarışı: kurulumun var olan bağları kilitlenir (belirlenimli sıra) → eşzamanlı kaydetler sıraya girer ve
    // sayım bir öncekinin eklediğini görür. Sıfır bağdan başlayan yarış tavanı en çok eşzamanlı istek × 20 aşar (belge §5).
    await tx.$queryRaw`SELECT id FROM push_bridge_links WHERE kurulum_id = ${installationId}::uuid ORDER BY id FOR UPDATE`;
    const existing = await tx.pushBridgeLink.count({ where: { installationId } });
    const known = await tx.pushBridgeLink.count({ where: { installationId, tokenDigest: { in: digests } } });
    if (existing - known + digests.length > PUSH_BRIDGE_MAX_LINKS) {
      throw new CloudError(409, "BAG_TAVANI", `Bu kurulumun belirteç bağı tavanı (${PUSH_BRIDGE_MAX_LINKS}) doldu; kullanılmayanları bırakın`);
    }
    await tx.pushBridgeLink.createMany({ data: digests.map((tokenDigest) => ({ installationId, tokenDigest })), skipDuplicates: true });
    // Yeniden kayıt geçersizlik işaretini kaldırır (telefon aynı belirteci yeniden doğruladı).
    await tx.pushBridgeLink.updateMany({ where: { installationId, tokenDigest: { in: digests }, invalidatedAt: { not: null } }, data: { invalidatedAt: null } });
    // Ses seçimi (S0): kayıt bağın sesini KURAR — `sesler`de olmayan özet varsayılana döner. Aynı sesli özetler tek yazım.
    for (const [key, group] of soundGroups(digests, req.sesler ?? [])) {
      const [soundNotification, soundAlarm] = key.split("|") as [PushSound, PushSound];
      await tx.pushBridgeLink.updateMany({ where: { installationId, tokenDigest: { in: group } }, data: { soundNotification, soundAlarm } });
    }
  });
  return { v: ENVELOPE_VERSION, bagli: digests };
}

/** Özetleri (bildirim|alarm) sesine göre gruplar; aynı özet iki kez gelirse SON seçim geçerli. */
function soundGroups(digests: readonly string[], sounds: NonNullable<PushRegisterRequest["sesler"]>): Map<string, string[]> {
  const chosen = new Map(sounds.map((s) => [s.ozet, `${s.bildirim}|${s.alarm}`]));
  const out = new Map<string, string[]>();
  for (const d of digests) {
    const key = chosen.get(d) ?? `${PUSH_DEFAULT_SOUND.BILDIRIM}|${PUSH_DEFAULT_SOUND.ALARM}`;
    out.set(key, [...(out.get(key) ?? []), d]);
  }
  return out;
}

/** DB değeri kümede değilse (CHECK bunu önler; savunma) sınıfın varsayılanı. */
const soundOrDefault = (v: string, fallback: PushSound): PushSound => ((PUSH_SOUNDS as readonly string[]).includes(v) ? (v as PushSound) : fallback);

export async function releaseTokens(ctx: CloudContext, caller: BridgeCaller, req: PushReleaseRequest): Promise<{ v: 1; birakilan: number }> {
  const digests = unique(req.ozetler);
  const n = await withCentral(ctx.sync, {}, async (tx) => (await tx.pushBridgeLink.deleteMany({ where: { installationId: caller.installationId, tokenDigest: { in: digests } } })).count);
  return { v: ENVELOPE_VERSION, birakilan: n };
}

const outcomeOf = (o: PushOutcome): { sonuc: PushNudgeOutcome; kod?: string } =>
  o.kind === "OK" ? { sonuc: "GONDERILDI" } : o.kind === "GECERSIZ_CIHAZ" ? { sonuc: "GECERSIZ", kod: o.code } : { sonuc: o.kind, kod: o.code };

export async function nudge(ctx: CloudContext, caller: BridgeCaller, req: PushNudgeRequest, nowMs: number): Promise<PushNudgeResponse> {
  const title = cleanPushText(req.baslik, PUSH_TITLE_MAX, false);
  if (title.length === 0) throw badRequest("Bildirim başlığı boş (denetim karakterleri temizlendikten sonra)");
  const body = cleanPushText(req.govde, PUSH_BODY_MAX, true);
  const installationId = caller.installationId;
  const tokens = unique(req.belirtecler).map((token) => ({ token, digest: tokenDigestOf(token) }));
  const links = await withCentral(ctx.sync, {}, (tx) =>
    tx.pushBridgeLink.findMany({ where: { installationId, tokenDigest: { in: tokens.map((t) => t.digest) } }, select: { tokenDigest: true, invalidatedAt: true, soundNotification: true, soundAlarm: true } }),
  );
  const cls = req.sinif ?? "BILDIRIM";
  const linkOf = new Map(links.map((l) => [l.tokenDigest, l]));
  const transport = bridgeTransport(ctx);
  const results: { ozet: string; sonuc: PushNudgeOutcome; kod?: string }[] = [];
  const tickets: { tokenDigest: string; ticket: string }[] = [];
  const msg = { title, body, bildirimId: req.data.bildirimId, rota: req.data.rota };
  const live = tokens.flatMap((t) => {
    const l = linkOf.get(t.digest);
    if (!l || l.invalidatedAt !== null) return [];
    const chosen = cls === "ALARM" ? soundOrDefault(l.soundAlarm, PUSH_DEFAULT_SOUND.ALARM) : soundOrDefault(l.soundNotification, PUSH_DEFAULT_SOUND.BILDIRIM);
    return [{ ...t, sound: bridgeSoundOf(cls, chosen) }];
  });
  // Ağ çağrısı tx DIŞINDA; süre tavanlı + yineleme belleğiyle (`push-bridge-send.ts`). Sonuç sırası istek sırasıdır.
  const sent = transport && live.length > 0 ? await sendWithBudget(ctx, transport, { installationId, items: live, msg, nowMs }) : [];
  const outcomeByDigest = new Map(live.map((t, k) => [t.digest, sent[k]]));
  for (const t of tokens) {
    const link = linkOf.get(t.digest);
    const o = outcomeByDigest.get(t.digest);
    if (!link) results.push({ ozet: t.digest, sonuc: "BAGSIZ" });
    else if (link.invalidatedAt) results.push({ ozet: t.digest, sonuc: "GECERSIZ", kod: "EXPO_CIHAZ_KAYITSIZ" });
    else if (!transport || !o) results.push({ ozet: t.digest, sonuc: "KAPALI" });
    else {
      results.push({ ozet: t.digest, ...outcomeOf(o) });
      if (o.kind === "OK" && o.ticket) tickets.push({ tokenDigest: t.digest, ticket: o.ticket });
    }
  }
  const invalid = results.filter((r) => r.sonuc === "GECERSIZ").map((r) => r.ozet);
  if (invalid.length > 0 || tickets.length > 0) {
    const now = new Date(nowMs);
    await withCentral(ctx.sync, {}, async (tx) => {
      if (invalid.length > 0) await tx.pushBridgeLink.deleteMany({ where: { installationId, tokenDigest: { in: invalid } } });
      if (tickets.length > 0) {
        await tx.pushBridgeTicket.createMany({
          data: tickets.map((x) => ({ installationId, tokenDigest: x.tokenDigest, ticket: x.ticket, sentAt: now, receiptDueAt: new Date(nowMs + RECEIPT_DELAY_MS) })),
          skipDuplicates: true,
        });
      }
    });
  }
  return { v: ENVELOPE_VERSION, gonderim: transport ? "acik" : "kapali", sonuclar: results, gecersiz: invalid };
}

// ---------------------------------------------------------------- makbuz turu (merkez)

const CLAIM_MS = 2 * 60_000;
const BATCH = 100;

interface ClaimedTicket {
  id: string;
  kurulum_id: string;
  token_digest: string;
  ticket: string;
  sent_at: Date;
}

const label = (o: PushOutcome): string => (o.kind === "OK" ? "OK" : `${o.kind}:${o.code}`).slice(0, 60);

/** Vadesi gelen köprü biletlerinin makbuzları: atomik claim (`FOR UPDATE SKIP LOCKED`), ağ tx DIŞINDA, sonuç yalnız claim bizdeyse. */
export async function checkBridgeReceipts(ctx: CloudContext, transport: BridgeTransport, nowMs: number): Promise<{ checked: number; invalid: number }> {
  const t = { checked: 0, invalid: 0 };
  const now = new Date(nowMs);
  const until = new Date(nowMs + CLAIM_MS);
  const claimed = await withCentral(ctx.sync, {}, (tx) =>
    tx.$queryRaw<ClaimedTicket[]>`
      WITH due AS (
        SELECT id FROM push_bridge_tickets
         WHERE receipt_due_at <= ${now}::timestamptz
         ORDER BY receipt_due_at, id LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED)
      UPDATE push_bridge_tickets p SET receipt_due_at = ${until}::timestamptz, updated_at = now()
        FROM due WHERE p.id = due.id
      RETURNING p.id, p.kurulum_id, p.token_digest, p.ticket, p.sent_at`,
  );
  if (claimed.length === 0) return t;
  let batch: ReceiptBatch = { kind: "OK", results: new Map() };
  if (transport.receipts) {
    const results = new Map<string, PushOutcome>();
    for (let i = 0; i < claimed.length && batch.kind === "OK"; i += RECEIPT_BATCH) {
      const r = await transport.receipts(claimed.slice(i, i + RECEIPT_BATCH).map((c) => c.ticket));
      if (r.kind === "OK") for (const [k, v] of r.results) results.set(k, v);
      else batch = r;
    }
    if (batch.kind === "OK") batch = { kind: "OK", results };
  }
  for (const c of claimed) {
    const r = batch.kind === "OK" ? batch.results.get(c.ticket) : undefined;
    const expired = nowMs - c.sent_at.getTime() >= RECEIPT_GIVE_UP_MS;
    const data: Prisma.PushBridgeTicketUpdateManyMutationInput = r
      ? { result: label(r), receiptDueAt: null }
      : !transport.receipts
        ? { result: "YOKLANAMADI", receiptDueAt: null }
        : expired
          ? { result: "ZAMAN_ASIMI", receiptDueAt: null }
          : { receiptDueAt: new Date(nowMs + RECEIPT_DELAY_MS) };
    const invalid = r?.kind === "GECERSIZ_CIHAZ";
    const written = await withCentral(ctx.sync, {}, async (tx) => {
      const w = await tx.pushBridgeTicket.updateMany({ where: { id: c.id, receiptDueAt: until }, data });
      if (w.count === 1 && invalid) {
        await tx.pushBridgeLink.updateMany({ where: { installationId: c.kurulum_id, tokenDigest: c.token_digest, invalidatedAt: null }, data: { invalidatedAt: now } });
      }
      return w.count === 1;
    });
    if (written) {
      t.checked++;
      if (invalid) t.invalid++;
    }
  }
  return t;
}
