// Üyeler sekmesi: tablo + "Üye ekle" (çoklu kişi seçici MODAL) + çıkar; "Kaydet" tam listeyi PUT eder.
// Profil izin VERMEZ — üye, izni olmayan türü yine almaz (matristeki uyarı satırı).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { actionErrorMessage } from "@/pages/Operations/LoomAlarms/useLoomAlarmActions";
import { bildirimProfilService, type NotificationProfile } from "@/services/bildirimProfilService";
import { candidatesKey, PROFILES_QUERY_ROOT } from "./queries";
import { UserPickerDialog } from "./UserPickerDialog";

export function ProfileMembersTab({ profile }: { profile: NotificationProfile }) {
  const qc = useQueryClient();
  const readOnly = profile.arsivlendi !== null;
  const base = useMemo(() => profile.uyeler.map((u) => u.userId), [profile.uyeler]);
  const [ids, setIds] = useState<string[]>(base);
  useEffect(() => setIds(base), [base]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const candidates = useQuery({ queryKey: candidatesKey, queryFn: () => bildirimProfilService.adaylar(), enabled: !readOnly, staleTime: 60_000 });
  const names = useMemo(() => {
    const m = new Map(profile.uyeler.map((u) => [u.userId, u.ad]));
    for (const c of candidates.data?.items ?? []) if (!m.has(c.id)) m.set(c.id, c.ad);
    return m;
  }, [profile.uyeler, candidates.data]);
  const dirty = ids.length !== base.length || ids.some((u, i) => u !== base[i]);

  const save = useMutation({
    mutationFn: () => bildirimProfilService.uyeleriYaz(profile.id, ids),
    onSuccess: () => {
      toast.success("Üyeler kaydedildi.");
      void qc.invalidateQueries({ queryKey: PROFILES_QUERY_ROOT });
    },
    // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır: sunucu cümlesi TEK toast
    onError: (e) => toast.error(actionErrorMessage(e)),
  });

  const rows = [...ids].sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? "", "tr"));
  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} disabled={candidates.isLoading}>
            <UserPlus className="mr-1.5 h-4 w-4" /> Üye ekle
          </Button>
          <span className="text-xs text-muted-foreground">{ids.length} üye</span>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={Users} title="Bu profilin üyesi yok" description={readOnly ? "Arşivli profil." : "“Üye ekle” ile kişi seçin; profil üyelerine tercih seti olarak uygulanır."} />
      ) : (
        <ul className="divide-y rounded-md border" aria-label="Profil üyeleri">
          {rows.map((u) => (
            <li key={u} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{names.get(u) ?? "—"}</span>
              {!readOnly && (
                <Button variant="ghost" size="sm" aria-label={`${names.get(u) ?? ""} çıkar`} onClick={() => setIds((s) => s.filter((x) => x !== u))}>
                  <UserMinus className="mr-1 h-4 w-4" /> Çıkar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="flex items-center justify-end gap-2">
          {dirty && <span className="mr-auto text-xs text-muted-foreground">Kaydedilmemiş değişiklik var.</span>}
          {dirty && <Button variant="outline" onClick={() => setIds(base)}>Geri al</Button>}
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Kaydet</Button>
        </div>
      )}
      <UserPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Profile üye ekle"
        candidates={candidates.data?.items ?? []}
        exclude={new Set(ids)}
        onConfirm={(add) => setIds((s) => [...s, ...add.filter((a) => !s.includes(a))])}
      />
    </div>
  );
}
