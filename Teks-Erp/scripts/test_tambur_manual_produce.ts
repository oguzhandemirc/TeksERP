// =============================================================================
// TAMBUR "MANUEL MOD" — KARTSIZ BİTMİŞ ÜRÜN UCU (HTTP sözleşmesi + KK1 regresyonu)
// Çalıştır: npx tsx scripts/test_tambur_manual_produce.ts
// =============================================================================
// NEDEN AYRI DOSYA (test_tambur_manual_roll.ts zaten var):
// O dosya KART VARSAYAN iki ucu ölçer (`/manual/bring*`, `/manual/roll`) ve
// fixture'ının tamamı bir iş emri + Tambur adımı üzerine kuruludur. Bu uç tam
// tersini iddia eder: HİÇBİR iş emrine/adıma/harekete dokunmaz. İki iddiayı aynı
// fixture'a bindirmek, "adıma bağlanmadı" kontrolünü fixture'ın kendi
// gürültüsüyle (aynı WO'ya bağlı başka toplar) karıştırırdı.
//
// ÖLÇÜLENLER:
//   A) YETKİ KAPISI — token yok → 401 · 0-izinli → 403 · YALNIZ
//      `mobile:tambur-duzelt` → kapı AÇIK (403 DEĞİL).
//   B) ZOD SINIRLARI — ürün/metraj/sebep/clientToken eksikse 400 · gövdeye
//      `targetStepId` sızdırılırsa YOK SAYILIR (bu uç kart TANIMAZ).
//   C) ⭐ ASIL İDDİA — RENKSİZ bitmiş top da **WAREHOUSE**'a yazılır (Ham Stok'a
//      DEĞİL) ve barkodu **"F"** (final) damgalıdır. Renk sezgisi bypass edildi.
//   D) ZİNCİR-DIŞI DOĞUMUN İZİ — `entrySource=TAMBUR_MANUAL` (kendi değeri:
//      mobilden gelse de SUPPLIER_RECEIPT DEĞİL, Electron'dan gelmediği için
//      MANUAL_ENTRY de DEĞİL — top detayında "Tambur (Manuel)" yazsın diye) ·
//      `form=TOP` · audit `event=TAMBUR_MANUAL_PRODUCE` + sebep + operatör.
//   E) İŞ EMRİNE DOKUNMAMA — `currentStepId=null`, `batchId=null`, RollMovement
//      SIFIR, `producedInStepId=null`.
//   F) ETİKET NİYETİ — müşteri seçilirse `lastLabelSnapshot={customerId}`,
//      seçilmezse `{stock:true}`, PASİF müşteri → 400 CUSTOMER_INACTIVE.
//   G) İDEMPOTENCY — aynı clientToken → tek top + `idempotentReplay:true`.
//   I) ⭐ MOBİL TABLET YOLU — istek eşleşmiş bir TABLET'ten (`x-device-id`)
//      geldiğinde de `entrySource` **TAMBUR_MANUAL** kalır. A–G bölümlerinin
//      HİÇBİRİ bunu kanıtlamaz: cihaz başlığı göndermedikleri için hepsi
//      `isMobileOrigin=false` (Electron) dalından geçer. Ayrıca oturumsuz mobil
//      istek 409 WORK_SESSION_REQUIRED ve makine atfı damgalanıyor mu.
//   H) ⭐ KK1 REGRESYONU — `createInitialEntry` opts'SUZ çağrıldığında ESKİ
//      davranış birebir sürüyor: renksiz → STOCK + "H" barkod, renkli →
//      WAREHOUSE + "F" barkod, `lastLabelSnapshot` null, kartelalık false.
//      Bu bölüm olmadan (C) maddesi KK1'i sessizce bozarak da yeşil kalabilirdi.
//
// Fixture: `fixture-test-user.ts` (TEST-ADMIN) + bu dosyanın ürettiği ürün, iki
// müşteri (aktif/pasif), renk ve iki dar yetkili kullanıcı. Hepsi `TEST-` öneklidir
// ve `finally` bloğunda silinir.
// =============================================================================

import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import * as bcrypt from "bcryptjs";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { InventoryService } from "../src/services/inventory.service";
import { TamburManualService } from "../src/services/tambur-manual.service";

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

function dataOf(r: Res): Record<string, unknown> {
  return (r.body.data ?? {}) as Record<string, unknown>;
}
/** AppError makine-okunur kodu (`details.code`) — mobil bu kodu okur. */
function codeOf(r: Res): string | undefined {
  const d = (r.body.details ?? {}) as Record<string, unknown>;
  return typeof d.code === "string" ? d.code : undefined;
}

const TEST_PASSWORD = "TestProduce2026!";
const PRODUCE_PATH = "/api/tambur/manual/produce";

