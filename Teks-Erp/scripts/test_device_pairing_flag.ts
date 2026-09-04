// =============================================================================
// Test: Cihaz onay kapısı BAYRAĞA bağlı (announce doğuş durumu + status cevabı)
// Çalıştır: npx tsx scripts/test_device_pairing_flag.ts
// =============================================================================
// SAHA BULGUSU (2026-09-04): `devicePairingRequired` KAPALI olmasına rağmen yeni
// tablet "Cihaz Atama Bekliyor" ekranında kalıyordu. İki kusur birlikte:
//   ① `announce` yeni cihazı KOŞULSUZ `PENDING` yaratıyordu (bayrağa hiç bakmıyor),
//   ② `getStatus` ham `status` döndürüyordu (karar istemciye kalıyordu).
// Sahadaki 28 cihazın hepsi APPROVED olduğu için görünmedi; yeni kurulumda ve
// arızalı tablet değişiminde ilk çıkacak şey.
//
// Doğrulananlar:
//   §1 bayrak KAPALI → yeni cihaz APPROVED doğar (+ audit izi DEVICE_AUTO_APPROVED)
//   §2 bayrak KAPALI → resolveDevice atıf döner (makine/donanım çözümü boşa düşmez)
//   §3 bayrak AÇIK  → yeni cihaz PENDING doğar (eski davranış korunur)
//   §4 status/announce cevabı `pairingRequired` TAŞIR (bilinmeyen cihazda da)
//   §5 bayrak KAPALIYKEN mevcut PENDING cihaz TERFİ ETMEZ (revoke kararı korunur)
//   §6 F216: mevcut cihazda announce yalnız canlılık yazar (status/kind sabit)
//   §7 iki tavan da yerinde (MAX_PENDING_DEVICES + MAX_DEVICE_ROWS)
// =============================================================================
import { readFileSync } from "fs";
import path from "path";
import prisma from "../src/lib/prisma";
import { DeviceService } from "../src/services/device.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** Bayrağı doğrudan DB'ye yaz — reader KASITEN cache'siz, anında görülür. */
async function setFlag(value: boolean) {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED },
    create: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED, value, description: "TEST" },
    update: { value },
  });
}

