// =============================================================================
// BEKÇİ — İNDİRME KAPISI (Cloudflare Worker, `deploy/guncelleme-sunucusu/worker/indirme-kapisi.js`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts indirme_kapisi   (DB'SİZ, ağsız)
//
// NE ÖLÇER: Worker modülü içe aktarılır, fetch işleyicisi SAHTE origin (fetch) ve enjekte
// saatle çağrılır; belirteçler GERÇEK protokol koduyla (`src/lib/license/protocol/`) basılır.
//   §0 kâhin paritesi: her belirteç biçimi için Worker'ın kodu = `verifyDownloadToken` kodu
//      (alg none/HS256 · başlıkta jwk · typ eksik/yanlış · kid biçimsiz/bilinmez · kanonik
//      olmayan base64 · kısa imza · kurcalı yük · v:2 · şema · süre ±10 dk · 70 dk ömür · 32 KB)
//   §1 HTTP: geçerli · süresi dolmuş · yanlış önek/kanal/ürün · imzasız · alg none · yanlış
//      typ · bilinmeyen kid (+ çok anahtar) — her ret yanında aynı yolun kabulü
//   §2 kapsam: kapsam dışı yol aynen geçer · kodlanmış/çift bölü/büyük harf atlatma kapılı
//   §3 geçiş listesi: içi/dışı · önek · süresi dolmuş · bitişsiz/90 günden uzak = ayar geçersiz
//   §4 belirteç kaynakları: `Expo-Extra-Params` (RFC 8941) · `?t=` · origin'e belirteç GİTMEZ;
//      belirteç dışı sorgu (yayın betiklerinin `onbellek-atla`/`cb`) origin'e aynen gider
//   §5 OTA: varlık belirteci kapalıyken varlık anonim, kaçışlı varlık yolu kapılı · açıkken
//      manifestin imza DIŞI `extensions.assetRequestHeaders`ı yazılır, imza (gerçek üretici
//      `mobil/scripts/lib/manifest.mjs`) hâlâ doğrulanır
//   §6 ayar/yöntem/önbellek: tanınmayan alan 503 · GET/HEAD dışı 405 · değişmez dosyada
//      cacheEverything + 404 tutulmaz, değişken dosyada cf yok
//   §7 varsayılan dışa aktarım: gerçek saat + `env.TKL_INDIRME_AYAR` (dize ve nesne)
//   §8 İNDİRME listesi (L2-8): kid × kanal × pencere — §0'a parite satırları (INDIRME_KANAL · INDIRME_PENCERE ·
//      ±10 dk · yarım/biçimsiz pencere · dize kanal tuzağı · aynı kid ilk satır) + HTTP: üretim/hazırlık ayrımı iki
//      yönde (G3) · pencere sınırları · örtüşmeli döndürme (eski kid penceresiyle kendiliğinden kapanır) · eski biçim
//      kısıtsız (bir sürüm) · 22 geçersiz liste ayarı 503 (her biri geçerli komşusuyla) · env dize · runbook şablonu
//   §9 backend/ öneki (Dağıtım v2): Worker ürün kümesi = kâhin `DOWNLOAD_PRODUCTS` · backend belirteci
//      yalnız backend/ altında · başka ürünün belirteci backend/de RED · son.json değişken, zip değişmez
//   §10 tek ortak paket (O9): grup-nötr OTA takma adı `/ota/<rv>/manifest` — belirteçsiz 403 · grup YALNIZ
//      belirteçten (her grubun belirteci kendi gerçek yoluna, origin isteği gerçek yol) · başka ürünün/önekin
//      belirteci RED · geçiş listesi takma adda uygulanmaz · `//`, `%..`, büyük harf, sonek bicimleri kapılı ·
//      zincirli işaretçiler (`son-zincir.json` · `surum-zincir.json` · `pg-zincir.json`) değişken · yeni adres
//      ayarı (`worker/indir-ayar.json`): geçerli, kanallar = backend `UPDATE_GROUPS`, eski biçim/hazırlık/geçiş
//      boş, K-5 — `ind-2026` listede YOK ve onunla imzalı belirteç RED
// ÖLÇMEDİĞİ: Cloudflare çalışma zamanı (workerd). WebCrypto Ed25519 burada Node'unkidir;
// kenar ölçümü runbook'un prova adımında (docs/ops/INDIRME-KAPISI-WORKER.md).
// =============================================================================
import path from "node:path";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  DOWNLOAD_PRODUCTS,
  TYP,
  msToIso,
  signDownloadToken,
  verifyDownloadToken,
  isDownloadPathAllowed as isDownloadPathAllowedKahin,
  b64uEncode,
  type DownloadDoc,
  type DownloadPublicKey,
} from "../src/lib/license/protocol";
import { anahtarUret, hamImzala, type TestAnahtari } from "./lib/lisans-fikstur";
import { CHAINED_PG_POINTER_FILE, CHAINED_RELEASE_MANIFEST_FILE, CHAINED_RELEASE_POINTER_FILE } from "../src/lib/license/protocol/paket-zinciri";
import { UPDATE_GROUPS } from "../src/lib/license/update-group";

const REPO = path.resolve(__dirname, "..", "..");
const WORKER_YOLU = path.join(REPO, "deploy/guncelleme-sunucusu/worker/indirme-kapisi.js");
const MANIFEST_URETICI = path.join(REPO, "mobil/scripts/lib/manifest.mjs");
const DAKIKA = 60 * 1000;
const SIMDI = Date.parse("2026-09-29T12:00:00.000Z");
const KANAL = "deneme-kanal";
const KOK = "https://guncelleme.example.test";

type Yanitlayici = (r: Request, init?: { cf?: Record<string, unknown> }) => Promise<Response>;
interface WorkerModulu {
  default: { fetch: (r: Request, env?: Record<string, unknown>) => Promise<Response> };
  kapiOlustur: (g: { ayar: unknown; fetchImpl?: Yanitlayici; simdi?: () => number }) => (r: Request) => Promise<Response>;
  belirteciDogrula: (t: unknown, g: { anahtarlar: AnahtarSatiri[]; simdiMs: number }) => Promise<{ ok: boolean; kod?: string; belge?: DownloadDoc }>;
  ayarCoz: (ham: unknown, simdiMs: number) => { ok: boolean; neden?: string };
  yolIzinli: (b: DownloadDoc, yol: string) => boolean;
  sozlukDegeri: (metin: string, anahtar: string) => string | null;
  extensionsYaz: (metin: string, sinir: string, belirtec: string) => string | null;
  VARSAYILAN_AYAR: Record<string, unknown>;
  URUN_DIZINLERI: readonly string[];
}

/** Eski biçim `{kid, x}` ya da liste satırı; parite tablosu bilerek biçimsiz değer de taşır (kâhine `unknown` gider). */
type AnahtarSatiri = { kid: string; x: string; kanallar?: unknown; baslangic?: unknown; bitis?: unknown };

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const IND = anahtarUret("ind-2026");
const IND2 = anahtarUret("ind-2026-yedek");
const YABANCI = anahtarUret("ind-yabanci");
const KURULUM = "3f0c8a52-6d1e-4b7a-9c2f-1a2b3c4d5e6f";

type Urun = "electron" | "mobil" | "backend";
function yuk(urun: Urun, ek: Partial<DownloadDoc> = {}, kanal = KANAL): DownloadDoc {
  return { v: 1, kanal, yolOneki: `/${kanal}/${urun}/`, kurulumId: KURULUM, exp: msToIso(SIMDI + 60 * DAKIKA), ...ek };
}
function bas(urun: Urun, ek: Partial<DownloadDoc> = {}, anahtar: TestAnahtari = IND, simdi = SIMDI): string {
  return signDownloadToken({ payload: yuk(urun, ek), key: { kid: anahtar.kid, privateKey: anahtar.privateKey }, nowMs: simdi });
}
const acik = (a: TestAnahtari) => ({ kid: a.kid, x: a.x });
const GUN = 24 * 60 * DAKIKA;
/** İNDİRME listesi satırı: varsayılan kanal KANAL, pencere SIMDI − 1 gün → + 119 gün (120 g sertifika). */
function satir(a: TestAnahtari, ek: Partial<Record<"kanallar" | "baslangic" | "bitis", unknown>> = {}): AnahtarSatiri {
  return { kid: a.kid, x: a.x, kanallar: [KANAL], baslangic: msToIso(SIMDI - GUN), bitis: msToIso(SIMDI + 119 * GUN), ...ek };
}

interface Kayit {
  url: string;
  init?: { cf?: Record<string, unknown> };
  basliklar: Headers;
  istek: Request;
}
/** Sahte origin: her çağrıyı kaydeder, 200 + yolu gövdede döner (ya da verilen yanıtı). */
function sahteOrigin(yanit?: (r: Request) => Response): { cagrilar: Kayit[]; fetchImpl: Yanitlayici } {
  const cagrilar: Kayit[] = [];
  const fetchImpl: Yanitlayici = async (r, init) => {
    cagrilar.push({ url: r.url, init, basliklar: new Headers(r.headers), istek: r });
    return yanit ? yanit(r) : new Response(`origin:${new URL(r.url).pathname}`, { status: 200 });
  };
  return { cagrilar, fetchImpl };
}

function istek(yol: string, basliklar: Record<string, string> = {}, method = "GET"): Request {
  return new Request(`${KOK}${yol}`, { method, headers: basliklar });
}
const kodu = (y: Response) => y.headers.get("X-TKL-Kod") ?? "";

async function yukle<T>(dosya: string): Promise<T> {
  return (await import(pathToFileURL(dosya).href)) as T;
}


