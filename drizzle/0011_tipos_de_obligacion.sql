-- Tipos nuevos de obligación: cochera, seguro y línea móvil.
--
-- El tipo deja de ser un enum de Postgres y pasa a ser texto con una restricción CHECK.
-- Con un enum no se podía hacer esto en una sola migración: Postgres no permite usar un
-- valor recién agregado a un enum hasta que la transacción cierra, y Drizzle corre todas
-- las migraciones pendientes dentro de una sola transacción. Con texto, agregar un tipo
-- más adelante es ampliar la restricción y nada más.
--
-- Aditiva. No borra ni mueve ninguna obligación: solo reetiqueta las que claramente son
-- cochera, seguro o línea y hasta ahora caían todas bajo "Servicio". Lo que no reconoce
-- se queda como está y se corrige desde la ficha, que ahora deja cambiar el tipo.

ALTER TABLE "obligations" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "obligations" ALTER COLUMN "type" TYPE varchar(16) USING "type"::text;
ALTER TABLE "obligations" ALTER COLUMN "type" SET DEFAULT 'SERVICIO';
DROP TYPE IF EXISTS "obligation_type";

ALTER TABLE "obligations" ADD CONSTRAINT "obligations_type_valid"
  CHECK ("type" IN ('PRESTAMO','ALQUILER','COCHERA','SEGURO','LINEA','SERVICIO','IMPUESTO','OTRO'));

-- Para comparar sin tropezar con tildes ni mayúsculas: "Línea" y "LINEA" son lo mismo.
-- Se mira el concepto y el nombre juntos, que es donde la empresa escribe de qué se trata.

-- Cocheras. Salen también de los alquileres porque la ayuda del formulario decía
-- "Local, cochera o equipo alquilado", así que varias se cargaron ahí.
UPDATE "obligations" SET "type" = 'COCHERA'
WHERE "type" IN ('SERVICIO', 'ALQUILER')
  AND translate(lower(coalesce("category", '') || ' ' || "name"), 'áéíóú', 'aeiou')
      ~ '(cochera|estacionamiento)';

UPDATE "obligations" SET "type" = 'SEGURO'
WHERE "type" = 'SERVICIO'
  AND translate(lower(coalesce("category", '') || ' ' || "name"), 'áéíóú', 'aeiou')
      ~ '(seguro|poliza|soat)';

UPDATE "obligations" SET "type" = 'LINEA'
WHERE "type" = 'SERVICIO'
  AND translate(lower(coalesce("category", '') || ' ' || "name"), 'áéíóú', 'aeiou')
      ~ '(linea|lineal|celular|telefon|movil|rpc|rpm)';
