// =============================================================================
// Test: ÖLÜ ETİKET SÖZLEŞMESİ — etiketli iptal guard'ı + iptali geri alma
// Çalıştır: npx tsx scripts/test_roll_cancel_undo.ts
// =============================================================================
// SAHA VAKASI (2026-08-05, gerçek veriden yeniden kuruldu):
//   10:48:29  T050826H0033 KK1'de doğdu (BAYRO FLAM, 100 m, STOCK)
//   10:48:30  etiketi BASILDI → kâğıt fiziksel olarak topa yapıştı
//   10:56:02  aynı operatör kaydı İPTAL etti — uyarı yok, sebep sorulmadı
//   11:09     iş emri açıldı, mal boyahaneye gitmek zorundaydı
//   14:12     operatör doğaçladı: İKİNCİ bir kayıt (T050826H0072) + ikinci etiket
//   ~15:57    ölü etiket okutuldu → sistem yalnız "stokta değil" dedi
//
// Dört yapısal boşluk vardı; bu bekçi dördünü de kilitler:
//   [1] İptal, etiketin basıldığına BAKMIYORDU        → LABEL_PRINTED guard'ı
//   [2] Etiketli iptalde sebep sorulmuyordu           → CANCEL_REASON_REQUIRED
//   [3] İptalin GERİ DÖNÜŞÜ yoktu (→ ikinci barkod)   → restoreCancelledRoll
//   [4] Okutma yüzeyi sebebi söylemiyordu             → lookup teşhis alanları
//
// ⚠️ Bekçinin en kolay kaybedilen özelliği: guard'ların HEPSİ "kırmızı verebiliyor
// mu" diye negatif sondayla sınanmalı. Guard'ı kaldırıp testi koştur; kırmızı
// vermiyorsa test o guard'ı ölçmüyordur.
// =============================================================================

import { randomUUID } from "crypto";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import {
  resolveRollRestoreBlockReason,
  resolveRestoreTargetStatus,
} from "../src/services/helpers/roll-cancel-restore.helper";
import { RollStatus } from "@prisma/client";

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

const service = new InventoryService();
const created: string[] = [];

/** Test topu — fixture'ı test KENDİSİ yaratır (ortam verisine yaslanma yasağı). */
async function makeRoll(opts: {
  labelPrinted: boolean;
  status?: RollStatus;
}): Promise<{ id: string; barcode: string }> {
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Aktif ürün yok — seed koşulmamış olabilir");
  const barcode = `T-TEST-${randomUUID().slice(0, 8)}`;
  const roll = await prisma.roll.create({
    data: {
      itemId: item.id,
      barcode,
      initialQty: 100,
      currentQty: 100,
      status: opts.status ?? RollStatus.STOCK,
      entrySource: "SUPPLIER_RECEIPT",
      labelPrintedAt: opts.labelPrinted ? new Date() : null,
    },
    select: { id: true, barcode: true },
  });
  created.push(roll.id);
  return { id: roll.id, barcode: roll.barcode! };
}