const ALT = anahtarUret("alt-2026");
const b64j = (o: unknown) => b64uEncode(JSON.stringify(o));
/** Başlığı elle kurulmuş belirteç (imza geçerli bir belirtecinkidir — başlık denetimi imzadan önce düşürür). */
function elleBaslik(baslik: Record<string, unknown>, gecerli: string): string {
  const [, p, s] = gecerli.split(".");
  return `${b64j(baslik)}.${p}.${s}`;
}
/** Son karakterin kullanılmayan kuyruk bitini açar: aynı baytlar, kanonik olmayan yazım. */
function kanoniksiz(parca: string): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const son = abc.indexOf(parca[parca.length - 1]!);
  return parca.slice(0, -1) + abc[son | 1];
}

// §0 — kâhin paritesi: aynı belirteç, aynı an, aynı anahtar kümesi ⇒ aynı kod.
async function bolum0(w: WorkerModulu): Promise<void> {
  console.log("\n§0 — kâhin paritesi (Worker ↔ protocol/indirme.ts)");
  const g = bas("electron");
  const [h, p, s] = g.split(".");
  const baslik = { alg: "EdDSA", typ: TYP.INDIRME, kid: IND.kid };
  const ham = (ek: Record<string, unknown>, a: TestAnahtari = IND) => hamImzala(TYP.INDIRME, a, { ...yuk("electron"), ...ek });
  const exp = (dk: number) => msToIso(SIMDI + dk * DAKIKA);
  const tablo: [string, unknown, string, AnahtarSatiri[]?][] = [
    ["geçerli", g, "OK"],
    ["alg none", `${b64j({ ...baslik, alg: "none" })}.${p}.`, "JWS_ALG"],
    ["alg HS256", elleBaslik({ ...baslik, alg: "HS256" }, g), "JWS_ALG"],
    ["başlıkta gömülü jwk", elleBaslik({ ...baslik, jwk: { kty: "OKP" } }, g), "JWS_BASLIK"],
    ["typ eksik", elleBaslik({ alg: "EdDSA", kid: IND.kid }, g), "JWS_TYP"],
    ["typ yanlış (tekserp-kira, geçerli imza)", hamImzala(TYP.KIRA, IND, yuk("electron")), "JWS_TYP"],
    ["kid biçimsiz", elleBaslik({ ...baslik, kid: "IND_2026" }, g), "JWS_KID"],
    ["kid bilinmez (yabancı ind- anahtarı)", ham({}, YABANCI), "JWS_KID"],
    ["kid ind- değil (alt- anahtarı listede)", ham({}, ALT), "JWS_KID", [acik(IND), acik(ALT)]],
    ["aynı kid başka açık anahtar", g, "JWS_IMZA", [{ kid: IND.kid, x: YABANCI.x }]],
    ["kurcalı yük", `${h}.${b64j({ ...yuk("electron"), kurulumId: "4f0c8a52-6d1e-4b7a-9c2f-1a2b3c4d5e6f" })}.${s}`, "JWS_IMZA"],
    ["kanonik olmayan imza base64", `${h}.${p}.${kanoniksiz(s!)}`, "JWS_BICIM"],
    ["dolgulu base64", `${h}.${p}.${s}==`, "JWS_BICIM"],
    ["kısa imza (63 bayt)", `${h}.${p}.${b64uEncode(Buffer.alloc(63))}`, "JWS_BICIM"],
    ["imzasız (boş imza parçası)", `${h}.${p}.`, "JWS_BICIM"],
    ["iki parça", `${h}.${p}`, "JWS_BICIM"],
    ["başlık dizi", `${b64j([baslik])}.${p}.${s}`, "JWS_BICIM"],
    ["yük JSON değil", `${h}.${b64uEncode("{bozuk")}.${s}`, "JWS_BICIM"],
    ["32 KB tavanı", g + "A".repeat(33 * 1024), "JWS_BICIM"],
    ["metin değil", 42, "JWS_BICIM"],
    ["boş dize", "", "JWS_BICIM"],
    ["v:2", ham({ v: 2 }), "BELGE_SURUM"],
    ["v:\"1\" (dize)", ham({ v: "1" }), "BELGE_SURUM"],
    ["v yok", hamImzala(TYP.INDIRME, IND, { kanal: KANAL, yolOneki: `/${KANAL}/electron/`, kurulumId: KURULUM, exp: exp(60) }), "BELGE_SEMA"],
    ["önek kanalla uyuşmuyor", ham({ yolOneki: "/baska-kanal/electron/" }), "BELGE_SEMA"],
    ["önek bölüsüz", ham({ yolOneki: `/${KANAL}/electron` }), "BELGE_SEMA"],
    ["kanal büyük harf", ham({ kanal: "Deneme", yolOneki: "/Deneme/electron/" }), "BELGE_SEMA"],
    ["kurulumId uuid değil", ham({ kurulumId: "kurulum-1" }), "BELGE_SEMA"],
    ["exp ofsetli", ham({ exp: "2026-09-29T15:00:00+03:00" }), "BELGE_SEMA"],
    ["exp saniyesiz (Zod kabul eder)", ham({ exp: "2026-09-29T13:00Z" }), "OK"],
    ["exp 30 Şubat", ham({ exp: "2026-02-30T12:00:00Z" }), "BELGE_SEMA"],
    ["tanınmayan ek alan (şema atar)", ham({ fazla: 1 }), "OK"],
    ["süre 9 dk geçmiş (tolerans içi)", ham({ exp: exp(-9) }), "OK"],
    ["süre 11 dk geçmiş", ham({ exp: exp(-11) }), "BELGE_SURESI_DOLDU"],
    ["ömür 79 dk (70 + tolerans içi)", ham({ exp: exp(79) }), "OK"],
    ["ömür 81 dk", ham({ exp: exp(81) }), "INDIRME_OMUR"],
    ["mobil önekli geçerli", bas("mobil"), "OK"],
    ["backend önekli geçerli (Dağıtım v2)", bas("backend"), "OK"],
    ["tanınmayan ürün öneki", ham({ yolOneki: `/${KANAL}/diger/` }), "BELGE_SEMA"],
    // §8 — İNDİRME listesi satırı (kid × kanal × pencere).
    ["liste: kanal kümede, pencere içinde", g, "OK", [satir(IND)]],
    ["liste: çok kanallı küme kanalı içerir", g, "OK", [satir(IND, { kanallar: ["baska-kanal", KANAL] })]],
    ["liste: kanal kümede DEĞİL", g, "INDIRME_KANAL", [satir(IND, { kanallar: ["baska-kanal"] })]],
    ["liste: kanallar boş dizi", g, "INDIRME_KANAL", [satir(IND, { kanallar: [] })]],
    ["liste: kanallar dize (alt dize tuzağı)", g, "INDIRME_KANAL", [satir(IND, { kanallar: `${KANAL}-uzun` })]],
    ["liste: pencere 9 dk sonra başlıyor (tolerans içi)", g, "OK", [satir(IND, { baslangic: exp(9) })]],
    ["liste: pencere 11 dk sonra başlıyor", g, "INDIRME_PENCERE", [satir(IND, { baslangic: exp(11) })]],
    ["liste: pencere 9 dk önce bitti (tolerans içi)", g, "OK", [satir(IND, { bitis: exp(-9) })]],
    ["liste: pencere 11 dk önce bitti", g, "INDIRME_PENCERE", [satir(IND, { bitis: exp(-11) })]],
    ["liste: yarım pencere (başlangıç yok)", g, "INDIRME_PENCERE", [{ ...satir(IND), baslangic: undefined }]],
    ["liste: pencere biçimsiz (ofsetli ISO)", g, "INDIRME_PENCERE", [satir(IND, { bitis: "2027-01-01T00:00:00+03:00" })]],
    ["liste: pencere ve kanal ikisi de dışında → pencere önce", g, "INDIRME_PENCERE", [satir(IND, { bitis: exp(-11), kanallar: ["baska-kanal"] })]],
    ["liste: süresi dolmuş + pencere dışı → süre önce", ham({ exp: exp(-11) }), "BELGE_SURESI_DOLDU", [satir(IND, { bitis: exp(-30) })]],
    ["liste: aynı kid iki satır → İLK kazanır (ilki kanal dışı)", g, "INDIRME_KANAL", [satir(IND, { kanallar: ["baska-kanal"] }), satir(IND)]],
    ["liste: aynı kid iki satır, ilkinin x'i bozuk → kid bilinmez", g, "JWS_KID", [{ kid: IND.kid, x: "AAAA" }, acik(IND)]],
    ["liste: başka kid'in satırı kısıtlı, bu kid eski biçim → kısıtsız", g, "OK", [satir(IND2, { kanallar: ["baska-kanal"] }), acik(IND)]],
  ];
  for (const [ad, belirtec, beklenen, anahtarlar = [acik(IND), acik(IND2)]] of tablo) {
    const k = verifyDownloadToken(belirtec, { keys: anahtarlar as DownloadPublicKey[], nowMs: SIMDI });
    const sonuc = await w.belirteciDogrula(belirtec, { anahtarlar, simdiMs: SIMDI });
    const kk = k.ok ? "OK" : k.code;
    const wk = sonuc.ok ? "OK" : String(sonuc.kod);
    check(`§0 ${ad}: kâhin ${kk} = Worker ${wk} = beklenen ${beklenen}`, kk === beklenen && wk === beklenen);
  }
  const b = verifyDownloadToken(g, { keys: [acik(IND)], nowMs: SIMDI });
  const yollar = ["/deneme-kanal/electron/latest.yml", "/deneme-kanal/electron/", "/deneme-kanal/electron/../mobil/x.apk",
    "/deneme-kanal/electron/%2E%2E/x", "/deneme-kanal/electron/a//b", "/deneme-kanal/electron/a\\b", "/deneme-kanal/electron/a%00",
    "/baska-kanal/electron/latest.yml", "/deneme-kanal/mobil/x.apk"];
  if (b.ok) {
    for (const y of yollar) {
      const k = w.yolIzinli(b.value, y);
      check(`§0 yol ${y}: Worker ${k ? "izin" : "RED"} = kâhin`, k === isDownloadPathAllowedKahin(b.value, y));
    }
  } else check("§0 yol paritesi için geçerli belirteç", false, b.code);
}

