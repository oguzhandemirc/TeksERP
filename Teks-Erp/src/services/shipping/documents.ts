// =============================================================================
// Shipping Service / documents
// =============================================================================
// İrsaliye + kalite sertifikası içerik üretimi, belge builder kayıtları (yan etki) ve sevk raporları.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (shipping/list.ts sayılır) */

import {
  Prisma,
  ShipmentStatus,
  ShipmentDestination,
  PrintedDocType,
  PrintedDocStatus,
  LoadUnitKind,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { loadOpenDefectNotes } from "../helpers/open-defect-note.helper";
import { loadActiveCustomerCodes } from "../helpers/roll-customer-code-read.helper";
import { AppError } from "../../utils/app-error";
import {
  printedDocumentService,
  registerPrintedDocBuilder,
  type BuiltDocContent,
  type PrintedDocDb,
} from "../printed-document.service";
import {
  renderShipmentDispatchHtml,
  renderShipmentDispatchTables,
  type ShipmentDispatchDoc,
} from "../document-render/shipment-dispatch.html";
import { renderQualityCertificateHtml, type QualityCertificateDoc } from "../document-render/quality-certificate.html";
import { loadShipmentCustomerNames } from "../helpers/shipment-customer-name.helper";
import { loadCustomerNamePolicy } from "../helpers/quality-role.helper";
import {
  readShippingDocItemNameMode,
  readShippingDocCekiNameMode,
  readShippingDocProductColorSplit,
} from "../system-setting.service";
import { resolveDocNameMode, type DocNameMode } from "../document-render/shipment-name-mode";
import {
  SACK_ABSENT_STATUSES,
} from "../helpers/sack-invariants.helper";
import {
  D0,
} from "../helpers/allocation.helper";
import { ACTIVE_TAG_WHERE } from "../helpers/sack-tag.helper";
import { ApiResponse } from "../../types/api.types";
import {
  exportCodeForDestination,
} from "../helpers/shipment-destination.helper";
import { ACTIVE_SACK_ALLOCATION } from "../helpers/sack-allocation.helper";
import { LIVE_LOAD_UNIT_WHERE } from "../helpers/load-unit.helper";
import { DELIVERY_TO_SELECT, deliveryToSnapshot } from "../helpers/shipment-delivery.helper";

/** Belge özeti: dökme/arabada birim türü + etiket; çuvalda HİÇ anahtar yok (eski snapshot ile bayt-eşit). */
function loadUnitDocFields(sk: { unitKind: LoadUnitKind; unitLabel: string | null }): { unitKind?: "CART" | "BULK"; unitLabel?: string | null } {
  if (sk.unitKind === LoadUnitKind.SACK) return {};
  return { unitKind: sk.unitKind, unitLabel: sk.unitLabel };
}

/** Çeki satırının birim kodu: "Dökme" / "Araba <no>"; çuvalda null (sackNo basılır). */
function loadUnitCekiCode(sk: { unitKind: LoadUnitKind; unitLabel: string | null }): string | null {
  if (sk.unitKind === LoadUnitKind.BULK) return "Dökme";
  if (sk.unitKind === LoadUnitKind.CART) return `Araba ${sk.unitLabel ?? ""}`.trim();
  return null;
}

/**
 * Bir sevkiyattan İPTAL EDİLMEMİŞ iadelerin özeti (adet + metraj).
 *
 * Fişte/irsaliyede rakamı DÜŞMEK için değil, "bu belge sevk anına aittir, sonrasında
 * iade olmuş" dipnotunu bastırmak için. İptal edilen iade (`cancelledAt`) sayılmaz —
 * top sevkiyata geri döndüğü için zaten donmuş belgeyle tutarlıdır.
 */
async function summarizeShipmentReturns(
  db: PrintedDocDb,
  shipmentId: string,
): Promise<{ count: number; meters: number }> {
  const agg = await db.rollReturn.aggregate({
    where: { fromShipmentId: shipmentId, cancelledAt: null },
    _count: { _all: true },
    _sum: { qty: true },
  });
  return { count: agg._count._all, meters: Number(agg._sum.qty ?? 0) };
}

// =============================================================================
// RESMİ BELGE — Sevk İrsaliyesi snapshot builder'ı (PrintedDocument)
// =============================================================================
// Tek üretici: freeze (dispatch tx'i), reissue (revizyon), lazy-init. `collectShipmentDocContent`
// çuval içeriğinden (Sack→Roll) üretir — tahsis/allocation'a DOKUNMAZ.
//
// ⚠️ Bu fonksiyon CANLI okur; "sevk anı" garantisini veren şey donma (freeze) adımıdır.
// Muhasebe fişi (`getDispatchReport`) ile irsaliye BİREBİR aynı kalsın diye ikisi de
// donmuş SNAPSHOT'tan beslenir — buradan DEĞİL. Yeni bir "sevk içeriği" yüzeyi eklerken
// aynı kuralı uygula: sevk edilmiş bir sevkiyatın rakamını canlı sorgudan üretme.
//
// ⚠️⚠️ AMA "CANLI" ≠ "NET" (2026-08-05, kapatılan açık). Freeze tek koruma DEĞİLDİ:
// `reissue` ve lazy-init de bu üreticiyi çağırır ve onlar sevkten SONRA koşar. İade
// `Roll.sackId` + `shipmentId`'yi NULL'lar (`return.service.ts:322-325`) → o iki yol
// iadeden sonra NET bir "donmuş" resmi belge üretiyordu: aynı belge numarası, geçen ay
// 501 m, bugün 452 m. Sektör standardı bunun tersi: çıkış belgesi asla düzeltilmez,
// iade AYRI belgeyle kapanır. Bu yüzden içerik artık BRÜT kurulur — iptal edilmemiş
// `RollReturn` satırları geri eklenir.
//
// KAYNAK TERCİHİ snapshot DEĞİL `RollReturn`: `attachTotals`, `accounting-export` ve
// `getShipmentById` de aynı kaynağı seçti; dördüncü bir kaynak dördüncü bir rakam
// demekti (perf kuralı 13 ayrıca snapshot okumayı liste yüzeylerinde yasaklıyor).
//
// DİĞER ÇAĞIRANLARDA NO-OP: freeze sevk tx'inin İÇİNDE koşar (henüz iade yoktur) ve
// TASLAK önizleme PLANNED sevkiyat içindir — iade `roll.status=SHIPPED` istediği için
// orada `RollReturn` doğamaz, sorgu doğal olarak boş döner. Yani bu ekleme yalnız
// kırık olan iki yolu düzeltir, çalışanları AYNEN bırakır.
async function collectShipmentDocContent(
  db: PrintedDocDb,
  shipmentId: string,
  opts: { requireDispatched: boolean }
): Promise<ShipmentDispatchDoc | null> {
  const sh = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      shipmentNo: true, status: true, procedureCode: true, destination: true, dispatchedAt: true, createdAt: true,
      sackSeqPrefix: true,
      manualSackCount: true,
      plateNumber: true, driverName: true, carrier: true,
      // `customerId` + `orders.orderId` (2026-09-04) — "müşterideki ad" zinciri
      // müşteri×ürün master alias'ı ve sipariş satırı override'ını bu ikisiyle
      // çözer (bkz. `loadShipmentCustomerNames`).
      customerId: true,
      customer: { select: { code: true, name: true, taxNumber: true, exportCode: true } },
      branch: { select: { code: true, name: true } },
      ...DELIVERY_TO_SELECT,
      orders: { select: { orderId: true, order: { select: { orderNumber: true } } } },
      sacks: {
        // Çözülmüş (boşalmış) dökme/araba sayılmaz, listelenmez, belgeye girmez.
        where: LIVE_LOAD_UNIT_WHERE,
        orderBy: { seq: "asc" },
        // ⚠️ RESMİ BELGE — hayalet toplar DIŞLANIR (`SACK_ABSENT_STATUSES`; `SHIPPED`
        // SAYILIR). Bu filtre olmadan çuvalda kayıtlı ama fiziksel olarak binada
        // olmayan top (kartelaya/tambura/fasona gitmiş) irsaliyenin ÇUVAL METRAJINA,
        // ÜRÜN ÖZETİNE, ÇEKİ satırlarına ve TOPLAM METRAJA giriyordu — ve bu içerik
        // `freezeForSource` ile DONUYORDU (müşteriye/gümrüğe giden hukuken bağlayıcı
        // belge). Donmuş eski snapshot'lar etkilenmez (JSON olarak saklı); filtre
        // yalnız YENİ build'leri etkiler (taslak önizleme, lazy-init reconstruction,
        // reissue) — reissue'de düzeltilmiş çıkması İSTENEN davranıştır.
        // `batch` = çeki satırındaki Parti No. Çuval KARIŞIK içerikli olabildiği için
        // parti çuval değil TOP başına taşınır. Kolon opt-in (defaultHidden) — müşteri
        // belgesinin yerleşimi sormadan değişmesin.
        // `id` ŞART: iade satırları `RollReturn.prevSackId` ile bu id'ye eşlenir
        // (brütleştirme). Onsuz iade edilen top hangi çuvala döneceğini bilemez.
        // `itemId`/`colorId` (2026-09-04) — "müşterideki ad" zincirinin ANAHTARI.
        // İlişkinin `name`i yetmez: override `OrderLine`da, master alias
        // `CustomerItemAlias`ta ve ikisi de KİMLİKLE eşlenir (ada göre eşleme,
        // aynı adı taşıyan iki kartı sessizce birleştirirdi).
        // `qualityGradeId`/`qualityGrade` (2026-09-13) — "müşterideki ad" POLİTİKA
        // anahtarı (`QualityGrade.skipCustomerName`). İkisi birden: FK canlı topta
        // dolu, kod eski/iade satırlarında tek kalan olabilir.
        // `packageNo`/`packingGroup.name` (2026-09-21, sevk partisi) — belgeye yalnız
        // `shipping.docPackingLot` açıkken basılır; snapshot'a her zaman girer (donuk içerik).
        select: { id: true, seq: true, sackNo: true, unitKind: true, unitLabel: true, weightKg: true, packageNo: true, packingGroup: { select: { name: true, code: true } }, rolls: { where: { status: { notIn: SACK_ABSENT_STATUSES } }, orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, currentQty: true, width: true, itemId: true, colorId: true, qualityGradeId: true, qualityGrade: true, item: { select: { name: true } }, color: { select: { name: true } }, batch: { select: { batchNumber: true } } } } },
      },
    },
  });
  if (!sh) return null;
  if (opts.requireDispatched && sh.status !== ShipmentStatus.DISPATCHED) return null;

  // ── BRÜTLEŞTİRME: iade edilmiş topları çuvallarına geri ekle ───────────────
  // (Gerekçe fonksiyon başlığında. Freeze/taslak yollarında bu sorgu boş döner.)
  const returnRows = await db.rollReturn.findMany({
    where: { fromShipmentId: shipmentId, cancelledAt: null },
    select: {
      rollId: true,
      prevSackId: true,
      qty: true,
      width: true,
      // Kimlikler ŞART: brütleştirmeyle geri eklenen top da "müşterideki ad"
      // zincirinden geçer; yalnız `name` taşınırsa iade satırı belgede BİZİM
      // adımızla, kardeşleri müşterinin adıyla basılırdı.
      itemId: true,
      colorId: true,
      item: { select: { name: true } },
      color: { select: { name: true } },
      // Barkod + parti CANLI toptan okunur: iade ikisini de DEĞİŞTİRMEZ
      // (metraj/kalite değişebilir — onlar iade anındaki `prev*` alanlarından).
      // ⚠️ KALİTE de kimlikler kadar ŞART (2026-09-13): "müşterideki ad" politikası
      // kaliteye bakar; taşımazsak iade satırı politikayı ATLAR ve alt kalite mal
      // müşterinin adıyla basılır — FAIL-SAFE'in TERS yönü. İade ANINDAKİ kalite
      // doğru olandır (top sonradan yeniden derecelenmiş olabilir).
      prevQualityGradeId: true,
      prevQualityGrade: true,
      roll: { select: { barcode: true, batch: { select: { batchNumber: true } } } },
    },
  });

  // YARIŞ KORUMASI: `shipment.findUnique` ile bu findMany AYRI sorgulardır (tx yok).
  // Arada bir iade commit olursa aynı top HEM canlı `sk.rolls`'ta HEM iade satırı
  // olarak gelir → belge metrajı ŞİŞER. Canlı id kümesiyle dedup o pencereyi kapatır.
  // (`getShipmentById` ile birebir aynı koruma.)
  const liveRollIds = new Set<string>();
  for (const sk of sh.sacks) for (const r of sk.rolls) liveRollIds.add(r.id);

  const returnsBySack = new Map<string, (typeof sh.sacks)[number]["rolls"]>();
  for (const rr of returnRows) {
    if (liveRollIds.has(rr.rollId)) continue;
    // `prevSackId` yoksa (kolon 2026-06'da eklendi — eski iadeler) hangi çuvala
    // döneceği bilinmiyor; uydurmak yerine ATLANIR. Belge o kadarıyla eksik kalır
    // ama YANLIŞ çuvala yazmaktan iyidir.
    if (!rr.prevSackId) continue;
    const row = {
      id: rr.rollId,
      barcode: rr.roll.barcode,
      currentQty: rr.qty,
      width: rr.width,
      itemId: rr.itemId,
      colorId: rr.colorId,
      item: { name: rr.item?.name ?? "" },
      color: rr.color ? { name: rr.color.name } : null,
      qualityGradeId: rr.prevQualityGradeId,
      qualityGrade: rr.prevQualityGrade,
      batch: rr.roll.batch ? { batchNumber: rr.roll.batch.batchNumber } : null,
    } as unknown as (typeof sh.sacks)[number]["rolls"][number];
    const arr = returnsBySack.get(rr.prevSackId);
    if (arr) arr.push(row);
    else returnsBySack.set(rr.prevSackId, [row]);
  }

  // Not: `totalKg` DEĞİŞMEZ — iade `Sack.weightKg`'a dokunmaz, yani o rakam zaten
  // brüt. Geri-ekleme kg'yi çift sayardı.
  // TEK KAYNAK: çuval satırı, ürün özeti ve çeki satırları BU listeden türetilir.
  // İkisini ayrı ayrı toplamak (biri canlı, biri brüt) çift sayım üretirdi.
  const sacksGross = sh.sacks.map((sk) => ({
    ...sk,
    rolls: [...sk.rolls, ...(returnsBySack.get(sk.id) ?? [])],
  }));

  // ── MÜŞTERİDEKİ AD (2026-09-04) ────────────────────────────────────────────
  // Donmuş çekirdeğe GİRER (annotation DEĞİL): irsaliye hukuki kayıttır ve
  // "sevk anındaki ad" doğru olandır; master alias sonradan düzeltilirse eski
  // belge DEĞİŞMEMELİ. Bu yüzden ad snapshot'a YAZILIR, hangi adın basılacağı
  // (`shipping.docItemNameMode`) ise render anında CANLI okunur — içerik donuk,
  // sunum canlı (refakat kartının 2026-08-06 kuralıyla aynı ayrım).
  //
  // ⚠️ Sevkten SONRA da koşar (reissue / lazy-init) — 2026-08-05 dersi. Zincir
  // o yollarda da doğrudur: override sipariş satırında kalıcıdır, master alias
  // canlı okunur (o gün geçerli olan ad reissue'de basılır; reissue zaten
  // "bugünkü doğruyu yeniden dondur" demektir).
  const customerNames = await loadShipmentCustomerNames(db, {
    customerId: sh.customerId,
    sackIds: sh.sacks.map((s) => s.id),
    orderIds: sh.orders.map((o) => o.orderId),
    itemIds: sacksGross.flatMap((sk) => sk.rolls.map((r) => r.itemId)),
    colorIds: sacksGross.flatMap((sk) => sk.rolls.map((r) => r.colorId ?? "")),
  });
  // MÜŞTERİ ADI POLİTİKASI (2026-09-13) — `QualityGrade.skipCustomerName`.
  // Karar SATIR düzeyindedir: sütunu `resolveDocNameMode` açar/kapatır, bu politika
  // yalnız o satırın HÜCRESİNİ boşaltır (bkz. schema notu).
  const namePolicy = await loadCustomerNamePolicy(db);
  // ⚠️ TİP, GERÇEKTEN YAZILAN ALANLARI SAYAR: `customerItemOnly`/`customerColorOnly`
  // aşağıda kuruluyordu ama bu tipte YOKTU (birleşim genişlemesi sayesinde derleyici
  // susuyordu) ve `products` eşlemesi onları zaten düşürüyor. Tipe alındılar ki
  // "yazılıyor ama çıktıya gitmiyor" görünür olsun — davranış DEĞİŞMEDİ.
  const productMap = new Map<
    string,
    {
      name: string;
      customerName: string | null;
      customerItemOnly: string | null;
      customerColorOnly: string | null;
      skipsCustomerName: boolean;
      rollCount: number;
      totalMeters: Prisma.Decimal;
    }
  >();
  const sackRows = sacksGross.map((sk) => {
    let sackMeters = D0();
    for (const r of sk.rolls) {
      sackMeters = sackMeters.plus(r.currentQty);
      const widthStr = r.width != null ? `${Number(r.width)}cm.` : "";
      const stokAdi = [r.item.name, r.color?.name ?? "", widthStr].filter(Boolean).join(" ");
      // GRUPLAMA ANAHTARI BİZİM ADIMIZDIR ve öyle KALIR: müşteri adına göre
      // gruplasaydık iki farklı ürün aynı alias altında birleşir, adet/metraj
      // sessizce toplanırdı. Müşteri adı gruba TAŞINIR, grubu belirlemez.
      // ⚠️ FAIL-SAFE: işaretli kalitede müşteri adı HİÇ çözülmez. Çözüp sonra
      // gizlemek, karışık satırda ilk topun adının gruba yapışmasına açık kapı
      // bırakırdı (grup `customerName`ini İLK top kurar).
      const rollSkips = namePolicy.skips(r.qualityGradeId, r.qualityGrade);
      const ci = rollSkips ? null : customerNames.itemName(r.itemId, r.colorId);
      const cc = rollSkips ? null : customerNames.colorName(r.itemId, r.colorId);
      const custName =
        ci || cc
          ? [ci ?? r.item.name, cc ?? r.color?.name ?? "", widthStr].filter(Boolean).join(" ")
          : null;
      // AYRIŞTIRILMIŞ İKİZLER (2026-09-06) — `shipping.docProductColorSplit` açıkken
      // renderer bunları KULLANIR, kapalıyken birleşik `customerName`i basar.
      // ⚠️ Birleşik dize AYNEN kalıyor: bayrak kapalıyken çıktı bayt-bayt aynı olsun
      // ve donmuş eski belgeler yeni alan olmadan da doğru basılabilsin.
      const custItemOnly = ci || cc ? [ci ?? r.item.name, widthStr].filter(Boolean).join(" ") : null;
      // ⚠️ FALLBACK YOK ve bu BİLİNÇLİ (kullanıcı düzeltmesi 2026-09-06):
      // "çoğu müşteri bizim renk adımızı kullanır." Yani renk karşılığının olmaması
      // eksik veri DEĞİL, normal hâldir. Ayrık kipte bizim adımızı "MÜŞTERİ VARYANT"
      // başlığı altında basmak onu müşterinin adıymış gibi gösterirdi — yanlış
      // etiketleme. Karşılığı olmayan satırda sütun BOŞ kalır.
      const custColorOnly = cc ?? null;
      const g =
        productMap.get(stokAdi) ??
        {
          name: stokAdi,
          customerName: custName,
          customerItemOnly: custItemOnly,
          customerColorOnly: custColorOnly,
          skipsCustomerName: false,
          rollCount: 0,
          totalMeters: D0(),
        };
      // ⚠️ KARIŞIK SATIRIN KURALI: grubun müşteri adını İLK top kurar, ama işaret
      // TÜM toplara sorulur ve OR'lanır. Tek bir işaretli top satırı bizim adımıza
      // düşürür — "en az bir alt kalite varsa müşterinin adını iliştirme".
      if (rollSkips) g.skipsCustomerName = true;
      g.rollCount += 1;
      g.totalMeters = g.totalMeters.plus(r.currentQty);
      productMap.set(stokAdi, g);
    }
    return {
      code: sk.sackNo ?? `#${sk.seq}`, seq: sk.seq ?? 0, totalMeters: Number(sackMeters), totalKg: sk.weightKg != null ? Number(sk.weightKg) : 0, packageCount: sk.rolls.length,
      packageNo: sk.packageNo ?? null, packingGroupName: sk.packingGroup?.name ?? null,
      // ⚠️ KOD DOĞUŞTA MATERYALİZE (İ1): belgeye basılan dizgi `PackingGroup.code`
      // kolonunun kendisidir, render'da kurulmaz — ekran da aynı kolonu okur.
      packingGroupCode: sk.packingGroup?.code ?? null,
      // Çuvalsız sevk: anahtar YALNIZ dökme/arabada — çuvallı belgenin snapshot'ı bayt-aynı kalır.
      ...loadUnitDocFields(sk),
    };
  });

  // ⚠️ ÇEKİ SATIRI TOP BAŞINADIR — orada karışıklık sorusu YOKTUR, politika
  // doğrudan o topun kalitesine sorulur. (Ürün özetindeki OR'lama yalnız GRUP
  // satırı için gerekliydi.)
  // Açık hata notu (KQ-D8): yalnız hatası olan topun satırına alan girer — hatasız
  // belgede snapshot bayt-aynı kalır; kolon opt-in (`defaultHidden`), sevk rakamına dokunmaz.
  const defectNotes = await loadOpenDefectNotes(sacksGross.flatMap((sk) => sk.rolls.map((r) => r.id)));
  // Müşteri barkodu (D4-F3): yalnız kodlu topun satırına alan girer — snapshot sevkte DONAR, kodsuz belge bayt-aynı.
  const customerCodes = await loadActiveCustomerCodes(sacksGross.flatMap((sk) => sk.rolls.map((r) => r.id)), db);
  const cekiRows = sacksGross.flatMap((sk) =>
    sk.rolls.map((r, idx) => {
      const skips = namePolicy.skips(r.qualityGradeId, r.qualityGrade);
      return { rollId: r.id, sackCode: loadUnitCekiCode(sk) ?? sk.sackNo ?? `#${sk.seq}`, seq: sk.seq ?? null, packageNo: sk.packageNo ?? null, packingGroupName: sk.packingGroup?.name ?? null, packingGroupCode: sk.packingGroup?.code ?? null, barcode: r.barcode, desen: r.item.name, varyant: r.color?.name ?? "", customerDesen: skips ? null : customerNames.itemName(r.itemId, r.colorId), customerVaryant: skips ? null : customerNames.colorName(r.itemId, r.colorId), width: r.width != null ? Number(r.width) : null, meters: Number(r.currentQty), kg: idx === 0 && sk.weightKg != null ? Number(sk.weightKg) : 0, batchNumber: r.batch?.batchNumber ?? null, ...(defectNotes.has(r.id) ? { defectNote: defectNotes.get(r.id) } : {}), ...(customerCodes.has(r.id) ? { customerCode: customerCodes.get(r.id) } : {}) };
    })
  );

  // ⚠️ AYRIK KİP İKİZLERİ SNAPSHOT'A GİRER (2026-09-13 düzeltmesi): bu iki alan
  // yukarıda KURULUYOR ama eşleme onları DÜŞÜRÜYORDU ⇒ `docProductColorSplit`
  // açıldığında "MÜŞTERİ VARYANT" sütunu çiziliyor, hücresi HEP BOŞ kalıyor ve
  // "MÜŞTERİ STOK ADI" birleşik adı basmaya devam ediyordu — yani bayrağın var
  // oluş gerekçesi ("yarı çevrilmiş ad basılmasın") sağlanmıyordu.
  // Fail-safe aynen uygulanır: işaretli kalite satırında ikizler de düşer.
  const products = [...productMap.values()].map((p) => ({ name: p.name, customerName: p.skipsCustomerName ? null : p.customerName, customerItemOnly: p.skipsCustomerName ? null : p.customerItemOnly, customerColorOnly: p.skipsCustomerName ? null : p.customerColorOnly, rollCount: p.rollCount, totalMeters: Number(p.totalMeters) }));
  const totalRolls = products.reduce((s, p) => s + p.rollCount, 0);
  const totalMeters = Number(sackRows.reduce((s, r) => s.plus(r.totalMeters), D0()));
  const totalKg = Number(sackRows.reduce((s, r) => s.plus(r.totalKg), D0()));
  const orderNos = [...new Set(sh.orders.map((o) => o.order.orderNumber))].join(", ");
  // Teslim yeri (K18) DOĞARKEN donar; yoksa anahtar HİÇ yazılmaz (snapshot bayt bayt bugünkü).
  const deliveryTo = deliveryToSnapshot(sh);

  return {
    // branchCode = şube ihracat kodu; customerExportCode = şirket ihracat kodu.
    // Belgede TEK "İhracat Kodu" satırı basılır: `exportCode` DOĞUŞTA çözülür (yalnız
    // yurtdışında dolu; yurtiçi snapshot'a kod girmez) — "exportCode" toggle'ıyla açılıp kapanır.
    header: { shipmentNo: sh.shipmentNo, customerName: sh.customer.name, customerCode: sh.customer.code, customerTaxNumber: sh.customer.taxNumber ?? null, branchName: sh.branch?.name ?? null, branchCode: sh.branch?.code ?? null, customerExportCode: sh.customer.exportCode ?? null, exportCode: exportCodeForDestination(sh.destination, { branchCode: sh.branch?.code, customerExportCode: sh.customer.exportCode }), procedureCode: sh.procedureCode, destination: sh.destination, status: sh.status, date: (sh.dispatchedAt ?? sh.createdAt).toISOString(), plateNumber: sh.plateNumber, driverName: sh.driverName, carrier: sh.carrier, orderNos, ...(deliveryTo ? { deliveryTo } : {}) },
    products,
    sacks: sackRows,
    cekiRows,
    // Sevk anındaki sıra ön eki DONAR (2026-09-22): `shipping.sackSeqPrefixLive` kapalıyken
    // baskı bunu kullanır — ön ek sonradan değişse de eski belge değişmez.
    sackSeqPrefix: sh.sackSeqPrefix ?? "",
    totals: {
      totalRolls,
      totalMeters,
      totalKg,
      // `sackCount` SİSTEMİN saydığı kayıt adedi — sözleşme değişmedi.
      sackCount: sh.sacks.length,
      // `manualSackCount` operatörün beyan ettiği FİZİKSEL adet. Belge ikisini
      // birlikte basar (biri diğerinin yerine geçmez): sahada 10 çuval tek çuval
      // kaydına yazıldığı için ikisi meşru olarak farklıdır ve fark BİLGİDİR.
      // null = beyan yok → belgede yalnız sistemin rakamı çıkar.
      manualSackCount: sh.manualSackCount,
    },
  };
}

