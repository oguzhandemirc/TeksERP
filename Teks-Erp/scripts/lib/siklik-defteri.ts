// =============================================================================
// SIKLIK DEFTERİ — ARALIKLI bir bekçinin sebebini ÖLÇEREK bulmak için
// =============================================================================
// Maliyet: SIFIR ekstra koşum. Zaten koşan bir bekçinin sonucundan tek satır.
//
// ⛔ KAPSAM — YEREL REJİM, TEK AĞAÇ. Bu defter YALNIZ kendi çalışma ağacında
//    koşan bekçilerin kaydını tutar. CI turları bu dosyaya YAZILMAZ (CI'ın ağacı
//    koşum bitince yok olur ve CI commit atmaz) ⇒ **CI kırmızıları defterin
//    KONUSU DEĞİLDİR**, `gh run` ile ayrıca sayılır. Her satır `rejim` ve `agac`
//    damgası taşır ki bir kayıt, üretildiği rejimin/ağacın DIŞINDA sayılamasın.
//
// =============================================================================
// ⚖️ KARAR KURALI
// =============================================================================
// Bu blok defterde TEK BİR KAYIT oluşmadan önce commit edildi (`94f59ce0`). Git
// damgası bunun kanıtıdır: kural verinin ÖNÜNDE durur. Sonra yazılan bir ölçüt,
// veriye bakıp seçilmiş demektir — ve o artık bir ölçüt değil bir GEREKÇEDİR.
//
// PENCERE .......: bir bekçi `IZLENEN`e girdiği GÜN açılır ve o satırın kendi
//   `pencereSon` tarihinde ya da `HEDEF_KAYIT` kayıtta kapanır. Pencere ALETE
//   değil İZLENEN BEKÇİYE aittir (aletin tek bir global tarihi, konusu kapanınca
//   sıradaki bekçiye BAYAT bir pencere devrederdi).
// HÜKÜM EŞİĞİ ...: **AYNI AĞAÇTA** ≥`HEDEF_KAYIT` kayıt VE ≥3 yeşil VE ≥3 kırmızı.
//   İki ağacın kayıtları TOPLANMAZ — ağaç bir ölçüm eksenidir, ve iki ağacın
//   dosyası ayrıdır (ölçüldü 2026-09-13: 10 kaydın 7'si `wt-d9`, 3'ü ortak ağaç,
//   üç ayrı DB; hiçbir dosya tek başına eşiğe varmıyordu ve kimse toplamıyordu).
//
// Sorular SABİT SIRADA sorulur; her birinin YANLIŞLAYANI önceden yazılmıştır:
//
//   ① ARTIK mı? (fatura başkasına çıkar)
//      Kırmızıların hepsi `onceki` alanında AYNI bekçiyi taşıyorsa, ya da
//      kırmızıların hepsi mod=tam & yeşillerin hepsi mod=tek ise
//      ⇒ sınıf ARTIK, ARALIKLI değil; sahibi artığı ÜRETEN bekçidir.
//      YANLIŞLAR: mod=tek bir kırmızı · ya da farklı `onceki` ile iki kırmızı.
//
//   ② ORTAM mı? (kusur DEĞİL)
//      Kırmızı/yeşil ayrımı `db` alanıyla birebir örtüşüyorsa ⇒ sınıf ORTAM.
//      YANLIŞLAR: aynı `db` ile bir yeşil ve bir kırmızı.
//
//   ③ SÜRÜKLENME mi? (aralıklı değil, bir AN'da dönmüş)
//      Tüm kırmızılar tek bir sha'dan SONRA, tüm yeşiller ÖNCESİNDE ise
//      ⇒ aralıklı değil; o sha'nın getirdiği gerçek bir değişim.
//      YANLIŞLAR: sha sırasında yeşil → kırmızı → yeşil.
//
//   ④ GERÇEKTEN ARALIKLI: ①②③ hiçbiri açıklamıyorsa — yani AYNI sha, AYNI db,
//      AYNI mod, AYNI `onceki`, AYNI ağaç ile iki kayıt AYRIŞIYORSA. Bu kelimeyi
//      hak eden TEK kanıt budur. Daha azı, ölçülmemiş bir değişkeni olan ①/②/③'tür.
//
//   ⑤ ≥`HEDEF_KAYIT` kayıt TEK YÖNLÜ ise (hepsi yeşil ya da hepsi kırmızı):
//      hüküm **"YEREL REJİMDE ÜRETİLEMEDİ"**. Satır ARALIKLI KALIR ve arama
//      REJİM eksenine taşınır (`gh run`). ⛔ Bu, "aralıklı değilmiş" DEMEK
//      DEĞİLDİR ve satırı SİLDİRMEZ: gözlenen kırmızılar defterin KAYDETMEDİĞİ
//      bir rejimde olduysa, o rejimde hiçbir şey ölçülmemiştir.
//
//   ⑥ `<HEDEF_KAYIT` kayıt: **"veri yetmedi"** — meşru bir sonuçtur, sezgiyle
//      doldurulmaz. Hüküm YAZILMAZ, satır ARALIKLI kalır.
//
// ⚠️ DEFTER BİR TEŞHİS ALETİDİR, BİR ONARIM DEĞİL. Pencere boyunca izlenen bekçi
//    DEĞİŞTİRİLMEZ; değiştirilirse pencere SIFIRLANIR. Yoksa ölçtüğün şey olay
//    değil, kendi düzeltmendir (*kontrol grubu kirli*).
//
// ⚠️ HİÇBİR KAYIT DEFTERDEN ÇIKARILMAZ — "bu koşum sayılmaz" denmez. Aletin
//    kendi sondası da bir koşumdur ve defterdeki İLK kayıt odur. Kaydı niyetine
//    göre elemek, hangi turun "gerçek" olduğuna ÇÖZÜMLEME ANINDA karar vermek
//    demektir; sonuca göre seçim tam oradan sızar. Ayrımı `db`/`mod`/`agac`
//    alanları zaten taşıyor ve ①②③④ soruları onları kullanıyor — eleme ORADA
//    yapılır, kayıt kabulünde değil.
//
// =============================================================================
// 📌 KURALIN DEĞİŞTİĞİ YER — ve neden bu bir GEREKÇE değil
// =============================================================================
// İlk kural "≥3 kırmızı" istiyordu ve bu eşik **yapısal olarak dolamazdı**:
// kırmızılar YALNIZ CI'da oluyordu, defter ise yalnız yerel ağaçta kayıt tutuyor
// (ölçüldü 2026-09-13: 10 kayıt, 10'u da yerel, 10'u da yeşil). ⇒ Kural veriden
// önce yazılmıştı ama ÖLÇÜLEMEZ bir şey soruyordu.
// Kuralı değiştirmek de bir karardır (1e hükmü, 2026-09-13, şık (b); arşivde
// gerekçesiyle). Değişikliğin post-hoc gerekçeye düşmemesinin ölçüsü şudur:
// **yeni ⑤ hiçbir yeni İZİN vermez, bir izni GERİ ALIR.** Eski ⑤ "10/10 aynı
// cevapsa satır aralıklı değildir, yeşilse SİLİNİR" diyordu — yani eldeki 10
// yeşil kaydın satırı KAPATMASINA izin veriyordu. Yeni ⑤ bunu YASAKLIYOR ve
// yerine yalnız bir yön değişikliği koyuyor. Kural NET SIKILAŞTI; veriye
// bakılarak seçilmiş bir ölçüt, tuttuğu veriyi kendi lehine kapatırdı.
//
// =============================================================================
// ⚠️ İKİ TASARIM KARARI, GEREKÇESİYLE
// =============================================================================
// **① Defter dosyası İZLENMEZ (`.gitignore`), ama satır STDOUT'a da basılır.**
// Bu ağaçta altı oturum çalışıyor; izlenen bir dosyaya her `npm test`in yazması
// herkesin `git status`unu kirletir ve commit kapısını zehirler. Stdout satırı
// CI'da da basılır ve `SIKLIK-DEFTERİ` ile grep'lenir — ama o satır bir KAYIT
// DEĞİL bir İZDİR: hiçbir yerde toplanmaz, hüküm eşiğine girmez (yukarıdaki
// kapsam cümlesi). CI'ın sayımı `gh run`ındır.
//
// **② Yazma hatası bekçiyi KIRMIZI YAPMAZ ama SESSİZ de kalmaz.** Bir teşhis
// aleti ölçtüğü şeyi düşüremez. Ama `.catch(() => {})` bir kök nedeni tam 13 kez
// sakladı (2026-09-13) — o yüzden yutulan hata BASILIR.
// =============================================================================
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * İzlenen bekçiler ve HER BİRİNİN KENDİ penceresi. Bir satır eklemek pencereyi
 * AÇAR; `acilis` o günün tarihidir. Genişletmek bir KARARDIR, kayma değil.
 *
 * BUGÜN BOŞ: tek konusu `test_fold_catalog.ts` idi ve aralıklılığı `675211b2`
 * ile açıklandı (sınırsız alt dizgi eşleşmesi, 1/10) — defterle değil TEŞHİSLE.
 * Alet dormant kalır: sıradaki ARALIKLI satır için hazır, ve boş kümede
 * `defteYaz` hiçbir şey yapmaz.
 */
