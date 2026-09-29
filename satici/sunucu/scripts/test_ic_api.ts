// =============================================================================
// SATICI İÇ API'Sİ — patron bulutunun kurulum dizini (`GET /ic/v1/kurulum/:id`) ve zili (`POST /ic/v1/zil`)
// (sözleşme PATRON-BULUTU-ESITLEME §17). Kapı FAIL-CLOSED ve üç koşullu: iç dinleyicinin soketi + kaynak
// ağı (IC_KAYNAK_AGLARI; yoksa yalnız geri döngü) → değilse 404 · Bearer ortak sır (dosyadan, sabit zamanlı)
// → değilse 401 IC_KIMLIK_GECERSIZ. Sır yoksa/zayıfsa/herkese açıksa iç dinleyici HİÇ AÇILMAZ. Genel ve
// tailnet dinleyicileri /ic/* yolunu bilmez (404). Kimlik = portalda doğan LİSANS kimliği (D14); satıcı DB
// kimliği eşleşmez. Yanıt ALLOWLIST (katı şema): müşteri/lisans no/parmak izi/öteki modüller ÇIKMAZ.
// Zil: konu yalnız {gelen-kutusu, rapor, ozet}; hedef tesisin ETKİN ÜRETİM kurulumları; kurulum başına hız
// sınırı. Çağrılar denetime SAYAÇLA (pencere başına tek satır) yazılır.
// ⭐ KALICI SONDA ✓K3 (her koşumda): katı şema sentetik fazla üst alanı, tesis altındaki fazla alanı ve
//    patron-bulut dışı modülü REDDEDER (§3b–§3d) — ve doğru yanıtı GEÇİRİR (§3a); kapı doğru soket + kaynak +
//    sırla GEÇİRİR (§4c, §5a; her şeyi reddeden kör kapı da 404/401 yeşili verirdi).
// Koşum: npx tsx scripts/test_ic_api.ts
// =============================================================================
import { randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { ENDPOINTS } from "../src/lisans-protokol";
import { kurulumAnahtariUret, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { loadConfig } from "../src/config";
import { createInternalApp } from "../src/http/internal-app";
import { InternalBearer, loadInternalBearer } from "../src/lib/internal-bearer";
import { InternalApiCounters, InternalInstallationSchema } from "../src/services/internal-api.service";
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
  zilAboneOl,
  type AnahtarOrtami,
  type KurulumFiksturu,
} from "./lib/test-ortam";

/** Sözleşmenin allowlist'i — yanıtın anahtar kümesi BİREBİR bu olmalı. */
const IZINLI_ALANLAR = ["v", "kurulumId", "tesis", "acikAnahtar", "anahtarKimligi", "durum", "sinif", "moduller", "patronBulutBitis", "devredildi", "aktif"].sort();

interface Cevap {
  readonly status: number;
  readonly json: Record<string, unknown>;
  readonly metin: string;
  readonly kod: string | undefined;
}

async function istek(url: string, g: { yontem?: string; bearer?: string | null; govde?: unknown } = {}): Promise<Cevap> {
  const r = await fetch(url, {
    method: g.yontem ?? "GET",
    headers: {
      ...(g.bearer ? { Authorization: `Bearer ${g.bearer}` } : {}),
      ...(g.govde !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(g.govde !== undefined ? { body: JSON.stringify(g.govde) } : {}),
  });
  const metin = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(metin) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: r.status, json, metin, kod: (json.details as { code?: string } | undefined)?.code };
}

function sirDosyasi(ortam: AnahtarOrtami, ad: string, icerik: string, mod: number): string {
  const yol = path.join(ortam.dizin, ad);
  writeFileSync(yol, icerik, { mode: mod });
  chmodSync(yol, mod);
  return yol;
}

async function etkinlestir(genel: string, ortam: AnahtarOrtami, k: KurulumFiksturu): Promise<TestAnahtari> {
  const anahtar = kurulumAnahtariUret();
  const et = await imzaliPost(genel, ENDPOINTS.ACTIVATE, {
    kurulumId: k.kurulumId,
    amac: "etkinlestir",
    anahtar,
    govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: ortam.f.parmakIzi }),
  });
  if (et.status !== 200) throw new Error(`etkinleştirme ${et.status} ${et.kod}`);
  return anahtar;
}

