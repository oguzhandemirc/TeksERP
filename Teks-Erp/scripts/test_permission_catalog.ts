// =============================================================================
// İZİN KATALOĞU BEKÇİSİ — kod tabanındaki her izin kodu katalogda var mı?
//
// NEDEN VAR: `requirePermission("x:y")` yazıldığı anda o satırın DB'de olması
// bir ZORUNLULUK olur — yoksa Admin dışı HERKES 403 alır ve sebebi ekranda
// anlaşılmaz (mesaj "yetkiniz yok" der, "böyle bir izin tanımlı değil" demez).
// 2026-08-01'de bu fiilen yaşandı: kurşun bypass ekranı canlıya çıktı, izin
// satırı olmadığı için kimse göremedi, teşhis saatler aldı.
//
// Üç parçalı kalıcı çözümün ÜÇÜNCÜ parçası:
//   1. TEK KAYNAK          → src/constants/permission-catalog.ts
//   2. BOOT-TIME UZLAŞTIRMA→ backend her açılışta DB'deki eksikleri yazar
//   3. MEKANİK BEKÇİ       → BU DOSYA: kodda geçen izin kataloğa yazılmamışsa
//                            ya da yazım hatası varsa GELİŞTİRME anında düşer.
//
// YÖN ASİMETRİKTİR — bilinçli:
//   • katalog ⊇ kod tabanı  → ZORUNLU. Kodun istediği izin katalogda yoksa HATA.
//   • DB ⊇ katalog          → ZORUNLU. Uzlaştırma koştuysa hep yeşil; kırmızıysa
//                             "uzlaştırma bu DB'de koşmamış" sinyali.
//   • DB \ katalog (fazla)  → HATA DEĞİL. Kaldırılmış izinler DB'de kalır
//                             (uzlaştırma yalnız EKLER — atamaları koparmamak
//                             için). Yalnız bilgi olarak listelenir.
//
// TARAMA: TypeScript AST ile (regex değil) — böylece Swagger JSDoc yorumlarında
// geçen `requirePermission("...")` örnekleri sayılmaz, çok satırlı çağrılar ve
// dizi yayılımı (`...MOBILE_ROLL_READ`) doğru okunur.
//
// SESSİZ ATLAMA YOK: statik olarak çözülemeyen bir izin argümanı görülürse test
// DÜŞER ve dosyayı `DINAMIK_IZIN_KAYNAKLARI` tablosuna yazmaya zorlar. Kapsam
// boşluğu her zaman görünür kalır.
//
// Salt-okunur: hiçbir yazma/fixture yok, ortamdaki veriye bağımlı değil.
// Koşum: npx tsx scripts/test_permission_catalog.ts
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import prisma, { pool } from "../src/lib/prisma";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";

let pass = 0,
  fail = 0,
  warn = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
function warnLine(msg: string): void {
  warn++;
  console.log(`⚠️  ${msg}`);
}

const KOK = path.resolve(__dirname, "..");
const SRC = path.join(KOK, "src");
const ROUTES = path.join(SRC, "routes");

// ─────────────────────────────────────────────────────────────────────────────
// AYAR: izin kodunu ARGÜMANINDA taşıyan enforcement fonksiyonları.
// Değer = izin kodu taşıyan argüman indeksi; "hepsi" = tüm argümanlar.
//
// `matchesPermission` de listede: rbac middleware'inin aynı primitifi, route
// dışında (controller/servis içi koşullu yetki) doğrudan çağrılıyor. Oradaki
// yazım hatası da 403/sessiz-gizleme üretir → aynı bekçi kapsar.
// ─────────────────────────────────────────────────────────────────────────────
const IZIN_FONKSIYONLARI: Record<string, "hepsi" | number> = {
  requirePermission: 0,
  requireAnyPermission: "hepsi",
  matchesPermission: 1,
};

