// =============================================================================
// BEKÇİ — KARTELA OLAY DEFTERİNİN YAZAR KÜMESİ (AST, DB'siz)
// =============================================================================
// Kural (docs/design/KARTELA-HAREKET-DEFTERI.md §5.2): kartelanın yerini anlatan
// kolonlar (`YER_KOLONLARI`) ve kartelanın doğuşu YALNIZ
// `helpers/swatch-event.helper.ts`ten yazılır; olay satırı da yalnız oradan doğar.
//   §1 YER — `swatch.update*`/`upsert` gövdesinde yer kolonu helper DIŞINDA yazılmaz.
//   §2 DOĞUŞ — `swatch.create*` helper DIŞINDA yok (BORN satırı doğuşla aynı tx'te).
//   §3 OLAY — `swatchEvent` üzerindeki her yazım helper'da; ham SQL ve ilişki üzerinden
//      (`swatches: { connect … }`) yazım da sayılır.
//   §4 ÖLÇÜLEMEDİ — `data` nesne literali değilse (değişken/spread) yazılan anahtar
//      görülemez; üçüncü sonuç sessizce "uyumlu" sayılmaz.
//   §7 TETİK — tek yazara verilen her `trigger` Türkçe sözlükte (`SWATCH_TRIGGER_LABEL`);
//      iki yönlü: sözlükte olup hiçbir yerde verilmeyen tetik de kırmızı.
//   §8 STOK YÜKLEMİ — "stokta kartela" sorgusu `SWATCH_IN_STOCK_WHERE`den; kartela okuma
//      sorgusunda elle `sackId: null` + `shipmentId: null` üçlüsü kırmızı.
// Kapsam `src/` + `scripts/` (bakım/düzeltme script'i de tek yazardan geçer); bekçi ve
// fikstür dosyaları (`test_*` · `fixture-*`) hariç — onlar kurgu durum kurar.
// K1'deki eski site beyanı (14 → 13) K2'de 0'a indi ve silindi; kapı sert 0.
// Sondalar (§5) her koşumda SAF tarayıcı üzerinde koşar: ihlal eklenince sayı ARTAR,
// helper'a taşınınca DÜŞER.
// =============================================================================
import { readFileSync } from "fs";
import { join, relative, sep } from "path";
import * as ts from "typescript";
import { walkTs } from "./lib/ts-tarama";
import { fonksiyonAdi } from "./lib/damga-null-tarama";
import { atlamaDefteri } from "./lib/atlama";
import { SWATCH_TRIGGER_LABEL } from "../src/constants/swatch-event-labels";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

const SRC = join(__dirname, "..", "src");
const SCRIPTS = __dirname;
const HELPER_REL = ["services", "helpers", "swatch-event.helper.ts"].join("/");