/**
 * Muhasebe fişi + sevk top listesi (D4-J6) içerik kaynağı — TEK yol: donmuş snapshot, yoksa
 * canlı toplayıcı. Sevk içeriğini okuyan yeni yüzey buradan beslenir (ikinci toplayıcı yasak,
 * `test_sevk_top_listesi` AST ile ölçer).
 */
export async function resolveShipmentDispatchContent(
  shipmentId: string
): Promise<{ content: ShipmentDispatchDoc; doc: { status: string; version: number } | null }> {
  const doc = (
    await printedDocumentService.getCurrent(PrintedDocType.SHIPMENT_DISPATCH, shipmentId)
  ).data as { snapshot: { doc: unknown }; status: string; version: number } | null;
  const content = doc
    ? (doc.snapshot.doc as ShipmentDispatchDoc)
    : await collectShipmentDocContent(prisma, shipmentId, { requireDispatched: false });
  if (!content) throw AppError.notFound("Sevkiyat bulunamadı");
  return { content, doc };
}

/** Freeze / reissue / lazy-init — yalnız DISPATCHED sevkiyat belgelenir. */
async function buildShipmentDispatchDoc(db: PrintedDocDb, shipmentId: string): Promise<BuiltDocContent | null> {
  const content = await collectShipmentDocContent(db, shipmentId, { requireDispatched: true });
  if (!content) return null;
  return { documentNo: content.header.shipmentNo, doc: content as unknown as Record<string, unknown> };
}

