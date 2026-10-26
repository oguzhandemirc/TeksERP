// =============================================================================
// BEKÇİ — BİLDİRİM TEK KAYNAK (AST): tek yazar + tek görme süzgeci
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_tek_kaynak
// =============================================================================
// NEDEN: outbox'a ikinci bir yazar, bayrak kapısını (emit no-op) ve iş tx'ine bağlılığı (rollback →
// bildirim yok) sessizce deler; görme kararını kendi hesaplayan ikinci bir yüzey de izin kaybında
// gizlemeyi unutur (B4 fail-closed). Bu bekçi `src/`i tarar ve tablo × işlem başına İZİNLİ dosya
// kümesini ölçer (Prisma delegesi + ham SQL metni):
//   §1 outbox INSERT yalnız emit helper · UPDATE yalnız dağıtıcı · DELETE yalnız budama
//   §2 gelen kutusu INSERT yalnız dağıtıcı · UPDATE dağıtıcı + kutu okuma servisi (okundu/ertele) · DELETE yalnız budama · günlük sayaç aynı
//   §3 koşul INSERT/UPDATE yalnız koşul tarayıcısı · DELETE yalnız budama
//   §4 görme: katalog `izinler` alanını yalnız görme helper'ı okur · gelen kutusuna dokunan her
//      dosya (budama hariç) görme helper'ını import eder · dağıtıcı kararı helper'dan alır ·
//      §4d tercih çözücüsünün İLK ifadesi görme süzgeci · §4e teslim kararı tek yerden (`decideDeliveries` → `resolvePreference`)
//   §5 körlük zemini (yazarlar bulundu) · §6 sondalar (saf tarayıcı, her koşumda)
// İzinli küme genişlerken (N1-ZIL okundu/ertele ucu) satır BURAYA eklenir — gerekçesiyle.
// DB GEREKTİRMEZ.
//
// NEGATİF SONDA (2026-10-24, sha256 ile birebir geri alındı): `services/order.service.ts`e
// `tx.notificationOutbox.create(...)` eklendi ⇒ yalnız §1 ❌ (13 ✅ / 1 ❌, `order.service.ts:3795`);
// ayrıca §6 sondaları her koşumda.
// (2026-10-25, N4-MOTOR) `resolvePreference`'ın başına görme dışı ifade eklendi ⇒ yalnız §4d ❌ (16 ✅ / 1 ❌); md5 ile geri alındı.
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { walkTs } from "./lib/ts-tarama";

const KOK = join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

export type Tablo = "outbox" | "inbox" | "conditions" | "stats";
export type Islem = "INSERT" | "UPDATE" | "DELETE" | "READ";
export interface Bulgu { tablo: Tablo; islem: Islem; dosya: string; satir: number }

const DELEGE: Record<string, Tablo> = {
  notificationOutbox: "outbox", notificationInbox: "inbox",
  notificationCondition: "conditions", notificationDailyStats: "stats",
};
const SQL_TABLO: Record<string, Tablo> = {
  notification_outbox: "outbox", notification_inbox: "inbox",
  notification_conditions: "conditions", notification_daily_stats: "stats",
};
const METOT: Record<string, Islem> = {
  create: "INSERT", createMany: "INSERT", createManyAndReturn: "INSERT", upsert: "INSERT",
  update: "UPDATE", updateMany: "UPDATE", updateManyAndReturn: "UPDATE",
  delete: "DELETE", deleteMany: "DELETE",
  findMany: "READ", findFirst: "READ", findUnique: "READ", findFirstOrThrow: "READ", findUniqueOrThrow: "READ",
  count: "READ", aggregate: "READ", groupBy: "READ",
};

/** Ham SQL metnindeki tablo işlemleri. SAF. */
export function sqlBulgulari(metin: string): Array<{ tablo: Tablo; islem: Islem }> {
  const out: Array<{ tablo: Tablo; islem: Islem }> = [];
  for (const [ad, tablo] of Object.entries(SQL_TABLO)) {
    const t = `"?${ad}"?\\b`;
    if (new RegExp(`INSERT\\s+INTO\\s+${t}`, "i").test(metin)) out.push({ tablo, islem: "INSERT" });
    if (new RegExp(`\\bUPDATE\\s+${t}`, "i").test(metin)) out.push({ tablo, islem: "UPDATE" });
    if (new RegExp(`DELETE\\s+FROM\\s+${t}`, "i").test(metin)) out.push({ tablo, islem: "DELETE" });
    if (new RegExp(`(?<!DELETE\\s{1,20})\\b(?:FROM|JOIN)\\s+${t}`, "i").test(metin)) out.push({ tablo, islem: "READ" });
  }
  return out;
}