async function makeUser(
  username: string,
  permissionCodes: string[],
): Promise<{ id: string; username: string }> {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      fullName: "TEST Tambur Manuel Mod (fixture)",
      isActive: true,
    },
    select: { id: true },
  });
  if (permissionCodes.length > 0) {
    const perms = await prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
      select: { id: true, code: true },
    });
    // Eksik satır = izin kataloğu uzlaştırması bu DB'de koşmamış demektir.
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
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = async (
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; deviceId?: string } = {},
  ): Promise<Res> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    // `x-device-id` VARSA istek "saha cihazından" sayılır — hem `resolveDevice`
    // hem `getStampContext(enforceForMobile)` hem de `createInitialEntry`in
    // `isMobileOrigin` sezgisi bu tek başlıkla tetiklenir (I bölümü).
    if (opts.deviceId) headers["x-device-id"] = opts.deviceId;
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
  const createdRollIds: string[] = [];
  let itemId: string | null = null;
  let colorId: string | null = null;
  let activeCustomerId: string | null = null;
  let passiveCustomerId: string | null = null;
  let noPermUserId: string | null = null;
  let fieldUserId: string | null = null;
  let stationId: string | null = null;
  let machineId: string | null = null;
  let deviceRowId: string | null = null;

  try {
    // ---- FIXTURE -----------------------------------------------------------
    const item = await prisma.item.create({
      data: {
        code: `TEST-MPR-${stamp}`.slice(0, 32),
        name: `TEST Manuel Mod ${stamp}`,
        itemType: "FABRIC",
      },
      select: { id: true },
    });
    itemId = item.id;

    const color = await prisma.color.create({
      data: { code: `TEST-MPRC-${stamp}`.slice(0, 32), name: `TEST Renk ${stamp}` },
      select: { id: true },
    });
    colorId = color.id;

    const activeCustomer = await prisma.customer.create({
      data: { code: `TEST-MPRA-${stamp}`.slice(0, 32), name: `TEST Müşteri Aktif ${stamp}` },
      select: { id: true },
    });
    activeCustomerId = activeCustomer.id;

    const passiveCustomer = await prisma.customer.create({
      data: {
        code: `TEST-MPRP-${stamp}`.slice(0, 32),
        name: `TEST Müşteri Pasif ${stamp}`,
        isActive: false,
      },
      select: { id: true },
    });
    passiveCustomerId = passiveCustomer.id;

    const adminCred = await ensureTestAdmin();
    const adminToken = await login(adminCred.username, adminCred.password);
    check("TEST-ADMIN login → token", typeof adminToken === "string" && adminToken.length > 20);

    const noPerm = await makeUser(`TEST-MPRN-${stamp}`.slice(0, 50), []);
    noPermUserId = noPerm.id;
    const noPermToken = await login(noPerm.username, TEST_PASSWORD);
    check("0-izinli kullanıcı login → token", typeof noPermToken === "string");

    const fieldUser = await makeUser(`TEST-MPRF-${stamp}`.slice(0, 50), ["mobile:tambur-duzelt"]);
    fieldUserId = fieldUser.id;
    const fieldToken = await login(fieldUser.username, TEST_PASSWORD);
    check("saha izinli kullanıcı login → token", typeof fieldToken === "string");

    /** Testin ürettiği her topu teardown listesine yazan yardımcı. */
    const produce = async (
      body: Record<string, unknown>,
      token: string | undefined,
      deviceId?: string,
    ): Promise<Res> => {
      const r = await call("POST", PRODUCE_PATH, { token, body, deviceId });
      const id = dataOf(r).rollId;
      if (typeof id === "string" && !createdRollIds.includes(id)) createdRollIds.push(id);
      return r;
    };

    // =========================================================================
    // A) YETKİ KAPISI
    // =========================================================================
    const anon = await call("POST", PRODUCE_PATH, {
      body: { itemId, initialQty: 10, reason: "anonim deneme", clientToken: randomUUID() },
    });
    check("token YOK → 401", anon.status === 401, `status=${anon.status}`);

    const forbidden = await call("POST", PRODUCE_PATH, {
      token: noPermToken,
      body: { itemId, initialQty: 10, reason: "yetkisiz deneme", clientToken: randomUUID() },
    });
    check("0-izinli kullanıcı → 403", forbidden.status === 403, `status=${forbidden.status}`);
    check(
      "403 mesajı gerekli izinleri söylüyor",
      typeof forbidden.body.message === "string" &&
        (forbidden.body.message as string).includes("mobile:tambur-duzelt"),
      String(forbidden.body.message ?? ""),
    );
    const strayAfter403 = await prisma.roll.count({ where: { itemId: item.id } });
    check("403 sonrası hiç top doğmadı (kapı süs değil)", strayAfter403 === 0, `n=${strayAfter403}`);

    // =========================================================================
    // B) ZOD SINIRLARI
    // =========================================================================
    const noItem = await call("POST", PRODUCE_PATH, {
      token: fieldToken,
      body: { initialQty: 10, reason: "ürünsüz deneme", clientToken: randomUUID() },
    });
    check("ürünsüz çağrı → 400 (miras alınacak iş emri yok)", noItem.status === 400, `status=${noItem.status}`);
    // "400 döndü" YETMEZ: operatör hangi alanın eksik olduğunu ekranda görmeli.
    // Zod gövdesi alanı ADIYLA söylemeli — aksi halde mobil "Validasyon hatası"
    // diye anlamsız bir uyarı basar ve saha personeli neyi düzelteceğini bilmez.
    const noItemErrors = (noItem.body.errors ?? []) as Array<{ field?: string; message?: string }>;
    check(
      "ürünsüz çağrının hatası ALANI adıyla söylüyor (field=itemId)",
      noItemErrors.some((e) => e.field === "itemId"),
      JSON.stringify(noItem.body.errors ?? noItem.body.message),
    );

    // Servis katmanının `ITEM_REQUIRED` guard'ı HTTP'den ulaşılamaz (Zod önce
    // keser) ama ÖLÜ DEĞİL: şema gevşerse ya da servis başka bir yerden
    // çağrılırsa tek koruma odur. Doğrudan çağırıp makine-okunur kodunu doğrula
    // — "kapsanmadığı için sessizce çürüyen guard" bu repoda tekrar eden bir hata.
    let itemRequiredCode: string | undefined;
    try {
      await new TamburManualService().produceFinishedRoll({
        itemId: "   ",
        initialQty: 10,
        reason: "servis katmanı ürünsüz çağrı",
        clientToken: randomUUID(),
      });
    } catch (e) {
      itemRequiredCode = (e as { details?: Record<string, unknown> }).details?.code as
        | string
        | undefined;
    }
    check(
      "servis katmanı ürünsüz çağrıyı ITEM_REQUIRED koduyla reddediyor",
      itemRequiredCode === "ITEM_REQUIRED",
      String(itemRequiredCode),
    );

    const zeroQty = await call("POST", PRODUCE_PATH, {
      token: fieldToken,
      body: { itemId, initialQty: 0, reason: "sıfır metraj", clientToken: randomUUID() },
    });
    check("metraj 0 → 400", zeroQty.status === 400, `status=${zeroQty.status}`);

    const shortReason = await call("POST", PRODUCE_PATH, {
      token: fieldToken,
      body: { itemId, initialQty: 10, reason: "ab", clientToken: randomUUID() },
    });
    check("3 karakterden kısa sebep → 400", shortReason.status === 400, `status=${shortReason.status}`);

    const noToken = await call("POST", PRODUCE_PATH, {
      token: fieldToken,
      body: { itemId, initialQty: 10, reason: "anahtarsız deneme" },
    });
    check(
      "clientToken'sız çağrı → 400 (idempotency anahtarı ZORUNLU)",
      noToken.status === 400,
      `status=${noToken.status}`,
    );

    // =========================================================================
    // SEBEP KODU (2026-08-21): preset metni → kod sunucuda türetilir; serbest
    // metin → null (uydurulmaz); uydurma AÇIK kod → 400 REASON_CODE_INVALID.
    // Mobil bugün yalnız metin gönderiyor — kod APK değişmeden dolmalı.
    // =========================================================================
    const presetRes = await produce(
      { itemId, initialQty: 12, reason: "Sayım farkı — fiziksel mal var", clientToken: randomUUID() },
      fieldToken,
    );
    check("preset metniyle üretim → 201", presetRes.status === 201, `status=${presetRes.status}`);
    const presetRollId = dataOf(presetRes).rollId as string | undefined;
    if (typeof presetRollId === "string") {
      const pr = await prisma.roll.findUniqueOrThrow({
        where: { id: presetRollId },
        select: { entryReason: true, entryReasonCode: true },
      });
      check("sebep KODU sunucuda türetildi → SAYIM_FARKI", pr.entryReasonCode === "SAYIM_FARKI", String(pr.entryReasonCode));
      check("görünen metin aynen duruyor", pr.entryReason === "Sayım farkı — fiziksel mal var", String(pr.entryReason));
    }
    const freeRes = await produce(
      { itemId, initialQty: 12, reason: "manuel mod serbest açıklama", clientToken: randomUUID() },
      fieldToken,
    );
    const freeRollId = dataOf(freeRes).rollId as string | undefined;
    if (typeof freeRollId === "string") {
      const fr = await prisma.roll.findUniqueOrThrow({ where: { id: freeRollId }, select: { entryReasonCode: true } });
      check("serbest metinde sebep KODU null (uydurulmaz)", fr.entryReasonCode === null, String(fr.entryReasonCode));
    } else {
      check("serbest metinli üretim → 201", false, `status=${freeRes.status}`);
    }
    const badCodeRes = await produce(
      { itemId, initialQty: 12, reason: "deneme sebebi", reasonCode: "YOK_BOYLE_KOD", clientToken: randomUUID() },
      fieldToken,
    );
    check(
      "uydurma AÇIK sebep kodu → 400 REASON_CODE_INVALID",
      badCodeRes.status === 400 && codeOf(badCodeRes) === "REASON_CODE_INVALID",
      `${badCodeRes.status}/${String(codeOf(badCodeRes))}`,
    );

    // =========================================================================
    // C+D+E) ⭐ ASIL İDDİA — RENKSİZ bitmiş top BİTMİŞ DEPO'ya yazılır
    // =========================================================================
    const coreReason = "manuel mod: top tamburda takıldı, bitmiş mal elle alındı";
    const coreToken = randomUUID();
    const coreBody = {
      itemId,
      initialQty: 412.5,
      width: 150,
      qualityGrade: "1.KALITE",
      reason: coreReason,
      clientToken: coreToken,
      // colorId GÖNDERİLMEDİ → RENKSİZ. Eski sezgi bunu STOCK'a düşürürdü.
    };
    const core = await produce(coreBody, fieldToken);
    check("kartsız bitmiş üretim → 201", core.status === 201, `status=${core.status}`);
    const coreData = dataOf(core);
    const coreRollId = coreData.rollId as string | undefined;
    check("yanıt rollId taşıyor", typeof coreRollId === "string");

    if (typeof coreRollId === "string") {
      const roll = await prisma.roll.findUniqueOrThrow({
        where: { id: coreRollId },
        select: {
          barcode: true,
          status: true,
          form: true,
          entrySource: true,
          colorId: true,
          currentStepId: true,
          producedInStepId: true,
          batchId: true,
          parentRollId: true,
          initialQty: true,
          currentQty: true,
          width: true,
          qualityGrade: true,
          qualityGradeId: true,
          markedForKartela: true,
          lastLabelSnapshot: true,
          clientToken: true,
          createdById: true,
        },
      });

      check("renksiz doğdu (fixture doğrulaması)", roll.colorId === null);
      check(
        "⭐ RENKSİZ bitmiş top BİTMİŞ DEPO'da (Ham Stok DEĞİL)",
        roll.status === "WAREHOUSE",
        `status=${roll.status}`,
      );
      check(
        "⭐ barkod tip damgası F (final) — renksiz olmasına rağmen H değil",
        typeof roll.barcode === "string" && /^T\d{6}F\d{4}$/.test(roll.barcode),
        String(roll.barcode),
      );
      check("form=TOP (Tambur bitmiş top üretir)", roll.form === "TOP", String(roll.form));
      check(
        "entrySource=TAMBUR_MANUAL (SUPPLIER_RECEIPT de MANUAL_ENTRY de DEĞİL)",
        roll.entrySource === "TAMBUR_MANUAL",
        String(roll.entrySource),
      );
      check(
        "metraj korundu (giriş = anlık)",
        Number(roll.initialQty) === 412.5 && Number(roll.currentQty) === 412.5,
        `${Number(roll.initialQty)} → ${Number(roll.currentQty)}`,
      );
      check("en (width) yazıldı", Number(roll.width) === 150, String(roll.width));
      check(
        "kalite kodu + katalog referansı yazıldı",
        roll.qualityGrade === "1.KALITE" && roll.qualityGradeId !== null,
        `${String(roll.qualityGrade)} / ${String(roll.qualityGradeId)}`,
      );
      check("clientToken kayda yazıldı", roll.clientToken === coreToken);
      check(
        "topu yaratan HTTP kimliği damgalandı",
        roll.createdById === fieldUser.id,
        `createdById=${String(roll.createdById)}`,
      );

      // E) İŞ EMRİNE HİÇ DOKUNULMADI
      check("currentStepId null (hiçbir adıma bağlanmadı)", roll.currentStepId === null);
      check("producedInStepId null (üretim adımı yok)", roll.producedInStepId === null);
      check("batchId null (partiye girmedi)", roll.batchId === null);
      check("parentRollId null (kesimden doğmadı)", roll.parentRollId === null);
      const moves = await prisma.rollMovement.count({ where: { rollId: coreRollId } });
      check("RollMovement AÇILMADI (geçilen istasyon yok)", moves === 0, `n=${moves}`);

      // Etiket niyeti: müşteri seçilmedi → stok
      check(
        "müşterisiz üretimde lastLabelSnapshot = {stock:true}",
        JSON.stringify(roll.lastLabelSnapshot) === JSON.stringify({ stock: true }),
        JSON.stringify(roll.lastLabelSnapshot),
      );
      check("kartelalık işareti varsayılan false", roll.markedForKartela === false);

      // D) AUDIT — kalıcı sebep izi
      const logs = await prisma.systemLog.findMany({
        where: { tableName: "ROLL", recordId: coreRollId },
        select: { userId: true, action: true, newData: true },
      });
      const log = logs.find(
        (l) => (l.newData as Record<string, unknown> | null)?.event === "TAMBUR_MANUAL_PRODUCE",
      );
      const logData = (log?.newData ?? {}) as Record<string, unknown>;
      check("audit yazıldı (event=TAMBUR_MANUAL_PRODUCE)", Boolean(log));
      check(
        "audit olayı createManualRoll'unkinden AYRI (TAMBUR_MANUAL_ROLL değil)",
        logs.every(
          (l) => (l.newData as Record<string, unknown> | null)?.event !== "TAMBUR_MANUAL_ROLL",
        ),
      );
      check(
        "audit SEBEBİ taşıyor",
        typeof logData.reason === "string" && (logData.reason as string).includes("takıldı"),
        String(logData.reason ?? "-"),
      );
      check(
        "audit statü + form + entrySource taşıyor",
        logData.status === "WAREHOUSE" &&
          logData.form === "TOP" &&
          logData.entrySource === "TAMBUR_MANUAL",
        `${String(logData.status)} / ${String(logData.form)} / ${String(logData.entrySource)}`,
      );
      check("audit HTTP kimliğini taşıyor", log?.userId === fieldUser.id, String(log?.userId));

      // G) İDEMPOTENCY
      const retry = await produce(coreBody, fieldToken);
      check("aynı clientToken ile 2. çağrı → 201", retry.status === 201, `status=${retry.status}`);
      check("2. çağrı AYNI topu döndürdü", dataOf(retry).rollId === coreRollId);
      check(
        "2. çağrı idempotentReplay:true diyor",
        dataOf(retry).idempotentReplay === true,
        String(dataOf(retry).idempotentReplay),
      );
      const tokenRolls = await prisma.roll.count({ where: { clientToken: coreToken } });
      check("token başına TEK top (mükerrer doğmadı)", tokenRolls === 1, `n=${tokenRolls}`);
    }

    // =========================================================================
    // B-devam) Gövdeye sızdırılan `targetStepId` artık 400 — SESSİZCE ATILMAZ
    //
    // ⚠️ BU KURAL 2026-09-01'DE BİLİNÇLİ OLARAK TERSİNE ÇEVRİLDİ. Eskiden aynı
    // çağrı 201 dönüyordu ve bu dosya onu "Zod tarafından atıldı" diye ölçüyordu.
    // Ters çevirmenin gerekçesi (geri almadan önce ÇÜRÜT):
    //
    //   • Kontrolördeki karar "`targetStepId` YOKTUR ve olmayacaktır" —
    //     yani alanın ÖZELLİK olarak eklenmemesi. Sessiz atma o kararın parçası
    //     DEĞİL, `z.object`in varsayılan davranışıydı; bu bölüm onu yalnız
    //     KAYDEDİYORDU.
    //   • İki uç kardeş ve gövdeleri karışmaya açık — mobil servis dosyası bunu
    //     kendi içinde uyarıyor ("`TamburManualRollRequest` ile KARIŞTIRMA:
    //     orada `targetStepId` ZORUNLUDUR").
    //   • Sessiz atmanın bedeli ölçüldü (canlı demo): adım göndererek üretim
    //     yapıldığında uç 201 döner, operatör "üretildi ✓" görür, ama top iş
    //     emrine HİÇ bağlanmaz → iş emrinin çıkan metrajı ve sipariş
    //     karşılanması sessizce eksik kalır. 400 aynı hatayı GELİŞTİRME anında
    //     görünür kılar.
    //   • Sahadaki istemciler kırılmaz: mobil yükü şemanın alt kümesi,
    //     Electron bu ucu hiç çağırmıyor (ikisi de ölçüldü).
    // =========================================================================
    const strayStep = await produce(
      {
        itemId,
        initialQty: 5,
        reason: "kart alanı sızdırma denemesi",
        clientToken: randomUUID(),
        targetStepId: randomUUID(),
      },
      fieldToken,
    );
    check(
      "gövdedeki targetStepId REDDEDİLDİ → 400 (sessizce atılmıyor)",
      strayStep.status === 400,
      `status=${strayStep.status}`,
    );
    const strayStepData = dataOf(strayStep);
    if (typeof strayStepData.rollId === "string") {
      const r = await prisma.roll.findUniqueOrThrow({
        where: { id: strayStepData.rollId },
        select: { status: true, currentStepId: true },
      });
      check(
        "sızdırılan adım UYGULANMADI (top yine serbest depoda)",
        r.status === "WAREHOUSE" && r.currentStepId === null,
        `${r.status} / ${String(r.currentStepId)}`,
      );
    }

    // =========================================================================
    // F) ETİKET NİYETİ — müşteri + kartelalık + pasif müşteri reddi
    // =========================================================================
    const withCustomer = await produce(
      {
        itemId,
        colorId,
        initialQty: 88,
        reason: "manuel mod: müşteriye ayrılan bitmiş top",
        clientToken: randomUUID(),
        targetCustomerId: activeCustomerId,
        markedForKartela: true,
      },
      fieldToken,
    );
    check("müşterili üretim → 201", withCustomer.status === 201, `status=${withCustomer.status}`);
    const custRollId = dataOf(withCustomer).rollId as string | undefined;
    if (typeof custRollId === "string") {
      const r = await prisma.roll.findUniqueOrThrow({
        where: { id: custRollId },
        select: { status: true, colorId: true, lastLabelSnapshot: true, markedForKartela: true },
      });
      check("renkli bitmiş top da WAREHOUSE", r.status === "WAREHOUSE", `status=${r.status}`);
      check("renk yazıldı", r.colorId === colorId);
      check(
        "etiket niyeti lastLabelSnapshot'a yazıldı ({customerId})",
        JSON.stringify(r.lastLabelSnapshot) === JSON.stringify({ customerId: activeCustomerId }),
        JSON.stringify(r.lastLabelSnapshot),
      );
      check("kartelalık işareti uygulandı", r.markedForKartela === true);
    }

    const passive = await call("POST", PRODUCE_PATH, {
      token: fieldToken,
      body: {
        itemId,
        initialQty: 12,
        reason: "pasif müşteri denemesi",
        clientToken: randomUUID(),
        targetCustomerId: passiveCustomerId,
      },
    });
    check("PASİF müşteri → 400", passive.status === 400, `status=${passive.status}`);
    check(
      "PASİF müşteri → code=CUSTOMER_INACTIVE",
      codeOf(passive) === "CUSTOMER_INACTIVE",
      String(codeOf(passive)),
    );
    const afterPassive = await prisma.roll.count({ where: { itemId: item.id } });
    check("pasif müşteri reddinde top DOĞMADI", afterPassive === createdRollIds.length, `n=${afterPassive}`);

    const ghostCustomer = await call("POST", PRODUCE_PATH, {
      token: fieldToken,
      body: {
        itemId,
        initialQty: 12,
        reason: "olmayan müşteri denemesi",
        clientToken: randomUUID(),
        targetCustomerId: randomUUID(),
      },
    });
    check(
      "olmayan müşteri → 400 CUSTOMER_NOT_FOUND",
      ghostCustomer.status === 400 && codeOf(ghostCustomer) === "CUSTOMER_NOT_FOUND",
      `${ghostCustomer.status} / ${String(codeOf(ghostCustomer))}`,
    );

    // Süpervizör izni (`roll:manual-adjust`) de kapıyı açmalı — TEST-ADMIN taşır.
    const bySupervisor = await produce(
      {
        itemId,
        initialQty: 7,
        reason: "süpervizör panelden bitmiş top ekliyor",
        clientToken: randomUUID(),
      },
      adminToken,
    );
    check(
      "roll:manual-adjust taşıyan kullanıcı da üretebiliyor → 201",
      bySupervisor.status === 201,
      `status=${bySupervisor.status}`,
    );

    // =========================================================================
    // I) ⭐ MOBİL TABLET YOLU — `x-device-id` ile gelen istek
    // =========================================================================
    // Bu bölümün varlık sebebi, C maddesinin ikizi olan İKİNCİ sessiz sezgi:
    // `createInitialEntry` giriş yerini CİHAZDAN çıkarır (`isMobileOrigin` →
    // eşleşmiş tablet = `SUPPLIER_RECEIPT`, cihazsız istek = `MANUAL_ENTRY`).
    // Manuel Mod TAM DA Tambur tabletinden kullanılacak; sezgi burada devrede
    // kalsaydı acil durumda elle alınan BİTMİŞ top envanter raporlarında "ham
    // tedarikçi girişi" olarak görünürdü — yanlış olduğu hiçbir yerde
    // patlamayan, yalnız rapor okunduğunda fark edilen bir sapma.
    //
    // Yukarıdaki A–G bölümleri bunu KANITLAMAZ: hiçbiri `x-device-id`
    // göndermiyor, yani hepsi sezginin "Electron" dalından geçiyor ve bugünkü
    // `TAMBUR_MANUAL` sonucunu `forcedEntrySource` olmadan da verirdi.
    const station = await prisma.station.create({
      data: {
        code: `TEST-MPRS-${stamp}`.slice(0, 32),
        name: `TEST Tambur İst. ${stamp}`,
        type: "INTERNAL",
        kind: "TAMBUR",
      },
      select: { id: true },
    });
    stationId = station.id;
    const machine = await prisma.machine.create({
      data: {
        stationId: station.id,
        code: `TEST-MPRM-${stamp}`.slice(0, 32),
        name: `TEST Tambur Makine ${stamp}`,
      },
      select: { id: true },
    });
    machineId = machine.id;
    const device = await prisma.device.create({
      data: {
        deviceId: `test-mpr-${stamp}`.slice(0, 64),
        name: `TEST Tambur Tablet ${stamp}`,
        status: "APPROVED",
        kind: "TABLET",
        machineId: machine.id,
      },
      select: { id: true, deviceId: true },
    });
    deviceRowId = device.id;

    // I-a) Oturumsuz mobil istek → 409. `enforceForMobile` kapısı bu uçta da
    // gerçek olmalı: iş emri izi olmayan bir doğumun TEK sorumluluk çapası
    // operatör + makine/istasyon + sebeptir; oturum yoksa çapanın yarısı yok.
    const sessionlessToken = randomUUID();
    const sessionless = await produce(
      {
        itemId,
        initialQty: 30,
        reason: "oturumsuz tabletten deneme",
        clientToken: sessionlessToken,
      },
      fieldToken,
      device.deviceId,
    );
    check(
      "mobil + çalışma oturumu YOK → 409",
      sessionless.status === 409,
      `status=${sessionless.status}`,
    );
    check(
      "409 kodu WORK_SESSION_REQUIRED",
      codeOf(sessionless) === "WORK_SESSION_REQUIRED",
      String(codeOf(sessionless)),
    );
    const sessionlessRolls = await prisma.roll.count({ where: { clientToken: sessionlessToken } });
    check("oturumsuz redde top DOĞMADI", sessionlessRolls === 0, `n=${sessionlessRolls}`);

    // I-b) Aktif oturumla aynı istek → 201 ve giriş yeri HÂLÂ TAMBUR_MANUAL.
    await prisma.workSession.create({
      data: {
        userId: fieldUser.id,
        deviceId: device.id,
        machineId: machine.id,
        stationId: station.id,
        lastActivityAt: new Date(),
      },
      select: { id: true },
    });
    const fromTablet = await produce(
      {
        itemId,
        initialQty: 64,
        reason: "manuel mod: tabletten bitmiş top alındı",
        clientToken: randomUUID(),
      },
      fieldToken,
      device.deviceId,
    );
    check("mobil + aktif oturum → 201", fromTablet.status === 201, `status=${fromTablet.status}`);
    const tabletRollId = dataOf(fromTablet).rollId as string | undefined;
    if (typeof tabletRollId === "string") {
      const r = await prisma.roll.findUniqueOrThrow({
        where: { id: tabletRollId },
        select: {
          entrySource: true,
          status: true,
          barcode: true,
          currentStepId: true,
          createdMachineId: true,
        },
      });
      check(
        "⭐ TABLET'ten gelse de entrySource=TAMBUR_MANUAL (SUPPLIER_RECEIPT DEĞİL)",
        r.entrySource === "TAMBUR_MANUAL",
        String(r.entrySource),
      );
      check(
        "tabletten üretilen renksiz top da WAREHOUSE + F barkod",
        r.status === "WAREHOUSE" && /^T\d{6}F\d{4}$/.test(String(r.barcode)),
        `${r.status} / ${String(r.barcode)}`,
      );
      check("tabletten üretilen top da hiçbir adıma bağlanmadı", r.currentStepId === null);
      check(
        "makine atfı damgalandı (createdMachineId)",
        r.createdMachineId === machine.id,
        String(r.createdMachineId),
      );
      const tabletMoves = await prisma.rollMovement.count({ where: { rollId: tabletRollId } });
      check("tabletten üretimde de RollMovement AÇILMADI", tabletMoves === 0, `n=${tabletMoves}`);

      const tabletLogs = await prisma.systemLog.findMany({
        where: { tableName: "ROLL", recordId: tabletRollId },
        select: { newData: true },
      });
      const tData = (tabletLogs.find(
        (l) => (l.newData as Record<string, unknown> | null)?.event === "TAMBUR_MANUAL_PRODUCE",
      )?.newData ?? {}) as Record<string, unknown>;
      check(
        "audit oturumun makine + istasyonunu taşıyor",
        tData.machineId === machine.id && tData.sessionStationId === station.id,
        `${String(tData.machineId)} / ${String(tData.sessionStationId)}`,
      );
    }

    // =========================================================================
    // H) ⭐ KK1 REGRESYONU — opts'SUZ createInitialEntry ESKİ davranışta
    // =========================================================================
    // `forcedStatus` KK1 yolunu bozmamalı: renk sezgisi orada DOĞRU ve tek
    // müşterisi KK1'dir. Bu bölüm olmadan yukarıdaki (C) maddesi KK1'i sessizce
    // WAREHOUSE'a çevirerek de yeşil kalabilirdi.
    const inventory = new InventoryService();

    const kk1Raw = await inventory.createInitialEntry(
      { itemId: item.id, initialQty: 300, clientToken: randomUUID() },
      undefined,
      null,
      true, // isMobileOrigin — KK1 istasyon taraması
    );
    createdRollIds.push(kk1Raw.data.id);
    check(
      "KK1 (renksiz) → STOCK (Ham Stok) — sezgi korundu",
      kk1Raw.data.status === "STOCK",
      `status=${kk1Raw.data.status}`,
    );
    check(
      "KK1 (renksiz) → barkod tip damgası H (ham)",
      typeof kk1Raw.data.barcode === "string" && /^T\d{6}H\d{4}$/.test(kk1Raw.data.barcode),
      String(kk1Raw.data.barcode),
    );
    check(
      "KK1 girişinde entrySource=SUPPLIER_RECEIPT (mobil kaynak)",
      kk1Raw.data.entrySource === "SUPPLIER_RECEIPT",
      String(kk1Raw.data.entrySource),
    );
    check("KK1 girişinde lastLabelSnapshot yazılmadı", kk1Raw.data.lastLabelSnapshot === null);
    check("KK1 girişinde kartelalık işareti yok", kk1Raw.data.markedForKartela === false);
    check("KK1 girişinde form=TOP", kk1Raw.data.form === "TOP", String(kk1Raw.data.form));

    const kk1Colored = await inventory.createInitialEntry(
      { itemId: item.id, colorId: color.id, initialQty: 120, clientToken: randomUUID() },
      undefined,
      null,
      false, // Electron "Manuel Top Ekle"
    );
    createdRollIds.push(kk1Colored.data.id);
    check(
      "KK1 (renkli) → WAREHOUSE — sezgi korundu",
      kk1Colored.data.status === "WAREHOUSE",
      `status=${kk1Colored.data.status}`,
    );
    check(
      "KK1 (renkli) → barkod tip damgası F (final)",
      typeof kk1Colored.data.barcode === "string" && /^T\d{6}F\d{4}$/.test(kk1Colored.data.barcode),
      String(kk1Colored.data.barcode),
    );
    check(
      "Electron manuel girişte entrySource=MANUAL_ENTRY",
      kk1Colored.data.entrySource === "MANUAL_ENTRY",
      String(kk1Colored.data.entrySource),
    );
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.stack : e);
  } finally {
    // Söküm: bu ürüne bağlı HER top (kırmızı koşumda beklenmedik top da olabilir)
    // → sonra master-data → sonra kullanıcılar.
    if (itemId) {
      const doomed = await prisma.roll.findMany({ where: { itemId }, select: { id: true } });
      const ids = doomed.map((r) => r.id);
      if (ids.length > createdRollIds.length) {
        console.warn(
          `  ⚠️  beklenmeyen top(lar) bu ürüne bağlanmış: ${ids.length} > ${createdRollIds.length}`,
        );
      }
      if (ids.length > 0) {
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.systemLog.deleteMany({ where: { recordId: { in: ids } } });
        await prisma.roll.deleteMany({ where: { id: { in: ids } } });
      }
      await prisma.systemLog.deleteMany({ where: { recordId: itemId } });
      await prisma.item.deleteMany({ where: { id: itemId } });
    }
    for (const cid of [activeCustomerId, passiveCustomerId]) {
      if (!cid) continue;
      await prisma.systemLog.deleteMany({ where: { recordId: cid } });
      await prisma.customer.deleteMany({ where: { id: cid } });
    }
    if (colorId) {
      await prisma.systemLog.deleteMany({ where: { recordId: colorId } });
      await prisma.color.deleteMany({ where: { id: colorId } });
    }
    // Mobil fixture'ı: oturum → cihaz → makine → istasyon (FK sırası ters).
    // Toplar YUKARIDA silindi; `createdMachineId` FK'sı bu yüzden makineyi tutmuyor.
    if (deviceRowId) {
      await prisma.workSession.deleteMany({ where: { deviceId: deviceRowId } });
      await prisma.systemLog.deleteMany({ where: { recordId: deviceRowId } });
      await prisma.device.deleteMany({ where: { id: deviceRowId } });
    }
    if (machineId) {
      await prisma.systemLog.deleteMany({ where: { recordId: machineId } });
      await prisma.machine.deleteMany({ where: { id: machineId } });
    }
    if (stationId) {
      await prisma.systemLog.deleteMany({ where: { recordId: stationId } });
      await prisma.station.deleteMany({ where: { id: stationId } });
    }
    for (const uid of [noPermUserId, fieldUserId]) {
      if (!uid) continue;
      await prisma.userPermission.deleteMany({ where: { userId: uid } });
      await prisma.session.deleteMany({ where: { userId: uid } });
      await prisma.workSession.deleteMany({ where: { userId: uid } });
      await prisma.systemLog.deleteMany({ where: { userId: uid } });
      await prisma.user.delete({ where: { id: uid } }).catch((e: unknown) => {
        console.warn(
          `  ⚠️  temizlik: test kullanıcısı silinemedi (${uid}):`,
          e instanceof Error ? e.message.split("\n")[0] : String(e),
        );
      });
    }
    console.log(
      "(temizlendi — TEST- ürün/renk/müşteriler + toplar + kullanıcılar + cihaz/makine/istasyon)",
    );

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
