// =============================================================================
// HEDEF VERİTABANI KAPISI — bayrak/veri YAZAN bekçi altyapısı için TEK kaynak
// =============================================================================
// NEDEN: `Teks-Erp/.env` bir dev DB'sini gösterebilir ve `DATABASE_URL`
// export'u unutulan tek bir koşum oraya gider. Bu kapı yalnız ÜRETİM adlarını
// tutar (dev/demo DB'ye yazmak meşru olabilir); ad kümedeyse `BEKCI_PROD_ONAY=1`
// verilmeden DURULUR. 2026-09-03'e kadar kapı yalnız `test_module_flag_off`
// içindeydi; fixture üzerinden bayrak yazan dört test (yarn_stock ·
// goods_receipt · stock_count · purchase_order) korumasızdı (V minor #2).
//
// TÜKETİCİLER: test_module_flag_off (bant + fail) · fixture-module-flags (throw).
// =============================================================================
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { PG_SESSION_OPTIONS } from "../../src/lib/pg-session";
import { BILINEN_GUVENLI_DB_ADLARI } from "./bilinen-guvenli-db";

export const YAZILMASI_YASAK_DB: ReadonlySet<string> = new Set([
  "tekserp",
  "tekserp_prod",
  "adnansahin_db",
]);

/** `DATABASE_URL`den veritabanı adı; okunamazsa "(bilinmiyor)" / "(okunamadı)". */
export function hedefDbAdi(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "") || "(bilinmiyor)";
  } catch {
    return "(okunamadı)";
  }
}

/** Engel varsa Türkçe gerekçe döner, yoksa null. Yazma yapan her bekçi/fixture ÖNCE bunu sorar. */
export function hedefDbEngeli(): string | null {
  const dbAdi = hedefDbAdi();
  if (YAZILMASI_YASAK_DB.has(dbAdi) && process.env.BEKCI_PROD_ONAY !== "1") {
    return (
      `'${dbAdi}' bir ÜRETİM veritabanı adı ve bu koşum YAZAR ` +
      "(modül bayrakları + test verisi). Bilerek koşuyorsan BEKCI_PROD_ONAY=1 ver."
    );
  }
  return null;
}

// ── PAKET/BEKÇİ HEDEFİ: FİXTURE DB ZORUNLU (2026-09-12) ─────────────────────
// Ortak ağaçtaki `.env` fabrikanın canlı YEDEĞİNİ (`tekserp_fabrika_dev`)
// gösteriyor: açık `DATABASE_URL` verilmeden koşulan her bekçi oraya yazar ve
// paket 1.500'den fazla `deleteMany` gönderir. Host kapısı bunu görmez (adres
// yerel), bu yüzden kapı ADA bakar: hedef fixture kalıbına uymuyorsa DURUR.
//
// ⚠️ YALNIZ `_test`: ilk yazımda `_local` de kabul ediliyordu ama o son eki
// taşıyan tek bir veritabanı yok — kapının kabul kümesi, KULLANILAN adlardan
// geniş olmamalı. `db-guard.ts` daha geniş bir küme (`_dev`/`_demo`) tanır;
// o kapı "geliştirme hedefi mi" sorusunu, bu kapı "fixture hedefi mi" sorusunu
// cevaplar ve fixture kümesi bilerek DARDIR.
const FIXTURE_SON_EKLERI = ["_test"];

/**
 * Son eki taşımayan ama FİXTURE hedefi olduğu BİLİNEN adlar.
 *
 * ⚠️ Liste burada YAZILMAZ — `lib/bilinen-guvenli-db.ts` bu kapı ile
 * `scripts/db-guard.ts`in ORTAK kaynağıdır. `teks_ci` yalnız buraya eklendiği
 * sürece diğer kapı onu "TANINMAYAN AD" sayıyordu (ölçüldü 2026-09-12, CI-biçimli
 * koşum). SON EK listesi ortak DEĞİLDİR ve olmamalı: bu kapı `_dev`/`_demo`yu
 * REDDETMEK için var. `test_script_guards §6` her iki ayağı da sondalar.
 */
const FIXTURE_ADLARI: ReadonlySet<string> = BILINEN_GUVENLI_DB_ADLARI;

/** Fixture olmadığı BİLİNEN adlar — mesajda ayrıca anılır (dev kopya / canlı). */
export const FIXTURE_OLMAYAN_DB: ReadonlySet<string> = new Set([
  "tekserp_fabrika_dev",
  "tekserp_demo",
  "tekserp_demo2",
  "tekserp_saf_dev",
  "tekserp_yeni_dev",
  "tekserp_adnansahin_dev",
  ...YAZILMASI_YASAK_DB,
]);

