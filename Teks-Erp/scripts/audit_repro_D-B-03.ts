// =============================================================================
// AUDIT REPRO — D-B-03: `withBarcodeRetry` PREDICATE'SİZ çağrıldığında KALICI bir
//   P2002'yi (clientToken / nameFold gibi) 5 kez tekrarlayıp yanıltıcı
//   "Barkod üretimi 5 denemede başarısız oldu" 409'una çeviriyor mu?
//   Fason mal kabulü (`subcontractor.service.receive`) tam bu şekilde çağrılıyor
//   ve dış catch'i de YOK → aynı token'la gelen ikinci istek cached makbuz
//   DÖNEMEZ; operatör "başarısız" okur ve kabulü YENİ token'la tekrarlar.
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem): kalıcı P2002 retry EDİLMEZ; çağıran onu ya cached
//   yanıta (replay) ya da anlamlı 409'a çevirir (emsal: shipping.openSack /
//   createShipment / order.create / workorder.create — hepsi predicate + catch).
// Gözlenen: çalıştırınca doldur — log audit/repro/D-B-03.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_D-B-03.ts
// =============================================================================
import "dotenv/config";
function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch { throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)"); }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import prisma from "../src/lib/prisma";
import { withBarcodeRetry } from "../src/utils/barcode-retry";

const STAMP = `AUDITREPRO-D-B-03-${randomUUID().slice(0, 6).toUpperCase()}`;
let fail = 0;
const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => { fail++; console.log(`❌ ${m}`); };
const info = (m: string) => console.log(`   ${m}`);

async function main(): Promise<void> {
  console.log(`\n=== AUDIT REPRO D-B-03 — predicate'siz withBarcodeRetry + kalıcı P2002 (${STAMP}) ===\n`);

  // ── §1 DAVRANIŞ ÖLÇÜMÜ: kalıcı P2002 predicate'siz retry'a girerse ne döner ──
  const first = await prisma.qualityGrade.create({
    data: { code: `AR3${STAMP.slice(-6)}`, name: `${STAMP} A`, targetStatus: "WAREHOUSE" },
  });
  const t0 = Date.now();
  let seen = "";
  try {
    await withBarcodeRetry(() =>
      prisma.qualityGrade.create({
        data: { code: first.code, name: `${STAMP} B`, targetStatus: "WAREHOUSE" },
      }),
    );
    seen = "BEKLENMEDİK: başarılı";
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; message?: string };
    seen = `code=${err.code ?? "-"} status=${err.statusCode ?? "-"} msg="${String(err.message).replace(/\n/g, " ").slice(0, 90)}"`;
  }
  const ms = Date.now() - t0;
  if (/Barkod üretimi/.test(seen)) {
    bad(`kalıcı P2002 → 5 deneme (${ms} ms) → ${seen}`);
    info("mesaj kusurun kendisi: kaybeden istemci 'barkod üretilemedi' okur, oysa çakışan şey İDEMPOTENCY ANAHTARIDIR.");
  } else {
    ok(`kalıcı P2002 → ${seen}`);
  }

  // ── §2 ÇAĞRI YERİ TARAMASI: hangi withBarcodeRetry çağrıları clientToken YAZAN
  //     bir tx'i sarıyor ve predicate/dış-catch TAŞIMIYOR ──────────────────────
  console.log("");
  const src = readFileSync(join(__dirname, "../src/services/subcontractor.service.ts"), "utf8");
  const lines = src.split("\n");
  const wbrLine = lines.findIndex((l) => l.includes("const result = await withBarcodeRetry(") && lines[lines.indexOf(l) + 1]?.includes("prisma.$transaction"));
  const receiveIdx = lines.findIndex((l) => l.includes("clientToken: data.clientToken ?? null,"));
  info(`subcontractor.service.ts: clientToken yazımı satır ${receiveIdx + 1} (receipt create)`);
  // Sarmalayıcının kapanışı: `      })\n    );` deseni
  const closeIdx = lines.findIndex((l, i) => i > receiveIdx && l.trim() === ")" && lines[i - 1]?.trim() === "})");
  const wrapper = lines.slice(Math.max(0, wbrLine), (closeIdx > 0 ? closeIdx : receiveIdx) + 2).join("\n");
  const hasPredicate = /isClientTokenP2002|p2002Mentions/.test(wrapper);
  const hasOuterCatch = /catch \(err\)[\s\S]{0,400}clientToken/.test(
    lines.slice(closeIdx, closeIdx + 25).join("\n"),
  );
  if (!hasPredicate) bad("receive() `withBarcodeRetry` çağrısında P2002 predicate'i YOK → clientToken P2002 5 kez retry edilir");
  else ok("receive() predicate taşıyor");
  if (!hasOuterCatch) bad("receive() etrafında clientToken P2002'yi cached makbuza çeviren dış catch YOK");
  else ok("receive() dış catch taşıyor");

  // Karşılaştırma: doğru deseni uygulayan üç çağrı yeri
  const shipping = readFileSync(join(__dirname, "../src/services/shipping.service.ts"), "utf8");
  const order = readFileSync(join(__dirname, "../src/services/order.service.ts"), "utf8");
  const wo = readFileSync(join(__dirname, "../src/services/workorder.service.ts"), "utf8");
  info(`referans desen — shipping p2002Mentions(/clientToken/) ×${(shipping.match(/p2002Mentions\(err, \/clientToken\/i\)/g) ?? []).length}, ` +
    `order isClientTokenP2002 ×${(order.match(/isClientTokenP2002/g) ?? []).length}, workorder ×${(wo.match(/isClientTokenP2002/g) ?? []).length}`);

  // ── §3 Saha ölçümü hatırlatması ─────────────────────────────────────────
  console.log("");
  info("saha (2026-08-25 kopyası): subcontractor_receipts 143 satır, clientToken dolu 2 →");
  info("token gönderen APK sahada AZINLIKTA; yol yeni APK yayıldıkça sıcaklaşır.");
  info("küme-eşitliği guard'ı KISMİ makbuzda `continue` eder (subcontractor.service.ts:2412-2416)");
  info("→ kısmi kabulde ikinci kapı da yok: yeni token'la tekrar = İKİNCİ KISMİ MAKBUZ.");

  console.log(`\n=== SONUÇ: ${fail} kırmızı ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => { console.error("REPRO HATASI:", e); process.exitCode = 2; })
  .finally(async () => {
    try {
      const rows = await prisma.qualityGrade.findMany({ where: { name: { startsWith: STAMP } }, select: { id: true } });
      await prisma.qualityGrade.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: rows.map((r) => r.id) } } });
      console.log("temizlik tamam");
    } catch (e) {
      console.error("TEMİZLİK HATASI (elle bak):", (e as Error).message, "damga:", STAMP);
    }
    await prisma.$disconnect();
  });
