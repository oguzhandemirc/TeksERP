// =============================================================================
// AUDIT REPRO — BULGU-T1-011: Tambur geri almasıyla iptal edilen KESİM ÇOCUĞU
// "İptali Geri Al" (POST /api/rolls/:id/restore-cancel) ile diriltilebiliyor.
// Metrajı geri alma sırasında ZATEN kaynak topa iade edilmişti → aynı metre
// sistemde İKİ KEZ canlı olur (hayalet stok).
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (devDbGuard).
// Beklenen (sağlıklı sistem): restoreCancelledRoll 409 RESTORE_BLOCKED verir
//   ("bu top bir kesimin parçasıydı, metrajı kaynağa iade edildi") ve
//   Σ(canlı metraj) kesim öncesi toplamla AYNI kalır.
// Gözlenen: <koşumda doldurulur — log audit/repro/BULGU-T1-011.log>
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_BULGU-T1-011.ts
//
// SINIF: yarış DEĞİL — eksik guard yüklemi. Bu yüzden kanıt "tek istekle
// davranışsal": tek sıralı çağrı zinciri, 10 tekrar (determinizm ölçümü).
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch { throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)"); }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { randomUUID } from "crypto";
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { TamburUndoService } from "../src/services/tambur-undo.service";
import { InventoryService } from "../src/services/inventory.service";
import { RollStatus } from "@prisma/client";

const STAMP = `AUDITREPRO-T1-011-${randomUUID().slice(0, 6).toUpperCase()}`;
const tambur = new TamburUndoService();
const tamburSvc = new TamburService();
const inventory = new InventoryService();

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
const num = (d: unknown): number => Number(d as never);

/** Bu koşumda yaratılan her top — finally temizliği yalnız bunlara dokunur. */
const createdRolls: string[] = [];

async function liveQty(ids: string[]): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ sum: string | null }[]>(
    `SELECT COALESCE(SUM("currentQty"),0)::text AS sum FROM rolls
      WHERE id = ANY($1::uuid[]) AND status NOT IN ('CANCELLED','SCRAP','TAMBUR_CONSUMED')`,
    ids,
  );
  return Number(rows[0]?.sum ?? 0);
}

