// =============================================================================
// BEKÇİ — YIKICI BETİKLER KAPIDAN GEÇİYOR MU (BULGU-T1-019)
// Çalıştır: npx tsx scripts/test_script_guards.ts
// =============================================================================
// `reset-operational.ts` 30+ tabloyu tek `TRUNCATE … CASCADE` ile siliyordu ve
// TEK koruması bir YORUM SATIRIYDI. Yorum bir kapı değildir; bu dosya kapının
// varlığını MEKANİK olarak zorunlu kılar.
//
// ⚠️ TEHLİKE SUNUCUDA DEĞİL GELİŞTİRİCİ MAKİNESİNDE: `paketle.ps1` `scripts/`
// klasörünü pakete koymuyor ve `npm ci --omit=dev` `tsx`'i de dışarıda
// bırakıyor — yani fabrika sunucusunda bu betikler koşturulamaz. Ama `.env`'inde
// prod `DATABASE_URL` taşıyan bir geliştirici, ya da paylaşımlı dev DB'nin
// kendisi (bu projede dev DB PROD'UN KOPYASIDIR) hâlâ açık hedeflerdir.
//
// İKİ YÖNLÜ:
//   §1 kapısız yıkıcı betik YOK          (yeni bir tanesi eklenirse kırmızı)
//   §2 ölü muaf YOK                      (muaf edilen dosya artık yıkıcı değilse kırmızı)
//   §3 muaf listesinde hayalet dosya YOK (yeniden adlandırma sonrası bayat girdi)
//   §4 kapı GERÇEKTEN reddediyor         (varlık ≠ işlev; uzak/prod hedefle ölçülür)
//   §6 paket hedefi fixture ADI taşıyor  (fabrika adı durur, fixture adı geçer)
//   §7 hedefin HACMİ fabrika ölçeğinde değil (ad kalıbı yanılabilir, sayı yanılmaz)
//   §8 silen temizlik yolları da aynı kapıdan geçiyor (`--apply` olmadan bile)
// =============================================================================
import { readFileSync } from "fs";
import { join, relative } from "path";
import { execFileSync, spawnSync } from "child_process";
import { walkTs } from "./lib/ts-tarama";
import { FABRIKA_HACIM_ESIGI, hacimEngeliMetni } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * "Yıkıcı" sayılan izler. DAR tutuldu: `deleteMany` BİLEREK yok — testlerin
 * kendi fixture'ını temizlemesi meşrudur ve onu işaretlemek 200+ dosyayı
 * kırmızıya çevirip bekçiyi ilk gün devre dışı bıraktırırdı (bu repoda
 * `FIXTURE_PREFIXES` notunun anlattığı hata).
 */
const YIKICI_IZLER = [
  { iz: "TRUNCATE", ne: "tablo boşaltma" },
  { iz: "INSERT INTO system_logs", ne: "sentetik audit satırı" },
];