function birimSondalari(ortam: AnahtarOrtami, sir: string): void {
  console.log("\n§1 yapılandırma ve sır yükleme (fail-closed)");
  const at = (env: Record<string, string>): boolean => {
    try {
      loadConfig({ DATABASE_URL: "x", ...env }, SATICI_KOKU);
      return false;
    } catch {
      return true;
    }
  };
  kontrol("§1a IC_BIND joker adres (0.0.0.0) açılışta RED", at({ IC_BIND: "0.0.0.0" }));
  kontrol("§1b IC_KAYNAK_AGLARI biçimsiz CIDR açılışta RED", at({ IC_KAYNAK_AGLARI: "10.0.0.0/33" }));
  kontrol("§1c ✓K geçerli IC_BIND + IC_KAYNAK_AGLARI kabul", !at({ IC_BIND: "172.30.9.2", IC_KAYNAK_AGLARI: "172.30.9.3/32" }));
  kontrol("§1d sır dosyası verilmedi → kapalı", !loadInternalBearer(undefined).ok);
  kontrol("§1e sır dosyası yok → kapalı", !loadInternalBearer(path.join(ortam.dizin, "olmayan")).ok);
  kontrol("§1f herkese açık (0644) sır → kapalı", !loadInternalBearer(sirDosyasi(ortam, "acik.belirtec", sir, 0o644)).ok);
  kontrol("§1g kısa (31) sır → kapalı", !loadInternalBearer(sirDosyasi(ortam, "kisa.belirtec", "a".repeat(31), 0o600)).ok);
  kontrol("§1h boşluklu sır → kapalı", !loadInternalBearer(sirDosyasi(ortam, "bosluk.belirtec", `${"a".repeat(20)} ${"b".repeat(20)}`, 0o600)).ok);
  const iyi = loadInternalBearer(sirDosyasi(ortam, "iyi.belirtec", `${sir}\n`, 0o640));
  kontrol("§1i ✓K 0640 + satır sonlu geçerli sır → açık", iyi.ok);
  const nedenler = [loadInternalBearer(sirDosyasi(ortam, "sizinti.belirtec", `${sir} x`, 0o600))].map((r) => (r.ok ? "" : r.reason)).join();
  kontrol("§1j ret nedeni sırrı İÇERMEZ", !nedenler.includes(sir.slice(0, 12)), nedenler);

  console.log("\n§2 Bearer karşılaştırması");
  const b = InternalBearer.fromSecret(sir);
  kontrol("§2a ✓K doğru `Bearer <sır>` eşleşir", b.matches(`Bearer ${sir}`));
  const tekHarfFarkli = `${sir.slice(0, -1)}${sir.endsWith("x") ? "y" : "x"}`;
  kontrol("§2b yanlış sır (tek harf farklı) eşleşmez", !b.matches(`Bearer ${tekHarfFarkli}`));
  kontrol("§2c eksik başlık eşleşmez", !b.matches(undefined) && !b.matches(""));
  kontrol("§2d küçük harf şema / çift boşluk / Basic eşleşmez", !b.matches(`bearer ${sir}`) && !b.matches(`Bearer  ${sir}`) && !b.matches(`Basic ${sir}`));
  kontrol("§2e dizi başlık eşleşmez", !b.matches([`Bearer ${sir}`]));

  console.log("\n§3 ✓K yanıt allowlist'i katı şemadır");
  const ornek = {
    v: 1,
    kurulumId: "3f0c2b1e-5a5d-4c1e-9d36-6f0c2b1e5a5d",
    tesis: { id: "4f0c2b1e-5a5d-4c1e-9d36-6f0c2b1e5a5d", ad: "Merkez" },
    acikAnahtar: null,
    anahtarKimligi: null,
    durum: "ETKINLESMEDI",
    sinif: "URETIM",
    moduller: [],
    patronBulutBitis: null,
    devredildi: false,
    aktif: true,
  };
  kontrol("§3a ✓K sözleşmeli yanıt şemadan geçer", InternalInstallationSchema.safeParse(ornek).success);
  kontrol("§3b fazla üst alan (musteri) RED", !InternalInstallationSchema.safeParse({ ...ornek, musteri: { ad: "X" } }).success);
  kontrol("§3c tesis altında fazla alan (vergiNo) RED", !InternalInstallationSchema.safeParse({ ...ornek, tesis: { ...ornek.tesis, vergiNo: "1" } }).success);
  kontrol("§3d patron-bulut dışı modül RED", !InternalInstallationSchema.safeParse({ ...ornek, moduller: ["finance.enabled"] }).success);
  kontrol("§3e allowlist sabiti şemanın anahtarlarıyla aynı", JSON.stringify(Object.keys(InternalInstallationSchema.shape).sort()) === JSON.stringify(IZINLI_ALANLAR));
}

