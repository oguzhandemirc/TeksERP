// =============================================================================
// Patron bulutu GELEN KUTUSU işi — zil `gelen-kutusu` + periyodik (kiradaki `esitlemeAraligiDk`)
// =============================================================================
// Backend sürecinin İÇİNDE (ikinci Node süreci yok); `license-poll.job.ts` kalıbı: `running` koruması (TEK SÜREÇ,
// tek tur — işleme sırası buluttaki atomik claim + burada seri döngü), zil yağmur korumalı, test enjeksiyonu.
// SIFIR FARK: ön koşul (§1.4, fail-closed), teknik kullanıcı ya da bulut adresi yoksa HİÇBİR dış istek atılmaz.
// Lisans yazmaya kapalıysa (`zorla` + KISITLI/DURDURULMUŞ) `al` çağrılmaz: kayıtlar bulutta BEKLIYOR kalır.
// Beklenen ağ hatası `reportJobFailure`e yazılmaz; yalnız programcı hatası iz bırakır.
// =============================================================================
import { reportJobFailure } from "./job-failure";
import { bilgi, uyari } from "../lib/logger";
import { egressTransport, requireReady, signedHeaders, type VendorTransport } from "../services/helpers/license-wire.helper";
import { cloudEligibility, inboxWritesAllowed } from "../cloud-sync/eligibility";
import { getCloudUrl } from "../cloud-sync/cloud-url";
import {
  CloudAccountsResponseSchema,
  INBOX_ENDPOINTS,
  INBOX_PULL_MAX,
  INBOX_WIRE_VERSION,
  InboxPullResponseSchema,
  type InboxOutcome,
} from "../cloud-sync/inbox-wire";
import { processInboxMessage } from "../services/cloud-inbox.service";
import { recordCloudAccounts, recordInboxRun, resolveActivePatronCloudUserId } from "../services/patron-cloud.service";

const STARTUP_DELAY_MS = 90 * 1000;
/** Ön koşul yokken ne sıklıkla yeniden bakılır (kira/hak değişince zil zaten dürter). */
const IDLE_RECHECK_MS = 5 * 60 * 1000;
/** Zil yağmurunda buluta vurmamak için iki tur arası en az bu kadar. */
const MIN_RUN_GAP_MS = 5 * 1000;

export type InboxRunOutcome =
  | "MESGUL"
  | "KAPALI"
  | "ADRES_YOK"
  | "TEKNIK_KULLANICI_YOK"
  | "LISANS_KISITLI"
  | "BASARILI"
  | "BASARISIZ";

export interface InboxRunResult {
  readonly outcome: InboxRunOutcome;
  readonly reason?: string;
  readonly pulled: number;
  readonly outcomes: readonly InboxOutcome[];
  readonly uncertain: number;
}

let started = false;
let stopped = false;
let running = false;
let again = false;
let timer: NodeJS.Timeout | null = null;
let lastRunAt = 0;

type CloudCall = { ok: true; json: unknown } | { ok: false; code: string };

async function cloudPost(base: string, path: string, body: unknown, transport: VendorTransport): Promise<CloudCall> {
  const ctx = requireReady();
  const text = JSON.stringify(body);
  let res: { status: number; body: string };
  try {
    res = await transport({ url: `${base}${path}`, method: "POST", headers: signedHeaders(ctx, "esitle", text), body: text });
  } catch (err) {
    return { ok: false, code: (err as { code?: string }).code ?? "EGRESS_NETWORK" };
  }
  let json: unknown = null;
  try {
    json = JSON.parse(res.body) as unknown;
  } catch {
    json = null;
  }
  if (res.status >= 200 && res.status < 300) return { ok: true, json };
  const code = (json as { details?: { code?: unknown } } | null)?.details?.code;
  return { ok: false, code: typeof code === "string" ? code : `HTTP_${res.status}` };
}

function done(r: InboxRunResult, nowMs: number, errorCode: string | null = null): InboxRunResult {
  recordInboxRun({
    atMs: nowMs,
    outcome: r.reason ? `${r.outcome}:${r.reason}` : r.outcome,
    pulled: r.pulled,
    processed: r.outcomes.filter((o) => o.durum === "ISLENDI").length,
    rejected: r.outcomes.filter((o) => o.durum === "REDDEDILDI").length,
    uncertain: r.uncertain,
    errorCode,
  });
  return r;
}

/**
 * Tek tur: ön koşul → `al` (bulut claim eder) → kayıtları `olusturma` sırasıyla SERİ işle (bir kaydın hatası
 * diğerlerini durdurmaz) → kesin sonuçları `sonuc` ile bildir → bulut hesap listesini tazele.
 * @param transport Test enjeksiyonu (sahte bulut); üretimde proxy'li HTTPS.
 */
