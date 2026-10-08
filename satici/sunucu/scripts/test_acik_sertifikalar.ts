// =============================================================================
// AÇIK SERTİFİKALAR (ISTEMCI-ANAHTARI-KOK-ALTINDA I7 kalan borcu · PAKET-ANAHTARI-KOK-ALTINDA D4) — satıcının TUTMADIĞI anahtarların
// (ISTEMCI `ist-*` · PAKET `pkt-*`) kök imzalı açık sertifikaları anahtar biriminin `istemci/` · `paket/` alt dizinlerinden
// canlı okunur (DB'ye yazılmaz); tablet OTA yaprakları `istemci/ota-yaprak-*.pem`. Kendi _test DB'si.
//   §1 KeyStore: doğru dizindeki ISTEMCI/PAKET yüklenir; yanlış dizin (kullanım ≠ dizin) · çapa dışı kök · kid ≠ dosya adı ·
//      biçimsiz dosya yüklenmez; süresi dolmuş sertifika künyede `valid:false`; tepe dizindeki çıplak `{sertifika}` "alt
//      dizine konur" uyarısı verir (emekli künyesi sanılmaz); OTA yaprağı CN'iyle yüklü ISTEMCI'ye bağlanır, CA sertifikası ·
//      yabancı CN · tanınmayan ad reddedilir; özel yarı dosyası (`*.paket.json`) okunmaz, uyarıda adı geçmez
//   §2 `keyExpiryWarnings`: PAKET eşiği; ISTEMCI'de en geç biten seçilir ve bitişi bağlı OTA yaprağıyla ERKEN biteni;
//      dağıtım iptalindeki (kid ya da sertifika kimliği) sertifika hesaba girmez
//   §3 portal HTTP (süreç içi): `/anahtarlar acikSertifikalar` (iptal sırası · OTA yaprağı · sertifika metni YOK) ·
//      `/iptal-belgeleri dagitimIptali` (kiradaki sıra · iptal edilen yüklüler · belge metni YOK) · `/filo paketZinciri`
//      (yetenek bildiren true · bildirmeyen false · hiç etkinleşmemiş null)
// ⭐ KALICI SONDA ✓K (her koşumda): §1a doğru konan dört dosya GERÇEKTEN yüklenir (hepsini reddeden yükleyici yeşil
//    veremez) · §2b uyarı GERÇEKTEN üretilir (hiç uyarı vermeyen fonksiyon yeşil veremez) · §3e üç durum da GERÇEKTEN ayrışır.
// ✓B11 (dosya dışı, her biri sha ile geri alındı): kid/dosya adı denetimi → §1a §1d · kullanım dizinden değil yükten →
//    §1a §1b · tepe dizin ayrımı → §1g · CA denetimi → §1h §1i · EKU denetimi → §1h §1i · CN bağı → §1h §1j · OTA min → §2b ·
//    iptal süzgeci → §2c · filo null dalı → §3e · iptalSira → §3a · kiradakiSira → §3d.
// Gerekli mi: ölçülmedi — kapı okuyucuyla aynı gün doğdu, ağaçta yakaladığı bir kusur yok (bugünkü kusuru değil yarınkini önler).
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_acik_sertifikalar.ts   (yalnız *_test DB)
// =============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DAY_MS, ENDPOINTS, PROTOCOL_VERSION, TYP, msToIso, verifyPackageRevocation, type CertUsage } from "../src/lisans-protokol";
import { anahtarUret, hamImzala, kurulumAnahtariUret, sertifikaBas, sertifikaYuku, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { KeyStore } from "../src/keys/key-store";
import { keyExpiryWarnings } from "../src/notifications/key-expiry";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
  temizlePaketIptalBelgeleri,
  temizlePortal,
} from "./lib/test-ortam";

const YUKLEYEN = "bekci-acik-sertifika";
const OZEL_YARI_ISARETI = "BEKCI-OZEL-YARI-OKUNMAZ";