// AYAR: bu fonksiyonları TANIMLAYAN dosya(lar). Taramadan çıkarılır — içindeki
// `matchesPermission(userPermissions, required)` çağrısı bir izin İSTEĞİ değil,
// primitifin kendi gövdesidir; `required` çalışma anında gelen parametredir.
// Çıkarma KÖRLEŞTİRİCİ olabileceği için altta doğrulanıyor: bu dosya gerçekten
// IZIN_FONKSIYONLARI'nın hepsini tanımlıyor mu? Biri yeniden adlandırılırsa
// tarayıcı sessizce kör kalmaz, test düşer.
const TANIM_DOSYALARI = ["src/middlewares/rbac.middleware.ts"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// AYAR: statik olarak çözülemeyen (dinamik) izin kaynakları.
//
// Bazı yerlerde izin kodu çağrı argümanında DEĞİL, bir tabloda yaşar ve çalışma
// anında seçilir (örn. `requireAnyPermission(...entry[kind])`). AST bunu takip
// edemez. Sessizce atlamak yerine dosyayı BURAYA yazıyoruz: değer, o dosyada
// izin kodlarını taşıyan sabitin adıdır; bekçi o sabitin İÇİNDEKİ tüm string
// literal'leri toplayıp katalogla karşılaştırır.
//
// Yeni bir dinamik yol eklenirse test "çözülemedi" diye DÜŞER ve buraya
// eklenmeye zorlar — kapsam boşluğu sessizce büyüyemez.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Bir dosyanın izin kodları tek bir sabitte durmuyorsa (registry/adaptör deseni)
 * kapsam BAŞKA bir bekçiye devredilebilir. Devir sessiz bir muafiyet değildir:
 * hedef bekçi dosyası VAR olmalı ve devir her koşumda ekrana basılır.
 */
const DELEGE = "delege:";

const DINAMIK_IZIN_KAYNAKLARI: Record<string, readonly string[]> = {
  // requireAnyPermission(...entry[kind]) — entry = DOC_PERMISSIONS[docType]
  "src/routes/printed-document.routes.ts": ["DOC_PERMISSIONS"],
  // matchesPermission(perms, needM) — needM = STATION_KIND_PERM[station.kind]
  "src/services/work-session.service.ts": ["STATION_KIND_PERM"],
  // matchesPermission(perms, permission) — permission =
  // requiredPermissionForTable(table) → TABLE_PERMISSIONS[tableName].
  // Yetki KAYIT TÜRÜNE göre çözülür: siparişi okuyamayan biri siparişin
  // "kim değiştirdi"sini de okuyamamalı. Allowlist DIŞI tablo 400 ile reddedilir
  // (serbest tableName, audit'i dolaylı bir arama yüzeyine çevirirdi).
  "src/routes/record-info.routes.ts": ["TABLE_PERMISSIONS"],
  // matchesPermission(perms, adapter.writePermission / adapter.readPermission)
  // — adaptör `import-registry`den `:entity` ile çözülür. Yetki AKTARILAN
  // VERİYE göredir: `data:import` yalnız "toplu yükleme yapabilir" demektir,
  // hedefin kendi write izni AYRICA aranır (iki katman, iki ayrı soru).
  // Kodların katalogda tanımlı olduğunu `test_import_framework.ts` §11
  // MEKANİK doğrular (registry'deki her adaptör için).
  // İzinler `import-registry`deki ADAPTÖRLERDEN gelir (adapter.writePermission /
  // readPermission) — tek bir sabitte durmuyorlar, dolayısıyla AST ile
  // çözülemezler. Kapsam BAŞKA bir bekçide MEKANİK olarak kuruluyor:
  // `test_import_framework.ts §11` registry'deki HER adaptörün iki iznini de
  // katalogla karşılaştırır ve registry boşalırsa körlük zemini düşer.
  // Bu yüzden burada delegasyon beyan ediyoruz — muafiyet DEĞİL, devir.
  "src/routes/import.routes.ts": [`${DELEGE}scripts/test_import_framework.ts`],
  // Aynı desen: izinler `BUNDLE_PERMISSIONS` haritasından (config-bundle.service)
  // TÜRE göre çözülür. `test_config_bundle.ts` her türün iki iznini de katalogla
  // karşılaştırır ve tür sayısı zeminini korur.
  "src/routes/config-bundle.routes.ts": [`${DELEGE}scripts/test_config_bundle.ts`],
  // GLOBAL ARAMA (2026-08-19): kova başına izin `SEARCH_ENTITIES` katalogunda
  // durur ve servis `matchesPermission(perms, code)` ile kovayı ELER — yani
  // yetkisiz kova hiç sorgulanmaz (route katmanı yalnız `verifyToken` ister,
  // F221 deseni). Kodlar servis dosyasında DEĞİL katalogda olduğu için AST ile
  // çözülemezler; kapsamı `test_global_search.ts §2` kuruyor: katalogdaki HER
  // kovanın izni permission-catalog'da tanımlı VE liste ucunun izniyle hizalı mı.
  "src/services/search.service.ts": [`${DELEGE}scripts/test_global_search.ts`],
  // BİRLEŞTİRME (2026-08-19): ikinci kapı izni `import-registry`den çözülüyor
  // (`adapter.writePermission`) — import.routes.ts ile BİREBİR aynı desen ve
  // aynı gerekçe: ikinci bir varlık→izin listesi tutmamak için. Kapsam
  // `test_master_data_merge.ts` içinde kuruluyor (dört varlığın da write izni
  // katalogda tanımlı mı + renk gerçekten `property:write` mi).
  "src/routes/master-data-merge.routes.ts": [`${DELEGE}scripts/test_master_data_merge.ts`],
};

// Taramanın gerçekten "bir şeye baktığını" doğrulayan zeminler. Bir refactor
// tarayıcıyı boşa düşürürse (dizin taşındı, fonksiyon adı değişti) aşağıdaki
// tüm kontroller SIFIR kod üzerinde vakumen yeşil kalırdı — bu zeminler onu
// yakalar. Değerler bugünkü gerçeğin (53 route dosyası, 402 çağrı) çok
// altında; amaç eşik tutturmak değil, "hiç bakmıyor" halini yakalamak.
const ASGARI_ROUTE_DOSYASI = 10;
const ASGARI_CAGRI = 50;

type CagriYeri = {
  dosya: string; // repo köküne göreli
  satir: number;
  fonksiyon: string;
  kodlar: string[];
  cozulemeyen: string[]; // çözülemeyen argümanın kaynak metni
};

const sfCache = new Map<string, ts.SourceFile>();
function kaynakOku(mutlakYol: string): ts.SourceFile {
  const onbellek = sfCache.get(mutlakYol);
  if (onbellek) return onbellek;
  const metin = fs.readFileSync(mutlakYol, "utf8");
  const sf = ts.createSourceFile(mutlakYol, metin, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  sfCache.set(mutlakYol, sf);
  return sf;
}

function goreli(mutlakYol: string): string {
  return path.relative(KOK, mutlakYol).split(path.sep).join("/");
}

function tsDosyalari(dizin: string): string[] {
  const cikti: string[] = [];
  for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
    const tam = path.join(dizin, girdi.name);
    if (girdi.isDirectory()) cikti.push(...tsDosyalari(tam));
    else if (girdi.name.endsWith(".ts") && !girdi.name.endsWith(".d.ts")) cikti.push(tam);
  }
  return cikti.sort();
}

/** `x as const`, `(x)`, `x satisfies T` sarmalarını soyar. */
function soy(node: ts.Expression): ts.Expression {
  let n = node;
  for (;;) {
    if (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isParenthesizedExpression(n)) {
      n = n.expression;
      continue;
    }
    return n;
  }
}

/** Dosyada `AD` adlı ilk değişken bildirimini bulur (ilk eşleşme kazanır). */
function sabitBildirimi(sf: ts.SourceFile, ad: string): ts.VariableDeclaration | null {
  // Dizi toplayıcı — `let x: T | null` kullanılsaydı TS kapanış içindeki atamayı
  // göremeyip dışarıda `x`i `null`a daraltır ve `.initializer` erişimi derlenmezdi.
  const bulunanlar: ts.VariableDeclaration[] = [];
  const gez = (node: ts.Node): void => {
    if (bulunanlar.length > 0) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === ad) {
      bulunanlar.push(node);
      return;
    }
    ts.forEachChild(node, gez);
  };
  ts.forEachChild(sf, gez);
  return bulunanlar[0] ?? null;
}

