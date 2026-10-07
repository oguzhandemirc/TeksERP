// Satıcı bekçilerinin ortak ortamı. `test_` öneki yok → koşucu bunu bekçi saymaz.
//   · Hedef DB kapısı (FAIL-CLOSED allowlist): adı `_test` ile bitmeyen ya da `tekserp_fabrika_`
//     ile başlayan DB'de HİÇBİR bekçi koşmaz.
//   · Anahtarlar Teks-Erp fikstüründen ÇALIŞMA ANINDA üretilir (lisans-fikstur.ts — Senaryo L'nin
//     fabrika tarafıyla aynı kökler); kök parolalı dosya, alt/indirme 0600 geçici dizine yazılır.
//   · Sunucu GERÇEK süreç olarak kalkar (tek süreç, port 0) ve PID'iyle kapatılır.
//   · Satıcı portalının TEK yolu ERİŞİM'dir (tünel yok): düzenek süreç başına bir RSA-2048 anahtarı üretir, JWKS'ini
//     dosyaya yazar, sunucuyu sahte takım alanı + AUD ile açar ve portal isteklerine `Cf-Access-Jwt-Assertion` ekler.
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, randomBytes, randomUUID, sign, type KeyObject } from "node:crypto";
import {
  ACCEPTANCE_TEXTS,
  DAY_MS,
  EntitlementSchema,
  REQUEST_HEADER,
  TYP,
  generateNonce,
  parseJws,
  signAcceptance,
  signDocument,
  signRequest,
  type AcceptanceDoc,
  type EntitlementDoc,
  type Fingerprint,
  type LicenseClass,
  type RequestPurpose,
} from "../../src/lisans-protokol";
import {
  fiksturKur,
  sertifikaBas,
  sertifikaYuku,
  type Fikstur,
  type TestAnahtari,
} from "../../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { ERISIM_BASLIGI, ERISIM_EPOSTA, ERISIM_TAKIM_ALANI, erisimJetonu, erisimOrtami } from "./erisim-duzenegi";
import { loadConfig } from "../../src/config";
import { passwordBuffer, subKeyFileFor, wrapPrivateKey, writeKeyFileExclusive } from "../../src/keys/key-files";
import { KeyStore } from "../../src/keys/key-store";
import { ActivationCodeHasher } from "../../src/keys/code-pepper";
import { loadEnvFile } from "../../src/lib/env";
import { runAsCli } from "../../src/lib/request-scope";
import { PortalSecretBox } from "../../src/portal/secret-box";
import { ModuleKeyVault } from "../../src/keys/module-vault";
import type { VendorContext } from "../../src/services/context";

export const SATICI_KOKU = path.resolve(__dirname, "..", "..");

/**
 * Bekçi ortamının varsayılanları: /v1 hız sınırı akış bekçilerini ısırmasın. Hız sınırı KENDİ bekçisinde düşük
 * değerle ölçülür (`ekOrtam` bu varsayılanları ezer).
 */
export const BEKCI_ORTAMI: Readonly<Record<string, string>> = { V1_HIZ_IP_DK: "100000", V1_HIZ_KURULUM_DK: "100000" };
export const TEST_KOK_PAROLASI = "bekci-kok-parolasi-2026";

