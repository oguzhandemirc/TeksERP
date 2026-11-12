import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageTabsList, PageTabsTrigger } from "@/components/layout/PageTabs";
import { LabelTemplatesPage } from "@/pages/LabelTemplates/LabelTemplatesPage";
import { LabelAssignmentsPage } from "@/pages/Labels/LabelAssignmentsPage";
import { StandalonePrintPage } from "@/pages/Labels/StandalonePrintPage";
import { resolveEtiketTab } from "@/pages/Labels/tabs-config";

/**
 * Etiketler — tek başlık + içerikte iki sekme (çift PageHeader sorunu giderildi).
 * Eski "Yazıcı Modelleri" ve "Boyutlar" kalktı (yazıcı dili + medya boyutu artık
 * doğrudan yazıcı cihazında — Etiket Stüdyosu v2). Kalan 2 kavram:
 *   - Düzenler  = hangi alan nerede / uzman kod — LabelTemplate (TEK HAVUZ)
 *   - Atamalar  = bağlam başına varsayılan şablon — LabelContextDefault
 * Alt sayfalar `hideHeader` ile kendi PageHeader'larını basmaz → tek başlık kalır.
 */
export function EtiketlerPage() {
  // Aktif sekme URL'de (?tab=) — düzenle→kaydet sonrası doğru sekmeye (Düzenler) dönülür.
  const [sp, setSp] = useSearchParams();
  // Alt sayfaların Yenile/+Yeni butonları başlığa PORTAL'lanır (yıldızın sağına) —
  // ref-callback state'i: element mount olunca alt sayfalara geçer.
  const [actionsEl, setActionsEl] = useState<HTMLDivElement | null>(null);
  // Sekme anahtarları `tabs-config.ts`te — komut paleti aynı listeden derin
  // bağlantı üretiyor (kopyalanırsa palet olmayan bir sekmeye götürür).
  const tab = resolveEtiketTab(sp.get("tab"));
  const setTab = (v: string) => {
    const n = new URLSearchParams(sp);
    n.set("tab", v);
    setSp(n, { replace: true });
  };

  return (
    <PageShell>
      <PageHeader
        title="Etiketler"
        actions={<div ref={setActionsEl} className="flex items-center gap-2" />}
      />
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <PageTabsList>
          <PageTabsTrigger value="templates">Düzenler</PageTabsTrigger>
          <PageTabsTrigger value="assignments">Atamalar</PageTabsTrigger>
          <PageTabsTrigger value="freeprint">Serbest Baskı</PageTabsTrigger>
        </PageTabsList>
        <TabsContent value="templates" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <LabelTemplatesPage hideHeader actionsPortal={actionsEl} />
        </TabsContent>
        <TabsContent value="assignments" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <LabelAssignmentsPage hideHeader actionsPortal={actionsEl} />
        </TabsContent>
        <TabsContent value="freeprint" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <StandalonePrintPage hideHeader actionsPortal={actionsEl} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
