// Patron bulutu bekçilerinin ortak fikstürü: (1) eşitleme HAKLI bir lisans (URETIM +
// `patron-bulut` + kirada aralık/abonelik) — anahtarlar çalışma anında üretilir, depo geçici
// dizinde; (2) SAHTE BULUT — yerel HTTP (döngü adresine düz HTTP meşru), imzalı isteği
// protokolün KENDİ doğrulayıcısıyla denetler, gövdeyi KATI sözleşme şemasından geçirir ve
// sözleşmenin bulut yarısını (§6.3–6.4 zincir · sürüm anı · TAM işaretle-süpür · §4.4
// uzlaştırma) referans olarak uygular. `test_` öneki yok → koşucu bunu bekçi saymaz.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, createPublicKey, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { ensureInstallationIdentity } from "../../src/jobs/installation-identity.job";
import { loadLicenseStoreSync, saveEntitlement, saveLease, saveLicenseIdentity } from "../../src/lib/license/store";
import {
  configureLicenseRuntimeForTests,
  getLicenseSnapshot,
  invalidateLicenseSnapshot,
  setMeasuredFingerprint,
} from "../../src/lib/license/runtime";
import { startAccumulationForLease } from "../../src/lib/license/record-writer";
import { refreshLicenseDbFacts } from "../../src/services/license-sync.service";
import {
  DAY_MS,
  LeaseSchema,
  REQUEST_HEADER,
  TYP,
  msToIso,
  readRequestIdentity,
  signDocument,
  verifyRequest,
  type EntitlementDoc,
  type Fingerprint,
  type LeaseDoc,
} from "../../src/lib/license/protocol";
import { setCloudUrlForTests } from "../../src/cloud-sync/cloud-url";
import { PackageSchema, RECONCILE_PARENTS, ReportResultRequestSchema, type ReportResult, type SyncPackage } from "../../src/cloud-sync/wire";
import { PATRON_CLOUD_ENTITLEMENT } from "../../src/cloud-sync/eligibility";
import { fiksturKur, hakBas, kiraYuku, type Fikstur } from "./lisans-fikstur";

export interface BulutLisans {
  readonly f: Fikstur;
  readonly dizin: string;
  /** LİSANS kimliği (D14, `LICENSE_DIR`) — imzalı istekler bununla; DB kimliğinden bilerek FARKLI. */
  readonly installationId: string;
  /** DB `system.installationId`si — yalnız bilgi; imzada görünmemeli (V1 sondası). */
  readonly dbInstallationId: string;
  /** Depo açık anahtarı (sahte bulut imzayı bununla doğrular). */
  readonly x: string;
  /** HAK + KİRA yazar (varsayılan: URETIM, `patron-bulut`, aralık 5 dk, abonelik +30 gün, gözlem). */
  lisansiYaz(hak?: Partial<EntitlementDoc>, kira?: Partial<LeaseDoc>): void;
}

export async function bulutLisansKur(): Promise<BulutLisans> {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), "bulut-lisans-"));
  const store = loadLicenseStoreSync({ dir: dizin });
  if (!store.key) throw new Error("bulut fikstürü: depo anahtarı yok");
  const kimlik = await ensureInstallationIdentity();
  const f0 = fiksturKur(Date.now());
  const key = store.key;
  const lisansId = randomUUID();
  saveLicenseIdentity(lisansId);
  const f: Fikstur = { ...f0, kurulumId: lisansId, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: null });
  await refreshLicenseDbFacts(kimlik.installationId);
  const tum = { f1: true, f2: true, f3: true, f4: true, f5: true };
  setMeasuredFingerprint({ digest: f.parmakIzi as Fingerprint, measured: tum, measuredAt: new Date().toISOString() });
  const lisansiYaz = (hak: Partial<EntitlementDoc> = {}, kira: Partial<LeaseDoc> = {}): void => {
    saveEntitlement(hakBas(f, { moduller: ["production.enabled", "finance.enabled", PATRON_CLOUD_ENTITLEMENT], ...hak }));
    const doc = kiraYuku(f, {
      zorlama: false,
      esitlemeAraligiDk: 5,
      patronBulutBitis: msToIso(Date.now() + 30 * DAY_MS),
      ...kira,
    });
    saveLease(signDocument({ typ: TYP.KIRA, schema: LeaseSchema, payload: doc, key: f.alt }));
    invalidateLicenseSnapshot();
    const hakDogru = getLicenseSnapshot().entitlement;
    if (!hakDogru) throw new Error("bulut fikstürü: HAK doğrulanmadı");
    startAccumulationForLease({ lease: doc, entitlement: hakDogru, licenseId: lisansId });
    invalidateLicenseSnapshot();
  };
  lisansiYaz();
  return { f, dizin, installationId: lisansId, dbInstallationId: kimlik.installationId, x: key.x, lisansiYaz };
}

