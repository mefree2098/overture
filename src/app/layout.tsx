import type { Metadata } from "next";
import Link from "next/link";
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
                <Link href="/" className="inline-flex items-center gap-4 text-sm text-[var(--color-muted)]">
                  <span className="grid h-14 w-14 place-items-center rounded-[22px] border border-white/10 bg-[linear-gradient(160deg,rgba(123,240,255,0.28),rgba(143,166,255,0.14))] text-lg font-semibold text-[var(--color-ink)] shadow-[0_0_34px_rgba(123,240,255,0.18)]">
                    OV
                  </span>
                  <span>
                    <span className="block font-mono text-[11px] uppercase tracking-[0.38em] text-[var(--color-accent)]">
                      AI Delivery OS
                    </span>
                    <span className="block holo-text text-2xl font-semibold text-[var(--color-ink)]">
                      Overture Control Plane
                    </span>
                    <span className="mt-1 block text-sm text-[var(--color-muted)]">
                      Codex planning, Symphony execution, evidence-first delivery.
                    </span>
                  </span>
                </Link>
              </div>
              <div className="flex flex-col gap-3 md:items-end">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  <span className="rounded-full border border-[var(--color-border)] bg-white/4 px-4 py-2">
                    Planner: LLM
                  </span>
                  <span className="rounded-full border border-[var(--color-border)] bg-white/4 px-4 py-2">
                    Executor: Symphony
                  </span>
                  <span className="rounded-full border border-[var(--color-border)] bg-white/4 px-4 py-2">
                    Tracker: GraphQL Bridge
                  </span>
                </div>
                <nav className="flex flex-wrap items-center gap-2 font-mono text-[12px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  <Link
                    href="/"
                    className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                  >
                  Projects
                  </Link>
                  <a
                    href="#operator-view"
                    className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                  >
                    Operators
                  </a>
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
