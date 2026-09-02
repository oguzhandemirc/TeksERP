// =============================================================================
// ORTAK REJİM KAPISI TARAYICISI (bekçi altyapısı — test DEĞİL)
// =============================================================================
// `test_finance_regime_gate.ts` 2026-08-14'te tek bir modül (ön muhasebe) için
// yazılmıştı. 2026-09-02'de modül anahtarları dörde çıkınca (ticaret · iplik ·
// çoklu depo · üretim) aynı 250 satırlık AST taraması dört kez kopyalanacaktı.
// Kopya bekçi, bekçilerin en kötü cinsidir: kopyalardan biri düzeltilir,
// diğerleri eski mantıkla YEŞİL kalmaya devam eder.
//
// ⚠️ JENERİK BEKÇİ SERBEST, JENERİK MIDDLEWARE YASAK. Bu ayrım load-bearing:
// kapı varlığı middleware'in ADIYLA (AST identifier) ölçülüyor. Kapılar
// `requireModule("ticaret")` gibi jenerik bir fabrikaya çevrilirse bu tarayıcı
// HİÇBİR kapı bulamaz ve tüm router'ları "kapısız" ilan eder — ya da daha
// kötüsü, `kapiliMi` gevşetilirse kapısız router "kapılı" görünür (yanlış
// YEŞİL). Tarayıcının parametrik olması bu kuralı zayıflatmaz: her bekçi
// KENDİ kapı adını verir, ad hâlâ koda yazılıdır.
//
// ⚠️ TARAMA TS AST İLE, REGEX DEĞİL (finans bekçisinin ölçülmüş dersi):
// `reports.routes.ts` düz metin aramasında "kapılı" çıkıyordu, çünkü orada
// `requireFinanceEnabled` yalnız bir AÇIKLAMA SATIRINDA geçiyor.
//
// Salt-okunur: DB'ye dokunmaz, HTTP atmaz — boş CI veritabanında da tam koşar.
//
// TÜKETİCİLER: test_finance_regime_gate · test_ticaret_regime_gate ·
// test_iplik_regime_gate · test_depo_multi_regime_gate ·
// test_production_regime_gate · test_module_flag_off · test_module_flags ·
// test_module_grandfathering (son üçü dosyanın SONUNDAKİ "modül kapısı özel
// yardımcıları" bölümünü kullanır — AST gövde/önbellek/`forbidden` analizi ve
// migration damga ayrıştırıcısı).
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

export interface RejimTaramaGirdisi {
  /** `src` kökü (mutlak yol). */
  src: string;
  /**
   * Bu rejime ÖZEL Prisma model erişimcileri (`prisma.<ad>` / `tx.<ad>`).
   *
   * ⚠️ Bir model eklemeden önce sor: "bu modülü KULLANMAYAN bir kurulumda bu
   * tabloya satır yazılması MEŞRU mu?" Meşruysa liste dışıdır.
   */
  modeller: ReadonlySet<string>;
  /**
   * Kabul edilen kapı middleware ADLARI. Çoğu bekçide TEK ad; bağımlılıklı
   * modüllerde (iplik ⊂ ticaret) birden çok ad kabul edilebilir.
   *
   * ⚠️ Listeyi genişletmek muaf listelerini bayatlatır: bir router "artık
   * kapılı" sayılınca ona ait muaf satırı §3b'de "gereksiz" olur (bilinçli —
   * ölü muaf sessiz kalmasın).
   */
  kapiAdlari: readonly string[];
  /** Transitif import derinliği. Varsayılan 3 = finans bekçisinin ölçülmüş değeri. */
  derinlik?: number;
}

export interface RejimTarama {
  /** `src/routes` altındaki tüm `*.routes.ts` (mutlak, sıralı). */
  routerlar: string[];
  /** Mount grafiğinin kökü (`src/app.ts`). */
  girisDosyasi: string;
  /** Dosya (ya da transitif servis bağımlılıkları) rejim modeline dokunuyor mu? */
  modelDokunusu(dosya: string): string | null;
  /** Kapı DOSYANIN KENDİSİNDE mi (yorumda geçmesi ve salt import SAYILMAZ)? */
  kapiDosyadaVar(dosya: string): boolean;
  /** Kapı kendisinde ya da MOUNT EDEN zincirde var mı? */
  kapiliMi(dosya: string): boolean;
  /** Rejim modeline dokunan router'lar (dokunulan model adıyla). */
  ilgiliRouterlar(): Array<{ f: string; model: string }>;
}