async function main() {
  const ts = Date.now();
  const prefix = `test-pairflag-${ts}`;
  const original = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED },
    select: { value: true, description: true },
  });

  const station = await prisma.station.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!station) throw new Error("İstasyon yok (npm run seed)");
  const machine = await prisma.machine.create({
    data: { stationId: station.id, code: `TST-PF-${ts}`, name: "TEST PAIRFLAG MAKİNE" },
    select: { id: true },
  });

  try {
    // ── §1 bayrak KAPALI → APPROVED doğar ────────────────────────────────────
    await setFlag(false);
    const offId = `${prefix}-off`;
    const off = await DeviceService.announce({ deviceId: offId, name: "TEST Tablet OFF" });
    check("§1 bayrak KAPALI → announce APPROVED döner", off.status === "APPROVED", `status=${off.status}`);
    const offRow = await prisma.device.findUnique({
      where: { deviceId: offId },
      select: { id: true, status: true },
    });
    check("§1b DB satırı da APPROVED", offRow?.status === "APPROVED", `db=${offRow?.status}`);
    check("§1c cevap pairingRequired=false taşır", off.pairingRequired === false, String(off.pairingRequired));

    // Audit izi — bayrak sonradan açılırsa "kimse onaylamadı" diyebilmenin tek kaydı.
    const auto = await prisma.systemLog.findFirst({
      where: { tableName: "devices", recordId: offRow?.id ?? "" },
      orderBy: { createdAt: "desc" },
      select: { action: true, newData: true },
    });
    const autoData = (auto?.newData ?? {}) as Record<string, unknown>;
    check(
      "§1d otomatik onayın audit izi (DEVICE_AUTO_APPROVED)",
      auto?.action === "CREATE" && autoData.event === "DEVICE_AUTO_APPROVED",
      `${auto?.action}/${String(autoData.event)}`,
    );

    // ── §2 bayrak KAPALI → atıf çözülür ──────────────────────────────────────
    // Eski davranışta (koşulsuz PENDING) resolveDevice NULL dönüyordu; yani makine
    // atfı VE cihaza bağlı donanım (BT yazıcı) sessizce çözülemiyordu.
    const resolvedNoMachine = await DeviceService.resolveDevice(offId);
    check("§2 APPROVED doğan cihaz resolveDevice ile çözülür", resolvedNoMachine !== null);
    await DeviceService.approveAndAssign(offRow?.id ?? "", { machineId: machine.id });
    const resolved = await DeviceService.resolveDevice(offId);
    check("§2b atama sonrası makine atfı döner", resolved?.machineId === machine.id);

    // ── §3 bayrak AÇIK → PENDING doğar ───────────────────────────────────────
    await setFlag(true);
    const onId = `${prefix}-on`;
    const on = await DeviceService.announce({ deviceId: onId, name: "TEST Tablet ON" });
    check("§3 bayrak AÇIK → announce PENDING döner", on.status === "PENDING", `status=${on.status}`);
    check("§3b cevap pairingRequired=true taşır", on.pairingRequired === true, String(on.pairingRequired));
    check("§3c PENDING iken resolveDevice null", (await DeviceService.resolveDevice(onId)) === null);

    // ── §4 status cevabı kararı taşır (bilinmeyen cihazda da) ────────────────
    const stOn = await DeviceService.getStatus(onId);
    check("§4 getStatus pairingRequired=true", stOn.pairingRequired === true && stOn.status === "PENDING");
    const unknown = await DeviceService.getStatus(`${prefix}-yok`);
    check(
      "§4b bilinmeyen cihaz: UNKNOWN + pairingRequired",
      unknown.status === "UNKNOWN" && unknown.pairingRequired === true,
    );
    await setFlag(false);
    const stOff = await DeviceService.getStatus(onId);
    check(
      "§4c bayrak kapanınca aynı PENDING cihaz için karar false döner",
      stOff.status === "PENDING" && stOff.pairingRequired === false,
      `${stOff.status}/${String(stOff.pairingRequired)}`,
    );

    // ── §5 mevcut PENDING TERFİ ETMEZ ────────────────────────────────────────
    // Bayrak kapalıyken bile: "hiç görülmemiş cihaz" ≠ "yöneticinin PENDING'de
    // bıraktığı / revoke ettiği cihaz". Public uç yönetici kararını geri alamaz.
    const reOff = await DeviceService.announce({ deviceId: onId });
    check("§5 bayrak KAPALI + mevcut PENDING → PENDING kalır", reOff.status === "PENDING", `status=${reOff.status}`);

    // ── §6 F216: mevcut cihazda announce yalnız canlılık yazar ───────────────
    const beforeKind = await prisma.device.findUnique({
      where: { deviceId: offId },
      select: { kind: true, status: true, lastSeenAt: true },
    });
    await new Promise((r) => setTimeout(r, 20));
    await DeviceService.announce({ deviceId: offId, kind: "DESKTOP" });
    const afterKind = await prisma.device.findUnique({
      where: { deviceId: offId },
      select: { kind: true, status: true, lastSeenAt: true },
    });
    check(
      "§6 APPROVED cihazda kind/status DEĞİŞMEZ (F216)",
      afterKind?.kind === beforeKind?.kind && afterKind?.status === "APPROVED",
      `${beforeKind?.kind}→${afterKind?.kind}`,
    );
    check(
      "§6b lastSeenAt tazelenir",
      (afterKind?.lastSeenAt?.getTime() ?? 0) > (beforeKind?.lastSeenAt?.getTime() ?? 0),
    );

    // ── §7 tavanlar yerinde ──────────────────────────────────────────────────
    // Kaynak sondası: 200/500 satırlık gerçek yük üretmeden, kapının SİLİNMEDİĞİNİ
    // ölçer. Bayrak kapalı rejimde PENDING sayacı hiç artmaz → tek tavan yetmez.
    const src = readFileSync(path.join(__dirname, "../src/services/device.service.ts"), "utf8");
    check("§7 PENDING tavanı duruyor", /pendingCount >= MAX_PENDING_DEVICES/.test(src) && src.includes("PENDING_DEVICE_LIMIT"));
    check("§7b toplam satır tavanı eklendi", /totalCount >= MAX_DEVICE_ROWS/.test(src) && src.includes("DEVICE_LIMIT"));
    check(
      "§7c toplam tavan REJİMDEN BAĞIMSIZ (pairingRequired dalının DIŞINDA)",
      src.indexOf("totalCount >= MAX_DEVICE_ROWS") < src.indexOf("if (pairingRequired) {"),
    );
  } finally {
    await prisma.device
      .deleteMany({ where: { deviceId: { startsWith: prefix } } })
      .catch(() => {});
    await prisma.machine.deleteMany({ where: { id: machine.id } }).catch(() => {});
    // Bayrağı OLDUĞU GİBİ geri koy (satır yoksa satırsız bırak — "false" yazmak
    // "hiç ayarlanmamış" ile aynı davranır ama denetim izini kirletir).
    if (original) {
      await prisma.systemSetting
        .update({
          where: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED },
          data: { value: original.value ?? false, description: original.description },
        })
        .catch(() => {});
    } else {
      await prisma.systemSetting
        .delete({ where: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED } })
        .catch(() => {});
    }
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
