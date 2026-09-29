// Patron bulutu bekçilerinin ortak ortamı. `test_` öneki yok → koşucu bunu bekçi saymaz.
//   · Hedef DB kapısı (FAIL-CLOSED allowlist): göç URL'inin DB adı `_test` ile bitmeli, `tekserp_fabrika_*` ASLA.
//   · Roller her koşumda hizalanır (`scripts/db-rolleri.ts` — idempotent); sunucu SÜREÇ İÇİNDE port 0'da
//     kalkar, saat ENJEKTE edilir (TOTP adımı, claim süresi, saklama). Gerçek süreç açılışı ayrıca ölçülür.
//   · Kurulum anahtarları çalışma anında üretilir (Ed25519); src'ye/diske anahtar yazılmaz.
//   · Her bekçi kendi rastgele tesisini açar ve `temizleTesis` ile siler (başka bekçinin satırına dokunmaz).
import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { LicenseClass } from "@prisma/client";
import { SecretBox } from "../../src/auth/secret-box";
import { hotp, totpStep } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { createApp } from "../../src/http/app";
import { closeDatabase, createDatabase, type Database } from "../../src/lib/db";
import { loadEnvFile } from "../../src/lib/env";
import { withTesis } from "../../src/lib/tenant";
import { REQUEST_HEADER, publicKeyX, signRequest } from "../../src/lisans-protokol";
import type { CloudContext } from "../../src/services/context";
import type { Doorbell, DoorbellTopic } from "../../src/services/doorbell";
import { InstallationDirectory } from "../../src/services/installation-directory";
import { inviteFacilityAdmin, openFacility, registerInstallation } from "../../src/services/vendor-admin.service";
import { acceptInvite, confirmInvite } from "../../src/auth/invite.service";
import { applyRoles } from "../db-rolleri";

export const PATRON_KOKU = path.resolve(__dirname, "..", "..");