function oku(dosya: string): ts.SourceFile {
  return ts.createSourceFile(dosya, fs.readFileSync(dosya, "utf8"), ts.ScriptTarget.Latest, true);
}

function cozYol(kaynak: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const taban = path.resolve(path.dirname(kaynak), spec);
  for (const aday of [`${taban}.ts`, path.join(taban, "index.ts")]) {
    if (fs.existsSync(aday)) return aday;
  }
  return null;
}

/** Dosyanın YEREL import ettiği modüller (mutlak yol). */
function yerelImportlar(dosya: string): string[] {
  const sf = oku(dosya);
  const cikti: string[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const h = cozYol(dosya, n.moduleSpecifier.text);
      if (h) cikti.push(h);
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return cikti;
}

/** `A.use(..., B)` kenarları — mount grafiği. */
function mountEdilenler(dosya: string): string[] {
  const sf = oku(dosya);
  const imp = new Map<string, string>();
  const kullanilan = new Set<string>();
  const gez = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const h = cozYol(dosya, n.moduleSpecifier.text);
      if (h && n.importClause?.name) imp.set(n.importClause.name.text, h);
    }
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isPropertyAccessExpression(e) && e.name.text === "use") {
        for (const a of n.arguments) if (ts.isIdentifier(a)) kullanilan.add(a.text);
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  const out: string[] = [];
  for (const ad of kullanilan) {
    const h = imp.get(ad);
    if (h) out.push(h);
  }
  return out;
}

/** `src/routes` altındaki tüm router dosyaları. */
export function tumRouterlar(src: string): string[] {
  const cikti: string[] = [];
  const yuru = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const tam = path.join(dir, e.name);
      if (e.isDirectory()) yuru(tam);
      else if (e.name.endsWith(".routes.ts")) cikti.push(tam);
    }
  };
  yuru(path.join(src, "routes"));
  return cikti.sort();
}

