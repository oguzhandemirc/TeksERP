// =============================================================================
// TAMBUR SAHA DÜZELTMESİ — HTTP SÖZLEŞMESİ + REGRESYON
// Çalıştır: npx tsx scripts/test_tambur_manual_roll.ts
// =============================================================================
// NEDEN AYRI DOSYA (test_tambur_manual_field.ts zaten var):
// O dosya `TamburManualService`i DOĞRUDAN import eder — yani route + RBAC +
// controller Zod + error.middleware katmanını HİÇ görmez. Yeni uç ailesinin en
// pahalı sessiz hatası tam orada yaşar: izin kodu route'a bağlanmamış olabilir,
// katalog satırı DB'ye hiç yazılmamış olabilir, Zod şeması sebebi opsiyonel
// bırakmış olabilir — servis testi ÜÇÜNÜ DE YEŞİL geçer. Bu dosya app'i
// efemeral portta (`app.listen(0)`) gerçekten dinletir ve uçları `fetch` ile
// çağırır (jest/vitest YOK — CLAUDE.md).
//
// Doğrulananlar:
//   1) YETKİ KAPISI — token yok → 401 · 0-izinli kullanıcı → üç uçta da 403 ·
//      YALNIZ `mobile:tambur-duzelt` taşıyan saha kullanıcısı → kapı AÇILIR
//      (403 DEĞİL). Yani izin gerçekten kapıyor VE gerçekten açıyor.
//   2) BURAYA AL — önizleme canApply · SEBEPSİZ çağrı 400 (Zod sınırı) ·
//      uygulandığında top Tambur adımına geçer, açık hareket doğar, KAYNAK ADIM
//      recompute edilir (hareket kapanır → adım COMPLETED) · ÖLÜ statülü top
//      409 ROLL_DEAD · ÇUVALDAKİ top 409 ROLL_IN_SACK.
//   3) MANUEL EKLE — 201, barkod SUNUCUDA üretildi, `entrySource=TAMBUR_MANUAL`,
//      top Tambur adımında IN_PRODUCTION, ürün iş emrinden miras alındı,
//      izlenebilirlik işaretleri YAZILDI (hareket marker'ı + audit event'i +
//      SEBEP + HTTP kimliği), sebep/metraj eksikse 400, AYNI clientToken ile
//      ikinci çağrı MÜKERRER TOP DOĞURMAZ.
//
// Fixture: `fixture-manual-move.ts` (Zımpara → Boyahane → Kurşun+KK2 → Tambur),
// `fixture-test-user.ts` (tam yetkili TEST-ADMIN — seed `admin` şifresine
// GÜVENİLMEZ, bkz. o dosyanın başlığı) + bu dosyanın kendi ürettiği iki dar
// yetkili kullanıcı. Üretilen her kayıt `TEST-` öneklidir ve finally'de silinir.
// =============================================================================

import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import * as bcrypt from "bcryptjs";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { createManualMoveFixture } from "./fixture-manual-move";

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

interface Res {
  status: number;
  body: Record<string, unknown>;
}

/** `ApiResponse.data` — gövde şekli uçtan uca sözleşme olduğu için tipsiz okunmaz. */
function dataOf(r: Res): Record<string, unknown> {
  return (r.body.data ?? {}) as Record<string, unknown>;
}
/** AppError makine-okunur kodu (`details.code`) — mobil bu kodu okur. */
function codeOf(r: Res): string | undefined {
  const d = (r.body.details ?? {}) as Record<string, unknown>;
  return typeof d.code === "string" ? d.code : undefined;
}

const TEST_PASSWORD = "TestTambur2026!";

