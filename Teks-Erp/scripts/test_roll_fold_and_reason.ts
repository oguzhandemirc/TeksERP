// =============================================================================
// Test: Roll.foldType + Roll.entryReason KALICI KOLON sözleşmesi
// Çalıştır: npx tsx scripts/test_roll_fold_and_reason.ts
// =============================================================================
// 2026-08-04'te iki kalıcı kolon eklendi. Bu bekçi dört şeyi kilitler:
//
//  1) KAT MİRAS ALINMAZ — kesimde doğan çocuk, ebeveyninin katını körlemesine
//     devralmaz; o kesimde SEÇİLEN değer yazılır. Kullanıcı kararı birebir:
//     "top kesilerek yeni bir kat değeri kazanabilir".
//  2) GERİ-UYUMLULUK FALLBACK'İ — alan hiç GÖNDERİLMEZSE (eski APK) parent →
//     iş emri planı sırası uygulanır. Bu MİRAS değil, sözleşme boşluğunun
//     doldurulmasıdır; ikisi karıştırılırsa (1) sessizce bozulur.
//  3) FİLTRE KANONİKLEŞTİRME — en sinsi hata. `buildWhereClause` tanımadığı
//     filtre anahtarını HAM geçirir; DB'de "4-KAT" varken istemci "4 kat"
//     ararsa sorgu 0 satır döner ve HATA/LOG ÇIKMAZ. Operatör "bu kumaştan
//     hiç yok" sanır.
//  4) SEBEP KOLONDAN OKUNUR — audit'ten DEĞİL. Audit 6 ayda bir arşivleniyor
//     (`archive-scheduler`, MONTHS_TO_KEEP=6); yalnız audit'e dayanan okuma
//     altı ay sonra sebebi SESSİZCE kaybederdi. Test bunu audit kaydını
//     SİLEREK kanıtlar — sebep hâlâ okunabiliyorsa kaynak gerçekten kolondur.
//
// Fixture kendi verisini üretir (ortam verisine bağımlı DEĞİL) ve finally'de siler.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { normalizeFoldType } from "../src/services/helpers/fold-type";
import type { Request } from "express";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const inventoryService = new InventoryService();

const fakeReq = (query: Record<string, unknown>) => ({ query }) as unknown as Request;

interface RollPage { data: Array<{ id: string; foldType?: string | null }> }

