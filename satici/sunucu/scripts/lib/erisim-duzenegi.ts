// ERİŞİM DÜZENEĞİ (yaprak modül; yalnız node: bağımlılığı) — satıcı portalının tek yolu Cloudflare Access'tir; testte
// süreç başına TEK RSA-2048 anahtarı ve TEK JWKS dosyası (ilk kullanımda yazılır, çıkışta silinir — yaş tavanı ısırmaz).
// Takım alanı ve AUD sahtedir; sunucu ağa çıkmaz. Jeton her istekte taze basılır (exp +1 sa).
// `test-ortam.ts` (satıcı bekçileri) ve Teks-Erp `senaryo-lisans` (saati kaydırılmış satıcı süreci) aynı düzeneği kullanır.
import { generateKeyPairSync, randomBytes, randomUUID, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const ERISIM_TAKIM_ALANI = "bekci.cloudflareaccess.com";
export const ERISIM_EPOSTA = "bekci@ornek.test";
export const ERISIM_BASLIGI = "cf-access-jwt-assertion";

interface ErisimAnahtari {
  readonly ozel: KeyObject;
  readonly kid: string;
  readonly aud: string;
  readonly jwksDosyasi: string;
}
let erisimAnahtari: ErisimAnahtari | null = null;

function erisimAnahtar(): ErisimAnahtari {
  if (erisimAnahtari) return erisimAnahtari;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `bekci-${randomUUID().slice(0, 8)}`;
  const dizin = mkdtempSync(path.join(os.tmpdir(), "satici-erisim-"));
  process.once("exit", () => rmSync(dizin, { recursive: true, force: true }));
  const jwksDosyasi = path.join(dizin, "certs.json");
  const jwk = publicKey.export({ format: "jwk" });
  writeFileSync(jwksDosyasi, `${JSON.stringify({ keys: [{ kid, kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", use: "sig" }] })}\n`);
  erisimAnahtari = { ozel: privateKey, kid, aud: randomBytes(32).toString("hex"), jwksDosyasi };
  return erisimAnahtari;
}

/** JWKS dosyasının yolu (satıcı sürecinin `CF_ACCESS_JWKS_DOSYASI`'ı; saati kaydırılan süreç için mtime'ı o saate çekilir). */
export function erisimJwksDosyasi(): string {
  return erisimAnahtar().jwksDosyasi;
}

/** Bu sürecin düzeneğine göre geçerli Access JWT'si (gerçek RS256). `simdiMs`: doğrulayan sürecin saati (kaydırılmışsa onunki). */
export function erisimJetonu(g: { eposta?: string; simdiMs?: number } = {}): string {
  const a = erisimAnahtar();
  const sn = Math.floor((g.simdiMs ?? Date.now()) / 1000);
  const b64u = (x: unknown): string => Buffer.from(JSON.stringify(x)).toString("base64url");
  const govde = `${b64u({ alg: "RS256", kid: a.kid, typ: "JWT" })}.${b64u({ aud: [a.aud], email: g.eposta ?? ERISIM_EPOSTA, sub: "bekci", iss: `https://${ERISIM_TAKIM_ALANI}`, iat: sn - 5, nbf: sn - 5, exp: sn + 3600, type: "app" })}`;
  return `${govde}.${sign("sha256", Buffer.from(govde), a.ozel).toString("base64url")}`;
}

/** Sunucunun ERİŞİM ayarları (gerçek süreç ortamı ya da `loadConfig` girdisi). */
export function erisimOrtami(): Record<string, string> {
  const a = erisimAnahtar();
  return { PORT_ERISIM: "0", ERISIM_BIND: "127.0.0.1", CF_ACCESS_TAKIM_ALANI: ERISIM_TAKIM_ALANI, CF_ACCESS_AUD: a.aud, CF_ACCESS_JWKS_DOSYASI: a.jwksDosyasi };
}