type Ayar = Record<string, unknown>;
function ayarKur(w: WorkerModulu, ek: Ayar = {}): Ayar {
  return { ...w.VARSAYILAN_AYAR, anahtarlar: [acik(IND)], ...ek };
}
async function kapidan(w: WorkerModulu, ayar: Ayar, r: Request, simdi = SIMDI, yanit?: (r: Request) => Response) {
  const o = sahteOrigin(yanit);
  const y = await w.kapiOlustur({ ayar, fetchImpl: o.fetchImpl, simdi: () => simdi })(r);
  return { y, o };
}
/** Kabul: 200, origin bir kez çağrıldı. Ret: beklenen durum + kod başlığı, origin HİÇ çağrılmadı. */
async function kabul(w: WorkerModulu, ad: string, ayar: Ayar, r: Request, simdi = SIMDI) {
  const { y, o } = await kapidan(w, ayar, r, simdi);
  check(`${ad} → 200`, y.status === 200 && o.cagrilar.length === 1, `${y.status} ${kodu(y)} origin=${o.cagrilar.length}`);
  return o;
}
async function ret(w: WorkerModulu, ad: string, ayar: Ayar, r: Request, kod: string, durum = 403, simdi = SIMDI) {
  const { y, o } = await kapidan(w, ayar, r, simdi);
  const govde = await y.text();
  const ok = y.status === durum && kodu(y) === kod && o.cagrilar.length === 0 && govde.length > 0 && govde.length < 120;
  check(`${ad} → ${durum} ${kod}`, ok && y.headers.get("cache-control") === "no-store", `${y.status} ${kodu(y)} origin=${o.cagrilar.length}`);
}
const bsl = (t: string) => ({ "X-TKL-Indirme": t });

// §1 — HTTP düzeyi: her ret aynı yolun (ya da aynı belirtecin) kabulüyle eşli.
async function bolum1(w: WorkerModulu): Promise<void> {
  console.log("\n§1 — geçerli / süresi dolmuş / önek / imzasız / alg none / typ / kid");
  const a = ayarKur(w);
  const exe = `/${KANAL}/electron/TeksERP-Setup-1.3.2.exe`;
  const g = bas("electron");
  const o = await kabul(w, "§1a geçerli belirteç (başlık) exe", a, istek(exe, bsl(g)));
  check("§1a' origin'e belirteçsiz yol gitti", o.cagrilar[0]?.url === `${KOK}${exe}` && !o.cagrilar[0]?.basliklar.has("x-tkl-indirme"));
  await ret(w, "§1b belirteçsiz exe", a, istek(exe), "INDIRME_BELIRTEC_YOK");
  const dolmus = hamImzala(TYP.INDIRME, IND, yuk("electron", { exp: msToIso(SIMDI - 11 * DAKIKA) }));
  const toleransli = hamImzala(TYP.INDIRME, IND, yuk("electron", { exp: msToIso(SIMDI - 9 * DAKIKA) }));
  await ret(w, "§1c süresi dolmuş (11 dk)", a, istek(exe, bsl(dolmus)), "BELGE_SURESI_DOLDU");
  await kabul(w, "§1c' tolerans içi (9 dk)", a, istek(exe, bsl(toleransli)));
  await ret(w, "§1c'' aynı belirteç 80 dk sonra", a, istek(exe, bsl(g)), "BELGE_SURESI_DOLDU", 403, SIMDI + 80 * DAKIKA);
  await ret(w, "§1d yanlış ürün öneki (electron belirteci → mobil)", a, istek(`/${KANAL}/mobil/apk/teks.apk`, bsl(g)), "INDIRME_YOL");
  await kabul(w, "§1d' mobil belirteci → mobil apk", a, istek(`/${KANAL}/mobil/apk/teks.apk`, bsl(bas("mobil"))));
  await ret(w, "§1e başka kanal", a, istek("/baska-kanal/electron/latest.yml", bsl(g)), "INDIRME_YOL");
  await ret(w, "§1f önekin kendisi (dizin)", a, istek(`/${KANAL}/electron/`, bsl(g)), "INDIRME_YOL");
  await ret(w, "§1g kodlanmış kaçış (..%2F)", a, istek(`/${KANAL}/electron/..%2Fmobil/x.apk`, bsl(g)), "INDIRME_YOL");
  await kabul(w, "§1g' aynı belirteç latest.yml", a, istek(`/${KANAL}/electron/latest.yml`, bsl(g)));
  const [h, p] = g.split(".");
  await ret(w, "§1h imzasız (boş imza)", a, istek(exe, bsl(`${h}.${p}.`)), "JWS_BICIM");
  await ret(w, "§1h' kurcalı yük", a, istek(exe, bsl(`${h}.${b64uEncode(JSON.stringify(yuk("electron", {}, "baska-kanal")))}.${g.split(".")[2]}`)), "JWS_IMZA");
  const none = `${b64uEncode(JSON.stringify({ alg: "none", typ: TYP.INDIRME, kid: IND.kid }))}.${p}.`;
  await ret(w, "§1i alg none", a, istek(exe, bsl(none)), "JWS_ALG");
  await ret(w, "§1j yanlış typ (tekserp-istek)", a, istek(exe, bsl(hamImzala(TYP.ISTEK, IND, yuk("electron")))), "JWS_TYP");
  const ikinci = bas("electron", {}, IND2);
  await ret(w, "§1k bilinmeyen kid (ayarda yok)", a, istek(exe, bsl(ikinci)), "JWS_KID");
  await kabul(w, "§1k' çok anahtar: ikinci kid ayara girince kabul", ayarKur(w, { anahtarlar: [acik(IND), acik(IND2)] }), istek(exe, bsl(ikinci)));
  await kabul(w, "§1k'' eski anahtar da hâlâ kabul (döndürme penceresi)", ayarKur(w, { anahtarlar: [acik(IND), acik(IND2)] }), istek(exe, bsl(g)));
  await ret(w, "§1l HEAD de kapılı", a, istek(exe, {}, "HEAD"), "INDIRME_BELIRTEC_YOK");
  await kabul(w, "§1l' HEAD belirteçle", a, istek(exe, bsl(g), "HEAD"));
}

// §2 — kapsam: yalnız /<kanal>/(electron|mobil) kapılı; origin'in çözeceği atlatmalar da kapılı.
async function bolum2(w: WorkerModulu): Promise<void> {
  console.log("\n§2 — kapsam dışı geçer · atlatma denemeleri kapılı");
  const a = ayarKur(w);
  for (const yol of ["/", "/saglik", `/${KANAL}/baska/x.bin`, `/${KANAL}/electronx/a`, "/electron/latest.yml"]) {
    const r = istek(yol, {}, "POST");
    const { y, o } = await kapidan(w, a, r);
    check(`§2a kapsam dışı ${yol} (POST dahil) aynen geçer`, y.status === 200 && o.cagrilar.length === 1 && o.cagrilar[0]!.istek === r && o.cagrilar[0]!.init === undefined);
  }
  const { y: bozukAyar } = await kapidan(w, { yanlis: 1 }, istek("/saglik"));
  check("§2b ayar geçersizken kapsam dışı yine geçer", bozukAyar.status === 200);
  const atlatmalar = [
    `/${KANAL}/%65lectron/latest.yml`,
    `//${KANAL}/electron/latest.yml`,
    `/${KANAL}//electron/latest.yml`,
    `/${KANAL}%2Felectron/latest.yml`,
    `/${KANAL}/ELECTRON/latest.yml`,
    `/${KANAL}/electron`,
    `/${KANAL}/mobil%2fapk/x.apk`,
    `/${KANAL}/%E0%A4%A/electron/x`,
  ];
  for (const yol of atlatmalar) await ret(w, `§2c atlatma ${yol} kapılı`, a, istek(yol), "INDIRME_BELIRTEC_YOK");
  await kabul(w, "§2c' kanonik yol belirteçle", a, istek(`/${KANAL}/electron/latest.yml`, bsl(bas("electron"))));
}