/** Dosya içinde `const AD = [...] as const` arayıp string dizisini döner. */
function yerelDiziSabiti(sf: ts.SourceFile, ad: string): string[] | null {
  const bildirim = sabitBildirimi(sf, ad);
  if (!bildirim?.initializer) return null;
  const init = soy(bildirim.initializer);
  if (!ts.isArrayLiteralExpression(init)) return null;
  const kodlar: string[] = [];
  for (const el of init.elements) {
    if (!ts.isStringLiteralLike(el)) return null; // saf string dizisi değil → çözülemedi
    kodlar.push(el.text);
  }
  return kodlar;
}

/** `./x` / `../x` modül yolunu dosyaya çözer (.ts veya /index.ts). */
function modulCoz(kaynakDosya: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // paket importu — izlemiyoruz
  const temel = path.resolve(path.dirname(kaynakDosya), spec);
  for (const aday of [`${temel}.ts`, path.join(temel, "index.ts")]) {
    if (fs.existsSync(aday)) return aday;
  }
  return null;
}

/** `import { AD } from "./yol"` → { dosya, disaAktarilanAd } */
function importKaynagi(
  sf: ts.SourceFile,
  yerelAd: string
): { dosya: string; disaAktarilanAd: string } | null {
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const bag = st.importClause.namedBindings;
    if (!bag || !ts.isNamedImports(bag)) continue;
    for (const el of bag.elements) {
      if (el.name.text !== yerelAd) continue;
      if (!ts.isStringLiteral(st.moduleSpecifier)) return null;
      const dosya = modulCoz(sf.fileName, st.moduleSpecifier.text);
      if (!dosya) return null;
      return { dosya, disaAktarilanAd: (el.propertyName ?? el.name).text };
    }
  }
  return null;
}

