import { darkCard } from "@/lib/ui/dark-surfaces";
import { shellBrand } from "@/lib/ui/shell-text";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <p className={`mb-6 ${shellBrand}`}>SMV</p>
      <div className={`w-full max-w-sm p-6 ${darkCard}`}>{children}</div>
    </main>
  );
}
