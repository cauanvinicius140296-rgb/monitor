"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface SeriesPoint {
  t: number;
  [storeSlug: string]: number | null;
}

export interface SeriesDef {
  key: string;
  label: string;
}

const COLORS = ["#4f46e5", "#059669", "#d97706", "#db2777", "#0891b2", "#7c3aed"];

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const shortDate = (t: number) =>
  new Date(t).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

export function PriceChart({
  data,
  series,
  targetCents,
  referenceCents,
}: {
  data: SeriesPoint[];
  series: SeriesDef[];
  targetCents?: number | null;
  referenceCents?: number | null;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
        Ainda não há observações válidas neste período.
      </div>
    );
  }
  return (
    <div className="h-72 w-full" role="img" aria-label="Gráfico do histórico de preços">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={shortDate} stroke="#64748b" fontSize={12} />
          <YAxis
            tickFormatter={(v: number) => (v / 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
            stroke="#64748b"
            fontSize={12}
            width={70}
          />
          <Tooltip
            labelFormatter={(t) => new Date(Number(t)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
            formatter={(value, name) => [typeof value === "number" ? brl(value) : "—", name]}
          />
          <Legend />
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
          {targetCents ? (
            <Line dataKey={() => targetCents} name="Preço-alvo" stroke="#e11d48" strokeDasharray="6 4" dot={false} isAnimationActive={false} legendType="line" />
          ) : null}
          {referenceCents ? (
            <Line dataKey={() => referenceCents} name="Referência" stroke="#64748b" strokeDasharray="2 4" dot={false} isAnimationActive={false} legendType="line" />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