// ── Sahte bulut ───────────────────────────────────────────────────────────────
export interface BulutSatiri {
  veri: Record<string, unknown>;
  surum: string;
  silindi: string | null;
}

export interface SahteBulut {
  readonly url: string;
  readonly paketler: SyncPackage[];
  readonly raporSonuclari: ReportResult[];
  /** Her istek: yol, imza geçerli mi, gzip mi, (varsa) paket kimliği. */
  readonly istekler: Array<{ yol: string; imza: boolean; gzip: boolean; paketId: string | null; durum: number }>;
  /** Projeksiyon → onaylı zincir `{t,k}`. */
  readonly zincir: Map<string, { t: string; k: string }>;
  /** Projeksiyon → satır kimliği → saklanan satır. */
  readonly satirlar: Map<string, Map<string, BulutSatiri>>;
  /** Davranış anahtarları (her bekçi kendi senaryosunu kurar). */
  readonly mod: {
    ret: Set<string>;
    istenenTam: Set<string>;
    /** >0: sıradaki N `/v1/esitle` isteği 500 döner (ağ tekrarı sondası). */
    hata500: number;
    bekleyenRaporlar: Array<{ istekId: string; raporAnahtari: string; parametreler: Record<string, unknown> }>;
    ufukTarihi: Record<string, string | null>;
    /** Bulutun saati − gerçek saat (ms): imza damgası bu saate göre ±10 dk dışındaysa `ISTEK_ZAMAN` (D4). */
    saatFarkiMs: number;
    /** `sunucuSaati`nde BİLDİRİLEN fark (null = gerçek fark); yanlış bildirim düzeltmeyi boşa çıkarır. */
    bildirilenSaatFarkiMs: number | null;
  };
  kapat(): Promise<void>;
}

function govdeOku(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const parcalar: Buffer[] = [];
    req.on("data", (c: Buffer) => parcalar.push(c));
    req.on("end", () => resolve(Buffer.concat(parcalar)));
  });
}

