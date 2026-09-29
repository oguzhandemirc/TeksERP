// GİDEN DOSYA YÜKLEME (bizden müşteriye) — sunucunun parçalı oturum sözleşmesi: önce bütün + parça
// özetleri (tek okuma), sonra oturum (işlem kimliği DENEME başına: aynı dosya yeniden seçilirse aynı
// oturum SÜRER, alınan parçalar atlanır), eksik parçalar ham PUT'la (X-Parca-Sha256), en son tamamla.
import { ApiError, NETWORK_ERROR_CODE, type ApiClient } from "../../shared/api";
import { Sha256 } from "./sha256";
import type { UploadSession } from "./types";

/** Ham parça ucu (JSON tablosu dışında; aynı oturum + izin kapısı — sunucu `distribution-raw.ts`). */
export const partUrl = (sessionId: string, index: number): string => `/portal/api/ham/giden-oturum/${sessionId}/parca/${index}`;
/** Gövde indirme ucu (portal; saklama süresi dolmuşsa 410). */
export const fileBodyUrl = (fileId: string): string => `/portal/api/ham/dosyalar/${fileId}`;

export interface FileLike {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  slice(start: number, end: number): Blob;
}

export interface Digests {
  readonly whole: string;
  readonly parts: readonly string[];
}

/** Parça boyutu sunucunun tavanı (oturum yanıtı) olmadan bilinemez; özet parça sınırından bağımsız hesaplanır. */
export async function digestFile(file: FileLike, partBytes: number, onProgress?: (done: number, total: number) => void): Promise<Digests> {
  const whole = new Sha256();
  const parts: string[] = [];
  const n = Math.max(1, Math.ceil(file.size / partBytes));
  for (let i = 0; i < n; i++) {
    const buf = new Uint8Array(await file.slice(i * partBytes, Math.min(file.size, (i + 1) * partBytes)).arrayBuffer());
    whole.update(buf);
    parts.push(new Sha256().update(buf).hex());
    onProgress?.(i + 1, n);
  }
  return { whole: whole.hex(), parts };
}

async function putPart(fetchImpl: typeof fetch, url: string, blob: Blob, sha: string): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream", "X-Parca-Sha256": sha }, body: blob });
  } catch {
    throw new ApiError(0, NETWORK_ERROR_CODE, "Sunucuya ulaşılamadı; aynı dosyayı yeniden seçince kaldığı yerden sürer");
  }
  if (res.ok) return;
  let body: { message?: string; details?: { code?: string } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    body = {};
  }
  throw new ApiError(res.status, body.details?.code ?? "BILINMEYEN", body.message ?? `Parça gönderilemedi (${res.status})`);
}

export interface OutgoingUpload {
  readonly api: ApiClient;
  readonly customerId: string;
  readonly file: FileLike;
  readonly clientToken: string;
  /** Sunucunun parça tavanı (PARCA_AZAMI_MB) — ilk oturum yanıtından; bilinmiyorsa 50 MB. */
  readonly partBytes?: number;
  readonly fetchImpl?: typeof fetch;
  readonly onProgress?: (text: string) => void;
}

export async function uploadOutgoing(u: OutgoingUpload): Promise<{ dosyaId: string }> {
  const doFetch = u.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const partBytes = u.partBytes ?? 50 * 1024 * 1024;
  const d = await digestFile(u.file, partBytes, (i, n) => u.onProgress?.(`Özet hesaplanıyor… ${i}/${n}`));
  const s = await u.api.post<UploadSession>("/dagitim/giden-oturum", {
    clientToken: u.clientToken,
    musteriId: u.customerId,
    dosyaAdi: u.file.name,
    boyut: u.file.size,
    sha256: d.whole,
    mime: u.file.type || undefined,
  });
  if (s.parcaBayt !== partBytes) return uploadOutgoing({ ...u, partBytes: s.parcaBayt });
  const have = new Set(s.alinanlar);
  for (let i = 0; i < s.parcaSayisi; i++) {
    if (have.has(i)) continue;
    await putPart(doFetch, partUrl(s.oturumId, i), u.file.slice(i * s.parcaBayt, Math.min(u.file.size, (i + 1) * s.parcaBayt)), d.parts[i]!);
    u.onProgress?.(`Yükleniyor… ${i + 1}/${s.parcaSayisi}`);
  }
  return u.api.post<{ dosyaId: string }>(`/dagitim/giden-oturum/${s.oturumId}/tamamla`, {});
}
