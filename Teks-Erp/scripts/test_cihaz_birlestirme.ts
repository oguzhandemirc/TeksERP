/**
 * Bekçi: cihaz kopyası birleştirme (izlenebilirlik D4) — durum geçişi, defter taşınmaz, geri alınabilir.
 * Kök neden: aynı tablet yeniden kurulunca yeni `devices` satırıyla doğuyordu (Tambur tableti 5–6 satır).
 * Birleştirme insan onayıyla: kopya pasif + ana kayda bağlı, `MERGED` olayı; iş oturumları YERİNDE kalır.
 * Gerçek HTTP: app aynı süreçte 127.0.0.1:<boş port> (ikinci süreç yok). Yalnız `_test` DB.
 * Koşum: `cd Teks-Erp && npx tsx scripts/run-all-tests.ts cihaz_birlestirme`
 *
 * NEGATİF SONDALAR (2026-10-25, izole ağaç, her biri md5 ile geri yüklendi; temiz koşum 44/0):
 *   P1 birleştirme iş oturumlarını hedefe taşır          → 3 ❌ (§10a, §4b, §4g)
 *   P2 zincir kontrolü (kopyası olan kaynak) kaldırılır   → 2 ❌ (§6b 409 INTEGRITY_RULE — trigger ham yakalar, §7a)
 *   P3 advisory kilit kaldırılır                          → 1 ❌ (§7a: 6/6 turda kaybeden ham DB hatası)
 *   P4 FK politikasından `RollInspection.device` silinir  → 1 ❌ (§9a)
 *   P5 servise `tx.device.delete` girer                   → 1 ❌ (§10b)
 *   P6 betik bir satırın `updatedAt`ını yazar             → 2 ❌ (§10c, §11b)
 */
import prisma from "../src/lib/prisma"; // İLK import: dotenv → DATABASE_URL
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Prisma } from "@prisma/client";
import { AuthService } from "../src/services/auth.service";
import { DeviceMergeService, DEVICE_MERGE_FK_POLICY } from "../src/services/device-merge.service";
import { readMergeLink } from "../src/services/helpers/device-identity.helper";
import { fixtureHedefEngeli } from "./lib/hedef-db-kapisi";

