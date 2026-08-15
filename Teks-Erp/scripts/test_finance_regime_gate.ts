// =============================================================================
// REJİM KAPISI BEKÇİSİ — ticaret paketinin HER ucu `requireFinanceEnabled`den
// geçiyor mu?
//
// NEDEN VAR: Ticaret paketinin (ön muhasebe + iplik + fiyat + alış siparişi)
// tek ve en önemli sözleşmesi **FABRİKA SIFIR-FARK**tır: `finance.enabled`
// KAPALI bir kurulumda bu kavramların hiçbiri var olmamalı. Bunu iki ayrı kapı
// sağlar ve İKİSİ DE gereklidir:
//
//   • REJİM  (`requireFinanceEnabled`) → "bu KURULUM bu modülü kullanıyor mu"
//   • İZİN   (`requirePermission`)     → "bu KİŞİ bunu yapabilir mi"
//
// İzin kapısı TEK BAŞINA YETMEZ ve sebebi somut: `ADMIN_FULL` şablonu tanımı
// gereği HER izni taşır. Yani rejim kapısı olmayan bir ticaret ucu, fabrikadaki
// admin'e cari deftere / çek portföyüne / iplik stoğuna yazma yolu açardı —
// menüde hiçbir şey görünmese bile, çünkü adres bilmek yeterlidir.
//
// ÖLÇÜM — kapsam TÜRETİLİR, elle listelenmez:
//   ① Ticaret-özel Prisma modellerine (`cheque`, `cariTransaction`, `yarnStock`…)
//      dokunan servis dosyaları AST ile bulunur.
//   ② Bu servisleri (transitif) import eden rota dosyaları bulunur.
//   ③ Her biri için "rejim kapısı var mı" sorulur — kapı dosyanın KENDİSİNDE
//      olabilir ya da onu MOUNT EDEN üst router'dan MİRAS alınabilir
//      (`finance-allocation.routes` → `finance.routes` emsali).
//
// Elle liste tutulsaydı, yeni bir ticaret router'ı eklendiği gün kapsam dışında
// kalırdı ve bekçi "ihlal yok" derdi — yani tam da korkulan anda susardı.
//
// ⚠️ TARAMA TS AST İLE, REGEX DEĞİL. Bu dosya yazılırken düz metin araması
// `reports.routes.ts`i "kapılı" saydı — çünkü orada `requireFinanceEnabled`
// yalnız bir AÇIKLAMA SATIRINDA geçiyor. Regex bekçi, kapısı olmayan bir
// router'ı kapılı ilan ederdi: yanlış YEŞİL, yani en tehlikeli hata.
//
// Salt-okunur: DB'ye dokunmaz, boş CI veritabanında da tam koşar.
// Koşum: npx tsx scripts/test_finance_regime_gate.ts
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const KOK = path.resolve(__dirname, "..");
const SRC = path.join(KOK, "src");
const GIRIS = path.join(SRC, "app.ts");

/**
 * TİCARET-ÖZEL Prisma model erişimcileri.
 *
 * ⚠️ Bu listeye bir model eklemeden önce sor: "fabrika kurulumunda bu tabloya
 * satır yazılması MEŞRU mu?" Meşruysa liste dışıdır. `invoice`/`payment` burada
 * çünkü ön muhasebe fabrikada KAPALI; `roll`/`order` burada DEĞİL çünkü onlar
 * üretim tarafının ana tabloları.
 */
