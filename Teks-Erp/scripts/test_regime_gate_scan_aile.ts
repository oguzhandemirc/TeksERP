// =============================================================================
// REJİM TARAYICISI — BÖLÜNMÜŞ AİLE + YENİDEN DIŞA AKTARIM BEKÇİSİ (sentetik fikstür)
// =============================================================================
// Büyük servisler cephe (`<ad>.service.ts`) + alt dizin (`<ad>/`) modüllerine bölündü (2026-11-08, S1–S5).
// Tarayıcı (`lib/regime-gate-scan.ts`) router'dan 3 sekme import izler; bölme bir dosyayı ikiye-üçe
// yaydığı için derinlik tavanı erken dolup tarama SESSİZCE daralıyordu (bağımsız inceleme dört sınıf ölçtü):
//   (a) cepheye tam derinlik 3'te varılırsa alt modüllere hiç inilmiyordu;
//   (b) cephe→modül kenarı kuyruğun SONUNA girip BFS derinlik sırasını bozuyordu (düğüm büyük derinlikle işaretlenip kısa yol atlanıyordu);
//   (c) modül→KARDEŞ modül kenarı derinlik sayıyordu;
//   (d) `export * from` / `export { x } from` izlenmiyordu.
// Bu bekçi her sınıfı küçük bir geçici `src/` ağacında ölçer; gerçek kod ağacından bağımsızdır (DB'siz, salt-okur).
// Gerçek ağaçta taban (bölme öncesi) ⊆ şimdi ölçümü düzeltme PR'ının gövdesinde; kalıcı koruma bu sentetik fikstür.
// ⭐ NEGATİF SONDA (2026-11-08): (a)–(d) ve aile genişletmesi tek tek geri alındı → ilgili §2 satırı ❌; geri alınınca yeşil.
//   (b) İKİ mekanizmadır (gevşetme: kısa yol bayat girişi ezer · deque önü: 0-kenar arkaya girmez). Yalnız biri geri
//   alınınca §2b2 ❌; ikisi birden geri alınınca §2b1 de ❌ (§2b1 tek başına ikisinden birini yakalamaz, ölçüldü).
// =============================================================================
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { aileCephesi, rejimTaramasiKur, ulasilanDosyalar } from "./lib/regime-gate-scan";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

/** Model erişimi taşıyan dosya gövdesi. */
const modelKodu = (m: string): string => `import prisma from "../lib/prisma";\nexport const f = () => prisma.${m}.findMany();\n`;

const FIKSTUR: Record<string, string> = {
  "app.ts": "",
  "lib/prisma.ts": "export default {} as never;\n",
  // (a) Cephe tam derinlik 3'te: a.routes → m1 (1) → m2 (2) → famA.service (3) ⇒ famA/core (aile içi, 3).
  "routes/a.routes.ts": 'import "../services/m1";\n',
  "services/m1.ts": 'import "./m2";\n',
  "services/m2.ts": 'import "./famA.service";\n',
  "services/famA.service.ts": 'import { f } from "./famA/core";\nexport const g = f;\n',
  "services/famA/core.ts": modelKodu("hedefA").replace("../lib", "../../lib"),
  // (b) BFS sırası: b.routes → p (1) → q (2) → h (3, uzun yol); b.routes → famB.service (1) ⇒ famB/x (1) → h (2) → k (3).
  "routes/b.routes.ts": 'import "../services/p";\nimport "../services/famB.service";\n',
  "services/p.ts": 'import "./q";\n',
  "services/q.ts": 'import "./h";\n',
  "services/famB.service.ts": 'import "./famB/x";\n',
  "services/famB/x.ts": 'import "../h";\n',
  "services/h.ts": 'import "./k";\n',
  "services/k.ts": modelKodu("hedefB"),
  // (b2) Deque önü: b2.routes → q2 (1) → h2 (2) → famQ/y (3, yanlış); b2.routes → famB2.service (1) ⇒ famB2/x (1) →
  // famQ.service (2) ⇒ famQ/y (2) → k2 (3). 0-kenar ARKAYA girerse famQ/y önce 3'te İŞLENİR, 2'lik giriş atlanır, k2 düşer.
  "routes/b2.routes.ts": 'import "../services/q2";\nimport "../services/famB2.service";\n',
  "services/q2.ts": 'import "./h2";\n',
  "services/h2.ts": 'import "./famQ/y";\n',
  "services/famB2.service.ts": "export const b2 = 1;\n",
  "services/famB2/x.ts": 'import "../famQ.service";\n',
  "services/famQ.service.ts": "export const q = 1;\n",
  "services/famQ/y.ts": 'import "../k2";\n',
  "services/k2.ts": modelKodu("hedefB2"),
  // Aile TEK DOSYA: cephenin import ETMEDİĞİ üye de sayılır (bölme öncesi aynı dosyadaydı).
  "routes/g.routes.ts": 'import "../services/famG.service";\n',
  "services/famG.service.ts": "export const g = 1;\n",
  "services/famG/yalniz.ts": modelKodu("hedefG").replace("../lib", "../../lib"),
  // (c) Kardeş modül: c.routes → famC.service (1) ⇒ famC/a ⇒ famC/b (aile içi, 1) → c1 (2) → c2 (3).
  "routes/c.routes.ts": 'import "../services/famC.service";\n',
  "services/famC.service.ts": 'import "./famC/a";\n',
  "services/famC/a.ts": 'import "./b";\n',
  "services/famC/b.ts": 'import "../c1";\n',
  "services/c1.ts": 'import "./c2";\n',
  "services/c2.ts": modelKodu("hedefC"),
  // (d) Yeniden dışa aktarım: d1 `export *`, d2 `export { x }` — ikisi de kenar.
  "routes/d1.routes.ts": 'import "../services/r1";\n',
  "services/r1.ts": 'export * from "./r1x";\n',
  "services/r1x.ts": modelKodu("hedefD1"),
  "routes/d2.routes.ts": 'import "../services/r2";\n',
  "services/r2.ts": 'export { f } from "./r2x";\n',
  "services/r2x.ts": modelKodu("hedefD2"),
  // Tavan HÂLÂ var: aile dışı düz zincirde derinlik 4'teki model görülmez (genişleme sınırsız olmasın).
  "routes/e.routes.ts": 'import "../services/e1";\n',
  "services/e1.ts": 'import "./e2";\n',
  "services/e2.ts": 'import "./e3";\n',
  "services/e3.ts": 'import "./e4";\n',
  "services/e4.ts": modelKodu("hedefE"),
  // Ad öneki aile sayılmaz: `famA-ek/` dizini `famA.service.ts`in ailesi değildir.
  "services/famA-ek/y.ts": "export const y = 1;\n",
};

