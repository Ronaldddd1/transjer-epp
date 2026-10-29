-- La actividad que hizo el trabajador el día que vino.
--
-- Pasar lista contestaba si vino o no vino, y nada más. Con la actividad al lado, la lista
-- del día dice además en qué se ocupó la gente, que es lo que después hace falta para
-- explicar un día de almacén o cuadrar una jornada con lo que se despachó. Es obligatoria
-- al marcar "vino": sin detalle la asistencia no se guarda.
--
-- La columna admite nulos porque las faltas y los justificados no llevan actividad, y
-- porque lo que ya estaba registrado antes de este cambio no la tiene.

ALTER TABLE "attendance" ADD COLUMN "activity" varchar(250);
