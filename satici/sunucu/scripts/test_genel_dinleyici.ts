// =============================================================================
// GENEL DİNLEYİCİ KAPILARI (D9) — /v1/* herkese açık: kötüye kullanım sınırları ve sırası.
//   §1 istemci adresi: vekil başlığı (cf-connecting-ip) YALNIZ güvenilen kenar ağından (yerleşik Cloudflare
//      aralıkları ya da GUVENILIR_VEKIL_AGLARI) gelen bağlantıda okunur; araya iç vekil (Traefik, IC_VEKIL_AGLARI)
//      girerse güven kararı X-Forwarded-For'un SON halkasına göre; sahte başlık başka her yerde yok sayılır
//   §2 IP başına sınır (V1_HIZ_IP_DK) → 429 HIZ_SINIRI + Retry-After; portal/sağlık uçları etkilenmez
//   §3 kurulum başına sınır (V1_HIZ_KURULUM_DK) İMZA DOĞRULANDIKTAN SONRA sayılır: başkasının kurulum
//      kimliğiyle gönderilen imzasız/yanlış imzalı çöp, o kurulumun kotasını TÜKETEMEZ
//   §4 ucuz ön denetimler nonce'tan ÖNCE: şemaya uymayan imzalı gövde · DR olmayan kurulumun devralma isteği
//      nonce defterine yazılmaz; geçerli istek tam bir satır yazar
//   §5 yarışı kaybeden tekillik ihlali (P2002) 409 TEKRAR_DENEYIN'dir, 500 değil
// ⭐ KALICI SONDA ✓K4 (her koşumda): sahte başlık güvenilmeyen soketten YOK SAYILIR · çöp istekler kota
//    tüketmez (sınır imzadan sonra) · sınırın altındaki istekler geçer (kör ret yok) · geçerli istek nonce yazar.
// Koşum: npx tsx scripts/test_genel_dinleyici.ts   (kendi _test DB'si)
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ENDPOINTS } from "../src/lisans-protokol";
import { loadConfig } from "../src/config";
import { clientAddress, proxyTrustFrom } from "../src/http/client-address";
import { errorHandler } from "../src/http/error-handler";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  gonder,
  hedefDbKapisi,
  imzaliBaslik,
  imzaliPost,
  kapat,
  kiraIdOf,
  kontrol,
  kurulumFiksturu,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  yoklamaGovdesi,
} from "./lib/test-ortam";

const TABAN = { DATABASE_URL: "postgresql://x@127.0.0.1:1/x_test" };

function istek(remote: string, headers: Record<string, string>) {
  return { socket: { remoteAddress: remote }, headers } as never;
}

