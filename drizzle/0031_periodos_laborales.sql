-- Los periodos anteriores de un trabajador que se fue y volvió.
--
-- Al reincorporar a alguien que cesó, su ficha toma la nueva fecha de ingreso y el cese
-- queda vacío; el periodo anterior (ingreso, cese y motivo) se guarda aquí para que no se
-- pierda y para que las actas de ese cese sigan diciendo la fecha correcta.
CREATE TABLE "employment_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "hire_date" date,
  "terminated_at" date NOT NULL,
  "termination_reason" varchar(160),
  "rehired_at" date NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "employment_periods_employee_idx" ON "employment_periods" ("employee_id", "terminated_at");
