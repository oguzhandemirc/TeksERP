// Satıcı bekçilerinin ortak ortamı. `test_` öneki yok → koşucu bunu bekçi saymaz.
//   · Hedef DB kapısı (FAIL-CLOSED allowlist): adı `_test` ile bitmeyen ya da `tekserp_fabrika_`
//     ile başlayan DB'de HİÇBİR bekçi koşmaz.
//   · Anahtarlar Teks-Erp fikstüründen ÇALIŞMA ANINDA üretilir (lisans-fikstur.ts — Senaryo L'nin
//     fabrika tarafıyla aynı kökler); kök parolalı dosya, alt/indirme 0600 geçici dizine yazılır.
//   · Sunucu GERÇEK süreç olarak kalkar (tek süreç, iki dinleyici, port 0) ve PID'iyle kapatılır.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DAY_MS,
  REQUEST_HEADER,
  generateNonce,
  parseJws,
  signRequest,
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
import { loadConfig } from "../../src/config";
import { passwordBuffer, subKeyFileFor, wrapPrivateKey, writeKeyFileExclusive } from "../../src/keys/key-files";
import { KeyStore } from "../../src/keys/key-store";
import { loadEnvFile } from "../../src/lib/env";
import type { VendorContext } from "../../src/services/context";

export const SATICI_KOKU = path.resolve(__dirname, "..", "..");
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

