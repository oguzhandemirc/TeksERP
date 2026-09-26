// =============================================================================
// Bekçi: CARİ EKSTRE SIRASI BELİRLENİMLİ — tek sıra tanımı, eşitlikte id (DB ister)
// Çalıştır: DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/test_cari_ekstre_sirasi.ts
// =============================================================================
// BEYAN (2026-09-26, 1e/4b kararı a): cari defterin yazarı TEK DEĞİL (4 servis, 7 yer) ve damga
// yazara bağlanmadı. Gerekçe ölçümdür: her yazım eylem başına tek satırdır, satırlar arası ≥ 3 ifade
// (dönem kilidi okuması · bakiye güncellemesi · çek olayı) vardır; en dar gerçek yolda (bordro cirosu,
// 300 çek tek cariye, tek tx) 299 komşuda aynı-an eşitliği 0, en kısa aralık 1 ms. Yapısal garanti
// YOK ⇒ okuyucu belirlenimli: ekstre ve "en son terslenmemiş satır" okuyucuları eşitlikte `id`.
// Eşitlik bir gün gerçekten ölçülürse yazar tek damgaya bağlanır (seçenek b).
//   §1 ⭐ tek sıra tanımı (AST, `src/`): `cariTransaction.find*` sıralaması yalnız
//      `CARI_STATEMENT_ORDER` / `CARI_TXN_LATEST_FIRST`ten; sabitler eşitlikte `id` taşır
//   §2 ⭐ ekstre: aynı tarihli ve AYNI ANDA yazılmış satırlar id sırasıyla döner, iki sorgu aynı sırayı ve
//      aynı ara bakiyeleri verir (satırlar id'nin TERSİ sırayla yazılır — fiziksel sıra kurtaramaz)
// Ekran, PDF ve Excel aynı sunucu satırlarını okur (`StatementDialog` · `statementExport`, istemci
// yeniden sıralamaz) ⇒ tek sunucu tanımı üç çıktıyı da belirler.
// Gerekli mi: doğduğu gün ekstre `[txnDate, createdAt]` eşitlik bozucusuzdu; §2 onsuz kırmızı (sonda ①).
// Sonda (✓B2, bu commit; md5 ile geri alındı): ① `CARI_STATEMENT_ORDER`dan `id` çıkar → §1 + §2 ❌2 ·
// ② ekstre okuyucusu elle `[{ txnDate }, { createdAt }]`e döner → §1 + §2 ❌2.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { CariKind, CariTxnSource, Currency } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { cariService } from "../src/services/cari.service";
import { CARI_STATEMENT_ORDER, CARI_TXN_LATEST_FIRST } from "../src/services/helpers/finance.helper";
import { walkTs } from "./lib/ts-tarama";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const ROOT = join(__dirname, "..");
const TAG = `TST-CES-${Date.now()}`;
const olusan: { customerId?: string; cariId?: string; txnIds: string[] } = { txnIds: [] };

function tekSiraTanimi(): void {
  console.log("§1 ⭐ Tek sıra tanımı — okuyucular `CARI_STATEMENT_ORDER` / `CARI_TXN_LATEST_FIRST`");
  check("sabitler eşitlikte id taşır",
    JSON.stringify(CARI_STATEMENT_ORDER) === '[{"txnDate":"asc"},{"createdAt":"asc"},{"id":"asc"}]'
      && JSON.stringify(CARI_TXN_LATEST_FIRST) === '[{"createdAt":"desc"},{"id":"desc"}]',
    JSON.stringify(CARI_STATEMENT_ORDER));
  const sabit = new Set(["CARI_STATEMENT_ORDER", "CARI_TXN_LATEST_FIRST"]);
  const ihlal: string[] = [];
  let sirali = 0;
  for (const abs of walkTs(join(ROOT, "src"))) {
    const sf = ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
    const git = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^find/.test(n.expression.name.text)
        && ts.isPropertyAccessExpression(n.expression.expression) && n.expression.expression.name.text === "cariTransaction") {
        const arg = n.arguments[0];
        const ob = arg && ts.isObjectLiteralExpression(arg)
          ? arg.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "orderBy")
          : undefined;
        if (ob) {
          sirali++;
          if (!(ts.isIdentifier(ob.initializer) && sabit.has(ob.initializer.text))) {
            ihlal.push(`${relative(ROOT, abs)}:${sf.getLineAndCharacterOfPosition(ob.getStart()).line + 1} ${ob.initializer.getText().replace(/\s+/g, " ")}`);
          }
        }
      }
      ts.forEachChild(n, git);
    };
    git(sf);
  }
  check("körlük zemini: ≥ 3 sıralı okuyucu tarandı", sirali >= 3, `${sirali}`);
  check("elle sıralama yok (hepsi tek sıra tanımından)", ihlal.length === 0, ihlal.join(" · "));
}

async function ekstre(): Promise<void> {
  console.log("§2 ⭐ Ekstre — aynı tarih + aynı an satırları id sırasıyla, iki sorgu aynı");
  const c = await prisma.customer.create({ data: { code: TAG, name: TAG }, select: { id: true } });
  olusan.customerId = c.id;
  const cari = await prisma.cariAccount.create({ data: { kind: CariKind.CUSTOMER, customerId: c.id }, select: { id: true } });
  olusan.cariId = cari.id;
  const tarih = new Date("2026-09-20T09:00:00.000Z");
  const an = new Date("2026-09-20T10:00:00.000Z");
  const ids = Array.from({ length: 6 }, () => randomUUID()).sort();
  // id'nin TERSİ sırayla yazılır: eşitlik bozucu yoksa fiziksel sıra id sırasını vermez.
  for (const [i, id] of [...ids].reverse().entries()) {
    await prisma.cariTransaction.create({
      data: {
        id, cariId: cari.id, currency: Currency.TRY, txnDate: tarih, createdAt: an,
        debit: i % 2 === 0 ? 100 + i : 0, credit: i % 2 === 0 ? 0 : 50 + i, amountTry: 100 + i,
        sourceType: CariTxnSource.ADJUSTMENT, description: `${TAG} ${i}`,
      },
    });
    olusan.txnIds.push(id);
  }
  const sorgu = () => cariService.statement({ cariId: cari.id, currency: Currency.TRY, from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") });
  const a = (await sorgu()).data!.rows;
  const b = (await sorgu()).data!.rows;
  check("satırlar id sırasıyla döner", JSON.stringify(a.map((r) => r.id)) === JSON.stringify(ids), `${a.length} satır`);
  check("iki sorgu aynı sırayı ve aynı ara bakiyeleri verir",
    JSON.stringify(a.map((r) => [r.id, String(r.running)])) === JSON.stringify(b.map((r) => [r.id, String(r.running)])));
}

async function temizle(): Promise<void> {
  if (olusan.txnIds.length) await prisma.cariTransaction.deleteMany({ where: { id: { in: olusan.txnIds } } });
  if (olusan.cariId) await prisma.cariAccount.deleteMany({ where: { id: olusan.cariId } });
  if (olusan.customerId) await prisma.customer.deleteMany({ where: { id: olusan.customerId } });
}

async function main(): Promise<void> {
  tekSiraTanimi();
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) { check("hedef DB fixture DB'si", false, engel); return; }
  await ekstre();
}

main()
  .catch((e: unknown) => {
    fail++;
    console.log(`  ❌ beklenmeyen hata — ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(async () => {
    try {
      await temizle();
    } catch (e) {
      fail++;
      console.log(`  ❌ temizlik — ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
