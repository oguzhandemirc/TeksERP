import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { AlertOctagon, RefreshCw, Home, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorTime: string | null;
}

export function ErrorFallbackUI({ error, errorTime }: { error: Error; errorTime: string | null }) {
  const [showDetails, setShowDetails] = useState(import.meta.env.DEV);
  const [copied, setCopied] = useState(false);
  const isDev = import.meta.env.DEV;

  const handleReload = () => window.location.reload();

  const handleHome = () => {
    window.location.hash = "/";
    window.location.reload();
  };

  const handleCopy = async () => {
    const text = `${error.message}\n\n${error.stack ?? ""}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="app-viewport flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <span className="text-lg font-bold tracking-tight">TeksERP</span>
        <span className="text-xs text-muted-foreground">Yönetim Paneli</span>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
          <AlertOctagon className="h-10 w-10 text-destructive" />
        </div>

        <div className="max-w-md space-y-2">
          <h1 className="text-2xl font-bold">Beklenmeyen Hata Oluştu</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Uygulama beklenmedik bir sorunla karşılaştı. Sayfayı yenileyerek devam
            edebilir ya da ana sayfaya dönebilirsiniz.
          </p>
        </div>

        <div className="flex gap-3">
          <Button onClick={handleReload} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Sayfayı Yenile
          </Button>
          <Button variant="outline" onClick={handleHome} className="gap-2">
            <Home className="h-4 w-4" />
            Ana Sayfaya Dön
          </Button>
        </div>

        {/* Error accordion */}
        <div className="w-full max-w-xl">
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="flex w-full items-center justify-between rounded-md border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <span>Hata Detayı</span>
            {showDetails ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {showDetails && (
            <div className="mt-1 rounded-md border bg-muted/50 p-3 text-left">
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-destructive">{error.message}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 shrink-0 gap-1 px-2 text-xs"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copied ? "Kopyalandı" : "Kopyala"}
                </Button>
              </div>
              {isDev && error.stack && (
                <pre className="overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">
                  {error.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {errorTime && (
        <div className="border-t px-6 py-3 text-center">
          <p className="text-xs text-muted-foreground">Hata Zamanı: {errorTime}</p>
        </div>
      )}
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorTime: null };

  static getDerivedStateFromError(error: Error): State {
    return {
      error,
      errorTime: new Date().toLocaleTimeString("tr-TR"),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    const { error, errorTime } = this.state;
    if (!error) return this.props.children;
    return <ErrorFallbackUI error={error} errorTime={errorTime} />;
  }
}