const TICARET_MODELLERI = new Set([
  // Ön muhasebe çekirdeği
  "cariAccount",
  "cariBalance",
  "cariTransaction",
  "invoice",
  "invoiceLine",
  "payment",
  "cashBox",
  "bankAccount",
  "cashTransaction",
  "exchangeRate",
  // Paket C
  "cheque",
  "chequeEvent",
  "paymentAllocation",
  "cariPeriodClose",
  // Resmi ön muhasebe belgeleri (J2 #18). ⚠️ Bunlar OLMASA da kapsam bugün
  // türetiliyor (servisler `cariTransaction`/`cheque` okuyor) — listede
  // durmalarının sebebi İLERİSİ: yalnız bu tablolara dokunan bir servis/router
  // yazıldığı gün kapsam dışında kalmasın.
  "reconciliationLetter",
  "chequeDeliveryNote",
  "chequeDeliveryNoteItem",
  // Tam stok sayımı (J2 #19). ⚠️ Kapsam bugün ZATEN türetiliyor (servis
  // `yarnStock`/`yarnMovement` okuyor) — listede durmalarının sebebi İLERİSİ:
  // yalnız bu tablolara dokunan bir servis/router yazıldığı gün (ör. salt-okunur
  // sayım raporu) kapsam dışında kalmasın.
  "stockCount",
  "stockCountLine",
  // Paket D
  "yarnStock",
  "yarnMovement",
  "itemPrice",
  "purchaseOrder",
  "purchaseOrderLine",
]);

// -----------------------------------------------------------------------------
// MUAF LİSTESİ — gerekçeli, iki yönlü denetlenir
// -----------------------------------------------------------------------------
const MUAF: ReadonlyArray<{ dosya: string; neden: string }> = [
  {
    dosya: "routes/return.routes.ts",
    neden:
      "İade FABRİKANIN ana akışıdır (mobil iade ekranı + RollReturn) → rejim kapısı KONULAMAZ. " +
      "invoice izi tek daldan gelir (H8, 2026-08-14): `attachReturnInvoices` sayfadaki iade " +
      "gruplarına faturalanmışlık bilgisini SALT-OKUMA tek sorguyla ekler (panelin 'Satış İade " +
      "Faturası' düğmesi alana bakar). Fabrikada `returnGroupId`li fatura VAR OLAMAZ (fatura " +
      "yazan tüm uçlar rejim kapılı) → sorgu 0 satır döner, alan null kalır, davranış bayt-bayt " +
      "aynı. Yazma yüzeyi sıfır: dal hiçbir ticaret tablosuna INSERT/UPDATE üretmez. Bu muaf " +
      "2026-08-14 gecesi J1 dikişinde eklendi — kenar H8'den beri vardı ve o günkü taramada " +
      "gözden kaçmıştı (shipping.service'in statik invoice importu kaldırılınca tek başına " +
      "görünür oldu).",
  },
  {
    dosya: "routes/goods-receipt.routes.ts",
    neden:
      "Mal kabul FABRİKADA DA kullanılır (satın alınan kumaşın depo girişi) → rejim kapısı " +
      "KONULAMAZ. Ticaret alanlarına (alış fiyatı, iplik hareketi, alış siparişi bağı) " +
      "dokunan dallar servis içinde ayrıca kapılıdır; fabrika yolu bayt-bayt aynı kalır.",
  },
  {
    dosya: "routes/inventory.routes.ts",
    neden:
      "Envanter FABRİKANIN ana router'ıdır → rejim kapısı KONULAMAZ. purchaseOrder izi tek " +
      "daldan gelir (G2, 2026-08-14): `softDelete`, iptal edilen top bir mal kabul fişinden " +
      "doğduysa (`Roll.goodsReceiptId` dolu) PO rollup senkronunu tetikler. Fabrikada " +
      "goodsReceiptId'li top VAR OLAMAZ (fişi yazan tek yol goods-receipt akışı ve onun " +
      "uçları rejim kapılı) → dal tek sorgu bile koşmaz, fabrika yolu bayt-bayt aynı kalır. " +
      "Yeni yazma yüzeyi de açılmaz: senkron purchaseOrderId'yi istemciden değil topun " +
      "kendi fiş zincirinden çözer. Bekçi: test_purchase_order.ts §T (negatif sondalı).",
  },
];

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