// §3 — geçiş listesi: bugünkü sürüm dosyaları süreli anonim; bitiş zorunlu ve yakın.
async function bolum3(w: WorkerModulu): Promise<void> {
  console.log("\n§3 — geçiş listesi");
  const yarin = msToIso(SIMDI + 24 * 60 * DAKIKA);
  const yml = `/${KANAL}/electron/latest.yml`;
  const a = ayarKur(w, {
    gecisListesi: [
      { yol: yml, bitis: yarin },
      { onek: `/${KANAL}/mobil/ota/1.0.0/1759000000000/`, bitis: yarin },
    ],
  });
  await kabul(w, "§3a listedeki dosya anonim", a, istek(yml));
  await ret(w, "§3b listede olmayan dosya anonim", a, istek(`/${KANAL}/electron/TeksERP-Setup-1.3.2.exe`), "INDIRME_BELIRTEC_YOK");
  await ret(w, "§3c tam yol eşleşmesi: yol + sonek geçmez", a, istek(`${yml}.bak`), "INDIRME_BELIRTEC_YOK");
  const vb = ayarKur(w, { ...a, varlikBelirteci: true });
  await kabul(w, "§3d önek altındaki varlık anonim", vb, istek(`/${KANAL}/mobil/ota/1.0.0/1759000000000/assets/abc`));
  await ret(w, "§3e önekin kendisi geçmez", vb, istek(`/${KANAL}/mobil/ota/1.0.0/1759000000000/`), "INDIRME_BELIRTEC_YOK");
  await ret(w, "§3f önek altında kaçış geçmez", vb, istek(`/${KANAL}/mobil/ota/1.0.0/1759000000000/..%2F..%2Fapk/x.apk`), "INDIRME_BELIRTEC_YOK");
  await ret(w, "§3g geçiş bitti (1 ms sonra)", a, istek(yml), "INDIRME_BELIRTEC_YOK", 403, Date.parse(yarin) + 1);
  await kabul(w, "§3g' bitiş anı dahil", a, istek(yml), Date.parse(yarin));
  const bozuk = hamImzala(TYP.INDIRME, IND, yuk("electron", { exp: msToIso(SIMDI - 30 * DAKIKA) }));
  await kabul(w, "§3h geçersiz belirteçli eski istemci listedeki dosyayı yine alır", a, istek(yml, bsl(bozuk)));
  await ret(w, "§3h' aynı belirteç liste dışı dosyada kodunu taşır", a, istek(`/${KANAL}/electron/x.exe`, bsl(bozuk)), "BELGE_SURESI_DOLDU");
  const gecersizler: [string, unknown[]][] = [
    ["bitişsiz satır", [{ yol: yml }]],
    ["biçimsiz bitiş", [{ yol: yml, bitis: "yarın" }]],
    ["90 günden uzak bitiş", [{ yol: yml, bitis: msToIso(SIMDI + 91 * 24 * 60 * DAKIKA) }]],
    ["yol ve önek birlikte", [{ yol: yml, onek: `/${KANAL}/electron/`, bitis: yarin }]],
    ["önek sığ (/<kanal>/)", [{ onek: `/${KANAL}/`, bitis: yarin }]],
    ["kaçışlı yol", [{ yol: `/${KANAL}/electron/../x`, bitis: yarin }]],
    ["tanınmayan alan", [{ yol: yml, bitis: yarin, sure: 5 }]],
  ];
  for (const [ad, liste] of gecersizler) {
    await ret(w, `§3i ayar geçersiz: ${ad}`, ayarKur(w, { gecisListesi: liste }), istek(yml), "AYAR_GECERSIZ", 503);
  }
  await kabul(w, "§3i' 89 günlük bitiş geçerli", ayarKur(w, { gecisListesi: [{ yol: yml, bitis: msToIso(SIMDI + 89 * 24 * 60 * DAKIKA) }] }), istek(yml));
}

// §4 — belirteç kaynakları: başlık · Expo-Extra-Params `tkl` · ?t=; origin'e hiçbiri gitmez.
async function bolum4(w: WorkerModulu): Promise<void> {
  console.log("\n§4 — Expo-Extra-Params · ?t= · origin'e belirteç gitmez");
  const a = ayarKur(w);
  const m = bas("mobil");
  const man = `/${KANAL}/mobil/ota/1.0.0/manifest`;
  const sd = w.sozlukDegeri;
  check("§4a sözlük: tek dize", sd(`tkl="${m}"`, "tkl") === m);
  check("§4b sözlük: başka üyeler, parametre, boolean, sayı", sd(`a=1, b=?1, tkl="${m}";p="x,y", c=tok/en, d`, "tkl") === m);
  check("§4c sözlük: kaçışlı tırnak", sd(`tkl="a\\"b"`, "tkl") === 'a"b');
  check("§4d sözlük: sonuncu kazanır", sd(`tkl="bir", tkl="iki"`, "tkl") === "iki");
  check("§4e sözlük: kapanmamış tırnak null", sd(`tkl="${m}`, "tkl") === null);
  check("§4f sözlük: anahtar yok null · sayı değer null · boolean null", sd(`a="x"`, "tkl") === null && sd("tkl=5", "tkl") === null && sd("tkl", "tkl") === null);
  check("§4g sözlük: büyük harfli anahtar biçimsiz (RFC 8941) null", sd(`TKL="${m}"`, "tkl") === null);
  const o = await kabul(w, "§4h manifest isteği Expo-Extra-Params tkl ile", a, istek(man, { "Expo-Extra-Params": `kanal="x", tkl="${m}"`, "expo-platform": "android" }));
  const c = o.cagrilar[0];
  check("§4h' origin'e Expo-Extra-Params gitmedi, expo-platform gitti", !!c && !c.basliklar.has("expo-extra-params") && c.basliklar.get("expo-platform") === "android");
  await ret(w, "§4i Expo-Extra-Params'ta tkl yok", a, istek(man, { "Expo-Extra-Params": `kanal="x"` }), "INDIRME_BELIRTEC_YOK");
  await ret(w, "§4j Expo-Extra-Params'ta bozuk belirteç", a, istek(man, { "Expo-Extra-Params": `tkl="a.b.c"` }), "JWS_BICIM");
  const exe = `/${KANAL}/electron/x.exe`;
  const g = bas("electron");
  const q = await kabul(w, "§4k ?t= ile", a, istek(`${exe}?t=${g}&v=2`));
  check("§4k' origin'e t düştü, öbür sorgu kaldı", q.cagrilar[0]?.url === `${KOK}${exe}?v=2`, q.cagrilar[0]?.url);
  await ret(w, "§4l ?t= boş", a, istek(`${exe}?t=`), "INDIRME_BELIRTEC_YOK");
  await ret(w, "§4m başlık önceliklidir: bozuk başlık + geçerli ?t= RED", a, istek(`${exe}?t=${g}`, bsl("bozuk")), "JWS_BICIM");
  const r = await kabul(w, "§4n Range başlığı korunur", a, istek(exe, { ...bsl(g), Range: "bytes=0-99" }));
  check("§4n' origin Range'i gördü, belirteç başlığını görmedi", r.cagrilar[0]?.basliklar.get("range") === "bytes=0-99" && !r.cagrilar[0]?.basliklar.has("x-tkl-indirme"));
  // 3c' kenar doğrulaması: belirteç başlıkta, önbellek atlatması sorguda (`onbellek-atla` · `cb`).
  const t1 = await kabul(w, "§4o yayın doğrulaması: HEAD + başlık + ?onbellek-atla=", a, istek(`${exe}?onbellek-atla=4242`, bsl(g), "HEAD"));
  check("§4o' origin sorguyu aynen gördü (atlatma işler), belirteç başlığı yok", t1.cagrilar[0]?.url === `${KOK}${exe}?onbellek-atla=4242` && !t1.cagrilar[0]?.basliklar.has("x-tkl-indirme"), t1.cagrilar[0]?.url);
  const t2 = await kabul(w, "§4p temiz URL + başlık", a, istek(exe, bsl(g)));
  check("§4p' önbellek anahtarı belirteçsiz temiz URL (sorgu eklenmedi)", t2.cagrilar[0]?.url === `${KOK}${exe}`, t2.cagrilar[0]?.url);
  const t3 = await kabul(w, "§4q ?cb= + ?t= birlikte", a, istek(`${exe}?cb=7&t=${g}`));
  check("§4q' origin'e yalnız cb gitti (t düştü)", t3.cagrilar[0]?.url === `${KOK}${exe}?cb=7`, t3.cagrilar[0]?.url);
}

interface UreticiModulu {
  imzaBasligi: (govde: string, pem: string, keyid?: string) => string;
  multipartKur: (g: { manifest: unknown; imzaBasligiDegeri: string | null }) => Buffer;
  multipartDogrula: (b: Buffer, pem: string | null) => { manifest: { id: string }; imzali: boolean };
}
const SINIR = "tekserpota";
function parcaGovdesi(metin: string, ad: string): string | null {
  for (const blok of metin.split(`--${SINIR}`)) {
    const kesim = blok.indexOf("\r\n\r\n");
    if (kesim >= 0 && blok.slice(0, kesim).includes(`name="${ad}"`)) return blok.slice(kesim + 4).replace(/\r\n$/, "");
  }
  return null;
}
function parcaBlogu(metin: string, ad: string): string | undefined {
  return metin.split(`--${SINIR}`).find((b) => b.includes(`name="${ad}"`));
}

