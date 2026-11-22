// =============================================================================
// test_weave_drawdown — kumaş görünümü (drawdown) saf helper'ı (kart görseli 2026-11-22). SAF, DB'siz.
// Örnek tablo panel (`Electron/src/components/weave/weave-drawdown.ts`) ve tablet aynalarının parite
// testleriyle AYNIDIR: bez ayağı, 2/1 dimi + iki atkı ipliği, döner çerçeveli desen (zemin = 3..), LENO null.
// =============================================================================
import { computeDrawdown, drawdownWindow } from "../src/services/helpers/weave-drawdown.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
const grid = (c: number[][] | undefined): string => (c ?? []).map((r) => r.join("")).join("/");

function main(): void {
  console.log("§1 bez ayağı");
  const plain = computeDrawdown({ kind: "PLAIN", liftPlan: [[1, 0], [0, 1]], lenoFrames: [], pickSequence: null, ends: 4 });
  check("§1a 2 çerçeve, 4 tel: dama tahtası (0 = çözgü üstte, 1 = atkı)", grid(plain?.cells) === "0101/1010", grid(plain?.cells));
  check("§1b düz tahar 1,2,1,2", plain?.threading.join() === "1,2,1,2");

  console.log("§2 2/1 dimi + atkı seçici");
  const twill = computeDrawdown({ kind: "DOBBY", liftPlan: [[1, 1, 0], [0, 1, 1], [1, 0, 1]], lenoFrames: [], pickSequence: [1, 2, 2] });
  check("§2a varsayılan pencere = 3 tel × 3 atkı", twill?.ends === 3 && twill.picks === 3);
  check("§2b atkı hücresi seçicideki iplik no'su", grid(twill?.cells) === "001/200/020", grid(twill?.cells));
  const tall = computeDrawdown({ kind: "DOBBY", liftPlan: [[1, 0], [0, 1]], lenoFrames: [], pickSequence: [1, 2, 3], picks: 6, ends: 2 });
  check("§2c armür ve seçici ayrı raporla döner", grid(tall?.cells) === "01/20/03/10/02/30", grid(tall?.cells));

  console.log("§3 döner çerçeve + LENO");
  const leno = computeDrawdown({ kind: "DOBBY", liftPlan: [[1, 1, 1, 0], [0, 0, 0, 1]], lenoFrames: [1, 2], pickSequence: null });
  check("§3a döner çerçeveler tahardan çıkar (zemin 3,4)", leno?.groundFrames.join() === "3,4" && leno.threading.join() === "3,4", leno?.groundFrames.join());
  check("§3b zemin hücreleri yalnız zemin çerçevelerinden", grid(leno?.cells) === "01/10", grid(leno?.cells));
  check("§3c LENO türünde çizim yok", computeDrawdown({ kind: "LENO", liftPlan: [[1, 0]], lenoFrames: [], pickSequence: null }) === null);
  check("§3d bütün çerçeveler döner → null", computeDrawdown({ kind: "DOBBY", liftPlan: [[1, 0]], lenoFrames: [1, 2], pickSequence: null }) === null);
  check("§3e armür yok → null", computeDrawdown({ kind: "DOBBY", liftPlan: null, lenoFrames: [], pickSequence: null }) === null && computeDrawdown({ kind: "DOBBY", liftPlan: [], lenoFrames: [], pickSequence: null }) === null);

  console.log("§4 pencere");
  check("§4a 14 zemin, 30 armür + 30 seçici → 28 tel × 30 atkı", JSON.stringify(drawdownWindow(14, 30, 30)) === '{"ends":28,"picks":30}', JSON.stringify(drawdownWindow(14, 30, 30)));
  check("§4b 4 zemin, 4 armür + 6 seçici → 24 × 24 (EKOK 12'nin katı)", JSON.stringify(drawdownWindow(4, 4, 6)) === '{"ends":24,"picks":24}', JSON.stringify(drawdownWindow(4, 4, 6)));
  check("§4c rapor min'i aşarsa tek rapor; tavan 64", drawdownWindow(30, 100, 0).ends === 30 && drawdownWindow(30, 100, 0).picks === 64);
}

main();
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
