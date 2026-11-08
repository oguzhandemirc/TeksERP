// =============================================================================
// DAMGALI DEFTER TARAYICISI — BÖLÜNMÜŞ AİLE İZLEMESİ BEKÇİSİ (sentetik fikstür)
// =============================================================================
// `revoke-ast-tarama.ts` aktif yüklemi argümanda arar; değişken bir düzey izlenir. Bölünmüş servis ailesinde
// (cephe + `<ad>/`, tanım `lib/servis-aile.ts`) sabit kardeş modülde tanımlı olabilir — bölme öncesi aynı
// dosyaydı, o yüzden aile içi import izlenir. Aile DIŞI ve cephesiz dizin (`helpers/` gibi) izlenmez:
// orada sabit argümanda görünmeli, yoksa süzgeç sessizce "var" sayılır.
// DB'siz, salt-okur; gerçek ağaçtan bağımsız geçici bir kökte koşar.
// ⭐ NEGATİF SONDA (2026-11-08): `aileDizini` → `null` (aile izleme kapalı) → §2a/§2b/§3d ❌; eski tanım
//   (`services/<x>/` birinci düzey dizin) geri konunca → §2a ❌ (cephe aileye girmiyordu) + §3a ❌; geri alınınca yeşil.
// =============================================================================
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { aktifYuklemTara } from "./revoke-ast-tarama";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const DB = "const db: any = {};\n";
const FIKSTUR: Record<string, string> = {
  "tsconfig.json": JSON.stringify({ compilerOptions: { target: "es2022", module: "commonjs", strict: false, noEmit: true }, include: ["src/**/*"] }),
  "prisma/schema.prisma": "model Foo {\n  id String\n}\n",
  "src/services/helpers/foo.helper.ts": "export const ACTIVE_FOO = { revokedAt: null };\n",
  // Cepheli aile: sabit kardeş modülde; cephe ve kardeş modül onu import eder.
  "src/services/famA/shared.ts": 'import { ACTIVE_FOO } from "../helpers/foo.helper";\nexport const W = { ...ACTIVE_FOO };\n',
  "src/services/famA.service.ts": `import { W } from "./famA/shared";\n${DB}export const a = () => db.foo.findMany({ where: W });\n`,
  "src/services/famA/core.ts": `import { W } from "./shared";\n${DB}export const b = () => db.foo.count({ where: W });\n`,
  // Cephesiz dizin: kardeşten gelen sabit İZLENMEZ.
  "src/services/cephesiz/a.ts": 'import { ACTIVE_FOO } from "../helpers/foo.helper";\nexport const W2 = { ...ACTIVE_FOO };\n',
  "src/services/cephesiz/b.ts": `import { W2 } from "./a";\n${DB}export const c = () => db.foo.findMany({ where: W2 });\n`,
  // Aile dışı tüketici: ailenin sabiti İZLENMEZ.
  "src/services/disari.ts": `import { W } from "./famA/shared";\n${DB}export const d = () => db.foo.findMany({ where: W });\n`,
  // Doğrudan sabit her yerde geçer.
  "src/services/dogrudan.ts": `import { ACTIVE_FOO } from "./helpers/foo.helper";\n${DB}export const e = () => db.foo.findMany({ where: ACTIVE_FOO });\n`,
};

function main(): void {
  console.log("=== DAMGALI DEFTER TARAYICISI: BÖLÜNMÜŞ AİLE İZLEMESİ ===\n");
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), "revoke-aile-"));
  try {
    for (const [rel, icerik] of Object.entries(FIKSTUR)) {
      const f = path.join(kok, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, icerik);
    }
    const r = aktifYuklemTara(kok, [
      { delegate: "foo", model: "Foo", sabit: "ACTIVE_FOO", tablo: "foos", helper: path.join("src", "services", "helpers", "foo.helper.ts") },
    ]).get("foo")!;
    const ihlal = (d: string): boolean => r.cagriIhlal.some((x) => x.startsWith(d));
    check("§1 körlük zemini: beş çağrı da sayıldı", r.cagriSayisi === 5, `çağrı=${r.cagriSayisi}`);
    check("§2a ⭐ cephe, kardeş modülün sabitini izler", !ihlal("src/services/famA.service.ts"), r.cagriIhlal.join(", "));
    check("§2b ⭐ aile modülü, kardeş modülün sabitini izler", !ihlal("src/services/famA/core.ts"), r.cagriIhlal.join(", "));
    check("§3a ⭐ cephesiz dizinde kardeş sabiti İZLENMEZ (ihlal)", ihlal("src/services/cephesiz/b.ts"), r.cagriIhlal.join(", "));
    check("§3b ⭐ aile dışı tüketici ailenin sabitini İZLEMEZ (ihlal)", ihlal("src/services/disari.ts"), r.cagriIhlal.join(", "));
    check("§3c doğrudan sabit her yerde geçer", !ihlal("src/services/dogrudan.ts"));
    check("§3d ihlal kümesi tam iki", r.cagriIhlal.length === 2, r.cagriIhlal.join(", "));
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
