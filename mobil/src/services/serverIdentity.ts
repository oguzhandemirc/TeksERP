/**
 * Sunucu kimliğinin bu tablete sabitlenmesi.
 *
 * ⚠️ SABİTLEME ANI = İLK BAŞARILI GİRİŞ, keşif anı DEĞİL. Bir sunucuyu prob
 * etmek onun doğru sunucu olduğunun beyanı değildir — ağdaki herhangi bir makine
 * proba cevap verebilir. Ama bir insan oraya kullanıcı adı ve PIN'iyle GİRDİYSE,
 * "evet bu benim sunucum" demiş olur. Koruma böylece gerçek bir insan kararına
 * dayanır.
 *
 * ⚠️ Kimliği OLMAYAN sunucuda hiçbir şey sabitlenmez (eski backend / boot'ta DB'si
 * hazır olmayan sunucu). Eski bir sürümü sahtekârlıkla suçlamak, uyarıyı
 * yanlış-pozitif üretir hale getirir.
 *
 * ⚠️ VAR OLAN KİMLİK EZİLMEZ. Sabitleme YALNIZ boşken yapılır: aksi halde
 * operatör yanlış sunucuya bir kez girdiğinde koruma o sunucuyu "doğru" ilan
 * eder ve bir daha asla uyarmaz.
 */
import { getPinnedInstallationId, setPinnedInstallationId, getCurrentBaseUrl } from '../store/baseUrlStore';
import { probeServer } from './discovery.service';

/** `http://host:port[/api]` → parçalar. */
function splitUrl(url: string): { host: string; port: number } | null {
  const m = /^https?:\/\/([^:/\s]+)(?::(\d+))?/i.exec((url ?? '').trim());
  if (!m || !m[1]) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : 4000 };
}

/** Giriş başarılı olduktan sonra çağrılır. Best-effort — hatası girişi ETKİLEMEZ. */
export async function pinServerIdentityAfterLogin(): Promise<void> {
  try {
    const already = await getPinnedInstallationId();
    if (already) return; // var olanı EZME (yukarıdaki nota bak)
    const parts = splitUrl(getCurrentBaseUrl());
    if (!parts) return;
    const found = await probeServer(parts.host, parts.port, null, 2500);
    const id = found?.identity?.installationId;
    if (!id) return; // kimlik yok → sabitleme YOK
    await setPinnedInstallationId(id);
  } catch {
    /* sessiz geç — sabitleme bir kolaylık, giriş yolunu düşüremez */
  }
}
