// AÇIK SERTİFİKALAR — satıcının TUTMADIĞI anahtarlar (ISTEMCI · PAKET) anahtar biriminin `istemci/` · `paket/` alt
// dizinlerinde yalnız kök imzalı açık sertifikalarıyla durur; tablet OTA yaprakları `istemci/ota-yaprak-*.pem`. Yalnız künye
// ve süre uyarısı içindir, imzada kullanılmaz; DB'ye yazılmaz.
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isoToMs, parseJws, verifyCertificate, type CertificateDoc, type RootKey } from "../lisans-protokol";
import { certValidAt, listFiles, parseCertificatePayload } from "./key-dir";

/** Satıcının TUTMADIĞI anahtarın kök imzalı açık sertifikası (ISTEMCI · PAKET): künye + süre uyarısı, imza yok. */
export type OpenCertUsage = "ISTEMCI" | "PAKET";
export interface OpenCertificate {
  readonly kid: string;
  readonly usage: OpenCertUsage;
  readonly x: string;
  readonly certificate: string;
  readonly document: CertificateDoc;
  /** Sertifika ŞİMDİ geçerli mi (süresi dolmuş sertifika künyede kalır). */
  readonly valid: boolean;
}

/**
 * Tablet OTA yaprağı (X.509, ISTEMCI ile aynı törende basılır; CN `TeksERP OTA Yaprak <ist-kid>`). OTA kökü satıcıda
 * yoktur — zincir burada DOĞRULANMAZ; yaprak yalnız yüklü bir ISTEMCI sertifikasına adıyla bağlıysa künyeye girer.
 */
export interface OtaLeaf {
  readonly file: string;
  readonly clientKid: string;
  readonly fingerprint: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
}

/** Açık sertifika alt dizinleri: dizin kullanımı belirler, başka kullanımın sertifikası orada yüklenmez. */
export const OPEN_CERT_DIRS: Readonly<Record<string, OpenCertUsage>> = { istemci: "ISTEMCI", paket: "PAKET" };
const OpenCertFileSchema = z.strictObject({ sertifika: z.string().min(1).max(8192) });
const OTA_LEAF_FILE = /^ota-yaprak-[a-z0-9-]{1,40}\.pem$/;
const OTA_LEAF_CN = /^TeksERP OTA Yaprak (ist-[a-z0-9-]{1,40})$/;
const CODE_SIGNING_EKU = "1.3.6.1.5.5.7.3.3";

/** Dosya açık sertifika biçimindeyse (`{sertifika}`) yükündeki kullanım; değilse null (emekli künyesi yolu sürer). */
export function openCertUsageOf(file: string): string | null {
  const parsed = OpenCertFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) return null;
  const jws = parseJws(parsed.data.sertifika);
  const usage = jws.ok ? jws.value.payload.kullanim : undefined;
  return typeof usage === "string" ? usage : "bilinmeyen";
}

/**
 * Açık sertifikalar (`istemci/` · `paket/`): kök imzası çapaya karşı KENDİ başlangıç anında doğrulanır, kullanım dizinle,
 * kid dosya adıyla uyuşmalı; süresi dolmuş sertifika künyede kalır (`valid: false`). Uymayan dosya uyarıyla atlanır.
 */
export function loadOpenCertificates(dir: string, anchor: readonly RootKey[], nowMs: number, warnings: string[]): OpenCertificate[] {
  const out: OpenCertificate[] = [];
  for (const [sub, usage] of Object.entries(OPEN_CERT_DIRS)) {
    for (const file of listFiles(path.join(dir, sub), ".sertifika.json")) {
      const name = `${sub}/${path.basename(file)}`;
      try {
        const parsed = OpenCertFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
        if (!parsed.success) {
          warnings.push(`${name} açık sertifika dosyası değil ({sertifika}) — yok sayıldı`);
          continue;
        }
        const token = parsed.data.sertifika;
        const start = parseCertificatePayload(token);
        const cert = start ? verifyCertificate(token, { roots: anchor, usage, atMs: isoToMs(start.baslangic) }) : null;
        if (!cert?.ok) {
          warnings.push(`${name} ${usage} sertifikası doğrulanamadı (${cert?.code ?? "BELGE_SEMA"}) — yok sayıldı`);
          continue;
        }
        const doc = cert.value.document;
        if (path.basename(file) !== `${doc.kid}.sertifika.json`) {
          warnings.push(`${name} başka bir kid'in (${doc.kid}) sertifikasını taşıyor — yok sayıldı`);
          continue;
        }
        if (out.some((c) => c.kid === doc.kid)) {
          warnings.push(`${name}: ${doc.kid} iki kez — ikincisi yok sayıldı`);
          continue;
        }
        const valid = certValidAt(doc, nowMs);
        if (!valid) warnings.push(`${doc.kid} ${usage} sertifikası şu an geçerli değil (${doc.baslangic.slice(0, 10)} → ${doc.bitis.slice(0, 10)})`);
        out.push({ kid: doc.kid, usage, x: doc.x, certificate: token, document: doc, valid });
      } catch (err) {
        warnings.push(`Açık sertifika okunamadı (${name}): ${(err as Error).message}`);
      }
    }
  }
  return out;
}

/** OTA yaprakları (`istemci/ota-yaprak-*.pem`): CA değil, kod imzası EKU'lu ve CN'i yüklü bir ISTEMCI kid'ini adlandırıyorsa. */
export function loadOtaLeaves(dir: string, clients: readonly OpenCertificate[], warnings: string[]): OtaLeaf[] {
  const out: OtaLeaf[] = [];
  for (const file of listFiles(dir, ".pem")) {
    const name = `istemci/${path.basename(file)}`;
    if (!OTA_LEAF_FILE.test(path.basename(file))) {
      warnings.push(`${name} tanınmayan dosya adı (ota-yaprak-<rol>.pem) — yok sayıldı`);
      continue;
    }
    try {
      const x = new X509Certificate(readFileSync(file));
      const cn = /(?:^|\n)CN=([^\n]+)/.exec(x.subject)?.[1] ?? "";
      const clientKid = OTA_LEAF_CN.exec(cn)?.[1];
      if (x.ca || !(x.keyUsage ?? []).includes(CODE_SIGNING_EKU)) {
        warnings.push(`${name} OTA yaprağı değil (CA ya da kod imzası kullanımı yok) — yok sayıldı`);
        continue;
      }
      if (!clientKid || !clients.some((c) => c.usage === "ISTEMCI" && c.kid === clientKid)) {
        warnings.push(`${name} yüklü bir ISTEMCI sertifikasına bağlanamadı (CN "${cn.slice(0, 80)}") — yok sayıldı`);
        continue;
      }
      out.push({ file: name, clientKid, fingerprint: x.fingerprint256, notBefore: x.validFromDate, notAfter: x.validToDate });
    } catch (err) {
      warnings.push(`OTA yaprağı okunamadı (${name}): ${(err as Error).message}`);
    }
  }
  return out;
}
