// GÜNCELLEYİCİ IPC (Dağıtım v2 — docs/design/GUNCELLEYICI.md §5): güncelleyici (SYSTEM) durum dizinine
// `durum.json` + `gecmis.jsonl` yazar, backend yalnız OKUR; niyet dizinine (`niyet\niyet.json`) yalnız
// backend yazar. Okuma ileri uyumludur (tanınmayan alan yok sayılır); dosya yoksa "güncelleyici yok",
// okunamıyor/biçimsizse "ölçülemedi". Bağlantı (junction/sembolik bağ) izlenmez, boy sınırlıdır.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  APPROVAL_TIMINGS,
  IsoTimeSchema,
  ReleaseVersionSchema,
  UPDATE_DECISIONS,
  UuidSchema,
} from "./protocol";

/** Geliştirme/test için açık veri kökü (mutlak); yoksa Windows'ta `%ProgramData%\TeksERP\guncelleme`. */
export const UPDATER_DIR_ENV = "TEKSERP_GUNCELLEME_DIZINI";
export const UPDATER_STATUS_FILE = path.join("durum", "durum.json");
export const UPDATER_HISTORY_FILE = path.join("durum", "gecmis.jsonl");
export const UPDATER_INTENT_DIR = "niyet";
export const UPDATER_INTENT_FILE = path.join(UPDATER_INTENT_DIR, "niyet.json");
const STATUS_MAX_BYTES = 64 * 1024;
const INTENT_MAX_BYTES = 64 * 1024;
const HISTORY_TAIL_BYTES = 64 * 1024;
/** Panele verilen geçmiş satırı sayısı (en yeni önce). */
export const UPDATER_HISTORY_LIMIT = 20;

const Code = z.string().regex(/^[A-Z0-9_]{2,40}$/);
const Short = (max: number) => z.string().max(max).nullable().optional();

/**
 * `durum\durum.json` (D2 §5.2) — yalnız backend'in kullandığı alanlar; gerisi atılır. Kesin bloklar
 * (`karar` · `bekleyen` · `son` · `sonAyrinti`) burada ham okunur, eşlemede KENDİ şemasıyla süzülür: biri
 * biçimsizse yalnız o blok yok sayılır, dosyanın tamamı "ölçülemedi" olmaz.
 */
export const UpdaterStatusDocSchema = z.object({
  v: z.literal(1),
  durum: Code,
  /** Kalp atışı (§5.2): her turda tazelenir; yaşı `canlilikEsigiSn`i aşarsa güncelleyici yanıt vermiyor. */
  sonCanlilik: Short(40),
  canlilikEsigiSn: z.number().int().min(0).nullable().optional(),
  urun: Short(20),
  karar: z.unknown().optional(),
  bekleyen: z.unknown().optional(),
  son: z.unknown().optional(),
  sonAyrinti: z.unknown().optional(),
  bilgi: z.unknown().optional(),
  surum: Short(40),
  kaynakSurum: Short(40),
  kuruluSurum: Short(40),
  adim: Short(60),
  hataKodu: Short(60),
  mesaj: Short(500),
  ilerleme: z.object({ indirilen: z.number().int().min(0), toplam: z.number().int().min(0) }).nullable().optional(),
  planlanan: Short(40),
  politika: z.object({ kip: z.string().max(20), izin: z.boolean(), neden: Short(60) }).nullable().optional(),
  guncelleyiciSurum: Short(40),
  zaman: Short(40),
});
export type UpdaterStatusDoc = z.infer<typeof UpdaterStatusDocSchema>;

/** `durum\gecmis.jsonl` satırı (D2 §5.3) — onaylayanın adı gibi alanlar okunmaz. */
export const UpdaterHistoryLineSchema = z.object({
  v: z.literal(1),
  islemId: z.string().max(64),
  /** İşlemi tetikleyen panel onayı (`UpdateApproval.id`); otomatik pencerede null. */
  onayId: Short(64),
  urun: z.string().max(20),
  /** PG satırında: bu adımın ön koşul olduğu backend sürümü. */
  hedefBackend: Short(40),
  kaynakSurum: Short(40),
  surum: z.string().max(40),
  sonuc: Code,
  /** Raporun belgeli sonuç kodu (`UPDATE_RESULT_CODES`); iç kod `ayrintiKodu`nda. */
  hataKodu: Short(60),
  ayrintiKodu: Short(60),
  basladi: z.string().max(40),
  bitti: z.string().max(40),
  veriGeriYuklendi: z.boolean().optional(),
});
export type UpdaterHistoryLine = z.infer<typeof UpdaterHistoryLineSchema>;

