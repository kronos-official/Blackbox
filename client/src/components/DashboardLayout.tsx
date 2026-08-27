import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { startLogin } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { dashboardDirection, normalizeDashboardLocale, type DashboardLocale } from "@/lib/dashboardI18n";
import { LayoutDashboard, LogOut, Palette, PanelLeft, Users } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";

const shellCopy: Record<DashboardLocale, { navigation: string; overview: string; sample: string; themes: string; signInTitle: string; signInText: string; signIn: string; signOut: string }> = {
  fa: { navigation: "ناوبری", overview: "صفحهٔ اصلی", sample: "بخش نمونه", themes: "گالری تم", signInTitle: "برای ادامه وارد شوید", signInText: "دسترسی به این داشبورد به احراز هویت نیاز دارد. برای شروع ورود ادامه دهید.", signIn: "ورود", signOut: "خروج از حساب" },
  en: { navigation: "Navigation", overview: "Home", sample: "Sample section", themes: "Theme gallery", signInTitle: "Sign in to continue", signInText: "Access to this dashboard requires authentication. Continue to launch the login flow.", signIn: "Sign in", signOut: "Sign out" },
  ar: { navigation: "التنقل", overview: "الرئيسية", sample: "قسم تجريبي", themes: "معرض السمات", signInTitle: "سجّل الدخول للمتابعة", signInText: "يتطلب الوصول إلى هذه اللوحة التحقق من الهوية. تابع لبدء تسجيل الدخول.", signIn: "تسجيل الدخول", signOut: "تسجيل الخروج" },
  tr: { navigation: "Gezinme", overview: "Ana sayfa", sample: "Örnek bölüm", themes: "Tema galerisi", signInTitle: "Devam etmek için giriş yapın", signInText: "Bu panele erişim kimlik doğrulaması gerektirir. Giriş akışını başlatmak için devam edin.", signIn: "Giriş yap", signOut: "Çıkış yap" },
  ru: { navigation: "Навигация", overview: "Главная", sample: "Пример раздела", themes: "Галерея тем", signInTitle: "Войдите, чтобы продолжить", signInText: "Для доступа к панели требуется аутентификация. Продолжите, чтобы начать вход.", signIn: "Войти", signOut: "Выйти" },
  es: { navigation: "Navegación", overview: "Inicio", sample: "Sección de ejemplo", themes: "Galería de temas", signInTitle: "Inicia sesión para continuar", signInText: "El acceso a este panel requiere autenticación. Continúa para iniciar sesión.", signIn: "Iniciar sesión", signOut: "Cerrar sesión" },
  fr: { navigation: "Navigation", overview: "Accueil", sample: "Section d’exemple", themes: "Galerie de thèmes", signInTitle: "Connectez-vous pour continuer", signInText: "L’accès à ce tableau de bord nécessite une authentification. Continuez pour ouvrir la connexion.", signIn: "Se connecter", signOut: "Se déconnecter" },
  pt: { navigation: "Navegação", overview: "Início", sample: "Seção de exemplo", themes: "Galeria de temas", signInTitle: "Entre para continuar", signInText: "O acesso a este painel exige autenticação. Continue para iniciar o login.", signIn: "Entrar", signOut: "Sair" },
  it: { navigation: "Navigazione", overview: "Home", sample: "Sezione di esempio", themes: "Galleria temi", signInTitle: "Accedi per continuare", signInText: "L’accesso a questo pannello richiede l’autenticazione. Continua per avviare l’accesso.", signIn: "Accedi", signOut: "Esci" },
  de: { navigation: "Navigation", overview: "Startseite", sample: "Beispielbereich", themes: "Themengalerie", signInTitle: "Zum Fortfahren anmelden", signInText: "Der Zugriff auf dieses Dashboard erfordert eine Anmeldung. Fahren Sie fort, um den Anmeldevorgang zu starten.", signIn: "Anmelden", signOut: "Abmelden" },
  pl: { navigation: "Nawigacja", overview: "Strona główna", sample: "Przykładowa sekcja", themes: "Galeria motywów", signInTitle: "Zaloguj się, aby kontynuować", signInText: "Dostęp do tego panelu wymaga uwierzytelnienia. Kontynuuj, aby rozpocząć logowanie.", signIn: "Zaloguj się", signOut: "Wyloguj się" },
  vi: { navigation: "Điều hướng", overview: "Trang chủ", sample: "Mục ví dụ", themes: "Thư viện giao diện", signInTitle: "Đăng nhập để tiếp tục", signInText: "Bạn cần xác thực để truy cập bảng điều khiển này. Hãy tiếp tục để bắt đầu đăng nhập.", signIn: "Đăng nhập", signOut: "Đăng xuất" },
};

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = typeof window === "undefined" ? "fa" : normalizeDashboardLocale(window.localStorage.getItem("kronos-dashboard-locale"));
  const copy = shellCopy[locale];
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return (
      <div dir={dashboardDirection(locale)} className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              {copy.signInTitle}
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {copy.signInText}
            </p>
          </div>
          <Button
            onClick={() => startLogin()}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            {copy.signIn}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const locale = typeof window === "undefined" ? "fa" : normalizeDashboardLocale(window.localStorage.getItem("kronos-dashboard-locale"));
  const copy = shellCopy[locale];
  const menuItems = [
    { icon: LayoutDashboard, label: copy.overview, path: "/" },
    { icon: Users, label: copy.sample, path: "/some-path" },
    { icon: Palette, label: copy.themes, path: "/themes" },
  ];
  const activeMenuItem = menuItems.find(item => item.path === location);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label={copy.navigation}
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold tracking-tight truncate">
                    {copy.navigation}
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {menuItems.map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`h-10 transition-all font-normal`}
                    >
                      <item.icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                      />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{copy.signOut}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-foreground">
                    {activeMenuItem?.label ?? "Menu"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>
    </>
  );
}
