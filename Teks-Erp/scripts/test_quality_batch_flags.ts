// =============================================================================
// Test: KALİTE ZORUNLULUĞU + OTOMATİK PARTİ bayrakları (Dilim 2 · D6/D7/D8)
// Çalıştır: npx tsx scripts/test_quality_batch_flags.ts
// =============================================================================
// İKİ BAYRAK, TEK DERS: "bayrak yazmak ≠ bayrak açmak". Her ikisinin de
// varsayılanı BUGÜNKÜ davranıştır ve hiçbiri hiçbir profilde açık doğmaz.
//
//   `quality.gradeRequiredEnabled` (D6) — kalite zorunlu mu. KAPSAM DAR ve
//   bu bekçinin ASIL DEĞERİ kapsamın DIŞINI ölçmesidir: kapsamı "her top
//   doğumu"na genişletmek Adnan Şahin'de fason kabulünü ve son-adım finalize'ı
//   komple 400'e düşürürdü — üstelik bayrak KAPALIYKEN değil, AÇILDIĞI GÜN.
//
//   `batch.autoCreateEnabled` (D7) — açık parti yokken sunucu partiyi kendisi
//   açar. ⚠️ ADI "otomatik", "zorunlu" DEĞİL: aynı yerde 400 vermek ÇIKIŞSIZ
//   bir kapı olurdu, çünkü sistemde sıfırdan parti YARATAN bir uç/ekran yok
//   (`batch.routes` yalnız move/merge/split taşır). Bayrağın adı bu gerçeği
//   söylemek zorunda — "requiredEnabled" adı bilerek REDDEDİLDİ.
//
// Bölümler:
//   §1  DÖRT KAPI ZEMİNİ — anahtar + Zod şeması + panel satırı + ÖNKOŞUL şerhi
//   §2  VARSAYILAN = BUGÜN (boş systemSetting istemcisiyle okuyucular FALSE)
//   §3  KAPSAM POZİTİF — dört yüzeyin dördü de bayrak açıkken 400 GRADE_REQUIRED
//   §4  ⭐ KAPSAM NEGATİF — bayrak AÇIKKEN dokunulmayan yüzeyler (asıl değer)
//   §5  D7 POZİTİF — 0 açık partide parti DOĞAR, top ona bağlanır
//   §6  D7 NEGATİF — tek açık parti varken YENİ parti doğmaz; bayrak kapalıyken
//       davranış bayt-bayt bugünkü (parti NULL)
//   §7  ÇEKİRDEK BEYANI — iki bayrağın da `resolve*`ı YOK (gerekçe kodda) ve
//       panel kategorileri `regime:` TAŞIMAZ
//
// NEGATİF SONDA TABLOSU (dosyanın altında; her biri koşuldu, çıkış kodu kayıtlı).
// =============================================================================

import { randomUUID } from "crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { RollStatus, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { TamburService } from "../src/services/tambur.service";
import { TamburManualService } from "../src/services/tambur-manual.service";
import { WorkOrderService } from "../src/services/workorder.service";
import {
  systemSettingService,
  SETTING_KEYS,
  readQualityGradeRequiredEnabled,
  readBatchAutoCreateEnabled,
} from "../src/services/system-setting.service";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { middlewareGovdeAnalizi, yorumlariSok } from "./lib/regime-gate-scan";
import { createManualMoveFixture } from "./fixture-manual-move";

const inventory = new InventoryService();
const tambur = new TamburService();
const manual = new TamburManualService();
const workOrders = new WorkOrderService();

const KOK = path.resolve(__dirname, "..");
const SRC = path.join(KOK, "src");
const SERVIS = path.join(SRC, "services/system-setting.service.ts");
const ELECTRON_CONFIG = path.resolve(
  KOK,
  "../Electron/src/pages/GeneralSettings/settings-config.ts",
);

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

/** Servis hatasını tipsiz okumadan sondala. */
function errInfo(e: unknown): { status?: number; code?: string; message: string } {
  const err = e as {
    statusCode?: number;
    message?: string;
    details?: Record<string, unknown>;
  } | null;
  return {
    status: err?.statusCode,
    code: err?.details?.code as string | undefined,
    message: err?.message ?? String(e),
  };
}