// ── durum.json'un KESİN blokları (§5.2) — eşleme bunları sezgisiz, doğrudan okur ────────────────
const IntervalSchema = z.object({ baslangic: IsoTimeSchema, bitis: IsoTimeSchema });
/** `karar`: güncelleyicinin son kararı (aday olsun olmasın) — TS `UpdateDecision` birebir. */
export const UpdaterDecisionBlockSchema = z.object({
  karar: z.enum(UPDATE_DECISIONS),
  neden: Code.nullable(),
  aralik: IntervalSchema.nullable().optional(),
  pgGuncellemesi: z.boolean().optional(),
});
export type UpdaterDecisionBlock = z.infer<typeof UpdaterDecisionBlockSchema>;
/** `bekleyen`: en yeni adayın kararı (geri dönmüş aday yeni onay yoksa ONAY_BEKLIYOR). */
export const UpdaterPendingBlockSchema = UpdaterDecisionBlockSchema.extend({
  surum: ReleaseVersionSchema,
  zorunlu: z.boolean().optional(),
  ozet: z.string().max(2000).nullable().optional(),
});
export type UpdaterPendingBlock = z.infer<typeof UpdaterPendingBlockSchema>;
/** `sonAyrinti`: son sonucun iç kodu ve ileti (panel/destek; rapora GİTMEZ). */
export const UpdaterLastDetailSchema = z.object({
  urun: z.enum(["backend", "pg"]),
  hataKodu: Code.nullable(),
  mesaj: z.string().max(500).nullable(),
});
export type UpdaterLastDetail = z.infer<typeof UpdaterLastDetailSchema>;
/** `bilgi`: bu turun SORUN OLMAYAN bilgisi (bugün yalnız `SEMA_OLCULEMEDI`) — `hataKodu`ndan ayrı; yoksa alan yok. */
export const UpdaterNoticeSchema = z.object({ kod: Code, mesaj: z.string().max(500) });
export type UpdaterNotice = z.infer<typeof UpdaterNoticeSchema>;

export type UpdaterStatusRead =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly reason: string }
  | { readonly kind: "ok"; readonly doc: UpdaterStatusDoc };

export interface UpdaterRead {
  readonly status: UpdaterStatusRead;
  /** Geçerli satırlar, eskiden yeniye (sondan okunan pencere). */
  readonly history: readonly UpdaterHistoryLine[];
}

/** Veri kökü: açık değişken (göreliyse `invalid`) > Windows'ta ProgramData > yok (güncelleyici yok). */
export function resolveUpdaterDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): { readonly dir: string | null; readonly invalid: boolean } {
  const explicit = env[UPDATER_DIR_ENV]?.trim();
  if (explicit) return path.isAbsolute(explicit) ? { dir: explicit, invalid: false } : { dir: null, invalid: true };
  const programData = platform === "win32" ? (env.ProgramData ?? env.PROGRAMDATA)?.trim() : undefined;
  return { dir: programData ? path.join(programData, "TeksERP", "guncelleme") : null, invalid: false };
}

/** Düz dosya (bağlantı değil) ve boy sınırı içinde mi — değilse okunmaz. */
function plainFileSize(file: string): number | "missing" | "unsafe" {
  try {
    const st = fs.lstatSync(file);
    return st.isFile() && !st.isSymbolicLink() ? st.size : "unsafe";
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unsafe";
  }
}

export function readUpdaterStatus(dir: string): UpdaterStatusRead {
  const file = path.join(dir, UPDATER_STATUS_FILE);
  const size = plainFileSize(file);
  if (size === "missing") return { kind: "missing" };
  if (size === "unsafe" || size > STATUS_MAX_BYTES) return { kind: "invalid", reason: "durum dosyası düz dosya değil ya da çok büyük" };
  try {
    const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    const parsed = UpdaterStatusDocSchema.safeParse(JSON.parse(text));
    return parsed.success ? { kind: "ok", doc: parsed.data } : { kind: "invalid", reason: "durum dosyası biçimsiz" };
  } catch {
    return { kind: "invalid", reason: "durum dosyası okunamadı" };
  }
}