let gecti = 0;
let kaldi = 0;
export function kontrol(ad: string, kosul: boolean, ayrinti = ""): void {
  if (kosul) {
    gecti++;
    console.log(`  ✅ ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
  } else {
    kaldi++;
    console.log(`  ❌ ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
  }
}
export function sonuc(): never {
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
  process.exit(kaldi > 0 ? 1 : 0);
}

/** DB adı: `_test` ile bitmeli, fabrika verisi sınıfı (`tekserp_fabrika_*`) ASLA. */
export function hedefDbKapisi(): string {
  loadEnvFile();
  const url = process.env.DATABASE_URL ?? "";
  const ad = /\/([^/?]+)(\?|$)/.exec(url.replace(/^postgres(ql)?:\/\/[^/]*/, ""))?.[1] ?? "";
  if (!ad || !ad.endsWith("_test") || ad.startsWith("tekserp_fabrika_")) {
    console.error(`⛔ Hedef DB kapısı: "${ad || "?"}" bekçi hedefi olamaz (yalnız *_test; fabrika verisi asla)`);
    process.exit(2);
  }
  return ad;
}

export interface AnahtarOrtami {
  readonly f: Fikstur;
  readonly dizin: string;
  readonly capaDosyasi: string;
  readonly ctx: VendorContext;
  /** Sunucunun künyeye yazdığı fikstür anahtarları (temizlikte silinir). */
  readonly kidler: readonly string[];
  temizle(): void;
}

/** Geçici anahtar dizini: parolalı iki kök (bütün sınıflar + dar TEST/DEMO), ALT ve İNDİRME (kök imzalı), çapa dosyası. */
export async function anahtarOrtamiKur(simdi: number = Date.now(), ekOrtam: Record<string, string> = {}): Promise<AnahtarOrtami> {
  const f = fiksturKur(simdi);
  const dizin = mkdtempSync(path.join(os.tmpdir(), "satici-bekci-"));
  const parola = (): Buffer => passwordBuffer(TEST_KOK_PAROLASI);
  writeKeyFileExclusive(
    path.join(dizin, `${f.kok.kid}.kok.json`),
    await wrapPrivateKey({ tur: "tekserp-kok-anahtar", kid: f.kok.kid, siniflar: f.kokler[0]!.classes }, f.kok.privateKey, parola()),
  );
  writeKeyFileExclusive(
    path.join(dizin, `${f.dar.kid}.kok.json`),
    await wrapPrivateKey({ tur: "tekserp-kok-anahtar", kid: f.dar.kid, siniflar: ["TEST", "DEMO"] }, f.dar.privateKey, parola()),
  );
  writeKeyFileExclusive(
    path.join(dizin, `${f.alt.kid}.anahtar.json`),
    subKeyFileFor("tekserp-alt-anahtar", f.alt.kid, f.alt.privateKey, sertifikaBas(f.kok, sertifikaYuku(f, f.alt, "ALT"))),
  );
  writeKeyFileExclusive(
    path.join(dizin, `${f.ind.kid}.anahtar.json`),
    subKeyFileFor("tekserp-indirme-anahtar", f.ind.kid, f.ind.privateKey, sertifikaBas(f.kok, sertifikaYuku(f, f.ind, "INDIRME"))),
  );
  const capaDosyasi = path.join(dizin, "capa.json");
  writeFileSync(capaDosyasi, JSON.stringify(f.kokler));
  loadEnvFile();
  const config = loadConfig({ ...process.env, ...BEKCI_ORTAMI, ...ekOrtam, ANAHTAR_DIZINI: dizin, GUVEN_CAPASI_DOSYASI: capaDosyasi }, SATICI_KOKU);
  const ctx: VendorContext = {
    config,
    keys: KeyStore.load(config, simdi),
    portalSecrets: PortalSecretBox.load(dizin, { create: true }),
    moduleVault: ModuleKeyVault.load(dizin, { create: true }),
    codeHasher: ActivationCodeHasher.load(dizin, { create: true }),
  };
  const kidler = [f.kok.kid, f.dar.kid, f.alt.kid, f.ind.kid];
  return { f, dizin, capaDosyasi, ctx, kidler, temizle: () => rmSync(dizin, { recursive: true, force: true }) };
}

export interface CalisanSunucu {
  readonly genel: string;
  /** Satıcı portalı = ERİŞİM dinleyicisi; istek yardımcıları (portalIstek · portalGiris · portalFetch) JWT'yi ekler. */
  readonly portal: string;
  /** İç API dinleyicisi; ortak sır dosyası verilmediyse null (dinleyici AÇILMAZ). */
  readonly ic: string | null;
  readonly surec: ChildProcess;
  cikti(): string;
  durdur(): Promise<void>;
}

/**
 * Satıcı sunucusunu gerçek süreç olarak kaldırır (port 0; dinleme satırından okunur). Varsayılan: ERİŞİM düzeneği
 * açık (portal var). `{ erisim: false }`: düzenek ortamı verilmez — ERİŞİM'i kendi ayarıyla ölçen bekçi içindir.
 */
export function sunucuBaslat(ortam: AnahtarOrtami, ekOrtam: Record<string, string> = {}, g: { erisim?: boolean } = {}): Promise<CalisanSunucu> {
  const erisim = g.erisim === false ? {} : erisimOrtami();
  const surec = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: SATICI_KOKU,
    env: {
      ...process.env,
      PORT_GENEL: "0",
      PORT_IC: "0",
      IC_BIND: "127.0.0.1",
      GENEL_BIND: "127.0.0.1",
      ...erisim,
      ANAHTAR_DIZINI: ortam.dizin,
      GUVEN_CAPASI_DOSYASI: ortam.capaDosyasi,
      SATICI_ERISIM_GUNLUGU: "0",
      ...BEKCI_ORTAMI,
      ...ekOrtam,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  return new Promise((resolve, reject) => {
    const zaman = setTimeout(() => {
      surec.kill("SIGKILL");
      reject(new Error(`Sunucu 30 sn'de dinlemeye başlamadı:\n${log}`));
    }, 30_000);
    const oku = (c: Buffer): void => {
      log += c.toString("utf8");
      const m = /SATICI_DINLIYOR genel=(\d+) ic=(\d+|kapali) erisim=(\d+|kapali)/.exec(log);
      if (m) {
        clearTimeout(zaman);
        surec.stdout!.off("data", oku);
        surec.stdout!.on("data", (d: Buffer) => (log += d.toString("utf8")));
        const erisimAdresi = m[3] === "kapali" ? null : `http://127.0.0.1:${m[3]}`;
        // Düzenek ortamı verilmeyen süreçte (kendi Access ayarı) yardımcılar JWT eklemez.
        const portal = erisimAdresi && g.erisim !== false ? erisimTabaniKaydet(erisimAdresi) : erisimAdresi;
        const portalAdresi = (): string => {
          if (!portal) throw new Error("ERİŞİM dinleyicisi kapalı (sunucuBaslat { erisim: false } ya da PORT_ERISIM yok)");
          return portal;
        };
        resolve({
          genel: `http://127.0.0.1:${m[1]}`,
          get portal() {
            return portalAdresi();
          },
          ic: m[2] === "kapali" ? null : `http://127.0.0.1:${m[2]}`,
          surec,
          cikti: () => log,
          durdur: () =>
            new Promise<void>((r) => {
              if (surec.exitCode !== null) return r();
              surec.once("exit", () => r());
              surec.kill("SIGTERM");
              setTimeout(() => surec.kill("SIGKILL"), 5_000).unref();
            }),
        });
      }
    };
    surec.stdout!.on("data", oku);
    surec.stderr!.on("data", (c: Buffer) => (log += c.toString("utf8")));
    surec.once("exit", (kod) => {
      clearTimeout(zaman);
      reject(new Error(`Sunucu erken çıktı (${kod}):\n${log}`));
    });
  });
}

// ---------------------------------------------------------------- satıcı tarafı fikstürü
export interface KurulumFiksturu {
  readonly musteriId: string;
  readonly tesisId: string;
  /** Satıcı kaydının id'si. */
  readonly kurulumDbId: string;
  /** Lisans kimliği (portalda doğar, D14). */
  readonly kurulumId: string;
  readonly hakId: string;
  readonly lisansNo: string;
  readonly kod: string;
}

/**
 * Kanal fikstürü. Güncelleme grubu (`test` · `oncu` · `genel`) migration'la VARDIR — burada yalnız varlığı doğrulanır
 * (fikstür grubu ne açar ne değiştirir ne siler). Başka bir kod EMEKLİ kanal satırıdır (`aktif=false`, demofabrika
 * benzeri): kurulum alamaz, yalnız okuma/görünüm bekçileri kullanır. Aynı kod her koşumda yeniden kullanılır (upsert).
 */
export async function kanalFiksturu(kod: string): Promise<string> {
  const { prisma } = await import("../../src/lib/prisma");
  const { isUpdateGroup } = await import("../../src/services/channel.service");
  if (isUpdateGroup(kod)) {
    const row = await prisma.kanal.findUnique({ where: { kod }, select: { aktif: true } });
    if (!row?.aktif) throw new Error(`Güncelleme grubu satırı yok ya da pasif: ${kod} (migration 20261006120000_guncelleme_gruplari)`);
    return kod;
  }
  await prisma.kanal.upsert({ where: { kod }, create: { kod, ad: `Bekçi emekli kanalı ${kod}`, tur: "uretim", aktif: false }, update: {} });
  return kod;
}

export async function kurulumFiksturu(
  ctx: VendorContext,
  g: { sinif?: LicenseClass; kanal?: string; moduller?: string[]; tesisId?: string; musteriId?: string } = {},
): Promise<KurulumFiksturu> {
  const svc = await import("../../src/services/entitlement.service");
  const musteriId = g.musteriId ?? (await svc.createCustomer({ name: `Bekçi Tekstil ${randomUUID().slice(0, 8)}`, actor: "bekci" })).id;
  const tesisId = g.tesisId ?? (await svc.createSite({ customerId: musteriId, name: "Merkez Tesis", actor: "bekci" })).id;
  const kurulum = await svc.createInstallation({
    siteId: tesisId,
    licenseClass: g.sinif ?? "URETIM",
    ...(g.kanal === undefined ? {} : { channelCode: g.kanal }),
    actor: "bekci",
  });
  const hak = await svc.createEntitlement({
    installationDbId: kurulum.id,
    modules: g.moduller ?? ["production.enabled", "finance.enabled"],
    perpetual: true,
    maintenanceUntil: new Date(Date.now() + 365 * DAY_MS),
    // Bitişi zorunlu sınıf (DEMO — K5) bitişsiz doğamaz.
    ...(svc.isValidityEndRequired(kurulum.sinif) ? { validUntil: new Date(Date.now() + 30 * DAY_MS) } : {}),
    actor: "bekci",
  });
  await runAsCli(() => svc.issueEntitlementVersion(ctx, { entitlementId: hak.id, password: passwordBuffer(TEST_KOK_PAROLASI), reason: "bekçi fikstürü", actor: "bekci" }));
  const kod = await svc.createActivationCode(ctx, { installationDbId: kurulum.id, actor: "bekci" });
  return { musteriId, tesisId, kurulumDbId: kurulum.id, kurulumId: kurulum.kurulumId, hakId: hak.id, lisansNo: hak.lisansNo, kod: kod.code };
}

/**
 * Lisans v2 fikstürü: aktif HAK'ın YENİ sürümü `cevrimdisiUfukGun` ile (fikstür kökü imzalar) — P modelinin HAK yarısı.
 * Ufuklu HAK'ı portaldan basan yol L2-3'tedir; bekçi o inene dek sürümü doğrudan defterine yazar (kurulum kilidi altında).
 */
export async function ufukluHakSurumu(f: Fikstur, hakId: string, ufukGun: number | null = 400): Promise<number> {
  const { prisma } = await import("../../src/lib/prisma");
  const { lockInstallation } = await import("../../src/lib/locks");
  const hak = await prisma.hak.findUniqueOrThrow({ where: { id: hakId } });
  const onceki = await prisma.hakSurumu.findUniqueOrThrow({ where: { hakId_surum: { hakId, surum: hak.guncelSurum } } });
  const p = parseJws(onceki.belge);
  if (!p.ok) throw new Error("fikstür HAK belgesi okunamadı");
  const surum = hak.guncelSurum + 1;
  const simdi = new Date();
  const payload = { ...(p.value.payload as EntitlementDoc), surum, verilis: simdi.toISOString(), cevrimdisiUfukGun: ufukGun };
  const belge = signDocument({ typ: TYP.HAK, schema: EntitlementSchema, payload, key: { kid: f.kok.kid, privateKey: f.kok.privateKey } });
  await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, hak.kurulumId);
    await tx.hakSurumu.create({ data: { hakId, surum, belge, imzalayanKid: f.kok.kid, verilis: simdi, sebep: "bekçi: ufuklu HAK (lisans v2)", yapan: "bekci" } });
    await tx.hak.update({ where: { id: hakId }, data: { guncelSurum: surum } });
  });
  return surum;
}

