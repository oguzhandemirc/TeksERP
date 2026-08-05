// =============================================================================
// Test: Roll.entryStationId — GİRİŞ İSTASYONU damgası
// Çalıştır: npx tsx scripts/test_roll_entry_station.ts
// =============================================================================
// Kolon 2026-08-05'te eklendi ("sistemdeki tüm kumaşlarda giriş istasyonu ve
// yapan personel sütunu var mı?"). Personel ve makine ZATEN kolondu; eksik olan
// istasyondu ve o güne kadar ancak DOLAYLI çözülebiliyordu (createdMachineId →
// Machine.stationId). Dolaylı yol iki yerden bozuktu: makine taşınırsa değer
// GERİYE DÖNÜK değişiyordu, ve makine damgası yalnız oturumlu girişlerde
// doluyordu.
//
// Bu bekçi ÜÇ cepheyi kilitler:
//
//  [1] MEKANİK KAPSAMA — `src/` altındaki HER `roll.create` / `roll.createMany`
//      çağrısının `data` nesnesinde `entryStationId` GEÇMELİ. Bu madde en
//      önemlisi: kolonun `@default`'u YOKTUR, yani 10. bir doğum yolu
//      eklendiğinde ne derleme ne de davranış testi kırmızı verir — kolon
//      sessizce NULL doğar ve kullanıcı yalnız boş bir sütun görür.
//      (Aynı desen: `test_permission_catalog.ts` route taraması.)
//
//  [2] ÖNCELİK KURALI — ADIM > OTURUM > NULL. Kural tek yerde
//      (`roll-entry-station.helper.ts`) yaşar; burada davranışı doğrulanır.
//
//  [3] MAKİNEDEN TÜRETİLMEZ — damga makine üzerinden çözülmüş olsaydı, makineyi
//      başka istasyona taşımak GEÇMİŞ topların istasyonunu değiştirirdi. Test
//      bunu fiilen makineyi taşıyarak kanıtlar.
//
// Ayrıca istasyon silme guard'ı (SetNull FK → sessiz iz kaybı) doğrulanır.
// =============================================================================

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import prisma, { pool } from "../src/lib/prisma";
import { resolveEntryStationId } from "../src/services/helpers/roll-entry-station.helper";
import { InventoryService } from "../src/services/inventory.service";

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

const SRC = path.resolve(__dirname, "../src");

/**
 * MUAF doğum noktaları — her biri GEREKÇELİDİR ve her koşumda basılır.
 * Muaf listesi bayatlarsa (dosya artık roll yaratmıyorsa) test DÜŞER: ölü muaf,
 * gerçek bir ihlali sessizce kapsam dışında tutar.
 */
const EXEMPT: Array<{ file: string; reason: string }> = [
  {
    file: "services/inventory.service.ts",
    reason:
      "createInitialEntry — damga opts.entryStationId ile ÇAĞIRANDAN gelir " +
      "(bu tek create noktası üç farklı mantıksal yolu besliyor; sezgi burada " +
      "sessizce yanlış olur). Ayrı kontrolle (aşağıda) doğrulanıyor.",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Bir `roll.create(` / `roll.createMany(` çağrısının gövdesini kabaca çıkarır. */
function callBodies(text: string): Array<{ index: number; body: string }> {
  const out: Array<{ index: number; body: string }> = [];
  const re = /\broll\.create(?:Many)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ index: m.index, body: text.slice(start, i + 1) });
  }
  return out;
}

