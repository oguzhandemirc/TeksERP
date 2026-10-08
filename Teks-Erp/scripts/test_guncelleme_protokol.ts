// =============================================================================
// BEKÇİ — GÜNCELLEME SÖZLEŞMESİ (Dağıtım v2): sürüm bildirimi · kira politikası · pencere · karar · rapor
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts guncelleme_protokol   (DB'SİZ, ağsız)
//             npx tsx scripts/test_guncelleme_protokol.ts --vektor-yaz  (vektör dosyalarını TS'ten yeniden üretir)
//
// NE ÖLÇER: `src/lib/license/protocol/guncelleme.ts` + `guncelleme-karar.ts` + `belgeler.ts` güncelleme alanları — satıcı, backend
// ve Rust güncelleyici (D2) bu sözleşmeye karşı yazılır; anlatım `docs/design/GUNCELLEYICI.md` §1–§3.
//   §1 bildirim: geçerli · kurcalı · typ · bilinmeyen/süzülmüş anahtar · imzalayan≠paketImzaKid · kanal ·
//      şema (sürüm eki, yol, özet, kaynak sınırı, derleme/yayın, platform) · v:2 · ek alan atılır
//   §2 işaretçi: geçerli · JSON değil · fazla alan · v:2 · boş · tavan
//   §3 kira politikası: varsayılan (alan yok = ONAYLI) · kip/pencere/aralık kuralları · kira ömrü bağı ·
//      eski doğrulayıcı alanı atar · indirme öneki backend/
//   §4 pencere aritmetiği: İstanbul · gece yarısı · gün süzgeci · 24:00 · yaz saati boşluğu/çifti ·
//      bilinmeyen dilim · çıktı şemadan geçer · tavan
//   §5 karar tablosu: her neden en az bir kez, sıra (yetki → sürüm → uygunluk → zamanlama); PG kararı
//      (sözleşme sürümü 2): ana sürüm farkı hiçbir kipte otomatik değil · kendi örnekte hedef yeniyse birlikte ·
//      harici örneğe dokunulmaz (yalnız enAz) · geri inme yok
//   §1'' PG künyesi `tekserp-pg` (sözleşme sürümü 2): geçerli · kurcalı · typ · anahtar · ana sürüm ≠ çizgi ·
//      derleme · v:2 · ürün; §7' PG bağı: hedef yok · özet · ANA SÜRÜM · ICU · derleme
//   §6 sürüm karşılaştırma (semver önceliği)  §7 paket bağı  §8 rapor şeması KATI
//   §9 vektör dosyaları (`native/test-vektorleri/guncelleme-*.json`, Rust güncelleyici de okur): her
//      kaydın beklenen sonucu BUGÜNKÜ TS'le aynı (bayat yok) · kapsam (her neden/kod en az bir kayıtta)
//   §1s5 sözleşme 5 (Linux/OCI): ayrı ürün yolu `backend-oci` · platform okuyanın hedefi (`SURUM_PLATFORM`, kanaldan
//      sonra) · imaj yalnız ve zorunlu Linux'ta · uzantı platformun · Linux'ta PG hedefi yok · güncelleyici bloğu
//      eski okuyucuda atılır · künye ürünü platformun (`backend-docker`) · karar tablosu platformdan bağımsız
//   §10 ⭐ KALICI SONDA ✓K (her koşumda): bayatlık karşılaştırıcısı mutasyonlu beklenende ısırır,
//      eşitte susar · kapsam denetimi eksik nedeni yakalar
//
// NEGATİF SONDA — dosya DIŞI mutasyonlar (bir kezlik, ✓B; sayılar commit mesajında):
//   bkz. Teks-Erp/docs/BEKCI-HARITASI.md `## lisans` satırı (test_guncelleme_protokol).
// =============================================================================
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  DOWNLOAD_PRODUCTS,
  DownloadSchema,
  LeaseSchema,
  LeaseUpdatePolicySchema,
  PACKAGE_IDENTITY_PRODUCTS,
  PG_PLATFORMS,
  PROTOCOL_ERROR_CODES,
  RELEASE_PACKAGE_EXTENSIONS,
  RELEASE_PRODUCT_DIRS,
  DOWNLOAD_PRODUCTS_BY_PLATFORM,
  backendDownloadPrefix,
  downloadPlatformOf,
  UPDATE_PLATFORMS,
  UPDATE_DECISION_REASONS,
  UPDATE_DECISIONS,
  UPDATE_INTERVAL_MAX,
  UpdateIntervalSchema,
  decodeDocument,
  defaultUpdatePolicy,
  isKnownTimeZone,
  pgReleaseFilePath,
  releaseFilePath,
  releasePointerPath,
  windowIntervals,
} from "../src/lib/license/protocol";
import { DEFAULT_FACTORY_TIMEZONE } from "../src/constants/time";
import { jsonEsit } from "./lib/lisans-cekirdek-vektor";
import {
  GUNCELLEME_VEKTOR_BICIMI,
  GUNCELLEME_VEKTOR_DOSYALARI,
  guncellemeDegerlendir,
  guncellemeVektorDizini,
  guncellemeVektorMetni,
  guncellemeVektorleriKur,
  type GuncellemeVektorKaydi,
} from "./lib/guncelleme-vektor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const TEKS = path.resolve(__dirname, "..");
const DIZIN = guncellemeVektorDizini(TEKS);
const IST = DEFAULT_FACTORY_TIMEZONE;
const T0 = Date.parse("2026-10-01T00:00:00.000Z");
const GUN = 86_400_000;