/** Canlı önizleme (TASLAK) — sevk öncesi içerik üretir. */
async function buildShipmentDispatchPreview(db: PrintedDocDb, shipmentId: string): Promise<BuiltDocContent | null> {
  const content = await collectShipmentDocContent(db, shipmentId, { requireDispatched: false });
  if (!content) return null;
  return { documentNo: content.header.shipmentNo, doc: content as unknown as Record<string, unknown> };
}

registerPrintedDocBuilder(PrintedDocType.SHIPMENT_DISPATCH, {
  fresh: buildShipmentDispatchDoc,
  renderHtml: renderShipmentDispatchHtml,
  // Excel'in tabloları — irsaliyeyi çizen AYNI kolon çözücüsünden (PDF ↔ Excel eşit).
  renderTables: renderShipmentDispatchTables,
  buildPreview: buildShipmentDispatchPreview,
  // Belge şablon profili: sevkiyatın müşterisine atanmış profil (yoksa genel ayar).
  resolveProfileId: async (db, sourceId) => {
    const s = await db.shipment.findUnique({
      where: { id: sourceId },
      select: { customer: { select: { documentProfileId: true } } },
    });
    return s?.customer?.documentProfileId ?? null;
  },
  // İrsaliye açıklaması — sevkiyata kayıtlı serbest not (annotation). Donmuş belgeye
  // girmez; her baskıda canlı çözülür, düzenlenince tekrar baskıda güncel çıkar.
  resolveLiveNote: async (db, sourceId) => {
    const s = await db.shipment.findUnique({
      where: { id: sourceId },
      select: { dispatchNote: true },
    });
    return s?.dispatchNote ?? null;
  },
  // Çuval yorumları — irsaliye ÇUVAL LİSTESİ'ndeki opsiyonel "AÇIKLAMA" kolonunu besler.
  // Annotation: donmuş çekirdeğe (collectShipmentDocContent) GİRMEZ → sevkten sonra
  // yazılan yorum da basılır, sürüm doğmaz, eski snapshot'lar etkilenmez. Anahtar
  // `sackNo`, çünkü snapshot satırındaki `code` alanı da sackNo'dur.
  resolveLiveRowNotes: async (db, sourceId) => {
    const rows = await db.sack.findMany({
      where: { shipmentId: sourceId, notes: { not: null } },
      select: { sackNo: true, notes: true },
    });
    const out: Record<string, string> = {};
    for (const r of rows) if (r.notes) out[r.sackNo] = r.notes;
    return out;
  },
  // Çuval İZLERİ (etiket) — irsaliye ÇUVAL LİSTESİ'ndeki opsiyonel "İZ" kolonunu
  // besler. Yorum kolonunun KARDEŞİ, ama AYRI kanal: iz ile yorum farklı
  // hassasiyette veridir ve tek anahtar "notu bas" diyene sessizce izi de
  // bastırırdı.
  //
  // ⚠️ Annotation: donmuş çekirdeğe (`collectShipmentDocContent`) GİRMEZ.
  // Girseydi (a) etiketleme sonrası reissue yeni belge sürümü doğururdu,
  // (b) DISPATCH'teki iz temizliği (`clearedAt`) snapshot ile canlı listeyi
  // KALICI çelişkiye sokardı — üretici sevkten SONRA da koşuyor (2026-08-05).
  //
  // ⚠️ `ACTIVE_TAG_WHERE` TEK KAYNAK: rozet/filtre/belge ayrışmasın. Sevk ANINDA
  // izler temizlendiği için DISPATCHED bir sevkiyatın çuvallarında bu sorgu
  // normalde BOŞ döner ve kolon hiç basılmaz — dolu döndüğü tek meşru hal,
  // sevkten SONRA yeni iz bırakılmış olmasıdır (bu da serbest).
  resolveLiveRowTags: async (db, sourceId) => {
    const rows = await db.sack.findMany({
      where: { shipmentId: sourceId },
      select: {
        sackNo: true,
        tags: {
          where: ACTIVE_TAG_WHERE,
          select: { tag: { select: { name: true, sortOrder: true } } },
          orderBy: [{ tag: { sortOrder: "asc" } }, { tag: { name: "asc" } }],
        },
      },
    });
    const out: Record<string, string> = {};
    for (const r of rows) {
      const names = r.tags.map((t) => t.tag.name).filter(Boolean);
      if (names.length) out[r.sackNo] = names.join(", ");
    }
    return out;
  },
});

