// =============================================================================
// Onarım: çuvalda KAYITLI ama fiziksel olarak binada OLMAYAN toplar ("hayalet")
// Çalıştır: npx tsx scripts/repair_sack_ghost_rolls.ts          (RAPOR — yazmaz)
//           npx tsx scripts/repair_sack_ghost_rolls.ts --apply  (sınıf A'yı onarır)
// =============================================================================
// KÖK NEDEN: DEPO çuvalındaki topun `Roll.shipmentId`'si NULL'dır (`shipmentId`
// yalnız `createShipment` anında yazılır) → "çuvalda mı?" sorusunu `shipmentId`
// ile soran guard depo çuvalındaki topu SERBEST sanar. Dört akış bu hatayı
// yapıyordu: `kartela.dispatch`, `tambur.cutWarehouseRoll`,
// `tambur.finalizeWarehouseCut`, `subcontractor` auto-attach. Guard'lar eklendi
// (`sack-invariants.helper.ts`); bu script GEÇMİŞ hasarı temizler.
//
// NE YAZAR: yalnız `rolls.sackId = NULL`. **`status` DEĞİŞTİRİLMEZ** — top
// gerçekten kartela firmasında/tüketilmiş, statüsü DOĞRU; yanlış olan çuval
// üyeliğidir. Fiziksel DELETE yok. `printed_documents`'a DOKUNULMAZ (donmuş
// belge; düzeltme yalnız `reissue` ile insan kararıdır).
//
// TARTI SIFIRLAMA: onarılan topun çuvalı tartılmışsa `weightKg`/`weighedAt`/
// `weighedById` NULL'lanır — `removeRollFromSack`'in davranışının birebir aynısı
// (`resetSackWeightsTx`): hayaletin de sayıldığı brüt kg artık şüphelidir.
// Yıkıcı-işlem-onayı kuralının script karşılığı: RAPOR modu tartısını
// kaybedecek çuvalları TEK TEK listeler (soyut sayı değil), `--apply` sonra koşar.
//
// ⚠️ ÇALIŞTIRMA SIRASI: bu script uygulama deploy'u BEKLEMEZ (tsx, `dist/` gerekmez)
// → guard'lar canlıya çıkmadan önce koşabilir. Ama guard'lar canlı olmadığı sürece
// YENİ hayalet doğabilir; bu yüzden `--apply`'ı deploy penceresinin HEMEN ÖNCESİNDE
// koş. Öncesinde YEDEK al (`URETIM-KONTROL-LISTESI.md`).
// =============================================================================
import { RollStatus, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { touchWarehouseSackTx } from "../src/services/helpers/shipment-locks.helper";
import { SACK_ABSENT_STATUSES } from "../src/services/helpers/sack-invariants.helper";
import { shippingService } from "../src/services/shipping.service";

const APPLY = process.argv.includes("--apply");
/** Sınıf B (PLANNED sevkiyattaki çuval) onarımı — canlı sevkiyatı geçici bozar, opt-in. */
const REPAIR_PLANNED = process.argv.includes("--planned");

/** Onarımı bir kullanıcıya atfetmek için: --user <userId> (yoksa SYSTEM). */
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const ACTOR = argValue("--user");

const fmt = (n: unknown) => (n == null ? "—" : String(n));

async function main() {
  console.log(
    APPLY
      ? "== UYGULAMA MODU — sınıf A onarılacak =="
      : "== RAPOR MODU (yazmaz; --apply ile uygula) =="
  );

  // ---------------------------------------------------------------------------
  // Tarama: sackId dolu + statü SACK_ABSENT. Çuvalın sevkiyat durumu sınıfı belirler.
  // ---------------------------------------------------------------------------
  const ghosts = await prisma.roll.findMany({
    where: { sackId: { not: null }, status: { in: SACK_ABSENT_STATUSES } },
    select: {
      id: true,
      barcode: true,
      status: true,
      currentQty: true,
      updatedAt: true,
      sackId: true,
      sack: {
        select: {
          id: true,
          sackNo: true,
          weightKg: true,
          shipmentId: true,
          shipment: { select: { shipmentNo: true, status: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const classA = ghosts.filter((g) => g.sack?.shipmentId == null);
  const classB = ghosts.filter(
    (g) => g.sack?.shipment?.status === ShipmentStatus.PLANNED
  );
  const classC = ghosts.filter(
    (g) => g.sack?.shipment?.status === ShipmentStatus.DISPATCHED
  );

  // ---------------------------------------------------------------------------
  // Sınıf D — GERİ ALINAMAZ: statü SHIPPED'e ezilmiş (performDispatchTx) ama top
  // kartela/fason sevkinde de var → aynı mal iki kez tüketildi, irsaliye DONMUŞ.
  // Statü kanıtı yok olduğu için kalıcı kanıt yalnız sevk kalemlerinde durur.
  // ---------------------------------------------------------------------------
  const shippedInSack = await prisma.roll.findMany({
    where: {
      sackId: { not: null },
      status: RollStatus.SHIPPED,
      sack: { shipment: { status: ShipmentStatus.DISPATCHED } },
    },
    select: { id: true },
  });
  const shippedIds = shippedInSack.map((r) => r.id);

  const [kartelaHits, fasonHits] = shippedIds.length
    ? [
        await prisma.kartelaDispatchItem.findMany({
          where: { rollId: { in: shippedIds }, dispatch: { cancelledAt: null } },
          select: {
            rollId: true,
            dispatch: { select: { dispatchNo: true, createdAt: true } },
          },
        }),
        await prisma.subcontractorDispatchItem.findMany({
          where: { rollId: { in: shippedIds }, dispatch: { cancelledAt: null } },
          select: {
            rollId: true,
            dispatch: { select: { dispatchNo: true, createdAt: true } },
          },
        }),
      ]
    : [[], []];

  const classDIds = new Set([
    ...kartelaHits.map((k) => k.rollId),
    ...fasonHits.map((f) => f.rollId),
  ]);
  const classD = classDIds.size
    ? await prisma.roll.findMany({
        where: { id: { in: [...classDIds] } },
        select: {
          id: true,
          barcode: true,
          currentQty: true,
          sack: {
            select: {
              sackNo: true,
              shipment: {
                select: {
                  shipmentNo: true,
                  dispatchedAt: true,
                  customer: { select: { name: true } },
                },
              },
            },
          },
        },
      })
    : [];

  // ---------------------------------------------------------------------------
  // Rapor
  // ---------------------------------------------------------------------------
  const line = (g: (typeof ghosts)[number]) =>
    `  ${(g.barcode ?? g.id).padEnd(22)} ${g.status.padEnd(24)} ` +
    `${fmt(g.currentQty).padStart(8)} m  çuval=${fmt(g.sack?.sackNo)}` +
    (g.sack?.shipment
      ? `  sevkiyat=${g.sack.shipment.shipmentNo} (${g.sack.shipment.status})`
      : "  [DEPODA]");

  console.log(`\n── Toplam hayalet (sackId dolu + fiziksel yok): ${ghosts.length}`);

  console.log(`\n【A】 DEPO çuvalında — OTOMATİK ONARILABİLİR: ${classA.length}`);
  classA.forEach((g) => console.log(line(g)));

  console.log(
    `\n【B】 PLANNED sevkiyattaki çuvalda — \`--planned\` ile ONARILABİLİR: ${classB.length}` +
      (classB.length
        ? "\n     Script servisleri sırayla çağırır (ham UPDATE DEĞİL): çuvalı sevkiyattan\n" +
          "     ÇIKAR → hayaletleri çuvaldan çıkar → çuvalı sevkiyata GERİ EKLE. Böylece\n" +
          "     tahsisler yeniden hesaplanır (writeShipmentAllocationsTx) ve sipariş\n" +
          "     karşılanması hayaletin metresiyle şişmiş kalmaz.\n" +
          "     ⚠️ Canlı sevkiyatı GEÇİCİ bozar (çuval kısa süre depoya döner, seq yeniden\n" +
          "     atanır, çuvalın brüt kg'si sıfırlanır) → ayrı onay: --apply --planned"
        : "")
  );
  classB.forEach((g) => console.log(line(g)));

  console.log(`\n【C】 DISPATCHED çuvalda + statü hâlâ ölü — ELLE İNCELE: ${classC.length}`);
  classC.forEach((g) => console.log(line(g)));

  console.log(
    `\n【D】 ⛔ GERİ ALINAMAZ — sevk edildi VE kartelaya/fasona gitti: ${classD.length}`
  );
  for (const d of classD) {
    const k = kartelaHits.find((x) => x.rollId === d.id);
    const f = fasonHits.find((x) => x.rollId === d.id);
    console.log(
      `  ${(d.barcode ?? d.id).padEnd(22)} ${fmt(d.currentQty).padStart(8)} m  ` +
        `çuval=${fmt(d.sack?.sackNo)}  irsaliye=${fmt(d.sack?.shipment?.shipmentNo)}  ` +
        `müşteri=${fmt(d.sack?.shipment?.customer?.name)}  ` +
        `${k ? `kartela=${k.dispatch.dispatchNo}` : ""}${f ? `fason=${f.dispatch.dispatchNo}` : ""}`
    );
  }
  if (classD.length) {
    console.log(
      "\n  ⚠️  Bu satırlar GERİ ALINAMAZ: aynı mal müşteriye faturalandı VE dışarıya çıktı.\n" +
        "      İrsaliye DONMUŞ; düzeltme yalnız `reissue` (gerekçeli revizyon) ile İNSAN\n" +
        "      kararıyla yapılır. Bu script belgeye DOKUNMAZ.\n" +
        "      ⓘ Tambur kaynaklı çift-sayım burada GÖRÜNMEZ — performDispatchTx statüyü\n" +
        "        ezdiği için kalıcı kanıt kalmıyor; `system_logs` (tableName='ROLL')\n" +
        "        üzerinden aranabilir ama arşiv ufku ~6 ay (jobs/archive-scheduler)."
    );
  }

  // Sınıf E — tartısı sıfırlanacak çuvallar (yıkıcı etkinin somut listesi)
  const sacksLosingWeight = [
    ...new Map(
      classA
        .filter((g) => g.sack?.weightKg != null)
        .map((g) => [g.sack!.id, g.sack!])
    ).values(),
  ];
  console.log(
    `\n【E】 --apply ile TARTISI SIFIRLANACAK çuvallar: ${sacksLosingWeight.length}` +
      (sacksLosingWeight.length
        ? "  (yeniden tartılmalı + etiketi yeniden basılmalı)"
        : "")
  );
  sacksLosingWeight.forEach((s) =>
    console.log(`  ${s.sackNo.padEnd(20)} mevcut kg=${fmt(s.weightKg)} → NULL`)
  );

  // ---------------------------------------------------------------------------
  // Onarım — yalnız sınıf A
  // ---------------------------------------------------------------------------
  if (!APPLY) {
    console.log(
      `\n== RAPOR bitti. Onarmak için: npx tsx scripts/repair_sack_ghost_rolls.ts --apply ==`
    );
    return;
  }

  let fixed = 0;
  const skipped: { ref: string; why: string }[] = [];

  for (const g of classA) {
    const sackId = g.sackId!;
    const ref = g.barcode ?? g.id;
    const before = {
      sackId,
      sackNo: g.sack?.sackNo ?? null,
      status: g.status,
      sackWeightKg: g.sack?.weightKg != null ? Number(g.sack.weightKg) : null,
    };

    try {
      await prisma.$transaction(async (tx) => {
        // Sevkiyata atanma yarışıyla serileş — çuval bu arada sevke girmişse 409.
        await touchWarehouseSackTx(tx, sackId);

        // Atomik claim: statü + üyelik hâlâ beklediğimiz gibiyse çuvaldan çıkar.
        const freed = await tx.roll.updateMany({
          where: {
            id: g.id,
            sackId,
            shipmentId: null,
            status: { in: SACK_ABSENT_STATUSES },
          },
          data: { sackId: null },
        });
        if (freed.count !== 1) {
          throw new Error("durum bu sırada değişti (statü/üyelik)");
        }

        // Bayat brüt kg — removeRollFromSack ile aynı davranış.
        // `resetSackWeightsTx`'in ELLE kopyası — orada bir alan eklenirse BURAYA DA
        // eklenmeli (aksi halde onarım sonrası "kg yok ama kaynağı dolu" kalır).
        await tx.sack.updateMany({
          where: { id: sackId, weightKg: { not: null } },
          data: { weightKg: null, weightSource: null, weighedById: null, weighedAt: null },
        });
      });
    } catch (e) {
      skipped.push({ ref, why: (e as Error).message });
      continue;
    }

    // Audit tx DIŞINDA, best-effort (ev standardı). `kind` normal operatör
    // çıkarmasından (SACK_UNSCAN) BİLİNÇLİ ayrı — toplu onarım ayırt edilebilmeli.
    await AuditService.log({
      userId: ACTOR,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: g.id,
      oldData: before,
      newData: {
        kind: "SACK_GHOST_REPAIR",
        sackId: null,
        status: g.status,
        script: "repair_sack_ghost_rolls",
      },
    });
    fixed++;
  }

  // ---------------------------------------------------------------------------
  // Sınıf B — PLANNED sevkiyattaki çuvalda kalan hayaletler (yalnız `--planned`)
  // ---------------------------------------------------------------------------
  // `removeRollFromSack` sevkiyattaki çuvalı reddeder → doğrudan onarılamaz. Doğru
  // yol SERVİS çağrılarını sıralamaktır (ham UPDATE DEĞİL): çuvalı sevkiyattan çıkar
  // → hayaletleri çuvaldan çıkar → çuvalı sevkiyata geri ekle. Her adım kendi
  // guard'ından + audit'inden geçer; ÖNEMLİSİ `removeSackFromShipment` ve
  // `addSacksToShipment` TAHSİSLERİ YENİDEN HESAPLAR (`writeShipmentAllocationsTx`) —
  // ham UPDATE bunu yapmaz ve sipariş karşılanması hayaletin metresiyle ŞİŞMİŞ kalırdı.
  //
  // ⚠️ NEDEN AYRI BAYRAK: bu yol canlı bir sevkiyatı GEÇİCİ olarak bozar (çuval kısa
  // süre depoya döner, `seq` yeniden atanır, çuvalın brüt kg'si sıfırlanır). Operatör
  // o sevkiyatla çalışıyorsa görünen içerik değişir → bilinçli opt-in.
  //
  // ⚠️ SIRA ÖNEMLİ: çuvaldaki TÜM hayaletler geri eklemeden ÖNCE çıkarılır; aksi halde
  // `addSacksToShipment` → `loadSacksForShipment` guard'ı kalan hayalet yüzünden 400 verir.
  //
  // ⚠️ BU ONARIM KİLİTTEN ÖNCE YAPILMALI: `rolls_sackId_status_present` CHECK'i
  // eklendikten sonra `removeSackFromShipment`'in `roll.updateMany({shipmentId:null})`
  // adımı hayalet satıra dokunduğu için 23514 verir ve bu yol TIKANIR.
  let plannedFixed = 0;
  if (classB.length > 0 && REPAIR_PLANNED) {
    console.log(`\n── Sınıf B onarımı (PLANNED sevkiyat) ──`);
    const bySack = new Map<string, typeof classB>();
    for (const g of classB) bySack.set(g.sackId!, [...(bySack.get(g.sackId!) ?? []), g]);

    for (const [sackId, ghosts] of bySack) {
      const first = ghosts[0]!;
      const shipmentId = first.sack?.shipmentId ?? null;
      const sackNo = first.sack?.sackNo ?? sackId;
      if (!shipmentId) {
        skipped.push({ ref: sackNo, why: "sevkiyat bağı bu sırada kayboldu" });
        continue;
      }
      try {
        await shippingService.removeSackFromShipment(shipmentId, sackId, ACTOR);
        for (const g of ghosts) {
          await shippingService.removeRollFromSack({ rollId: g.id }, ACTOR);
          await AuditService.log({
            userId: ACTOR,
            action: "UPDATE",
            tableName: "ROLL",
            recordId: g.id,
            oldData: { sackId, sackNo, status: g.status, shipmentId },
            newData: {
              kind: "SACK_GHOST_REPAIR",
              sackId: null,
              status: g.status,
              script: "repair_sack_ghost_rolls",
              mode: "planned",
            },
          });
          plannedFixed++;
        }
        await shippingService.addSacksToShipment(shipmentId, [sackId], ACTOR);
        console.log(`  ✅ ${sackNo}: ${ghosts.length} hayalet çıkarıldı → çuval sevkiyata geri eklendi`);
      } catch (e) {
        // Yarıda kalırsa çuval DEPODA kalmış olabilir — sessiz bırakma.
        skipped.push({
          ref: sackNo,
          why:
            `${(e as Error).message} — ⚠️ çuval sevkiyata GERİ EKLENMEMİŞ olabilir; ` +
            `Sevk Kapısı'ndan kontrol edin`,
        });
      }
    }
  } else if (classB.length > 0) {
    console.log(
      `\nⓘ Sınıf B (${classB.length} top) ONARILMADI — bu yol canlı sevkiyatı geçici bozduğu\n` +
        `  için ayrı onay ister:  npx tsx scripts/repair_sack_ghost_rolls.ts --apply --planned`,
    );
  }

  console.log(
    `\n✅ Onarıldı: ${fixed} top çuvaldan çıkarıldı (statüleri değişmedi)` +
      (plannedFixed > 0 ? ` · sınıf B: ${plannedFixed} top` : ""),
  );
  if (skipped.length) {
    console.log(`⚠️  Atlandı: ${skipped.length}`);
    skipped.forEach((s) => console.log(`  ${s.ref} — ${s.why}`));
  }
  console.log(
    `\nSonraki adım: psql "$DATABASE_URL" -f scripts/consistency-check.sql → §7'de\n` +
      `yalnız sınıf B/C satırları kalmalı. §E listesindeki çuvalları yeniden tartın.`
  );
}

// ⚠️ `prisma.$disconnect()` TEK BAŞINA YETMEZ: `lib/prisma.ts` havuzu
// `idleTimeoutMillis: 600_000` ile kuruyor → idle client handle'ı event loop'u 10
// DAKİKA açık tutar ve script "bitti ama çıkmadı" görünür. `pool.end()` handle'ı
// gerçekten kapatır. `process.exit()` de çıkarırdı ama uzun raporu boruya/dosyaya
// yazarken stdout'u KIRPABİLİR (bu script'in çıktısı operatör kaydıdır) — bu yüzden
// zorla çıkış değil, düzgün kapanış.
main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(1);
  });
