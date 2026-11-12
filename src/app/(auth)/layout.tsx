import Image from "next/image";
import { APP_NAME } from "@/lib/pwa/config";
import { darkHeroGradient, darkHeroShell } from "@/lib/ui/dark-surfaces";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center px-4 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 55% at 50% -8%, rgba(201,162,39,0.14), transparent 58%), radial-gradient(ellipse 70% 45% at 50% 110%, rgba(19,42,64,0.55), transparent 62%)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        <header className="mb-7 flex flex-col items-center text-center sm:mb-8">
          <Image
            src="/icons/brasaosmv.png"
            alt=""
            width={120}
            height={136}
            priority
            className="h-[5.5rem] w-auto object-contain drop-shadow-[0_10px_28px_rgba(0,0,0,0.5)] sm:h-24"
          />
          <p className="mt-5 max-w-[18rem] text-lg font-semibold leading-snug tracking-tight text-smv-gold-bright sm:max-w-none sm:text-xl">
            {APP_NAME}
          </p>
        </header>

        <div
          className={`w-full p-6 shadow-lg shadow-black/30 sm:p-8 ${darkHeroShell}`}
          style={{ backgroundImage: darkHeroGradient }}
        >
          {children}
        </div>
      </div>
    </main>
  );
}