async function main(): Promise<void> {
  const created: string[] = [];
  const svc = new InventoryService();

  try {
    // ── [1] MEKANİK KAPSAMA ──────────────────────────────────────────────────
    console.log("\n[1] Her roll.create çağrısı entryStationId taşıyor mu");
    const files = walk(SRC);
    let scanned = 0;
    const misses: string[] = [];
    const seenExempt = new Set<string>();

    for (const f of files) {
      const rel = path.relative(SRC, f).replace(/\\/g, "/");
      const text = fs.readFileSync(f, "utf8");
      const calls = callBodies(text);
      if (calls.length === 0) continue;
      const exempt = EXEMPT.find((e) => e.file === rel);
      if (exempt) {
        seenExempt.add(rel);
        continue;
      }
      for (const c of calls) {
        scanned++;
        if (!/entryStationId/.test(c.body)) {
          const line = text.slice(0, c.index).split("\n").length;
          misses.push(`${rel}:${line}`);
        }
      }
    }

    // KÖRLÜK ZEMİNİ: tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye
    // bakılmadı" AYNI yeşile çıkar. Bugün src/ altında 8 muaf-dışı create var.
    check(
      "körlük zemini — yeterli create noktası tarandı",
      scanned >= 6,
      `${scanned} çağrı tarandı, ${files.length} dosya`,
    );
    check(
      "entryStationId taşımayan create YOK",
      misses.length === 0,
      misses.length ? misses.join(" · ") : "tümü damgalı",
    );

    // Muaf listesi bayat mı?
    for (const e of EXEMPT) {
      check(`muaf hâlâ geçerli: ${e.file}`, seenExempt.has(e.file), e.reason.slice(0, 70));
    }
    console.log(`   (muaf: ${EXEMPT.map((e) => e.file).join(", ")})`);

    // ── [2] ÖNCELİK KURALI ───────────────────────────────────────────────────
    console.log("\n[2] ADIM > OTURUM > NULL");
    check(
      "adım varsa adım kazanır",
      resolveEntryStationId({ stepStationId: "A", sessionStationId: "B" }) === "A",
    );
    check(
      "adım yoksa oturum",
      resolveEntryStationId({ sessionStationId: "B" }) === "B",
    );
    check("ikisi de yoksa null", resolveEntryStationId({}) === null);
    check(
      "adım null ise oturuma düşer (undefined ile aynı)",
      resolveEntryStationId({ stepStationId: null, sessionStationId: "B" }) === "B",
    );

    // ── [3] MAKİNEDEN TÜRETİLMEZ ─────────────────────────────────────────────
    console.log("\n[3] Damga MAKİNEDEN türetilmiyor (makine taşınınca değişmemeli)");
    const stA = await prisma.station.create({
      data: { code: `TEST-ES-A-${Date.now().toString().slice(-7)}`, name: "TEST İstasyon A", type: "INTERNAL", kind: "RAW_QC" },
      select: { id: true },
    });
    const stB = await prisma.station.create({
      data: { code: `TEST-ES-B-${Date.now().toString().slice(-7)}`, name: "TEST İstasyon B", type: "INTERNAL", kind: "RAW_QC" },
      select: { id: true },
    });
    const mach = await prisma.machine.create({
      data: { code: `TEST-ES-M-${Date.now().toString().slice(-7)}`, name: "TEST Makine", stationId: stA.id },
      select: { id: true },
    });
    const item = await prisma.item.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true },
    });

    const res = await svc.createInitialEntry(
      { itemId: item.id, initialQty: 100, clientToken: randomUUID() },
      undefined,
      mach.id,
      true,
      { entryStationId: stA.id },
    );
    const rollId = (res.data as { id: string }).id;
    created.push(rollId);

    const row1 = await prisma.roll.findUniqueOrThrow({
      where: { id: rollId },
      select: { entryStationId: true, createdMachineId: true },
    });
    check("damga yazıldı", row1.entryStationId === stA.id, String(row1.entryStationId));
    check("makine damgası da yazıldı", row1.createdMachineId === mach.id);

    // ASIL İDDİA: makineyi B'ye taşı — topun giriş istasyonu DEĞİŞMEMELİ.
    await prisma.machine.update({ where: { id: mach.id }, data: { stationId: stB.id } });
    const row2 = await prisma.roll.findUniqueOrThrow({
      where: { id: rollId },
      select: { entryStationId: true },
    });
    check(
      "makine taşındı ama GİRİŞ İSTASYONU DEĞİŞMEDİ",
      row2.entryStationId === stA.id,
      `${row2.entryStationId} (makine artık B'de)`,
    );
    // Karşı kanıt: dolaylı yol OLSAYDI B döndürürdü.
    const viaMachine = await prisma.roll.findUniqueOrThrow({
      where: { id: rollId },
      select: { createdMachine: { select: { stationId: true } } },
    });
    check(
      "karşı kanıt — makine üzerinden okunsa B çıkardı (dolaylı yol bozuk)",
      viaMachine.createdMachine?.stationId === stB.id,
      String(viaMachine.createdMachine?.stationId),
    );

    // ── [4] SİLME GUARD'I ────────────────────────────────────────────────────
    console.log("\n[4] Giriş istasyonu olan istasyon kalıcı SİLİNEMEZ (SetNull tuzağı)");
    const cnt = await prisma.roll.count({ where: { entryStationId: stA.id } });
    check("guard sorgusu topu görüyor", cnt >= 1, `${cnt} top`);
    // Guard'ın kendisi guarded-hard-remove.ts'te; burada sorgunun DOĞRU alanı
    // saydığını kilitliyoruz (makine üzerinden dolaylı sayan eski guard bu topu
    // GÖRÜRDÜ ama makinesiz doğan Tambur/fason toplarını göremezdi).
    const indirect = await prisma.roll.count({
      where: { createdMachine: { stationId: stA.id } },
    });
    check(
      "dolaylı (makine) sayacı bu topu ARTIK göremiyor — doğrudan sayaç şart",
      indirect === 0,
      `${indirect} (makine B'ye taşındı)`,
    );
  } finally {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: created } } });
    await prisma.roll.deleteMany({ where: { id: { in: created } } });
    await prisma.machine.deleteMany({ where: { code: { startsWith: "TEST-ES-M-" } } });
    await prisma.station.deleteMany({ where: { code: { startsWith: "TEST-ES-" } } });
    console.log("\n(temizlendi — TEST-ES fixture'ları silindi)");
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