/** Dosyadaki bildirim tablosu işlemleri + `.izinler` erişimi. SAF — girdi kaynak, çıktı bulgular. */
export function tara(kaynak: string, dosya: string): { bulgular: Bulgu[]; izinler: number[] } {
  const sf = ts.createSourceFile(dosya, kaynak, ts.ScriptTarget.Latest, true);
  const bulgular: Bulgu[] = [];
  const izinler: number[] = [];
  const satir = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const islem = METOT[n.expression.name.text];
      const ic = n.expression.expression;
      if (islem && ts.isPropertyAccessExpression(ic) && DELEGE[ic.name.text]) {
        bulgular.push({ tablo: DELEGE[ic.name.text]!, islem, dosya, satir: satir(n) });
      }
    }
    if (ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || ts.isStringLiteral(n)) {
      const metin = ts.isTemplateExpression(n)
        ? [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" ? ")
        : n.text;
      for (const b of sqlBulgulari(metin)) bulgular.push({ ...b, dosya, satir: satir(n) });
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === "izinler") izinler.push(satir(n));
    n.forEachChild(gez);
  };
  gez(sf);
  return { bulgular, izinler };
}

const EMIT = "src/services/helpers/notification-emit.helper.ts";
const GORME = "src/services/helpers/notification-visibility.helper.ts";
const DAGITICI = "src/services/notification-dispatch.service.ts";
const KOSUL = "src/jobs/notification-condition.job.ts";
const BUDAMA = "src/services/notification-prune.service.ts";
const KATALOG = "src/constants/notification-catalog.ts";
/** N1-ZIL: kişinin kendi satırında okundu/okunmadı/ertele (yalnız readAt/snoozedUntil; userId WHERE'de). */
const KUTU_OKUMA = "src/services/notification-inbox.service.ts";

/** Tablo × işlem → izinli dosyalar. READ'i olmayan tablo okuması serbesttir (görme kuralı §4'te). */
export const IZINLI: Record<Tablo, Partial<Record<Islem, readonly string[]>>> = {
  outbox: { INSERT: [EMIT], UPDATE: [DAGITICI], DELETE: [BUDAMA] },
  inbox: { INSERT: [DAGITICI], UPDATE: [DAGITICI, KUTU_OKUMA], DELETE: [BUDAMA] },
  stats: { INSERT: [DAGITICI], UPDATE: [DAGITICI], DELETE: [BUDAMA] },
  conditions: { INSERT: [KOSUL], UPDATE: [KOSUL], DELETE: [BUDAMA] },
};

const TERCIH = "src/services/helpers/notification-preference.helper.ts";
const TESLIM = "src/services/helpers/notification-delivery.helper.ts";

/** `resolvePreference` fonksiyonunun gövdesindeki ilk ifade `canSeeNotificationType(` çağrısını taşır mı (AST). */
export function ilkIfadeGormeMi(kaynak: string): boolean {
  const sf = ts.createSourceFile("t.ts", kaynak, ts.ScriptTarget.Latest, true);
  let ok = false;
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === "resolvePreference" && n.body) {
      const ilk = n.body.statements[0];
      ok = !!ilk && /\bcanSeeNotificationType\(/.test(ilk.getText(sf));
    }
  });
  return ok;
}

export function ihlaller(bulgular: readonly Bulgu[]): string[] {
  return bulgular
    .filter((b) => { const izin = IZINLI[b.tablo][b.islem]; return izin !== undefined && !izin.includes(b.dosya); })
    .map((b) => `${b.tablo}/${b.islem} ← ${b.dosya}:${b.satir}`);
}

