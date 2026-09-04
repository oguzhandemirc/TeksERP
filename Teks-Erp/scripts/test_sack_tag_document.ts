// =============================================================================
// BEKÇİ — Sevk irsaliyesinde "İZ" (çuval etiketi) kolonu  [plan §F]
// Çalıştır: npx tsx scripts/test_sack_tag_document.ts
// =============================================================================
// İz, çuvala bırakılan bir işarettir — ANNOTATION (`Sack.notes` kardeşi). Kardeşin
// bekçisi `test_sack_note_document.ts`; buradaki kontroller BİLEREK onun aynası,
// ama iki EK sınıf ölçer:
//
//   ⭐ AYRI KANAL: `?rowTags=1` `?rowNotes=1`e BİNDİRİLMEZ. Tek bayrak "notu bas"
//      diyen operatöre sessizce İZLERİ de bastırırdı (ve tersi) — ikisi farklı
//      hassasiyette veri. Bu bekçi bindirmenin YOKLUĞUNU iki yönde de ölçer (§4).
//   ⭐ DONMUŞ ÇEKİRDEĞE GİRMEZ: `collectShipmentDocContent` sevkten SONRA da koşuyor
//      (2026-08-05 dersi). İz snapshot'a girseydi (a) etiketleme sonrası reissue yeni
//      belge SÜRÜMÜ doğururdu, (b) DISPATCH'teki iz temizliği (`clearedAt`) snapshot
//      ile canlı listeyi KALICI çelişkiye sokardı. §7 gerçek bir freeze yapıp
//      snapshot JSON'unda etiket adını ARAR.
//
// Ölçülenler:
//   §1  Görünürlük matrisi (OR) + ⭐ kolon VARSAYILAN KAPALI + legacy bit-bit aynı
//   §2  Tri-state: `hidden:["tag"]` opt-in kolonda YOK SAYILIR; normal kolonda çalışır
//   §3  Escape · boş kolon basılmaz · ⭐ ÇEKİ listesine SIZMAZ · EN başlığı
//   §4  ⭐ İKİ BAYRAK AYRI: notes bayrağı izi AÇMAZ, tags bayrağı notu AÇMAZ
//   §5  ⭐ `columns.cuval.shown:["tag"]` sanitize + Zod turunda HAYATTA KALIR
//       ("ayar sessizce kaybolur" sınıfı — opt-in kolonun ön koşulu)
//   §6  Uçtan uca (gerçek DB): bayraklı baskıda iz ÇIKAR · bayraksızda ÇIKMAZ ·
//       ayara YAZILMAZ · yeni belge versiyonu DOĞURMAZ
//   §7  ⭐ DONMUŞ SNAPSHOT'TA İZ YOK (freeze → `printedDocument.snapshot` taraması)
//   §8  ⭐ SEVKTE TEMİZLENEN iz belgede BASILMAZ (`ACTIVE_TAG_WHERE` tek kaynağı)
//
// ⚠️ §8 BEKÇİNİN KÖR NOKTASINI KAPATIR — İLK YAZIMDA YOKTU ve tam da o yüzden
//    3. negatif sonda (`resolveLiveRowTags`ten `ACTIVE_TAG_WHERE` düşürüldü) ISIRMADI:
//    §1-§7'nin tamamı `clearedAt` NULL'ken koşuyor, yani temizleme yüklemi silinse
//    bile hepsi yeşil kalıyordu. Kardeş bekçi (`test_sack_tags`) da görmedi — o
//    belge yolunu hiç çağırmıyor. Bekçinin kör noktası hatanın kendisiyle aynı
//    yerdeydi; §8'i §1-§7 içine BİRLEŞTİRME.
//
// ⚠️ NEGATİF SONDALAR ÜRÜN KODU ÜZERİNDE ÖLÇÜLDÜ — bkz. dosya sonundaki liste.
//    Bekçiyi değiştirirsen hepsini tekrarla; "kırmızı verebiliyor mu" kanıtlanmamış
//    bekçi, bekçi değil süstür.
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";
import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import { sanitizeDocumentsConfig } from "../src/services/system-setting.service";
import { docConfigSchema } from "../src/controllers/printed-document.controller";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import type { DocumentConfig } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG_A = "Kontrol Et";
const TAG_XSS = '<script>alert("iz")</script> & "kaçış"';
const NOTE_A = "Ölçü şüpheli — müşteri kontrol etsin";

