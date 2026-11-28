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

  console.log("§5 kenar çerçevesi (dilim C)");
  const kenar = computeDrawdown({ kind: "DOBBY", liftPlan: [[1, 0, 1, 0], [0, 1, 0, 1]], lenoFrames: [], selvedgeFrames: [1, 2], pickSequence: null });
  check("§5a kenar çerçeveleri zemin raporuna girmez (parite örneği: zemin 3,4)", kenar?.groundFrames.join() === "3,4" && grid(kenar?.cells) === "01/10", grid(kenar?.cells));
  // G5 (desen programı): 12 çerçeve × 9 atkı; Ç1–Ç2 kenar bezayağı, Ç3–Ç12 atkı 1–5 saten (2 atlamalı), 6–9 bezayağı.
  const g5 = Array.from({ length: 9 }, (_, j) => Array.from({ length: 12 }, (_, c) => {
    if (c < 2) return (c + j) % 2 === 0 ? 1 : 0;
    const g = c - 2;
    return j < 5 ? ((g * 2) % 5 === j ? 1 : 0) : (g + j) % 2 === 0 ? 1 : 0;
  }));
  const g5dd = computeDrawdown({ kind: "DOBBY", liftPlan: g5, lenoFrames: [], selvedgeFrames: [1, 2], pickSequence: null });
  check("§5b G5: zemin raporu 10 tel (Ç3–Ç12), kenar teli rapor içinde tekrar etmez", g5dd?.ends === 10 && g5dd.groundFrames.join() === "3,4,5,6,7,8,9,10,11,12", `${g5dd?.ends}`);
  const g5wide = computeDrawdown({ kind: "DOBBY", liftPlan: g5, lenoFrames: [], selvedgeFrames: [1, 2], pickSequence: null, ends: 30 });
  check("§5c G5 3 rapor: tahar Ç1/Ç2'ye hiç uğramaz", g5wide?.threading.length === 30 && g5wide.threading.every((f) => f >= 3));
  const noSel = computeDrawdown({ kind: "DOBBY", liftPlan: g5, lenoFrames: [], pickSequence: null });
  check("§5d kenar verilmezse bugünkü davranış (12 çerçeve zemin)", noSel?.ends === 12 && grid(noSel.cells) === grid(computeDrawdown({ kind: "DOBBY", liftPlan: g5, lenoFrames: [], selvedgeFrames: [], pickSequence: null })?.cells));
  check("§5e döner + kenar birlikte: zemin ikisinin de dışı", computeDrawdown({ kind: "DOBBY", liftPlan: [[1, 0, 1, 0, 1]], lenoFrames: [1], selvedgeFrames: [2], pickSequence: null })?.groundFrames.join() === "3,4,5");

  // K1 tahar türü — panel `weave-drawdown.test` DRAWDOWN_CASES ile aynı örnekler (parite).
  const diag = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  const pointed = computeDrawdown({ kind: "DOBBY", liftPlan: diag, lenoFrames: [], selvedgeFrames: [], pickSequence: null, drawingInType: "POINTED" });
  check("§5f sivri tahar 4 çerçeve → 6 tel (1-2-3-4-3-2)", grid(pointed?.cells) === "011111/101110/110101/111011", grid(pointed?.cells));
  const skip = computeDrawdown({ kind: "DOBBY", liftPlan: diag, lenoFrames: [], selvedgeFrames: [], pickSequence: null, drawingInType: "SKIP" });
  check("§5g atlamalı tahar 4 çerçeve → 1-3-2-4", grid(skip?.cells) === "0111/1101/1011/1110", grid(skip?.cells));
  const custom = computeDrawdown({ kind: "DOBBY", liftPlan: diag, lenoFrames: [], selvedgeFrames: [], pickSequence: null, drawingInType: "CUSTOM" });
  check("§5h özel tahar düz çizilir (bugünkü)", grid(custom?.cells) === grid(computeDrawdown({ kind: "DOBBY", liftPlan: diag, lenoFrames: [], selvedgeFrames: [], pickSequence: null })?.cells));

  // T1 tahar planı — panel `weave-drawdown.test` "tahar planı" örnekleriyle aynı (parite).
  console.log("§6 kumaşın tahar planı");
  const planned = computeDrawdown({ kind: "DOBBY", liftPlan: diag, lenoFrames: [], selvedgeFrames: [], pickSequence: null, drawingInType: "SKIP", threading: [1, 1, 2, 3, 4] });
  check("§6a plan türün önüne geçer: tahar 1-1-2-3-4, 5 tel", planned?.threading.join() === "1,1,2,3,4" && grid(planned?.cells) === "00111/11011/11101/11110", grid(planned?.cells));
  const over = computeDrawdown({ kind: "DOBBY", liftPlan: diag, lenoFrames: [], selvedgeFrames: [], pickSequence: null, drawingInType: "SKIP", threading: [1, 5] });
  check("§6b plan örgü genişliğini aşarsa türden türetilir (geri uyum)", grid(over?.cells) === grid(skip?.cells), grid(over?.cells));
  const empty = computeDrawdown({ kind: "DOBBY", liftPlan: diag, lenoFrames: [], selvedgeFrames: [], pickSequence: null, threading: [] });
  check("§6c boş plan = bugünkü düz çizim", grid(empty?.cells) === grid(custom?.cells));

  console.log("§4 pencere");
  check("§4a 14 zemin, 30 armür + 30 seçici → 28 tel × 30 atkı", JSON.stringify(drawdownWindow(14, 30, 30)) === '{"ends":28,"picks":30}', JSON.stringify(drawdownWindow(14, 30, 30)));
  check("§4b 4 zemin, 4 armür + 6 seçici → 24 × 24 (EKOK 12'nin katı)", JSON.stringify(drawdownWindow(4, 4, 6)) === '{"ends":24,"picks":24}', JSON.stringify(drawdownWindow(4, 4, 6)));
  check("§4c rapor min'i aşarsa tek rapor; tavan 64", drawdownWindow(30, 100, 0).ends === 30 && drawdownWindow(30, 100, 0).picks === 64);
}

main();
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