type Beklenen = { ok: true; value?: unknown } | { ok: false; code?: string };

function kodu(b: unknown): string {
  if (typeof b !== "object" || b === null) return JSON.stringify(b);
  const r = b as Record<string, unknown>;
  return r.ok === true ? "OK" : String(r.code ?? "RED");
}

/** Taze kayıtlar: bölüm testleri adla kaydı bulur ve beklenenine bakar (vektör ve test aynı kaynaktan). */
const TAZE = guncellemeVektorleriKur();
const TUM = Object.values(TAZE).flat();
type Tur = GuncellemeVektorKaydi["vektor"]["tur"];
function kayit(tur: Tur, ad: string): GuncellemeVektorKaydi {
  const k = TUM.find((x) => x.vektor.tur === tur && x.vektor.ad === ad);
  if (!k) throw new Error(`vektör yok: ${tur}:${ad}`);
  return k;
}
function beklenenKod(tur: Tur, ad: string, kod: string): void {
  const k = kayit(tur, ad);
  check(`${tur}: ${ad} → ${kod}`, kodu(k.beklenen) === kod, kodu(k.beklenen));
}

function bolum1(): void {
  console.log("\n§1 — sürüm bildirimi (tekserp-surum, PAKET imzalı)");
  beklenenKod("bildirim", "geçerli bildirim", "OK");
  beklenenKod("bildirim", "üretim anahtarıyla geçerli bildirim", "OK");
  beklenenKod("bildirim", "yük kurcalandı", "JWS_IMZA");
  beklenenKod("bildirim", "başka kanalın bildirimi (tekrar oynatma)", "SURUM_KANAL");
  beklenenKod("bildirim", "bilinmeyen anahtar", "JWS_KID");
  beklenenKod("bildirim", "hazırlık anahtarı çağıranın kümesinde yok (ÜRETİM kurulumu)", "JWS_KID");
  beklenenKod("bildirim", "yanlış belge türü (bütünlük typ'i)", "JWS_TYP");
  beklenenKod("bildirim", "imzalayan paketImzaKid değil", "SURUM_ANAHTAR");
  beklenenKod("bildirim", "v:2", "BELGE_SURUM");
  for (const ad of ["sürümde +yapı eki", "paket adında yol", "sha256 büyük harf", "minKaynakSurum sürümden yeni", "derleme yayından sonra", "platform linux"]) beklenenKod("bildirim", ad, "BELGE_SEMA");
  beklenenKod("bildirim", "pg hedefsiz (küçük sürüm güncellemesi yok)", "OK");
  for (const ad of ["pg enAz başka ana sürümde", "pg hedef başka ana sürümde (17)", "pg hedef enAz'dan eski", "pg eski biçim (gerekenSurum) — sözleşme sürümü 1"]) beklenenKod("bildirim", ad, "BELGE_SEMA");
  console.log("\n§1'' — PG paketi künyesi (tekserp-pg, sözleşme sürümü 2)");
  beklenenKod("pg-kunye", "geçerli PG künyesi", "OK");
  beklenenKod("pg-kunye", "PG künyesi kurcalandı", "JWS_IMZA");
  beklenenKod("pg-kunye", "PG künyesi yanlış tür (tekserp-surum)", "JWS_TYP");
  beklenenKod("pg-kunye", "PG künyesi bilinmeyen anahtar", "JWS_KID");
  beklenenKod("pg-kunye", "PG künyesi v:2", "BELGE_SURUM");
  for (const ad of ["PG sürümü çizginin ana sürümünde değil", "PG derlemesi 0", "PG künyesi başka ürün"]) beklenenKod("pg-kunye", ad, "BELGE_SEMA");
  check("§1'' yol yardımcısı", pgReleaseFilePath("k1", "16.15", 4, "pg.json") === "/k1/backend/pg/16.15-4/pg.json");
  const ek = kayit("bildirim", "tanınmayan alan atılır (v:1 ekleme)").beklenen as { ok: boolean; value?: Record<string, unknown> };
  check("§1 tanınmayan alan doğrulamada ATILIR (v:1 içinde ekleme kırmaz)", ek.ok === true && !!ek.value && !("yeniBilgi" in ek.value));
  check("§1 yol yardımcıları", releasePointerPath("testfabrika") === "/testfabrika/backend/son.json" && releaseFilePath("k1", "2.11.0", "a.zip") === "/k1/backend/2.11.0/a.zip");
  check("§1 protokol kodları kayıtlı (SURUM_* · PAKET_BAGI · PG_BAGI)", ["SURUM_ISARETCI", "SURUM_KANAL", "SURUM_ANAHTAR", "PAKET_BAGI", "PG_BAGI"].every((c) => (PROTOCOL_ERROR_CODES as readonly string[]).includes(c)));
}

