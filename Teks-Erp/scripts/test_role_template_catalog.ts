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
//   §5 TAM YETKİ YAYILIMI: Tam Yetki'ye bu koşumda eklenen izin bağlı kullanıcıya
//      gider; bağlı olmayan, süreli, silinmiş, diğer şablon almaz; SoD yayılmaz;
//      audit izi; idempotent; eşzamanlı iki açılışta tek yayılım.
//
// Koşum: npx tsx scripts/test_role_template_catalog.ts
//
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `role-template-catalog.ts`ten bir izin
//    kodu (`shipping:repair-allocation`) çıkarıldı → "Her izin en az bir DAR
//    rolde" KIRMIZI. Geri konunca 21/21 yeşil. Yani bekçi "yeni izin hiçbir role
//    girmedi, kimse atayamıyor" sınıfını yakalıyor.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { PERMISSION_CATALOG, grantsDesktopPanel } from "../src/constants/permission-catalog";
import { SCREEN_CATALOG, mobileScreenPermissionCodes } from "../src/constants/screen-catalog";
import {
  ROLE_TEMPLATE_CATALOG,
  LEGACY_TEMPLATE_NAME_TO_CODE,
  ROLE_COVERAGE_EXEMPT,
  SOD_ALLOWED_TEMPLATES,
  SOD_PERMISSION_CODES,
  PATRON_READ_EXTRA_CODES,
  PATRON_READ_EXCLUDED_CODES,
  resolveRoleTemplateCodes,
} from "../src/constants/role-template-catalog";
import { reconcileRoleTemplates, ROLE_TEMPLATE_RECONCILE_LOCK_NS, withoutSodPermissionIds } from "../src/jobs/role-template-catalog.job";
import { matchesPermission } from "../src/middlewares/rbac.middleware";
import { readFileSync } from "fs";
import * as path from "path";
import { foldNameForCompare } from "../src/services/helpers/name-normalize.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

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

  console.log("\n=== §2d SoD DAĞILIMI: üçlü yalnız beyanlı rollerde ===");
  // Kural "yalnız Muhasebe/Süpervizör" idi ama §2 dağılımı ölçmüyordu: WEB_TRADE `shipping:write`
  // ile `shipping:invoice`ı birlikte taşıdı. Joker (`shipping:*`) da sayılır — eşleşme tek yüklemden.
  const sodIhlal = ROLE_TEMPLATE_CATALOG.filter((e) => e.mode !== "all" && !SOD_ALLOWED_TEMPLATES.includes(e.code))
    .flatMap((e) => SOD_PERMISSION_CODES.filter((c) => matchesPermission(e.codes, c)).map((c) => `${e.code}:${c}`));
  check("SoD kümesi yalnız beyanlı rollerde (Muhasebe · Süpervizör · Tam Yetki)", sodIhlal.length === 0, sodIhlal.join(", ") || "temiz");
  const faturaYazan = ROLE_TEMPLATE_CATALOG.filter(
    (e) => e.mode !== "all" && matchesPermission(e.codes, "shipping:invoice") && matchesPermission(e.codes, "shipping:write"),
  ).map((e) => e.code);
  check("`shipping:invoice` taşıyan rol `shipping:write` taşımaz (sevk eden faturalamaz)", faturaYazan.length === 0, faturaYazan.join(", ") || "temiz");
  const olu = SOD_ALLOWED_TEMPLATES.filter((c) => !kodlar.includes(c));
  check("SoD beyanındaki her rol katalogda var (ölü beyan yok)", olu.length === 0, olu.join(", "));

  console.log("\n=== §2e OPERATÖR ŞABLONU → PANEL GİRİŞİ YOK (K4P patron kararı 2026-10-24) ===");
  // Web izni (`inspection:*` vb.) masaüstü paneline giriş açar; KK1 operatörü yalnız tablet kapsamlı muayene alır.
  // Sonda (2026-10-24): MOBILE_KK1'e `inspection:read` eklendi → iki ❌; geri alınınca yeşil.
  const kk1 = ROLE_TEMPLATE_CATALOG.find((r) => r.code === "MOBILE_KK1");
  check("MOBILE_KK1 var ve tablet muayene iznini (`mobile:muayene`) taşıyor", !!kk1 && kk1.codes.includes("mobile:muayene"));
  check("⭐ MOBILE_KK1 masaüstü paneline giriş AÇMAZ (auth kanal kapısıyla aynı yüklem)", !!kk1 && !grantsDesktopPanel(kk1.codes), kk1?.codes.filter((c) => grantsDesktopPanel([c])).join(", ") || "temiz");
  const k4pWeb = [...izinKodlari].filter((c) => /^(inspection|labtest|certificate):/.test(c));
  const k4pSizinti = ROLE_TEMPLATE_CATALOG.filter((r) => !r.code.startsWith("WEB_") && r.mode !== "all")
    .flatMap((r) => k4pWeb.filter((c) => r.codes.includes(c)).map((c) => `${r.code}:${c}`));
  check("Körlük zemini: K4P web izinleri katalogda (≥ 9)", k4pWeb.length >= 9, `${k4pWeb.length} kod`);
  check("⭐ K4P panel izinleri (muayene/lab/sertifika) yalnız WEB_* sorumlu-şef şablonlarında", k4pSizinti.length === 0, k4pSizinti.join(", ") || "temiz");
  const authKaynak = readFileSync(path.join(__dirname, "..", "src", "services", "auth.service.ts"), "utf8");
  check("Kanal kapısı tek yüklemi okur (`grantsDesktopPanel`; elle `startsWith(\"mobile:\")` yok)", authKaynak.includes("!grantsDesktopPanel(permissions)") && !authKaynak.includes('startsWith("mobile:")'));

  console.log("\n=== §2f PATRON — TAM OKUMA (C4, kullanıcı kararı 2026-11-15) ===");
  // NEGATİF SONDA (2026-11-15): PATRON_READ_EXTRA_CODES'a "order:write" eklendi → §2f-b ❌; türetimden `:view` soneki
  //   düşürüldü → §2f-c ❌ (license:view eksik). İkisi de geri alındı.
  const patron = ROLE_TEMPLATE_CATALOG.find((r) => r.code === "WEB_PATRON_READ_ALL");
  const dislanan = new Set<string>(PATRON_READ_EXCLUDED_CODES);
  const okumaSoneki = [...izinKodlari].filter((c) => /:(read|view)$/.test(c) && !dislanan.has(c) && PERMISSION_CATALOG.find((p) => p.code === c)?.category === "web");
  check("§2f-a şablon var, mode list, patron uygulaması girişini taşır", !!patron && patron.mode === "list" && patron.codes.includes("patron-app:login"));
  const yazmaSinifi = (patron?.codes ?? []).filter((c) => c !== "patron-app:login" && !/:(read|view)$/.test(c) && !(PATRON_READ_EXTRA_CODES as readonly string[]).includes(c));
  const yazmaSoneki = (patron?.codes ?? []).filter((c) => /:(write|approve|cancel|manage|print|edit|design|publish|merge|close|invoice|payment|import)$/.test(c) || c.endsWith(":*") || c === "*");
  check("§2f-b ⭐ yazma/onay/yönetim izni yok (her kod okuma soneki, beyanlı ek okuma ya da giriş kanalı)", yazmaSinifi.length === 0 && yazmaSoneki.length === 0, [...yazmaSinifi, ...yazmaSoneki].join(", ") || "temiz");
  const eksikOkuma = okumaSoneki.filter((c) => !patron?.codes.includes(c));
  check("§2f-c ⭐ katalogdaki her web okuma izni şablonda (türetim — yeni :read kendiliğinden girer)", okumaSoneki.length >= 25 && eksikOkuma.length === 0, eksikOkuma.join(", ") || `${okumaSoneki.length} okuma izni`);
  const patronSod = SOD_PERMISSION_CODES.filter((c) => matchesPermission(patron?.codes ?? [], c));
  check("§2f-d SoD kümesi girmez", patronSod.length === 0, patronSod.join(", ") || "temiz");
  const oluEk = PATRON_READ_EXTRA_CODES.filter((c) => !izinKodlari.has(c));
  const sizan = PATRON_READ_EXCLUDED_CODES.filter((c) => patron?.codes.includes(c) || !izinKodlari.has(c));
  check("§2f-f dışlanan okuma izni (mal kabul) şablonda yok ve katalogda yaşıyor", sizan.length === 0, sizan.join(", ") || "temiz");
  check("§2f-e ek okuma listesinde ölü kod yok", oluEk.length === 0, oluEk.join(", ") || `${PATRON_READ_EXTRA_CODES.length} kod`);

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
  check("İkinci koşum kimseye izin yaymıyor", ikinci.spread.length === 0, `${ikinci.spread.length} satır`);

  await tamYetkiYayilimi();

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

