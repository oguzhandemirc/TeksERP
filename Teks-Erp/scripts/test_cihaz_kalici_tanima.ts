/**
 * Bekçi: onaylı cihazın KALICI TANINMASI (2026-11-13, kullanıcı kararı) — eşleştirme zorunluyken de
 * bilinen donanım (ANDROID_ID özeti) yeni kurulum anahtarıyla gelirse YÖNETİCİ ONAYI İSTEMEDEN aynı
 * satıra bağlanır (`device.autoReattachKnownHardware`, varsayılan AÇIK, barındırılanda zorlanmaz).
 * Revoke edilmiş / pasif hedef ASLA otomatik değil; barındırılanda 10 dk soğuma (klon sigortası).
 * Talep + yönetici onayı yolu (ayar kapalı) `test_cihaz_yeniden_baglama`da.
 * Servis düzeyi (sunucusuz). Yalnız `_test` DB.
 * Koşum: `cd Teks-Erp && npx tsx scripts/test_cihaz_kalici_tanima.ts`
 *
 * NEGATİF SONDALAR (2026-11-13, ölçüldü; her biri md5 ile geri yüklendi):
 *   (i)   `autoRebindRule`dan isActive/APPROVED koşulu düşer      → 2 kırmızı (§1d, §1e; uçtan uca §6 yeşil kalır:
 *         çağıran `eligible` ön koşulu + `rebindDeviceTx` atomik WHERE'i ikinci/üçüncü sed)
 *   (ii)  ayar yok sayılır (autoReattach daima true)             → 2 kırmızı (§1c, §5a)
 *   (iii) barındırılan soğuma kaldırılır                          → 1 kırmızı (§7b)
 *   (iv)  okuyucunun kayıt-yok varsayılanı false olur             → 11 kırmızı (§2a–§5a)
 * Gerekli mi: doğduğu gün ağaçta kusur yakalamadı (yeni davranışın sözleşmesi); kapı ileriye dönük.
 */
import prisma from "../src/lib/prisma"; // İLK import: dotenv → DATABASE_URL
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceService } from "../src/services/device.service";
import { autoRebindRule } from "../src/services/device-rebind.service";
import {
  SETTING_KEYS, SystemSettingService, invalidateFeatureFlagsCache, readDeviceAutoReattach,
} from "../src/services/system-setting.service";
import { newProofSalt } from "../src/lib/device-proof";
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
const ozet = (): string => randomBytes(32).toString("hex");
const hw = (o: string) => ({ v: 1 as const, kaynak: "ANDROID_ID" as const, ozet: o });
type Cevap = Record<string, unknown>;
const st = (c: unknown): string => String((c as Cevap).status ?? "");

function sSaf(): void {
  console.log("\n=== §1 karar yüklemi (saf) ===");
  const ok = { isActive: true, status: "APPROVED" };
  const r = (target: { isActive: boolean; status: string }, pairingRequired: boolean, autoReattach: boolean, hostedRecentAuto = false) =>
    autoRebindRule({ target, pairingRequired, autoReattach, hostedRecentAuto });
  check("§1a eşleştirme kapalı → ESLESTIRME_KAPALI (bugünkü)", r(ok, false, false) === "ESLESTIRME_KAPALI");
  check("§1b eşleştirme zorunlu + ayar açık → BILINEN_DONANIM", r(ok, true, true) === "BILINEN_DONANIM");
  check("§1c eşleştirme zorunlu + ayar kapalı → talep (null)", r(ok, true, false) === null);
  check("§1d revoke edilmiş (PENDING) hedef → asla otomatik", r({ isActive: true, status: "PENDING" }, false, true) === null
    && r({ isActive: true, status: "PENDING" }, true, true) === null);
  check("§1e pasif hedef → asla otomatik", r({ isActive: false, status: "APPROVED" }, true, true) === null
    && r({ isActive: false, status: "APPROVED" }, false, true) === null);
  check("§1f barındırılan soğuma penceresi → talep", r(ok, true, true, true) === null);
}

