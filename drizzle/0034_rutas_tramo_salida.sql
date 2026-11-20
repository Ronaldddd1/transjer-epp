-- El tramo cochera → centro de recojo de cada ruta.
--
-- Los km de cada móvil cuentan desde que sale de la cochera, pero ese tramo no se dibuja
-- en el mapa ni suma al tiempo (la jornada se cuenta desde que sale del centro). Se guarda
-- aparte para mostrar cuánto de los km es ese tramo. Solo agrega una columna.
ALTER TABLE "route_plans" ADD COLUMN IF NOT EXISTS "exit_km" numeric(10, 2);