function bolum1s5(): void {
  console.log("\n§1s5 — sözleşme 5: Linux/OCI bildirimi (ayrı ürün yolu, platform okuyanın hedefi)");
  check("§1s5a platformlar win32-x64 · linux-x64-oci; PG künyesi yalnız Windows", jsonEsit([...UPDATE_PLATFORMS], ["win32-x64", "linux-x64-oci"]) && jsonEsit([...PG_PLATFORMS], ["win32-x64"]));
  const dizinler = UPDATE_PLATFORMS.map((p) => RELEASE_PRODUCT_DIRS[p]);
  check("§1s5b ürün yolları platform başına AYRI (Windows yolu backend/ — değişmedi)", new Set(dizinler).size === UPDATE_PLATFORMS.length && RELEASE_PRODUCT_DIRS["win32-x64"] === "backend" && RELEASE_PRODUCT_DIRS["linux-x64-oci"] === "backend-oci", dizinler.join(","));
  check(
    "§1s5c yol yardımcıları: platformsuz çağrı bugünkü yol, Linux backend-oci/",
    releasePointerPath("test") === "/test/backend/son.json" &&
      releasePointerPath("test", "linux-x64-oci") === "/test/backend-oci/son.json" &&
      releaseFilePath("test", "2.11.0", "a.tar", "linux-x64-oci") === "/test/backend-oci/2.11.0/a.tar",
  );
  check("§1s5d künye ürünü ve uzantı platform başına", PACKAGE_IDENTITY_PRODUCTS["win32-x64"] === "backend" && PACKAGE_IDENTITY_PRODUCTS["linux-x64-oci"] === "backend-docker" && RELEASE_PACKAGE_EXTENSIONS["win32-x64"] === ".zip" && RELEASE_PACKAGE_EXTENSIONS["linux-x64-oci"] === ".tar");
  check("§1s5e SURUM_PLATFORM ortak katalogda", (PROTOCOL_ERROR_CODES as readonly string[]).includes("SURUM_PLATFORM"));
  for (const ad of ["s5 Linux bildirimi Linux okuyucuda", "s5 Linux bildirimi güncelleyici bloğu yok", "s5 imajda tanınmayan alan atılır"]) beklenenKod("bildirim", ad, "OK");
  for (const ad of ["s5 Linux bildirimi platformsuz okuyucuda (Windows)", "s5 Linux bildirimi açıkça Windows okuyucuda", "s5 Windows bildirimi Linux okuyucuda"]) beklenenKod("bildirim", ad, "SURUM_PLATFORM");
  beklenenKod("bildirim", "s5 kanal platformdan önce denetlenir", "SURUM_KANAL");
  for (const ad of [
    "s5 Linux bildirimi imajsız",
    "s5 Windows bildirimi imajlı",
    "s5 Linux paketi zip",
    "s5 Windows paketi tar",
    "s5 Linux bildiriminde PG hedefi",
    "s5 imaj kimliği öneksiz",
    "s5 imaj etiketi etiketsiz ad",
    "s5 güncelleyici özeti büyük harf",
    "s5 güncelleyici sürümünde +yapı eki",
    "s5 imaj null",
  ])
    beklenenKod("bildirim", ad, "BELGE_SEMA");
  beklenenKod("pg-kunye", "s5 PG künyesi Linux platformunda", "BELGE_SEMA");
  const blok = kayit("bildirim", "s5 Windows bildirimi güncelleyici bloğuyla").beklenen as { ok: boolean; value?: Record<string, unknown> };
  check("§1s5f Windows bildirimi güncelleyici bloğunu TAŞIR (yeni okuyucu korur)", blok.ok === true && jsonEsit(blok.value?.guncelleyici, { surum: "0.2.0", sha256: "6".repeat(64) }));
  const imaj = kayit("bildirim", "s5 imajda tanınmayan alan atılır").beklenen as { ok: boolean; value?: { imaj?: Record<string, unknown> } };
  check("§1s5g imaj bloğunda tanınmayan alan ATILIR", imaj.ok === true && !!imaj.value?.imaj && !("platform" in imaj.value.imaj));
  beklenenKod("paket-bagi", "s5 Linux paketi Docker künyesiyle bağlı", "OK");
  for (const ad of ["s5 Linux bildirimi Windows künyesiyle", "s5 Windows bildirimi Docker künyesiyle"]) beklenenKod("paket-bagi", ad, "PAKET_BAGI");
  const k = kayit("karar", "s5 Linux adayı aynı tablodan (pencere içi → kur)").beklenen as { karar?: string };
  const w = kayit("karar", "otomatik, pencere içi → kur").beklenen as { karar?: string };
  check("§1s5h karar tablosu platformdan bağımsız (Linux adayı = Windows adayı kararı)", k.karar === "KUR" && k.karar === w.karar);
}

