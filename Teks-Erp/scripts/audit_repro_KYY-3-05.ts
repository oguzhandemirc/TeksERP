// =============================================================================
// AUDIT REPRO — KYY-3-05: Tambur "Top Kesme" AŞIM dalında parent güncellemesinde
// `currentQty` guard'ı YOK ve `exceedsRemaining` kararı tx ÖNCESİ okunan metrajdan
// veriliyor → iki eşzamanlı kesim aynı parent'tan iki TAM çocuk doğurur ve aşım
// defteri (RollVariance/OVERAGE) eksik yazılır (INV-STK-03 / INV-AUD-05).
// Ortam: SADECE dev DB. `tambur.overQuantityEnabled` VARSAYILAN AÇIK (ayar satırı
//   yok) — bayrak DEĞİŞTİRİLMEZ.
// Beklenen (sağlıklı sistem): 100 m parent'tan 2×120 m çocuk doğuyorsa aşım defteri
//   toplamı 140 m olmalı (ya da ikinci kesim 409 almalı).
// Gözlenen: audit/repro/KYY-3-05.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_KYY-3-05.ts
// =============================================================================
import "dotenv/config";
function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production") throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
  try { const u = new URL(url); host = u.hostname.toLowerCase(); db = decodeURIComponent(u.pathname.replace(/^\//, "")); } catch { throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)"); }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db") throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { ensureTestAdmin } from "./fixture-test-user";

const STAMP = `AUDITREPRO-KYY305-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
const short = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 130).replace(/\s+/g, " ");
const N = (v: unknown) => Number(v);

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO KYY-3-05 — damga ${STAMP} ===`);
  const admin = await ensureTestAdmin();
  const svc = new TamburService();
  const flagRow = await prisma.systemSetting.findFirst({ where: { key: { contains: "verQuantity" } }, select: { key: true, value: true } });
  console.log(`   aşım bayrağı ayar satırı: ${flagRow ? JSON.stringify(flagRow) : "YOK → varsayılan AÇIK (dokunulmadı)"}`);

  const item = await prisma.item.create({ data: { code: `${STAMP}-I`, name: `${STAMP} KUMAS`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const color = await prisma.color.create({ data: { code: `${STAMP}-K`, name: `${STAMP} EKRU` }, select: { id: true } });

  const parentIds: string[] = [];
  let ihlalAsim = 0, ihlalDefter = 0, tur = 0;
  try {
    console.log("\n[A] 100 m depo topuna iki eşzamanlı 120 m kesim — 12 tur");
    for (let i = 0; i < 12; i++) {
      const parent = await prisma.roll.create({
        data: { barcode: `${STAMP}-P${i}`, itemId: item.id, colorId: color.id, status: "WAREHOUSE", currentQty: 100, initialQty: 100, width: 330, entrySource: "SUPPLIER_RECEIPT" },
        select: { id: true },
      });
      parentIds.push(parent.id);
      tur++;
      const res = await Promise.allSettled([
        svc.cutWarehouseRoll(parent.id, { cutLength: 120 }, admin.id),
        svc.cutWarehouseRoll(parent.id, { cutLength: 120 }, admin.id),
      ]);
      const ok = res.filter((r) => r.status === "fulfilled").length;
      const kids = await prisma.roll.findMany({ where: { parentRollId: parent.id }, select: { initialQty: true } });
      const kidSum = kids.reduce((a, k) => a + N(k.initialQty), 0);
      const varRows = await prisma.rollVariance.findMany({ where: { rollId: parent.id, kind: "OVERAGE" }, select: { qty: true } });
      const varSum = varRows.reduce((a, v) => a + N(v.qty), 0);
      const beklenenAsim = Math.max(0, kidSum - 100);
      if (ok === 2 && kids.length === 2) {
        ihlalAsim++;
        if (ihlalAsim <= 4) console.log(`   ⚠️ tur ${i + 1}: ${ok} kesim başarılı, ${kids.length} çocuk toplam ${kidSum} m (parent 100 m) · OVERAGE defteri ${varSum} m (olması gereken ${beklenenAsim} m)`);
      } else if (ok < 2) {
        const e = res.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
        if (i < 3) console.log(`   tur ${i + 1}: ${ok} başarılı — ${e ? short(e.reason) : ""}`);
      }
      if (Math.abs(varSum - beklenenAsim) > 0.001) ihlalDefter++;
    }
    check("INV-STK-03 — aşım dalında ikinci eşzamanlı kesim engellendi", ihlalAsim === 0, `${ihlalAsim}/${tur} turda iki tam çocuk doğdu`);
    check("INV-AUD-05 — aşım defteri gerçek aşımı yazıyor", ihlalDefter === 0, `${ihlalDefter}/${tur} turda defter eksik/fazla`);
  } finally {
    console.log("\n--- temizlik ---");
    await prisma.rollVariance.deleteMany({ where: { roll: { itemId: item.id } } });
    await prisma.rollOperation.deleteMany({ where: { roll: { itemId: item.id } } });
    await prisma.rollMovement.deleteMany({ where: { roll: { itemId: item.id } } });
    await prisma.rollProperty.deleteMany({ where: { roll: { itemId: item.id } } });
    await prisma.roll.deleteMany({ where: { itemId: item.id, parentRollId: { not: null } } });
    await prisma.roll.deleteMany({ where: { itemId: item.id } });
    await prisma.color.deleteMany({ where: { id: color.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: parentIds } } });
  }
  console.log(`\n=== Sonuç: ${pass} korundu, ${fail} İHLAL ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); await pool.end(); process.exit(1); });
