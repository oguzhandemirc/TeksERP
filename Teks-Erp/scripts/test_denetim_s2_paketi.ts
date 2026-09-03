// =============================================================================
// BEKÇİ — DENETİM S2 PAKETİ (2026-08-29): T2-005 · T2-013 · T1-039
// Çalıştır: npx tsx scripts/test_denetim_s2_paketi.ts
// =============================================================================
// §1 SİPARİŞ İPTALİ ÇIKMAZI (T2-005) — "izinli aksiyonlar" ile "varsayılan
//    aksiyon" iki BAĞIMSIZ fonksiyondu ve sessizce ayrıştılar: iptal edilmiş iş
//    emrine bağlı tek-siparişli bir siparişte izinli liste ["UNLINK_ONLY"] iken
//    varsayılan CONVERT_TO_STOCK dönüyordu. Arayüz izinli aksiyon tek olduğu
//    için seçim kutusunu çizmiyor → istemci bir şey göndermiyor → sunucu
//    varsayılana düşüyor → "geçersiz" 400'ü. Yenilemek işe yaramıyor: sipariş
//    HİÇBİR yoldan iptal edilemiyor ve sonsuza dek "açık talep" sayılıyordu
//    (prod'da 2 canlı sipariş kilitliydi; tek çıkış DB'ye elle müdahaleydi).
//
// §2 KENDİNE TAM YETKİ (T2-013) — `admin:users` taşıyan hesap kendi id'sine
//    `admin:*` yazabiliyordu. Son-admin koruması yalnız yetki DÜŞÜREN dalda
//    koşuyor, YÜKSELTEN dalda hiçbir kontrol yoktu. Üç yazma yolu var
//    (tekil grant · toplu set · şablon uygulama) ve üçü de açıktı.
//
// §3 DEPODA HAYALET TOP (T1-039) — depo topu tek parça kesilince kaynak
//    WAREHOUSE / 0 m / barkodlu kalıyordu: listede fazla satır, çuvala
//    okutulabilen ve "top adedi"ni şişiren bir hayalet, irsaliyede 0 m'lik kalem.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { PermissionManagementService } from "../src/services/permission-management.service";
import { RollStatus } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
type Hata = { message: string; code?: string; statusCode?: number } | null;
async function hataOf(fn: () => Promise<unknown>): Promise<Hata> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { message: string; statusCode?: number; details?: { code?: string } };
    return { message: err.message, code: err.details?.code, statusCode: err.statusCode };
  }
}

const ts = Date.now();
const userIds: string[] = [];
const rollIds: string[] = [];
let itemId = "";

