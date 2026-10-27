import type { Metadata } from "next";
import "@fontsource-variable/schibsted-grotesk";
import "./globals.css";
import { Nav } from "./nav";

export const metadata: Metadata = {
  title: "Prediction Market Scanner",
  description: "The same question priced on Kalshi and Polymarket, and whether the gap is real money after fees.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="frame">
          <header className="topbar">
            <a href="/" className="brand">
              <span className="brand-mark" aria-hidden>
                <span />
                <span />
              </span>
              Prediction Market Scanner
            </a>
            <Nav />
          </header>
          <main>{children}</main>
          <footer className="footer">
            Prices come from the public Kalshi and Polymarket APIs. This is a research tool, not investment advice:
            read both contracts&apos; resolution rules before trading.
          </footer>
        </div>
      </body>
    </html>
  );
}
