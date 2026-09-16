export const PERIODS = { mes: "Este mes", "7d": "Últimos 7 días", "30d": "Últimos 30 días", anio: "Este año" } as const;
export type PeriodKey = keyof typeof PERIODS;