function dinle(server: http.Server): Promise<AddressInfo> {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address() as AddressInfo)));
}

/** Soket koşulu gerçekten okunuyor mu: AYNI uygulama başka bir soketi "kendi" sanınca 404, doğrusunda geçer. */
async function soketSondasi(ortam: AnahtarOrtami, sir: string, k: KurulumFiksturu): Promise<void> {
  console.log("\n§4 soket ve kaynak ağı kapısı (süreç içi)");
  const bearer = InternalBearer.fromSecret(sir);
  const baska: AddressInfo = { address: "127.0.0.1", family: "IPv4", port: 1 };
  const kur = async (sahte: boolean, aglar?: string[]) => {
    const ctx = aglar ? { ...ortam.ctx, config: { ...ortam.ctx.config, IC_KAYNAK_AGLARI: aglar } } : ortam.ctx;
    let adres: AddressInfo | null = null;
    const s = http.createServer(createInternalApp(ctx, { bearer, counters: new InternalApiCounters(), listener: () => (sahte ? baska : adres) }));
    adres = await dinle(s);
    return { s, url: `http://127.0.0.1:${adres.port}` };
  };
  const yol = `/ic/v1/kurulum/${k.kurulumId}`;
  const a = await kur(true);
  const r1 = await istek(`${a.url}${yol}`, { bearer: sir });
  kontrol("§4a istek iç dinleyicinin soketine gelmedi → 404", r1.status === 404 && r1.kod === "BULUNAMADI", `${r1.status} ${r1.kod}`);
  a.s.close();
  const b = await kur(false, ["10.0.0.0/8"]);
  const r2 = await istek(`${b.url}${yol}`, { bearer: sir });
  kontrol("§4b kaynak IC_KAYNAK_AGLARI dışında (geri döngü listede değil) → 404", r2.status === 404, `${r2.status} ${r2.kod}`);
  b.s.close();
  const c = await kur(false);
  const r3 = await istek(`${c.url}${yol}`, { bearer: sir });
  kontrol("§4c ✓K doğru soket + geri döngü + sır → 200", r3.status === 200, `${r3.status} ${r3.kod}`);
  const r4 = await istek(`${c.url}${yol}`, { bearer: null });
  kontrol("§4d kapıyı geçen ama Bearer'sız istek → 401 IC_KIMLIK_GECERSIZ (404 değil)", r4.status === 401 && r4.kod === "IC_KIMLIK_GECERSIZ", `${r4.status} ${r4.kod}`);
  c.s.close();
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const sir = randomBytes(36).toString("base64url");
  const sirYolu = sirDosyasi(ortam, "ic-api.belirtec", `${sir}\n`, 0o600);
  const temizlenecek: string[] = [];
  const baslangic = new Date();
  birimSondalari(ortam, sir);

  const kapali = await sunucuBaslat(ortam);
  kontrol("§1k ✓ sır dosyası verilmeyen sunucu iç dinleyiciyi AÇMAZ (ic=kapali)", kapali.ic === null && /iç API KAPALI/.test(kapali.cikti()));
  await kapali.durdur();
  const sunucu = await sunucuBaslat(ortam, { IC_API_BELIRTEC_DOSYASI: sirYolu, IC_ZIL_HIZ_DK: "2" });
  try {
    if (!sunucu.ic) throw new Error(`iç dinleyici açılmadı:\n${sunucu.cikti()}`);
    const ic = sunucu.ic;
    const bulut = await kurulumFiksturu(ctx, { moduller: ["production.enabled", "patron-bulut"] });
    temizlenecek.push(bulut.kurulumDbId);
    const anahtar = await etkinlestir(sunucu.genel, ortam, bulut);
    const bulutsuz = await kurulumFiksturu(ctx, { moduller: ["production.enabled", "finance.enabled"], tesisId: bulut.tesisId, musteriId: bulut.musteriId });
    temizlenecek.push(bulutsuz.kurulumDbId);
    await soketSondasi(ortam, sir, bulut);

    console.log("\n§5 kurulum görünümü — allowlist ve lisans kimliği");
    const r = await istek(`${ic}/ic/v1/kurulum/${bulut.kurulumId}`, { bearer: sir });
    kontrol("§5a ✓K doğru sırla 200", r.status === 200, `${r.status} ${r.kod}`);
    kontrol("§5b anahtar kümesi BİREBİR allowlist", JSON.stringify(Object.keys(r.json).sort()) === JSON.stringify(IZINLI_ALANLAR), Object.keys(r.json).join(","));
    kontrol("§5c tesis yalnız {id, ad}", JSON.stringify(Object.keys((r.json.tesis ?? {}) as object).sort()) === '["ad","id"]' && (r.json.tesis as { id?: string }).id === bulut.tesisId);
    kontrol("§5d açık anahtar + kid etkinleştirmedeki anahtar", r.json.acikAnahtar === anahtar.x && typeof r.json.anahtarKimligi === "string" && (r.json.anahtarKimligi as string).startsWith("kur-"));
    kontrol("§5e durum ETKIN · sınıf URETIM · aktif · devredilmedi", r.json.durum === "ETKIN" && r.json.sinif === "URETIM" && r.json.aktif === true && r.json.devredildi === false);
    const hak = await prisma.hak.findFirst({ where: { kurulumId: bulut.kurulumDbId, aktif: true } });
    kontrol("§5f patron-bulut hakkı + bitiş = bakım bitişi", JSON.stringify(r.json.moduller) === '["patron-bulut"]' && r.json.patronBulutBitis === hak?.bakimBitis.toISOString(), String(r.json.patronBulutBitis));
    const sizinti = [bulut.lisansNo, "Bekçi Tekstil", "production.enabled", ortam.f.parmakIzi.f1 ?? "∅", bulut.kurulumDbId, bulut.musteriId].filter((s) => r.metin.includes(s));
    kontrol("§5g kişisel/ticari veri yok (lisans no · müşteri adı · öteki modül · parmak izi · DB kimlikleri)", sizinti.length === 0, sizinti.join(", "));
    const r2 = await istek(`${ic}/ic/v1/kurulum/${bulutsuz.kurulumId}`, { bearer: sir });
    kontrol("§5h hakkı olmayan kurulum: moduller [] + bitiş null + anahtarsız ETKINLESMEDI", r2.status === 200 && JSON.stringify(r2.json.moduller) === "[]" && r2.json.patronBulutBitis === null && r2.json.acikAnahtar === null && r2.json.durum === "ETKINLESMEDI", r2.metin.slice(0, 160));
    await prisma.kurulum.update({ where: { id: bulutsuz.kurulumDbId }, data: { durum: "IPTAL" } });
    const r3 = await istek(`${ic}/ic/v1/kurulum/${bulutsuz.kurulumId}`, { bearer: sir });
    kontrol("§5i IPTAL kurulum → aktif:false, durum IPTAL", r3.json.aktif === false && r3.json.durum === "IPTAL", r3.metin.slice(0, 120));

    console.log("\n§6 kimlik ve yol kapısı");
    const yanlis = await istek(`${ic}/ic/v1/kurulum/${bulut.kurulumId}`, { bearer: `${sir.slice(0, -1)}${sir.endsWith("x") ? "y" : "x"}` });
    kontrol("§6a yanlış Bearer → 401 IC_KIMLIK_GECERSIZ", yanlis.status === 401 && yanlis.kod === "IC_KIMLIK_GECERSIZ", `${yanlis.status} ${yanlis.kod}`);
    const eksik = await istek(`${ic}/ic/v1/kurulum/${bulut.kurulumId}`);
    kontrol("§6b eksik Bearer → 401 IC_KIMLIK_GECERSIZ", eksik.status === 401 && eksik.kod === "IC_KIMLIK_GECERSIZ", `${eksik.status} ${eksik.kod}`);
    kontrol("§6c 401 gövdesi kurulum verisi taşımaz", !yanlis.metin.includes(bulut.tesisId) && !eksik.metin.includes("acikAnahtar"));
    const bilinmeyen = await istek(`${ic}/ic/v1/kurulum/${crypto.randomUUID()}`, { bearer: sir });
    kontrol("§6d bilinmeyen kurulum → 404 BULUNAMADI", bilinmeyen.status === 404 && bilinmeyen.kod === "BULUNAMADI", `${bilinmeyen.status} ${bilinmeyen.kod}`);
    const dbKimligi = await istek(`${ic}/ic/v1/kurulum/${bulut.kurulumDbId}`, { bearer: sir });
    kontrol("§6e satıcı DB kimliği lisans kimliği yerine geçmez → 404", dbKimligi.status === 404, `${dbKimligi.status}`);
    const kimliksiz = await istek(`${ic}/ic/v1/kurulum/`, { bearer: sir });
    kontrol("§6f kimliksiz yol → 404", kimliksiz.status === 404, `${kimliksiz.status}`);
    const bicimsiz = await istek(`${ic}/ic/v1/kurulum/abc`, { bearer: sir });
    kontrol("§6g biçimsiz kimlik → 400 GOVDE_GECERSIZ (404 değil: patron kaydı pasife çekmesin)", bicimsiz.status === 400 && bicimsiz.kod === "GOVDE_GECERSIZ", `${bicimsiz.status} ${bicimsiz.kod}`);
    const genel = await istek(`${sunucu.genel}/ic/v1/kurulum/${bulut.kurulumId}`, { bearer: sir });
    const genelZil = await istek(`${sunucu.genel}/ic/v1/zil`, { yontem: "POST", bearer: sir, govde: { v: 1, tesisId: bulut.tesisId, konu: "rapor" } });
    kontrol("§6h genel dinleyicide /ic/* → 404 (GET + POST)", genel.status === 404 && genelZil.status === 404, `${genel.status} ${genelZil.status}`);
    const tailnet = await istek(`${sunucu.tailnet}/ic/v1/kurulum/${bulut.kurulumId}`, { bearer: sir });
    const tailnetPortal = await istek(`${sunucu.tailnet}/portal/api/ic/v1/kurulum/${bulut.kurulumId}`, { bearer: sir });
    kontrol("§6i tailnet portalında /ic/* → 404", tailnet.status === 404 && tailnetPortal.status !== 200, `${tailnet.status} ${tailnetPortal.status}`);

    console.log("\n§7 zil — konu allowlist'i, hedef, kurulum başına hız sınırı");
    const zil = await zilAboneOl(sunucu.genel, { kurulumId: bulut.kurulumId, anahtar });
    const zilUrl = `${ic}/ic/v1/zil`;
    const lisansKonusu = await istek(zilUrl, { yontem: "POST", bearer: sir, govde: { v: 1, tesisId: bulut.tesisId, konu: "lisans" } });
    kontrol("§7a iç API'den 'lisans' konusu → 400", lisansKonusu.status === 400 && lisansKonusu.kod === "GOVDE_GECERSIZ", `${lisansKonusu.status}`);
    const fazla = await istek(zilUrl, { yontem: "POST", bearer: sir, govde: { v: 1, tesisId: bulut.tesisId, konu: "rapor", icerik: "x" } });
    kontrol("§7b gövdede fazla alan (içerik) → 400", fazla.status === 400, `${fazla.status}`);
    const yokTesis = await istek(zilUrl, { yontem: "POST", bearer: sir, govde: { v: 1, tesisId: crypto.randomUUID(), konu: "rapor" } });
    kontrol("§7c bilinmeyen tesis → 404", yokTesis.status === 404, `${yokTesis.status}`);
    const zilSirsiz = await istek(zilUrl, { yontem: "POST", govde: { v: 1, tesisId: bulut.tesisId, konu: "rapor" } });
    kontrol("§7d Bearer'sız zil → 401", zilSirsiz.status === 401 && zilSirsiz.kod === "IC_KIMLIK_GECERSIZ", `${zilSirsiz.status}`);
    const b1 = zil.bekleKonu("gelen-kutusu", 2_000);
    const z1 = await istek(zilUrl, { yontem: "POST", bearer: sir, govde: { v: 1, tesisId: bulut.tesisId, konu: "gelen-kutusu" } });
    const ms1 = await b1;
    kontrol("§7e ✓K zil 200 · yalnız ETKİN ÜRETİM kurulumu (1) · SSE ≤2 sn", z1.status === 200 && z1.json.calinan === 1 && ms1 !== null, `${z1.status} ${z1.metin} ${ms1}ms`);
    const b2 = zil.bekleKonu("rapor", 2_000);
    const z2 = await istek(zilUrl, { yontem: "POST", bearer: sir, govde: { v: 1, tesisId: bulut.tesisId, konu: "rapor" } });
    kontrol("§7f ikinci zil (tavan 2) geçer", z2.status === 200 && (await b2) !== null, `${z2.status}`);
    const z3 = await istek(zilUrl, { yontem: "POST", bearer: sir, govde: { v: 1, tesisId: bulut.tesisId, konu: "ozet" } });
    kontrol("§7g tavan aşımı → 429 HIZ_SINIRI", z3.status === 429 && z3.kod === "HIZ_SINIRI", `${z3.status} ${z3.kod}`);
    zil.kapat();

    console.log("\n§8 sayaç: denetime pencere başına TEK satır");
    await sunucu.durdur();
    const satirlar = await prisma.denetim.findMany({ where: { olay: "IC_API_SAYAC", createdAt: { gte: baslangic } } });
    const sayilar = (satirlar[0]?.ozet as { sayilar?: Record<string, number> } | undefined)?.sayilar ?? {};
    const toplam = Object.values(sayilar).reduce((a, b) => a + b, 0);
    kontrol("§8a kapanışta tek IC_API_SAYAC satırı (her istek değil)", satirlar.length === 1 && toplam >= 10, `${satirlar.length} satır · ${toplam} çağrı`);
    kontrol(
      "§8b sayılar uç × durum: kurulum 200/401/404, zil 200/429",
      (sayilar["kurulum 200"] ?? 0) >= 3 && (sayilar["kurulum 401"] ?? 0) >= 2 && (sayilar["kurulum 404"] ?? 0) >= 2 && sayilar["zil 200"] === 2 && sayilar["zil 429"] === 1,
      JSON.stringify(sayilar),
    );
    kontrol("§8c sayaç satırı sır ya da kurulum kimliği taşımaz", !JSON.stringify(satirlar).includes(sir.slice(0, 12)) && !JSON.stringify(satirlar).includes(bulut.kurulumId));
  } finally {
    await sunucu.durdur();
    await prisma.denetim.deleteMany({ where: { olay: "IC_API_SAYAC", createdAt: { gte: baslangic } } }).catch(() => undefined);
    await temizleKurulumlar(temizlenecek, ortam.kidler);
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(err);
  await kapat();
  process.exit(1);
});
