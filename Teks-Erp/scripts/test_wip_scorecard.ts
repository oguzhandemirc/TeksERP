// =============================================================================
// Test: NEREDE TAKILDI (WIP) KARNESİ
// Çalıştır: npx tsx scripts/test_wip_scorecard.ts
// =============================================================================
// ÜÇ KRİTİK KURAL:
//   1. BEKLEYEN bölümü SNAPSHOT'tır — tarih filtresi onu ETKİLEMEZ. "Şu an
//      nerede takılı" sorusunu filtrelemek, önündeki yığını görmek isteyen
//      planlamacıyı yanıltırdı. Test aynı veriyi İKİ FARKLI dönemle sorgulayıp
//      bekleyen rakamının değişmediğini, geçen rakamının değiştiğini ölçer.
//   2. İSTASYON LİSTESİ İKİ KÜMENİN BİRLEŞİMİ — dönemde iş geçirmiş ama şu an
//      boş olan istasyon da satır alır. Düşerse "boş mu, hiç mi çalışmadı"
//      sorusu doğar ve operatör durur.
//   3. ORTALAMA BEKLEME TOP AĞIRLIKLI — istasyon ortalamalarının düz ortalaması,
//      1 toplu istasyon ile 50 toplu istasyonu eşit sayardı.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { getWipScorecard } from "../src/services/reports/wip-scorecard.report.service";
import type { DateRange } from "../src/services/reports/_shared";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const round1x = (n: number) => Math.round(n * 10) / 10;
const TAG = `TEST-WIP-${Date.now()}`;
const DAY = 86_400_000;
// ⚠️ Fixture GEÇMİŞE kurulur, diğer karne testlerindeki gibi geleceğe DEĞİL.
// Sebep: bu karnenin ana metriği YAŞ (`now() - enteredAt`) ve gelecek tarihli
// bir hareket NEGATİF yaş üretir (ilk yazımda −24684 gün çıktı). Dönem izolasyonu
// burada tarihle değil, kontrollerin KENDİ istasyon id'lerine kilitlenmesiyle
// sağlanır — komşu veri A/B satırlarına karışamaz.
const ENTERED = new Date(Date.now() - 3 * DAY);
const EXITED = new Date(ENTERED.getTime() + 6 * 3_600_000); // 6 saat
const OLD_ENTERED = new Date(Date.now() - 10 * DAY);
const RANGE: DateRange = {
  from: new Date(OLD_ENTERED.getTime() - DAY),
  to: new Date(Date.now() + DAY),
};
/** EXITED'i KAPSAMAYAN ikinci dönem — snapshot bağımsızlığını ölçmek için. */
const OTHER: DateRange = {
  from: new Date(ENTERED.getTime() - 30 * DAY),
  to: new Date(ENTERED.getTime() - 10 * DAY),
};

const ids = {
  movements: [] as string[], rolls: [] as string[], steps: [] as string[],
  wos: [] as string[], stations: [] as string[],
};

