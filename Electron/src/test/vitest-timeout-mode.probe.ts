// Sonda yardımcısı (test DEĞİL — `.probe.ts`): config'i ayrı bir Node sürecinde yükler ve
// çözülen testTimeout'u basar. Test dosyası bunu `vite-node` ile spawn eder: config'in
// import ettiği vite eklentisi (esbuild) jsdom worker'ında yüklenemez (TextEncoder/Uint8Array
// realm uyuşmazlığı), plain Node'da yüklenir. Kip env'den okunur (TEKSERP_KAPI_ADIMI).
import config from "../../vitest.config";

const c = config as { test?: { testTimeout?: number } };
process.stdout.write(String(c.test?.testTimeout));
