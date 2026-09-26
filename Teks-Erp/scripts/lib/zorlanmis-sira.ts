// =============================================================================
// ZORLANMIŞ SIRA — iki eşzamanlı çağrının yarış penceresini yükten bağımsız açar
// =============================================================================
// NEDEN: yükle ölçen yarış testi pencereyi şansa bırakır (bordroda aynı hata 10 koşumda 0 kez
// yakalandı). Burada B'nin `prisma.$transaction`ı sarılır ve B'nin tx'indeki İLK `<model>.<metod>`
// çağrısı kapıda bekler; A o sırada koşar. Kapı A bitince, A bir PG kilidinde beklemeye düşünce ya
// da zaman aşımında açılır — hangisiyle açıldığı döner ki bekçi "B kapıya vardı mı" diye ölçebilsin.
// Kalıp: `docs/design/TOKEN-REPLAY-KILIDI.md` §4 (ilk kullanıcı `test_cek_bordro_taslak_token` ③c).
// =============================================================================
import { AsyncLocalStorage } from "node:async_hooks";
import prisma from "../../src/lib/prisma";

/** B'nin bekletilecek ilk delegate çağrısı (ör. `{ model: "cheque", metod: "findMany" }`). */
export interface KapiNoktasi {
  model: string;
  metod: string;
  /** "tx" (varsayılan): B'nin tx'indeki ilk çağrı · "dis": B'nin tx DIŞI (genel istemci) ilk çağrısı — tx'ten önce koşan kural. */
  kapsam?: "tx" | "dis";
}

/** Kapının açılış sebebi; son ikisi "B kapıya vardı ama sıra zorlanamadı" demektir. */
export type KapiAcilisi = "A bitti" | "A kilitte bekliyor" | "zaman aşımı" | "B kapıya varmadı";

export interface ZorlanmisSiraSonucu {
  /** [B, A] sırasıyla. */
  sonuclar: [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>];
  kapi: KapiAcilisi;
}

/** Kapının GERÇEKTEN sırayı zorladığı açılışlar — bekçi sonucu yorumlamadan önce bunu ölçer. */
export const SIRA_ZORLANDI: ReadonlySet<KapiAcilisi> = new Set<KapiAcilisi>(["A bitti", "A kilitte bekliyor"]);

const kapiDeposu = new AsyncLocalStorage<() => Promise<KapiAcilisi>>();
type TxFn = (fn: unknown, opts?: unknown) => Promise<unknown>;

function kapiliTx(tx: object, nokta: KapiNoktasi, bekle: () => Promise<KapiAcilisi>): object {
  const bagla = (t: object, p: string | symbol) => {
    const v = Reflect.get(t, p) as unknown;
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
  };
  const delegate = Reflect.get(tx, nokta.model) as object | undefined;
  if (!delegate) throw new Error(`zorlanmisSira: tx'te '${nokta.model}' delegate'i yok`);
  const kapili = new Proxy(delegate, {
    get: (t, p) =>
      p === nokta.metod
        ? async (...a: unknown[]) => {
            await bekle();
            return (Reflect.get(t, p) as (...x: unknown[]) => unknown).apply(t, a);
          }
        : bagla(t, p),
  });
  return new Proxy(tx, { get: (t, p) => (p === nokta.model ? kapili : bagla(t, p)) });
}

/** B'yi başlatır, B kapıya varınca (ya da B erken biterse) A'yı başlatır; ikisini bekler. */
export async function zorlanmisSira(
  nokta: KapiNoktasi,
  b: () => Promise<unknown>,
  a: () => Promise<unknown>,
  zamanAsimiMs = 5000,
): Promise<ZorlanmisSiraSonucu> {
  const kanca = prisma as unknown as { $transaction: TxFn };
  const onceki = kanca.$transaction;
  const asil = onceki.bind(prisma);
  const disDelegate = nokta.kapsam === "dis" ? (Reflect.get(prisma, nokta.model) as Record<string, unknown> | undefined) : undefined;
  const disOnceki = disDelegate?.[nokta.metod] as ((...a: unknown[]) => unknown) | undefined;
  if (nokta.kapsam === "dis") {
    if (!disDelegate || typeof disOnceki !== "function") throw new Error(`zorlanmisSira: genel istemcide '${nokta.model}.${nokta.metod}' yok`);
    disDelegate[nokta.metod] = async (...a: unknown[]) => {
      const bekle = kapiDeposu.getStore();
      if (bekle) await bekle();
      return disOnceki.apply(disDelegate, a);
    };
  } else {
    kanca.$transaction = (fn, opts) => {
      const bekle = kapiDeposu.getStore();
      if (!bekle || typeof fn !== "function") return asil(fn, opts);
      return asil((tx: object) => (fn as (t: object) => unknown)(kapiliTx(tx, nokta, bekle)), opts);
    };
  }
  let aBitti = false;
  let kapidaSinyal!: () => void;
  const kapida = new Promise<void>((r) => (kapidaSinyal = r));
  let acilis: Promise<KapiAcilisi> | null = null;
  const bekle = () =>
    (acilis ??= (async (): Promise<KapiAcilisi> => {
      kapidaSinyal();
      for (const son = Date.now() + zamanAsimiMs; Date.now() < son; ) {
        if (aBitti) return "A bitti";
        const [r] = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        if ((r?.n ?? 0) > 0) return "A kilitte bekliyor";
        await new Promise((r2) => setTimeout(r2, 10));
      }
      return "zaman aşımı";
    })());
  try {
    const bSoz = kapiDeposu.run(bekle, b);
    await Promise.race([kapida, bSoz.catch(() => undefined)]);
    const aSoz = a().finally(() => (aBitti = true));
    const [bs, as] = await Promise.allSettled([bSoz, aSoz]);
    return { sonuclar: [bs, as], kapi: acilis ? await acilis : "B kapıya varmadı" };
  } finally {
    kanca.$transaction = onceki;
    if (disDelegate && disOnceki) disDelegate[nokta.metod] = disOnceki;
  }
}

/** Sonucun hata kodu (`details.code`), yoksa mesajın başı; başarıda "ok". */
export function sonucKodu(r: PromiseSettledResult<unknown>): string {
  if (r.status === "fulfilled") return "ok";
  const e = r.reason as { details?: { code?: string }; code?: string; message?: string };
  return String(e.details?.code ?? e.code ?? (e.message ?? String(r.reason)).slice(0, 60));
}