export const IZLENEN = new Map<string, { acilis: string; pencereSon: string }>();

/** Hüküm için gereken kayıt sayısı (ve her yönden en az 3), TEK AĞAÇTA. */
export const HEDEF_KAYIT = 10;

const DEFTER = join(__dirname, "..", "..", "siklik-defteri.jsonl");

export interface DefterKaydi {
  /** Hangi bekçi. */
  dosya: string;
  /** `git describe`sız kısa sha + ağaç kirliyse `+`. */
  sha: string;
  /** "tam" = paket koşumu · "tek" = filtreli tek bekçi. ARTIK eksenini ayırır. */
  mod: "tam" | "tek";
  /** YALNIZ veritabanı ADI — bağlantı dizesi ve parola ASLA yazılmaz. */
  db: string;
  /** REJİM ekseni: bu satır hangi koşum rejiminde doğdu (kapsam cümlesi). */
  rejim: "yerel" | "ci";
  /** AĞAÇ ekseni: worktree adı ya da "ortak". İki ağacın kaydı TOPLANMAZ. */
  agac: string;
  sonuc: "yesil" | "kirmizi";
  ozet: string;
  /** Kırmızı yüklemin ADI — sayı bir teşhis değildir, adres gerekir. */
  ilk: string | null;
  /** Sırada HEMEN ÖNCE koşan bekçi — ARTIK ekseninin taşıyıcısı. */
  onceki: string | null;
  sira: number;
  ms: number;
  /** Altyapı arızasıyla yeniden denendi mi (koşucunun kendi bayrağı). */
  yeniden: boolean;
}

