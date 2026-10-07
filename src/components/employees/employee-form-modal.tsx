"use client";

import { Pencil, UserPlus } from "lucide-react";
import { createEmployee, updateEmployee } from "@/actions/employees";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { DateInput } from "@/components/ui/date-field";
import { FormModal } from "@/components/ui/form-modal";

type EmployeeData = {
  id: string; dni: string; firstName: string; lastName: string; position: string; area: string;
  phone: string | null; hireDate: string | null; notes: string | null;
};

export const POSITIONS = ["Conductor", "Ayudante de reparto", "Operario de almacén", "Supervisor de operaciones", "Mecánico", "Administrativo"];
export const AREAS = ["Operaciones", "Almacén", "Flota", "Mantenimiento", "Administración", "Seguridad"];

export function EmployeeFormModal({ employee, areas = [], variant = "full" }: { employee?: EmployeeData; areas?: string[]; variant?: "full" | "icon" }) {
  const editing = !!employee;
  const areaList = Array.from(new Set([...AREAS, ...areas]));
  return (
    <FormModal
      title={editing ? "Editar trabajador" : "Nuevo trabajador"}
      submitLabel={editing ? "Guardar cambios" : "Registrar trabajador"}
      size="lg"
      action={(fd) => (editing ? updateEmployee(employee.id, fd) : createEmployee(fd))}
      trigger={(open) =>
        editing ? (
          <Button variant={variant === "icon" ? "ghost" : "outline"} size={variant === "icon" ? "sm" : "md"} onClick={open} title="Editar">
            <Pencil className="h-4 w-4" /><span className={variant === "icon" ? "sr-only 2xl:not-sr-only" : ""}>Editar</span>
          </Button>
        ) : (
          <Button onClick={open}><UserPlus className="h-4 w-4" /> Nuevo trabajador</Button>
        )
      }
    >
      {({ errors }) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="DNI" name="dni" required error={errors.dni}>
            <Input name="dni" inputMode="numeric" maxLength={12} defaultValue={employee?.dni} invalid={!!errors.dni} />
          </Field>
          <Field label="Fecha de ingreso" name="hireDate" error={errors.hireDate}>
            <DateInput name="hireDate" defaultValue={employee?.hireDate ?? ""} />
          </Field>
          <Field label="Nombres" name="firstName" required error={errors.firstName}>
            <Input name="firstName" defaultValue={employee?.firstName} invalid={!!errors.firstName} maxLength={80} />
          </Field>
          <Field label="Apellidos" name="lastName" required error={errors.lastName}>
            <Input name="lastName" defaultValue={employee?.lastName} invalid={!!errors.lastName} maxLength={80} />
          </Field>
          <Field label="Cargo" name="position" required error={errors.position}>
            <Input name="position" list="position-options" defaultValue={employee?.position} invalid={!!errors.position} maxLength={80} />
            <datalist id="position-options">{POSITIONS.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="Área" name="area" required error={errors.area}>
            <Input name="area" list="area-options" defaultValue={employee?.area} invalid={!!errors.area} maxLength={80} />
            <datalist id="area-options">{areaList.map((a) => <option key={a} value={a} />)}</datalist>
          </Field>
          <Field label="Teléfono" name="phone" error={errors.phone}>
            <Input name="phone" type="tel" inputMode="tel" defaultValue={employee?.phone ?? ""} maxLength={20} invalid={!!errors.phone} />
          </Field>
          <Field label="Observaciones" name="notes" error={errors.notes} className="sm:col-span-2">
            <Textarea name="notes" rows={2} defaultValue={employee?.notes ?? ""} maxLength={1000} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}
