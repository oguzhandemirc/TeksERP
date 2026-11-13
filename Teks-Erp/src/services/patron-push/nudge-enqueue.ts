// Patron telefonu dürt kuyruğuna yazım — YALNIZ dağıtıcının gelen kutusu tx'inde (`dispatchBatchTx`), upsert'ten SONRA.
// Tx geri alınırsa dürt de yoktur. Satır yalnız teslim kararı `pp` olan (tercih + sessiz saat, `decideDeliveries`) ∧
// push bayrağı açık ∧ kullanıcının canlı belirteci varken doğar; metin KOPYALANMAZ (gönderimde kutudan okunur).
// Birleşen olay bekleyen dürt varken ikinci dürt doğurmaz (partial unique + ON CONFLICT DO NOTHING). ON CONFLICT
// yüklemi index yüklemiyle LİTERAL eşleşmeli (parametre çıkarımı tutmaz) — küme `NUDGE_LIVE_STATES`, bekçi ölçer.
import type { Prisma } from "@prisma/client";
import { readPatronPushEnabled } from "../system-setting.service";
import { LIVE_STATES } from "./states";
import { requestPatronPushRound } from "./wake";

type Tx = Prisma.TransactionClient;

export async function enqueuePatronPushTx(tx: Tx, targets: ReadonlyArray<{ userId: string; groupKey: string; pp: boolean }>): Promise<number> {
  const wanted = targets.filter((t) => t.pp);
  if (wanted.length === 0) return 0;
  if (!(await readPatronPushEnabled(tx))) return 0;
  return tx.$executeRaw`
    INSERT INTO patron_push_nudges (id, "inboxId", state, "createdAt", "updatedAt")
    SELECT gen_random_uuid(), i.id, 'BEKLIYOR', now(), now() -- tz-ok: patron_push_nudges zaman kolonları timestamptz, çıplak now() mutlak anı yazar
    FROM unnest(${wanted.map((t) => t.userId)}::text[], ${wanted.map((t) => t.groupKey)}::text[]) AS d(u, g)
    JOIN notification_inbox i ON i."userId" = d.u::uuid AND i."groupKey" = d.g AND i."resolvedAt" IS NULL
    WHERE EXISTS (SELECT 1 FROM patron_push_tokens t WHERE t."userId" = i."userId" AND t."cloudState" = ANY(${[...LIVE_STATES]}::text[]))
    ON CONFLICT ("inboxId") WHERE state IN ('BEKLIYOR', 'GONDERILIYOR') DO NOTHING`;
}

/** Dağıtıcı tur commit olduktan SONRA çağırır: kuyruğa dürt girdiyse iş turu öne çekilir. */
export function onPatronPushQueued(count: number): void {
  if (count > 0) requestPatronPushRound();
}
