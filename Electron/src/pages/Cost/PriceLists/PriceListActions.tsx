// Liste eylemleri: Taslak → Yayınla (onay modalı, aynı müşteri+dövizde yayındaki listeyi ADIYLA söyler — o liste
// arşive düşer) · Yayında → Arşivle · Yayında/Arşivde → Revizyon (yeni taslak sürüm, `clientToken`). Taslakta
// "Standart maliyetten doldur" (kâr oranı + kur; boş = parametre/önerilen kur).
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useAttemptToken } from "@/lib/attemptToken";
import { EMPTY_PRICE_LIST_FILTER, priceListLabel, type PriceListDetail } from "./pl-types";
import { buildFillBody, priceListService, type FillForm } from "./service";
import { usePriceListMutation } from "./usePriceListMutation";

type Modal = "publish" | "archive" | "fill" | null;

export function PriceListActions({ list, dirtyLines }: { list: PriceListDetail; dirtyLines?: boolean }) {
  const nav = useNavigate();
  const { hasPermission } = useRoleAccess();
  const attempt = useAttemptToken();
  const [modal, setModal] = useState<Modal>(null);
  const close = () => setModal(null);
  const publish = usePriceListMutation({ listId: list.id, fn: () => priceListService.publish(list.id), onDone: close });
  const archive = usePriceListMutation({ listId: list.id, fn: () => priceListService.archive(list.id), onDone: close });
  const revise = usePriceListMutation({
    listId: list.id,
    fn: () => priceListService.revise(list.id, attempt.token()),
    onDone: (r) => { attempt.onSuccess(); void nav(`/cost/price-lists/${r.data.id}`); },
    onFail: (e) => attempt.onFailure(e),
  });
  if (!hasPermission("price-list:write")) return null;
  const busy = publish.isPending || archive.isPending || revise.isPending;
  return (
    <div className="flex flex-wrap gap-2" data-testid="pl-actions">
      {list.status === "DRAFT" && (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setModal("fill")}>Standart maliyetten doldur</Button>
          <Button size="sm" disabled={busy || list.lines.length === 0 || dirtyLines} onClick={() => setModal("publish")} title={dirtyLines ? "Önce satırları kaydedin" : undefined}>Yayınla</Button>
        </>
      )}
      {list.status === "PUBLISHED" && <Button size="sm" variant="outline" disabled={busy} onClick={() => setModal("archive")}>Arşivle</Button>}
      {list.status !== "DRAFT" && <Button size="sm" variant="outline" disabled={busy} onClick={() => revise.mutate()}>Revizyon oluştur</Button>}
      {modal === "publish" && <PublishDialog list={list} busy={publish.isPending} onCancel={close} onConfirm={() => publish.mutate()} />}
      {modal === "archive" && (
        <Confirm title="Listeyi arşivle" body="Arşivdeki liste fiyat önerisinde kullanılmaz. Gerekirse revizyonla yeniden yayınlanır." busy={archive.isPending} label="Arşivle" onCancel={close} onConfirm={() => archive.mutate()} />
      )}
      {modal === "fill" && <FillDialog list={list} onClose={close} />}
    </div>
  );
}

function Confirm({ title, body, busy, label, onCancel, onConfirm, children }: { title: string; body: string; busy: boolean; label: string; onCancel: () => void; onConfirm: () => void; children?: ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Vazgeç</Button>
          <Button disabled={busy} onClick={onConfirm} data-testid="pl-confirm">{busy ? "İşleniyor…" : label}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Aynı kapsam (müşteri ya da genel) + dövizde yayındaki liste — yayınlanınca arşive düşer; adıyla söylenir. */
function PublishDialog({ list, busy, onCancel, onConfirm }: { list: PriceListDetail; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const current = useQuery({
    queryKey: ["price-lists", "list", "published-peer", list.customerId, list.currency],
    queryFn: () =>
      priceListService.list(
        { ...EMPTY_PRICE_LIST_FILTER, status: "PUBLISHED", currency: list.currency, scope: list.customerId ? "customer" : "genel", customerId: list.customerId },
        null,
        5,
      ),
  });
  const peers = (current.data?.data ?? []).filter((p) => p.id !== list.id);
  return (
    <Confirm
      title="Listeyi yayınla"
      body={`${list.customer ? list.customer.name : "Genel"} · ${list.currency} — yayınlanan liste değişmez; teklif fiyat önerisi bu listeden okunur.`}
      busy={busy || current.isLoading}
      label="Yayınla"
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {current.isLoading ? (
        <p className="text-sm text-muted-foreground">Yayındaki liste denetleniyor…</p>
      ) : peers.length > 0 ? (
        <p className="rounded-md border border-warning/50 bg-warning/5 p-2 text-sm" role="note" data-testid="pl-publish-peer">
          Şu an yayında olan <strong>{peers.map((p) => `${priceListLabel(p)} — ${p.name}`).join(", ")}</strong> arşive alınacak.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="pl-publish-nopeer">Bu kapsam ve dövizde yayında başka liste yok.</p>
      )}
    </Confirm>
  );
}

function FillDialog({ list, onClose }: { list: PriceListDetail; onClose: () => void }) {
  const [f, setF] = useState<FillForm>({ markupPct: "", fxRate: "" });
  const fill = usePriceListMutation({ listId: list.id, fn: () => priceListService.fill(list.id, buildFillBody(f, list.currency)), onDone: onClose });
  return (
    <Confirm
      title="Standart maliyetten doldur"
      body="Yürürlükteki standart maliyeti olan her kumaş için satır yazılır (renksiz satır güncellenir, renkli satırlar korunur). Fiyat sunucuda maliyet + kâr ve kurla hesaplanır."
      busy={fill.isPending}
      label="Doldur"
      onCancel={onClose}
      onConfirm={() => fill.mutate()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted-foreground">Kâr oranı % (boş = parametre)</span>
          <Input className="mt-1" inputMode="decimal" value={f.markupPct} onChange={(e) => setF({ ...f, markupPct: e.target.value })} aria-label="Kâr oranı" />
        </label>
        {list.currency !== "TRY" && (
          <label className="block text-sm">
            <span className="text-muted-foreground">{list.currency} kuru (boş = önerilen)</span>
            <Input className="mt-1" inputMode="decimal" value={f.fxRate} onChange={(e) => setF({ ...f, fxRate: e.target.value })} aria-label="Kur" />
          </label>
        )}
      </div>
    </Confirm>
  );
}
