import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "./nav";

export const metadata: Metadata = {
  title: "prediction-market-scanner",
  description: "Kalshi vs Polymarket: the same contracts at different prices, checked against fees and order book depth.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <a href="/" className="name">
            prediction-market-scanner
          </a>
          <Nav />
        </header>
        <main>{children}</main>
        <footer>
          Data from the public Kalshi and Polymarket APIs.
        </footer>
      </body>
    </html>
  );
}
