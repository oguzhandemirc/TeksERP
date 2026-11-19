// =============================================================================
// Bekçi: İNSAN METNİNDE ÖLÇÜ SAYISI BİÇİMİ — DB gerekmez
// Çalıştır: npx tsx scripts/test_mesaj_sayi_bicimi.ts
// =============================================================================
// `genel.md` sayı kuralı: kg/metre/yüzde AYIRICISIZ ve ondalık VİRGÜLLE ("25000,5 kg", "%3,25").
// Sunucunun kullanıcıya döndürdüğü cümlelerdeki (hata · uyarı · mesaj · defter sebebi · belge
// listesi alt yazısı) ölçü sayısı TEK kaynaktan geçer: `helpers/qty-text.helper.ts`
// (`qtyText`/`pctText`). Ham `${x} m` JS nokta-ondalığı basar ("12.5 m"); `.toFixed(` ise hem
// nokta basar hem sondaki sıfırı tutar ("40.000 m"). `details`/DTO sayısal alanları makine
// biçiminde kalır — bu bekçi yalnız şablon dizgesi (insan metni) içine bakar.
//
// TS AST: `src/services/**` içindeki her şablon dizgesinin her `${…}` yuvası:
//   §1a yuvadan hemen sonra birim (` m`, `kg`, `metre`, `mt`) ya da `%` → ifade biçimleyici çağrısı olmalı
//   §1b yuvadan hemen önce `%` (`%${x}`) → `pctText`
//   §1c yuvada `.toFixed(` → hiç olmaz (birimsiz de: nokta ondalık)
// Etiketli şablon (`Prisma.sql`…, `$queryRaw`…) ve logger/console çağrısı insan metni değildir, atlanır.
// Muaf listesi gerekçeli ve iki yönlü (§3): artık eşleşmeyen muaf kırmızıdır.
//
// Doğuş (2026-11-18): #771'in `test_warp_beam_mount` §0g satır regex taraması 22 levent dosyasına
// bakıyordu ve çok satırlı/üçlü (`? \`…\``) metni görmüyordu; buraya taşındı ve tüm servislere
// genişledi. O gün tabanda tambur geri alma · metraj düzeltme · fason kalan/kabul · emanet ekstresi
// · iş emri belgeleri/iptal etkisi · sayım dahil ihlaller aynı commit'te düzeltildi.
// Sonda: bkz. `docs/bekci-harita/diger.md` satırı.
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const ROOT = path.resolve(__dirname, "..");
const SVC = path.join(ROOT, "src/services");

/**
 * Biçimleyiciler: ölçü (`qtyText`/`pctText`), anlatı (`sayiMetni`/`oranMetni`), para (`paraMetni`, binlik ayrı kural);
 * aynı kuralı (ayırıcısız, ondalık virgül) uygulayan yüzey biçimleyicileri: etiket `formatNumber`, bildirim
 * `formatNotificationNumber`, patron dışa aktarım `formatDisplay` (üçü de `useGrouping:false`). Tamsayı üretenler de biçimlidir.
 */
