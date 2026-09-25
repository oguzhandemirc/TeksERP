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
//   [2] Etiketli iptalde sebep sorulmuyordu           → sebep alanı (§2/§2b)
//       ⚠️ 2026-08-06: sebep ZORUNLU olmaktan çıktı (kullanıcı kararı — zorunluluk
//       rastgele kategori seçtiriyordu, o da cevapsızlıktan kötü). Sorulmaya devam
//       ediyor, verilmezse NULL kalıyor. Fail-closed'ı taşıyan ONAY bayrağıdır.
//   [3] İptalin GERİ DÖNÜŞÜ yoktu (→ ikinci barkod)   → restoreCancelledRoll
//   [4] Okutma yüzeyi sebebi söylemiyordu             → lookup teşhis alanları
//
// ⚠️ Bekçinin en kolay kaybedilen özelliği: guard'ların HEPSİ "kırmızı verebiliyor
// mu" diye negatif sondayla sınanmalı. Guard'ı kaldırıp testi koştur; kırmızı
// vermiyorsa test o guard'ı ölçmüyordur.
// =============================================================================

import { randomUUID } from "crypto";
import { TAMBUR_UNDO_CANCEL_CODE } from "../src/constants/reason-presets";
import prisma, { pool } from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { InventoryService } from "../src/services/inventory.service";
import {
  resolveRollRestoreBlockReason,
  resolveRestoreTargetStatus,
} from "../src/services/helpers/roll-cancel-restore.helper";
import { RollStatus } from "@prisma/client";
import { fixtureWarehouseId } from "./fixture-warehouse";

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
  /** Varsayılan 100 — Tambur kesimi bölümü kendi metrajını verir. */
  qty?: number;
}): Promise<{ id: string; barcode: string }> {
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Aktif ürün yok — seed koşulmamış olabilir");
  // ⚠️ BÜYÜK harf: gerçek barkodlar hep büyüktür ve okutma yolu girdiyi
  // büyütür (normalizeScanCode). Küçük harfli fixture, üretimde olmayan bir
  // durumu sınayıp testi yanlış yerden kırmızıya düşürür.
  const barcode = `T-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
  const roll = await prisma.roll.create({
    data: {
      // Stok kumesinden cikabilmek icin deposu DOLU olmali (K6 kapisi):
      // uretimde deposuz top dogamaz, fikstur de uretmemeli.
      warehouseId: await fixtureWarehouseId(),
      itemId: item.id,
      barcode,
      initialQty: opts.qty ?? 100,
      currentQty: opts.qty ?? 100,
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

  // ── §2 Etiketi BASILMIŞ top: GUARD KALDIRILDI (2026-08-25) ────────────────
  //
  // ⚠️ BU BÖLÜM 2026-08-25'te TERSİNE ÇEVRİLDİ ve bu bilinçlidir. Eskiden burada
  // "onaysız iptal 409 LABEL_PRINTED ile reddedilir" ölçülüyordu. Kullanıcı kararı:
  // ölü etiket onayı bir sektör standardı değildi (2026-08-05'teki tek olaydan
  // sonra eklenmiş yerel bir korumaydı), karşılığında bir "etiket toplama" süreci
  // hiç kurulmadı ve masaüstünde hiç bağlanmadığı için orada etiketli top HİÇ
  // iptal edilemiyordu. Guard kalktı; VERİ (labelPrintedAt) duruyor.
  //
  // Geri koymak istersen: `inventory.service.softDelete`teki gerekçeyi ÖNCE çürüt,
  // sonra bu bölümü ve `test_roll_cancel_undo` §2b'yi birlikte geri al.
  console.log("\n§2 Etiketli top — onay SORULMAZ, veri korunur");
  {
    const r = await makeRoll({ labelPrinted: true });
    // Onaysız, sebepsiz: tek hamlede geçmeli.
    await service.softDelete(r.id, undefined, {});
    const first = await prisma.roll.findUnique({
      where: { id: r.id },
      select: { status: true, labelPrintedAt: true },
    });
    check(
      "etiketli top onay SORULMADAN iptal edildi",
      first?.status === RollStatus.CANCELLED,
      String(first?.status),
    );
    // Kaldırılan şey SORU; veri duruyor — "sahada hangi ölü etiket var" sorusu
    // bir gün sorulursa cevabı hâlâ bu kolonda.
    check("labelPrintedAt SİLİNMEDİ (soru kalktı, veri kalmadı değil)", first?.labelPrintedAt != null);

    // Sebep verilen ikinci top: sebep TOPUN SATIRINA yazılır (audit'e değil).
    const r2 = await makeRoll({ labelPrinted: true });
    await service.softDelete(r2.id, undefined, {
      reason: "yanlış metraj girildi",
    });
    const done = await prisma.roll.findUnique({
      where: { id: r2.id },
      select: { status: true, cancelReason: true, cancelReasonCode: true },
    });
    check("sebeple iptal edildi", done?.status === RollStatus.CANCELLED);
    check(
      "sebep topun KENDİ satırında (audit'te değil — 6 ayda arşivlenir)",
      done?.cancelReason === "yanlış metraj girildi",
      String(done?.cancelReason),
    );
    // 2026-08-21: sebep KODU da satırda — metin kataloğun fullText'iyle KATLANMIŞ
    // eşleşti ("yanlış metraj girildi" ≡ "Yanlış metraj girildi") → YANLIS_METRAJ.
    check(
      "sebep KODU sunucuda türetildi (katlanmış eşleşme) → YANLIS_METRAJ",
      done?.cancelReasonCode === "YANLIS_METRAJ",
      String(done?.cancelReasonCode),
    );
  }

  // ── §2b SEBEP OPSİYONEL (2026-08-06) ──────────────────────────────────────
  // Zorunluluk kaldırıldı: eldivenli operatör vardiya ortasında kategori seçmeye
  // zorlanınca rastgele seçiyordu ve o cevap cevapsızlıktan kötüdür. ONAY yine
  // ZORUNLU — eski istemcileri fail-closed tutan tek şey odur.
  console.log("\n§2b Etiketli top — sebep OPSİYONEL, onay ZORUNLU");
  {
    const r = await makeRoll({ labelPrinted: true });
    // ⚠️ try/catch ŞART: zorunluluk geri gelirse burası fırlatır ve testi çökertip
    // geri kalan §'leri hiç koşmadan bırakırdı — çökme de kırmızıdır ama NEDENİNİ
    // söylemez. Sonda buradan girecek, o yüzden mesaj net olsun.
    try {
      await service.softDelete(r.id, undefined, { confirmLabelPrinted: true });
      check("sebepsiz iptal reddedilmedi (sebep opsiyonel)", true);
    } catch (e) {
      check(
        "sebepsiz iptal reddedilmedi (sebep opsiyonel)",
        false,
        `FIRLATTI: ${(e as Error).message.slice(0, 60)}`,
      );
    }
    const done = await prisma.roll.findUnique({
      where: { id: r.id },
      select: { status: true, cancelReason: true, cancelledAt: true },
    });
    check("sebepsiz iptal GEÇER", done?.status === RollStatus.CANCELLED, String(done?.status));
    check(
      "sebep NULL kalır (uydurma metin yazılmaz — yüzeyler 'Seçilmedi' gösterir)",
      done?.cancelReason === null,
      String(done?.cancelReason),
    );
    check("iptal anı yine damgalanır", done?.cancelledAt != null);

    // Doldurma metni ELENİR: "a"/"." denetimde cevap varmış gibi görünür.
    const r2 = await makeRoll({ labelPrinted: true });
    await service
      .softDelete(r2.id, undefined, { confirmLabelPrinted: true, reason: " . " })
      .catch((e: Error) => check("doldurma sebep iptali fırlatmadı", false, e.message.slice(0, 60)));
    const done2 = await prisma.roll.findUnique({
      where: { id: r2.id },
      select: { status: true, cancelReason: true, cancelReasonCode: true },
    });
    check("3 karakterden kısa sebep iptali DÜŞÜRMEZ", done2?.status === RollStatus.CANCELLED);
    check(
      "3 karakterden kısa sebep SAKLANMAZ (null)",
      done2?.cancelReason === null,
      String(done2?.cancelReason),
    );
    check("kısa doldurmada sebep KODU da null", done2?.cancelReasonCode === null, String(done2?.cancelReasonCode));

    // ⚠️ Eski istemci uyumu (2026-08-25): `confirmLabelPrinted` artık hiçbir kapı
    // açmıyor ama sahadaki APK'lar hâlâ gönderiyor. Gönderilmesi de gönderilmemesi
    // de AYNI sonucu vermeli — biri 409'a düşerse deploy penceresinde tabletler
    // ya da masaüstü sessizce kilitlenir.
    const r3 = await makeRoll({ labelPrinted: true });
    await service.softDelete(r3.id, undefined, {
      confirmLabelPrinted: true,
      reason: "yanlış ürün seçildi",
    });
    const done3 = await prisma.roll.findUnique({
      where: { id: r3.id },
      select: { status: true },
    });
    check("eski istemcinin confirmLabelPrinted'i zararsız", done3?.status === RollStatus.CANCELLED);
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
      select: { status: true, cancelledAt: true, cancelReason: true, cancelReasonCode: true, preCancelStatus: true },
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
    check("cancelReasonCode temizlendi", after?.cancelReasonCode === null);
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
      cancelReasonCode: null,
    };
    check("temiz kayıt: engel yok", resolveRollRestoreBlockReason(base) === null);
    check(
      "hareketli top engelli",
      /hareket kaydı var/i.test(resolveRollRestoreBlockReason({ ...base, movementCount: 1 }) ?? ""),
    );
    // ⚠️ TERSİNE ÇEVRİLDİ (2026-08-25, "SAP'taki gibi yap"): parti üyeliği tek
    // başına ENGEL DEĞİL. SAP'ta parti ana veridir; ters kaydı engelleyen şey
    // sonraki hareket / tüketim / sevktir — hepsi ayrı kural. Ölçüm: bu kural
    // 86 topu kilitliyordu, 85'i sıfır hareketli Tambur çıktısıydı.
    check(
      "partili ama HAREKETSİZ top: engel YOK (parti ana veridir, hareket değil)",
      resolveRollRestoreBlockReason({ ...base, batchId: "x" }) === null,
    );
    check(
      "partili VE hareketli top: yine engelli (asıl koruma bu)",
      /hareket kaydı var/i.test(
        resolveRollRestoreBlockReason({ ...base, batchId: "x", movementCount: 1 }) ?? "",
      ),
    );
    check(
      "partili VE kesilmiş top: yine engelli",
      /kesilmiş/i.test(
        resolveRollRestoreBlockReason({ ...base, batchId: "x", childCount: 1 }) ?? "",
      ),
    );
    check(
      "partili VE çuvaldaki top: yine engelli",
      /çuvala\/sevkiyata/i.test(
        resolveRollRestoreBlockReason({ ...base, batchId: "x", sackId: "s" }) ?? "",
      ),
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
      resolveRollRestoreBlockReason({ ...base, operationCount: 1 }),
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
      cancelReasonCode?: string | null;
      cancelledAt: Date | null;
      canRestore?: boolean;
      restoreBlockReason?: string | null;
    };
    check("okutma iptal sebebini taşıyor", d.cancelReason === "mükerrer giriş");
    // "mükerrer giriş" ne label ("Mükerrer") ne fullText ile eşleşir → serbest metin, kod NULL.
    check("serbest metinde sebep KODU null (okutma yanıtı taşır)", d.cancelReasonCode === null, String(d.cancelReasonCode));
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

  // ── §7 FİRE ("mal vardı, artık yok") — iptalden AYRI karar ────────────────
  //
  // 2026-08-25 kullanıcı kararı. İki eylem AYRI kalmak ZORUNDA:
  //   • İptal → "bu kayıt hiç olmamalıydı": stok düşmez (mal hiç girmemişti),
  //     hareket kapanışı STORNO (`qtyOut = 0`), fire raporuna GİRMEZ.
  //   • Fire  → "mal vardı, artık yok": stok gerçekten düşer, hareket kapanışı
  //     `qtyOut = qtyIn` (mal o istasyondan geçti), fire raporuna GİRER.
  // Birleştirilirse fabrikanın fire oranı veri düzeltmeleriyle kirlenir. Ölçüm
  // (canlı kopya, 2026-08-25): 230 iptal / 1 fire; sebep yazılmış 24 iptalin
  // HEPSİ kayıt hatası — yani ayrım sahada zaten doğru kullanılıyor.
  console.log("\n§7 Fire — iptalden ayrı karar");
  {
    const r = await makeRoll({ labelPrinted: true });
    await service.softDelete(r.id, undefined, { mode: "SCRAP", reason: "Kirlendi" });
    const done = await prisma.roll.findUnique({
      where: { id: r.id },
      select: { status: true, cancelReason: true, preCancelStatus: true, cancelledAt: true },
    });
    check("fire → SCRAP (CANCELLED DEĞİL)", done?.status === RollStatus.SCRAP, String(done?.status));
    check("fire sebebi topun SATIRINDA", done?.cancelReason === "Kirlendi", String(done?.cancelReason));
    check("çıkış izi fire'da da damgalanır", done?.cancelledAt != null);
    check("geldiği raf kaydedildi", done?.preCancelStatus === RollStatus.STOCK, String(done?.preCancelStatus));

    // Fire GERİ ALINAMAZ — yüklem statüye bakar, "cancel kolonları dolu" diye
    // fire'ı diriltmemeli (kolonlar bilerek paylaşılıyor).
    const block = resolveRollRestoreBlockReason({
      status: done!.status,
      preCancelStatus: done!.preCancelStatus,
      cancelReasonCode: null,
      batchId: null,
      sackId: null,
      shipmentId: null,
      currentStepId: null,
      movementCount: 0,
      operationCount: 0,
      childCount: 0,
      dispatchItemCount: 0,
      kartelaItemCount: 0,
    });
    check("fire geri alınamaz (kolonlar paylaşılsa da)", block !== null, String(block));

    // Geçersiz fire sebep kodu → 400 (fire kataloğu iptal kataloğundan AYRI).
    const r2 = await makeRoll({ labelPrinted: false });
    try {
      await service.softDelete(r2.id, undefined, { mode: "SCRAP", reasonCode: "MUKERRER_GIRIS" });
      check("iptal kataloğunun kodu fire'da reddedilir", false, "GEÇTİ — katalog ayrımı yok!");
    } catch (e) {
      check("iptal kataloğunun kodu fire'da reddedilir", true, (e as Error).message.slice(0, 50));
    }

    // Aynı engeller: fasondaki top fire EDİLEMEZ.
    const r3 = await makeRoll({ labelPrinted: false, status: RollStatus.AT_SUBCONTRACTOR });
    try {
      await service.softDelete(r3.id, undefined, { mode: "SCRAP" });
      check("fasondaki top fire edilemez", false, "GEÇTİ — engel yok!");
    } catch (e) {
      check("fasondaki top fire edilemez", /fason/i.test((e as Error).message));
    }
  }

  // ── §  TAMBUR GERİ ALMASININ İPTALİ DİRİLTİLEMEZ (2026-08-29 / T1-011) ────
  // Geri alma bir kesim parçasını iptal ederken metrajını KAYNAK TOPA İADE eder.
  // Parça bundan sonra "iptal ama metrajı üstünde" bir kayıt olurdu ve
  // Envanter→Arşiv'den "İptali Geri Al" onu diriltince AYNI metraj iki yerde
  // sayılırdı — hiçbir ekranda uyarı yok, fark ancak fiziksel sayımda görülür.
  // Beş eski sinyal bunu GÖREMİYORDU: böyle bir parçanın hareketi, istasyon
  // işlemi, çocuğu, çuvalı, sevki YOKTUR — tam da "hiç yaşamamış" gibi görünür.
  console.log("\n── Tambur geri almasıyla iptal edilen parça ──");
  {
    const { TamburService } = await import("../src/services/tambur.service");
    const { TamburUndoService } = await import("../src/services/tambur-undo.service");
    const kaynak = await makeRoll({ labelPrinted: false, status: RollStatus.WAREHOUSE, qty: 100 });
    const adminId = (await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }))?.id;
    // `qualityGrade` AÇIKÇA verilir: kaynak top gradesiz doğuyor ve
    // `quality.gradeRequiredEnabled` AÇIK bir kurulumda kesim 400
    // GRADE_REQUIRED'a düşerdi — bekçinin konusu (geri alma ↔ diriltme) hiç
    // ölçülmeden. Operatörün kesimde kalite seçmesinin birebir karşılığı.
    const kesim = await new TamburService().cutWarehouseRoll(
      kaynak.id,
      { cutLength: 40, qualityGrade: (await roleGrade("FIRST")).code },
      adminId,
    );
    const cocuk = (kesim.data as { childRoll: { id: string } }).childRoll;
    created.push(cocuk.id); // kesimin doğurduğu parça da temizlenir — izlenmezse kalıntı kalıyordu

    await new TamburUndoService().applyUndo(cocuk.id, adminId, { mode: "SINGLE" });

    const c = await prisma.roll.findUnique({
      where: { id: cocuk.id },
      select: { status: true, currentQty: true, initialQty: true, cancelReasonCode: true },
    });
    check("geri alma parçayı iptal etti", c?.status === RollStatus.CANCELLED, String(c?.status));
    check(
      "parçanın METRAJI SIFIRLANDI (metraj kaynak topa döndü)",
      Number(c?.currentQty) === 0,
      `${c?.currentQty} m`,
    );
    check(
      "giriş metrajı KORUNDU (arşiv 'bu kesim 40 m'ydi' diyebiliyor)",
      Number(c?.initialQty) === 40,
      `${c?.initialQty} m`,
    );
    check(
      "iptalin kaynağı SATIRIN KENDİSİNDE (audit'e bağımlı değil)",
      c?.cancelReasonCode === TAMBUR_UNDO_CANCEL_CODE,
      String(c?.cancelReasonCode),
    );

    let dirilmeHatasi: string | undefined;
    try {
      await service.restoreCancelledRoll(cocuk.id, adminId);
    } catch (e) {
      dirilmeHatasi = (e as Error).message;
    }
    check("İPTALİ GERİ AL reddedildi", dirilmeHatasi !== undefined, dirilmeHatasi?.slice(0, 60) ?? "DİRİLDİ!");
    check(
      "mesaj ne yapılacağını söylüyor (kaynak topu tekrar kesin)",
      Boolean(dirilmeHatasi?.includes("tekrar kesin")),
    );
    const sonra = await prisma.roll.findUnique({ where: { id: cocuk.id }, select: { status: true } });
    check("parça hâlâ iptal (dirilmedi)", sonra?.status === RollStatus.CANCELLED, String(sonra?.status));

    // ── ESKİ KAYIT (damgasız) — kapı audit'e BAKMAZ ─────────────────────────
    // 2026-08-29 öncesi geri almalar satıra iz yazmadı. K-A2 kararı (kullanıcı,
    // 2026-09-26): iz yayın günü BİR KEZ yazılır (`fix_tambur_undo_cancel_marker.ts`,
    // bekçisi test_tambur_undo_marker_backfill); kapı audit'e bakmaz. Damgasız parça
    // bu yüzden iz yazılana kadar diriltilebilir — yayın sırasının neden bağlayıcı
    // olduğunu bu satır ölçer.
    await prisma.roll.update({
      where: { id: cocuk.id },
      data: { cancelReasonCode: null, cancelReason: null }, // eski kaydı taklit et
    });
    const damgasiz = await prisma.roll.findUnique({
      where: { id: cocuk.id },
      select: { cancelReasonCode: true },
    });
    check("sonda damgayı gerçekten sildi (eski kayıt taklidi)", damgasiz?.cancelReasonCode === null);

    let eskiHata: string | undefined;
    try {
      await service.restoreCancelledRoll(cocuk.id, adminId);
    } catch (e) {
      eskiHata = (e as Error).message;
    }
    check(
      "damgasız eski kayıtta kapı audit'e BAKMAZ — iz yoksa diriltilir (koruma yayın günü izinden)",
      eskiHata === undefined,
      eskiHata?.slice(0, 55) ?? "dirildi (beklenen)",
    );
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);

}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    // Test kendi yarattığını siler; hata YUTULMAZ, kalıntı bırakan koşum kırmızıdır.
    if (created.length) {
      try {
        await prisma.roll.deleteMany({ where: { id: { in: created } } });
      } catch (e) {
        fail++;
        console.error("❌ TEMİZLİK HATASI — kalıntı kaldı:", String((e as Error).message ?? e).split("\n").map((l) => l.trim()).filter(Boolean).pop());
      }
    }
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
