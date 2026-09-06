// =============================================================================
// YIKICI BETİK KAPISI (BULGU-T1-019)
// =============================================================================
// `reset-operational.ts` 30+ tabloyu tek `TRUNCATE … CASCADE` ile siliyordu ve
// TEK koruması bir YORUM SATIRIYDI ("!! GERİ ALINAMAZ — önce yedek al"). Yorum
// bir kapı değildir.
//
// ⚠️ "SAHADA ÇALIŞTIRILAMAZ" TAM BİR SAVUNMA DEĞİLDİR. Doğrudur — `paketle.ps1`
// `scripts/` klasörünü pakete HİÇ koymuyor ve `npm ci --omit=dev` `tsx`'i de
// dışarıda bırakıyor. Ama tehlike sunucuda değil GELİŞTİRİCİ MAKİNESİNDE:
//   • `.env`'inde prod/uzak `DATABASE_URL` taşıyan biri,
//   • ya da dev DB'nin KENDİSİ (bu projede dev DB, prod'un kopyasıdır ve
//     paylaşımlıdır — silmek başkalarının işini de yok eder),
//   • ya da `kur.ps1` ilk geçişte sunucuda bırakılan git kabuğu.
// Kapı bu üçünü birden kapatır ve maliyeti bir satırdır.
//
// TASARIM: FAIL-CLOSED, İZİN LİSTESİ.
// "Prod'u tanı ve reddet" (kara liste) yanlış yöndür — yarın açılan yeni bir
// ortamın adını bilemeyiz ve kara liste onu SESSİZCE geçirir. Burada tersi:
// tanınmayan her hedef reddedilir. Yanlış tarafa düşmenin bedeli "script
// koşmadı" (dakikalar), diğer tarafın bedeli "fabrikanın verisi gitti".
// =============================================================================

/**
 * Adı BİREBİR bu olan veritabanı geliştirme hedefi sayılır.
 * ⚠️ BOŞ BIRAKILDI ve öyle kalmalı: DB adı bir PROFİL değeridir, koda sabitlenmez
 * (kök CLAUDE.md). Hedef, ADIN SON EKİNDEN tanınır.
 */
const IZINLI_DB_ADLARI = new Set<string>([]);
/**
 * Bu son eklerle biten adlar geliştirme/test hedefi sayılır.
 * `_demo` 2026-09-05'te eklendi: geliştirme DB'si `adnansahin_db` → `tekserp_demo`
 * olarak yeniden adlandırıldığında bu liste güncellenmemişti; `adnansahin_db` ise
 * `lib/hedef-db-kapisi.ts`te artık ÜRETİM adı sayıldığı için buradan kaldırıldı
 * (iki kapı aynı adı zıt sınıflandırıyordu).
 */
const IZINLI_SON_EKLER = ["_dev", "_test", "_local", "_demo"];
/** Yalnız bu makinedeki PostgreSQL. Uzak host = üretim varsayılır. */
const IZINLI_HOSTLAR = new Set(["localhost", "127.0.0.1", "::1", ""]);

export interface KapiSonucu {
  /** Ayrıştırılmış hedef — mesajlarda gösterilir. */
  host: string;
  db: string;
  /** `--apply` verildi mi (kuru koşum ayrımı). */
  apply: boolean;
}

function hedefiCoz(): { host: string; db: string } {
  const ham = process.env.DATABASE_URL ?? "";
  if (!ham) throw new Error("DATABASE_URL tanımsız");
  // `new URL` postgres:// şemasını ayrıştırır; parola/parametre önemsiz.
  const u = new URL(ham);
  return { host: u.hostname, db: decodeURIComponent(u.pathname.replace(/^\//, "")) };
}

/**
 * Yıkıcı bir betiğin İLK ifadesi olarak çağrılır. Hedef geliştirme veritabanı
 * değilse SÜRECİ DÜŞÜRÜR (throw değil `process.exit(1)` — çağıranın bir
 * `catch`'i yanlışlıkla yutmasın).
 *
 * @param betik  hata mesajında görünecek ad
 * @param opts.applyGerekli  true ise `--apply` olmadan yalnız hedefi basıp çıkar
 */
export function assertGelistirmeVeritabani(
  betik: string,
  opts: { applyGerekli?: boolean } = {},
): KapiSonucu {
  const apply = process.argv.includes("--apply");
  let hedef: { host: string; db: string };
  try {
    hedef = hedefiCoz();
  } catch (e) {
    console.error(`\n⛔ ${betik} DURDURULDU — ${(e as Error).message}\n`);
    process.exit(1);
  }

  const { host, db } = hedef;
  const hostOk = IZINLI_HOSTLAR.has(host);
  const dbOk = IZINLI_DB_ADLARI.has(db) || IZINLI_SON_EKLER.some((s) => db.endsWith(s));
  const prodOrtam = process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";

  if (!hostOk || !dbOk || prodOrtam) {
    console.error(`\n⛔ ${betik} DURDURULDU — hedef bir GELİŞTİRME veritabanı değil.\n`);
    console.error(`   host : ${host || "(soket)"}${hostOk ? "" : "   ← UZAK HOST"}`);
    console.error(`   db   : ${db}${dbOk ? "" : "   ← TANINMAYAN AD"}`);
    if (prodOrtam) console.error(`   ortam: production   ← NODE_ENV/APP_ENV`);
    console.error(
      `\n   Bu betik geri alınamaz veri kaybı yapar. İzinli hedefler: ` +
        `${IZINLI_SON_EKLER.join("/")} ile biten adlar` +
        `${IZINLI_DB_ADLARI.size ? ` ya da ${[...IZINLI_DB_ADLARI].join(", ")}` : ""},\n` +
        `   yalnız yerel PostgreSQL üzerinde.\n`,
    );
    console.error(
      `   ⚠️ Fabrikanın verisini gerçekten sıfırlamak istiyorsanız bu kapıyı ATLAMAYIN —\n` +
        `      önce yedek alın, sonra kapının izin listesini bilinçli olarak genişletin.\n`,
    );
    process.exit(1);
  }

  console.log(`\n🔓 Hedef doğrulandı: ${db} @ ${host || "yerel soket"}`);
  if (opts.applyGerekli && !apply) {
    console.log(`   KURU KOŞUM — hiçbir şey silinmedi. Uygulamak için: --apply\n`);
  }
  return { host, db, apply };
}
