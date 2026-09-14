// =============================================================================
// AUDIT REPRO — S-1-03: KK1 ham girişi ürün/renk doğrulamasını transaction
//   DIŞINDA yapar. Süpervizör aynı anda o kumaşı birleştirirse (MasterDataMerge)
//   yeni top MEZAR TAŞI (tombstone) kumaşa yazılır ve birleştirmenin
//   "UPDATE rolls SET itemId=survivor" turu onu KAÇIRIR (phantom).
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
//
// Beklenen (sağlıklı sistem):
//   §1 Mezar taşı (mergedIntoId dolu) kumaşa KK1 girişi REDDEDİLİR.
//   §2 Birleştirme ile eşzamanlı KK1 girişinde, işlem bittiğinde HİÇBİR canlı top
//      mezar taşı kumaşa bakmıyor olur (ya 409 alır ya survivor'a yazılır).
//
// Gözlenen: çalıştırınca doldur — log audit/repro/S-1-03.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_S-1-03.ts
//
// NOT: feature-flag / SystemSetting DEĞİŞTİRİLMEZ. Mükerrer tuzağı bu senaryoda
// devrede değil (opts.duplicateGuard verilmiyor → F221 deseni).
// @temizlik-scripti: denetim repro'su: silme, önceki kesilmiş koşumun KENDİ damgasını süpürer ve turlar arasında senaryoyu sıfırlar — sonda değil ÖN KOŞUL
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
import { ItemType } from "@prisma/client";
import { InventoryService } from "../src/services/inventory.service";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";

const STAMP = `AUDITREPRO-S-1-03-${randomUUID().slice(0, 6).toUpperCase()}`;
const SUFFIX = STAMP.slice(-6);
let fail = 0;
const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => { fail++; console.log(`❌ ${m}`); };
const info = (m: string) => console.log(`   ${m}`);

const inv = new InventoryService();
let seq = 0;
async function mkItem(tag: string): Promise<{ id: string; name: string }> {
  seq += 1;
  return prisma.item.create({
    data: {
      code: `AR3${SUFFIX}${String(seq).padStart(2, "0")}`,
      name: `${STAMP} ${tag} ${seq}`,
      itemType: ItemType.FABRIC,
    },
    select: { id: true, name: true },
  });
}

