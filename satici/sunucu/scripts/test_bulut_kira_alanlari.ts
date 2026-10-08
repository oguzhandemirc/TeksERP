// =============================================================================
// KİRANIN BULUT ALANLARI + YAYINCI İNDİRME BELİRTECİ (3bc). Kira `patronBulutBitis`i ve iç API'nin
// `patronBulutBitis`i TEK yardımcıdan (`services/cloud-entitlement.ts`) doğar; `esitlemeAraligiDk` kurulum
// ayarından (varsayılan 5, 1–60 kıstırılır), iç API `saklamaAy` kurulum ayarından (varsayılan 13; null =
// tüm geçmiş). Portal girişi sınır dışını 400 ile, DB CHECK'i ham yazımı reddeder. Yayıncı belirteci
// (`anahtar.ts indirme-belirteci`) kanal × {electron, mobil}, ≤ 70 dk, kâhinden geçer.
// ⭐ KALICI SONDA ✓K2 (her koşumda): tek-kaynak taraması bozulmuş kopyada (kira `patronBulutBitis: null`
//    basıyor · iç API bitişi kendisi hesaplıyor) KIRMIZI verir — ve gerçek dosyalarda YEŞİL (§1b–§1d).
// Koşum: npx tsx scripts/test_bulut_kira_alanlari.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ENDPOINTS, parseJws, verifyDownloadToken, type LeaseDoc } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { cloudEntitlementUntil, leaseSyncMinutes } from "../src/services/cloud-entitlement";
import { PUBLISHER_INSTALLATION_ID, publisherTokens } from "../src/keys/publisher-token";
import {
  SATICI_KOKU,
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kontrol,
  kurulumFiksturu,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
  yoklamaGovdesi,
  type AnahtarOrtami,
  type Yanit,
} from "./lib/test-ortam";
// Bekçi/koşucu gerçek Anahtar Zinciri'ne GİTMEZ: parola okuyan araçlar kasa yerine stdin/dosya kullanır (scripts/lib/parola-kasasi.mjs).
process.env.TEKSERP_PAROLA_KASASI = "kapali";

const SUNUCU = SATICI_KOKU;
const oku = (rel: string): string => readFileSync(path.join(SUNUCU, rel), "utf8");

