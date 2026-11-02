// =============================================================================
// SİSTEM → BİLDİRİM PROFİLLERİ (plan §6.5; yönetici, `settings:notifications ∨ admin:settings`)
// =============================================================================
// Sol: profil listesi (+ arşivlenenler süzgeci). Sağ: Matris · Üyeler · Fabrika varsayılanı. Profil yalnız
// TERCİH setidir, izin VERMEZ; katman önceliği sunucudadır (`resolvePreference`), ekran yalnız gösterir/yazar.
// Eski sunucu (404) ve kapalı bayrak (409 `BILDIRIM_KAPALI`) sessiz durum kartına düşer.
// =============================================================================
import { useMemo, useState } from "react";
import { TERIM_AD } from "@/lib/terim";
import { useQuery } from "@tanstack/react-query";
import { Archive, BellRing, Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { ListToolbar } from "@/components/layout/ListPage";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { httpStatusOf, notificationErrorCode } from "@/services/bildirimService";
import { bildirimProfilService, type NotificationProfile } from "@/services/bildirimProfilService";
import { cn } from "@/lib/utils";
import { ArchiveProfileDialog } from "./ArchiveProfileDialog";
import { FactoryDefaultsTab } from "./FactoryDefaultsTab";
import { ProfileFormDialog } from "./ProfileFormDialog";
import { ProfileMatrixTab } from "./ProfileMatrixTab";
import { ProfileMembersTab } from "./ProfileMembersTab";
import { factoryKey, PROFILES_QUERY_ROOT, profilesKey } from "./queries";

/** Uç yoksa (eski sunucu) ya da gelen kutusu kapalıysa sayfa sessiz durum kartı gösterir. */
export function unavailableReason(e: unknown): string | null {
  if (httpStatusOf(e) === 404) return "Bu sunucu sürümü bildirim profillerini desteklemiyor — sunucu güncellenince açılır.";
  if (notificationErrorCode(e) === "BILDIRIM_KAPALI") return "Bildirimler kapalı — Genel Ayarlar → Bildirimler'den “Yeni bildirim gelen kutusu” açılınca kullanılabilir.";
  return null;
}

function ProfileListItem({ p, active, onClick }: { p: NotificationProfile; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted", active && "bg-primary/10 font-medium")}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{p.ad}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {p.kod} · {p.uyeler.length} üye{p.arsivlendi ? " · arşivli" : ""}
        </span>
      </span>
    </button>
  );
}

/** Matris dışındaki sekmeler (üyeler, fabrika varsayılanı) form gövdesidir: dolgulu, kendi kaydırıcısı. */
const TAB_PAD = "mt-0 min-h-0 flex-1 overflow-auto p-4 md:p-6";

export function NotificationProfilesPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState("matris");
  const [form, setForm] = useState<{ profile: NotificationProfile | null } | null>(null);
  const [archiving, setArchiving] = useState<NotificationProfile | null>(null);

  const list = useQuery({ queryKey: profilesKey(showArchived), queryFn: () => bildirimProfilService.liste(showArchived), retry: false });
  const factory = useQuery({ queryKey: factoryKey, queryFn: () => bildirimProfilService.fabrikaVarsayilani(), retry: false });
  const profiles = useMemo(() => list.data?.items ?? [], [list.data]);
  const selected = profiles.find((p) => p.id === selectedId) ?? profiles.find((p) => !p.arsivlendi) ?? profiles[0] ?? null;
  const kinds = factory.data?.turler ?? [];
  const blocked = unavailableReason(list.error) ?? unavailableReason(factory.error);
  // Profilsiz kurulumda yalnız fabrika varsayılanı anlamlıdır; pasif sekme seçili kalmasın.
  const activeTab = !selected && !list.isLoading ? "fabrika" : tab;

  return (
    <PageShell>
      <PageHeader
        title={TERIM_AD.bildirimProfilleri}
        description="Yöneticinin kişilere atadığı hazır bildirim tercih setleri ve fabrika varsayılanı. Profil izin vermez."
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton queryKey={[...PROFILES_QUERY_ROOT]} />
            {!blocked && (
              <Button onClick={() => setForm({ profile: null })}>
                <Plus className="mr-1.5 h-4 w-4" /> Yeni profil
              </Button>
            )}
          </div>
        }
      />
      {blocked ? (
        <PageBody className="p-4 md:p-6">
          <EmptyState icon={BellRing} title="Bildirim profilleri kullanılamıyor" description={blocked} />
        </PageBody>
      ) : (
        // Liste standardı: solda profil listesi (kendi kaydırıcısı), sağda sabit bant (başlık + sekmeler) → kenardan kenara matris.
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <ProfileListPanel
            loading={list.isLoading}
            profiles={profiles}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            showArchived={showArchived}
            onShowArchived={setShowArchived}
          />
          <Tabs value={activeTab} onValueChange={setTab} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ListToolbar>
              {selected && <SelectedHeader p={selected} onRename={() => setForm({ profile: selected })} onArchive={() => setArchiving(selected)} />}
              <TabsList className="flex-wrap self-start">
                <TabsTrigger value="matris" disabled={!selected}>Matris</TabsTrigger>
                <TabsTrigger value="uyeler" disabled={!selected}>Üyeler</TabsTrigger>
                <TabsTrigger value="fabrika">Fabrika varsayılanı</TabsTrigger>
              </TabsList>
            </ListToolbar>
            <TabsContent value="matris" className="mt-0 flex min-h-0 flex-1 flex-col">
              {selected ? <ProfileMatrixTab profile={selected} kinds={kinds} /> : <NoProfile />}
            </TabsContent>
            <TabsContent value="uyeler" className={TAB_PAD}>
              {selected ? <ProfileMembersTab profile={selected} /> : <NoProfile />}
            </TabsContent>
            <TabsContent value="fabrika" className={TAB_PAD}>
              {factory.isLoading ? <Skeleton className="h-40 w-full" /> : <FactoryDefaultsTab kinds={kinds} />}
            </TabsContent>
          </Tabs>
        </div>
      )}
      <ProfileFormDialog
        open={form !== null}
        onOpenChange={(o) => !o && setForm(null)}
        profile={form?.profile ?? null}
        onSaved={(p) => {
          setSelectedId(p.id);
          setTab("matris");
        }}
      />
      <ArchiveProfileDialog profile={archiving} onOpenChange={(o) => !o && setArchiving(null)} />
    </PageShell>
  );
}

