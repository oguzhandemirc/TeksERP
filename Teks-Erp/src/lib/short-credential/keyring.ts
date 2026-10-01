// Kısa kimlik (PIN/kart) özetlerinin HMAC anahtar HALKASI — DB'de değil LICENSE_DIR'de, ki DB kopyası
// tek başına PIN vermesin. Halka üstüne yazılmaz: başka makineden gelen anahtar EKLENİR. Yalnız
// ENOENT yeni halka üretir; okunamayan dosya üretmez (sessiz anahtar değişimi = PIN'lerin sessiz ölümü).
import fs from "node:fs";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { resolveLicenseDir } from "../license/store";
import { readFileState, writeFileAtomicSync } from "../license/store-files";

export const SHORT_CREDENTIAL_KEY_FILE = "kisa-kimlik-anahtarlari.json";
const KEY_BYTES = 32;
const MAX_FILE_BYTES = 64 * 1024;
const KID_LABEL = "tekserp/kisa-kimlik/kid/v1";

export type KeySource = "URETILDI" | "EMANETTEN";

export interface RingKey {
  readonly kid: string;
  readonly key: Buffer;
  readonly createdAt: string;
  readonly source: KeySource;
}

export interface KeyRing {
  readonly dir: string;
  readonly active: RingKey;
  readonly keys: readonly RingKey[];
}

export type KeyRingProblem = "DEPO_SORUNLU" | "OKUNAMADI" | "YAZILAMADI";

export type KeyRingState =
  | { readonly ok: true; readonly ring: KeyRing }
  | { readonly ok: false; readonly problem: KeyRingProblem; readonly dir: string | null; readonly detail: string };

const FileSchema = z.object({
  v: z.literal(1),
  etkin: z.string().regex(/^[0-9a-f]{16}$/),
  anahtarlar: z
    .array(
      z.object({
        kid: z.string().regex(/^[0-9a-f]{16}$/),
        anahtar: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        olusturuldu: z.string().min(10).max(40),
        kaynak: z.enum(["URETILDI", "EMANETTEN"]),
      }),
    )
    .min(1)
    .max(32),
});

/** Anahtarın kimliği — anahtarın kendisinden türer (dosyadaki `kid` alanı doğrulanır). */
export function kidOf(key: Buffer): string {
  return createHmac("sha256", key).update(KID_LABEL).digest("hex").slice(0, 16);
}

let cached: KeyRingState | null = null;
let dirOverride: string | null = null;

/** Yalnız bekçi: halka dizinini değiştirir ve önbelleği boşaltır ("başka makine" benzetimi). */
export function setShortCredentialKeyDirForTests(dir: string | null): void {
  dirOverride = dir;
  cached = null;
}

/** Yalnız bekçi/yönetim aracı: önbelleği boşaltır (dosya dışarıdan değiştiyse). */
export function invalidateShortCredentialKeyRing(): void {
  cached = null;
}

function ringDir(): { dir: string | null; problem: string | null } {
  if (dirOverride) return { dir: path.resolve(dirOverride), problem: null };
  const r = resolveLicenseDir();
  return { dir: r.dir, problem: r.problem };
}

function fileBody(keys: readonly RingKey[], activeKid: string): string {
  return `${JSON.stringify(
    {
      v: 1,
      etkin: activeKid,
      anahtarlar: keys.map((k) => ({
        kid: k.kid,
        anahtar: k.key.toString("base64url"),
        olusturuldu: k.createdAt,
        kaynak: k.source,
      })),
    },
    null,
    2,
  )}\n`;
}

function parseFile(text: string): { keys: RingKey[]; activeKid: string } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = FileSchema.safeParse(raw);
  if (!parsed.success) return null;
  const keys: RingKey[] = [];
  for (const k of parsed.data.anahtarlar) {
    const key = Buffer.from(k.anahtar, "base64url");
    if (key.length !== KEY_BYTES || kidOf(key) !== k.kid) return null;
    keys.push({ kid: k.kid, key, createdAt: k.olusturuldu, source: k.kaynak });
  }
  if (!keys.some((k) => k.kid === parsed.data.etkin)) return null;
  return { keys, activeKid: parsed.data.etkin };
}

function load(): KeyRingState {
  const { dir, problem } = ringDir();
  if (!dir || problem) {
    return { ok: false, problem: "DEPO_SORUNLU", dir, detail: `lisans deposu kullanılamıyor (${problem ?? "dizin yok"})` };
  }
  const file = path.join(dir, SHORT_CREDENTIAL_KEY_FILE);
  const state = readFileState(file, MAX_FILE_BYTES);
  if (state.kind === "METIN") {
    const parsed = parseFile(state.text);
    if (!parsed) return { ok: false, problem: "OKUNAMADI", dir, detail: "anahtar dosyası bozuk" };
    const active = parsed.keys.find((k) => k.kid === parsed.activeKid)!;
    return { ok: true, ring: { dir, active, keys: parsed.keys } };
  }
  if (state.kind !== "YOK") {
    return { ok: false, problem: "OKUNAMADI", dir, detail: `anahtar dosyası okunamadı (${state.kind})` };
  }
  // İlk kullanım: halkayı üret. Başka makineden gelen özetler varsa onlar emanetten eklenir.
  const key = randomBytes(KEY_BYTES);
  const fresh: RingKey = { kid: kidOf(key), key, createdAt: new Date().toISOString(), source: "URETILDI" };
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileAtomicSync(file, fileBody([fresh], fresh.kid));
  } catch (e) {
    return { ok: false, problem: "YAZILAMADI", dir, detail: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, ring: { dir, active: fresh, keys: [fresh] } };
}

/** Halkayı (önbellekli) döner; ilk çağrıda dosya yoksa üretir. */
export function getShortCredentialKeyRing(): KeyRingState {
  if (cached && cached.ok) return cached;
  // Hata durumu önbelleklenmez: dizin izni düzeltilince yeniden başlatma gerekmesin.
  cached = load();
  return cached;
}

/**
 * Emanetten açılan anahtarı halkaya EKLER (etkin anahtar DEĞİŞMEZ — yeni özetler bu
 * makinenin anahtarıyla yazılmaya devam eder). Zaten varsa no-op. Döner: kid.
 */
export function addKeyToRing(key: Buffer, source: KeySource = "EMANETTEN"): string {
  if (key.length !== KEY_BYTES) throw new Error("Kısa kimlik anahtarı 32 bayt olmalı.");
  const st = getShortCredentialKeyRing();
  if (!st.ok) throw new Error(`Kısa kimlik anahtar halkası kullanılamıyor: ${st.detail}`);
  const kid = kidOf(key);
  if (st.ring.keys.some((k) => k.kid === kid)) return kid;
  const added: RingKey = { kid, key: Buffer.from(key), createdAt: new Date().toISOString(), source };
  const keys = [...st.ring.keys, added];
  writeFileAtomicSync(path.join(st.ring.dir, SHORT_CREDENTIAL_KEY_FILE), fileBody(keys, st.ring.active.kid));
  cached = { ok: true, ring: { dir: st.ring.dir, active: st.ring.active, keys } };
  return kid;
}

/** Halkadaki anahtarı kid ile bul. */
export function ringKeyByKid(ring: KeyRing, kid: string): RingKey | null {
  return ring.keys.find((k) => k.kid === kid) ?? null;
}
