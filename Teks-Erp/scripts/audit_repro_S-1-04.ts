// =============================================================================
// AUDIT REPRO — S-1-04: Mükerrer ham giriş tuzağının KİLİT ANAHTARI 3 ondalığa
//   yuvarlanır (`duplicateGuardLockKey` → `Decimal.toFixed(3)`), ama İKİZ
//   SORGUSU ham değerle karşılaştırır (`initialQty: new Prisma.Decimal(raw)`).
//   Kolon `Decimal(12,3)` olduğu için DB değeri zaten yuvarlanmıştır → iki giriş
//   AYNI kilidi alır (serileşir) ama sorgu birbirini BULAMAZ: tuzak tam da
//   serileştirdiği çiftte boşa düşer.
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
//
// Beklenen (sağlıklı sistem): kilit anahtarı ile ikiz sorgusu AYNI hassasiyette
//   çalışır → 140.0001 girildikten sonra 140.0004 ikiz SAYILIR.
// Gözlenen: çalıştırınca doldur — log audit/repro/S-1-04.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_S-1-04.ts
//
// ⚠️ FEATURE-FLAG DEĞİŞTİRİLMEZ (denetim kuralı). Bayrak kapalıysa §3 atlanır ve
// bu AÇIKÇA raporlanır; §1-§2 bayraktan BAĞIMSIZ ve deterministiktir.
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
import prisma from "../src/lib/prisma";
import { ItemType, Prisma, RollEntrySource } from "@prisma/client";
import { InventoryService } from "../src/services/inventory.service";
import { duplicateGuardLockKey } from "../src/services/helpers/duplicate-guard.helper";
import { readKk1DuplicateGuardEnabled } from "../src/services/system-setting.service";

const STAMP = `AUDITREPRO-S-1-04-${randomUUID().slice(0, 6).toUpperCase()}`;
const SUFFIX = STAMP.slice(-6);
let fail = 0;
const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => { fail++; console.log(`❌ ${m}`); };
const info = (m: string) => console.log(`   ${m}`);

const A = 140.0001; // 1. okuma
const B = 140.0004; // 2. okuma — DB'de İKİSİ DE 140.000