// =============================================================================
// SEVKİYAT-TÜREVLİ BELGELER — Kalite Sertifikası / Packing List / Commercial Invoice
// =============================================================================
// Aynı Shipment kaynağının farklı görünümleri (sourceId = Shipment.id, her belge
// tipi kendi zinciri). Tek genişletilmiş collector: kalite, ambalaj ve fiyat verisi
// bir sorguda. Fatura fiyatı çuval→SackAllocation→OrderLine.unitPrice'tan türetilir.
async function collectShipmentDerived(db: PrintedDocDb, shipmentId: string) {
  const sh = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      shipmentNo: true, status: true, destination: true, dispatchedAt: true, createdAt: true, procedureCode: true,
      customer: { select: { code: true, name: true, taxNumber: true, exportCode: true, address: true, city: true, country: true } },
      orders: { select: { order: { select: { orderNumber: true } } } },
      sacks: {
        // Çözülmüş (boşalmış) dökme/araba sayılmaz, listelenmez, belgeye girmez.
        where: LIVE_LOAD_UNIT_WHERE,
        orderBy: { seq: "asc" },
        select: {
          seq: true, sackNo: true, weightKg: true,
          // ⚠️ RESMİ BELGE (kalite sertifikası + muhasebe fişi) — irsaliye ile BİREBİR
          // aynı veriden türemesi zorunlu, dolayısıyla aynı hayalet filtresi.
          rolls: { where: { status: { notIn: SACK_ABSENT_STATUSES } }, orderBy: { createdAt: "asc" }, select: { barcode: true, currentQty: true, width: true, qualityGrade: true, item: { select: { name: true } }, color: { select: { name: true } }, qualityGradeRef: { select: { name: true } } } },
          // ⚠️ Para birimi SİPARİŞ BAŞLIĞINDA yaşar (`Order.currency`), satırda DEĞİL.
          // `orderLine.currency` seçmek PrismaClientValidationError üretir ve bu hata
          // DB'ye hiç gitmeden, sorgu kurulurken atılır → belge her çağrıda patlar.
          // tsc bunu GÖREMEZ: `PrintedDocDb` bir union tipidir ve union üzerinden çağrı
          // fazla-alan (excess property) kontrolünü düşürür.
          allocations: { where: ACTIVE_SACK_ALLOCATION, select: { qty: true, orderLine: { select: { unitPrice: true, customerItemName: true, item: { select: { name: true } }, color: { select: { name: true } }, order: { select: { currency: true } } } } } },
        },
      },
    },
  });
  if (!sh) return null;

  const date = (sh.dispatchedAt ?? sh.createdAt).toISOString();
  const orderNos = [...new Set(sh.orders.map((o) => o.order.orderNumber))].join(", ");
  const addr = [sh.customer.address, sh.customer.city, sh.customer.country].filter(Boolean).join(", ") || null;

  // ── Kalite: kalite başına adet/metraj + top dökümü ──
  const gradeMap = new Map<string, { grade: string; rollCount: number; totalMeters: Prisma.Decimal }>();
  const qualityRolls: { sequence: number; barcode: string | null; itemName: string; colorName: string | null; width: number | null; grade: string; meters: number }[] = [];
  let seq = 0;
  for (const sk of sh.sacks) {
    for (const r of sk.rolls) {
      const grade = r.qualityGradeRef?.name ?? r.qualityGrade ?? "Belirsiz";
      const g = gradeMap.get(grade) ?? { grade, rollCount: 0, totalMeters: D0() };
      g.rollCount += 1;
      g.totalMeters = g.totalMeters.plus(r.currentQty);
      gradeMap.set(grade, g);
      qualityRolls.push({ sequence: ++seq, barcode: r.barcode, itemName: r.item.name, colorName: r.color?.name ?? null, width: r.width != null ? Number(r.width) : null, grade, meters: Number(r.currentQty) });
    }
  }
  const grades = [...gradeMap.values()].map((g) => ({ grade: g.grade, rollCount: g.rollCount, totalMeters: Number(g.totalMeters) }));
  const totalRolls = qualityRolls.length;
  const totalMeters = Number(qualityRolls.reduce((s, r) => s.plus(r.meters), D0()));

  // ── Ambalaj (packing): çuval bazlı ── (width = çuvaldaki farklı enler, cm)
  const packages = sh.sacks.map((sk) => {
    const contents = [...new Set(sk.rolls.map((r) => `${r.item.name}${r.color?.name ? ` ${r.color.name}` : ""}`))].join(", ");
    const meters = Number(sk.rolls.reduce((s, r) => s.plus(r.currentQty), D0()));
    const widths = [...new Set(sk.rolls.map((r) => (r.width != null ? Math.round(Number(r.width)) : null)).filter((w): w is number => w != null))]
      .sort((a, b) => a - b)
      .join(" / ");
    return { no: sk.sackNo ?? `#${sk.seq}`, contents, width: widths, meters, netKg: sk.weightKg != null ? Number(sk.weightKg) : 0, rollCount: sk.rolls.length };
  });
  const totalNetKg = Number(sh.sacks.reduce((s, sk) => s.plus(sk.weightKg ?? 0), D0()));

  // ── Fatura: allocation → orderLine fiyatı; (açıklama|fiyat|para) bazında grupla ──
  const invMap = new Map<string, { description: string; qty: Prisma.Decimal; unit: string; unitPrice: number | null; currency: string; amount: Prisma.Decimal | null }>();
  let anyPrice = false;
  let currency = "TRY";
  for (const sk of sh.sacks) {
    for (const al of sk.allocations) {
      const ol = al.orderLine;
      const desc = ol.customerItemName?.trim() || `${ol.item.name}${ol.color?.name ? ` · ${ol.color.name}` : ""}`;
      const up = ol.unitPrice != null ? Number(ol.unitPrice) : null;
      if (up != null) anyPrice = true;
      const lineCurrency = ol.order.currency;
      currency = lineCurrency;
      const key = `${desc}|${up ?? ""}|${lineCurrency}`;
      const row = invMap.get(key) ?? { description: desc, qty: D0(), unit: "m", unitPrice: up, currency: lineCurrency, amount: up != null ? D0() : null };
      row.qty = row.qty.plus(al.qty);
      if (up != null && row.amount != null) row.amount = row.amount.plus(new Prisma.Decimal(al.qty).times(up));
      invMap.set(key, row);
    }
  }
  const invoiceLines = [...invMap.values()].map((r) => ({ description: r.description, qty: Number(r.qty), unit: r.unit, unitPrice: r.unitPrice, amount: r.amount != null ? Number(r.amount) : null }));
  const curTotals = new Map<string, Prisma.Decimal>();
  for (const r of invMap.values()) {
    if (r.amount != null) curTotals.set(r.currency, (curTotals.get(r.currency) ?? D0()).plus(r.amount));
  }
  const invoiceTotals = [...curTotals.entries()].map(([currency, amount]) => ({ currency, amount: Number(amount) }));

  const header = { shipmentNo: sh.shipmentNo, customerName: sh.customer.name, customerCode: sh.customer.code, customerTaxNumber: sh.customer.taxNumber ?? null, customerAddress: addr, date, orderNos, procedureCode: sh.procedureCode };
  return { header, destination: sh.destination, grades, qualityRolls, packages, invoiceLines, invoiceTotals, currency, hasPrices: anyPrice, totals: { totalRolls, totalMeters, totalNetKg } };
}

