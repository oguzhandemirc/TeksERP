// =============================================================================
// ROL (YETKİ ŞABLONU) KATALOĞU BEKÇİSİ
//
// NEDEN VAR — ölçülmüş bir saha hatası:
//   2026-08-06 denetiminde canlı fabrikada "Admin (Tam Yetki)" şablonu 55 izin
//   taşıyordu, izin kataloğu ise 67. Yani o şablonla açılan yeni yönetici 12
//   yetkiyi ALMIYORDU ve bunu hiçbir yerde göremiyordu — şablonlar yalnız
//   `prisma/seed.ts`'te yaşıyor, seed ise yalnız ilk kurulumda koşuyordu.
//   Aynı boşluk 2026-08-01'de izin kataloğunda yaşanmış ve boot-time
//   uzlaştırmayla çözülmüştü; bu dosya o çözümün ÜÇÜNCÜ parçasıdır
//   (tek kaynak → uzlaştırma → MEKANİK BEKÇİ).
//
// DÖRT CEPHE:
//   §1 Katalog iç tutarlılığı (kod/ad benzersiz, DB kolon sınırları, izin
//      kodları gerçekten var).
//   §2 KAPSAM: her izin, "Admin (Tam Yetki)" DIŞINDA en az bir dar rolde.
//      ⚠️ "Admin (Tam Yetki)" hariç tutulmazsa kontrol VAKUMEN yeşil kalır —
//      o şablon tanımı gereği her izni içerir.
//   §3 DB uzlaştırması gerçekten koşmuş mu (katalog ⊆ DB, ADMIN_FULL ⊇ izin
//      kataloğu, kodlar yazılmış mı).
//   §4 Uzlaştırma İDEMPOTENT mi (ikinci koşum hiçbir şey değiştirmemeli) —
//      yoksa her restart audit'e sahte "değişti" satırı yazar ve gerçek bir
//      değişikliği görünmez kılar.
//
// Koşum: npx tsx scripts/test_role_template_catalog.ts
//
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `role-template-catalog.ts`ten bir izin
//    kodu (`shipping:repair-allocation`) çıkarıldı → "Her izin en az bir DAR
//    rolde" KIRMIZI. Geri konunca 21/21 yeşil. Yani bekçi "yeni izin hiçbir role
//    girmedi, kimse atayamıyor" sınıfını yakalıyor.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { SCREEN_CATALOG, mobileScreenPermissionCodes } from "../src/constants/screen-catalog";
import {
  ROLE_TEMPLATE_CATALOG,
  LEGACY_TEMPLATE_NAME_TO_CODE,
  ROLE_COVERAGE_EXEMPT,
  resolveRoleTemplateCodes,
} from "../src/constants/role-template-catalog";
import { reconcileRoleTemplates } from "../src/jobs/role-template-catalog.job";
import { foldNameForCompare } from "../src/services/helpers/name-normalize.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

// Körlük zeminleri: bir refactor katalogu boşaltırsa "ihlal yok" ile "hiçbir
// şeye bakılmadı" aynı yeşile çıkardı.
const ASGARI_ROL = 15;
const ASGARI_IZIN = 50;

