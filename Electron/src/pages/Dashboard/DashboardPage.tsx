import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/store/auth";

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Anasayfa" description={`Hoş geldin, ${user?.username ?? ""}.`} />
      <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Açık Sipariş", value: "—" },
          { label: "Açık İş Emri", value: "—" },
          { label: "Sevke Hazır Top", value: "—" },
          { label: "Bugünkü Sevkiyat", value: "—" },
        ].map((m) => (
          <Card key={m.label}>
            <CardHeader>
              <CardTitle className="text-xs font-medium text-muted-foreground">{m.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{m.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="px-6 pb-6 text-xs text-muted-foreground">
        Özet kartlar ve grafikler ileri aşamada gerçek üretim verisine bağlanacak.
      </div>
    </div>
  );
}