// OTA fikstürü (openssl, 100 yıl; yalnız AÇIK sertifikalar): kök CA · `ist-2026-1` yaprağı (codeSigning, bitiş
// 2125-05-01T23:45:07Z) · CN'i yüklü olmayan `ist-2099-9` yaprağı.
const OTA_KOK = [
  "MIIDOjCCAiKgAwIBAgIUVzG1w5GZ9XGh/JRXxrIig6VOM3gwDQYJKoZIhvcNAQEL",
  "BQAwIjEgMB4GA1UEAwwXVGVrc0VSUCBPVEEgS29rIChiZWtjaSkwIBcNMjYxMDA3",
  "MjM0NTA3WhgPMjEyNjA5MTMyMzQ1MDdaMCIxIDAeBgNVBAMMF1Rla3NFUlAgT1RB",
  "IEtvayAoYmVrY2kpMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuVF8",
  "Hh6MmssZsP5Cx6lNUEJYYidh3FdusSWuMQODi4VRoPcSDgTAyDg3XepvOQmyLLJo",
  "4D9CwcLLqL9bpgrgZcqGhCFeW4WuTtLfoV1BqNrKEBIMI/uldLb9YvbXjoMBVdZb",
  "47Vc5K3fTHUVT8VLxDNq7nxuDh1D4hL7tag0BpGIGNqN031Q/IwIJbvGX1EUiJoa",
  "DjNUeXAPaG5xNBAEaziX+QDHyjRzavHZq7gsSuOLtAT/6B9O5/S+0rfMj2oZYknT",
  "GVVYVWpTzzLTb1KYCVShbM5lz8UXXkcyW+Qcx5iD+ukD/3QjAQINE2XuU5352y95",
  "V7Gz/agxt8BR9TY5NwIDAQABo2YwZDAdBgNVHQ4EFgQU7jH9MqaU1x7W5MqTLPsp",
  "kfAt3R4wHwYDVR0jBBgwFoAU7jH9MqaU1x7W5MqTLPspkfAt3R4wEgYDVR0TAQH/",
  "BAgwBgEB/wIBADAOBgNVHQ8BAf8EBAMCAgQwDQYJKoZIhvcNAQELBQADggEBALHh",
  "Wd9AZYAFApDzS8BeQ/GAqsvoaxV67sqOFr6tovKBaBPjOGzDvxvkluNYUkoA6db7",
  "OkOwcEe80lY7j1ZUERzzp02p7TfYZb22X8mEwKOLY44RmYu6AhCeXiV83bKh45tm",
  "PEmYBFWn+moFUOBlAarKbJVMM8CylZ+s7zLIo3FP77Xf1lZ+/tDt/Cv2VgB15sFI",
  "GFeSwmxhaEIYShcuh5dHZs/hCzcv71q8aKw3p778toQCjFvPYAVnXuCL9HCKF0ht",
  "9HabkFgDhJCZnTPKlzuGlBOsQIUT+rj1Ky4FW0/nt6wdNOtU50ml3hoRNt/9Xjoq",
  "WE3XL21Iih66uzW6ggc=",
];
const OTA_YAPRAK = [
  "MIIDTzCCAjegAwIBAgIUUpCha3CgbN9iPYP+Bm9BdurpYFEwDQYJKoZIhvcNAQEL",
  "BQAwIjEgMB4GA1UEAwwXVGVrc0VSUCBPVEEgS29rIChiZWtjaSkwIBcNMjYxMDA3",
  "MjM0NTA3WhgPMjEyNTA1MDEyMzQ1MDdaMCgxJjAkBgNVBAMMHVRla3NFUlAgT1RB",
  "IFlhcHJhayBpc3QtMjAyNi0xMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC",
  "AQEAn+ccmgVCwEpsrjnUggvE4Bq+mi+1vdwzjMfFjdX+SryDb8o97rFJjjYip3Sn",
  "+XUdlOCg8jsaMyY+nzJ+A+lICDk+zaXmTT7p82dscVcYEWzhJiVyZJHqTkz5hF4u",
  "h87fhSXaw01bA9znzAkzwuQ5cs3Bhjrh1O7EiQXTqMNkMX3Ej9zQrhnrY4H/5LnN",
  "/lNQg2m+4wm8bL9dInW7tr/w79konpK2zQGslWCNI8aT2kB3A00xWEARPMwbgqaP",
  "wMSRv9qRvnLL2RrtuaJsmnUMORas1jBLhePLdGCwxEwG83clyk+PW4GG7u613476",
  "tQc/QFqvBE8sE/7HJH3V/pCVZwIDAQABo3UwczAMBgNVHRMBAf8EAjAAMA4GA1Ud",
  "DwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDAzAdBgNVHQ4EFgQUodysgrvE",
  "tKWoB1SsOzJAwAp4OhkwHwYDVR0jBBgwFoAU7jH9MqaU1x7W5MqTLPspkfAt3R4w",
  "DQYJKoZIhvcNAQELBQADggEBAIInhDDCvYrGGpd8D8gky1IxnxPWdyytJAr7WeiK",
  "yOZAtYI5kppQP25t44BCQfIhoqfGqSymxajbyT0XDiAU80QshOL+H5dE7fAE/woD",
  "2xzVr40WnJZjfwGvGFDOiZ/AkzetXbK6pr/OSCOFz9yaFzhm1Gc9FT3pJ2SBA2i6",
  "fEvnJiUzdgzfxQy01XAj/vP3P8yqBrAIXmkHEW4U7X6C5EM/fZt17V+4pkFscQ0s",
  "bFfBaRwYOft1g37ckPM53ZfXVQyMxZnws53/RxU7ILcLpjthe3R7eEpjnei7jSwG",
  "rfi9mFrCXu2qqq0fJhqzo3aJYrd7DotMWu8o0OIhdm/tA3U=",
];
const OTA_YABANCI = [
  "MIIDTzCCAjegAwIBAgIUUpCha3CgbN9iPYP+Bm9BdurpYFIwDQYJKoZIhvcNAQEL",
  "BQAwIjEgMB4GA1UEAwwXVGVrc0VSUCBPVEEgS29rIChiZWtjaSkwIBcNMjYxMDA3",
  "MjM0NTA3WhgPMjEyNTA1MDEyMzQ1MDdaMCgxJjAkBgNVBAMMHVRla3NFUlAgT1RB",
  "IFlhcHJhayBpc3QtMjA5OS05MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC",
  "AQEAwYr7645wR8nFZwnIABeWu59jD6I1MRYvnv5l+OuUwbRQxcS0E+Zs4p10vMXD",
  "vnK98WKbygFdtg4ZA0elDWWFyGdlZW/Cl7ZQoykbu0eE1CKda/VptYgweejoKQAG",
  "soNORmOdxr3PWK+/p2BWhRaVGURNZlFO5W/I57cDJjyTGOrSD3a8NLLRmuv5Yj93",
  "73wbqsHDGwl1jxePx6XHYhnUh+vnGP4ZIuTBeFNpb/ZUd+y7J1xCJdouYBkcQBK5",
  "5epE3f3MvsgkdDT/0sHYaOq+SpoBB/wI7MfEIHTlH8cA4eXuzbXPcMNss/vGIgkv",
  "mDJ0HPQChITc3kNQ02MdC1o80QIDAQABo3UwczAMBgNVHRMBAf8EAjAAMA4GA1Ud",
  "DwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDAzAdBgNVHQ4EFgQUug85XPdG",
  "uiLqr80OzwqiXN4Sc3IwHwYDVR0jBBgwFoAU7jH9MqaU1x7W5MqTLPspkfAt3R4w",
  "DQYJKoZIhvcNAQELBQADggEBAE+8EsDBsBLkvZ5sgq7Jii7749VIsrySOaUL45Vm",
  "VQjY7T/GKQg4tbAGQ6Mf7+n7T6bsfDkE4GK9P2EYZqdMgBkkQjIHa3MWRsQnnP/Q",
  "ZakGHKEAvkVSRLlXD3YSqHaeWvZx2Qygvl13RzfXVoRKZ1R0L/NR81I+slx4RiCk",
  "z0S0StZDGQNDZgOZXz4g0loEPkQM7kncmVPHuLSlNvL+y3gtNve11ogSdzchOdh4",
  "6ofcu9Q4pi8HIZ/TNAH37E8x3pzKoJkdKXgvt5HiF5yAzxXfgvU5dFN6wWqyxwZF",
  "J0Qe+8k0m1P6GMNl+oXXLXzTy7Bbtasx56tfRimNnFBTEEc=",
];
// CA:TRUE ama kod imzası EKU'lu ve CN'i yüklü ISTEMCI'yi adlandıran sertifika — yalnız CA denetimi reddeder.
const OTA_CA_KOD_IMZASI = [
  "MIIDOjCCAiKgAwIBAgIUT9PtN714kAP10cWlTgG/LEzvik8wDQYJKoZIhvcNAQEL",
  "BQAwKDEmMCQGA1UEAwwdVGVrc0VSUCBPVEEgWWFwcmFrIGlzdC0yMDI2LTEwIBcN",
  "MjYxMDA3MjM1NDI2WhgPMjEyNjA5MTMyMzU0MjZaMCgxJjAkBgNVBAMMHVRla3NF",
  "UlAgT1RBIFlhcHJhayBpc3QtMjAyNi0xMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A",
  "MIIBCgKCAQEAwYr7645wR8nFZwnIABeWu59jD6I1MRYvnv5l+OuUwbRQxcS0E+Zs",
  "4p10vMXDvnK98WKbygFdtg4ZA0elDWWFyGdlZW/Cl7ZQoykbu0eE1CKda/VptYgw",
  "eejoKQAGsoNORmOdxr3PWK+/p2BWhRaVGURNZlFO5W/I57cDJjyTGOrSD3a8NLLR",
  "muv5Yj9373wbqsHDGwl1jxePx6XHYhnUh+vnGP4ZIuTBeFNpb/ZUd+y7J1xCJdou",
  "YBkcQBK55epE3f3MvsgkdDT/0sHYaOq+SpoBB/wI7MfEIHTlH8cA4eXuzbXPcMNs",
  "s/vGIgkvmDJ0HPQChITc3kNQ02MdC1o80QIDAQABo1owWDASBgNVHRMBAf8ECDAG",
  "AQH/AgEAMA4GA1UdDwEB/wQEAwIChDATBgNVHSUEDDAKBggrBgEFBQcDAzAdBgNV",
  "HQ4EFgQUug85XPdGuiLqr80OzwqiXN4Sc3IwDQYJKoZIhvcNAQELBQADggEBAByx",
  "oq2UkhHsu/+SZi7lG6rO0saFPmgwSk9a348gnTkyGTMIZ/CmUsHNstLBaa7NMVN9",
  "6G7IjvOqwEytO8LoWaPHvhAT6R223MOOQc3K2E2LSrmBlNHakhbD5NFnU62idEUi",
  "ez+kLh0bcYpq0Vvx2sCDPF0AKJs3S+5ghnmrFJmEEc1wolbBSsPo7y+DRegKh+Ie",
  "raqNQqlcxb+h3As1rLgwZygpK1eplmZ/oFNvWzlJOJ5O2ZLA4XnqpbzYtmBhVBN6",
  "9LQo7YFuELxy11GIEJ4skZGHZsE8Pta5v+s2W/lVb6bf2cHB44M3eufu7HdYPY+P",
  "IGaOKShLFARH3DiqGd0=",
];
// CA değil, CN'i doğru ama kod imzası EKU'su yok — yalnız EKU denetimi reddeder.
const OTA_EKUSUZ = [
  "MIIDOjCCAiKgAwIBAgIUUpCha3CgbN9iPYP+Bm9BdurpYFMwDQYJKoZIhvcNAQEL",
  "BQAwIjEgMB4GA1UEAwwXVGVrc0VSUCBPVEEgS29rIChiZWtjaSkwIBcNMjYxMDA3",
  "MjM1NTAwWhgPMjEyNjA5MTMyMzU1MDBaMCgxJjAkBgNVBAMMHVRla3NFUlAgT1RB",
  "IFlhcHJhayBpc3QtMjAyNi0xMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC",
  "AQEAwYr7645wR8nFZwnIABeWu59jD6I1MRYvnv5l+OuUwbRQxcS0E+Zs4p10vMXD",
  "vnK98WKbygFdtg4ZA0elDWWFyGdlZW/Cl7ZQoykbu0eE1CKda/VptYgweejoKQAG",
  "soNORmOdxr3PWK+/p2BWhRaVGURNZlFO5W/I57cDJjyTGOrSD3a8NLLRmuv5Yj93",
  "73wbqsHDGwl1jxePx6XHYhnUh+vnGP4ZIuTBeFNpb/ZUd+y7J1xCJdouYBkcQBK5",
  "5epE3f3MvsgkdDT/0sHYaOq+SpoBB/wI7MfEIHTlH8cA4eXuzbXPcMNss/vGIgkv",
  "mDJ0HPQChITc3kNQ02MdC1o80QIDAQABo2AwXjAMBgNVHRMBAf8EAjAAMA4GA1Ud",
  "DwEB/wQEAwIHgDAdBgNVHQ4EFgQUug85XPdGuiLqr80OzwqiXN4Sc3IwHwYDVR0j",
  "BBgwFoAU7jH9MqaU1x7W5MqTLPspkfAt3R4wDQYJKoZIhvcNAQELBQADggEBABkN",
  "d05dTbvXYiwAQ/sGpkP13K3O5Ta5jPXghoaqDJngymgd5HasbnHjn03lktj4h1Nm",
  "7nXpscwOb3KDY3nTX4v+PlEev1RDfzssDTNhf0KXsOW6TZ/TGyNk3Ldc03JSVrDr",
  "l0hev4r9M8isM7QGpt0tpD3RUDHYY6YY4cBnjdTaTdVEXvlE5tAsKnBzE3t3Wf1f",
  "tWInynFcehS6ospA6rVZGq8l+v6iU4VgORQ0IXj/USHOqIH+ZI7rLO+tKehnI+8F",
  "nSHqmTHmzNxDEBO3aYojrQGnE3+1USSMYpcA8/i3PukMtkW/e38s0o+zyyYfcrw9",
  "tO+tGyVLb2B3+bjyoA0=",
];
const YAPRAK_BITIS_MS = Date.parse("2125-05-01T23:45:07Z");
const pem = (satirlar: readonly string[]): string => `-----BEGIN CERTIFICATE-----\n${satirlar.join("\n")}\n-----END CERTIFICATE-----\n`;

