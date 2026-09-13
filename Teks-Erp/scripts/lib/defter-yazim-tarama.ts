// =============================================================================
// DEFTERE YAZAN YOL TARAMASI — tip denetleyicili, TEK ALTYAPI
// =============================================================================
// NEDEN tip denetleyicisi: delegate yüklemi (`prisma.importRunLine.create`) İÇ İÇE
// ilişki yazımını GÖRMEZ — `ImportRunLine`ın ileri satırları `lines: { createMany }`
// ile yazılıyor ve delegate çağrısı hiç yok (ölçüldü 2026-09-13). Ad bazlı iç içe
// yüklem ise BELİRSİZ: `lines` hem `InvoiceLine` hem `ImportRunLine` hem
// `PurchaseOrderLine` ilişkisinin adı — 6 bulgunun 4'ü yanlış pozitifti. Ayrım
// Prisma'nın BAĞLAMSAL (kısıt) tipinden yapılır: `<Model>CreateNestedManyWithout…Input`.
//
// Program + şema okuması `revoke-ast-tarama.ts`ten İTHAL EDİLİR; ikinci bir tarama
// altyapısı bir hafta sonra ayrışır ve iki bekçi iki farklı kapsam iddia eder.
//
// KAPSAM: SATIR YARATAN yazımlar (`create` · `createMany` · `createManyAndReturn` ·
// `upsert` · ham `INSERT`). `update`/`delete` AYRI SORUDUR (append-only ihlali) ve
// burada sayılmaz — "yeni ileri yol eklendi mi" sorusunun cevabı satır doğuran
// yazımdır.
// =============================================================================
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import * as ts from "typescript";
import { CONTEXT_COMPLETIONS, tipliProgram } from "../revoke-ast-tarama";

/** Satır DOĞURAN delegate metotları. */
export const YARATAN = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);
/** Satır SİLEN delegate metotları — doktrin defterde bunları YASAKLAR. */
export const SILEN = new Set(["delete", "deleteMany"]);
/** İç içe ilişki yazımında satır doğuran anahtarlar. */
const YARATAN_ICICE = new Set(["create", "createMany", "connectOrCreate", "upsert"]);

export interface YazimYeri {
  /** Şemadaki model adı — `ImportRunLine`. */
  model: string;
  /** Backend köküne göreli dosya yolu. */
  dosya: string;
  satir: number;
  /** `create` · `lines.createMany` · `INSERT` */
  nasil: string;
  /** İç içe ilişki üzerinden mi yazıldı (delegate çağrısı yok). */
  icIce: boolean;
}

/**
 * `{ createMany: … }` nesnesinin BAĞLAMSAL tipinden model adını çözer.
 *
 * ⚠️ Prisma iç içe yazım tiplerinin İKİ ayrı ad düzeni var ve tek kalıp biri
 * kaçırır (ölçüldü 2026-09-13: aynı `upsert`in `create:` dalı yakalandı,
 * `update:` dalı KAÇTI — `ImportRunLine`ın iki yazım yerinden biri görünmüyordu):
 *   create yönü → `<Model>CreateNestedManyWithout<X>Input`
 *   update yönü → `<Model>UpdateManyWithout<X>NestedInput`
 * İkisi de `Nested` taşır; kalıp bunu ZORUNLU tutar ki `<Model>CreateManyInput`
 * (iç içe olmayan `data:` dizisi) yanlış eşleşmesin.
 */
const ICICE_TIP_KALIPLARI = [
  /\b([A-Z]\w*?)(?:Unchecked)?(?:Create|Update)Nested(?:Many|One)(?:Without\w+?)?Input\b/,
  /\b([A-Z]\w*?)(?:Unchecked)?(?:Create|Update)(?:Many|One)(?:Without\w+?)?NestedInput\b/,
];

function iciceModel(
  checker: ReturnType<typeof tipliProgram>["checker"],
  node: ts.Expression,
): { model: string | null; cozuldu: boolean } {
  const tip = checker.getContextualType(node, CONTEXT_COMPLETIONS);
  if (!tip) return { model: null, cozuldu: false };
  const metin = checker.typeToString(tip);
  for (const kalip of ICICE_TIP_KALIPLARI) {
    const m = kalip.exec(metin);
    if (m) return { model: m[1], cozuldu: true };
  }
  return { model: null, cozuldu: false };
}

/**
 * `kokler` altındaki TS dosyalarında, `hedefler` kümesindeki modellere satır yazan
 * her yeri döndürür. `tabloAdi` ham SQL için gerekir (model → tablo eşlemesi
 * şemadan türetilemez; `@@map` okunmaz, çağıran verir).
 */
