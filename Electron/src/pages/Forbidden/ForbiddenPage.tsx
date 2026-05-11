import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ForbiddenPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <ShieldAlert className="h-10 w-10 text-muted-foreground" />
      <div>
        <h1 className="text-lg font-semibold">Erişim engellendi</h1>
        <p className="text-sm text-muted-foreground">Bu sayfaya erişim yetkin yok.</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Dashboard'a dön</Link>
      </Button>
    </div>
  );
}
