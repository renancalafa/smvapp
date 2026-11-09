import Image from "next/image";
import Link from "next/link";
import { LogoutForm } from "@/components/logout-form";
import { requireViewer } from "@/server/auth/dal";
import { BottomNav, SideNav, type NavItem } from "./app-nav";

// O layout não substitui a verificação em cada página e Server Action: ele não é
// renderizado de novo a cada navegação.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();

  // Itens de ADMIN nem chegam ao cliente para quem não é ADMIN; a página ainda
  // verifica o papel com requireAdmin().
  // Rankings fica na lateral (e no atalho da home): a barra inferior do celular
  // já tem Início / Ao Vivo / Admin? / Conta e não deve lotar.
  const mobileItems: NavItem[] = [
    { href: "/", label: "Início", icon: "home" },
    { href: "/live", label: "Ao Vivo", icon: "live" },
    ...(viewer.member.role === "ADMIN" ? [{ href: "/admin", label: "Admin", icon: "admin" } as const] : []),
    { href: "/account", label: "Conta", icon: "account" },
  ];
  const desktopItems: NavItem[] = [
    { href: "/", label: "Início", icon: "home" },
    { href: "/live", label: "Ao Vivo", icon: "live" },
    { href: "/stats", label: "Rankings", icon: "stats" },
    ...(viewer.member.role === "ADMIN" ? [{ href: "/admin", label: "Admin", icon: "admin" } as const] : []),
    { href: "/account", label: "Conta", icon: "account" },
  ];

  return (
    <div className="flex flex-1 flex-col bg-smv-navy-deep md:flex-row">
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-r md:border-white/10 md:bg-smv-navy md:p-4">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold">
          <Image
            src="/icons/logo.png"
            alt=""
            width={32}
            height={32}
            className="size-8 shrink-0 rounded-full bg-black/30 object-contain p-0.5 ring-1 ring-smv-gold/35"
          />
          <span className="min-w-0">
            <span className="block text-lg font-semibold text-smv-cream">SMV</span>
            <span className="block truncate text-xs text-white/50">{viewer.group.name}</span>
          </span>
        </Link>
        <SideNav items={desktopItems} />
        <div className="mt-auto border-t border-white/10 pt-4">
          <p className="truncate px-3 text-sm font-medium text-smv-cream">{viewer.user.name}</p>
          <p className="truncate px-3 text-xs text-white/50">{viewer.user.username}</p>
          <LogoutForm
            className="mt-2"
            buttonClassName="flex min-h-11 w-full items-center rounded-lg px-3 text-sm font-medium text-white/65 transition-colors hover:bg-white/8 hover:text-smv-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold"
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-white/10 bg-smv-navy/95 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <Link
              href="/"
              className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold"
            >
              <Image
                src="/icons/logo.png"
                alt=""
                width={28}
                height={28}
                className="size-7 rounded-full bg-black/30 object-contain p-0.5 ring-1 ring-smv-gold/35"
              />
              <span className="text-lg font-semibold text-smv-cream">SMV</span>
            </Link>
            <span className="truncate text-sm text-white/50">{viewer.group.name}</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:py-8">
          {children}
        </main>
      </div>

      <BottomNav items={mobileItems} />
    </div>
  );
}