/** Kiranın yükü (kendi imzalı belgemiz; bekçi yalnız okur). */
export function kiraYuku(json: Record<string, unknown>): Record<string, unknown> {
  const p = parseJws(json.kira);
  if (!p.ok) throw new Error("yanıtta kira yok");
  return p.value.payload as Record<string, unknown>;
}

// ---------------------------------------------------------------- fabrika (istemci) tarafı
export interface Yanit {
  readonly status: number;
  readonly json: Record<string, unknown>;
  readonly kod: string | undefined;
}

export const ORTAM = {
  platform: "win32" as const,
  mimari: "x64" as const,
  isletimSistemi: "Windows Server 2022",
  nodeSurum: "v24.18.0",
  uygulamaSurum: "2.11.2",
  derlemeTarihi: null,
  konteyner: false,
};

export function yoklamaGovdesi(g: {
  sonKiraId: string | null;
  hak?: { hakId: string; surum: number; ozet?: string } | null;
  parmakIzi: Fingerprint;
  /** Lisans v2 ekleri — yalnız verilirse gövdeye girer (eski fabrika hiçbirini göndermez). */
  v2?: {
    yetenekler?: string[];
    durumKaydi?: { sira: number | null; gecerli: boolean };
    belirsizlik?: { birikenMs: number; ilk: string | null };
    nedenler?: string[];
    saticiSapmaSn?: number;
    parmakIziKayip?: ("f1" | "f2" | "f3" | "f4" | "f5")[];
  };
}) {
  const simdi = new Date().toISOString();
  const v2 = g.v2 ?? {};
  return {
    v: 1,
    sonKiraId: g.sonKiraId,
    hak: g.hak ?? null,
    parmakIzi: g.parmakIzi,
    durum: { gecerlilik: "GECERLI", nedenler: v2.nedenler ?? [], kip: "gozlem", hesaplananKademe: "NORMAL", uygulananKademe: "NORMAL" },
    saat: { duvar: simdi, guvenilir: simdi, bulgu: null, ...(v2.saticiSapmaSn === undefined ? {} : { saticiSapmaSn: v2.saticiSapmaSn }) },
    ortam: ORTAM,
    saglik: {
      surum: "2.11.2",
      calismaSn: 3600,
      dbBoyutBayt: 1_000_000,
      yedek: { hukum: "ok", yasSaat: 3 },
      offsite: { yapilandirildi: true, ok: true, eksikSayisi: 0 },
      diskDolulukYuzde: 42,
      auditYazmaHatasi: 0,
      havuzZamanAsimi: 0,
      istemciler: [{ tur: "panel", surum: "1.3.2", adet: 2 }],
      isHatalari: [],
    },
    gozlem: { reddedilecekIstek: 0, reddedilecekModul: 0 },
    ...(v2.yetenekler === undefined ? {} : { yetenekler: v2.yetenekler }),
    ...(v2.durumKaydi === undefined ? {} : { durumKaydi: v2.durumKaydi }),
    ...(v2.belirsizlik === undefined ? {} : { belirsizlik: v2.belirsizlik }),
    ...(v2.parmakIziKayip === undefined ? {} : { parmakIziKayip: v2.parmakIziKayip }),
  };
}

