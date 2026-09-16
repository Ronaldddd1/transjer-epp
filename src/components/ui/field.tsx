import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const controlClass =
  "w-full rounded-md border border-steel-300 bg-white px-3 text-[15px] text-ink placeholder:text-steel-400 " +
  "focus:border-ink focus:outline-none focus:ring-2 focus:ring-brand/60 disabled:bg-steel-100 disabled:text-steel-500 " +
  "aria-[invalid=true]:border-red-500";

type FieldProps = { label: string; name: string; error?: string; required?: boolean; hint?: string; className?: string; children: ReactNode };

export function Field({ label, name, error, required, hint, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={name} className="text-sm font-medium text-ink-700">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${name}-error`} className="text-sm text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-steel-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return <input ref={ref} id={props.id ?? props.name} aria-invalid={invalid || undefined} className={cn(controlClass, "h-10", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, ...props }, ref) {
    return <select ref={ref} id={props.id ?? props.name} aria-invalid={invalid || undefined} className={cn(controlClass, "h-10 pr-8", className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...props }, ref) {
    return <textarea ref={ref} id={props.id ?? props.name} rows={3} aria-invalid={invalid || undefined} className={cn(controlClass, "py-2", className)} {...props} />;
  },
);
