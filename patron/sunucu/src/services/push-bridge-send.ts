// PUSH KÖPRÜSÜ GÖNDERİMİ — tek dürt isteğinin belirteçlerini taşıyıcıya verir; iki güvence:
//   · süre tavanı (`KOPRU_DURT_SURE_SN`): toplu taşıyıcıda (Expo) tek istek, değilse sıralı + tavan; süre dolunca kalan
//     belirteçler `GECICI SURE_DOLDU` (geç biten gönderim yine yineleme belleğine işlenir).
//   · yineleme belleği (süreç içi, `PUSH_BRIDGE_DEDUP_MS`): aynı (kurulum, bildirimId, özet) gönderildiyse ikinci kez
//     GÖNDERİLMEZ → `GONDERILDI`; gönderim sürüyorsa `GECICI GONDERIM_SURUYOR`. Yeniden başlatmada bellek silinir.
import type { BridgeMessage, BridgeTransport, PushOutcome } from "../push/transports";
import type { CloudContext } from "./context";

/** Aynı bildirimin aynı belirtece ikinci kez gitmediği pencere. */
export const PUSH_BRIDGE_DEDUP_MS = 10 * 60_000;
/** Bellek tavanı (en eski önce düşer); 20 belirteç × dakikada 120 dürt × birkaç yüz kurulumu karşılar. */
export const PUSH_BRIDGE_DEDUP_MAX = 50_000;

type DedupState = { readonly state: "sending" } | { readonly state: "sent"; readonly until: number };

const dedupByCtx = new WeakMap<CloudContext, Map<string, DedupState>>();

function dedupOf(ctx: CloudContext): Map<string, DedupState> {
  let m = dedupByCtx.get(ctx);
  if (!m) {
    m = new Map();
    dedupByCtx.set(ctx, m);
  }
  return m;
}

export interface SendItem {
  readonly token: string;
  readonly digest: string;
}

const SURE_DOLDU: PushOutcome = { kind: "GECICI", code: "SURE_DOLDU" };
const SURUYOR: PushOutcome = { kind: "GECICI", code: "GONDERIM_SURUYOR" };

function sendAll(transport: BridgeTransport, items: readonly SendItem[], msg: BridgeMessage, deadline: number): Promise<PushOutcome>[] {
  if (transport.sendBridgeBatch && items.length > 0) {
    const batch = transport.sendBridgeBatch(
      items.map((i) => i.token),
      msg,
    );
    return items.map((_, k) => batch.then((r) => r[k] ?? { kind: "KALICI", code: "EXPO_YANIT_BICIMSIZ" }));
  }
  // Sıralı (Expo hız sınırı + belirlenimli sıra); süre dolduysa sıradakine istek atılmaz.
  const out: Promise<PushOutcome>[] = [];
  let prev: Promise<unknown> = Promise.resolve();
  for (const i of items) {
    const p = prev.then(() => (performance.now() >= deadline ? SURE_DOLDU : transport.sendBridge(i.token, msg)));
    out.push(p);
    prev = p;
  }
  return out;
}

/** `results[k]` = `items[k]`'nin sonucu. Yineleme belleği gönderim başarısız olursa serbest kalır. */
export async function sendWithBudget(
  ctx: CloudContext,
  transport: BridgeTransport,
  g: { readonly installationId: string; readonly items: readonly SendItem[]; readonly msg: BridgeMessage; readonly nowMs: number },
): Promise<PushOutcome[]> {
  const { installationId, items, msg, nowMs } = g;
  const dedup = dedupOf(ctx);
  const keyOf = (i: SendItem) => `${installationId}|${msg.bildirimId}|${i.digest}`;
  const results: (PushOutcome | null)[] = items.map((i) => {
    const d = dedup.get(keyOf(i));
    if (d?.state === "sending") return SURUYOR;
    if (d?.state === "sent" && d.until > nowMs) return { kind: "OK" };
    return null;
  });
  const fresh = items.filter((_, k) => results[k] === null);
  for (const i of fresh) dedup.set(keyOf(i), { state: "sending" });
  const deadline = performance.now() + ctx.config.KOPRU_DURT_SURE_SN * 1000;
  const pending = sendAll(transport, fresh, msg, deadline).map((p, k) =>
    p.then(
      (o) => {
        const key = keyOf(fresh[k]!);
        dedup.delete(key);
        if (o.kind === "OK" && o !== SURE_DOLDU) dedup.set(key, { state: "sent", until: nowMs + PUSH_BRIDGE_DEDUP_MS });
        while (dedup.size > PUSH_BRIDGE_DEDUP_MAX) dedup.delete(dedup.keys().next().value!);
        return o;
      },
      (): PushOutcome => {
        dedup.delete(keyOf(fresh[k]!));
        return { kind: "GECICI", code: "AG_HATASI" };
      },
    ),
  );
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<"SURE">((r) => {
    timer = setTimeout(() => r("SURE"), Math.max(0, deadline - performance.now()));
    timer.unref();
  });
  const settled: (PushOutcome | null)[] = fresh.map(() => null);
  pending.forEach((p, k) => void p.then((o) => (settled[k] = o)));
  await Promise.race([Promise.all(pending), expired]);
  clearTimeout(timer);
  let f = 0;
  return results.map((r) => r ?? settled[f++] ?? SURE_DOLDU);
}