/** Yayılan tanımlayıcıyı (yerel ya da import edilmiş) string dizisine çözer. */
function diziSabitiCoz(sf: ts.SourceFile, ad: string): string[] | null {
  const yerel = yerelDiziSabiti(sf, ad);
  if (yerel) return yerel;
  const kaynak = importKaynagi(sf, ad);
  if (!kaynak) return null;
  return yerelDiziSabiti(kaynakOku(kaynak.dosya), kaynak.disaAktarilanAd);
}

/** Verilen sabitin İÇİNDEKİ tüm string literal'leri toplar (dinamik tablolar için). */
function sabittekiStringler(sf: ts.SourceFile, ad: string): string[] | null {
  const bildirim = sabitBildirimi(sf, ad);
  if (!bildirim?.initializer) return null;
  const kodlar: string[] = [];
  const topla = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) kodlar.push(node.text);
    ts.forEachChild(node, topla);
  };
  topla(bildirim.initializer);
  return kodlar;
}

/** Dosyanın dışa aktardığı üst düzey `const`/`function` adları. */
function disaAktarilanAdlar(sf: ts.SourceFile): Set<string> {
  const adlar = new Set<string>();
  for (const st of sf.statements) {
    const disaAktarim = ts.canHaveModifiers(st)
      ? ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false;
    if (!disaAktarim) continue;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) adlar.add(d.name.text);
      }
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      adlar.add(st.name.text);
    }
  }
  return adlar;
}