// §5 — OTA: varlık belirteci bayrağı (varsayılan kapalı) ve imza DIŞI extensions yazımı.
async function bolum5(w: WorkerModulu, u: UreticiModulu): Promise<void> {
  console.log("\n§5 — OTA varlıkları · manifest extensions.assetRequestHeaders");
  const kapali = ayarKur(w);
  const acikAyar = ayarKur(w, { varlikBelirteci: true });
  const damga = `/${KANAL}/mobil/ota/1.0.0/1759000000000`;
  const varlik = `${damga}/_expo/static/js/android/index-abc.hbc`;
  const m = bas("mobil");
  check("§5a varsayılan ayarda varlık belirteci KAPALI", w.VARSAYILAN_AYAR.varlikBelirteci === false);
  const o = await kabul(w, "§5b kapalıyken OTA varlığı anonim (içerik adresli; kapı manifestte)", kapali, istek(varlik));
  check("§5b' varlık değişmez dosya gibi önbelleğe", o.cagrilar[0]?.init?.cf?.cacheEverything === true);
  await ret(w, "§5c kapalıyken kaçışlı varlık yolu kapılı", kapali, istek(`${damga}/..%2F..%2Fapk/x.apk`), "INDIRME_BELIRTEC_YOK");
  await ret(w, "§5d kapalıyken damgasız (sayı olmayan) dizin kapılı", kapali, istek(`/${KANAL}/mobil/ota/1.0.0/eski/x`), "INDIRME_BELIRTEC_YOK");
  await ret(w, "§5e kapalıyken manifest anonim RED", kapali, istek(`/${KANAL}/mobil/ota/1.0.0/manifest`), "INDIRME_BELIRTEC_YOK");
  await ret(w, "§5f kapalıyken apk künyesi anonim RED", kapali, istek(`/${KANAL}/mobil/apk/surum.json`), "INDIRME_BELIRTEC_YOK");
  await ret(w, "§5g açıkken OTA varlığı anonim RED", acikAyar, istek(varlik), "INDIRME_BELIRTEC_YOK");
  await kabul(w, "§5g' açıkken OTA varlığı belirteçle", acikAyar, istek(varlik, bsl(m)));

  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ozel = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const acikPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const manifest = {
    id: "0a1b2c3d-4e5f-4061-8a7b-8c9d0e1f2a3b",
    createdAt: "2026-09-29T12:00:00.000Z",
    runtimeVersion: "1.0.0",
    launchAsset: { hash: "h0", key: "k0", contentType: "application/javascript", fileExtension: ".bundle", url: `${KOK}${varlik}` },
    assets: [{ hash: "h1", key: "k1", contentType: "image/png", fileExtension: ".png", url: `${KOK}${damga}/assets/k1` }, { hash: "h2", key: "k2" }],
    metadata: {},
    extra: {},
  };
  const govde = u.multipartKur({ manifest, imzaBasligiDegeri: u.imzaBasligi(JSON.stringify(manifest), ozel) });
  const originYaniti = () =>
    new Response(new Uint8Array(govde), {
      status: 200,
      headers: { "content-type": `multipart/mixed; boundary=${SINIR}`, "cache-control": "no-cache, must-revalidate" },
    });
  const man = `/${KANAL}/mobil/ota/1.0.0/manifest`;
  const tkl = { "Expo-Extra-Params": `tkl="${m}"` };
  const orijinal = govde.toString("utf8");

  const { y: yKapali } = await kapidan(w, kapali, istek(man, tkl), SIMDI, originYaniti);
  check("§5h bayrak kapalıyken manifest bayt bayt aynen", (await yKapali.text()) === orijinal);
  const { y } = await kapidan(w, acikAyar, istek(man, tkl), SIMDI, originYaniti);
  const metin = await y.text();
  let imzaTamam = false;
  try {
    imzaTamam = u.multipartDogrula(Buffer.from(metin, "utf8"), acikPem).imzali;
  } catch (e) {
    console.log(`   imza: ${(e as Error).message}`);
  }
  check("§5i açıkken yeniden yazılan manifestin İMZASI gerçek doğrulayıcıyla tutar", imzaTamam);
  check("§5i' manifest parçası bayt bayt aynı", parcaBlogu(metin, "manifest") === parcaBlogu(orijinal, "manifest"));
  const ext = JSON.parse(parcaGovdesi(metin, "extensions") ?? "{}") as { assetRequestHeaders?: Record<string, Record<string, string>> };
  const arh = ext.assetRequestHeaders ?? {};
  check("§5j her varlık anahtarına (launch + assets) belirteç başlığı", ["k0", "k1", "k2"].every((k) => arh[k]?.["X-TKL-Indirme"] === m) && Object.keys(arh).length === 3, JSON.stringify(Object.keys(arh)));
  check("§5k belirteçli gövde paylaşılan önbelleğe girmez", y.headers.get("cache-control") === "private, no-store" && y.headers.get("content-type")?.includes(SINIR) === true);
  await kabul(w, "§5l uçtan uca: extensions'taki başlıkla varlık indirilir", acikAyar, istek(varlik, arh.k0 ?? {}));
  const gecisli = ayarKur(w, { varlikBelirteci: true, gecisListesi: [{ yol: man, bitis: msToIso(SIMDI + DAKIKA) }] });
  const { y: yAnonim } = await kapidan(w, gecisli, istek(man), SIMDI, originYaniti);
  check("§5m geçiş listesinden anonim manifest yeniden YAZILMAZ (yazacak belirteç yok)", (await yAnonim.text()) === orijinal);
  const { y: yBozuk } = await kapidan(w, acikAyar, istek(man, tkl), SIMDI, () =>
    new Response("multipart değil", { status: 200, headers: { "content-type": `multipart/mixed; boundary=${SINIR}` } }));
  check("§5n tanınmayan gövde aynen verilir", (await yBozuk.text()) === "multipart değil" && yBozuk.status === 200);
  const eklenmis = w.extensionsYaz(orijinal.replace('{"assetRequestHeaders":{}}', '{"assetRequestHeaders":{},"baska":1}'), SINIR, "T");
  check("§5o extensions'taki başka alanlar korunur", !!eklenmis && (JSON.parse(parcaGovdesi(eklenmis, "extensions") ?? "{}") as { baska?: number }).baska === 1);
  const extsiz = orijinal.replace(parcaBlogu(orijinal, "extensions")!, "").replace(`--${SINIR}--${SINIR}`, `--${SINIR}`);
  const eklendi = w.extensionsYaz(extsiz, SINIR, "T");
  check("§5p extensions parçası yoksa eklenir", !!eklendi && parcaGovdesi(eklendi, "extensions")?.includes('"k0"') === true && parcaGovdesi(extsiz, "extensions") === null);
}

// §6 — ayar (fail-closed) · yöntem · önbellek seçeneği.
async function bolum6(w: WorkerModulu): Promise<void> {
  console.log("\n§6 — ayar · yöntem · önbellek");
  const yml = `/${KANAL}/electron/latest.yml`;
  const gecersizler: [string, unknown][] = [
    ["ayar yok (null)", null],
    ["tanınmayan üst alan", ayarKur(w, { anahtar: [] })],
    ["ind- olmayan kid", ayarKur(w, { anahtarlar: [acik(ALT)] })],
    ["x 32 bayt değil", ayarKur(w, { anahtarlar: [{ kid: "ind-kisa", x: "AAAA" }] })],
    ["kid iki kez", ayarKur(w, { anahtarlar: [acik(IND), { kid: IND.kid, x: IND2.x }] })],
    ["varlikBelirteci dize", ayarKur(w, { varlikBelirteci: "true" })],
    ["onbellekSn negatif", ayarKur(w, { onbellekSn: -1 })],
    ["gecisListesi nesne", ayarKur(w, { gecisListesi: {} })],
  ];
  for (const [ad, ayar] of gecersizler) await ret(w, `§6a ayar geçersiz: ${ad}`, ayar as Ayar, istek(yml, bsl(bas("electron"))), "AYAR_GECERSIZ", 503);
  await kabul(w, "§6a' aynı istek geçerli ayarla", ayarKur(w), istek(yml, bsl(bas("electron"))));
  await ret(w, "§6b boş anahtar listesi: belirteç de reddedilir", ayarKur(w, { anahtarlar: [] }), istek(yml, bsl(bas("electron"))), "JWS_KID");
  for (const y of ["POST", "PUT", "DELETE"]) await ret(w, `§6c ${y} kapsamda 405`, ayarKur(w), istek(yml, bsl(bas("electron")), y), "YONTEM", 405);
  const beklenen = { cacheEverything: true, cacheTtlByStatus: { "200-299": 604800, 404: 1, "500-599": 0 } };
  const g = bas("electron");
  const mb = bas("mobil");
  const degismez = [`/${KANAL}/electron/TeksERP-Setup-1.3.2.exe`, `/${KANAL}/electron/TeksERP-Setup-1.3.2.exe.blockmap`, `/${KANAL}/mobil/apk/teks-1.3.2.apk`];
  for (const yol of degismez) {
    const o = await kabul(w, `§6d değişmez ${yol.split("/").pop()}`, ayarKur(w), istek(yol, bsl(yol.includes("/mobil/") ? mb : g)));
    check(`§6d' ${yol.split("/").pop()}: cacheEverything + 404 bir saniye`, JSON.stringify(o.cagrilar[0]?.init?.cf) === JSON.stringify(beklenen), JSON.stringify(o.cagrilar[0]?.init));
  }
  const degisken = [yml, `/${KANAL}/electron/latest-mac.yaml`, `/${KANAL}/mobil/ota/1.0.0/manifest`, `/${KANAL}/mobil/ota/1.0.0/manifest-2`, `/${KANAL}/mobil/apk/surum.json`];
  for (const yol of degisken) {
    const o = await kabul(w, `§6e değişken ${yol.split("/").slice(-2).join("/")}`, ayarKur(w), istek(yol, bsl(yol.includes("/mobil/") ? mb : g)));
    check(`§6e' ${yol.split("/").pop()}: cf seçeneği YOK (origin no-cache geçerli)`, o.cagrilar[0]?.init === undefined);
  }
  const o = await kabul(w, "§6f onbellekSn ayardan", ayarKur(w, { onbellekSn: 3600 }), istek(degismez[0]!, bsl(g)));
  check("§6f' 200-299 = 3600", (o.cagrilar[0]?.init?.cf?.cacheTtlByStatus as Record<string, number> | undefined)?.["200-299"] === 3600);
}