/** Tek-kaynak ihlalleri: kira ve iç API yardımcıyı çağırmalı, bitişi/modül anahtarını kendisi yazmamalı. */
export function singleSourceViolations(files: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  const lease = files["src/services/lease.service.ts"] ?? "";
  const internal = files["src/services/internal-api.service.ts"] ?? "";
  if (!/from "\.\/cloud-entitlement"/.test(lease) || !/leaseCloudFields\(/.test(lease)) out.push("lease.service: leaseCloudFields çağrılmıyor");
  if (/patronBulutBitis:\s*null|esitlemeAraligiDk:\s*null/.test(lease)) out.push("lease.service: bulut alanı sabit null");
  if (!/from "\.\/cloud-entitlement"/.test(internal) || !/cloudEntitlementUntil\(/.test(internal)) out.push("internal-api: cloudEntitlementUntil çağrılmıyor");
  for (const [rel, text] of Object.entries(files)) {
    if (rel.endsWith("cloud-entitlement.ts")) continue;
    if (/"patron-bulut"/.test(text)) out.push(`${rel}: "patron-bulut" sabiti yardımcı dışında`);
    if (/bakimBitis\.getTime\(\)/.test(text) && /gecerlilikBitis/.test(text) && /Math\.min/.test(text)) out.push(`${rel}: bitiş hesabı yardımcı dışında`);
  }
  return out;
}

function tekKaynak(): void {
  console.log("\n§1 tek kaynak — kira ve iç API aynı yardımcıdan");
  const gercek = {
    "src/services/lease.service.ts": oku("src/services/lease.service.ts"),
    "src/services/internal-api.service.ts": oku("src/services/internal-api.service.ts"),
  };
  const v = singleSourceViolations(gercek);
  kontrol("§1a ✓K gerçek dosyalar temiz", v.length === 0, v.join(" · "));
  const bozukKira = { ...gercek, "src/services/lease.service.ts": gercek["src/services/lease.service.ts"].replace("patronBulutBitis: cloud.patronBulutBitis", "patronBulutBitis: null") };
  kontrol("§1b kira bitişi sabit null → KIRMIZI (sonda)", singleSourceViolations(bozukKira).some((m) => m.includes("sabit null")));
  const kendiHesabi = `const b = Math.min(hak.bakimBitis.getTime(), hak.gecerlilikBitis?.getTime() ?? Infinity); if (m === "patron-bulut") {}`;
  const bozukIc = { ...gercek, "src/services/internal-api.service.ts": gercek["src/services/internal-api.service.ts"].replace("cloudEntitlementUntil(", "ownUntil(") + kendiHesabi };
  const b2 = singleSourceViolations(bozukIc);
  kontrol("§1c iç API bitişi kendisi hesaplıyor → KIRMIZI (sonda, üç ayak)", b2.length >= 3, b2.join(" · "));
  const bozukKira2 = { ...gercek, "src/services/lease.service.ts": gercek["src/services/lease.service.ts"].replace("leaseCloudFields(", "ownFields(") };
  kontrol("§1d kira yardımcıyı çağırmıyor → KIRMIZI (sonda)", singleSourceViolations(bozukKira2).some((m) => m.includes("leaseCloudFields")));
}

function saf(): void {
  console.log("\n§2 saf yardımcılar");
  const aralik = (v: number): number => leaseSyncMinutes({ esitlemeAraligiDk: v });
  kontrol("§2a eşitleme aralığı 1–60'a kıstırılır (999→60 · 0→1 · -5→1 · 17→17 · NaN→5)", aralik(999) === 60 && aralik(0) === 1 && aralik(-5) === 1 && aralik(17) === 17 && aralik(Number.NaN) === 5);
  const bakim = new Date("2027-01-01T00:00:00Z");
  const hak = { aktif: true, guncelSurum: 1, moduller: ["patron-bulut"], bakimBitis: bakim, gecerlilikBitis: null };
  kontrol("§2b ✓K hak + modül → bitiş = bakım", cloudEntitlementUntil(hak, [])?.getTime() === bakim.getTime());
  kontrol("§2c geçerlilik bakımdan erkense o", cloudEntitlementUntil({ ...hak, gecerlilikBitis: new Date("2026-12-01T00:00:00Z") }, [])?.toISOString() === "2026-12-01T00:00:00.000Z");
  kontrol("§2d modül yok / donmuş / imzasız / pasif / hak yok → null",
    [cloudEntitlementUntil({ ...hak, moduller: ["production.enabled"] }, []), cloudEntitlementUntil(hak, ["patron-bulut"]), cloudEntitlementUntil({ ...hak, guncelSurum: 0 }, []), cloudEntitlementUntil({ ...hak, aktif: false }, []), cloudEntitlementUntil(null, [])].every((x) => x === null));
}

function kiraOf(y: Yanit): LeaseDoc | null {
  if (y.status !== 200) return null;
  const p = parseJws(y.json.kira);
  return p.ok ? (p.value.payload as unknown as LeaseDoc) : null;
}

async function hataDurumu(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "HATA_YOK";
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return e.status ? String(e.status) : "ATILDI";
  }
}

async function kiraVeIcApi(ortam: AnahtarOrtami, temizlenecek: string[]): Promise<void> {
  const { prisma } = await import("../src/lib/prisma");
  const { readInstallationForCloud } = await import("../src/services/internal-api.service");
  const { updateInstallationTx } = await import("../src/services/master-data.service");
  const { applySanction } = await import("../src/services/sanction.service");
  const sunucu = await sunucuBaslat(ortam);
  try {
    console.log("\n§3 kira ve iç API — aynı bitiş, ayar kiraya");
    const k = await kurulumFiksturu(ortam.ctx, { moduller: ["production.enabled", "patron-bulut"] });
    temizlenecek.push(k.kurulumDbId);
    const anahtar = kurulumAnahtariUret();
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId, amac: "etkinlestir", anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: ortam.f.parmakIzi }),
    });
    let kira = kiraOf(et);
    let uc = kira?.kiraId ?? null;
    const yokla = async (): Promise<LeaseDoc | null> => {
      const y = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
        kurulumId: k.kurulumId, amac: "yokla", anahtar,
        govde: yoklamaGovdesi({ sonKiraId: uc, hak: { hakId: k.hakId, surum: 1 }, parmakIzi: ortam.f.parmakIzi }),
      });
      const l = kiraOf(y);
      if (l) uc = l.kiraId;
      return l;
    };
    const ic = await readInstallationForCloud(prisma, k.kurulumId);
    const hak = await prisma.hak.findFirst({ where: { kurulumId: k.kurulumDbId, aktif: true } });
    kontrol("§3a ✓K kira patronBulutBitis = iç API = bakım bitişi", !!kira && kira.patronBulutBitis !== null && kira.patronBulutBitis === ic?.patronBulutBitis && kira.patronBulutBitis === hak?.bakimBitis.toISOString(), `${kira?.patronBulutBitis} / ${ic?.patronBulutBitis}`);
    kontrol("§3b varsayılan: eşitleme 5 dk · saklama 13 ay", kira?.esitlemeAraligiDk === 5 && ic?.saklamaAy === 13, `${kira?.esitlemeAraligiDk} / ${ic?.saklamaAy}`);
    await prisma.$transaction((tx) => updateInstallationTx(tx, { installationDbId: k.kurulumDbId, syncMinutes: 17, cloudRetentionMonths: 25, actor: "bekci" }));
    kira = await yokla();
    const ic2 = await readInstallationForCloud(prisma, k.kurulumId);
    kontrol("§3c portal ayarı → kira 17 dk · iç API 25 ay", kira?.esitlemeAraligiDk === 17 && ic2?.saklamaAy === 25, `${kira?.esitlemeAraligiDk} / ${ic2?.saklamaAy}`);
    await prisma.$transaction((tx) => updateInstallationTx(tx, { installationDbId: k.kurulumDbId, cloudRetentionMonths: null, actor: "bekci" }));
    kontrol("§3d tüm geçmiş → saklamaAy null", (await readInstallationForCloud(prisma, k.kurulumId))?.saklamaAy === null);
    const g = (v: Record<string, unknown>) => hataDurumu(() => prisma.$transaction((tx) => updateInstallationTx(tx, { installationDbId: k.kurulumDbId, actor: "bekci", ...v })));
    const red = [await g({ syncMinutes: 0 }), await g({ syncMinutes: 61 }), await g({ syncMinutes: 2.5 }), await g({ cloudRetentionMonths: 12 })];
    kontrol("§3e portal sınır dışı → 400 (0 · 61 · 2,5 dk · 12 ay)", red.every((x) => x === "400"), red.join(","));
    const ham = [
      await hataDurumu(() => prisma.kurulum.update({ where: { id: k.kurulumDbId }, data: { esitlemeAraligiDk: 61 } })),
      await hataDurumu(() => prisma.kurulum.update({ where: { id: k.kurulumDbId }, data: { bulutSaklamaAy: 7 } })),
    ];
    kontrol("§3f DB CHECK ham yazımı reddeder (61 dk · 7 ay)", ham.every((x) => x === "ATILDI"), ham.join(","));
    await applySanction({ installationDbId: k.kurulumDbId, level: "K2", modules: ["patron-bulut"], reason: "bekçi: bulut dondur", actor: "bekci" });
    kira = await yokla();
    const ic3 = await readInstallationForCloud(prisma, k.kurulumId);
    kontrol("§3g K2 patron-bulut dondurma → kira ve iç API bitişi null (aralık kalır)", kira?.patronBulutBitis === null && ic3?.patronBulutBitis === null && kira?.esitlemeAraligiDk === 17, `${kira?.patronBulutBitis} / ${ic3?.patronBulutBitis}`);
    const b = await kurulumFiksturu(ortam.ctx, { tesisId: k.tesisId, musteriId: k.musteriId });
    temizlenecek.push(b.kurulumDbId);
    const anahtar2 = kurulumAnahtariUret();
    const et2 = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: b.kurulumId, amac: "etkinlestir", anahtar: anahtar2,
      govde: etkinlestirmeGovdesi({ kod: b.kod, kurulumId: b.kurulumId, anahtar: anahtar2, parmakIzi: ortam.f.parmakIzi }),
    });
    const kb = kiraOf(et2);
    kontrol("§3h ✓K bulut hakkı olmayan kurulum: bitiş null, aralık yine ayardan", !!kb && kb.patronBulutBitis === null && kb.esitlemeAraligiDk === 5, `${kb?.patronBulutBitis} ${kb?.esitlemeAraligiDk}`);
  } finally {
    await sunucu.durdur();
  }
}

