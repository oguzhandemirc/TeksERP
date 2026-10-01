// `latest-yml.mjs` tip bildirimi — çalışan kod bağımlılıksız JS (yayın kapısı zero-dep koşar); imzalar burada.
import type { KunyeResult } from "./kunye-jws.mjs";

export interface LatestYmlInfo {
  readonly version: string;
  readonly files: ReadonlyArray<Record<string, unknown>>;
  readonly path?: unknown;
  readonly sha512?: unknown;
  readonly releaseDate?: unknown;
  readonly tekserp: Record<string, unknown> | null;
}

export function parseLatestYml(text: unknown): KunyeResult<LatestYmlInfo>;
export function withReleaseBlock(text: string, token: string): string;