/** Güncel katalog metninin (bütün kutular) kurulum imzalı kabul belgesi (Ek-7); `ek` alanları ezer (negatif sondalar). */
export function kabulBelgesi(anahtar: TestAnahtari, ek: Partial<AcceptanceDoc> = {}): string {
  const metin = ACCEPTANCE_TEXTS.at(-1);
  if (!metin) throw new Error("kabul metni kataloğu boş");
  return signAcceptance({
    privateKey: anahtar.privateKey,
    payload: {
      v: 1,
      kabulId: randomUUID(),
      metin: { kimlik: metin.kimlik, ozet: metin.ozet },
      kutular: [...metin.kutular],
      kabulEden: { kullaniciId: randomUUID(), ad: "Bekçi Yetkili", unvan: "Genel Müdür" },
      zaman: new Date().toISOString(),
      istemci: { tur: "panel", surum: "1.5.0" },
      sunucuSurum: "2.13.0",
      ...ek,
    },
  });
}

/**
 * `kurulumId: null` → kimliksiz etkinleştirme (yeni makine lisans kimliğini bilmez; kurulumu kod belirler). Gövde
 * varsayılan olarak aynı anahtarla imzalı geçerli kabul belgesini taşır; `kabul: null` alanı hiç koymaz.
 */
export function etkinlestirmeGovdesi(g: { kod: string; kurulumId: string | null; anahtar: TestAnahtari; parmakIzi: Fingerprint; kabul?: string | null }) {
  const kabul = g.kabul === undefined ? kabulBelgesi(g.anahtar) : g.kabul;
  return {
    v: 1,
    kod: g.kod,
    ...(g.kurulumId === null ? {} : { kurulumId: g.kurulumId }),
    acikAnahtar: g.anahtar.x,
    parmakIzi: g.parmakIzi,
    ortam: ORTAM,
    ...(kabul === null ? {} : { kabul }),
  };
}

/** Kurulum imzalı istek (ham gövde baytları imzalanır, aynen gönderilir). `kurulumId: null` = kimliksiz; `yol` imzalı uç yolu. */
export function imzaliBaslik(g: { kurulumId: string | null; amac: RequestPurpose; govde: string; anahtar: TestAnahtari; zamanMs?: number; nonce?: string; yol?: string }): string {
  return signRequest({
    installationId: g.kurulumId,
    purpose: g.amac,
    body: g.govde,
    key: { privateKey: g.anahtar.privateKey, nowMs: g.zamanMs ?? Date.now(), nonce: g.nonce ?? generateNonce() },
    ...(g.yol !== undefined ? { path: g.yol } : {}),
  });
}

export async function gonder(url: string, g: { baslik?: string; govde?: string; yontem?: string }): Promise<Yanit> {
  const r = await fetch(url, {
    method: g.yontem ?? "POST",
    headers: { "Content-Type": "application/json", ...(g.baslik ? { [REQUEST_HEADER]: g.baslik } : {}) },
    ...(g.govde !== undefined ? { body: g.govde } : {}),
  });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { _metin: text };
  }
  const details = json.details as { code?: string } | undefined;
  return { status: r.status, json, kod: details?.code };
}

/** Kurulum imzalı POST: gövde nesnesi → metin → imza → gönder. */
export async function imzaliPost(
  taban: string,
  yol: string,
  g: { kurulumId: string | null; amac: RequestPurpose; govde: unknown; anahtar: TestAnahtari; zamanMs?: number; nonce?: string; imzaYolu?: string },
): Promise<Yanit & { baslik: string; metin: string }> {
  const metin = JSON.stringify(g.govde);
  const baslik = imzaliBaslik({ kurulumId: g.kurulumId, amac: g.amac, govde: metin, anahtar: g.anahtar, zamanMs: g.zamanMs, nonce: g.nonce, yol: g.imzaYolu });
  const y = await gonder(`${taban}${yol}`, { baslik, govde: metin });
  return { ...y, baslik, metin };
}

