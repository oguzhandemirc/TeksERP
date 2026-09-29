// SENARYO SAATİ — koşucunun doğurduğu sunucu sürecinde küresel saati kaydırır (`--import` ile,
// uygulama modüllerinden ÖNCE). Yalnız senaryo süreçleri (127.0.0.1, `_test` DB) yükler; src'ye girmez.
//   duvar: Date.now() / new Date() kayar — saat ileri/geri SIÇRAMASI (makinenin saati yanlış)
//   mono : process.hrtime kayar — GERÇEK zaman geçişi (makine açıkken biriken süre)
// Uygulamanın zamanlayıcıları (setTimeout) gerçek süreyle işler; yalnız okunan saat kayar.
// Denetim IPC ile: `{ tip: "senaryo-saat", duvarMs, monoMs }` → `{ tip: "senaryo-saat-tamam", simdi }`.

const GercekDate = Date;
const gercekHrBig = process.hrtime.bigint.bind(process.hrtime);
let duvarMs = Number(process.env.SENARYO_SAAT_DUVAR_MS ?? 0) || 0;
let monoNs = BigInt(Math.round(Number(process.env.SENARYO_SAAT_MONO_MS ?? 0) || 0)) * 1_000_000n;

function simdi(): number {
  return GercekDate.now() + duvarMs;
}

const KaymisDate = new Proxy(GercekDate, {
  construct(hedef, args: unknown[], yeniHedef) {
    return args.length === 0 ? Reflect.construct(hedef, [simdi()], yeniHedef) : Reflect.construct(hedef, args, yeniHedef);
  },
  apply() {
    return new GercekDate(simdi()).toString();
  },
  get(hedef, ad, alici) {
    if (ad === "now") return simdi;
    return Reflect.get(hedef, ad, alici) as unknown;
  },
});
globalThis.Date = KaymisDate;

function hrBig(): bigint {
  return gercekHrBig() + monoNs;
}
function hr(onceki?: [number, number]): [number, number] {
  const t = hrBig();
  let s = Number(t / 1_000_000_000n);
  let n = Number(t % 1_000_000_000n);
  if (onceki) {
    s -= onceki[0];
    n -= onceki[1];
    if (n < 0) {
      s -= 1;
      n += 1_000_000_000;
    }
  }
  return [s, n];
}
hr.bigint = hrBig;
process.hrtime = hr as typeof process.hrtime;

process.on("message", (m: unknown) => {
  if (!m || typeof m !== "object" || (m as { tip?: unknown }).tip !== "senaryo-saat") return;
  const g = m as { duvarMs?: unknown; monoMs?: unknown };
  if (typeof g.duvarMs === "number" && Number.isFinite(g.duvarMs)) duvarMs = g.duvarMs;
  if (typeof g.monoMs === "number" && Number.isFinite(g.monoMs)) monoNs = BigInt(Math.round(g.monoMs)) * 1_000_000n;
  process.send?.({ tip: "senaryo-saat-tamam", duvarMs, monoMs: Number(monoNs / 1_000_000n), simdi: simdi() });
});

// Koşucu düşerse (IPC koptu) süreç yetim kalmasın: düzgün kapanış (SIGTERM → sunucunun kendi kapanışı).
process.on("disconnect", () => process.kill(process.pid, "SIGTERM"));

export {};