let gecti = 0;
let kaldi = 0;
function check(etiket: string, ok: boolean, ayrinti = ""): void {
  if (ok) gecti++;
  else kaldi++;
  console.log(`${ok ? "✅" : "❌"} ${etiket}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

type Cevap = { status: number; body: Record<string, unknown> };
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
          resolve({ status: res.statusCode ?? 0, body: j });
        });
      },
    );
    r.on("error", reject);
    if (veri) r.write(veri);
    r.end();
  });
}
const kod = (c: Cevap): string => String((c.body.details as { code?: string } | undefined)?.code ?? "");
const data = <T = Record<string, unknown>>(c: Cevap): T => (c.body.data as T | undefined) ?? ({} as T);
const hataKodu = (e: unknown): string =>
  String((e as { details?: { code?: string } } | null)?.details?.code ?? (e as { statusCode?: number } | null)?.statusCode ?? "ham");

const KOK = join(__dirname, "..");
const SERVIS = "src/services/device-merge.service.ts";
const BETIK = "scripts/cihaz-birlestir.ts";
const DAKIKA = 60_000;

// ─── §9 FK kapsaması: şema metnindeki `Device` FK'ları ↔ DEVICE_MERGE_FK_POLICY (iki yönlü) ───
export function deviceFkAnahtarlari(sema: string): string[] {
  const out: string[] = [];
  let model = "";
  for (const satir of sema.split("\n")) {
    const m = /^model (\w+) \{/.exec(satir);
    if (m) { model = m[1]!; continue; }
    const f = /^\s+(\w+)\s+Device\??\s+@relation\((.*)\)/.exec(satir);
    if (f && /fields:\s*\[/.test(f[2]!)) out.push(`${model}.${f[1]}`);
  }
  return out.sort();
}
function sFk(): void {
  console.log("\n=== §9 FK kapsaması (şema ↔ politika) ===");
  const sema = readFileSync(join(KOK, "prisma/schema.prisma"), "utf8");
  const semada = deviceFkAnahtarlari(sema);
  const politika = Object.keys(DEVICE_MERGE_FK_POLICY).sort();
  const eksik = semada.filter((k) => !politika.includes(k));
  const olu = politika.filter((k) => !semada.includes(k));
  check("§9a şemadaki her `Device` FK'sı politikada sınıflı (yeni FK sessizce atlanamaz)", eksik.length === 0, eksik.join(", "));
  check("§9b politikada ölü girdi yok", olu.length === 0, olu.join(", "));
  check("§9c körlük zemini: ayrıştırıcı ≥9 FK buluyor", semada.length >= 9, `${semada.length} FK`);
  const sonda = deviceFkAnahtarlari("model Yeni {\n  cihaz Device? @relation(fields: [cihazId], references: [id])\n}\n");
  check("§9d sonda: yeni FK ayrıştırıcıya görünür", sonda.length === 1 && sonda[0] === "Yeni.cihaz");
}

// ─── §10 statik: ayak izi tablosu taşınmaz, hard delete yok, betik yazmaz ───
const AYAK_IZI = ["workSession", "session", "systemLog", "workOrderEvent", "rollInspection", "printJob", "requestTrace", "deviceBindingEvent"];
export function ayakIziYazimlari(kaynak: string): string[] {
  const re = new RegExp(`\\.(${AYAK_IZI.join("|")})\\.(update|updateMany|upsert|delete|deleteMany|create|createMany)\\(`, "g");
  return [...kaynak.matchAll(re)].map((x) => `${x[1]}.${x[2]}`);
}
export function yasakSilmeler(kaynak: string): string[] {
  const out = [...kaynak.matchAll(/\.(\w+)\.(delete|deleteMany)\(/g)].filter((x) => x[1] !== "devicePeripheral").map((x) => `${x[1]}.${x[2]}`);
  if (/DELETE\s+FROM/i.test(kaynak)) out.push("ham DELETE");
  return out;
}
export function betikYazimlari(kaynak: string): string[] {
  return [...kaynak.matchAll(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw\w*)\(/g)].map((x) => x[1]!);
}
function sStatik(): void {
  console.log("\n=== §10 statik tarama ===");
  const servis = readFileSync(join(KOK, SERVIS), "utf8");
  const betik = readFileSync(join(KOK, BETIK), "utf8");
  check("§10a servis ayak izi tablolarına YAZMAZ (oturum/audit/print/trace taşınmaz; olay yalnız helper boğazından)",
    ayakIziYazimlari(servis).length === 0, ayakIziYazimlari(servis).join(", "));
  check("§10b servis hard delete içermez (yalnız saf yapılandırma pivotu `devicePeripheral` çift satırı)",
    yasakSilmeler(servis).length === 0, yasakSilmeler(servis).join(", "));
  check("§10c betik veritabanına yazan çağrı içermez (yalnız rapor)", betikYazimlari(betik).length === 0, betikYazimlari(betik).join(", "));
  check("§10d betik `--apply`ı açıkça reddeder", /includes\("--apply"\)[\s\S]{0,200}process\.exit\(2\)/.test(betik));
  check("§10e sonda: tarayıcılar yakalar",
    ayakIziYazimlari("tx.workSession.updateMany({})").length === 1
      && yasakSilmeler("tx.device.delete({})").length === 1 && yasakSilmeler("tx.devicePeripheral.delete({})").length === 0
      && betikYazimlari("prisma.device.update({})").length === 1);
}

async function main(): Promise<void> {
  const engel = fixtureHedefEngeli();
  if (engel) {
    console.error(`HEDEF RED: ${engel}`);
    process.exit(2);
  }
  sFk();
  sStatik();

  const { default: app } = await import("../src/app");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const stamp = randomBytes(4).toString("hex");
  const perm = await prisma.permission.findFirst({ where: { code: "admin:settings" }, select: { id: true } });
  if (!perm) throw new Error("admin:settings izin kaydı yok (seed eksik?)");
  // Kendi fikstürü (iş anahtarı `code`): ortamdaki "herhangi bir istasyon"a yaslanmaz.
  const istasyon = await prisma.station.create({
    data: { code: `CBR-${stamp}`.toUpperCase(), name: "Birleştirme bekçisi istasyonu", type: "INTERNAL" },
    select: { id: true },
  });
  const parola = `Cb-${randomBytes(9).toString("hex")}`; // değer basılmaz
  const yonetici = await prisma.user.create({
    data: {
      username: `cbr-yon-${stamp}`, fullName: "Birleştirme bekçisi yönetici",
      passwordHash: await AuthService.hashPassword(parola), isActive: true,
      permissions: { create: [{ permissionId: perm.id }] },
    },
    select: { id: true, username: true },
  });
  const operator = await prisma.user.create({
    data: { username: `cbr-op-${stamp}`, fullName: "Birleştirme bekçisi operatör", passwordHash: await AuthService.hashPassword(parola), isActive: true },
    select: { id: true },
  });
  const giris = await istek(port, "POST", "/api/auth/login", { username: yonetici.username, password: parola, clientType: "electron" });
  const token = String(data<{ token?: string }>(giris).token ?? "");
  const yetki = { authorization: `Bearer ${token}` };
  const birlestir = (targetId: string, sourceIds: string[]) => istek(port, "POST", "/api/admin/devices/merge", { targetId, sourceIds }, yetki);

  // Sentetik zaman: uzak geçmişte rastgele bir gün — önceki koşumların satırlarıyla ardıllık kurulmaz.
  const taban = Date.UTC(2015, 0, 1) + Math.floor(Math.random() * 3000) * 24 * 60 * DAKIKA;
  const yaratilan: string[] = [];
  const cihaz = async (ad: string | null, kind: "TABLET" | "PHONE", dogum: number, sonGorulme: number, aktif = true) => {
    const localId = randomUUID();
    const row = await prisma.device.create({
      data: {
        deviceId: localId, name: ad ?? `${kind === "PHONE" ? "Telefon" : "Tablet"} ${localId.slice(0, 8)}`, kind,
        status: "APPROVED", isActive: aktif, createdAt: new Date(dogum), lastSeenAt: new Date(sonGorulme),
      },
      select: { id: true, deviceId: true, name: true },
    });
    yaratilan.push(row.id);
    return row;
  };
  const oturum = (deviceId: string, bas: number, acik = false) =>
    prisma.workSession.create({
      data: {
        deviceId, userId: operator.id, stationId: istasyon.id,
        startedAt: new Date(bas), lastActivityAt: new Date(bas), endedAt: acik ? null : new Date(bas + 5 * DAKIKA),
        endReason: acik ? null : "LOGOUT",
      },
      select: { id: true },
    });
  let periferikIdler: string[] = [];

  try {
    check("§0 yönetici girişi", giris.status === 200 && token.length > 20, `HTTP ${giris.status}`);

    // ─── Sentetik Tambur zinciri: 6 kurulum, her biri öncekinin son görülmesinden 1 dk sonra doğar ───
    const zincir: Array<{ id: string; deviceId: string; name: string }> = [];
    for (let i = 0; i < 6; i++) {
      const dogum = taban + i * 30 * DAKIKA;
      zincir.push(await cihaz(null, "TABLET", dogum, dogum + 29 * DAKIKA));
      await oturum(zincir[i]!.id, dogum + 2 * DAKIKA);
      await oturum(zincir[i]!.id, dogum + 12 * DAKIKA);
    }
    const ana = zincir[5]!;
    const kopyalar = zincir.slice(0, 5);
    // Donanım: bir pivot bağı (kopya 2) + bir eski tekil sahiplik (kopya 3).
    const p1 = await prisma.peripheralDevice.create({
      data: { code: `CBR-P1-${stamp}`, name: "Bekçi yazıcısı", kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP" },
      select: { id: true },
    });
    const p2 = await prisma.peripheralDevice.create({
      data: { code: `CBR-P2-${stamp}`, name: "Bekçi terazisi", kind: "SCALE", connectionType: "NETWORK_TCP", deviceId: kopyalar[2]!.id },
      select: { id: true },
    });
    periferikIdler = [p1.id, p2.id];
    await prisma.devicePeripheral.create({ data: { deviceId: kopyalar[1]!.id, peripheralId: p1.id } });

    // Ad farkı: "emulator" ↔ "samsun a9" (C-R1 yanlış pozitif) — aynı istasyon, 10 dk ardıllık.
    const telTaban = taban + 10 * 60 * DAKIKA;
    const emu = await cihaz("emulator", "PHONE", telTaban, telTaban + 20 * DAKIKA);
    const a9 = await cihaz("samsun a9", "PHONE", telTaban + 30 * DAKIKA, telTaban + 60 * DAKIKA);
    await oturum(emu.id, telTaban + 5 * DAKIKA);
    await oturum(a9.id, telTaban + 35 * DAKIKA);

    // ─── §1 sezgi ───
    console.log("\n=== §1 sezgi (aday grupları) ===");
    const aday = await istek(port, "GET", "/api/admin/devices/merge/candidates", undefined, yetki);
    type G = { confidence: string; target: { id: string }; sources: Array<{ id: string; confidence: string; warnings: string[] }> };
    const gruplar = data<{ groups?: G[] }>(aday).groups ?? [];
    const zg = gruplar.find((g) => g.target.id === ana.id);
    check("§1a zincir TEK grupta, önerilen ana kayıt en son görülen aktif satır", !!zg && zg.sources.length === 5
      && kopyalar.every((k) => zg.sources.some((s) => s.id === k.id)), zg ? `${zg.sources.length} kaynak` : `grup yok (HTTP ${aday.status})`);
    check("§1b zincir güveni YÜKSEK", zg?.confidence === "HIGH" && zg.sources.every((s) => s.confidence === "HIGH"));
    const tg = gruplar.find((g) => [g.target.id, ...g.sources.map((s) => s.id)].includes(emu.id));
    check("§1c ad farkı (emulator ↔ samsun a9) DÜŞÜK güven + 'ayrı cihaz olabilir'",
      !!tg && tg.confidence === "LOW" && tg.sources.some((s) => s.warnings.some((w) => w.includes("ayrı cihaz olabilir"))));

    // ─── §11 betik: yalnız rapor, DB'ye yazmaz ───
    console.log("\n=== §11 betik (dry-run) ===");
    const ayakIzi = async () => JSON.stringify([
      await prisma.device.count(), await prisma.deviceBindingEvent.count(), await prisma.devicePeripheral.count(),
      await prisma.workSession.count(), await prisma.systemLog.count(),
      (await prisma.device.aggregate({ _max: { updatedAt: true } }))._max.updatedAt?.toISOString(),
    ]);
    const betikOnce = await ayakIzi();
    const kos = spawnSync("npx", ["tsx", BETIK, "--json"], { cwd: KOK, encoding: "utf8", env: process.env, timeout: 120_000 });
    const betikSonra = await ayakIzi();
    let betikGrup: G | undefined;
    try {
      const j = JSON.parse(kos.stdout.slice(kos.stdout.search(/^\{/m))) as { groups: G[] }; // dotenv bayrağı da "{" taşır
      betikGrup = j.groups.find((g) => g.target.id === ana.id);
    } catch { /* aşağıda kırmızı */ }
    check("§11a betik çıkışı 0 ve zinciri YÜKSEK güvenle raporlar (uçla aynı sezgi)",
      kos.status === 0 && betikGrup?.confidence === "HIGH" && betikGrup.sources.length === 5, `çıkış ${kos.status}`);
    check("§11b betik koşumu DB'ye YAZMAZ (satır/olay/pivot/oturum/audit sayısı + son updatedAt aynı)", betikOnce === betikSonra);
    const apply = spawnSync("npx", ["tsx", BETIK, "--apply"], { cwd: KOK, encoding: "utf8", env: process.env, timeout: 120_000 });
    check("§11c `--apply` reddedilir (çıkış 2)", apply.status === 2, `çıkış ${apply.status}`);

    // ─── §2 önizleme: her kaydı listeler, yan etkisiz ───
    console.log("\n=== §2 önizleme ===");
    const onOnce = await ayakIzi();
    const on = await istek(port, "POST", "/api/admin/devices/merge/preview", { targetId: ana.id, sourceIds: kopyalar.map((k) => k.id) }, yetki);
    const onSonra = await ayakIzi();
    type K = { id: string; blockers: Array<{ code: string }>; workSessions: { count: number; recent: unknown[]; staysInPlace: boolean };
      hardwareLinks: Array<{ id: string }>; legacyPeripherals: Array<{ id: string }> };
    const onv = data<{ sources?: K[]; undoNote?: string }>(on);
    const ks = onv.sources ?? [];
    check("§2a önizleme 200 ve kaynak başına bir satır", on.status === 200 && ks.length === 5, `HTTP ${on.status}`);
    check("§2b her kaynakta iş oturumu sayısı + son oturumlar (YERİNDE KALIR)",
      ks.every((k) => k.workSessions.count === 2 && k.workSessions.recent.length === 2 && k.workSessions.staysInPlace));
    check("§2c taşınacak pivot bağı ve eski tekil donanım listelenir",
      ks.find((k) => k.id === kopyalar[1]!.id)?.hardwareLinks.length === 1 && ks.find((k) => k.id === kopyalar[2]!.id)?.legacyPeripherals.length === 1);
    check("§2d engel yok + geri alma notu", ks.every((k) => k.blockers.length === 0) && /geri taşınmaz/.test(onv.undoNote ?? ""));
    check("§2e önizleme YAN ETKİSİZ", onOnce === onSonra);

    // ─── §3 açık oturum engeller (atomik: hiçbir kaynak birleşmez) ───
    console.log("\n=== §3 açık oturum ===");
    const acik = await oturum(kopyalar[4]!.id, taban + 200 * DAKIKA, true);
    const onAcik = await istek(port, "POST", "/api/admin/devices/merge/preview", { targetId: ana.id, sourceIds: [kopyalar[4]!.id] }, yetki);
    check("§3a önizleme açık oturumu ENGEL olarak gösterir",
      data<{ sources?: K[] }>(onAcik).sources?.[0]?.blockers.some((b) => b.code === "DEVICE_MERGE_OPEN_SESSION") === true);
    const r409 = await birlestir(ana.id, kopyalar.map((k) => k.id));
    check("§3b birleştirme 409 DEVICE_MERGE_OPEN_SESSION", r409.status === 409 && kod(r409) === "DEVICE_MERGE_OPEN_SESSION", `HTTP ${r409.status} ${kod(r409)}`);
    check("§3c hepsi-ya-hiç: önceki kaynaklar da birleşmedi", (await readMergeLink(prisma, kopyalar[0]!.id)) === null);
    await prisma.workSession.update({ where: { id: acik.id }, data: { endedAt: new Date(taban + 205 * DAKIKA), endReason: "LOGOUT" } });

    // ─── §4 birleştir: tek kayda iner, defter yerinde ───
    console.log("\n=== §4 birleştirme (defter testi) ===");
    const tumIdler = zincir.map((z) => z.id);
    const oturumFoto = async () => JSON.stringify(await prisma.workSession.findMany({
      where: { deviceId: { in: tumIdler } }, orderBy: { id: "asc" }, select: { id: true, deviceId: true, startedAt: true, endedAt: true },
    }));
    const fotoOnce = await oturumFoto();
    const ok = await birlestir(ana.id, kopyalar.map((k) => k.id));
    check("§4a birleştirme 200", ok.status === 200, `HTTP ${ok.status} ${kod(ok)}`);
    check("§4b iş oturumu satırları ÖNCE = SONRA (cihaz bağı taşınmadı)", fotoOnce === (await oturumFoto()));
    const linkler = await Promise.all(kopyalar.map((k) => readMergeLink(prisma, k.id)));
    check("§4c her kopya ana kayda bağlı", linkler.every((l) => l?.targetId === ana.id));
    const pasif = await prisma.device.count({ where: { id: { in: kopyalar.map((k) => k.id) }, isActive: false } });
    check("§4d kopyalar pasif", pasif === 5);
    check("§4e donanım taşındı (pivot + eski tekil sahiplik)",
      (await prisma.devicePeripheral.count({ where: { deviceId: ana.id, peripheralId: p1.id } })) === 1
        && (await prisma.peripheralDevice.findUnique({ where: { id: p2.id }, select: { deviceId: true } }))?.deviceId === ana.id);
    const merged = await prisma.deviceBindingEvent.count({ where: { deviceRefId: { in: kopyalar.map((k) => k.id) }, event: "MERGED" } });
    check("§4f kaynak başına bir MERGED olayı", merged === 5, `${merged}`);
    const det = await istek(port, "GET", `/api/admin/devices/${ana.id}`, undefined, yetki);
    const gecmis = data<{ pastInstallations?: Array<{ id: string; workSessionCount: number }> }>(det).pastInstallations ?? [];
    check("§4g detay 'geçmiş kurulumlar' 5 kopya + oturum sayıları", gecmis.length === 5
      && gecmis.reduce((t, g) => t + g.workSessionCount, 0) === 11, `${gecmis.length} kopya`);
    const kopyaDet = await istek(port, "GET", `/api/admin/devices/${kopyalar[0]!.id}`, undefined, yetki);
    check("§4h kopya detayı ana kayda işaret eder", data<{ mergedInto?: { id: string } }>(kopyaDet).mergedInto?.id === ana.id);
    const audit = await prisma.systemLog.findFirst({ where: { recordId: kopyalar[0]!.id, newData: { path: ["event"], equals: "MERGED" } } });
    check("§4i audit (tx dışı) MERGED olayıyla yazıldı", audit !== null);

    // ─── §5 tekrar ikilemez ───
    console.log("\n=== §5 tekrar ===");
    const tekrar = await birlestir(ana.id, kopyalar.map((k) => k.id));
    const merged2 = await prisma.deviceBindingEvent.count({ where: { deviceRefId: { in: kopyalar.map((k) => k.id) }, event: "MERGED" } });
    check("§5a aynı istek tekrarı 409 + olay sayısı sabit", tekrar.status === 409 && merged2 === 5, `HTTP ${tekrar.status} ${kod(tekrar)} · ${merged2}`);

    // ─── §6 zincir yasağı ───
    console.log("\n=== §6 zincir yasağı ===");
    const disari = await cihaz(null, "TABLET", taban + 20 * 60 * DAKIKA, taban + 20 * 60 * DAKIKA + DAKIKA);
    const hedefKopya = await birlestir(kopyalar[0]!.id, [disari.id]);
    check("§6a birleşmiş kayda HEDEF olarak birleştirme 409 DEVICE_MERGE_TARGET_INVALID",
      hedefKopya.status === 409 && kod(hedefKopya) === "DEVICE_MERGE_TARGET_INVALID", `HTTP ${hedefKopya.status} ${kod(hedefKopya)}`);
    const kaynakAna = await birlestir(disari.id, [ana.id]);
    check("§6b kopyaları olan ana kaydı KAYNAK yapmak 409 DEVICE_MERGE_CHAIN",
      kaynakAna.status === 409 && kod(kaynakAna) === "DEVICE_MERGE_CHAIN", `HTTP ${kaynakAna.status} ${kod(kaynakAna)}`);

    // ─── §7 eşzamanlılık: çapraz birleştirme yarışı, tek kazanan + kaybeden 409 (ham hata yok) ───
    console.log("\n=== §7 eşzamanlılık ===");
    const yaris: string[] = [];
    let ihlal = 0;
    for (let tur = 0; tur < 6; tur++) {
      const t0 = taban + (30 + tur * 10) * 60 * DAKIKA;
      const a = await cihaz(null, "TABLET", t0, t0 + DAKIKA);
      const b = await cihaz(null, "TABLET", t0 + 2 * DAKIKA, t0 + 3 * DAKIKA);
      const c = await cihaz(null, "TABLET", t0 + 4 * DAKIKA, t0 + 5 * DAKIKA);
      // A: c → a  ·  B: a → b. İkisi birden geçerse zincir doğar (a hem hedef hem kopya).
      const sonuc = await Promise.allSettled([
        DeviceMergeService.merge(a.id, [c.id], yonetici.id),
        DeviceMergeService.merge(b.id, [a.id], yonetici.id),
      ]);
      const kazanan = sonuc.filter((s) => s.status === "fulfilled").length;
      const kodlar = sonuc.filter((s): s is PromiseRejectedResult => s.status === "rejected").map((s) => hataKodu(s.reason));
      yaris.push(`${kazanan}:${kodlar.join("/")}`);
      if (kazanan !== 1 || !kodlar.every((k) => k.startsWith("DEVICE_MERGE_"))) ihlal++;
    }
    check("§7a her turda TEK kazanan, kaybeden 409 DEVICE_MERGE_* (ham DB hatası değil)", ihlal === 0, yaris.join(" "));

    // ─── §8 geri alma: karşı olay, ileri kayıt durur ───
    console.log("\n=== §8 geri alma ===");
    const geri = await istek(port, "POST", `/api/admin/devices/merge/${kopyalar[2]!.id}/undo`, {}, yetki);
    check("§8a geri alma 200", geri.status === 200, `HTTP ${geri.status} ${kod(geri)}`);
    const k3 = await prisma.device.findUnique({ where: { id: kopyalar[2]!.id }, select: { isActive: true } });
    check("§8b kaynak bağsız ve PASİF döner", (await readMergeLink(prisma, kopyalar[2]!.id)) === null && k3?.isActive === false);
    const olaylar = await prisma.deviceBindingEvent.findMany({
      where: { deviceRefId: kopyalar[2]!.id, event: { in: ["MERGED", "UNMERGED"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { event: true },
    });
    check("§8c ileri MERGED DURUR + UNMERGED karşı olayı eklendi", olaylar.map((o) => o.event).join(",") === "MERGED,UNMERGED");
    check("§8d taşınan donanım geri taşınmaz", (await prisma.peripheralDevice.findUnique({ where: { id: p2.id }, select: { deviceId: true } }))?.deviceId === ana.id);
    const geri2 = await istek(port, "POST", `/api/admin/devices/merge/${kopyalar[2]!.id}/undo`, {}, yetki);
    check("§8e ikinci geri alma 409 DEVICE_MERGE_NOT_MERGED", geri2.status === 409 && kod(geri2) === "DEVICE_MERGE_NOT_MERGED", `HTTP ${geri2.status} ${kod(geri2)}`);
    const reakt = await istek(port, "POST", `/api/admin/devices/${kopyalar[0]!.id}/reactivate`, {}, yetki);
    check("§8f birleşmiş kopya etkinleştirilemez (409 DEVICE_MERGED_COPY)", reakt.status === 409 && kod(reakt) === "DEVICE_MERGED_COPY", `HTTP ${reakt.status} ${kod(reakt)}`);

    // ─── §12 izin ───
    const izinsiz = await istek(port, "GET", "/api/admin/devices/merge/candidates", undefined, {});
    check("§12a kimliksiz istek 401", izinsiz.status === 401, `HTTP ${izinsiz.status}`);
  } finally {
    if (periferikIdler.length) {
      await prisma.devicePeripheral.deleteMany({ where: { peripheralId: { in: periferikIdler } } });
      await prisma.peripheralDevice.deleteMany({ where: { id: { in: periferikIdler } } });
    }
    // Birleşmiş satırlar silinmez (FK RESTRICT + defter); pasif bırakılır.
    await prisma.device.updateMany({ where: { id: { in: yaratilan.length ? yaratilan : [randomUUID()] } }, data: { isActive: false } });
    await prisma.user.updateMany({ where: { id: { in: [yonetici.id, operator.id] } }, data: { isActive: false } });
    await prisma.station.update({ where: { id: istasyon.id }, data: { isActive: false } });
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
  await prisma.$disconnect();
  process.exit(kaldi === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch(async (e: unknown) => {
    console.error(e instanceof Prisma.PrismaClientKnownRequestError ? `${e.code} ${e.message}` : e);
    await prisma.$disconnect();
    process.exit(1);
  });
}