const FORMATTERS = new Set(["qtyText", "pctText", "sayiMetni", "oranMetni", "paraMetni", "formatNumber", "formatNotificationNumber", "formatDisplay"]);
const INTEGER_CALLS = new Set(["round", "floor", "ceil", "trunc"]);
const UNIT_AFTER = /^\s?(?:m|kg|metre|mt)(?![\p{L}\d]|\.")/u;
const PCT_AFTER = /^\s?%/;
const PCT_BEFORE = /%$/;
const LOG_CALLEE = /^(?:logger|console|log)\.\w+$/;
/** Ham SQL metni (etiketsiz `$queryRawUnsafe` gövdesi, alias `m`) insan metni değildir. */
const SQL_TEXT = /\b(?:SELECT|FROM|WHERE|JOIN|UPDATE|INSERT INTO|ORDER BY)\b/;

/**
 * Gerekçeli muaflar — anahtar ya dosya/dizin ön eki (`src/services/x/`) ya da `göreli/yol.ts::<yuva ifadesi>`.
 * İnsan metni DEĞİL, para (binlik ayırıcılı ayrı kural, bu bekçinin kapsamı dışı) ya da tamsayı olduğu kanıtlı yerler.
 */
const ALLOWED: Record<string, string> = {
  // ── Dosya/dizin: kendi biçimleyicisi ve bekçisi olan çizim yüzeyleri ──
  "src/services/document-render/": "belge çizimi: sayı `fmt-num.ts` (ticari yuvarlama, PDF = Excel) — bekçi `test_belge_ticari_yuvarlama`; `%` CSS genişliği",
  "src/services/document-template/": "belge şablon motoru: Liquid sözdizimi (`{% %}`) ve CSS genişliği; sayı belge biçimleyicisinde",
  "src/services/helpers/native-preview.ts": "etiket önizleme SVG/CSS ölçüsü (px/mm), insan cümlesi değil",
  "src/services/helpers/label-canvas-html.helper.ts": "etiket tuvali CSS ölçüsü (mm), insan cümlesi değil",
  "src/services/helpers/label-html-landscape.helper.ts::fitScale.toFixed(3)": "CSS `scale()` çarpanı, insan metni değil",
  // TAKİP: native yazıcı satırı (PPLA/PPLB/ZPL) bugün nokta ondalık basar ve `test_label_ppla` bu baytı bekler;
  // HTML etiket `formatNumber` kullanır. Basılı etiket biçimini değiştirmek etiket alanı kararıdır — ayrı iş.
  "src/services/helpers/native-label.shared.ts::cleanCtl(p.weightKg)": "native etiket bayt metni (TAKİP: etiket kararı)",
  "src/services/helpers/native-label.shared.ts::cleanCtl(p.lengthMeters)": "native etiket bayt metni (TAKİP: etiket kararı)",
  // ── Makine anahtarı / parmak izi: idempotency imzası, çift-kayıt anahtarı — biçim DEĞİŞMEMELİ ──
  "src/services/consignment-dispatch/lines.ts::y.qtyKg.toFixed(3)": "sevk satırı imzası (token replay karşılaştırması)",
  "src/services/subcontractor/receive.ts::r.qty == null ? \"\" : new Prisma.Decimal(r.qty).toFixed(3)": "fason kabul imzası (token replay karşılaştırması)",
  "src/services/invoice.service.ts::new Prisma.Decimal(l.qty).toFixed(4)": "fatura satır imzası (token replay)",
  "src/services/invoice.service.ts::new Prisma.Decimal(l.unitPrice).toFixed(4)": "fatura satır imzası (token replay)",
  "src/services/purchase-order.service.ts::new Prisma.Decimal(l.qty).toFixed(4)": "sipariş satır imzası (token replay)",
  "src/services/purchase-order.service.ts::l.unitPrice == null ? \"-\" : new Prisma.Decimal(l.unitPrice).toFixed(4)": "sipariş satır imzası (token replay)",
  "src/services/quality-inspection.service.ts::meter.toFixed(3)": "aynı metrede çift hata anahtarı (Set), insan metni değil",
  "src/services/warping-order/plan.ts::t.targetLengthM.toFixed(3)": "devere emri açık adet imzası (token replay)",
  "src/services/warping-order/plan.ts::l.beamLengthM.toFixed(3)": "devere emri levent satırı imzası (token replay)",
  "src/services/warping-order/dispatch.ts::D(l.qty).toFixed(3)": "devere sevk imzası (token replay)",
  "src/services/warping-order/receive.ts::D(r.lengthM).toFixed(3)": "devere kabul imzası (token replay)",
  "src/services/warping-order/receive.ts::r.grossKg === null ? \"\" : D(r.grossKg).toFixed(3)": "devere kabul imzası (token replay)",
  "src/services/warping-order/receive.ts::r.tareKg === null ? \"\" : D(r.tareKg).toFixed(3)": "devere kabul imzası (token replay)",
  "src/services/warping-order/yarn-transfer.ts::q.toFixed(3)": "iplik aktarım imzası (token replay)",
  // ── Para: binlik ayırıcılı ayrı kural (`paraMetni`), bu bekçinin kapsamı dışı ──
  "src/services/invoice.service.ts::D(negative.unitPrice).toFixed(2)": "para (birim fiyat)",
  "src/services/invoice.service.ts::limit.toFixed(2)": "para (kredi limiti)",
  "src/services/invoice.service.ts::balance.toFixed(2)": "para (bakiye)",
  "src/services/invoice.service.ts::exposure.toFixed(2)": "para (risk)",
  "src/services/invoice.service.ts::extra.toFixed(2)": "para (ek tutar)",
  "src/services/helpers/cari-merge.helper.ts::balanceOf(sourceId, c).toFixed(2)": "para (cari bakiye)",
  "src/services/helpers/cari-merge.helper.ts::sum.toFixed(2)": "para (cari bakiye)",
  "src/services/helpers/cash-balance-guard.helper.ts::balance.toFixed(2)": "para (kasa bakiyesi)",
  "src/services/helpers/cash-balance-guard.helper.ts::ref.amount.toFixed(2)": "para (tutar)",
  "src/services/payment.service.ts::summary.leftover.toFixed(2)": "para (artan tutar)",
  "src/services/payment.service.ts::summary.total.toFixed(2)": "para (toplam)",
  // ── Tamsayı sayım: birim sözcüğü ad tamlamasıdır ("3 metre okuması") ──
  "src/services/helpers/guarded-hard-remove.ts::n": "okuma ADEDİ (count), tamsayı",
  // ── Basılı müşteri belgesi: `genel.md` "basılı müşteri belgeleri ayrı karar" ──
  "src/services/helpers/open-defect-note.helper.ts::m": "etiket + irsaliye notu, belge biçimi `fmtTrNum` (binlik; `test_label_open_defects` §2)",
};
const ALLOWED_PREFIXES = Object.keys(ALLOWED).filter((k) => !k.includes("::"));
const allowedKey = (h: Hit): string | undefined => (ALLOWED[h.key] ? h.key : ALLOWED_PREFIXES.find((p) => h.key.startsWith(p)));

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (n.endsWith(".ts") && !n.endsWith(".d.ts")) out.push(f);
  }
  return out;
}

