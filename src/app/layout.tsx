import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { IBM_Plex_Mono, Oxanium } from "next/font/google";
import "./globals.css";

const oxanium = Oxanium({
  variable: "--font-oxanium",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Overture",
  description:
    "Control plane for resumable AI software delivery with planning, gates, evidence, and deployment oversight.",
  icons: {
    icon: "/overtureicon.png",
    shortcut: "/overtureicon.png",
    apple: "/overtureicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${oxanium.variable} ${ibmPlexMono.variable} antialiased`}
      >
        <div className="ambient-orb ambient-orb-a" />
        <div className="ambient-orb ambient-orb-b" />
        <div className="ambient-orb ambient-orb-c" />
        <div className="min-h-screen text-[var(--color-ink)]">
          <div className="mx-auto min-h-screen max-w-[1720px] px-4 py-5 sm:px-6 lg:px-8">
            <header className="panel halo-ring mb-6 flex flex-col gap-4 rounded-[34px] px-5 py-5 md:flex-row md:items-center md:justify-between">
              <div>
                <Link
                  href="/"
                  className="inline-flex items-center gap-4 text-sm text-[var(--color-muted)]"
                >
                  <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(160deg,rgba(123,240,255,0.28),rgba(143,166,255,0.14))] shadow-[0_0_34px_rgba(123,240,255,0.18)]">
                    <Image
                      src="/overtureicon.png"
                      alt="Overture icon"
                      width={56}
                      height={56}
                      className="h-full w-full object-cover"
                      priority
                    />
                  </span>
                  <span>
                    <span className="block font-mono text-[11px] uppercase tracking-[0.38em] text-[var(--color-accent)]">
                      From Plan To Finished Run
                    </span>
                    <span className="block holo-text text-2xl font-semibold text-[var(--color-ink)]">
                      Overture
                    </span>
                    <span className="mt-1 block text-sm text-[var(--color-muted)]">
                      Turn a written plan into an automated build, test, and review workflow.
                    </span>
                  </span>
                </Link>
              </div>
              <div className="flex flex-col gap-3 md:items-end">
                <div className="rounded-full border border-[var(--color-border)] bg-white/4 px-4 py-2 text-sm text-[var(--color-muted)]">
                  Best for first-time users: start on the home page, paste a plan, then review the
                  new project before starting the automated run.
                </div>
                <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-muted)]">
                  <Link
                    href="/"
                    className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                  >
                    Projects
                  </Link>
                  <Link
                    href="/settings"
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                  >
                    <Settings2 className="h-4 w-4" />
                    Settings
                  </Link>
                </nav>
              </div>
            </header>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
