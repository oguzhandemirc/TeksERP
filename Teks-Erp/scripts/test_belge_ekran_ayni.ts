// =============================================================================
// Bekçi: BELGE ↔ EKRAN AYNI NUMARAYI GÖSTERİR (2026-09-22) — DB gerekir
// =============================================================================
// Kullanıcı değişmezi: "belge-çıktı-programdaki veriler birbiriyle aynı olmalı;
// programda p-2 yazarken çıktı p20260202 görmemeliyiz — bu büyük hataya sebep olur."
//
// Ölçüm gerçek yoldan yapılır: fixture çuval + sevkiyat kurulur, sevk edilir
// (belge DONAR), sonra İKİ yüzey okunur ve KARŞILAŞTIRILIR:
//   • EKRAN  → `getShipmentById` + `getShipmentSackContents` (panelin okuduğu uçlar)
//   • BELGE  → `printedDocumentService.getHtml` (kâğıda basılan HTML)
//
//   §1 Sevkiyat no · çuval no · sevkiyat içi sıra etiketi ÜÇÜ DE belgede birebir geçer
//   §2 ⭐ ÖN EK DEĞİŞİNCE ESKİ BELGE DEĞİŞMEZ (donmuş `Shipment.sackSeqPrefix`) ve
//      ekran da eski ön eki gösterir — iki yüzey BİRLİKTE donar, biri ötekinden kaymaz
//   §3 ⭐ Yeni sevkiyat yeni ön eki alır; ekran ve belge yine AYNI
//   §4 ⭐ "eski belgeler de değişsin" bayrağı açıkken İKİSİ BİRDEN canlıya döner
//      (bayrağın anlamı "belge değişir, ekran eski kalır" DEĞİLDİR)
//   §5 ⭐ SEVK PARTİSİ ADI (P-1) ve AMBALAJ NO ekranda ne ise belgede de o
//   §6 ⭐ İADE BELGE NO — ÇOK KALEMLİ iadede (3 top) ÜÇ SATIRIN ÜÇÜ DE aynı
//      numarayı taşır ve o numara belgede BİREBİR geçer. Tek kalemli bir iade
//      bu davranışı ÖLÇEMEZ: kopya semantiği ancak üye satır varken görünür.
//
// ⭐ §6 negatif sonda ✓B2 (2026-09-22, ölçüldü): numara yalnız LİDERE yazılınca
//    §6 ❌3 (üye satırların `returnNo`su null) · belge numarayı kolondan değil
//    `returnDocumentNo(...)` TÜRETİMİNDEN okuyunca §6 ❌1 — ekran sayaçlı
//    `IADE-220926-000001` gösterirken belge `id`den türemiş hex kuyruk gösteriyor,
//    yani kullanıcının şikâyetinin ta kendisi ("programda başka, çıktıda başka") ·
//    `seriesImpactCount`tan BELGE ÇAPASI yüklemi kalkınca §6 ❌1 (3 satır → "3
//    belge"; etki cümlesi "1.314 iade" der, oysa 438 belge vardır).
// ⭐ Negatif sonda (2026-09-22, ölçüldü): `getShipmentById`in `seqLabel` üretimi
//    `readSackSeqFormat(sh.sackSeqPrefix)` yerine `readSackSeqFormat(null)` yapılınca
//    §2 KIRMIZI (ekran "3", belge "SP3"); `collectShipmentDocContent`ten
//    `sackSeqPrefix` alanı silinince §1/§2 KIRMIZI.
// Çalıştır: npx tsx scripts/run-all-tests.ts belge_ekran_ayni
// =============================================================================
import { PrintedDocType, Prisma } from "@prisma/client";

import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { returnService } from "../src/services/return.service";
import { invoiceService } from "../src/services/invoice.service";
import { seriesImpactCount } from "../src/services/helpers/series-panel.helper";
import { PackingGroupService } from "../src/services/packing-group.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { firstGrade } from "./fixture-quality-grade";
import { ensureTestAdmin } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

const ship = new ShippingService();
const TS = Date.now();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const prevFlags = new Map<string, Prisma.InputJsonValue | undefined>();
async function setFlag(key: string, value: Prisma.InputJsonValue): Promise<void> {
  if (!prevFlags.has(key)) {
    const cur = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    prevFlags.set(key, cur ? (cur.value as Prisma.InputJsonValue) : undefined);
  }
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value, description: "test_belge_ekran_ayni" },
    update: { value },
  });
}

