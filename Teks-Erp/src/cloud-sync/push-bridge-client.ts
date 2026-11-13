// Push köprüsü istemcisi (fabrika → bulut, amaç `bildir`) — yalnız TEL: gövdeyi kurar, imzalı boğazdan (`cloudPost`)
// geçirir, yanıtı katı şemayla okur. Ön koşul (`pushBridgeEligibility`) ve durum makinesi çağıranda (`patron-push.job`).
// Sözleşme `docs/design/PATRON-PUSH-KOPRUSU.md` §2–§4; gövde gzip'siz (bulut sıkıştırılmış gövdeyi 400'ler).
import { cloudPost, type CloudCallContext } from "./cloud-client";
import {
  ENVELOPE_VERSION,
  PUSH_BRIDGE_MAX_TOKENS,
  PUSH_BRIDGE_PATHS,
  PushRegisterResponseSchema,
  PushReleaseResponseSchema,
} from "./wire";

export type BridgeResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly status: number; readonly code: string };

function assertBatch(digests: readonly string[]): void {
  // Programcı hatası: iş partiyi zaten kırpar; tavanı aşan istek bulutta 400 olurdu.
  if (digests.length < 1 || digests.length > PUSH_BRIDGE_MAX_TOKENS) throw new Error(`köprü partisi 1–${PUSH_BRIDGE_MAX_TOKENS} özet olmalı`);
}

/** `POST /v1/bildirim/kaydet` — bağı kurar/tazeler; dönen `bagli` bağlanan özetlerdir. */
export async function registerDigests(ctx: CloudCallContext, digests: readonly string[]): Promise<BridgeResult<{ bagli: string[] }>> {
  assertBatch(digests);
  const r = await cloudPost(ctx, PUSH_BRIDGE_PATHS.REGISTER, { v: ENVELOPE_VERSION, ozetler: digests }, { gzip: false });
  if (!r.ok) return r;
  const parsed = PushRegisterResponseSchema.safeParse(r.json);
  return parsed.success ? { ok: true, value: { bagli: parsed.data.bagli } } : { ok: false, status: 200, code: "YANIT_GECERSIZ" };
}

/** `POST /v1/bildirim/birak` — bağı siler; olmayan özet hata değildir. */
export async function releaseDigests(ctx: CloudCallContext, digests: readonly string[]): Promise<BridgeResult<{ birakilan: number }>> {
  assertBatch(digests);
  const r = await cloudPost(ctx, PUSH_BRIDGE_PATHS.RELEASE, { v: ENVELOPE_VERSION, ozetler: digests }, { gzip: false });
  if (!r.ok) return r;
  const parsed = PushReleaseResponseSchema.safeParse(r.json);
  return parsed.success ? { ok: true, value: { birakilan: parsed.data.birakilan } } : { ok: false, status: 200, code: "YANIT_GECERSIZ" };
}
