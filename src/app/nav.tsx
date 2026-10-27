"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "scan" },
  { href: "/history", label: "history" },
  { href: "/methodology", label: "how it works" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
      <a href="https://github.com/lukeyin08/prediction-market-scanner">github</a>
    </nav>
  );
}
