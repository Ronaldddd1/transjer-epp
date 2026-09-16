"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const HIDDEN = new Set(["id", "createdAt", "updatedAt"]);

function diff(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(oldData ?? {}), ...Object.keys(newData ?? {})]);
  return [...keys].filter((k) => !HIDDEN.has(k)).map((k) => {
    const before = oldData?.[k];
    const after = newData?.[k];
    return { key: k, before, after, changed: JSON.stringify(before) !== JSON.stringify(after) };
  });
}

const show = (v: unknown) => (v === undefined ? "" : v === null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function AuditDetail({ description, oldData, newData }: { description: string; oldData: unknown; newData: unknown }) {
  const [open, setOpen] = useState(false);
  if (!oldData && !newData) return <span className="text-steel-400">—</span>;
  const rows = diff(oldData as Record<string, unknown> | null, newData as Record<string, unknown> | null);
  const both = !!oldData && !!newData;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Ver detalle</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Detalle del cambio" description={description} size="lg">
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-steel-500">
                <th scope="col" className="py-1.5 pr-3 font-medium">Campo</th>
                {oldData ? <th scope="col" className="py-1.5 pr-3 font-medium">Información anterior</th> : null}
                {newData ? <th scope="col" className="py-1.5 font-medium">Información nueva</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={both && r.changed ? "bg-brand-soft" : ""}>
                  <td className="border-t border-steel-100 py-1.5 pr-3 font-medium">{r.key}</td>
                  {oldData ? <td className="border-t border-steel-100 py-1.5 pr-3 break-all text-steel-600">{show(r.before)}</td> : null}
                  {newData ? <td className="border-t border-steel-100 py-1.5 break-all">{show(r.after)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </>
  );
}