/** Çağrıyı koşar; hata varsa bilgisini, yoksa `null` döner. */
async function bekle<T>(fn: () => Promise<T>): Promise<ReturnType<typeof errInfo> | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return errInfo(e);
  }
}

function oku(rel: string): string {
  return yorumlariSok(fs.readFileSync(path.join(SRC, rel), "utf8"));
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { username: "admin" },
    select: { id: true },
  });
  const item = await prisma.item.findFirstOrThrow({
    where: { isActive: true },
    select: { id: true },
  });
  const grade = await prisma.qualityGrade.findFirstOrThrow({
    where: { isActive: true },
    select: { id: true, code: true },
  });

  const oncekiGrade = await readQualityGradeRequiredEnabled();
  const oncekiBatch = await readBatchAutoCreateEnabled();
  const createdRolls: string[] = [];
  const createdBatches: string[] = [];
  const teardowns: Array<() => Promise<void>> = [];

  try {
    // =========================================================================
    // §1 DÖRT KAPI ZEMİNİ
    // =========================================================================
    console.log("\n§1 — dört kapı zemini (anahtar · Zod · panel · önkoşul şerhi)");
    check(
      "§1 SETTING_KEYS.QUALITY_GRADE_REQUIRED_ENABLED = quality.gradeRequiredEnabled",
      SETTING_KEYS.QUALITY_GRADE_REQUIRED_ENABLED === "quality.gradeRequiredEnabled",
    );
    check(
      "§1 SETTING_KEYS.BATCH_AUTO_CREATE_ENABLED = batch.autoCreateEnabled",
      SETTING_KEYS.BATCH_AUTO_CREATE_ENABLED === "batch.autoCreateEnabled",
    );
    const zodShape = updateSchema.shape as Record<string, unknown>;
    check("§1 PATCH şeması qualityGradeRequiredEnabled kabul ediyor", "qualityGradeRequiredEnabled" in zodShape);
    check("§1 PATCH şeması batchAutoCreateEnabled kabul ediyor", "batchAutoCreateEnabled" in zodShape);

    const panel = fs.existsSync(ELECTRON_CONFIG) ? fs.readFileSync(ELECTRON_CONFIG, "utf8") : "";
    check("§1 zemin: Electron settings-config okunabildi", panel.length > 5000, `${panel.length} bayt`);
    for (const key of ["qualityGradeRequiredEnabled", "batchAutoCreateEnabled"]) {
      const i = panel.indexOf(`key: "${key}"`);
      check(`§1 panel satırı var: ${key}`, i >= 0);
      if (i < 0) continue;
      // ÖNKOŞUL ŞERHİ (Dilim 2 şart 2): çıkışsız kapıya dönüşebilecek her bayrak
      // önkoşulunu PANELDE yazar — gelecekte biri bilmeden açmasın.
      const blok = panel.slice(i, i + 4000);
      const sonrakiKey = blok.indexOf('key: "', 10);
      const kendi = sonrakiKey > 0 ? blok.slice(0, sonrakiKey) : blok;
      check(
        `§1 ⭐ ${key} panel açıklamasında ÖNKOŞUL şerhi geçiyor`,
        kendi.includes("ÖNKOŞUL"),
        "şerh yoksa bayrağı açan kişi sahayı çıkışsız bırakabilir",
      );
    }

    // =========================================================================
    // §2 VARSAYILAN = BUGÜNKÜ DAVRANIŞ
    // =========================================================================
    console.log("\n§2 — varsayılan BUGÜNKÜ davranış (satır yokken FALSE)");
    const bosIstemci = {
      systemSetting: { findUnique: async () => null },
    } as unknown as Parameters<typeof readQualityGradeRequiredEnabled>[0];
    check(
      "§2 ⭐ satır YOKKEN readQualityGradeRequiredEnabled = false",
      (await readQualityGradeRequiredEnabled(bosIstemci)) === false,
    );
    check(
      "§2 ⭐ satır YOKKEN readBatchAutoCreateEnabled = false",
      (await readBatchAutoCreateEnabled(bosIstemci)) === false,
    );

    // =========================================================================
    // §3 KAPSAM POZİTİF — dört yüzey
    // =========================================================================
    console.log("\n§3 — kapsam POZİTİF (bayrak AÇIK → dört yüzey 400 GRADE_REQUIRED)");
    await systemSettingService.setFeatureFlags({ qualityGradeRequiredEnabled: true }, admin.id);
    check("§3 bayrak açık okundu", (await readQualityGradeRequiredEnabled()) === true);

    // ── 3a KK1 / manuel giriş (HTTP yolu = opts.gradeRequired) ───────────────
    const kk1 = await bekle(() =>
      inventory.createInitialEntry({ itemId: item.id, initialQty: 120 }, admin.id, null, false, {
        gradeRequired: true,
      }),
    );
    check(
      "§3a KK1 girişi: kalitesiz istek 400 GRADE_REQUIRED",
      kk1?.status === 400 && kk1.code === "GRADE_REQUIRED",
      kk1 ? `${kk1.status} ${kk1.code}` : "hata atılmadı (kalitesiz top DOĞDU)",
    );
    // Aynı yol kaliteyle SORUNSUZ geçmeli — kapı "her girişi reddet" değil.
    const kk1Ok = await inventory.createInitialEntry(
      { itemId: item.id, initialQty: 121, qualityGrade: grade.code },
      admin.id,
      null,
      false,
      { gradeRequired: true },
    );
    createdRolls.push(kk1Ok.data.id);
    check("§3a KK1 girişi: KALİTELİ istek geçti (kapı kör değil)", Boolean(kk1Ok.data.id));

    // ── 3b DEPO KESİMİ (`cutWarehouseRoll`) ─────────────────────────────────
    // Kalitesiz bir WAREHOUSE topu kur (bayrak dahili çağrıyı kapsamaz — 3b'nin
    // ölçtüğü şey kesim kapısı, giriş kapısı değil).
    const depoTop = await inventory.createInitialEntry(
      { itemId: item.id, initialQty: 200 },
      admin.id,
      null,
      false,
      { forcedStatus: RollStatus.WAREHOUSE },
    );
    createdRolls.push(depoTop.data.id);
    const kesim = await bekle(() =>
      tambur.cutWarehouseRoll(depoTop.data.id, { cutLength: 40 }, admin.id),
    );
    check(
      "§3b depo kesimi: kalitesiz kaynak + kalitesiz kesim 400 GRADE_REQUIRED",
      kesim?.status === 400 && kesim.code === "GRADE_REQUIRED",
      kesim ? `${kesim.status} ${kesim.code}` : "hata atılmadı (kalitesiz çocuk DOĞDU)",
    );
    const kesimOk = await bekle(() =>
      tambur.cutWarehouseRoll(
        depoTop.data.id,
        { cutLength: 40, qualityGrade: grade.code },
        admin.id,
      ),
    );
    check("§3b depo kesimi: kalite verilince geçti", kesimOk === null, kesimOk?.message);
    // Doğan çocuk temizlik listesine.
    for (const r of await prisma.roll.findMany({
      where: { parentRollId: depoTop.data.id },
      select: { id: true },
    })) {
      createdRolls.push(r.id);
    }

    // ── 3c TAMBUR KALAN-KUYRUK ──────────────────────────────────────────────
    const fxTail = await createManualMoveFixture(1);
    teardowns.push(fxTail.teardown);
    const tamburStep = fxTail.stepIdBySeq[4];
    await prisma.roll.update({
      where: { id: fxTail.rollIds[0] },
      data: {
        status: RollStatus.IN_PRODUCTION,
        currentStepId: tamburStep,
        qualityGrade: null,
        qualityGradeId: null,
        currentQty: 100,
        initialQty: 100,
      },
    });
    // Kesim toplamı (40) < metraj (100) → sistem "kalan" child üretecek ve onun
    // kalitesi PARENT'tan devralınacak; parent gradesiz olduğu için kapı ısırır.
    const tail = await bekle(() =>
      tambur.finalize(
        {
          rollId: fxTail.rollIds[0],
          decisions: [],
          cuts: [{ length: 40, qualityGrade: grade.code, relatedErrorIds: [] }],
          // Fixture WO'sunun hedef rengi var, top renksiz → plan-sapma kapısı
          // (409 PLAN_MISMATCH) BİZDEN ÖNCE ısırıyor. Ölçmek istediğimiz kapı o
          // değil; sapma onaylanıp geçilir.
          confirmMismatch: true,
        },
        admin.id,
      ),
    );
    check(
      "§3c Tambur kalan-kuyruk: gradesiz parent + eksik kesim 400 GRADE_REQUIRED",
      tail?.status === 400 && tail.code === "GRADE_REQUIRED",
      tail ? `${tail.status} ${tail.code}` : "hata atılmadı (kalitesiz kuyruk topu DOĞDU)",
    );
    // Aynı finalize, metrajın TAMAMI kesildiğinde geçmeli: kuyruk hiç doğmaz,
    // dolayısıyla kapının soracağı bir şey de yoktur.
    const tailOk = await bekle(() =>
      tambur.finalize(
        {
          rollId: fxTail.rollIds[0],
          decisions: [],
          cuts: [{ length: 100, qualityGrade: grade.code, relatedErrorIds: [] }],
          confirmMismatch: true,
        },
        admin.id,
      ),
    );
    check(
      "§3c ⭐ metrajın tamamı kesilince kapı SUSUYOR (kuyruk doğmuyor)",
      tailOk === null,
      tailOk?.message,
    );
    for (const r of await prisma.roll.findMany({
      where: { parentRollId: fxTail.rollIds[0] },
      select: { id: true },
    })) {
      createdRolls.push(r.id);
    }

    // ── 3d WO KAPANIŞ DİSPOZİSYONU (yalnız WAREHOUSE / A1_STOCK) ────────────
    const fxClose = await createManualMoveFixture(1);
    teardowns.push(fxClose.teardown);
    await prisma.workOrder.update({
      where: { id: fxClose.woId },
      data: { status: WorkOrderStatus.IN_PROGRESS },
    });
    await prisma.roll.update({
      where: { id: fxClose.rollIds[0] },
      data: {
        status: RollStatus.IN_PRODUCTION,
        currentStepId: fxClose.stepIdBySeq[4],
        qualityGrade: null,
        qualityGradeId: null,
      },
    });
    const kapanis = await bekle(() =>
      workOrders.completeWorkOrder(
        fxClose.woId,
        {
          reason: "Bekçi — kapanış dispozisyonu kalite kapısı",
          dispositions: [{ rollId: fxClose.rollIds[0], action: "WAREHOUSE" }],
        },
        admin.id,
      ),
    );
    check(
      "§3d WO kapanışı: kalitesiz WAREHOUSE dispozisyonu 400 GRADE_REQUIRED",
      kapanis?.status === 400 && kapanis.code === "GRADE_REQUIRED",
      kapanis ? `${kapanis.status} ${kapanis.code}` : "hata atılmadı (kalitesiz top DEPOYA indi)",
    );
    // ⭐ AYNI KAPANIŞ, `STOCK` kararıyla GEÇMELİ: kapsam "satılabilir statüler"dir.
    // `STOCK`/`TRANSFER`/`SCRAP`/`CANCELLED`ta kalite bir karar değildir.
    const kapanisStock = await bekle(() =>
      workOrders.completeWorkOrder(
        fxClose.woId,
        {
          reason: "Bekçi — STOCK dispozisyonu kalite sormaz",
          dispositions: [{ rollId: fxClose.rollIds[0], action: "STOCK" }],
        },
        admin.id,
      ),
    );
    check(
      "§3d ⭐ aynı kapanış STOCK kararıyla GEÇTİ (kapsam satılabilir statüler)",
      kapanisStock === null,
      kapanisStock?.message,
    );

    // =========================================================================
    // §4 ⭐ KAPSAM NEGATİF — bayrak AÇIKKEN dokunulmayanlar
    // =========================================================================
    console.log("\n§4 — ⭐ kapsam NEGATİF (bayrak AÇIKKEN etkilenmeyen yüzeyler)");
    check("§4 zemin: bayrak hâlâ açık", (await readQualityGradeRequiredEnabled()) === true);

    // 4a DAHİLİ ÇAĞRI (F221) — `opts.gradeRequired` verilmeyen her çağıran muaf.
    // Mal kabul, depo transferi ve tambur-manual bu yoldan geçer; koşulsuz bir
    // kural onların hepsini kilitlerdi.
    const dahili = await bekle(async () => {
      const r = await inventory.createInitialEntry({ itemId: item.id, initialQty: 122 }, admin.id);
      createdRolls.push(r.data.id);
      return r;
    });
    check(
      "§4a ⭐ opts'SUZ dahili çağrı kalitesiz geçti (mal kabul / tambur-manual korundu)",
      dahili === null,
      dahili?.message,
    );

    // 4b-4e MEKANİK KAPSAM SINIRI — kapı bu dosyalara SIZMAMALI. Ölçüm YORUMSUZ
    // kod üzerinde (bir dosyanın açıklamasında okuyucunun ADININ geçmesi sızıntı
    // değildir; `test_feature_flag_contract §14`in aynı gün kapanan körlüğü).
    const OKUYUCU = "readQualityGradeRequiredEnabled";
    const KAPSAM_ICI = [
      "services/inventory.service.ts",
      "services/tambur.service.ts",
      "services/workorder.service.ts",
    ];
    const KAPSAM_DISI: Record<string, string> = {
      "services/helpers/roll-finalize.helper.ts":
        "son-adım finalize — kilitlenirse iş emri hiç kapanmaz",
      "services/subcontractor.service.ts": "fason kabul doğumu — kalite BİLEREK null",
      "services/return.service.ts":
        "iade kabulü — `return.gradingEnabled` kapalıyken kalite girecek yüzey YOK",
    };
    // KÖRLÜK ZEMİNİ: kapsam İÇİ dosyalar okuyucuyu gerçekten çağırıyor mu?
    // Çağırmıyorlarsa aşağıdaki negatif kontroller "hiçbir yerde yok" diye
    // vakumen yeşil kalırdı.
    for (const rel of KAPSAM_ICI) {
      check(`§4 zemin: ${rel} kapıyı GERÇEKTEN taşıyor`, oku(rel).includes(`${OKUYUCU}(`));
    }
    for (const [rel, neden] of Object.entries(KAPSAM_DISI)) {
      check(`§4 ⭐ kapsam DIŞI: ${rel} (${neden})`, !oku(rel).includes(`${OKUYUCU}(`));
    }
    // `cutOpenFabric` aynı DOSYADA yaşıyor (tambur.service) → dosya bazlı ölçüm
    // onu göremez; gövde bazlı bakılır. Açık kumaş kesiminde kalite her hâlükârda
    // dolu ("1.KALITE" varsayılanı), yani kapının ısıracağı bir durum yok.
    const tamburKod = oku("services/tambur.service.ts");
    const ofBas = tamburKod.indexOf("async cutOpenFabric(");
    const ofSon = tamburKod.indexOf("async ", ofBas + 10);
    check("§4 zemin: cutOpenFabric gövdesi ayrıştırıldı", ofBas > 0 && ofSon > ofBas);
    check(
      "§4 ⭐ kapsam DIŞI: cutOpenFabric (kalite zaten hep dolu)",
      ofBas > 0 && ofSon > ofBas && !tamburKod.slice(ofBas, ofSon).includes(`${OKUYUCU}(`),
    );
    // 4f D7 tarafı: `attachRolls`/`quickStart` parti bayrağından ETKİLENMEZ —
    // orada parti zaten KOŞULSUZ doğuyor, bayrak eklemek ikinci bir kural olurdu.
    check(
      "§4 ⭐ workorder.service otomatik-parti bayrağını OKUMUYOR (attachRolls koşulsuz)",
      !oku("services/workorder.service.ts").includes("readBatchAutoCreateEnabled("),
    );

    await systemSettingService.setFeatureFlags({ qualityGradeRequiredEnabled: false }, admin.id);

    // =========================================================================
    // §5 / §6 OTOMATİK PARTİ (D7)
    // =========================================================================
    console.log("\n§5/§6 — otomatik parti (batch.autoCreateEnabled)");
    const fxBatch = await createManualMoveFixture(1);
    teardowns.push(fxBatch.teardown);
    // Fixture partisini KAPAT: hiçbir canlı top kalmasın ("açık" tanımı veriye
    // dayanır) → "0 açık parti" dalına düşülür.
    await prisma.roll.updateMany({
      where: { batchId: fxBatch.batchId },
      data: { status: RollStatus.CANCELLED, currentStepId: null },
    });
    const bStep = fxBatch.stepIdBySeq[4];
    const ekle = async (qty: number) => {
      const res = await manual.createManualRoll({
        targetStepId: bStep,
        initialQty: qty,
        reason: "Bekçi — otomatik parti ölçümü",
        clientToken: randomUUID(),
      });
      const d = res.data as { rollId: string; batchId?: string | null; batchNumber?: string | null };
      createdRolls.push(d.rollId);
      return d;
    };

    // §6 KAPALIYKEN — bayt-bayt bugünkü davranış: parti NULL.
    await systemSettingService.setFeatureFlags({ batchAutoCreateEnabled: false }, admin.id);
    const kapali = await ekle(61);
    check("§6 ⭐ bayrak KAPALI: 0 açık partide top PARTİSİZ doğdu (bugünkü davranış)", kapali.batchId == null, String(kapali.batchId));

    // §5 AÇIKKEN — sunucu partiyi kendisi açar, top ona bağlanır, yanıt söyler.
    await systemSettingService.setFeatureFlags({ batchAutoCreateEnabled: true }, admin.id);
    check("§5 bayrak açık okundu", (await readBatchAutoCreateEnabled()) === true);
    const acik = await ekle(62);
    if (acik.batchId) createdBatches.push(acik.batchId);
    check("§5 ⭐ bayrak AÇIK: sunucu partiyi kendisi açtı", Boolean(acik.batchId), String(acik.batchId));
    check(
      "§5 yanıt parti numarasını GERİ SÖYLÜYOR (operatör partisiz sanmasın)",
      typeof acik.batchNumber === "string" && acik.batchNumber.length > 0,
      String(acik.batchNumber),
    );
    const acikRow = await prisma.roll.findUniqueOrThrow({
      where: { id: acik.rollId },
      select: { batchId: true },
    });
    check("§5 top gerçekten o partiye YAZILDI", acikRow.batchId === acik.batchId, String(acikRow.batchId));
    const yeniBatch = await prisma.batch.findUniqueOrThrow({
      where: { id: acik.batchId as string },
      select: { workOrderId: true },
    });
    check("§5 doğan parti DOĞRU iş emrine ait", yeniBatch.workOrderId === fxBatch.woId);

    // §6b Bayrak AÇIKKEN tek açık parti varsa YENİ parti DOĞMAZ — mevcut açık
    // partiye bağlanır (eski üç dallı sözleşme bozulmadı).
    const ikinci = await ekle(63);
    check(
      "§6b ⭐ tek açık parti varken YENİ parti doğmadı (mevcuda bağlandı)",
      ikinci.batchId === acik.batchId,
      `${ikinci.batchId} vs ${acik.batchId}`,
    );
    const partiSayisi = await prisma.batch.count({ where: { workOrderId: fxBatch.woId } });
    check("§6b iş emrinde toplam 2 parti var (fixture + otomatik)", partiSayisi === 2, String(partiSayisi));

    await systemSettingService.setFeatureFlags({ batchAutoCreateEnabled: false }, admin.id);

    // =========================================================================
    // §7 ÇEKİRDEK BEYANI — resolver YOK, `regime:` YOK
    // =========================================================================
    console.log("\n§7 — çekirdek beyanı (resolver YOK · panel kategorisi regime'siz)");
    // İki bayrak da ÇEKİRDEKTİR (D8): KK1 dalı Roll doğuran motorda yaşar
    // (tasarım karar #2 "motor çekirdek, sunum modülde"), parti bayrağının tek
    // tüketicisi zaten üretim kapılı bir router'ın arkasında. Bu yüzden okuyucu
    // gövdeleri HAM'dır — başka bir bayrak okumazlar.
    for (const okuyucu of ["readQualityGradeRequiredEnabled", "readBatchAutoCreateEnabled"]) {
      const analiz = middlewareGovdeAnalizi(SERVIS, okuyucu);
      check(`§7 zemin: ${okuyucu} tanımlı`, analiz.bulundu);
      check(
        `§7 ⭐ ${okuyucu} HAM değer döner (modül şalteri okumaz — ÇEKİRDEK)`,
        analiz.bulundu && analiz.okuyucular.length === 0,
        analiz.okuyucular.map((o) => o.ad).join(", "),
      );
    }
    // Panel kategorisi `regime:` taşıyamaz — taşısaydı §14 sızıntı taraması
    // kırmızı verirdi (inventory.service / tambur.service üretim kapısı olmayan
    // yollardan da ulaşılabilir; Dilim 2 keşfinde 350/443 dosya ölçüldü).
    for (const [key, kategori] of [
      ["qualityGradeRequiredEnabled", 'id: "production"'],
      ["batchAutoCreateEnabled", 'id: "work-orders"'],
    ] as const) {
      const kIdx = panel.indexOf(`key: "${key}"`);
      const cIdx = panel.lastIndexOf(kategori, kIdx);
      check(`§7 zemin: ${key} '${kategori}' kategorisinde`, kIdx > 0 && cIdx > 0 && cIdx < kIdx);
      const blok = panel.slice(cIdx, kIdx);
      check(
        `§7 ⭐ ${key} kategorisi 'regime:' TAŞIMIYOR`,
        !/^ {4}regime:/m.test(blok),
        "regime eklenirse enforcement rejimsiz yollardan koşmaya devam eder (sahte gizleme)",
      );
    }
  } finally {
    await systemSettingService
      .setFeatureFlags(
        { qualityGradeRequiredEnabled: oncekiGrade, batchAutoCreateEnabled: oncekiBatch },
        admin.id,
      )
      .catch(() => {});
    // Sıra FK zinciri: hareket → operasyon → özellik → top → parti → fixture.
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
    await prisma.roll.updateMany({
      where: { id: { in: createdRolls } },
      data: { currentStepId: null, batchId: null, parentRollId: null },
    }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } }).catch(() => {});
    await prisma.batch.deleteMany({ where: { id: { in: createdBatches } } }).catch(() => {});
    for (const t of teardowns.reverse()) await t().catch(() => {});
    console.log("\n(temizlendi)");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});