async function buildQualityCertificateDoc(db: PrintedDocDb, shipmentId: string): Promise<BuiltDocContent | null> {
  const c = await collectShipmentDerived(db, shipmentId);
  if (!c) return null;
  const doc: QualityCertificateDoc = {
    header: { shipmentNo: c.header.shipmentNo, customerName: c.header.customerName, customerCode: c.header.customerCode, date: c.header.date, orderNos: c.header.orderNos },
    grades: c.grades,
    rolls: c.qualityRolls,
    totals: { rollCount: c.totals.totalRolls, totalMeters: c.totals.totalMeters },
  };
  return { documentNo: c.header.shipmentNo, doc: doc as unknown as Record<string, unknown> };
}

// Sevkiyat-türevli belgelerin ortak profil çözücüsü (müşteri profili).
const resolveShipmentProfileId = async (db: PrintedDocDb, sourceId: string) => {
  const s = await db.shipment.findUnique({ where: { id: sourceId }, select: { customer: { select: { documentProfileId: true } } } });
  return s?.customer?.documentProfileId ?? null;
};

registerPrintedDocBuilder(PrintedDocType.QUALITY_CERTIFICATE, { fresh: buildQualityCertificateDoc, renderHtml: renderQualityCertificateHtml, resolveProfileId: resolveShipmentProfileId });