/** Dar yetkili geçici kullanıcı — izin kümesi TESTİN ölçtüğü özne. */
async function makeUser(
  username: string,
  permissionCodes: string[],
): Promise<{ id: string; username: string }> {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      fullName: "TEST Tambur Saha (fixture)",
      isActive: true,
    },
    select: { id: true },
  });
  if (permissionCodes.length > 0) {
    const perms = await prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
      select: { id: true, code: true },
    });
    // Eksik satır = izin kataloğu uzlaştırması bu DB'de koşmamış demektir; bunu
    // sessizce geçmek testin ölçtüğü şeyi (yetkinin GERÇEKTEN açtığı) boşa düşürür.
    check(
      `izin satırları DB'de mevcut (${permissionCodes.join(", ")})`,
      perms.length === permissionCodes.length,
      `bulunan=${perms.map((p) => p.code).join(",") || "-"}`,
    );
    await prisma.userPermission.createMany({
      data: perms.map((p) => ({ userId: user.id, permissionId: p.id, grantedById: user.id })),
      skipDuplicates: true,
    });
  }
  return { id: user.id, username };
}

async function main(): Promise<void> {
  // Efemeral port (0) → çalışan dev/CI sunucusuyla çakışmaz.
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = async (
    method: string,
    path: string,
    opts: { token?: string; body?: unknown } = {},
  ): Promise<Res> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const r = await fetch(`${base}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await r.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    return { status: r.status, body };
  };

  const login = async (username: string, password: string): Promise<string | undefined> => {
    const r = await call("POST", "/api/auth/login", { body: { username, password } });
    return dataOf(r).token as string | undefined;
  };

  const stamp = `${process.pid}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  const fx = await createManualMoveFixture(3);
  const kursunStepId = fx.stepIdBySeq[3];
  const tamburStepId = fx.stepIdBySeq[4];
  const [rollMove, rollSack, rollDead] = fx.rollIds;

  let sackId: string | null = null;
  let noPermUserId: string | null = null;
  let fieldUserId: string | null = null;
  const createdRollIds: string[] = [];

  try {
    // ---- SETUP -------------------------------------------------------------
    // rollMove: Kurşun+KK2 adımında açık hareketle bekliyor (adım ACTIVE).
    // rollSack: depoda ama ÇUVALDA (paketlenmiş malı geri çekme denemesi).
    // rollDead: tüketilmiş tarihçe kaydı (ölü statü).
    await prisma.roll.update({
      where: { id: rollMove },
      data: { status: "IN_PRODUCTION", currentStepId: kursunStepId },
    });
    await prisma.rollMovement.create({
      data: { rollId: rollMove, workOrderStepId: kursunStepId, qtyIn: 100 },
    });
    await prisma.workOrderStep.update({ where: { id: kursunStepId }, data: { status: "ACTIVE" } });

    const sack = await prisma.sack.create({
      data: { sackNo: `TEST-CV-${stamp}`.slice(0, 64) },
      select: { id: true },
    });
    sackId = sack.id;
    await prisma.roll.update({
      where: { id: rollSack },
      data: { status: "WAREHOUSE", currentStepId: null, sackId: sack.id },
    });
    await prisma.roll.update({
      where: { id: rollDead },
      data: { status: "TAMBUR_CONSUMED", currentStepId: null },
    });

    const wo = await prisma.workOrder.findUniqueOrThrow({
      where: { id: fx.woId },
      select: { targetItemId: true, targetColorId: true, workOrderNumber: true },
    });

    // ---- KİMLİKLER ---------------------------------------------------------
    const adminCred = await ensureTestAdmin();
    const adminToken = await login(adminCred.username, adminCred.password);
    check("TEST-ADMIN login → token", typeof adminToken === "string" && adminToken.length > 20);

    // 0 izinli kullanıcı: kapı KAPALI olmalı.
    const noPerm = await makeUser(`TEST-TMBN-${stamp}`.slice(0, 50), []);
    noPermUserId = noPerm.id;
    const noPermToken = await login(noPerm.username, TEST_PASSWORD);
    check("0-izinli kullanıcı login → token", typeof noPermToken === "string");

    // YALNIZ saha izni: kapı AÇIK olmalı (`roll:manual-adjust` YOK).
    const fieldUser = await makeUser(`TEST-TMBF-${stamp}`.slice(0, 50), ["mobile:tambur-duzelt"]);
    fieldUserId = fieldUser.id;
    const fieldToken = await login(fieldUser.username, TEST_PASSWORD);
    check("saha izinli kullanıcı login → token", typeof fieldToken === "string");

    // =========================================================================
    // 1) YETKİ KAPISI — izin gerçekten kapıyor mu / açıyor mu
    // =========================================================================
    const anon = await call("POST", "/api/tambur/manual/bring-preview", {
      body: { rollId: rollMove, targetStepId: tamburStepId },
    });
    check("token YOK → 401", anon.status === 401, `status=${anon.status}`);

    const guarded: { path: string; body: Record<string, unknown> }[] = [
      {
        path: "/api/tambur/manual/bring-preview",
        body: { rollId: rollMove, targetStepId: tamburStepId },
      },
      {
        path: "/api/tambur/manual/bring",
        body: { rollId: rollMove, targetStepId: tamburStepId, reason: "yetkisiz deneme" },
      },
      {
        path: "/api/tambur/manual/roll",
        body: {
          targetStepId: tamburStepId,
          initialQty: 10,
          reason: "yetkisiz deneme",
          clientToken: randomUUID(),
        },
      },
    ];
    for (const g of guarded) {
      const r = await call("POST", g.path, { token: noPermToken, body: g.body });
      check(`[403] 0-izinli POST ${g.path}`, r.status === 403, `status=${r.status}`);
      check(
        `403 mesajı gerekli izinleri söylüyor (${g.path})`,
        typeof r.body.message === "string" &&
          (r.body.message as string).includes("mobile:tambur-duzelt"),
        String(r.body.message ?? ""),
      );
    }
    // Yetkisiz çağrı HİÇBİR ŞEY değiştirmemiş olmalı (403 gerçekten kapı, süs değil).
    const afterForbidden = await prisma.roll.findUniqueOrThrow({
      where: { id: rollMove },
      select: { currentStepId: true },
    });
    check(
      "403 sonrası top hâlâ Kurşun adımında (yan etki yok)",
      afterForbidden.currentStepId === kursunStepId,
    );
    const strayRolls = await prisma.roll.count({
      where: { entrySource: "TAMBUR_MANUAL", currentStepId: tamburStepId },
    });
    check("403 sonrası Tambur adımında elle eklenmiş top doğmadı", strayRolls === 0);

    const fieldPreview = await call("POST", "/api/tambur/manual/bring-preview", {
      token: fieldToken,
      body: { rollId: rollMove, targetStepId: tamburStepId },
    });
    check(
      "YALNIZ mobile:tambur-duzelt izinli kullanıcı → kapı AÇIK (200)",
      fieldPreview.status === 200,
      `status=${fieldPreview.status}`,
    );

    // =========================================================================
    // 2) MEVCUT TOPU BURAYA AL
    // =========================================================================
    const pv = dataOf(fieldPreview);
    const effects = (pv.effects ?? {}) as Record<string, unknown>;
    check("önizleme canApply=true", pv.canApply === true, String(pv.blockReason ?? "-"));
    check("önizleme yönü ileri", effects.direction === "forward", String(effects.direction));
    check(
      "önizleme kaynak adımı söylüyor",
      typeof effects.fromStepName === "string" && (effects.fromStepName as string).length > 0,
      String(effects.fromStepName),
    );

    // SEBEPSİZ çağrı → 400 (Zod sınırı; servis min-3 kuralının HTTP ikizi)
    const noReason = await call("POST", "/api/tambur/manual/bring", {
      token: fieldToken,
      body: { rollId: rollMove, targetStepId: tamburStepId },
    });
    check("sebepsiz 'buraya al' → 400", noReason.status === 400, `status=${noReason.status}`);
    check("400 gövdesi success:false", noReason.body.success === false);
    const shortReason = await call("POST", "/api/tambur/manual/bring", {
      token: fieldToken,
      body: { rollId: rollMove, targetStepId: tamburStepId, reason: "ab" },
    });
    check("3 karakterden kısa sebep → 400", shortReason.status === 400, `status=${shortReason.status}`);

    // UYGULA
    const bringReason = "saha: top Kurşun'da unutuldu, Tambur'a alındı";
    const bring = await call("POST", "/api/tambur/manual/bring", {
      token: fieldToken,
      body: { rollId: rollMove, targetStepId: tamburStepId, reason: bringReason },
    });
    check("'buraya al' → 200", bring.status === 200, `status=${bring.status}`);
    check(
      "yanıt iş emri numarasını taşıyor",
      dataOf(bring).workOrderNumber === wo.workOrderNumber,
      String(dataOf(bring).workOrderNumber),
    );

    const moved = await prisma.roll.findUniqueOrThrow({
      where: { id: rollMove },
      select: { status: true, currentStepId: true },
    });
    check(
      "top Tambur adımında IN_PRODUCTION",
      moved.status === "IN_PRODUCTION" && moved.currentStepId === tamburStepId,
      `${moved.status}`,
    );
    const openAtTambur = await prisma.rollMovement.count({
      where: { rollId: rollMove, workOrderStepId: tamburStepId, exitedAt: null },
    });
    check("Tambur'da TEK açık hareket açıldı", openAtTambur === 1, `n=${openAtTambur}`);
    const closedAtKursun = await prisma.rollMovement.count({
      where: { rollId: rollMove, workOrderStepId: kursunStepId, exitedAt: { not: null } },
    });
    check("Kurşun hareketi kapandı", closedAtKursun === 1, `n=${closedAtKursun}`);
    const sourceStep = await prisma.workOrderStep.findUniqueOrThrow({
      where: { id: kursunStepId },
      select: { status: true },
    });
    check(
      "kaynak adım recompute edildi (ACTIVE → COMPLETED)",
      sourceStep.status === "COMPLETED",
      `status=${sourceStep.status}`,
    );

    const bringLogs = await prisma.systemLog.findMany({
      where: { tableName: "ROLL", recordId: rollMove },
      select: { userId: true, newData: true },
    });
    const bringLog = bringLogs.find(
      (l) => (l.newData as Record<string, unknown> | null)?.event === "TAMBUR_MANUAL_BRING",
    );
    const bringData = (bringLog?.newData ?? {}) as Record<string, unknown>;
    check("saha audit'i yazıldı (event=TAMBUR_MANUAL_BRING)", Boolean(bringLog));
    check(
      "audit SEBEBİ taşıyor",
      typeof bringData.reason === "string" && (bringData.reason as string).includes("unutuldu"),
      String(bringData.reason ?? "-"),
    );
    check(
      "audit HTTP kimliğini taşıyor (req.user → servis)",
      bringLog?.userId === fieldUser.id,
      `userId=${String(bringLog?.userId)}`,
    );

    // ÖLÜ STATÜ → 409 ROLL_DEAD
    const dead = await call("POST", "/api/tambur/manual/bring", {
      token: adminToken,
      body: { rollId: rollDead, targetStepId: tamburStepId, reason: "ölü topu almayı dene" },
    });
    check("ölü statülü top → 409", dead.status === 409, `status=${dead.status}`);
    check("ölü statülü top → code=ROLL_DEAD", codeOf(dead) === "ROLL_DEAD", String(codeOf(dead)));
    const deadAfter = await prisma.roll.findUniqueOrThrow({
      where: { id: rollDead },
      select: { status: true, currentStepId: true },
    });
    check(
      "reddedilen ölü top DEĞİŞMEDİ",
      deadAfter.status === "TAMBUR_CONSUMED" && deadAfter.currentStepId === null,
    );

    // ÇUVALDAKİ TOP → 409 ROLL_IN_SACK
    const inSack = await call("POST", "/api/tambur/manual/bring", {
      token: adminToken,
      body: { rollId: rollSack, targetStepId: tamburStepId, reason: "çuvaldaki topu almayı dene" },
    });
    check("çuvaldaki top → 409", inSack.status === 409, `status=${inSack.status}`);
    check(
      "çuvaldaki top → code=ROLL_IN_SACK",
      codeOf(inSack) === "ROLL_IN_SACK",
      String(codeOf(inSack)),
    );
    const sackRollAfter = await prisma.roll.findUniqueOrThrow({
      where: { id: rollSack },
      select: { sackId: true, currentStepId: true },
    });
    check(
      "reddedilen çuval topu çuvalda kaldı",
      sackRollAfter.sackId === sackId && sackRollAfter.currentStepId === null,
    );

    // =========================================================================
    // 3) MANUEL TOP EKLE — envanter zincirindeki bilinçli DELİK
    // =========================================================================
    const badQty = await call("POST", "/api/tambur/manual/roll", {
      token: fieldToken,
      body: {
        targetStepId: tamburStepId,
        initialQty: 0,
        reason: "sıfır metraj denemesi",
        clientToken: randomUUID(),
      },
    });
    check("metraj 0 → 400", badQty.status === 400, `status=${badQty.status}`);
    const noReasonCreate = await call("POST", "/api/tambur/manual/roll", {
      token: fieldToken,
      body: { targetStepId: tamburStepId, initialQty: 25, clientToken: randomUUID() },
    });
    check("sebepsiz manuel top → 400", noReasonCreate.status === 400, `status=${noReasonCreate.status}`);
    const noToken = await call("POST", "/api/tambur/manual/roll", {
      token: fieldToken,
      body: { targetStepId: tamburStepId, initialQty: 25, reason: "anahtarsız deneme" },
    });
    check(
      "clientToken'sız manuel top → 400 (idempotency anahtarı ZORUNLU)",
      noToken.status === 400,
      `status=${noToken.status}`,
    );

    const manualReason = "saha: sistemde olmayan top elde bulundu";
    const manualToken = randomUUID();
    const manualBody = {
      targetStepId: tamburStepId,
      initialQty: 137.5,
      reason: manualReason,
      clientToken: manualToken,
      // PARTİ AÇIKÇA verilir (2026-08-04): iş emrinde birden fazla açık parti
      // varsa backend BATCH_REQUIRED ile sorar — testin ölçtüğü şey o değil.
      batchId: fx.batchId,
      // ⚠️ 2026-08-04: ürün/renk ARTIK GÖNDERİLMİYOR. Bu uç topu ŞU iş emrinin
      // adımına bağladığı için ikisi de iş emrinden gelir; operatör değiştiremez.
      // (Mobil form da bu alanları hiç sormuyor.) Sapma denemeleri aşağıda ayrıca
      // sınanır — ITEM_MISMATCH / COLOR_MISMATCH.
    };
    const created = await call("POST", "/api/tambur/manual/roll", {
      token: fieldToken,
      body: manualBody,
    });
    check("manuel top → 201", created.status === 201, `status=${created.status}`);
    const createdData = dataOf(created);
    const manualRollId = createdData.rollId as string | undefined;
    check("yanıt rollId taşıyor", typeof manualRollId === "string");
    if (typeof manualRollId === "string") createdRollIds.push(manualRollId);
    check(
      "ürün iş emrinin hedefinden miras alındı",
      createdData.itemId === wo.targetItemId,
      `itemId=${String(createdData.itemId)}`,
    );
    check(
      "renk iş emrinin hedefinden geldi (operatör seçemez)",
      createdData.colorSource === "WORKORDER" && createdData.colorId === wo.targetColorId,
      `colorSource=${String(createdData.colorSource)} colorId=${String(createdData.colorId)}`,
    );

    // ── SEBEP KODU (2026-08-21) ─────────────────────────────────────────────
    // Serbest metin → kod UYDURULMAZ (null); preset metni → sunucu kodu türetir;
    // uydurma AÇIK kod → 400. Mobil bugün yalnız metin gönderiyor.
    if (typeof manualRollId === "string") {
      const manualRow = await prisma.roll.findUniqueOrThrow({
        where: { id: manualRollId },
        select: { entryReasonCode: true },
      });
      check("serbest metin sebep → entryReasonCode NULL", manualRow.entryReasonCode === null, String(manualRow.entryReasonCode));
    }
    const presetCreated = await call("POST", "/api/tambur/manual/roll", {
      token: fieldToken,
      body: {
        targetStepId: tamburStepId,
        initialQty: 21,
        reason: "Sayım farkı — fiziksel mal var",
        clientToken: randomUUID(),
        batchId: fx.batchId,
      },
    });
    check("preset metniyle manuel top → 201", presetCreated.status === 201, `status=${presetCreated.status}`);
    const presetRollId = dataOf(presetCreated).rollId as string | undefined;
    if (typeof presetRollId === "string") {
      createdRollIds.push(presetRollId);
      const pr = await prisma.roll.findUniqueOrThrow({
        where: { id: presetRollId },
        select: { entryReasonCode: true, entryReason: true },
      });
      check("sebep KODU sunucuda türetildi → SAYIM_FARKI", pr.entryReasonCode === "SAYIM_FARKI", String(pr.entryReasonCode));
    }
    const badCode = await call("POST", "/api/tambur/manual/roll", {
      token: fieldToken,
      body: {
        targetStepId: tamburStepId,
        initialQty: 21,
        reason: "deneme sebebi",
        reasonCode: "YOK_BOYLE_KOD",
        clientToken: randomUUID(),
        batchId: fx.batchId,
      },
    });
    check(
      "uydurma AÇIK sebep kodu → 400 REASON_CODE_INVALID",
      badCode.status === 400 && codeOf(badCode) === "REASON_CODE_INVALID",
      `${badCode.status}/${String(codeOf(badCode))}`,
    );

    // ── ÜRÜN/RENK KİLİDİ (2026-08-04) — sapma denemeleri REDDEDİLİR ──────────
    // Mobil form bu alanları hiç sormuyor; buradaki guard eski APK'lı tablete ve
    // doğrudan API çağrısına karşı ikinci savunma hattıdır. Sapma serbest
    // bırakılsaydı, o iş emrine ait OLMAYAN bir top onun çıktısına yazılır ve
    // üretim muhasebesi (ÇIKAN metriği) sessizce kayardı.
    const otherItem = await prisma.item.findFirst({
      where: { isActive: true, id: { not: wo.targetItemId ?? undefined } },
      select: { id: true },
    });
    if (otherItem) {
      const mismatch = await call("POST", "/api/tambur/manual/roll", {
        token: fieldToken,
        body: {
          targetStepId: tamburStepId,
          initialQty: 50,
          reason: "TEST — farklı ürün denemesi reddedilmeli",
          clientToken: randomUUID(),
          itemId: otherItem.id,
        },
      });
      check("farklı ÜRÜN → 400", mismatch.status === 400, `status=${mismatch.status}`);
      check(
        "farklı ÜRÜN → code=ITEM_MISMATCH",
        codeOf(mismatch) === "ITEM_MISMATCH",
        String(codeOf(mismatch)),
      );
    }
    if (wo.targetColorId) {
      const colorless = await call("POST", "/api/tambur/manual/roll", {
        token: fieldToken,
        body: {
          targetStepId: tamburStepId,
          initialQty: 50,
          reason: "TEST — renksiz denemesi reddedilmeli",
          clientToken: randomUUID(),
          colorId: null,
        },
      });
      check("RENKSİZ denemesi → 400", colorless.status === 400, `status=${colorless.status}`);
      check(
        "RENKSİZ denemesi → code=COLOR_MISMATCH",
        codeOf(colorless) === "COLOR_MISMATCH",
        String(codeOf(colorless)),
      );
    }

    if (typeof manualRollId === "string") {
      const mRoll = await prisma.roll.findUniqueOrThrow({
        where: { id: manualRollId },
        select: {
          barcode: true,
          entrySource: true,
          status: true,
          currentStepId: true,
          currentQty: true,
          initialQty: true,
          colorId: true,
          clientToken: true,
          createdById: true,
        },
      });
      check(
        "barkod SUNUCUDA üretildi (istemci göndermedi)",
        typeof mRoll.barcode === "string" && mRoll.barcode.length > 0,
        String(mRoll.barcode),
      );
      check(
        "barkod yanıtta da aynı",
        createdData.barcode === mRoll.barcode,
        `${String(createdData.barcode)} / ${String(mRoll.barcode)}`,
      );
      check(
        "entrySource=TAMBUR_MANUAL (Electron manuel girişinden AYRI — Tambur tabletinden)",
        mRoll.entrySource === "TAMBUR_MANUAL",
        String(mRoll.entrySource),
      );
      check(
        "top Tambur adımında IN_PRODUCTION",
        mRoll.status === "IN_PRODUCTION" && mRoll.currentStepId === tamburStepId,
        `${mRoll.status}`,
      );
      check(
        "metraj korundu (giriş = anlık)",
        Number(mRoll.currentQty) === 137.5 && Number(mRoll.initialQty) === 137.5,
        `${Number(mRoll.initialQty)} → ${Number(mRoll.currentQty)}`,
      );
      check(
        "iş emrinin hedef rengiyle doğdu (miras uygulandı)",
        mRoll.colorId === wo.targetColorId,
        `${String(mRoll.colorId)} vs hedef ${String(wo.targetColorId)}`,
      );
      check("clientToken kayda yazıldı", mRoll.clientToken === manualToken);
      check(
        "topu yaratan HTTP kimliği damgalandı",
        mRoll.createdById === fieldUser.id,
        `createdById=${String(mRoll.createdById)}`,
      );

      // İZLENEBİLİRLİK #1 — giriş hareketinde marker + sebep
      const mMove = await prisma.rollMovement.findFirst({
        where: { rollId: manualRollId, workOrderStepId: tamburStepId, exitedAt: null },
        select: { notes: true, qtyIn: true },
      });
      check(
        "giriş hareketinde marker + SEBEP",
        (mMove?.notes ?? "").startsWith("TAMBUR_MANUAL_ROLL:") &&
          (mMove?.notes ?? "").includes("elde bulundu"),
        String(mMove?.notes ?? "-"),
      );
      check("giriş hareketi metrajı taşıyor", Number(mMove?.qtyIn ?? 0) === 137.5);

      // İZLENEBİLİRLİK #2 — audit (KALICI çapa: sebep + kim + hangi adım)
      const mLogs = await prisma.systemLog.findMany({
        where: { tableName: "ROLL", recordId: manualRollId },
        select: { userId: true, action: true, newData: true },
      });
      const mLog = mLogs.find(
        (l) => (l.newData as Record<string, unknown> | null)?.event === "TAMBUR_MANUAL_ROLL",
      );
      const mData = (mLog?.newData ?? {}) as Record<string, unknown>;
      check("manuel top audit'i yazıldı (event=TAMBUR_MANUAL_ROLL)", Boolean(mLog));
      check(
        "audit SEBEBİ taşıyor",
        typeof mData.reason === "string" && (mData.reason as string).includes("elde bulundu"),
        String(mData.reason ?? "-"),
      );
      check(
        "audit hedef adımı + iş emrini taşıyor",
        mData.targetStepId === tamburStepId && mData.workOrderNumber === wo.workOrderNumber,
        `${String(mData.targetStepId)} / ${String(mData.workOrderNumber)}`,
      );
      check(
        "audit entrySource işaretini taşıyor",
        mData.entrySource === "TAMBUR_MANUAL",
        String(mData.entrySource ?? "-"),
      );
      check("audit HTTP kimliğini taşıyor", mLog?.userId === fieldUser.id, String(mLog?.userId));

      // İDEMPOTENCY — aynı clientToken, MÜKERRER TOP YOK
      const retry = await call("POST", "/api/tambur/manual/roll", {
        token: fieldToken,
        body: manualBody,
      });
      check("aynı clientToken ile 2. çağrı → 201", retry.status === 201, `status=${retry.status}`);
      const retryData = dataOf(retry);
      if (typeof retryData.rollId === "string" && retryData.rollId !== manualRollId) {
        createdRollIds.push(retryData.rollId);
      }
      check("2. çağrı AYNI topu döndürdü", retryData.rollId === manualRollId);
      check("2. çağrı adıma yeniden bağlamadı (alreadyAttached)", retryData.alreadyAttached === true);
      const tokenRolls = await prisma.roll.count({ where: { clientToken: manualToken } });
      check("token başına TEK top (mükerrer doğmadı)", tokenRolls === 1, `n=${tokenRolls}`);
      const openMoves = await prisma.rollMovement.count({
        where: { rollId: manualRollId, workOrderStepId: tamburStepId, exitedAt: null },
      });
      check("2. çağrıda ikinci açık hareket doğmadı", openMoves === 1, `n=${openMoves}`);
    }
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.stack : e);
  } finally {
    // Söküm sırası FK'ya bağlı: fixture DIŞI toplar (currentStepId → step) →
    // çuval → taşımanın doğurduğu ekstra parti → fixture → kullanıcılar.
    //
    // ⚠️ Silinecek küme yalnız `createdRollIds` DEĞİL, bu iş emrinin adımlarına
    // bağlanmış HER yabancı top. Gerekçe ölçüldü (negatif sınama, 2026-08-03):
    // izin guard'ı bilerek kaldırılınca yetkisiz çağrı gerçekten bir top doğurdu;
    // o top listeye kaydedilmediği için `workOrderStep` silme FK'ya takıldı ve
    // KIRMIZI koşum dev DB'sinde bir iş emri + bir hayalet top bıraktı. Kırmızının
    // ikinci bir zarar vermemesi gerekir — teardown kendini onarır.
    const fxStepIds = Object.values(fx.stepIdBySeq);
    const strays = await prisma.roll.findMany({
      where: {
        id: { notIn: fx.rollIds },
        OR: [
          { currentStepId: { in: fxStepIds } },
          { movements: { some: { workOrderStepId: { in: fxStepIds } } } },
        ],
      },
      select: { id: true, barcode: true },
    });
    if (strays.length > createdRollIds.length) {
      console.warn(
        `  ⚠️  beklenmeyen top(lar) bu iş emrine bağlanmış: ${strays
          .map((s) => s.barcode ?? s.id)
          .join(", ")}`,
      );
    }
    const doomedRollIds = [...new Set([...createdRollIds, ...strays.map((s) => s.id)])];
    if (doomedRollIds.length > 0) {
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: doomedRollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: doomedRollIds } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: doomedRollIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: doomedRollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: doomedRollIds } } });
    }
    await prisma.roll.updateMany({ where: { id: rollSack }, data: { sackId: null } });
    if (sackId) await prisma.sack.deleteMany({ where: { id: sackId } });

    // Taşımanın varsayılan parti kararı 'new' → fixture'ın BİLMEDİĞİ bir parti
    // doğar; fixture teardown'ı yalnız kendi partisini siler ve WO silme FK'ya takılır.
    const extraBatches = await prisma.batch.findMany({
      where: { workOrderId: fx.woId, id: { not: fx.batchId } },
      select: { id: true },
    });
    if (extraBatches.length > 0) {
      const ids = extraBatches.map((b) => b.id);
      await prisma.roll.updateMany({ where: { batchId: { in: ids } }, data: { batchId: fx.batchId } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: ids } } });
      await prisma.batch.deleteMany({ where: { id: { in: ids } } });
    }
    await fx.teardown();

    // Kullanıcılar: ÖNCE oturum + izin + audit (sessions RESTRICT; system_logs
    // SetNull olsa da bu satırlar bizim ürettiğimiz artıktır).
    for (const uid of [noPermUserId, fieldUserId]) {
      if (!uid) continue;
      await prisma.userPermission.deleteMany({ where: { userId: uid } });
      await prisma.session.deleteMany({ where: { userId: uid } });
      await prisma.systemLog.deleteMany({ where: { userId: uid } });
      // Sessiz yutma YOK — temizlik düşerse görünür olsun (fabrika DB'sinde artık birikmesin).
      await prisma.user.delete({ where: { id: uid } }).catch((e: unknown) => {
        console.warn(
          `  ⚠️  temizlik: test kullanıcısı silinemedi (${uid}):`,
          e instanceof Error ? e.message.split("\n")[0] : String(e),
        );
      });
    }
    console.log("(temizlendi — TEST- fixture WO/parti/toplar + manuel top + çuval + kullanıcılar)");

    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end().catch(() => {});
  process.exit(1);
});
