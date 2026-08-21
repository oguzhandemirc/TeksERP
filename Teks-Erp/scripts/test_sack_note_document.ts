// =============================================================================
// Test: Sevk irsaliyesinde "AÇIKLAMA" (çuval yorumu) kolonu
// Çalıştır: npx tsx scripts/test_sack_note_document.ts
//
// SAF renderer testi (DB yok) — `renderShipmentDispatchHtml` bir pure function.
// Ek olarak `resolveLiveRowNotes` builder hook'u için tek DB assert'i var.
//
// Doğrulanan GÖRÜNÜRLÜK MATRİSİ (pure OR — tek-seferlik bayrak kalıcı ayarı EZER):
//   toggle kapalı + bayrak yok  → kolon YOK
//   toggle kapalı + bayrak VAR  → kolon VAR   ⭐ ana yol
//   toggle açık   + bayrak yok  → kolon VAR
//   toggle açık   + bayrak VAR  → kolon VAR (no-op)
// Ayrıca:
//   • bayrak yokken çıktı, yorumlar HİÇ çözülmemiş haliyle BİT-BİT AYNI
//   • kolon varsayılan KAPALI (yeni kolon mevcut config'lerde görünür DOĞMAZ)
//   • `hidden: ["note"]` opt-in kolonda YOK SAYILIR (tri-state)
//   • HTML escape (yorumda <script> geçerse kaçışlı basılır)
//   • hiç yorum yoksa kolon basılmaz (boş sütun gürültüsü olmaz)
//   • ÇEKİ listesine yorum SIZMAZ
//   • EN dilinde başlık "REMARKS"
//   • sanitizeDocumentsConfig `shown`-only satırı KORUR (1789 kapısı)
// =============================================================================

import prisma from "../src/lib/prisma";
import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import { sanitizeDocumentsConfig } from "../src/services/system-setting.service";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import type { DocumentConfig } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const NOTE_A = "Ölçü şüpheli — müşteri kontrol etsin";
const NOTE_XSS = '<script>alert("x")</script> & "kaçış"';

