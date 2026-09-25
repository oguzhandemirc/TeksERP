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
//   §6 K2 BORCU — bugünkü eski yazım siteleri `K2_BAGLANACAK`ta site başına beyanlı;
//      beyan İKİ YÖNLÜ: beyansız yeni site kırmızı, isabetsiz (ölü) beyan kırmızı. K2
//      her siteyi tek yazara bağlayınca liste boşalır ve kapı sert 0 olur.
// Sondalar (§5) her koşumda SAF tarayıcı üzerinde koşar: ihlal eklenince sayı ARTAR,
// helper'a taşınınca DÜŞER.
// =============================================================================
import { readFileSync } from "fs";
import { join, relative, sep } from "path";
import * as ts from "typescript";
import { walkTs } from "./lib/ts-tarama";
import { fonksiyonAdi } from "./lib/damga-null-tarama";
import { atlamaDefteri } from "./lib/atlama";

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
const HELPER_REL = ["services", "helpers", "swatch-event.helper.ts"].join("/");

/** Kartelanın yerini anlatan kolonlar — yalnız tek yazar değiştirir. */
export const YER_KOLONLARI = new Set(["status", "statusChangedAt", "sackId", "shipmentId", "cancelledAt", "cancelReason"]);
const GUNCELLE = new Set(["update", "updateMany", "updateManyAndReturn", "upsert"]);
const YARAT = new Set(["create", "createMany", "createManyAndReturn"]);
const OLAY_YAZIM = new Set([...GUNCELLE, ...YARAT, "delete", "deleteMany"]);
const ILISKI_YAZIM = new Set(["connect", "connectOrCreate", "disconnect", "set", "create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

/**
 * K2'de tek yazara bağlanacak eski siteler — dosya · fonksiyon → site sayısı.
 * Sayı ÖLÇÜLENE eşit olmalı; site bağlanınca satır SİLİNİR (ölü beyan kırmızıdır).
 */
export const K2_BAGLANACAK: Record<string, number> = {
  "services/kartela.service.ts · cancelReceipt": 1,
  "services/kartela.service.ts · reduceStock": 1,
  "services/kartela.service.ts · reverseStockReductionTx": 1,
  "services/shipping.service.ts · scanIntoSack": 2,
  "services/shipping.service.ts · addKartelaToSack": 1,
  "services/shipping.service.ts · removeSwatchFromSack": 1,
  "services/shipping.service.ts · distributeSackContents": 1,
  "services/shipping.service.ts · removeSack": 1,
  "services/shipping.service.ts · createShipmentCoreTx": 1,
  "services/shipping.service.ts · addSacksToShipment": 1,
  "services/shipping.service.ts · removeSackFromShipment": 1,
  "services/shipping.service.ts · cancelPlannedShipmentTx": 1,
};

export interface Olcum {
  /** "dosya · fonksiyon" başına yer/doğuş ihlali (K2 borcuyla karşılaştırılır). */
  yerVeDogus: Map<string, string[]>;
  olayIhlal: string[];
  olculemedi: string[];
  yazimSayisi: number;
  dogusSayisi: number;
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
  const o: Olcum = { yerVeDogus: new Map(), olayIhlal: [], olculemedi: [], yazimSayisi: 0, dogusSayisi: 0 };
  const sf = ts.createSourceFile(rel, kod, ts.ScriptTarget.Latest, true);
  if (rel === HELPER_REL) return o;
  const yer = (n: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const yerIhlali = (n: ts.Node) => {
    const k = `${rel} · ${fonksiyonAdi(n)}`;
    o.yerVeDogus.set(k, [...(o.yerVeDogus.get(k) ?? []), yer(n)]);
  };
  const gez = (n: ts.Node): void => {
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
  const out: Olcum = { yerVeDogus: new Map(), olayIhlal: [], olculemedi: [], yazimSayisi: 0, dogusSayisi: 0 };
  for (const p of parcalar) {
    for (const [k, v] of p.yerVeDogus) out.yerVeDogus.set(k, [...(out.yerVeDogus.get(k) ?? []), ...v]);
    out.olayIhlal.push(...p.olayIhlal);
    out.olculemedi.push(...p.olculemedi);
    out.yazimSayisi += p.yazimSayisi;
    out.dogusSayisi += p.dogusSayisi;
  }
  return out;
}

/** §6 — ölçülen siteler ile K2 borcu arasındaki fark (iki yönlü). */
export function borcFarki(o: Olcum, borc: Record<string, number>): { beyansiz: string[]; olu: string[] } {
  const beyansiz = [...o.yerVeDogus]
    .filter(([k, satirlar]) => borc[k] !== satirlar.length)
    .map(([k, satirlar]) => `${k} :${satirlar.map((s) => s.split(":").pop()).join(",")} (ölçülen ${satirlar.length}, beyan ${borc[k] ?? "YOK"})`);
  const olu = Object.keys(borc).filter((k) => !o.yerVeDogus.has(k));
  return { beyansiz, olu };
}

// ── Gerçek ağaç ──────────────────────────────────────────────────────────────
const agac = birlestir(
  walkTs(SRC).map((abs) => olc(relative(SRC, abs).split(sep).join("/"), readFileSync(abs, "utf8"))),
);
const helperKodu = readFileSync(join(SRC, HELPER_REL), "utf8");

console.log("\n=== Kartela olay defteri — yazar kümesi ===");
check("§0 körlük zemini: kartela yazımı ve doğuşu görülüyor",
  agac.yazimSayisi >= 1 && helperKodu.includes("tx.swatch.updateManyAndReturn") && helperKodu.includes("tx.swatch.createManyAndReturn"),
  `helper dışı ${agac.yazimSayisi} güncelleme · ${agac.dogusSayisi} doğuş`);
const fark = borcFarki(agac, K2_BAGLANACAK);
check("§1/§2 helper DIŞINDA yer/doğuş yazımı yalnız beyanlı K2 sitelerinde", fark.beyansiz.length === 0,
  fark.beyansiz.length ? `BEYANSIZ: ${fark.beyansiz.join(" · ")} — transitionSwatchesTx/createSwatchesTx kullan` : `${agac.yerVeDogus.size} site, hepsi beyanlı`);
check("§6 ölü K2 beyanı yok (bağlanan site listeden silinir)", fark.olu.length === 0,
  fark.olu.length ? `İSABETSİZ BEYAN: ${fark.olu.join(" · ")}` : `${Object.keys(K2_BAGLANACAK).length} beyan, hepsi ölçüldü`);
check("§3 olay satırı yalnız helper'da yazılır", agac.olayIhlal.length === 0,
  agac.olayIhlal.length ? `helper DIŞINDA: ${agac.olayIhlal.join(" · ")}` : "0 ihlal");
check("§4 ölçülemeyen kartela yazımı yok (data nesne literali)", agac.olculemedi.length === 0,
  agac.olculemedi.length ? `ÖLÇÜLEMEDİ: ${agac.olculemedi.join(" · ")}` : "0");
const borcToplam = Object.values(K2_BAGLANACAK).reduce((a, b) => a + b, 0);
console.log(`ℹ️  K2 BORCU: ${borcToplam} site / ${Object.keys(K2_BAGLANACAK).length} fonksiyon`);

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
const borcSonda = borcFarki(s(YER), { "services/x.service.ts · f": 1 });
const borcOlu = borcFarki(s(YER_TASINDI), { "services/x.service.ts · f": 1 });
check("§5j sonda: beyanlı site yeşil; site bağlanınca beyan ÖLÜ kırmızı olur",
  borcSonda.beyansiz.length === 0 && borcSonda.olu.length === 0 && borcOlu.olu.length === 1);
check("§5k sonda: aynı fonksiyonda ikinci site beyan sayısını AŞAR",
  borcFarki(s(YER.replace("} }); }", "} }); await tx.swatch.updateMany({ where:{id}, data:{ shipmentId: null } }); }")), { "services/x.service.ts · f": 1 }).beyansiz.length === 1);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
process.exit(fail > 0 ? 1 : 0);
