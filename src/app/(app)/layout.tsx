import Link from "next/link";
import { logoutAction } from "@/server/auth/actions";
import { requireViewer } from "@/server/auth/dal";
import { BottomNav, SideNav, type NavItem } from "./app-nav";

// O layout não substitui a verificação em cada página e Server Action: ele não é
// renderizado de novo a cada navegação.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();

  // Itens de ADMIN nem chegam ao cliente para quem não é ADMIN; a página ainda
  // verifica o papel com requireAdmin().
  const items: NavItem[] = [
    { href: "/", label: "Início", icon: "home" },
    ...(viewer.member.role === "ADMIN" ? [{ href: "/admin", label: "Admin", icon: "admin" } as const] : []),
    { href: "/account", label: "Conta", icon: "account" },
  ];

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-r md:border-zinc-200 md:bg-white md:p-4">
        <Link href="/" className="mb-6 flex items-center gap-2 px-3 py-2">
          <span className="text-lg font-semibold text-emerald-700">SMV</span>
          <span className="truncate text-sm text-zinc-500">{viewer.group.name}</span>
        </Link>
        <SideNav items={items} />
        <div className="mt-auto border-t border-zinc-200 pt-4">
          <p className="truncate px-3 text-sm font-medium text-zinc-900">{viewer.user.name}</p>
          <p className="truncate px-3 text-xs text-zinc-500">{viewer.user.username}</p>
          <form action={logoutAction} className="mt-2">
            <button
              type="submit"
              className="flex min-h-11 w-full items-center rounded-lg px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            >
              Sair
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <Link href="/" className="text-lg font-semibold text-emerald-700">
              SMV
            </Link>
            <span className="truncate text-sm text-zinc-500">{viewer.group.name}</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:py-8">
          {children}
        </main>
      </div>

      <BottomNav items={items} />
    </div>
  );
}