function snap(cfg: DocumentConfig | null): PrintedDocSnapshot {
  return {
    schemaVersion: 1,
    frozenAt: new Date("2026-07-30T08:00:00Z").toISOString(),
    company: { name: "TEST TEKSTİL", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
    docConfigOverride: cfg,
    doc: {
      header: {
        shipmentNo: "SVK3007260001", customerName: "TEST MÜŞTERİ", customerCode: "M1",
        customerTaxNumber: null, branchName: null, branchCode: null, procedureCode: null,
        destination: "DOMESTIC", status: "DISPATCHED", date: "2026-07-30T08:00:00Z",
        plateNumber: null, driverName: null, carrier: null, orderNos: "",
      },
      products: [{ name: "PAMUK 141cm.", rollCount: 2, totalMeters: 200 }],
      sacks: [
        { code: "CV3007260001", seq: 1, totalMeters: 120, totalKg: 40, packageCount: 1 },
        { code: "CV3007260002", seq: 2, totalMeters: 80, totalKg: 30, packageCount: 1 },
      ],
      cekiRows: [
        { sackCode: "CV3007260001", barcode: "T300726F0001", desen: "PAMUK", varyant: "", width: 141, meters: 120, kg: 40 },
        { sackCode: "CV3007260002", barcode: "T300726F0002", desen: "PAMUK", varyant: "", width: 141, meters: 80, kg: 0 },
      ],
      totals: { totalRolls: 2, totalMeters: 200, totalKg: 70, sackCount: 2 },
    } as unknown as Record<string, unknown>,
  };
}

/** Yorumlar (annotation) — sackNo → yorum. Donmuş snapshot'ta YOK. */
const ROW_NOTES = { CV3007260001: NOTE_A, CV3007260002: NOTE_XSS };

/** Kalıcı olarak kolonu AÇAN config (Belge Kişiselleştirme → shown). */
const CFG_SHOWN: DocumentConfig = { columns: { cuval: { shown: ["note"] } } };

async function main(): Promise<void> {
  // ── Görünürlük matrisi ────────────────────────────────────────────────────
  const offOff = renderShipmentDispatchHtml(snap(null), { rowNotes: ROW_NOTES, forceRowNotes: false });
  check("1) toggle kapalı + bayrak yok → kolon YOK", !offOff.includes("AÇIKLAMA") && !offOff.includes(NOTE_A));

  const offOn = renderShipmentDispatchHtml(snap(null), { rowNotes: ROW_NOTES, forceRowNotes: true });
  check("2) ⭐ toggle KAPALI + bayrak VAR → kolon VAR", offOn.includes("AÇIKLAMA") && offOn.includes(NOTE_A));

  const onOff = renderShipmentDispatchHtml(snap(CFG_SHOWN), { rowNotes: ROW_NOTES, forceRowNotes: false });
  check("3) toggle AÇIK + bayrak yok → kolon VAR", onOff.includes("AÇIKLAMA") && onOff.includes(NOTE_A));

  const onOn = renderShipmentDispatchHtml(snap(CFG_SHOWN), { rowNotes: ROW_NOTES, forceRowNotes: true });
  check("4) toggle AÇIK + bayrak VAR → kolon VAR (no-op)", onOn === onOff, "iki çıktı birebir aynı olmalı");

  // ── Regresyon: yorum mekanizması eski çıktıyı DEĞİŞTİRMEZ ─────────────────
  const legacy = renderShipmentDispatchHtml(snap(null), {});
  check("5) bayrak+yorum HİÇ verilmezse çıktı bit-bit AYNI", legacy === offOff);

  // ── Varsayılan kapalı: mevcut config'te kolon adı GEÇMEZ ──────────────────
  const withOtherCols = renderShipmentDispatchHtml(
    snap({ columns: { cuval: { order: ["code", "totalKg"] } } }),
    { rowNotes: ROW_NOTES },
  );
  check("6) başka kolon ayarı varken de kolon varsayılan KAPALI", !withOtherCols.includes("AÇIKLAMA"));

  // ── Tri-state: hidden opt-in kolonda YOK SAYILIR ──────────────────────────
  const hiddenIgnored = renderShipmentDispatchHtml(
    snap({ columns: { cuval: { shown: ["note"], hidden: ["note"] } } }),
    { rowNotes: ROW_NOTES },
  );
  check("7) `hidden:[note]` opt-in kolonda YOK SAYILIR (shown kazanır)", hiddenIgnored.includes("AÇIKLAMA"));
  // Karşıt: normal kolonda hidden HÂLÂ çalışıyor (blocklist bozulmadı).
  const kgHidden = renderShipmentDispatchHtml(snap({ columns: { cuval: { hidden: ["totalKg"] } } }), {});
  check("7b) normal kolonda `hidden` hâlâ çalışıyor (KG TOPLAMI düştü)", !kgHidden.includes("KG TOPLAMI"));

  // ── HTML escape ───────────────────────────────────────────────────────────
  check(
    "8) yorum HTML-escape edildi (<script> ham geçmedi)",
    offOn.includes("&lt;script&gt;") && !offOn.includes("<script>alert"),
  );

  // ── Boş kolon basılmaz ────────────────────────────────────────────────────
  const noNotes = renderShipmentDispatchHtml(snap(CFG_SHOWN), { rowNotes: {}, forceRowNotes: true });
  check("9) hiç yorum yoksa kolon BASILMAZ (boş sütun yok)", !noNotes.includes("AÇIKLAMA"));

  // ── ÇEKİ listesine sızmaz ─────────────────────────────────────────────────
  const cekiPart = offOn.slice(offOn.indexOf("ÇEKİ LİSTESİ"));
  check("10) ÇEKİ listesine yorum SIZMADI", !cekiPart.includes(NOTE_A));

  // ── EN dili ───────────────────────────────────────────────────────────────
  const en = renderShipmentDispatchHtml(
    snap({ ...CFG_SHOWN, language: "en" }),
    { rowNotes: ROW_NOTES },
  );
  check("11) EN dilinde başlık REMARKS", en.includes("REMARKS") && !en.includes("AÇIKLAMA"));

  // ── sanitize: `shown`-only satır KORUNUR (1789 kapısı) ────────────────────
  const sanitized = sanitizeDocumentsConfig({ shipmentDispatch: { columns: { cuval: { shown: ["note"] } } } });
  check(
    "12) ⭐ sanitize `shown`-only satırı KORUDU (sessizce atmadı)",
    sanitized.shipmentDispatch?.columns?.cuval?.shown?.includes("note") === true,
    JSON.stringify(sanitized.shipmentDispatch?.columns),
  );
  const sanitizedBad = sanitizeDocumentsConfig({ shipmentDispatch: { columns: { cuval: { shown: [1, "note", null] } } } });
  check("12b) sanitize `shown` içindeki non-string'leri attı", JSON.stringify(sanitizedBad.shipmentDispatch?.columns?.cuval?.shown) === '["note"]');

  // ── UÇTAN UCA: resolveLiveRowNotes + getHtml zinciri (gerçek DB) ──────────
  // Yorum donmuş çekirdeğe girmediği için PLANNED sevkiyatın TASLAK önizlemesinde
  // bile çıkmalı — "sevkten sonra yazılan yorum da basılır" iddiasının kanıtı.
  await import("../src/services/shipping.service"); // builder kaydı (side-effect)
  const { printedDocumentService } = await import("../src/services/printed-document.service");
  const { ShippingService } = await import("../src/services/shipping.service");
  const ship = new ShippingService();

  const ts = Date.now();
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true }, orderBy: { code: "asc" } });
  if (!item) throw new Error("Seed Item bulunamadı — önce `npm run seed`");
  const customer = await prisma.customer.create({ data: { code: `TST-SND-${ts}`, name: `BELGE YORUM TEST ${ts}` }, select: { id: true } });
  const rollIds: string[] = [];
  const sackIds: string[] = [];
  let shipmentId: string | null = null;
  try {
    const roll = await prisma.roll.create({
      data: {
        barcode: `TST-SND-${ts}`, itemId: item.id, colorId: null, width: 141,
        initialQty: 100, currentQty: 100, status: "WAREHOUSE", qualityGrade: "1.KALITE",
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true, barcode: true },
    });
    rollIds.push(roll.id);

    const opened = await ship.openSack({ customerId: customer.id });
    const sackId = (opened.data as { id: string; sackNo: string }).id;
    const sackNo = (opened.data as { sackNo: string }).sackNo;
    sackIds.push(sackId);
    await ship.scanIntoSack({ sackId, barcode: roll.barcode! });
    await ship.setSackNotes(sackId, NOTE_A);

    const sh = await prisma.shipment.create({
      data: { shipmentNo: `TST-SND-S-${ts}`, customerId: customer.id, status: "PLANNED" },
      select: { id: true },
    });
    shipmentId = sh.id;
    await prisma.sack.update({ where: { id: sackId }, data: { shipmentId: sh.id, seq: 1 } });

    const withFlag = await printedDocumentService.getHtml("SHIPMENT_DISPATCH", sh.id, undefined, {
      allowDraft: true,
      forceRowNotes: true,
    });
    const htmlOn = (withFlag.data as { html: string } | null)?.html ?? "";
    check("13) ⭐ uçtan uca: bayraklı baskıda yorum ÇIKTI", htmlOn.includes(NOTE_A) && htmlOn.includes(sackNo));

    const noFlag = await printedDocumentService.getHtml("SHIPMENT_DISPATCH", sh.id, undefined, { allowDraft: true });
    const htmlOff = (noFlag.data as { html: string } | null)?.html ?? "";
    check("14) uçtan uca: bayraksız baskıda yorum ÇIKMADI (kalıcı ayar kapalı)", !htmlOff.includes(NOTE_A));

    // Bayrak hiçbir yere yazılmadı: DOCUMENTS_CONFIG ayarında `shown` yok.
    const setting = await prisma.systemSetting.findUnique({ where: { key: "documents.config" }, select: { value: true } });
    const raw = JSON.stringify(setting?.value ?? {});
    check("15) ⭐ bayrak DOCUMENTS_CONFIG'e YAZILMADI", !raw.includes('"shown"'), raw.slice(0, 120));

    // Bayraklı baskı yeni belge versiyonu doğurmadı (taslak → donmuş kayıt yok).
    const docCount = await prisma.printedDocument.count({ where: { sourceId: sh.id } });
    check("16) bayraklı baskı donmuş belge/versiyon ÜRETMEDİ", docCount === 0, `kayıt: ${docCount}`);
  } finally {
    if (sackIds.length) await prisma.sack.updateMany({ where: { id: { in: sackIds } }, data: { shipmentId: null, seq: null } });
    if (rollIds.length) await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } });
    if (rollIds.length) await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    if (rollIds.length) await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    if (rollIds.length) await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    if (sackIds.length) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    if (shipmentId) await prisma.printedDocument.deleteMany({ where: { sourceId: shipmentId } });
    if (shipmentId) await prisma.shipment.deleteMany({ where: { id: shipmentId } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