function bolum2(): void {
  console.log("\n§2 — sürüm işaretçisi (son.json · <sürüm>/surum.json)");
  beklenenKod("isaretci", "geçerli işaretçi", "OK");
  beklenenKod("isaretci", "JSON değil", "SURUM_ISARETCI");
  beklenenKod("isaretci", "fazla alan", "SURUM_ISARETCI");
  beklenenKod("isaretci", "v:2", "BELGE_SURUM");
  beklenenKod("isaretci", "bildirim boş", "SURUM_ISARETCI");
}

function bolum3(): void {
  console.log("\n§3 — kira politikası (kira.guncelleme)");
  const v = defaultUpdatePolicy();
  check("§3a alan yokken politika = ONAYLI, pencere yok, sabitleme yok (bugünkü davranış)", v.kip === "ONAYLI" && v.pencere === null && v.araliklar.length === 0 && v.hedefSurum === null);
  check("§3a' varsayılan her çağrıda TAZE nesne (paylaşılan değişken durum yok)", defaultUpdatePolicy() !== defaultUpdatePolicy());
  for (const ad of ["otomatik + pencere + aralıklar", "onaylı, pencere yok", "dondur + sabitleme", "bitişik aralıklar (00:00–24:00 her gün)", "gece yarısını aşan pencere"]) beklenenKod("politika", ad, "OK");
  for (const ad of ["otomatik ama pencere yok", "pencere yokken aralık", "aralıklar sırasız", "aralıklar çakışıyor", "aralık 25 saatten uzun", "gün listesi sırasız", "gün 0", "başlangıç = bitiş", "başlangıç 24:00", "sabitlemede +yapı eki", "saat dilimi biçimsiz", "bilinmeyen kip"]) beklenenKod("politika", ad, "BELGE_SEMA");
  const ek = kayit("politika", "tanınmayan alan atılır").beklenen as { ok: boolean; value?: Record<string, unknown> };
  check("§3b tanınmayan alan atılır (ileri uyum)", ek.ok === true && !!ek.value && !("yeniAlan" in ek.value));
  const yok = kayit("kira-yuku", "alan yok (eski satıcı)").beklenen as { ok: boolean; guncelleme?: unknown };
  check("§3c eski satıcının kirası (alan yok) geçerli, guncelleme null", yok.ok === true && yok.guncelleme === null);
  const var_ = kayit("kira-yuku", "alan var").beklenen as { ok: boolean; guncelleme?: unknown };
  check("§3d yeni kira alanı taşır", var_.ok === true && var_.guncelleme !== null);
  beklenenKod("kira-yuku", "aralık kiranın ömrü dışında", "BELGE_SEMA");
  beklenenKod("kira-yuku", "politika bozuk → kira bozuk", "BELGE_SEMA");
  // Eski doğrulayıcı alanı ATAR: v:1 kira şemasının kendisi z.object (eski backend yeni alanı bilmez → yok sayar).
  const eskiSema = LeaseSchema.safeParse({ ...(kayit("kira-yuku", "alan var").vektor as { girdi: Record<string, unknown> }).girdi, gelecekAlani: 1 });
  check("§3e kira şeması tanınmayan kök alanı atar (eski backend ↔ yeni satıcı)", eskiSema.success && !("gelecekAlani" in eskiSema.data));
  const etkin = kayit("etkin-politika", "alan yok → varsayılan ONAYLI").beklenen as { kaynak?: string; politika?: { kip?: string } } | null;
  check("§3f etkin politika: alan yok → VARSAYILAN/ONAYLI", etkin?.kaynak === "VARSAYILAN" && etkin?.politika?.kip === "ONAYLI");
  check("§3g etkin politika: kira yok → null (yetki yok)", kayit("etkin-politika", "kira yok").beklenen === null);
  check("§3h etkin politika: süresi tolerans DIŞINDA geçmiş kira → null", kayit("etkin-politika", "kiranın süresi geçti (tolerans dışı)").beklenen === null);
  check("§3h' etkin politika: tolerans içinde → kiradan", (kayit("etkin-politika", "kiranın süresi tolerans içinde").beklenen as { kaynak?: string } | null)?.kaynak === "KIRA");
  console.log("\n§3' — indirme belirteci öneki");
  const d = (yolOneki: string) => DownloadSchema.safeParse({ v: 1, kanal: "k1", yolOneki, kurulumId: "2f5d8b4c-1e3a-4b9c-8d2e-7f8a9b0c1d2e", exp: "2026-10-01T00:00:00Z" }).success;
  check("§3i önek kümesi electron · mobil · backend · backend-oci", jsonEsit([...DOWNLOAD_PRODUCTS], ["electron", "mobil", "backend", "backend-oci"]));
  check("§3j /k1/backend/ · /k1/backend-oci/ geçer", d("/k1/backend/") && d("/k1/backend-oci/"));
  check("§3k /k1/diger/ · başka kanalın backend'i · öneksiz · /k1/backend-ocix/ RED", !d("/k1/diger/") && !d("/k2/backend/") && !d("/k1/backend") && !d("/k1/backend-ocix/"));
  // L2b: kurulum yalnız KENDİ platformunun backend dizinini alır; Windows kümesi sözleşme 5 öncesiyle aynı.
  check("§3l Windows kurulumunun kümesi DEĞİŞMEDİ (electron · mobil · backend)", jsonEsit([...DOWNLOAD_PRODUCTS_BY_PLATFORM["win32-x64"]], ["electron", "mobil", "backend"]));
  check("§3m Linux/OCI kurulumunun kümesi electron · mobil · backend-oci", jsonEsit([...DOWNLOAD_PRODUCTS_BY_PLATFORM["linux-x64-oci"]], ["electron", "mobil", "backend-oci"]));
  check("§3n platform kümelerinin backend dizini = RELEASE_PRODUCT_DIRS; birleşimleri = DOWNLOAD_PRODUCTS",
    UPDATE_PLATFORMS.every((p) => (DOWNLOAD_PRODUCTS_BY_PLATFORM[p] as readonly string[]).includes(RELEASE_PRODUCT_DIRS[p]) && backendDownloadPrefix("k1", p) === `/k1/${RELEASE_PRODUCT_DIRS[p]}/`) &&
      jsonEsit([...new Set(UPDATE_PLATFORMS.flatMap((p) => [...DOWNLOAD_PRODUCTS_BY_PLATFORM[p]]))].sort(), [...DOWNLOAD_PRODUCTS].sort()));
  const ortam = (o: unknown) => downloadPlatformOf(o);
  check("§3o ortam → platform: yalnız linux + konteyner:true OCI; win32 · linux konteynersiz · darwin · ortamsız · biçimsiz → Windows",
    ortam({ platform: "linux", konteyner: true }) === "linux-x64-oci" &&
      ortam({ platform: "win32", konteyner: false }) === "win32-x64" && ortam({ platform: "win32", konteyner: true }) === "win32-x64" &&
      ortam({ platform: "linux", konteyner: false }) === "win32-x64" && ortam({ platform: "linux", konteyner: "true" }) === "win32-x64" &&
      ortam({ platform: "darwin", konteyner: true }) === "win32-x64" && ortam(null) === "win32-x64" && ortam(undefined) === "win32-x64" && ortam("linux") === "win32-x64");
}