/** Bekçi fikstürünün temizliği — defter tetikleyicisinin `_test` DB istisnasıyla (yalnız bu oturum). */
export async function temizleKurulumlar(kurulumDbIdleri: readonly string[], kidler: readonly string[] = []): Promise<void> {
  const { prisma } = await import("../../src/lib/prisma");
  if (kidler.length > 0) await prisma.anahtarKaydi.deleteMany({ where: { kid: { in: [...kidler] } } });
  // Yarıda düşen bekçinin `undefined` kimliği temizliği de düşürmesin (sonraki koşumu kalıntı kirletir).
  const ids = kurulumDbIdleri.filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL satici.defter_temizlik = 'test'`);
    const w = { kurulumId: { in: ids } };
    // Denetim ayak izi varlık id'siyle bağlı: kurulum · hak · tesis · müşteri · taşıma talebi · kalem.
    const denetimIdleri = new Set<string>(ids);
    const tasimaIdleri = (await tx.tasimaTalebi.findMany({ where: w, select: { id: true } })).map((t) => t.id);
    for (const t of tasimaIdleri) denetimIdleri.add(t);
    for (const h of await tx.hak.findMany({ where: w, select: { id: true } })) denetimIdleri.add(h.id);
    for (const p of await tx.planliEylem.findMany({ where: w, select: { id: true } })) denetimIdleri.add(p.id);
    const planlar = await tx.taksitPlani.findMany({ where: w, select: { id: true } });
    for (const p of planlar) denetimIdleri.add(p.id);
    for (const k of await tx.taksitKalemi.findMany({ where: { planId: { in: planlar.map((p) => p.id) } }, select: { id: true } })) denetimIdleri.add(k.id);
    await tx.taksitKalemi.deleteMany({ where: { planId: { in: planlar.map((p) => p.id) } } });
    await tx.taksitPlani.deleteMany({ where: w });
    await tx.yaptirimEylemi.deleteMany({ where: { ...w, geriAlinanEylemId: { not: null } } });
    await tx.yaptirimEylemi.deleteMany({ where: w });
    await tx.planliEylem.deleteMany({ where: w });
    await tx.etkinlestirmeKodu.deleteMany({ where: w });
    await tx.nonceDefteri.deleteMany({ where: w });
    // Kurulumsuz taşıma talebinin nonce'u anahtar kapsamında (`kid:…`) — o anahtarlar kurulumların talep/kayıtlarından.
    const talepAnahtarlari = (await tx.tasimaTalebi.findMany({ where: w, select: { yeniAnahtarKimligi: true } })).map((t) => `kid:${t.yeniAnahtarKimligi}`);
    await tx.nonceDefteri.deleteMany({ where: { kapsam: { in: talepAnahtarlari } } });
    await tx.yoklama.deleteMany({ where: w });
    await tx.hataRaporuGrubu.deleteMany({ where: w });
    await tx.hataRaporuPartisi.deleteMany({ where: w });
    await tx.kopyaUyarisi.deleteMany({ where: w });
    await tx.tasimaTalebi.deleteMany({ where: w });
    // Donanım / zayıf tanıma onay talepleri (K8): denetim ayak izi talep id'siyle.
    for (const d of await tx.donanimTalebi.findMany({ where: w, select: { id: true } })) denetimIdleri.add(d.id);
    await tx.donanimTalebi.deleteMany({ where: w });
    // Destek talepleri (3d-2): defter satırları önce, talep sonra; denetim ayak izi talep id'siyle.
    const talepler = await tx.destekTalebi.findMany({ where: w, select: { id: true } });
    for (const t of talepler) denetimIdleri.add(t.id);
    await tx.destekOlayi.deleteMany({ where: { talepId: { in: talepler.map((t) => t.id) } } });
    await tx.destekTalebi.deleteMany({ where: w });
    // Bildirim giden kutusu (kuruluma FK'lı; iletim kaydı, defter değil). Kimliksiz doğup sonra bu kuruluma
    // bağlanan taşıma talebinin bildirimi kurulumsuzdur → talep kimliğiyle.
    await tx.bildirim.deleteMany({ where: { OR: [w, { ilgiliKayit: { in: tasimaIdleri } }] } });
    await tx.kurulumKaydi.deleteMany({ where: w });
    await tx.kurulum.updateMany({ where: { id: { in: ids } }, data: { sonKiraId: null } });
    await tx.kira.deleteMany({ where: w });
    // Kök imzası bekleyen HAK kuyruğu (G4): sürüm defteri satırına bağlı → defterden ÖNCE.
    await tx.hakKokTalebi.deleteMany({ where: w });
    const haklar = await tx.hak.findMany({ where: w, select: { id: true } });
    await tx.hakSurumu.deleteMany({ where: { hakId: { in: haklar.map((h) => h.id) } } });
    await tx.hak.deleteMany({ where: w });
    const kurulumlar = await tx.kurulum.findMany({ where: { id: { in: ids } }, select: { tesisId: true } });
    await tx.kurulum.deleteMany({ where: { id: { in: ids } } });
    const tesisIdleri = [...new Set(kurulumlar.map((k) => k.tesisId))];
    const bosTesisler = await tx.tesis.findMany({ where: { id: { in: tesisIdleri }, kurulumlar: { none: {} } }, select: { id: true, musteriId: true } });
    await tx.tesis.deleteMany({ where: { id: { in: bosTesisler.map((t) => t.id) } } });
    const musteriIdleri = [...new Set(bosTesisler.map((t) => t.musteriId))];
    await tx.musteri.deleteMany({ where: { id: { in: musteriIdleri }, tesisler: { none: {} } } });
    for (const x of [...bosTesisler.map((t) => t.id), ...musteriIdleri]) denetimIdleri.add(x);
    await tx.denetim.deleteMany({ where: { varlikId: { in: [...denetimIdleri] } } });
  });
}

/** Kuruluma bağlanmamış (kimliksiz, onaylanmamış) taşıma talepleri ve anahtar kapsamlı nonce'ları — anahtar kimliğiyle. */
export async function temizleBagsizTalepler(anahtarKimlikleri: readonly string[]): Promise<void> {
  const { prisma } = await import("../../src/lib/prisma");
  const kidler = anahtarKimlikleri.filter((k) => typeof k === "string" && k.length > 0);
  if (kidler.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL satici.defter_temizlik = 'test'`);
    const talepler = await tx.tasimaTalebi.findMany({ where: { yeniAnahtarKimligi: { in: kidler }, kurulumId: null }, select: { id: true } });
    await tx.bildirim.deleteMany({ where: { ilgiliKayit: { in: talepler.map((t) => t.id) }, kurulumId: null } });
    await tx.tasimaTalebi.deleteMany({ where: { id: { in: talepler.map((t) => t.id) } } });
    await tx.nonceDefteri.deleteMany({ where: { kapsam: { in: kidler.map((k) => `kid:${k}`) } } });
    await tx.denetim.deleteMany({ where: { varlikId: { in: talepler.map((t) => t.id) } } });
  });
}