function NoProfile() {
  return <EmptyState icon={BellRing} title="Profil seçilmedi" description="Listeden bir profil seçin ya da “Yeni profil” oluşturun." />;
}

interface ListPanelProps {
  loading: boolean;
  profiles: readonly NotificationProfile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showArchived: boolean;
  onShowArchived: (v: boolean) => void;
}

function ProfileListPanel({ loading, profiles, selectedId, onSelect, showArchived, onShowArchived }: ListPanelProps) {
  return (
    <aside className="max-h-60 shrink-0 space-y-2 overflow-y-auto border-b p-2 lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r" aria-label="Profiller">
      <div>
        {loading && <Skeleton className="h-24 w-full" />}
        {!loading && profiles.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Henüz profil yok. “Yeni profil” ile başlayın; fabrika varsayılanı profilsiz de çalışır.
          </p>
        )}
        {profiles.map((p) => (
          <ProfileListItem key={p.id} p={p} active={p.id === selectedId} onClick={() => onSelect(p.id)} />
        ))}
      </div>
      <label className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
        <Checkbox checked={showArchived} onCheckedChange={(v) => onShowArchived(v === true)} aria-label="Arşivlenenler" />
        Arşivlenenler
      </label>
    </aside>
  );
}

function SelectedHeader({ p, onRename, onArchive }: { p: NotificationProfile; onRename: () => void; onArchive: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-base font-semibold">{p.ad}</h2>
      <span className="text-sm text-muted-foreground">{p.kod}</span>
      {p.arsivlendi ? (
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">Arşivli</span>
      ) : (
        <span className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => onRename()}>
            <Pencil className="mr-1 h-4 w-4" /> Yeniden adlandır
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onArchive()}>
            <Archive className="mr-1 h-4 w-4" /> Arşivle
          </Button>
        </span>
      )}
    </div>
  );
}