/** `DATABASE_URL`den YALNIZ veritabanı adını çıkarır (sır hijyeni). */
export function dbAdi(url: string | undefined): string {
  if (!url) return "?";
  try {
    return new URL(url).pathname.replace(/^\//, "") || "?";
  } catch {
    return "?";
  }
}

/** Koşum rejimi — CI'ın satırı bir İZ'dir, kayıt değil (kapsam cümlesi). */
export function rejimAdi(env: NodeJS.ProcessEnv = process.env): "yerel" | "ci" {
  return env.CI === "true" || env.GITHUB_ACTIONS === "true" ? "ci" : "yerel";
}

/**
 * Çalışma ağacının adı: izole worktree'de dizin adı (`wt-d9`), ortak ağaçta
 * "ortak". `git rev-parse --git-dir` izole ağaçta `.git/worktrees/<ad>` döner —
 * `hizli-mandallar.mjs`in izole-ağaç ölçütüyle aynı kaynak.
 */
export function agacAdi(cwd: string = process.cwd()): string {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { cwd, encoding: "utf8" }).trim();
    return gitDir.includes("/worktrees/") ? basename(gitDir) : "ortak";
  } catch {
    return "?";
  }
}

/**
 * Bir satır yaz. Zaten koşmuş bir bekçinin sonucundan türer — ekstra koşum YOK.
 * Kapsam dışıysa hiçbir şey yapmaz.
 */
export function defteYaz(k: DefterKaydi): void {
  const pencere = IZLENEN.get(k.dosya);
  if (!pencere) return;
  const satir = JSON.stringify({ t: new Date().toISOString(), ...k });
  // CI'da da basılır ama orada bir İZ'dir: sabit ön ek grep'lenebilsin diye.
  console.log(`📓 SIKLIK-DEFTERİ ${satir}`);
  try {
    appendFileSync(DEFTER, `${satir}\n`);
  } catch (e) {
    // Yutulur ama SESSİZ DEĞİL: teşhis aleti ölçtüğünü düşürmez, ama kendi
    // arızasını da saklamaz.
    console.log(`   ⚠️ sıklık defteri YAZILAMADI (kayıt yalnız log'da): ${(e as Error).message}`);
  }
  if (new Date().toISOString().slice(0, 10) > pencere.pencereSon) {
    console.log(
      `   ⚠️ SIKLIK DEFTERİ PENCERESİ DOLDU (${k.dosya}, ${pencere.pencereSon}) — hüküm yazılmadı.\n` +
        `      Karar kuralı: scripts/lib/siklik-defteri.ts başlığı. Kapanmayan pencere bir defter değil, bir GÜNLÜKTÜR.`,
    );
  }
}
