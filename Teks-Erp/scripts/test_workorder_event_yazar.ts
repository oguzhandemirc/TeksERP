// =============================================================================
// BEKÇİ — İŞ EMRİ HAREKET DEFTERİNİN YAZAR KÜMESİ (AST, DB'siz)
// =============================================================================
// Kural (docs/design/IS-EMRI-HAREKET-DEFTERI.md §4.3): iş emrinin durumunu ya da
// planını değiştiren her yol `work_order_events`e satır yazar.
//   §1 STATÜ — `workOrder.update*` gövdesinde `status` YALNIZ
//      `helpers/workorder-event.helper.ts`te yazılır (claimWorkOrderStatusTx).
//      Sert kapı: ihlal 0.
//   §2 DOĞUŞ — `workOrder.create` YALNIZ helper'da (`createWorkOrderTx` satırı ve
//      CREATED'ı aynı tx'te yazar). Sert kapı: ihlal 0.
//   §3 ALAN — izlenen plan alanını (`WORK_ORDER_TRACKED_FIELDS`: renk · en · metre ·
//      kg · kat · kumaş · tarih · rota · tip · aktiflik) yazan fonksiyon bir alan
//      yazıcısı (`recordWorkOrderFieldChangesTx` / `recordWorkOrderFieldDiffTx`)
//      çağırır. Sert kapı: ihlal 0 (D2'de 10 → 0).
//   §3c NUMARA — `workOrderNumber` doğuşta donar: hiçbir update gövdesinde yazılmaz.
//   §4 ÖLÇÜLEMEDİ — `data` nesne literali değilse (değişken/spread) yazılan
//      anahtarlar görülemez; üçüncü sonuç sessizce "uyumlu" sayılmaz.
//   §6 KÜNYE — `claimWorkOrderStatusTx(... to: COMPLETED)` çağıran fonksiyon
//      `freezeCloseSnapshotTx` da çağırır (kapanış künyesiz olamaz) ve
//      `workOrderCloseSnapshot.create` YALNIZ künye helper'ında yazılır. Sert.
// Sondalar (§5) her koşumda SAF tarayıcı üzerinde koşar: ihlal eklenince sayı
// ARTAR, düzeltilince DÜŞER — ikinci yön olmadan tabanı düşüremeyen bir cırcır
// yazılabilirdi.
// =============================================================================
import { readFileSync } from "fs";
import { join, relative, sep } from "path";
import * as ts from "typescript";
import { walkTs } from "./lib/ts-tarama";
import { WORK_ORDER_TRACKED_FIELDS } from "../src/constants/workorder-event-fields";
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
const HELPER_REL = ["services", "helpers", "workorder-event.helper.ts"].join("/");
const KUNYE_REL = ["services", "helpers", "workorder-close-snapshot.helper.ts"].join("/");

/** §3 izlenen plan alanları — tek kaynak `constants/workorder-event-fields.ts`. */
export const IZLENEN_ALANLAR = new Set<string>(WORK_ORDER_TRACKED_FIELDS);
const ALAN_YAZICILARI = ["recordWorkOrderFieldChangesTx", "recordWorkOrderFieldDiffTx"];

const YAZIM = new Set(["update", "updateMany", "updateManyAndReturn", "upsert"]);

export interface Olcum {
  statuIhlal: string[];
  dogusIhlal: string[];
  alanIhlal: string[];
  numaraIhlal: string[];
  olculemedi: string[];
  kunyesizKapanis: string[];
  kunyeYazariDisi: string[];
  kapanisSayisi: number;
  dogusSayisi: number;
  yazimSayisi: number;
}

function enYakinFonksiyonlar(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p)) out.push(p);
  }
  return out;
}

function cagiriyor(fn: ts.Node, ad: string): boolean {
  let bulundu = false;
  const gez = (n: ts.Node): void => {
    if (bulundu) return;
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      const isim = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
      if (isim === ad) { bulundu = true; return; }
    }
    ts.forEachChild(n, gez);
  };
  gez(fn);
  return bulundu;
}

