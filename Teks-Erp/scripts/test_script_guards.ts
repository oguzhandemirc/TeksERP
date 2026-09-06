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
// =============================================================================
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

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

const MUAFLAR: Record<string, string> = {
  "test_db_invariants.ts":
    "TRUNCATE bir STRING SABİTİNDE geçiyor (trigger tanımı: 'BEFORE DELETE OR UPDATE OR TRUNCATE') — yorum ayıklaması bunu elemez, çalıştırılan bir ifade de değil",
  "test_audit_depth.ts":
    "TRUNCATE bilerek koşuluyor ama GERİ ALINAN bir tx içinde: audit guard'ının onu reddettiğini ölçüyor",
  "test_script_guards.ts": "bu dosyanın kendisi — izleri sabit olarak taşır",
};

function main(): void {
  const dizin = join(__dirname);
  const dosyalar = readdirSync(dizin).filter((f) => f.endsWith(".ts"));

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
  const PRISMA_SILME = /\.deleteMany\(|\$executeRaw/;
  /** ÖLÇÜLDÜ 2026-09-06: 44 yıkıcı betiğin 42'sinde kapı yok. Yalnız DÜŞER. */
  const KAPISIZ_TAVAN = 42;
  const prismaYikicilar: string[] = [];
  const prismaKapisizlar: string[] = [];
  for (const f of dosyalar) {
    if (f.startsWith("test_") || f.startsWith("fixture-")) continue;
    const kod = kodSatirlari(readFileSync(join(dizin, f), "utf8"));
    if (!PRISMA_SILME.test(kod)) continue;
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
    return !readFileSync(yol, "utf8").includes(KAPI);
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
}

try {
  main();
} catch (e) {
  console.error("Beklenmeyen hata:", e);
  fail++;
}
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
