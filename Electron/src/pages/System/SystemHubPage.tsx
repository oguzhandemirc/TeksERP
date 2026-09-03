import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useAuthStore } from "@/store/auth";
import { isSuperadminGateOpen } from "@/lib/superadmin-gate";
import { systemTiles, systemTileSections } from "./tile-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

export function SystemHubPage() {
  const { isAdmin, hasPermission } = useRoleAccess();
  // ⚠️ ÜÇÜNCÜ KAPI: KİMLİK. Yüklem `lib/superadmin-gate.ts`ten gelir — kural üç
  // tüketicide (bu hub · `FeatureFlagSection` · Sistem Profili sayfası) ayrı
  // ayrı yazılsaydı supap (`!systemAccountExists`) birinde unutulur ve
  // süperadminsiz kurulum modüllerini bir daha yapılandıramazdı.
  //
  // ⚠️ Kimlik cevabı gelene kadar `isSystemAccount` FALSE'tır (fail-closed) →
  // karo satıcıda kısa bir gecikmeyle BELİRİR. Ters varsayım fabrikaya bir an
  // için satıcı karosunu gösterirdi; gecikme kabul edildi.
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  const systemAccountExists = useAuthStore((s) => s.systemAccountExists);
  const superadminGateOpen = isSuperadminGateOpen({ isSystemAccount, systemAccountExists });
  // Karo ile route AYNI kapıyı kullanır: `permission` taşıyan karo yalnız o izne
  // sahip kullanıcıya görünür, yoksa varsayılan `admin:settings` kapısı geçerli
  // (Sistem hub'ı zaten onun arkasında). Ayrışırsa kart görünür ama sayfa açılmaz.
  const visibleTiles = systemTiles.filter((t) => {
    if (t.superadminOnly && !superadminGateOpen) return false;
    if (t.adminOnly && !isAdmin) return false;
    if (t.permission) return hasPermission(t.permission);
    return true;
  });

  return (
    <PageShell>
      <PageHeader title="Sistem" />
      <PageBody className="space-y-8 p-6">
        {systemTileSections.map((section) => {
          const tiles = visibleTiles.filter((t) => t.group === section.group);
          if (tiles.length === 0) return null;
          return (
            <section key={section.group}>
              <div className="mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground/80">
                  {section.description}
                </p>
              </div>
              <HubGrid>
                {tiles.map((tile, i) => (
                  <HubCard
                    key={tile.key}
                    to={tile.to}
                    title={tile.title}
                    description={tile.description}
                    icon={tile.icon}
                    index={i}
                  />
                ))}
              </HubGrid>
            </section>
          );
        })}
      </PageBody>
    </PageShell>
  );
}