function calleeName(e: ts.Expression): string | null {
  if (!ts.isCallExpression(e)) return null;
  const c = e.expression;
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return null;
}

interface Scope { names: Set<string>; fns: Set<string> }

/**
 * Yuva ifadesi biçimli mi: biçimleyici (ya da dosyada biçimleyiciyi saran yerel fonksiyon) çağrısı,
 * tamsayı (`Math.round`… · `.length`) ya da dosyada böyle bir ifadeyle kurulmuş `const` ad.
 */
function formatted(e: ts.Expression, sc: Scope): boolean {
  let x: ts.Expression = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  const name = calleeName(x);
  if (name && (FORMATTERS.has(name) || sc.fns.has(name))) return true;
  if (name && INTEGER_CALLS.has(name) && ts.isCallExpression(x) && x.expression.getText().startsWith("Math.")) return true;
  if (ts.isPropertyAccessExpression(x) && x.name.text === "length") return true;
  if (ts.isIdentifier(x) && sc.names.has(x.text)) return true;
  if (ts.isConditionalExpression(x)) return formatted(x.whenTrue, sc) && formatted(x.whenFalse, sc);
  if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return formatted(x.left, sc) && formatted(x.right, sc);
  // Yedek metin (`"?"`, `"—"`) ve sayısal sabit sayı biçimi taşımaz.
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || (ts.isNumericLiteral(x) && !x.text.includes("."))) return true;
  return false;
}

/** Yerel sarmalayıcı: gövdesinde bir biçimleyici çağrısı geçen ok/fonksiyon (`const sayi = (v) => … sayiMetni(…)`). */
function wrapsFormatter(fn: ts.Node): boolean {
  let found = false;
  const v = (n: ts.Node): void => {
    const name = ts.isCallExpression(n) ? calleeName(n) : null;
    if (name && FORMATTERS.has(name)) found = true;
    else ts.forEachChild(n, v);
  };
  v(fn);
  return found;
}

function inLogCall(n: ts.Node): boolean {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && LOG_CALLEE.test(p.expression.getText())) return true;
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

interface Hit { key: string; where: string; rule: string }

