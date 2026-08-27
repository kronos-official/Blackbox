import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";
import { dashboardDirection, normalizeDashboardLocale } from "@/lib/dashboardI18n";
import { dashboardSystemCopy } from "@/lib/dashboardSystemI18n";
import { safeStorageGet } from "@/lib/safeStorage";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const locale = typeof window === "undefined" ? "fa" : normalizeDashboardLocale(safeStorageGet("local", "kronos-dashboard-locale"));
      const copy = dashboardSystemCopy();
      return (
        <div dir={dashboardDirection(locale)} lang={locale} className="flex min-h-[100dvh] items-center justify-center bg-[#050913] p-8 text-slate-100">
          <div className="flex w-full max-w-2xl flex-col items-center rounded-3xl border border-rose-300/20 bg-slate-950/90 p-8 text-center shadow-2xl">
            <AlertTriangle
              size={48}
              className="mb-6 flex-shrink-0 text-rose-300"
            />

            <h2 className="mb-4 text-xl font-black text-white">{copy.unexpectedError}</h2>

            <div className="mb-6 w-full overflow-auto rounded-xl border border-white/10 bg-white/[.04] p-4 text-right">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">{copy.technicalDetails}</p>
              <pre className="whitespace-break-spaces text-sm text-slate-300">
                {this.state.error?.stack}
              </pre>
            </div>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              {copy.reloadPage}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