// §7 — panele yapıştırılan varsayılan dışa aktarım: gerçek saat, env ayarı, küresel fetch.
async function bolum7(w: WorkerModulu): Promise<void> {
  console.log("\n§7 — varsayılan dışa aktarım (env · gerçek saat)");
  const eski = globalThis.fetch;
  const o = sahteOrigin();
  globalThis.fetch = o.fetchImpl as typeof fetch;
  try {
    const simdi = Date.now();
    const g = signDownloadToken({ payload: { ...yuk("electron"), exp: msToIso(simdi + 60 * DAKIKA) }, key: { kid: IND.kid, privateKey: IND.privateKey }, nowMs: simdi });
    const exe = `/${KANAL}/electron/x.exe`;
    const ayar = { anahtarlar: [acik(IND)] };
    const f = w.default.fetch;
    const y0 = await f(istek(exe, bsl(g)), {});
    check("§7a env yok: dosyadaki varsayılan (anahtar yok) → 403 JWS_KID", y0.status === 403 && kodu(y0) === "JWS_KID");
    const y1 = await f(istek(exe, bsl(g)), { TKL_INDIRME_AYAR: JSON.stringify(ayar) });
    check("§7b env dize JSON → 200", y1.status === 200, `${y1.status} ${kodu(y1)}`);
    const y2 = await f(istek(exe, bsl(g)), { TKL_INDIRME_AYAR: ayar });
    check("§7c env nesne (panel JSON değişkeni) → 200", y2.status === 200, `${y2.status} ${kodu(y2)}`);
    const y3 = await f(istek(exe, bsl(g)), { TKL_INDIRME_AYAR: "{bozuk" });
    check("§7d env bozuk JSON → 503 AYAR_GECERSIZ", y3.status === 503 && kodu(y3) === "AYAR_GECERSIZ");
    const y4 = await f(istek(exe, bsl(g)), { TKL_INDIRME_AYAR: "[]" });
    check("§7e env dizi → 503 AYAR_GECERSIZ", y4.status === 503 && kodu(y4) === "AYAR_GECERSIZ");
    const y5 = await f(istek("/saglik"), { TKL_INDIRME_AYAR: "{bozuk" });
    check("§7f env bozukken kapsam dışı yine geçer", y5.status === 200);
    check("§7g origin çağrı sayısı: yalnız kabul edilen 3 istek", o.cagrilar.length === 3, String(o.cagrilar.length));
  } finally {
    globalThis.fetch = eski;
  }
}


// §8 — İNDİRME listesi (L2-8): kid × kanal × pencere, üretim/hazırlık listeleri ayrı.
const HZR = anahtarUret("ind-hazirlik-2026");
const HZR_KANAL = "hazirlik-kanal";
const RUNBOOK = path.join(REPO, "docs/ops/INDIRME-KAPISI-WORKER.md");
function basK(kanal: string, anahtar: TestAnahtari, simdi = SIMDI, urun: "electron" | "mobil" = "electron"): string {
  return signDownloadToken({ payload: { ...yuk(urun, {}, kanal), exp: msToIso(simdi + 60 * DAKIKA) }, key: { kid: anahtar.kid, privateKey: anahtar.privateKey }, nowMs: simdi });
}
function listeAyari(w: WorkerModulu, uretim: unknown, hazirlik: unknown, ek: Ayar = {}): Ayar {
  return { ...w.VARSAYILAN_AYAR, anahtarlar: [], indirmeListesi: { uretim, hazirlik }, ...ek };
}
const exeK = (kanal: string) => `/${kanal}/electron/TeksERP-Setup-1.3.2.exe`;

async function bolum8(w: WorkerModulu): Promise<void> {
  console.log("\n§8 — İNDİRME listesi: kid × kanal × pencere · üretim/hazırlık ayrımı · döndürme · fail-closed ayar");
  const iki = "uretim-iki";
  const a = listeAyari(w, [satir(IND, { kanallar: [KANAL, iki] })], [satir(HZR, { kanallar: [HZR_KANAL] })]);
  check("§8a varsayılan ayarda liste boş ve iki ayrı dizi", JSON.stringify(w.VARSAYILAN_AYAR.indirmeListesi) === JSON.stringify({ uretim: [], hazirlik: [] }) && w.ayarCoz(w.VARSAYILAN_AYAR, SIMDI).ok);
  await kabul(w, "§8b üretim satırı: kanal kümede, pencere içinde", a, istek(exeK(KANAL), bsl(basK(KANAL, IND))));
  await kabul(w, "§8b' aynı anahtar kümedeki ikinci kanal", a, istek(exeK(iki), bsl(basK(iki, IND))));
  await ret(w, "§8c ⭐ hazırlık anahtarı üretim kanalına (G3)", a, istek(exeK(KANAL), bsl(basK(KANAL, HZR))), "INDIRME_KANAL");
  await kabul(w, "§8c' hazırlık anahtarı kendi kanalına", a, istek(exeK(HZR_KANAL), bsl(basK(HZR_KANAL, HZR))));
  await ret(w, "§8d ⭐ üretim anahtarı hazırlık kanalına (G3, öbür yön)", a, istek(exeK(HZR_KANAL), bsl(basK(HZR_KANAL, IND))), "INDIRME_KANAL");
  await ret(w, "§8e tanınmayan kid (listede yok)", a, istek(exeK(KANAL), bsl(basK(KANAL, YABANCI))), "JWS_KID");
  await kabul(w, "§8e' aynı kid listeye girince", listeAyari(w, [satir(IND), satir(YABANCI)], []), istek(exeK(KANAL), bsl(basK(KANAL, YABANCI))));

  const bas0 = SIMDI + GUN;
  const bit0 = SIMDI + 121 * GUN;
  const p = listeAyari(w, [satir(IND, { baslangic: msToIso(bas0), bitis: msToIso(bit0) })], []);
  await ret(w, "§8f pencere başlamadı (1 gün önce)", p, istek(exeK(KANAL), bsl(basK(KANAL, IND))), "INDIRME_PENCERE");
  await ret(w, "§8f' başlangıçtan 11 dk önce", p, istek(exeK(KANAL), bsl(basK(KANAL, IND, bas0 - 11 * DAKIKA))), "INDIRME_PENCERE", 403, bas0 - 11 * DAKIKA);
  await kabul(w, "§8f'' başlangıçtan 9 dk önce (tolerans)", p, istek(exeK(KANAL), bsl(basK(KANAL, IND, bas0 - 9 * DAKIKA))), bas0 - 9 * DAKIKA);
  await kabul(w, "§8g bitişten 9 dk sonra (tolerans)", p, istek(exeK(KANAL), bsl(basK(KANAL, IND, bit0 + 9 * DAKIKA))), bit0 + 9 * DAKIKA);
  await ret(w, "§8g' bitişten 11 dk sonra", p, istek(exeK(KANAL), bsl(basK(KANAL, IND, bit0 + 11 * DAKIKA))), "INDIRME_PENCERE", 403, bit0 + 11 * DAKIKA);

  // Örtüşmeli döndürme: eski (ind-2026, bitişi tören + 30 g) ve yeni (ind-2026-yedek, tören anından 120 g) birlikte listede.
  const toren = SIMDI;
  const r = listeAyari(w, [
    satir(IND, { baslangic: msToIso(toren - 90 * GUN), bitis: msToIso(toren + 30 * GUN) }),
    satir(IND2, { baslangic: msToIso(toren), bitis: msToIso(toren + 120 * GUN) }),
  ], []);
  const t1 = toren + 60 * DAKIKA;
  await kabul(w, "§8h örtüşme: eski kid tören sonrası hâlâ geçer", r, istek(exeK(KANAL), bsl(basK(KANAL, IND, t1))), t1);
  await kabul(w, "§8h' örtüşme: yeni kid tören anından itibaren geçer", r, istek(exeK(KANAL), bsl(basK(KANAL, IND2, t1))), t1);
  const t2 = toren + 30 * GUN + 11 * DAKIKA;
  await ret(w, "§8i eski kid penceresi kendiliğinden kapandı (satır silinmeden)", r, istek(exeK(KANAL), bsl(basK(KANAL, IND, t2))), "INDIRME_PENCERE", 403, t2);
  await kabul(w, "§8i' yeni kid aynı anda geçer", r, istek(exeK(KANAL), bsl(basK(KANAL, IND2, t2))), t2);

  const eski = { ...w.VARSAYILAN_AYAR, anahtarlar: [acik(IND2)], indirmeListesi: { uretim: [satir(IND)], hazirlik: [] } };
  await kabul(w, "§8j eski biçim (bir sürüm) liste ile birlikte: eski kid kısıtsız, başka kanal", eski, istek(exeK("baska-kanal"), bsl(basK("baska-kanal", IND2))));
  await ret(w, "§8j' liste satırı aynı ayarda kanalına bağlı", eski, istek(exeK("baska-kanal"), bsl(basK("baska-kanal", IND))), "INDIRME_KANAL");

  const yml = `/${KANAL}/electron/latest.yml`;
  const gecerli = bsl(basK(KANAL, IND));
  const S = (ek: Partial<Record<string, unknown>> = {}) => ({ ...satir(IND), ...ek });
  const alansiz = (o: Record<string, unknown>, alan: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== alan));
  const gecersizler: [string, Ayar, Ayar][] = [
    ["indirmeListesi dizi", { ...w.VARSAYILAN_AYAR, indirmeListesi: [] }, listeAyari(w, [], [])],
    ["indirmeListesi null", { ...w.VARSAYILAN_AYAR, indirmeListesi: null }, listeAyari(w, [satir(IND)], [])],
    ["tanınmayan liste adı", { ...w.VARSAYILAN_AYAR, indirmeListesi: { uretim: [satir(IND)], hazirlik: [], test: [] } }, listeAyari(w, [satir(IND)], [])],
    ["hazırlık listesi eksik", { ...w.VARSAYILAN_AYAR, indirmeListesi: { uretim: [satir(IND)] } }, listeAyari(w, [satir(IND)], [])],
    ["liste dizi değil", listeAyari(w, { 0: satir(IND) }, []), listeAyari(w, [satir(IND)], [])],
    ["satırda tanınmayan alan", listeAyari(w, [S({ sinif: "URETIM" })], []), listeAyari(w, [S()], [])],
    ["satırda bitiş yok", listeAyari(w, [alansiz(S(), "bitis")], []), listeAyari(w, [S()], [])],
    ["kid ind- değil", listeAyari(w, [{ ...S(), kid: ALT.kid, x: ALT.x }], []), listeAyari(w, [S()], [])],
    ["x biçimsiz", listeAyari(w, [S({ x: "AAAA" })], []), listeAyari(w, [S()], [])],
    ["kanallar boş", listeAyari(w, [S({ kanallar: [] })], []), listeAyari(w, [S()], [])],
    ["kanallar dize", listeAyari(w, [S({ kanallar: KANAL })], []), listeAyari(w, [S()], [])],
    ["kanal biçimsiz (büyük harf)", listeAyari(w, [S({ kanallar: [KANAL, "Deneme"] })], []), listeAyari(w, [S({ kanallar: [KANAL, "deneme"] })], [])],
    ["kanal iki kez", listeAyari(w, [S({ kanallar: [KANAL, KANAL] })], []), listeAyari(w, [S({ kanallar: [KANAL] })], [])],
    ["başlangıç tarihsiz saat yok", listeAyari(w, [S({ baslangic: "2026-09-29" })], []), listeAyari(w, [S()], [])],
    ["pencere ters (bitiş < başlangıç)", listeAyari(w, [S({ baslangic: msToIso(SIMDI + GUN), bitis: msToIso(SIMDI - GUN) })], []), listeAyari(w, [S()], [])],
    ["pencere 731 gün", listeAyari(w, [S({ baslangic: msToIso(SIMDI - GUN), bitis: msToIso(SIMDI + 730 * GUN) })], []), listeAyari(w, [S({ baslangic: msToIso(SIMDI - GUN), bitis: msToIso(SIMDI + 729 * GUN) })], [])],
    ["aynı kid iki listede", listeAyari(w, [S()], [{ ...satir(IND, { kanallar: [HZR_KANAL] }), x: HZR.x }]), listeAyari(w, [S()], [satir(HZR, { kanallar: [HZR_KANAL] })])],
    ["aynı kid eski biçimde ve listede", listeAyari(w, [S()], [], { anahtarlar: [acik(IND)] }), listeAyari(w, [S()], [], { anahtarlar: [acik(IND2)] })],
    ["aynı açık anahtar iki kid'de", listeAyari(w, [S(), { ...satir(IND2), x: IND.x }], []), listeAyari(w, [S(), satir(IND2)], [])],
    ["⭐ kanal iki listede (G3)", listeAyari(w, [S()], [satir(HZR, { kanallar: [HZR_KANAL, KANAL] })]), listeAyari(w, [S()], [satir(HZR, { kanallar: [HZR_KANAL] })])],
    ["eski biçim satırı kanal taşıyor (yanlış diziye yapıştırma)", listeAyari(w, [], [], { anahtarlar: [satir(IND)] }), listeAyari(w, [satir(IND)], [])],
    ["eski biçim + listede aynı açık anahtar", listeAyari(w, [S()], [], { anahtarlar: [{ kid: IND2.kid, x: IND.x }] }), listeAyari(w, [S()], [], { anahtarlar: [acik(IND2)] })],
  ];
  for (const [ad, bozuk, komsu] of gecersizler) {
    await ret(w, `§8k ayar geçersiz: ${ad}`, bozuk, istek(yml, gecerli), "AYAR_GECERSIZ", 503);
    const { y, o } = await kapidan(w, komsu, istek(yml, gecerli));
    // Komşu ayar GEÇERLİ olmalı: kabul (200) ya da belirtecin kendi kodu (ör. boş listede JWS_KID) — 503 değil.
    check(`§8k' geçerli komşu: ${ad}`, y.status !== 503 && (y.status === 200 ? o.cagrilar.length === 1 : o.cagrilar.length === 0), `${y.status} ${kodu(y)}`);
  }
  await kabul(w, "§8l geçmiş pencereli satır ayarı GEÇERSİZ KILMAZ (temizlik ayrı)", listeAyari(w, [satir(IND2, { baslangic: msToIso(SIMDI - 200 * GUN), bitis: msToIso(SIMDI - 80 * GUN) }), S()], []), istek(yml, gecerli));

  // Varsayılan dışa aktarım: panel değişkeni JSON dizesi, gerçek saat.
  const eskiFetch = globalThis.fetch;
  const o = sahteOrigin();
  globalThis.fetch = o.fetchImpl as typeof fetch;
  try {
    const simdi = Date.now();
    const satirSimdi = { kid: IND.kid, x: IND.x, kanallar: [KANAL], baslangic: msToIso(simdi - GUN), bitis: msToIso(simdi + 119 * GUN) };
    const env = { TKL_INDIRME_AYAR: JSON.stringify({ indirmeListesi: { uretim: [satirSimdi], hazirlik: [] } }) };
    const y1 = await w.default.fetch(istek(exeK(KANAL), bsl(basK(KANAL, IND, simdi))), env);
    const y2 = await w.default.fetch(istek(exeK(HZR_KANAL), bsl(basK(HZR_KANAL, IND, simdi))), env);
    check("§8m env dize JSON (yalnız indirmeListesi): kanal içi 200, kanal dışı 403 INDIRME_KANAL", y1.status === 200 && y2.status === 403 && kodu(y2) === "INDIRME_KANAL", `${y1.status} ${kodu(y1)} / ${y2.status} ${kodu(y2)}`);
  } finally {
    globalThis.fetch = eskiFetch;
  }

  // Runbook'taki yapıştırma şablonu Worker'ın kabul ettiği biçimde mi? Yer tutucular test değerleriyle doldurulur.
  const metin = readFileSync(RUNBOOK, "utf8");
  const blok = /<!-- indirme-listesi-sablonu -->\s*```json\n([\s\S]*?)```/.exec(metin)?.[1];
  let sablon: Ayar | null = null;
  if (blok) {
    let n = 0;
    const xler = [IND.x, HZR.x, IND2.x, YABANCI.x];
    const dolu = blok
      .replace(/"x": "<[^"]*>"/g, () => `"x": "${xler[n++ % xler.length]}"`)
      .replace(/"baslangic": "<[^"]*>"/g, `"baslangic": "${msToIso(SIMDI - GUN)}"`)
      .replace(/"bitis": "<[^"]*>"/g, `"bitis": "${msToIso(SIMDI + 119 * GUN)}"`);
    try {
      const ayrik: unknown = JSON.parse(dolu);
      if (typeof ayrik === "object" && ayrik !== null && !Array.isArray(ayrik)) sablon = { ...ayrik };
    } catch {
      sablon = null;
    }
  }
  const sablonCozum = sablon ? w.ayarCoz({ ...w.VARSAYILAN_AYAR, ...sablon }, SIMDI) : { ok: false, neden: "şablon bloğu bulunamadı ya da JSON değil" };
  const liste = sablon?.indirmeListesi;
  const listeli = typeof liste === "object" && liste !== null && "uretim" in liste && Array.isArray(liste.uretim) && liste.uretim.length > 0;
  check("§8n runbook şablonu (INDIRME-KAPISI-WORKER.md §8) doldurulunca Worker ayarı GEÇERLİ ve liste biçiminde", sablonCozum.ok && listeli, sablonCozum.neden ?? "");
}

