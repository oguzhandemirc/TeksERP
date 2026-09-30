// BİLDİRİM GÖNDERİCİ TURU — yan konteyner (`satici-bildirim`) bunu döngüde koşar; DB bağlantısı YALNIZ
// `bildirim`de SELECT + durum kolonlarında UPDATE yetkili rolledir (göç `20261001130000`). Bir tur:
//   ① yapılandırılmamış kanalın bekleyenleri KAPALI (gönderim yok; portal kanal durumunu buradan okur)
//   ② `BILDIRIM_AZAMI_YAS_SAAT`ten eski bekleyen HATA `SURESI_GECTI` (uzun kesintinin birikmişi yığılmasın)
//   ③ aday oku → ATOMİK CLAIM: `updateMany WHERE {id, durum, deneme}` (deneme her claim'de artar = CAS) →
//      GONDERILIYOR + kilit süresi; count 0 → başka gönderici almış, dokunulmaz. Süresi dolan kilit (çöken
//      gönderici) yeniden alınabilir.
//   ④ ağ çağrısı tx DIŞINDA; sonuç YALNIZ kendi claim'imiz duruyorsa yazılır (`WHERE {id, GONDERILIYOR, deneme,
//      kilitBitis}`): OK → GONDERILDI · GECICI → üstel geri çekilme (tavanda HATA) · 429 → sağlayıcının süresi kadar
//      KANAL beklemesi, deneme hakkı yanmaz · KALICI → HATA (Telegram sohbeti taşındıysa yeni kimlik satırda).
// Hata kaydı yalnız kısa KODdur (DB seddi); gövde okunurken allowlist şemasından geçmeyen satır gönderilmez.
import type { BildirimDurumu, BildirimKanali, BildirimOlayi, Prisma, PrismaClient } from "@prisma/client";
import { NOTIFICATION_CHANNELS, NotificationBodySchema } from "./catalog";
import { renderMessage } from "./message";
import type { NotificationTransport, SendOutcome } from "./transports";

/** Claim süresi: ağ zaman aşımının (10 sn) çok üstünde — canlı gönderimin kilidi dolmaz. */
export const CLAIM_MS = 2 * 60_000;
const BATCH = 25;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 6 * 3_600_000;

/** Üstel geri çekilme: 1 · 4 · 16 · 64 · 256 dk … en çok 6 saat (deneme = bu tura dek yapılan deneme sayısı). */
export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 4 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS);
}

export interface SenderSettings {
  readonly maxAttempts: number;
  readonly maxAgeHours: number;
  readonly portalBase: string | null;
  readonly timeZone: string;
}

export interface SenderDeps {
  readonly db: PrismaClient;
  /** YALNIZ yapılandırılmış kanallar; olmayan kanal KAPALI sayılır. */
  readonly transports: Partial<Record<BildirimKanali, NotificationTransport>>;
  readonly settings: SenderSettings;
  /** Kanal beklemesi (sağlayıcı 429 `retry_after`): bu ana dek o kanala İSTEK ATILMAZ. Turlar arası taşınır. */
  readonly pausedUntil?: Map<BildirimKanali, number>;
}

export interface CycleTotals {
  closed: number;
  expired: number;
  sent: number;
  retried: number;
  failed: number;
  /** Claim'i başka gönderici aldı ya da kilit bitmeden sonuç yazılamadı. */
  lost: number;
  /** Kanal beklemesinde (429) dokunulmadan bırakılan aday. */
  paused: number;
}

interface Candidate {
  readonly id: string;
  readonly olay: BildirimOlayi;
  readonly kanal: BildirimKanali;
  readonly govde: Prisma.JsonValue;
  readonly durum: BildirimDurumu;
  readonly deneme: number;
  readonly createdAt: Date;
}

interface Claimed extends Candidate {
  readonly until: Date;
}

/** Bekleyen ya da kilidi dolmuş satır (yalnız bu kanallardan). */
const openRows = (now: Date): Prisma.BildirimWhereInput[] => [{ durum: "BEKLIYOR" }, { durum: "GONDERILIYOR", kilitBitis: { lt: now } }];

async function closeUnconfigured(deps: SenderDeps, now: Date): Promise<number> {
  const off = NOTIFICATION_CHANNELS.filter((k) => !deps.transports[k]);
  if (off.length === 0) return 0;
  const r = await deps.db.bildirim.updateMany({
    where: { kanal: { in: off }, OR: openRows(now) },
    data: { durum: "KAPALI", kilitBitis: null, sonHata: "KANAL_YAPILANDIRILMAMIS" },
  });
  return r.count;
}

async function expireStale(deps: SenderDeps, nowMs: number): Promise<number> {
  const now = new Date(nowMs);
  const r = await deps.db.bildirim.updateMany({
    where: { createdAt: { lt: new Date(nowMs - deps.settings.maxAgeHours * 3_600_000) }, OR: openRows(now) },
    data: { durum: "HATA", kilitBitis: null, sonHata: "SURESI_GECTI" },
  });
  return r.count;
}

