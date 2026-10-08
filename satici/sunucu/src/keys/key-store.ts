// Anahtar deposu: anahtar dizinindeki dosyaları okur, güven çapasına karşı doğrular.
//   *.kok.json     — KÖK (`kok-*` ailesi; parolalı; burada yalnız AÇIK yarısı okunur)
//   *.bayi.json    — BAYİ (bayinin parolasıyla sarılı; yalnız açık yarı + sertifika)
//   *.anahtar.json — ALT (kira) / İNDİRME (parolasız 0600 + kök imzalı sertifika)
//   *.ara.json     — HAK ARA İMZACISI (G4; parolalı + kök imzalı `HAK` sertifikası; 395 gün, yıllık dönem töreninde yenilenir)
//   *.sertifika.json — EMEKLİ anahtar: özel yarısı silinmiş ALT · İNDİRME · ARA'nın açık yarısı + sertifikası (yalnız künye)
//   istemci/ · paket/ — satıcının TUTMADIĞI anahtarların AÇIK sertifikaları (`{sertifika}`; ISTEMCI · PAKET) + istemci/
//     altında tablet OTA yaprakları (`ota-yaprak-*.pem`): yalnız künye ve süre uyarısı, imzada kullanılmaz
// Çapa: gömülü üretim kökleri (GUVEN_CAPASI=uretim; fabrika derlemesinin güvendiği küme — ayna); yalnız bekçiler için
// GUVEN_CAPASI_DOSYASI.
// Çapada olmayan kökle imza yapılmaz (fabrika reddederdi); kip yok ya da çapa geçersizse yükleme DURUR (fail-closed).
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { KeyObject } from "node:crypto";
import { z } from "zod";
import {
  LICENSE_CLASSES,
  isoToMs,
  prepareTrustAnchor,
  rootPublicKeysFor,
  verifyCertificate,
  type CertificateDoc,
  type CertUsage,
  type LicenseClass,
  type RootKey,
  type TrustAnchorMode,
} from "../lisans-protokol";
import type { VendorConfig } from "../config";
import { certValidAt, listFiles, parseCertificatePayload } from "./key-dir";
import { readRetiredKeyFile, readSubKeyFile, readWrappedKeyFile, subKeyPrivate, type RetiredKeyFile } from "./key-files";
import { loadOpenCertificates, loadOtaLeaves, openCertUsageOf, type OpenCertificate, type OtaLeaf } from "./open-certificates";

// Prisma `AnahtarTuru`nun CANLI değerleri; şemada `/// EMEKLİ DEĞER` işaretli değer yazılmaz (TEK-ORTAK-PAKET §7).
export type VendorKeyKind = "KOK" | "ALT" | "INDIRME" | "BAYI" | "ARA";

