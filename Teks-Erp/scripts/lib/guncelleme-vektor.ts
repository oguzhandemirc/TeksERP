// Güncelleme sözleşmesi TEST VEKTÖRLERİ — TS protokolü (tek kaynak, `protocol/guncelleme.ts` + `guncelleme-karar.ts`)
// ile Rust güncelleyicinin (Dağıtım v2, D2) ORTAK girdisi. `test_` öneki yok → koşucu bunu bekçi saymaz.
// Dosyalar `Teks-Erp/native/test-vektorleri/guncelleme-*.json`; elle düzenlenmez, yalnız
// `npx tsx scripts/test_guncelleme_protokol.ts --vektor-yaz` üretir. Bekçi her kaydın beklenenini BUGÜNKÜ
// TS'le yeniden hesaplar (bayat vektör kırmızı). Anahtarlar çalışma anında üretilir; dosyaya YALNIZ açık
// yarılar ve imzalı belgeler girer.
import path from "node:path";
import {
  LeaseSchema,
  LeaseUpdatePolicySchema,
  UpdateReportSchema,
  checkPackageBinding,
  checkPgBinding,
  compareVersions,
  decideUpdate,
  decodeDocument,
  effectiveUpdatePolicy,
  readReleasePointer,
  releaseFilePath,
  releasePointerPath,
  releasePointerText,
  signJws,
  signPgPackageManifest,
  signReleaseManifest,
  verifyPgPackageManifest,
  verifyReleaseManifest,
  windowIntervals,
  type PackageIdentity,
  type PackagePublicKey,
  type PgPackageManifest,
  type PgRequirement,
  type ReleaseManifest,
  type UpdateDecisionInput,
  type UpdatePlatform,
} from "../../src/lib/license/protocol";
import { anahtarUret, type TestAnahtari } from "./lisans-fikstur";
import { DEFAULT_FACTORY_TIMEZONE } from "../../src/constants/time";

export const GUNCELLEME_VEKTOR_BICIMI = 1;
export const GUNCELLEME_VEKTOR_DOSYALARI = ["guncelleme-surum.json", "guncelleme-kira.json", "guncelleme-karar.json", "guncelleme-rapor.json"] as const;
export type GuncellemeVektorDosyasi = (typeof GUNCELLEME_VEKTOR_DOSYALARI)[number];

export function guncellemeVektorDizini(teksKok: string): string {
  return path.join(teksKok, "native", "test-vektorleri");
}

export type GuncellemeVektoru =
  // `platform` okuyanın hedefi (sözleşme 5); yoksa Windows — eski kayıtlar ve eski okuyucu aynen.
  | { readonly tur: "bildirim"; readonly ad: string; readonly token: unknown; readonly keys: PackagePublicKey[]; readonly kanal: string; readonly platform?: UpdatePlatform }
  | { readonly tur: "isaretci"; readonly ad: string; readonly metin: string }
  | { readonly tur: "pg-kunye"; readonly ad: string; readonly token: unknown; readonly keys: PackagePublicKey[] }
  | { readonly tur: "pg-bagi"; readonly ad: string; readonly gereksinim: PgRequirement; readonly kunye: PgPackageManifest }
  | { readonly tur: "politika"; readonly ad: string; readonly girdi: unknown }
  | { readonly tur: "kira-yuku"; readonly ad: string; readonly girdi: unknown }
  | { readonly tur: "etkin-politika"; readonly ad: string; readonly kira: unknown; readonly nowMs: number }
  | { readonly tur: "karar"; readonly ad: string; readonly girdi: UpdateDecisionInput }
  | { readonly tur: "surum-karsilastir"; readonly ad: string; readonly a: string; readonly b: string }
  | { readonly tur: "paket-bagi"; readonly ad: string; readonly bildirim: ReleaseManifest; readonly paket: PackageIdentity }
  | { readonly tur: "rapor"; readonly ad: string; readonly girdi: unknown }
  // Sözleşme 5: yayın yolu platformun ürün dizininden (`platform` yoksa Windows yolu).
  | { readonly tur: "yol"; readonly ad: string; readonly kanal: string; readonly surum: string; readonly dosya: string; readonly platform?: UpdatePlatform };

export interface GuncellemeVektorKaydi {
  readonly vektor: GuncellemeVektoru;
  readonly beklenen: unknown;
}

/** Sonuç tipini tele indirir: hata metni Rust'ta farklıdır, yalnız kod karşılaştırılır. */
function sonuc(r: { ok: true; value: unknown } | { ok: false; code: string }): unknown {
  return r.ok ? { ok: true, value: jsonKopya(r.value) } : { ok: false, code: r.code };
}

function jsonKopya(x: unknown): unknown {
  return x === undefined ? null : JSON.parse(JSON.stringify(x));
}