async function yayinci(ortam: AnahtarOrtami, cliDizin: string): Promise<void> {
  console.log("\n§4 yayıncı indirme belirteci");
  const now = Date.now();
  const anahtarlar = [{ kid: ortam.f.ind.kid, x: ortam.f.ind.x }];
  const t = publisherTokens(ortam.ctx.keys, { channels: ["testfabrika", "adnansahin", "testfabrika"], minutes: 60, nowMs: now });
  const onekler = t.map((x) => x.yolOneki).sort().join(",");
  kontrol("§4a ✓K kanal × {electron, mobil, backend}, tekrarlı kanal tekilleşir", onekler === "/adnansahin/backend/,/adnansahin/electron/,/adnansahin/mobil/,/testfabrika/backend/,/testfabrika/electron/,/testfabrika/mobil/", onekler);
  const dog = t.map((x) => verifyDownloadToken(x.belirtec, { keys: anahtarlar, nowMs: now }));
  kontrol("§4b ✓K hepsi kâhinden geçer, yayıncı kimliği, yol öneki belgeyle aynı", dog.every((d, i) => d.ok && d.value.kurulumId === PUBLISHER_INSTALLATION_ID && d.value.yolOneki === t[i]!.yolOneki));
  const at = (fn: () => unknown): boolean => { try { fn(); return false; } catch { return true; } };
  kontrol("§4c ömür 71 dk · 0 dk · kanal biçimsiz · kanalsız → RED",
    at(() => publisherTokens(ortam.ctx.keys, { channels: ["x"], minutes: 71, nowMs: now })) && at(() => publisherTokens(ortam.ctx.keys, { channels: ["x"], minutes: 0, nowMs: now })) &&
    at(() => publisherTokens(ortam.ctx.keys, { channels: ["Kötü Kanal"], minutes: 5, nowMs: now })) && at(() => publisherTokens(ortam.ctx.keys, { channels: [], minutes: 5, nowMs: now })));
  const cli = (argv: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/anahtar.ts", "indirme-belirteci", ...argv], {
    cwd: SUNUCU, encoding: "utf8", timeout: 60_000, env: { ...process.env, GUVEN_CAPASI_DOSYASI: ortam.capaDosyasi, ANAHTAR_DIZINI: cliDizin },
  });
  const r = cli(["--kanal=testfabrika", "--dk=5"]);
  let json: { v?: number; belirtecler?: { yolOneki: string; belirtec: string }[] } = {};
  try { json = JSON.parse(r.stdout) as typeof json; } catch { json = {}; }
  const cliOk = r.status === 0 && json.v === 1 && json.belirtecler?.length === 3 && json.belirtecler.every((b) => verifyDownloadToken(b.belirtec, { keys: anahtarlar, nowMs: Date.now() }).ok);
  kontrol("§4d ✓K CLI indirme-belirteci → tek satır JSON, üç belirteç (electron · mobil · backend) kâhinden geçer", cliOk, `${r.status} ${r.stderr.slice(0, 160)}`);
  const r71 = cli(["--kanal=testfabrika", "--dk=71"]);
  const rYok = cli([]);
  kontrol("§4e CLI ömür 71 dk / kanalsız → çıkış 2, stdout'ta belirteç yok", r71.status === 2 && rYok.status === 2 && !r71.stdout.includes("ey") && !rYok.stdout.includes("ey"), `${r71.status} ${rYok.status}`);
}