export interface WrappedKeyInfo {
  readonly path: string;
  readonly kid: string;
  readonly kind: "KOK" | "BAYI";
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

/** HAK ara imzacısı (parolalı dosya + kök imzalı `HAK` sertifikası). `usable`: sertifika ŞİMDİ geçerli. */
export interface LoadedIntermediate {
  readonly path: string;
  readonly kid: string;
  readonly x: string;
  readonly certificate: string;
  readonly document: CertificateDoc;
  readonly usable: boolean;
}

/** Emekli anahtar: yalnız açık yarı + sertifika (özel yarı törende silindi) — künyede EMEKLI görünür. */
export interface RetiredKey {
  readonly kid: string;
  readonly kind: "ALT" | "INDIRME" | "ARA";
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
  /** Özel yarısı silinmiş (emekli) anahtar. */
  readonly retired?: true;
}

const AnchorFileSchema = z
  .array(z.strictObject({ kid: z.string(), x: z.string(), classes: z.array(z.enum(LICENSE_CLASSES)).min(1) }))
  .min(1);

const USAGE_OF: Record<"tekserp-alt-anahtar" | "tekserp-indirme-anahtar", { usage: CertUsage; kind: "ALT" | "INDIRME" }> = {
  "tekserp-alt-anahtar": { usage: "ALT", kind: "ALT" },
  "tekserp-indirme-anahtar": { usage: "INDIRME", kind: "INDIRME" },
};

const RETIRED_USAGE_OF: Record<RetiredKeyFile["kaynakTur"], { usage: CertUsage; kind: RetiredKey["kind"] }> = {
  "tekserp-alt-anahtar": { usage: "ALT", kind: "ALT" },
  "tekserp-indirme-anahtar": { usage: "INDIRME", kind: "INDIRME" },
  "tekserp-ara-anahtar": { usage: "HAK", kind: "ARA" },
};

/** Dosya uzantısı → beklenen sarılı tür: yanlış uzantıyla konmuş dosya (ör. ara anahtarı `.kok.json`) yüklenmez. */
const WRAPPED_SUFFIX_TYPE = { ".kok.json": "tekserp-kok-anahtar", ".bayi.json": "tekserp-bayi-anahtar" } as const;

/** Kök dosyası yalnız `kok-*` ailesindendir (protokolün kök kid kalıbı); başka aile künyeye de girmez. */
const ROOT_FILE_KID = /^kok-[a-z0-9-]{1,40}$/;

const sameClasses = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Anahtar dizinindeki kökler yalnız `kok-*` ailesindense uretim; başka aile (eski `hazirlik-*`) ya da kök yoksa null.
 * Yalnız ortamı olmayan CLI kolaylığıdır (yerel anahtar dizini); sunucu kipi yapılandırmadan alır.
 */
export function anchorModeOfKeyDir(dir: string): TrustAnchorMode | null {
  const kids = listFiles(dir, ".kok.json").map((f) => path.basename(f, ".kok.json"));
  return kids.length > 0 && kids.every((k) => k.startsWith("kok-")) ? "uretim" : null;
}

/** Çapa ve kaynağı: dosya çapası yalnız üretim DIŞINDA; gömülü çapa ortamın kipinden; kip yoksa RED. */
function resolveAnchor(config: Pick<VendorConfig, "GUVEN_CAPASI" | "GUVEN_CAPASI_DOSYASI">): { anchor: readonly RootKey[]; anchorSource: "gomulu" | "dosya" } {
  if (config.GUVEN_CAPASI_DOSYASI) {
    if (config.GUVEN_CAPASI === "uretim") throw new Error("Üretim satıcısı (GUVEN_CAPASI=uretim) dosyadan güven çapası kabul etmez");
    return { anchor: AnchorFileSchema.parse(JSON.parse(readFileSync(config.GUVEN_CAPASI_DOSYASI, "utf8"))), anchorSource: "dosya" };
  }
  if (!config.GUVEN_CAPASI) throw new Error("Güven çapası kipi yok: GUVEN_CAPASI=uretim (compose ORTAM'dan) ya da yalnız test için GUVEN_CAPASI_DOSYASI");
  return { anchor: rootPublicKeysFor(config.GUVEN_CAPASI), anchorSource: "gomulu" };
}

export class KeyStore {
  private constructor(
    readonly anchor: readonly RootKey[],
    readonly anchorSource: "gomulu" | "dosya",
    readonly wrapped: readonly WrappedKeyInfo[],
    readonly subKeys: readonly LoadedSubKey[],
    readonly warnings: readonly string[],
    readonly intermediates: readonly LoadedIntermediate[] = [],
    readonly retired: readonly RetiredKey[] = [],
    readonly openCertificates: readonly OpenCertificate[] = [],
    readonly otaLeaves: readonly OtaLeaf[] = [],
  ) {}