async function claim(db: PrismaClient, row: Candidate, nowMs: number): Promise<Claimed | null> {
  const now = new Date(nowMs);
  const until = new Date(nowMs + CLAIM_MS);
  const due: Prisma.BildirimWhereInput = row.durum === "BEKLIYOR" ? { sonrakiDeneme: { lte: now } } : { kilitBitis: { lt: now } };
  const r = await db.bildirim.updateMany({
    where: { id: row.id, durum: row.durum, deneme: row.deneme, ...due },
    data: { durum: "GONDERILIYOR", kilitBitis: until, deneme: { increment: 1 } },
  });
  return r.count === 1 ? { ...row, deneme: row.deneme + 1, until } : null;
}

/** Sonucu yaz — yalnız claim hâlâ bizdeyse (count 0 → kilit dolmuş, başka gönderici almış). */
async function finish(db: PrismaClient, c: Claimed, data: Prisma.BildirimUpdateManyMutationInput): Promise<boolean> {
  const r = await db.bildirim.updateMany({ where: { id: c.id, durum: "GONDERILIYOR", deneme: c.deneme, kilitBitis: c.until }, data: { ...data, kilitBitis: null } });
  return r.count === 1;
}

async function attempt(deps: SenderDeps, c: Claimed): Promise<SendOutcome> {
  const transport = deps.transports[c.kanal];
  if (!transport) return { kind: "KALICI", code: "KANAL_YAPILANDIRILMAMIS" };
  const body = NotificationBodySchema.safeParse(c.govde);
  if (!body.success) return { kind: "KALICI", code: "GOVDE_GECERSIZ" };
  const msg = renderMessage(c.olay, body.data, { portalBase: deps.settings.portalBase, timeZone: deps.settings.timeZone, createdAt: c.createdAt });
  try {
    return await transport.send(msg, `bildirim-${c.id}`);
  } catch {
    return { kind: "GECICI", code: "TASIYICI_HATASI" };
  }
}

/** Bir turun ortak durumu: an · sayaçlar · kanal beklemeleri. */
interface Cycle {
  readonly nowMs: number;
  readonly t: CycleTotals;
  readonly paused: Map<BildirimKanali, number>;
}

async function deliver(deps: SenderDeps, c: Claimed, cycle: Cycle): Promise<void> {
  const { nowMs, t, paused } = cycle;
  const outcome = await attempt(deps, c);
  if (outcome.kind === "OK") {
    const ok = await finish(deps.db, c, { durum: "GONDERILDI", gonderimZamani: new Date(nowMs), saglayiciKimligi: outcome.providerId, sonHata: null });
    if (ok) t.sent++;
    else t.lost++;
    return;
  }
  if (outcome.kind === "GECICI" && outcome.rateLimited) {
    // Hız sınırı satırın kusuru değil: deneme hakkı YANMAZ, kanal bekleme süresince istek görmez.
    const wait = outcome.retryAfterMs ?? backoffMs(c.deneme);
    paused.set(c.kanal, nowMs + wait);
    if (await finish(deps.db, c, { durum: "BEKLIYOR", sonrakiDeneme: new Date(nowMs + wait), sonHata: outcome.code, deneme: c.deneme - 1 })) t.retried++;
    else t.lost++;
    return;
  }
  if (outcome.kind === "GECICI" && c.deneme < deps.settings.maxAttempts) {
    const wait = Math.max(backoffMs(c.deneme), outcome.retryAfterMs ?? 0);
    if (await finish(deps.db, c, { durum: "BEKLIYOR", sonrakiDeneme: new Date(nowMs + wait), sonHata: outcome.code })) t.retried++;
    else t.lost++;
    return;
  }
  const moved = outcome.kind === "KALICI" && outcome.newChatId ? { yeniSohbetKimligi: outcome.newChatId } : {};
  if (await finish(deps.db, c, { durum: "HATA", sonHata: outcome.code, ...moved })) t.failed++;
  else t.lost++;
}

/** Bir tur: kapat → eskit → al → gönder. Aynı anda birden çok gönderici koşabilir (claim atomik). */
export async function runSenderCycle(deps: SenderDeps, nowMs: number): Promise<CycleTotals> {
  const now = new Date(nowMs);
  const t: CycleTotals = { closed: 0, expired: 0, sent: 0, retried: 0, failed: 0, lost: 0, paused: 0 };
  const paused = deps.pausedUntil ?? new Map<BildirimKanali, number>();
  t.closed = await closeUnconfigured(deps, now);
  t.expired = await expireStale(deps, nowMs);
  const live = NOTIFICATION_CHANNELS.filter((k) => deps.transports[k]);
  if (live.length === 0) return t;
  const candidates = await deps.db.bildirim.findMany({
    where: { kanal: { in: live }, OR: [{ durum: "BEKLIYOR", sonrakiDeneme: { lte: now } }, { durum: "GONDERILIYOR", kilitBitis: { lt: now } }] },
    orderBy: [{ sonrakiDeneme: "asc" }, { id: "asc" }],
    take: BATCH,
    select: { id: true, olay: true, kanal: true, govde: true, durum: true, deneme: true, createdAt: true },
  });
  for (const row of candidates) {
    if ((paused.get(row.kanal) ?? 0) > nowMs) {
      t.paused++;
      continue;
    }
    const c = await claim(deps.db, row, nowMs);
    if (!c) {
      t.lost++;
      continue;
    }
    await deliver(deps, c, { nowMs, t, paused });
  }
  return t;
}
