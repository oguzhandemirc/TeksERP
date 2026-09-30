// GÜNCELLEYİCİ IPC OKUYUCUSU (Dağıtım v2 — docs/design/GUNCELLEYICI.md §5): güncelleyici (SYSTEM) durum
// dizinine `durum.json` + `gecmis.jsonl` yazar; backend yalnız OKUR (dizin ona salt okunur). Biçim ileri
// uyumludur (tanınmayan alan yok sayılır); dosya yoksa "güncelleyici yok", okunamıyor/biçimsizse
// "ölçülemedi". Bağlantı (junction/sembolik bağ) izlenmez, boy sınırlıdır.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/** Geliştirme/test için açık veri kökü (mutlak); yoksa Windows'ta `%ProgramData%\TeksERP\guncelleme`. */
export const UPDATER_DIR_ENV = "TEKSERP_GUNCELLEME_DIZINI";
export const UPDATER_STATUS_FILE = path.join("durum", "durum.json");
export const UPDATER_HISTORY_FILE = path.join("durum", "gecmis.jsonl");
const STATUS_MAX_BYTES = 64 * 1024;
const HISTORY_TAIL_BYTES = 64 * 1024;
/** Panele verilen geçmiş satırı sayısı (en yeni önce). */
export const UPDATER_HISTORY_LIMIT = 20;

const Code = z.string().regex(/^[A-Z0-9_]{2,40}$/);
const Short = (max: number) => z.string().max(max).nullable().optional();

/** `durum\durum.json` (D2 §5.2) — yalnız backend'in kullandığı alanlar; gerisi atılır. */
export const UpdaterStatusDocSchema = z.object({
  v: z.literal(1),
  durum: Code,
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
  urun: z.string().max(20),
  kaynakSurum: Short(40),
  surum: z.string().max(40),
  sonuc: Code,
  hataKodu: Short(60),
  basladi: z.string().max(40),
  bitti: z.string().max(40),
  veriGeriYuklendi: z.boolean().optional(),
});
export type UpdaterHistoryLine = z.infer<typeof UpdaterHistoryLineSchema>;

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
