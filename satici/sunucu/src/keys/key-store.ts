// Anahtar deposu: anahtar dizinindeki dosyaları okur, güven çapasına karşı doğrular.
//   *.kok.json     — KÖK / hazırlık kökü (parolalı; burada yalnız AÇIK yarısı okunur)
//   *.bayi.json    — BAYİ (bayinin parolasıyla sarılı; yalnız açık yarı + sertifika)
//   *.anahtar.json — ALT (kira) / İNDİRME (parolasız 0600 + kök imzalı sertifika)
// Çapa: gömülü ROOT_PUBLIC_KEYS (fabrikanın güvendiği küme — ayna); yalnız hazırlık/test için
// GUVEN_CAPASI_DOSYASI. Çapada olmayan kökle imza yapılmaz (fabrika reddederdi) — fail-closed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { KeyObject } from "node:crypto";
import { z } from "zod";
import {
  CLOCK_SKEW_MS,
  LICENSE_CLASSES,
  ROOT_PUBLIC_KEYS,
  STAGING_ROOT_CLASSES,
  isoToMs,
  prepareTrustAnchor,
  verifyCertificate,
  type CertificateDoc,
  type CertUsage,
  type LicenseClass,
  type RootKey,
} from "../lisans-protokol";
import type { VendorConfig } from "../config";
import { readSubKeyFile, readWrappedKeyFile, subKeyPrivate } from "./key-files";

export type VendorKeyKind = "KOK" | "HAZIRLIK_KOK" | "ALT" | "INDIRME" | "BAYI";

export interface WrappedKeyInfo {
  readonly path: string;
  readonly kid: string;
  readonly kind: "KOK" | "HAZIRLIK_KOK" | "BAYI";
  readonly x: string;
  readonly classes: readonly LicenseClass[];
  /** Kök çapada (aynı kid + aynı açık anahtar) mı? Değilse imzada kullanılmaz. */
  readonly inAnchor: boolean;
  readonly certificate: string | null;
}

export interface LoadedSubKey {
  readonly kid: string;
  readonly kind: "ALT" | "INDIRME";
  readonly privateKey: KeyObject;
  readonly x: string;
  readonly certificate: string;
  readonly document: CertificateDoc;
}

export interface PublicKeyRecord {
  readonly kid: string;
  readonly kind: VendorKeyKind;
  readonly x: string;
  readonly classes: readonly LicenseClass[];
  readonly certificate: string | null;
  readonly notBefore: Date | null;
  readonly notAfter: Date | null;
}

const AnchorFileSchema = z
  .array(z.strictObject({ kid: z.string(), x: z.string(), classes: z.array(z.enum(LICENSE_CLASSES)).min(1) }))
  .min(1);

const USAGE_OF: Record<"tekserp-alt-anahtar" | "tekserp-indirme-anahtar", { usage: CertUsage; kind: "ALT" | "INDIRME" }> = {
  "tekserp-alt-anahtar": { usage: "ALT", kind: "ALT" },
  "tekserp-indirme-anahtar": { usage: "INDIRME", kind: "INDIRME" },
};

function listFiles(dir: string, suffix: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(suffix))
    .sort()
    .map((n) => path.join(dir, n));
}

function certValidAt(doc: CertificateDoc, atMs: number): boolean {
  return atMs >= isoToMs(doc.baslangic) - CLOCK_SKEW_MS && atMs <= isoToMs(doc.bitis) + CLOCK_SKEW_MS;
}

export class KeyStore {
  private constructor(
    readonly anchor: readonly RootKey[],
    readonly anchorSource: "gomulu" | "dosya",
    readonly wrapped: readonly WrappedKeyInfo[],
    readonly subKeys: readonly LoadedSubKey[],
    readonly warnings: readonly string[],
  ) {}