async function main(): Promise<void> {
  console.log("=== ÖLÜ ETİKET SÖZLEŞMESİ ===\n");

  // ── §1 Etiketi BASILMAMIŞ top: davranış DEĞİŞMEDİ ─────────────────────────
  // Regresyon zemini: guard yalnız etiketli sınıfa dokunmalı. Her iptali onaya
  // bağlamak depo/mobil akışlarını sebepsiz kırardı.
  console.log("§1 Etiketsiz top — eski davranış korunuyor");
  {
    const r = await makeRoll({ labelPrinted: false });
    let ok = true;
    let msg = "";
    try {
      await service.softDelete(r.id, undefined, {});
    } catch (e) {
      ok = false;
      msg = (e as Error).message;
    }
    check("etiketi basılmamış top onaysız/sebepsiz iptal edilir", ok, msg);
    const after = await prisma.roll.findUnique({
      where: { id: r.id },
      select: { status: true, cancelledAt: true, preCancelStatus: true },
    });
    check("statü CANCELLED", after?.status === RollStatus.CANCELLED);
    check("cancelledAt damgalandı", after?.cancelledAt != null);
    check(
      "preCancelStatus iptalden önceki rafı taşıyor",
      after?.preCancelStatus === RollStatus.STOCK,
      String(after?.preCancelStatus),
    );
  }

  // ── §2 Etiketi BASILMIŞ top: onaysız iptal REDDEDİLİR ─────────────────────
  console.log("\n§2 Etiketli top — fail-loud iptal");
  {
    const r = await makeRoll({ labelPrinted: true });
    let code = "";
    try {
      await service.softDelete(r.id, undefined, {});
      check("onaysız iptal reddedildi", false, "GEÇTİ — guard yok!");
    } catch (e) {
      code = (e as { details?: { code?: string } }).details?.code ?? "";
      check("onaysız iptal 409 ile reddedildi", true);
      check("hata kodu LABEL_PRINTED", code === "LABEL_PRINTED", code);
      check(
        "mesaj operatöre NE YAPACAĞINI söylüyor (etiketi sök)",
        /etiketi\s+topt?an\s+sök/i.test((e as Error).message),
        (e as Error).message.slice(0, 80),
      );
    }
    const still = await prisma.roll.findUnique({ where: { id: r.id }, select: { status: true } });
    check("top hâlâ iptal EDİLMEMİŞ", still?.status === RollStatus.STOCK, String(still?.status));

    // Onay var ama SEBEP yok → yine reddedilir.
    try {
      await service.softDelete(r.id, undefined, { confirmLabelPrinted: true });
      check("sebepsiz iptal reddedildi", false, "GEÇTİ — sebep zorunluluğu yok!");
    } catch (e) {
      const c = (e as { details?: { code?: string } }).details?.code ?? "";
      check("onaylı ama sebepsiz iptal reddedildi", true);
      check("hata kodu CANCEL_REASON_REQUIRED", c === "CANCEL_REASON_REQUIRED", c);
    }

    // Onay + sebep → geçer ve sebep TOPUN SATIRINA yazılır (audit'e değil).
    await service.softDelete(r.id, undefined, {
      confirmLabelPrinted: true,
      reason: "yanlış metraj girildi",
    });
    const done = await prisma.roll.findUnique({
      where: { id: r.id },
      select: { status: true, cancelReason: true },
    });
    check("onay + sebep ile iptal edildi", done?.status === RollStatus.CANCELLED);
    check(
      "sebep topun KENDİ satırında (audit'te değil — 6 ayda arşivlenir)",
      done?.cancelReason === "yanlış metraj girildi",
      String(done?.cancelReason),
    );
  }

  // ── §3 Geri alma: temiz kayıt geri döner, RAFI KORUNUR ────────────────────
  console.log("\n§3 İptali geri alma");
  {
    const r = await makeRoll({ labelPrinted: true, status: RollStatus.A1_STOCK });
    await service.softDelete(r.id, undefined, {
      confirmLabelPrinted: true,
      reason: "sehven girildi",
    });
    const res = await service.restoreCancelledRoll(r.id);
    check("geri alma başarılı", res.success === true);
    const after = await prisma.roll.findUnique({
      where: { id: r.id },
      select: { status: true, cancelledAt: true, cancelReason: true, preCancelStatus: true },
    });
    // ⚠️ EN KRİTİK KONTROL: körlemesine STOCK'a dönmek 2. kalite topu 1. kalite
    // rafına yazardı (`preShipStatus` vakasının birebir aynısı).
    check(
      "iptalden ÖNCEKİ rafa döndü (A1_STOCK) — körlemesine STOCK değil",
      after?.status === RollStatus.A1_STOCK,
      String(after?.status),
    );
    check("cancelledAt temizlendi", after?.cancelledAt === null);
    check("cancelReason temizlendi", after?.cancelReason === null);
    check("preCancelStatus temizlendi", after?.preCancelStatus === null);

    // İkinci kez geri alma → anlamlı red (idempotent sessizlik DEĞİL).
    try {
      await service.restoreCancelledRoll(r.id);
      check("iptal edilmemiş topta geri alma reddedildi", false, "GEÇTİ");
    } catch (e) {
      check(
        "iptal edilmemiş topta geri alma anlamlı red veriyor",
        /iptal edilmemiş/i.test((e as Error).message),
        (e as Error).message.slice(0, 60),
      );
    }
  }

  // ── §4 Geri alma KAPSAMI: hareket görmüş top reddedilir ───────────────────
  console.log("\n§4 Geri alma kapsamı — dar ve sebebi söylenir");
  {
    // Saf yüklem üzerinde: kapsam kararı DB'siz sınanabilir olmalı.
    const base = {
      status: RollStatus.CANCELLED,
      preCancelStatus: RollStatus.STOCK,
      batchId: null,
      sackId: null,
      shipmentId: null,
      currentStepId: null,
      movementCount: 0,
      operationCount: 0,
      childCount: 0,
      dispatchItemCount: 0,
      kartelaItemCount: 0,
    };
    check("temiz kayıt: engel yok", resolveRollRestoreBlockReason(base) === null);
    check(
      "hareketli top engelli",
      /hareket kaydı var/i.test(resolveRollRestoreBlockReason({ ...base, movementCount: 1 }) ?? ""),
    );
    check(
      "partili top engelli",
      /partiye kayıtlı/i.test(resolveRollRestoreBlockReason({ ...base, batchId: "x" }) ?? ""),
    );
    check(
      "kesilmiş top engelli",
      /kesilmiş/i.test(resolveRollRestoreBlockReason({ ...base, childCount: 2 }) ?? ""),
    );
    check(
      "çuvaldaki top engelli",
      /çuvala\/sevkiyata/i.test(resolveRollRestoreBlockReason({ ...base, sackId: "x" }) ?? ""),
    );
    check(
      "fason sevkine girmiş top engelli",
      /fason\/kartela/i.test(
        resolveRollRestoreBlockReason({ ...base, dispatchItemCount: 1 }) ?? "",
      ),
    );
    // Her engel mesajı SEBEBİ söylemeli — sessiz 409 yasak.
    const reasons = [
      resolveRollRestoreBlockReason({ ...base, movementCount: 1 }),
      resolveRollRestoreBlockReason({ ...base, batchId: "x" }),
      resolveRollRestoreBlockReason({ ...base, childCount: 1 }),
    ];
    check(
      "engel mesajlarının hepsi dolu ve Türkçe",
      reasons.every((r) => typeof r === "string" && r.length > 20),
    );

    // Hedef raf çözümü.
    check("hedef raf: WAREHOUSE korunur", resolveRestoreTargetStatus(RollStatus.WAREHOUSE) === RollStatus.WAREHOUSE);
    check("hedef raf: A1_STOCK korunur", resolveRestoreTargetStatus(RollStatus.A1_STOCK) === RollStatus.A1_STOCK);
    check("hedef raf: NULL → STOCK (en kısıtsız raf)", resolveRestoreTargetStatus(null) === RollStatus.STOCK);
    check(
      "hedef raf: tanınmayan statü → STOCK (satılabilir diye işaretlemez)",
      resolveRestoreTargetStatus(RollStatus.SHIPPED) === RollStatus.STOCK,
    );
  }

  // ── §5 Okutma teşhisi: lookup "neden + geri alınabilir mi" taşır ──────────
  console.log("\n§5 Okutma teşhisi");
  {
    const r = await makeRoll({ labelPrinted: true });
    await service.softDelete(r.id, undefined, {
      confirmLabelPrinted: true,
      reason: "mükerrer giriş",
    });
    const look = await service.findRollByBarcode(r.barcode);
    const d = look.data as unknown as {
      status: RollStatus;
      cancelReason: string | null;
      cancelledAt: Date | null;
      canRestore?: boolean;
      restoreBlockReason?: string | null;
    };
    check("okutma iptal sebebini taşıyor", d.cancelReason === "mükerrer giriş");
    check("okutma iptal tarihini taşıyor", d.cancelledAt != null);
    // Ekran ile uç AYNI yüklemi kullanmalı — ayrışırsa "Geri Al" butonu 409 üretir.
    check("okutma canRestore taşıyor", d.canRestore === true, String(d.canRestore));
    check("engel yokken restoreBlockReason null", d.restoreBlockReason === null);

    // Geri alındıktan sonra teşhis alanları DÜŞER (top artık iptal değil).
    await service.restoreCancelledRoll(r.id);
    const look2 = await service.findRollByBarcode(r.barcode);
    const d2 = look2.data as unknown as { canRestore?: boolean; cancelReason: string | null };
    check("geri alındıktan sonra canRestore yok", d2.canRestore === undefined);
    check("geri alındıktan sonra sebep temiz", d2.cancelReason === null);
  }

  // ── §6 Önizleme labelPrinted bayrağını söylüyor ───────────────────────────
  console.log("\n§6 İptal önizlemesi");
  {
    const withLabel = await makeRoll({ labelPrinted: true });
    const without = await makeRoll({ labelPrinted: false });
    const p1 = (await service.getCancelPreview(withLabel.id)).data;
    const p2 = (await service.getCancelPreview(without.id)).data;
    check("etiketli topta labelPrinted=true", p1.labelPrinted === true);
    check("etiketli topta labelPrintedAt dolu", p1.labelPrintedAt != null);
    check("etiketsiz topta labelPrinted=false", p2.labelPrinted === false);
    // İki eksen AYRI: "istasyonda aktif mi" ile "sahada ölü kâğıt bırakır mı".
    check("labelPrinted, requiresConfirm'den ayrı eksen", p1.requiresConfirm === false);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    // Test kendi yarattığını siler.
    if (created.length) {
      await prisma.roll.deleteMany({ where: { id: { in: created } } }).catch(() => {});
    }
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
