import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { RecordHistoryDialog } from "@/components/RecordHistoryDialog";
import { useAuthStore } from "@/store/auth";
import { isSuperadminGateOpen } from "@/lib/superadmin-gate";
import {
  MODULE_FLAG_KEYS,
  MODULE_LABELS,
  MODULE_PLACEHOLDERS,
  type ModuleFlagKey,
} from "@/lib/module-flags";
import { FEATURE_FLAGS_QUERY_KEY, useEnabledLoginMethods } from "@/hooks/usePricingEnabled";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { featureFlagService } from "@/services/featureFlagService";
import { moduleProfileService, type ModuleProfileDiffRow } from "@/services/moduleProfileService";
import { screenCatalogService } from "@/services/screenCatalogService";
import { SETTINGS_CATEGORIES } from "@/pages/GeneralSettings/settings-config";
import { FeatureFlagSection } from "@/pages/GeneralSettings/FeatureFlagSection";
import { SettingsPasswordCard } from "@/pages/GeneralSettings/SettingsPasswordCard";
import {
  describeDiffRow,
  diffToFlagPatch,
  moduleRequires,
  modulesThatDependOn,
  screensHiddenByModule,
  settingKeyOfModule,
} from "./moduleProfile.helpers";

// =============================================================================
// MODÜLLER (Sistem Profili) — "bu kurulum hangi ürünü aldı"
// =============================================================================
// Satıcının (süperadmin) ekranı ve modül anahtarlarının TEK EVİ. 2026-09-04'te
// Genel Ayarlar → Modüller sekmesi KALDIRILDI (kullanıcı isteği: "modül
// flaglarını ayrı bir yere taşıyalım … modüller menüsü de sadece süperadmine
// gözüksün"); aynı turda kurulum beyanı (demo) ve ayar şifresi de buraya taşındı.
// Sayfa yalnız bir ayar yüzeyi değil KURULUM FOTOĞRAFIDIR: profil
// karşılaştırması, bağımlılık okları, "kapatırsan şu ekranlar gizlenir"
// önizlemesi ve tutarsızlık bantları.
//
// ⚠️ KAPI ARTIK ÜÇ KATMANLI ve KİMLİK KATMANI SUPAPLI: route `admin:settings`
// (karo ile birebir — `tile-route-permission.test`) + `requireSystemAccount`
// (`isSuperadminGateOpen`, yani supap DAHİL) + sayfa içi yazma kapısı.
// Süperadmin hesabı DOĞMUŞSA fabrika yöneticisi bu sayfayı hiç açamaz; hesap
// HİÇ DOĞMAMIŞSA açar ve yazar — yoksa o kurulumda modül anahtarlarına
// dokunacak hiçbir yüzey kalmazdı (ikinci yazma yolu bu turda kaldırıldı).
// Aşağıdaki `canWrite` salt-okunur bandı bu yüzden bugün yalnız teorik bir
// dal: kapıdan geçen herkes zaten yazabiliyor. Bant BİLEREK duruyor — kimlik
// kapısı bir gün gevşetilirse (ör. "fabrika salt-okunur görsün") sebebi
// ekranda yazılı olmalı.
//
// ⚠️ YAZMA YÜZEYİ GÖMÜLÜ, KOPYALANMADI: modül toggle'ları `FeatureFlagSection`
// ile çizilir (taslak + tek Kaydet + süperadmin bandı + ayar şifresi haberi
// hazır gelir) ve metinler `settings-config`in "Modüller" kategorisinden
// İTHAL EDİLİR. İkinci bir metin kümesi yazsaydık aynı anahtar iki ekranda
// başka türlü anlatılırdı.
//
// ⚠️ PROFİL UYGULAMA AYRI BİR UÇ DEĞİL: sunucunun hesapladığı fark tek bir
// `PATCH /api/feature-flags` gövdesine çevrilir. Ayrı bir `POST /apply`
// süperadmin dalını + bağımlılık doğrulamasını + ayar şifresi zincirini İKİNCİ
// kez kurardı (kapı çoğaltmak).
// =============================================================================