  static load(config: Pick<VendorConfig, "ANAHTAR_DIZINI" | "GUVEN_CAPASI_DOSYASI">, nowMs: number = Date.now()): KeyStore {
    const warnings: string[] = [];
    let anchor: readonly RootKey[] = ROOT_PUBLIC_KEYS;
    let anchorSource: "gomulu" | "dosya" = "gomulu";
    if (config.GUVEN_CAPASI_DOSYASI) {
      anchor = AnchorFileSchema.parse(JSON.parse(readFileSync(config.GUVEN_CAPASI_DOSYASI, "utf8")));
      anchorSource = "dosya";
      warnings.push("Güven çapası DOSYADAN (hazırlık/test) — gömülü ROOT_PUBLIC_KEYS değil");
    }
    const prepared = prepareTrustAnchor(anchor);
    if (!prepared.ok) warnings.push(`Güven çapası kullanılamıyor (${prepared.code}): ${prepared.message}`);

    const wrapped: WrappedKeyInfo[] = [];
    const dir = config.ANAHTAR_DIZINI;
    for (const file of [...listFiles(dir, ".kok.json"), ...listFiles(dir, ".bayi.json")]) {
      try {
        const k = readWrappedKeyFile(file);
        const kind = k.tur === "tekserp-bayi-anahtar" ? "BAYI" : k.kid.startsWith("hazirlik-") ? "HAZIRLIK_KOK" : "KOK";
        const inAnchor = kind !== "BAYI" && anchor.some((r) => r.kid === k.kid && r.x === k.x);
        if (kind !== "BAYI" && !inAnchor) warnings.push(`Kök ${k.kid} güven çapasında yok — imzada kullanılmaz`);
        wrapped.push({ path: file, kid: k.kid, kind, x: k.x, classes: k.siniflar, inAnchor, certificate: k.sertifika ?? null });
      } catch (err) {
        warnings.push(`Anahtar dosyası okunamadı (${path.basename(file)}): ${(err as Error).message}`);
      }
    }

    const subKeys: LoadedSubKey[] = [];
    for (const file of listFiles(dir, ".anahtar.json")) {
      try {
        const mode = statSync(file).mode & 0o077;
        if (mode !== 0 && process.platform !== "win32") warnings.push(`${path.basename(file)} başkalarına açık (0600 olmalı)`);
        const k = readSubKeyFile(file);
        const meta = USAGE_OF[k.tur];
        const cert = verifyCertificate(k.sertifika, { roots: anchor, usage: meta.usage, atMs: nowMs });
        if (!cert.ok) {
          warnings.push(`${k.kid} sertifikası geçersiz (${cert.code}) — kullanılmaz`);
          continue;
        }
        if (cert.value.document.kid !== k.kid || cert.value.document.x !== k.x) {
          warnings.push(`${k.kid} sertifikası başka bir anahtara ait — kullanılmaz`);
          continue;
        }
        subKeys.push({
          kid: k.kid,
          kind: meta.kind,
          privateKey: subKeyPrivate(k),
          x: k.x,
          certificate: k.sertifika,
          document: cert.value.document,
        });
      } catch (err) {
        warnings.push(`Anahtar dosyası okunamadı (${path.basename(file)}): ${(err as Error).message}`);
      }
    }
    return new KeyStore(anchor, anchorSource, wrapped, subKeys, warnings);
  }

  /** Kirayı imzalayacak ALT anahtar: şimdi geçerli ve sınıfa yetkili olanların en yenisi. */
  leaseKeyFor(cls: LicenseClass, nowMs: number): LoadedSubKey | null {
    return this.newest(this.subKeys.filter((k) => k.kind === "ALT" && k.document.siniflar.includes(cls) && certValidAt(k.document, nowMs)));
  }

  downloadKey(nowMs: number): LoadedSubKey | null {
    return this.newest(this.subKeys.filter((k) => k.kind === "INDIRME" && certValidAt(k.document, nowMs)));
  }

  /** HAK'ı imzalayacak kök dosyası: TEST/DEMO'da varsa hazırlık kökü, yoksa sınıfa yetkili üretim kökü. */
  rootFileFor(cls: LicenseClass): WrappedKeyInfo | null {
    const usable = this.wrapped.filter((w) => w.kind !== "BAYI" && w.inAnchor && w.classes.includes(cls));
    if (STAGING_ROOT_CLASSES.includes(cls)) {
      const staging = usable.find((w) => w.kind === "HAZIRLIK_KOK");
      if (staging) return staging;
    }
    return usable.find((w) => w.kind === "KOK") ?? null;
  }

  publicRecords(): PublicKeyRecord[] {
    const roots: PublicKeyRecord[] = this.wrapped.map((w) => ({
      kid: w.kid,
      kind: w.kind,
      x: w.x,
      classes: w.classes,
      certificate: w.certificate,
      notBefore: null,
      notAfter: null,
    }));
    const subs: PublicKeyRecord[] = this.subKeys.map((k) => ({
      kid: k.kid,
      kind: k.kind,
      x: k.x,
      classes: k.document.siniflar,
      certificate: k.certificate,
      notBefore: new Date(isoToMs(k.document.baslangic)),
      notAfter: new Date(isoToMs(k.document.bitis)),
    }));
    return [...roots, ...subs];
  }

  private newest(list: LoadedSubKey[]): LoadedSubKey | null {
    return [...list].sort((a, b) => isoToMs(b.document.baslangic) - isoToMs(a.document.baslangic))[0] ?? null;
  }
}