async function main(): Promise<void> {
  hedefDbKapisi();

  console.log("\n§1 istemci adresi (vekil güveni)");
  const cf = proxyTrustFrom(loadConfig({ ...TABAN, VEKIL_IP_BASLIGI: "cf-connecting-ip" }));
  const baslikYok = proxyTrustFrom(loadConfig(TABAN));
  const ic = proxyTrustFrom(loadConfig({ ...TABAN, VEKIL_IP_BASLIGI: "cf-connecting-ip", IC_VEKIL_AGLARI: "172.31.252.0/28" }));
  const ozel = proxyTrustFrom(loadConfig({ ...TABAN, VEKIL_IP_BASLIGI: "cf-connecting-ip", GUVENILIR_VEKIL_AGLARI: "198.51.100.0/24" }));
  const sahte = { "cf-connecting-ip": "1.2.3.4" };
  kontrol("§1a başlık yapılandırılmamış → soket adresi", clientAddress(istek("173.245.48.5", sahte), baslikYok) === "173.245.48.5");
  kontrol("§1b Cloudflare aralığından gelen bağlantı → başlıktaki adres", clientAddress(istek("::ffff:173.245.48.5", sahte), cf) === "1.2.3.4");
  kontrol("§1c ✓K CF dışı soketten sahte başlık YOK SAYILIR → soket adresi", clientAddress(istek("203.0.113.9", sahte), cf) === "203.0.113.9");
  kontrol(
    "§1d iç vekil (Traefik) + XFF son halkası CF → başlıktaki adres",
    clientAddress(istek("172.31.252.3", { ...sahte, "x-forwarded-for": "9.9.9.9, 173.245.48.9" }), ic) === "1.2.3.4",
  );
  kontrol(
    "§1e ✓K iç vekil + XFF son halkası CF DEĞİL (kökene doğrudan vuran) → o halkanın adresi, sahte başlık yok sayılır",
    clientAddress(istek("172.31.252.3", { ...sahte, "x-forwarded-for": "173.245.48.9, 203.0.113.7" }), ic) === "203.0.113.7",
  );
  kontrol("§1f iç vekil yapılandırılmamışsa XFF okunmaz", clientAddress(istek("172.31.252.3", { ...sahte, "x-forwarded-for": "173.245.48.9" }), cf) === "172.31.252.3");
  kontrol(
    "§1g GUVENILIR_VEKIL_AGLARI yerleşik listeyi EZER (CF aralığı artık güvenilmez)",
    clientAddress(istek("198.51.100.20", sahte), ozel) === "1.2.3.4" && clientAddress(istek("173.245.48.5", sahte), ozel) === "173.245.48.5",
  );
  kontrol("§1h başlıktaki biçimsiz adres yok sayılır", clientAddress(istek("173.245.48.5", { "cf-connecting-ip": "<script>" }), cf) === "173.245.48.5");
  let bicimsizRed = false;
  try {
    loadConfig({ ...TABAN, IC_VEKIL_AGLARI: "172.31.252.0/33" });
  } catch {
    bicimsizRed = true;
  }
  kontrol("§1i biçimsiz CIDR açılışı durdurur (fail-closed)", bicimsizRed);

  const ortam = await anahtarOrtamiKur(Date.now(), { V1_HIZ_IP_DK: "5" });
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const temizlenecek: string[] = [];
  const ipSunucu = await portalSunuculariKur(ctx);
  const kurulumConfig = loadConfig({ ...process.env, V1_HIZ_IP_DK: "100000", V1_HIZ_KURULUM_DK: "4", ANAHTAR_DIZINI: ortam.dizin, GUVEN_CAPASI_DOSYASI: ortam.capaDosyasi });
  const kurulumCtx = { ...ctx, config: kurulumConfig };
  const sunucu = await portalSunuculariKur(kurulumCtx);
  try {
    console.log("\n§2 IP başına sınır (5/dk)");
    const durumlar: number[] = [];
    for (let i = 0; i < 6; i++) durumlar.push((await gonder(`${ipSunucu.genel}${ENDPOINTS.POLL}`, { govde: "{}" })).status);
    const altinci = await gonder(`${ipSunucu.genel}${ENDPOINTS.POLL}`, { govde: "{}" });
    kontrol("§2a ✓K sınır altındaki 5 istek geçer (kapı değerlendirir: 400/401)", durumlar.slice(0, 5).every((d) => d === 400 || d === 401), durumlar.join(","));
    kontrol("§2b 6. ve sonrası → 429 HIZ_SINIRI + Retry-After", durumlar[5] === 429 && altinci.status === 429 && altinci.kod === "HIZ_SINIRI", `${durumlar[5]} ${altinci.status} ${altinci.kod}`);
    const saglik = await fetch(`${ipSunucu.genel}/saglik`);
    const bayi = await fetch(`${ipSunucu.genel}/bayi/api/oturum`);
    kontrol("§2c /v1 dışı uçlar bu sınırdan etkilenmez", saglik.status === 200 && bayi.status === 401, `${saglik.status}/${bayi.status}`);

    console.log("\n§3 kurulum başına sınır (4/dk) imzadan SONRA");
    const k = await kurulumFiksturu(ctx);
    temizlenecek.push(k.kurulumDbId);
    const anahtar = kurulumAnahtariUret();
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: f.parmakIzi }),
    });
    if (et.status !== 200) throw new Error(`etkinleştirme ${et.status} ${et.kod}`);
    const saldirgan = kurulumAnahtariUret();
    const copler: number[] = [];
    for (let i = 0; i < 6; i++) {
      const y = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar: saldirgan, govde: yoklamaGovdesi({ sonKiraId: null, parmakIzi: f.parmakIzi }) });
      copler.push(y.status);
    }
    kontrol("§3a başkasının kurulum kimliğiyle yanlış imzalı 6 istek → hepsi 401 (429 değil)", copler.every((d) => d === 401), copler.join(","));
    let kira = kiraIdOf(et.json);
    const mesru: number[] = [];
    for (let i = 0; i < 3; i++) {
      const y = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar, govde: yoklamaGovdesi({ sonKiraId: kira, parmakIzi: f.parmakIzi }) });
      mesru.push(y.status);
      if (y.status === 200) kira = kiraIdOf(y.json);
    }
    kontrol("§3b ✓K çöp kota TÜKETMEDİ: etkinleştirme + 3 meşru yoklama geçer (4/dk)", mesru.every((d) => d === 200), mesru.join(","));
    const fazla = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar, govde: yoklamaGovdesi({ sonKiraId: kira, parmakIzi: f.parmakIzi }) });
    kontrol("§3c aynı kurulumun 5. isteği → 429 HIZ_SINIRI", fazla.status === 429 && fazla.kod === "HIZ_SINIRI", `${fazla.status} ${fazla.kod}`);

    console.log("\n§4 ucuz ön denetimler nonce'tan ÖNCE");
    const k2 = await kurulumFiksturu(ctx);
    temizlenecek.push(k2.kurulumDbId);
    const anahtar2 = kurulumAnahtariUret();
    const et2 = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k2.kurulumId,
      amac: "etkinlestir",
      anahtar: anahtar2,
      govde: etkinlestirmeGovdesi({ kod: k2.kod, kurulumId: k2.kurulumId, anahtar: anahtar2, parmakIzi: f.parmakIzi }),
    });
    if (et2.status !== 200) throw new Error(`etkinleştirme ${et2.status} ${et2.kod}`);
    const nonceSayisi = () => prisma.nonceDefteri.count({ where: { kapsam: k2.kurulumDbId } });
    const once = await nonceSayisi();
    const bozukGovde = { ...yoklamaGovdesi({ sonKiraId: kiraIdOf(et2.json), parmakIzi: f.parmakIzi }), musteriAdi: "sızıntı" };
    const bozuk = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k2.kurulumId, amac: "yokla", anahtar: anahtar2, govde: bozukGovde });
    const drDegil = await imzaliPost(sunucu.genel, ENDPOINTS.DR_TAKEOVER, {
      kurulumId: k2.kurulumId,
      amac: "dr-devral",
      anahtar: anahtar2,
      govde: { v: 1, anaKurulumId: randomUUID(), gerekce: "deneme" },
    });
    const sonra = await nonceSayisi();
    kontrol(
      "§4a şemaya uymayan imzalı gövde (400) ve DR olmayan kurulumun devralma isteği (400) nonce YAZMAZ",
      bozuk.status === 400 && bozuk.kod === "GOVDE_GECERSIZ" && drDegil.status === 400 && sonra === once,
      `${bozuk.status}/${drDegil.status} nonce ${once}→${sonra}`,
    );
    const gecerli = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k2.kurulumId, amac: "yokla", anahtar: anahtar2, govde: yoklamaGovdesi({ sonKiraId: kiraIdOf(et2.json), parmakIzi: f.parmakIzi }) });
    kontrol("§4b ✓K geçerli yoklama tam bir nonce satırı yazar", gecerli.status === 200 && (await nonceSayisi()) === once + 1, `${gecerli.status} nonce ${await nonceSayisi()}`);
    const tekrar = await gonder(`${sunucu.genel}${ENDPOINTS.POLL}`, { baslik: imzaliBaslik({ kurulumId: k2.kurulumId, amac: "yokla", govde: JSON.stringify(bozukGovde), anahtar: anahtar2 }), govde: JSON.stringify(bozukGovde) });
    kontrol("§4c reddedilen istek tekrar gönderilince yine 400 (nonce tüketmediği için ISTEK_TEKRAR değil)", tekrar.status === 400, `${tekrar.status} ${tekrar.kod}`);

    console.log("\n§5 tekillik ihlali → 409");
    let durum = 0;
    let kod: unknown;
    const res = {
      headersSent: false,
      status(s: number) {
        durum = s;
        return this;
      },
      json(b: { details?: { code?: string } }) {
        kod = b.details?.code;
        return this;
      },
    };
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "7" });
    errorHandler(p2002, { method: "POST", path: "/x" } as never, res as never, () => undefined);
    kontrol("§5a P2002 → 409 TEKRAR_DENEYIN (500 değil)", durum === 409 && kod === "TEKRAR_DENEYIN", `${durum} ${String(kod)}`);
  } finally {
    await ipSunucu.kapat();
    await sunucu.kapat();
    await temizleKurulumlar(temizlenecek, ortam.kidler);
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