// §9 — backend/ öneki (Dağıtım v2): tek ürün kümesi, önek ayrımı, işaretçi değişken.
async function bolum9(w: WorkerModulu): Promise<void> {
  console.log("\n§9 — backend/ öneki");
  check("§9a Worker ürün dizinleri = kâhin DOWNLOAD_PRODUCTS", JSON.stringify([...w.URUN_DIZINLERI]) === JSON.stringify([...DOWNLOAD_PRODUCTS]), JSON.stringify(w.URUN_DIZINLERI));
  const a = ayarKur(w);
  const be = bas("backend");
  const zip = `/${KANAL}/backend/2.11.0/tekserp-backend-2.11.0.zip`;
  const son = `/${KANAL}/backend/son.json`;
  const o = await kabul(w, "§9b backend belirteci → paket zip", a, istek(zip, bsl(be)));
  check("§9b' zip DEĞİŞMEZ: kenar önbelleği", o.cagrilar[0]?.init?.cf?.cacheEverything === true);
  const o2 = await kabul(w, "§9c backend belirteci → son.json", a, istek(son, bsl(be)));
  check("§9c' son.json DEĞİŞKEN: cf seçeneği YOK", o2.cagrilar[0]?.init === undefined);
  await kabul(w, "§9d backend belirteci → sürüm işaretçisi", a, istek(`/${KANAL}/backend/2.11.0/surum.json`, bsl(be)));
  await ret(w, "§9e belirteçsiz son.json", a, istek(son), "INDIRME_BELIRTEC_YOK");
  await ret(w, "§9f electron belirteci backend/de", a, istek(son, bsl(bas("electron"))), "INDIRME_YOL");
  await ret(w, "§9g backend belirteci electron/da", a, istek(`/${KANAL}/electron/latest.yml`, bsl(be)), "INDIRME_YOL");
  await ret(w, "§9h başka kanalın backend'i", a, istek("/baska-kanal/backend/son.json", bsl(be)), "INDIRME_YOL");
  await ret(w, "§9i kodlanmış atlatma (%62ackend)", a, istek(`/${KANAL}/%62ackend/son.json`), "INDIRME_BELIRTEC_YOK");
  const { y, o: o3 } = await kapidan(w, a, istek(`/${KANAL}/backendx/a`, {}, "POST"));
  check("§9j benzer ad (backendx) kapsam dışı, aynen geçer", y.status === 200 && o3.cagrilar.length === 1);
}