async function main(): Promise<void> {
  const engel = fixtureHedefEngeli();
  if (engel) {
    console.error(`HEDEF RED: ${engel}`);
    process.exitCode = 2;
    return;
  }
  setShortCredentialKeyDirForTests(mkdtempSync(join(tmpdir(), "cihaz-kalici-halka-")));
  delete process.env[INSTALL_CLASS_ENV];
  sSaf();
  const halka = getShortCredentialKeyRing();
  if (!halka.ok) throw new Error(`anahtar halkası yok: ${halka.detail}`);

  const AYARLAR = [
    SETTING_KEYS.DEVICE_PAIRING_REQUIRED, SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY,
    SETTING_KEYS.DEVICE_PROOF_REQUIRED, SETTING_KEYS.DEVICE_AUTO_REATTACH,
  ];
  const once = new Map<string, unknown>();
  for (const k of AYARLAR) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    once.set(k, row ? row.value : undefined);
  }
  const set = async (key: string, value: unknown): Promise<void> => {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
    invalidateFeatureFlagsCache();
  };
  const sil = async (key: string): Promise<void> => {
    await prisma.systemSetting.deleteMany({ where: { key } });
    invalidateFeatureFlagsCache();
  };
  const yaratilan: string[] = [];
  // setFeatureFlags kimlikli yazar ister; bekçi kullanıcısı sert silinmez, pasifleştirilir.
  const yazar = await prisma.user.create({
    data: { username: `TST-ckt-${Date.now()}`, fullName: "Kalıcı tanıma bekçisi", passwordHash: "x", isActive: true },
    select: { id: true },
  });
  const onayliCihaz = async (localId: string, H: string): Promise<{ id: string; name: string }> => {
    await DeviceService.announce({ deviceId: localId, hw: hw(H), kind: "TABLET" });
    const row = await prisma.device.findUniqueOrThrow({ where: { deviceId: localId }, select: { id: true, name: true } });
    yaratilan.push(row.id);
    // Yönetici onayı + teyitli sır (onaylı, kanıtı çalışan cihazın hâli).
    await prisma.device.update({
      where: { id: row.id },
      data: { status: "APPROVED", proofSalt: newProofSalt(halka.ring.active), proofIssuedAt: new Date(), proofConfirmedAt: new Date() },
    });
    return row;
  };
  const olaylar = (deviceRefId: string, event: "REBOUND" | "REBIND_REQUESTED") =>
    prisma.deviceBindingEvent.findMany({ where: { deviceRefId, event }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

  try {
    await set(SETTING_KEYS.DEVICE_PAIRING_REQUIRED, true);
    await set(SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY, false);
    await set(SETTING_KEYS.DEVICE_PROOF_REQUIRED, false);
    await sil(SETTING_KEYS.DEVICE_AUTO_REATTACH);

    // ─── §2 varsayılan ───
    console.log("\n=== §2 ayarın varsayılanı (kayıt yok) ===");
    check("§2a okuyucu kayıt yokken AÇIK", (await readDeviceAutoReattach()) === true);
    const ff = await new SystemSettingService().getFeatureFlags();
    check("§2b feature-flag yükünde deviceAutoReattach=true", (ff.data as unknown as Cevap | undefined)?.deviceAutoReattach === true);

    // ─── §3 eşleştirme zorunlu + bilinen donanım yeni kurulum → onaysız aynı satır ───
    console.log("\n=== §3 eşleştirme zorunlu, kaldır-kur → onaysız yeniden bağlama ===");
    const H = ozet();
    const A1 = randomUUID();
    const cihaz = await onayliCihaz(A1, H);
    const tuzOnce = (await prisma.device.findUniqueOrThrow({ where: { id: cihaz.id }, select: { proofSalt: true } })).proofSalt;
    const A2 = randomUUID();
    const c2 = await DeviceService.announce({ deviceId: A2, hw: hw(H), kind: "TABLET", model: "SM-T505" }) as unknown as Cevap;
    const r2 = await prisma.device.findUniqueOrThrow({ where: { id: cihaz.id } });
    check("§3a cevap APPROVED (onay ekranı yok)", st(c2) === "APPROVED" && c2.pairingRequired === true, st(c2));
    check("§3b aynı satır yeni anahtara geçti, yeni satır doğmadı",
      r2.deviceId === A2 && (await prisma.device.count({ where: { hwDigest: H } })) === 1 && (await prisma.device.count({ where: { deviceId: A2 } })) === 1);
    check("§3c talep AÇILMADI", (await prisma.deviceRebindRequest.count({ where: { localId: A2 } })) === 0);
    const reb = await olaylar(cihaz.id, "REBOUND");
    const m = (reb[0]?.meta ?? {}) as Cevap;
    check("§3d defter REBOUND (yol=OTOMATIK, kural=BILINEN_DONANIM, eski localId)",
      reb.length === 1 && m.yol === "OTOMATIK" && m.kural === "BILINEN_DONANIM" && m.eskiLocalId === A1, JSON.stringify(m));
    const audit = await prisma.systemLog.findFirst({ where: { recordId: cihaz.id, newData: { path: ["event"], equals: "DEVICE_REBOUND_AUTO" } } });
    const an = (audit?.newData ?? {}) as Cevap;
    check("§3e audit DEVICE_REBOUND_AUTO (gerekçe ayar adı; ham donanım değeri yok)",
      !!audit && an.reason === "device.autoReattachKnownHardware=true" && !JSON.stringify(an).includes(H));
    check("§3f eski sır öldü, yeni sır verildi",
      r2.proofSalt !== tuzOnce && r2.proofConfirmedAt === null && /^[0-9a-f]{64}$/.test(String(c2.deviceSecret ?? "")));
    const eski = await DeviceService.getStatus(A1) as unknown as Cevap;
    check("§3g eski localId artık tanınmaz", st(eski) === "UNKNOWN", st(eski));

    // ─── §4 panel listesi izi ───
    console.log("\n=== §4 panel listesi: yeniden bağlandı izi ===");
    const liste = await DeviceService.list();
    const satir = liste.find((d) => d.id === cihaz.id);
    check("§4a satır lastReboundAt + lastReboundPath=OTOMATIK taşır", !!satir?.lastReboundAt && satir.lastReboundPath === "OTOMATIK");
    check("§4b liste sır alanı taşımaz", !!satir && !("proofSalt" in satir));

    // ─── §5 ayar kapalı → bugünkü talep yolu ───
    console.log("\n=== §5 ayar kapalı → talep (yönetici onayı) ===");
    await set(SETTING_KEYS.DEVICE_AUTO_REATTACH, false);
    const A3 = randomUUID();
    const c3 = await DeviceService.announce({ deviceId: A3, hw: hw(H), kind: "TABLET" }) as unknown as Cevap;
    check("§5a REBIND_PENDING, satır değişmedi",
      st(c3) === "REBIND_PENDING" && (await prisma.device.findUniqueOrThrow({ where: { id: cihaz.id } })).deviceId === A2, st(c3));
    await set(SETTING_KEYS.DEVICE_AUTO_REATTACH, true);

    // ─── §6 revoke / pasif hedef asla otomatik ───
    console.log("\n=== §6 revoke edilmiş / pasif hedef ===");
    const H6 = ozet();
    const k6 = await onayliCihaz(randomUUID(), H6);
    await DeviceService.revoke(k6.id);
    const c6 = await DeviceService.announce({ deviceId: randomUUID(), hw: hw(H6), kind: "TABLET" }) as unknown as Cevap;
    check("§6a revoke edilmiş hedef → REBIND_PENDING", st(c6) === "REBIND_PENDING", st(c6));
    const H6b = ozet();
    const k6b = await onayliCihaz(randomUUID(), H6b);
    await DeviceService.deactivate(k6b.id);
    const c6b = await DeviceService.announce({ deviceId: randomUUID(), hw: hw(H6b), kind: "TABLET" }) as unknown as Cevap;
    check("§6b pasif hedef → REBIND_PENDING", st(c6b) === "REBIND_PENDING", st(c6b));
    check("§6c iki hedefte de REBOUND yok", (await olaylar(k6.id, "REBOUND")).length === 0 && (await olaylar(k6b.id, "REBOUND")).length === 0);

    // ─── §7 barındırılan: açık, zorlanmaz, soğuma ───
    console.log("\n=== §7 barındırılan sınıf ===");
    process.env[INSTALL_CLASS_ENV] = "BARINDIRILAN";
    try {
      const H7 = ozet();
      const k7 = await onayliCihaz(randomUUID(), H7);
      const B1 = randomUUID();
      const c7 = await DeviceService.announce({ deviceId: B1, hw: hw(H7), kind: "TABLET" }) as unknown as Cevap;
      check("§7a barındırılanda da onaysız yeniden bağlama", st(c7) === "APPROVED"
        && (await prisma.device.findUniqueOrThrow({ where: { id: k7.id } })).deviceId === B1, st(c7));
      const B2 = randomUUID();
      const c7b = await DeviceService.announce({ deviceId: B2, hw: hw(H7), kind: "TABLET" }) as unknown as Cevap;
      check("§7b 10 dk içinde ikinci otomatik bağlama → talep (klon sigortası)", st(c7b) === "REBIND_PENDING"
        && (await prisma.device.findUniqueOrThrow({ where: { id: k7.id } })).deviceId === B1, st(c7b));
      let hata = "";
      try { await new SystemSettingService().setFeatureFlags({ deviceAutoReattach: false } as never, yazar.id); }
      catch (e) { hata = String(e); }
      check("§7c barındırılanda ayar kapatılabilir (zorlanmaz)", hata === "" && (await readDeviceAutoReattach()) === false, hata);
    } finally {
      delete process.env[INSTALL_CLASS_ENV];
      await set(SETTING_KEYS.DEVICE_AUTO_REATTACH, true);
    }

    // ─── §8 hw'siz eski istemci: bugünkü davranış ───
    console.log("\n=== §8 hw göndermeyen eski istemci ===");
    const E = randomUUID();
    const c8 = await DeviceService.announce({ deviceId: E, kind: "TABLET" }) as unknown as Cevap;
    const e8 = await prisma.device.findUnique({ where: { deviceId: E }, select: { id: true, status: true, hwDigest: true } });
    if (e8) yaratilan.push(e8.id);
    check("§8a yeni localId → PENDING doğar (bugünkü)", st(c8) === "PENDING" && e8?.status === "PENDING" && e8.hwDigest === null, st(c8));
  } finally {
    for (const [k, v] of once) {
      if (v === undefined) await prisma.systemSetting.deleteMany({ where: { key: k } });
      else await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: v as never }, update: { value: v as never } });
    }
    invalidateFeatureFlagsCache();
    if (yaratilan.length) await prisma.device.updateMany({ where: { id: { in: yaratilan } }, data: { isActive: false, machineId: null } });
    await prisma.deviceRebindRequest.updateMany({ where: { targetDeviceId: { in: yaratilan.length ? yaratilan : [randomUUID()] }, status: "OPEN" }, data: { status: "REJECTED", decidedAt: new Date(), decidedById: yazar.id } });
    await prisma.user.updateMany({ where: { id: yazar.id }, data: { isActive: false } });
  }

  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = kaldi === 0 ? 0 : 1;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