/** İptal belgesi defteri fikstürü (G4) — yalnız bu bekçinin yükleyen etiketiyle yazdığı satırlar (`_test` beyanıyla). */
export async function temizleIptalBelgeleri(yukleyen: string): Promise<void> {
  const { prisma } = await import("../../src/lib/prisma");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL satici.defter_temizlik = 'test'`);
    const rows = await tx.iptalBelgesi.findMany({ where: { yukleyen }, select: { id: true } });
    await tx.iptalBelgesi.deleteMany({ where: { yukleyen } });
    await tx.denetim.deleteMany({ where: { varlikId: { in: rows.map((r) => r.id) } } });
  });
}

/** Dağıtım iptali defteri fikstürü — yalnız bu bekçinin yükleyen etiketiyle yazdığı satırlar (`_test` beyanıyla). */
export async function temizlePaketIptalBelgeleri(yukleyen: string): Promise<void> {
  const { prisma } = await import("../../src/lib/prisma");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL satici.defter_temizlik = 'test'`);
    const rows = await tx.paketIptalBelgesi.findMany({ where: { yukleyen }, select: { id: true } });
    await tx.paketIptalBelgesi.deleteMany({ where: { yukleyen } });
    await tx.denetim.deleteMany({ where: { varlikId: { in: rows.map((r) => r.id) } } });
  });
}

export async function kapat(): Promise<void> {
  const { prisma, pool } = await import("../../src/lib/prisma");
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
}

// ---------------------------------------------------------------- kapı zili istemcisi (SSE)
export interface ZilAboneligi {
  readonly status: number;
  readonly basliklar: Headers;
  readonly konular: string[];
  yorumSayisi(): number;
  bekleKonu(konu: string, ms: number): Promise<number | null>;
  kapat(): void;
}

/** Kurulum imzalı zil aboneliği: `event: zil` / `data: {konu}` ve `:` yorum satırlarını toplar. */
export async function zilAboneOl(genel: string, g: { kurulumId: string; anahtar: TestAnahtari }): Promise<ZilAboneligi> {
  const baslik = imzaliBaslik({ kurulumId: g.kurulumId, amac: "zil", govde: "", anahtar: g.anahtar });
  const iptal = new AbortController();
  const r = await fetch(`${genel}/v1/zil`, { headers: { [REQUEST_HEADER]: baslik }, signal: iptal.signal });
  const konular: string[] = [];
  let yorum = 0;
  const bekleyenler: { konu: string; t0: number; coz: (ms: number) => void }[] = [];
  if (r.ok && r.body) {
    const okuyucu = r.body.getReader();
    const cozucu = new TextDecoder();
    let tampon = "";
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await okuyucu.read();
          if (done) break;
          tampon += cozucu.decode(value, { stream: true });
          let i: number;
          while ((i = tampon.indexOf("\n\n")) >= 0) {
            const blok = tampon.slice(0, i);
            tampon = tampon.slice(i + 2);
            if (blok.startsWith(":")) {
              yorum++;
              continue;
            }
            const veri = /^data: (.*)$/m.exec(blok)?.[1];
            if (/^event: zil$/m.test(blok) && veri) {
              const konu = (JSON.parse(veri) as { konu: string }).konu;
              konular.push(konu);
              for (const b of [...bekleyenler]) {
                if (b.konu === konu) {
                  bekleyenler.splice(bekleyenler.indexOf(b), 1);
                  b.coz(Date.now() - b.t0);
                }
              }
            }
          }
        }
      } catch {
        // iptal
      }
    })();
  } else {
    await r.text().catch(() => "");
  }
  return {
    status: r.status,
    basliklar: r.headers,
    konular,
    yorumSayisi: () => yorum,
    bekleKonu: (konu, ms) =>
      new Promise((coz) => {
        const t0 = Date.now();
        const zaman = setTimeout(() => coz(null), ms);
        bekleyenler.push({ konu, t0, coz: (x) => (clearTimeout(zaman), coz(x)) });
      }),
    kapat: () => iptal.abort(),
  };
}

/** Yanıttaki kiranın kimliği (imza doğrulanmadan okunur — yalnız zincir sürmek için). */
export function kiraIdOf(json: Record<string, unknown>): string {
  const p = parseJws(json.kira);
  const id = p.ok ? p.value.payload.kiraId : undefined;
  if (typeof id !== "string") throw new Error("yanıtta kira yok");
  return id;
}

// ---------------------------------------------------------------- ERİŞİM düzeneği (satıcı portalının tek yolu)
// Anahtar · JWKS · jeton `erisim-duzenegi.ts`te (yalnız node: bağımlı yaprak — Teks-Erp senaryosu da içe aktarır).
export { ERISIM_BASLIGI, ERISIM_EPOSTA, ERISIM_TAKIM_ALANI, erisimJetonu, erisimOrtami };

/** Düzeneğin ERİŞİM adresleri: istek yardımcıları yalnız bunlara JWT ekler (bayi/genel adresine asla). */
const erisimTabanlari = new Set<string>();
function erisimTabaniKaydet(taban: string): string {
  erisimTabanlari.add(taban);
  return taban;
}
function erisimAdresiMi(url: string): boolean {
  for (const t of erisimTabanlari) if (url === t || url.startsWith(`${t}/`)) return true;
  return false;
}