/**
 * §5 TAM YETKİ YAYILIMI (kullanıcı kararı 2026-11-18): `ADMIN_FULL`a bu koşumda eklenen izin,
 * şablonun bütün (SoD hariç) izinlerini süresiz taşıyan kullanıcıya da verilir; diğer şablonlar yaymaz.
 * "Yeni doğan izin" = bekçinin yarattığı geçici izin + `extraCodesByTemplate` dikişi (şablon satırı SİLİNMEZ).
 */
async function tamYetkiYayilimi(): Promise<void> {
  console.log("\n=== §5 TAM YETKİ YAYILIMI ===");
  const engel = hedefDbEngeli();
  if (engel) {
    check("§5 hedef DB yazılabilir", false, engel);
    return;
  }
  const STAMP = Date.now().toString(36);
  const sod = new Set<string>(SOD_PERMISSION_CODES);
  const admin = await prisma.permissionTemplate.findUnique({ where: { code: "ADMIN_FULL" }, select: { permissions: { select: { permission: { select: { code: true } } } } } });
  const muhasebe = await prisma.permissionTemplate.findUnique({ where: { code: "WEB_ACCOUNTING" }, select: { permissions: { select: { permission: { select: { code: true } } } } } });
  if (!admin || !muhasebe) {
    check("§5 ADMIN_FULL ve WEB_ACCOUNTING DB'de", false);
    return;
  }
  const adminKodlari = admin.permissions.map((p) => p.permission.code);
  const adminTemelKodlar = adminKodlari.filter((c) => !sod.has(c));
  const Y = [...adminTemelKodlar].sort()[0]; // bilerek kaldırılan
  const muhasebeKodlari = muhasebe.permissions.map((p) => p.permission.code).filter((c) => !sod.has(c));

  // SoD süzgeci saf fonksiyonda — yayılım ve bağlılık ölçümü ikisi de bunu kullanır.
  const sodKodu = [...SOD_PERMISSION_CODES].sort()[0];
  const sodSatir = await prisma.permission.findMany({ where: { code: { in: [sodKodu, Y] } }, select: { id: true, code: true } });
  const sodHarita = new Map(sodSatir.map((p) => [p.id, p.code]));
  const suzulen = withoutSodPermissionIds(sodSatir.map((p) => p.id), sodHarita).map((id) => sodHarita.get(id));
  check("§5c ⭐ SoD izni yayılım kümesinden düşer (sıradan izin kalır)", sodSatir.length === 2 && !suzulen.includes(sodKodu) && suzulen.includes(Y), suzulen.join(", "));

  const madeUserIds: string[] = [];
  const madePermIds: string[] = [];
  const yeniIzin = async (ek: string): Promise<string> => {
    const code = `test-izyay-${ek}-${STAMP}:x`.slice(0, 64);
    const p = await prisma.permission.create({ data: { code, module: "ADMIN", description: "TEST izin yayılım bekçisi" }, select: { id: true } });
    madePermIds.push(p.id);
    return code;
  };
  const yeniKullanici = async (ek: string, kodlar: readonly string[], opts: { validUntil?: Date; deleted?: boolean } = {}): Promise<string> => {
    const u = await prisma.user.create({
      data: {
        username: `test-izyay-${ek}-${STAMP}`.slice(0, 50),
        fullName: `TEST İzin Yayılım ${ek}`,
        passwordHash: "$2a$10$testtesttesttesttesttestteAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ...(opts.deleted ? { deletedAt: new Date(), isActive: false } : {}),
      },
      select: { id: true },
    });
    madeUserIds.push(u.id);
    const perms = await prisma.permission.findMany({ where: { code: { in: [...kodlar] } }, select: { id: true } });
    await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: u.id, permissionId: p.id, validUntil: opts.validUntil ?? null })) });
    return u.id;
  };
  const sahip = async (userId: string, code: string): Promise<number> =>
    prisma.userPermission.count({ where: { userId, permission: { code } } });

  try {
    const bagli = await yeniKullanici("bagli", adminTemelKodlar);
    const kaldirilan = await yeniKullanici("kaldirilan", adminTemelKodlar.filter((c) => c !== Y));
    const sureli = await yeniKullanici("sureli", adminTemelKodlar, { validUntil: new Date(Date.now() + 365 * 86_400_000) });
    const silinmis = await yeniKullanici("silinmis", adminTemelKodlar, { deleted: true });
    const muhasebeci = await yeniKullanici("muhasebe", muhasebeKodlari);

    // Yeni doğan izin X: hem Tam Yetki'ye hem Muhasebe şablonuna bu koşumda girer.
    const X = await yeniIzin("x");
    const dikis = { extraCodesByTemplate: { ADMIN_FULL: [X], WEB_ACCOUNTING: [X] } };
    const r1 = await reconcileRoleTemplates(dikis);
    check("§5a iki şablon da yeni izni aldı (Tam Yetki + Muhasebe)", (r1.itemsAdded.ADMIN_FULL ?? []).includes(X) && (r1.itemsAdded.WEB_ACCOUNTING ?? []).includes(X), JSON.stringify({ a: r1.itemsAdded.ADMIN_FULL, m: r1.itemsAdded.WEB_ACCOUNTING }));
    check("§5b ⭐ bağlı kullanıcı yeni izni aldı", (await sahip(bagli, X)) === 1 && r1.spread.some((s) => s.userId === bagli && s.permissionCode === X));
    check("§5d ⭐ bilerek izni alınmış kullanıcı bağlı sayılmadı — ne yeni izin ne kaldırılan geri", (await sahip(kaldirilan, X)) === 0 && (await sahip(kaldirilan, Y)) === 0);
    check("§5e süreli izinli kullanıcı bağlı sayılmadı", (await sahip(sureli, X)) === 0);
    check("§5f silinmiş kullanıcıya yayılmadı", (await sahip(silinmis, X)) === 0);
    check("§5g ⭐ diğer şablon (Muhasebe) kullanıcısına yayılmadı", (await sahip(muhasebeci, X)) === 0);
    check("§5h yalnız eklenen izin yayıldı", r1.spread.every((s) => s.permissionCode === X), [...new Set(r1.spread.map((s) => s.permissionCode))].join(", "));

    const satir = r1.spread.find((s) => s.userId === bagli);
    const iz = satir ? await prisma.systemLog.count({ where: { tableName: "USER_PERMISSION", recordId: satir.userPermissionId, action: "CREATE" } }) : 0;
    check("§5i audit: kullanıcı × izin ayak izi yazıldı", iz === 1, `${iz} satır`);

    const r2 = await reconcileRoleTemplates(dikis);
    check("§5j ⭐ idempotent: ikinci açılış yaymıyor, tek satır kalıyor", r2.spread.length === 0 && (await sahip(bagli, X)) === 1);

    // Çok örnekli açılış: iki uzlaştırma aynı anda — biri yayar, öteki kilitte bekleyip boş döner.
    const yaris = await yeniKullanici("yaris", [...adminTemelKodlar, X]);
    const Z = await yeniIzin("z");
    const dikisZ = { extraCodesByTemplate: { ADMIN_FULL: [X, Z], WEB_ACCOUNTING: [X] } };
    const [y1, y2] = await Promise.all([reconcileRoleTemplates(dikisZ), reconcileRoleTemplates(dikisZ)]);
    const yarisYayilim = [...y1.spread, ...y2.spread].filter((s) => s.userId === yaris);
    check("§5k yarış: iki eşzamanlı açılışta izin TEK kez yayıldı", yarisYayilim.length === 1 && (await sahip(yaris, Z)) === 1, `${yarisYayilim.length} yayılım`);

    // Kilit gerçekten alınıyor mu: elle açık tutulan tx uzayı tutarken uzlaştırma BEKLEMELİ.
    let birakildi = 0;
    let bitti = 0;
    const tutucu = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROLE_TEMPLATE_RECONCILE_LOCK_NS}::int, 1::int)`;
      await new Promise((r) => setTimeout(r, 1500));
      birakildi = Date.now();
    }, { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 300));
    const bekleyen = reconcileRoleTemplates().then(() => { bitti = Date.now(); });
    await Promise.all([tutucu, bekleyen]);
    check("§5l ⭐ uzlaştırma 8049 kilidinde bekliyor (çok örnekli açılış serileşir)", bitti >= birakildi && birakildi > 0, `bitti-bırakıldı=${bitti - birakildi} ms`);
  } finally {
    await prisma.userPermission.deleteMany({ where: { userId: { in: madeUserIds } } }).catch(() => {});
    // Bekçi kullanıcısı sert silinmez — silindi damgası (yayılım da bunları dışlar).
    await prisma.user.updateMany({ where: { id: { in: madeUserIds } }, data: { deletedAt: new Date(), isActive: false } }).catch(() => {});
    // Geçici izin: şablon satırları ve kalan kullanıcı izinleri FK cascade ile gider.
    await prisma.permission.deleteMany({ where: { id: { in: madePermIds } } }).catch(() => {});
  }
}

main()
  .catch((err) => {
    console.error(err);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
