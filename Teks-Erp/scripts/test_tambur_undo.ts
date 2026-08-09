// =============================================================================
// Test: TAMBUR GERİ AL — 2026-08-09 yeniden yazımı
// Çalıştır: npx tsx scripts/test_tambur_undo.ts
// =============================================================================
// SAHA VAKASI (IE0808260001, 2026-08-08): operatör BİR topa "Geri Al" dedi,
// **14 top birden iptal oldu**, 520,5 m kaynağa geri yazıldı, tamamlanmış iş
// emri diriltildi. Kaynak top o günden beri `initialQty=500` iken
// `currentQty=520,5` taşıyor (DB'deki TEK böyle satır).
//
// Bu bekçi dört kök nedeni de kilitler:
//   §1 MOD SORULUYOR — `options[]` iki seçeneği de döner, `defaultMode` EN DAR
//   §2 ESKİ İSTEMCİ (mod göndermeyen) tek parça iptaline düşer — 14 top DEĞİL
//   §3 Finalize SONRASI tekil iptal ÇALIŞIR ve metraj SAPMA olarak yazılır
//      (bu yol 2026-08-09'a kadar HİÇ YOKTU — asıl eksik oydu)
//   §4 FULL yetki + sebep kapıları (günlük operatör iş emrini yeniden yazamaz)
//   §5 METRAJ İNVARİANTI — aşımlı kesimde bile `currentQty <= initialQty`
//      (saha vakasının BİREBİR yeniden üretimi)
//   §6 DEPO KESİMİ ÇIKMAZI kapandı (9 kaynağın 6'sı bu durumdaydı)
//   §7 Sapma defteri TERSLENİR (hayalet fire kalmaz)
//
// Fixture kendi verisini üretir (ortam verisine bağımlı DEĞİL), finally'de siler.
// =============================================================================
import { Prisma, RollStatus, RollVarianceKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { TamburUndoService, UNDO_FULL_PERMISSION } from "../src/services/tambur-undo.service";

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

const tambur = new TamburService();
const undo = new TamburUndoService();

interface Preview {
  mode: string;
  defaultMode: string;
  parentArchived: boolean;
  canApply: boolean;
  blockReason: string | null;
  restoredQty: number;
  children: Array<{ id: string; barcode: string | null }>;
  options: Array<{ mode: string; canApply: boolean; affectedCount: number; restoredQty: number; requiresReason: boolean; blockReason: string | null }>;
}

const pv = async (rollId: string, opts?: Parameters<typeof undo.getUndoPreview>[1]): Promise<Preview> =>
  ((await undo.getUndoPreview(rollId, opts)).data as unknown) as Preview;

function errStatus(e: unknown): number {
  return (e as { statusCode?: number })?.statusCode ?? 0;
}

async function main(): Promise<void> {
  const ts = Date.now();
  const rollIds: string[] = [];
  let itemId = "";
  const ADMIN = [UNDO_FULL_PERMISSION];

  /** Depo topu + N kesim üretir. `overCut` son kesimde aşım yaptırır. */
  const buildCutSession = async (
    tag: string,
    initial: number,
    cuts: number[],
  ): Promise<{ parentId: string; childIds: string[] }> => {
    const parent = await prisma.roll.create({
      data: {
        barcode: `TEST-UNDO-${tag}-${ts}`,
        itemId,
        status: RollStatus.WAREHOUSE,
        initialQty: initial,
        currentQty: initial,
        qualityGrade: "1.KALITE",
        entrySource: "MANUAL_ENTRY",
      },
      select: { id: true },
    });
    rollIds.push(parent.id);
    const childIds: string[] = [];
    for (const len of cuts) {
      const res = await tambur.cutWarehouseRoll(
        parent.id,
        { cutLength: len, qualityGrade: "1.KALITE" },
        undefined,
      );
      const childId = (res.data as { childRoll: { id: string } }).childRoll.id;
      childIds.push(childId);
      rollIds.push(childId);
    }
    return { parentId: parent.id, childIds };
  };

  try {
    const item = await prisma.item.create({
      data: { code: `TEST-UNDO-${ts}`, name: `TEST Geri Al ${ts}`, itemType: "FABRIC" },
      select: { id: true },
    });
    itemId = item.id;

    // ── §1 MOD SORULUYOR ────────────────────────────────────────────────────
    console.log("\n── §1 Mod artık SORULUYOR (sistemden türetilmiyor) ──");

    const s1 = await buildCutSession("S1", 100, [30, 30]);
    await tambur.finalizeWarehouseCut(
      s1.parentId,
      { remainingAction: "discard", varianceReasonCode: "OLCUM_HATASI" },
      undefined,
      null,
    );

    const p1 = await pv(s1.childIds[0]!);
    check(
      "kapanmış kaynağın çocuğunda İKİ seçenek de sunuluyor",
      p1.options.length === 2 &&
        p1.options.some((o) => o.mode === "SINGLE") &&
        p1.options.some((o) => o.mode === "FULL"),
      `options=[${p1.options.map((o) => o.mode).join(",")}]`,
    );
    check(
      "varsayılan mod EN DAR olan (SINGLE)",
      p1.defaultMode === "SINGLE",
      `defaultMode=${p1.defaultMode}`,
      );
    check("kaynak arşivde işareti geliyor", p1.parentArchived === true);
    check(
      "FULL seçeneği SEBEP istiyor",
      p1.options.find((o) => o.mode === "FULL")?.requiresReason === true,
    );
    check(
      "SINGLE seçeneği sebep İSTEMİYOR",
      p1.options.find((o) => o.mode === "SINGLE")?.requiresReason === false,
    );
    check(
      "FULL seçeneği kapsamı SOMUT söylüyor (2 top)",
      p1.options.find((o) => o.mode === "FULL")?.affectedCount === 2,
      `affected=${p1.options.find((o) => o.mode === "FULL")?.affectedCount}`,
    );
    check(
      "SINGLE seçeneği kapsamı 1 top",
      p1.options.find((o) => o.mode === "SINGLE")?.affectedCount === 1,
    );

    // ── §2 ESKİ İSTEMCİ tek parçaya düşer ───────────────────────────────────
    console.log("\n── §2 Eski istemci (mod göndermeyen) ──");

    await undo.applyUndo(s1.childIds[0]!, undefined, { permissions: ADMIN });
    const afterS1 = await prisma.roll.findMany({
      where: { id: { in: s1.childIds } },
      select: { id: true, status: true },
    });
    const cancelledCount = afterS1.filter((r) => r.status === RollStatus.CANCELLED).length;
    check(
      "⭐ mod GÖNDERİLMEYİNCE yalnız 1 top iptal (14 DEĞİL)",
      cancelledCount === 1,
      `${cancelledCount} top iptal — saha vakasının doğrudan testi`,
    );
    const s1Parent = await prisma.roll.findUnique({
      where: { id: s1.parentId },
      select: { status: true },
    });
    check(
      "kaynak top ARŞİVDE KALDI (tek top için diriltilmedi)",
      s1Parent?.status === RollStatus.TAMBUR_CONSUMED,
      String(s1Parent?.status),
    );

    // ── §3 Arşiv dalında metraj SAPMA olarak yazılır ─────────────────────────
    console.log("\n── §3 Finalize sonrası tekil iptal (2026-08-09'da açıldı) ──");

    const vr = await prisma.rollVariance.findMany({
      where: { rollId: s1.childIds[0]!, source: "TAMBUR_UNDO_SINGLE" },
      select: { kind: true, qty: true },
    });
    check("iptal edilen top için sapma satırı yazıldı", vr.length === 1);
    check(
      "türü KAYIT DÜZELTMESİ (fire DEĞİL)",
      vr[0]?.kind === RollVarianceKind.RECORD_CORRECTION,
    );
    check("metraj doğru", Number(vr[0]?.qty) === 30, `${vr[0]?.qty} m`);

    // ── §4 FULL kapıları ────────────────────────────────────────────────────
    console.log("\n── §4 FULL: yetki + sebep kapıları ──");

    const s4 = await buildCutSession("S4", 100, [40]);
    await tambur.finalizeWarehouseCut(
      s4.parentId,
      { remainingAction: "keep_1kalite" },
      undefined,
      null,
    );

    let st = 0;
    try {
      await undo.applyUndo(s4.parentId, undefined, {
        mode: "FULL",
        reason: "yanlış top okutuldu",
        permissions: ["mobile:tambur"],
      });
    } catch (e) {
      st = errStatus(e);
    }
    check(
      "yetkisiz kullanıcı TÜMDEN geri alamaz (403)",
      st === 403,
      `status=${st}`,
    );

    st = 0;
    try {
      await undo.applyUndo(s4.parentId, undefined, { mode: "FULL", permissions: ADMIN });
    } catch (e) {
      st = errStatus(e);
    }
    check("sebepsiz TÜMDEN geri alma reddedilir (403)", st === 403, `status=${st}`);

    // ── §5 METRAJ İNVARİANTI (saha vakasının yeniden üretimi) ───────────────
    console.log("\n── §5 ⭐ Aşımlı kesimde metraj invariantı ──");

    // 100 m kayıtlı top; 40 + 40 kesildi (kalan 20), sonra 50 m kesildi (AŞIM).
    // Çıkan toplam = 130 m > kayıtlı 100 m. Eski kod bunu kaynağa yazıp
    // `currentQty(130) > initialQty(0)` üretiyordu.
    const s5 = await buildCutSession("S5", 100, [40, 40, 50]);
    const beforeClose = await prisma.roll.findUnique({
      where: { id: s5.parentId },
      select: { currentQty: true, initialQty: true },
    });
    check(
      "aşımlı kesim kaynağı tamamen tüketti",
      Number(beforeClose?.currentQty) === 0,
      `cur=${beforeClose?.currentQty} init=${beforeClose?.initialQty}`,
    );
    const overRows = await prisma.rollVariance.findMany({
      where: { rollId: s5.parentId, kind: RollVarianceKind.OVERAGE },
      select: { qty: true },
    });
    check(
      "AŞIM deftere yazıldı (2026-08-09 öncesi hiç yazılmıyordu)",
      overRows.length === 1 && Number(overRows[0]?.qty) === 30,
      `${overRows.map((r) => r.qty).join(",")} m`,
    );

    await tambur.finalizeWarehouseCut(s5.parentId, { remainingAction: "discard" }, undefined, null);
    await undo.applyUndo(s5.parentId, undefined, {
      mode: "FULL",
      reason: "test — aşımlı oturum geri alınıyor",
      permissions: ADMIN,
    });

    const s5After = await prisma.roll.findUnique({
      where: { id: s5.parentId },
      select: { currentQty: true, initialQty: true, status: true, preTamburCloseQty: true },
    });
    check(
      "⭐ currentQty > initialQty OLUŞMADI (saha vakasının hasarı)",
      Number(s5After?.currentQty) <= Number(s5After?.initialQty),
      `cur=${s5After?.currentQty} init=${s5After?.initialQty}`,
    );
    check(
      "geri konan metraj çıkan toplamla tutarlı (130 m)",
      Number(s5After?.currentQty) === 130,
      `cur=${s5After?.currentQty}`,
    );
    check(
      "kapanış-öncesi kayıt TÜKETİLDİ (bayat değer kalmadı)",
      s5After?.preTamburCloseQty === null,
    );

    // ── §6 DEPO KESİMİ ÇIKMAZI ──────────────────────────────────────────────
    console.log("\n── §6 Depo kesimi çıkmazı kapandı ──");

    check(
      "⭐ depo kesimi kapanışı artık TÜMDEN geri alınabiliyor",
      s5After?.status === RollStatus.WAREHOUSE,
      `kaynak ${s5After?.status} — eskiden "kalıcı işlem izi yok" ile reddediliyordu`,
    );
    const s5Children = await prisma.roll.findMany({
      where: { parentRollId: s5.parentId },
      select: { status: true },
    });
    check(
      "tüm parçalar iptal edildi",
      s5Children.length === 3 && s5Children.every((c) => c.status === RollStatus.CANCELLED),
      `${s5Children.filter((c) => c.status === RollStatus.CANCELLED).length}/${s5Children.length}`,
    );

    // ── §7 Sapma defteri TERSLENİR ──────────────────────────────────────────
    console.log("\n── §7 Sapma defteri terslenir (hayalet fire kalmaz) ──");

    // NOT: §5 oturumu aşım yüzünden kalansız kapandı (kalan 0 → sapma satırı
    // YAZILMAZ, doğru davranış). Tersleme için kalanı ATILAN ayrı bir oturum
    // gerekiyor — aynı zamanda "atılan kalan geri konan metraja EKLENİR"
    // kuralının da tek testi bu.
    const s7 = await buildCutSession("S7", 100, [30]);
    await tambur.finalizeWarehouseCut(
      s7.parentId,
      { remainingAction: "discard", varianceReasonCode: "OLCUM_HATASI" },
      undefined,
      null,
    );
    const s7Before = await prisma.rollVariance.findMany({
      where: { rollId: s7.parentId, source: "TAMBUR_WAREHOUSE_FINALIZE" },
      select: { qty: true, reversedAt: true },
    });
    check(
      "kapanış sapması yazıldı (atılan 70 m)",
      s7Before.length === 1 && Number(s7Before[0]?.qty) === 70,
      `${s7Before.map((v) => v.qty).join(",")} m`,
    );
    check("tersleme ÖNCESİ işaret yok", s7Before[0]?.reversedAt === null);

    await undo.applyUndo(s7.parentId, undefined, {
      mode: "FULL",
      reason: "test — kalanı atılmış oturum geri alınıyor",
      permissions: ADMIN,
    });

    const s7After = await prisma.roll.findUnique({
      where: { id: s7.parentId },
      select: { currentQty: true, initialQty: true },
    });
    check(
      "⭐ ATILAN kalan geri konan metraja EKLENDİ (30 kesim + 70 atılan = 100)",
      Number(s7After?.currentQty) === 100,
      `cur=${s7After?.currentQty} — düz Σ(çocuklar) kullanılsaydı 30 çıkardı`,
    );
    // ⚠️ initialQty 70'ten 100'e ÇIKAR ve bu doğrudur: `cutWarehouseRoll` her
    // kesimde initialQty'yi de düşürür (100 → 70), geri alma onu geri ekler.
    // "Değişmedi" diye okuma — orijinal değerine DÖNER.
    check(
      "initialQty kesim öncesi değerine DÖNDÜ (70 → 100)",
      Number(s7After?.initialQty) === 100,
      `init=${s7After?.initialQty}`,
    );

    const s7Vars = await prisma.rollVariance.findMany({
      where: { rollId: s7.parentId },
      select: { kind: true, source: true, reversedAt: true, qty: true },
    });
    const closeVar = s7Vars.find((v) => v.source === "TAMBUR_WAREHOUSE_FINALIZE");
    check(
      "kapanışın sapma satırı TERSLENDİ (silinmedi)",
      closeVar != null && closeVar.reversedAt !== null,
      closeVar ? "reversedAt dolu" : "satır yok",
    );
    check(
      "satır SİLİNMEDİ (append-only defter)",
      s7Vars.filter((v) => v.source === "TAMBUR_WAREHOUSE_FINALIZE").length === 1,
    );

    const s5Vars = await prisma.rollVariance.findMany({
      where: { rollId: s5.parentId },
      select: { kind: true, source: true, reversedAt: true },
    });
    const cutOverage = s5Vars.find(
      (v) => v.source === "TAMBUR_OVERCUT" && v.kind === RollVarianceKind.OVERAGE,
    );
    check(
      "kesim AŞIMI terslenmedi (kesimler gerçekten yapıldı)",
      cutOverage != null && cutOverage.reversedAt === null,
      "kapanışın terslenmesi kesim ölçümünü geçersiz kılmaz",
    );

    // ── §8 ÖNİZLEME = UYGULAMA (2026-08-09 kod incelemesi) ──────────────────
    // Bu bölüm bir KÖR NOKTAYI kapatıyor: §1-§7 hep UYGULAMA sonucunu ölçüyor,
    // hiçbiri "diyalogda yazan sayı ile olan şey aynı mı" diye sormuyordu.
    // İncelemede ölçülen üç ayrışma da tam oradan geçmişti:
    //   (a) önizleme 200 m derken uygulama 500 m geri koyuyordu
    //       (`preTamburCloseQty` "kapanıştaki currentQty"dir = parçalı kesimde
    //        KALAN; toplam sanılmıştı),
    //   (b) yetkisiz kullanıcıya önizleme `canApply:true` diyordu, uç 403,
    //   (c) uygulanamayan mod açıkça istendiğinde SESSİZCE diğerine düşülüyordu.
    // Üçü de aynı sınıf: **operatöre söylenen ≠ yapılan** — yani bu dosyanın var
    // olma sebebi olan saha vakasının küçük kopyaları.
    console.log("\n── §8 ⭐ Önizleme ile uygulama AYNI şeyi söylüyor ──");

    const s8 = await buildCutSession("S8", 500, [100, 100, 100]);
    await tambur.finalizeWarehouseCut(
      s8.parentId,
      { remainingAction: "discard", varianceReasonCode: "OLCUM_HATASI" },
      undefined,
      null,
    );
    const s8Stored = await prisma.roll.findUnique({
      where: { id: s8.parentId },
      select: { preTamburCloseQty: true },
    });
    // Zemin: kolon gerçekten KALAN'ı taşıyor olmalı (200), yoksa aşağıdaki
    // kontrol "yanlış sebeple yeşil" kalır — kolon toplamı taşısaydı hatalı
    // formül de doğru sayıyı üretirdi ve test hiçbir şey kanıtlamazdı.
    check(
      "zemin: preTamburCloseQty KALAN'ı taşıyor (200), toplamı değil",
      Number(s8Stored?.preTamburCloseQty) === 200,
      `kolon=${s8Stored?.preTamburCloseQty} — 500 olsaydı bu bölüm körleşirdi`,
    );

    const s8Pv = await pv(s8.parentId, { mode: "FULL", permissions: ADMIN });
    const s8PvFull = s8Pv.options.find((o) => o.mode === "FULL");
    const s8Applied = (
      await undo.applyUndo(s8.parentId, undefined, {
        mode: "FULL",
        reason: "test — önizleme/uygulama mutabakatı",
        permissions: ADMIN,
      })
    ).data as { restoredQty: number };
    const s8Row = await prisma.roll.findUnique({
      where: { id: s8.parentId },
      select: { currentQty: true },
    });
    check(
      "⭐ önizlemedeki metraj UYGULANANLA aynı",
      s8PvFull?.restoredQty === s8Applied.restoredQty,
      `önizleme=${s8PvFull?.restoredQty} · uygulama=${s8Applied.restoredQty}`,
    );
    check(
      "⭐ ve ikisi de DB'ye yazılanla aynı (300 kesim + 200 atılan = 500)",
      s8PvFull?.restoredQty === 500 && Number(s8Row?.currentQty) === 500,
      `önizleme=${s8PvFull?.restoredQty} · kaynak=${s8Row?.currentQty}`,
    );

    // (b) Yetki önizlemeye DE yansır — "görünür ama basınca 403" olmaz.
    const s8b = await buildCutSession("S8B", 200, [50]);
    await tambur.finalizeWarehouseCut(
      s8b.parentId,
      { remainingAction: "discard", varianceReasonCode: "OLCUM_HATASI" },
      undefined,
      null,
    );
    const s8bPv = await pv(s8b.parentId, { mode: "FULL", permissions: ["mobile:tambur"] });
    const s8bFull = s8bPv.options.find((o) => o.mode === "FULL");
    check(
      "⭐ yetkisiz kullanıcının ÖNİZLEMESİ de FULL'ü engelli gösterir",
      s8bFull?.canApply === false && (s8bFull?.blockReason ?? "").includes("yetkiniz yok"),
      `canApply=${s8bFull?.canApply} block=${s8bFull?.blockReason ?? "-"}`,
    );
    // Yetkili aynı topta engelsiz görmeli — yoksa yukarıdaki kontrol "her zaman
    // engelli" diye de yeşil kalırdı (körlük zemini).
    const s8bAdminPv = await pv(s8b.parentId, { mode: "FULL", permissions: ADMIN });
    check(
      "zemin: YETKİLİ kullanıcı aynı topta engelsiz görür",
      s8bAdminPv.options.find((o) => o.mode === "FULL")?.canApply === true,
    );
    // Sebep kapısı önizlemede KOŞMAZ (aynı diyalogda doldurulacak alan) ama
    // uygulamada koşar — ikisinin ayrı olması bilinçli.
    let s8bSt = 0;
    try {
      await undo.applyUndo(s8b.parentId, undefined, { mode: "FULL", permissions: ADMIN });
    } catch (e) {
      s8bSt = errStatus(e);
    }
    check(
      "sebep kapısı önizlemede yok ama UYGULAMADA var (403)",
      s8bSt === 403,
      `status=${s8bSt}`,
    );

    // (c) Uygulanamayan mod açıkça istenirse SESSİZCE düşülmez.
    const s8c = await buildCutSession("S8C", 100, [40]);
    let s8cSt = 0;
    try {
      // Kaynak YAŞIYOR (finalize edilmedi) → FULL mümkün değil.
      await undo.applyUndo(s8c.childIds[0]!, undefined, {
        mode: "FULL",
        reason: "test — uygulanamaz mod",
        permissions: ADMIN,
      });
    } catch (e) {
      s8cSt = errStatus(e);
    }
    const s8cChild = await prisma.roll.findUnique({
      where: { id: s8c.childIds[0]! },
      select: { status: true },
    });
    check(
      "⭐ uygulanamayan mod SESSİZCE diğerine düşmez (409)",
      s8cSt === 409,
      `status=${s8cSt}`,
    );
    check(
      "⭐ ve hiçbir şey YAPILMADI (sessiz tek-parça iptali olmadı)",
      s8cChild?.status !== RollStatus.CANCELLED,
      `çocuk=${s8cChild?.status}`,
    );
  } finally {
    if (rollIds.length) {
      const all = await prisma.roll.findMany({
        where: { OR: [{ id: { in: rollIds } }, { parentRollId: { in: rollIds } }] },
        select: { id: true },
      });
      const ids = all.map((r) => r.id);
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.roll.deleteMany({ where: { parentRollId: { in: ids } } });
      await prisma.roll.deleteMany({ where: { id: { in: ids } } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
  }
}

main().then(
  () => process.exit(fail > 0 ? 1 : 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
