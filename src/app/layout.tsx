import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
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
        className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} antialiased`}
      >
        <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,153,79,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(38,115,72,0.18),_transparent_30%),linear-gradient(180deg,_#fbf7ef_0%,_#f5efe2_100%)] text-[var(--color-ink)]">
          <div className="mx-auto min-h-screen max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
            <header className="mb-6 flex flex-col gap-3 rounded-[28px] border border-white/60 bg-white/72 px-5 py-4 shadow-[0_18px_60px_rgba(66,47,23,0.08)] backdrop-blur md:flex-row md:items-center md:justify-between">
              <div>
                <Link href="/" className="inline-flex items-center gap-3 text-sm text-[var(--color-muted)]">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--color-panel-strong)] text-[var(--color-surface)] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
                    OV
                  </span>
                  <span>
                    <span className="block font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-accent)]">
                      AI Delivery OS
                    </span>
                    <span className="block text-xl font-semibold text-[var(--color-ink)]">
                      Overture Control Plane
                    </span>
                  </span>
                </Link>
              </div>
              <nav className="flex flex-wrap items-center gap-2 font-mono text-[12px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                <Link href="/" className="rounded-full border border-[var(--color-border)] bg-white px-4 py-2 transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">
                  Projects
                </Link>
                <a href="#operator-view" className="rounded-full border border-[var(--color-border)] bg-white px-4 py-2 transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">
                  Operators
                </a>
              </nav>
            </header>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