/** Tek kaynak metni tarar; öz sondada sentetik metinle de çağrılır. */
function scanSource(rel: string, text: string): Hit[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sc: Scope = { names: new Set(), fns: new Set() };
  // 1. geçiş: yerel biçimli adlar ve sarmalayıcılar (kullanım bildirimden önce gelebilir).
  const collect = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = n.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        if (wrapsFormatter(init.body)) sc.fns.add(n.name.text);
      } else if (formatted(init, sc)) sc.names.add(n.name.text);
    }
    if (ts.isFunctionDeclaration(n) && n.name && n.body && wrapsFormatter(n.body)) sc.fns.add(n.name.text);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const hits: Hit[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isTemplateExpression(n) && !ts.isTaggedTemplateExpression(n.parent) && !inLogCall(n) && !SQL_TEXT.test(n.getText(sf))) {
      n.templateSpans.forEach((span, i) => {
        const before = i === 0 ? n.head.text : n.templateSpans[i - 1]!.literal.text;
        const after = span.literal.text;
        const last = i === n.templateSpans.length - 1;
        const expr = span.expression;
        const src = expr.getText(sf).replace(/\s+/g, " ");
        const line = sf.getLineAndCharacterOfPosition(expr.getStart(sf)).line + 1;
        const add = (rule: string) => hits.push({ key: `${rel}::${src}`, where: `${rel}:${line} \${${src.slice(0, 60)}}`, rule });
        // `${a} %${b}`: `%` sonraki değerin önekidir · `%${x}%`: LIKE kalıbı, sayı değil.
        const pctAfter = PCT_AFTER.test(after) && (last || after.trim() !== "%");
        const like = PCT_BEFORE.test(before) && /^%/.test(after);
        if (src.includes(".toFixed(")) add("toFixed");
        else if (UNIT_AFTER.test(after) && !formatted(expr, sc)) add("birim");
        else if (!like && (pctAfter || PCT_BEFORE.test(before)) && !formatted(expr, sc)) add("yüzde");
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

function main(): void {
  console.log("=== İNSAN METNİNDE ÖLÇÜ SAYISI BİÇİMİ ===\n");
  // §0 körlük zemini — tarayıcı boşa düşerse "ihlal yok" ile "bakmadım" aynı yeşile çıkar.
  const files = walk(SVC);
  let templates = 0;
  const all: Hit[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    templates += (text.match(/`/g) ?? []).length;
    all.push(...scanSource(path.relative(ROOT, f).split(path.sep).join("/"), text));
  }
  check(`§0 zemin: src/services taraması (${files.length} dosya ≥ 800; ${templates} ters tırnak ≥ 5000)`, files.length >= 800 && templates >= 5000);
  check("§0b tek kaynak biçimleyici var (qty-text.helper qtyText/pctText)", /export const qtyText/.test(readFileSync(path.join(SVC, "helpers/qty-text.helper.ts"), "utf8")));
  // Tarayıcı `qtyText(`/`pctText(` çağrısını ADINDAN biçimli sayar: başka bir modül aynı adı tanımlarsa
  // (2026-11-18: mal kabul ön-uçuşunda ham `toString()` basan `qtyText` vardı) bekçi kör olur.
  const HELPER = path.join(SVC, "helpers/qty-text.helper.ts");
  const shadows = walk(path.join(ROOT, "src")).filter((f) => f !== HELPER && /\b(?:const|let|function)\s+(?:qtyText|pctText)\b/.test(readFileSync(f, "utf8")));
  check("§0c `qtyText`/`pctText` adı yalnız qty-text.helper'da tanımlı (gölge yok)", shadows.length === 0, shadows.map((f) => path.relative(ROOT, f)).join(", "));

  // §1 gerçek ihlaller
  const live = all.filter((h) => !allowedKey(h));
  check(`§1 insan metninde ham ölçü sayısı yok (birim · yüzde · toFixed)`, live.length === 0, live.map((h) => `${h.rule} ${h.where}`).join("\n   "));

  // §2 öz sonda — tarayıcı neyi yakalar, neyi bırakır (sentetik)
  const s = (code: string) => scanSource("x.ts", code).map((h) => h.rule);
  check("§2a `${x} m` · `${x}kg` · `${n.toFixed(1)}` · `%${p}` · `${p}%` yakalanır", JSON.stringify([
    s("throw AppError.conflict(`kalan ${x} m`)"), s("w.push(`${x}kg`)"), s("const t = `${n.toFixed(1)} adet`"), s("m = `fark %${p}`"), s("m = `fark ${p}%`"),
  ]) === JSON.stringify([["birim"], ["birim"], ["toFixed"], ["yüzde"], ["yüzde"]]));
  check("§2b çok satırlı + üçlü metin yakalanır", JSON.stringify(s("const m = ok\n  ? `a ${Number(q)} m`\n  : `b ${(\n x\n ).toFixed(2)} m`;")) === JSON.stringify(["birim", "toFixed"]));
  check("§2c biçimli / insan-metni-değil bırakılır (qtyText · ara ad · üçlü · müşteri · Prisma.sql · logger)", s(
    "a = `${qtyText(x)} m`; const q = pctText(y); b = `%${q}`; c = `${ok ? qtyText(1) : qtyText(2)} kg`; d = `${ad} müşterisinin`; e = Prisma.sql`${x} m`; logger.info(`${x} m`); f = `${n} top`;",
  ).length === 0);
  check("§2d SQL gövdesi · LIKE `%${q}%` · Math.round · yerel sarmalayıcı · `${a} %${pctText(b)}` · yedek metin bırakılır", s(
    "a = `SELECT x FROM t m WHERE m.id = ${id}`; b = `%${term}%`; c = `~${Math.round(q)} m`; const tr1 = (n) => sayiMetni(n, 1); d = `%${tr1(p)}`; e = `${ok ? \"▲\" : \"▼\"} %${pctText(v)}`; f = `${r ? qtyText(r.q) : \"?\"} m`; g = `${list.length} kg`;",
  ).length === 0);

  // §3 muaf listesi bayat değil
  const used = new Set(all.map(allowedKey).filter((k): k is string => !!k));
  const stale = Object.keys(ALLOWED).filter((k) => !used.has(k));
  check("§3 muaf listesi bayat değil (her muaf hâlâ eşleşiyor)", stale.length === 0, stale.join(", "));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