/** Kartelanın yerini anlatan kolonlar — yalnız tek yazar değiştirir. */
export const YER_KOLONLARI = new Set(["status", "statusChangedAt", "sackId", "shipmentId", "cancelledAt", "cancelReason"]);
const GUNCELLE = new Set(["update", "updateMany", "updateManyAndReturn", "upsert"]);
const YARAT = new Set(["create", "createMany", "createManyAndReturn"]);
const OLAY_YAZIM = new Set([...GUNCELLE, ...YARAT, "delete", "deleteMany"]);
const TEK_YAZAR = new Set(["transitionSwatchesTx", "createSwatchesTx"]);
const OKUMA = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "groupBy", "aggregate"]);
const ILISKI_YAZIM = new Set(["connect", "connectOrCreate", "disconnect", "set", "create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

export interface Olcum {
  /** "dosya · fonksiyon" başına yer/doğuş ihlali (K2 borcuyla karşılaştırılır). */
  yerVeDogus: Map<string, string[]>;
  olayIhlal: string[];
  olculemedi: string[];
  yazimSayisi: number;
  dogusSayisi: number;
  /** Tek yazar çağrıları (helper dışı) — körlük zemini. */
  cagriSayisi: number;
  /** Tek yazar çağıran dosyalarda verilen `trigger` dizgeleri. */
  tetikler: Set<string>;
  /** Elle yazılmış stok üçlüsü (kartela okuma sorgusu). */
  stokUclusu: string[];
}

function dataAnahtarlari(arg: ts.Expression | undefined, anahtar: string): string[] | null {
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
  const data = arg.properties.find(
    (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === anahtar,
  );
  if (!data) return [];
  if (!ts.isPropertyAssignment(data) || !ts.isObjectLiteralExpression(data.initializer)) return null;
  const keys: string[] = [];
  for (const p of data.initializer.properties) {
    if (ts.isSpreadAssignment(p)) return null;
    if (p.name) keys.push(p.name.getText().replace(/['"]/g, ""));
  }
  return keys;
}

/** SAF TARAYICI — bir kaynak metni ölçer; sondalar da bunu çağırır. */
export function olc(rel: string, kod: string): Olcum {
  const o: Olcum = { yerVeDogus: new Map(), olayIhlal: [], olculemedi: [], yazimSayisi: 0, dogusSayisi: 0, cagriSayisi: 0, tetikler: new Set(), stokUclusu: [] };
  const tekYazarCagriyor = /\b(transitionSwatchesTx|createSwatchesTx)\s*\(/.test(kod);
  const sf = ts.createSourceFile(rel, kod, ts.ScriptTarget.Latest, true);
  if (rel === HELPER_REL) return o;
  const yer = (n: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const yerIhlali = (n: ts.Node) => {
    const k = `${rel} · ${fonksiyonAdi(n)}`;
    o.yerVeDogus.set(k, [...(o.yerVeDogus.get(k) ?? []), yer(n)]);
  };
  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && TEK_YAZAR.has(n.expression.text)) o.cagriSayisi++;
    if (tekYazarCagriyor && ts.isPropertyAssignment(n) && n.name.getText(sf) === "trigger" && ts.isStringLiteral(n.initializer)) {
      o.tetikler.add(n.initializer.text);
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /(^|\.)swatch$/.test(n.expression.expression.getText(sf))
      && OKUMA.has(n.expression.name.text)) {
      const arg = n.arguments[0];
      const w = arg && ts.isObjectLiteralExpression(arg)
        ? arg.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "where")
        : undefined;
      if (w && ts.isPropertyAssignment(w) && ts.isObjectLiteralExpression(w.initializer)) {
        const nulls = new Set(w.initializer.properties
          .filter((p) => ts.isPropertyAssignment(p) && p.initializer.kind === ts.SyntaxKind.NullKeyword)
          .map((p) => p.name!.getText(sf)));
        if (nulls.has("sackId") && nulls.has("shipmentId")) o.stokUclusu.push(yer(n));
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const yontem = n.expression.name.text;
      const hedef = n.expression.expression.getText(sf);
      if (/(^|\.)swatch$/.test(hedef) && YARAT.has(yontem)) {
        o.dogusSayisi++;
        yerIhlali(n);
      } else if (/(^|\.)swatch$/.test(hedef) && GUNCELLE.has(yontem)) {
        o.yazimSayisi++;
        const anahtarlar = yontem === "upsert"
          ? [dataAnahtarlari(n.arguments[0], "update"), dataAnahtarlari(n.arguments[0], "create")]
          : [dataAnahtarlari(n.arguments[0], "data")];
        if (anahtarlar.some((k) => k === null)) o.olculemedi.push(yer(n));
        else if (anahtarlar.some((k) => k!.some((x) => YER_KOLONLARI.has(x)))) yerIhlali(n);
      } else if (/(^|\.)swatchEvent$/.test(hedef) && OLAY_YAZIM.has(yontem)) {
        o.olayIhlal.push(yer(n));
      }
    }
    // İlişki üzerinden yazım: `swatches: { connect: … }` kartelanın sackId/shipmentId'sini değiştirir.
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "swatches" && ts.isObjectLiteralExpression(n.initializer)
      && n.initializer.properties.some((p) => p.name && ILISKI_YAZIM.has(p.name.getText(sf)))) {
      yerIhlali(n);
    }
    // Ham SQL: kartelanın yer kolonuna SET ya da olay tablosuna INSERT.
    if (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n)) {
      const metin = n.getText(sf);
      const setKolonu = /\bUPDATE\s+"?swatches"?\s+[\s\S]*?\bSET\b([\s\S]*?)(?=\bWHERE\b|\bRETURNING\b|\bFROM\b|$)/i.exec(metin);
      if (setKolonu && [...YER_KOLONLARI].some((k) => new RegExp(`"?${k}"?\\s*=`).test(setKolonu[1] ?? ""))) yerIhlali(n);
      if (/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?swatch_events"?/i.test(metin)) o.olayIhlal.push(yer(n));
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return o;
}

function birlestir(parcalar: Olcum[]): Olcum {
  const out: Olcum = { yerVeDogus: new Map(), olayIhlal: [], olculemedi: [], yazimSayisi: 0, dogusSayisi: 0, cagriSayisi: 0, tetikler: new Set(), stokUclusu: [] };
  for (const p of parcalar) {
    for (const [k, v] of p.yerVeDogus) out.yerVeDogus.set(k, [...(out.yerVeDogus.get(k) ?? []), ...v]);
    out.olayIhlal.push(...p.olayIhlal);
    out.olculemedi.push(...p.olculemedi);
    out.yazimSayisi += p.yazimSayisi;
    out.dogusSayisi += p.dogusSayisi;
    out.cagriSayisi += p.cagriSayisi;
    for (const t of p.tetikler) out.tetikler.add(t);
    out.stokUclusu.push(...p.stokUclusu);
  }
  return out;
}

// ── Gerçek ağaç ──────────────────────────────────────────────────────────────
/** Bekçi ve fikstür dosyaları kurgu durum kurar; bakım script'leri ise tek yazardan geçer. */
export function scriptTaranirMi(ad: string): boolean {
  return !/^(test_|fixture-)/.test(ad);
}
const agac = birlestir([
  ...walkTs(SRC).map((abs) => olc(relative(SRC, abs).split(sep).join("/"), readFileSync(abs, "utf8"))),
  ...walkTs(SCRIPTS)
    .filter((abs) => scriptTaranirMi(relative(SCRIPTS, abs).split(sep).pop()!))
    .map((abs) => olc(`scripts/${relative(SCRIPTS, abs).split(sep).join("/")}`, readFileSync(abs, "utf8"))),
]);
const helperKodu = readFileSync(join(SRC, HELPER_REL), "utf8");

console.log("\n=== Kartela olay defteri — yazar kümesi ===");
// Zemin: bugün 17 tek yazar çağrısı (15 geçiş sitesi, taşıma iki çağrı, doğuş bir).
check("§0 körlük zemini: tek yazar çağrıları ve helper'ın kendi yazımları görülüyor",
  agac.cagriSayisi >= 17 && helperKodu.includes("tx.swatch.updateManyAndReturn") && helperKodu.includes("tx.swatch.createManyAndReturn"),
  `${agac.cagriSayisi} tek yazar çağrısı · helper dışı ${agac.yazimSayisi} güncelleme · ${agac.dogusSayisi} doğuş`);
const siteler = [...agac.yerVeDogus].map(([k, satirlar]) => `${k} :${satirlar.map((x) => x.split(":").pop()).join(",")}`);
check("§1/§2 helper DIŞINDA yer/doğuş yazımı YOK (sert 0)", siteler.length === 0,
  siteler.length ? `helper DIŞINDA: ${siteler.join(" · ")} — transitionSwatchesTx/createSwatchesTx kullan` : "0 site");
check("§3 olay satırı yalnız helper'da yazılır", agac.olayIhlal.length === 0,
  agac.olayIhlal.length ? `helper DIŞINDA: ${agac.olayIhlal.join(" · ")}` : "0 ihlal");
const sozluk = new Set(Object.keys(SWATCH_TRIGGER_LABEL));
const sozluksuz = [...agac.tetikler].filter((t) => !sozluk.has(t));
const oluTetik = [...sozluk].filter((t) => !agac.tetikler.has(t));
check("§7 her tetiğin Türkçesi var; sözlükte ölü tetik yok (iki yönlü)", sozluksuz.length === 0 && oluTetik.length === 0 && agac.tetikler.size >= 15,
  `${agac.tetikler.size} tetik${sozluksuz.length ? ` · SÖZLÜKSÜZ: ${sozluksuz.join(", ")}` : ""}${oluTetik.length ? ` · ÖLÜ: ${oluTetik.join(", ")}` : ""}`);
check("§8 stokta-kartela sorgusu tek yükleme bağlı (elle sackId/shipmentId null üçlüsü yok)", agac.stokUclusu.length === 0,
  agac.stokUclusu.length ? `ELLE: ${agac.stokUclusu.join(" · ")} — SWATCH_IN_STOCK_WHERE kullan` : "0");
check("§4 ölçülemeyen kartela yazımı yok (data nesne literali)", agac.olculemedi.length === 0,
  agac.olculemedi.length ? `ÖLÇÜLEMEDİ: ${agac.olculemedi.join(" · ")}` : "0");

// ── §5 SONDALAR — saf tarayıcı, iki yön ──────────────────────────────────────
const s = (kod: string, rel = "services/x.service.ts") => olc(rel, kod);
const say = (o: Olcum) => [...o.yerVeDogus.values()].reduce((a, v) => a + v.length, 0);
const YER = `async function f(tx){ await tx.swatch.updateMany({ where:{id}, data:{ sackId: s } }); }`;
const YER_TASINDI = `async function f(tx){ await transitionSwatchesTx(tx, SwatchEventType.SACKED, { scope:{ ids:[id] }, sack, ctx }); }`;
check("§5a sonda ⬆: helper dışında yer yazımı sayıyı ARTIRIR", say(s(YER)) === 1);
check("§5b sonda ⬇: tek yazara taşınınca sayı DÜŞER", say(s(YER_TASINDI)) === 0);
check("§5c sonda: aynı yazım helper'da serbest", say(s(YER, HELPER_REL)) === 0);
check("§5d sonda: yer kolonu olmayan yazım sayılmaz (ör. renk)",
  say(s(`async function f(tx){ await tx.swatch.update({ where:{id}, data:{ colorId: c } }); }`)) === 0);
check("§5e sonda: helper dışında doğuş YAKALANIR",
  say(s(`async function f(tx){ await tx.swatch.createMany({ data: rows }); }`)) === 1);
check("§5f sonda: spread'li data ÖLÇÜLEMEDİ sayılır (uyumlu değil)",
  s(`async function f(tx){ await tx.swatch.updateMany({ where:{id}, data:{ ...patch } }); }`).olculemedi.length === 1);
check("§5g sonda: ilişki üzerinden kartela bağlama YAKALANIR",
  say(s(`async function f(tx){ await tx.sack.update({ where:{id}, data:{ swatches: { connect: [{ id }] } } }); }`)) === 1);
check("§5h sonda: ham SQL SET yer kolonu YAKALANIR, WHERE'deki sayılmaz",
  say(s('async function f(tx){ await tx.$executeRaw`UPDATE "swatches" SET "sackId" = NULL WHERE "id" = ${id}`; }')) === 1
    && say(s('async function f(tx){ await tx.$executeRaw`UPDATE "swatches" SET "colorId" = ${c} WHERE "sackId" = ${id}`; }')) === 0);
check("§5i sonda: helper dışında olay satırı YAKALANIR (Prisma + ham SQL)",
  s(`async function f(tx){ await tx.swatchEvent.createMany({ data: [] }); }`).olayIhlal.length === 1
    && s('async function f(tx){ await tx.$executeRaw`INSERT INTO "swatch_events" ("id") VALUES (${id})`; }').olayIhlal.length === 1);
check("§5j sonda: bakım script'i taranır, bekçi/fikstür dosyası taranmaz",
  scriptTaranirMi("kartela_durum_anomali.ts") && !scriptTaranirMi("test_x.ts") && !scriptTaranirMi("fixture-x.ts")
    && say(s(YER, "scripts/kartela_durum_anomali.ts")) === 1);

check("§5k sonda: tek yazar çağıran dosyadaki tetik toplanır, çağırmayanınki toplanmaz",
  s(`async function f(tx){ await transitionSwatchesTx(tx, T, { ctx: { trigger: "YENI_TETIK" } }); }`).tetikler.has("YENI_TETIK")
    && !s(`async function f(tx){ await x({ trigger: "BASKA" }); }`).tetikler.has("BASKA"));
const UCLU = `async function f(tx){ return tx.swatch.count({ where: { itemId, shipmentId: null, sackId: null, cancelledAt: null } }); }`;
check("§5l sonda ⬆: elle stok üçlüsü YAKALANIR; ⬇ tek yükleme geçince düşer",
  s(UCLU).stokUclusu.length === 1 && s(UCLU.replace("shipmentId: null, sackId: null, cancelledAt: null", "...SWATCH_IN_STOCK_WHERE")).stokUclusu.length === 0);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
process.exit(fail > 0 ? 1 : 0);
