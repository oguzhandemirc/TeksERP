// =============================================================================
// Test: yazıcı transport (Faz-2 gerçek socket gönderim + Faz-1 simülasyon)
// Çalıştır: npx tsx scripts/test_printer_transport.ts
// localhost SAHTE TCP dinleyiciyle bağlantı + gönderilen baytlar doğrulanır
// (gerçek Argox olmadan). Fiziksel baskı sahada teyit edilir.
// =============================================================================
import net from "net";
import prisma from "../src/lib/prisma";
import { dispatchNativeSend } from "../src/services/helpers/printer-transport";
import { LabelService } from "../src/services/label.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Mock { port: number; received: () => string; close: () => void }
function startMock(): Promise<Mock> {
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0);
    const server = net.createServer((sock) => {
      sock.on("data", (d: Buffer) => { buf = Buffer.concat([buf, d]); });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, received: () => buf.toString("latin1"), close: () => server.close() });
    });
  });
}

async function main() {
  const svc = new LabelService();
  const originalFlag = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED },
    select: { value: true },
  });

  const mock = await startMock();
  try {
    // 1) enabled=true + localhost mock → gerçekten gönderilir, baytlar ulaşır
    const content = "\x02L\r1100PATOS\rE\r";
    const r1 = await dispatchNativeSend(content, { language: "PPLA", enabled: true, printerIp: "127.0.0.1", port: mock.port });
    await sleep(120);
    check("enabled → delivered=true, simulated=false", r1.delivered === true && r1.simulated === false);
    check("gönderilen bayt sayısı doğru", r1.bytes === Buffer.byteLength(content, "latin1"));
    check("mock baytları AYNEN aldı", mock.received() === content, `${mock.received().length}/${content.length}`);
    check("target ip:port", r1.target === `127.0.0.1:${mock.port}`);

    // 2) enabled=false → SİMÜLE (socket açılmaz, mock yeni veri almaz)
    const beforeLen = mock.received().length;
    const r2 = await dispatchNativeSend("XYZ", { language: "PPLA", enabled: false, printerIp: "127.0.0.1", port: mock.port });
    await sleep(80);
    check("disabled → simulated=true, delivered=false", r2.simulated === true && r2.delivered === false);
    check("disabled → mock'a hiç veri gitmedi", mock.received().length === beforeLen);

    // 3) enabled ama IP yok → hata (gönderemez)
    const r3 = await dispatchNativeSend("XYZ", { language: "ZPL", enabled: true, printerIp: null });
    check("enabled + IP yok → delivered=false + error", r3.delivered === false && !!r3.error);

    // 4) enabled + erişilemez port → hata, ÇÖKMEZ
    const r4 = await dispatchNativeSend("XYZ", { language: "PPLA", enabled: true, printerIp: "127.0.0.1", port: 1, timeoutMs: 1500 });
    check("erişilemez port → delivered=false + error (çökme yok)", r4.delivered === false && !!r4.error);

    // 5) Servis: testNativeSend — flag açık → sample PPLA mock'a gider
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED },
      update: { value: true }, create: { key: SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED, value: true },
    });
    const before5 = mock.received().length;
    const t1 = await svc.testNativeSend({ printerIp: "127.0.0.1", port: mock.port, language: "PPLA" });
    await sleep(120);
    check("testNativeSend(flag açık, PPLA) → delivered", t1.data.delivered === true);
    check("testNativeSend → örnek PPLA mock'a ulaştı (STX L + ÖRNEK)",
      mock.received().length > before5 && mock.received().slice(before5).includes("\x02L"));

    // 6) Servis: testNativeSend — HTML dili → doğrudan gönderim YOK
    const t2 = await svc.testNativeSend({ printerIp: "127.0.0.1", port: mock.port, language: "RASTER_HTML" });
    check("testNativeSend(HTML) → delivered=false + not", t2.data.delivered === false && /HTML/.test(t2.data.note));

    // 7) Servis: flag KAPALI → simüle
    await prisma.systemSetting.update({
      where: { key: SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED }, data: { value: false },
    });
    const t3 = await svc.testNativeSend({ printerIp: "127.0.0.1", port: mock.port, language: "PPLA" });
    check("testNativeSend(flag kapalı) → simulated", t3.data.simulated === true && t3.data.delivered === false);
  } finally {
    mock.close();
    if (originalFlag) {
      await prisma.systemSetting.upsert({
        where: { key: SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED },
        update: { value: originalFlag.value as boolean }, create: { key: SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED, value: originalFlag.value as boolean },
      });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED } });
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