const MODULES_CATEGORY = SETTINGS_CATEGORIES.find((c) => c.id === "modules");
/**
 * "Demo" kategorisi de SATICI yüzeyine taşındı (2026-09-04 kullanıcı isteği:
 * "demo menüsü de sadece süperadmine gözüksün").
 *
 * Gerekçe zaten `settings-config`te yazılıydı: demo modu bir TERCİH değil,
 * kurulumun NE OLDUĞUNA dair bir BEYANDIR — yani modül anahtarlarıyla aynı
 * sınıftan bir cümle, fabrikanın davranış ayarı değil.
 */
const DEMO_CATEGORY = SETTINGS_CATEGORIES.find((c) => c.id === "demo");

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function ModuleProfilePage() {
  const qc = useQueryClient();
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  const systemAccountExists = useAuthStore((s) => s.systemAccountExists);
  const canWrite = isSuperadminGateOpen({ isSystemAccount, systemAccountExists });

  const profileQ = useQuery({
    queryKey: ["module-profile"],
    queryFn: moduleProfileService.get,
    staleTime: 60_000,
  });
  // ⚠️ FAIL-CLOSED: manifesto okunamazsa "hiçbir ekran gizlenmeyecek" demek
  // YALAN olurdu (`/api/admin/screens` `admin:users` ∨ `admin:settings` ister;
  // dar yetkili bir kullanıcıda 403 gelebilir). Hata durumunu ayrıca söylüyoruz.
  const screensQ = useQuery({
    queryKey: ["screen-catalog"],
    queryFn: screenCatalogService.list,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const screens = screensQ.data?.data?.screens ?? [];

  const state = profileQ.data?.data;
  const [pendingProfile, setPendingProfile] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  const applyMut = useMutation({
    mutationFn: async (rows: ModuleProfileDiffRow[]) => {
      const { patch, unknownKeys } = diffToFlagPatch(rows);
      if (unknownKeys.length > 0) {
        // Eksik uygulanmış profil, hiç uygulanmamıştan kötüdür: kullanıcı
        // bittiğini sanır. Panelin aynası bayatlamışsa gürültülü düş.
        throw new Error(
          `Bu sürüm şu modülleri tanımıyor: ${unknownKeys.join(", ")}. Paneli güncelleyin.`,
        );
      }
      if (Object.keys(patch).length === 0) return;
      await featureFlagService.update(patch);
    },
    onSuccess: () => {
      toast.success("Profil uygulandı.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: ["module-profile"] });
      setPendingProfile(null);
    },
    onError: (e: unknown) => {
      // apiClient kendi toast'ını basar; yalnız yerel doğrulama hatası burada.
      if (e instanceof Error && e.message.startsWith("Bu sürüm")) toast.error(e.message);
      setPendingProfile(null);
    },
  });

  const pendingRows = pendingProfile ? (state?.diffs[pendingProfile] ?? []) : [];
  const pendingProfileName =
    state?.profiles.find((p) => p.id === pendingProfile)?.ad ?? pendingProfile ?? "";

  // ── Tutarsızlık bantları ──────────────────────────────────────────────────
  const { warehouses, multiWarehouse } = useMultiWarehouse();
  const activeWarehouses = warehouses.filter((w) => w.isActive).length;
  const loginMethods = useEnabledLoginMethods();
  const warnings = useMemo(() => {
    const out: string[] = [];
    if (activeWarehouses > 1 && !multiWarehouse) {
      out.push(
        `${activeWarehouses} aktif depo tanımlı ama Çoklu Depo modülü kapalı — depo seçicileri, ` +
          "listelerdeki depo kolonu ve transfer ekranı çizilmiyor.",
      );
    }
    if (!loginMethods.includes("pin")) {
      out.push(
        "Giriş yöntemlerinde PIN kapalı — saha personeli tablete hızlı PIN ile giremez " +
          "(Genel Ayarlar → Oturum & Güvenlik).",
      );
    }
    return out;
  }, [activeWarehouses, multiWarehouse, loginMethods]);

  return (
    <PageShell>
      <PageHeader
        title="Modüller"
        actions={<RefreshButton queryKey={["module-profile"]} successMessage="Profil yenilendi" />}
      />
      <PageBody className="max-w-4xl space-y-8 p-6">
        {!canWrite && (
          <Callout tone="warning" title="Salt-okunur görünüm">
            Modül anahtarlarını yalnız sistem yöneticisi (satıcı hesabı) değiştirir. Bu sayfa size
            kurulumun hangi modülleri kullandığını gösterir; açma/kapatma talebiniz için yazılım
            firmanıza başvurun.
          </Callout>
        )}

        {warnings.map((w) => (
          <Callout key={w} tone="warning" title="Tutarsızlık">
            {w}
          </Callout>
        ))}

        {/* ── ① MODÜL ANAHTARLARI ──────────────────────────────────────── */}
        <Section
          title="Modüller"
          description={MODULES_CATEGORY?.description}
        >
          {MODULES_CATEGORY?.flags ? (
            <FeatureFlagSection flags={MODULES_CATEGORY.flags} superadminOnly />
          ) : null}

          {/* Yer tutucular — Genel Ayarlar'da BİLEREK yok ("açtım, hiçbir şey
              olmadı"), ama burası kurulumun TAM fotoğrafı: profil tablosunda
              yedi sütun varken beşini göstermek satıcıyı yanıltırdı. */}
          <div className="rounded-md border border-dashed p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Anahtarı olan ama henüz yüzeyi olmayan modüller
            </p>
            <div className="flex flex-wrap gap-2">
              {MODULE_PLACEHOLDERS.map((k) => (
                <Badge key={k} variant="muted">
                  {MODULE_LABELS[k]} · yüzeyi yok
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Bu anahtarlar profillerde taşınır ve kurulumda yazılır, ama arkalarında henüz ekran
              yok — açmak bugün hiçbir şeyi değiştirmez.
            </p>
          </div>
        </Section>

        {/* ── ② BAĞIMLILIK + KAPATMA ETKİSİ ─────────────────────────────── */}
        <Section
          title="Bağımlılıklar ve kapatma etkisi"
          description="Hangi modül hangisine bağlı ve kapatınca hangi ekranlar çizilmez."
        >
          {screensQ.isError && (
            <Callout tone="warning" title="Ekran listesi okunamadı">
              “Kapatırsan gizlenir” önizlemesi çizilemiyor. Boş liste göstermek “hiçbir şey
              gizlenmeyecek” anlamına gelirdi — bu yüzden hiç gösterilmiyor.
            </Callout>
          )}
          <div className="space-y-2">
            {MODULE_FLAG_KEYS.map((key: ModuleFlagKey) => {
              const requires = moduleRequires(key);
              const dependents = modulesThatDependOn(key);
              const hidden = screensQ.isError ? null : screensHiddenByModule(screens, key);
              return (
                <div key={key} className="rounded-md border p-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{MODULE_LABELS[key]}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => setHistoryKey(key)}
                    >
                      <History className="h-3.5 w-3.5" /> Geçmiş
                    </Button>
                  </div>
                  {requires && (
                    <p className="mt-1 text-muted-foreground">
                      Açılabilmesi için önce <strong>{MODULE_LABELS[requires]}</strong> açık olmalı.
                    </p>
                  )}
                  {dependents.length > 0 && (
                    <p className="mt-1 text-muted-foreground">
                      Kapatılırsa birlikte kapanır:{" "}
                      <strong>{dependents.map((d) => MODULE_LABELS[d]).join(", ")}</strong>
                    </p>
                  )}
                  {hidden === null ? null : hidden.desktop.length + hidden.mobile.length > 0 ? (
                    <>
                      {hidden.desktop.length > 0 && (
                        <p className="mt-1 text-muted-foreground">
                          Kapatılırsa gizlenen masaüstü ekranları ({hidden.desktop.length}):{" "}
                          {hidden.desktop.join(" · ")}
                        </p>
                      )}
                      {hidden.mobile.length > 0 && (
                        <p className="mt-1 text-muted-foreground">
                          Kapatılırsa <strong>tablette duran</strong> ekranlar (
                          {hidden.mobile.length}): {hidden.mobile.join(" · ")}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-muted-foreground">
                      Bu modüle bağlı bir ekran beyan edilmemiş.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── ③ KURULUM PROFİLLERİ ──────────────────────────────────────── */}
        <Section
          title="Kurulum profilleri"
          description="Müşterinin satın aldığı ürüne göre hazır anahtar setleri. Fark sunucuda hesaplanır."
        >
          {profileQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : profileQ.isError || !state ? (
            <Callout tone="warning" title="Profiller okunamadı">
              Sunucudan profil listesi alınamadı; sayfayı yenilemeyi deneyin.
            </Callout>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Bu kurulum:{" "}
                <strong>
                  {state.current.closest === "ozel"
                    ? "Özel (hiçbir profille tam eşleşmiyor)"
                    : (state.profiles.find((p) => p.id === state.current.closest)?.ad ??
                      state.current.closest)}
                </strong>
                {state.current.appliedProfile ? (
                  <>
                    {" "}
                    · kurulumda uygulanan profil: <strong>{String(state.current.appliedProfile)}</strong>{" "}
                    <span className="text-muted-foreground/80">
                      (doğuş damgası — bugünkü durumu söylemez)
                    </span>
                  </>
                ) : null}
              </p>
              <div className="space-y-2">
                {state.profiles.map((p) => {
                  const rows = state.diffs[p.id] ?? [];
                  return (
                    <div key={p.id} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{p.ad}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{p.aciklama}</p>
                        </div>
                        {rows.length === 0 ? (
                          <Badge variant="secondary">Uygulanmış</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canWrite || applyMut.isPending}
                            onClick={() => setPendingProfile(p.id)}
                          >
                            {applyMut.isPending && pendingProfile === p.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Uygula ({rows.length} değişiklik)
                          </Button>
                        )}
                      </div>
                      {rows.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                          {rows.map((r) => (
                            <li key={r.key}>· {describeDiffRow(r)}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Section>

        {/* ── ④ KURULUM BEYANI (demo) ───────────────────────────────────── */}
        {DEMO_CATEGORY?.flags ? (
          <Section title={DEMO_CATEGORY.label} description={DEMO_CATEGORY.description}>
            {/* ⚠️ `superadminOnly` BİLEREK YOK: o bayrak bir KİLİT iddiasıdır ve
                backend `flagWriteGuard`ın süperadmin dalı YALNIZ modül
                anahtarlarını kapsar (`MODULE_FLAG_KEYS`) — `demoModeEnabled`
                onda değil. Kilit çizseydik panel, sunucuda olmayan bir kapıyı
                varmış gibi anlatırdı. Demo'yu fabrikadan uzak tutan şey bu
                SAYFANIN kimlik kapısıdır. */}
            <FeatureFlagSection flags={DEMO_CATEGORY.flags} />
          </Section>
        ) : null}

        {/* ── ⑤ AYAR ŞİFRESİ ────────────────────────────────────────────── */}
        {/* Kart kendi kimlik kapısını uygular (backend uçları başka kimlikte 404
            döner); Genel Ayarlar → Modüller sekmesiyle birlikte buraya taşındı. */}
        <SettingsPasswordCard />
      </PageBody>

      {/* Onay — "N kayıt etkilenecek" gibi SOYUT bir sayı yetmez; her satır
          adıyla ve iki yönüyle listelenir (yıkıcı işlem onayı kuralı). */}
      <Dialog open={pendingProfile !== null} onOpenChange={(o) => !o && setPendingProfile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>“{pendingProfileName}” profili uygulansın mı?</DialogTitle>
            <DialogDescription>
              Aşağıdaki modül anahtarları değişecek. Veri silinmez; yalnız yüzeyler ve backend
              kapıları açılıp kapanır.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 space-y-1 overflow-auto text-sm">
            {pendingRows.map((r) => (
              <li key={r.key} className="rounded border px-2 py-1">
                {describeDiffRow(r)}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingProfile(null)}>
              Vazgeç
            </Button>
            <Button
              disabled={applyMut.isPending}
              onClick={() => applyMut.mutate(pendingRows)}
            >
              {applyMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Uygula
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Değişiklik geçmişi — YENİ UÇ GEREKMEZ: her bayrak yazımı
          `SYSTEM_SETTING` tablosuna `recordId = <ayar anahtarı>` ile düşüyor. */}
      {historyKey && (
        <RecordHistoryDialog
          open
          onOpenChange={(o) => !o && setHistoryKey(null)}
          table="SYSTEM_SETTING"
          id={settingKeyOfModule(historyKey as ModuleFlagKey) ?? historyKey}
          title={`${MODULE_LABELS[historyKey as ModuleFlagKey]} modülü`}
        />
      )}
    </PageShell>
  );
}
