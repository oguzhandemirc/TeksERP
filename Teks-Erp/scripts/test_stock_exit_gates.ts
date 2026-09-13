// =============================================================================
// BEKÇİ — STOK KÜMESİNDEN ÇIKAN YOLLARIN DEPO KAPISI (K6)
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_exit_gates
// =============================================================================
// NEDEN: deposuz bir top stok kümesinden çıkarsa defter çıkış satırının `from`
// ucu kurulamaz ve satır SESSİZCE atlanır — mal gider, defter çıkışı görmez.
// Ölçüldü (sevk yolunda, d9): iki top sevk edildi, TEK `SHIPMENT` satırı yazıldı.
// Kapı o sessizliği kapatır ve `assertEndShape` (500) yalnız SON AĞ olarak kalır.
//
// ÖLÇÜLENLER — dört çıkış yolu, dördü de AYNI helper'dan (tek kaynak)
//   §1 Kartela sevki: deposuz top 409 · `details.code` · barkod listesi
//   §2 Top İPTALİ: deposuz stok topu 409 (iptal bozuk kaydın çaresi olsa da —
//      alternatifi kanıtsız bir depo uydurmak olurdu)
//   §3 ⭐ Stok DIŞI statüden iptal depo İSTEMEZ (o mal zaten stokta değil)
//   §4 ⭐ TRANSFER kendi yüklemiyle reddediyor — servis GERÇEKTEN çağrılarak ölçülür
//      (metin çapası negatif sondada çürüdü: sarmalamak metni korur, korumayı bozar)
//   §5 Pozitif kontrol: DEPOLU top aynı yollardan GEÇER (kapı her şeyi durdurmuyor)
//
// ⚠️ KAPI ≠ DEFTER SATIRI: kartela bugün hiç defter satırı yazmıyor (ileri de,
// ters de). Bu bekçi yalnız KAPIYI ölçer; kartela satırları K7'nin son dilimi.
// "Kapı kondu" ile "yol deftere bağlandı" aynı şey değil.
// =============================================================================
import { RollForm, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { fixtureWarehouseId } from "./fixture-warehouse";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SEG-${Date.now()}`;
const rollIds: string[] = [];
let itemId = "";

interface Hata { status?: number; code?: unknown; message: string; barkodVar: boolean }

async function yakala(fn: () => Promise<unknown>, barkod: string): Promise<Hata | null> {
  try { await fn(); return null; } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: unknown }; message?: string };
    const message = err.message ?? String(e);
    return {
      status: err.statusCode,
      code: err.details?.code,
      message,
      barkodVar: message.includes(barkod),
    };
  }
}

async function mkRoll(suffix: string, status: RollStatus, warehouseId: string | null): Promise<{ id: string; barcode: string }> {
  const barcode = `${TAG}-${suffix}`;
  const r = await prisma.roll.create({
    data: {
      barcode, itemId, initialQty: 100, currentQty: 100,
      status, form: RollForm.TOP, warehouseId, entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return { id: r.id, barcode };
}

async function main(): Promise<void> {
  console.log("\n=== Stok çıkış yollarının depo kapısı ===\n");
  const whId = await fixtureWarehouseId();
  itemId = (await prisma.item.create({
    data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true },
  })).id;

  const { InventoryService } = await import("../src/services/inventory.service");
  const { kartelaService } = await import("../src/services/kartela.service");
  const inv = new InventoryService();

  const firma = await prisma.subcontractor.findFirst({
    where: { isActive: true }, select: { id: true },
  });

  // ── §1 — KARTELA SEVKİ ────────────────────────────────────────────────────
  if (firma) {
    const deposuz = await mkRoll("K1", RollStatus.WAREHOUSE, null);
    const h = await yakala(
      () => kartelaService.dispatch({ subcontractorId: firma.id, rollIds: [deposuz.id] }),
      deposuz.barcode,
    );
    check(
      "§1a ⭐ Kartela sevki deposuz topu 409 ile durdurdu",
      h !== null && h.status === 409,
      h ? `kod=${String(h.status)}` : "HİÇ fırlatmadı",
    );
    check(
      "§1b ⭐ `details.code` = ROLL_WAREHOUSE_MISSING (body.code DEĞİL)",
      h?.code === "ROLL_WAREHOUSE_MISSING",
      `code=${String(h?.code)}`,
    );
    check("§1c ⭐ Mesaj BARKODU sayıyor (soyut sayı yetmez)", h?.barkodVar === true, h?.message?.slice(0, 90) ?? "");
  } else {
    console.log("   ℹ️ §1 ATLANDI: aktif kartela firması yok (körlük zemini).");
  }

  // ── §2 — TOP İPTALİ (stok kümesinden) ─────────────────────────────────────
  const iptalDeposuz = await mkRoll("C1", RollStatus.WAREHOUSE, null);
  const h2 = await yakala(
    () => inv.softDelete(iptalDeposuz.id, undefined, { reason: `${TAG} bekçi iptali`, confirmActive: true, confirmLabelPrinted: true }),
    iptalDeposuz.barcode,
  );
  check(
    "§2a ⭐ İptal deposuz STOK topunu 409 ile durdurdu",
    h2 !== null && h2.status === 409,
    h2 ? `kod=${String(h2.status)}` : "HİÇ fırlatmadı",
  );
  check("§2b ⭐ Barkod mesajda", h2?.barkodVar === true, h2?.message?.slice(0, 90) ?? "");

  // ── §3 — STOK DIŞI statüden iptal depo İSTEMEZ ────────────────────────────
  // `IN_PRODUCTION` top stokta değil; iptalinde defter çıkışı da doğmaz, yani
  // kapı oraya uygulanmamalı. Kapıyı statüden bağımsız koysaydık üretimdeki
  // deposuz bir topun iptali kilitlenirdi.
  const uretimDeposuz = await mkRoll("C2", RollStatus.IN_PRODUCTION, null);
  const h3 = await yakala(
    () => inv.softDelete(uretimDeposuz.id, undefined, { reason: `${TAG} üretim iptali`, confirmActive: true, confirmLabelPrinted: true }),
    uretimDeposuz.barcode,
  );
  check(
    "§3 ⭐ Stok DIŞI statüden iptal depo istemedi (kapı statüye duyarlı)",
    h3 === null || !h3.message.includes("deposu tanımlı değil"),
    h3 ? h3.message.slice(0, 90) : "geçti",
  );

  // ── §4 — TRANSFER kendi yüklemiyle kapatıyor (ikinci kapı YOK) ────────────
  // Transfer `r.warehouseId !== input.fromWarehouseId` yüklemiyle deposuz topu
  // zaten reddediyor (NULL hiçbir depoya eşit değil), o yüzden ikinci bir kapı
  // EKLENMEDİ — "aynı soruyu cevaplayan iki yer" olurdu. Ama o koruma sessizce
  // kaybolabilir, bu yüzden ölçülüyor.
  //
  // ⚠️ İLK SÜRÜM KAYNAK METNİNİ ARIYORDU ve NEGATİF SONDA ONU ÇÜRÜTTÜ: yüklemi
  // `r.warehouseId === null ? false : <aynı ifade>` ile sarmak korumayı etkisiz
  // kılıyor ama METNİ koruyor ⇒ çapa yeşil kalıyordu. Metin varlığı DAVRANIŞ
  // kanıtı değildir; kontrol artık servisi GERÇEKTEN çağırıyor.
  const ikinciDepo = await prisma.warehouse.findFirst({
    where: { isDefault: false, isActive: true }, select: { id: true },
  });
  if (ikinciDepo) {
    const { warehouseTransferService } = await import("../src/services/warehouse-transfer.service");
    const trDeposuz = await mkRoll("T1", RollStatus.WAREHOUSE, null);
    const h4 = await yakala(
      () => warehouseTransferService.create({
        fromWarehouseId: whId, toWarehouseId: ikinciDepo.id, rollIds: [trDeposuz.id],
      }),
      trDeposuz.barcode,
    );
    // ⚠️ "REDDEDİLDİ" YETMEZ, "DOĞRU KATMAN reddetti" ölçülür. Transfer'de İKİ
    // bağımsız koruma var ve negatif sonda ikisini ayırdı:
    //   · doğrulama yüklemi → 400, mesaj TOPU ADIYLA söyler ("bu depoda değil")
    //   · atomik claim      → 409, mesaj "başka bir işleme girdi" (YANILTICI teşhis:
    //                         yarış yok, topun deposu yok)
    // Yüklem sarmalanıp etkisiz kılındığında claim hâlâ reddediyor ⇒ `h4 !== null`
    // yeşil kalıyordu. Barkodu ŞART koşmak yüklemi izole eder.
    check(
      "§4 ⭐ Transfer deposuz topu ADIYLA reddetti (yüklem; claim'in yanıltıcı 409'u değil)",
      h4 !== null && h4.barkodVar,
      h4 ? `${String(h4.status)}: ${h4.message.slice(0, 80)}` : "GEÇTİ — koruma kaybolmuş",
    );
  } else {
    console.log("   ℹ️ §4 ATLANDI: ikinci depo yok, transfer çağrılamaz (körlük zemini).");
  }

  // ── §5 — POZİTİF KONTROL: depolu top geçer ────────────────────────────────
  // Kapı "her şeyi durduruyor" olmasın: aynı yollar DEPOLU topta çalışmalı.
  const iptalDepolu = await mkRoll("C3", RollStatus.WAREHOUSE, whId);
  const h5 = await yakala(
    () => inv.softDelete(iptalDepolu.id, undefined, { reason: `${TAG} depolu iptal`, confirmActive: true, confirmLabelPrinted: true }),
    iptalDepolu.barcode,
  );
  const sonra = await prisma.roll.findUnique({
    where: { id: iptalDepolu.id }, select: { status: true },
  });
  check(
    "§5 ⭐ POZİTİF KONTROL: DEPOLU top iptal edildi (kapı geçirgen)",
    h5 === null && sonra?.status === RollStatus.CANCELLED,
    h5 ? `fırlattı: ${h5.message.slice(0, 70)}` : `statü=${String(sonra?.status)}`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds }, reversesMovementId: { not: null } } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