export function rejimTaramasiKur(g: RejimTaramaGirdisi): RejimTarama {
  const SRC = g.src;
  const GIRIS = path.join(SRC, "app.ts");
  const derinlik = g.derinlik ?? 3;
  const routerlar = tumRouterlar(SRC);

  /** Dosya rejim modeline DOĞRUDAN dokunuyor mu (`prisma.x` / `tx.x`)? */
  const modelKullaniyor = (dosya: string): string | null => {
    const sf = oku(dosya);
    let bulunan: string | null = null;
    const gez = (n: ts.Node): void => {
      if (bulunan) return;
      if (ts.isPropertyAccessExpression(n) && g.modeller.has(n.name.text)) {
        const o = n.expression;
        const kok = ts.isIdentifier(o)
          ? o.text
          : ts.isPropertyAccessExpression(o)
            ? o.name.text
            : "";
        if (kok === "prisma" || kok === "tx" || kok === "client" || kok === "db") {
          bulunan = n.name.text;
          return;
        }
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
    return bulunan;
  };

  /**
   * ⚠️ ALT ROUTER'LAR ZİNCİRE GİRMEZ (`.routes.ts` atlanır) ve bu kural
   * load-bearing: `reports.routes.ts` yalnız bir TOPLAYICIDIR — kendi
   * handler'ı yoktur, yedi domain router'ını mount eder. Alt router üzerinden
   * "dokunuyor" sayılsaydı kapıyı toplayıcıya takmak gerekirdi ve o kapı
   * üretim/kalite/stok raporlarını da rejime bağlardı. Doğru yer alt
   * router'ın KENDİSİDİR; her router bağımsız bir birim olarak değerlendirilir.
   */
  const modelDokunusu = (giris: string): string | null => {
    const gorulen = new Set<string>();
    let kuyruk: Array<{ f: string; d: number }> = [{ f: giris, d: 0 }];
    while (kuyruk.length) {
      const { f, d } = kuyruk.shift() as { f: string; d: number };
      if (gorulen.has(f)) continue;
      gorulen.add(f);
      const m = modelKullaniyor(f);
      if (m) return m;
      if (d < derinlik) {
        kuyruk = kuyruk.concat(
          yerelImportlar(f)
            .filter((x) => !x.endsWith(".routes.ts"))
            .map((x) => ({ f: x, d: d + 1 })),
        );
      }
    }
    return null;
  };

  /** Kapı adlarından biri dosyada GERÇEKTEN çağrılıyor mu? */
  const kapiDosyadaVar = (dosya: string): boolean => {
    const sf = oku(dosya);
    let var_ = false;
    const gez = (n: ts.Node): void => {
      if (var_) return;
      if (ts.isIdentifier(n) && g.kapiAdlari.includes(n.text)) {
        // Yalnız import bildiriminde geçiyorsa saymayız — çağrı/argüman olmalı.
        const p = n.parent;
        if (!ts.isImportSpecifier(p) && !ts.isImportClause(p)) var_ = true;
        return;
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
    return var_;
  };

  // Mount grafiği: her router için "beni kim mount etti" (ebeveyn zinciri).
  const ebeveyn = new Map<string, string[]>();
  for (const f of [GIRIS, ...routerlar]) {
    for (const c of mountEdilenler(f)) {
      ebeveyn.set(c, [...(ebeveyn.get(c) ?? []), f]);
    }
  }

  const kapiliMi = (f: string, gorulen = new Set<string>()): boolean => {
    if (gorulen.has(f)) return false;
    gorulen.add(f);
    if (kapiDosyadaVar(f)) return true;
    return (ebeveyn.get(f) ?? []).some((p) => p !== GIRIS && kapiliMi(p, gorulen));
  };

  return {
    routerlar,
    girisDosyasi: GIRIS,
    modelDokunusu,
    kapiDosyadaVar,
    kapiliMi: (f) => kapiliMi(f),
    ilgiliRouterlar: () =>
      routerlar
        .map((f) => ({ f, model: modelDokunusu(f) }))
        .filter((x): x is { f: string; model: string } => x.model !== null),
  };
}

// -----------------------------------------------------------------------------
// METİN AYAĞI — kapının SIRASI (AST değil, bilerek)
// -----------------------------------------------------------------------------
// Express kayıt sırası yüzünden `router.use`tan ÖNCE tanımlı bir uç kapıyı HİÇ
// görmez ve bu sızıntı ne hata ne log üretir (`test_yarn_stock` §9c'nin ölçtüğü
// şey). Sıra bir KAYNAK SIRASI olgusudur; AST'de de ölçülebilirdi ama metin
// ölçümü hem daha okunaklı hem de kırmızı mesajı somut satır numarası verir.
//
// ⚠️ YORUM AYIKLAMA SIRASI LOAD-BEARING: önce satır yorumu, sonra blok. Ters
// sırada bir blok yorumunun içindeki `//` satırı erken tüketilir. `[^:]`
// koruması `http://` gibi URL'leri satır yorumu sanmayı önler.
export function yorumlariSok(src: string): string {
  return src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

export interface RouterKapiOlcumu {
  /** `<router>.use(verifyToken, <kapı>)` satırı bulundu mu? */
  kapiVar: boolean;
  /** Kapıyı taşıyan router DEĞİŞKENİNİN adı (`router`, `travelerCardRouter`…). */
  routerAdi: string | null;
  kapiIdx: number;
  /** Aynı router değişkeninin uç tanımları (karakter ofseti). */
  ucIdx: number[];
  ucSayisi: number;
  /** Kimlik kapısı rejim kapısından ÖNCE mi (kimliksiz istek 401 alır, 403 değil)? */
  kimlikOnce: boolean;
  /** O router'ın HER ucu kapıdan SONRA mı tanımlı? */
  hepsiKapidanSonra: boolean;
}

/**
 * Bir route dosyasında adlandırılmış rejim kapısının konumunu ölçer.
 *
 * ⚠️ ROUTER DEĞİŞKENİ BAZLIDIR, dosya bazlı DEĞİL: `traveler-card.routes.ts`
 * İKİ router taşır (`workOrderTravelerRouter` iş-emri kapsamlı olduğu için
 * kapıyı `workorder.routes`tan MİRAS alır, `travelerCardRouter` kendi kapısını
 * taşır). Dosya bazlı ölçüm, miras alan router'ın uçlarını "kapıdan önce
 * tanımlı" diye sayar ve HAKLI bir tasarımı kırmızı yapardı.
 */
export function routerKapiOlcumu(dosyaYolu: string, kapiAdi: string): RouterKapiOlcumu {
  const kod = yorumlariSok(fs.readFileSync(dosyaYolu, "utf8"));
  const kapiRe = new RegExp(
    `([A-Za-z_$][\\w$]*)\\.use\\(\\s*verifyToken\\s*,\\s*${kapiAdi}\\s*\\)`,
  );
  const m = kapiRe.exec(kod);
  if (!m) {
    // Kapı var ama `verifyToken`sız olabilir — o zaman "kimlikÖnce" false.
    const yalinRe = new RegExp(`([A-Za-z_$][\\w$]*)\\.use\\([^)]*\\b${kapiAdi}\\b`);
    const y = yalinRe.exec(kod);
    const ad = y?.[1] ?? null;
    const authIdx = ad ? kod.indexOf(`${ad}.use(verifyToken`) : -1;
    return {
      kapiVar: false,
      routerAdi: ad,
      kapiIdx: y?.index ?? -1,
      ucIdx: [],
      ucSayisi: 0,
      kimlikOnce: authIdx >= 0 && y !== null && authIdx < y.index,
      hepsiKapidanSonra: false,
    };
  }
  const routerAdi = m[1]!;
  const kapiIdx = m.index;
  const ucRe = new RegExp(`${routerAdi}\\.(get|post|patch|put|delete)\\(`, "g");
  const ucIdx = [...kod.matchAll(ucRe)].map((x) => x.index!);
  return {
    kapiVar: true,
    routerAdi,
    kapiIdx,
    ucIdx,
    ucSayisi: ucIdx.length,
    kimlikOnce: true,
    hepsiKapidanSonra: ucIdx.every((i) => i > kapiIdx),
  };
}

// =============================================================================
// MODÜL KAPISI ÖZEL YARDIMCILARI (2026-09-02 düzeltme turu — D1/D2 kör noktaları)
// =============================================================================
// NEDEN BURADA: aşağıdaki üç ölçüm İKİ bekçi tarafından da kullanılıyor
// (`test_module_flag_off` + `test_module_flags`, damga ayrıştırıcısını ise
// `test_module_grandfathering` de). Aynı yüklemi iki dosyaya kopyalamak, bu
// dosyanın başlığındaki "kopya bekçi, bekçilerin en kötü cinsidir" kuralının
// ihlali olurdu.
//
// NEDEN AST, NEDEN METİN DEĞİL — üçü de ÖLÇÜLMÜŞ kör noktadır:
//   ① Kapı YANLIŞ bayrağı okuyabiliyordu (`requireTicaretEnabled` içinde
//      `readIplikEnabled()`): metin ayağı "okuyucu çağrısı var mı" diye baktığı
//      ve gövde penceresi bir sonraki fonksiyona taştığı için 240 kontrolün
//      HİÇBİRİ görmedi.
//   ② "cache" SÖZCÜĞÜ geçmeyen gerçek bir önbellek konulabiliyordu
//      (`let ticaretBellegi …` + `Date.now()`): kelime tabanlı yüklem dile
//      bağlıdır, YAPI bağlı değildir.
//   ③ `code` bir seviye derine sarılabiliyordu (`{ details: { code … } }`):
//      metin hâlâ dosyada olduğu için kontrol yeşil kalıyor, istemcinin
//      okuduğu `details.code` ise `undefined` oluyordu.
// =============================================================================

/** Bir `read*Enabled(` çağrısının, ait olduğu fonksiyon gövdesindeki konumu. */
export interface OkuyucuCagrisi {
  ad: string;
  /** Çağrı bir `if`/`?:`/`&&`/`||`/`??` altında mı (yani KOŞULLU mu)? */
  kosullu: boolean;
  /** Çağrıya argüman geçilmiş mi (`readXEnabled(tx)` → cache/bayat okuma riski)? */
  argumanli: boolean;
}

export interface MiddlewareGovdeAnalizi {
  bulundu: boolean;
  okuyucular: OkuyucuCagrisi[];
}

/**
 * `export async function <ad>(…) { … }` gövdesindeki `read*Enabled(` çağrılarını
 * AST ile çıkarır.
 *
 * ⚠️ GÖVDE SINIRI AST'DEN GELİR — sabit karakter penceresi DEĞİL. Ölçülmüş
 * hata: 1600 karakterlik pencere `requireTicaretEnabled`ten taşıp bir alttaki
 * `requireIplikEnabled`in `readTicaretEnabled()` çağrısını görüyor ve kapı
 * yanlış bayrağı okusa bile YEŞİL kalıyordu.
 *
 * ⚠️ KOŞULLULUK NEDEN ÖLÇÜLÜYOR: bir önbellek eklemenin tek yolu okumayı bir
 * `if`in içine almaktır (`if (!bellek || eski) bellek = await readX()`).
 * Çağrının VARLIĞI o durumda da doğrudur; yalan olan "her istekte okunuyor"
 * iddiasıdır. `try/catch` serbesttir (koşul değil, hata yolu).
 */
export function middlewareGovdeAnalizi(
  dosyaYolu: string,
  fonksiyonAdi: string,
): MiddlewareGovdeAnalizi {
  const sf = ts.createSourceFile(
    dosyaYolu,
    fs.readFileSync(dosyaYolu, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let hedef: ts.FunctionDeclaration | null = null;
  const bul = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === fonksiyonAdi) hedef = n;
    ts.forEachChild(n, bul);
  };
  bul(sf);
  if (!hedef) return { bulundu: false, okuyucular: [] };

  const govde = (hedef as ts.FunctionDeclaration).body;
  if (!govde) return { bulundu: false, okuyucular: [] };

  const okuyucular: OkuyucuCagrisi[] = [];
  const gez = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      /^read[A-Z][A-Za-z0-9]*Enabled$/.test(n.expression.text)
    ) {
      let p: ts.Node | undefined = n.parent;
      let kosullu = false;
      while (p && p !== govde) {
        if (
          ts.isIfStatement(p) ||
          ts.isConditionalExpression(p) ||
          (ts.isBinaryExpression(p) &&
            (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
              p.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
              p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
        ) {
          kosullu = true;
          break;
        }
        p = p.parent;
      }
      okuyucular.push({
        ad: n.expression.text,
        kosullu,
        argumanli: n.arguments.length > 0,
      });
    }
    ts.forEachChild(n, gez);
  };
  gez(govde);
  return { bulundu: true, okuyucular };
}

export interface DurumTasiyiciBulgusu {
  /** Dosya düzeyinde mutable/durum taşıyıcı bildirimler (`let x`, `const c = {}`). */
  durumBildirimleri: string[];
  /** Zaman tabanlı TTL izleri (`Date.now(`, `setTimeout(`, `performance.now(`). */
  zamanIzleri: string[];
}

/**
 * Dosya DÜZEYİNDE önbellek YAPISI var mı?
 *
 * ⚠️ KELİME DEĞİL YAPI: `cache` sözcüğünü hiç kullanmayan (`ticaretBellegi`,
 * `memo`, `_c`) gerçek bir 30 sn TTL önbelleği ölçüm sırasında konuldu ve
 * kelime tabanlı yüklem onu GÖRMEDİ; kapı bayrak kapatıldıktan sonra ~24 sn
 * daha AÇIK kaldı. Modül düzeyi mutable durum, önbellek yazmanın TEK yoludur.
 *
 * ⚠️ Sabit `const` string/sayı SERBEST (mesaj metni, anahtar adı); yasak olan
 * obje/dizi/`Map`/`Set` literali ve `let`/`var` — çünkü onlar DEĞER TAŞIR.
 */
export function dosyaDuzeyiDurumTasiyicilari(dosyaYolu: string): DurumTasiyiciBulgusu {
  const kaynak = fs.readFileSync(dosyaYolu, "utf8");
  const sf = ts.createSourceFile(dosyaYolu, kaynak, ts.ScriptTarget.Latest, true);
  const durumBildirimleri: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    const liste = st.declarationList;
    const sabit = (liste.flags & ts.NodeFlags.Const) !== 0;
    for (const d of liste.declarations) {
      const ad = ts.isIdentifier(d.name) ? d.name.text : "(desen)";
      if (!sabit) {
        durumBildirimleri.push(`let/var ${ad}`);
        continue;
      }
      const init = d.initializer;
      if (!init) continue;
      const fonksiyon =
        ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isClassExpression(init);
      const duzSabit =
        ts.isStringLiteral(init) ||
        ts.isNumericLiteral(init) ||
        init.kind === ts.SyntaxKind.TrueKeyword ||
        init.kind === ts.SyntaxKind.FalseKeyword ||
        ts.isNoSubstitutionTemplateLiteral(init) ||
        ts.isTemplateExpression(init);
      if (!fonksiyon && !duzSabit) durumBildirimleri.push(`const ${ad} = <değer taşıyıcı>`);
    }
  }
  const kod = yorumlariSok(kaynak);
  const zamanIzleri = ["Date.now(", "setTimeout(", "setInterval(", "performance.now("].filter((z) =>
    kod.includes(z),
  );
  return { durumBildirimleri, zamanIzleri };
}

export interface ForbiddenCagrisi {
  /** 2. argüman doğrudan bir nesne literali mi? */
  nesneLiterali: boolean;
  /** Nesnenin DOĞRUDAN `code` özelliğinin string değeri (varsa). */
  kod: string | null;
  /** Nesnede `details` adlı bir özellik var mı (bir seviye derine sarma)? */
  detailsSarmasi: boolean;
  /** Nesnenin DOĞRUDAN `modul` özelliğinin string değeri (varsa). */
  modul: string | null;
}

/**
 * Dosyadaki tüm `AppError.forbidden(mesaj, { … })` çağrılarının ikinci
 * argümanını AST ile okur.
 *
 * ⚠️ NEDEN AST: `{ details: { code: "MODULE_DISABLED" } }` yazımı metin
 * aramasını YEŞİL bırakır (`code: "MODULE_DISABLED"` hâlâ dosyada) ama
 * `error.middleware` `details`i olduğu gibi bastığı için gövde
 * `details.details.code` olur ve istemcinin belgelenmiş okuma kalıbı
 * (`e?.details?.code`) `undefined` görür — panel "modül kapalı" ile "yetkin
 * yok" farkını ayırt EDEMEZ.
 */
export function forbiddenCagrilari(dosyaYolu: string): ForbiddenCagrisi[] {
  const sf = ts.createSourceFile(
    dosyaYolu,
    fs.readFileSync(dosyaYolu, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const cikti: ForbiddenCagrisi[] = [];
  const metin = (v: ts.Expression | undefined): string | null =>
    v && ts.isStringLiteral(v) ? v.text : null;
  const gez = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "forbidden"
    ) {
      const arg = n.arguments[1];
      if (!arg || !ts.isObjectLiteralExpression(arg)) {
        cikti.push({ nesneLiterali: false, kod: null, detailsSarmasi: false, modul: null });
      } else {
        const alan = (ad: string): ts.PropertyAssignment | undefined =>
          arg.properties.find(
            (p): p is ts.PropertyAssignment =>
              ts.isPropertyAssignment(p) &&
              (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
              p.name.text === ad,
          );
        cikti.push({
          nesneLiterali: true,
          kod: metin(alan("code")?.initializer),
          detailsSarmasi: alan("details") !== undefined,
          modul: metin(alan("modul")?.initializer),
        });
      }
      return;
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return cikti;
}

/**
 * Grandfathering migration'ının DAMGALADIĞI anahtarlar → değer İFADESİ.
 *
 * Damga satırları `('<key>', <değer ifadesi>, '<açıklama>')` biçiminde VALUES
 * demetleridir. Bu ayrıştırıcı yalnız DEMET biçimini sayar; bir anahtarın SQL
 * metninde başka bir yerde geçmesi (örn. `WHERE "key" = 'finance.enabled'`
 * okuması) damga SAYILMAZ — ayrım load-bearing, çünkü ticaret/iplik değeri
 * artık `finance.enabled`i OKUYARAK türetiliyor ve "okunan" ile "yazılan"
 * karıştırılırsa migration muaf listesi (`MIGRASYON_DISI`) yanlış kırmızı verir.
 *
 * ⚠️ Değer ifadesi, açıklama metninin başladığı yerde kesilir: açıklamalar
 * `'` + BÜYÜK HARF ile başlar, değer ifadeleri ise (`'true'::jsonb`,
 * `to_jsonb(...)`, `'finance.enabled'`) başlamaz.
 */
export function migrationDamgaDegerleri(sqlHam: string): Map<string, string> {
  const sql = sqlHam.replace(/--.*$/gm, "");
  const out = new Map<string, string>();
  const re = /\(\s*'([A-Za-z][A-Za-z0-9.]*\.[A-Za-z][A-Za-z0-9]*)'\s*,/g;
  for (const m of sql.matchAll(re)) {
    const anahtar = m[1]!;
    const bas = m.index! + m[0].length;
    const pencere = sql.slice(bas, bas + 600);
    const aciklamaIdx = pencere.search(/'[A-ZÇĞİÖŞÜ]/);
    out.set(anahtar, (aciklamaIdx >= 0 ? pencere.slice(0, aciklamaIdx) : pencere).trim());
  }
  return out;
}

export interface ModulKoduIzleri {
  /** `modulKapali("<kod>", …)` çağrılarının ilk (string literal) argümanları. */
  modulKapali: string[];
  /** Doğrudan `AppError.forbidden(msg, { modul: "<kod>" })` çağrılarındaki `modul` değerleri. */
  forbiddenModul: string[];
}

/**
 * `require<X>Enabled` gövdesinde 403'e basılan MODÜL KODLARI (statik).
 *
 * ⚠️ NEDEN: dört kapı gövdesi birbirinin kopyası; `modulKapali("production", …)`
 * yerine `modulKapali("ticaret", …)` yazmak gerçekçi bir kopyala-yapıştır
 * hatasıdır ve ölçüldü: HTTP ayağı yalnız sunucu BOZUK kodla yeniden
 * başlatılınca görüyordu, statik ayak KÖRDÜ (V minor #1, 2026-09-03).
 * Operatör "Ticaret modülü kapalı" okuyup yanlış şalteri açardı.
 */
export function modulKoduIzleri(dosyaYolu: string, fonksiyonAdi: string): ModulKoduIzleri {
  const sf = ts.createSourceFile(
    dosyaYolu,
    fs.readFileSync(dosyaYolu, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let hedef: ts.FunctionDeclaration | null = null;
  const bul = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === fonksiyonAdi) hedef = n;
    ts.forEachChild(n, bul);
  };
  bul(sf);
  const out: ModulKoduIzleri = { modulKapali: [], forbiddenModul: [] };
  const govde = (hedef as ts.FunctionDeclaration | null)?.body;
  if (!govde) return out;
  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression) && n.expression.text === "modulKapali") {
        const a0 = n.arguments[0];
        if (a0 && ts.isStringLiteral(a0)) out.modulKapali.push(a0.text);
      }
      if (
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "forbidden"
      ) {
        const a1 = n.arguments[1];
        if (a1 && ts.isObjectLiteralExpression(a1)) {
          for (const p of a1.properties) {
            if (
              ts.isPropertyAssignment(p) &&
              ts.isIdentifier(p.name) &&
              p.name.text === "modul" &&
              ts.isStringLiteral(p.initializer)
            ) {
              out.forbiddenModul.push(p.initializer.text);
            }
          }
        }
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(govde);
  return out;
}