async function main(): Promise<void> {
  const ts = Date.now();
  const item = await prisma.item.create({
    data: { code: `TEST-FLD-${ts}`, name: `TEST Kat ${ts}`, itemType: "FABRIC" },
    select: { id: true },
  });
  const created: string[] = [];
  const auditLogIds: string[] = [];

  const mkRoll = async (n: number, fold: string | null, reason: string | null) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TEST-FLD-R${n}-${ts}`,
        itemId: item.id,
        status: "WAREHOUSE",
        initialQty: 100,
        currentQty: 100,
        entrySource: "TAMBUR_MANUAL",
        foldType: fold,
        entryReason: reason,
      },
      select: { id: true },
    });
    created.push(r.id);
    return r.id;
  };

  try {
    // ── 1) KANONİKLEŞTİRME YARDIMCISI ────────────────────────────────────────
    console.log("\n[1] normalizeFoldType");
    check('"4 kat" → "4-KAT"', normalizeFoldType("4 kat") === "4-KAT", String(normalizeFoldType("4 kat")));
    check('"4KAT" → "4-KAT"', normalizeFoldType("4KAT") === "4-KAT");
    check('"2_kat" → "2-KAT"', normalizeFoldType("2_kat") === "2-KAT");
    // Planlama tarafı TÜP/özel değer taşıyabilir — reddedilmez, aynen geçer.
    check('"TÜP" olduğu gibi geçer (reddedilmez)', normalizeFoldType("TÜP") === "TÜP");
    check("boş → null", normalizeFoldType("   ") === null);

    // ── 2) FİLTRE — kanonik OLMAYAN girdi de bulmalı ─────────────────────────
    console.log("\n[2] Envanter filtresi kanonikleştiriyor (sessiz 0-sonuç tuzağı)");
    const r4 = await mkRoll(1, "4-KAT", null);
    await mkRoll(2, "2-KAT", null);

    const listWith = async (foldFilter: string) => {
      const res = (await inventoryService.findAllRolls(
        // Filtreler `filter[alan]=deger\' biçiminde okunur (query-parser:62).
        fakeReq({
          "filter[itemId]": item.id,
          "filter[status]": "ALL",
          "filter[foldType]": foldFilter,
          pageSize: "50",
        }),
      )) as unknown as RollPage;
      return res.data;
    };

    const exact = await listWith("4-KAT");
    check("kanonik değer bulur", exact.length === 1 && exact[0].id === r4, `${exact.length} satır`);

    // ASIL İDDİA: kanonik olmayan yazım da AYNI topu bulmalı.
    const loose = await listWith("4 kat");
    check(
      '"4 kat" (kanonik değil) AYNI topu bulur',
      loose.length === 1 && loose[0].id === r4,
      `${loose.length} satır`,
    );
    const loose2 = await listWith("4kat");
    check('"4kat" de bulur', loose2.length === 1 && loose2[0].id === r4, `${loose2.length} satır`);

    // Negatif: normalizasyon "her şeyi bulur"a dönüşmemeli.
    const other = await listWith("2-KAT");
    check("2-KAT filtresi 4-KAT topu GETİRMEZ", other.every((x) => x.id !== r4), `${other.length} satır`);

    // ── 3) SEBEP KOLONDAN OKUNUR (audit'ten DEĞİL) ───────────────────────────
    console.log("\n[3] entryReason kolondan okunuyor — audit silinse bile");
    const reasonRoll = await mkRoll(3, null, "Etiketi kopmuş / okunmuyor");
    // Audit'te BİLEREK hiç kayıt yok (fixture doğrudan yazdı). Kolon tek kaynak
    // değilse burada null döner.
    const auditCount = await prisma.systemLog.count({
      where: { tableName: "ROLL", recordId: reasonRoll },
    });
    check("ön koşul — bu topun audit kaydı YOK", auditCount === 0, `${auditCount} kayıt`);

    const detail = (await inventoryService.findRollById(reasonRoll)) as unknown as {
      data: { manualReason?: string | null } | null;
    };
    check(
      "sebep detay ucunda görünüyor (kaynak = kolon)",
      detail.data?.manualReason === "Etiketi kopmuş / okunmuyor",
      String(detail.data?.manualReason),
    );

    // Zincire dayanan topta sebep SORGULANMAZ ve null döner.
    const chainRoll = await prisma.roll.create({
      data: {
        barcode: `TEST-FLD-CHAIN-${ts}`,
        itemId: item.id,
        status: "WAREHOUSE",
        initialQty: 50,
        currentQty: 50,
        entrySource: "TAMBUR_SPLIT",
        entryReason: "BU OKUNMAMALI",
      },
      select: { id: true },
    });
    created.push(chainRoll.id);
    const chainDetail = (await inventoryService.findRollById(chainRoll.id)) as unknown as {
      data: { manualReason?: string | null } | null;
    };
    check(
      "zincire dayanan topta sebep OKUNMAZ (gereksiz sorgu yok)",
      chainDetail.data?.manualReason == null,
      String(chainDetail.data?.manualReason),
    );

    // ── 3b) AUDIT OKUNMAZ (K-A1, 2026-09-25) — kolon boşsa audit'teki sebep de gösterilmez.
    // Audit yalnız ayak izidir; kolondan önce doğmuş toplar göç script'iyle doldurulur.
    // Negatif sonda (2026-09-25): servise audit dalı geri konunca bu kontrol ❌, geri alındı.
    console.log("\n[3b] kolon boş + audit'te sebep var → sebep GÖSTERİLMEZ (audit okunmaz)");
    const auditRoll = await mkRoll(5, null, null);
    const log = await prisma.systemLog.create({
      data: { category: "DOMAIN", action: "CREATE", tableName: "ROLL", recordId: auditRoll,
        newData: { event: "TAMBUR_MANUAL_ROLL", reason: "AUDITTEN OKUNMAMALI" } },
      select: { id: true },
    });
    auditLogIds.push(log.id);
    const auditDetail = (await inventoryService.findRollById(auditRoll)) as unknown as {
      data: { manualReason?: string | null } | null;
    };
    check("audit'teki sebep detayda GÖRÜNMEZ (kaynak yalnız kolon)", auditDetail.data?.manualReason == null,
      String(auditDetail.data?.manualReason));

    // ── 4) KOLON GERÇEKTEN KALICI ────────────────────────────────────────────
    console.log("\n[4] Kolonlar şemada ve yazılabilir");
    const row = await prisma.roll.findUniqueOrThrow({
      where: { id: r4 },
      select: { foldType: true, entryReason: true, entryReasonCode: true },
    });
    check("foldType kolonu okunuyor", row.foldType === "4-KAT", String(row.foldType));
    check("entryReason kolonu ayrı (bu topta null)", row.entryReason === null);
    check("entryReasonCode kolonu şemada (bu topta null)", row.entryReasonCode === null);
  } finally {
    // Test DB'de audit koruması (teks.audit_guard) kapalı; açıksa satır kalır, zararsız.
    await prisma.systemLog.deleteMany({ where: { id: { in: auditLogIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: created } } });
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    console.log("\n(temizlendi — TEST-FLD fixture'ları silindi)");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
