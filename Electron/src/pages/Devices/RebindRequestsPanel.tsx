import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/services/apiClient";
import { safeFormat } from "@/lib/format";
import { deviceService } from "./service";
import { deviceKindLabel } from "./DeviceRow";
import type { DeviceListItem, RebindRequest } from "./types";
import { REBIND_QUERY_KEY, openRebindRequests, useRebindRequests } from "./rebind";

type Mode = "approve" | "separate" | "reject";

export const REBIND_CONFLICT_MESSAGE = "Talep başka biri tarafından işlendi, liste yenilendi";

const MODE_TEXT: Record<Mode, { title: string; confirm: string; effect: string }> = {
  approve: {
    title: "Yeniden bağlamayı onayla",
    confirm: "Onayla ve bağla",
    effect:
      "Yeni kurulum bu kayda bağlanır; yeni cihaz kaydı açılmaz. Makine ataması ve donanım bağları korunur. Eski kurulumun oturum sırrı geçersiz olur.",
  },
  separate: {
    title: "Ayrı cihaz olarak kaydet",
    confirm: "Ayrı cihaz olarak kaydet",
    effect:
      "Aşağıdaki kayıt DEĞİŞMEZ. Yeni kurulum için ayrı bir cihaz kaydı açılır (kopyalanmış disk imajı gibi durumlar için).",
  },
  reject: {
    title: "Talebi reddet",
    confirm: "Reddet",
    effect: "Yeni kurulum kayıt almaz ve çalışamaz. Aşağıdaki kayıt değişmez.",
  },
};

function isConflict(e: unknown): boolean {
  return (e as { response?: { status?: number } } | undefined)?.response?.status === 409;
}

/**
 * Cihazlar sayfası üst bölümü: kayıtlı bir cihazla AYNI DONANIMDAN gelen yeni kurulumlar
 * (uygulama yeniden kurulmuş / veri silinmiş). Otomatik birleştirme yok — yönetici karar verir.
 */
export function RebindRequestsPanel({ devices }: { devices: DeviceListItem[] }) {
  const qc = useQueryClient();
  const query = useRebindRequests();
  const [target, setTarget] = useState<{ req: RebindRequest; mode: Mode } | null>(null);
  const [reason, setReason] = useState("");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: [REBIND_QUERY_KEY] });
    void qc.invalidateQueries({ queryKey: ["admin-devices"] });
  };

  const decide = useMutation({
    mutationFn: ({ req, mode }: { req: RebindRequest; mode: Mode }) =>
      mode === "approve"
        ? deviceService.approveRebind(req.id)
        : deviceService.rejectRebind(req.id, {
            mode: mode === "separate" ? "AYRI_CIHAZ" : "REDDET",
            ...(mode === "reject" && reason.trim() ? { reason: reason.trim() } : {}),
          }),
    onSuccess: (_d, { req, mode }) => {
      toast.success(
        mode === "approve"
          ? `Yeni kurulum "${req.target.name}" kaydına bağlandı`
          : mode === "separate"
            ? "Ayrı cihaz kaydı açıldı"
            : "Talep reddedildi",
      );
      setTarget(null);
      refresh();
    },
    onError: (e) => {
      if (isConflict(e)) {
        // eslint-disable-next-line yerel/mutation-onerror-toast -- istek suppressErrorToast taşır; 409 kendi Türkçe mesajı
        toast.error(REBIND_CONFLICT_MESSAGE);
        setTarget(null);
      } else {
        // eslint-disable-next-line yerel/mutation-onerror-toast -- istek suppressErrorToast taşır; tek toast burası
        toast.error(apiErrorMessage(e, "İşlem yapılamadı"));
      }
      refresh();
    },
  });

  const open = openRebindRequests(query.data);
  if (open.length === 0) return null;

  return (
    <section
      aria-label="Yeniden bağlama talepleri"
      className="rounded-md border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/30"
    >
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Yeniden bağlama talepleri ({open.length})
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Bu kurulumlar kayıtlı bir cihazla aynı donanımdan geliyor (uygulama yeniden kurulmuş olabilir). Onaylarsanız yeni
        kurulum eski kayda bağlanır, ayrı kayıt açılmaz.
      </p>
      <ul className="divide-y divide-amber-200 dark:divide-amber-900/60">
        {open.map((r) => (
          <RebindRow key={r.id} req={r} onPick={(mode) => { if (mode === "reject") setReason(""); setTarget({ req: r, mode }); }} />
        ))}
      </ul>

      <RebindDecisionDialog
        target={target}
        device={target ? devices.find((d) => d.id === target.req.target.id) : undefined}
        reason={reason}
        onReason={setReason}
        pending={decide.isPending}
        onClose={() => setTarget(null)}
        onConfirm={() => { if (target) decide.mutate(target); }}
      />
    </section>
  );
}

