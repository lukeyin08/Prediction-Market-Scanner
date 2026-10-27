import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prediction Market Scanner",
  description: "Cross-venue mispricing between Kalshi and Polymarket, net of fees and order book depth.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden />
            Prediction Market Scanner
          </Link>
          <nav>
            <Link href="/">Live</Link>
            <Link href="/history">Persistence</Link>
            <Link href="/methodology">Method</Link>
            <a href="https://github.com/lukeyin08/prediction-market-scanner">GitHub</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="footer">
          Data from the public Kalshi and Polymarket APIs. Not investment advice: always read both contracts&apos;
          resolution rules before trading.
        </footer>
      </body>
    </html>
  );
}
