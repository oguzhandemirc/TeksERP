import { Link, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isForbiddenByModule } from "@/lib/route-modules";

export function ForbiddenPage() {
  // Modül kapısından gelindiyse sebep yetki değil kurulumdur — kullanıcı yetkisini aramasın.
  const moduleClosed = isForbiddenByModule(useLocation().state);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <ShieldAlert className="h-10 w-10 text-muted-foreground" />
      <div>
        <h1 className="text-lg font-semibold">{moduleClosed ? "Modül kapalı" : "Erişim engellendi"}</h1>
        <p className="text-sm text-muted-foreground">
          {moduleClosed ? "Bu sayfanın modülü bu kurulumda kapalı." : "Bu sayfaya erişim yetkin yok."}
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Dashboard'a dön</Link>
      </Button>
    </div>
  );
}
