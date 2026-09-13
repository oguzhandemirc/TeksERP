// =============================================================================
// SIKLIK DEFTERİ — ARALIKLI bir bekçinin sebebini ÖLÇEREK bulmak için
// =============================================================================
// Kapsam: `IZLENEN` kümesi — bugün TEK dosya (`test_fold_catalog.ts`).
// Maliyet: SIFIR ekstra koşum. Zaten koşan bir bekçinin sonucundan tek satır.
//
// ⭐ NEDEN VAR: `test_fold_catalog` aynı ağaçta iki ardışık CI turunda iki farklı
//    cevap verdi (`8f68c367` → 24/1 KIRMIZI · `2e188894` → YEŞİL; arada bu
//    bekçiye ve kat kataloğuna dokunan değişiklik YOK). Sınıfı **aralıklı**,
//    sebebi **BİLİNMİYOR**. İki gözlem bir dağılım değildir.
//
// =============================================================================
// ⚖️ KARAR KURALI — SONUÇLAR GÖRÜLMEDEN YAZILDI
// =============================================================================
// Bu blok defterde TEK BİR KAYIT oluşmadan önce commit edildi. Git damgası
// bunun kanıtıdır: kural verinin ÖNÜNDE durur. Sonra yazılan bir ölçüt, veriye
// bakıp seçilmiş demektir — ve o artık bir ölçüt değil bir GEREKÇEDİR.
//
// PENCERE .......: 10 kayıt YA DA 2026-09-27 — hangisi önce dolarsa.
// HÜKÜM EŞİĞİ ...: ≥10 kayıt VE ≥3 yeşil VE ≥3 kırmızı.
//   Eşik dolmazsa HÜKÜM YAZILMAZ, satır ARALIKLI kalır. **"veri yetmedi" meşru
//   bir sonuçtur** ve sezgiyle doldurulmaz.
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
//      AYNI mod, AYNI `onceki` ile iki kayıt AYRIŞIYORSA. Bu kelimeyi hak eden
//      TEK kanıt budur. Daha azı, ölçülmemiş bir değişkeni olan ①/②/③'tür.
//
//   ⑤ 10/10 AYNI cevap ise: satır ARALIKLI DEĞİLDİR — ilk iki turun ayrışması
//      kendisi bir artefakttı. Satır o cevabın sınıfına düşer (yeşilse SİLİNİR).
//
// ⚠️ DEFTER BİR TEŞHİS ALETİDİR, BİR ONARIM DEĞİL. Pencere boyunca
//    `test_fold_catalog` DEĞİŞTİRİLMEZ; değiştirilirse pencere SIFIRLANIR.
//    Yoksa ölçtüğün şey olay değil, kendi düzeltmendir (*kontrol grubu kirli*).
//
// ⚠️ HİÇBİR KAYIT DEFTERDEN ÇIKARILMAZ — "bu koşum sayılmaz" denmez. Aletin
//    kendi sondası da bir koşumdur ve defterdeki İLK kayıt odur. Kaydı niyetine
//    göre elemek, hangi turun "gerçek" olduğuna ÇÖZÜMLEME ANINDA karar vermek
//    demektir; sonuca göre seçim tam oradan sızar. Ayrımı `db`/`mod` alanları
//    zaten taşıyor ve ①②③ soruları onları kullanıyor — eleme ORADA yapılır,
//    kayıt kabulünde değil.
//
// =============================================================================
// ⚠️ İKİ TASARIM KARARI, GEREKÇESİYLE
// =============================================================================
// **① Defter dosyası İZLENMEZ (`.gitignore`), ama satır STDOUT'a da basılır.**
// Bu ağaçta altı oturum çalışıyor; izlenen bir dosyaya her `npm test`in yazması
// herkesin `git status`unu kirletir ve commit kapısını zehirler. Ama aralıklılık
// **CI'da** gözlendi ve yalnız yerel dosya tutmak CI turlarını KAYBEDERDİ.
// Çözüm ikisi birden: yerelde satır dosyaya, her yerde satır stdout'a — CI'ın
// kendi log'u o turun kalıcı deposudur ve `SIKLIK-DEFTERİ` ile grep'lenir.
//
// **② Yazma hatası bekçiyi KIRMIZI YAPMAZ ama SESSİZ de kalmaz.** Bir teşhis
// aleti ölçtüğü şeyi düşüremez. Ama `.catch(() => {})` bu gece bir kök nedeni
// tam 13 kez sakladı — o yüzden yutulan hata BASILIR.
// =============================================================================
import { appendFileSync } from "node:fs";
import { join } from "node:path";

/** Defterin kapsamı — BİLEREK tek dosya. Genişletmek bir KARARDIR, kayma değil. */
export const IZLENEN = new Set(["test_fold_catalog.ts"]);

/** Pencerenin kapanış günü. Dolduğunda koşucu GÖRÜNÜR bir uyarı basar. */
export const PENCERE_SON = "2026-09-27";

/** Hüküm için gereken kayıt sayısı (ve her yönden en az 3). */
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

/**
 * Bir satır yaz. Zaten koşmuş bir bekçinin sonucundan türer — ekstra koşum YOK.
 * Kapsam dışıysa hiçbir şey yapmaz.
 */
export function defteYaz(k: DefterKaydi): void {
  if (!IZLENEN.has(k.dosya)) return;
  const satir = JSON.stringify({ t: new Date().toISOString(), ...k });
  // CI'ın log'u bu turun kalıcı deposu — grep'lenebilir sabit ön ek.
  console.log(`📓 SIKLIK-DEFTERİ ${satir}`);
  try {
    appendFileSync(DEFTER, `${satir}\n`);
  } catch (e) {
    // Yutulur ama SESSİZ DEĞİL: teşhis aleti ölçtüğünü düşürmez, ama kendi
    // arızasını da saklamaz.
    console.log(`   ⚠️ sıklık defteri YAZILAMADI (kayıt yalnız log'da): ${(e as Error).message}`);
  }
  if (new Date().toISOString().slice(0, 10) > PENCERE_SON) {
    console.log(
      `   ⚠️ SIKLIK DEFTERİ PENCERESİ DOLDU (${PENCERE_SON}) — hüküm yazılmadı.\n` +
        `      Karar kuralı: scripts/lib/siklik-defteri.ts başlığı. Kapanmayan pencere bir defter değil, bir GÜNLÜKTÜR.`,
    );
  }
}