// =============================================================================
// NEGATİF SONDA TABLOSU (koşuldu — her sondadan sonra dosya md5 ile geri yüklendi)
// =============================================================================
//  (α) inventory.service kapısı `if (false)` yapıldı        → §3a + §4 zemin KIRMIZI (2/47)
//  (β) `roll-finalize.helper`e GERÇEK çağrı eklendi         → §4 kapsam-dışı KIRMIZI (1/47)
//  (γ) okuyucu varsayılanı `true` yapıldı                   → §2 KIRMIZI (1/47)
//  (δ) tambur-manual otomatik parti dalı `if (false)`       → §5 KIRMIZI
//  (ε) panel "production" kategorisine `regime:` eklendi    → §7 KIRMIZI beklenir
//      ⚠️ BU TURDA KOŞULMADI: `Electron/.../settings-config.ts` o sırada PARALEL bir
//      ajanın (sevkiyat bayrakları) çalışma dosyasıydı; md5 geri yüklemesi onun
//      yazımını sessizce silebilirdi. Sondanın ölçtüğü mekanizma ayrıca
//      `test_feature_flag_contract §14`te ÜÇ sondayla doğrulandı (miras modeli
//      kapatıldı · `yorumlariSok` no-op edildi · kapı adı bozuldu → üçü de KIRMIZI).
//
// ⚠️ β'nın İLK yazımı ETKİSİZ SONDAYDI: okuyucu adı YORUM + string literal olarak
// eklenmişti; §4 `yorumlariSok`lu koda ve `OKUYUCU + "("` kalıbına baktığı için
// hiçbir şey değişmedi (47/47 yeşil kaldı). Sonda GERÇEK ÇAĞRI olmak zorunda —
// "kırmızı verdi" cümlesi yazılmadan önce sondanın kendisi doğrulanır.
// =============================================================================
