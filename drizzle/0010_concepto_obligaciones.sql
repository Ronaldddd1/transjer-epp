-- Concepto por el que se agrupan las obligaciones en el listado.
--
-- Aditiva. Las que ya existen quedan con un concepto deducido de su nombre: se le quita por
-- el final lo que identifica la unidad (la placa, el número de línea), que es lo que separaba
-- cada cochera y cada seguro en su propio bloque. La deducción acierta en la mayoría, no en
-- todas —"SEGURO VEHICULAR FLOTA" no lleva número y queda aparte de las demás—, así que el
-- campo es editable desde la ficha y se corrige escribiendo el concepto correcto.

ALTER TABLE "obligations" ADD COLUMN "category" varchar(80);
UPDATE "obligations"
SET "category" = nullif(trim(regexp_replace(trim("name"), '(\s+[-–]?\s*\S*[0-9]\S*)+$', '')), '')
WHERE "category" IS NULL;