function bolum4(): void {
  console.log("\n§4 — pencere aritmetiği (satıcı basar; güncelleyici yalnız mutlak aralığı okur)");
  const her = { baslangic: "02:00", bitis: "05:00", gunler: [1, 2, 3, 4, 5, 6, 7], saatDilimi: IST };
  const a = windowIntervals(her, T0, T0 + 3 * GUN);
  check("§4a İstanbul 02:00–05:00 = 23:00Z–02:00Z, fromMs'i içeren pencere dahil", a[0]?.baslangic === "2026-09-30T23:00:00.000Z" && a[0]?.bitis === "2026-10-01T02:00:00.000Z" && a.length === 4, JSON.stringify(a.slice(0, 2)));
  const cmt = windowIntervals({ baslangic: "23:00", bitis: "04:00", gunler: [6], saatDilimi: IST }, T0, T0 + 10 * GUN);
  check("§4b cumartesi 23:00 → pazar 04:00 (gün BAŞLANGICA göre, gece yarısı aşılır)", cmt.length === 2 && cmt[0].baslangic === "2026-10-03T20:00:00.000Z" && cmt[0].bitis === "2026-10-04T01:00:00.000Z", JSON.stringify(cmt));
  const tum = windowIntervals({ baslangic: "00:00", bitis: "24:00", gunler: [4], saatDilimi: IST }, T0, T0 + 2 * GUN);
  check("§4c 00:00–24:00 = tam gün (24:00 gün sonu)", tum.length === 1 && tum[0].baslangic === "2026-09-30T21:00:00.000Z" && tum[0].bitis === "2026-10-01T21:00:00.000Z", JSON.stringify(tum));
  const bosluk = windowIntervals({ baslangic: "02:30", bitis: "04:00", gunler: [7], saatDilimi: "Europe/Berlin" }, Date.parse("2026-03-27T00:00:00Z"), Date.parse("2026-03-30T00:00:00Z"));
  check("§4d yaz saati BOŞLUĞU: yaşanmayan 02:30 → boşluktan sonraki an (03:30 CEST)", bosluk.length === 1 && bosluk[0].baslangic === "2026-03-29T01:30:00.000Z", JSON.stringify(bosluk));
  const cift = windowIntervals({ baslangic: "02:30", bitis: "24:00", gunler: [7], saatDilimi: "Europe/Berlin" }, Date.parse("2026-10-23T00:00:00Z"), Date.parse("2026-10-27T00:00:00Z"));
  check("§4e yaz saati ÇİFTİ: iki kez yaşanan 02:30 → İLK an (CEST)", cift.length === 1 && cift[0].baslangic === "2026-10-25T00:30:00.000Z", JSON.stringify(cift));
  let atti = false;
  try {
    windowIntervals({ ...her, saatDilimi: "Mars/Olympus" }, T0, T0 + GUN);
  } catch {
    atti = true;
  }
  check("§4f bilinmeyen dilim FIRLATIR (sessiz UTC yok)", atti && !isKnownTimeZone("Mars/Olympus") && isKnownTimeZone(IST));
  const kira45 = windowIntervals(her, T0, T0 + 45 * GUN);
  check("§4g 45 günlük kiranın aralıkları politika şemasından geçer", LeaseUpdatePolicySchema.safeParse({ kip: "OTOMATIK", pencere: her, araliklar: kira45, hedefSurum: null }).success, `${kira45.length} aralık`);
  check("§4h aralık sayısı tavanı", windowIntervals(her, T0, T0 + 400 * GUN).length === UPDATE_INTERVAL_MAX);
  check("§4i her aralık tek başına şemadan geçer", kira45.every((x) => UpdateIntervalSchema.safeParse(x).success));
}

