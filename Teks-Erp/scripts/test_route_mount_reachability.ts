// =============================================================================
// ROUTER ERİŞİLEBİLİRLİK BEKÇİSİ — yazılmış her router GERÇEKTEN bağlı mı?
//
// NEDEN VAR (2026-08-14, saha vakası): Paket C'de iki router dosyası tam
// yazıldı, Zod şemaları, izin guard'ları, Swagger JSDoc'ları, hatta KENDİ
// BEKÇİLERİ de yeşildi — ama `finance-period.routes.ts` `app.ts`'e,
// `reports/finance.report.routes.ts` de `reports.routes.ts`'e HİÇ BAĞLANMAMIŞTI.
// Dokuz uç ölüydü ve bunu HİÇBİR bekçi görmedi:
//
//   • `test_finance_reports` §10 rota dosyasını AÇIP içine bakıyordu
//     ("/aging ucu tanımlı" ✅) — yani DOSYANIN İÇERİĞİNİ ölçüyordu,
//     ERİŞİLEBİLİRLİĞİNİ değil. Bu ayrım bu dosyanın var oluş sebebidir.
//   • `test_permission_catalog` route dosyalarını tarar, ama "bu izin katalogda
//     var mı" diye sorar — dosyanın bağlı olup olmadığını sormaz.
//   • Tip kontrolü de göremez: bağlanmamış router mükemmel derlenir.
//
// Belirti sahada şudur: panel ekranı açılır, istek gider, **404** döner ve
// hiçbir log "bu router bağlı değil" demez — çünkü teknik olarak hata yoktur.
//
// ÖLÇÜM: `app.ts`ten başlayan TRANSİTİF erişilebilirlik grafiği.
//   düğüm = dosya · kenar = "A dosyası B'yi import ediyor VE B'nin tanımlayıcısını
//   bir `.use(...)` çağrısında argüman olarak geçiriyor"
// `app.use("/x", r)` ile `router.use("/x", r)` AYNI kenardır — iki mount deseni
// de (app seviyesi / alt router) meşrudur ve ikisi de bu grafikte görünür.
//
// TARAMA TS AST İLE, REGEX DEĞİL: yorum satırındaki ya da JSDoc'taki bir
// `app.use("/api/x", xRoutes)` ÖRNEĞİ "bağlı" sayılmamalı. Bu dosyanın konu
// aldığı vakada tam olarak öyle bir yorum vardı (`finance-period.routes.ts`
// başlığı mount satırını ÖRNEK olarak yazıyordu) — düz metin araması onu
// "bağlı" sayar ve bekçi tehlikeli yönde (yanlış YEŞİL) hata verirdi.
//
// Salt-okunur: DB'ye dokunmaz, ortamdaki veriye bağımlı değil, boş CI
// veritabanında da tam koşar.
// Koşum: npx tsx scripts/test_route_mount_reachability.ts
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
const ROUTES_DIR = path.join(SRC, "routes");
const GIRIS = path.join(SRC, "app.ts");

// -----------------------------------------------------------------------------
// MUAF LİSTESİ — her satır GEREKÇELİ olmak zorunda
// -----------------------------------------------------------------------------
// ⚠️ Muaf listesi İKİ YÖNLÜ denetlenir (aşağıda): listede olup ARTIK VAR OLMAYAN
// ya da aslında BAĞLI OLAN bir dosya da testi düşürür. Ölü muaf, gerçek bir
// boşluğu sessizce kapsam dışında tutar — muaf listesinin en sinsi hâli budur.
const MUAF: ReadonlyArray<{ dosya: string; neden: string }> = [
  // (Bugün boş. Bir router'ı buraya yazmadan önce sorulacak soru: "bu dosya
  // gerçekten bağlanmamalı mı, yoksa bağlamayı mı unuttum?" — vakaların
  // çoğunda ikincisidir.)
];

// -----------------------------------------------------------------------------
// AST YARDIMCILARI
// -----------------------------------------------------------------------------
function oku(dosya: string): ts.SourceFile {
  return ts.createSourceFile(dosya, fs.readFileSync(dosya, "utf8"), ts.ScriptTarget.Latest, true);
}

/** `./routes/x.routes` → mutlak dosya yolu (uzantı çözümlemeli). */
function cozYol(kaynakDosya: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // paket importu — grafiğe girmez
  const taban = path.resolve(path.dirname(kaynakDosya), spec);
  for (const aday of [`${taban}.ts`, path.join(taban, "index.ts")]) {
    if (fs.existsSync(aday)) return aday;
  }
  return null;
}

/**
 * Bir dosyanın MOUNT ETTİĞİ yerel dosyaları döner.
 *
 * İki adım: (1) `import X from "./y"` → X ↦ y dosyası, (2) AST'te `*.use(...)`
 * çağrılarının argümanlarında geçen tanımlayıcıları topla. Kesişim = kenarlar.
 *
 * ⚠️ `.use(` ARADIĞIMIZ ŞEY, `app.use` DEĞİL: alt router'lar `router.use(...)`
 * ile bağlanır (bu projede `finance.routes.ts` → `/allocations` böyle) ve
 * yalnız `app.use` aransaydı o dosyalar "bağlı değil" görünürdü.
 */