/** Bir vektörün BUGÜNKÜ TS sonucu — üretim de bayatlık denetimi de bunu çağırır. */
export function guncellemeDegerlendir(v: GuncellemeVektoru): unknown {
  switch (v.tur) {
    case "bildirim":
      return sonuc(verifyReleaseManifest(v.token, { keys: v.keys, kanal: v.kanal, ...(v.platform ? { platform: v.platform } : {}) }));
    case "isaretci":
      return sonuc(readReleasePointer(v.metin));
    case "pg-kunye":
      return sonuc(verifyPgPackageManifest(v.token, { keys: v.keys }));
    case "pg-bagi":
      return sonuc(checkPgBinding(v.gereksinim, v.kunye));
    case "politika":
      return sonuc(decodeDocument(LeaseUpdatePolicySchema, v.girdi));
    case "kira-yuku": {
      const r = decodeDocument(LeaseSchema, v.girdi);
      return r.ok ? { ok: true, guncelleme: jsonKopya(r.value.guncelleme) } : { ok: false, code: r.code };
    }
    case "etkin-politika": {
      const kira = v.kira === null ? null : decodeDocument(LeaseSchema, v.kira);
      if (kira !== null && !kira.ok) return { gecersizKira: kira.code };
      return jsonKopya(effectiveUpdatePolicy(kira === null ? null : kira.value, v.nowMs));
    }
    case "karar":
      return jsonKopya(decideUpdate(v.girdi));
    case "surum-karsilastir":
      return compareVersions(v.a, v.b);
    case "paket-bagi":
      return sonuc(checkPackageBinding(v.bildirim, v.paket));
    case "yol":
      return { isaretci: releasePointerPath(v.kanal, v.platform), dosya: releaseFilePath(v.kanal, v.surum, v.dosya, v.platform) };
    case "rapor": {
      const r = UpdateReportSchema.safeParse(v.girdi);
      return r.success ? { ok: true, value: jsonKopya(r.data) } : { ok: false };
    }
  }
}

// ── Sabit fikstür (belirlenimli alanlar; imzalar çalışma anında) ─────────────
const T0 = Date.parse("2026-10-01T00:00:00.000Z");
const ISO = (ms: number) => new Date(ms).toISOString();
const SAAT = 60 * 60 * 1000;
const GUN = 24 * SAAT;

const PG_HEDEF = {
  surum: "16.15",
  derleme: 4,
  paket: { ad: "postgresql-16.15-4-win-x64.zip", boyut: 97_000_000, sha256: "2".repeat(64) },
  icerikSha256: "3".repeat(64),
  icuSurum: "67",
};
const PG_GEREKSINIM: PgRequirement = { cizgi: 16, enAz: "16.9", hedef: PG_HEDEF };

function pgKunyeYuku(ek: Partial<PgPackageManifest> = {}): PgPackageManifest {
  return { v: 1, urun: "postgresql", platform: "win32-x64", cizgi: 16, ...PG_HEDEF, yayinZamani: "2026-09-30T21:00:00.000Z", ...ek };
}

function bildirimYuku(ek: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    v: 1,
    urun: "backend",
    platform: "win32-x64",
    kanal: "testfabrika",
    surum: "2.11.0",
    commit: "91c79ebd",
    derlemeTarihi: "2026-09-30T18:00:00.000Z",
    yayinZamani: "2026-09-30T20:00:00.000Z",
    paket: { ad: "tekserp-backend-2.11.0.zip", boyut: 187_654_321, sha256: "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821", paketId: "6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b" },
    paketImzaKid: "paket-2027",
    minKaynakSurum: "2.9.0",
    gocSayisi: 251,
    pg: PG_GEREKSINIM,
    runtime: { node: "24.18.0" },
    notlar: { ozet: "Sevkiyat ekranı hızlandı; yedek şifreleme varsayılan." },
    zorunlu: false,
    ...ek,
  };
}

// Sözleşme 5: Linux/OCI bildirimi — ayrı ürün yolu, tar paket, imaj zorunlu, PG hedefi yok.
const IMAJ = { kimlik: `sha256:${"5".repeat(64)}`, etiket: "tekserp-korumali:2.11.0" };
const GUNCELLEYICI = { surum: "0.2.0", sha256: "6".repeat(64) };

function linuxYuku(ek: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return bildirimYuku({
    platform: "linux-x64-oci",
    paket: { ad: "tekserp-backend-oci-2.11.0.tar", boyut: 412_345_678, sha256: "7".repeat(64), paketId: "8b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e" },
    pg: { cizgi: 16, enAz: "16.9", hedef: null },
    imaj: IMAJ,
    guncelleyici: GUNCELLEYICI,
    ...ek,
  });
}

const KURAL = { baslangic: "02:00", bitis: "05:00", gunler: [1, 2, 3, 4, 5, 6, 7], saatDilimi: DEFAULT_FACTORY_TIMEZONE };

function politika(ek: Record<string, unknown> = {}): Record<string, unknown> {
  return { kip: "OTOMATIK", pencere: KURAL, araliklar: windowIntervals(KURAL, T0, T0 + 30 * GUN), hedefSurum: null, ...ek };
}

function kiraYukuSabit(ek: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    kiraId: "0d3b6f2a-9c1e-4f7a-8b2d-5e6f7a8b9c0d",
    hakId: "1e4c7a3b-0d2f-4a8b-9c1d-6e7f8a9b0c1d",
    hakSurum: 3,
    kurulumId: "2f5d8b4c-1e3a-4b9c-8d2e-7f8a9b0c1d2e",
    kurulumAnahtarKimligi: `kur-${"A".repeat(43)}`,
    parmakIzi: { f1: "B".repeat(43), f2: null, f3: null, f4: "C".repeat(43), f5: null },
    verilis: ISO(T0),
    bitis: ISO(T0 + 30 * GUN),
    sunucuSaati: ISO(T0),
    ekSureGun: 30,
    zorlama: false,
    gecerlilikBitis: null,
    yaptirim: { kademe: null, mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false },
    yoklamaAraligiDk: 60,
    esitlemeAraligiDk: null,
    patronBulutBitis: null,
    devredildi: false,
    kanal: { kod: "testfabrika", guncelSurumler: { backend: "2.11.0" } },
    altSertifika: "eyJ.sertifika.yer-tutucu",
    ...ek,
  };
}

