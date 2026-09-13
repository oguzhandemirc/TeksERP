// GEÇİCİ ÖLÇÜM — topun statüsünü yazan her site + damga var mı.
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

const KOK = path.resolve(__dirname, "..");
const STOK = ["STOCK", "WAREHOUSE", "A1_STOCK", "RETURNED_FROM_SUBCONTRACTOR"];

function tsDosyalari(d: string): string[] {
  const out: string[] = [];
  const y = [d];
  while (y.length) {
    const c = y.pop()!;
    for (const e of fs.readdirSync(c, { withFileTypes: true })) {
      const p = path.join(c, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "__tests__") y.push(p); }
      else if (e.isFile() && p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
    }
  }
  return out.sort();
}

interface Bulgu {
  dosya: string; satir: number; cagri: string;
  statuIfadesi: string; stokOlabilir: boolean;
  ayniDataDaWarehouse: boolean; yakindaDamga: boolean;
}

const bulgular: Bulgu[] = [];

/**
 * Damga fonksiyonlarının adları — ELLE SAYILMAZ, helper'dan KEŞFEDİLİR.
 *
 * ⚠️ Elle liste üçüncü kez ısırdı: `warehouseStampWhereTx` eklendiğinde tarama onu
 * tanımadı ve damgalanmış iki siteyi "damgasız" gösterdi. Çift terimli bir tripwire'a
 * ÜÇÜNCÜ terim eklenince liste sessizce eksik kalır — kapı, koruduğu kümeden dar olamaz.
 * Pozitif kontrol: hiç damga fonksiyonu bulunamazsa araç bozuk sayılır.
 */
function damgaAdlari(): string[] {
  const yol = path.join(KOK, "src/services/helpers/warehouse.helper.ts");
  const sf = ts.createSourceFile(yol, fs.readFileSync(yol, "utf8"), ts.ScriptTarget.Latest, true);
  const adlar: string[] = [];
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name && /^warehouseStamp/.test(n.name.text)) {
      adlar.push(n.name.text);
    }
  });
  if (adlar.length === 0) {
    throw new Error("ARAÇ BOZUK: warehouse.helper'da `warehouseStamp*` fonksiyonu bulunamadı");
  }
  return adlar;
}
const DAMGALAR = damgaAdlari();
const DAMGA_RE = new RegExp(DAMGALAR.join("|"));

/** Çağrıyı kapsayan en yakın fonksiyon/metot gövdesinin metni (yoksa dosya). */
function govdeMetni(n: ts.Node, sf: ts.SourceFile): string {
  let p: ts.Node | undefined = n.parent;
  while (p) {
    if (
      ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) ||
      ts.isArrowFunction(p) || ts.isFunctionExpression(p)
    ) {
      return p.getText(sf);
    }
    p = p.parent;
  }
  return sf.getText();
}

for (const dosya of tsDosyalari(path.join(KOK, "src"))) {
  const metin = fs.readFileSync(dosya, "utf8");
  const sf = ts.createSourceFile(dosya, metin, ts.ScriptTarget.Latest, true);


  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const ad = n.expression.name.text;
      const hedef = n.expression.expression.getText(sf);
      if (["update", "updateMany", "upsert"].includes(ad) && /\broll$/.test(hedef)) {
        const arg = n.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const dataProp = arg.properties.find(
            (p): p is ts.PropertyAssignment =>
              ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) &&
              (p.name.text === "data" || p.name.text === "update"),
          );
          const satirNo = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          if (dataProp && !ts.isObjectLiteralExpression(dataProp.initializer)) {
            // `data: rollData` — alanlar burada görünmez. Sessizce atlamak yanlış
            // negatif üretir ⇒ site SAYILIR, elle bakılmak üzere (fail-closed).
            bulgular.push({
              dosya: path.relative(KOK, dosya), satir: satirNo, cagri: ad,
              statuIfadesi: `(DEĞİŞKEN ${dataProp.initializer.getText(sf).slice(0, 24)})`,
              stokOlabilir: true, ayniDataDaWarehouse: false, yakindaDamga: false,
            });
          }
          if (dataProp && ts.isObjectLiteralExpression(dataProp.initializer)) {
            const d = dataProp.initializer;
            // ⚠️ KISAYOL DA SAYILIR: `data: { status, currentStepId: null }` biçiminde
            // `status:` token'ı YOKTUR (ShorthandPropertyAssignment) ve ilk sürüm
            // yalnız PropertyAssignment arıyordu — üretimin ANA finalize boğazını
            // (`roll-finalize.helper.ts`) tam bu yüzden kaçırdı (ölçüldü 2026-09-13).
            const statusProp = d.properties.find(
              (p) =>
                (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
                ts.isIdentifier(p.name) && p.name.text === "status",
            );
            if (statusProp) {
              const ifade = ts.isShorthandPropertyAssignment(statusProp)
                ? "(KISAYOL status)"
                : (statusProp as ts.PropertyAssignment).initializer.getText(sf).replace(/\s+/g, " ").slice(0, 70);
              const stokOlabilir =
                STOK.some((s) => ifade.includes(s)) ||
                // Değişkenden geliyorsa KESİN bilemeyiz → aday say (fail-closed).
                !/^RollStatus\.[A-Z_]+$/.test(ifade);
              const warehouseVar = d.properties.some(
                (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "warehouseId",
              ) || DAMGA_RE.test(d.getText(sf));
              const satir = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
              // ⚠️ KAPSAYAN FONKSİYON GÖVDESİ, satır penceresi DEĞİL. ±25 satırlık
              // pencere bir BİÇİM sorusudur ("yakında mı") ve ilk sürüm tam bu
              // yüzden yanlış pozitif verdi: `roll-disposition`ın damgası
              // `updateMany`den 34 satır sonra, yani aynı kod yolunda ama pencerenin
              // dışındaydı. "Aynı fonksiyonda mı" ANLAM sorusudur.
              const pencere = govdeMetni(n, sf);
              bulgular.push({
                dosya: path.relative(KOK, dosya), satir, cagri: ad,
                statuIfadesi: ifade, stokOlabilir,
                ayniDataDaWarehouse: warehouseVar,
                yakindaDamga: DAMGA_RE.test(pencere),
              });
            }
          }
        }
      }
    }
    n.forEachChild(gez);
  };
  sf.forEachChild(gez);
}

const aday = bulgular.filter((b) => b.stokOlabilir);
const acik = aday.filter((b) => !b.ayniDataDaWarehouse && !b.yakindaDamga);
console.log(`statü yazan site: ${bulgular.length} · stok olabilir: ${aday.length} · DAMGASIZ: ${acik.length}\n`);
console.log("=== DAMGASIZ (stok kümesine çekebilir, depo garanti yok) ===");
for (const b of acik) console.log(`  ${b.dosya}:${b.satir} [${b.cagri}] status=${b.statuIfadesi}`);
console.log("\n=== DAMGALI / kapsanan ===");
for (const b of aday.filter((x) => x.ayniDataDaWarehouse || x.yakindaDamga)) {
  console.log(`  ${b.dosya}:${b.satir} [${b.cagri}] ${b.ayniDataDaWarehouse ? "data'da warehouseId" : "yakında damga"}`);
}
console.log("\n=== stok OLAMAZ (kapsam dışı) ===");
for (const b of bulgular.filter((x) => !x.stokOlabilir)) console.log(`  ${b.dosya}:${b.satir} status=${b.statuIfadesi}`);
