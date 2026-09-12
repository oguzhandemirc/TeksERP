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
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
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

  // ═══ §6 — PAKET HEDEFİ FİXTURE DB OLMALI (2026-09-12) ═══
  // Ortak ağaçtaki `.env` fabrikanın canlı YEDEĞİNİ gösteriyor ve o da
  // localhost'ta: host kapısı bunu göremez. Kapı ADA bakar. İki yön de ölçülür —
  // fabrika adı DURMALI, fixture adı GEÇMELİ (yalnız "durur" ölçmek, her şeyi
  // durduran bozuk bir kapıyı da yeşil gösterirdi).
  const kosucu = join(dizin, "run-all-tests.ts");
  const kos = (db: string) =>
    spawnSync("npx", ["tsx", kosucu, "__eslesmeyen_ad__"], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: `postgresql://u:p@localhost:55433/${db}` },
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
}

try {
  main();
} catch (e) {
  console.error("Beklenmeyen hata:", e);
  fail++;
}
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