// §10 — tek ortak paket (O9): grup-nötr OTA takma adı + yeni adresin ayarı (K-5).
const YENI_AYAR = path.join(REPO, "deploy/guncelleme-sunucusu/worker/indir-ayar.json");
const IND_YENI = anahtarUret("ind-2026-2");
const IND_EMEKLI = anahtarUret("ind-2026");
const TAKMA = "/ota/55.0/manifest";
async function bolum10(w: WorkerModulu): Promise<void> {
  console.log("\n§10 — OTA takma adı · zincirli işaretçiler · yeni adres ayarı (K-5)");
  const gruplar = [...UPDATE_GROUPS];
  const a = listeAyari(w, [satir(IND_YENI, { kanallar: gruplar })], []);
  const tb = (kanal: string, urun: "electron" | "mobil" = "mobil", anahtar = IND_YENI) => basK(kanal, anahtar, SIMDI, urun);
  await ret(w, "§10a ⭐ takma ad belirteçsiz", a, istek(TAKMA), "INDIRME_BELIRTEC_YOK");
  for (const g of gruplar) {
    const o = await kabul(w, `§10b ${g} belirteci → takma ad`, a, istek(TAKMA, bsl(tb(g))));
    const c = o.cagrilar[0];
    check(`§10b' ⭐ origin isteği ${g} grubunun GERÇEK yolu, belirteçsiz, önbelleksiz`,
      c?.url === `${KOK}/${g}/mobil/ota/55.0/manifest` && !c.basliklar.has("x-tkl-indirme") && c.init === undefined, c?.url ?? "çağrı yok");
  }
  await ret(w, "§10c electron belirteci takma adda", a, istek(TAKMA, bsl(tb("test", "electron"))), "INDIRME_YOL");
  const capraz = hamImzala(TYP.INDIRME, IND_YENI, { ...yuk("mobil", {}, "test"), yolOneki: "/oncu/mobil/" });
  const { y: cy, o: co } = await kapidan(w, a, istek(TAKMA, bsl(capraz)));
  check("§10d kanalı test, öneki oncu olan belirteç takma adda RED (şema ya da önek)", cy.status === 403 && co.cagrilar.length === 0, `${cy.status} ${kodu(cy)}`);
  await ret(w, "§10e listede olmayan grup (demofabrika) belirteci", a, istek(TAKMA, bsl(tb("demofabrika"))), "INDIRME_KANAL");
  const gecisli = listeAyari(w, [satir(IND_YENI, { kanallar: gruplar })], [], { gecisListesi: [{ yol: "/test/mobil/ota/55.0/manifest", bitis: msToIso(SIMDI + GUN) }] });
  await kabul(w, "§10f' gerçek yol geçiş listesinde: belirteçsiz 200 (kıyas)", gecisli, istek("/test/mobil/ota/55.0/manifest"));
  await ret(w, "§10f ⭐ geçiş listesi takma adda uygulanmaz", gecisli, istek(TAKMA), "INDIRME_BELIRTEC_YOK");
  const bicimler = ["//ota/55.0/manifest", "/%6fta/55.0/manifest", "/OTA/55.0/manifest", "/ota/55.0//manifest", "/ota//55.0/manifest",
    "/ota/55.0/manifest/", "/ota/55.0/%6danifest", "/ota/55.0/manifest-1790619945836", "/ota/abc/manifest", "/ota/55.0/x/manifest",
    "/ota/%E0%A4%A/manifest", "/ota", "/ota/", "/ota/55.0/manifest%2F..%2F..%2Ftest%2Fmobil%2Fapk%2Fx.apk"];
  for (const yol of bicimler) await ret(w, `§10g ⭐ takma ad biçimi ${yol} (geçerli belirteçle bile)`, a, istek(yol, bsl(tb("test"))), "INDIRME_YOL");
  await ret(w, "§10g' kodlanmış takma ad belirteçsiz de kapılı", a, istek("/%6fta/55.0/manifest"), "INDIRME_YOL");
  await ret(w, "§10h takma ad POST", a, istek(TAKMA, {}, "POST"), "YONTEM", 405);
  await kabul(w, "§10i takma ad HEAD belirteçle", a, istek(TAKMA, bsl(tb("oncu")), "HEAD"));
  const ot = await kabul(w, "§10j takma ad ?t=", a, istek(`${TAKMA}?t=${encodeURIComponent(tb("genel"))}`));
  check("§10j' origin'e ?t= gitmez", ot.cagrilar[0]?.url === `${KOK}/genel/mobil/ota/55.0/manifest`, ot.cagrilar[0]?.url ?? "");
  await kabul(w, "§10k takma ad Expo-Extra-Params tkl (tabletin yolu)", a, istek(TAKMA, { "Expo-Extra-Params": `tkl="${tb("test")}"` }));
  const dolmus = signDownloadToken({ payload: { ...yuk("mobil", {}, "test"), exp: msToIso(SIMDI + 5 * DAKIKA) }, key: { kid: IND_YENI.kid, privateKey: IND_YENI.privateKey }, nowMs: SIMDI });
  await ret(w, "§10l süresi dolmuş belirteç takma adda", a, istek(TAKMA, bsl(dolmus)), "BELGE_SURESI_DOLDU", 403, SIMDI + 20 * DAKIKA);
  for (const yol of ["/otax/a", "/ot/55.0/manifest", "/otamobil/55.0/manifest"]) {
    const r = istek(yol, {}, "POST");
    const { y, o } = await kapidan(w, a, r);
    check(`§10m benzer ad ${yol} kapsam dışı, aynen geçer`, y.status === 200 && o.cagrilar.length === 1 && o.cagrilar[0]!.istek === r);
  }
  const beB = signDownloadToken({ payload: yuk("backend", {}, "test"), key: { kid: IND_YENI.kid, privateKey: IND_YENI.privateKey }, nowMs: SIMDI });
  for (const ad of [CHAINED_RELEASE_POINTER_FILE, `2.20.0/${CHAINED_RELEASE_MANIFEST_FILE}`, CHAINED_PG_POINTER_FILE]) {
    const o = await kabul(w, `§10n zincirli işaretçi ${ad}`, a, istek(`/test/backend/${ad}`, bsl(beB)));
    check(`§10n' ⭐ ${ad} DEĞİŞKEN: cf seçeneği YOK`, o.cagrilar[0]?.init === undefined);
  }
  const zo = await kabul(w, "§10n'' zincir paketi zip (kıyas)", a, istek("/test/backend/2.20.0/tekserp-backend-2.20.0.zip", bsl(beB)));
  check("§10n''' zip DEĞİŞMEZ: kenar önbelleği", zo.cagrilar[0]?.init?.cf?.cacheEverything === true);

  // Yeni adresin ayarı — panele yapıştırılacak metin bu dosyadır.
  let ham: Record<string, unknown> | null = null;
  try {
    ham = JSON.parse(readFileSync(YENI_AYAR, "utf8")) as Record<string, unknown>;
  } catch (e) {
    check("§10o yeni adres ayarı okunur", false, String(e));
    return;
  }
  const liste = ham.indirmeListesi as { uretim?: AnahtarSatiri[]; hazirlik?: unknown[] } | undefined;
  const uretim = Array.isArray(liste?.uretim) ? liste.uretim : [];
  const yeniSatir = uretim.find((r) => r.kid === IND_YENI.kid);
  const orta = yeniSatir ? Date.parse(String(yeniSatir.baslangic)) + GUN : SIMDI;
  const cozum = w.ayarCoz({ ...w.VARSAYILAN_AYAR, ...ham }, orta);
  check("§10o yeni adres ayarı Worker'da GEÇERLİ (pencere içinde)", cozum.ok, cozum.neden ?? "");
  check("§10p ⭐ K-5: emekli kid (ind-2026) yeni adres ayarında YOK", uretim.length > 0 && uretim.every((r) => r.kid !== IND_EMEKLI.kid), uretim.map((r) => r.kid).join(", "));
  const kumeler = uretim.map((r) => JSON.stringify(r.kanallar));
  check("§10q her satırın kanalları = backend UPDATE_GROUPS (dağıtım zinciri)", kumeler.every((k) => k === JSON.stringify(gruplar)), kumeler.join(" · "));
  check("§10r eski biçim (anahtarlar), hazırlık listesi, geçiş listesi BOŞ",
    JSON.stringify(ham.anahtarlar) === "[]" && JSON.stringify(liste?.hazirlik) === "[]" && JSON.stringify(ham.gecisListesi) === "[]", JSON.stringify({ a: ham.anahtarlar, h: liste?.hazirlik, g: ham.gecisListesi }));
  // Davranış: aynı ayar, satırların açık anahtarı test anahtarıyla değiştirilmiş (özel yarı yalnız satıcıda).
  const kopya = { ...w.VARSAYILAN_AYAR, ...ham, indirmeListesi: { ...liste, uretim: uretim.map((r) => (r.kid === IND_YENI.kid ? { ...r, x: IND_YENI.x } : r)) } };
  const an = (kanal: string, anahtar: TestAnahtari) => signDownloadToken({ payload: { ...yuk("mobil", {}, kanal), exp: msToIso(orta + 60 * DAKIKA) }, key: { kid: anahtar.kid, privateKey: anahtar.privateKey }, nowMs: orta });
  await kabul(w, "§10s yeni ayarda ind-2026-2 belirteci takma adda", kopya, istek(TAKMA, bsl(an("test", IND_YENI))), orta);
  await ret(w, "§10t ⭐ K-5: ind-2026 ile imzalı belirteç yeni adreste RED", kopya, istek(TAKMA, bsl(an("test", IND_EMEKLI))), "JWS_KID", 403, orta);
  await ret(w, "§10u yeni ayarda eski kanal (demofabrika) belirteci RED", kopya, istek("/demofabrika/mobil/apk/surum.json", bsl(an("demofabrika", IND_YENI))), "INDIRME_KANAL", 403, orta);
}

async function main(): Promise<void> {
  const w = await yukle<WorkerModulu>(WORKER_YOLU);
  const u = await yukle<UreticiModulu>(MANIFEST_URETICI);
  await bolum0(w);
  await bolum1(w);
  await bolum2(w);
  await bolum3(w);
  await bolum4(w);
  await bolum5(w, u);
  await bolum6(w);
  await bolum7(w);
  await bolum8(w);
  await bolum9(w);
  await bolum10(w);
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("❌ Bekçi çöktü:", e);
  process.exit(1);
});