/**
 * Paket/bekçi koşumunun hedefi fixture DB mi? Değilse Türkçe gerekçe döner.
 *
 * Kaçış `BEKCI_HEDEF_ONAY=1` — bilinçli karardır ve hedef adı log'a basılır.
 */
export function fixtureHedefEngeli(): string | null {
  const dbAdi = hedefDbAdi();
  const fixture = FIXTURE_SON_EKLERI.some((ek) => dbAdi.endsWith(ek)) || FIXTURE_ADLARI.has(dbAdi);
  if (fixture) return null;
  if (process.env.BEKCI_HEDEF_ONAY === "1") return null;
  const bilinen = FIXTURE_OLMAYAN_DB.has(dbAdi)
    ? " Bu ad fabrikanın yedeği / canlı kopya olarak biliniyor."
    : "";
  return (
    `Hedef DB '${dbAdi}' fixture kalıbına uymuyor (${FIXTURE_SON_EKLERI.join(" / ")} ile bitmeli).` +
    `${bilinen} Paket ve bekçiler bu hedefe YAZAR ve SİLER — ` +
    "`DATABASE_URL=postgresql://…/<ad>_test` ile koş. " +
    "Bilerek koşuyorsan BEKCI_HEDEF_ONAY=1 ver."
  );
}

// ── ÜÇÜNCÜ AYAK: HACİM (2026-09-12) ─────────────────────────────────────────
// Ad kapısı yanılabilir: yarın fabrikanın yeni bir kopyası `..._test` adıyla
// doğarsa kalıp onu GEÇİRİR. Veri hacmi yanılmaz — temiz fixture DB'si onlarca
// top taşır (ölçüldü: 28), fabrikanın yedeği binlerce (ölçüldü: 5.784).
export const FABRIKA_HACIM_ESIGI = 500;

/**
 * Saf yüklem — sayıyı bilen çağıran (bekçi) DB'siz ölçebilsin diye ayrı.
 * I/O yapan sarmalayıcı `hacimHedefEngeli()`.
 */
export function hacimEngeliMetni(dbAdi: string, topSayisi: number): string | null {
  if (topSayisi <= FABRIKA_HACIM_ESIGI) return null;
  return (
    `Hedef DB '${dbAdi}' FABRİKA ÖLÇEĞİNDE veri taşıyor: ${topSayisi} top ` +
    `(eşik ${FABRIKA_HACIM_ESIGI}). Temiz bir fixture veritabanı bu kadar top ` +
    "taşımaz — ad kalıbı doğru olsa bile hedef büyük olasılıkla fabrikanın bir " +
    "kopyasıdır ve paket oraya YAZAR, SİLER. " +
    "Bilerek koşuyorsan BEKCI_HEDEF_ONAY=1 ver."
  );
}

export interface HacimOlcumu {
  engel: string | null;
  topSayisi: number | null;
  /** Ölçüm YAPILAMADIYSA sebebi — sessiz geçmek 'ölçüldü' sanılmasın. */
  olcumNotu: string | null;
}