let gecti = 0;
let kaldi = 0;
export function kontrol(ad: string, kosul: boolean, ayrinti = ""): void {
  if (kosul) gecti++;
  else kaldi++;
  console.log(`  ${kosul ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
}
export function sonuc(): never {
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
  process.exit(kaldi > 0 ? 1 : 0);
}

/** DB adı: `_test` ile bitmeli, fabrika verisi sınıfı (`tekserp_fabrika_*`) ASLA. */
export function hedefDbKapisi(): string {
  loadEnvFile();
  const url = process.env.GOC_DATABASE_URL ?? "";
  let ad = "";
  try {
    ad = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    ad = "";
  }
  if (!ad || !ad.endsWith("_test") || ad.startsWith("tekserp_fabrika_")) {
    console.error(`⛔ Hedef DB kapısı: "${ad || "?"}" bekçi hedefi olamaz (yalnız *_test; fabrika verisi asla)`);
    process.exit(2);
  }
  return ad;
}

/** Enjekte saat: `simdi` her çağrıda aynı değeri döner; `ilerlet` ile kaydırılır. */
export class Saat {
  constructor(private ms: number = Date.now()) {}
  simdi = (): number => this.ms;
  ilerlet(ms: number): void {
    this.ms += ms;
  }
  ayarla(ms: number): void {
    this.ms = ms;
  }
}

export class KayitliZil implements Doorbell {
  readonly caldi: { tesisId: string; konu: DoorbellTopic }[] = [];
  ring(tesisId: string, konu: DoorbellTopic): void {
    this.caldi.push({ tesisId, konu });
  }
}

export interface Ortam {
  readonly ctx: CloudContext;
  readonly goc: Database;
  readonly app: Database;
  readonly sync: Database;
  readonly saat: Saat;
  readonly zil: KayitliZil;
  readonly adres: string;
  kapat(): Promise<void>;
}

export async function ortamKur(ekOrtam: Record<string, string> = {}, fetchImpl?: typeof fetch, doorbell?: Doorbell): Promise<Ortam> {
  hedefDbKapisi();
  await applyRoles(process.env);
  const dizin = mkdtempSync(path.join(os.tmpdir(), "patron-bekci-"));
  const config = loadConfig({ ...process.env, ANAHTAR_DIZINI: dizin, ...ekOrtam }, PATRON_KOKU);
  const goc = createDatabase(process.env.GOC_DATABASE_URL!, "goc", 4);
  const app = createDatabase(config.DATABASE_URL, "uygulama", 6);
  const sync = createDatabase(config.ESITLEME_DATABASE_URL, "esitleme", 6);
  const saat = new Saat();
  const zil = new KayitliZil();
  const ctx: CloudContext = {
    config,
    app: app.prisma,
    sync: sync.prisma,
    secrets: SecretBox.load(dizin, { create: true }),
    directory: new InstallationDirectory(sync.prisma, config, fetchImpl),
    doorbell: doorbell ?? zil,
    now: saat.simdi,
  };
  const server = http.createServer(createApp(ctx));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const adres = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    ctx,
    goc,
    app,
    sync,
    saat,
    zil,
    adres,
    kapat: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await closeDatabase(app);
      await closeDatabase(sync);
      await closeDatabase(goc);
      rmSync(dizin, { recursive: true, force: true });
    },
  };
}

export interface TestKurulumu {
  readonly tesisId: string;
  readonly kurulumId: string;
  readonly privateKey: KeyObject;
  readonly acikAnahtar: string;
}

export async function tesisKur(
  o: Ortam,
  g: { sinif?: LicenseClass; patronBulut?: boolean; bitis?: Date | null; saklamaAy?: number | null; ad?: string } = {},
): Promise<TestKurulumu> {
  const tesisId = randomUUID();
  const kurulumId = randomUUID();
  const { privateKey } = generateKeyPairSync("ed25519");
  const acikAnahtar = publicKeyX(privateKey);
  await openFacility(o.goc.prisma, { tesisId, name: g.ad ?? `Bekçi Tesisi ${tesisId.slice(0, 8)}`, ...(g.saklamaAy === undefined ? {} : { retentionMonths: g.saklamaAy }) });
  await ekKurulum(o, tesisId, { kurulumId, privateKey, sinif: g.sinif, patronBulut: g.patronBulut, bitis: g.bitis });
  return { tesisId, kurulumId, privateKey, acikAnahtar };
}

export async function ekKurulum(
  o: Ortam,
  tesisId: string,
  g: { kurulumId?: string; privateKey?: KeyObject; sinif?: LicenseClass; patronBulut?: boolean; bitis?: Date | null },
): Promise<TestKurulumu> {
  const kurulumId = g.kurulumId ?? randomUUID();
  const privateKey = g.privateKey ?? generateKeyPairSync("ed25519").privateKey;
  const acikAnahtar = publicKeyX(privateKey);
  await registerInstallation(
    o.goc.prisma,
    {
      tesisId,
      installationId: kurulumId,
      publicKeyX: acikAnahtar,
      licenseClass: g.sinif ?? "URETIM",
      modules: g.patronBulut === false ? ["production.enabled"] : ["production.enabled", "patron-bulut"],
      cloudUntil: g.bitis === undefined ? new Date(o.saat.simdi() + 365 * 86_400_000) : g.bitis,
    },
    o.saat.simdi(),
  );
  return { tesisId, kurulumId, privateKey, acikAnahtar };
}

export const TEST_PAROLASI = "bekci-bulut-parolasi-2026";

export interface TestHesabi {
  readonly accountId: string;
  readonly eposta: string;
  readonly sir: string;
  belirtec: string;
}

/** TOTP kodu (verilen anda); aynı adımı ikinci kez kullanmamak için saat ≥ 30 sn ilerletilir. */
export function totpKodu(sir: string, ms: number): string {
  return hotp(sir, totpStep(ms));
}

/** Hesap: satıcı daveti → kabul → onay → giriş (gerçek servis yolu). İzinler sonradan GÖÇ rolüyle ayarlanır. */
export async function hesapKur(o: Ortam, tesisId: string, izinler: readonly string[]): Promise<TestHesabi> {
  const eposta = `bekci-${randomUUID().slice(0, 12)}@ornek.test`;
  const davet = await inviteFacilityAdmin(o.goc.prisma, { tesisId, email: eposta, name: "Bekçi Hesabı", validHours: 24 }, o.saat.simdi());
  const kabul = await acceptInvite(o.ctx, { token: davet.token, password: TEST_PAROLASI });
  o.saat.ilerlet(31_000);
  await confirmInvite(o.ctx, { token: davet.token, totp: totpKodu(kabul.totpSirri, o.saat.simdi()) });
  await withTesis(o.goc.prisma, { tesisId }, (tx) => tx.account.update({ where: { id: davet.accountId }, data: { permissions: [...izinler] } }));
  const hesap: TestHesabi = { accountId: davet.accountId, eposta, sir: kabul.totpSirri, belirtec: "" };
  hesap.belirtec = await girisYap(o, hesap);
  return hesap;
}

export async function girisYap(o: Ortam, h: Pick<TestHesabi, "eposta" | "sir">): Promise<string> {
  o.saat.ilerlet(31_000);
  const r = await api(o, "POST", "/api/oturum/ac", { govde: { eposta: h.eposta, parola: TEST_PAROLASI, totp: totpKodu(h.sir, o.saat.simdi()) } });
  if (r.status !== 200) throw new Error(`giriş başarısız: ${r.status} ${JSON.stringify(r.json)}`);
  return (r.json.data as { belirtec: string }).belirtec;
}

export interface Yanit {
  readonly status: number;
  readonly json: { success: boolean; data?: unknown; message?: string; details?: { code?: string } & Record<string, unknown> };
  readonly headers: Headers;
}

export async function api(o: Ortam, method: string, yol: string, g: { belirtec?: string; govde?: unknown } = {}): Promise<Yanit> {
  const res = await fetch(`${o.adres}${yol}`, {
    method,
    headers: { ...(g.belirtec ? { Authorization: `Bearer ${g.belirtec}` } : {}), ...(g.govde !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(g.govde !== undefined ? { body: JSON.stringify(g.govde) } : {}),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Yanit["json"]) : { success: false }, headers: res.headers };
}

/** Kurulum imzalı fabrika isteği (`amac: esitle`). `ham` verilirse gövde aynen gider (gzip dahil). */
export async function imzali(
  o: Ortam,
  k: Pick<TestKurulumu, "kurulumId" | "privateKey">,
  yol: string,
  g: { govde?: unknown; ham?: Buffer; gzip?: boolean; baslik?: string; nowMs?: number } = {},
): Promise<Yanit & { baslik: string; ham: Buffer }> {
  const json = g.ham ?? Buffer.from(JSON.stringify(g.govde ?? {}), "utf8");
  const ham = g.gzip ? gzipSync(json) : json;
  const baslik = g.baslik ?? signRequest({ installationId: k.kurulumId, purpose: "esitle", body: ham, key: { privateKey: k.privateKey, nowMs: g.nowMs ?? o.saat.simdi() } });
  const res = await fetch(`${o.adres}${yol}`, {
    method: "POST",
    headers: { [REQUEST_HEADER]: baslik, "Content-Type": "application/json", ...(g.gzip ? { "Content-Encoding": "gzip" } : {}) },
    body: new Uint8Array(ham),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Yanit["json"]) : { success: false }, headers: res.headers, baslik, ham };
}

/** Test tesisinin bütün satırları (çocuktan ebeveyne). Yalnız `_test` DB'de, yalnız bekçinin kendi tesisi. */
export async function temizleTesis(o: Ortam, tesisId: string): Promise<void> {
  await withTesis(o.goc.prisma, { tesisId }, async (tx) => {
    await tx.session.deleteMany({ where: { tesisId } });
    await tx.pushDevice.deleteMany({ where: { tesisId } });
    await tx.accountAudit.deleteMany({ where: { tesisId } });
    await tx.operationReceipt.deleteMany({ where: { tesisId } });
    await tx.inboxMessage.deleteMany({ where: { tesisId } });
    await tx.reportRequest.deleteMany({ where: { tesisId } });
    await tx.$executeRaw`DELETE FROM report_results WHERE tesis_id = ${tesisId}::uuid`;
    await tx.$executeRaw`DELETE FROM projection_rows WHERE tesis_id = ${tesisId}::uuid`;
    await tx.syncWatermark.deleteMany({ where: { tesisId } });
    await tx.packageReceipt.deleteMany({ where: { tesisId } });
    await tx.syncState.deleteMany({ where: { tesisId } });
    await tx.fullSyncRun.deleteMany({ where: { tesisId } });
    await tx.requestNonce.deleteMany({ where: { tesisId } });
    await tx.account.deleteMany({ where: { tesisId } });
    await tx.installation.deleteMany({ where: { tesisId } });
    await tx.facility.deleteMany({ where: { tesisId } });
  });
}

/** Anahtar sırasından bağımsız JSON (jsonb saklı yanıt anahtarları yeniden sıralar; anlam aynı). */
export function kanonik(value: unknown): string {
  const sirala = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sirala);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sirala((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sirala(value));
}

/** Eşitleme paketi iskeleti (sözleşme §6.2). */
export function paket(k: Pick<TestKurulumu, "kurulumId">, g: { ufuk: Date; kayitlar?: unknown[]; anliklar?: unknown[]; uzlastirma?: unknown[]; paketId?: string; sozlesme?: number; tur?: string }) {
  return {
    v: 1,
    sozlesme: g.sozlesme ?? 1,
    paketId: g.paketId ?? randomUUID(),
    kurulumId: k.kurulumId,
    tur: g.tur ?? "ARTIMLI",
    ufuk: g.ufuk.toISOString(),
    uretimBilgisi: { uygulamaSurum: "2.12.0", katalogSurum: 1 },
    kayitlar: g.kayitlar ?? [],
    anliklar: g.anliklar ?? [],
    uzlastirma: g.uzlastirma ?? [],
  };
}

export function girdi(projeksiyon: string, g: { yaz?: Record<string, unknown>[]; sil?: { id: string; neden: string }[]; onceki?: { t: string; k: string } | null; yeni: { t: string; k: string }; tam?: unknown; katalogSurum?: number }) {
  return {
    projeksiyon,
    katalogSurum: g.katalogSurum ?? 1,
    yaz: g.yaz ?? [],
    sil: g.sil ?? [],
    filigran: { onceki: g.onceki ?? null, yeni: g.yeni },
    tam: g.tam ?? null,
  };
}