async function main(): Promise<void> {
  console.log(`\n=== AUDIT REPRO S-1-04 — tuzağın ondalık asimetrisi (${STAMP}) ===\n`);
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!user) { bad("dev DB'de aktif kullanıcı yok — repro kurulamadı"); return; }
  const item = await prisma.item.create({
    data: { code: `AR4${SUFFIX}`, name: `${STAMP} KUMAS`, itemType: ItemType.FABRIC },
    select: { id: true },
  });

  // ── §1 KİLİT ANAHTARI: iki değer AYNI mı? (saf fonksiyon, DB'siz) ─────────
  console.log("── §1 Kilit anahtarı (duplicateGuardLockKey) ────────────────────────\n");
  const base = {
    entrySource: "SUPPLIER_RECEIPT",
    itemId: item.id,
    colorId: null,
    width: null,
    userId: user.id,
    machineId: null,
  };
  const kA = duplicateGuardLockKey({ ...base, initialQty: A });
  const kB = duplicateGuardLockKey({ ...base, initialQty: B });
  info(`key(${A}) = …${kA.slice(-24)}`);
  info(`key(${B}) = …${kB.slice(-24)}`);
  if (kA === kB) ok("iki giriş AYNI advisory kilidini alır → serileşirler (tasarım gereği)");
  else bad("kilit anahtarları FARKLI — bu repro'nun ön koşulu tutmuyor, senaryoyu gözden geçir");

  // ── §2 İKİZ SORGUSU: DB aynı satırı buluyor mu? (bayraktan BAĞIMSIZ) ──────
  // Guard'ın tx içindeki `findFirst`'ü ile BİREBİR aynı eşitlik yüklemi.
  console.log("\n── §2 İkiz sorgusunun eşitlik yüklemi (DB, bayraktan bağımsız) ──────\n");
  const seed = await prisma.roll.create({
    data: {
      barcode: null,
      itemId: item.id,
      initialQty: A,
      currentQty: A,
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      createdById: user.id,
      clientEnteredAt: new Date(),
    },
    select: { id: true, initialQty: true },
  });
  info(`DB'ye yazılan initialQty: gönderilen ${A} → saklanan ${seed.initialQty.toString()} (Decimal(12,3))`);

  const foundRaw = await prisma.roll.findFirst({
    where: { id: seed.id, initialQty: new Prisma.Decimal(B) },
    select: { id: true },
  });
  const foundRounded = await prisma.roll.findFirst({
    where: { id: seed.id, initialQty: new Prisma.Decimal(new Prisma.Decimal(B).toFixed(3)) },
    select: { id: true },
  });
  if (foundRaw) {
    ok("ham değerle (140.0004) ikiz BULUNUYOR — asimetri yok");
  } else {
    bad("ham değerle (140.0004) ikiz BULUNAMIYOR → guard sorgusu kaçırır");
    info(`aynı satır 3 haneye yuvarlanmış değerle bulunuyor mu: ${foundRounded ? "EVET" : "hayır"}`);
    info("SONUÇ: kilit çifti serileştirir, sorgu çifti eşleştiremez → tuzak sessizce boşa düşer.");
  }

  // ── §3 UÇTAN UCA (yalnız bayrak AÇIKSA — bayrağa DOKUNULMAZ) ─────────────
  console.log("\n── §3 Uçtan uca: createInitialEntry × 2 (bayrak durumuna bağlı) ─────\n");
  const flag = await readKk1DuplicateGuardEnabled();
  info(`kk1.duplicateGuardEnabled (bu DB'de) = ${flag}`);
  if (!flag) {
    info("BAYRAK KAPALI → §3 ATLANDI. Sahada bu bayrak AÇIK (tur2 V-4 §0.1) —");
    info("yani asimetri sahada CANLI bir yoldadır; burada ölçmek için bayrak gerekir.");
  } else {
    const inv = new InventoryService();
    const guard = { duplicateGuard: { confirmed: false } };
    const first = await inv.createInitialEntry(
      { itemId: item.id, initialQty: A, clientEnteredAt: new Date() },
      user.id, null, true, guard,
    );
    info(`1. giriş: ${(first.data as { barcode: string | null }).barcode}`);
    let second: { ok: boolean; code?: string } = { ok: false };
    try {
      await inv.createInitialEntry(
        { itemId: item.id, initialQty: B, clientEnteredAt: new Date() },
        user.id, null, true, guard,
      );
      second = { ok: true };
    } catch (e) {
      second = { ok: false, code: (e as { details?: { code?: string } })?.details?.code };
    }
    if (second.ok) {
      bad("2. giriş (140.0004) TUZAĞA TAKILMADI — aynı fiziksel top ikinci kez yazıldı");
    } else {
      ok(`2. giriş reddedildi (${second.code}) — tuzak çalıştı`);
    }
  }

  console.log(`\n=== SONUÇ: ${fail} kırmızı ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => { console.error("REPRO HATASI:", e); process.exitCode = 2; })
  .finally(async () => {
    try {
      const items = await prisma.item.findMany({
        where: { name: { startsWith: STAMP } },
        select: { id: true },
      });
      const itemIds = items.map((i) => i.id);
      if (itemIds.length) {
        const rolls = await prisma.roll.findMany({
          where: { itemId: { in: itemIds } },
          select: { id: true },
        });
        const rollIds = rolls.map((r) => r.id);
        if (rollIds.length) {
          await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
          await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
          await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
          await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
          await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
        }
        await prisma.systemLog.deleteMany({ where: { recordId: { in: [...itemIds, ...rollIds] } } });
        await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      }
      console.log("temizlik tamam");
    } catch (e) {
      console.error("TEMİZLİK HATASI (elle bak):", (e as Error).message, "damga:", STAMP);
    }
    await prisma.$disconnect();
  });