async function main(): Promise<void> {
  console.log("\n=== WIP Karnesi bekçisi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) { console.log("❌ Ön koşul yok"); fail++; return; }

  const mkStation = async (suffix: string) => {
    const s = await prisma.station.create({
      data: { code: `${TAG}-${suffix}`, name: `WIP ${suffix}`, type: "INTERNAL" },
      select: { id: true, name: true },
    });
    ids.stations.push(s.id);
    return s;
  };
  const stA = await mkStation("A"); // bekleyen mal var
  const stB = await mkStation("B"); // ŞU AN BOŞ, ama dönemde iş geçirdi

  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" }, select: { id: true },
  });
  ids.wos.push(wo.id);
  const mkStep = async (stationId: string, seq: number) => {
    const s = await prisma.workOrderStep.create({
      data: { workOrderId: wo.id, stationId, stepSequence: seq }, select: { id: true },
    });
    ids.steps.push(s.id);
    return s.id;
  };
  const stepA = await mkStep(stA.id, 1);
  const stepB = await mkStep(stB.id, 2);

  const mkRoll = async (qty: number) => {
    const r = await prisma.roll.create({
      data: {
        itemId: item.id, initialQty: qty, currentQty: qty, status: "IN_PRODUCTION",
        entrySource: "SUPPLIER_RECEIPT", barcode: `${TAG}-R${ids.rolls.length}`,
      },
      select: { id: true },
    });
    ids.rolls.push(r.id);
    return r.id;
  };
  const mkMovement = async (o: { stepId: string; qty: number; entered: Date; exited: Date | null }) => {
    const m = await prisma.rollMovement.create({
      data: {
        rollId: await mkRoll(o.qty), workOrderStepId: o.stepId,
        qtyIn: o.qty, qtyOut: o.exited ? o.qty : null,
        enteredAt: o.entered, exitedAt: o.exited,
      },
      select: { id: true },
    });
    ids.movements.push(m.id);
  };

  // ── FIXTURE ────────────────────────────────────────────────────────────────
  // A istasyonu: 2 top BEKLİYOR (300 + 100 m) — açık hareket
  await mkMovement({ stepId: stepA, qty: 300, entered: ENTERED, exited: null });
  await mkMovement({ stepId: stepA, qty: 100, entered: ENTERED, exited: null });
  // B istasyonu: şu an BOŞ ama dönemde 1 top geçti (6 saat kaldı)
  await mkMovement({ stepId: stepB, qty: 500, entered: ENTERED, exited: EXITED });
  // C istasyonu: 1 top, ÇOK DAHA ESKİ. Ağırlıklı ortalamayı düz ortalamadan
  // ayırt edilebilir kılan tek şey bu satır — onsuz iki hesap aynı sonucu
  // veriyordu ve "ağırlıklı" kontrolü VAKUMEN yeşil kalıyordu (ölçüldü).
  //   ağırlıklı = (3g×2 + 10g×1) / 3 ≈ 5,3    düz = (3g + 10g) / 2 = 6,5
  const stC = await mkStation("C");
  const stepC = await mkStep(stC.id, 3);
  await mkMovement({ stepId: stepC, qty: 50, entered: OLD_ENTERED, exited: null });

  const sc = await getWipScorecard(RANGE);
  const rowA = sc.byStation.find((r) => r.key === stA.id);
  const rowB = sc.byStation.find((r) => r.key === stB.id);

  // ── 1) ANLIK BEKLEYEN ─────────────────────────────────────────────────────
  console.log("── 1) Bekleyen (anlık) ──");
  check("A: 2 top bekliyor", rowA?.waitingCount === 2, `gelen: ${rowA?.waitingCount}`);
  check("A: bekleyen metraj 400 m", rowA?.waitingQty === 400, `gelen: ${rowA?.waitingQty}`);
  check("B: şu an bekleyen YOK", rowB?.waitingCount === 0, `gelen: ${rowB?.waitingCount}`);
  check(
    "kapanmış hareket bekleyen sayılmaz",
    rowA?.waitingCount === 2 && rowB?.waitingCount === 0,
    "B'nin 500 m'si kapandı, bekleyene girmemeli",
  );

  // ── 2) BOŞ İSTASYON LİSTEDEN DÜŞMEZ ───────────────────────────────────────
  console.log("\n── 2) Dönemde iş geçirmiş boş istasyon listede kalır ──");
  check("B satırı var", rowB !== undefined, "düşseydi 'boş mu, hiç mi çalışmadı' belirsiz kalırdı");
  check("B: dönemde 1 top geçti", rowB?.passedCount === 1, `gelen: ${rowB?.passedCount}`);
  check("B: ortalama süre 6 saat", rowB?.avgDurationHours === 6, `gelen: ${rowB?.avgDurationHours}`);
  check("B'nin adı çözüldü (bekleyen satırı olmasa da)", rowB?.label === stB.name, `gelen: ${rowB?.label}`);

  // ── 3) SNAPSHOT TARİH FİLTRESİNDEN BAĞIMSIZ ───────────────────────────────
  console.log("\n── 3) Bekleyen snapshot'tır, dönem onu etkilemez ──");
  const other = await getWipScorecard(OTHER);
  const otherA = other.byStation.find((r) => r.key === stA.id);
  check(
    "başka dönemde de A'da 400 m bekliyor",
    otherA?.waitingQty === 400,
    `gelen: ${otherA?.waitingQty}`,
  );
  check(
    "ama 'geçen' rakamı döneme DUYARLI (B artık 0)",
    (other.byStation.find((r) => r.key === stB.id)?.passedCount ?? 0) === 0,
    "ikisi de dönemden bağımsız olsaydı filtre anlamsızlaşırdı",
  );

  // ── 4) EN UZUN BEKLEYENLER ────────────────────────────────────────────────
  console.log("\n── 4) En uzun bekleyen listesi ──");
  // ⚠️ `oldestWaiting` TÜM VERİTABANI için `LIMIT 25` ile kesilir — yani ortamda
  // kaç açık hareket olduğuna bağlıdır. Bu test eskiden "üçü de listede" diyordu
  // ve dev DB'sinde 22'den fazla açık hareket olduğu anda düşüyordu (2026-08-19:
  // 24 gerçek bekleyen hareket vardı, fixture'ların ikisi listeden taşmıştı).
  // Bu, testin kendi kusuruydu — CLAUDE.md "ortamdaki veriye BAĞIMLI OLMA".
  // Doğru iddia: EN ESKİ fixture'ımız listede olmalı (o, yaş sırasında yukarıda)
  // ve bizim satırlarımız kendi aralarında ESKİDEN YENİYE sıralı olmalı.
  const mine = sc.oldestWaiting.filter((r) => r.barcode?.startsWith(TAG));
  check("en eski bekleyen fixture listede", mine.length >= 1, `gelen: ${mine.length} (liste 25 ile sınırlı)`);
  check(
    "bizim satırlarımız kendi aralarında eskiden yeniye sıralı",
    mine.every((r, i) => i === 0 || (mine[i - 1]?.daysWaiting ?? 0) >= r.daysWaiting),
    mine.map((r) => r.daysWaiting).join(" ≥ "),
  );
  // Sıra EN ESKİDEN başlar → ilk satır C (10 gün), A'nınkiler (3 gün) sonra.
  check("en eski bekleyen başta (C, 10 gün)", mine[0]?.stationName === stC.name, `gelen: ${mine[0]?.stationName}`);
  check("bekleme günü pozitif", (mine[0]?.daysWaiting ?? 0) > 0, `gelen: ${mine[0]?.daysWaiting}`);

  // ── 5) HİÇ BAŞLAMAMIŞ İŞ EMRİ ─────────────────────────────────────────────
  console.log("\n── 5) Hiç başlamamış canlı iş emirleri ──");
  const emptyWo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-EMPTY`, status: "PLANNED" }, select: { id: true },
  });
  ids.wos.push(emptyWo.id);
  const sc2 = await getWipScorecard(RANGE);
  check(
    "hareketsiz iş emri sayılıyor",
    sc2.summary.neverStartedWorkOrders > sc.summary.neverStartedWorkOrders,
    `${sc.summary.neverStartedWorkOrders} → ${sc2.summary.neverStartedWorkOrders}`,
  );
  check(
    "hareketi OLAN iş emri bu listeye girmez",
    !sc2.neverStarted.some((w) => w.workOrderNumber === `${TAG}-WO`),
    "fixture WO'sunun 3 hareketi var",
  );

  // ── 6) AĞIRLIKLI ORTALAMA ─────────────────────────────────────────────────
  console.log("\n── 6) Ortalama bekleme TOP AĞIRLIKLI ──");
  // Yalnız KENDİ istasyonlarımızın satırlarından hesapla — komşu veri karışmasın.
  const mineRows = sc.byStation.filter((r) => [stA.id, stB.id, stC.id].includes(r.key));
  const myCount = mineRows.reduce((a, r) => a + r.waitingCount, 0);
  const weighted =
    mineRows.reduce((a, r) => a + (r.avgWaitDays ?? 0) * r.waitingCount, 0) / myCount;
  const flat =
    mineRows.filter((r) => r.waitingCount > 0).reduce((a, r) => a + (r.avgWaitDays ?? 0), 0) /
    mineRows.filter((r) => r.waitingCount > 0).length;
  check(
    "ağırlıklı ve düz ortalama GERÇEKTEN farklı (fixture ayırt edici)",
    Math.abs(weighted - flat) > 0.5,
    `kendi istasyonlarımızda ağırlıklı ${round1x(weighted)} ↔ düz ${round1x(flat)}`,
  );
  // ⚠️ ASIL KONTROL: özet AĞIRLIKLI olanla örtüşmeli. Yukarıdaki satır yalnız
  // fixture'ın ayırt edici olduğunu söyler — ilk yazımda TEK kontrol oydu ve
  // "ağırlıksız ortalama" sondası YEŞİL geçiyordu (ölçüldü). Beklenen değer TÜM
  // satırlardan türetilir (komşu veri dahil), böylece ortamdan bağımsız kalır.
  const allCount = sc.byStation.reduce((a, r) => a + r.waitingCount, 0);
  const allWeighted =
    sc.byStation.reduce((a, r) => a + (r.avgWaitDays ?? 0) * r.waitingCount, 0) / allCount;
  const busy = sc.byStation.filter((r) => r.waitingCount > 0);
  const allFlat = busy.reduce((a, r) => a + (r.avgWaitDays ?? 0), 0) / busy.length;
  const dW = Math.abs((sc.summary.avgWaitDays ?? 0) - allWeighted);
  const dF = Math.abs((sc.summary.avgWaitDays ?? 0) - allFlat);
  check(
    "özet ortalaması AĞIRLIKLI hesaba uyuyor, düz hesaba değil",
    dW < 0.1 && dW < dF,
    `özet ${sc.summary.avgWaitDays} · ağırlıklı ${round1x(allWeighted)} (Δ${round1x(dW)}) · düz ${round1x(allFlat)} (Δ${round1x(dF)})`,
  );
  check(
    "3 bekleyen top: A'da 2 (3 gün) + C'de 1 (10 gün)",
    myCount === 3,
    `gelen: ${myCount}`,
  );
  check("özet bekleyen metrajı kırılımla tutuyor",
    sc.summary.waitingQty === Math.round(sc.byStation.reduce((a, r) => a + r.waitingQty, 0) * 10) / 10,
    `${sc.summary.waitingQty}`);
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    if (ids.movements.length) await prisma.rollMovement.deleteMany({ where: { id: { in: ids.movements } } });
    if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.steps.length) await prisma.workOrderStep.deleteMany({ where: { id: { in: ids.steps } } });
    if (ids.wos.length) await prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } });
    if (ids.stations.length) await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