type Ortam = Awaited<ReturnType<typeof anahtarOrtamiKur>>;

interface Fikstur {
  store: KeyStore;
  ist1: { kid: string; sertifikaId: string; token: string };
  pkt1: { kid: string; sertifikaId: string };
}

/** §1 — anahtar birimine açık sertifika dosyalarını koyar ve KeyStore'u yeniden yükler. */
function birimKur(ortam: Ortam, simdi: number): Fikstur {
  const { f, dizin } = ortam;
  const bas = (imzalayan: TestAnahtari, kid: string, kullanim: CertUsage, baslangic: number, bitis: number) => {
    const doc = sertifikaYuku(f, anahtarUret(kid), kullanim, { baslangic: msToIso(baslangic), bitis: msToIso(bitis) });
    return { kid, sertifikaId: doc.sertifikaId, token: sertifikaBas(imzalayan, doc) };
  };
  const yaz = (alt: string, ad: string, govde: unknown) => {
    mkdirSync(path.join(dizin, alt), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(dizin, alt, ad), typeof govde === "string" ? govde : JSON.stringify(govde), { mode: 0o600 });
  };
  const once = simdi - 10 * DAY_MS;
  const ist1 = bas(f.kok, "ist-2026-1", "ISTEMCI", once, Date.parse("2127-01-01T00:00:00Z"));
  const ist2 = bas(f.kok, "ist-2026-2", "ISTEMCI", once, simdi + 5 * DAY_MS + 3_600_000);
  const pkt1 = bas(f.kok, "pkt-2026-1", "PAKET", once, simdi + 20 * DAY_MS);
  const pktEski = bas(f.kok, "pkt-2025-1", "PAKET", simdi - 400 * DAY_MS, simdi - DAY_MS);
  yaz("istemci", "ist-2026-1.sertifika.json", { sertifika: ist1.token });
  yaz("istemci", "ist-2026-2.sertifika.json", { sertifika: ist2.token });
  yaz("paket", "pkt-2026-1.sertifika.json", { sertifika: pkt1.token });
  yaz("paket", "pkt-2025-1.sertifika.json", { sertifika: pktEski.token });
  // Yüklenmemesi gerekenler.
  yaz("istemci", "pkt-2026-9.sertifika.json", { sertifika: bas(f.kok, "pkt-2026-9", "PAKET", once, simdi + 100 * DAY_MS).token });
  yaz("paket", "ist-2026-8.sertifika.json", { sertifika: bas(f.kok, "ist-2026-8", "ISTEMCI", once, simdi + 100 * DAY_MS).token });
  yaz("paket", "pkt-2026-7.sertifika.json", { sertifika: bas(anahtarUret("kok-fikstur-9"), "pkt-2026-7", "PAKET", once, simdi + 100 * DAY_MS).token });
  yaz("istemci", "ist-2026-7.sertifika.json", { sertifika: bas(f.kok, "ist-2026-6", "ISTEMCI", once, simdi + 100 * DAY_MS).token });
  yaz("istemci", "ist-2026-3.sertifika.json", { sertifika: ist2.token, fazla: 1 });
  yaz(".", "ist-2026-5.sertifika.json", { sertifika: bas(f.kok, "ist-2026-5", "ISTEMCI", once, simdi + 100 * DAY_MS).token });
  yaz("istemci", "ota-yaprak-birincil.pem", pem(OTA_YAPRAK));
  yaz("istemci", "ota-yaprak-kok.pem", pem(OTA_KOK));
  yaz("istemci", "ota-yaprak-yabanci.pem", pem(OTA_YABANCI));
  yaz("istemci", "ota-yaprak-ca.pem", pem(OTA_CA_KOD_IMZASI));
  yaz("istemci", "ota-yaprak-ekusuz.pem", pem(OTA_EKUSUZ));
  yaz("istemci", "notlar.pem", pem(OTA_YAPRAK));
  yaz("istemci", "ota-yaprak-bozuk.pem", "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n");
  yaz("paket", "pkt-2026-1.paket.json", JSON.stringify({ tur: "tekserp-paket-anahtar", ozel: OZEL_YARI_ISARETI }));
  const store = KeyStore.load(ortam.ctx.config, simdi);
  return { store, ist1, pkt1 };
}

