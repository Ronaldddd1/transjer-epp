-- Accesos por módulo para cada usuario.
--
-- En vez de un rol armado de antemano, al crear un usuario se marca módulo por módulo:
-- sin acceso, solo ver, o ver y editar. Se guarda como {"inventario":"edit", ...}.
--
-- NULL quiere decir "todavía con rol": los usuarios creados antes siguen funcionando con
-- su rol hasta que alguien los edite, y entonces pasan a tener sus accesos. El
-- administrador entra a todo y no necesita accesos.
ALTER TABLE "users" ADD COLUMN "module_access" jsonb;
