// =============================================================================
// BEKÇİ — BİLDİRİM S5b: kalan boşluklar (vade koşulları · cari.degisti · kurşun kâğıt yolu · watchdog düzeltmesi)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_bosluk
// =============================================================================
// NEDEN: vade sorusunu bugüne dek yalnız yaşlandırma raporu cevaplıyordu; bildirim ayrı formül yazarsa aynı faturaya
// iki yüzey iki cevap verir. Ölçülenler:
//   §V0 AST — vade fonksiyonları (`resolveEffectiveDue` · `daysOverdueAt` · `bucketOfDaysOverdue` · `isOverdueBucket` ·
//       `dueWindowState`) yalnız `helpers/invoice-due.helper.ts`te TANIMLI; rapor onları helper'dan import eder; vade
//       kaynağı `collectAgingRows` + `dueWindowState` çağırır, `dueDate`/`paymentTermDays` okumaz; emit literali yok.
//   §V1 saf: `dueWindowState` sınırları (−pencere … −1 yaklaşan, 0 gecikmiş, vadesiz) + gruplama (yön, sayı, gün).
//   §V2 DB: gerçek faturalarla kaynak konuları = raporun kalem kovalarından BAĞIMSIZ türetilen küme (boğaz-ikiz);
//       ödenmiş/uzak vadeli fatura konu doğurmaz; tolerans eşiği; modül kapalı → boş; yükte tutar yok.
//   §C cari.degisti: gerçek `CustomerService.update` → tek outbox satırı, değişen alan ADLARI metinde (değer yok); değişiklik
//       yoksa / yalnız iç kolon değiştiyse satır yok; kanca fırlatınca kart da outbox da geri sarılır (aynı tx).
// NEGATİF SONDA: bölüm başlıklarında (aşağıda, bölüm bölüm).
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { walkTs } from "./lib/ts-tarama";
import { NOTIFICATION_CATALOG } from "../src/constants/notification-catalog";
import { canSeeNotificationType } from "../src/services/helpers/notification-visibility.helper";
import { dueWindowState } from "../src/services/helpers/invoice-due.helper";
import { collectAgingRows, getAgingReport, isOverdueBucket } from "../src/services/reports/finance-aging.report";
import { dueSoonSubjects, groupDueItems, overdueSubjects, overrideDueSourceDeps } from "../src/services/notification-sources/finans-vade";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { CustomerService } from "../src/services/customer.service";
import { emitCustomerChangedTx } from "../src/services/notification-sources/anaveri";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const SRC = join(__dirname, "..", "src");
const ek = Date.now().toString(36);
const DAY = 86_400_000;
const oku = (rel: string): string => readFileSync(join(SRC, rel), "utf8");
const DUE_FNS = ["resolveEffectiveDue", "daysOverdueAt", "bucketOfDaysOverdue", "isOverdueBucket", "dueWindowState"];
const HELPER = "services/helpers/invoice-due.helper.ts";
const REPORT = "services/reports/finance-aging.report.ts";
const VADE = "services/notification-sources/finans-vade.ts";

