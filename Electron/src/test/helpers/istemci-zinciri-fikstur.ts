import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { signReleaseDoc, type ReleaseDoc } from "../../../electron/guncelleme/panel-kunye.mjs";

/**
 * İSTEMCİ ZİNCİRİ FİKSTÜRÜ — kök → ISTEMCI sertifikası (`ist-*`) → künye v:2 · dağıtım iptali. Anahtarlar test
 * anında ÜRETİLİR ve atılır (gerçek anahtar yok). Ham JWS `node:crypto` ile — doğrulayıcının kendi imzalayıcısı
 * sertifika/iptal üretmez, fikstür onu körleştirmesin.
 */
export interface TestAnahtari {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly x: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SINIFLAR = ["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"] as const;

export function anahtarUret(kid: string): TestAnahtari {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { kid, privateKey, x: publicKey.export({ format: "jwk" }).x as string };
}

const b64u = (s: string | Buffer): string => Buffer.from(s).toString("base64url");

/** Ham compact JWS (protokol `signJws` biçimi: `{alg, typ, kid}` başlığı). */
export function hamJws(typ: string, imzalayan: TestAnahtari, yuk: Record<string, unknown>): string {
  const signingInput = `${b64u(JSON.stringify({ alg: "EdDSA", typ, kid: imzalayan.kid }))}.${b64u(JSON.stringify(yuk))}`;
  return `${signingInput}.${b64u(sign(null, Buffer.from(signingInput, "ascii"), imzalayan.privateKey))}`;
}

export const iso = (ms: number): string => new Date(ms).toISOString();

export interface Zincir {
  readonly kok: TestAnahtari;
  readonly ist: TestAnahtari;
  readonly roots: ReadonlyArray<{ kid: string; x: string; classes: string[] }>;
  /** `ist`in ISTEMCI sertifikası: şimdi − 30 gün … şimdi + 365 gün. */
  readonly sertifika: string;
  readonly sertifikaId: string;
  readonly simdi: number;
  sertifikaBas(konu: TestAnahtari, ek?: Record<string, unknown>, imzalayan?: TestAnahtari): { token: string; sertifikaId: string };
  iptalBas(satirlar: ReadonlyArray<{ kid: string; sertifikaId: string }>, sira: number, imzalayan?: TestAnahtari): string;
  /** v:2 künye: varsayılan `ist` + `sertifika`, imza anı şimdi − 1 gün. */
  imzala(doc: ReleaseDoc, g?: { anahtar?: TestAnahtari; sertifika?: string; imzaAni?: string }): string;
}

export function zincirKur(g: { kokKid?: string; istKid?: string; simdi?: number } = {}): Zincir {
  const simdi = g.simdi ?? Date.now();
  const kok = anahtarUret(g.kokKid ?? "kok-fikstur-1");
  const ist = anahtarUret(g.istKid ?? "ist-fikstur-1");
  const sertifikaBas = (konu: TestAnahtari, ek: Record<string, unknown> = {}, imzalayan: TestAnahtari = kok) => {
    const sertifikaId = randomUUID();
    const token = hamJws("tekserp-sertifika", imzalayan, {
      v: 1,
      sertifikaId,
      kullanim: "ISTEMCI",
      kid: konu.kid,
      x: konu.x,
      siniflar: ["URETIM"],
      baslangic: iso(simdi - 30 * DAY_MS),
      bitis: iso(simdi + 365 * DAY_MS),
      bayi: null,
      ...ek,
    });
    return { token, sertifikaId };
  };
  const ilk = sertifikaBas(ist);
  return {
    kok,
    ist,
    roots: [{ kid: kok.kid, x: kok.x, classes: [...SINIFLAR] }],
    sertifika: ilk.token,
    sertifikaId: ilk.sertifikaId,
    simdi,
    sertifikaBas,
    iptalBas: (satirlar, sira, imzalayan = kok) =>
      hamJws("tekserp-paketiptal", imzalayan, {
        v: 1,
        iptalId: randomUUID(),
        sira,
        verilis: iso(simdi - DAY_MS),
        iptaller: satirlar.map((s) => ({ ...s, tarih: iso(simdi - DAY_MS), neden: "test" })),
      }),
    imzala: (doc, o = {}) => {
      const a = o.anahtar ?? ist;
      return signReleaseDoc({ doc, kid: a.kid, privateKey: a.privateKey, certificate: o.sertifika ?? ilk.token, signedAt: o.imzaAni ?? iso(simdi - DAY_MS) });
    },
  };
}