/** Geçmişin son penceresi: biçimsiz ya da yarım satır atlanır (tek bozuk satır geçmişi susturmaz). */
export function readUpdaterHistory(dir: string): UpdaterHistoryLine[] {
  const file = path.join(dir, UPDATER_HISTORY_FILE);
  const size = plainFileSize(file);
  if (typeof size !== "number") return [];
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const start = Math.max(0, size - HISTORY_TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    const body = start > 0 ? text.slice(text.indexOf("\n") + 1) : text.replace(/^﻿/, "");
    const out: UpdaterHistoryLine[] = [];
    for (const line of body.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = UpdaterHistoryLineSchema.safeParse(JSON.parse(line));
        if (parsed.success) out.push(parsed.data);
      } catch {
        // yarım/bozuk satır
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Güncelleyicinin durum + geçmişi; kök yoksa "yok", açık kök göreliyse "ölçülemedi". */
export function readUpdater(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): UpdaterRead {
  const { dir, invalid } = resolveUpdaterDir(env, platform);
  if (invalid) return { status: { kind: "invalid", reason: `${UPDATER_DIR_ENV} mutlak bir yol olmalı` }, history: [] };
  if (!dir) return { status: { kind: "missing" }, history: [] };
  return { status: readUpdaterStatus(dir), history: readUpdaterHistory(dir) };
}

// ── NİYET (§5.1) — backend yazar, güncelleyici okur; YETKİ DEĞİL, yalnız TETİK ─────────────────
// Güven sınırı: düşük yetkili backend yazar, SYSTEM güncelleyici okur. Niyet yalnız bir SÜRÜM ve bir
// KİMLİK seçer — yol, komut, adres, dosya adı TAŞIMAZ (şema KATI; tanınmayan anahtar yazılamaz). Kurulacak
// paket ve sunucu adresi güncelleyicinin kendi ayarından + imzalı bildirimden gelir; onay yalnız AYNI
// sürümün imzalı adayına sayılır (sözleşme §3 madde 2).
/** JWS karakter kümesi (güncelleyicinin `Intent::validate`ıyla aynı): base64url parçaları + nokta. */
const IntentTokenSchema = z.string().min(1).max(32 * 1024).regex(/^[A-Za-z0-9._-]+$/);
/** Onaylayanın adı: tek satır (kontrol karakteri yok), en çok 200 (güncelleyicinin tavanı). */
const IntentNameSchema = z.string().min(1).max(200).refine((s) => !/\p{Cc}/u.test(s), { message: "ad tek satır olmalı" });
export const UpdaterIntentSchema = z.strictObject({
  v: z.literal(1),
  yazildi: IsoTimeSchema,
  indirme: z.strictObject({ belirtec: IntentTokenSchema, bitis: IsoTimeSchema }).nullable(),
  onay: z
    .strictObject({
      onayId: UuidSchema,
      surum: ReleaseVersionSchema,
      zamanlama: z.enum(APPROVAL_TIMINGS),
      kullaniciId: UuidSchema,
      ad: IntentNameSchema,
      zaman: IsoTimeSchema,
    })
    .nullable(),
});
export type UpdaterIntent = z.infer<typeof UpdaterIntentSchema>;

export type IntentWriteResult =
  | { readonly kind: "ok"; readonly file: string }
  | { readonly kind: "error"; readonly code: "NIYET_BICIMSIZ" | "NIYET_DIZINI_YOK" | "NIYET_DIZINI_GUVENSIZ" | "NIYET_YAZILAMADI"; readonly reason: string };

const RENAME_RETRIES = 5;
const RENAME_RETRY_MS = 100;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Niyeti ATOMİK yazar: `niyet.json.tmp` (yalnız yeni dosya; bağlantı izlenmez) → diske boşalt → `niyet.json`
 * üstüne yeniden adlandır — okuyan yarım dosya görmez. Dizin yoksa ya da bağlantıysa YAZMAZ (fail-closed).
 * Windows'ta güncelleyici o an dosyayı açık tutuyorsa yeniden adlandırma kısa aralıklarla yeniden denenir.
 */
export async function writeUpdaterIntent(dir: string, intent: UpdaterIntent): Promise<IntentWriteResult> {
  const parsed = UpdaterIntentSchema.safeParse(intent);
  if (!parsed.success) return { kind: "error", code: "NIYET_BICIMSIZ", reason: "niyet sözleşme biçiminde değil" };
  const intentDir = path.join(dir, UPDATER_INTENT_DIR);
  try {
    const st = fs.lstatSync(intentDir);
    if (st.isSymbolicLink() || !st.isDirectory()) return { kind: "error", code: "NIYET_DIZINI_GUVENSIZ", reason: "niyet dizini düz bir dizin değil" };
  } catch {
    return { kind: "error", code: "NIYET_DIZINI_YOK", reason: "niyet dizini yok (kurulum dizin iskeletini kurmalı)" };
  }
  const file = path.join(dir, UPDATER_INTENT_FILE);
  if (plainFileSize(file) === "unsafe") return { kind: "error", code: "NIYET_DIZINI_GUVENSIZ", reason: "niyet dosyası düz dosya değil" };
  const tmp = `${file}.tmp`;
  const text = `${JSON.stringify(parsed.data, null, 2)}\n`;
  try {
    fs.rmSync(tmp, { force: true });
    const fd = fs.openSync(tmp, "wx");
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    for (let attempt = 1; ; attempt++) {
      try {
        fs.renameSync(tmp, file);
        return { kind: "ok", file };
      } catch (err) {
        if (attempt >= RENAME_RETRIES) throw err;
        await sleep(RENAME_RETRY_MS);
      }
    }
  } catch {
    fs.rmSync(tmp, { force: true });
    return { kind: "error", code: "NIYET_YAZILAMADI", reason: "niyet dosyası yazılamadı" };
  }
}

/** Backend'in kendi yazdığı niyet (belirteci yeniden başlatmada korumak için); yoksa ya da biçimsizse null. */
export function readUpdaterIntent(dir: string): UpdaterIntent | null {
  const file = path.join(dir, UPDATER_INTENT_FILE);
  const size = plainFileSize(file);
  if (typeof size !== "number" || size > INTENT_MAX_BYTES) return null;
  try {
    const parsed = UpdaterIntentSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
