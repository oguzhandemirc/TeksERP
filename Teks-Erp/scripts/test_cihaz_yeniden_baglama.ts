/**
 * Bekçi: cihaz eşleme v2 (D1) — donanım özetiyle tanıma, yeni satır yerine YENİDEN BAĞLAMA.
 * Kök neden: kimlik uygulama deposundaki rastgele localId'ydi; kaldır-kur depoyu silince sunucu yeni
 * `devices` satırı açıyordu. Artık bilinen `hw` yeni localId ile gelirse aynı satıra bağlanır
 * (eşleştirme kapalıysa otomatik, zorunluysa/barındırılanda talep + yönetici onayı).
 * Gerçek HTTP: app aynı süreçte 127.0.0.1:<boş port> (ikinci süreç yok). Yalnız `_test` DB.
 * Koşum: `cd Teks-Erp && npx tsx scripts/test_cihaz_yeniden_baglama.ts`
 *
 * NEGATİF SONDALAR (2026-10-24, ölçüldü; her biri md5 ile geri yüklendi):
 *   (i)   kısmi UNIQUE `devices_hw_digest_live_uq` DROP          → 2 kırmızı (§8a eşzamanlı iki satır, §8b)
 *   (ii)  barındırılanda otomatik bağlama (auto'dan pairingRequired düşer) → 4 kırmızı (§5a–§5d) + çıkış 1
 *   (iii) yeniden bağlamada kanıt sıfırlama kaldırılır            → 4 kırmızı (§2f, §2g, §5f, §5h)
 *   (iv)  pasif cihaza otomatik bağlama (isActive koşulu düşer)  → 6 kırmızı (§3a–§3e, §5b)
 *   (v)   `hw`siz doğuşta ad biçimi değişir                       → 1 kırmızı (§4b)
 *   (vi)  yerinde onayda kilit rezervasyonu atlanır               → 1 kırmızı (§6b)
 */
