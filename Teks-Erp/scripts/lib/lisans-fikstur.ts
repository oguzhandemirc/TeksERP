// Lisans bekçilerinin ortak fikstürü: anahtarlar ÇALIŞMA ANINDA üretilir, hiçbir yere
// yazılmaz (test anahtarı src'ye ya da diske girmez). `test_` öneki yok → koşucu bunu
// bekçi saymaz. Belgeler protokolün KENDİ imzalayıcısıyla basılır; bozuk belge gerekiyorsa
// `hamImzala` şemayı atlar.
import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import {
  DAY_MS,
  EntitlementSchema,
  LeaseSchema,
  LICENSE_CLASSES,
  CertificateSchema,
  TYP,
  publicKeyX,
  signDocument,
  signJws,
  installationKeyId,
  msToIso,
  digestFingerprint,
  type EntitlementDoc,
  type LeaseDoc,
  type RootKey,
  type Fingerprint,
  type CertificateDoc,
  type CertUsage,
  type LicenseClass,
} from "../../src/lib/license/protocol";

export interface TestAnahtari {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly acik: KeyObject;
  readonly x: string;
}

export function anahtarUret(kid: string): TestAnahtari {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { kid, privateKey, acik: publicKey, x: publicKeyX(publicKey) };
}

export function kurulumAnahtariUret(): TestAnahtari {
  const gecici = anahtarUret("kur-gecici");
  return { ...gecici, kid: installationKeyId(gecici.x) };
}

export const HAM_PARMAK_IZI = {
  f1: "{6F1C2B9A-0D3E-4B57-9A11-3C5E7D9F0B24}",
  f2: "4C4C4544-0051-3010-8052-B7C04F4E3332",
  f3: "S4EVNX0N912345",
  f4: "PF3K7Q2A",
  f5: "7412345678901234567",
};

export interface Fikstur {
  readonly simdi: number;
  readonly kurulumId: string;
  readonly hakId: string;
  readonly musteriId: string;
  readonly tesisId: string;
  readonly kok: TestAnahtari;
  readonly hazirlik: TestAnahtari;
  readonly alt: TestAnahtari;
  readonly ind: TestAnahtari;
  readonly bayi: TestAnahtari;
  readonly kurulum: TestAnahtari;
  readonly tuz: Buffer;
  readonly parmakIzi: Fingerprint;
  /** Üretim kökü (tüm sınıflar) + hazırlık kökü (TEST/DEMO). */
  readonly kokler: RootKey[];
}

export function fiksturKur(simdi: number): Fikstur {
  const tuz = Buffer.alloc(32, 7);
  const kok = anahtarUret("kok-2026-1");
  const hazirlik = anahtarUret("hazirlik-2026-1");
  return {
    simdi,
    kurulumId: randomUUID(),
    hakId: randomUUID(),
    musteriId: randomUUID(),
    tesisId: randomUUID(),
    kok,
    hazirlik,
    alt: anahtarUret("alt-2026-1"),
    ind: anahtarUret("ind-2026"),
    bayi: anahtarUret("bayi-b1"),
    kurulum: kurulumAnahtariUret(),
    tuz,
    parmakIzi: digestFingerprint(HAM_PARMAK_IZI, tuz),
    kokler: [
      { kid: kok.kid, x: kok.x, classes: [...LICENSE_CLASSES] },
      { kid: hazirlik.kid, x: hazirlik.x, classes: ["TEST", "DEMO"] },
    ],
  };
}

/** Şemayı ATLAYAN imza — yalnız bozuk belge sondaları için. */
export function hamImzala(typ: string, imzalayan: TestAnahtari, yuk: Record<string, unknown>): string {
  return signJws({ typ, kid: imzalayan.kid, payload: yuk, privateKey: imzalayan.privateKey });
}

export function sertifikaYuku(
  f: Fikstur,
  konu: TestAnahtari,
  kullanim: CertUsage,
  ek: Partial<CertificateDoc> = {},
): CertificateDoc {
  return {
    v: 1,
    sertifikaId: randomUUID(),
    kullanim,
    kid: konu.kid,
    x: konu.x,
    siniflar: [...LICENSE_CLASSES],
    baslangic: msToIso(f.simdi - 10 * DAY_MS),
    bitis: msToIso(f.simdi + 170 * DAY_MS),
    bayi: null,
    ...ek,
  };
}

export function sertifikaBas(imzalayan: TestAnahtari, yuk: CertificateDoc): string {
  return signDocument({ typ: TYP.SERTIFIKA, schema: CertificateSchema, payload: yuk, key: imzalayan });
}

export function hakYuku(f: Fikstur, ek: Partial<EntitlementDoc> = {}): EntitlementDoc {
  return {
    v: 1,
    hakId: f.hakId,
    surum: 1,
    lisansNo: "TKS-2026-0001",
    musteri: { id: f.musteriId, ad: "Deneme Tekstil" },
    tesis: { id: f.tesisId, ad: "Merkez Tesis" },
    kurulumId: f.kurulumId,
    sinif: "URETIM",
    moduller: ["production.enabled", "finance.enabled", "ticaret.enabled"],
    kalici: true,
    bakimBitis: msToIso(f.simdi + 365 * DAY_MS),
    verilis: msToIso(f.simdi - DAY_MS),
    ...ek,
  };
}

export function hakBas(f: Fikstur, ek: Partial<EntitlementDoc> = {}, imzalayan: TestAnahtari = f.kok): string {
  return signDocument({ typ: TYP.HAK, schema: EntitlementSchema, payload: hakYuku(f, ek), key: imzalayan });
}

export function kiraYuku(f: Fikstur, ek: Partial<LeaseDoc> = {}): LeaseDoc {
  return {
    v: 1,
    kiraId: randomUUID(),
    hakId: f.hakId,
    hakSurum: 1,
    kurulumId: f.kurulumId,
    kurulumAnahtarKimligi: f.kurulum.kid,
    parmakIzi: f.parmakIzi,
    verilis: msToIso(f.simdi - 60 * 60 * 1000),
    bitis: msToIso(f.simdi + 29 * DAY_MS),
    sunucuSaati: msToIso(f.simdi - 60 * 60 * 1000),
    ekSureGun: 30,
    zorlama: true,
    gecerlilikBitis: null,
    yaptirim: { kademe: null, mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false },
    yoklamaAraligiDk: 60,
    esitlemeAraligiDk: null,
    patronBulutBitis: null,
    devredildi: false,
    kanal: { kod: "deneme-kanal", guncelSurumler: { backend: "2.11.2" } },
    altSertifika: sertifikaBas(f.kok, sertifikaYuku(f, f.alt, "ALT")),
    ...ek,
  };
}

export function kiraBas(f: Fikstur, ek: Partial<LeaseDoc> = {}, imzalayan: TestAnahtari = f.alt): string {
  return signDocument({ typ: TYP.KIRA, schema: LeaseSchema, payload: kiraYuku(f, ek), key: imzalayan });
}

export function siniflar(...s: LicenseClass[]): LicenseClass[] {
  return s;
}