export async function getDispatchReport(shipmentId: string): Promise<ApiResponse<unknown>> {
    const { content, doc } = await resolveShipmentDispatchContent(shipmentId);

    return {
      success: true,
      data: {
        ...content,
        frozen: Boolean(doc),
        docStatus: doc?.status ?? null,
        docVersion: doc?.version ?? null,
        returns: await summarizeShipmentReturns(prisma, shipmentId),
        // ⚠️ AD REJİMİ FİŞE DE GİDER (2026-09-10 saha bulgusu). Snapshot iki adı
        // da taşıyor (`name` ↔ `customerName`); HANGİSİNİN basılacağı ayardan
        // gelir ve baskı anında CANLI okunur. Bu alan olmadan muhasebe fişinin
        // Excel'i kararı hiç sormuyor, hep bizim adımızı basıyordu — oysa ayarın
        // kendi açıklaması "kapsam sevk irsaliyesi + MUHASEBE FİŞİDİR" diyor.
        // Karar `resolveDocNameMode`de, yani irsaliyeyi çizen helper'ın AYNISINDA.
        docNameMode: resolveDocNameMode({
          itemNameMode: await readShippingDocItemNameMode(),
          cekiNameMode: await readShippingDocCekiNameMode(),
          productColorSplit: await readShippingDocProductColorSplit(),
        }) satisfies DocNameMode,
      },
    };
  }

