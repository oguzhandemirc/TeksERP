// =============================================================================
// Test: aynı clientToken'ın kaybedeni işi KOŞTURMAZ — R kipi erken dönüş (Perf-4 B-02)
// Çalıştır: npx tsx scripts/test_perf_replay_erken.ts
// =============================================================================
// `tokenReplay(...).run` aynı token uçuştayken gelen denemeyi kazananın bitişine
// bağlar ve cevabı token'dan (`resolve`) verir; iş (tx) yalnız bir kez koşar.
// DB'siz: politika bellek içi bir "defter" okur. Ölçülen: iş çağrı sayısı.
// Negatif sonda (elle, harita satırında): `run`daki uçuş kuyruğu kaldırılınca §1 ❌ (iş 50 kez);
// bağlam (`flightContext.tokens`) kontrolü kaldırılınca §6 ❌ (iç içe aynı token ebeveynini bekler, kilit).
// =============================================================================
import { AppError } from "../src/utils/app-error";
import { inFlightReplayCount, tokenReplay } from "../src/services/helpers/token-replay.helper";

let fail = 0;
let pass = 0;
function check(ad: string, ok: boolean, ayrinti = ""): void {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

type Kayit = { id: string; qty: number; dead?: boolean };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function kur(defter: Map<string, Kayit>, gelen: number) {
  return tokenReplay<Kayit, { id: string; replay: boolean }>({
    find: async (_db, t) => defter.get(t) ?? null,
    alive: (p) => {
      if (p.dead) throw AppError.conflict("iptal", { code: "ENTRY_CANCELLED" });
    },
    identity: (p) => [{ ad: "qty", mevcut: p.qty, gelen }],
    collision: "başka yük",
    respond: (p) => ({ id: p.id, replay: true }),
  });
}

async function main(): Promise<void> {
  const N = 50;

  // §1 aynı token ×N → iş 1 kez, N-1 replay, hepsi aynı kayıt
  {
    const defter = new Map<string, Kayit>();
    let is = 0;
    const work = async () => {
      is += 1;
      await sleep(40);
      defter.set("T1", { id: "r1", qty: 5 });
      return { id: "r1", replay: false };
    };
    const sonuc = await Promise.all(Array.from({ length: N }, () => kur(defter, 5).run("T1", work)));
    check("§1 ⭐ aynı token ×50 → iş (tx) YALNIZ 1 kez koşar", is === 1, `iş=${is}`);
    check("§1 49 deneme cevabı token'dan alır (replay)", sonuc.filter((s) => s.replay).length === N - 1);
    check("§1 hepsi aynı kayıt", sonuc.every((s) => s.id === "r1"));
  }

  // §2 kazanan kayıtsız düşerse bekleyenler SIRAYLA yeniden dener (paralel ikinci dalga yok)
  {
    const defter = new Map<string, Kayit>();
    let is = 0;
    const work = async () => {
      is += 1;
      await sleep(20);
      if (is === 1) throw AppError.badRequest("ilk deneme düştü");
      defter.set("T2", { id: "r2", qty: 5 });
      return { id: "r2", replay: false };
    };
    const sonuc = await Promise.allSettled(Array.from({ length: 10 }, () => kur(defter, 5).run("T2", work)));
    check("§2 kazanan düşünce iş yalnız bir kez daha koşar", is === 2, `iş=${is}`);
    check("§2 1 hata + 9 başarı", sonuc.filter((s) => s.status === "rejected").length === 1);
  }

  // §3 dört durum korunur: bekleyen, farklı yükte 409, ölü kayıtta 409 alır
  {
    const defter = new Map<string, Kayit>();
    const work = async () => {
      await sleep(20);
      defter.set("T3", { id: "r3", qty: 5 });
      return { id: "r3", replay: false };
    };
    const [a, b] = await Promise.allSettled([kur(defter, 5).run("T3", work), kur(defter, 9).run("T3", work)]);
    const kod = b.status === "rejected" ? (b.reason as AppError).details : null;
    check("§3 farklı yüklü bekleyen 409 CLIENT_TOKEN_COLLISION", a.status === "fulfilled" && JSON.stringify(kod).includes("CLIENT_TOKEN_COLLISION"), JSON.stringify(kod));
    const olu = new Map<string, Kayit>();
    const [c, d] = await Promise.allSettled([
      kur(olu, 5).run("T4", async () => { await sleep(20); olu.set("T4", { id: "r4", qty: 5, dead: true }); return { id: "r4", replay: false }; }),
      kur(olu, 5).run("T4", async () => ({ id: "x", replay: false })),
    ]);
    check("§3 ölü kayda bekleyen 409 ENTRY_CANCELLED (4. durum)", c.status === "fulfilled" && d.status === "rejected" && JSON.stringify((d.reason as AppError).details).includes("ENTRY_CANCELLED"));
  }

  // §4 farklı token'lar serileşmez
  {
    const defter = new Map<string, Kayit>();
    let is = 0;
    const t0 = Date.now();
    await Promise.all(Array.from({ length: N }, (_, i) => kur(defter, 5).run(`F${i}`, async () => { is += 1; await sleep(40); return { id: `f${i}`, replay: false }; })));
    const ms = Date.now() - t0;
    check("§4 farklı token ×50 → iş 50 kez, paralel", is === N && ms < 1000, `iş=${is} · ${ms} ms`);
  }

  // §6 aynı token İÇ İÇE (quickStart → create gibi): iç çağrı kuyruğa girmez, ebeveynini beklemez.
  // Negatif sonda: `run`daki bağlam ataması kaldırılınca iç çağrı dıştaki sözü bekler → zaman aşımı ❌.
  {
    const defter = new Map<string, Kayit>();
    let icIs = 0;
    const ic = async () => {
      icIs += 1;
      await sleep(20);
      defter.set("N1", { id: "n1", qty: 5 });
      return { id: "n1", replay: false };
    };
    const dis = () => kur(defter, 5).run("N1", async () => {
      await sleep(10);
      return kur(defter, 5).run("N1", ic);
    });
    const zaman = sleep(1500).then(() => "ZAMAN AŞIMI" as const);
    const sonuc = await Promise.race([Promise.all([dis(), ...Array.from({ length: 5 }, () => kur(defter, 5).run("N1", ic))]), zaman]);
    const ok = sonuc !== "ZAMAN AŞIMI";
    check("§6 ⭐ iç içe aynı token kilitlenmez (dış + iç + 5 bekleyen biter)", ok, ok ? `iç iş=${icIs}` : "1.5 s içinde bitmedi");
    check("§6 iç iş yalnız 1 kez, bekleyenler replay", ok && icIs === 1 && (sonuc as Array<{ replay: boolean }>).filter((s) => s.replay).length === 5, `iç iş=${icIs}`);
    const tekBasina = await Promise.race([kur(defter, 5).run("N2", () => kur(defter, 5).run("N2", async () => { defter.set("N2", { id: "n2", qty: 5 }); return { id: "n2", replay: false }; })), zaman]);
    check("§6 yalnız iç içe (bekleyensiz) de biter", tekBasina !== "ZAMAN AŞIMI" && (tekBasina as { id: string }).id === "n2");
  }

  check("§5 uçuş kuyruğu boşaldı (sızıntı yok)", inFlightReplayCount() === 0, `${inFlightReplayCount()}`);
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail === 0 ? 0 : 1;
}

void main();