function main(): void {
  console.log("=== REJİM TARAYICISI: BÖLÜNMÜŞ AİLE + YENİDEN DIŞA AKTARIM ===\n");
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), "rejim-aile-"));
  try {
    const src = path.join(kok, "src");
    for (const [rel, icerik] of Object.entries(FIKSTUR)) {
      const f = path.join(src, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, icerik);
    }
    const R = (ad: string): string => path.join(src, "routes", `${ad}.routes.ts`);
    const S = (rel: string): string => path.join(src, "services", rel);
    const tarama = rejimTaramasiKur({
      src,
      modeller: new Set(["hedefA", "hedefB", "hedefC", "hedefD1", "hedefD2", "hedefE", "hedefB2", "hedefG"]),
      kapiAdlari: ["requireXEnabled"],
    });

    // §1 Aile tanımı — genel kural, ad listesi yok.
    check("§1a cephe kendi ailesinin anahtarı", aileCephesi(S("famA.service.ts"), src) === S("famA.service.ts"));
    check("§1b alt modül cepheye bağlanır", aileCephesi(S("famA/core.ts"), src) === S("famA.service.ts"));
    check("§1c ad öneki aile sayılmaz (`famA-ek/`)", aileCephesi(S("famA-ek/y.ts"), src) === null);
    check("§1d aile dışı düz dosya aileye bağlanmaz", aileCephesi(S("m1.ts"), src) === null);

    // §2 Dört daralma sınıfı.
    const ulA = ulasilanDosyalar(R("a"), 3, src);
    check("§2a (a) derinlik 3'teki cephenin alt modülüne inilir", tarama.modelDokunusu(R("a")) === "hedefA", `famA/core@${ulA.get(S("famA/core.ts")) ?? "yok"}`);
    const ulB = ulasilanDosyalar(R("b"), 3, src);
    check(
      "§2b1 (b) kısa yol, önce kuyruğa giren uzun yolu ezer",
      tarama.modelDokunusu(R("b")) === "hedefB" && ulB.get(S("h.ts")) === 2,
      `h@${ulB.get(S("h.ts")) ?? "yok"} k@${ulB.get(S("k.ts")) ?? "yok"}`,
    );
    const ulB2 = ulasilanDosyalar(R("b2"), 3, src);
    check(
      "§2b2 (b) aile içi 0-kenar deque ÖNÜNE girer (derinlik sırası)",
      tarama.modelDokunusu(R("b2")) === "hedefB2" && ulB2.get(S("famQ/y.ts")) === 2,
      `famQ/y@${ulB2.get(S("famQ/y.ts")) ?? "yok"} k2@${ulB2.get(S("k2.ts")) ?? "yok"}`,
    );
    const ulC = ulasilanDosyalar(R("c"), 3, src);
    check(
      "§2c (c) aile içi kardeş kenarı derinlik saymaz",
      tarama.modelDokunusu(R("c")) === "hedefC" && ulC.get(S("famC/b.ts")) === 1,
      `famC/b@${ulC.get(S("famC/b.ts")) ?? "yok"} c2@${ulC.get(S("c2.ts")) ?? "yok"}`,
    );
    check(
      "§2e aile tek dosya: cephenin import etmediği üyenin model dokunuşu sayılır",
      tarama.modelDokunusu(R("g")) === "hedefG",
      `famG/yalniz@${ulasilanDosyalar(R("g"), 3, src).get(S("famG/yalniz.ts")) ?? "yok"}`,
    );
    check("§2d1 (d) `export * from` kenardır", tarama.modelDokunusu(R("d1")) === "hedefD1");
    check("§2d2 (d) `export { x } from` kenardır", tarama.modelDokunusu(R("d2")) === "hedefD2");

    // §3 Genişleme sınırlı kalır.
    check("§3a aile dışı düz zincirde derinlik tavanı (3) korunur", tarama.modelDokunusu(R("e")) === null);
    check("§3b ulaşılan her dosyanın derinliği ≤ 3", [...ulasilanDosyalar(R("e"), 3, src).values()].every((d) => d <= 3));
    const ilgili = tarama.ilgiliRouterlar().map((x) => path.basename(x.f)).sort();
    check(
      "§3c ilgili router kümesi beklenen (a, b, b2, c, d1, d2, g — e değil)",
      ilgili.join(",") === "a.routes.ts,b.routes.ts,b2.routes.ts,c.routes.ts,d1.routes.ts,d2.routes.ts,g.routes.ts",
      ilgili.join(", "),
    );
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
