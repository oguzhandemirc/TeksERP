import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Uygulama geneli hata sınırı. Production'da beyaz ekran yerine anlamlı bir
 * hata mesajı + yenile butonu gösterir. Development'ta ayrıca hata detayını
 * ekranda basar (React overlay'e ek olarak).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private reload = () => window.location.reload();

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isDev = import.meta.env.DEV;

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Beklenmeyen bir hata oluştu</h1>
          <p className="text-sm text-muted-foreground">
            Uygulama beklenmedik bir hatayla karşılaştı. Sayfayı yenileyerek tekrar deneyin.
          </p>
        </div>
        {isDev && (
          <pre className="max-w-xl overflow-auto rounded-md border bg-muted/50 p-3 text-left text-[11px] text-destructive">
            {error.message}
            {"\n"}
            {error.stack}
          </pre>
        )}
        <Button variant="outline" size="sm" onClick={this.reload} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Sayfayı Yenile
        </Button>
      </div>
    );
  }
}