async function main(): Promise<void> {
  console.log(`\n=== AUDIT REPRO S-1-03 — birleştirme ↔ KK1 ham giriş yarışı (${STAMP}) ===\n`);
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!user) { bad("dev DB'de aktif kullanıcı yok — repro kurulamadı"); return; }

  // ── §1 DETERMİNİSTİK KONTROL: yazma yolunda `mergedIntoId` kapısı VAR MI? ──
  // Birleştirme kaynağı hem `mergedIntoId` hem `isActive:false` yazar. Burada
  // YALNIZ `mergedIntoId`i doldurup `isActive`i true bırakıyoruz: böylece tek
  // soruyu izole ediyoruz — "yazma yolu mezar taşını KENDİ BAŞINA tanıyor mu?"
  // (Yarışta tam olarak bu durum doğar: KK1 `isActive`i mezar taşı olmadan ÖNCE
  // okumuştur, yani kararı bu satırın soy bağına bakmadan verir.)
  console.log("── §1 Mezar taşı kumaşa doğrudan KK1 girişi (deterministik) ─────────\n");
  const survivor1 = await mkItem("SURVIVOR");
  const loser1 = await mkItem("TOMBSTONE");
  await prisma.item.update({
    where: { id: loser1.id },
    data: { mergedIntoId: survivor1.id, mergedAt: new Date() },
  });
  info(`loser=${loser1.id.slice(0, 8)} → mergedIntoId=${survivor1.id.slice(0, 8)} (isActive HÂLÂ true)`);

  let r1Err: unknown = null;
  let r1Id: string | null = null;
  try {
    const res = await inv.createInitialEntry({ itemId: loser1.id, initialQty: 120 }, user.id);
    r1Id = (res.data as { id: string }).id;
  } catch (e) { r1Err = e; }

  if (r1Err) {
    ok(`mezar taşı kumaşa giriş REDDEDİLDİ: ${(r1Err as Error).message}`);
  } else {
    bad(`mezar taşı kumaşa TOP YAZILDI (id ${r1Id?.slice(0, 8)}) — yazma yolunda mergedIntoId kapısı YOK`);
    const chk = await prisma.roll.findUnique({
      where: { id: r1Id! },
      select: { barcode: true, item: { select: { name: true, mergedIntoId: true, isActive: true } } },
    });
    info(`top ${chk?.barcode} → kumaş "${chk?.item.name}" (mergedIntoId dolu: ${!!chk?.item.mergedIntoId})`);
    info("SONUÇ: bu top survivor kumaşın hiçbir listesinde/filtresinde GÖRÜNMEZ.");
  }

  // ── §2 GERÇEK YARIŞ: merge tx'i koşarken KK1 girişi ────────────────────────
  // KK1 `item.findUnique` → (renk/özellik/kalite/ayar okumaları) → `$transaction`
  // → `roll.create` sırasını izler. Aradaki her `await` bir yield noktasıdır.
  // Pencereyi görünür kılmak için merge'e ÇOK KAYNAK veriyoruz (her kaynak 42
  // MOVE kuralı × UPDATE koşturur → tx uzar).
  console.log("\n── §2 Birleştirme ile EŞZAMANLI KK1 girişi (N tur) ──────────────────\n");
  const TURS = 12;
  const SOURCES_PER_MERGE = 6;
  let hit = 0;
  let rejected = 0;
  let clean = 0;

  for (let t = 0; t < TURS; t++) {
    const survivor = await mkItem(`S${t}`);
    const losers: Array<{ id: string; name: string }> = [];
    for (let i = 0; i < SOURCES_PER_MERGE; i++) losers.push(await mkItem(`L${t}_${i}`));
    // KK1'in hedefi kaynaklardan BİRİ (operatörün ekranında hâlâ seçili olan).
    const target = losers[Math.floor(SOURCES_PER_MERGE / 2)]!;

    // Stagger: KK1 isteği merge'den `delayMs` sonra başlar. 0'dan başlayıp
    // artırıyoruz ki pencere nerede olursa olsun bir turda yakalansın.
    const delayMs = t * 4;

    const mergeP = MasterDataMergeService.merge("item", {
      survivorId: survivor.id,
      sourceIds: losers.map((l) => l.id),
      reason: `${STAMP} eszamanlilik reprosu — denetim`,
      acknowledgedConflicts: 0,
      userId: user.id,
    }).then(
      () => "merge-ok" as const,
      (e: Error) => { info(`  tur ${t}: merge düştü — ${e.message}`); return "merge-fail" as const; },
    );

    const kk1P = new Promise<void>((res) => setTimeout(res, delayMs)).then(() =>
      inv.createInitialEntry({ itemId: target.id, initialQty: 100 + t }, user.id).then(
        (r) => ({ kind: "ok" as const, id: (r.data as { id: string }).id }),
        (e: Error) => ({ kind: "err" as const, msg: e.message }),
      ),
    );

    const [, kk1] = await Promise.all([mergeP, kk1P]);

    // ÖLÇÜM COMMIT SONRASI, DB'DEN: canlı top mezar taşına mı bakıyor?
    const orphan = await prisma.$queryRaw<Array<{ id: string; barcode: string | null; itemName: string }>>`
      SELECT r."id", r."barcode", i."name" AS "itemName"
      FROM rolls r JOIN items i ON i."id" = r."itemId"
      WHERE i."mergedIntoId" IS NOT NULL
        AND i."name" LIKE ${`${STAMP}%`}
        AND r."status" NOT IN ('CANCELLED','SCRAP')`;

    if (kk1.kind === "err") {
      rejected++;
    } else if (orphan.length > 0) {
      hit++;
      bad(`tur ${t} (gecikme ${delayMs}ms): top ${orphan[0]!.barcode} MEZAR TAŞI kumaşta kaldı ("${orphan[0]!.itemName}")`);
      // Bir sonraki turu kirletmesin diye bu turun yetimini temizle.
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: orphan.map((o) => o.id) } } });
      await prisma.roll.deleteMany({ where: { id: { in: orphan.map((o) => o.id) } } });
    } else {
      clean++;
    }
  }

  info(`tur sonucu: ${hit} yetim · ${rejected} reddedildi · ${clean} temiz (toplam ${TURS})`);
  if (hit > 0) {
    bad(`YARIŞ TETİKLENDİ — ${hit}/${TURS} turda canlı top mezar taşı kumaşa yazıldı`);
  } else {
    ok(`bu koşumda yarış tetiklenmedi (${TURS} tur) — §1 kapısının yokluğu KALICI, tetikleme zamanlamaya bağlı`);
    info("Negatif sonuç kanıttır: pencere dar olabilir; kusur §1'de deterministik olarak duruyor.");
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
        await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: itemIds } } });
        await prisma.itemAllowedProperty.deleteMany({ where: { itemId: { in: itemIds } } });
        await prisma.systemLog.deleteMany({ where: { recordId: { in: [...itemIds, ...rollIds] } } });
        // Mezar taşları survivor'a bakar → önce bağı kopar, sonra sil.
        await prisma.item.updateMany({ where: { id: { in: itemIds } }, data: { mergedIntoId: null } });
        await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      }
      console.log("temizlik tamam");
    } catch (e) {
      console.error("TEMİZLİK HATASI (elle bak):", (e as Error).message, "damga:", STAMP);
    }
    await prisma.$disconnect();
  });