function yanit(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function hata(res: http.ServerResponse, status: number, code: string, ek: Record<string, unknown> = {}): void {
  yanit(res, status, { success: false, message: "sahte bulut reddetti", details: { ...ek, code } });
}

/** `{t,k}` karşılaştırması — bulut ikisini metin olarak sıralar (§6.4). */
export function zincirKarsilastir(a: { t: string; k: string }, b: { t: string; k: string }): number {
  return a.t < b.t ? -1 : a.t > b.t ? 1 : a.k < b.k ? -1 : a.k > b.k ? 1 : 0;
}

/** Bulut tarafı küme özeti — fabrikanınkiyle aynı biçim: uuid sırası, virgül, md5. */
export function kumeOzeti(ids: string[]): string {
  return createHash("md5").update([...ids].sort().join(",")).digest("hex");
}

export async function sahteBulutBaslat(x: string): Promise<SahteBulut> {
  const paketler: SyncPackage[] = [];
  const raporSonuclari: ReportResult[] = [];
  const istekler: SahteBulut["istekler"] = [];
  const zincir = new Map<string, { t: string; k: string }>();
  const satirlar = new Map<string, Map<string, BulutSatiri>>();
  const tamTarama = new Map<string, string>();
  const gorulenPaket = new Map<string, unknown>();
  const mod: SahteBulut["mod"] = { ret: new Set(), istenenTam: new Set(), hata500: 0, bekleyenRaporlar: [], ufukTarihi: {}, saatFarkiMs: 0, bildirilenSaatFarkiMs: null };

  /**
   * null = imza geçerli; aksi hâlde protokol kodu (bulut `ISTEK_*` kodunu olduğu gibi geçirir). `yol`: isteği alan uç —
   * gerçek bulut gibi verilir (`authenticateFactory` `SYNC_PATHS` sabiti), imzalı `yol` başka uca aitse ISTEK_YOL.
   */
  const dogrula = (req: http.IncomingMessage, govde: Buffer, yol: string): string | null => {
    const token = req.headers[REQUEST_HEADER.toLowerCase()];
    const kimlik = readRequestIdentity(token);
    if (!kimlik.ok) return kimlik.code;
    const v = verifyRequest(token, { publicKeyX: x, body: govde, nowMs: Date.now() + mod.saatFarkiMs, purposes: ["esitle"], installationId: kimlik.value.installationId, path: yol });
    return v.ok ? null : v.code;
  };

  const esitle = (paket: SyncPackage): unknown => {
    const kabul: Array<{ projeksiyon: string; filigran: { t: string; k: string } }> = [];
    const ret: Array<{ projeksiyon: string; kod: string }> = [];
    const istenen: Array<{ projeksiyon: string; tur: string; neden: string }> = [];
    for (const k of paket.kayitlar) {
      if (mod.ret.has(k.projeksiyon)) {
        ret.push({ projeksiyon: k.projeksiyon, kod: "KATALOG_SURUMU" });
        continue;
      }
      const sakli = zincir.get(k.projeksiyon);
      const onceki = k.filigran.onceki;
      const kopuk = onceki !== null && (!sakli || zincirKarsilastir(onceki, sakli) > 0);
      if (kopuk) {
        istenen.push({ projeksiyon: k.projeksiyon, tur: "TAM", neden: "FILIGRAN_KOPUK" });
        continue;
      }
      const tablo = satirlar.get(k.projeksiyon) ?? new Map<string, BulutSatiri>();
      satirlar.set(k.projeksiyon, tablo);
      if (k.tam?.parca === 1) tamTarama.set(k.projeksiyon, k.tam.baslangic);
      for (const r of k.yaz) {
        const id = String(r.id);
        const eski = tablo.get(id);
        if (eski && eski.surum > paket.ufuk) continue; // eski paket yeni veriyi ezemez
        tablo.set(id, { veri: r, surum: paket.ufuk, silindi: null });
      }
      for (const s of k.sil) {
        const eski = tablo.get(s.id);
        if (eski) eski.silindi = paket.ufuk;
      }
      if (k.tam && k.tam.parca === k.tam.toplamParca) {
        const bas = tamTarama.get(k.projeksiyon) ?? k.tam.baslangic;
        for (const [id, sat] of tablo) if (sat.surum < bas) tablo.delete(id);
        tamTarama.delete(k.projeksiyon);
      }
      if (!sakli || zincirKarsilastir(k.filigran.yeni, sakli) > 0) zincir.set(k.projeksiyon, k.filigran.yeni);
      kabul.push({ projeksiyon: k.projeksiyon, filigran: k.filigran.yeni });
    }
    // Sözleşmenin uzlaştırma kuralı (saklama hariç): canlı ∧ (kalemse) üst belge canlı − bekleyen.
    for (const u of paket.uzlastirma) {
      const bekleyen = new Set(u.bekleyen);
      const bag = RECONCILE_PARENTS[u.projeksiyon];
      const ust = bag ? (satirlar.get(bag.parent) ?? new Map<string, BulutSatiri>()) : null;
      const ustCanli = (s: BulutSatiri): boolean => {
        const u = ust && bag ? ust.get(String(s.veri[bag.field])) : null;
        return !ust || (!!u && !u.silindi);
      };
      const canli = [...(satirlar.get(u.projeksiyon) ?? new Map<string, BulutSatiri>())].filter(([id, s]) => !s.silindi && !bekleyen.has(id) && ustCanli(s)).map(([id]) => id);
      if (canli.length !== u.adet || kumeOzeti(canli) !== u.ozet) istenen.push({ projeksiyon: u.projeksiyon, tur: "TAM", neden: "UZLASTIRMA_UYUSMAZ" });
    }
    for (const p of mod.istenenTam) istenen.push({ projeksiyon: p, tur: "TAM", neden: "TEST" });
    mod.istenenTam.clear();
    return { v: 1, paketId: paket.paketId, kabul, ret, istenen, ufukTarihi: mod.ufukTarihi, sozlesmeUyarisi: null };
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const govde = await govdeOku(req);
      const yol = req.url ?? "";
      const gzip = req.headers["content-encoding"] === "gzip";
      const red = dogrula(req, govde, yol.split("?")[0]);
      const imza = red === null;
      const kaydet = (durum: number, paketId: string | null = null): void => {
        istekler.push({ yol, imza, gzip, paketId, durum });
      };
      if (!imza) {
        kaydet(401);
        const fark = mod.bildirilenSaatFarkiMs ?? mod.saatFarkiMs;
        return red === "ISTEK_ZAMAN" ? hata(res, 401, red, { sunucuSaati: new Date(Date.now() + fark).toISOString() }) : hata(res, 401, "ISTEK_GECERSIZ");
      }
      let json: unknown;
      try {
        json = JSON.parse((gzip ? gunzipSync(govde) : govde).toString("utf8"));
      } catch {
        kaydet(400);
        return hata(res, 400, "GOVDE_GECERSIZ");
      }
      if (yol === "/v1/esitle") {
        const p = PackageSchema.safeParse(json);
        if (!p.success) {
          kaydet(400);
          return hata(res, 400, "GOVDE_GECERSIZ");
        }
        if (mod.hata500 > 0) {
          mod.hata500--;
          kaydet(500, p.data.paketId);
          return hata(res, 500, "SUNUCU_HATASI");
        }
        kaydet(200, p.data.paketId);
        const onceki = gorulenPaket.get(p.data.paketId);
        if (onceki) return yanit(res, 200, onceki);
        paketler.push(p.data);
        const cevap = esitle(p.data);
        gorulenPaket.set(p.data.paketId, cevap);
        return yanit(res, 200, cevap);
      }
      if (yol === "/v1/rapor/al") {
        kaydet(200);
        return yanit(res, 200, { v: 1, istekler: mod.bekleyenRaporlar.splice(0) });
      }
      if (yol === "/v1/rapor/sonuc") {
        const r = ReportResultRequestSchema.safeParse(json);
        if (!r.success) {
          kaydet(400);
          return hata(res, 400, "GOVDE_GECERSIZ");
        }
        kaydet(200);
        raporSonuclari.push(r.data);
        return yanit(res, 200, { v: 1, ok: true });
      }
      kaydet(404);
      return hata(res, 404, "BULUNAMADI");
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const adres = server.address();
  if (!adres || typeof adres === "string") throw new Error("sahte bulut dinleyemedi");
  const url = `http://127.0.0.1:${adres.port}`;
  setCloudUrlForTests(url);
  return {
    url,
    paketler,
    raporSonuclari,
    istekler,
    zincir,
    satirlar,
    mod,
    kapat: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
