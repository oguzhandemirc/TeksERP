// Kayıt kalıbı — TAM KAYIT SAYFASI iskeleti: kimlik şeridi (avatar + ad + rozet + alt satır + eylemler),
// sayı kartları şeridi, sekmeler, tek kaydırıcı gövde. Geri/üst sayfa PageHeader'dan (sekme derinlik defteri).
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface RecordTab {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** Sekme yanında küçük sayı (yalnız hazırsa). */
  count?: number | null;
}

export interface RecordPageShellProps {
  parent: { label: string; to: string };
  title: string;
  avatar?: ReactNode;
  /** Ad yanında rol/durum rozetleri. */
  badges?: ReactNode;
  /** Ad altında tek satır (kod · şehir · telefon). */
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Sayı kartları — boşsa şerit çizilmez. */
  stats?: ReactNode[];
  tabs: RecordTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  /** Etkin sekmenin içeriği. */
  children: ReactNode;
}

export function RecordPageShell({ parent, title, avatar, badges, subtitle, actions, stats, tabs, activeTab, onTabChange, children }: RecordPageShellProps) {
  const shownStats = (stats ?? []).filter(Boolean);
  const current = tabs.some((t) => t.key === activeTab) ? activeTab : (tabs[0]?.key ?? "");
  return (
    <PageShell>
      <PageHeader
        parent={parent}
        pageFavorite={false}
        title={
          <span className="flex items-center gap-3">
            {avatar}
            <span className="min-w-0 break-words">{title}</span>
          </span>
        }
        titleExtra={badges}
        statusLine={subtitle}
        actions={actions}
      />
      <PageBody className="px-4 pb-[var(--space-page)] md:px-[var(--space-page)]">
        {shownStats.length > 0 && (
          <div data-record-stats="" className="mb-[var(--space-section)] grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-[var(--space-gap)]">
            {shownStats}
          </div>
        )}
        <Tabs value={current} onValueChange={onTabChange}>
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            {tabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                {t.icon && <t.icon className="h-3.5 w-3.5" aria-hidden />}
                {t.label}
                {t.count != null && t.count > 0 && <span className="rounded-badge bg-muted px-1.5 text-[10.5px] font-semibold tabular-nums text-muted-foreground">{t.count}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={current} className="mt-4">
            {children}
          </TabsContent>
        </Tabs>
      </PageBody>
    </PageShell>
  );
}