/** Dosya ticaret-özel bir modele DOĞRUDAN dokunuyor mu (`prisma.x` / `tx.x`)? */
function ticaretModeliKullaniyor(dosya: string): string | null {
  const sf = oku(dosya);
  let bulunan: string | null = null;
  const gez = (n: ts.Node): void => {
    if (bulunan) return;
    if (ts.isPropertyAccessExpression(n) && TICARET_MODELLERI.has(n.name.text)) {
      const o = n.expression;
      const kok = ts.isIdentifier(o) ? o.text : ts.isPropertyAccessExpression(o) ? o.name.text : "";
      if (kok === "prisma" || kok === "tx" || kok === "client" || kok === "db") {
        bulunan = n.name.text;
        return;
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return bulunan;
}

/**
 * Dosya (ya da transitif SERVİS bağımlılıkları) ticaret modeline dokunuyor mu?
 *
 * ⚠️ ALT ROUTER'LAR ZİNCİRE GİRMEZ (`.routes.ts` atlanır) ve bu kural
 * load-bearing: `reports.routes.ts` yalnız bir TOPLAYICIDIR — kendi handler'ı
 * yoktur, yedi domain router'ını mount eder. Alt router üzerinden "ticarete
 * dokunuyor" sayılsaydı, kapıyı toplayıcıya takmak gerekirdi ve o kapı
 * üretim/kalite/stok raporlarını da rejime bağlayıp fabrikada kapatırdı.
 * Doğru yer alt router'ın KENDİSİDİR (`finance.report.routes.ts` orada taşıyor);
 * her router bağımsız bir birim olarak değerlendirilir.
 *
 * (Bu satır ilk yazımda yoktu ve bekçi tam da bu yüzden yanlış pozitif verdi —
 * kaydı burada duruyor ki "gereksiz optimizasyon" diye silinmesin.)
 */
function ticaretDokunuyorTransitif(giris: string, derinlik = 3): string | null {
  const gorulen = new Set<string>();
  let kuyruk: Array<{ f: string; d: number }> = [{ f: giris, d: 0 }];
  while (kuyruk.length) {
    const { f, d } = kuyruk.shift() as { f: string; d: number };
    if (gorulen.has(f)) continue;
    gorulen.add(f);
    const m = ticaretModeliKullaniyor(f);
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
}

/** Dosya `requireFinanceEnabled`i GERÇEKTEN çağırıyor mu (yorumda geçmesi sayılmaz)? */
function rejimKapisiVar(dosya: string): boolean {
  const sf = oku(dosya);
  let var_ = false;
  const gez = (n: ts.Node): void => {
    if (var_) return;
    // `router.use(verifyToken, requireFinanceEnabled)` ya da route argümanı
    if (ts.isIdentifier(n) && n.text === "requireFinanceEnabled") {
      // Yalnız import bildiriminde geçiyorsa saymayız — çağrı/argüman olmalı.
      const p = n.parent;
      if (!ts.isImportSpecifier(p) && !ts.isImportClause(p)) var_ = true;
      return;
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return var_;
}

/** `A.use(..., B)` kenarları — mount grafiği (test_route_mount_reachability ile aynı mantık). */
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

function tumRouterlar(): string[] {
  const cikti: string[] = [];
  const yuru = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const tam = path.join(dir, e.name);
      if (e.isDirectory()) yuru(tam);
      else if (e.name.endsWith(".routes.ts")) cikti.push(tam);
    }
  };
  yuru(path.join(SRC, "routes"));
  return cikti.sort();
}

async function main(): Promise<void> {
  console.log("=== REJİM KAPISI BEKÇİSİ (fabrika sıfır-fark) ===\n");

  const routerlar = tumRouterlar();

  // Mount grafiği: her router için "beni kim mount etti" (ebeveyn zinciri).
  const ebeveyn = new Map<string, string[]>();
  const tumDosyalar = [GIRIS, ...routerlar];
  for (const f of tumDosyalar) {
    for (const c of mountEdilenler(f)) {
      ebeveyn.set(c, [...(ebeveyn.get(c) ?? []), f]);
    }
  }

  /** Kapı dosyanın kendisinde ya da MOUNT EDEN zincirde var mı? */
  const kapiliMi = (f: string, gorulen = new Set<string>()): boolean => {
    if (gorulen.has(f)) return false;
    gorulen.add(f);
    if (rejimKapisiVar(f)) return true;
    return (ebeveyn.get(f) ?? []).some((p) => p !== GIRIS && kapiliMi(p, gorulen));
  };

  const ticaretRouterlari = routerlar
    .map((f) => ({ f, model: ticaretDokunuyorTransitif(f) }))
    .filter((x) => x.model !== null);

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  // Türetme boşa düşerse ("hiç ticaret router'ı bulunamadı") sonuç "ihlal yok"
  // ile AYNI yeşile çıkardı — model adları değişir ya da tarayıcı kırılırsa.
  check("§1a Körlük zemini: router dosyaları tarandı", routerlar.length >= 40, `router=${routerlar.length}`);
  check(
    "§1b Körlük zemini: ticaret-özel router'lar TÜRETİLEBİLDİ",
    ticaretRouterlari.length >= 5,
    `bulunan=${ticaretRouterlari.length} → ${ticaretRouterlari.map((x) => path.basename(x.f)).join(", ")}`,
  );

  // ── §2 ⭐ ASIL KONTROL ────────────────────────────────────────────────────
  const muafSet = new Set(MUAF.map((m) => path.join(SRC, m.dosya)));
  const kapisiz = ticaretRouterlari.filter((x) => !muafSet.has(x.f) && !kapiliMi(x.f));
  check(
    "§2 ⭐ Ticaret modeline dokunan HER router rejim kapısı taşıyor",
    kapisiz.length === 0,
    kapisiz.length === 0
      ? `${ticaretRouterlari.length - muafSet.size} router kapılı`
      : `KAPISIZ: ${kapisiz.map((x) => `${path.relative(SRC, x.f)} (→ ${x.model})`).join(", ")} — ` +
        `router'a \`router.use(verifyToken, requireFinanceEnabled)\` ekle ya da rejim kapısı ` +
        `taşıyan bir üst router'ın İÇİNE mount et`,
  );

  // ── §3 MUAF LİSTESİ BAYATLIK DENETİMİ (iki yönlü) ─────────────────────────
  const olu = MUAF.filter((m) => !fs.existsSync(path.join(SRC, m.dosya)));
  check("§3a Muaf listesinde ölü satır yok", olu.length === 0, olu.map((m) => m.dosya).join(", "));
  const gereksiz = MUAF.filter((m) => {
    const f = path.join(SRC, m.dosya);
    return fs.existsSync(f) && (kapiliMi(f) || ticaretDokunuyorTransitif(f) === null);
  });
  check(
    "§3b Muaf listesinde gereksiz satır yok (artık kapılı ya da ticarete dokunmuyor)",
    gereksiz.length === 0,
    gereksiz.map((m) => m.dosya).join(", "),
  );
  const gerekcesiz = MUAF.filter((m) => !m.neden || m.neden.trim().length < 20);
  check("§3c Her muafın GEREKÇESİ yazılı", gerekcesiz.length === 0, gerekcesiz.map((m) => m.dosya).join(", "));
  for (const m of MUAF) console.log(`   ℹ️  muaf: ${m.dosya} — ${m.neden}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE: kapısız bir ticaret ucu, FABRİKADAKİ ADMİN'e (ADMIN_FULL tanımı\n" +
        "gereği her izni taşır) cari deftere / çek portföyüne / iplik stoğuna yazma\n" +
        "yolu açar — menüde hiçbir şey görünmese bile, çünkü adres bilmek yeterlidir.\n" +
        "Doğru tepki muaf listesine satır eklemek DEĞİL, kapıyı takmaktır.",
    );
  }
  process.exit(fail > 0 ? 1 : 0);
}

void main();