function RebindRow({ req: r, onPick }: { req: RebindRequest; onPick: (mode: Mode) => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2" data-testid="rebind-row">
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{r.model?.trim() || `${deviceKindLabel(r.kind)} (model bilinmiyor)`}</span>
        <span className="text-muted-foreground"> · {safeFormat(r.updatedAt, "dd.MM HH:mm")} · </span>
        <span>
          "{r.target.name}" ile <strong>AYNI DONANIM</strong>
        </span>
        <span className="text-muted-foreground">
          {" "}
          (son görülme {safeFormat(r.target.lastSeenAt, "dd.MM HH:mm")}
          {r.target.isActive ? "" : " · kayıt pasif"})
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button size="sm" onClick={() => onPick("approve")}>
          <Link2 className="mr-1 h-3.5 w-3.5" />
          Onayla
        </Button>
        <Button size="sm" variant="outline" onClick={() => onPick("separate")}>
          Ayrı cihazdır
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive dark:text-red-400" onClick={() => onPick("reject")}>
          Reddet
        </Button>
      </div>
    </li>
  );
}

interface DialogProps {
  target: { req: RebindRequest; mode: Mode } | null;
  device: DeviceListItem | undefined;
  reason: string;
  onReason: (v: string) => void;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** Yıkıcı karar diyaloğu: etkilenen kaydı (hedef, makine, donanım bağları) listeler. */
function RebindDecisionDialog({ target, device, reason, onReason, pending, onClose, onConfirm }: DialogProps) {
  const hardware = device?.hardwareLinks ?? [];
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      {target && (
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{MODE_TEXT[target.mode].title}</DialogTitle>
            <DialogDescription>{MODE_TEXT[target.mode].effect}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border bg-muted/40 p-3 text-sm">
            <dt className="text-muted-foreground">Yeni kurulum</dt>
            <dd>{target.req.model?.trim() || deviceKindLabel(target.req.kind)} · {safeFormat(target.req.updatedAt, "dd.MM.yyyy HH:mm")}</dd>
            <dt className="text-muted-foreground">Hedef cihaz</dt>
            <dd>
              {target.req.target.name} ({deviceKindLabel(target.req.target.kind)}
              {target.req.target.isActive ? "" : ", pasif"})
            </dd>
            <dt className="text-muted-foreground">Son görülme</dt>
            <dd>{safeFormat(target.req.target.lastSeenAt, "dd.MM.yyyy HH:mm")}</dd>
            <dt className="text-muted-foreground">Makine ataması</dt>
            <dd>{target.req.target.machine ? `${target.req.target.machine.name} (${target.req.target.machine.code})` : "Yok"}</dd>
            <dt className="text-muted-foreground">Donanım bağları</dt>
            <dd>{hardware.length === 0 ? "Yok" : hardware.map((h) => `${h.peripheral.name} (${h.peripheral.code})`).join(", ")}</dd>
          </dl>
          {target.mode === "reject" && (
            <div className="space-y-1">
              <label htmlFor="rebind-reason" className="text-sm font-medium">
                Gerekçe (isteğe bağlı)
              </label>
              <Textarea
                id="rebind-reason"
                value={reason}
                maxLength={300}
                onChange={(e) => onReason(e.target.value)}
                placeholder="Örn. tanımadığımız bir bilgisayar"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={onClose}>
              Vazgeç
            </Button>
            <Button variant={target.mode === "reject" ? "destructive" : "default"} disabled={pending} onClick={onConfirm}>
              {MODE_TEXT[target.mode].confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
