// SENARYO L — ham (fabrika süreci OLMADAN) imzalı istemci: L40 yeteneksiz alıcı · L41 eski fabrika (v1) · L42 `yol`.
// v1 protokolü L2-1'in (v2 protokolünün ilk commit'i) ebeveyninden `git show` ile koşumun geçici dizinine çıkarılır ve oradan içe aktarılır:
// eski fabrikanın gövde kurucusu ve doğrulayıcısı BUGÜNKÜ kodla değil o günkü kodla ölçülür (tasarım §4.2).
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadLicenseStoreSync } from "../../src/lib/license/store";
import { TEKS_KOKU } from "./senaryo-lisans-surec";

/** L2-1'in (v2 protokolünün ilk commit'i) ebeveyni: v1 protokolünün son hâli (`git log -- …/protocol`). */
export const V1_TABAN = "1971a7e9ee94e7ff6015a6afb1073e7d04c484a8";
const PROTOKOL_YOLU = "Teks-Erp/src/lib/license/protocol";

interface Sonuc<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly code?: string;
  readonly message?: string;
}
interface Semasal {
  safeParse(x: unknown): { success: boolean; error?: { message: string } };
}
export interface V1Belge {
  readonly document: Record<string, unknown>;
  readonly signer?: { readonly kind: string; readonly kid: string };
}
/** v1 protokolünün senaryonun kullandığı yüzü (çıkarılan kodun gerçek dışa aktarımları). */
export interface V1Protokol {
  readonly REQUEST_HEADER: string;
  readonly ActivateRequestSchema: Semasal;
  readonly PollRequestSchema: Semasal;
  readonly LicenseResponseSchema: Semasal;
  readonly ACCEPTANCE_TEXTS: ReadonlyArray<{ kimlik: string; ozet: string; kutular: readonly string[] }>;
  signRequest(g: { installationId: string | null; purpose: string; body: string; key: { privateKey: KeyObject; nowMs: number; nonce?: string } }): string;
  signAcceptance(g: { payload: Record<string, unknown>; privateKey: KeyObject }): string;
  publicKeyX(k: KeyObject): string;
  digestFingerprint(raw: Record<string, string | null>, salt: Uint8Array): Record<string, string | null>;
  compareFingerprints(a: Record<string, string | null>, b: Record<string, string | null>): { result: string; matched: number; measurable: number };
  verifyEntitlement(token: unknown, roots: readonly unknown[]): Sonuc<V1Belge>;
  verifyLease(token: unknown, roots: readonly unknown[]): Sonuc<V1Belge>;
  checkLeaseBinding(lease: V1Belge, ent: V1Belge): Sonuc<true>;
  wrapEnvelope(request: string, body: string): string;
}

/** v1 protokolünü `dizin/v1-protokol`a çıkarır ve içe aktarır; git ya da içe aktarma düşerse neden döner. */
export async function v1ProtokolYukle(dizin: string): Promise<{ v1: V1Protokol | null; neden: string }> {
  const kok = path.dirname(TEKS_KOKU);
  const ls = spawnSync("git", ["ls-tree", "--name-only", "--full-tree", V1_TABAN, `${PROTOKOL_YOLU}/`], { cwd: kok, encoding: "utf8" });
  const dosyalar = (ls.stdout ?? "").split("\n").filter((x) => x.endsWith(".ts"));
  if (ls.status !== 0 || dosyalar.length === 0) return { v1: null, neden: `git ls-tree ${V1_TABAN.slice(0, 9)}: ${ls.stderr.trim() || "dosya yok"}` };
  const hedef = path.join(dizin, "v1-protokol");
  fs.mkdirSync(hedef, { recursive: true });
  for (const d of dosyalar) {
    const r = spawnSync("git", ["show", `${V1_TABAN}:${d}`], { cwd: kok, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0) return { v1: null, neden: `git show ${d}: ${r.stderr.trim()}` };
    fs.writeFileSync(path.join(hedef, path.basename(d)), r.stdout);
  }
  // Tek dış bağımlılık zod: geçici dizinden çözülsün diye backend'in node_modules'üne bağ.
  fs.symlinkSync(path.join(TEKS_KOKU, "node_modules"), path.join(hedef, "node_modules"), "dir");
  try {
    const v1: V1Protokol = await import(pathToFileURL(path.join(hedef, "index.ts")).href);
    return { v1, neden: `${dosyalar.length} dosya @ ${V1_TABAN.slice(0, 9)}` };
  } catch (err) {
    return { v1: null, neden: `içe aktarma: ${(err as Error).message}` };
  }
}

export interface HamYanit {
  readonly status: number;
  readonly json: Record<string, unknown>;
  readonly kod: string | undefined;
}

/** Kurulum anahtarı (Ed25519) + tuz + lisans kimliği; fabrika süreci yok. */
export class HamKurulum {
  constructor(
    readonly privateKey: KeyObject,
    readonly tuz: Buffer,
    public kurulumId: string | null,
  ) {}

  static yeni(): HamKurulum {
    return new HamKurulum(generateKeyPairSync("ed25519").privateKey, randomBytes(32), null);
  }

  /** Durmuş bir fabrikanın lisans klasöründen, fabrikanın KENDİ depo okuyucusuyla (anahtar + tuz + lisans kimliği). */
  static klasorden(lisansDizini: string): HamKurulum {
    const depo = loadLicenseStoreSync({ dir: lisansDizini });
    if (!depo.key) throw new Error(`${lisansDizini}: kurulum anahtarı okunamadı (${depo.problem ?? "anahtar yok"})`);
    return new HamKurulum(depo.key.privateKey, depo.key.salt, depo.identity?.kurulumId ?? null);
  }
}

/** Satıcının genel ucuna imzalı istek (`X-TKL-Istek`); gövde ham metin, yanıt düz JSON (hata: `details.code`). */
export async function hamGonder(adres: string, yol: string, govde: string, basliklar: Record<string, string>): Promise<HamYanit> {
  const r = await fetch(`${adres}${yol}`, { method: "POST", headers: { "content-type": "application/json", ...basliklar }, body: govde });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const details = (json.details ?? {}) as { code?: unknown };
  return { status: r.status, json, kod: typeof details.code === "string" ? details.code : undefined };
}

/** JWS yükü (imza denetlenmez — yalnız alan okuması). */
export function jwsYuku(jws: unknown): Record<string, unknown> {
  if (typeof jws !== "string") return {};
  try {
    return JSON.parse(Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
