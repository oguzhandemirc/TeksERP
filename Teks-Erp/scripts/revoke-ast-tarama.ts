// =============================================================================
// DAMGALI DEFTER — aktif yüklem AST taraması (bekçi yardımcısı, test değil)
// =============================================================================
// Silinmek yerine `revokedAt` ile damgalanan bir defterde okuyan/güncelleyen
// HER yol aktif yüklemi taşımalıdır; tek bir unutulmuş süzgeç geri alınmış
// satırı "yapılmış" sayar. Bu modül `src/`i TypeScript tip denetleyicisiyle
// tarar ve dört yüzeyi ölçer:
//   • delegate çağrısı (`<delegate>.findMany/count/updateMany/upsert…`)
//   • ilişki süzgeci / iç içe okuma (`movements: { some … }`, `_count`)
//   • ham SQL'de tabloya her başvuru (alias bazında `"revokedAt" IS NULL`)
//   • `<delegate>.delete*` çağrısı
// İlişki alanı adları ŞEMADAN türetilir: `movements` adı WarehouseMovement
// ilişkilerinde de var; ayrım Prisma'nın bağlamsal (kısıt) tipinden yapılır.
// Bağlamsal tipi olmayan nesnede (tipsiz `const X = { … }` include sabiti) model
// KARDEŞ ANAHTARLARDAN çözülür; çözülemeyen ya da belirsiz kalan erişim kırmızıdır.
// Gerekçeli istisna, erişimin üstündeki "`revokedAt` SÜZÜLMEZ" işaretidir: en fazla
// 3 satır yukarıda ya da araya yalnız yorum / `alan: true,` satırları giren aynı
// blokta (bir işaret altında gruplanmış `_count` anahtarları). Her istisna döndürülür.
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

export interface AktifYuklemTanimi {
  /** Prisma delegate adı — `rollMovement`. */
  delegate: string;
  /** Şemadaki model adı — `RollMovement`. */
  model: string;
  /** Tek kaynak sabit — `ACTIVE_MOVEMENT`. */
  sabit: string;
  /** Ham SQL tablo adı — `roll_movements`. */
  tablo: string;
  /** Taramadan muaf tek kaynak dosyası (backend köküne göreli). */
  helper: string;
}

export interface TaramaSonucu {
  silme: string[];
  cagriSayisi: number;
  cagriIhlal: string[];
  iliskiSayisi: number;
  iliskiIhlal: string[];
  sqlSayisi: number;
  sqlIhlal: string[];
  istisnalar: string[];
}

const ISTISNA = /`revokedAt` SÜZÜLMEZ/;
const OKUMA_GUNCELLEME = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow",
  "count", "aggregate", "groupBy", "update", "updateMany", "upsert",
]);
const SQL_ANAHTAR = new Set(["where", "set", "on", "join", "left", "right", "inner", "full", "cross", "group", "order", "using", "limit", "returning", "as"]);

/**
 * Şemadaki her modelin alan adı → tip adı eşlemesi (`[]`/`?` atılmış).
 *
 * İHRAÇ EDİLDİ (2026-09-13): defter ters-yol kapısı da şema alanlarını ve TS
 * programını okuyor. İkinci bir tarama altyapısı bir hafta sonra bundan ayrışır
 * ve iki bekçi iki farklı kapsam iddia eder — o yüzden program + şema okuması
 * TEK YERDE yaşar.
 */
export function semaAlanlari(kok: string): Map<string, Map<string, string>> {
  const sema = readFileSync(join(kok, "prisma", "schema.prisma"), "utf8");
  const modeller = new Map<string, Map<string, string>>();
  let aktif: Map<string, string> | null = null;
  for (const satir of sema.split("\n")) {
    const m = /^model\s+(\w+)\s*\{/.exec(satir);
    if (m) {
      aktif = new Map();
      modeller.set(m[1], aktif);
      continue;
    }
    if (/^\}/.test(satir)) aktif = null;
    const f = /^\s+(\w+)\s+(\w+)(\[\])?\??/.exec(satir);
    if (aktif && f && !f[1].startsWith("@@")) aktif.set(f[1], f[2]);
  }
  return modeller;
}

/** Prisma argüman anahtarları — model alanı değildir, kardeş çözümünde sayılmaz. */
const ARGUMAN_ANAHTARLARI = new Set([
  "where", "select", "include", "orderBy", "take", "skip", "cursor", "distinct", "_count",
  "AND", "OR", "NOT", "some", "none", "every", "is", "isNot", "data", "omit",
]);

/**
 * Tip denetleyicili `ts.Program` — tsconfig'ten, TEK KAYNAK (bkz. `semaAlanlari` şerhi).
 *
 * ⚠️ `tsconfigAdi` ÖNEMLİ: kök `tsconfig.json` YALNIZ `src/**` içerir. `scripts/`i
 * de taraması gereken bir kapı varsayılanla kurulursa program o dosyaları HİÇ
 * görmez ve tarama SESSİZCE boş döner (ölçüldü 2026-09-13: scripts/ taraması
 * sıfır bulgu verdi, sebebi kapsamdı). Kapsamı tarayan, kapsamın DOLU olduğunu da
 * ölçmek zorundadır.
 */