/** Bir dosyadaki tüm enforcement çağrılarını çıkarır. */
function cagriYerleri(sf: ts.SourceFile): CagriYeri[] {
  const cikti: CagriYeri[] = [];
  const gez = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = node.expression.text;
      const kural = IZIN_FONKSIYONLARI[fn];
      if (kural !== undefined) {
        const argumanlar =
          kural === "hepsi" ? [...node.arguments] : node.arguments[kural] ? [node.arguments[kural]] : [];
        const kodlar: string[] = [];
        const cozulemeyen: string[] = [];
        for (const arg of argumanlar) {
          if (ts.isStringLiteralLike(arg)) {
            kodlar.push(arg.text);
          } else if (ts.isSpreadElement(arg) && ts.isIdentifier(arg.expression)) {
            const cozum = diziSabitiCoz(sf, arg.expression.text);
            if (cozum) kodlar.push(...cozum);
            else cozulemeyen.push(arg.getText(sf));
          } else {
            cozulemeyen.push(arg.getText(sf));
          }
        }
        cikti.push({
          dosya: goreli(sf.fileName),
          satir: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          fonksiyon: fn,
          kodlar,
          cozulemeyen,
        });
      }
    }
    ts.forEachChild(node, gez);
  };
  ts.forEachChild(sf, gez);
  return cikti;
}

