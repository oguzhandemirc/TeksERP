// =============================================================================
// NİYET YAZICISI (Dağıtım v2 — docs/design/GUNCELLEYICI.md §5.1) — `niyet\niyet.json`un TEK yazarı
// =============================================================================
// Niyet iki girdiden doğar: kiranın yoklamasıyla gelen backend İNDİRME belirteci (önek platformun dizini: Windows
// `/<kanal>/backend/`, Linux/OCI `/<kanal>/backend-oci/` — `backendDownloadPrefix`; ≤ 70 dk ömür,
// yoklama saatlik — her kabul edilen yoklamada tazelenir) + yürürlükteki panel ONAYI. İkisi aynı dosyadadır:
// yazım tek yerden, süreç içinde SIRALI ve her seferinde iki girdinin BUGÜNKÜ hâlinden kurulur (iki yazım birbirini
// ezemez). Niyet yetki DEĞİLDİR: yalnız sürüm + kimlik seçer; yol, komut, adres, dosya adı taşımaz
// (`UpdaterIntentSchema` KATI). K1'de (güncelleme donuk) belirteç yazılmaz, eskisi de korunmaz.
// =============================================================================
import { isVerificationMode } from "../lib/dogrulama-kipi";
import { getDownloadTokens, getLicenseSnapshot } from "../lib/license/runtime";
import { WINDOWS_PLATFORM, backendDownloadPrefix, msToIso, type UpdatePlatform } from "../lib/license/protocol";
import {
  ownUpdatePlatform,
  readUpdaterIntent,
  resolveUpdaterDir,
  writeUpdaterIntent,
  type IntentWriteResult,
  type UpdaterIntent,
} from "../lib/license/updater-ipc";
import { decideDownloadToken } from "./license-view.service";
import { activeUpdateApproval } from "./update-status.service";
import type { UpdateApprovalView } from "./helpers/update-approval-rules.helper";
import { uyari } from "../lib/logger";

export type IntentRefreshResult = IntentWriteResult | { readonly kind: "skipped"; readonly reason: string };
type IntentToken = NonNullable<UpdaterIntent["indirme"]>;

/** Saf: iki girdiden niyet belgesi. */
export function composeIntent(g: {
  readonly token: IntentToken | null;
  readonly approval: Omit<UpdateApprovalView, "kullanildi"> | null;
  readonly nowMs: number;
}): UpdaterIntent {
  const a = g.approval;
  return {
    v: 1,
    yazildi: msToIso(g.nowMs),
    indirme: g.token ? { belirtec: g.token.belirtec, bitis: g.token.bitis } : null,
    onay: a ? { onayId: a.onayId, surum: a.surum, zamanlama: a.zamanlama, kullaniciId: a.onaylayan.id, ad: a.onaylayan.ad, zaman: a.zaman } : null,
  };
}

/**
 * Yazılacak belirteç: bellekteki, bu backend'in platformunun önekindeki belirteç; yoksa (yeniden başlatma sonrası ilk
 * yoklamadan önce) niyette duran ve süresi geçmemiş olan korunur. Güncelleme donuksa (K1) hiçbiri.
 */
export function intentToken(g: {
  readonly updatesAllowed: boolean;
  readonly kanal: string | null;
  readonly tokens: ReadonlyArray<{ yolOneki: string; belirtec: string }>;
  readonly kept: UpdaterIntent | null;
  readonly nowMs: number;
  readonly platform?: UpdatePlatform;
}): IntentToken | null {
  const prefix = g.kanal ? backendDownloadPrefix(g.kanal, g.platform ?? WINDOWS_PLATFORM) : null;
  const d = decideDownloadToken({ updatesAllowed: g.updatesAllowed, prefix, tokens: g.tokens, nowMs: g.nowMs });
  if (d.kind === "frozen") return null;
  if (d.kind === "ok" && d.token.gecerlilikSonu) return { belirtec: d.token.belirtec, bitis: d.token.gecerlilikSonu };
  const kept = g.kept?.indirme ?? null;
  return kept && Date.parse(kept.bitis) > g.nowMs ? kept : null;
}

async function refreshOnce(nowMs: number): Promise<IntentRefreshResult> {
  if (isVerificationMode()) return { kind: "skipped", reason: "doğrulama kipi — niyet yazılmaz" };
  const { dir, invalid } = resolveUpdaterDir();
  if (!dir) return { kind: "skipped", reason: invalid ? "güncelleyici kökü mutlak değil" : "güncelleyici yok" };
  const snap = getLicenseSnapshot(nowMs);
  const token = intentToken({
    updatesAllowed: snap.state.uygulanan.guncellemeIzni,
    kanal: snap.lease?.document.kanal.kod ?? null,
    tokens: getDownloadTokens(),
    kept: readUpdaterIntent(dir),
    nowMs,
    platform: ownUpdatePlatform(),
  });
  const approval = await activeUpdateApproval();
  return writeUpdaterIntent(dir, composeIntent({ token, approval, nowMs }));
}

let tail: Promise<unknown> = Promise.resolve();

/**
 * Kabul edilen kira yanıtından sonra (yeni indirme belirteci) — best-effort: yazılamazsa kira kabulü DÜŞMEZ,
 * güncelleyici `BELIRTEC_*` ile bekler ve bir sonraki yoklama yeniden dener.
 */
export function refreshUpdaterIntentQuietly(): void {
  void refreshUpdaterIntent().then(
    (r) => {
      if (r.kind === "error") uyari("guncelleme", `niyet yazılamadı (${r.code}): ${r.reason}`);
    },
    (err: unknown) => uyari("guncelleme", "niyet yazılamadı", err instanceof Error ? err.message : err),
  );
}

/** Niyeti iki girdinin bugünkü hâlinden yeniden yazar; çağrılar sıraya girer (aynı süreçte eşzamanlı yazım yok). */
export function refreshUpdaterIntent(nowMs?: number): Promise<IntentRefreshResult> {
  const run = tail.then(
    () => refreshOnce(nowMs ?? Date.now()),
    () => refreshOnce(nowMs ?? Date.now()),
  );
  tail = run.catch(() => undefined);
  return run;
}