export function tipliProgram(kok: string, tsconfigAdi = "tsconfig.json"): {
  program: ts.Program;
  checker: ts.TypeChecker & { getContextualType(e: ts.Expression, flags: number): ts.Type | undefined };
} {
  const cfg = ts.readConfigFile(join(kok, tsconfigAdi), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, kok);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
  return {
    program,
    checker: program.getTypeChecker() as ts.TypeChecker & {
      getContextualType(e: ts.Expression, flags: number): ts.Type | undefined;
    },
  };
}

/** `ts.ContextFlags.Completions` — çıkarım adayını değil KISIT tipini verir. */
export const CONTEXT_COMPLETIONS = 4;

export function aktifYuklemTara(kok: string, tanimlar: AktifYuklemTanimi[]): Map<string, TaramaSonucu> {
  const { program, checker } = tipliProgram(kok);
  const COMPLETIONS = CONTEXT_COMPLETIONS;

  const modeller = semaAlanlari(kok);
  const sonuclar = new Map<string, TaramaSonucu>();
  const hazir = tanimlar.map((t) => {
    const alanlar = [...modeller].flatMap(([model, alan]) =>
      [...alan].filter(([, tip]) => tip === t.model).map(([ad]) => ({ model, alan: ad })),
    );
    const buyuk = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    const tipler = alanlar.flatMap((a) => [`${a.model}$${a.alan}Args`, `${a.model}CountOutputTypeCount${buyuk(a.alan)}Args`]);
    const iliskiTipi = new RegExp(`\\b(${t.model}ListRelationFilter|${tipler.map((x) => x.replace(/\$/g, "\\$")).join("|")})\\b`);
    const sonuc: TaramaSonucu = {
      silme: [], cagriSayisi: 0, cagriIhlal: [], iliskiSayisi: 0, iliskiIhlal: [], sqlSayisi: 0, sqlIhlal: [], istisnalar: [],
    };
    sonuclar.set(t.delegate, sonuc);
    return { t, adlar: new Set(alanlar.map((a) => a.alan)), iliskiTipi, sonuc };
  });

  // Tipsiz nesnede kardeş anahtarlardan model: tüm kardeşleri alan olarak taşıyan
  // modeller içinde bu ad hedef modele gidiyorsa hedef; hiçbiri gitmiyorsa değil.
  // Yalnız Prisma argümanı ŞEKLİNDEKİ değer (`true` ya da anahtarları where/select/
  // some… olan nesne) aday sayılır — yanıt kuran `{ operations: [...] }` Prisma değildir.
  const argumanSekli = (e: ts.Expression): boolean =>
    e.kind === ts.SyntaxKind.TrueKeyword ||
    (ts.isObjectLiteralExpression(e) &&
      e.properties.length > 0 &&
      e.properties.every((p) => !p.name || (ts.isIdentifier(p.name) && ARGUMAN_ANAHTARLARI.has(p.name.text))));
  const kardestenCoz = (n: ts.PropertyAssignment, hedef: string): "hedef" | "degil" | "belirsiz" => {
    if (!argumanSekli(n.initializer)) return "degil";
    const nesne = n.parent;
    if (!ts.isObjectLiteralExpression(nesne)) return "belirsiz";
    const ad = (n.name as ts.Identifier).text;
    const kardesler = nesne.properties
      .map((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : ""))
      .filter((k) => k && k !== ad && !ARGUMAN_ANAHTARLARI.has(k));
    if (kardesler.length === 0) return "belirsiz";
    const adaylar = [...modeller.values()].filter((alan) => alan.has(ad) && kardesler.every((k) => alan.has(k)));
    if (adaylar.length === 0) return "degil";
    const hedefe = adaylar.filter((alan) => alan.get(ad) === hedef).length;
    if (hedefe === adaylar.length) return "hedef";
    return hedefe === 0 ? "degil" : "belirsiz";
  };

  for (const sf of program.getSourceFiles()) {
    if (!sf.fileName.startsWith(join(kok, "src"))) continue;
    const dosya = relative(kok, sf.fileName);
    const satirlar = sf.text.split("\n");
    const yer = (n: ts.Node): string => `${dosya}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const istisnaMi = (n: ts.Node, sonuc: TaramaSonucu): boolean => {
      const satir = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
      let isaretli = ISTISNA.test(satirlar.slice(Math.max(0, satir - 3), satir + 1).join("\n"));
      for (let i = satir - 1; !isaretli && i >= Math.max(0, satir - 8); i--) {
        const s = satirlar[i];
        if (ISTISNA.test(s)) isaretli = true;
        else if (!/^\s*(\/\/|\w+:\s*true,?\s*$)/.test(s)) break;
      }
      if (!isaretli) return false;
      sonuc.istisnalar.push(yer(n));
      return true;
    };
    // Alt ağaçta ya da bir düzey referans verilen yerel değişkenin başlatıcısında sabit geçiyor mu?
    const sabitTasir = (n: ts.Node, sabit: string, derinlik = 0): boolean => {
      let bulundu = false;
      const gez = (m: ts.Node): void => {
        if (bulundu) return;
        if (ts.isIdentifier(m)) {
          if (m.text === sabit) {
            bulundu = true;
            return;
          }
          if (derinlik === 0) {
            const decl = checker.getSymbolAtLocation(m)?.valueDeclaration;
            if (decl && ts.isVariableDeclaration(decl) && decl.initializer && decl.getSourceFile() === sf && sabitTasir(decl.initializer, sabit, 1)) {
              bulundu = true;
              return;
            }
          }
        }
        ts.forEachChild(m, gez);
      };
      gez(n);
      return bulundu;
    };

    const visit = (n: ts.Node): void => {
      for (const { t, adlar, iliskiTipi, sonuc } of hazir) {
        if (dosya === t.helper) continue;
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          ts.isPropertyAccessExpression(n.expression.expression) &&
          n.expression.expression.name.text === t.delegate
        ) {
          const metod = n.expression.name.text;
          if (metod.startsWith("delete")) sonuc.silme.push(yer(n));
          if (OKUMA_GUNCELLEME.has(metod)) {
            sonuc.cagriSayisi++;
            if (!n.arguments.some((a) => sabitTasir(a, t.sabit)) && !istisnaMi(n, sonuc)) {
              sonuc.cagriIhlal.push(`${yer(n)} ${metod}`);
            }
          }
        }
        if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && adlar.has(n.name.text)) {
          const tip = checker.getContextualType(n.initializer, COMPLETIONS);
          const ad = tip ? checker.typeToString(tip, undefined, ts.TypeFormatFlags.NoTruncation) : "";
          // Prisma tipi çözüldüyse karar tipten; çözülmediyse (tipsiz sabit) kardeşlerden.
          const prismaTipli = /Args\b|Filter\b|Input\b|Select\b|Include\b/.test(ad);
          // Prisma dışı bir tiple bağlamlanmış nesne (yanıt/şablon tipi) aday değildir.
          const kardes = prismaTipli ? null : ad ? "degil" : kardestenCoz(n, t.model);
          if (kardes === "belirsiz" && !istisnaMi(n, sonuc)) {
            sonuc.iliskiIhlal.push(`${yer(n)} (model çözülemedi)`);
          } else if (prismaTipli ? iliskiTipi.test(ad) : kardes === "hedef") {
            sonuc.iliskiSayisi++;
            const everyVar =
              ts.isObjectLiteralExpression(n.initializer) &&
              n.initializer.properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "every");
            if ((everyVar || !sabitTasir(n.initializer, t.sabit)) && !istisnaMi(n, sonuc)) {
              sonuc.iliskiIhlal.push(`${yer(n)}${everyVar ? " every" : ""}`);
            }
          }
        }
        if (ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || ts.isStringLiteral(n)) {
          const eksik = sqlEksikSuzgec(n.getText(sf), t.tablo);
          if (eksik !== null) {
            sonuc.sqlSayisi++;
            if (eksik.length > 0 && !istisnaMi(n, sonuc)) sonuc.sqlIhlal.push(`${yer(n)} ${eksik.join(",")}`);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return sonuclar;
}

/**
 * Metin tabloya FROM/JOIN/UPDATE ile başvurmuyorsa `null`. Başvuruyorsa süzgeci
 * eksik başvuruların listesi: alias'lı başvuru `<alias>."revokedAt" IS NULL`,
 * alias'sız başvuru nitelemesiz `"revokedAt" IS NULL` ister — her başvuru kendi
 * süzgecini sayar (aynı literalde iki tablo birbirinin süzgeciyle örtülmez).
 */
export function sqlEksikSuzgec(metin: string, tablo: string): string[] | null {
  const bas = new RegExp(`\\b(FROM|JOIN|UPDATE)\\s+(?:public\\.)?"?${tablo}"?(?:\\s+(?:AS\\s+)?([A-Za-z_][A-Za-z0-9_]*))?`, "gi");
  const aliasSay = new Map<string, number>();
  let bulundu = false;
  for (const m of metin.matchAll(bas)) {
    bulundu = true;
    const aday = m[2];
    const alias = aday && !SQL_ANAHTAR.has(aday.toLowerCase()) ? aday : "";
    aliasSay.set(alias, (aliasSay.get(alias) ?? 0) + 1);
  }
  if (!bulundu) return null;
  const eksik: string[] = [];
  for (const [alias, adet] of aliasSay) {
    const desen = alias
      ? new RegExp(`\\b${alias}\\."revokedAt"\\s+IS\\s+NULL`, "g")
      : new RegExp(`(?:^|[^.\\w"])"revokedAt"\\s+IS\\s+NULL`, "g");
    const suzgec = (metin.match(desen) ?? []).length;
    if (suzgec < adet) eksik.push(`${alias || "(alias yok)"} ${suzgec}/${adet}`);
  }
  return eksik;
}