interface YayinOkuma {
  belirtecOku(url?: string): string;
  indirmeBasliklari(url?: string): Record<string, string>;
  BelirtecYok: new (...a: unknown[]) => Error;
}

async function yayinKaynagi(ortam: AnahtarOrtami, cliDizin: string): Promise<void> {
  console.log("\n§5 yayın betiği belirteç kaynağı (scripts/lib/yayin-okuma.mjs)");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "yayin-kaynak-"));
  const kaynak = path.join(tmp, "kaynak.json");
  const dosya = path.join(tmp, "belirtec");
  const ENV = ["TEKSERP_YAYIN_BELIRTEC_KAYNAGI", "TEKSERP_YAYIN_BELIRTECI", "GUVEN_CAPASI_DOSYASI"] as const;
  const eski = ENV.map((k) => process.env[k]);
  process.env.TEKSERP_YAYIN_BELIRTEC_KAYNAGI = kaynak;
  process.env.TEKSERP_YAYIN_BELIRTECI = dosya;
  process.env.GUVEN_CAPASI_DOSYASI = ortam.capaDosyasi;
  try {
    const yo = (await import(pathToFileURL(path.resolve(SATICI_KOKU, "..", "..", "scripts", "lib", "yayin-okuma.mjs")).href)) as YayinOkuma;
    const anahtarlar = [{ kid: ortam.f.ind.kid, x: ortam.f.ind.x }];
    const dogrula = (t: string) => verifyDownloadToken(t, { keys: anahtarlar, nowMs: Date.now() });
    const yok = (fn: () => unknown): boolean => { try { fn(); return false; } catch (e) { return e instanceof yo.BelirtecYok; } };
    const DOSYA = "d".repeat(40);
    writeFileSync(dosya, DOSYA, { mode: 0o600 });
    kontrol("§5a ✓K kaynak yapılandırılmamış → dosya belirteci (bugünkü davranış)", yo.belirtecOku("https://g.test/testfabrika/electron/latest.yml") === DOSYA);
    writeFileSync(kaynak, JSON.stringify({ tur: "yerel", dizin: cliDizin }), { mode: 0o600 });
    const e = yo.belirtecOku("https://g.test/testfabrika/electron/latest.yml");
    const m = yo.belirtecOku("/testfabrika/mobil/ota/1.0.0/manifest");
    const de = dogrula(e);
    const dm = dogrula(m);
    kontrol("§5b ✓K yerel CLI: adresin önekine taze belirteç (electron · mobil), dosya belirteci kullanılmaz",
      e !== DOSYA && de.ok && de.value.yolOneki === "/testfabrika/electron/" && dm.ok && dm.value.yolOneki === "/testfabrika/mobil/");
    kontrol("§5c aynı önek ikinci okumada aynı belirteç (önbellek) · başlık X-TKL-Indirme", yo.belirtecOku("/testfabrika/electron/TeksERP.exe") === e && yo.indirmeBasliklari("/testfabrika/electron/latest.yml")["X-TKL-Indirme"] === e);
    kontrol("§5d kanal/ürün öneki dışı adres ya da adressiz → DUR", yok(() => yo.belirtecOku("/testfabrika/baska/x")) && yok(() => yo.belirtecOku()));
    writeFileSync(kaynak, JSON.stringify({ tur: "yerel", dizin: path.join(tmp, "olmayan") }), { mode: 0o600 });
    kontrol("§5e yapılandırılmış CLI üretemiyor → DUR (dosyaya DÜŞMEZ)", yok(() => yo.belirtecOku("/adnansahin/electron/latest.yml")));
    writeFileSync(kaynak, JSON.stringify({ tur: "http", adres: "x" }), { mode: 0o600 });
    const tanimsiz = yok(() => yo.belirtecOku("/adnansahin/electron/latest.yml"));
    writeFileSync(kaynak, JSON.stringify({ tur: "ssh", hedef: "h", komut: "x; rm -rf /" }), { mode: 0o600 });
    const enjeksiyon = yok(() => yo.belirtecOku("/adnansahin/electron/latest.yml"));
    rmSync(kaynak);
    writeFileSync(kaynak, JSON.stringify({ tur: "yerel", dizin: cliDizin }), { mode: 0o644 });
    const gevsek = yok(() => yo.belirtecOku("/adnansahin/electron/latest.yml"));
    kontrol("§5f tanınmayan tür · kabuk karakterli uzak komut · 0644 kaynak dosyası → DUR", tanimsiz && enjeksiyon && gevsek, `${tanimsiz}/${enjeksiyon}/${gevsek}`);
  } finally {
    ENV.forEach((k, i) => (eski[i] === undefined ? delete process.env[k] : (process.env[k] = eski[i])));
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  hedefDbKapisi();
  tekKaynak();
  saf();
  const ortam = await anahtarOrtamiKur();
  const temizlenecek: string[] = [];
  // Yayıncı CLI'ı dosya çapasını yalnız kip çözülmezken alır; fikstürün `kok-*` kökleri kipi `uretim`e çözerdi
  // (üretim dosya çapası reddeder) → CLI köksüz kopyayı okur (İNDİRME anahtarı kök dosyası istemez).
  const cliDizin = mkdtempSync(path.join(os.tmpdir(), "satici-yayinci-"));
  for (const ad of readdirSync(ortam.dizin)) if (!ad.endsWith(".kok.json")) cpSync(path.join(ortam.dizin, ad), path.join(cliDizin, ad), { recursive: true });
  try {
    await kiraVeIcApi(ortam, temizlenecek);
    await yayinci(ortam, cliDizin);
    await yayinKaynagi(ortam, cliDizin);
  } finally {
    await temizleKurulumlar(temizlenecek, ortam.kidler);
    rmSync(cliDizin, { recursive: true, force: true });
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

void main();