function main(): void {
  console.log("=== BİLDİRİM TEK KAYNAK ===\n");
  const tum: Bulgu[] = [];
  const izinlerOkuyan: string[] = [];
  const kaynaklar = new Map<string, string>();
  for (const f of walkTs(join(KOK, "src"))) {
    const rel = relative(KOK, f).split(sep).join("/");
    const s = readFileSync(f, "utf8");
    kaynaklar.set(rel, s);
    const r = tara(s, rel);
    tum.push(...r.bulgular);
    if (r.izinler.length && rel !== GORME && rel !== KATALOG) izinlerOkuyan.push(`${rel}:${r.izinler.join(",")}`);
  }
  const sec = (t: Tablo) => tum.filter((b) => b.tablo === t);
  const yazan = (t: Tablo, i: Islem) => [...new Set(tum.filter((b) => b.tablo === t && b.islem === i).map((b) => b.dosya))];

  // §5 körlük zemini — tarayıcı yazarları GÖRÜYOR mu (görmüyorsa §1–§3 boş yeşildir).
  check("§5 körlük zemini: her izinli yazar tarayıcıda görünüyor",
    yazan("outbox", "INSERT").includes(EMIT) && yazan("outbox", "UPDATE").includes(DAGITICI) && yazan("outbox", "DELETE").includes(BUDAMA)
    && yazan("inbox", "INSERT").includes(DAGITICI) && yazan("inbox", "DELETE").includes(BUDAMA)
    && yazan("conditions", "INSERT").includes(KOSUL) && yazan("conditions", "UPDATE").includes(KOSUL)
    && yazan("stats", "INSERT").includes(DAGITICI) && yazan("stats", "DELETE").includes(BUDAMA),
    `${tum.length} bulgu`);

  const i1 = ihlaller(sec("outbox"));
  check("§1 ⭐ outbox: INSERT yalnız emit helper, UPDATE yalnız dağıtıcı, DELETE yalnız budama", i1.length === 0,
    i1.length ? i1.join(" · ") : `INSERT ${yazan("outbox", "INSERT").join(",")}`);
  const i2 = [...ihlaller(sec("inbox")), ...ihlaller(sec("stats"))];
  check("§2 ⭐ gelen kutusu + günlük sayaç: yazım yalnız dağıtıcı (+ okundu/ertele yalnız kutu okuma servisi), silme yalnız budama", i2.length === 0, i2.join(" · ") || "tek yazar");
  const i3 = ihlaller(sec("conditions"));
  check("§3 ⭐ koşul: aç/kapa yalnız koşul tarayıcısı, silme yalnız budama", i3.length === 0, i3.join(" · ") || "tek yazar");

  check("§4a ⭐ katalog `izinler` (görme DNF'si) yalnız görme helper'ında okunur", izinlerOkuyan.length === 0,
    izinlerOkuyan.join(" · ") || "tek okuyucu");
  const kutuyaDokunan = [...new Set(sec("inbox").map((b) => b.dosya))].filter((d) => d !== BUDAMA);
  const importsuz = kutuyaDokunan.filter((d) => !/from\s+["'][^"']*notification-visibility\.helper["']/.test(kaynaklar.get(d) ?? ""));
  check("§4b ⭐ gelen kutusuna dokunan her dosya görme helper'ını import eder (budama hariç)", importsuz.length === 0 && kutuyaDokunan.length > 0,
    importsuz.length ? `IMPORTSUZ: ${importsuz.join(", ")}` : kutuyaDokunan.join(", "));
  const dag = kaynaklar.get(DAGITICI) ?? "";
  check("§4c dağıtıcının alıcı kararı görme helper'ından (`visibleUsersFor`)", /\bvisibleUsersFor\(/.test(dag));
  const tercih = kaynaklar.get(TERCIH) ?? "";
  check("§4d ⭐ tercih çözücüsü `resolvePreference`'ın İLK ifadesi görme süzgeci (`canSeeNotificationType`)", ilkIfadeGormeMi(tercih),
    tercih ? "" : `${TERCIH} okunamadı`);
  const teslim = kaynaklar.get(TESLIM) ?? "";
  check("§4e dağıtıcı teslim kararını tek yerden alır (`decideDeliveries`) ve o da `resolvePreference`'ı çağırır",
    /\bdecideDeliveries\(/.test(dag) && /\bresolvePreference\(/.test(teslim));

  console.log("\n=== §6 SONDALAR (saf tarayıcı) ===");
  const S = (k: string, d = "src/x.ts") => tara(k, d).bulgular;
  check("§6h `resolvePreference` ilk ifadesi görme değilse yakalanır",
    !ilkIfadeGormeMi("function resolvePreference() { const a = 1; if (!canSeeNotificationType(x)) return; }")
    && ilkIfadeGormeMi("function resolvePreference() { if (!canSeeNotificationType(x)) return; }"));
  check("§6a ⭐ ikinci outbox yazarı (delege) yakalanır",
    ihlaller(S("await tx.notificationOutbox.create({ data: {} });")).length === 1);
  check("§6b ⭐ ham SQL outbox INSERT'ü yakalanır",
    ihlaller(S("await tx.$executeRaw`INSERT INTO notification_outbox (id) VALUES (${x})`;")).length === 1);
  check("§6c ham SQL tırnaklı tablo adı da yakalanır",
    ihlaller(S("await tx.$executeRawUnsafe('UPDATE \"notification_inbox\" SET x = 1');")).length === 1);
  check("§6d DELETE FROM okuma sayılmaz, budama dışında ihlaldir",
    S("q`DELETE FROM notification_conditions WHERE x`").map((b) => b.islem).join() === "DELETE"
    && ihlaller(S("q`DELETE FROM notification_conditions WHERE x`")).length === 1);
  check("§6e izinli dosyada aynı yazım ihlal değil",
    ihlaller(S("await tx.notificationOutbox.create({ data: {} });", EMIT)).length === 0);
  check("§6f `.izinler` okuması bulunur", tara("const x = entry.izinler;", "src/x.ts").izinler.length === 1);
  check("§6g okuma delegesi READ'tir (yazım değil)", S("await prisma.notificationInbox.findMany({});").map((b) => b.islem).join() === "READ");
}

main();
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