async function main(): Promise<void> {
  // ═══ §1 — izinli liste ile varsayılan AYRIŞAMAZ ═══
  console.log("\n=== §1: sipariş iptali — varsayılan aksiyon izinli listeden türer ===");
  // Saf fonksiyonlar dışa açılmıyor; kaynağı okuyup DAVRANIŞ sözleşmesini
  // ölçüyoruz. Asıl güvence aşağıdaki kombinasyon taramasıdır.
  const src = readFileSync(join(__dirname, "../src/services/order.service.ts"), "utf8");
  const basla = src.indexOf("function pickDefaultAction(");
  const bitis = basla >= 0 ? src.indexOf("\n}", basla) : -1;
  check("§1: pickDefaultAction bulundu (körlük zemini)", basla >= 0 && bitis > basla);
  const govde = basla >= 0 ? src.slice(basla, bitis) : "";
  check(
    "§1: varsayılan İZİNLİ LİSTEDEN türetiliyor (bağımsız yazılmıyor)",
    govde.includes("computeAllowedActions(") && govde.includes("allowed.includes("),
    govde.includes("computeAllowedActions(") ? "listeden türetiyor" : "BAĞIMSIZ — ayrışabilir!",
  );
  // Kombinasyon taraması: her (woStatus × isSoleOrder) için varsayılan izinli mi.
  // Fonksiyonlar dışa açık olmadığı için sözleşmeyi kaynak üzerinden kurup
  // ölçüyoruz — ama SIRALAMA değil ANLAM ölçülüyor: "PLANNED+tek" vakası eski
  // kodda kırmızı verirdi (izinli=[UNLINK_ONLY], varsayılan=CONVERT_TO_STOCK).
  const kombinasyonlar = [
    { status: "PLANNED", sole: true },
    { status: "PLANNED", sole: false },
    { status: "COMPLETED", sole: true },
    { status: "COMPLETED", sole: false },
    { status: "IN_PROGRESS", sole: true },
    { status: "IN_PROGRESS", sole: false },
    { status: "CANCELLED", sole: true }, // ← prod'da kilitli kalan vaka
    { status: "CANCELLED", sole: false },
    { status: "SUPERSEDED", sole: true },
  ];
  const mod = (await import("../src/services/order.service")) as unknown as {
    __test__?: { computeAllowedActions: (s: string, b: boolean) => string[]; pickDefaultAction: (s: string, b: boolean) => string };
  };
  if (mod.__test__) {
    let hepsi = true;
    for (const k of kombinasyonlar) {
      const izinli = mod.__test__.computeAllowedActions(k.status, k.sole);
      const varsayilan = mod.__test__.pickDefaultAction(k.status, k.sole);
      if (!izinli.includes(varsayilan)) {
        hepsi = false;
        console.error(`   ↳ ${k.status}/${k.sole}: varsayılan ${varsayilan} ∉ [${izinli.join(",")}]`);
      }
    }
    check("§1: her (durum × tek-sipariş) için varsayılan İZİNLİ", hepsi, `${kombinasyonlar.length} kombinasyon`);
  } else {
    check("§1: saf fonksiyonlar test için dışa açık", false, "__test__ ihracı yok");
  }

  // ═══ §2 — kendi yetkisini genişletemez ═══
  console.log("\n=== §2: kendine tam yetki yazma ===");
  const wildcard = await prisma.permission.findFirst({ where: { code: "admin:*" }, select: { id: true } });
  const usersPerm = await prisma.permission.findFirst({ where: { code: "admin:users" }, select: { id: true } });
  check("§2: fixture hazır (admin:* + admin:users izinleri)", Boolean(wildcard && usersPerm));
  if (!wildcard || !usersPerm) return;

  const aktor = await prisma.user.create({
    data: { username: `tst-esc-${ts}`, passwordHash: "x", fullName: "Sonda Aktör" },
    select: { id: true },
  });
  userIds.push(aktor.id);
  await prisma.userPermission.create({ data: { userId: aktor.id, permissionId: usersPerm.id } });

  const e1 = await hataOf(() =>
    PermissionManagementService.grantPermission(aktor.id, { permissionId: wildcard.id }, aktor.id),
  );
  check("§2a: tekil grant ile kendine admin:* REDDEDİLDİ", e1 !== null, e1?.message?.slice(0, 55) ?? "SESSİZ BAŞARI!");
  check("§2a: MAKİNE-OKUR kod + 409", e1?.code === "SELF_ESCALATION" && e1?.statusCode === 409, `${e1?.code ?? "—"} / ${e1?.statusCode ?? "—"}`);

  const e2 = await hataOf(() =>
    PermissionManagementService.setUserPermissions(aktor.id, [usersPerm.id, wildcard.id], aktor.id),
  );
  check("§2b: toplu set ile kendine admin:* REDDEDİLDİ", e2?.code === "SELF_ESCALATION", e2?.code ?? "SESSİZ BAŞARI!");

  const sablon = await prisma.permissionTemplate.create({
    data: { name: `TST-ESC-${ts}`, permissions: { create: [{ permissionId: wildcard.id }] } },
    select: { id: true },
  });
  const e3 = await hataOf(() =>
    PermissionManagementService.applyTemplate(aktor.id, sablon.id, "merge", aktor.id),
  );
  check("§2c: şablon uygulayarak kendine admin:* REDDEDİLDİ", e3?.code === "SELF_ESCALATION", e3?.code ?? "SESSİZ BAŞARI!");

  const halaYok = await prisma.userPermission.count({ where: { userId: aktor.id, permissionId: wildcard.id } });
  check("§2: üç denemenin hiçbiri yetkiyi YAZAMADI", halaYok === 0, `${halaYok} satır`);

  // REGRESYON: BAŞKASINA yetki vermek serbest (ucun asıl işi)
  const hedef = await prisma.user.create({
    data: { username: `tst-esc-h-${ts}`, passwordHash: "x", fullName: "Sonda Hedef" },
    select: { id: true },
  });
  userIds.push(hedef.id);
  const e4 = await hataOf(() =>
    PermissionManagementService.grantPermission(hedef.id, { permissionId: wildcard.id }, aktor.id),
  );
  check("§2 REGRESYON: BAŞKASINA yetki vermek hâlâ serbest", e4 === null, e4?.message?.slice(0, 45) ?? "");
  // REGRESYON: kendi yetkisini DÜŞÜRMEK serbest
  const e5 = await hataOf(() =>
    PermissionManagementService.setUserPermissions(aktor.id, [usersPerm.id], aktor.id),
  );
  check("§2 REGRESYON: kendi kümesini AYNI bırakmak/daraltmak serbest", e5 === null, e5?.message?.slice(0, 45) ?? "");

  await prisma.permissionTemplate.deleteMany({ where: { id: sablon.id } }).catch(() => {});

  // ═══ §3 — tükenen kaynak top emekli oluyor ═══
  console.log("\n=== §3: depo kesiminde tükenen kaynak ===");
  const item = await prisma.item.create({
    data: { code: `TST-S2-${ts}`, name: `Test S2 Paketi ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  itemId = item.id;
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) {
    check("§3: admin kullanıcı bulundu", false);
    return;
  }
  const kaynak = await prisma.roll.create({
    data: {
      barcode: `TST-S2-${ts}`,
      itemId,
      initialQty: 40,
      currentQty: 40,
      status: RollStatus.WAREHOUSE,
      finalizedAt: new Date(),
      // Depo topu kalitesiyle iner — gradesiz fixture bu bekçiyi kendi
      // konusundan değil `quality.gradeRequiredEnabled` kapısından düşürürdü.
      qualityGrade: "1.KALITE",
    },
    select: { id: true },
  });
  rollIds.push(kaynak.id);

  const { TamburService } = await import("../src/services/tambur.service");
  const tambur = new TamburService();
  const kesim = await tambur.cutWarehouseRoll(kaynak.id, { cutLength: 40 }, admin.id);
  const cocuk = (kesim.data as { childRoll: { id: string } }).childRoll;
  rollIds.push(cocuk.id);

  const taze = await prisma.roll.findUnique({
    where: { id: kaynak.id },
    select: { status: true, currentQty: true, preTamburCloseQty: true, preTamburCloseStatus: true },
  });
  check("§3: tükenen kaynak DEPODA KALMADI (emekli edildi)", taze?.status === RollStatus.TAMBUR_CONSUMED, taze?.status ?? "");
  check("§3: metrajı 0", Number(taze?.currentQty) === 0, `${taze?.currentQty}`);
  check(
    "§3: geri alma için kapanış öncesi HÂL yazıldı (metraj + statü)",
    Number(taze?.preTamburCloseQty) === 40 && taze?.preTamburCloseStatus === RollStatus.WAREHOUSE,
    `${taze?.preTamburCloseQty} / ${taze?.preTamburCloseStatus ?? "—"}`,
  );
  const c = await prisma.roll.findUnique({ where: { id: cocuk.id }, select: { currentQty: true } });
  check("§3: çocuk topun metrajı doğru (40 m)", Number(c?.currentQty) === 40, `${c?.currentQty}`);

  // REGRESYON: KISMİ kesimde kaynak depoda KALMALI
  const kaynak2 = await prisma.roll.create({
    data: {
      barcode: `TST-S2B-${ts}`, itemId, initialQty: 40, currentQty: 40,
      status: RollStatus.WAREHOUSE, finalizedAt: new Date(), qualityGrade: "1.KALITE",
    },
    select: { id: true },
  });
  rollIds.push(kaynak2.id);
  const kesim2 = await tambur.cutWarehouseRoll(kaynak2.id, { cutLength: 15 }, admin.id);
  rollIds.push((kesim2.data as { childRoll: { id: string } }).childRoll.id);
  const taze2 = await prisma.roll.findUnique({ where: { id: kaynak2.id }, select: { status: true, currentQty: true } });
  check(
    "§3 REGRESYON: KISMİ kesimde kaynak depoda KALIYOR (25 m)",
    taze2?.status === RollStatus.WAREHOUSE && Number(taze2?.currentQty) === 25,
    `${taze2?.status} / ${taze2?.currentQty}`,
  );
}

async function cleanup(): Promise<void> {
  const hepsi = await prisma.roll.findMany({ where: { itemId }, select: { id: true } }).catch(() => []);
  const ids = [...new Set([...rollIds, ...hepsi.map((r) => r.id)])];
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
  await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  // ⚠️ RESTRICT FK (K6): audit izi kullanıcıyı kilitler — önce log satırları.
  await prisma.systemLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  await prisma.permissionTemplate.deleteMany({ where: { name: { startsWith: "TST-ESC-" } } }).catch(() => {});
}

main()
  .catch((err) => {
    console.error("Beklenmeyen hata:", err);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