function kararOf(ad: string): { karar: string; neden: string | null; aralik: { baslangic: string } | null; pgGuncellemesi: boolean } {
  return kayit("karar", ad).beklenen as { karar: string; neden: string | null; aralik: { baslangic: string } | null; pgGuncellemesi: boolean };
}

function bolum5(): void {
  console.log("\n§5 — güncelleme kararı (tek karar noktası)");
  const tablo: [string, string, string | null][] = [
    ["kira yok", "DONDURULDU", "KIRA_YOK"],
    ["K1 politikayı ve HEMEN onayını ezer", "DONDURULDU", "YAPTIRIM"],
    ["DONDUR onayı da kapatır", "DONDURULDU", "POLITIKA"],
    ["kurulu sürüm biçimsiz", "UYGUN_DEGIL", "KURULU_SURUM_BICIMSIZ"],
    ["sabitlenen sürüme ulaşıldı", "GUNCEL", "HEDEF_ULASILDI"],
    ["sabitleme geri inmez", "GUNCEL", "HEDEF_ULASILDI"],
    ["aday yok", "GUNCEL", "ADAY_YOK"],
    ["aday kurulu sürümle aynı", "GUNCEL", "SURUM_GUNCEL"],
    ["aday eski (geri inilmez)", "GUNCEL", "SURUM_GUNCEL"],
    ["sabitleme var, aday başka sürüm", "UYGUN_DEGIL", "HEDEF_DISI"],
    ["sabitlenen sürümün adayı, pencere içi", "KUR", "PENCERE"],
    ["kaynak sürüm doğrudan geçiş için eski", "UYGUN_DEGIL", "KAYNAK_SURUM_ESKI"],
    ["ön sürüm kaynağı sınırın altında", "UYGUN_DEGIL", "KAYNAK_SURUM_ESKI"],
    ["HAK yok", "UYGUN_DEGIL", "HAK_YOK"],
    ["derleme bakım sonundan sonra", "UYGUN_DEGIL", "BAKIM_DISI"],
    ["PostgreSQL ölçülemedi", "UYGUN_DEGIL", "PG_OLCULEMEDI"],
    ["kendi kipte PG derlemesi bilinmiyor", "UYGUN_DEGIL", "PG_OLCULEMEDI"],
    ["PostgreSQL ana sürüm farklı (kendi)", "UYGUN_DEGIL", "PG_ANA_SURUM"],
    ["PostgreSQL ana sürüm farklı (harici 17)", "UYGUN_DEGIL", "PG_ANA_SURUM"],
    ["harici PG enAz altında", "UYGUN_DEGIL", "PG_SURUMU_ESKI"],
    ["harici PG enAz üstünde, hedefe dokunulmaz", "KUR", "PENCERE"],
    ["kendi PG hedeften eski → PG birlikte", "KUR", "PENCERE"],
    ["kendi PG aynı sürüm eski derleme → PG birlikte", "KUR", "PENCERE"],
    ["kendi PG hedeften yeni → geri inmez", "KUR", "PENCERE"],
    ["hedefsiz bildirim, kendi PG enAz altında", "UYGUN_DEGIL", "PG_SURUMU_ESKI"],
    ["otomatik, pencere dışı → sıradaki pencere", "PENCERE_BEKLIYOR", null],
    ["otomatik, pencere içi → kur", "KUR", "PENCERE"],
    ["otomatik, HEMEN onayı hızlandırır", "KUR", "ONAY_HEMEN"],
    ["otomatik, son aralıktan sonra pencere yok", "PENCERE_BEKLIYOR", "PENCERE_YOK"],
    ["onaylı, onay yok", "ONAY_BEKLIYOR", null],
    ["onaylı, başka sürümün onayı sayılmaz", "ONAY_BEKLIYOR", null],
    ["onaylı, HEMEN", "KUR", "ONAY_HEMEN"],
    ["onaylı, PENCERE onayı pencere dışı", "PENCERE_BEKLIYOR", null],
    ["onaylı, PENCERE onayı pencere içi", "KUR", "PENCERE"],
    ["onaylı pencere yok, PENCERE onayı bekler", "PENCERE_BEKLIYOR", "PENCERE_YOK"],
    ["pencere bitiş anı dışarıda (yarı açık aralık)", "PENCERE_BEKLIYOR", null],
    ["pencere başlangıç anı içeride", "KUR", "PENCERE"],
  ];
  for (const [ad, karar, neden] of tablo) {
    const k = kararOf(ad);
    check(`§5 ${ad} → ${karar}${neden ? `/${neden}` : ""}`, k.karar === karar && k.neden === neden, `${k.karar}/${k.neden}`);
  }
  check("§5' PG küçük sürüm güncellemesi YALNIZ kendi örnekte ve hedef yeniyse işaretlenir",
    kararOf("kendi PG hedeften eski → PG birlikte").pgGuncellemesi && kararOf("kendi PG aynı sürüm eski derleme → PG birlikte").pgGuncellemesi &&
      !kararOf("kendi PG hedeften yeni → geri inmez").pgGuncellemesi && !kararOf("harici PG enAz üstünde, hedefe dokunulmaz").pgGuncellemesi &&
      !kararOf("otomatik, pencere içi → kur").pgGuncellemesi);
  check("§5'' pencere dışı bekleyiş SIRADAKİ aralığı verir", kararOf("otomatik, pencere dışı → sıradaki pencere").aralik?.baslangic === "2026-10-02T23:00:00.000Z");
  check("§5''' HEMEN onayı aralık taşımaz", kararOf("onaylı, HEMEN").aralik === null);
}