  static load(config: Pick<VendorConfig, "ANAHTAR_DIZINI" | "GUVEN_CAPASI" | "GUVEN_CAPASI_DOSYASI">, nowMs: number = Date.now()): KeyStore {
    const warnings: string[] = [];
    const { anchor, anchorSource } = resolveAnchor(config);
    if (anchorSource === "dosya") warnings.push("Güven çapası DOSYADAN (yalnız bekçi) — gömülü çapa değil");
    const prepared = prepareTrustAnchor(anchor);
    if (!prepared.ok) throw new Error(`Güven çapası kullanılamıyor (${prepared.code}): ${prepared.message}`);

    const wrapped: WrappedKeyInfo[] = [];
    const dir = config.ANAHTAR_DIZINI;
    const wrappedFiles = Object.entries(WRAPPED_SUFFIX_TYPE).flatMap(([suffix, expected]) => listFiles(dir, suffix).map((file) => ({ file, expected })));
    for (const { file, expected } of wrappedFiles) {
      try {
        const k = readWrappedKeyFile(file);
        if (k.tur !== expected) {
          warnings.push(`${path.basename(file)} türü (${k.tur}) uzantısıyla uyuşmuyor — kullanılmaz`);
          continue;
        }
        const kind = k.tur === "tekserp-bayi-anahtar" ? "BAYI" : "KOK";
        if (kind === "KOK" && !ROOT_FILE_KID.test(k.kid)) {
          warnings.push(`${path.basename(file)} kök ailesinde değil (kok-*) — yüklenmez`);
          continue;
        }
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
    const intermediates = loadIntermediates(dir, anchor, nowMs, warnings);
    const retired = loadRetired(dir, anchor, warnings);
    const openCertificates = loadOpenCertificates(dir, anchor, nowMs, warnings);
    const otaLeaves = loadOtaLeaves(path.join(dir, "istemci"), openCertificates, warnings);
    return new KeyStore(anchor, anchorSource, wrapped, subKeys, warnings, intermediates, retired, openCertificates, otaLeaves);
  }

  /** HAK'ı imzalayacak ARA imzacı: sertifikası ŞİMDİ geçerli ve sınıfa yetkili olanların en yenisi (G4). */
  intermediateFor(cls: LicenseClass, nowMs: number): LoadedIntermediate | null {
    const list = this.intermediates.filter((k) => k.usable && k.document.siniflar.includes(cls) && certValidAt(k.document, nowMs));
    return [...list].sort((a, b) => isoToMs(b.document.baslangic) - isoToMs(a.document.baslangic))[0] ?? null;
  }

  /** Kirayı imzalayacak ALT anahtar: şimdi geçerli ve sınıfa yetkili olanların en yenisi. */
  leaseKeyFor(cls: LicenseClass, nowMs: number): LoadedSubKey | null {
    return this.newest(this.subKeys.filter((k) => k.kind === "ALT" && k.document.siniflar.includes(cls) && certValidAt(k.document, nowMs)));
  }

  downloadKey(nowMs: number): LoadedSubKey | null {
    return this.newest(this.subKeys.filter((k) => k.kind === "INDIRME" && certValidAt(k.document, nowMs)));
  }

  /** HAK'ı imzalayacak kök dosyası: çapadaki, sınıfa yetkili üretim kökü. */
  rootFileFor(cls: LicenseClass): WrappedKeyInfo | null {
    const usable = this.wrapped.filter((w) => w.kind !== "BAYI" && w.inAnchor && w.classes.includes(cls));
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
    const intermediates: PublicKeyRecord[] = this.intermediates.map((k) => ({
      kid: k.kid,
      kind: "ARA",
      x: k.x,
      classes: k.document.siniflar,
      certificate: k.certificate,
      notBefore: new Date(isoToMs(k.document.baslangic)),
      notAfter: new Date(isoToMs(k.document.bitis)),
    }));
    const live = new Set([...roots, ...subs, ...intermediates].map((r) => r.kid));
    const retired: PublicKeyRecord[] = this.retired
      .filter((k) => !live.has(k.kid))
      .map((k) => ({
        kid: k.kid,
        kind: k.kind,
        x: k.x,
        classes: k.document.siniflar,
        certificate: k.certificate,
        notBefore: new Date(isoToMs(k.document.baslangic)),
        notAfter: new Date(isoToMs(k.document.bitis)),
        retired: true,
      }));
    return [...roots, ...subs, ...intermediates, ...retired];
  }

  private newest(list: LoadedSubKey[]): LoadedSubKey | null {
    return [...list].sort((a, b) => isoToMs(b.document.baslangic) - isoToMs(a.document.baslangic))[0] ?? null;
  }
}

/**
 * Ara imzacılar: sarılı dosya (`tekserp-ara-anahtar`) + gömülü kök imzalı `HAK` sertifikası. Sertifika çapaya karşı
 * KENDİ başlangıç anında doğrulanır (imza · kök · sınıf), sonra bugüne göre "kullanılabilir" işaretlenir: süresi
 * dolmuş ara imzacı künyede görünür ama imzalamaz. Sertifika başka anahtara ya da başka sınıf kümesine aitse yüklenmez.
 */
function loadIntermediates(dir: string, anchor: readonly RootKey[], nowMs: number, warnings: string[]): LoadedIntermediate[] {
  const out: LoadedIntermediate[] = [];
  for (const file of listFiles(dir, ".ara.json")) {
    try {
      const k = readWrappedKeyFile(file);
      if (k.tur !== "tekserp-ara-anahtar" || !k.sertifika) {
        warnings.push(`${path.basename(file)} ara imzacı dosyası değil ya da sertifikasız — kullanılmaz`);
        continue;
      }
      const parsed = parseCertificatePayload(k.sertifika);
      const cert = parsed ? verifyCertificate(k.sertifika, { roots: anchor, usage: "HAK", atMs: isoToMs(parsed.baslangic) }) : null;
      if (!cert?.ok) {
        warnings.push(`${k.kid} ara imzacı sertifikası geçersiz (${cert?.code ?? "BELGE_SEMA"}) — kullanılmaz`);
        continue;
      }
      const doc = cert.value.document;
      if (doc.kid !== k.kid || doc.x !== k.x || !sameClasses(doc.siniflar, k.siniflar)) {
        warnings.push(`${k.kid} sertifikası başka bir anahtara ya da sınıf kümesine ait — kullanılmaz`);
        continue;
      }
      const usable = certValidAt(doc, nowMs);
      if (!usable) warnings.push(`${k.kid} ara imzacı sertifikası şu an geçerli değil (${doc.baslangic.slice(0, 10)} → ${doc.bitis.slice(0, 10)}) — imzalamaz`);
      out.push({ path: file, kid: k.kid, x: k.x, certificate: k.sertifika, document: doc, usable });
    } catch (err) {
      warnings.push(`Anahtar dosyası okunamadı (${path.basename(file)}): ${(err as Error).message}`);
    }
  }
  return out;
}

/** Emekli künyeler: sertifika yine çapaya karşı doğrulanır (künyeye sahte satır giremesin). */
function loadRetired(dir: string, anchor: readonly RootKey[], warnings: string[]): RetiredKey[] {
  const out: RetiredKey[] = [];
  for (const file of listFiles(dir, ".sertifika.json")) {
    try {
      const open = openCertUsageOf(file);
      if (open) {
        warnings.push(`${path.basename(file)} açık ${open} sertifikası, emekli künyesi değil — anahtar biriminin ${open === "PAKET" ? "paket" : "istemci"}/ alt dizinine konur`);
        continue;
      }
      const k = readRetiredKeyFile(file);
      const meta = RETIRED_USAGE_OF[k.kaynakTur];
      const parsed = parseCertificatePayload(k.sertifika);
      const cert = parsed ? verifyCertificate(k.sertifika, { roots: anchor, usage: meta.usage, atMs: isoToMs(parsed.baslangic) }) : null;
      if (!cert?.ok || cert.value.document.kid !== k.kid || cert.value.document.x !== k.x) {
        warnings.push(`${path.basename(file)} emekli künyesi doğrulanamadı — yok sayıldı`);
        continue;
      }
      out.push({ kid: k.kid, kind: meta.kind, x: k.x, certificate: k.sertifika, document: cert.value.document });
    } catch (err) {
      warnings.push(`Emekli künyesi okunamadı (${path.basename(file)}): ${(err as Error).message}`);
    }
  }
  return out;
}