/** Ham `fetch` (statik dosya, ham dağıtım uçları): adres düzeneğin ERİŞİM adresiyse JWT'yi ekler, yoksa dokunmaz. */
export function portalFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!erisimAdresiMi(url)) return fetch(url, init);
  const headers = new Headers(init.headers);
  if (!headers.has(ERISIM_BASLIGI)) headers.set(ERISIM_BASLIGI, erisimJetonu());
  return fetch(url, { ...init, headers });
}

// ---------------------------------------------------------------- portal (süreç içi iki dinleyici)
export interface PortalSunuculari {
  /** Satıcı portalı = ERİŞİM uygulaması (/portal/api); istek yardımcıları JWT'yi ekler. */
  readonly portal: string;
  /** Genel dinleyici (bayi alt-portalı /bayi/api, /v1/*). */
  readonly genel: string;
  kapat(): Promise<void>;
}

function dinle(server: http.Server): Promise<AddressInfo> {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address() as AddressInfo)));
}

/** Portal uygulamalarını AYNI bağlamla süreç içinde kaldırır (bekçi saati/anahtarı enjekte edebilsin). */
export async function portalSunuculariKur(ctx: VendorContext): Promise<PortalSunuculari> {
  process.env.SATICI_ERISIM_GUNLUGU ??= "0";
  const { createAccessApp } = await import("../../src/http/access-app");
  const { createAccessVerifier } = await import("../../src/http/access-jwt");
  const { createPublicApp } = await import("../../src/http/public-app");
  const o = erisimOrtami();
  const verifier = createAccessVerifier({ CF_ACCESS_TAKIM_ALANI: o.CF_ACCESS_TAKIM_ALANI, CF_ACCESS_AUD: o.CF_ACCESS_AUD, CF_ACCESS_JWKS_DOSYASI: o.CF_ACCESS_JWKS_DOSYASI });
  if (!verifier) throw new Error("ERİŞİM düzeneği kurulamadı");
  let erisimAdresi: AddressInfo | null = null;
  const e = http.createServer(createAccessApp(ctx, { listener: () => erisimAdresi, verifier }));
  const g = http.createServer(createPublicApp(ctx, null));
  erisimAdresi = await dinle(e);
  const genelAdresi = await dinle(g);
  const portal = erisimTabaniKaydet(`http://127.0.0.1:${erisimAdresi.port}`);
  const kapat = (s: http.Server) => new Promise<void>((r) => (s.closeAllConnections(), s.close(() => r())));
  return {
    portal,
    genel: `http://127.0.0.1:${genelAdresi.port}`,
    kapat: async () => {
      await kapat(e);
      await kapat(g);
    },
  };
}

export interface PortalKimlik {
  readonly id: string;
  readonly kullaniciAdi: string;
  readonly parola: string;
  readonly sir: string;
  readonly rol: "SATICI_YONETICI" | "SATICI_OPERATOR" | "BAYI";
}

/** Portal kullanıcısı (servisten; TOTP sırrı döner). Kullanıcı adı bekçi önekli, tekil. */
export async function portalKullaniciAc(ctx: VendorContext, rol: PortalKimlik["rol"], bayiId: string | null = null): Promise<PortalKimlik> {
  const { prisma } = await import("../../src/lib/prisma");
  const { createPortalUserTx } = await import("../../src/portal/users.service");
  const { hashPortalPassword } = await import("../../src/portal/password");
  const kullaniciAdi = `bekci-${randomUUID().slice(0, 12)}`;
  const parola = `bekci-parola-${randomUUID()}`;
  const r = await createPortalUserTx(prisma, ctx, { username: kullaniciAdi, fullName: "Bekçi Kullanıcı", role: rol, dealerId: bayiId, passwordHash: await hashPortalPassword(parola) });
  return { id: r.user.id, kullaniciAdi, parola, sir: r.totp.sir, rol };
}

/** TOTP kodu; `adimKaydir` ile sonraki adımın kodu (aynı 30 sn içinde ikinci giriş için). */
export async function totpKodu(sir: string, adimKaydir = 0, zamanMs: number = Date.now()): Promise<string> {
  const { hotp, totpStep } = await import("../../src/portal/totp");
  return hotp(sir, totpStep(zamanMs) + adimKaydir);
}

export type PortalYolu = "/portal/api" | "/bayi/api";

export interface PortalYanit extends Yanit {
  readonly basliklar: Headers;
  readonly veri: Record<string, unknown>;
}

/**
 * JSON portal isteği; `cerez` "ad=değer" biçiminde; `basliklar` ek başlıklar. Düzeneğin ERİŞİM adresine geçerli Access
 * JWT'si kendiliğinden eklenir (`basliklar`taki açık başlık onu ezer; `erisimJetonu: false` hiç eklemez).
 */
export async function portalIstek(
  taban: string,
  yol: string,
  g: { yontem?: string; govde?: unknown; cerez?: string; icerikTuru?: string; basliklar?: Record<string, string>; erisimJetonu?: false } = {},
): Promise<PortalYanit> {
  const yontem = g.yontem ?? (g.govde === undefined ? "GET" : "POST");
  const jwt: Record<string, string> = g.erisimJetonu !== false && erisimAdresiMi(taban) ? { [ERISIM_BASLIGI]: erisimJetonu() } : {};
  const r = await fetch(`${taban}${yol}`, {
    method: yontem,
    headers: {
      ...(yontem === "GET" ? {} : { "Content-Type": g.icerikTuru ?? "application/json" }),
      ...(g.cerez ? { Cookie: g.cerez } : {}),
      ...jwt,
      ...(g.basliklar ?? {}),
    },
    ...(g.govde === undefined ? {} : { body: typeof g.govde === "string" ? g.govde : JSON.stringify(g.govde) }),
  });
  const metin = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(metin) as Record<string, unknown>;
  } catch {
    json = { _metin: metin };
  }
  const details = json.details as { code?: string } | undefined;
  return { status: r.status, json, kod: details?.code, basliklar: r.headers, veri: (json.data ?? {}) as Record<string, unknown> };
}

