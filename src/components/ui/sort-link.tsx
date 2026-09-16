"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { requestQuery } from "@/lib/query-nav";

export function SortLink({ href, sort, dir, children }: { href: string; sort: string; dir: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className="inline-flex items-center gap-1 hover:text-ink"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // abrir en otra pestaña
        if (requestQuery({ sort, dir })) e.preventDefault();
      }}
    >
      {children}
    </Link>
  );
}