async function main(): Promise<void> {
  // `Set<string>` bilinçli: katalogda OLMAYAN kodları arıyoruz (bilinmeyen izin,
  // ölü muaf). Set dar birleşim tipini taşısaydı `has(c)` düz string'i kabul
  // etmez ve tam da bu kontroller derlenmezdi.
  const izinKodlari = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));

  console.log("\n=== §1 KATALOG İÇ TUTARLILIĞI ===");
  check("Körlük zemini: rol sayısı", ROLE_TEMPLATE_CATALOG.length >= ASGARI_ROL, `${ROLE_TEMPLATE_CATALOG.length} rol`);
  check("Körlük zemini: izin sayısı", izinKodlari.size >= ASGARI_IZIN, `${izinKodlari.size} izin`);

  const kodlar = ROLE_TEMPLATE_CATALOG.map((e) => e.code);
  check("Rol kodları benzersiz", new Set(kodlar).size === kodlar.length);

  const katlanmisAdlar = ROLE_TEMPLATE_CATALOG.map((e) => foldNameForCompare(e.name));
  const adTekrar = katlanmisAdlar.filter((n, i) => katlanmisAdlar.indexOf(n) !== i);
  check(
    "Rol adları Türkçe-duyarsız benzersiz",
    adTekrar.length === 0,
    adTekrar.length ? `tekrar: ${[...new Set(adTekrar)].join(", ")}` : "",
  );

  // DB kolon sınırları — aşan satır uzlaştırmada P2000 ile patlar ve o rol
  // sessizce hiç doğmaz.
  const uzunAd = ROLE_TEMPLATE_CATALOG.filter((e) => e.name.length > 64 || e.code.length > 64);
  check("Ad ve kod ≤ 64 karakter (DB VarChar)", uzunAd.length === 0, uzunAd.map((e) => e.code).join(", "));
  const uzunAciklama = ROLE_TEMPLATE_CATALOG.filter((e) => e.description.length > 200);
  check("Açıklama ≤ 200 karakter (DB VarChar)", uzunAciklama.length === 0, uzunAciklama.map((e) => e.code).join(", "));

  const bilinmeyen: string[] = [];
  for (const e of ROLE_TEMPLATE_CATALOG)
    for (const c of e.codes) if (!izinKodlari.has(c)) bilinmeyen.push(`${e.code}→${c}`);
  check(
    "Rollerdeki her izin kodu izin kataloğunda var",
    bilinmeyen.length === 0,
    bilinmeyen.join(", "),
  );

  const bosRol = ROLE_TEMPLATE_CATALOG.filter((e) => resolveRoleTemplateCodes(e).length === 0);
  check("Hiçbir rol boş değil", bosRol.length === 0, bosRol.map((e) => e.code).join(", "));

  const allModu = ROLE_TEMPLATE_CATALOG.filter((e) => e.mode === "all");
  check('Tam olarak bir tane mode:"all" rolü var', allModu.length === 1, allModu.map((e) => e.code).join(", "));

  const legacyKodlari = new Set(Object.values(LEGACY_TEMPLATE_NAME_TO_CODE));
  const legacyFazla = [...legacyKodlari].filter((c) => !kodlar.includes(c));
  check(
    "Eski-ad→kod tablosundaki her kod katalogda var (bayat eşleme yok)",
    legacyFazla.length === 0,
    legacyFazla.join(", "),
  );

  console.log("\n=== §2 KAPSAM: her izin dar bir rolde mi? ===");
  // "Admin (Tam Yetki)" DIŞINDAKİ roller — bu ayrım load-bearing.
  const darRoller = ROLE_TEMPLATE_CATALOG.filter((e) => e.mode !== "all");
  const kapsanan = new Set(darRoller.flatMap((e) => e.codes));
  const muaflar = new Set(Object.keys(ROLE_COVERAGE_EXEMPT));

  const kapsamDisi = [...izinKodlari].filter((c) => !kapsanan.has(c) && !muaflar.has(c)).sort();
  check(
    "Her izin en az bir DAR rolde (muaflar hariç)",
    kapsamDisi.length === 0,
    kapsamDisi.length ? `kapsam dışı: ${kapsamDisi.join(", ")}` : `${kapsanan.size} izin kapsanıyor`,
  );

  // Muaf listesi bayatlamasın: muaf edilen kod katalogdan düşmüşse ölü muaftır
  // ve gerçek bir boşluğu sessizce kapsam dışında tutabilir.
  const oluMuaf = [...muaflar].filter((c) => !izinKodlari.has(c));
  check("Muaf listesinde ölü kod yok", oluMuaf.length === 0, oluMuaf.join(", "));
  // Dar bir role sonradan eklenen muaf, muafiyeti gereksizleştirir.
  const gereksizMuaf = [...muaflar].filter((c) => kapsanan.has(c));
  check("Gereksiz muaf yok (dar rolde olan muaf edilmemiş)", gereksizMuaf.length === 0, gereksizMuaf.join(", "));
  for (const [kod, gerekce] of Object.entries(ROLE_COVERAGE_EXEMPT))
    console.log(`   ℹ️  muaf ${kod} — ${gerekce.split(".")[0]}.`);

  console.log("\n=== §2b EKRAN BAĞIMLILIKLARI: yazan, okuduğu ucu da görebiliyor mu? ===");
  // ⚠️ §2 "her izin BİR rolde var mı" diye sorar ve bu soru YETMEZ: bir izin
  // fabrika rollerinde bulunduğu için §2 yeşil kalırken, o izne İHTİYAÇ DUYAN
  // ekranın bulunduğu rolde eksik olabilir. 2026-08-15'te tam bu oldu —
  // `subcontractor:read` üç fabrika rolündeydi, `goods-receipt:*` taşıyan TEK
  // rolde (WEB_TRADE) yoktu; C4 tedarikçi seçicisinin fason bacağı sahada 403
  // alıyor, kutu "yalnız cari kartlar" bandıyla YARIM açılıyordu.
  //
  // Bu bölüm sorunun sınıfını kilitler: bir ekranın ANA izni bir roldeyse, o
  // ekranın çizerken ÇAĞIRDIĞI uçların izinleri de aynı rolde olmalı. Tablo
  // elle tutulur (panel kaynağını backend tarayamaz) ama tek satırlıktır ve
  // sebebi yazılıdır.
  const EKRAN_BAGIMLILIKLARI: Array<{
    ana: string;
    gerekli: string[];
    neden: string;
  }> = [
    {
      ana: "goods-receipt:write",
      gerekli: ["customer:read", "subcontractor:read"],
      neden:
        "Mal Kabul formundaki tedarikçi seçicisi (SupplierSelect) İKİ uçtan besleniyor: /api/customers + /api/subcontractors",
    },
    {
      ana: "purchase-order:read",
      gerekli: ["customer:read", "subcontractor:read"],
      neden: "Alış Siparişi listesinin filtre şeridi ile formu aynı iki-kaynaklı seçiciyi çiziyor",
    },
  ];
  // Körlük zemini: tablodaki her ANA izin gerçekten katalogda olmalı — biri
  // yeniden adlandırılırsa kontrol sessizce hiçbir role uygulanmaz olur.
  const oluAna = EKRAN_BAGIMLILIKLARI.filter((d) => !izinKodlari.has(d.ana)).map((d) => d.ana);
  check("Bağımlılık tablosunda ölü ANA izin yok", oluAna.length === 0, oluAna.join(", "));
  const oluGerekli = EKRAN_BAGIMLILIKLARI.flatMap((d) => d.gerekli).filter((c) => !izinKodlari.has(c));
  check("Bağımlılık tablosunda ölü GEREKLİ izin yok", oluGerekli.length === 0, oluGerekli.join(", "));

  const bagimlilikIhlali: string[] = [];
  let olculenRol = 0;
  for (const d of EKRAN_BAGIMLILIKLARI) {
    for (const rol of darRoller) {
      if (!rol.codes.includes(d.ana)) continue;
      olculenRol++;
      const eksik = d.gerekli.filter((c) => !rol.codes.includes(c));
      if (eksik.length > 0) bagimlilikIhlali.push(`${rol.code} → ${d.ana} var ama ${eksik.join(", ")} yok (${d.neden})`);
    }
  }
  // İkinci körlük zemini: hiçbir rol eşleşmediyse kontrol VAKUMEN yeşildir.
  check("Körlük zemini: bağımlılık en az bir role uygulandı", olculenRol > 0, `${olculenRol} eşleşme`);
  check(
    "Yazma izni taşıyan rol, ekranın okuduğu uçların iznini de taşıyor",
    bagimlilikIhlali.length === 0,
    bagimlilikIhlali.join(" | "),
  );

  console.log("\n=== §2c SAHA OPERATÖRÜ: bütün karolar, YETENEK yok — katalogdan TÜRETİLİR ===");
  // Saha bulgusu (d9/d5 2026-09-18): yönetici karo izinlerini tek tek ekliyordu; wildcard şablon yetenekleri de verir.
  // Sonda: `codes` elle listeye çevrilince (bir karo eksik) "türetim ≡ katalog" ❌; bir yetenek kodu eklenince "yetenek sızmadı" ❌.
  const saha = ROLE_TEMPLATE_CATALOG.find((r) => r.code === "SAHA_OPERATORU");
  const mobilEkranlar = SCREEN_CATALOG.filter((e) => e.app === "mobile");
  const karoIzinleri = new Set(mobilEkranlar.flatMap((e) => [...e.requires]));
  const yetenekIzinleri = new Set(mobilEkranlar.flatMap((e) => e.capabilities.map((c) => c.code)).filter((c) => !karoIzinleri.has(c)));
  check("SAHA_OPERATORU şablonu var, mode list, en az 15 karo", !!saha && saha.mode === "list" && saha.codes.length >= 15, `${saha?.codes.length ?? 0} izin`);
  check("⭐ türetim ≡ ekran kataloğu: codes = ∪ mobil ekran `requires` (elle liste değil; yeni karo gelince kendiliğinden genişler)", !!saha && JSON.stringify([...saha.codes].sort()) === JSON.stringify([...karoIzinleri].sort()) && JSON.stringify([...saha.codes]) === JSON.stringify(mobileScreenPermissionCodes()));
  check("⭐ YETENEK izni sızmadı (tambur-duzelt · dokuma-geri-al · devere-iptal · kk1-desen · kk1-yari-mamul …) ve wildcard yok", !!saha && saha.codes.every((c) => !yetenekIzinleri.has(c) && c !== "mobile:*") && yetenekIzinleri.size >= 5, `${yetenekIzinleri.size} yetenek`);
  check("her kod izin kataloğunda var (şablon ölü izin taşımaz)", !!saha && saha.codes.every((c) => izinKodlari.has(c)));

  console.log("\n=== §3 DB UZLAŞTIRMASI ===");
  // ⚠️ ÖN KOŞULU TEST KENDİSİ KURAR — "backend'i yeniden başlatın" beklemez.
  // Uzlaştırma yalnız server boot'unda koşuyor (`server.ts`). CI backend'i HİÇ
  // ayağa kaldırmaz (yalnız `migrate deploy` + `seed` + test koşucusu), dolayısıyla
  // eski hâlinde bu bölüm temiz DB'de kaçınılmaz olarak kırmızıydı: §3 "rol eksik"
  // diyordu ve §4'ün "İKİNCİ koşum" dediği şey aslında BİRİNCİ koşum olduğu için
  // idempotentlik kontrolü de düşüyordu (CI 2026-08-09: MOBILE_KURSUN_DAGITIM).
  //
  // Burada çağırmak testi ZAYIFLATMAZ, GÜÇLENDİRİR: eski hâli "birinin backend'i
  // yeniden başlatmış olması" gibi ortama ait bir OLAYI ölçüyordu; yenisi
  // fonksiyonun KENDİSİNİN doğru durumu ürettiğini ölçüyor. Dev DB'de (boot zaten
  // koşmuş) çağrı no-op'tur, yani orada davranış değişmez.
  const ilk = await reconcileRoleTemplates();
  if (ilk.created.length + ilk.adopted.length + Object.keys(ilk.itemsAdded).length > 0) {
    console.log(
      `   ℹ️  ilk uzlaştırma: +${ilk.created.length} yeni · ${ilk.adopted.length} sahiplenildi · ` +
        `${Object.keys(ilk.itemsAdded).length} role izin eklendi`,
    );
  }

  const dbSablonlar = await prisma.permissionTemplate.findMany({
    select: {
      code: true,
      name: true,
      isActive: true,
      permissions: { select: { permission: { select: { code: true } } } },
    },
  });
  const dbByCode = new Map(dbSablonlar.filter((t) => t.code).map((t) => [t.code as string, t]));

  const dbdeYok = kodlar.filter((c) => !dbByCode.has(c));
  check(
    "Katalogdaki her rol DB'de var (uzlaştırma koşmuş)",
    dbdeYok.length === 0,
    dbdeYok.length ? `eksik: ${dbdeYok.join(", ")} — backend'i yeniden başlatın` : `${dbByCode.size} rol`,
  );

  const adminRol = dbByCode.get("ADMIN_FULL");
  if (adminRol) {
    const sablonIzinleri = new Set(adminRol.permissions.map((p) => p.permission.code));
    const eksik = [...izinKodlari].filter((c) => !sablonIzinleri.has(c)).sort();
    check(
      '"Admin (Tam Yetki)" izin kataloğunun TAMAMINI içeriyor',
      eksik.length === 0,
      eksik.length ? `eksik ${eksik.length}: ${eksik.join(", ")}` : `${sablonIzinleri.size} izin`,
    );
  } else {
    check('"Admin (Tam Yetki)" DB\'de bulundu', false, "ADMIN_FULL kodlu satır yok");
  }

  // Dar rollerin içeriği: uzlaştırma "yalnız ekler", yani DB ⊇ katalog olmalı.
  const eksikIcerik: string[] = [];
  for (const e of darRoller) {
    const row = dbByCode.get(e.code);
    if (!row) continue;
    const mevcut = new Set(row.permissions.map((p) => p.permission.code));
    const eksik = e.codes.filter((c) => !mevcut.has(c));
    if (eksik.length) eksikIcerik.push(`${e.code}: ${eksik.join(",")}`);
  }
  check("Her rolün DB içeriği katalogu KAPSIYOR", eksikIcerik.length === 0, eksikIcerik.join(" | "));

  console.log("\n=== §4 UZLAŞTIRMA İDEMPOTENT Mİ ===");
  const ikinci = await reconcileRoleTemplates();
  const degisiklik =
    ikinci.created.length + ikinci.adopted.length + Object.keys(ikinci.itemsAdded).length;
  check(
    "İkinci koşum hiçbir şey değiştirmiyor",
    degisiklik === 0,
    degisiklik
      ? `created:${ikinci.created.join(",")} adopted:${ikinci.adopted.join(",")} items:${Object.keys(ikinci.itemsAdded).join(",")}`
      : "0 değişiklik",
  );
  if (ikinci.custom.length > 0)
    console.log(`   ℹ️  fabrikanın kendi ${ikinci.custom.length} şablonu korunuyor: ${ikinci.custom.join(", ")}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((err) => {
    console.error(err);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