/** Hedefteki top sayısını ölçer; fabrika ölçeğindeyse Türkçe gerekçe döner. */
export async function hacimHedefEngeli(): Promise<HacimOlcumu> {
  // ÖLÇÜLEMEDİ = ENGEL (2026-09-12, ilk yazımdan gün içinde düzeltildi).
  // İlk sürümde ölçüm düşerse yalnız not basılıp koşum SÜRÜYORDU. Senaryo bunu
  // çürüttü: fabrikanın yedeği `tekserp_fabrika_test` adıyla kopyalanırsa AD
  // ayağı tanım gereği geçer; sunucu yüklüyken `count(*)` 5 sn zaman aşımına
  // takılır ve tek gerçek koruma tam ihtiyaç anında açılırdı. "Ölçemedim"
  // yokluk değil YANLIŞ HEDEF riskidir → fail-closed.
  const onay = process.env.BEKCI_HEDEF_ONAY === "1";
  const url = process.env.DATABASE_URL;
  if (!url) {
    return onay
      ? { engel: null, topSayisi: null, olcumNotu: "DATABASE_URL tanımsız" }
      : { engel: "Hedef hacmi ölçülemedi: DATABASE_URL tanımsız. Bilerek koşuyorsan BEKCI_HEDEF_ONAY=1 ver.", topSayisi: null, olcumNotu: null };
  }
  // 15 sn: yüklü bir makinede 5 sn connect bütçesi ölçümü düşürüyordu ve
  // fail-closed olduğumuz için bu artık koşumu DURDURUR — bütçe cömert olmalı.
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 15_000,
    options: PG_SESSION_OPTIONS,
  });
  try {
    // İki soru AYRI cevaplanır: (a) `rolls` tablosu var mı (b) kaç FABRİKA topu
    // var. Damgalı fixture artığı sayılmaz — `clean_test_residue` kendi
    // yorumlarında artığın 313/328/453 topa çıktığını yazıyor; sayılsaydı meşru
    // bir fixture DB'si eşiği aşar ve artığı temizleyecek betik de dururdu.
    const r = await pool.query<{ n: number }>(
      "SELECT CASE WHEN to_regclass('public.rolls') IS NULL THEN -1 ELSE " +
        "(SELECT count(*)::int FROM rolls WHERE barcode NOT LIKE 'TEST-%' AND barcode NOT LIKE 'TST-%') END AS n",
    );
    const n = Number(r.rows[0]?.n ?? 0);
    // Tablo YOK ⇒ hedef fabrika kopyası olamaz (fabrikada `rolls` her zaman var).
    // Bağlanamamaktan AYRI bir cevaptır ve engel değildir: taze bir test DB'si
    // `migrate deploy` öncesi bu hâldedir, migration kapısı zaten arkada durur.
    if (n < 0) return { engel: null, topSayisi: null, olcumNotu: "hedefte `rolls` tablosu yok (migration koşmamış)" };
    if (onay) return { engel: null, topSayisi: n, olcumNotu: null };
    return { engel: hacimEngeliMetni(hedefDbAdi(), n), topSayisi: n, olcumNotu: null };
  } catch (e) {
    const sebep = (e as Error).message.slice(0, 120);
    return onay
      ? { engel: null, topSayisi: null, olcumNotu: sebep }
      : {
          engel:
            `Hedef DB '${hedefDbAdi()}' hacmi ÖLÇÜLEMEDİ (${sebep}). Ad kalıbı doğru olsa bile hedefin ` +
            "fabrika kopyası olmadığı DOĞRULANAMADI; paket bu hedefe YAZAR ve SİLER. " +
            "Bilerek koşuyorsan BEKCI_HEDEF_ONAY=1 ver.",
          topSayisi: null,
          olcumNotu: null,
        };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/**
 * ŞEMA HİZASI — DB, ağacın `prisma/migrations/` dizinini taşıyor mu?
 *
 * NEDEN AYRI BİR ÖLÇÜM (2026-09-15, d9'un vakası): `migrationGate()` bu soruyu
 * zaten soruyor ama YALNIZ filtresiz tam pakette (`npx prisma migrate status`
 * bir süreç açar, ~3 sn — geliştirme döngüsünde bilerek atlanıyor). Tek bekçiyi
 * doğrudan koşturan yol ise kapıya HİÇ uğramaz: `test_zincir_uctan_uca` üç
 * migration geride bir DB'de `lot=undefined kg=0` diye kırmızı verdi — MANTIK
 * hatası gibi okunan bir ORTAM arızası. ⇒ Bir bekçinin kırmızısı, ölçtüğü şeyin
 * değil ÖN KOŞULUNUN bozukluğundan geliyorsa o kırmızı YANLIŞ HİKÂYE anlatır.
 *
 * ⚠️ KAPI DEĞİL BEYAN — `istemciHizasiBeyani`nin gerekçesiyle birebir aynı:
 * kayma başkasının meşru eyleminden doğar (migration indi) ve düzeltmesi TEK
 * KOMUTTUR; yaptırım kaymayı YAŞAYANA verilmez. Çıkış kodu etkilenmez.
 *
 * ⚠️ AD KÜMESİ, SAYI DEĞİL: "kaç migration var" karşılaştırması, biri silinip
 * biri eklendiğinde hizalı görünürdü. Eksik olanlar ADIYLA basılır.
 */
export interface SemaHizasi {
  durum: "hizali" | "geride" | "olculemedi";
  eksik: string[];
  /** `olculemedi` hâlinde sebep; diğerlerinde null. */
  neden: string | null;
  /** Ağaçtaki migration klasörü sayısı (körlük zemini). */
  agacta: number;
}

export async function semaHizasi(): Promise<SemaHizasi> {
  const url = process.env.DATABASE_URL;
  if (!url) return { durum: "olculemedi", eksik: [], neden: "DATABASE_URL tanımsız", agacta: 0 };
  let agac: string[];
  try {
    agac = readdirSync(join(__dirname, "..", "..", "prisma", "migrations"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch (e) {
    return { durum: "olculemedi", eksik: [], neden: `migrations dizini okunamadı (${(e as Error).message.slice(0, 60)})`, agacta: 0 };
  }
  // Körlük zemini: dizin boşsa ölçüm yok — "hepsi uygulanmış" demek YANLIŞ olur.
  if (agac.length === 0) return { durum: "olculemedi", eksik: [], neden: "ağaçta migration klasörü yok", agacta: 0 };

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 15_000, options: PG_SESSION_OPTIONS });
  try {
    // Tablo YOKSA ölçüm yapılamaz (taze DB) — "geride" demek de doğru olurdu ama
    // `hacimHedefEngeli`nin `rolls` dalıyla aynı gerekçe: migration hiç koşmamış
    // bir hedef, kaymış bir hedef DEĞİLDİR ve `migrationGate` zaten arkada durur.
    const t = await pool.query<{ v: string | null }>("SELECT to_regclass('public._prisma_migrations')::text AS v");
    if (!t.rows[0]?.v) return { durum: "olculemedi", eksik: [], neden: "_prisma_migrations tablosu yok (migration hiç koşmamış)", agacta: agac.length };
    // ⚠️ `finished_at IS NOT NULL`: yarım kalmış (rolled back / hata almış) bir
    // kayıt UYGULANMIŞ sayılmaz — sayılsaydı kayma tam da bozuk kurulumda gizlenirdi.
    const r = await pool.query<{ migration_name: string }>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL",
    );
    const uygulanan = new Set(r.rows.map((x) => x.migration_name));
    const eksik = agac.filter((m) => !uygulanan.has(m));
    return { durum: eksik.length === 0 ? "hizali" : "geride", eksik, neden: null, agacta: agac.length };
  } catch (e) {
    return { durum: "olculemedi", eksik: [], neden: (e as Error).message.slice(0, 100), agacta: agac.length };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/**
 * KAÇIŞ ANAHTARLARI — hedef kapısını bilinçli olarak devre dışı bırakırlar.
 * Tek kaynak: aşağıdaki `cocukOrtami` ve kapı ayakları aynı listeyi okur.
 */
export const KACIS_ANAHTARLARI = ["BEKCI_HEDEF_ONAY", "BEKCI_PROD_ONAY"] as const;

/**
 * Bir bekçinin DOĞURACAĞI süreç için ortam — kaçış anahtarları SİLİNMİŞ hâlde.
 *
 * ⚠️ NEDEN VAR (1e ölçtü 2026-09-15, fabrika yedeği kopyasında prova): kaçış
 * anahtarı bir KARARdır ve karar, onu VEREN sürece aittir. `test_script_guards`
 * kendi sondası için `clean_test_residue.ts`i doğuruyordu ve `{...process.env}`
 * ile kaçışı MİRAS bırakıyordu; çocukta ad kapısı `null` döndü, yani yıkıcı
 * betiğin tek koruması sessizce açıldı. Sonda dry-run'da kaldığı için yazma
 * olmadı — ama bu bir TESADÜFTÜ, koruma değil.
 *
 * ⇒ *Bir kaçış anahtarının kapsamı, onu alan SÜREÇTİR; torunlarına geçerse
 *   kapsamı ölçülemez hâle gelir ve kapı, kimsenin açtığını bilmediği bir yerde
 *   açık kalır.*
 *
 * ⚠️ KAPININ KENDİSİ BUNU GÖREMEZ (ölçüldü): çocuk süreç, anahtarın kendisine mi
 * yoksa ebeveynine mi verildiğini AYIRT EDEMEZ — `process.env` ikisinde de aynı
 * görünür. Yani çare kapıda değil ÇAĞIRANDA; ve "her çağıran hatırlasın" bir kapı
 * olmadığı için `test_bekci_sozlesmesi §k` bunu ölçer.
 */
export function cocukOrtami(ek?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // ⚠️ SIRA LOAD-BEARING: önce MİRASTAN sil, sonra `ek`i uygula. Ters sırada,
  // kaçışı BİLEREK veren sonda (`test_script_guards §6` kaçışın kendisini ölçer)
  // da silinirdi — ve o sonda kaçışsız koşunca ölçtüğünü sandığı şeyi ölçmez.
  // ⇒ *Silinen şey MİRAS, verilen şey KARAR: ikisi aynı anahtar olsa da farklı.*
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const anahtar of KACIS_ANAHTARLARI) delete env[anahtar];
  return { ...env, ...ek };
}