// ── §V0 AST ────────────────────────────────────────────────────────────────
// NEGATİF SONDA (2026-11-14): rapora `bucketOfDaysOverdue` yerel kopyası eklendi → §V0a ❌; finans-vade'de
//   `dueWindowState` yerine `it.daysOverdue >= 0` yazıldı → §V0c/§V1e/§V2c ❌. İkisi de geri alındı.
function bolumV0(): void {
  console.log("\n§V0 AST — vade tek kaynağı");
  const tanimlar = new Map<string, string[]>();
  const literaller: string[] = [];
  for (const f of walkTs(SRC)) {
    const rel = relative(SRC, f).split(sep).join("/");
    const sf = ts.createSourceFile(rel, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      const ad = ts.isFunctionDeclaration(n) && n.name ? n.name.text
        : ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) ? n.name.text : null;
      if (ad && DUE_FNS.includes(ad)) tanimlar.set(ad, [...(tanimlar.get(ad) ?? []), rel]);
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "emitNotification") {
        const a = n.arguments[1];
        if (a && ts.isStringLiteral(a) && /^finans\.vade-/.test(a.text)) literaller.push(`${a.text}@${rel}`);
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  const ihlal = DUE_FNS.filter((fn) => JSON.stringify(tanimlar.get(fn)) !== JSON.stringify([HELPER])).map((fn) => `${fn}: ${JSON.stringify(tanimlar.get(fn) ?? [])}`);
  check("§V0a ⭐ vade fonksiyonları yalnız invoice-due.helper'da tanımlı", ihlal.length === 0, ihlal.join(" · ") || `${DUE_FNS.length} fonksiyon`);
  const rapor = ts.createSourceFile(REPORT, oku(REPORT), ts.ScriptTarget.Latest, true);
  const raporImport = rapor.statements.some((s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)
    && s.moduleSpecifier.text === "../helpers/invoice-due.helper" && /resolveEffectiveDue/.test(s.getText()) && /daysOverdueAt/.test(s.getText()) && /bucketOfDaysOverdue/.test(s.getText()));
  check("§V0b rapor vade kararını helper'dan import ediyor (DAY_MS hesabı raporda yok)", raporImport && !/paymentTermDays \* /.test(oku(REPORT)));
  const kaynak = oku(VADE);
  check("§V0c ⭐ vade kaynağı yaşlandırma çekirdeği + dueWindowState'ten okur, kendi vadesini hesaplamaz",
    /collectAgingRows\(/.test(kaynak) && /dueWindowState\(/.test(kaynak) && !/\bdueDate\b|\bpaymentTermDays\b|daysOverdue\s*>=\s*0/.test(kaynak));
  check("§V0d vade türlerinin emit literali yok (koşul tarayıcısı yazar)", literaller.length === 0, literaller.join(" · ") || "temiz");
  const yasak = /tutar|bakiye|fiyat|amount|total/i;
  const yasakli = (["finans.vade-yaklasti", "finans.vade-gecti"] as const).flatMap((k) => NOTIFICATION_CATALOG[k].payloadAlanlari.filter((a) => yasak.test(a)));
  check("§V0e vade yüklerinde tutar alanı yok (S4 kararı)", yasakli.length === 0, yasakli.join(", ") || "temiz");
}

// ── §V1 saf ────────────────────────────────────────────────────────────────
function bolumV1(): void {
  console.log("\n§V1 saf — pencere sınırları + gruplama");
  check("§V1a pencere: −4 uzak · −3 yaklaşan · −1 yaklaşan · 0 gecikmiş · null vadesiz",
    dueWindowState(-4, 3) === "NOT_DUE" && dueWindowState(-3, 3) === "DUE_SOON" && dueWindowState(-1, 3) === "DUE_SOON"
      && dueWindowState(0, 3) === "OVERDUE" && dueWindowState(null, 3) === "NO_DUE");
  check("§V1b pencere 0 → yaklaşan kümesi boş", dueWindowState(-1, 0) === "NOT_DUE");
  const it = (netOpen: string, daysOverdue: number | null) => ({ netOpen, daysOverdue }) as never;
  const rows = [{ cariId: "c1", name: "A", code: "A1", currency: "TRY", items: [it("10", 5), it("20", 12), it("-5", 3), it("0", 40), it("7", -2), it("7", null)] }] as never;
  const gec = groupDueItems(rows, "OVERDUE", { windowDays: 0, minOverdue: 0 });
  const al = gec.find((s) => s.key === "c1:TRY:alacak")?.payload;
  const bor = gec.find((s) => s.key === "c1:TRY:borç")?.payload;
  check("§V1c ⭐ gecikmiş: yön başına konu, sayı + en eski gün; kapanmış (net 0) kalem sayılmaz",
    gec.length === 2 && al?.belgeSayisi === 2 && al?.gun === 12 && bor?.belgeSayisi === 1, JSON.stringify(gec.map((s) => s.payload)));
  check("§V1d tolerans 10 gün → yalnız 12 günlük kalem", groupDueItems(rows, "OVERDUE", { windowDays: 0, minOverdue: 10 }).map((s) => s.payload.belgeSayisi).join() === "1");
  const yak = groupDueItems(rows, "DUE_SOON", { windowDays: 3, minOverdue: 0 });
  check("§V1e yaklaşan: vadeye kalan gün (−2 → 2)", yak.length === 1 && yak[0]!.payload.gun === 2 && yak[0]!.payload.belgeSayisi === 1);
}

// ── §V2 DB: boğaz-ikiz ─────────────────────────────────────────────────────
// NEGATİF SONDA (2026-11-14): finans-vade'de `net === 0` süzgeci kaldırıldı → §V1c/§V1d ❌ (kapanmış kalem sayıldı). Geri alındı.
async function bolumV2(): Promise<void> {
  console.log("\n§V2 DB — kaynak = yaşlandırma raporu (boğaz-ikiz)");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const cust = await prisma.customer.create({ data: { code: `TEST-BB-${ek}`, name: `TEST-BB Müşteri ${ek}` }, select: { id: true } });
  const invIds: string[] = [];
  let geri: (() => void) | null = null;
  try {
    const cari = await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: cust.id }, select: { id: true } });
    const now = new Date();
    const fatura = async (n: string, gun: number, o: { paid?: number; type?: InvoiceType } = {}) => {
      const r = await prisma.invoice.create({
        data: {
          docNo: `TEST-BB-${n}-${ek}`, type: o.type ?? InvoiceType.SALES, cariId: cari.id, status: InvoiceStatus.CONFIRMED,
          issueDate: new Date(now.getTime() - 60 * DAY), confirmedAt: new Date(now.getTime() - 60 * DAY),
          dueDate: new Date(now.getTime() + gun * DAY + (gun < 0 ? -3_600_000 : 3_600_000)),
          grandTotal: new Prisma.Decimal(100), grandTotalTry: new Prisma.Decimal(100), paidTotal: new Prisma.Decimal(o.paid ?? 0),
        },
        select: { id: true },
      });
      invIds.push(r.id);
    };
    await fatura("G5", -5);
    await fatura("G12", -12);
    await fatura("ODENDI", -20, { paid: 100 });
    await fatura("Y2", 2);
    await fatura("U10", 10);
    await fatura("ALIS", -3, { type: InvoiceType.PURCHASE });
    geri = overrideDueSourceDeps({ moduleOpen: async () => true, agingRows: (asOf) => collectAgingRows({ asOf, cariId: cari.id, includeDetail: true }) });

    const gec = await overdueSubjects(now);
    const yak = await dueSoonSubjects(now);
    // Bağımsız türetim: rapor zarfının kalem kovaları (kaynağın yolu değil).
    const rapor = await getAgingReport({ asOf: now, cariId: cari.id, includeDetail: true });
    const kalemler = rapor.blocks.flatMap((b) => b.rows.flatMap((r) => r.items ?? []));
    const raporAlacakGec = kalemler.filter((i) => isOverdueBucket(i.bucket) && Number(i.netOpen) > 0).length;
    const raporBorcGec = kalemler.filter((i) => isOverdueBucket(i.bucket) && Number(i.netOpen) < 0).length;
    const al = gec.find((s) => s.key === `${cari.id}:TRY:alacak`)?.payload;
    const bor = gec.find((s) => s.key === `${cari.id}:TRY:borç`)?.payload;
    check("§V2a ⭐ gecikmiş belge sayısı = raporun gecikmiş kovalarındaki açık kalem sayısı (alacak + borç)",
      al?.belgeSayisi === raporAlacakGec && bor?.belgeSayisi === raporBorcGec && raporAlacakGec === 2 && raporBorcGec === 1,
      `kaynak ${String(al?.belgeSayisi)}/${String(bor?.belgeSayisi)} · rapor ${raporAlacakGec}/${raporBorcGec}`);
    check("§V2b ödenmiş fatura sayılmaz, en eski gün 12", al?.gun === 12, JSON.stringify(al));
    const yakPayload = yak.find((s) => s.key === `${cari.id}:TRY:alacak`)?.payload;
    // 2 gün 1 saat sonra → gecikme günü −3 (taban) → "en geç 3 gün içinde" (üst sınır; pencereyle aynı ölçü).
    check("§V2c yaklaşan (3 gün): yalnız 2 gün sonraki fatura (gün = 3, üst sınır); 10 gün sonraki girmez", yak.length === 1 && yakPayload?.belgeSayisi === 1 && yakPayload?.gun === 3, JSON.stringify(yak.map((s) => s.payload)));
    const yasak = /tutar|amount|total|100/i;
    check("§V2d yükte tutar yok", [...gec, ...yak].every((s) => !Object.entries(s.payload).some(([k, v]) => yasak.test(k) || String(v).includes("100"))));
    geri();
    geri = overrideDueSourceDeps({ moduleOpen: async () => false });
    check("§V2e modül kapalıyken iki koşul da boş", (await overdueSubjects(now)).length === 0 && (await dueSoonSubjects(now)).length === 0);
  } finally {
    geri?.();
    await prisma.invoice.deleteMany({ where: { id: { in: invIds } } });
    await cleanupTestCustomers([cust.id]);
  }
}