function snap(cfg: DocumentConfig | null): PrintedDocSnapshot {
  return {
    schemaVersion: 1,
    frozenAt: new Date("2026-09-04T08:00:00Z").toISOString(),
    company: { name: "TEST TEKSTİL", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
    docConfigOverride: cfg,
    doc: {
      header: {
        shipmentNo: "SVK0409260001", customerName: "TEST MÜŞTERİ", customerCode: "M1",
        customerTaxNumber: null, branchName: null, branchCode: null, procedureCode: null,
        destination: "DOMESTIC", status: "DISPATCHED", date: "2026-09-04T08:00:00Z",
        plateNumber: null, driverName: null, carrier: null, orderNos: "",
      },
      products: [{ name: "PAMUK 141cm.", rollCount: 2, totalMeters: 200 }],
      sacks: [
        { code: "CV0409260001", seq: 1, totalMeters: 120, totalKg: 40, packageCount: 1 },
        { code: "CV0409260002", seq: 2, totalMeters: 80, totalKg: 30, packageCount: 1 },
      ],
      cekiRows: [
        { sackCode: "CV0409260001", barcode: "T040926F0001", desen: "PAMUK", varyant: "", width: 141, meters: 120, kg: 40 },
        { sackCode: "CV0409260002", barcode: "T040926F0002", desen: "PAMUK", varyant: "", width: 141, meters: 80, kg: 0 },
      ],
      totals: { totalRolls: 2, totalMeters: 200, totalKg: 70, sackCount: 2 },
    } as unknown as Record<string, unknown>,
  };
}

/** İzler (annotation) — sackNo → virgüllü etiket adları. Donmuş snapshot'ta YOK. */
const ROW_TAGS = { CV0409260001: TAG_A, CV0409260002: TAG_XSS };
const ROW_NOTES = { CV0409260001: NOTE_A };

/** Kalıcı olarak İZ kolonunu AÇAN config (Belge Kişiselleştirme → shown). */
const CFG_TAG_SHOWN: DocumentConfig = { columns: { cuval: { shown: ["tag"] } } };

async function main(): Promise<void> {
  // =========================================================================
  console.log("[§1] GÖRÜNÜRLÜK MATRİSİ + varsayılan KAPALI");
  const offOff = renderShipmentDispatchHtml(snap(null), { rowTags: ROW_TAGS, forceRowTags: false });
  check(
    "⭐ §1 toggle kapalı + bayrak yok → kolon YOK (varsayılan KAPALI)",
    !offOff.includes(">İZ<") && !offOff.includes(TAG_A),
  );

  const offOn = renderShipmentDispatchHtml(snap(null), { rowTags: ROW_TAGS, forceRowTags: true });
  check("§1 toggle KAPALI + bayrak VAR → kolon VAR", offOn.includes(">İZ<") && offOn.includes(TAG_A));

  const onOff = renderShipmentDispatchHtml(snap(CFG_TAG_SHOWN), { rowTags: ROW_TAGS, forceRowTags: false });
  check("§1 toggle AÇIK + bayrak yok → kolon VAR", onOff.includes(">İZ<") && onOff.includes(TAG_A));

  const onOn = renderShipmentDispatchHtml(snap(CFG_TAG_SHOWN), { rowTags: ROW_TAGS, forceRowTags: true });
  check("§1 toggle AÇIK + bayrak VAR → no-op (iki çıktı BİREBİR aynı)", onOn === onOff);

  const legacy = renderShipmentDispatchHtml(snap(null), {});
  check("§1 iz mekanizması eski çıktıyı DEĞİŞTİRMEDİ (bit-bit aynı)", legacy === offOff);

  const withOtherCols = renderShipmentDispatchHtml(
    snap({ columns: { cuval: { order: ["code", "totalKg"] } } }),
    { rowTags: ROW_TAGS },
  );
  check(
    "⭐ §1 başka kolon ayarı varken de İZ varsayılan KAPALI (blocklist'e düşmedi)",
    !withOtherCols.includes(">İZ<"),
  );

  // =========================================================================
  console.log("\n[§2] TRİ-STATE — hidden opt-in kolonda yok sayılır");
  const hiddenIgnored = renderShipmentDispatchHtml(
    snap({ columns: { cuval: { shown: ["tag"], hidden: ["tag"] } } }),
    { rowTags: ROW_TAGS },
  );
  check("§2 `hidden:[tag]` opt-in kolonda YOK SAYILIR (shown kazanır)", hiddenIgnored.includes(">İZ<"));
  const kgHidden = renderShipmentDispatchHtml(snap({ columns: { cuval: { hidden: ["totalKg"] } } }), {});
  check("§2b normal kolonda `hidden` hâlâ çalışıyor (KG TOPLAMI düştü)", !kgHidden.includes("KG TOPLAMI"));

  // =========================================================================
  console.log("\n[§3] ESCAPE · boş kolon · ÇEKİ sızıntısı · EN");
  check(
    "§3 iz HTML-escape edildi (<script> ham geçmedi)",
    offOn.includes("&lt;script&gt;") && !offOn.includes("<script>alert"),
  );

  const noTags = renderShipmentDispatchHtml(snap(CFG_TAG_SHOWN), { rowTags: {}, forceRowTags: true });
  check("§3 hiç iz yoksa kolon BASILMAZ (boş sütun gürültüsü yok)", !noTags.includes(">İZ<"));

  // ⭐ Plan kararı: `cekiRows` satırı bir TOP'tur; çuval izi N satırda tekrarlanıp
  // topun özelliği gibi okunurdu. Kolon oraya EKLENMEDİ ve sızmamalı.
  const cekiPart = offOn.slice(offOn.indexOf("ÇEKİ LİSTESİ"));
  check("⭐ §3 ÇEKİ listesine iz SIZMADI", !cekiPart.includes(TAG_A));
  check("§3 iz gerçekten ÇUVAL tablosunda basıldı (sonda ölçüsü)", offOn.indexOf(TAG_A) < offOn.indexOf("ÇEKİ LİSTESİ"));

  const en = renderShipmentDispatchHtml(snap({ ...CFG_TAG_SHOWN, language: "en" }), { rowTags: ROW_TAGS });
  check("§3 EN dilinde başlık TAGS", en.includes(">TAGS<") && !en.includes(">İZ<"));

  // =========================================================================
  console.log("\n[§4] ⭐ İKİ BAYRAK AYRI — bindirme YOK (iki yönde de)");
  // Tek bayrak/tek anahtar olsaydı bu iki kontrol de sessizce YEŞİL kalırdı.
  const notesFlagOnly = renderShipmentDispatchHtml(snap(null), {
    rowNotes: ROW_NOTES, forceRowNotes: true,
    rowTags: ROW_TAGS, forceRowTags: false,
  });
  check(
    "⭐ §4 `?rowNotes=1` İZ kolonunu AÇMADI (yorum çıktı, iz çıkmadı)",
    notesFlagOnly.includes(NOTE_A) && !notesFlagOnly.includes(">İZ<") && !notesFlagOnly.includes(TAG_A),
  );
  const tagsFlagOnly = renderShipmentDispatchHtml(snap(null), {
    rowNotes: ROW_NOTES, forceRowNotes: false,
    rowTags: ROW_TAGS, forceRowTags: true,
  });
  check(
    "⭐ §4 `?rowTags=1` AÇIKLAMA kolonunu AÇMADI (iz çıktı, yorum çıkmadı)",
    tagsFlagOnly.includes(TAG_A) && !tagsFlagOnly.includes("AÇIKLAMA") && !tagsFlagOnly.includes(NOTE_A),
  );
  const bothFlags = renderShipmentDispatchHtml(snap(null), {
    rowNotes: ROW_NOTES, forceRowNotes: true,
    rowTags: ROW_TAGS, forceRowTags: true,
  });
  check(
    "§4 iki bayrak birlikte → iki kolon da VAR (bağımsız ama uyumlu)",
    bothFlags.includes("AÇIKLAMA") && bothFlags.includes(">İZ<") && bothFlags.includes(NOTE_A) && bothFlags.includes(TAG_A),
  );
  // Kalıcı ayar tarafında da bindirme yok: yalnız "note" açıkken iz görünmemeli.
  const noteShownOnly = renderShipmentDispatchHtml(
    snap({ columns: { cuval: { shown: ["note"] } } }),
    { rowNotes: ROW_NOTES, rowTags: ROW_TAGS },
  );
  check(
    "§4b kalıcı `shown:[note]` İZ kolonunu AÇMADI",
    noteShownOnly.includes("AÇIKLAMA") && !noteShownOnly.includes(">İZ<"),
  );

  // =========================================================================
  console.log("\n[§5] ⭐ AYAR SESSİZCE KAYBOLMASIN — sanitize + Zod turu");
  const sanitized = sanitizeDocumentsConfig({
    shipmentDispatch: { columns: { cuval: { shown: ["tag"] } } },
  });
  check(
    "⭐ §5 sanitize `shown:[tag]`-only satırı KORUDU (kayıt kapısı)",
    sanitized.shipmentDispatch?.columns?.cuval?.shown?.includes("tag") === true,
    JSON.stringify(sanitized.shipmentDispatch?.columns),
  );
  // Zod tanımadığı anahtarı hata VERMEDEN atar → önizleme kapısı ayrı ölçülür.
  const zodParsed = docConfigSchema.parse({ columns: { cuval: { shown: ["tag"] } } });
  check(
    "⭐ §5 Zod (canlı önizleme kapısı) `shown:[tag]` anahtarını KORUDU",
    zodParsed?.columns?.cuval?.shown?.includes("tag") === true,
    JSON.stringify(zodParsed?.columns),
  );
  // Tam tur: kaydet → oku → render. Ayar bir kapıdan düşse burada kolon çıkmaz.
  const roundTripped = renderShipmentDispatchHtml(
    snap((sanitized.shipmentDispatch ?? null) as DocumentConfig | null),
    { rowTags: ROW_TAGS },
  );
  check("⭐ §5 sanitize turundan geçen ayarla kolon GERÇEKTEN basıldı", roundTripped.includes(">İZ<"));
  const sanitizedBad = sanitizeDocumentsConfig({
    shipmentDispatch: { columns: { cuval: { shown: [1, "tag", null] } } },
  });
  check(
    "§5b sanitize `shown` içindeki non-string'leri attı",
    JSON.stringify(sanitizedBad.shipmentDispatch?.columns?.cuval?.shown) === '["tag"]',
  );

  // =========================================================================
  console.log("\n[§6/§7] UÇTAN UCA (gerçek DB) + donmuş snapshot");
  await import("../src/services/shipping.service"); // builder kaydı (side-effect)
  const { printedDocumentService } = await import("../src/services/printed-document.service");
  const { shippingService } = await import("../src/services/shipping.service");
  const { SackTagService } = await import("../src/services/sack-tag.service");

  const ts = Date.now();
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true }, orderBy: { code: "asc" } });
  if (!item) throw new Error("Seed Item bulunamadı — önce `npm run seed`");
  const customer = await prisma.customer.create({
    data: { code: `TST-IZB-${ts}`, name: `BELGE IZ TEST ${ts}` },
    select: { id: true },
  });
  const tagIds: string[] = [];
  const rollIds: string[] = [];
  const sackIds: string[] = [];
  let shipmentId: string | null = null;
  try {
    const tag = (await SackTagService.createTag({ name: `IZ BELGE ${ts}`, hex: "#2563EB" })).data;
    tagIds.push(tag.id);

    const roll = await prisma.roll.create({
      data: {
        barcode: `TST-IZB-${ts}`, itemId: item.id, colorId: null, width: 141,
        initialQty: 100, currentQty: 100, status: "WAREHOUSE", qualityGrade: "1.KALITE",
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true, barcode: true },
    });
    rollIds.push(roll.id);

    const opened = await shippingService.openSack({ customerId: customer.id });
    const sackId = (opened.data as { id: string; sackNo: string }).id;
    const sackNo = (opened.data as { sackNo: string }).sackNo;
    sackIds.push(sackId);
    await shippingService.scanIntoSack({ sackId, barcode: roll.barcode! });
    await SackTagService.setSackTags(sackId, [tag.id]);

    const sh = await prisma.shipment.create({
      data: { shipmentNo: `TST-IZB-S-${ts}`, customerId: customer.id, status: "PLANNED" },
      select: { id: true },
    });
    shipmentId = sh.id;
    await prisma.sack.update({ where: { id: sackId }, data: { shipmentId: sh.id, seq: 1 } });

    const withFlag = await printedDocumentService.getHtml("SHIPMENT_DISPATCH", sh.id, undefined, {
      allowDraft: true,
      forceRowTags: true,
    });
    const htmlOn = (withFlag.data as { html: string } | null)?.html ?? "";
    check(
      "⭐ §6 uçtan uca: bayraklı baskıda iz ÇIKTI",
      htmlOn.includes(tag.name) && htmlOn.includes(sackNo),
    );

    const noFlag = await printedDocumentService.getHtml("SHIPMENT_DISPATCH", sh.id, undefined, { allowDraft: true });
    const htmlOff = (noFlag.data as { html: string } | null)?.html ?? "";
    check("§6 uçtan uca: bayraksız baskıda iz ÇIKMADI (kalıcı ayar kapalı)", !htmlOff.includes(tag.name));

    // Kardeş kanal karışmadı: notes bayrağı izi getirmemeli (uçtan uca ayna).
    const notesFlagHtml = (
      (await printedDocumentService.getHtml("SHIPMENT_DISPATCH", sh.id, undefined, {
        allowDraft: true, forceRowNotes: true,
      })).data as { html: string } | null
    )?.html ?? "";
    check("⭐ §6 uçtan uca: `?rowNotes=1` izi GETİRMEDİ (kanal ayrı)", !notesFlagHtml.includes(tag.name));

    const setting = await prisma.systemSetting.findUnique({
      where: { key: "documents.config" },
      select: { value: true },
    });
    const raw = JSON.stringify(setting?.value ?? {});
    check("§6 tek-seferlik bayrak DOCUMENTS_CONFIG'e YAZILMADI", !raw.includes('"tag"'), raw.slice(0, 120));

    const draftDocCount = await prisma.printedDocument.count({ where: { sourceId: sh.id } });
    check("§6 bayraklı TASLAK baskı donmuş belge/versiyon ÜRETMEDİ", draftDocCount === 0, `kayıt: ${draftDocCount}`);

    // ── §7 DONMUŞ SNAPSHOT ────────────────────────────────────────────────
    // Belgeyi gerçekten dondur ve snapshot JSON'unda etiket adını ARA. İz donmuş
    // çekirdeğe girseydi: reissue yeni SÜRÜM doğurur ve DISPATCH temizliği
    // snapshot ile canlı listeyi kalıcı çelişkiye sokardı.
    await prisma.shipment.update({
      where: { id: sh.id },
      data: { status: "DISPATCHED", dispatchedAt: new Date() },
    });
    await printedDocumentService.freezeForSource(prisma, "SHIPMENT_DISPATCH", sh.id);
    const frozen = await prisma.printedDocument.findFirst({
      where: { sourceId: sh.id },
      select: { snapshot: true, version: true },
    });
    const frozenRaw = JSON.stringify(frozen?.snapshot ?? {});
    check(
      "⭐ §7 DONMUŞ SNAPSHOT'TA iz YOK (annotation çekirdeğe girmedi)",
      frozenRaw.length > 100 && !frozenRaw.includes(tag.name),
      `snapshot ${frozenRaw.length} bayt, v${frozen?.version}`,
    );
    // Kontrol grubu: snapshot GERÇEKTEN bu sevkiyatın içeriğini taşıyor — yoksa
    // yukarıdaki "iz yok" kontrolü boş bir JSON'da vakumen yeşil kalırdı.
    check(
      "§7 kontrol grubu: snapshot çuval no'sunu TAŞIYOR (kör nokta zemini)",
      frozenRaw.includes(sackNo),
    );
    // Donmuş belge yolunda da iz bayrakla CANLI çözülüyor (sevkten sonra bile).
    const frozenHtml = (
      (await printedDocumentService.getHtml("SHIPMENT_DISPATCH", sh.id, undefined, { forceRowTags: true })).data as
        | { html: string }
        | null
    )?.html ?? "";
    check(
      "⭐ §7 donmuş belgede de iz CANLI çözüldü (sevkten sonra bırakılan iz de basılır)",
      frozenHtml.includes(tag.name),
    );

    // ── §8 TEMİZLENMİŞ İZ BASILMAZ (`ACTIVE_TAG_WHERE` tek kaynağı) ────────
    // ⚠️ BU KONTROL BEKÇİNİN KÖR NOKTASINI KAPATIR: yukarıdaki her şey `clearedAt`
    // NULL'ken koşuyor, yani `resolveLiveRowTags` yüklemi düşürülse bile yeşil
    // kalırdı (negatif sonda 3 ilk yazımda ISIRMADI — ölçüldü). Damgayı sevkin
    // yazdığı gibi elle basıyoruz: §D'nin YAZMA tarafı `test_sack_tags` §1'de
    // ölçülüyor, burada ölçülen şey BELGENİN OKUMA tarafı.
    await prisma.sackTagAssignment.updateMany({
      where: { sackId, tagId: tag.id },
      data: { clearedAt: new Date(), clearedShipmentId: sh.id },
    });
    const clearedHtml = (
      (await printedDocumentService.getHtml("SHIPMENT_DISPATCH", sh.id, undefined, { forceRowTags: true })).data as
        | { html: string }
        | null
    )?.html ?? "";
    check(
      "⭐ §8 SEVKTE TEMİZLENEN iz belgede BASILMADI (ACTIVE_TAG_WHERE tek kaynak)",
      !clearedHtml.includes(tag.name) && clearedHtml.includes(sackNo),
    );
  } finally {
    await prisma.sackTagAssignment.deleteMany({ where: { tagId: { in: tagIds } } });
    await prisma.sackTag.deleteMany({ where: { id: { in: tagIds } } });
    if (sackIds.length) await prisma.sack.updateMany({ where: { id: { in: sackIds } }, data: { shipmentId: null, seq: null } });
    if (rollIds.length) {
      await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (sackIds.length) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    if (shipmentId) {
      await prisma.printedDocument.deleteMany({ where: { sourceId: shipmentId } });
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId } });
      await prisma.shipment.deleteMany({ where: { id: shipmentId } });
    }
    await prisma.customer.deleteMany({ where: { id: customer.id } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

// =============================================================================
// NEGATİF SONDALAR (ürün kodu üzerinde ölçüldü, hepsi md5 ile geri alındı):
//   1. `tag` kolonundan `defaultHidden: true` düşürüldü (naif blocklist yazımı —
//      "iç iz müşteri belgesine sızar" sınıfı)                            → 8 ❌
//   2. `forceRowTags` `forceRowNotes`e BİNDİRİLDİ (tek bayrak, iki kolon)  → 7 ❌
//   3. `resolveLiveRowTags` `ACTIVE_TAG_WHERE`i düşürdü (temizlenmiş iz basılır)
//      → 1 ❌ (YALNIZ §8; §1-§7 ve kardeş bekçi 55/55 SUSTU — yukarıdaki nota bak)
//   4. İz `collectShipmentDocContent` çekirdeğine taşındı (donmuş snapshot'a girdi)
//      → 1 ❌ (§7; snapshot 1328 → 1359 bayt)
//   5. Aynı kolon `cekiRows` tablosuna da eklendi (top satırına çuval izi) → 9 ❌
//   6. `sanitizeDocumentsConfig`ten `shown` dalı çıkarıldı (ayar sessizce kaybolur)
//      → 3 ❌
// Altısı da md5 ile birebir geri alındı.
// =============================================================================

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
