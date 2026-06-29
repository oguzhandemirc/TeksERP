// =============================================================================
// Test: HAL backend transport (tcpTransport) + meter codec.
// Çalıştır: npx tsx scripts/test_device_transport.ts
// localhost SAHTE TCP dinleyiciyle write/test doğrulanır; codec saf parser.
// DB gerektirmez.
// =============================================================================
import net from "net";
import { tcpTransport } from "../src/services/helpers/device-transport";
import { parseMeterReading } from "../src/services/helpers/codec/meter.codec";

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
      sock.on("data", (d) => { buf = Buffer.concat([buf, d]); });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, received: () => buf.toString("latin1"), close: () => server.close() });
    });
  });
}

async function main() {
  const mock = await startMock();
  try {
    // 1) tcpTransport.write → baytlar mock'a ulaşır, sayı doğru
    const content = "\x02L\r1100PATOS\rE\r";
    const t = tcpTransport("127.0.0.1", mock.port, 2000);
    const bytes = await t.write(content);
    await sleep(120);
    check("write → bayt sayısı doğru", bytes === Buffer.byteLength(content, "latin1"));
    check("write → mock baytları AYNEN aldı", mock.received() === content, `${mock.received().length}/${content.length}`);

    // 2) test() → erişilebilir porta bağlanır (resolve)
    let connected = false;
    try { await t.test(); connected = true; } catch { connected = false; }
    check("test() → erişilebilir port resolve", connected);

    // 3) test() → erişilemez port reject (çökme yok)
    let rejected = false;
    try { await tcpTransport("127.0.0.1", 1, 1200).test(); } catch { rejected = true; }
    check("test() → erişilemez port reject", rejected);

    // 4) codec — varsayılan (decimals=1, scale=1)
    check("codec '123.4\\r\\n' → 123.4", parseMeterReading("123.4\r\n") === 123.4);
    check("codec 'M=12,5' → 12.5", parseMeterReading("M=12,5") === 12.5);
    check("codec son pozitif token", parseMeterReading("PREV 10 CUR 42.7") === 42.7);
    check("codec sayı yok → null", parseMeterReading("ERR") === null);
    check("codec 0 → null", parseMeterReading("0") === null);

    // 5) codec — scale/decimals
    check("codec scale 0.01 (cm→m)", parseMeterReading("12345", { scale: 0.01 }) === 123.5);
    check("codec decimals 2", parseMeterReading("123.456", { decimals: 2 }) === 123.46);
  } finally {
    mock.close();
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