// ── §C cari.degisti ────────────────────────────────────────────────────────
// NEGATİF SONDA (2026-11-14): CustomerService'ten `afterUpdateTx` kaldırıldı → §Ca/§Cc/§Cd/§Ce ❌; BaseService'te kanca tx
//   DIŞINDA çağrıldı (yazım tx'siz) → §Cd ❌ (kart adı geri sarılmadı). İkisi de geri alındı.
class Patlat extends Error {}
async function bolumC(): Promise<void> {
  console.log("\n§C cari.degisti — gerçek CustomerService.update");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const ilk = await prisma.systemSetting.findUnique({ where: { key } });
  // Route config'iyle birebir (customer.routes.ts).
  const svc = new CustomerService({
    modelName: "customer", tableName: "CUSTOMER", searchFields: ["name"], codeSearchFields: ["code", "taxNumber", "exportCode"],
    defaultInclude: undefined, uniqueField: "code", nestedCreateFields: ["branches"],
  });
  const cust = await prisma.customer.create({ data: { code: `TEST-BBC-${ek}`, name: `TEST-BBC Müşteri ${ek}` }, select: { id: true } });
  const satirlar = () => prisma.notificationOutbox.findMany({ where: { kind: "cari.degisti", subjectId: cust.id }, select: { id: true, payload: true } });
  try {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
    await svc.update(cust.id, { name: `TEST-BBC Müşteri ${ek} Yeni`, contactPhone: "05550000000" });
    const r1 = await satirlar();
    const p = (r1[0]?.payload ?? {}) as Record<string, unknown>;
    check("§Ca ⭐ kart güncellemesi tek cari.degisti satırı yazar, alan adları metinde", r1.length === 1 && typeof p.alanlar === "string" && p.alanlar.includes("Ad"), JSON.stringify(p));
    check("§Cb yükte alan DEĞERİ yok (telefon metne girmez)", !JSON.stringify(p).includes("05550000000"));
    await svc.update(cust.id, { contactPhone: "05550000000" });
    check("§Cc değişiklik yoksa satır yok", (await satirlar()).length === 1);
    const asil = svc["afterUpdateTx"]!.bind(svc);
    (svc as unknown as { afterUpdateTx: typeof asil }).afterUpdateTx = async (tx, ctx) => { await asil(tx, ctx); throw new Patlat(); };
    const patladi = await svc.update(cust.id, { city: "TEST-Şehir" }).then(() => false, (e: unknown) => e instanceof Patlat);
    const kart = await prisma.customer.findUnique({ where: { id: cust.id }, select: { city: true } });
    check("§Cd ⭐ kanca fırlatınca kart ve outbox birlikte geri sarılır (aynı tx)", patladi && kart?.city !== "TEST-Şehir" && (await satirlar()).length === 1, `${patladi}/${kart?.city}`);
    let ic = -1;
    await prisma.$transaction(async (tx) => {
      await emitCustomerChangedTx(tx, cust.id, [{ field: "nameFold" }, { field: "updatedAt" }, { field: "type" }, { field: "clientToken" }], null);
      ic = await tx.notificationOutbox.count({ where: { kind: "cari.degisti", subjectId: cust.id } });
      throw new Patlat();
    }).catch((e: unknown) => { if (!(e instanceof Patlat)) throw e; });
    check("§Ce yalnız iç kolon değişimi bildirim doğurmaz (opt-in liste)", ic === 1, `${ic}`);
  } finally {
    await prisma.notificationOutbox.deleteMany({ where: { kind: "cari.degisti", subjectId: cust.id } });
    await cleanupTestCustomers([cust.id]);
    if (ilk) await prisma.systemSetting.update({ where: { key }, data: { value: (ilk.value ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

function bolumK7(): void {
  console.log("\n§K7 modül kapısı");
  const viewer = { permissions: ["*"] };
  const kapali = (kind: "finans.vade-yaklasti" | "finans.vade-gecti") => !canSeeNotificationType(viewer, kind, { modules: { financeEnabled: false }, gates: {} })
    && canSeeNotificationType(viewer, kind, { modules: { financeEnabled: true }, gates: {} });
  check("§K7a finans kapalıyken vade türleri görünmez", kapali("finans.vade-yaklasti") && kapali("finans.vade-gecti"));
}

async function main(): Promise<void> {
  console.log("=== Bildirim S5b — vade · cari değişti · kurşun kâğıt · watchdog düzeltmesi ===");
  bolumV0();
  bolumV1();
  bolumK7();
  await bolumV2();
  await bolumC();
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
