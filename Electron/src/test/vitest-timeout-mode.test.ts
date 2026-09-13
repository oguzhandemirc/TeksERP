// =============================================================================
// VITEST ZAMAN AŞIMI KİPE BAĞLI — config'in GERÇEK yüklemesi, bağımlılıkların yaşadığı yerde
// =============================================================================
// 1e hükmü 2026-09-14: commit kapısı 8 oturumun paylaştığı makinede yük altında koşar;
// load ≈ 25'te üç test 5000 ms'yi aştı (tek başına 21 sn) — CPU açlığı, kod hatası değil.
// Kapı kipinde (`TEKSERP_KAPI_ADIMI=commit`) 20 sn, bayraksız (CI · elle `npm test`) 5 sn.
//
// ⚠️ NEDEN BURADA: bu ölçüm önce backend bekçisinde (`test_hook_config §6`) yaşıyordu ve
//    CI'ı iki tur kırmızı tuttu — Backend job'ında `Electron/node_modules` yok, config
//    yüklenemez. Kontrol doğruydu, KOŞTUĞU YER yanlıştı: koşum yeri ölçüm koşuludur.
//    Backend tarafı artık yalnız METİN ölçer (ifade dosyada mı) ve yükleme ölçülemezse
//    ⏭ beyan eder; gerçek yükleme burada, Electron job'ında.
//
// ⚠️ AYRI SÜREÇTE (vite-node): config vite eklentisi (esbuild) import eder; jsdom
//    worker'ında yüklenemez (TextEncoder/Uint8Array realm uyuşmazlığı). Sonda yardımcısı
//    `vitest-timeout-mode.probe.ts` plain Node'da yükler, değeri basar.
// =============================================================================
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const KOK = resolve(__dirname, "..", "..");

function yuklenenTestTimeout(kip: string | undefined): string {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (kip === undefined) delete env.TEKSERP_KAPI_ADIMI;
  else env.TEKSERP_KAPI_ADIMI = kip;
  const r = spawnSync(process.execPath, [resolve(KOK, "node_modules/vite-node/vite-node.mjs"), resolve(KOK, "src/test/vitest-timeout-mode.probe.ts")], {
    cwd: KOK,
    encoding: "utf8",
    env,
    timeout: 60_000,
  });
  if (r.status !== 0) throw new Error(`sonda yüklenemedi (çıkış ${r.status}): ${r.stderr.slice(0, 300)}`);
  return r.stdout.trim();
}

describe("vitest.config.ts — testTimeout kipe bağlı (gerçek yükleme)", () => {
  it("⭐ kapı kipinde (TEKSERP_KAPI_ADIMI=commit) 20 000 ms", () => {
    expect(yuklenenTestTimeout("commit")).toBe("20000");
  });

  it("⭐ bayraksız (CI / elle koşum) 5 000 ms — asıl sınır boş koşucuda kalır", () => {
    expect(yuklenenTestTimeout(undefined)).toBe("5000");
  });

  it("başka bir değer kapı kipi SAYILMAZ (yalnız 'commit')", () => {
    expect(yuklenenTestTimeout("ci")).toBe("5000");
  });
});