export async function getDirectShipmentDispatchReport(id: string): Promise<ApiResponse<unknown>> {
    const ds = await prisma.directShipment.findUnique({
      where: { id },
      select: {
        shipmentNo: true,
        shippedAt: true,
        createdAt: true,
        customer: { select: { code: true, name: true, taxNumber: true, exportCode: true } },
        branch: { select: { code: true, name: true } },
        allocations: { select: { orderLine: { select: { order: { select: { orderNumber: true } } } } } },
        rolls: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            width: true,
            item: { select: { name: true } },
            color: { select: { name: true } },
            // collectShipmentDocContent ile AYNI şekil — yalnız birini güncellemek
            // iki belgeyi ayrıştırır (bu metodun tek varlık sebebi şekil birliği).
            batch: { select: { batchNumber: true } },
          },
        },
      },
    });
    if (!ds) throw AppError.notFound("Fasondan sevk kaydı bulunamadı");

    const productMap = new Map<string, { name: string; rollCount: number; totalMeters: Prisma.Decimal }>();
    let totalMeters = D0();
    const cekiRows = ds.rolls.map((r) => {
      totalMeters = totalMeters.plus(r.currentQty);
      const widthStr = r.width != null ? `${Number(r.width)}cm.` : "";
      const stokAdi = [r.item.name, r.color?.name ?? "", widthStr].filter(Boolean).join(" ");
      const g = productMap.get(stokAdi) ?? { name: stokAdi, rollCount: 0, totalMeters: D0() };
      g.rollCount += 1;
      g.totalMeters = g.totalMeters.plus(r.currentQty);
      productMap.set(stokAdi, g);
      // Çuval yok → sackCode "—", kg top-başına taşınmaz (0).
      return { rollId: r.id, sackCode: "—", barcode: r.barcode, desen: r.item.name, varyant: r.color?.name ?? "", meters: Number(r.currentQty), kg: 0, batchNumber: r.batch?.batchNumber ?? null };
    });
    const products = [...productMap.values()].map((p) => ({ name: p.name, rollCount: p.rollCount, totalMeters: Number(p.totalMeters) }));
    const orderNos = [...new Set(ds.allocations.map((a) => a.orderLine.order.orderNumber))].join(", ");

    return {
      success: true,
      data: {
        header: {
          shipmentNo: ds.shipmentNo,
          customerName: ds.customer.name,
          customerCode: ds.customer.code,
          customerTaxNumber: ds.customer.taxNumber ?? null,
          branchName: ds.branch?.name ?? null,
          branchCode: ds.branch?.code ?? null,
          // Şirket ihracat kodu — tek "İhracat Kodu" satırına şube ihracat kodu
          // (branchCode) boşsa yedek olarak basılır (branchCode ?? customerExportCode).
          customerExportCode: ds.customer.exportCode ?? null,
          procedureCode: null,
          destination: ShipmentDestination.DOMESTIC,
          status: ShipmentStatus.DISPATCHED,
          date: ds.shippedAt.toISOString(),
          plateNumber: null,
          driverName: null,
          carrier: null,
          orderNos,
        },
        products,
        sacks: [],
        cekiRows,
        totals: { totalRolls: ds.rolls.length, totalMeters: Number(totalMeters), totalKg: 0, sackCount: 0 },
        // ⚠️ AD REJİMİ BURADA SABİT "bizdeki" (2026-09-10). Fasondan DOĞRUDAN sevk
        // ayarın kapsamı DIŞINDADIR — ayarın kendi açıklaması bunu söylüyor
        // ("fasondan DOĞRUDAN sevk irsaliyesi bu ayarın dışındadır") ve bu uç
        // zaten müşteri adı alanlarını hiç kurmuyor (`desen: r.item.name`).
        // Alanı BOŞ bırakmak yerine ADIYLA sabitlemek, Excel'in "rejim yok →
        // ne yapayım" diye tahmin etmesini engeller.
        docNameMode: resolveDocNameMode({ itemNameMode: "bizdeki" }) satisfies DocNameMode,
        // Çuval sevkiyatı fişiyle AYNI kontrat — istemci tek `DispatchReport` tipiyle
        // çalışır ve alan eksik gelirse Excel dipnotu `returns.count` okurken PATLAR.
        //
        // `frozen: true` burada "snapshot'tan okundu" demek DEĞİL (yukarısı canlı
        // sorgu); "bu rakam sevk anının değişmez kaydıdır" demek — doğrudan sevkte
        // iki yol da kapalı olduğu için geçerli: (1) iade YOLU YOK, `RollReturn.
        // fromShipmentId` Shipment'a bakar, DirectShipment'a değil; (2) sevk edilmiş
        // topun metrajı düzeltilemez (`ALWAYS_BLOCKED` — sevkteki top). Bu iki
        // koşuldan biri değişirse (ör. fason sevkine iade eklenirse) burası gerçek
        // özet döndürmeli, yoksa fiş sessizce geriye dönük değişmeye başlar.
        frozen: true,
        docStatus: PrintedDocStatus.ACTIVE,
        docVersion: 1,
        returns: { count: 0, meters: 0 },
      },
    };
  }