async function main(): Promise<void> {
  const katalogKodlari = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));

  // ── 0) İZİN KODU BİÇİMİ — tam BİR iki nokta (2026-08-09, F-CORE-GUV-004) ────
  // `rbac.middleware.matchesPermission` domain wildcard'ını `indexOf(":")` ile,
  // yani İLK iki noktaya göre üretir. Bunun sonucu: iki kolonlu bir kod
  // (`mobile:depo:write`) eklenirse `mobile:*` taşıyan HERKES onu otomatik alır —
  // ve bu, kullanıcının atanmış izin listesinde GÖRÜNMEZ. Uzun süre kodun
  // yorumu bunun TERSİNİ söylüyordu ("mobile:* iki kolonluları kapsamaz"), yani
  // yanlış varsayımla ilerlemek kolaydı. Kural artık mekanik: yeni bir kod
  // eklerken kolon sayısı tektir; gerçekten hiyerarşi gerekiyorsa bu test
  // KIRMIZI verir ve karar (wildcard semantiğini değiştirmek mi, kodu düzleştirmek
  // mi) BİLİNÇLİ olarak verilir.
  // `as string`: katalog kodları literal union'a daralıyor ve `c !== "*"`
  // karşılaştırması TS2367 veriyor (union'da düz `"*"` yok, `"mobile:*"` var).
  const kolonIhlali = PERMISSION_CATALOG.map((p) => p.code as string).filter(
    (c) => c !== "*" && (c.match(/:/g) ?? []).length !== 1,
  );
  check(
    "her izin kodu TAM BİR iki nokta taşıyor (wildcard semantiği tek seviyeli)",
    kolonIhlali.length === 0,
    kolonIhlali.join(", "),
  );
  check(
    "körlük zemini: katalogda en az 50 kod var",
    katalogKodlari.size >= 50,
    `bulunan: ${katalogKodlari.size}`,
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 1) TARAMA — route'lar (asıl hedef) + kalan src (matchesPermission çağrıları)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n── 1) Kaynak tarama ──");

  // Primitifleri TANIMLAYAN dosya(lar) taramadan çıkarılır — ama çıkarma
  // körleştirici olmasın diye önce "hâlâ hepsini tanımlıyor mu" doğrulanır.
  const tanimlanan = new Set<string>();
  for (const dosya of TANIM_DOSYALARI) {
    const mutlak = path.join(KOK, dosya);
    if (!fs.existsSync(mutlak)) {
      check(`tanım dosyası mevcut: ${dosya}`, false, "dosya YOK — TANIM_DOSYALARI'nı güncelle");
      continue;
    }
    for (const ad of disaAktarilanAdlar(kaynakOku(mutlak))) tanimlanan.add(ad);
  }
  const tanimsizFn = Object.keys(IZIN_FONKSIYONLARI).filter((f) => !tanimlanan.has(f));
  check(
    "izlenen enforcement fonksiyonlarının hepsi tanım dosyasında duruyor",
    tanimsizFn.length === 0,
    tanimsizFn.length === 0
      ? Object.keys(IZIN_FONKSIYONLARI).join(", ")
      : `BULUNAMADI: ${tanimsizFn.join(", ")} — yeniden adlandırıldıysa IZIN_FONKSIYONLARI'nı güncelle, yoksa tarayıcı KÖR kalır`
  );

  const tanimMutlak = new Set(TANIM_DOSYALARI.map((d) => path.join(KOK, d)));
  const routeDosyalari = (fs.existsSync(ROUTES) ? tsDosyalari(ROUTES) : []).filter(
    (f) => !tanimMutlak.has(f)
  );
  const tumSrc = (fs.existsSync(SRC) ? tsDosyalari(SRC) : []).filter((f) => !tanimMutlak.has(f));
  const digerDosyalar = tumSrc.filter((f) => !f.startsWith(ROUTES + path.sep));

  const tumCagrilar: CagriYeri[] = [];
  for (const dosya of [...routeDosyalari, ...digerDosyalar]) {
    tumCagrilar.push(...cagriYerleri(kaynakOku(dosya)));
  }
  const routeCagrilari = tumCagrilar.filter((c) => c.dosya.startsWith("src/routes/"));

  check(
    "route dizini tarandı",
    routeDosyalari.length >= ASGARI_ROUTE_DOSYASI,
    `${routeDosyalari.length} dosya (asgari ${ASGARI_ROUTE_DOSYASI})`
  );
  check(
    "route'larda izin çağrısı bulundu",
    routeCagrilari.length >= ASGARI_CAGRI,
    `${routeCagrilari.length} çağrı (asgari ${ASGARI_CAGRI})`
  );
  console.log(
    `   ℹ️  route dışı ${tumCagrilar.length - routeCagrilari.length} çağrı da tarandı ` +
      `(controller/servis içi matchesPermission)`
  );

  // ── Çözülemeyen argümanlar: dinamik kaynak tablosuyla telafi edilir ──
  const cozulemeyenler = tumCagrilar.filter((c) => c.cozulemeyen.length > 0);
  const dinamikDosyalar = new Set(cozulemeyenler.map((c) => c.dosya));
  const beyanEdilmemis = [...dinamikDosyalar].filter((d) => !DINAMIK_IZIN_KAYNAKLARI[d]);

  check(
    "her izin argümanı ya statik çözüldü ya da dinamik kaynak tablosunda beyan edildi",
    beyanEdilmemis.length === 0,
    beyanEdilmemis.length === 0
      ? `${dinamikDosyalar.size} dinamik dosya beyanlı`
      : `BEYANSIZ: ${beyanEdilmemis.join(", ")}`
  );
  if (beyanEdilmemis.length > 0) {
    for (const dosya of beyanEdilmemis) {
      for (const c of cozulemeyenler.filter((x) => x.dosya === dosya)) {
        console.log(`     ${c.dosya}:${c.satir} → ${c.fonksiyon}(${c.cozulemeyen.join(", ")})`);
      }
    }
    console.log(
      "     YAPILACAK: bu dosyayı scripts/test_permission_catalog.ts içindeki\n" +
        "     DINAMIK_IZIN_KAYNAKLARI tablosuna, izin kodlarını taşıyan sabitin adıyla ekle."
    );
  }

  // Beyan edilen dinamik sabitlerden kodları topla + bayat beyanı yakala.
  const dinamikKodlar: { kod: string; kaynak: string }[] = [];
  for (const [dosya, sabitler] of Object.entries(DINAMIK_IZIN_KAYNAKLARI)) {
    const mutlak = path.join(KOK, dosya);
    if (!fs.existsSync(mutlak)) {
      check(`dinamik kaynak dosyası mevcut: ${dosya}`, false, "dosya YOK — tabloyu güncelle");
      continue;
    }
    const sf = kaynakOku(mutlak);
    for (const sabit of sabitler) {
      if (sabit.startsWith(DELEGE)) {
        // Devir: kapsamı kuran bekçi GERÇEKTEN var mı? Ölü bir devir, gerçek
        // bir kapsam boşluğunu "beyan edildi" diye gizlerdi.
        const hedef = sabit.slice(DELEGE.length);
        const bekciVar = fs.existsSync(path.join(KOK, hedef));
        check(
          `dinamik kapsam devri: ${dosya} → ${hedef}`,
          bekciVar,
          bekciVar ? "" : "devredilen bekçi dosyası YOK — devir ölü, tabloyu güncelle",
        );
        continue;
      }
      const stringler = sabittekiStringler(sf, sabit);
      if (!stringler) {
        check(`dinamik sabit çözüldü: ${dosya} → ${sabit}`, false, "sabit bulunamadı — tabloyu güncelle");
        continue;
      }
      check(`dinamik sabit çözüldü: ${dosya} → ${sabit}`, true, `${stringler.length} string literal`);
      for (const kod of stringler) dinamikKodlar.push({ kod, kaynak: `${dosya} → ${sabit}` });
    }
    if (!dinamikDosyalar.has(dosya)) {
      warnLine(
        `${dosya} artık çözülemeyen izin argümanı içermiyor — DINAMIK_IZIN_KAYNAKLARI` +
          ` tablosundan çıkarılabilir (bayat beyan).`
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2) KATALOG ⊇ KOD TABANI (zorunlu yön)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n── 2) Katalog ⊇ kod tabanı ──");

  /** kod → onu isteyen yerler (dosya:satır) */
  const kullanim = new Map<string, string[]>();
  for (const c of tumCagrilar) {
    for (const kod of c.kodlar) {
      const yerler = kullanim.get(kod) ?? [];
      yerler.push(`${c.dosya}:${c.satir}`);
      kullanim.set(kod, yerler);
    }
  }
  for (const { kod, kaynak } of dinamikKodlar) {
    const yerler = kullanim.get(kod) ?? [];
    yerler.push(kaynak);
    kullanim.set(kod, yerler);
  }

  const eksikKodlar = [...kullanim.keys()].filter((k) => !katalogKodlari.has(k)).sort();
  check(
    "kodda geçen her izin kataloğun içinde",
    eksikKodlar.length === 0,
    `${kullanim.size} benzersiz kod${eksikKodlar.length > 0 ? `, ${eksikKodlar.length} EKSİK` : ""}`
  );
  if (eksikKodlar.length > 0) {
    console.log("\n   KATALOGDA OLMAYAN İZİN KODLARI (geliştiriciye):");
    for (const kod of eksikKodlar) {
      console.log(`     • "${kod}"`);
      for (const yer of kullanim.get(kod) ?? []) console.log(`         ${yer}`);
    }
    console.log(
      "\n   YAPILACAK:\n" +
        "     a) Kod DOĞRUYSA → src/constants/permission-catalog.ts içindeki\n" +
        "        PERMISSION_CATALOG dizisine satırı ekle (code/module/category/description).\n" +
        "        Başka hiçbir yere kopyalama: seed ve boot-time uzlaştırma aynı diziyi okur,\n" +
        "        yani deploy ettiğin anda satır canlı DB'ye de gelir.\n" +
        "     b) Kod YAZIM HATASIYSA → route dosyasındaki dizgiyi düzelt.\n" +
        "   NEDEN ÖNEMLİ: katalogda olmayan bir izni isteyen endpoint'te Admin dışı\n" +
        "   HERKES 403 alır ve hata mesajı sebebi söylemez."
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3) WILDCARD SATIRLARI — katalogda GERÇEK satır olmalı
  //    `matchesPermission` "admin:*"i çalışma anında genişletir ama satırın
  //    kendisi DB'de var olmalı: wildcard bir kullanıcıya ATANAN izindir
  //    (UserPermission FK'sı gerçek bir Permission satırına bakar). Katalogdan
  //    "türetilmiş/sanal" sanılıp silinirse süper-kullanıcı atamaları yapılamaz.
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n── 3) Wildcard satırları ──");
  for (const wc of ["admin:*", "mobile:*"]) {
    check(
      `wildcard katalogda gerçek satır: ${wc}`,
      katalogKodlari.has(wc),
      "atanabilir izin — türetilmiş değil, silme"
    );
  }
  const istenenWildcard = [...kullanim.keys()].filter((k) => k.endsWith(":*") || k === "*");
  if (istenenWildcard.length > 0) {
    warnLine(
      `Endpoint wildcard İSTİYOR: ${istenenWildcard.join(", ")} — ` +
        `granüler izinle geçilemez, yalnız wildcard sahibi geçer. Bilinçli mi?`
    );
  } else {
    console.log("   ℹ️  Hiçbir endpoint wildcard İSTEMİYOR (doğru: wildcard verilir, istenmez).");
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4) DB UZLAŞTIRMASI — DB ⊇ katalog (fazlalık HATA DEĞİL)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n── 4) DB uzlaştırması ──");
  const dbSatirlari = await prisma.permission.findMany({ select: { code: true } });
  const dbKodlari = new Set(dbSatirlari.map((r) => r.code));

  if (dbKodlari.size === 0) {
    warnLine(
      "`permissions` tablosu BOŞ — bu DB hiç kurulmamış (seed koşmamış). " +
        "Katalog↔DB karşılaştırması atlandı; `npm run seed` sonrası tekrar koş."
    );
  } else {
    const dbdeEksik = PERMISSION_CATALOG.map((p) => p.code)
      .filter((c) => !dbKodlari.has(c))
      .sort();
    check(
      "DB `permissions` tablosu katalogun tamamını içeriyor",
      dbdeEksik.length === 0,
      `${dbKodlari.size} DB satırı / ${katalogKodlari.size} katalog satırı` +
        (dbdeEksik.length > 0 ? `, ${dbdeEksik.length} EKSİK` : "")
    );
    if (dbdeEksik.length > 0) {
      console.log("\n   DB'DE OLMAYAN KATALOG İZİNLERİ (geliştiriciye):");
      for (const kod of dbdeEksik) console.log(`     • "${kod}"`);
      console.log(
        "\n   ANLAMI: boot-time uzlaştırma bu veritabanında KOŞMAMIŞ.\n" +
          "     • Backend'i bir kez ayağa kaldır (uzlaştırma açılışta eksikleri yazar), ya da\n" +
          "     • uzlaştırma kodunun çağrıldığını doğrula (server.ts açılış zinciri).\n" +
          "   Bu satırlar gelmeden ilgili ekranları Admin dışı hiçbir kullanıcı göremez."
      );
    }

    // ASİMETRİ: DB'de fazladan izin olması HATA DEĞİL. Uzlaştırma yalnız EKLER;
    // kaldırılmış izinler mevcut atamaları koparmamak için DB'de bırakılır.
    const dbdeFazla = [...dbKodlari].filter((c) => !katalogKodlari.has(c)).sort();
    if (dbdeFazla.length > 0) {
      console.log(
        `   ℹ️  DB'de katalog dışı ${dbdeFazla.length} izin var — HATA DEĞİL ` +
          `(kaldırılmış izinler korunur): ${dbdeFazla.join(", ")}`
      );
    } else {
      console.log("   ℹ️  DB'de katalog dışı izin yok.");
    }
  }

  // ── Bilgi: kodda hiç istenmeyen katalog izinleri (ölü olabilir — HATA DEĞİL) ──
  const kullanilmayan = PERMISSION_CATALOG.map((p) => p.code)
    .filter((c) => !kullanim.has(c))
    .sort();
  if (kullanilmayan.length > 0) {
    console.log(
      `\n   ℹ️  Kodda hiçbir enforcement noktası İSTEMİYOR (${kullanilmayan.length}) — HATA DEĞİL,\n` +
        `      wildcard'lar ve yalnız frontend'in menü gizlemek için baktığı izinler burada olur:\n` +
        `      ${kullanilmayan.join(", ")}`
    );
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${warn > 0 ? `, ${warn} uyarı` : ""} ===`);
    if (fail > 0) {
      console.log(
        "\nDÜŞTÜYSE: yukarıdaki YAPILACAK bloklarını izle. Tek kaynak\n" +
          "src/constants/permission-catalog.ts — izin oraya yazılır, seed ve boot-time\n" +
          "uzlaştırma aynı diziyi okur. Elle SQL/script koşmak GEREKMEZ."
      );
    }
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
