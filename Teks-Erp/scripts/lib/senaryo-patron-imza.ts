// SENARYO P — koşucunun kendi imzalı fabrika kanalı istekleri (bulut `/v1/*`): fabrikanın KENDİ kurulum
// anahtarıyla (kendi geçici LICENSE_DIR'imiz) ya da ayrı bir test anahtarıyla. Protokolün `signRequest`i
// kullanılır — fabrika ile aynı imza yolu. Kullanım: sözleşme sürümü (N−1/N+1), sınıf kapısı, zincir kopması.
// `test_` öneki yok → bekçi değil.
import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import path from "node:path";
import { REQUEST_HEADER, publicKeyX, signRequest } from "../../src/lib/license/protocol";
import { loadLicenseStoreSync } from "../../src/lib/license/store";
import { ENVELOPE_VERSION, SYNC_CONTRACT_VERSION, SYNC_PATHS } from "../../src/cloud-sync/wire";
import type { Duzenek } from "./senaryo-patron-duzenek";

export interface KanalYaniti {
  readonly status: number;
  readonly kod: string | undefined;
  readonly veri: Record<string, unknown>;
}

/** Fabrika sürecinin kurulum anahtarı (geçici LICENSE_DIR'den; koşucunun kendi dizini). */
export function fabrikaAnahtari(d: Duzenek): KeyObject {
  const store = loadLicenseStoreSync({ dir: path.join(d.kok, "lisans") });
  if (!store.key) throw new Error("fabrika kurulum anahtarı okunamadı");
  return store.key.privateKey;
}

/** Ayrı bir kurulum (örn. TEST sınıfı ikinci makine) için Ed25519 anahtar + açık x. */
export function yeniKurulumAnahtari(): { privateKey: KeyObject; x: string } {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, x: publicKeyX(privateKey) };
}

export async function kanalPost(d: Duzenek, yol: string, govde: unknown, g: { kurulumId: string; privateKey: KeyObject }): Promise<KanalYaniti> {
  const raw = Buffer.from(JSON.stringify(govde), "utf8");
  const token = signRequest({ installationId: g.kurulumId, purpose: "esitle", body: raw, key: { privateKey: g.privateKey, nowMs: Date.now() } });
  const r = await fetch(`${d.patron.url}${yol}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", [REQUEST_HEADER]: token },
    body: raw,
  });
  let j: Record<string, unknown> = {};
  try {
    j = (await r.json()) as Record<string, unknown>;
  } catch {
    j = {};
  }
  const details = (j.details ?? {}) as { code?: unknown };
  const veri = (j.data && typeof j.data === "object" ? j.data : {}) as Record<string, unknown>;
  return { status: r.status, kod: typeof details.code === "string" ? details.code : undefined, veri };
}

/** Boş (kayıtsız) ARTIMLI paket — yalnız zarf ve kapı ölçümü için; ufuk şimdi. */
export function bosPaket(kurulumId: string, sozlesme = SYNC_CONTRACT_VERSION): Record<string, unknown> {
  return {
    v: ENVELOPE_VERSION,
    sozlesme,
    paketId: randomUUID(),
    kurulumId,
    tur: "ARTIMLI",
    ufuk: new Date().toISOString(),
    uretimBilgisi: { uygulamaSurum: "2.11.2", katalogSurum: 1 },
    kayitlar: [],
    anliklar: [],
    uzlastirma: [],
  };
}

export const ESITLE_YOLU = SYNC_PATHS.SYNC;
