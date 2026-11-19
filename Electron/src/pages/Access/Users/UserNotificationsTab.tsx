// Kişi kartı → Bildirimler (`settings:notifications ∨ admin:settings`): kişinin hangi türü hangi kanaldan, NEDEN
// aldığı + yöneticinin kişi adına uygulama içi aç/kapa. Liste ve görünürlük sunucudan; kişinin göremediği tür
// gerekçesiyle pasif (sunucu da 400 ile reddeder). Değişiklik anında kaydedilir ve audit'e düşer.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Lock, Search, ServerCrash } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { foldedIncludes } from "@/lib/search-fold";
import { actionErrorMessage } from "@/pages/Operations/LoomAlarms/useLoomAlarmActions";
import { NOTIFICATION_GROUP_ORDER } from "@/pages/Notifications/group-order";
import { bildirimProfilService, type UserPrefInput, type UserPrefKind } from "@/services/bildirimProfilService";
import { httpStatusOf, notificationErrorCode } from "@/services/bildirimService";
import { UserNotificationRow } from "./UserNotificationRow";

export const userPrefKey = (userId: string) => ["bildirim", "kisi-tercihleri", userId] as const;

function groups(kinds: UserPrefKind[]) {
  return NOTIFICATION_GROUP_ORDER.map((g) => ({ grup: g as string, turler: kinds.filter((k) => k.grup === g) })).filter((g) => g.turler.length > 0);
}

export function UserNotificationsTab({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [ara, setAra] = useState("");
  const q = useQuery({ queryKey: userPrefKey(userId), queryFn: () => bildirimProfilService.kisiTercihleri(userId), retry: false });
  const save = useMutation({
    mutationFn: (items: UserPrefInput[]) => bildirimProfilService.kisiTercihleriYaz(userId, items),
    onSuccess: (d) => {
      qc.setQueryData(userPrefKey(userId), d);
      toast.success("Kişinin bildirim tercihi kaydedildi.");
    },
    onError: (e) => {
      // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır: sunucu cümlesi TEK toast
      toast.error(actionErrorMessage(e));
      void q.refetch();
    },
  });
  const all = useMemo(() => (q.data?.turler ?? []).filter((k) => foldedIncludes(`${k.ad} ${k.grup}`, ara)), [q.data, ara]);
  const visible = useMemo(() => groups(all.filter((k) => k.gorur)), [all]);
  const hidden = all.filter((k) => !k.gorur);

  if (q.isError) {
    const moduleOff = notificationErrorCode(q.error) === "BILDIRIM_KAPALI";
    return moduleOff
      ? <EmptyState icon={BellOff} title="Bildirimler kapalı" description="Bildirim gelen kutusu bu fabrikada açık değil; Genel Ayarlar'dan açılır." />
      : <EmptyState icon={ServerCrash} title={httpStatusOf(q.error) === 404 ? "Sunucu bu ekranı henüz desteklemiyor" : "Tercihler okunamadı"} description="Sunucu güncellendiğinde ya da bağlantı gelince yeniden deneyin." />;
  }
  if (q.isLoading || !q.data) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  const d = q.data;
  const row = (k: UserPrefKind) => (
    <UserNotificationRow
      key={k.tur}
      k={k}
      pending={save.isPending}
      onToggle={(acik) => save.mutate([{ tur: k.tur, kanal: "UYGULAMA", acik }])}
      onReset={() => save.mutate([{ tur: k.tur, kanal: "UYGULAMA", acik: null }])}
    />
  );
  return (
    <div className="space-y-4" data-testid="kisi-bildirimler">
      <div className="space-y-1.5 rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
        <p>
          <span className="text-muted-foreground">Bildirim profilleri: </span>
          {d.profiller.length === 0 ? "yok (fabrika ve görev varsayılanı)" : d.profiller.map((p) => `${p.ad}${p.tercihKilidi ? " (tercih kilidi)" : ""}`).join(", ")}
        </p>
        {d.tercihKilidi.kilitli && (
          <p className="flex items-center gap-1.5 text-amber-800 dark:text-amber-200">
            <Lock className="h-3.5 w-3.5" aria-hidden /> Kişi kendi uygulama içi tercihlerini değiştiremez; değişikliği buradan siz yaparsınız.
          </p>
        )}
        {(!d.kullanici.aktif || d.kullanici.sistemHesabi) && (
          <p className="text-muted-foreground">{d.kullanici.sistemHesabi ? "Sistem hesabı bildirim almaz." : "Kullanıcı pasif; bildirim almaz."}</p>
        )}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Tür ara…" aria-label="Bildirim türü ara" className="pl-8" />
      </div>
      {visible.map((g) => (
        <section key={g.grup} aria-label={g.grup}>
          <h3 className="border-b border-border pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.grup}</h3>
          <ul className="divide-y divide-border/60">{g.turler.map(row)}</ul>
        </section>
      ))}
      {hidden.length > 0 && (
        <details className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-sm text-muted-foreground">Kişinin göremediği türler ({hidden.length}) — açılamaz</summary>
          <ul className="divide-y divide-border/60">{hidden.map(row)}</ul>
        </details>
      )}
      {visible.length === 0 && hidden.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Aramanıza uyan bildirim türü yok.</p>}
    </div>
  );
}