function mountEdilenler(dosya: string): string[] {
  const sf = oku(dosya);
  const importlar = new Map<string, string>(); // yerel ad → mutlak dosya
  const kullanilan = new Set<string>();

  const gez = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const hedef = cozYol(dosya, n.moduleSpecifier.text);
      if (hedef && n.importClause?.name) importlar.set(n.importClause.name.text, hedef);
      if (hedef && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
        for (const el of n.importClause.namedBindings.elements) importlar.set(el.name.text, hedef);
      }
    }
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isPropertyAccessExpression(e) && e.name.text === "use") {
        for (const arg of n.arguments) {
          if (ts.isIdentifier(arg)) kullanilan.add(arg.text);
        }
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);

  const kenarlar: string[] = [];
  for (const ad of kullanilan) {
    const hedef = importlar.get(ad);
    if (hedef) kenarlar.push(hedef);
  }
  return kenarlar;
}

// -----------------------------------------------------------------------------
// ÖLÇÜM
// -----------------------------------------------------------------------------
function tumRouterDosyalari(): string[] {
  const cikti: string[] = [];
  const yuru = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const tam = path.join(dir, e.name);
      if (e.isDirectory()) yuru(tam);
      else if (e.name.endsWith(".routes.ts")) cikti.push(tam);
    }
  };
  yuru(ROUTES_DIR);
  return cikti.sort();
}

async function main(): Promise<void> {
  console.log("=== ROUTER ERİŞİLEBİLİRLİK BEKÇİSİ ===\n");

  const hepsi = tumRouterDosyalari();

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  // Tarayıcı boşa düşerse ("hiç router bulunamadı") sonuç "ihlal yok" ile AYNI
  // yeşile çıkardı. Dizin adı değişir / uzantı deseni kayarsa burada yakalanır.
  check("§1a Körlük zemini: router dosyaları bulundu", hepsi.length >= 40, `bulunan=${hepsi.length}`);
  check("§1b Körlük zemini: giriş noktası okunabildi", fs.existsSync(GIRIS), path.relative(KOK, GIRIS));

  // ── §2 TRANSİTİF ERİŞİLEBİLİRLİK (BFS, app.ts'ten) ────────────────────────
  const erisilen = new Set<string>();
  const kuyruk: string[] = [GIRIS];
  while (kuyruk.length > 0) {
    const su = kuyruk.shift() as string;
    if (erisilen.has(su)) continue;
    erisilen.add(su);
    for (const komsu of mountEdilenler(su)) {
      if (!erisilen.has(komsu)) kuyruk.push(komsu);
    }
  }

  const muafSet = new Set(MUAF.map((m) => path.join(SRC, m.dosya)));
  const bagsiz = hepsi.filter((f) => !erisilen.has(f) && !muafSet.has(f));

  check(
    "§2a Körlük zemini: grafik gerçekten yürüdü (app.ts'ten router'lara ulaşıldı)",
    hepsi.filter((f) => erisilen.has(f)).length >= 40,
    `erişilen router=${hepsi.filter((f) => erisilen.has(f)).length}/${hepsi.length}`,
  );
  check(
    "§2b ⭐ Yazılmış HER router app.ts'ten erişilebilir (mount edilmiş)",
    bagsiz.length === 0,
    bagsiz.length === 0
      ? "hepsi bağlı"
      : `BAĞLANMAMIŞ: ${bagsiz.map((f) => path.relative(SRC, f)).join(", ")} — ` +
        `app.ts'e \`app.use("/api/...", X)\` ya da bir üst router'a \`router.use("/...", X)\` ekle`,
  );

  // ── §3 MUAF LİSTESİ BAYATLIK DENETİMİ (iki yönlü) ─────────────────────────
  const olu = MUAF.filter((m) => !fs.existsSync(path.join(SRC, m.dosya)));
  check("§3a Muaf listesinde ölü satır yok (dosya hâlâ var)", olu.length === 0, olu.map((m) => m.dosya).join(", "));
  const gereksiz = MUAF.filter((m) => erisilen.has(path.join(SRC, m.dosya)));
  check(
    "§3b Muaf listesinde gereksiz satır yok (aslında BAĞLI olan)",
    gereksiz.length === 0,
    gereksiz.map((m) => m.dosya).join(", "),
  );
  const gerekcesiz = MUAF.filter((m) => !m.neden || m.neden.trim().length < 10);
  check("§3c Her muafın GEREKÇESİ yazılı", gerekcesiz.length === 0, gerekcesiz.map((m) => m.dosya).join(", "));
  if (MUAF.length > 0) {
    console.log(`   ℹ️  muaf (${MUAF.length}): ${MUAF.map((m) => `${m.dosya} — ${m.neden}`).join(" | ")}`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE: bağlanmamış router bir 404 fabrikasıdır — dosya derlenir, testleri\n" +
        "geçer, Swagger'da görünür ve ilk istekte sessizce 404 döner. Mount satırını\n" +
        "ekle; router KENDİ `verifyToken + requireFinanceEnabled` kapısını taşıyorsa\n" +
        "app.ts'e SPESİFİK ön ekle ve genel prefix'ten ÖNCE bağla (çek emsali),\n" +
        "kapısını üst router'dan MİRAS ALIYORSA üst router'ın içine bağla.",
    );
  }
  process.exit(fail > 0 ? 1 : 0);
}

void main();