export function defterYazimlariniTara(
  kok: string,
  hedefler: Map<string, { delegate: string; tablo: string }>,
  dosyaSuzgeci: (rel: string) => boolean,
  tsconfigAdi = "tsconfig.scripts.json",
  metodlar: Set<string> = YARATAN,
): { bulgular: YazimYeri[]; cozulemeyen: string[]; taranan: string[] } {
  const { program, checker } = tipliProgram(kok, tsconfigAdi);
  const delegateModel = new Map([...hedefler].map(([model, c]) => [c.delegate, model]));
  const tabloModel = new Map([...hedefler].map(([model, c]) => [c.tablo, model]));
  const bulgular: YazimYeri[] = [];
  const cozulemeyen: string[] = [];
  const taranan: string[] = [];

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = relative(kok, sf.fileName);
    if (!dosyaSuzgeci(rel)) continue;
    taranan.push(rel);
    const satirNo = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    const gez = (n: ts.Node): void => {
      // ① delegate çağrısı: <herhangi>.<delegate>.create(…)
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const metod = n.expression.name.text;
        const ic = n.expression.expression;
        if (metodlar.has(metod) && ts.isPropertyAccessExpression(ic)) {
          const model = delegateModel.get(ic.name.text);
          if (model) bulgular.push({ model, dosya: rel, satir: satirNo(n), nasil: metod, icIce: false });
        }
      }
      // ② iç içe ilişki yazımı — model BAĞLAMSAL TİPTEN çözülür, adından DEĞİL
      if (metodlar === YARATAN && ts.isPropertyAssignment(n) && ts.isObjectLiteralExpression(n.initializer)) {
        const anahtarlar = n.initializer.properties
          .filter((p): p is ts.PropertyAssignment | ts.ShorthandPropertyAssignment => !!p.name && ts.isIdentifier(p.name))
          .map((p) => (p.name as ts.Identifier).text);
        const yaratan = anahtarlar.filter((a) => YARATAN_ICICE.has(a));
        if (yaratan.length > 0) {
          const { model, cozuldu } = iciceModel(checker, n.initializer);
          const alan = ts.isIdentifier(n.name) ? n.name.text : n.name.getText(sf);
          if (model && hedefler.has(model)) {
            bulgular.push({ model, dosya: rel, satir: satirNo(n), nasil: `${alan}.${yaratan.join("+")}`, icIce: true });
          } else if (!cozuldu) {
            // KÖRLÜK ZEMİNİ: tipi çözülemeyen iç içe yazım SAYILIR ve basılır.
            // Sıfır bulgu ile "hiç bakılamadı" aynı çıktıya inmesin.
            cozulemeyen.push(`${rel}:${satirNo(n)} ${alan}.{${yaratan.join("+")}}`);
          }
        }
      }
      // ③ ham SQL INSERT
      if (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n)) {
        const metin = n.getText(sf);
        for (const [tablo, model] of tabloModel) {
          const fiil = metodlar === SILEN ? "DELETE\\s+FROM" : "INSERT\\s+INTO";
          if (new RegExp(`${fiil}\\s+"?${tablo}"?`, "i").test(metin))
            bulgular.push({ model, dosya: rel, satir: satirNo(n), nasil: metodlar === SILEN ? "DELETE" : "INSERT", icIce: false });
        }
      }
      n.forEachChild(gez);
    };
    gez(sf);
  }
  return { bulgular, cozulemeyen, taranan };
}

/**
 * Bir sembolün TANIMI DIŞINDA referansı var mı — "yazılmış ama çağrılmayan yol"
 * sınıfının SINIRLI ve sağlam ölçümü.
 *
 * ⚠️ SINIR BEYANI: bu "uçtan erişilebilir mi" DEĞİLDİR. Elle kurulan ad/ithal
 * grafiği dört nesilde de yanlış negatif verdi (`this.service.X` · yerel
 * `new Ctrl()` · sınıf alanı ok fonksiyonu) ve gevşetilmiş sürümü her şeye EVET
 * dedi (1.251 → 10.727 ad). Soru bilinçle daraltıldı: SIFIR referans = ölü yol.
 */
export function sembolReferanslari(
  kok: string,
  dosyalar: string[],
): Map<string, { tanim: { dosya: string; bas: number; son: number }[]; disReferans: number; icReferans: number }> {
  const sonuc = new Map<string, { tanim: { dosya: string; bas: number; son: number }[]; disReferans: number; icReferans: number }>();
  const tanimlar: { ad: string; dosya: string; bas: number; son: number }[] = [];
  const referanslar: { ad: string; dosya: string; satir: number }[] = [];

  for (const abs of dosyalar) {
    const rel = relative(kok, abs);
    const sf = ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      let ad: string | null = null;
      if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) ad = n.name.getText(sf);
      else if (
        (ts.isPropertyDeclaration(n) || ts.isPropertyAssignment(n)) &&
        n.name && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
      ) ad = n.name.getText(sf);
      else if (
        ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
      ) ad = n.name.text;
      if (ad) {
        tanimlar.push({
          ad, dosya: rel,
          bas: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          son: sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1,
        });
      }
      if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) {
        const ust = n.parent;
        const tanimAdi =
          (ts.isFunctionDeclaration(ust) || ts.isMethodDeclaration(ust) || ts.isPropertyDeclaration(ust) ||
            ts.isPropertyAssignment(ust) || ts.isVariableDeclaration(ust)) && ust.name === n;
        if (!tanimAdi) {
          const metin = ts.isIdentifier(n) ? n.text : n.name.text;
          referanslar.push({ ad: metin, dosya: rel, satir: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
        }
      }
      n.forEachChild(gez);
    };
    gez(sf);
  }

  for (const t of tanimlar) {
    const kayit = sonuc.get(t.ad) ?? { tanim: [], disReferans: 0, icReferans: 0 };
    kayit.tanim.push({ dosya: t.dosya, bas: t.bas, son: t.son });
    sonuc.set(t.ad, kayit);
  }
  for (const r of referanslar) {
    const kayit = sonuc.get(r.ad);
    if (!kayit) continue;
    const kendiGovdesinde = kayit.tanim.some((t) => t.dosya === r.dosya && r.satir >= t.bas && r.satir <= t.son);
    if (kendiGovdesinde) continue;
    if (kayit.tanim.some((t) => t.dosya === r.dosya)) kayit.icReferans++;
    else kayit.disReferans++;
  }
  return sonuc;
}