import prisma from "../src/lib/prisma"; // İLK import: dotenv → DATABASE_URL
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import ts from "typescript";
import { Prisma } from "@prisma/client";
import { AuthService } from "../src/services/auth.service";
import { DeviceService } from "../src/services/device.service";
import { DeviceRebindService } from "../src/services/device-rebind.service";
import { computeHwDigest, countSeatDevices } from "../src/services/helpers/device-identity.helper";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { resetLoginLockout, flushLoginLockoutPersistence } from "../src/middlewares/login-lockout";
import { resetOnsiteRebindRateForTests } from "../src/controllers/device.controller";
import { buildDeviceProof, verifyDeviceProof, deriveDeviceSecret, newProofSalt } from "../src/lib/device-proof";
import { getShortCredentialKeyRing, setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { fixtureHedefEngeli } from "./lib/hedef-db-kapisi";
import { INSTALL_CLASS_ENV } from "../src/services/helpers/install-class.helper";

let gecti = 0;
let kaldi = 0;
function check(etiket: string, ok: boolean, ayrinti = ""): void {
  if (ok) gecti++;
  else kaldi++;
  console.log(`${ok ? "✅" : "❌"} ${etiket}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

type Cevap = { status: number; body: Record<string, unknown>; raw: string };
function istek(port: number, method: string, yol: string, govde: unknown, basliklar: Record<string, string> = {}): Promise<Cevap> {
  const veri = govde === undefined ? "" : JSON.stringify(govde);
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "127.0.0.1", port, path: yol, method,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(veri), ...basliklar } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let j: Record<string, unknown> = {};
          try { j = JSON.parse(b); } catch { /* düz metin */ }
          resolve({ status: res.statusCode ?? 0, body: j, raw: b });
        });
      },
    );
    r.on("error", reject);
    if (veri) r.write(veri);
    r.end();
  });
}
const kod = (c: Cevap): string => String((c.body.details as { code?: string } | undefined)?.code ?? "");
const data = (c: Cevap): Record<string, unknown> => (c.body.data as Record<string, unknown> | undefined) ?? {};
const ozet = (): string => randomBytes(32).toString("hex");
const hw = (o: string) => ({ v: 1, kaynak: "ANDROID_ID", ozet: o });

// ─── §1 saf: test vektörü (D2/D3 bayt-eşit uygular) ───
// installationId · kaynak · ham → ozet; `openssl dgst -sha256 -hmac <installationId>` ile bağımsız doğrulandı.
const VEKTOR = {
  installationId: "00000000-0000-4000-8000-000000000001",
  kaynak: "ANDROID_ID" as const,
  ham: "9774d56d682e549c",
  ozet: "b1c0721db73f7297afbeadaddff6de68c62f572cc68d36c9a0de087600dea9c7",
};
function sSaf(): void {
  console.log("\n=== §1 hw sözleşmesi (saf) ===");
  check("§1a test vektörü: HMAC-SHA256(installationId, domain\\nkaynak\\nham)",
    computeHwDigest(VEKTOR.installationId, VEKTOR.kaynak, VEKTOR.ham) === VEKTOR.ozet);
  check("§1b kaynak özete bağlı (aynı ham, başka kaynak → başka özet)",
    computeHwDigest(VEKTOR.installationId, "LINUX_MACHINE_ID", VEKTOR.ham) !== VEKTOR.ozet);
  check("§1c kurulum anahtarı özete bağlı (başka fabrika → başka özet)",
    computeHwDigest("00000000-0000-4000-8000-000000000002", VEKTOR.kaynak, VEKTOR.ham) !== VEKTOR.ozet);
}

// ─── §9 AST: cihazın `mergedIntoId`i yalnız kimlik helper'ında ───
const HELPER = "src/services/helpers/device-identity.helper.ts";
/** Cihaz bağlamında `mergedIntoId` geçişleri: `*.device.<op>(...)` argümanı, cihaz dosyası, ham SQL `devices`. */
function cihazMergedIhlalleri(dosya: string, kaynak: string): string[] {
  const sf = ts.createSourceFile(dosya, kaynak, ts.ScriptTarget.Latest, true);
  const cihazDosyasi = /(^|\/)device[^/]*\.ts$|[-.]device[^/]*\.ts$/.test(dosya);
  const out: string[] = [];
  const mergedMi = (n: ts.Node): boolean =>
    (ts.isIdentifier(n) && n.text === "mergedIntoId") ||
    (ts.isStringLiteral(n) && n.text === "mergedIntoId") ||
    (ts.isPropertyAccessExpression(n) && n.name.text === "mergedIntoId");
  const altta = (n: ts.Node): boolean => {
    let bulundu = false;
    const gez = (x: ts.Node): void => { if (bulundu) return; if (mergedMi(x)) { bulundu = true; return; } ts.forEachChild(x, gez); };
    gez(n);
    return bulundu;
  };
  const satir = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const gez = (n: ts.Node): void => {
    if (cihazDosyasi && mergedMi(n)) out.push(`${dosya}:${satir(n)}`);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const hedef = n.expression.expression;
      if (ts.isPropertyAccessExpression(hedef) && hedef.name.text === "device" && n.arguments.some(altta)) {
        out.push(`${dosya}:${satir(n)}`);
      }
    }
    if ((ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isStringLiteral(n))
      && /"devices"/.test(n.text) && /mergedIntoId/.test(n.text)) out.push(`${dosya}:${satir(n)}`);
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return [...new Set(out)];
}
function tsDosyalari(d: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(d)) {
    const p = join(d, ad);
    if (statSync(p).isDirectory()) out.push(...tsDosyalari(p));
    else if (ad.endsWith(".ts") && !ad.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
function sAst(): void {
  console.log("\n=== §9 AST: mergedIntoId (cihaz) yalnız kimlik helper'ında ===");
  const kok = join(__dirname, "..");
  const dosyalar = tsDosyalari(join(kok, "src"));
  const ihlal: string[] = [];
  for (const p of dosyalar) {
    const r = relative(kok, p);
    if (r === HELPER) continue;
    ihlal.push(...cihazMergedIhlalleri(r, readFileSync(p, "utf8")));
  }
  check("§9a cihaz `mergedIntoId` okuması/yazımı helper dışında YOK", ihlal.length === 0, ihlal.slice(0, 5).join(", "));
  check("§9b helper gerçekten `mergedIntoId` taşıyor (körlük zemini)",
    readFileSync(join(kok, HELPER), "utf8").includes("mergedIntoId: null") && dosyalar.length > 100, `${dosyalar.length} dosya`);
  // Kalıcı sondalar: tarayıcının kendisi ölçülür (sessiz kapı olmasın).
  const s1 = cihazMergedIhlalleri("src/services/x.service.ts", "prisma.device.findMany({ where: { mergedIntoId: null } });");
  const s2 = cihazMergedIhlalleri("src/services/device.service.ts", "const a = row.mergedIntoId;");
  const s3 = cihazMergedIhlalleri("src/services/x.service.ts", 'prisma.$queryRaw`SELECT 1 FROM "devices" WHERE "mergedIntoId" IS NULL`;');
  const s4 = cihazMergedIhlalleri("src/services/item.service.ts", "prisma.item.findMany({ where: { mergedIntoId: null } });");
  check("§9c sonda: delege argümanı · cihaz dosyası · ham SQL yakalanır; ana veri birleşmesi yakalanmaz",
    s1.length === 1 && s2.length === 1 && s3.length === 1 && s4.length === 0, `${s1.length}/${s2.length}/${s3.length}/${s4.length}`);
}

async function main(): Promise<void> {
  const engel = fixtureHedefEngeli();
  if (engel) {
    console.error(`HEDEF RED: ${engel}`);
    process.exit(2);
  }
  setShortCredentialKeyDirForTests(mkdtempSync(join(tmpdir(), "cihaz-baglama-halka-")));
  delete process.env[INSTALL_CLASS_ENV];
  delete process.env.RATE_LIMIT_ENABLED;
  resetOnsiteRebindRateForTests();

  sSaf();
  const halka = getShortCredentialKeyRing();
  if (!halka.ok) throw new Error(`anahtar halkası yok: ${halka.detail}`);

  const { default: app } = await import("../src/app");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const stamp = Date.now();
  const AYARLAR = [
    SETTING_KEYS.DEVICE_PAIRING_REQUIRED, SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY,
    SETTING_KEYS.DEVICE_PROOF_REQUIRED,
  ];
  const once = new Map<string, unknown>();
  for (const k of AYARLAR) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    once.set(k, row ? row.value : undefined);
  }
  const perm = await prisma.permission.findFirst({ where: { code: "admin:settings" }, select: { id: true } });
  if (!perm) throw new Error("admin:settings izin kaydı yok (seed eksik?)");
  const adminParola = `Yb-${randomBytes(9).toString("hex")}`; // değer basılmaz
  const yonetici = await prisma.user.create({
    data: {
      username: `cyb-yon-${stamp}`, fullName: "Yeniden bağlama bekçisi yönetici",
      passwordHash: await AuthService.hashPassword(adminParola), isActive: true,
      permissions: { create: [{ permissionId: perm.id }] },
    },
    select: { id: true, username: true },
  });
  const yetkisiz = await prisma.user.create({
    data: {
      username: `cyb-ops-${stamp}`, fullName: "Yeniden bağlama bekçisi operatör",
      passwordHash: await AuthService.hashPassword(adminParola), isActive: true,
    },
    select: { id: true, username: true },
  });
  const set = async (key: string, value: unknown): Promise<void> => {
    await prisma.systemSetting.upsert({
      where: { key }, create: { key, value: value as never, updatedById: yonetici.id }, update: { value: value as never, updatedById: yonetici.id },
    });
    invalidateFeatureFlagsCache();
  };
  const kilitTemizle = async (): Promise<void> => {
    for (const k of ["127.0.0.1", "::ffff:127.0.0.1"]) resetLoginLockout(k);
    await flushLoginLockoutPersistence();
  };
  const announce = (localId: string, govde: Record<string, unknown> = {}) =>
    istek(port, "POST", "/api/devices/announce", { deviceId: localId, ...govde });
  const durum = (localId: string) => istek(port, "GET", "/api/devices/status", undefined, { "x-device-id": localId });
  const olaylar = (where: Prisma.DeviceBindingEventWhereInput) =>
    prisma.deviceBindingEvent.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const auditVar = async (recordId: string, event: string) =>
    prisma.systemLog.findFirst({ where: { recordId, newData: { path: ["event"], equals: event } } });

  const yaratilan: string[] = [];
  let periferikId: string | null = null;

  try {
    await set(SETTING_KEYS.DEVICE_PAIRING_REQUIRED, false);
    await set(SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY, false);
    await set(SETTING_KEYS.DEVICE_PROOF_REQUIRED, false);
    await kilitTemizle();

    // ─── §2 bayrak kapalı: bilinen donanım yeni localId'yle → AYNI satır ───
    console.log("\n=== §2 eşleştirme kapalı → otomatik yeniden bağlama ===");
    const H = ozet();
    const A1 = randomUUID();
    const a1 = await announce(A1, { hw: hw(H), model: "SM-T505" });
    const cihaz = await prisma.device.findUnique({ where: { deviceId: A1 }, select: { id: true, name: true, hwDigest: true, status: true } });
    if (!cihaz) throw new Error(`ilk announce satır açmadı: HTTP ${a1.status} ${a1.raw.slice(0, 200)}`);
    yaratilan.push(cihaz.id);
    check("§2a ilk announce donanım özetini doğuşta yazar", cihaz.hwDigest === H && cihaz.status === "APPROVED", `HTTP ${a1.status}`);
    const makine = await prisma.machine.findFirst({ where: { code: "KK1-M1" }, select: { id: true } }); // seed:fixtures
    const periferik = await prisma.peripheralDevice.create({
      data: { code: `CYB-${stamp}`.slice(0, 48), name: "Bekçi yazıcı", kind: "LABEL_PRINTER", connectionType: "BLUETOOTH_SPP" },
      select: { id: true },
    });
    periferikId = periferik.id;
    await prisma.devicePeripheral.create({ data: { deviceId: cihaz.id, peripheralId: periferik.id } });
    const eskiTuz = newProofSalt(halka.ring.active);
    await prisma.device.update({
      where: { id: cihaz.id },
      data: { machineId: makine?.id ?? null, proofSalt: eskiTuz, proofIssuedAt: new Date(), proofConfirmedAt: new Date() },
    });
    const A2 = randomUUID();
    const a2 = await announce(A2, { hw: hw(H) });
    const sonra = await prisma.device.findUnique({
      where: { id: cihaz.id },
      select: { deviceId: true, machineId: true, proofSalt: true, proofConfirmedAt: true, _count: { select: { hardwareLinks: true } } },
    });
    const ayniHw = await prisma.device.count({ where: { hwDigest: H } });
    check("§2b yeni localId + bilinen hw → aynı satır (yeni satır YOK)", sonra?.deviceId === A2 && ayniHw === 1, `HTTP ${a2.status} · ${ayniHw} satır`);
    check("§2c makine ataması korunur", !!makine && sonra?.machineId === makine.id && data(a2).machineId === makine.id);
    check("§2d donanım bağı (device_peripherals) korunur", sonra?._count.hardwareLinks === 1);
    const reb = await olaylar({ deviceRefId: cihaz.id, event: "REBOUND", localId: A2 });
    const m = (reb[0]?.meta ?? {}) as Record<string, unknown>;
    check("§2e defter REBOUND (yol=OTOMATIK, eski localId)", reb.length === 1 && m.yol === "OTOMATIK" && m.eskiLocalId === A1);
    check("§2f eski kurulumun sırrı ölür (teyit + tuz yenilendi)", !!sonra && sonra.proofSalt !== eskiTuz && sonra.proofConfirmedAt === null);
    check("§2g yeni kurulum yeni sır alır", /^[0-9a-f]{64}$/.test(String(data(a2).deviceSecret ?? "")));
    const eskiA1 = await durum(A1);
    check("§2h eski localId artık tanınmaz (UNKNOWN)", data(eskiA1).status === "UNKNOWN", String(data(eskiA1).status));

    // ─── §3 pasif cihaz: otomatik bağlama YOK, talep ───
    console.log("\n=== §3 pasif cihaz → talep (public uç yönetici kararını geri alamaz) ===");
    await prisma.device.update({ where: { id: cihaz.id }, data: { isActive: false } });
    const A3 = randomUUID();
    const a3 = await announce(A3, { hw: hw(H) });
    check("§3a pasif hedef → REBIND_PENDING + targetName", data(a3).status === "REBIND_PENDING" && data(a3).targetName === cihaz.name,
      `HTTP ${a3.status} ${String(data(a3).status)} ${kod(a3)}`);
    const pasifSonra = await prisma.device.findUnique({ where: { id: cihaz.id }, select: { deviceId: true, isActive: true } });
    check("§3b pasif satır bağlanmadı, dirilmedi", pasifSonra?.deviceId === A2 && pasifSonra.isActive === false);
    const t3 = await prisma.deviceRebindRequest.findUnique({ where: { localId: A3 } });
    check("§3c talep açıldı (devices'a satır yok)", t3?.status === "OPEN" && (await prisma.device.count({ where: { deviceId: A3 } })) === 0);
    const d3 = await durum(A3);
    check("§3d status ucu aynı REBIND_PENDING yanıtını döner", data(d3).status === "REBIND_PENDING" && data(d3).pairingRequired === true);
    if (t3) await DeviceRebindService.reject(t3.id, { mode: "REDDET" }, yonetici.id);
    const a3b = await announce(A3, { hw: hw(H) });
    check("§3e reddedilen talep yeniden açılmaz (REBIND_REJECTED)", data(a3b).status === "REBIND_REJECTED", String(data(a3b).status));
    await prisma.device.update({ where: { id: cihaz.id }, data: { isActive: true } });

    // ─── §4 hw'siz eski istemci: bugünkü davranış bayt-eşit ───
    console.log("\n=== §4 hw göndermeyen istemci (bayt-eşit) ===");
    const B = randomUUID();
    const b = await announce(B, { kind: "TABLET" });
    const bd = data(b);
    const { deviceSecret: bSir, ...bAtama } = bd;
    check("§4a yanıt bugünkü biçim (alan kümesi + değerler)",
      b.status === 200 && JSON.stringify(bAtama) === JSON.stringify({
        pairingRequired: false, unpairedPasswordLogin: false, status: "APPROVED", machineId: null,
        machineCode: null, machineName: null, stationId: null, stationName: null,
      }) && /^[0-9a-f]{64}$/.test(String(bSir ?? "")), JSON.stringify(bAtama));
    const bRow = await prisma.device.findUnique({ where: { deviceId: B } });
    if (bRow) yaratilan.push(bRow.id);
    check("§4b satır alanları bugünkü doğuş (ad, tür, durum, aktiflik; hw/birleşme boş)",
      !!bRow && bRow.name === `Tablet ${B.slice(0, 8)}` && bRow.kind === "TABLET" && bRow.status === "APPROVED" && bRow.isActive
        && bRow.hwDigest === null && bRow.hwSource === null && bRow.machineId === null && bRow.mergedAt === null,
      bRow ? `${bRow.name} ${bRow.status}` : "satır yok");
    const bReg = bRow ? await olaylar({ deviceRefId: bRow.id, event: "REGISTERED" }) : [];
    check("§4c doğuş defterde REGISTERED + audit DEVICE_AUTO_APPROVED", bReg.length === 1 && !!bRow && !!(await auditVar(bRow.id, "DEVICE_AUTO_APPROVED")));
    await set(SETTING_KEYS.DEVICE_PAIRING_REQUIRED, true);
    const C = randomUUID();
    const c = await announce(C, {});
    const cRow = await prisma.device.findUnique({ where: { deviceId: C } });
    if (cRow) yaratilan.push(cRow.id);
    check("§4d eşleştirme zorunlu + hw'siz → PENDING doğar (bugünkü)", data(c).status === "PENDING" && cRow?.status === "PENDING");
    check("§4e PENDING doğuş audit'te (DEVICE_REGISTERED_PENDING) + REGISTERED",
      !!cRow && !!(await auditVar(cRow.id, "DEVICE_REGISTERED_PENDING")) && (await olaylar({ deviceRefId: cRow.id, event: "REGISTERED" })).length === 1);
    await set(SETTING_KEYS.DEVICE_PAIRING_REQUIRED, false);
    const uzun = await announce("x".repeat(70), {});
    check("§4f 64 karakteri aşan localId 400 (eskiden 80'e kadar kabul → kolon 500)", uzun.status === 400, `HTTP ${uzun.status}`);

    // ─── §5 barındırılan: talep, panelden onay, eski sır geçersiz ───
    console.log("\n=== §5 barındırılan sınıf → talep + panel onayı ===");
    process.env[INSTALL_CLASS_ENV] = "BARINDIRILAN";
    let A4 = "";
    let A5 = "";
    try {
      const eskiTuz2 = newProofSalt(halka.ring.active);
      await prisma.device.update({
        where: { id: cihaz.id }, data: { proofSalt: eskiTuz2, proofIssuedAt: new Date(), proofConfirmedAt: new Date() },
      });
      const eskiSir = deriveDeviceSecret(halka.ring, A2, eskiTuz2)!;
      A4 = randomUUID();
      const a4 = await announce(A4, { hw: hw(H), model: "SM-T505" });
      check("§5a barındırılan + bilinen hw → REBIND_PENDING (otomatik bağlama YOK)", data(a4).status === "REBIND_PENDING",
        `HTTP ${a4.status} ${String(data(a4).status)}`);
      const r4 = await prisma.device.findUnique({ where: { id: cihaz.id }, select: { deviceId: true } });
      check("§5b hedef satırın anahtarı değişmedi", r4?.deviceId === A2, String(r4?.deviceId));
      const t4 = await prisma.deviceRebindRequest.findUnique({ where: { localId: A4 } });
      check("§5c talep OPEN + REBIND_REQUESTED defterde", t4?.status === "OPEN"
        && (await olaylar({ localId: A4, event: "REBIND_REQUESTED" })).length === 1);
      // Eşzamanlı iki announce, aynı localId + hw → tek talep, tek defter satırı.
      A5 = randomUUID();
      const [e1, e2] = await Promise.all([announce(A5, { hw: hw(H) }), announce(A5, { hw: hw(H) })]);
      const t5n = await prisma.deviceRebindRequest.count({ where: { localId: A5 } });
      const t5e = (await olaylar({ localId: A5, event: "REBIND_REQUESTED" })).length;
      check("§5d eşzamanlı iki announce → tek talep, tek REBIND_REQUESTED",
        data(e1).status === "REBIND_PENDING" && data(e2).status === "REBIND_PENDING" && t5n === 1 && t5e === 1,
        `${data(e1).status}/${data(e2).status} · ${t5n} talep · ${t5e} olay`);
      check("§5e talep `devices`a satır açmadı", (await prisma.device.count({ where: { hwDigest: H } })) === 1);
      if (!t4) throw new Error("talep yok — §5 devam edemez");
      await DeviceRebindService.approve(t4.id, yonetici.id, "PANEL");
      const r5 = await prisma.device.findUnique({ where: { id: cihaz.id }, select: { deviceId: true, proofSalt: true, proofConfirmedAt: true } });
      check("§5f panel onayı aynı satıra bağlar, kanıt alanları düşer", r5?.deviceId === A4 && r5.proofSalt === null && r5.proofConfirmedAt === null);
      const pr = await olaylar({ deviceRefId: cihaz.id, event: "REBOUND", localId: A4 });
      check("§5g defter REBOUND (yol=PANEL, actor) + audit DEVICE_REBIND_APPROVED",
        pr.length === 1 && (pr[0]!.meta as Record<string, unknown>).yol === "PANEL" && pr[0]!.actorId === yonetici.id
          && !!(await auditVar(cihaz.id, "DEVICE_REBIND_APPROVED")));
      const s4 = await durum(A4);
      const yeniSir = String(data(s4).deviceSecret ?? "");
      const tuz = (await prisma.device.findUnique({ where: { id: cihaz.id }, select: { proofSalt: true } }))?.proofSalt ?? null;
      const sunucuSir = tuz ? deriveDeviceSecret(halka.ring, A4, tuz) : null;
      const t = Date.now();
      const yol = { method: "POST", path: "/api/auth/login-quick-pin" };
      check("§5h yeni kurulum yeni sır alır; sunucunun sırrıyla doğrulanır",
        /^[0-9a-f]{64}$/.test(yeniSir) && sunucuSir === yeniSir
          && verifyDeviceProof(sunucuSir, buildDeviceProof(yeniSir, t, yol.method, yol.path), yol, t) === "OK");
      check("§5i eski sır reddedilir",
        !!sunucuSir && verifyDeviceProof(sunucuSir, buildDeviceProof(eskiSir, t, yol.method, yol.path), yol, t) === "IMZA");
      let tekrar = "";
      try { await DeviceRebindService.approve(t4.id, yonetici.id, "PANEL"); } catch (e) { tekrar = String((e as { details?: { code?: string } }).details?.code ?? e); }
      check("§5j sonuçlanmış talep ikinci kez onaylanamaz (409)", tekrar === "REBIND_ALREADY_DECIDED", tekrar);

      // ─── §6 yerinde onay (tablet, yönetici parolası; JWT YOK) ───
      console.log("\n=== §6 yerinde onay ===");
      await kilitTemizle();
      resetOnsiteRebindRateForTests();
      const ONAY = "/api/devices/rebind-requests/onsite-approve";
      const t0 = new Date(Date.now() - 1000);
      const yanlis = await istek(port, "POST", ONAY, { localId: A5, username: yonetici.username, password: `${adminParola}-yanlis` });
      await flushLoginLockoutPersistence();
      const kova = await prisma.loginLockoutBucket.count({ where: { lastFailAt: { gte: t0 } } });
      check("§6a yanlış parola → 401", yanlis.status === 401, `HTTP ${yanlis.status} ${kod(yanlis)}`);
      check("§6b yanlış parola giriş kilit sayacını artırır (aynı kova)", kova >= 1, `${kova} kova`);
      const izinsiz = await istek(port, "POST", ONAY, { localId: A5, username: yetkisiz.username, password: adminParola });
      check("§6c admin:settings'siz doğru kimlik → 403", izinsiz.status === 403 && kod(izinsiz) === "REBIND_APPROVER_FORBIDDEN",
        `HTTP ${izinsiz.status} ${kod(izinsiz)}`);
      const dogru = await istek(port, "POST", ONAY, { localId: A5, username: yonetici.username, password: adminParola });
      check("§6d doğru kimlik → 200 APPROVED", dogru.status === 200 && data(dogru).status === "APPROVED", `HTTP ${dogru.status} ${kod(dogru)}`);
      check("§6e yanıt JWT/oturum TAŞIMAZ", !/token/i.test(dogru.raw), dogru.raw.slice(0, 160));
      const r6 = await prisma.device.findUnique({ where: { id: cihaz.id }, select: { deviceId: true } });
      const yr = await olaylar({ deviceRefId: cihaz.id, event: "REBOUND", localId: A5 });
      check("§6f aynı satıra bağlandı, defter REBOUND (yol=YERINDE, actor)",
        r6?.deviceId === A5 && yr.length === 1 && (yr[0]!.meta as Record<string, unknown>).yol === "YERINDE" && yr[0]!.actorId === yonetici.id);
      const iz = await prisma.systemLog.findFirst({
        where: { recordId: cihaz.id, newData: { path: ["event"], equals: "DEVICE_REBIND_APPROVED_ONSITE" } },
        orderBy: { createdAt: "desc" },
      });
      check("§6g audit DEVICE_REBIND_APPROVED_ONSITE (actor), parola izde YOK",
        !!iz && iz.userId === yonetici.id && !JSON.stringify(iz).includes(adminParola));
    } finally {
      delete process.env[INSTALL_CLASS_ENV];
      await kilitTemizle();
    }

    // ─── §7 tavan aktif sayım ───
    console.log("\n=== §7 tavan: aktif ∧ birleşmemiş sayım ===");
    const k0 = await countSeatDevices(prisma);
    const pasif = await prisma.device.create({ data: { deviceId: randomUUID(), name: "Bekçi pasif", isActive: false } , select: { id: true } });
    yaratilan.push(pasif.id);
    const k1 = await countSeatDevices(prisma);
    check("§7a pasif satır tavanı yemez", k1 === k0, `${k0} → ${k1}`);
    const dsrc = readFileSync(join(__dirname, "..", "src/services/device.service.ts"), "utf8");
    check("§7b doğuş ve reactivate tavanı aktif sayımdan okur",
      /assertDeviceRowCapacity\(prisma\)[\s\S]{0,400}countSeatDevices\(prisma, \{ status: "PENDING" \}\)/.test(dsrc)
        && /static async reactivate[\s\S]{0,400}assertDeviceRowCapacity\(prisma\)/.test(dsrc));

    // ─── §8 eşzamanlı iki announce, bilinmeyen hw → tek canlı satır ───
    console.log("\n=== §8 eşzamanlılık ===");
    const H2 = ozet();
    const [x1, x2] = await Promise.all([announce(randomUUID(), { hw: hw(H2) }), announce(randomUUID(), { hw: hw(H2) })]);
    const canli = await prisma.device.findMany({ where: { hwDigest: H2 }, select: { id: true } });
    yaratilan.push(...canli.map((r) => r.id));
    check("§8a aynı hw ile eşzamanlı iki yeni kurulum → tek satır", canli.length === 1, `HTTP ${x1.status}/${x2.status} · ${canli.length} satır`);
    const H3 = ozet();
    const ilk = await prisma.device.create({ data: { deviceId: randomUUID(), name: "Bekçi hw-1", hwDigest: H3 }, select: { id: true } });
    yaratilan.push(ilk.id);
    let ikinci = "kabul edildi";
    try {
      const r = await prisma.device.create({ data: { deviceId: randomUUID(), name: "Bekçi hw-2", hwDigest: H3 }, select: { id: true } });
      yaratilan.push(r.id);
    } catch (e) {
      ikinci = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : String(e);
    }
    check("§8b DB seddi: aynı özetle ikinci canlı satır P2002", ikinci === "P2002", ikinci);

    // ─── §10 kalıcı silme: PURGED kalır, deviceRefId SetNull; defter mühürlü ───
    console.log("\n=== §10 kalıcı silme + defter mührü ===");
    const P = randomUUID();
    await announce(P, { hw: hw(ozet()) });
    const pRow = await prisma.device.findUnique({ where: { deviceId: P }, select: { id: true } });
    if (pRow) await DeviceService.hardDelete(pRow.id, yonetici.id);
    const pEv = await olaylar({ localId: P });
    check("§10a kalıcı silmede REGISTERED + PURGED kalır, deviceRefId NULL",
      pEv.map((e) => e.event).join(",") === "REGISTERED,PURGED" && pEv.every((e) => e.deviceRefId === null),
      pEv.map((e) => `${e.event}:${e.deviceRefId ?? "null"}`).join(","));
    let silRed = "";
    try { await prisma.$executeRaw`DELETE FROM "device_binding_events" WHERE "localId" = ${P}`; } catch (e) { silRed = String(e); }
    let degRed = "";
    try { await prisma.$executeRaw`UPDATE "device_binding_events" SET "reason" = 'x' WHERE "localId" = ${P}`; } catch (e) { degRed = String(e); }
    check("§10b defter append-only: doğrudan DELETE ve UPDATE reddedilir", /append-only/.test(silRed) && /append-only/.test(degRed));

    // ─── §11 revoke edilmiş cihaz: bayrak kapalı da olsa talep ───
    console.log("\n=== §11 revoke edilmiş hedef ===");
    await DeviceService.revoke(cihaz.id, yonetici.id);
    const A6 = randomUUID();
    const a6 = await announce(A6, { hw: hw(H) });
    check("§11a revoke edilmiş (PENDING) hedef → talep, otomatik bağlama yok",
      data(a6).status === "REBIND_PENDING" && (await prisma.device.findUnique({ where: { id: cihaz.id }, select: { deviceId: true } }))?.deviceId === A5);
  } finally {
    for (const [k, v] of once) {
      if (v === undefined) await prisma.systemSetting.deleteMany({ where: { key: k, updatedById: yonetici.id } });
      else await prisma.systemSetting.update({ where: { key: k }, data: { value: v as never } });
    }
    invalidateFeatureFlagsCache();
    await kilitTemizle();
    if (periferikId) {
      await prisma.devicePeripheral.deleteMany({ where: { peripheralId: periferikId } });
      await prisma.peripheralDevice.deleteMany({ where: { id: periferikId } });
    }
    await prisma.device.updateMany({ where: { id: { in: yaratilan.length ? yaratilan : ["00000000-0000-0000-0000-000000000000"] } }, data: { isActive: false, machineId: null } });
    await prisma.user.updateMany({ where: { id: { in: [yonetici.id, yetkisiz.id] } }, data: { isActive: false } });
    await new Promise<void>((r) => server.close(() => r()));
  }

  sAst();
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = kaldi === 0 ? 0 : 1;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
