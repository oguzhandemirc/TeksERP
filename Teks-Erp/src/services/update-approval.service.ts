// =============================================================================
// GÜNCELLEME ONAYI (Dağıtım v2 — docs/design/GUNCELLEYICI.md §3 madde 2 · §5.1)
// =============================================================================
// Panelin kararı: "Şimdi kur" (HEMEN) · "Bu gece kur" (PENCERE — kiradaki sıradaki aralıkta) · "Onayı geri al"
// (GERI_AL — kurulum politikaya/pencereye kalır). Onay YETKİ DEĞİLDİR: yalnız güncelleyicinin imzalı bildirimden
// doğruladığı adayın zamanlamasını seçer; DONDUR · K1 · kira yok hâlinde verilemez ve güncelleyici onu yalnız AYNI
// sürümün imzalı adayına sayar. Karar eklemeli satırdır (`update_approvals`; yeni karar yeni satır, yürürlükteki
// en son satır) ve niyet dosyasına `onayId` ile gider. İzin kapısı `license:manage` (route).
// =============================================================================
import { randomUUID } from "node:crypto";
import { z } from "zod";
import prisma from "../lib/prisma";
import { ReleaseVersionSchema } from "../lib/license/protocol";
import { requestDownloadTokenRefresh } from "../lib/license/runtime";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { refreshUpdaterIntent, type IntentRefreshResult } from "./update-intent.service";
import { getUpdateStatus, type UpdateStatus } from "./update-status.service";
import { UPDATE_APPROVAL_CHOICES, type UpdateApprovalChoice } from "./helpers/update-approval-rules.helper";

const NAME_MAX = 200;

export const RecordUpdateApprovalSchema = z.strictObject({
  clientToken: z.uuid("İşlem kimliği geçersiz"),
  surum: z
    .string("Sürüm gerekli")
    .max(40, "Sürüm biçimi geçersiz")
    .refine((v) => ReleaseVersionSchema.safeParse(v).success, "Sürüm biçimi geçersiz (x.y.z)"),
  zamanlama: z.enum(UPDATE_APPROVAL_CHOICES, "Zamanlama HEMEN, PENCERE ya da GERI_AL olmalı"),
});
export type RecordUpdateApprovalInput = z.infer<typeof RecordUpdateApprovalSchema>;

export interface UpdateApprovalResult {
  /** Kararın kaydı (`update_approvals.id`) — HEMEN/PENCERE'de niyetin `onayId`si. */
  readonly kayitId: string;
  /** Niyet dosyası bu kararla yazıldı mı; yazılamadıysa kod (bir sonraki yoklama yeniden dener). */
  readonly niyet: { readonly yazildi: boolean; readonly kod: string | null };
  readonly durum: UpdateStatus;
}

/** Niyete giden ad: tek satır, kırpılmış, en çok 200 (güncelleyicinin tavanı). */
export function approverDisplayName(fullName: string | null | undefined): string {
  const name = (fullName ?? "").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  return name || "Kullanıcı";
}

function intentOutcome(r: IntentRefreshResult): UpdateApprovalResult["niyet"] {
  if (r.kind === "ok") return { yazildi: true, kod: null };
  return { yazildi: false, kod: r.kind === "error" ? r.code : "NIYET_ATLANDI" };
}

/** Karar bugünkü duruma uyuyor mu — panel düğmeleriyle AYNI yüklem (`approvalActions`). */
export function assertApprovalAllowed(status: UpdateStatus, input: Pick<RecordUpdateApprovalInput, "surum" | "zamanlama">): void {
  const e = status.eylemler;
  if (input.zamanlama === "GERI_AL") {
    if (!e.geriAl || !status.onay) {
      throw AppError.conflict(e.neden ?? "Geri alınacak bir onay yok.", { code: "UPDATE_APPROVAL_NOT_ALLOWED" });
    }
    if (status.onay.surum !== input.surum) {
      throw AppError.conflict(`Yürürlükteki onay ${status.onay.surum} için; ekranı yenileyin.`, {
        code: "UPDATE_APPROVAL_VERSION_CHANGED",
        hedefSurum: status.onay.surum,
      });
    }
    return;
  }
  const allowed = input.zamanlama === "HEMEN" ? e.hemen : e.pencere;
  if (e.hedefSurum !== null && e.hedefSurum !== input.surum) {
    throw AppError.conflict(`Kurulacak sürüm değişti (şu an ${e.hedefSurum}); ekranı yenileyin.`, {
      code: "UPDATE_APPROVAL_VERSION_CHANGED",
      hedefSurum: e.hedefSurum,
    });
  }
  if (!allowed || e.hedefSurum === null) {
    const already = status.onay && !status.onay.kullanildi && status.onay.surum === input.surum && status.onay.zamanlama === input.zamanlama;
    const reason = already
      ? `${input.surum} için bu onay zaten verildi.`
      : input.zamanlama === "PENCERE" && e.hemen
        ? "Kirada sıradaki güncelleme penceresi yok; yalnız \"Şimdi kur\" verilebilir."
        : (e.neden ?? "Bu onay şu an verilemez.");
    throw AppError.conflict(reason, { code: "UPDATE_APPROVAL_NOT_ALLOWED" });
  }
}

async function respondFor(kayitId: string): Promise<UpdateApprovalResult> {
  const r = await refreshUpdaterIntent();
  return { kayitId, niyet: intentOutcome(r), durum: await getUpdateStatus() };
}

function replayFor(input: RecordUpdateApprovalInput, userId: string) {
  return tokenReplay<{ id: string; version: string; choice: string; approvedById: string }, UpdateApprovalResult>({
    find: (db, clientToken) =>
      db.updateApproval.findUnique({ where: { clientToken }, select: { id: true, version: true, choice: true, approvedById: true } }),
    alive: { neverDies: "onay satırı silinmez ve değişmez; geri alma da yeni bir satırdır" },
    identity: (p) => [
      { ad: "surum", mevcut: p.version, gelen: input.surum },
      { ad: "zamanlama", mevcut: p.choice, gelen: input.zamanlama },
      { ad: "onaylayan", mevcut: p.approvedById, gelen: userId },
    ],
    collision: "Bu işlem kimliği başka bir güncelleme kararına ait; ekranı yenileyip yeniden deneyin.",
    respond: (p) => respondFor(p.id),
  });
}

export async function recordUpdateApproval(g: { userId: string; input: RecordUpdateApprovalInput }): Promise<UpdateApprovalResult> {
  const { input, userId } = g;
  return replayFor(input, userId).run(input.clientToken, async () => {
    const status = await getUpdateStatus();
    assertApprovalAllowed(status, input);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    if (!user) throw AppError.unauthorized("Oturum gerekli.");
    const id = randomUUID();
    const choice: UpdateApprovalChoice = input.zamanlama;
    await prisma.updateApproval.create({
      data: {
        id,
        clientToken: input.clientToken,
        version: input.surum,
        choice,
        policyMode: status.politika?.kip ?? null,
        approvedById: userId,
        approverName: approverDisplayName(user.fullName),
      },
    });
    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "UPDATE_APPROVAL",
      recordId: id,
      newData: { surum: input.surum, zamanlama: choice, kip: status.politika?.kip ?? null },
    });
    // Onay var ama elde backend belirteci yoksa güncelleyici indiremez: yoklamayı dürt (kısıtlı; yeni belirteç niyete yazılır).
    if (choice !== "GERI_AL" && !status.indirmeBelirteci) requestDownloadTokenRefresh();
    return respondFor(id);
  });
}