export async function runCloudInboxOnce(transport: VendorTransport = egressTransport): Promise<InboxRunResult> {
  const empty = { pulled: 0, outcomes: [], uncertain: 0 };
  if (running) {
    again = true;
    return { outcome: "MESGUL", ...empty };
  }
  running = true;
  const now = Date.now();
  lastRunAt = now;
  try {
    const e = cloudEligibility(now);
    if (!e.ok) return done({ outcome: "KAPALI", reason: e.reason, ...empty }, now);
    const base = getCloudUrl().url;
    if (!base) return done({ outcome: "ADRES_YOK", ...empty }, now);
    const actor = await resolveActivePatronCloudUserId();
    if (!actor) return done({ outcome: "TEKNIK_KULLANICI_YOK", ...empty }, now);

    // Hesap listesi yazma değildir: kısıtlı kipte de tazelenir (panel salt okunur listesi).
    const acc = await cloudPost(base, INBOX_ENDPOINTS.ACCOUNTS, { v: INBOX_WIRE_VERSION }, transport);
    if (acc.ok) {
      const parsed = CloudAccountsResponseSchema.safeParse(acc.json);
      if (parsed.success) recordCloudAccounts(parsed.data.hesaplar, now);
    }

    if (!inboxWritesAllowed(e.snap)) return done({ outcome: "LISANS_KISITLI", ...empty }, now);

    const pull = await cloudPost(base, INBOX_ENDPOINTS.PULL, { v: INBOX_WIRE_VERSION, enFazla: INBOX_PULL_MAX }, transport);
    if (!pull.ok) return done({ outcome: "BASARISIZ", ...empty }, now, pull.code);
    const parsed = InboxPullResponseSchema.safeParse(pull.json);
    if (!parsed.success) return done({ outcome: "BASARISIZ", ...empty }, now, "YANIT_GECERSIZ");
    const messages = [...parsed.data.kayitlar].sort((a, b) => Date.parse(a.olusturma) - Date.parse(b.olusturma) || a.mesajId.localeCompare(b.mesajId));

    const outcomes: InboxOutcome[] = [];
    let uncertain = 0;
    for (const m of messages) {
      if (stopped) break;
      let o: InboxOutcome | null = null;
      try {
        o = await processInboxMessage(m, actor);
      } catch (err) {
        reportJobFailure("cloud-inbox", err);
      }
      if (o) outcomes.push(o);
      else uncertain++;
    }
    if (outcomes.length > 0) {
      const res = await cloudPost(base, INBOX_ENDPOINTS.RESULT, { v: INBOX_WIRE_VERSION, sonuclar: outcomes }, transport);
      // Bildirim kaybolursa zarar yok: claim süresi dolunca bulut yeniden verir, makbuz aynı sonucu döndürür.
      if (!res.ok) return done({ outcome: "BASARISIZ", pulled: messages.length, outcomes, uncertain }, now, res.code);
    }
    if (messages.length > 0) bilgi("patron-bulut", `gelen kutusu: ${messages.length} kayıt · ${outcomes.length} kesin sonuç · ${uncertain} belirsiz`);
    return done({ outcome: "BASARILI", pulled: messages.length, outcomes, uncertain }, now);
  } catch (err) {
    reportJobFailure("cloud-inbox", err);
    return done({ outcome: "BASARISIZ", ...empty }, now, "PROGRAM_HATASI");
  } finally {
    running = false;
  }
}

function nextDelayMs(): number {
  const e = cloudEligibility();
  return e.ok ? Math.max(60 * 1000, e.intervalMinutes * 60 * 1000) : IDLE_RECHECK_MS;
}

function schedule(delayMs: number): void {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runCloudInboxOnce().finally(() => {
      const rerun = again;
      again = false;
      schedule(rerun ? MIN_RUN_GAP_MS : nextDelayMs());
    });
  }, delayMs);
  timer.unref();
}

/** Zil `gelen-kutusu` dedi: beklemeden tur (yağmur korumalı; sahte zil yalnız fazladan tur yaptırır). */
export function requestImmediateCloudInboxRun(): void {
  if (!started || stopped) return;
  if (running) {
    again = true;
    return;
  }
  schedule(Math.max(0, MIN_RUN_GAP_MS - (Date.now() - lastRunAt)));
}

export function startCloudInbox(): void {
  if (started) return;
  started = true;
  schedule(STARTUP_DELAY_MS);
  if (!getCloudUrl().url) uyari("patron-bulut", "bulut adresi tanımlı değil (PATRON_BULUT_URL) — gelen kutusu kapalı");
}

/** Kapanış fazı: zamanlayıcı iptal; süren tur kayıt arasında durur. */
export function stopCloudInbox(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Test-only. */
export function __resetCloudInboxJobForTests(): void {
  stopCloudInbox();
  started = false;
  stopped = false;
  running = false;
  again = false;
}