function keyStoreBolumu(fx: Fikstur): void {
  console.log("\n§1 KeyStore — açık sertifika alt dizinleri");
  const { store } = fx;
  const yuklu = store.openCertificates.map((c) => `${c.usage}:${c.kid}`).sort();
  const uyari = store.warnings.join("\n");
  kontrol("§1a ✓K doğru dizindeki dört sertifika yüklenir (ISTEMCI ×2 istemci/, PAKET ×2 paket/)",
    yuklu.join() === "ISTEMCI:ist-2026-1,ISTEMCI:ist-2026-2,PAKET:pkt-2025-1,PAKET:pkt-2026-1", yuklu.join());
  kontrol("§1b kullanım ≠ dizin yüklenmez (PAKET istemci/ altında, ISTEMCI paket/ altında — SERTIFIKA_KULLANIM)",
    !yuklu.some((k) => k.endsWith("pkt-2026-9") || k.endsWith("ist-2026-8")) && /istemci\/pkt-2026-9\.sertifika\.json ISTEMCI sertifikası doğrulanamadı \(SERTIFIKA_KULLANIM\)/.test(uyari) && /paket\/ist-2026-8\.sertifika\.json PAKET sertifikası doğrulanamadı \(SERTIFIKA_KULLANIM\)/.test(uyari));
  kontrol("§1c çapa dışı kökün sertifikası yüklenmez (KOK_BILINMIYOR)", !yuklu.some((k) => k.endsWith("pkt-2026-7")) && /pkt-2026-7\.sertifika\.json PAKET sertifikası doğrulanamadı \(KOK_BILINMIYOR\)/.test(uyari));
  kontrol("§1d kid ≠ dosya adı yüklenmez", !yuklu.some((k) => k.endsWith("ist-2026-6")) && /ist-2026-7\.sertifika\.json başka bir kid'in \(ist-2026-6\)/.test(uyari));
  kontrol("§1e biçimsiz dosya (`{sertifika}` dışı anahtar) yüklenmez", /istemci\/ist-2026-3\.sertifika\.json açık sertifika dosyası değil/.test(uyari));
  const eski = store.openCertificates.find((c) => c.kid === "pkt-2025-1");
  kontrol("§1f süresi dolmuş sertifika künyede kalır (`valid:false`) ve uyarı verir", eski?.valid === false && store.openCertificates.find((c) => c.kid === "pkt-2026-1")?.valid === true && /pkt-2025-1 PAKET sertifikası şu an geçerli değil/.test(uyari));
  kontrol("§1g tepe dizindeki çıplak `{sertifika}` 'alt dizine konur' der, emekli künyesine girmez",
    /ist-2026-5\.sertifika\.json açık ISTEMCI sertifikası, emekli künyesi değil — anahtar biriminin istemci\/ alt dizinine konur/.test(uyari) && !store.retired.some((r) => r.kid === "ist-2026-5") && !/ist-2026-5.*emekli künyesi doğrulanamadı/.test(uyari));
  const yaprak = store.otaLeaves;
  kontrol("§1h OTA yaprağı CN'iyle yüklü ISTEMCI'ye bağlanır (tek yaprak, bitişi X.509'dan)",
    yaprak.length === 1 && yaprak[0]?.clientKid === "ist-2026-1" && yaprak[0].file === "istemci/ota-yaprak-birincil.pem" && yaprak[0].notAfter.getTime() === YAPRAK_BITIS_MS, JSON.stringify(yaprak));
  kontrol("§1i CA ya da kod imzası EKU'suz sertifika yaprak sayılmaz (CN'i doğru olsa da)", ["kok", "ca", "ekusuz"].every((ad) => new RegExp(`ota-yaprak-${ad}\\.pem OTA yaprağı değil`).test(uyari)));
  kontrol("§1j yüklü ISTEMCI'yi adlandırmayan CN reddedilir", /ota-yaprak-yabanci\.pem yüklü bir ISTEMCI sertifikasına bağlanamadı/.test(uyari));
  kontrol("§1k tanınmayan ad ve bozuk PEM uyarıyla atlanır (yükleme durmaz)", /istemci\/notlar\.pem tanınmayan dosya adı/.test(uyari) && /OTA yaprağı okunamadı \(istemci\/ota-yaprak-bozuk\.pem\)/.test(uyari));
  kontrol("§1l özel yarı dosyası (`*.paket.json`) okunmaz: uyarıda ne adı ne içeriği", !uyari.includes("pkt-2026-1.paket.json") && !uyari.includes(OZEL_YARI_ISARETI));
}

function sureBolumu(fx: Fikstur, ortam: Ortam, simdi: number): void {
  console.log("\n§2 keyExpiryWarnings — ISTEMCI · PAKET");
  const { store } = fx;
  const oz = (w: ReturnType<typeof keyExpiryWarnings>) => w.filter((x) => x.usage === "ISTEMCI" || x.usage === "PAKET").map((x) => `${x.usage}:${x.kid}:${x.threshold}`).sort().join();
  const bugun = oz(keyExpiryWarnings(store, simdi));
  kontrol("§2a PAKET 20 gün kala eşik 30; ISTEMCI'de en geç biten (yaprağı 2125'te biten ist-2026-1) uyarı vermez", bugun === "PAKET:pkt-2026-1:30", bugun);
  const yaprakAni = YAPRAK_BITIS_MS - 10 * DAY_MS;
  const y = keyExpiryWarnings(store, yaprakAni).filter((x) => x.usage === "ISTEMCI");
  kontrol("§2b ✓K ISTEMCI bitişi bağlı OTA yaprağıyla ERKEN biteni (sertifika 2127'de, yaprak 10 gün sonra → eşik 15)",
    y.length === 1 && y[0]?.kid === "ist-2026-1" && y[0].threshold === 15 && y[0].expiresAt.getTime() === YAPRAK_BITIS_MS, JSON.stringify(y));
  const iptal = verifyPackageRevocation(
    hamImzala(TYP.PAKET_IPTAL, ortam.f.kok, {
      v: PROTOCOL_VERSION,
      iptalId: randomUUID(),
      sira: 1,
      verilis: msToIso(simdi),
      iptaller: [
        { kid: "ist-2026-1", sertifikaId: randomUUID(), tarih: msToIso(simdi), neden: "bekçi (kid ile)" },
        { kid: "pkt-2099-1", sertifikaId: fx.pkt1.sertifikaId, tarih: msToIso(simdi), neden: "bekçi (sertifika kimliği ile)" },
      ],
    }),
    ortam.ctx.keys.anchor,
  );
  if (!iptal.ok) throw new Error(`fikstür iptali doğrulanmadı: ${iptal.code}`);
  const iptalli = oz(keyExpiryWarnings(store, simdi, iptal.value));
  kontrol("§2c iptal edilen hesaba girmez: ist-2026-1 (kid) düşer → ist-2026-2 eşik 7; pkt-2026-1 (sertifika kimliği) düşer → PAKET uyarısı yok",
    iptalli === "ISTEMCI:ist-2026-2:7", iptalli);
}

async function httpBolumu(fx: Fikstur, ortam: Ortam, simdi: number, t: { kurulumlar: string[]; kidler: string[]; kullanicilar: string[] }): Promise<void> {
  console.log("\n§3 portal — /anahtarlar · /iptal-belgeleri · /filo");
  const { prisma } = await import("../src/lib/prisma");
  const { importPackageRevocation } = await import("../src/services/package-revocation.service");
  const once = await prisma.paketIptalBelgesi.count();
  kontrol("§3 ön koşul: dağıtım iptali defterinde bu bekçinin dışında satır yok (sıra seçimi bu satırlara göre)", once === 0, `${once} satır`);
  const sira = 1;
  const belge = hamImzala(TYP.PAKET_IPTAL, ortam.f.kok, {
    v: PROTOCOL_VERSION,
    iptalId: randomUUID(),
    sira,
    verilis: msToIso(simdi),
    iptaller: [
      { kid: "ist-2026-1", sertifikaId: fx.ist1.sertifikaId, tarih: msToIso(simdi), neden: "bekçi" },
      { kid: "pkt-2026-1", sertifikaId: fx.pkt1.sertifikaId, tarih: msToIso(simdi), neden: "bekçi" },
    ],
  });
  const ice = await importPackageRevocation({ token: belge, anchor: ortam.ctx.keys.anchor, actor: YUKLEYEN });
  if (ice.durum !== "EKLENDI") throw new Error(`fikstür iptali eklenmedi: ${ice.durum}`);

  const sunucu = await sunucuBaslat(ortam);
  const portal = await portalSunuculariKur({ ...ortam.ctx, keys: fx.store });
  try {
    const kul = await portalKullaniciAc(ortam.ctx, "SATICI_YONETICI");
    t.kullanicilar.push(kul.id);
    const cerez = (await portalGiris(portal.portal, "/portal/api", kul)).cerez ?? "";

    const a = await portalIstek(portal.portal, "/portal/api/anahtarlar", { cerez });
    type Acik = { kid: string; kullanim: string; iptalSira: number | null; suresiDoldu: boolean; otaYapraklari: { dosya: string; bitis: string }[] };
    const acik = (a.veri.acikSertifikalar ?? []) as Acik[];
    const bul = (kid: string) => acik.find((c) => c.kid === kid);
    kontrol("§3a /anahtarlar acikSertifikalar: dört satır; iptaldeki iki satır sıra taşır, diğerleri null",
      a.status === 200 && acik.length === 4 && bul("ist-2026-1")?.iptalSira === sira && bul("pkt-2026-1")?.iptalSira === sira && bul("ist-2026-2")?.iptalSira === null && bul("pkt-2025-1")?.iptalSira === null,
      `${a.status} ${JSON.stringify(acik.map((c) => [c.kid, c.iptalSira]))}`);
    const ist1 = bul("ist-2026-1");
    kontrol("§3b OTA yaprağı ISTEMCI satırında; süresi dolmuş PAKET işaretli",
      ist1?.otaYapraklari.length === 1 && ist1.otaYapraklari[0]?.dosya === "istemci/ota-yaprak-birincil.pem" && Date.parse(ist1.otaYapraklari[0].bitis) === YAPRAK_BITIS_MS && bul("pkt-2025-1")?.suresiDoldu === true && bul("ist-2026-2")?.otaYapraklari.length === 0);
    const govde = JSON.stringify(a.json);
    kontrol("§3c yanıtta sertifika metni ve özel yarı dosyası YOK (yalnız künye alanları)", !govde.includes(fx.ist1.token) && !govde.includes(OZEL_YARI_ISARETI) && !govde.includes("pkt-2026-1.paket.json"));

    const r = await portalIstek(portal.portal, "/portal/api/iptal-belgeleri", { cerez });
    const d = r.veri.dagitimIptali as { belgeler: Record<string, unknown>[]; kiradakiSira: number | null; iptalEdilenYukluler: string[] } | undefined;
    kontrol("§3d /iptal-belgeleri dagitimIptali: kiradaki sıra · iptal edilen yüklüler · belge metni listede yok",
      r.status === 200 && d?.kiradakiSira === sira && [...d.iptalEdilenYukluler].sort().join() === "ist-2026-1,pkt-2026-1" && d.belgeler.some((b) => b.sira === sira) && d.belgeler.every((b) => !("belge" in b)) && !JSON.stringify(r.json).includes(belge),
      `${r.status} ${JSON.stringify(d ? { ...d, belgeler: d.belgeler.length } : null)}`);

    const kZ = await kurulumFiksturu(ortam.ctx);
    const kE = await kurulumFiksturu(ortam.ctx);
    const kN = await kurulumFiksturu(ortam.ctx);
    t.kurulumlar.push(kZ.kurulumDbId, kE.kurulumDbId, kN.kurulumDbId);
    const etkinlestir = async (k: typeof kZ, yetenekler: string[]) => {
      const anahtar = kurulumAnahtariUret();
      t.kidler.push(anahtar.kid);
      return imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
        kurulumId: k.kurulumId,
        amac: "etkinlestir",
        anahtar,
        govde: { ...etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: ortam.f.parmakIzi }), yetenekler },
      });
    };
    const eZ = await etkinlestir(kZ, ["odenmis-tarih", "parmak-izi-v2", "paket-zinciri"]);
    const eE = await etkinlestir(kE, ["odenmis-tarih", "parmak-izi-v2"]);
    const filo = await portalIstek(portal.portal, "/portal/api/filo", { cerez });
    const satirlar = (filo.json.data ?? []) as { id: string; paketZinciri?: boolean | null }[];
    const pz = (id: string) => satirlar.find((x) => x.id === id)?.paketZinciri;
    kontrol("§3e ✓K /filo paketZinciri: bildiren true · bildirmeyen false · hiç etkinleşmemiş null",
      eZ.status === 200 && eE.status === 200 && pz(kZ.kurulumDbId) === true && pz(kE.kurulumDbId) === false && pz(kN.kurulumDbId) === null,
      `${eZ.status}/${eE.status} ${pz(kZ.kurulumDbId)}/${pz(kE.kurulumDbId)}/${pz(kN.kurulumDbId)}`);
  } finally {
    await portal.kapat();
    await sunucu.durdur();
  }
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const simdi = Date.now();
  const ortam = await anahtarOrtamiKur(simdi);
  const t = { kurulumlar: [] as string[], kidler: [...ortam.kidler], kullanicilar: [] as string[] };
  try {
    await temizlePaketIptalBelgeleri(YUKLEYEN);
    const fx = birimKur(ortam, simdi);
    keyStoreBolumu(fx);
    sureBolumu(fx, ortam, simdi);
    await httpBolumu(fx, ortam, simdi, t);
  } finally {
    await temizlePaketIptalBelgeleri(YUKLEYEN);
    await temizleKurulumlar(t.kurulumlar, t.kidler);
    await temizlePortal({ kullanicilar: t.kullanicilar });
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

main().catch(async (e) => {
  console.error("❌ Bekçi çöktü:", e);
  await kapat();
  process.exit(1);
});