/** Geçici anahtar dizini: parolalı üretim + hazırlık kökü, ALT ve İNDİRME (kök imzalı), çapa dosyası. */
export async function anahtarOrtamiKur(simdi: number = Date.now()): Promise<AnahtarOrtami> {
  const f = fiksturKur(simdi);
  const dizin = mkdtempSync(path.join(os.tmpdir(), "satici-bekci-"));
  const parola = (): Buffer => passwordBuffer(TEST_KOK_PAROLASI);
  writeKeyFileExclusive(
    path.join(dizin, `${f.kok.kid}.kok.json`),
    await wrapPrivateKey({ tur: "tekserp-kok-anahtar", kid: f.kok.kid, siniflar: f.kokler[0]!.classes }, f.kok.privateKey, parola()),
  );
  writeKeyFileExclusive(
    path.join(dizin, `${f.hazirlik.kid}.kok.json`),
    await wrapPrivateKey({ tur: "tekserp-kok-anahtar", kid: f.hazirlik.kid, siniflar: ["TEST", "DEMO"] }, f.hazirlik.privateKey, parola()),
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
  const config = loadConfig({ ...process.env, ANAHTAR_DIZINI: dizin, GUVEN_CAPASI_DOSYASI: capaDosyasi }, SATICI_KOKU);
  const ctx: VendorContext = { config, keys: KeyStore.load(config, simdi) };
  const kidler = [f.kok.kid, f.hazirlik.kid, f.alt.kid, f.ind.kid];
  return { f, dizin, capaDosyasi, ctx, kidler, temizle: () => rmSync(dizin, { recursive: true, force: true }) };
}

export interface CalisanSunucu {
  readonly genel: string;
  readonly tailnet: string;
  readonly surec: ChildProcess;
  cikti(): string;
  durdur(): Promise<void>;
}

/** Satıcı sunucusunu gerçek süreç olarak kaldırır (port 0; dinleme satırından okunur). */
export function sunucuBaslat(ortam: AnahtarOrtami, ekOrtam: Record<string, string> = {}): Promise<CalisanSunucu> {
  const surec = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: SATICI_KOKU,
    env: {
      ...process.env,
      PORT_GENEL: "0",
      PORT_TAILNET: "0",
      GENEL_BIND: "127.0.0.1",
      TAILNET_BIND: "127.0.0.1",
      ANAHTAR_DIZINI: ortam.dizin,
      GUVEN_CAPASI_DOSYASI: ortam.capaDosyasi,
      SATICI_ERISIM_GUNLUGU: "0",
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
      const m = /SATICI_DINLIYOR genel=(\d+) tailnet=(\d+)/.exec(log);
      if (m) {
        clearTimeout(zaman);
        surec.stdout!.off("data", oku);
        surec.stdout!.on("data", (d: Buffer) => (log += d.toString("utf8")));
        resolve({
          genel: `http://127.0.0.1:${m[1]}`,
          tailnet: `http://127.0.0.1:${m[2]}`,
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
  /** Fabrikanın installationId'si. */
  readonly kurulumId: string;
  readonly hakId: string;
  readonly lisansNo: string;
  readonly kod: string;
}

export async function kurulumFiksturu(
  ctx: VendorContext,
  g: { sinif?: LicenseClass; kanal?: string; moduller?: string[]; tesisId?: string; musteriId?: string; kurulumId?: string } = {},
): Promise<KurulumFiksturu> {
  const svc = await import("../../src/services/entitlement.service");
  const musteriId = g.musteriId ?? (await svc.createCustomer({ name: `Bekçi Tekstil ${randomUUID().slice(0, 8)}`, actor: "bekci" })).id;
  const tesisId = g.tesisId ?? (await svc.createSite({ customerId: musteriId, name: "Merkez Tesis", actor: "bekci" })).id;
  const kurulum = await svc.createInstallation({
    siteId: tesisId,
    installationId: g.kurulumId ?? randomUUID(),
    licenseClass: g.sinif ?? "URETIM",
    channelCode: g.kanal ?? "bekci-kanal",
    actor: "bekci",
  });
  const hak = await svc.createEntitlement({
    installationDbId: kurulum.id,
    modules: g.moduller ?? ["production.enabled", "finance.enabled"],
    perpetual: true,
    maintenanceUntil: new Date(Date.now() + 365 * DAY_MS),
    actor: "bekci",
  });
  await svc.issueEntitlementVersion(ctx, { entitlementId: hak.id, password: passwordBuffer(TEST_KOK_PAROLASI), reason: "bekçi fikstürü", actor: "bekci" });
  const kod = await svc.createActivationCode(ctx, { installationDbId: kurulum.id, actor: "bekci" });
  return { musteriId, tesisId, kurulumDbId: kurulum.id, kurulumId: kurulum.kurulumId, hakId: hak.id, lisansNo: hak.lisansNo, kod: kod.code };
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

export function yoklamaGovdesi(g: { sonKiraId: string | null; hak?: { hakId: string; surum: number } | null; parmakIzi: Fingerprint }) {
  const simdi = new Date().toISOString();
  return {
    v: 1,
    sonKiraId: g.sonKiraId,
    hak: g.hak ?? null,
    parmakIzi: g.parmakIzi,
    durum: { gecerlilik: "GECERLI", nedenler: [], kip: "gozlem", hesaplananKademe: "NORMAL", uygulananKademe: "NORMAL" },
    saat: { duvar: simdi, guvenilir: simdi, bulgu: null },
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
  };
}

export function etkinlestirmeGovdesi(g: { kod: string; kurulumId: string; anahtar: TestAnahtari; parmakIzi: Fingerprint }) {
  return { v: 1, kod: g.kod, kurulumId: g.kurulumId, acikAnahtar: g.anahtar.x, parmakIzi: g.parmakIzi, ortam: ORTAM };
}

/** Kurulum imzalı istek (ham gövde baytları imzalanır, aynen gönderilir). */
export function imzaliBaslik(g: { kurulumId: string; amac: RequestPurpose; govde: string; anahtar: TestAnahtari; zamanMs?: number; nonce?: string }): string {
  return signRequest({
    installationId: g.kurulumId,
    purpose: g.amac,
    body: g.govde,
    key: { privateKey: g.anahtar.privateKey, nowMs: g.zamanMs ?? Date.now(), nonce: g.nonce ?? generateNonce() },
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
  g: { kurulumId: string; amac: RequestPurpose; govde: unknown; anahtar: TestAnahtari; zamanMs?: number; nonce?: string },
): Promise<Yanit & { baslik: string; metin: string }> {
  const metin = JSON.stringify(g.govde);
  const baslik = imzaliBaslik({ kurulumId: g.kurulumId, amac: g.amac, govde: metin, anahtar: g.anahtar, zamanMs: g.zamanMs, nonce: g.nonce });
  const y = await gonder(`${taban}${yol}`, { baslik, govde: metin });
  return { ...y, baslik, metin };
}

/** Bekçi fikstürünün temizliği — defter tetikleyicisinin `_test` DB istisnasıyla (yalnız bu oturum). */
export async function temizleKurulumlar(kurulumDbIdleri: readonly string[], kidler: readonly string[] = []): Promise<void> {
  const { prisma } = await import("../../src/lib/prisma");
  if (kidler.length > 0) await prisma.anahtarKaydi.deleteMany({ where: { kid: { in: [...kidler] } } });
  if (kurulumDbIdleri.length === 0) return;
  const ids = [...kurulumDbIdleri];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL satici.defter_temizlik = 'test'`);
    const w = { kurulumId: { in: ids } };
    // Denetim ayak izi varlık id'siyle bağlı: kurulum · hak · tesis · müşteri · taşıma talebi · kalem.
    const denetimIdleri = new Set<string>(ids);
    for (const t of await tx.tasimaTalebi.findMany({ where: w, select: { id: true } })) denetimIdleri.add(t.id);
    for (const h of await tx.hak.findMany({ where: w, select: { id: true } })) denetimIdleri.add(h.id);
    for (const p of await tx.planliEylem.findMany({ where: w, select: { id: true } })) denetimIdleri.add(p.id);
    const planlar = await tx.taksitPlani.findMany({ where: w, select: { id: true } });
    for (const k of await tx.taksitKalemi.findMany({ where: { planId: { in: planlar.map((p) => p.id) } }, select: { id: true } })) denetimIdleri.add(k.id);
    await tx.taksitKalemi.deleteMany({ where: { planId: { in: planlar.map((p) => p.id) } } });
    await tx.taksitPlani.deleteMany({ where: w });
    await tx.yaptirimEylemi.deleteMany({ where: { ...w, geriAlinanEylemId: { not: null } } });
    await tx.yaptirimEylemi.deleteMany({ where: w });
    await tx.planliEylem.deleteMany({ where: w });
    await tx.etkinlestirmeKodu.deleteMany({ where: w });
    await tx.nonceDefteri.deleteMany({ where: w });
    await tx.yoklama.deleteMany({ where: w });
    await tx.kopyaUyarisi.deleteMany({ where: w });
    await tx.tasimaTalebi.deleteMany({ where: w });
    await tx.kurulumKaydi.deleteMany({ where: w });
    await tx.kurulum.updateMany({ where: { id: { in: ids } }, data: { sonKiraId: null } });
    await tx.kira.deleteMany({ where: w });
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
