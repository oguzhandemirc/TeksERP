// Kutu sorgusu toplayıcı — her kutu kendi react-query anahtarıyla yaşar (eklenen kutu yalnız kendini
// ister), ama aynı tikte başlayan kutu sorguları TEK `/pano?kutular=` isteğinde birleşir.
import { fetchPanoBoxes } from "../dashboardService";
import type { PanoDonem } from "./types";

export interface BoxRequest {
  key: string;
  donem: PanoDonem;
  /** Dönemsiz kutu herhangi bir dönemli isteğe katılabilir (penceresi kullanılmaz). */
  periodic: boolean;
  gun?: string;
  ay?: string;
}

interface Pending extends BoxRequest {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

type Fetcher = typeof fetchPanoBoxes;

let queue: Pending[] = [];
let scheduled = false;
let fetcher: Fetcher = fetchPanoBoxes;

/** Test kancası — gerçek istek yerine casus. */
export function setBoxFetcher(f: Fetcher | null): void {
  fetcher = f ?? fetchPanoBoxes;
}

/** Bir kutunun verisi (null = izinsiz/kapalı). Aynı tikteki çağrılar birleşir. */
export function requestBox(req: BoxRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    queue.push({ ...req, resolve, reject });
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
  });
}

/** Gruplar: ajanda parametresi (gun|ay) ayrı istek; dönemli kutular dönemine göre, dönemsizler ilk gruba katılır. */
export function groupRequests<T extends BoxRequest>(items: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  const loose = new Map<string, T[]>();
  for (const it of items) {
    const agenda = `${it.gun ?? ""}|${it.ay ?? ""}`;
    const target = it.periodic ? groups : loose;
    const key = it.periodic ? `${it.donem}|${agenda}` : agenda;
    target.set(key, [...(target.get(key) ?? []), it]);
  }
  for (const [agenda, list] of loose) {
    const host = [...groups.keys()].find((k) => k.slice(k.indexOf("|") + 1) === agenda);
    if (host) groups.get(host)!.push(...list);
    else groups.set(`${list[0]!.donem}|${agenda}`, list);
  }
  return [...groups.values()];
}

function flush(): void {
  const items = queue;
  queue = [];
  scheduled = false;
  for (const group of groupRequests(items)) void runGroup(group);
}

/** Sunucu `PANO_BOX_UNKNOWN` derse bilinmeyenler null sayılır, kalanlar bir kez yeniden istenir. */
async function runGroup(group: Pending[], retried = false): Promise<void> {
  const head = group[0]!;
  const keys = [...new Set(group.map((g) => g.key))];
  try {
    const res = await fetcher({ donem: head.donem, kutular: keys, gun: head.gun, ay: head.ay });
    for (const g of group) g.resolve(res.kutular[g.key] ?? null);
  } catch (e) {
    const unknown = unknownKeys(e);
    if (!retried && unknown.length > 0) {
      const rest = group.filter((g) => !unknown.includes(g.key));
      for (const g of group) if (unknown.includes(g.key)) g.resolve(null);
      if (rest.length > 0) await runGroup(rest, true);
      return;
    }
    for (const g of group) g.reject(e);
  }
}

function unknownKeys(e: unknown): string[] {
  const details = (e as { response?: { data?: { details?: { code?: unknown; unknown?: unknown } } } })?.response?.data?.details;
  if (details?.code !== "PANO_BOX_UNKNOWN" || !Array.isArray(details.unknown)) return [];
  return details.unknown.filter((k): k is string => typeof k === "string");
}
