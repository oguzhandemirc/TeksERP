// ETKİLİ DESTEK — yapılandırma (kapatma düğmesi) ve süreç içi çalışma zamanı.
// Varsayılan KAPALI (= bugünkü davranış): `DESTEK_API_URL` + `DESTEK_API_KEY` (ya da `DESTEK_API_KEY_DOSYASI`) ikisi de
// geçerli değilse destek uçları 403 `MODULE_DISABLED` döner ve merkeze HİÇBİR istek gitmez; `DESTEK_WEBHOOK_SECRET`
// (ya da `…_DOSYASI`) yoksa webhook ucu 404'tür. Biçimsiz değer açılışı DURDURMAZ (destek bulutun yan özelliğidir; diğer
// uçlar etkilenmez): özellik kapalı sayılır ve tek satır günlüğe NEDEN (değişken adı) yazılır — sırrın kendisi ASLA.
// Sırlar docker secret dosyasından gelir (`deploy/patron/patron-baslat.sh` → `…_DOSYASI`); boş dosya = kapalı.
import { secret } from "../../lib/security-events";
import { EventDedupe } from "./dedupe";

/**
 * Merkezdeki firma kimliği = lisans HAK'ındaki tesis kimliği (`hak.tesis.id`; bulutta oturumun `tesisId`'si). Müşteri sabiti
 * DEĞİL: fabrika backend'i aynı değeri kendi lisansından okur, böylece panelden ve patrondan açılan talep aynı firmada durur.
 */
export function supportTenantId(tesisId: string): string {
  return tesisId.toLowerCase();
}

/** Webhook'taki `externalTenantId` bir tesis kimliği mi (UUID); değilse bu bulutun talebi değildir. */
export function tesisIdFromTenant(externalTenantId: unknown): string | null {
  if (typeof externalTenantId !== "string") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(externalTenantId) ? externalTenantId.toLowerCase() : null;
}

const API_KEY = /^dst_(live|test)_[A-Za-z0-9_-]{8,200}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9_-]{8,200}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface SupportApiConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
}

export interface SupportRuntime {
  /** null = destek uçları KAPALI (dış istek yok). */
  readonly api: SupportApiConfig | null;
  /** null = webhook ucu KAPALI (404). */
  readonly webhookSecret: string | null;
  /** Merkeze giden istek (bekçide sahte merkez için sayaçlı sarmal). */
  readonly fetch: typeof fetch;
  /** Webhook `eventId` tekilleştirmesi (bellek içi, süreli). */
  readonly events: EventDedupe;
  /** Yanıttan SONRA süren webhook push işleri (bekçi bekler; kapanışta beklenebilir). */
  readonly pending: Set<Promise<unknown>>;
  /** Açılış günlüğü satırı (sırsız). */
  readonly summary: string;
}

/** HTTPS zorunlu; düz HTTP yalnız döngü adresi (yerel test merkezi). */
export function supportUrlAllowed(raw: string): boolean {
  if (!URL.canParse(raw)) return false;
  const u = new URL(raw);
  if (u.username || u.password || u.search || u.hash) return false;
  return u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname));
}

function apiConfig(env: NodeJS.ProcessEnv): { api: SupportApiConfig } | { reason: string } {
  const baseUrl = env.DESTEK_API_URL?.trim() ?? "";
  const key = secret(env, "DESTEK_API_KEY");
  if (!baseUrl) return { reason: "DESTEK_API_URL yok" };
  if (!supportUrlAllowed(baseUrl)) return { reason: "DESTEK_API_URL geçersiz ya da HTTPS değil" };
  if (!("value" in key)) return { reason: key.reason };
  if (!API_KEY.test(key.value)) return { reason: "DESTEK_API_KEY biçimsiz" };
  return { api: { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey: key.value } };
}

function webhookSecret(env: NodeJS.ProcessEnv): { value: string } | { reason: string } {
  const s = secret(env, "DESTEK_WEBHOOK_SECRET");
  if (!("value" in s)) return s;
  return WEBHOOK_SECRET.test(s.value) ? s : { reason: "DESTEK_WEBHOOK_SECRET biçimsiz" };
}

/** Ortamdan çalışma zamanı; dış istek YAPMAZ (açılışta merkeze ping yok). */
export function createSupportRuntime(env: NodeJS.ProcessEnv = process.env, opts: { fetch?: typeof fetch } = {}): SupportRuntime {
  const a = apiConfig(env);
  const w = webhookSecret(env);
  const api = "api" in a ? a.api : null;
  const hook = "value" in w ? w.value : null;
  const parts = [api ? "uçlar AÇIK" : `uçlar KAPALI (${"reason" in a ? a.reason : "?"})`, hook ? "webhook AÇIK" : `webhook KAPALI (${"reason" in w ? w.reason : "?"})`];
  return { api, webhookSecret: hook, fetch: opts.fetch ?? fetch, events: new EventDedupe(), pending: new Set(), summary: `destek: ${parts.join(" · ")}` };
}
