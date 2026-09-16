"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function MovementsChart({ data }: { data: { day: string; entradas: number; salidas: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}` }));
  const empty = rows.every((r) => r.entradas === 0 && r.salidas === 0);
  if (empty) {
    return <p className="flex h-64 items-center justify-center text-sm text-steel-500">Sin movimientos en los últimos 30 días.</p>;
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={1}>
          <CartesianGrid vertical={false} stroke="#E1E1E5" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6E6E76" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6E6E76" }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: "#F7F7F8" }}
            contentStyle={{ borderRadius: 6, border: "1px solid #E1E1E5", fontSize: 13 }}
            labelFormatter={(l) => `Día ${l}`}
          />
          <Legend iconType="square" wrapperStyle={{ fontSize: 13 }} />
          <Bar dataKey="entradas" name="Entradas" fill="#FFC20E" radius={[2, 2, 0, 0]} />
          <Bar dataKey="salidas" name="Salidas" fill="#000000" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