function dataAnahtarlari(arg: ts.Expression | undefined): string[] | null {
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
  const data = arg.properties.find(
    (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === "data",
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
  const o: Olcum = {
    statuIhlal: [], dogusIhlal: [], alanIhlal: [], numaraIhlal: [], olculemedi: [], kunyesizKapanis: [],
    kunyeYazariDisi: [], kapanisSayisi: 0, dogusSayisi: 0, yazimSayisi: 0,
  };
  const sf = ts.createSourceFile(rel, kod, ts.ScriptTarget.Latest, true);
  const helperMi = rel === HELPER_REL;
  const gez = (n: ts.Node): void => {
    // §6 COMPLETED claim'i künyesiz olamaz
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "claimWorkOrderStatusTx") {
      const opts = n.arguments[2];
      const to = opts && ts.isObjectLiteralExpression(opts)
        ? opts.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "to")
        : undefined;
      if (to && ts.isPropertyAssignment(to) && /\bCOMPLETED$/.test(to.initializer.getText(sf))) {
        o.kapanisSayisi++;
        if (!enYakinFonksiyonlar(n).some((f) => cagiriyor(f, "freezeCloseSnapshotTx"))) {
          o.kunyesizKapanis.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
        }
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
      && /(^|\.)workOrderCloseSnapshot$/.test(n.expression.expression.getText(sf))
      && ["create", "createMany", "update", "updateMany", "upsert"].includes(n.expression.name.text)
      && rel !== KUNYE_REL) {
      o.kunyeYazariDisi.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const yontem = n.expression.name.text;
      const hedef = n.expression.expression.getText(sf);
      if (/(^|\.)workOrder$/.test(hedef) && (yontem === "create" || YAZIM.has(yontem))) {
        const yer = `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
        const fonksiyonlar = enYakinFonksiyonlar(n);
        const cagrili = (ad: string) => fonksiyonlar.some((f) => cagiriyor(f, ad));
        if (yontem === "create") {
          o.dogusSayisi++;
          if (!helperMi) o.dogusIhlal.push(yer);
        } else {
          o.yazimSayisi++;
          const keys = dataAnahtarlari(n.arguments[0]);
          if (helperMi) {
            // Tek yazarın kendisi: statüyü ve ek kolonları çağıranın verdiği nesneden yazar.
          } else if (keys === null) {
            o.olculemedi.push(yer);
          } else {
            if (keys.includes("status")) o.statuIhlal.push(yer);
            if (keys.includes("workOrderNumber")) o.numaraIhlal.push(yer);
            const alan = keys.filter((k) => IZLENEN_ALANLAR.has(k));
            if (alan.length > 0 && !ALAN_YAZICILARI.some(cagrili)) {
              o.alanIhlal.push(`${yer} (${alan.join(",")})`);
            }
          }
        }
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return o;
}

function birlestir(parcalar: Olcum[]): Olcum {
  return parcalar.reduce<Olcum>(
    (a, b) => ({
      statuIhlal: [...a.statuIhlal, ...b.statuIhlal],
      dogusIhlal: [...a.dogusIhlal, ...b.dogusIhlal],
      alanIhlal: [...a.alanIhlal, ...b.alanIhlal],
      numaraIhlal: [...a.numaraIhlal, ...b.numaraIhlal],
      olculemedi: [...a.olculemedi, ...b.olculemedi],
      kunyesizKapanis: [...a.kunyesizKapanis, ...b.kunyesizKapanis],
      kunyeYazariDisi: [...a.kunyeYazariDisi, ...b.kunyeYazariDisi],
      kapanisSayisi: a.kapanisSayisi + b.kapanisSayisi,
      dogusSayisi: a.dogusSayisi + b.dogusSayisi,
      yazimSayisi: a.yazimSayisi + b.yazimSayisi,
    }),
    {
      statuIhlal: [], dogusIhlal: [], alanIhlal: [], numaraIhlal: [], olculemedi: [], kunyesizKapanis: [],
      kunyeYazariDisi: [], kapanisSayisi: 0, dogusSayisi: 0, yazimSayisi: 0,
    },
  );
}

// ── Gerçek ağaç ──────────────────────────────────────────────────────────────
const agac = birlestir(
  walkTs(SRC).map((abs) => olc(relative(SRC, abs).split(sep).join("/"), readFileSync(abs, "utf8"))),
);

console.log("\n=== İş emri hareket defteri — yazar kümesi ===");
check("§0 körlük zemini: iş emri yazımı ve doğuşu görülüyor",
  agac.yazimSayisi >= 5 && agac.dogusSayisi >= 1,
  `${agac.yazimSayisi} yazım · ${agac.dogusSayisi} doğuş`);
check("§1 statü yalnız workorder-event.helper'da yazılır", agac.statuIhlal.length === 0,
  agac.statuIhlal.length ? `helper DIŞINDA statü yazımı: ${agac.statuIhlal.join(" · ")}` : "0 ihlal");
check("§2 workOrder.create yalnız helper'da (doğuş CREATED'la aynı tx)", agac.dogusIhlal.length === 0,
  agac.dogusIhlal.length ? `helper DIŞINDA doğuş: ${agac.dogusIhlal.join(" · ")}` : `${agac.dogusSayisi} doğuş, hepsi helper'da`);
check("§3 izlenen alanı yazan her yol deftere yazar", agac.alanIhlal.length === 0,
  agac.alanIhlal.length ? `yazıcısız alan yazımı: ${agac.alanIhlal.join(" · ")}` : "0 ihlal");
check("§3c iş emri numarası hiçbir update gövdesinde yazılmaz", agac.numaraIhlal.length === 0,
  agac.numaraIhlal.length ? `numara yazımı: ${agac.numaraIhlal.join(" · ")}` : "0 ihlal");
check("§4 ölçülemeyen yazım yok (data nesne literali)", agac.olculemedi.length === 0,
  agac.olculemedi.length ? `ÖLÇÜLEMEDİ: ${agac.olculemedi.join(" · ")}` : "0");

check("§6 her COMPLETED claim'i künye dondurur", agac.kapanisSayisi >= 2 && agac.kunyesizKapanis.length === 0,
  agac.kunyesizKapanis.length ? `künyesiz kapanış: ${agac.kunyesizKapanis.join(" · ")}` : `${agac.kapanisSayisi} kapanış yolu`);
check("§6b künye yalnız kendi helper'ında yazılır", agac.kunyeYazariDisi.length === 0,
  agac.kunyeYazariDisi.length ? `helper DIŞINDA: ${agac.kunyeYazariDisi.join(" · ")}` : "0");

// ── §5 SONDALAR — saf tarayıcı, iki yön ──────────────────────────────────────
const s = (kod: string, rel = "services/x.service.ts") => olc(rel, kod);
const STATU = `async function f(tx){ await tx.workOrder.updateMany({ where:{id}, data:{ status: "COMPLETED" } }); }`;
check("§5a sonda: helper dışında statü yazımı YAKALANIR", s(STATU).statuIhlal.length === 1);
check("§5b sonda: aynı yazım helper'da SERBEST", s(STATU, HELPER_REL).statuIhlal.length === 0);
const ALAN_IHLAL = `async function f(tx){ await tx.workOrder.update({ where:{id}, data:{ width: 1 } }); }`;
const ALAN_DUZELTILDI = `async function f(tx){ await tx.workOrder.update({ where:{id}, data:{ width: 1 } }); await recordWorkOrderFieldChangesTx(tx, id, [], ctx); }`;
check("§5c sonda ⬆: yazıcısız alan yazımı sayıyı ARTIRIR", s(ALAN_IHLAL).alanIhlal.length === 1);
check("§5d sonda ⬇: yazıcı eklenince sayı DÜŞER", s(ALAN_DUZELTILDI).alanIhlal.length === 0);
check("§5d2 sonda: diff yazıcısı da yazıcı sayılır",
  s(ALAN_IHLAL.replace("} }); }", "} }); await recordWorkOrderFieldDiffTx(tx, id, b, a, ctx); }")).alanIhlal.length === 0);
const NUMARA = `async function f(tx){ await tx.workOrder.update({ where:{id}, data:{ workOrderNumber: "X" } }); }`;
check("§5l sonda ⬆: numara yazımı YAKALANIR; ⬇ kaldırılınca düşer",
  s(NUMARA).numaraIhlal.length === 1 && s(NUMARA.replace("workOrderNumber", "notes")).numaraIhlal.length === 0);
const DOGUS = `async function f(tx){ const wo = await tx.workOrder.create({ data:{} }); }`;
check("§5e sonda: helper dışında doğuş YAKALANIR", s(DOGUS).dogusIhlal.length === 1);
check("§5f sonda: aynı doğuş helper'da serbest", s(DOGUS, HELPER_REL).dogusIhlal.length === 0);
const SPREAD = `async function f(tx){ await tx.workOrder.updateMany({ where:{id}, data:{ ...patch } }); }`;
check("§5g sonda: spread'li data ÖLÇÜLEMEDİ sayılır (uyumlu değil)", s(SPREAD).olculemedi.length === 1);
const ICICE = `async function f(tx){ await prisma.$transaction(async (t) => { await t.workOrder.update({ where:{id}, data:{ width: 1 } }); }); await recordWorkOrderFieldChangesTx(tx, id, [], ctx); }`;
check("§5h sonda: yazıcı DIŞ fonksiyonda da sayılır (tx sarmalı)", s(ICICE).alanIhlal.length === 0);
const KAPANIS = `async function f(tx){ await claimWorkOrderStatusTx(tx, id, { from: [], to: WorkOrderStatus.COMPLETED, ctx }); }`;
const KAPANIS_TAMAM = `async function f(tx){ await claimWorkOrderStatusTx(tx, id, { from: [], to: WorkOrderStatus.COMPLETED, ctx }); await freezeCloseSnapshotTx(tx, id, o); }`;
const IPTAL = `async function f(tx){ await claimWorkOrderStatusTx(tx, id, { from: [], to: WorkOrderStatus.CANCELLED, ctx }); }`;
check("§5i sonda: künyesiz COMPLETED claim'i YAKALANIR", s(KAPANIS).kunyesizKapanis.length === 1);
check("§5j sonda: künye eklenince serbest; iptal claim'i künye istemez",
  s(KAPANIS_TAMAM).kunyesizKapanis.length === 0 && s(IPTAL).kunyesizKapanis.length === 0);
check("§5k sonda: helper dışında künye yazımı YAKALANIR",
  s(`async function f(tx){ await tx.workOrderCloseSnapshot.create({ data:{} }); }`).kunyeYazariDisi.length === 1
    && s(`async function f(tx){ await tx.workOrderCloseSnapshot.create({ data:{} }); }`, KUNYE_REL).kunyeYazariDisi.length === 0);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
process.exit(fail > 0 ? 1 : 0);