async function makeParent(itemId: string): Promise<{ id: string; barcode: string }> {
  const barcode = `T-${STAMP}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const roll = await prisma.roll.create({
    data: {
      itemId, barcode,
      initialQty: 100, currentQty: 100,
      status: RollStatus.WAREHOUSE,
      entrySource: "SUPPLIER_RECEIPT",
      entryReason: STAMP,
    },
    select: { id: true, barcode: true },
  });
  createdRolls.push(roll.id);
  return { id: roll.id, barcode: roll.barcode! };
}

/** Tek tur: kes → geri al → iptali geri al. Bozulma varsa fazla metrajı döner. */
async function oneRound(itemId: string, tur: number, verbose: boolean): Promise<number> {
  const parent = await makeParent(itemId);
  const oncesi = await liveQty([parent.id]);              // 100

  // ── 1) DEPO TOPU KESİMİ (cutWarehouseRoll) ───────────────────────────────
  const cut = await tamburSvc.cutWarehouseRoll(parent.id, { cutLength: 40 });
  const childId = cut.data!.childRoll.id;
  createdRolls.push(childId);
  const sonrasiKesim = await liveQty([parent.id, childId]); // 60 + 40 = 100

  // ── 2) TAMBUR GERİ ALMA (SINGLE) — metraj kaynağa İADE ────────────────────
  const undo = await tambur.applyUndo(childId);
  const undoData = undo.data as { mode: string; restoredQty: number };
  const sonrasiUndo = await liveQty([parent.id, childId]);  // 100 + 0 = 100

  const cocuk = await prisma.roll.findUniqueOrThrow({
    where: { id: childId },
    select: { status: true, currentQty: true, parentRollId: true, preCancelStatus: true, cancelledAt: true },
  });

  // ── 2b) OKUTMA YÜZEYİ NE DİYOR? (restore'dan ÖNCE ölçülmeli — restore
  //        statüyü değiştirince buildCancelDiagnostics null döner ve sonda
  //        sessizce "undefined" ölçer: yanlış çıpa = kör bekçi.)
  const diagResp = await inventory.findRollByBarcode(cut.data!.childRoll.barcode!);
  const diag = diagResp.data as unknown as
    { canRestore?: boolean; restoreBlockReason?: string | null } | null;

  // ── 3) "İPTALİ GERİ AL" — guard bunu DURDURMALI ───────────────────────────
  let restoreHata: string | null = null;
  let restoreStatus: RollStatus | null = null;
  try {
    const r = await inventory.restoreCancelledRoll(childId, undefined, { reason: STAMP });
    restoreStatus = (r.data as { status: RollStatus }).status;
  } catch (e) {
    restoreHata = (e as Error).message;
  }
  const sonrasiRestore = await liveQty([parent.id, childId]);
  const fazla = sonrasiRestore - oncesi;

  if (verbose) {
    console.log(`\n── TUR ${tur} (parent ${parent.barcode}) ──`);
    console.log(`   kesim öncesi canlı metraj      : ${oncesi} m`);
    console.log(`   kesimden sonra (parent+çocuk)  : ${sonrasiKesim} m`);
    console.log(`   geri almadan sonra             : ${sonrasiUndo} m   (mod=${undoData.mode}, iade=${undoData.restoredQty} m)`);
    console.log(`   çocuk: status=${cocuk.status} qty=${num(cocuk.currentQty)} parentRollId=${cocuk.parentRollId ? "DOLU" : "null"} preCancelStatus=${cocuk.preCancelStatus ?? "NULL"} cancelledAt=${cocuk.cancelledAt ? "damgalı" : "NULL"}`);
    console.log(`   okutma yüzeyi (barkod sorgusu) : canRestore=${String(diag?.canRestore)} blockReason=${String(diag?.restoreBlockReason)}`);
    console.log(`   restoreCancelledRoll           : ${restoreHata ? "REDDETTİ → " + restoreHata : "KABUL ETTİ → çocuk statüsü " + restoreStatus}`);
    console.log(`   "iptali geri al" sonrası       : ${sonrasiRestore} m   (FAZLA: ${fazla} m)`);
  }

  if (tur === 1) {
    console.log("\n=== §1 Zeminin doğruluğu (bulgu buna dayanıyor) ===");
    check("kesim korunumlu: parent+çocuk = kesim öncesi", sonrasiKesim === oncesi, `${sonrasiKesim} = ${oncesi}`);
    check("Tambur geri alma metrajı kaynağa İADE etti", undoData.restoredQty === 40 && sonrasiUndo === oncesi, `iade=${undoData.restoredQty} m, toplam=${sonrasiUndo} m`);
    check("çocuk CANCELLED", cocuk.status === RollStatus.CANCELLED);
    check("çocuğun currentQty'si SIFIRLANMADI (metraj kaydı üstünde duruyor)", num(cocuk.currentQty) === 40, `${num(cocuk.currentQty)} m`);
    check("çocuk parentRollId taşıyor (kesim çocuğu olduğunun tek işareti)", cocuk.parentRollId != null);
    check("preCancelStatus YAZILMADI (tambur-undo updateMany yalnız status yazıyor)", cocuk.preCancelStatus === null);
    check("cancelledAt YAZILMADI", cocuk.cancelledAt === null);

    console.log("\n=== §2 Guard yüklemi çocuğu görüyor mu? ===");
    check("okutma yüzeyi 'Geri Al' YAPILABİLİR diyor (canRestore=true)", diag?.canRestore === true, `canRestore=${String(diag?.canRestore)} reason=${String(diag?.restoreBlockReason)}`);

    console.log("\n=== §3 BEKLENEN: uç reddetmeli ===");
    check("restoreCancelledRoll 409 RESTORE_BLOCKED verir", restoreHata !== null, restoreHata ?? "REDDETMEDİ — kabul etti");
    check("çocuk iptalde KALIR", restoreStatus === null, `statü=${restoreStatus}`);
    check("Σ canlı metraj korunur (çift sayım yok)", fazla === 0, `fazla ${fazla} m`);
    check("çocuk WAREHOUSE'da doğmuştu — dirilirse rafı da yanlış (STOCK)", restoreStatus !== RollStatus.STOCK, `statü=${restoreStatus}`);
  }
  return fazla;
}

/**
 * §4 KONTROL GRUBU (negatif sonda) — bulgu "restore bozuk" DEĞİL, "restore
 * kesim çocuğunu ayırt edemiyor" diyor. Ebeveyni OLMAYAN, elle iptal edilmiş
 * bir top geri alınınca metraj korunmalı ve sonuç YEŞİL olmalı. Bu bölüm
 * kırmızıya dönerse repro yanlış şeyi ölçüyordur.
 */
async function controlGroup(itemId: string): Promise<void> {
  console.log("\n=== §4 KONTROL GRUBU: ebeveyni olmayan iptal (meşru geri alma) ===");
  const solo = await makeParent(itemId);          // 100 m, WAREHOUSE, parentRollId YOK
  const oncesi = await liveQty([solo.id]);
  await inventory.softDelete(solo.id, undefined, {});
  const iptalliyken = await liveQty([solo.id]);
  const r = await inventory.restoreCancelledRoll(solo.id, undefined, { reason: STAMP });
  const st = (r.data as { status: RollStatus }).status;
  const sonrasi = await liveQty([solo.id]);
  check("kontrol: iptalde canlı metraj 0", iptalliyken === 0, `${iptalliyken} m`);
  check("kontrol: geri alma KABUL edilir (meşru senaryo)", st !== RollStatus.CANCELLED, `statü=${st}`);
  check("kontrol: metraj korunur — hayalet YOK", sonrasi === oncesi, `${sonrasi} m = ${oncesi} m`);
  check("kontrol: preCancelStatus yazıldığı için doğru rafa döner (WAREHOUSE)",
    st === RollStatus.WAREHOUSE, `statü=${st}`);
}

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO BULGU-T1-011 (damga ${STAMP}) ===`);
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  if (!item) throw new Error("Aktif kumaş yok — seed koşulmamış olabilir");
  console.log(`Fixture kumaşı: ${item.name}\n`);

  const TEKRAR = 10;
  let bozulan = 0;
  let toplamFazla = 0;
  for (let i = 1; i <= TEKRAR; i++) {
    const fazla = await oneRound(item.id, i, i <= 2);
    if (fazla !== 0) { bozulan++; toplamFazla += fazla; }
  }

  await controlGroup(item.id);

  console.log(`\n=== ÖZET ===`);
  console.log(`Tekrar: ${TEKRAR} · Değişmez BOZULAN tur: ${bozulan} · Toplam hayalet metraj: ${toplamFazla} m`);
  console.log(`✅ ${pass} · ❌ ${fail}`);
  if (bozulan > 0) {
    console.log(`\n⚠️  BULGU DOĞRULANDI: ${bozulan}/${TEKRAR} turda "iptali geri al" kesim çocuğunu diriltti;`);
    console.log(`    her turda ${toplamFazla / bozulan} m aynı anda hem kaynak topta hem çocukta canlı sayılıyor.`);
  }
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => { console.error("REPRO HATASI:", e); process.exitCode = 2; })
  .finally(async () => {
    // ── TEMİZLİK — yalnız bu koşumun damgalı kayıtları, FK sırasına göre ─────
    try {
      const ids = createdRolls;
      if (ids.length) {
        await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } });   // RESTRICT FK
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.systemLog.deleteMany({ where: { tableName: "ROLL", recordId: { in: ids } } });
        // Çocuk ÖNCE (parentRollId FK), sonra ebeveyn.
        await prisma.roll.deleteMany({ where: { parentRollId: { in: ids } } });
        await prisma.roll.deleteMany({ where: { id: { in: ids } } });
      }
      console.log(`\n🧹 Temizlik tamam (${createdRolls.length} top).`);
    } catch (e) {
      console.error("🧹 TEMİZLİK HATASI (elle bak):", (e as Error).message, `damga=${STAMP}`);
    }
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