const sackIds: string[] = [];
const returnIds: string[] = [];
const invoiceIds: string[] = [];
const rollIds: string[] = [];
const shipmentIds: string[] = [];
const lotIds: string[] = [];
let customerId = "";
let itemId = "";
let colorId = "";
let rollN = 0;

/** HTML'den görünür metni çıkarır — etiket içine kaçmış eşleşme saymasın. */
function gorunurMetin(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

interface EkranSatiri { sackNo: string; seqLabel: string | null; packageNo: number | null; lotName: string | null }
async function ekraniOku(shipmentId: string): Promise<{ shipmentNo: string; satirlar: EkranSatiri[] }> {
  const detay = (await ship.getShipmentById(shipmentId)).data as {
    shipmentNo: string;
    sacks: Array<{ sackNo: string; seqLabel?: string | null; packageNo?: number | null; packingGroupName?: string | null }>;
  };
  return {
    shipmentNo: detay.shipmentNo,
    satirlar: detay.sacks.map((s) => ({
      sackNo: s.sackNo,
      seqLabel: s.seqLabel ?? null,
      packageNo: s.packageNo ?? null,
      lotName: s.packingGroupName ?? null,
    })),
  };
}

async function belgeyiOku(shipmentId: string): Promise<string> {
  const r = await printedDocumentService.getHtml(PrintedDocType.SHIPMENT_DISPATCH, shipmentId);
  const html = (r.data as { html: string } | null)?.html;
  if (!html) throw new Error(`belge yok (donmamış?) — ${shipmentId}`);
  return gorunurMetin(html);
}

async function cuvalKur(lotId: string | null = null): Promise<string> {
  const s = (await ship.openSack(lotId ? { packingGroupId: lotId } : { customerId })).data as { id: string };
  sackIds.push(s.id);
  rollN += 1;
  const grade = await firstGrade();
  const r = await prisma.roll.create({
    data: {
      warehouseId: await fixtureWarehouseId(),
      barcode: `TEST-BEA-R${rollN}-${TS}`,
      itemId, colorId,
      status: "WAREHOUSE",
      currentQty: 50, initialQty: 50, width: 150,
      qualityGrade: grade.code,
      qualityGradeId: grade.id,
      entrySource: "SUPPLIER_RECEIPT",
      sackId: s.id,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  await prisma.sack.update({ where: { id: s.id }, data: { weightKg: 12.5 } });
  return s.id;
}

/** Sevkiyat kurar ve SEVK EDER (belge ancak o zaman donar). */
async function sevkKur(cuvalSayisi: number): Promise<string> {
  const ids: string[] = [];
  for (let i = 0; i < cuvalSayisi; i++) ids.push(await cuvalKur());
  const sh = (await ship.createShipment({ sackIds: ids, customerId })).data as { id: string; status?: string };
  shipmentIds.push(sh.id);
  // Onay bayrağı kapalıyken kurulum ZATEN sevk eder (belge o anda donar); açıkken
  // PLANNED kalır ve ayrı sevk gerekir. İki rejimde de belge donmuş olmalı.
  const durum = await prisma.shipment.findUniqueOrThrow({ where: { id: sh.id }, select: { status: true } });
  if (durum.status !== "DISPATCHED") await ship.dispatchShipment(sh.id, { plateNumber: "34 TST 34" });
  return sh.id;
}

async function main(): Promise<void> {
  const c = await prisma.customer.create({
    data: { code: `TST-BEA-${TS}`, name: `BELGE EKRAN TEST ${TS}` }, select: { id: true },
  });
  customerId = c.id;
  const item = await prisma.item.create({
    data: { code: `TST-BEA-I-${TS}`, name: `BEA KUMAŞ ${TS}`, itemType: "FABRIC", unit: "MT" }, select: { id: true },
  });
  itemId = item.id;
  const color = await prisma.color.create({ data: { code: `TST-BEA-C-${TS}`, name: `BEA EKRU ${TS}` }, select: { id: true } });
  colorId = color.id;

  try {
    await setFlag(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, "false");
    await setFlag(SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT, "off");
    await setFlag(SETTING_KEYS.SHIPPING_SACK_SEQ_ON_DOC, "true");
    await setFlag(SETTING_KEYS.SHIPPING_SACK_SEQ_PREFIX_LIVE, "false");
    await setFlag(SETTING_KEYS.SHIPPING_SACK_SEQ_PREFIX, "SP");
    await setFlag(SETTING_KEYS.SHIPPING_SACK_SEQ_SHOW_TOTAL, "false");
    await setFlag(SETTING_KEYS.SHIPPING_SACK_SEQ_START, "1");

    // ── §1: üç numara da belgede birebir ───────────────────────────────────
    const s1 = await sevkKur(2);
    const ekran1 = await ekraniOku(s1);
    const belge1 = await belgeyiOku(s1);

    check("§1 zemin: ekran iki çuval + sıra etiketi döndürdü",
      ekran1.satirlar.length === 2 && ekran1.satirlar.every((r) => !!r.seqLabel),
      ekran1.satirlar.map((r) => `${r.sackNo}/${r.seqLabel}`).join(" · "));
    check("§1 zemin: belge HTML'i dolu", belge1.length > 500, `${belge1.length} karakter`);
    check("§1 ⭐ SEVKİYAT NO belgede birebir", belge1.includes(ekran1.shipmentNo), ekran1.shipmentNo);
    const cuvalEksik = ekran1.satirlar.filter((r) => !belge1.includes(r.sackNo));
    check("§1 ⭐ ÇUVAL NO'ların hepsi belgede birebir", cuvalEksik.length === 0,
      cuvalEksik.map((r) => r.sackNo).join(", ") || `${ekran1.satirlar.length} çuval`);
    const siraEksik = ekran1.satirlar.filter((r) => !r.seqLabel || !belge1.includes(r.seqLabel));
    check("§1 ⭐ SIRA ETİKETİ (ekranda görünen) belgede birebir", siraEksik.length === 0,
      siraEksik.map((r) => r.seqLabel).join(", ") || ekran1.satirlar.map((r) => r.seqLabel).join(", "));
    check("§1 ön ek gerçekten basıldı (ölçüm 'yalnız sayı'ya çakılmasın)",
      ekran1.satirlar.every((r) => (r.seqLabel ?? "").startsWith("SP")), ekran1.satirlar[0]?.seqLabel ?? "(yok)");

    // ── §2: ön ek değişti — ESKİ sevkiyat iki yüzeyde de DEĞİŞMEDİ ─────────
    await setFlag(SETTING_KEYS.SHIPPING_SACK_SEQ_PREFIX, "PKT");
    const ekran1b = await ekraniOku(s1);
    const belge1b = await belgeyiOku(s1);
    check("§2 ⭐ ESKİ sevkiyatın EKRANI değişmedi (donmuş ön ek)",
      JSON.stringify(ekran1b.satirlar) === JSON.stringify(ekran1.satirlar),
      ekran1b.satirlar.map((r) => r.seqLabel).join(" · "));
    check("§2 ⭐ ESKİ sevkiyatın BELGESİ değişmedi (yeni ön ek sızmadı)",
      ekran1b.satirlar.every((r) => !!r.seqLabel && belge1b.includes(r.seqLabel)) && !belge1b.includes("PKT"),
      belge1b.includes("PKT") ? "PKT belgeye sızdı" : "temiz");

    // ── §3: YENİ sevkiyat yeni ön eki alır; iki yüzey yine AYNI ────────────
    const s2 = await sevkKur(2);
    const ekran2 = await ekraniOku(s2);
    const belge2 = await belgeyiOku(s2);
    check("§3 ⭐ YENİ sevkiyat yeni ön eki aldı", ekran2.satirlar.every((r) => (r.seqLabel ?? "").startsWith("PKT")),
      ekran2.satirlar.map((r) => r.seqLabel).join(" · "));
    check("§3 ⭐ yeni sevkiyatta EKRAN ile BELGE aynı",
      ekran2.satirlar.every((r) => !!r.seqLabel && belge2.includes(r.seqLabel) && belge2.includes(r.sackNo)) && belge2.includes(ekran2.shipmentNo));

    // ── §4: "eski belgeler de değişsin" → İKİSİ BİRDEN canlıya döner ───────
    await setFlag(SETTING_KEYS.SHIPPING_SACK_SEQ_PREFIX_LIVE, "true");
    const ekran1c = await ekraniOku(s1);
    const belge1c = await belgeyiOku(s1);
    check("§4 ⭐ canlı bayrak açıkken EKRAN güncel ön eki gösterir",
      ekran1c.satirlar.every((r) => (r.seqLabel ?? "").startsWith("PKT")),
      ekran1c.satirlar.map((r) => r.seqLabel).join(" · "));
    check("§4 ⭐ canlı bayrak açıkken BELGE de güncel ön eki basar — ekranla AYNI",
      ekran1c.satirlar.every((r) => !!r.seqLabel && belge1c.includes(r.seqLabel)),
      ekran1c.satirlar.map((r) => r.seqLabel).join(" · "));
    // ── §5: sevk partisi adı + ambalaj no — ekranda ne ise belgede de o ────
    await setFlag(SETTING_KEYS.SHIPPING_SACK_SEQ_PREFIX_LIVE, "false");
    await setFlag(SETTING_KEYS.PACKING_GROUPS_ENABLE, "true");
    await setFlag(SETTING_KEYS.PACKING_GROUP_MODE, "sevk-partisi");
    await setFlag(SETTING_KEYS.SHIPPING_DOC_PACKING_LOT, "true");
    const lot = (await PackingGroupService.createWithSacks({ customerId, sackIds: [] })).data as { id: string; name: string };
    lotIds.push(lot.id);
    const lotCuvallari: string[] = [];
    for (let i = 0; i < 2; i++) lotCuvallari.push(await cuvalKur(lot.id));
    const s3 = (await ship.createShipment({ sackIds: lotCuvallari, customerId })).data as { id: string };
    shipmentIds.push(s3.id);
    const durum3 = await prisma.shipment.findUniqueOrThrow({ where: { id: s3.id }, select: { status: true } });
    if (durum3.status !== "DISPATCHED") await ship.dispatchShipment(s3.id, { plateNumber: "34 TST 34" });
    const ekran3 = await ekraniOku(s3.id);
    const belge3 = await belgeyiOku(s3.id);
    check("§5 zemin: ekran parti adı ve ambalaj no döndürdü",
      ekran3.satirlar.every((r) => !!r.lotName && r.packageNo != null),
      ekran3.satirlar.map((r) => `${r.lotName}/#${r.packageNo}`).join(" · "));
    check("§5 ⭐ SEVK PARTİSİ ADI belgede birebir (ekranda P-1 ise belgede de P-1)",
      ekran3.satirlar.every((r) => !!r.lotName && belge3.includes(r.lotName)),
      ekran3.satirlar[0]?.lotName ?? "(yok)");
    check("§5 ⭐ AMBALAJ NO belgede birebir",
      ekran3.satirlar.every((r) => r.packageNo != null && new RegExp(`(^|\\s)${r.packageNo}(\\s|$)`).test(belge3)),
      ekran3.satirlar.map((r) => String(r.packageNo)).join(", "));
    // ── §6 İADE BELGE NO — çok kalemli iade, kopya semantiği ──────────────
    const iadeSevk = await sevkKur(3);
    const sevkTop = await prisma.roll.findMany({
      where: { shipmentId: iadeSevk },
      select: { id: true },
      orderBy: { barcode: "asc" },
    });
    check("§6 zemin: iade için ÜÇ sevk edilmiş top hazır", sevkTop.length === 3, `${sevkTop.length} top`);

    // ⚠️ Seed kullanıcısına YASLANMAZ: kendi fikstürünü kurar (`ensureTestAdmin`),
    // böylece seed şifresi/adı değişse de bekçi ayakta kalır ve ortam-bağımlılığı
    // tavanı (`test_ortam_bagimliligi_tavani`) büyümez.
    const admin = await ensureTestAdmin();
    check("§6 zemin: iadeyi alan personel fikstürü hazır", admin.id.length > 0);
    const iade = (await returnService.createReturn(
      { rollIds: sevkTop.map((r) => r.id), reasonText: `TEST-BEA-${TS} hatalı sevk`, note: `TEST-BEA-${TS}` },
      admin.id,
    )).data as { ids?: string[]; returnGroupId?: string };
    const iadeIds = iade.ids ?? [];
    returnIds.push(...iadeIds);
    check("§6 zemin: çok kalemli iade üç satır yarattı", iadeIds.length === 3, `${iadeIds.length} satır`);

    const iadeSatirlari = await prisma.rollReturn.findMany({
      where: { id: { in: iadeIds } },
      select: { id: true, returnNo: true, returnGroupId: true },
    });
    const numaralar = new Set(iadeSatirlari.map((r) => r.returnNo));
    check("§6 ⭐ ÜÇ SATIRIN ÜÇÜ DE AYNI belge numarasını taşıyor (üyeler liderin kopyası)",
      numaralar.size === 1 && !numaralar.has(null),
      [...numaralar].join(" | "));
    const iadeNo = iadeSatirlari[0]?.returnNo ?? "";
    check("§6 numara sayaçtan geldi (türetilmiş hex kuyruk DEĞİL)",
      /^IADE-\d{6}-\d{6}$/.test(iadeNo), iadeNo);

    const iadeBelge = gorunurMetin(
      ((await printedDocumentService.getHtml(PrintedDocType.RETURN_DISPATCH, iade.returnGroupId ?? iadeIds[0]!))
        .data as { html: string } | null)?.html ?? "",
    );
    check("§6 zemin: iade belgesi donmuş ve okunabiliyor", iadeBelge.length > 100, `${iadeBelge.length} karakter`);
    check("§6 ⭐ EKRANDAKİ numara BELGEDE birebir geçiyor",
      iadeNo !== "" && iadeBelge.includes(iadeNo), iadeNo);

    // ⭐ ETKİ SAYISININ BİRİMİ: üç SATIR var ama BİR belge. Panelin cümlesi
    // "N iade belgesinin numarası değişmez" olacağı için sayım belge çapasını
    // saymalı; `count(*)` üçü de sayar ve cümle yalan olurdu.
    const satirSayisi = await prisma.rollReturn.count({ where: { id: { in: iadeIds } } });
    const belgeSayisi = (await seriesImpactCount("returnDoc")) ?? -1;
    check("§6 ⭐ etki sayısı BELGE sayar, SATIR değil (3 satır → 1 belge)",
      satirSayisi === 3 && belgeSayisi === 1, `${satirSayisi} satır ↔ ${belgeSayisi} belge`);
    // ── §7 FATURA NUMARASI — ekran ile belge AYNI (E2 finans dilimi) ────────
    // ⚠️ NEDEN AYRI BİR KOL: fatura numarası DÖRT serinin (satış · alış · iki
    // iade) PAYLAŞTIĞI tek kolondan (`Invoice.docNo`) doğuyor ve sayaç ön ekle
    // bölünüyor. Sevkiyat kolları bu yolu hiç koşmuyor; numara üreteci finans
    // diliminde `nextSeriesNo`a taşındı, yani ekran ↔ belge eşitliği YENİDEN
    // ölçülmeli — "aynı mekanizma, zaten ölçüldü" varsayımı tam da bu depoda
    // yanlış çıkan varsayım sınıfıdır.
    const faturaMusteri = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    check("§7 zemin: fatura için cari fikstürü hazır", faturaMusteri !== null);
    const fatura = await invoiceService.createDraft({
      type: "SALES" as never,
      customerId,
      lines: [{ description: "E-belge ölçümü", qty: 1, unit: "m", unitPrice: 10 }],
    });
    const faturaId = fatura.data?.id ?? null;
    invoiceIds.push(...(faturaId ? [faturaId] : []));
    check("§7 zemin: fatura taslağı numarasıyla doğdu", Boolean(faturaId && fatura.data?.docNo),
      fatura.data?.docNo ?? "(yok)");
    if (faturaId && fatura.data?.docNo) {
      const ekranNo = (await prisma.invoice.findUnique({
        where: { id: faturaId }, select: { docNo: true },
      }))?.docNo ?? "";
      check("§7 ⭐ EKRANIN okuduğu numara üretecin döndürdüğüyle AYNI",
        ekranNo === fatura.data.docNo, `${fatura.data.docNo} ↔ ${ekranNo}`);
      const faturaBelge = ((await printedDocumentService.getHtml(
        PrintedDocType.INVOICE_INTERNAL, faturaId, undefined, { allowDraft: true },
      )).data?.html) ?? "";
      check("§7 zemin: fatura belgesi okunabiliyor", faturaBelge.length > 100, `${faturaBelge.length} karakter`);
      check("§7 ⭐ FATURA NUMARASI belgede BİREBİR geçiyor (programda başka, çıktıda başka DEĞİL)",
        faturaBelge.includes(ekranNo), ekranNo);
    }
  } finally {
    // FK sırası: belge → iade → top → çuval → sevkiyat → parti → master veri
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...shipmentIds, ...returnIds, ...invoiceIds] } } });
    if (invoiceIds.length > 0) {
      const faturaCari = await prisma.cariAccount.findFirst({ where: { customerId }, select: { id: true } });
      if (faturaCari) await prisma.cariTransaction.deleteMany({ where: { cariId: faturaCari.id } });
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      if (faturaCari) await prisma.cariAccount.deleteMany({ where: { id: faturaCari.id } });
    }
    await prisma.warehouseMovement.deleteMany({ where: { rollReturnId: { in: returnIds } } });
    await prisma.rollReturn.deleteMany({ where: { id: { in: returnIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.packingGroup.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.color.deleteMany({ where: { id: colorId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    for (const [key, value] of prevFlags) {
      if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
      else await prisma.systemSetting.update({ where: { key }, data: { value } });
    }
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

void main().catch(async (e) => {
  console.error("❌ Bekçi hata ile durdu:", e);
  await prisma.$disconnect();
  process.exit(1);
});