function bolum6ila8(): void {
  console.log("\n§6 — sürüm karşılaştırma");
  const t: [string, unknown][] = [
    ["yama büyük", 1], ["sayısal (sözlük değil)", -1], ["eşit", 0], ["ön sürüm < sürüm", -1], ["ön sürüm sayısal kimlik", -1],
    ["sayısal < alfasayısal", -1], ["kısa ön sürüm < uzun", -1], ["+yapı önceliğe girmez", 0], ["biçimsiz", null], ["boş ön sürüm kimliği biçimsiz", null],
  ];
  for (const [ad, b] of t) check(`§6 ${ad} → ${String(b)}`, kayit("surum-karsilastir", ad).beklenen === b, String(kayit("surum-karsilastir", ad).beklenen));
  console.log("\n§7 — paket bağı (açılan paket bildirimin paketi mi)");
  beklenenKod("paket-bagi", "bağlı", "OK");
  beklenenKod("paket-bagi", "kanal-dışı paket (müşteri null) bağlı", "OK");
  beklenenKod("paket-bagi", "derleme tarihi aynı an, farklı yazım", "OK");
  for (const ad of ["başka kanalın paketi", "paketId farklı", "sürüm farklı", "imzalayan farklı"]) beklenenKod("paket-bagi", ad, "PAKET_BAGI");
  console.log("\n§7' — PG bağı (künye ↔ bildirimin PG hedefi)");
  beklenenKod("pg-bagi", "PG künyesi hedefle bağlı", "OK");
  for (const ad of ["bildirim PG hedefi taşımıyor", "PG paket özeti farklı", "PG künyesi başka ana sürüm (17)", "PG ICU sürümü farklı", "PG derlemesi farklı"]) beklenenKod("pg-bagi", ad, "PG_BAGI");
  console.log("\n§8 — yoklama raporu (KATI allowlist)");
  beklenenKod("rapor", "tam rapor", "OK");
  beklenenKod("rapor", "güncelleyici yok, sonuç yok", "OK");
  beklenenKod("rapor", "belgesiz ama desene uyan kod geçer (ileri uyum)", "OK");
  for (const ad of ["tanınmayan alan (KATI)", "başarılı sonuç kod taşıyamaz", "başarısız sonuç kod taşımalı", "kod deseni (serbest metin yok)", "bitiş başlangıçtan önce"]) beklenenKod("rapor", ad, "RED");
}

interface Dosya {
  readonly bicim: number;
  readonly kayitlar: GuncellemeVektorKaydi[];
}

function dosyaOku(ad: string): Dosya | null {
  const p = path.join(DIZIN, ad);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Dosya;
}

/** Bayat kayıtlar: beklenen ≠ bugünkü TS sonucu. */
export function bayatlar(kayitlar: readonly GuncellemeVektorKaydi[]): string[] {
  return kayitlar.filter((k) => !jsonEsit(k.beklenen, guncellemeDegerlendir(k.vektor))).map((k) => `${k.vektor.tur}:${k.vektor.ad}`);
}