/** Yorumları (blok + satır) atar; kalan yalnız koddur. */
function kodSatirlari(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Kapı çağrısının imzası. */
const KAPI = "assertGelistirmeVeritabani(";

/** `$executeRaw` / `$executeRawUnsafe` çağrısı — argümanı TEK düz literal ise yakalar. */
const RAW_TEK_LITERAL =
  /\$executeRaw(?:Unsafe)?(?:<[^>]*>)?\s*\(\s*(`[^`]*`|"[^"]*"|'[^']*')\s*\)/g;
/** Her `$executeRaw*` geçişi (argüman biçimi ne olursa olsun). */
const RAW_HERHANGI = /\$executeRaw(?:Unsafe)?\s*[(`<]/g;
/**
 * SADECE `ALTER TABLE x VALIDATE CONSTRAINT y` — BAŞTAN SONA, başka ifade yok.
 * Tablo/kısıt adı yerine tek bir `${sabit}` yer tutucusu kabul edilir (gerçek
 * kullanım kısıt adını sabitten geçiriyor); yer tutucunun İÇİ düz tanımlayıcı
 * olmak zorunda — `${"; DROP …"}` bu kalıba UYMAZ.
 */
const YALNIZ_VALIDATE =
  /^\s*ALTER\s+TABLE\s+(?:[\w".]+|\$\{[\w.]+\})\s+VALIDATE\s+CONSTRAINT\s+(?:[\w".]+|\$\{[\w.]+\})\s*;?\s*$/i;

/**
 * "Bu betik Prisma ile YIKIYOR mu?" — API ADINA değil ETKİYE bakar.
 *
 * `ALTER TABLE … VALIDATE CONSTRAINT` hiçbir şey yıkmaz: mevcut satırları tarar ve
 * kısıtı işaretler; satır silmez, değiştirmez. Prisma'nın tipli API'si olmadığı için
 * `$executeRawUnsafe` ile yazılır ve eski desen (`/\$executeRaw/`) onu yıkıcı
 * SAYIYORDU — yanlış pozitif (ölçüldü 2026-09-12: tavan 42→43'e çıktı ve bir
 * sürüm engeli commit'ini tuttu).
 *
 * ⚠️ YÜKLEM BİLEREK DAR: muafiyet yalnız argümanı TEK düz literal olan ve o
 * literalin BAŞTAN SONA yalnız bir VALIDATE ifadesi olduğu çağrıya tanınır.
 * `$executeRawUnsafe(\`DELETE …; -- VALIDATE CONSTRAINT\`)` bu kalıba UYMAZ ve
 * yıkıcı sayılmaya devam eder.
 * ⚠️ KAÇIRDIĞI (beyan, fail-closed yönde): VALIDATE'i bir DEĞİŞKENDEN geçiren ya
 * da tek çağrıda birden çok ifade gönderen betik hâlâ YIKICI sayılır. Yanlış
 * tarafa düşmenin bedeli "kapı ekle" (dakikalar), diğer tarafınki veri kaybıdır.
 */
function prismaYikiciMi(kod: string): boolean {
  if (/\.deleteMany\(/.test(kod)) return true;
  const rawSayisi = (kod.match(RAW_HERHANGI) ?? []).length;
  if (rawSayisi === 0) return false;
  const zararsiz = [...kod.matchAll(RAW_TEK_LITERAL)].filter((m) => {
    const sql = m[1]!.slice(1, -1);
    if (!YALNIZ_VALIDATE.test(sql)) return false;
    // Yer tutucu varsa DEĞERİ de ölçülür: aynı dosyada düz bir string sabiti
    // olarak tanımlanmış ve tanımlayıcıdan ibaret olmalı. Aksi hâlde muafiyet
    // YOK — `const K = "x; DROP TABLE …"` ile kapıdan kaçılamaz.
    return [...sql.matchAll(/\$\{([\w.]+)\}/g)].every(([, ad]) => {
      const tanim = new RegExp(`\\bconst\\s+${ad}\\s*(?::[^=]+)?=\\s*(\`[^\`]*\`|"[^"]*"|'[^']*')`).exec(kod);
      return tanim !== null && /^[\w".]+$/.test(tanim[1]!.slice(1, -1));
    });
  }).length;
  return rawSayisi > zararsiz;
}

/**
 * Gerekçeli muaflar. ⚠️ Muaf, "bu dosya yıkıcı DEĞİL" demektir — "yıkıcı ama
 * geçsin" demek değildir. Bayatlığa karşı §2/§3 ile iki yönlü denetlenir.
 */
/**
 * Kapı taşıması BEKLENEN test dosyaları (BULGU-T1-018).
 * ⚠️ Genel kural "test_* kapsam dışı"dır (kendi fixture'ını yaratır, bayatlayacak
 * bir şey yoktur). İSTİSNA: gerçek veriye yazma riski TAŞIMIŞ ve bu yüzden
 * ortam kapısı eklenmiş dosyalar. Liste küçülmez — bir dosya kapısını
 * kaybederse §5 kırmızı verir.
 */
const KAPI_ZORUNLU_TESTLER = ["test_manual_move_fason_receive.ts"];

/**
 * KENDİ HEDEFİNİ KURAN ama kapı çağırmayan betik TAVANI (§10).
 * Ölçüldü 2026-09-12: özyinelemeli taramada beş dosya kendi hedefini kuruyor,
 * dördü gerekçeli muaf, geriye `audit_repro_E-2-00-probe.ts` kalıyor.
 * ⚠️ Tavan yalnız DÜŞER — yeni bir kapısız betik eklenirse bu bekçi kırmızı verir.
 */
const HEDEF_KURAN_TAVAN = 1;

/**
 * `--apply` alıp hedefini BEYAN ETMEYEN betik TAVANI (§11).
 *
 * Ölçüm günlüğü (hepsi 2026-09-12): kural konduğunda 24 betiğin 21'i hedefi
 * basmıyordu → tavan 21. `apply-migration` beyan etmeye başladı (bölünmüş yazma
 * vakası) → 20. Günün son inişinden sonra (main `27e785ce`) yeniden ölçüldü:
 * **26 betik `--apply` alıyor, 18'i beyan etmiyor** → tavan 18. Yani taban
 * BÜYÜRKEN borç küçüldü: ratchet yalnız borcu dondurmuyor, davranışı da çekiyor.
 * Kalanlar: `setup-ticaret` + backfill/fix/repair ailesi (başkalarının dosyaları).
 *
 * ⚠️ Tavan yalnız DÜŞER — devralınan borç dondurulur, yeni borç kırmızı verir.
 */
const APPLY_BEYANSIZ_TAVAN = 18;

const MUAFLAR: Record<string, string> = {
  "test_db_invariants.ts":
    "TRUNCATE bir STRING SABİTİNDE geçiyor (trigger tanımı: 'BEFORE DELETE OR UPDATE OR TRUNCATE') — yorum ayıklaması bunu elemez, çalıştırılan bir ifade de değil",
  "test_audit_depth.ts":
    "TRUNCATE bilerek koşuluyor ama GERİ ALINAN bir tx içinde: audit guard'ının onu reddettiğini ölçüyor",
  "test_script_guards.ts": "bu dosyanın kendisi — izleri sabit olarak taşır",
};

function main(): void {
  const dizin = join(__dirname);
  // ⚠️ ÖZYİNELEMELİ (2026-09-12): eskiden yalnız `scripts/` KÖKÜ taranıyordu ve
  // `scripts/lib/` altı hiçbir bölüme girmiyordu — kapının KENDİ dosyası bile
  // denetim dışıydı. Tarama derinliği bekçinin kapsamını sessizce belirler; tek
  // kaynak `lib/ts-tarama.ts`.
  // ⚠️ YALNIZ İZLENEN DOSYALAR (2026-09-13). Bu bölümlerin tavanları birer
  // MANDALDIR (yalnız düşer). Takipsiz taslaklar — başka bir oturumun
  // `.gitignore`lu scratch dizini gibi — tavanı GEÇİCİ olarak şişirir; şişme
  // mandala KALICI yazılırsa taslaklar silindiğinde tavan bir daha düşürülemez
  // ve "neden 50" sorusunun cevabı kaybolur. Ölçüm (2026-09-13): `scripts/out/`
  // 8 dosya, 8'i de yıkıcı desen taşıyor ⇒ §6b 42 → 50, §11b 18 → 19.
  //
  // ⚠️ `.gitignore` bir dosyayı GİT'ten gizler, bu bekçiden gizlemez — dosya
  // diskte durduğu sürece `walkTs` onu görür. Filtre GİT'e sorar.
  //
  // ⚠️ GEVŞETME DEĞİL: CI checkout'unda hiçbir şey takipsiz değildir ⇒ CI'da
  // SIFIR fark. Commit edilmiş kapısız bir betik sayılmaya DEVAM eder; takipsiz
  // bir `test_*.ts` ise `check-migrations.mjs` GATE 4'ün konusudur.
  //
  // Git okunamazsa TÜM dosyalara düşülür — hata yönü GENİŞ tarafa.
  const izlenen = (() => {
    try {
      return new Set(
        execFileSync("git", ["ls-files", "-z", "--", "."], { cwd: dizin, encoding: "utf8" })
          .split("\0")
          .filter(Boolean),
      );
    } catch {
      return null;
    }
  })();
  const hepsi = walkTs(dizin).map((p) => relative(dizin, p));
  const dosyalar = izlenen ? hepsi.filter((f) => izlenen.has(f)) : hepsi;
  if (izlenen && hepsi.length !== dosyalar.length) {
    console.log(
      `   ℹ️ ${hepsi.length - dosyalar.length} takipsiz dosya sayımın DIŞINDA ` +
        `(tavan bir mandaldır; taslak onu kalıcı şişiremez)`,
    );
  }

  // KÖRLÜK ZEMİNİ: tarama boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı"
  // aynı yeşile çıkar.
  check("§0: scripts/ tarandı (körlük zemini)", dosyalar.length > 100, `${dosyalar.length} dosya`);

  const yikicilar: string[] = [];
  const kapisizlar: string[] = [];
  for (const f of dosyalar) {
    const src = readFileSync(join(dizin, f), "utf8");
    // ⚠️ YORUMLAR AYIKLANIR. Bu bekçinin ilk yazımında `db-guard.ts` "yıkıcı"
    // sayılıyordu — çünkü KENDİ AÇIKLAMA METNİNDE "TRUNCATE … CASCADE" geçiyor.
    // Doğru sebeple değil, tesadüfen geçiyordu (kapı imzasını tanımladığı için).
    // "Kodu değil yorumu eşlemek" bu denetim turunda iki kez ısırdı; burada
    // baştan kapatılıyor.
    const kod = kodSatirlari(src);
    const bulunan = YIKICI_IZLER.filter((y) => kod.includes(y.iz));
    if (bulunan.length === 0) continue;
    yikicilar.push(f);
    if (f in MUAFLAR) continue;
    if (!kod.includes(KAPI)) kapisizlar.push(`${f} (${bulunan.map((b) => b.ne).join("+")})`);
  }

  check("§0: yıkıcı iz taşıyan dosya bulundu (körlük zemini)", yikicilar.length >= 3, yikicilar.join(", "));

  // ═══ §1 — kapısız yıkıcı betik yok ═══
  check(
    "§1: yıkıcı yazma yapan HER betik kapıdan geçiyor",
    kapisizlar.length === 0,
    kapisizlar.join(" | ") || "hepsi kapılı ya da gerekçeli muaf",
  );

  // ═══ §2/§3 — muaf listesi bayat değil ═══
  const oluMuaf = Object.keys(MUAFLAR).filter(
    (f) => f !== "test_script_guards.ts" && !yikicilar.includes(f),
  );
  check("§2: ölü muaf yok", oluMuaf.length === 0, oluMuaf.join(", ") || "muaf listesi güncel");
  const hayalet = Object.keys(MUAFLAR).filter((f) => !dosyalar.includes(f));
  check("§3: muaf listesinde hayalet dosya yok", hayalet.length === 0, hayalet.join(", ") || "hepsi mevcut");

  // ═══ §6 — PRISMA İLE SİLEN BETİKLER: KAPISIZ SAYISI YALNIZ DÜŞER ═══
  // NEDEN AYRI BÖLÜM: §1 yıkıcılığı HAM SQL izinden ölçüyor (`TRUNCATE`,
  // `INSERT INTO system_logs`). Ama bu repoda silme çoğunlukla Prisma
  // `deleteMany` ile yapılıyor ve o izler §1'in radarına HİÇ girmiyordu —
  // `clean_test_residue.ts` 15 modelden satır siliyordu ve kapısız olduğu
  // 2026-09-06'ya kadar fark edilmedi.
  //
  // ⚠️ NEDEN TAVAN, NEDEN "HEPSİ KAPILI OLSUN" DEĞİL: ölçüm 2026-09-06 —
  // test olmayan 44 betikten YALNIZ 2'sinde kapı var. Kalan 42'yi bir gecede
  // kapılamak gerçekçi değil; hepsini birden kırmızı yapmak da bu bekçiyi ilk
  // gün devre dışı bıraktırırdı (dosyanın kendi başlığındaki uyarı). Bu yüzden
  // lint tavanı deseni: bugünkü sayı DONDURULUR ve yalnız DÜŞER. Yeni yazılan
  // kapısız betik hemen kırmızı verir.
  //
  // ⚠️ `test_*` ve `fixture-*` KAPSAM DIŞI ve bu bilinçli: bekçi kendi
  // fixture'ını yaratıp siler, hedefi zaten koşucunun üretim-DB kapısıyla
  // korunur (`run-all-tests.ts`). Tek istisna `KAPI_ZORUNLU_TESTLER`.
  /** ÖLÇÜLDÜ 2026-09-06: 44 yıkıcı betiğin 42'sinde kapı yok. Yalnız DÜŞER. */
  const KAPISIZ_TAVAN = 42;
  const prismaYikicilar: string[] = [];
  const prismaKapisizlar: string[] = [];
  for (const f of dosyalar) {
    if (f.startsWith("test_") || f.startsWith("fixture-")) continue;
    const kod = kodSatirlari(readFileSync(join(dizin, f), "utf8"));
    if (!prismaYikiciMi(kod)) continue;
    prismaYikicilar.push(f);
    if (!kod.includes(KAPI)) prismaKapisizlar.push(f);
  }
  check(
    "§6a körlük zemini: Prisma ile silen betik bulundu",
    prismaYikicilar.length >= 10,
    `${prismaYikicilar.length} betik`,
  );
  check(
    `§6b ⭐ kapısız Prisma-yıkıcı betik sayısı TAVANI (${KAPISIZ_TAVAN}) aşmadı — tavan yalnız DÜŞER`,
    prismaKapisizlar.length <= KAPISIZ_TAVAN,
    `${prismaKapisizlar.length} kapısız / ${prismaYikicilar.length} yıkıcı`,
  );
  if (prismaKapisizlar.length < KAPISIZ_TAVAN) {
    console.log(
      `\nℹ️  TAVAN DÜŞÜRÜLEBİLİR: ${prismaKapisizlar.length} ölçüldü, dosyadaki tavan ${KAPISIZ_TAVAN}.` +
        `\n   \`KAPISIZ_TAVAN = ${prismaKapisizlar.length}\` yaz ve hangi betiğe kapı eklediğini commit'e geç.`,
    );
  }

  // ═══ §5 — ortam kapısı eklenmiş testler onu KAYBETMEMELİ ═══
  const kapisizTest = KAPI_ZORUNLU_TESTLER.filter((f) => {
    const yol = join(dizin, f);
    if (!dosyalar.includes(f)) return true; // dosya kayboldu → liste bayat
    // ⚠️ YORUM AYIKLANIR (§1 ile aynı disiplin): ham metinde arasaydık, YORUM
    // SATIRINA ALINMIŞ bir kapı çağrısı bu kontrolü yeşil bırakırdı — kapının
    // varlığını değil metnin varlığını ölçmüş olurduk.
    return !kodSatirlari(readFileSync(yol, "utf8")).includes(KAPI);
  });
  check(
    "§5: ortam kapısı eklenmiş testler kapıyı KORUYOR",
    kapisizTest.length === 0,
    kapisizTest.join(", ") || KAPI_ZORUNLU_TESTLER.join(", "),
  );

  // ═══ §4 — kapı VAR olmakla REDDETMEK ayrı iddialardır ═══
  // Uzak host + tanınmayan DB adıyla gerçekten çalıştırılır; betik veriye
  // dokunmadan ÖNCE düşmeli. (Hedef makine yok — bağlantı bile kurulmamalı.)
  const r = spawnSync("npx", ["tsx", join(dizin, "reset-operational.ts"), "--apply"], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "postgresql://u:p@10.255.255.1:5432/tekserp" },
    timeout: 60_000,
  });
  const cikti = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // ⚠️ ÇIKIŞ KODU TEK BAŞINA ZAYIF SİNYALDİR — ölçüldü (negatif sonda,
  // 2026-08-31): kapı tamamen SİLİNDİĞİNDE de exit 1 geliyor, çünkü betik bu kez
  // ulaşılamayan hosta BAĞLANMAYA çalışıp düşüyor. Yani bu kontrol "durdu" der
  // ama "kapı durdurdu" DEMEZ. Asıl yükü aşağıdaki mesaj kontrolü taşır; onu
  // "zaten exit 1 var" diye ELEME.
  check("§4: uzak/prod hedefte betik DURDURULDU (exit 1)", r.status === 1, `exit ${r.status}`);
  check(
    "§4: sebep açıkça yazılıyor (operatör neden durduğunu görüyor)",
    cikti.includes("GELİŞTİRME veritabanı değil"),
    cikti.split("\n").find((l) => l.includes("DURDURULDU"))?.trim().slice(0, 70) ?? "(mesaj yok)",
  );
  check(
    "§4: silme HİÇ denenmedi (TRUNCATE çıktıda yok)",
    !cikti.includes("siliniyor"),
    "kapı yazmadan önce düştü",
  );

  // ═══ §6 — PAKET HEDEFİ FİXTURE DB OLMALI (2026-09-12) ═══
  // Ortak ağaçtaki `.env` fabrikanın canlı YEDEĞİNİ gösteriyor ve o da
  // localhost'ta: host kapısı bunu göremez. Kapı ADA bakar. İki yön de ölçülür —
  // fabrika adı DURMALI, fixture adı GEÇMELİ (yalnız "durur" ölçmek, her şeyi
  // durduran bozuk bir kapıyı da yeşil gösterirdi).
  const kosucu = join(dizin, "run-all-tests.ts");
  const kos = (db: string, url?: string) =>
    spawnSync("npx", ["tsx", kosucu, "__eslesmeyen_ad__"], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: url ?? `postgresql://u:p@localhost:55433/${db}` },
      timeout: 120_000,
    });
  const fabrika = kos("tekserp_fabrika_dev");
  const fabrikaCikti = `${fabrika.stdout ?? ""}${fabrika.stderr ?? ""}`;
  check("§6: fabrika yedeği adıyla paket DURDURULDU (exit 1)", fabrika.status === 1, `exit ${fabrika.status}`);
  check(
    "§6: gerekçe yapılabilir (fixture kalıbı + DATABASE_URL örneği)",
    fabrikaCikti.includes("fixture kalıbına uymuyor") && fabrikaCikti.includes("_test"),
    fabrikaCikti.split("\n").find((l) => l.includes("fixture kalıbına"))?.trim().slice(0, 80) ?? "(mesaj yok)",
  );
  check(
    "§6: hedef adı log'a basılıyor (operatör neyi vurduğunu görür)",
    fabrikaCikti.includes("tekserp_fabrika_dev"),
    "ad çıktıda",
  );
  // CI'nın veritabanı `teks_ci` — fixture son ekini TAŞIMAZ ve kabul kümesinde
  // ADIYLA durur. Bu sonda olmadan ad ayağı CI'yı ilk ifadede düşürürdü (491
  // bekçinin hiçbiri koşmazdı) ve kimse fark etmezdi: kapı "çalışıyor" görünür.
  // Eski kaçış YENİ ayağı kapatmasın: `ALLOW_NONLOCAL_TEST_DB` "yerel değil"
  // iddiasını gevşetir, "fixture değil" iddiasını DEĞİL. Ad ayağı bir dalın
  // içine yazılırsa bu anahtar onu sessizce atlatırdı (ölçüldü, düzeltildi).
  const uzakKacis = spawnSync("npx", ["tsx", kosucu, "__eslesmeyen_ad__"], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://u:p@192.168.1.250:5432/tekserp",
      ALLOW_NONLOCAL_TEST_DB: "1",
    },
    timeout: 120_000,
  });
  const uzakKacisCikti = `${uzakKacis.stdout ?? ""}${uzakKacis.stderr ?? ""}`;
  check(
    "§6 ⭐ ALLOW_NONLOCAL_TEST_DB ad ayağını ATLATMIYOR (uzak + fixture olmayan ad → DUR)",
    uzakKacis.status === 1 && uzakKacisCikti.includes("fixture kalıbına uymuyor"),
    `exit ${uzakKacis.status}`,
  );

  const ci = kos("teks_ci");
  const ciCikti = `${ci.stdout ?? ""}${ci.stderr ?? ""}`;
  check(
    "§6 ⭐ CI veritabanı adı (teks_ci) kapıdan GEÇİYOR",
    !ciCikti.includes("fixture kalıbına uymuyor"),
    ciCikti.split("\n").find((l) => l.includes("Hedef DB"))?.trim().slice(0, 60) ?? "(satır yok)",
  );

  // §6c ⭐ TEK KAYNAK — iki kapı da "bilinen güvenli ad" kümesini AYNI dosyadan
  // okumalı. `teks_ci` yalnız fixture kapısına eklendiği için CI'da
  // `test_manual_move_fason_receive` her koşumda "TANINMAYAN AD" ile düştü
  // (ölçüldü 2026-09-12, CI-biçimli koşum). Elle kopya yeniden doğarsa burası kırmızı.
  // ⚠️ SON EK listeleri KASTEN ayrıdır (fixture kapısı `_dev`/`_demo`yu reddeder);
  //    bu kontrol yalnız AD kümesini bağlar, son ekleri DEĞİL.
  const ORTAK_KAYNAK = "bilinen-guvenli-db";
  for (const [ad, yol] of [
    ["db-guard.ts", join(__dirname, "db-guard.ts")],
    ["lib/hedef-db-kapisi.ts", join(__dirname, "lib/hedef-db-kapisi.ts")],
  ] as const) {
    const kaynak = readFileSync(yol, "utf8");
    const kodSatirlari = kaynak
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"));
    const importEdiyor = kodSatirlari.some((l) => l.includes(ORTAK_KAYNAK));
    const elleAdYaziyor = kodSatirlari.some((l) => /new Set[^)]*["']teks_ci["']/.test(l));
    check(
      `§6c ⭐ ${ad} "bilinen güvenli ad" kümesini ORTAK kaynaktan okuyor`,
      importEdiyor && !elleAdYaziyor,
      importEdiyor
        ? elleAdYaziyor
          ? "ortak kaynağı import ediyor AMA elle de ad yazıyor — ikinci kopya"
          : `import: ${ORTAK_KAYNAK}`
        : `ortak kaynak import EDİLMEMİŞ — kabul kümesi yine ayrışır`,
    );
  }

  const fixture = kos("tekserp_kapi_sondasi_test");
  const fixtureCikti = `${fixture.stdout ?? ""}${fixture.stderr ?? ""}`;
  check(
    "§6: fixture adıyla kapı GEÇİYOR (kapı her şeyi durdurmuyor)",
    fixtureCikti.includes("Hedef DB: tekserp_kapi_sondasi_test") && !fixtureCikti.includes("fixture kalıbına uymuyor"),
    fixtureCikti.split("\n").find((l) => l.includes("Hedef DB"))?.trim().slice(0, 70) ?? "(satır yok)",
  );

  // ═══ §7 — HACİM AYAĞI: ad kalıbı yanılabilir, veri hacmi yanılmaz ═══
  // Fabrikanın `..._test` adlı yeni bir kopyası ad kapısından GEÇER. İkinci sed
  // top sayısıdır. Yüklem saf tutuldu ki bekçi DB'siz iki yönü de ölçebilsin.
  check(
    "§7: temiz fixture hacmi GEÇİYOR (28 top)",
    hacimEngeliMetni("tekserp_kapi_sondasi_test", 28) === null,
    `eşik ${FABRIKA_HACIM_ESIGI}`,
  );
  check(
    "§7: eşiğin tam üstü DURDURULUYOR",
    (hacimEngeliMetni("tekserp_kapi_sondasi_test", FABRIKA_HACIM_ESIGI + 1) ?? "").includes("FABRİKA ÖLÇEĞİNDE"),
    `${FABRIKA_HACIM_ESIGI + 1} top`,
  );
  check(
    "§7: eşiğin tam kendisi GEÇİYOR (sınır kapalı değil)",
    hacimEngeliMetni("x_test", FABRIKA_HACIM_ESIGI) === null,
    `${FABRIKA_HACIM_ESIGI} top`,
  );
  check(
    "§7 ⭐ koşucu hacim kapısını GERÇEKTEN çağırıyor (yüklem var ≠ kapı var)",
    readFileSync(kosucu, "utf8").includes("await hacimGeciti()"),
    "run-all-tests.ts",
  );
  // Ölçüm DÜŞERSE de durmalı: fabrikanın `..._test` adlı kopyası ad ayağından
  // geçer ve hacim tek gerçek korumadır — açık kalırsa tam ihtiyaç anında açılır.
  const olcumSondasi = kos("tekserp_kapi_sondasi_test", "postgresql://u:p@127.0.0.1:1/tekserp_kapi_sondasi_test");
  const olcumCikti = `${olcumSondasi.stdout ?? ""}${olcumSondasi.stderr ?? ""}`;
  check(
    "§7 ⭐ hacim ÖLÇÜLEMEDİĞİNDE de DURUYOR (fail-closed)",
    olcumSondasi.status === 1 && olcumCikti.includes("hacmi ÖLÇÜLEMEDİ"),
    `exit ${olcumSondasi.status}`,
  );
  const olcumOnay = spawnSync("npx", ["tsx", kosucu, "__eslesmeyen_ad__"], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://u:p@127.0.0.1:1/tekserp_kapi_sondasi_test",
      BEKCI_HEDEF_ONAY: "1",
    },
    timeout: 120_000,
  });
  const olcumOnayCikti = `${olcumOnay.stdout ?? ""}${olcumOnay.stderr ?? ""}`;
  check(
    "§7: onay anahtarıyla ölçülemeyen hedef GEÇİYOR ve not basılıyor",
    !olcumOnayCikti.includes("hedef doğrulanamadı") && olcumOnayCikti.includes("BEKCI_HEDEF_ONAY=1 ile geçildi"),
    "BEKCI_HEDEF_ONAY=1",
  );

  // ═══ §8 — SİLME YOLLARI: --apply OLMADAN da fixture olmayan hedefte durur ═══
  // 07:19 vakası: fixture'lar fabrikanın canlı yedeğinde yaratılıp silindi.
  // `db-guard` `_dev`i geliştirme sayıp geçirdiği için o yol açıktı.
  const temizlik = (db: string) =>
    spawnSync("npx", ["tsx", join(dizin, "clean_test_residue.ts")], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: `postgresql://u:p@localhost:55433/${db}` },
      timeout: 120_000,
    });
  const tFabrika = temizlik("tekserp_fabrika_dev");
  const tFabrikaCikti = `${tFabrika.stdout ?? ""}${tFabrika.stderr ?? ""}`;
  check(
    "§8 ⭐ temizlik betiği fabrika yedeğinde DURDU (--apply verilmeden)",
    tFabrika.status === 1 && tFabrikaCikti.includes("fixture kalıbına uymuyor"),
    `exit ${tFabrika.status}`,
  );
  check(
    "§8: silme HİÇ denenmedi (rapor başlığı bile basılmadı)",
    !tFabrikaCikti.includes("DRY-RUN") && !tFabrikaCikti.includes("UYGULAMA MODU"),
    "kapı ilk ifadede düştü",
  );
  const tFixture = temizlik("tekserp_kapi_sondasi_test");
  const tFixtureCikti = `${tFixture.stdout ?? ""}${tFixture.stderr ?? ""}`;
  check(
    "§8: fixture adıyla bu kapı GEÇİYOR (başka sebeple düşebilir, bu gerekçe çıkmaz)",
    !tFixtureCikti.includes("fixture kalıbına uymuyor"),
    "ad kapısı sessiz",
  );

  // ═══ §9 — HTTP AYAKLI BEKÇİ SABİT PORTU VARSAYAMAZ ═══════════════════════
  // Sabit port BAŞKA bir oturumun sunucusunda olabilir ve o sunucu BAŞKA bir
  // veritabanına bakıyor olabilir; bekçi o hâlde 401 alıp SESSİZCE atlıyordu
  // (ölçüldü 2026-09-12: beş dosyada 19 "atlandı", gerçek kayıp ≈23). Kapı tek
  // kaynakta: `lib/http-bekci-kapisi.ts` — yokluk beyan edilmiş atlama, yabancı
  // sunucu KIRMIZI. Bu tripwire, kapıyı çağırmayan yeni bir HTTP bekçisini
  // düşürür.
  const httpBekcileri = dosyalar
    .filter((f) => /^test_.*\.ts$/.test(f))
    .filter((f) => /TEST_API_URL/.test(readFileSync(join(dizin, f), "utf8")));
  check(
    "§9a körlük zemini: HTTP ayaklı bekçi bulundu",
    httpBekcileri.length >= 5,
    `${httpBekcileri.length} dosya`,
  );
  const kapisizHttp = httpBekcileri.filter(
    (f) => !readFileSync(join(dizin, f), "utf8").includes("http-bekci-kapisi"),
  );
  check(
    "§9b ⭐ her HTTP ayaklı bekçi hedef kapısını çağırıyor (sabit port varsayımı yok)",
    kapisizHttp.length === 0,
    kapisizHttp.join(", ") || "hepsi kapılı",
  );
  const kapiKaynak = readFileSync(join(dizin, "lib", "http-bekci-kapisi.ts"), "utf8");
  check(
    "§9c kapı YOKLUK ile YABANCIYI ayırıyor (ikisi aynı sonuca çıkmıyor)",
    kapiKaynak.includes("atlaSebebi") && kapiKaynak.includes("BAŞKA bir veritabanına"),
    "iki ayrı dönüş alanı",
  );
  check(
    "§9d STRICT koşumda yokluk da kırmızı (paket kararı burada verilir)",
    kapiKaynak.includes("TEKSERP_STRICT"),
    "tek anahtar",
  );

  // ═══ §10 — KENDİ HEDEFİNİ KURAN BETİK KAPISIZ OLAMAZ ═════════════════════
  // Yıkıcı iz taramaları yalnız SİLME desenlerine bakıyor. Ama hedefini kendisi
  // kuran bir betik (`new Pool(` / `new PrismaClient(` / `DATABASE_URL` ataması)
  // koşucunun kapısını da atlar: `npx tsx scripts/x.ts` doğrudan koşulduğunda
  // hiçbir ayak çalışmaz. Bu bölüm o sınıfı adıyla arar.
  const HEDEF_KURAN = ["new Pool(", "new PrismaClient(", "process.env.DATABASE_URL ="];
  const KAPILAR = [KAPI, "hedefDbEngeli(", "fixtureHedefEngeli(", "hacimHedefEngeli("];
  const HEDEF_KURAN_MUAF: Record<string, string> = {
    "lib/hedef-db-kapisi.ts": "kapının KENDİSİ — hedefi ölçmek için havuz kurar",
    "test_script_guards.ts": "bu dosyanın kendisi — aradığı izleri sabit olarak taşır",
    "test_timestamptz_contract.ts": "havuz izlerini TARAR; kendi havuzunu kurmaz",
    "test_pool_health.ts": "havuz TÜKENMESİNİ ölçer (max:1 + 1ms connect timeout); veriye yazmaz",
  };
  const hedefKuranlar: string[] = [];
  const hedefKuranKapisiz: string[] = [];
  for (const f of dosyalar) {
    const kod = kodSatirlari(readFileSync(join(dizin, f), "utf8"));
    if (!HEDEF_KURAN.some((iz) => kod.includes(iz))) continue;
    hedefKuranlar.push(f);
    if (f in HEDEF_KURAN_MUAF) continue;
    if (!KAPILAR.some((k) => kod.includes(k))) hedefKuranKapisiz.push(f);
  }
  check(
    "§10a körlük zemini: kendi hedefini kuran betik bulundu",
    hedefKuranlar.length >= 3,
    `${hedefKuranlar.length} betik`,
  );
  check(
    `§10b ⭐ kendi hedefini kuran kapısız betik TAVANI (${HEDEF_KURAN_TAVAN}) aşmadı — tavan yalnız DÜŞER`,
    hedefKuranKapisiz.length <= HEDEF_KURAN_TAVAN,
    `${hedefKuranKapisiz.length} kapısız / ${hedefKuranlar.length} hedef kuran`,
  );
  const oluHedefMuaf = Object.keys(HEDEF_KURAN_MUAF).filter((f) => !hedefKuranlar.includes(f));
  check("§10c ölü muaf yok (liste bayat değil)", oluHedefMuaf.length === 0, oluHedefMuaf.join(", ") || "güncel");

  // ═══ §11 — `--apply` ALAN HER BETİK HEDEFİ ADIYLA BEYAN EDER ══════════════
  // Geri alınamaz yazma yapan yolun izi, yalnız okuyan yolunkinden zayıf olamaz:
  // operatör hangi veritabanını vurduğunu çıktıdan görmeli.
  // Sözleşmenin ÇIKTISI ölçülür, çağrı biçimi değil: bir betik hedefi
  // `hedefDbAdi()` ile de basabilir, `db-guard`ın "Hedef doğrulandı" satırıyla
  // da, kendi `🎯 Hedef veritabanı:` satırıyla da. Üçü de aynı sözü tutar.
  const BEYAN_IZLERI = [
    "hedefDbAdi(",
    "assertGelistirmeVeritabani(",
    "Hedef doğrulandı",
    "Hedef veritabanı",
  ];
  const applyBetikleri = dosyalar.filter((f) => {
    const kod = kodSatirlari(readFileSync(join(dizin, f), "utf8"));
    return kod.includes('includes("--apply")') || kod.includes("includes('--apply')");
  });
  const beyansiz = applyBetikleri.filter(
    (f) => !BEYAN_IZLERI.some((iz) => kodSatirlari(readFileSync(join(dizin, f), "utf8")).includes(iz)),
  );
  check("§11a körlük zemini: `--apply` alan betik bulundu", applyBetikleri.length >= 2, `${applyBetikleri.length} betik`);
  check(
    `§11b ⭐ hedefini BEYAN ETMEYEN \`--apply\` betiği TAVANI (${APPLY_BEYANSIZ_TAVAN}) aşmadı — tavan yalnız DÜŞER`,
    beyansiz.length <= APPLY_BEYANSIZ_TAVAN,
    `${beyansiz.length} beyansız / ${applyBetikleri.length} apply betiği`,
  );
  if (beyansiz.length < APPLY_BEYANSIZ_TAVAN) {
    console.log(
      `\nℹ️  TAVAN DÜŞÜRÜLEBİLİR: ${beyansiz.length} ölçüldü, dosyadaki tavan ${APPLY_BEYANSIZ_TAVAN}.` +
        `\n   \`APPLY_BEYANSIZ_TAVAN = ${beyansiz.length}\` yaz.`,
    );
  }
  if (beyansiz.length > 0) console.log(`   beyan etmeyenler: ${beyansiz.join(", ")}`);

  // ═══ §12 — ÖZYİNELEMELİ TARAMA TEK YERDE TANIMLANIR ══════════════════════
  // Tarama derinliği bir bekçinin kapsamını sessizce belirler. İki kopya iki
  // farklı derinlik demektir: `test_timestamptz_contract` kendi `walkTs`ini
  // taşıyordu, `test_script_guards` ise hiç inmiyordu. Kopya yeniden doğarsa
  // fark yine sessiz olur — bu yüzden TANIM sayısı ölçülür (çağrı değil).
  const tarayiciTanimi = dosyalar.filter((f) =>
    /function\s+walkTs\s*\(/.test(kodSatirlari(readFileSync(join(dizin, f), "utf8"))),
  );
  check(
    "§12 ⭐ özyinelemeli TS tarayıcısı yalnız TEK dosyada tanımlı",
    tarayiciTanimi.length === 1 && tarayiciTanimi[0] === "lib/ts-tarama.ts",
    tarayiciTanimi.join(", ") || "(hiç tanım yok — tek kaynak kayboldu)",
  );

  // ═══ §13 — HEDEF BİR KEZ ÇÖZÜLÜR, İKİ ADIM DA ONU KULLANIR ════════════════
  // 2026-09-12 vakası: SQL yolu `.env` DOSYASINI, `resolve` yolu Prisma'nın kendi
  // çözümlemesini (`process.env`) okuyordu ⇒ SQL bir veritabanına, defter işareti
  // BAŞKASINA gitti. Düzeltme "hedef tek yerde çözülür"dü; bu bölüm o cümleyi
  // İDDİA olmaktan çıkarıp ÖLÇÜLEN bir değişmez yapar (yoksa bir sonraki
  // refactor ikinci bir çözüm noktası ekler ve kimse görmez).
  const applyMigKod = kodSatirlari(readFileSync(join(dizin, "apply-migration.ts"), "utf8"));
  const cozumGecisi = (applyMigKod.match(/resolveDbUrl\(\)/g) ?? []).length;
  check(
    "§13a ⭐ apply-migration hedefi TEK yerde çözüyor (1 tanım + 1 çağrı)",
    cozumGecisi === 2,
    `${cozumGecisi} geçiş`,
  );
  check(
    "§13b ⭐ resolve adımı hedefi AÇIKÇA alıyor (Prisma kendi çözümlemesine düşmüyor)",
    /"resolve"[\s\S]{0,240}DATABASE_URL:\s*prismaUrl/.test(applyMigKod),
    "env: { DATABASE_URL: prismaUrl }",
  );
  check(
    "§13c bağlanılan veritabanı SQL'den doğrulanıyor (URL okumak yetmez)",
    applyMigKod.includes("SELECT current_database()") && applyMigKod.includes("HEDEF ÇELİŞKİSİ"),
    "current_database() + durdurma",
  );

  // ═══ §14 — `prisma generate` İZOLE WORKTREE'DE ORTAK CLIENT'I EZEMEZ ══════
  // Şemada generator `output` yok ⇒ client `node_modules/.prisma/client`a yazılır
  // ve worktree'ler o dizini ORTAK ağaca symlink ediyor (2026-09-12: symlink
  // taşıyan altı ağaç). Bir worktree'de generate koşarsa ortak client o ağacın
  // İNMEMİŞ şemasıyla ezilir; başkalarının typecheck'i yanıltıcı yeşil verir.
  const paket = readFileSync(join(dizin, "..", "package.json"), "utf8");
  check(
    "§14a ⭐ `prisma:generate` kapıdan geçiyor (npm yolu korumasız değil)",
    /"prisma:generate":\s*"[^"]*prisma-generate-kapisi\.mjs[^"]*"/.test(paket),
    "package.json",
  );
  const genKapi = readFileSync(join(dizin, "prisma-generate-kapisi.mjs"), "utf8");
  check(
    "§14b kapı worktree'yi git'ten ölçüyor (dizin adı tahmini değil)",
    genKapi.includes("--git-common-dir") && genKapi.includes("isSymbolicLink"),
    "git-common-dir + symlink ölçümü",
  );
  check(
    "§14c kaçış anahtarı TEK ve adıyla anılıyor",
    genKapi.includes("PRISMA_GENERATE_WORKTREE_ONAY"),
    "bilinçli karar yolu açık",
  );
}

try {
  main();
} catch (e) {
  console.error("Beklenmeyen hata:", e);
  fail++;
}
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
