// =============================================================================
// TAHSİS TEŞHİSİ — "bu mal neden siparişe yazılmadı?" (SALT-OKUNUR)
// =============================================================================
// Çalıştır: npx tsx scripts/tahsis_teshis.ts            (tüm boşluklu sevkiyatlar)
//           npx tsx scripts/tahsis_teshis.ts <shipmentNo parçası>
//
// NEDEN VAR: sevk edilmiş sevkiyatların bir kısmında çuval içeriği sipariş
// defterine tam yazılmamış (ölçüm 2026-09-06: 42 sevkiyat / 11.384,7 m). "Neden"
// sorusunun cevabı bugüne kadar TAHMİNE dayanıyordu ve iki tahmin de ölçümle
// çürüdü — "fazla mal" değil (fazla sevk edilmiş kalem SIFIR) ve "şube" değil
// (64 çiftin 64'ü eşleşiyor). Bu betik tahsis motorunun KENDİ yüklemlerini
// (`specMatch`, şube eşleşmesi, kapasite) her top için SIRAYLA koşturur ve topun
// hangi adımda düştüğünü ADIYLA söyler.
//
// ⚠️ SALT-OKUNUR: tek bir yazma çağrısı yok. Amaç onarım değil TEŞHİS.
// ⚠️ BUGÜNÜN VERİSİYLE koşar; sevk ANINDAKİ durum farklı olabilir (sipariş miktarı
//    sonradan artmış, araya başka sevkiyat girmiş olabilir). Bu yüzden çıktı
//    "bugün yeniden denesek ne olurdu" sorusunu cevaplar. `YAZILABİLİRDİ` satırı
//    tam bu ayrışmayı ölçer: spec de kapasite de uygunsa sebep ZAMANLAMADIR.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { ShipmentStatus } from "@prisma/client";
import { specMatch } from "../src/services/helpers/allocation.helper";

const FILTRE = process.argv[2];

type Sebep =
  | "KUMAS_YOK"
  | "RENK_TUTMADI"
  | "EN_TUTMADI"
  | "SUBE_TUTMADI"
  | "KAPASITE_DOLU"
  | "YAZILABILIRDI";

const ETIKET: Record<Sebep, string> = {
  KUMAS_YOK: "kumaş sipariş kalemlerinde HİÇ yok",
  RENK_TUTMADI: "kumaş var ama RENK tutmuyor",
  EN_TUTMADI: "kumaş+renk var ama EN tutmuyor",
  SUBE_TUTMADI: "şube eşleşmiyor",
  KAPASITE_DOLU: "eşleşen kalem var ama KAPASİTE dolu",
  YAZILABILIRDI: "⚠️ bugün YAZILABİLİRDİ — sebep sevk anındaki durum (zamanlama)",
};

async function main(): Promise<void> {
  const sevkiyatlar = await prisma.shipment.findMany({
    where: {
      status: ShipmentStatus.DISPATCHED,
      ...(FILTRE ? { shipmentNo: { contains: FILTRE } } : {}),
      orders: { some: {} },
    },
    select: {
      id: true,
      shipmentNo: true,
      dispatchedAt: true,
      sacks: {
        select: {
          id: true,
          sackNo: true,
          branchId: true,
          rolls: {
            select: { id: true, barcode: true, itemId: true, colorId: true, width: true, currentQty: true },
          },
          allocations: { select: { qty: true } },
        },
      },
      orders: {
        select: {
          order: {
            select: {
              orderNumber: true,
              branchId: true,
              lines: {
                select: { id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true },
              },
            },
          },
        },
      },
    },
    orderBy: { dispatchedAt: "asc" },
  });

  const sayac = new Map<Sebep, { top: number; metre: number }>();
  const ekle = (s: Sebep, m: number): void => {
    const c = sayac.get(s) ?? { top: 0, metre: 0 };
    c.top += 1;
    c.metre += m;
    sayac.set(s, c);
  };
  let boslukluSevkiyat = 0;

  for (const sh of sevkiyatlar) {
    const icerik = sh.sacks.reduce(
      (a, sk) => a + sk.rolls.reduce((b, r) => b + Number(r.currentQty), 0),
      0,
    );
    const tahsis = sh.sacks.reduce(
      (a, sk) => a + sk.allocations.reduce((b, x) => b + Number(x.qty), 0),
      0,
    );
    const bosluk = Math.round((icerik - tahsis) * 1000) / 1000;
    if (bosluk <= 0.001) continue;
    boslukluSevkiyat++;

    const kalemler = sh.orders.flatMap((so) =>
      so.order.lines.map((l) => ({
        ...l,
        orderNumber: so.order.orderNumber,
        branchId: so.order.branchId,
        /** Motorun gördüğü ihtiyaç: ısmarlanan − sevk edilen. */
        kalan: Number(l.quantity) - Number(l.shippedQty),
      })),
    );

    console.log(
      `\n═══ ${sh.shipmentNo}  (${sh.dispatchedAt?.toISOString().slice(0, 10) ?? "?"})  boşluk ${Math.round(bosluk)} m ═══`,
    );
    const yerel = new Map<Sebep, number>();
    const say = (s: Sebep, m: number): void => {
      ekle(s, m);
      yerel.set(s, (yerel.get(s) ?? 0) + m);
    };

    for (const sk of sh.sacks) {
      for (const r of sk.rolls) {
        const metre = Number(r.currentQty);
        // Motorun yüklemleri SIRAYLA — top hangisinde düşüyorsa sebep odur.
        const kumasVar = kalemler.filter((l) => l.itemId === r.itemId);
        if (kumasVar.length === 0) {
          say("KUMAS_YOK", metre);
          continue;
        }
        const renkVar = kumasVar.filter(
          (l) => !(l.colorId != null && r.colorId != null && l.colorId !== r.colorId),
        );
        if (renkVar.length === 0) {
          say("RENK_TUTMADI", metre);
          continue;
        }
        const specVar = renkVar.filter((l) => specMatch(r, l));
        if (specVar.length === 0) {
          say("EN_TUTMADI", metre);
          continue;
        }
        const subeVar = specVar.filter((l) => (sk.branchId ?? null) === (l.branchId ?? null));
        if (subeVar.length === 0) {
          say("SUBE_TUTMADI", metre);
          continue;
        }
        say(subeVar.some((l) => l.kalan > 0.001) ? "YAZILABILIRDI" : "KAPASITE_DOLU", metre);
      }
    }
    for (const [s, m] of [...yerel.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${ETIKET[s]}: ${Math.round(m)} m`);
    }
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log(`TOPLAM: ${boslukluSevkiyat} boşluklu sevkiyat\n`);
  const sirali = [...sayac.entries()].sort((a, b) => b[1].metre - a[1].metre);
  for (const [s, c] of sirali) {
    console.log(
      `  ${String(Math.round(c.metre)).padStart(7)} m  ${String(c.top).padStart(4)} top   ${ETIKET[s]}`,
    );
  }
  console.log(
    "\n⚠️ Tablo BUGÜNÜN verisiyle hesaplandı ve ÇUVAL İÇERİĞİNİN TAMAMINI sınıflar",
  );
  console.log("   (tahsis edilmiş kısım da dahil). Onarım için bakılacak küme `YAZILABİLİRDİ`.");
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