/** Karar vektörlerinde hiç geçmeyen neden/karar değerleri. */
export function kapsamEksigi(kayitlar: readonly GuncellemeVektorKaydi[]): string[] {
  const gorulen = new Set<string>();
  for (const k of kayitlar) {
    if (k.vektor.tur !== "karar") continue;
    const b = k.beklenen as { karar?: string; neden?: string | null };
    if (b.karar) gorulen.add(b.karar);
    if (b.neden) gorulen.add(b.neden);
  }
  return [...UPDATE_DECISIONS, ...UPDATE_DECISION_REASONS].filter((x) => !gorulen.has(x));
}

function bolum9(): void {
  console.log("\n§9 — vektör dosyaları (native/test-vektorleri/guncelleme-*.json)");
  const hepsi: GuncellemeVektorKaydi[] = [];
  for (const ad of GUNCELLEME_VEKTOR_DOSYALARI) {
    const d = dosyaOku(ad);
    check(`§9a ${ad} var ve biçim ${GUNCELLEME_VEKTOR_BICIMI}`, d !== null && d.bicim === GUNCELLEME_VEKTOR_BICIMI && Array.isArray(d.kayitlar) && d.kayitlar.length > 0, d ? `${d.kayitlar.length} kayıt` : "yok — --vektor-yaz");
    if (!d) continue;
    const bayat = bayatlar(d.kayitlar);
    check(`§9b ⭐ ${ad} bayat değil (beklenen = bugünkü TS)`, bayat.length === 0, bayat.slice(0, 5).join(" · ") || "temiz");
    hepsi.push(...d.kayitlar);
  }
  const eksik = kapsamEksigi(hepsi);
  check("§9c kapsam: her karar ve neden en az bir karar vektöründe", eksik.length === 0, eksik.join(", ") || `${UPDATE_DECISIONS.length + UPDATE_DECISION_REASONS.length} değer`);
  const kodlar = new Set(hepsi.filter((k) => ["bildirim", "isaretci", "paket-bagi", "pg-kunye", "pg-bagi"].includes(k.vektor.tur)).map((k) => kodu(k.beklenen)));
  const gereken = ["OK", "JWS_IMZA", "JWS_KID", "JWS_TYP", "BELGE_SEMA", "BELGE_SURUM", "SURUM_ISARETCI", "SURUM_KANAL", "SURUM_ANAHTAR", "SURUM_PLATFORM", "PAKET_BAGI", "PG_BAGI"];
  check("§9d kapsam: bildirim/işaretçi/bağ kodlarının her biri en az bir vektörde", gereken.every((c) => kodlar.has(c)), gereken.filter((c) => !kodlar.has(c)).join(",") || `${gereken.length} kod`);
  check("§9e kayıt adları dosyalar arası tekil (Rust testi adla raporlar)", new Set(hepsi.map((k) => `${k.vektor.tur}:${k.vektor.ad}`)).size === hepsi.length);
}

function bolum10(): void {
  console.log("\n§10 — ✓K kalıcı sondalar (karşılaştırıcılar sentetik girdide)");
  const saglam = TAZE["guncelleme-karar.json"].slice(0, 3);
  check("§10a bayatlık denetimi özdeş kayıtta SUSAR", bayatlar(saglam).length === 0);
  const bozuk = saglam.map((k, i) => (i === 1 ? { ...k, beklenen: { ...(k.beklenen as object), karar: "KUR" } } : k));
  check("§10b bayatlık denetimi mutasyonlu beklenende ISIRIR", bayatlar(bozuk).length === 1);
  const tamKapsam = kapsamEksigi(TAZE["guncelleme-karar.json"]);
  const eksik = kapsamEksigi(TAZE["guncelleme-karar.json"].filter((k) => k.vektor.tur !== "karar" || (k.beklenen as { neden?: string }).neden !== "BAKIM_DISI"));
  check("§10c kapsam denetimi eksik nedeni YAKALAR (tam kümede susar)", tamKapsam.length === 0 && eksik.includes("BAKIM_DISI"), eksik.join(","));
}

function vektorYaz(): void {
  mkdirSync(DIZIN, { recursive: true });
  for (const ad of GUNCELLEME_VEKTOR_DOSYALARI) {
    writeFileSync(path.join(DIZIN, ad), guncellemeVektorMetni(TAZE[ad]));
    console.log(`✓ ${path.relative(TEKS, path.join(DIZIN, ad))} — ${TAZE[ad].length} kayıt`);
  }
}

function main(): void {
  if (process.argv.includes("--vektor-yaz")) {
    vektorYaz();
    return;
  }
  // Politika şemasıyla kira şemasının aynı `v`yi taşıdığı: decodeDocument BELGE_SURUM ayrımını yapar.
  check("§0 decodeDocument politika alt belgesinde v'siz çalışır", decodeDocument(LeaseUpdatePolicySchema, defaultUpdatePolicy()).ok);
  bolum1();
  bolum1s5();
  bolum2();
  bolum3();
  bolum4();
  bolum5();
  bolum6ila8();
  bolum9();
  bolum10();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
