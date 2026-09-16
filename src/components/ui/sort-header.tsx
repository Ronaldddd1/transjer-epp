import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SearchParamsRecord } from "@/lib/utils";
import { first } from "@/lib/utils";
import { SortLink } from "./sort-link";
import { Th } from "./table";

export function SortHeader({ label, field, basePath, sp, className }: { label: string; field: string; basePath: string; sp: SearchParamsRecord; className?: string }) {
  const current = first(sp.sort) ?? "code";
  const dir = first(sp.dir) === "desc" ? "desc" : "asc";
  const active = current === field;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "page") params.set(k, v);
  params.set("sort", field);
  params.set("dir", active && dir === "asc" ? "desc" : "asc");
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Th className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <SortLink href={`${basePath}?${params}`} sort={field} dir={params.get("dir") ?? "asc"}>
        {label} <Icon className={active ? "h-3.5 w-3.5 text-ink" : "h-3.5 w-3.5 opacity-40"} />
      </SortLink>
    </Th>
  );
}