function kararGirdisi(ek: Partial<UpdateDecisionInput> = {}): UpdateDecisionInput {
  const p = LeaseUpdatePolicySchema.parse(politika());
  return {
    politika: p,
    guncellemeDonuk: false,
    bakimBitisMs: Date.parse("2027-06-30T00:00:00.000Z"),
    kuruluSurum: "2.10.4",
    pg: { kip: "KENDI", surum: "16.15", derleme: 4 },
    aday: bildirimYuku(),
    onay: null,
    // 2026-10-02 12:00 İstanbul — pencere dışı; sıradaki pencere 2026-10-03 02:00 İstanbul.
    nowMs: Date.parse("2026-10-02T09:00:00.000Z"),
    ...ek,
  };
}

const ICINDE = Date.parse("2026-10-02T23:30:00.000Z"); // 2026-10-03 02:30 İstanbul — pencere içi

function onayli(ek: Record<string, unknown> = {}) {
  return LeaseUpdatePolicySchema.parse(politika({ kip: "ONAYLI", ...ek }));
}

function vektorler(anahtar: TestAnahtari, yabanci: TestAnahtari, uretim: TestAnahtari): GuncellemeVektoru[] {
  const keys: PackagePublicKey[] = [{ kid: anahtar.kid, x: anahtar.x }, { kid: uretim.kid, x: uretim.x }];
  const imzala = (y: ReleaseManifest, k: TestAnahtari = anahtar) => signReleaseManifest({ payload: { ...y, paketImzaKid: k.kid }, key: { kid: k.kid, privateKey: k.privateKey } });
  const gecerli = imzala(bildirimYuku());
  const [bas, , imza] = gecerli.split(".");
  const kurcali = `${bas}.${Buffer.from(JSON.stringify({ ...bildirimYuku(), surum: "9.9.9" })).toString("base64url")}.${imza}`;
  const hamYuk = (y: Record<string, unknown>, typ = "tekserp-surum", kid = anahtar.kid) => signJws({ typ, kid, payload: y, privateKey: anahtar.privateKey });
  const hedefsiz = bildirimYuku({ pg: { cizgi: 16, enAz: "16.9", hedef: null } });
  const pgImzala = (y: Record<string, unknown>, typ = "tekserp-pg", k: TestAnahtari = anahtar) => signJws({ typ, kid: k.kid, payload: y, privateKey: k.privateKey });
  const pgGecerli = signPgPackageManifest({ payload: pgKunyeYuku(), key: { kid: anahtar.kid, privateKey: anahtar.privateKey } });
  const [pbas, , pimza] = pgGecerli.split(".");
  const paket: PackageIdentity = { kid: "paket-2027", paketId: bildirimYuku().paket.paketId, urun: "backend", surum: "2.11.0", derlemeTarihi: "2026-09-30T18:00:00.000Z", musteri: "testfabrika" };
  return [
    // ── bildirim ──
    { tur: "bildirim", ad: "geçerli bildirim", token: gecerli, keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "üretim anahtarıyla geçerli bildirim", token: imzala(bildirimYuku(), uretim), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "yük kurcalandı", token: kurcali, keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "başka kanalın bildirimi (tekrar oynatma)", token: gecerli, keys, kanal: "adnansahin" },
    { tur: "bildirim", ad: "bilinmeyen anahtar", token: imzala(bildirimYuku(), yabanci), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "hazırlık anahtarı çağıranın kümesinde yok (ÜRETİM kurulumu)", token: gecerli, keys: [{ kid: uretim.kid, x: uretim.x }], kanal: "testfabrika" },
    { tur: "bildirim", ad: "yanlış belge türü (bütünlük typ'i)", token: hamYuk(bildirimYuku(), "tekserp-butunluk"), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "imzalayan paketImzaKid değil", token: hamYuk({ ...bildirimYuku(), paketImzaKid: uretim.kid }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "v:2", token: hamYuk({ ...bildirimYuku(), v: 2 }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "sürümde +yapı eki", token: hamYuk({ ...bildirimYuku(), surum: "2.11.0+abc" }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "paket adında yol", token: hamYuk({ ...bildirimYuku(), paket: { ...bildirimYuku().paket, ad: "../x.zip" } }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "sha256 büyük harf", token: hamYuk({ ...bildirimYuku(), paket: { ...bildirimYuku().paket, sha256: "A".repeat(64) } }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "minKaynakSurum sürümden yeni", token: hamYuk({ ...bildirimYuku(), minKaynakSurum: "2.12.0" }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "derleme yayından sonra", token: hamYuk({ ...bildirimYuku(), derlemeTarihi: "2026-10-05T00:00:00.000Z" }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "tanınmayan alan atılır (v:1 ekleme)", token: hamYuk({ ...bildirimYuku(), yeniBilgi: 1 }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "platform linux", token: hamYuk({ ...bildirimYuku(), platform: "linux-x64" }), keys, kanal: "testfabrika" },
    // ── sözleşme 5: Linux/OCI ──
    { tur: "bildirim", ad: "s5 Windows bildirimi güncelleyici bloğuyla", token: imzala(bildirimYuku({ guncelleyici: GUNCELLEYICI })), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "s5 Linux bildirimi Linux okuyucuda", token: imzala(linuxYuku()), keys, kanal: "testfabrika", platform: "linux-x64-oci" },
    { tur: "bildirim", ad: "s5 Linux bildirimi güncelleyici bloğu yok", token: imzala(linuxYuku({ guncelleyici: undefined })), keys, kanal: "testfabrika", platform: "linux-x64-oci" },
    { tur: "bildirim", ad: "s5 Linux bildirimi platformsuz okuyucuda (Windows)", token: imzala(linuxYuku()), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "s5 Linux bildirimi açıkça Windows okuyucuda", token: imzala(linuxYuku()), keys, kanal: "testfabrika", platform: "win32-x64" },
    { tur: "bildirim", ad: "s5 Windows bildirimi Linux okuyucuda", token: gecerli, keys, kanal: "testfabrika", platform: "linux-x64-oci" },
    { tur: "bildirim", ad: "s5 kanal platformdan önce denetlenir", token: imzala(linuxYuku()), keys, kanal: "adnansahin" },
    { tur: "bildirim", ad: "s5 Linux bildirimi imajsız", token: hamYuk({ ...linuxYuku(), imaj: undefined }), keys, kanal: "testfabrika", platform: "linux-x64-oci" },
    { tur: "bildirim", ad: "s5 Windows bildirimi imajlı", token: hamYuk({ ...bildirimYuku(), imaj: IMAJ }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "s5 Linux paketi zip", token: hamYuk({ ...linuxYuku(), paket: { ...linuxYuku().paket, ad: "tekserp-backend-oci-2.11.0.zip" } }), keys, kanal: "testfabrika", platform: "linux-x64-oci" },
    { tur: "bildirim", ad: "s5 Windows paketi tar", token: hamYuk({ ...bildirimYuku(), paket: { ...bildirimYuku().paket, ad: "tekserp-backend-2.11.0.tar" } }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "s5 Linux bildiriminde PG hedefi", token: hamYuk({ ...linuxYuku(), pg: PG_GEREKSINIM }), keys, kanal: "testfabrika", platform: "linux-x64-oci" },
    { tur: "bildirim", ad: "s5 imaj kimliği öneksiz", token: hamYuk({ ...linuxYuku(), imaj: { ...IMAJ, kimlik: "5".repeat(64) } }), keys, kanal: "testfabrika", platform: "linux-x64-oci" },
    { tur: "bildirim", ad: "s5 imaj etiketi etiketsiz ad", token: hamYuk({ ...linuxYuku(), imaj: { ...IMAJ, etiket: "tekserp-korumali" } }), keys, kanal: "testfabrika", platform: "linux-x64-oci" },
    { tur: "bildirim", ad: "s5 güncelleyici özeti büyük harf", token: hamYuk({ ...bildirimYuku(), guncelleyici: { ...GUNCELLEYICI, sha256: "A".repeat(64) } }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "s5 güncelleyici sürümünde +yapı eki", token: hamYuk({ ...bildirimYuku(), guncelleyici: { ...GUNCELLEYICI, surum: "0.2.0+abc" } }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "s5 imaj null", token: hamYuk({ ...linuxYuku(), imaj: null }), keys, kanal: "testfabrika", platform: "linux-x64-oci" },
    { tur: "bildirim", ad: "s5 imajda tanınmayan alan atılır", token: hamYuk({ ...linuxYuku(), imaj: { ...IMAJ, platform: "linux/amd64" } }), keys, kanal: "testfabrika", platform: "linux-x64-oci" },
    { tur: "bildirim", ad: "pg hedefsiz (küçük sürüm güncellemesi yok)", token: imzala(hedefsiz), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "pg enAz başka ana sürümde", token: hamYuk({ ...bildirimYuku(), pg: { ...PG_GEREKSINIM, enAz: "15.8" } }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "pg hedef başka ana sürümde (17)", token: hamYuk({ ...bildirimYuku(), pg: { ...PG_GEREKSINIM, hedef: { ...PG_HEDEF, surum: "17.6" } } }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "pg hedef enAz'dan eski", token: hamYuk({ ...bildirimYuku(), pg: { ...PG_GEREKSINIM, enAz: "16.16" } }), keys, kanal: "testfabrika" },
    { tur: "bildirim", ad: "pg eski biçim (gerekenSurum) — sözleşme sürümü 1", token: hamYuk({ ...bildirimYuku(), pg: { gerekenSurum: "16.4", paket: null } }), keys, kanal: "testfabrika" },
    // ── yayın yolları (sözleşme 5) ──
    { tur: "yol", ad: "s5 platformsuz yol = Windows (değişmedi)", kanal: "test", surum: "2.11.0", dosya: "tekserp-backend-2.11.0.zip" },
    { tur: "yol", ad: "s5 Windows yolu", kanal: "genel", surum: "2.11.0", dosya: "surum.json", platform: "win32-x64" },
    { tur: "yol", ad: "s5 Linux yolu backend-oci", kanal: "test", surum: "2.11.0", dosya: "tekserp-backend-oci-2.11.0.tar", platform: "linux-x64-oci" },
    // ── PG künyesi (sözleşme sürümü 2) ──
    { tur: "pg-kunye", ad: "geçerli PG künyesi", token: pgGecerli, keys },
    { tur: "pg-kunye", ad: "PG künyesi kurcalandı", token: `${pbas}.${Buffer.from(JSON.stringify({ ...pgKunyeYuku(), derleme: 5 })).toString("base64url")}.${pimza}`, keys },
    { tur: "pg-kunye", ad: "PG künyesi yanlış tür (tekserp-surum)", token: pgImzala(pgKunyeYuku(), "tekserp-surum"), keys },
    { tur: "pg-kunye", ad: "PG künyesi bilinmeyen anahtar", token: pgImzala(pgKunyeYuku(), "tekserp-pg", yabanci), keys },
    { tur: "pg-kunye", ad: "PG sürümü çizginin ana sürümünde değil", token: pgImzala({ ...pgKunyeYuku(), surum: "17.6" }), keys },
    { tur: "pg-kunye", ad: "PG derlemesi 0", token: pgImzala({ ...pgKunyeYuku(), derleme: 0 }), keys },
    { tur: "pg-kunye", ad: "PG künyesi v:2", token: pgImzala({ ...pgKunyeYuku(), v: 2 }), keys },
    { tur: "pg-kunye", ad: "PG künyesi başka ürün", token: pgImzala({ ...pgKunyeYuku(), urun: "backend" }), keys },
    { tur: "pg-kunye", ad: "s5 PG künyesi Linux platformunda", token: pgImzala({ ...pgKunyeYuku(), platform: "linux-x64-oci" }), keys },
    // ── işaretçi ──
    { tur: "isaretci", ad: "geçerli işaretçi", metin: releasePointerText(gecerli) },
    { tur: "isaretci", ad: "JSON değil", metin: "<html>404</html>" },
    { tur: "isaretci", ad: "fazla alan", metin: JSON.stringify({ v: 1, bildirim: gecerli, surum: "2.11.0" }) },
    { tur: "isaretci", ad: "v:2", metin: JSON.stringify({ v: 2, bildirim: gecerli }) },
    { tur: "isaretci", ad: "bildirim boş", metin: JSON.stringify({ v: 1, bildirim: "" }) },
    // ── politika ──
    { tur: "politika", ad: "otomatik + pencere + aralıklar", girdi: politika() },
    { tur: "politika", ad: "onaylı, pencere yok", girdi: { kip: "ONAYLI", pencere: null, araliklar: [], hedefSurum: null } },
    { tur: "politika", ad: "dondur + sabitleme", girdi: { kip: "DONDUR", pencere: null, araliklar: [], hedefSurum: "2.10.9" } },
    { tur: "politika", ad: "otomatik ama pencere yok", girdi: { kip: "OTOMATIK", pencere: null, araliklar: [], hedefSurum: null } },
    { tur: "politika", ad: "pencere yokken aralık", girdi: { kip: "ONAYLI", pencere: null, araliklar: [{ baslangic: ISO(T0), bitis: ISO(T0 + SAAT) }], hedefSurum: null } },
    { tur: "politika", ad: "aralıklar sırasız", girdi: politika({ araliklar: [{ baslangic: ISO(T0 + GUN), bitis: ISO(T0 + GUN + SAAT) }, { baslangic: ISO(T0), bitis: ISO(T0 + SAAT) }] }) },
    { tur: "politika", ad: "aralıklar çakışıyor", girdi: politika({ araliklar: [{ baslangic: ISO(T0), bitis: ISO(T0 + 2 * SAAT) }, { baslangic: ISO(T0 + SAAT), bitis: ISO(T0 + 3 * SAAT) }] }) },
    { tur: "politika", ad: "bitişik aralıklar (00:00–24:00 her gün)", girdi: politika({ pencere: { ...KURAL, baslangic: "00:00", bitis: "24:00" }, araliklar: [{ baslangic: ISO(T0), bitis: ISO(T0 + GUN) }, { baslangic: ISO(T0 + GUN), bitis: ISO(T0 + 2 * GUN) }] }) },
    { tur: "politika", ad: "aralık 25 saatten uzun", girdi: politika({ araliklar: [{ baslangic: ISO(T0), bitis: ISO(T0 + 26 * SAAT) }] }) },
    { tur: "politika", ad: "gün listesi sırasız", girdi: politika({ pencere: { ...KURAL, gunler: [3, 1] } }) },
    { tur: "politika", ad: "gün 0", girdi: politika({ pencere: { ...KURAL, gunler: [0] } }) },
    { tur: "politika", ad: "başlangıç = bitiş", girdi: politika({ pencere: { ...KURAL, bitis: "02:00" } }) },
    { tur: "politika", ad: "başlangıç 24:00", girdi: politika({ pencere: { ...KURAL, baslangic: "24:00" } }) },
    { tur: "politika", ad: "gece yarısını aşan pencere", girdi: politika({ pencere: { ...KURAL, baslangic: "23:00", bitis: "04:00" } }) },
    { tur: "politika", ad: "sabitlemede +yapı eki", girdi: politika({ hedefSurum: "2.11.0+abc" }) },
    { tur: "politika", ad: "saat dilimi biçimsiz", girdi: politika({ pencere: { ...KURAL, saatDilimi: "../etc" } }) },
    { tur: "politika", ad: "tanınmayan alan atılır", girdi: politika({ yeniAlan: true }) },
    { tur: "politika", ad: "bilinmeyen kip", girdi: politika({ kip: "HEMEN" }) },
    // ── kira yükü ──
    { tur: "kira-yuku", ad: "alan yok (eski satıcı)", girdi: kiraYukuSabit() },
    { tur: "kira-yuku", ad: "alan var", girdi: kiraYukuSabit({ guncelleme: politika() }) },
    { tur: "kira-yuku", ad: "aralık kiranın ömrü dışında", girdi: kiraYukuSabit({ guncelleme: politika({ araliklar: [{ baslangic: ISO(T0 + 40 * GUN), bitis: ISO(T0 + 40 * GUN + SAAT) }] }) }) },
    { tur: "kira-yuku", ad: "politika bozuk → kira bozuk", girdi: kiraYukuSabit({ guncelleme: { kip: "OTOMATIK", pencere: null, araliklar: [], hedefSurum: null } }) },
    // ── etkin politika ──
    { tur: "etkin-politika", ad: "kira yok", kira: null, nowMs: T0 },
    { tur: "etkin-politika", ad: "alan yok → varsayılan ONAYLI", kira: kiraYukuSabit(), nowMs: T0 + GUN },
    { tur: "etkin-politika", ad: "alan var → kiradan", kira: kiraYukuSabit({ guncelleme: politika() }), nowMs: T0 + GUN },
    { tur: "etkin-politika", ad: "kiranın süresi geçti (tolerans dışı)", kira: kiraYukuSabit({ guncelleme: politika() }), nowMs: T0 + 30 * GUN + 11 * 60 * 1000 },
    { tur: "etkin-politika", ad: "kiranın süresi tolerans içinde", kira: kiraYukuSabit({ guncelleme: politika() }), nowMs: T0 + 30 * GUN + 9 * 60 * 1000 },
    // ── karar ──
    { tur: "karar", ad: "kira yok", girdi: kararGirdisi({ politika: null }) },
    { tur: "karar", ad: "K1 politikayı ve HEMEN onayını ezer", girdi: kararGirdisi({ guncellemeDonuk: true, onay: { surum: "2.11.0", zamanlama: "HEMEN" } }) },
    { tur: "karar", ad: "DONDUR onayı da kapatır", girdi: kararGirdisi({ politika: LeaseUpdatePolicySchema.parse({ kip: "DONDUR", pencere: null, araliklar: [], hedefSurum: null }), onay: { surum: "2.11.0", zamanlama: "HEMEN" } }) },
    { tur: "karar", ad: "kurulu sürüm biçimsiz", girdi: kararGirdisi({ kuruluSurum: "dev" }) },
    { tur: "karar", ad: "sabitlenen sürüme ulaşıldı", girdi: kararGirdisi({ politika: LeaseUpdatePolicySchema.parse(politika({ hedefSurum: "2.10.4" })) }) },
    { tur: "karar", ad: "sabitleme geri inmez", girdi: kararGirdisi({ politika: LeaseUpdatePolicySchema.parse(politika({ hedefSurum: "2.9.0" })) }) },
    { tur: "karar", ad: "aday yok", girdi: kararGirdisi({ aday: null }) },
    { tur: "karar", ad: "aday kurulu sürümle aynı", girdi: kararGirdisi({ kuruluSurum: "2.11.0" }) },
    { tur: "karar", ad: "aday eski (geri inilmez)", girdi: kararGirdisi({ kuruluSurum: "2.12.0" }) },
    { tur: "karar", ad: "sabitleme var, aday başka sürüm", girdi: kararGirdisi({ politika: LeaseUpdatePolicySchema.parse(politika({ hedefSurum: "2.10.9" })) }) },
    { tur: "karar", ad: "sabitlenen sürümün adayı, pencere içi", girdi: kararGirdisi({ politika: LeaseUpdatePolicySchema.parse(politika({ hedefSurum: "2.11.0" })), nowMs: ICINDE }) },
    { tur: "karar", ad: "kaynak sürüm doğrudan geçiş için eski", girdi: kararGirdisi({ kuruluSurum: "2.8.7" }) },
    { tur: "karar", ad: "ön sürüm kaynağı sınırın altında", girdi: kararGirdisi({ kuruluSurum: "2.9.0-rc.1" }) },
    { tur: "karar", ad: "HAK yok", girdi: kararGirdisi({ bakimBitisMs: null }) },
    { tur: "karar", ad: "derleme bakım sonundan sonra", girdi: kararGirdisi({ bakimBitisMs: Date.parse("2026-09-30T00:00:00.000Z") }) },
    { tur: "karar", ad: "PostgreSQL ölçülemedi", girdi: kararGirdisi({ pg: null }) },
    { tur: "karar", ad: "kendi kipte PG derlemesi bilinmiyor", girdi: kararGirdisi({ pg: { kip: "KENDI", surum: "16.15", derleme: null } }) },
    { tur: "karar", ad: "PostgreSQL ana sürüm farklı (kendi)", girdi: kararGirdisi({ pg: { kip: "KENDI", surum: "15.8", derleme: 1 } }) },
    { tur: "karar", ad: "PostgreSQL ana sürüm farklı (harici 17)", girdi: kararGirdisi({ pg: { kip: "HARICI", surum: "17.2", derleme: null } }) },
    { tur: "karar", ad: "harici PG enAz altında", girdi: kararGirdisi({ pg: { kip: "HARICI", surum: "16.2", derleme: null } }) },
    { tur: "karar", ad: "harici PG enAz üstünde, hedefe dokunulmaz", girdi: kararGirdisi({ pg: { kip: "HARICI", surum: "16.9", derleme: null }, nowMs: ICINDE }) },
    { tur: "karar", ad: "kendi PG hedeften eski → PG birlikte", girdi: kararGirdisi({ pg: { kip: "KENDI", surum: "16.9", derleme: 1 }, nowMs: ICINDE }) },
    { tur: "karar", ad: "kendi PG aynı sürüm eski derleme → PG birlikte", girdi: kararGirdisi({ pg: { kip: "KENDI", surum: "16.15", derleme: 3 }, nowMs: ICINDE }) },
    { tur: "karar", ad: "kendi PG hedeften yeni → geri inmez", girdi: kararGirdisi({ pg: { kip: "KENDI", surum: "16.16", derleme: 1 }, nowMs: ICINDE }) },
    { tur: "karar", ad: "hedefsiz bildirim, kendi PG enAz altında", girdi: kararGirdisi({ aday: hedefsiz, pg: { kip: "KENDI", surum: "16.2", derleme: 1 } }) },
    { tur: "karar", ad: "otomatik, pencere dışı → sıradaki pencere", girdi: kararGirdisi() },
    { tur: "karar", ad: "otomatik, pencere içi → kur", girdi: kararGirdisi({ nowMs: ICINDE }) },
    { tur: "karar", ad: "otomatik, HEMEN onayı hızlandırır", girdi: kararGirdisi({ onay: { surum: "2.11.0", zamanlama: "HEMEN" } }) },
    { tur: "karar", ad: "otomatik, son aralıktan sonra pencere yok", girdi: kararGirdisi({ nowMs: T0 + 40 * GUN }) },
    { tur: "karar", ad: "onaylı, onay yok", girdi: kararGirdisi({ politika: onayli(), nowMs: ICINDE }) },
    { tur: "karar", ad: "onaylı, başka sürümün onayı sayılmaz", girdi: kararGirdisi({ politika: onayli(), onay: { surum: "2.10.9", zamanlama: "HEMEN" } }) },
    { tur: "karar", ad: "onaylı, HEMEN", girdi: kararGirdisi({ politika: onayli(), onay: { surum: "2.11.0", zamanlama: "HEMEN" } }) },
    { tur: "karar", ad: "onaylı, PENCERE onayı pencere dışı", girdi: kararGirdisi({ politika: onayli(), onay: { surum: "2.11.0", zamanlama: "PENCERE" } }) },
    { tur: "karar", ad: "onaylı, PENCERE onayı pencere içi", girdi: kararGirdisi({ politika: onayli(), onay: { surum: "2.11.0", zamanlama: "PENCERE" }, nowMs: ICINDE }) },
    { tur: "karar", ad: "onaylı pencere yok, PENCERE onayı bekler", girdi: kararGirdisi({ politika: LeaseUpdatePolicySchema.parse({ kip: "ONAYLI", pencere: null, araliklar: [], hedefSurum: null }), onay: { surum: "2.11.0", zamanlama: "PENCERE" } }) },
    { tur: "karar", ad: "pencere bitiş anı dışarıda (yarı açık aralık)", girdi: kararGirdisi({ nowMs: Date.parse("2026-10-03T02:00:00.000Z") }) },
    { tur: "karar", ad: "pencere başlangıç anı içeride", girdi: kararGirdisi({ nowMs: Date.parse("2026-10-02T23:00:00.000Z") }) },
    { tur: "karar", ad: "s5 Linux adayı aynı tablodan (pencere içi → kur)", girdi: kararGirdisi({ aday: linuxYuku(), nowMs: ICINDE }) },
    { tur: "karar", ad: "s5 Linux adayı, kendi PG hedefsiz bildirimde dokunulmaz", girdi: kararGirdisi({ aday: linuxYuku(), pg: { kip: "KENDI", surum: "16.9", derleme: 1 }, nowMs: ICINDE }) },
    // ── sürüm karşılaştırma ──
    { tur: "surum-karsilastir", ad: "yama büyük", a: "2.10.10", b: "2.10.9" },
    { tur: "surum-karsilastir", ad: "sayısal (sözlük değil)", a: "2.9.0", b: "2.10.0" },
    { tur: "surum-karsilastir", ad: "eşit", a: "2.10.0", b: "2.10.0" },
    { tur: "surum-karsilastir", ad: "ön sürüm < sürüm", a: "1.0.0-rc.1", b: "1.0.0" },
    { tur: "surum-karsilastir", ad: "ön sürüm sayısal kimlik", a: "1.0.0-rc.2", b: "1.0.0-rc.10" },
    { tur: "surum-karsilastir", ad: "sayısal < alfasayısal", a: "1.0.0-1", b: "1.0.0-alpha" },
    { tur: "surum-karsilastir", ad: "kısa ön sürüm < uzun", a: "1.0.0-alpha", b: "1.0.0-alpha.1" },
    { tur: "surum-karsilastir", ad: "+yapı önceliğe girmez", a: "1.0.0+abc", b: "1.0.0" },
    { tur: "surum-karsilastir", ad: "biçimsiz", a: "v1.0.0", b: "1.0.0" },
    { tur: "surum-karsilastir", ad: "boş ön sürüm kimliği biçimsiz", a: "1.0.0-rc..1", b: "1.0.0" },
    // ── paket bağı ──
    { tur: "paket-bagi", ad: "bağlı", bildirim: bildirimYuku(), paket },
    { tur: "paket-bagi", ad: "kanal-dışı paket (müşteri null) bağlı", bildirim: bildirimYuku(), paket: { ...paket, musteri: null } },
    { tur: "paket-bagi", ad: "başka kanalın paketi", bildirim: bildirimYuku(), paket: { ...paket, musteri: "adnansahin" } },
    { tur: "paket-bagi", ad: "paketId farklı", bildirim: bildirimYuku(), paket: { ...paket, paketId: "7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" } },
    { tur: "paket-bagi", ad: "sürüm farklı", bildirim: bildirimYuku(), paket: { ...paket, surum: "2.10.9" } },
    { tur: "paket-bagi", ad: "imzalayan farklı", bildirim: bildirimYuku(), paket: { ...paket, kid: "paket-2026" } },
    { tur: "paket-bagi", ad: "derleme tarihi aynı an, farklı yazım", bildirim: bildirimYuku(), paket: { ...paket, derlemeTarihi: "2026-09-30T18:00:00Z" } },
    { tur: "paket-bagi", ad: "s5 Linux paketi Docker künyesiyle bağlı", bildirim: linuxYuku(), paket: { ...paket, paketId: linuxYuku().paket.paketId, urun: "backend-docker" } },
    { tur: "paket-bagi", ad: "s5 Linux bildirimi Windows künyesiyle", bildirim: linuxYuku(), paket: { ...paket, paketId: linuxYuku().paket.paketId } },
    { tur: "paket-bagi", ad: "s5 Windows bildirimi Docker künyesiyle", bildirim: bildirimYuku(), paket: { ...paket, urun: "backend-docker" } },
    // ── PG bağı (sözleşme sürümü 2) ──
    { tur: "pg-bagi", ad: "PG künyesi hedefle bağlı", gereksinim: PG_GEREKSINIM, kunye: pgKunyeYuku() },
    { tur: "pg-bagi", ad: "bildirim PG hedefi taşımıyor", gereksinim: { ...PG_GEREKSINIM, hedef: null }, kunye: pgKunyeYuku() },
    { tur: "pg-bagi", ad: "PG paket özeti farklı", gereksinim: PG_GEREKSINIM, kunye: pgKunyeYuku({ paket: { ...PG_HEDEF.paket, sha256: "4".repeat(64) } }) },
    { tur: "pg-bagi", ad: "PG künyesi başka ana sürüm (17)", gereksinim: PG_GEREKSINIM, kunye: pgKunyeYuku({ cizgi: 17, surum: "17.6" }) },
    { tur: "pg-bagi", ad: "PG ICU sürümü farklı", gereksinim: PG_GEREKSINIM, kunye: pgKunyeYuku({ icuSurum: "74" }) },
    { tur: "pg-bagi", ad: "PG derlemesi farklı", gereksinim: PG_GEREKSINIM, kunye: pgKunyeYuku({ derleme: 5 }) },
    // ── rapor ──
    { tur: "rapor", ad: "tam rapor", girdi: raporYuku() },
    { tur: "rapor", ad: "güncelleyici yok, sonuç yok", girdi: { saatDilimi: DEFAULT_FACTORY_TIMEZONE, guncelleyici: { durum: "YOK", surum: null }, bekleyen: null, son: null } },
    { tur: "rapor", ad: "tanınmayan alan (KATI)", girdi: { ...raporYuku(), mesaj: "serbest metin" } },
    { tur: "rapor", ad: "başarılı sonuç kod taşıyamaz", girdi: raporYuku({ sonuc: "BASARILI", kod: "GOC_HATASI" }) },
    { tur: "rapor", ad: "başarısız sonuç kod taşımalı", girdi: raporYuku({ sonuc: "BASARISIZ", kod: null }) },
    { tur: "rapor", ad: "kod deseni (serbest metin yok)", girdi: raporYuku({ kod: "göç düştü: tablo yok" }) },
    { tur: "rapor", ad: "belgesiz ama desene uyan kod geçer (ileri uyum)", girdi: raporYuku({ kod: "YENI_BIR_KOD" }) },
    { tur: "rapor", ad: "bitiş başlangıçtan önce", girdi: raporYuku({ bitis: "2026-10-02T23:00:00.000Z" }) },
  ];
}

function raporYuku(son: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    saatDilimi: DEFAULT_FACTORY_TIMEZONE,
    guncelleyici: { durum: "CALISIYOR", surum: "1.0.0" },
    bekleyen: { surum: "2.11.0", karar: "PENCERE_BEKLIYOR", neden: null },
    son: {
      kayitId: "3a6e9c5d-2f4b-4c0d-9e3f-8a9b0c1d2e3f",
      hedefSurum: "2.10.4",
      kaynakSurum: "2.10.3",
      sonuc: "GERI_DONDU",
      kod: "SAGLIK_HATASI",
      baslangic: "2026-10-02T23:05:00.000Z",
      bitis: "2026-10-02T23:41:00.000Z",
      veriGeriYuklendi: true,
      ...son,
    },
  };
}

/** Dosya adı → o dosyanın vektör türleri (Rust tarafı dosya başına okur). */
const DOSYA_TURLERI: Record<GuncellemeVektorDosyasi, readonly GuncellemeVektoru["tur"][]> = {
  "guncelleme-surum.json": ["bildirim", "isaretci", "pg-kunye", "yol"],
  "guncelleme-kira.json": ["politika", "kira-yuku", "etkin-politika"],
  "guncelleme-karar.json": ["karar", "surum-karsilastir", "paket-bagi", "pg-bagi"],
  "guncelleme-rapor.json": ["rapor"],
};

/** Taze anahtarlarla bütün kayıtlar, dosyalarına bölünmüş. */
export function guncellemeVektorleriKur(): Record<GuncellemeVektorDosyasi, GuncellemeVektorKaydi[]> {
  const liste = vektorler(anahtarUret("paket-2027"), anahtarUret("paket-yabanci"), anahtarUret("paket-2026"));
  const out: Record<GuncellemeVektorDosyasi, GuncellemeVektorKaydi[]> = {
    "guncelleme-surum.json": [],
    "guncelleme-kira.json": [],
    "guncelleme-karar.json": [],
    "guncelleme-rapor.json": [],
  };
  for (const v of liste) {
    const dosya = GUNCELLEME_VEKTOR_DOSYALARI.find((d) => DOSYA_TURLERI[d].includes(v.tur));
    if (!dosya) throw new Error(`vektör türü dosyasız: ${v.tur}`);
    out[dosya].push({ vektor: v, beklenen: guncellemeDegerlendir(v) });
  }
  return out;
}

/** Satır başına bir kayıt (fark okunur); biçim sürümü + üretici notu. */
export function guncellemeVektorMetni(kayitlar: readonly GuncellemeVektorKaydi[]): string {
  const bas = JSON.stringify({ bicim: GUNCELLEME_VEKTOR_BICIMI, not: "Üreten: Teks-Erp/scripts/test_guncelleme_protokol.ts --vektor-yaz (TS kâhini). Elle düzenlenmez." });
  return `${bas.slice(0, -1)},"kayitlar":[\n${kayitlar.map((k) => JSON.stringify(k)).join(",\n")}\n]}\n`;
}