/** Giriş: başarılıysa çerez "ad=değer" döner. `totp` verilmezse güncel adımın kodu. */
export async function portalGiris(
  taban: string,
  yol: PortalYolu,
  k: PortalKimlik,
  g: { totp?: string; parola?: string; adimKaydir?: number; basliklar?: Record<string, string>; erisimJetonu?: false } = {},
): Promise<PortalYanit & { cerez: string | null; setCookie: string | null }> {
  const y = await portalIstek(taban, `${yol}/oturum/ac`, {
    govde: { kullaniciAdi: k.kullaniciAdi, parola: g.parola ?? k.parola, totp: g.totp ?? (await totpKodu(k.sir, g.adimKaydir ?? 0)) },
    basliklar: g.basliklar,
    erisimJetonu: g.erisimJetonu,
  });
  const setCookie = y.basliklar.get("set-cookie");
  const cerez = y.status === 200 && setCookie ? setCookie.split(";")[0]!.trim() : null;
  return { ...y, cerez, setCookie };
}

/** Portal fikstürünün temizliği: kullanıcılar (oturum + işlem kimliği) · boş tesis/müşteri · bayi + tavan defteri · kurulumsuz kanal. */
export async function temizlePortal(g: {
  kullanicilar?: readonly string[];
  bayiler?: readonly string[];
  tesisler?: readonly string[];
  musteriler?: readonly string[];
  kanallar?: readonly string[];
}): Promise<void> {
  const { prisma } = await import("../../src/lib/prisma");
  const kullanicilar = [...(g.kullanicilar ?? [])];
  const bayiler = [...(g.bayiler ?? [])];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL satici.defter_temizlik = 'test'`);
    await tx.portalOturumu.deleteMany({ where: { kullaniciId: { in: kullanicilar } } });
    await tx.portalIslemi.deleteMany({ where: { kullaniciId: { in: kullanicilar } } });
    await tx.portalKullanici.deleteMany({ where: { OR: [{ id: { in: kullanicilar } }, { bayiId: { in: bayiler } }] } });
    const tesisler = [...(g.tesisler ?? []), ...(await tx.tesis.findMany({ where: { musteri: { bayiId: { in: bayiler } } }, select: { id: true } })).map((t) => t.id)];
    await tx.tesis.deleteMany({ where: { id: { in: tesisler }, kurulumlar: { none: {} } } });
    const musteriler = [...(g.musteriler ?? []), ...(await tx.musteri.findMany({ where: { bayiId: { in: bayiler } }, select: { id: true } })).map((m) => m.id)];
    await tx.musteri.deleteMany({ where: { id: { in: musteriler }, tesisler: { none: {} } } });
    await tx.bayiTavani.deleteMany({ where: { bayiId: { in: bayiler } } });
    await tx.bayi.deleteMany({ where: { id: { in: bayiler } } });
    // Güncelleme grubu satırı ASLA silinmez (migration'ın satırı; sonraki bekçiler ona kurulum açar).
    const { UPDATE_GROUPS } = await import("../../src/services/channel.service");
    const silinecek = (g.kanallar ?? []).filter((k) => !(UPDATE_GROUPS as readonly string[]).includes(k));
    const kanallar = (await tx.kanal.findMany({ where: { kod: { in: silinecek }, kurulumlar: { none: {} } }, select: { id: true } })).map((k) => k.id);
    await tx.kanal.deleteMany({ where: { id: { in: kanallar } } });
    await tx.denetim.deleteMany({ where: { varlikId: { in: [...kullanicilar, ...bayiler, ...tesisler, ...musteriler, ...kanallar] } } });
  });
}

/** Bayinin kurulumları (temizlikte `temizleKurulumlar`a verilir). */
export async function bayiKurulumlari(bayiler: readonly string[]): Promise<string[]> {
  const { prisma } = await import("../../src/lib/prisma");
  const rows = await prisma.kurulum.findMany({ where: { tesis: { musteri: { bayiId: { in: [...bayiler] } } } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Dağıtım fikstürünün temizliği (Faz 3d) — müşteri silinmeden ÖNCE çağrılır (FK). Defter satırları yalnız `_test`
 * DB'sinde beyanla silinir; yayıncı anahtarı ve yayın bildirimi kimlikle ayrıca.
 */
export async function temizleDagitim(g: { musteriler?: readonly string[]; yayinciKidler?: readonly string[]; bildirimKanallari?: readonly string[] }): Promise<void> {
  const { prisma } = await import("../../src/lib/prisma");
  const musteriler = [...(g.musteriler ?? [])].filter((x) => typeof x === "string" && x.length > 0);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL satici.defter_temizlik = 'test'`);
    const w = { musteriId: { in: musteriler } };
    const oturumlar = (await tx.yuklemeOturumu.findMany({ where: w, select: { id: true } })).map((o) => o.id);
    const baglantilar = (await tx.indirmeBaglantisi.findMany({ where: w, select: { id: true } })).map((o) => o.id);
    const istekler = (await tx.yuklemeIstegi.findMany({ where: w, select: { id: true } })).map((o) => o.id);
    const yayincilar = (await tx.yayinciAnahtari.findMany({ where: { kid: { in: [...(g.yayinciKidler ?? [])] } }, select: { id: true } })).map((o) => o.id);
    await tx.dagitimDefteri.deleteMany({ where: w });
    await tx.yuklemeParcasi.deleteMany({ where: { oturumId: { in: oturumlar } } });
    await tx.yuklemeOturumu.deleteMany({ where: w });
    await tx.indirmeBaglantisi.deleteMany({ where: w });
    await tx.dagitimDosyasi.deleteMany({ where: w });
    await tx.yuklemeIstegi.deleteMany({ where: w });
    await tx.yayinBildirimi.deleteMany({ where: { kanalKodu: { in: [...(g.bildirimKanallari ?? [])] } } });
    await tx.yayinciAnahtari.deleteMany({ where: { id: { in: yayincilar } } });
    await tx.denetim.deleteMany({ where: { varlikId: { in: [...baglantilar, ...istekler, ...yayincilar] } } });
  });
}
