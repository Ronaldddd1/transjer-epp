# Control de Inventario de EPP — Transjer Operador Logístico S.A.C.

Sistema web para controlar el inventario de Equipos de Protección Personal (EPP): stock, entradas, salidas, ajustes, entregas al personal, alertas de stock bajo, auditoría y reportes en Excel, CSV y PDF. Es multiusuario: todos trabajan sobre la misma base de datos PostgreSQL en la nube, así que lo que registra una persona lo ven las demás al instante.

**Tecnologías:** Next.js 15 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS · Drizzle ORM · PostgreSQL (Neon o Supabase) · despliegue en Vercel.

---

## Contenido

1. [Qué necesitas](#1-qué-necesitas)
2. [Crear la base de datos](#2-crear-la-base-de-datos)
3. [Configurar las variables de entorno](#3-configurar-las-variables-de-entorno)
4. [Instalar y ejecutar en tu computadora](#4-instalar-y-ejecutar-en-tu-computadora)
5. [Migraciones](#5-migraciones)
6. [Usuario administrador](#6-usuario-administrador)
7. [Datos de prueba: cargarlos y borrarlos](#7-datos-de-prueba-cargarlos-y-borrarlos)
8. [Subir el proyecto a GitHub](#8-subir-el-proyecto-a-github)
9. [Desplegar en Vercel](#9-desplegar-en-vercel)
10. [Actualizar el sistema](#10-actualizar-el-sistema)
11. [Roles y permisos](#11-roles-y-permisos)
12. [Reglas de negocio](#12-reglas-de-negocio)
13. [Estructura del proyecto](#13-estructura-del-proyecto)
14. [Solución de problemas](#14-solución-de-problemas)

---

## 1. Qué necesitas

- **Node.js 20.9 o superior** (recomendado: 22 LTS). Verifica con `node -v`.
- Una cuenta gratuita en **[Neon](https://neon.tech)** o **[Supabase](https://supabase.com)** para la base de datos.
- Una cuenta en **[GitHub](https://github.com)** y otra en **[Vercel](https://vercel.com)** (puedes entrar a Vercel con tu cuenta de GitHub).
- Git instalado.

## 2. Crear la base de datos

Necesitas **dos cadenas de conexión**:

| Variable | Para qué sirve | Tipo de conexión |
|---|---|---|
| `DATABASE_URL` | La usa la aplicación en Vercel | *Pooled* (con pooler) |
| `DIRECT_URL` | La usan las migraciones y los scripts | *Direct* (sin pooler) |

### Opción A — Neon

1. Crea un proyecto en Neon y elige la región más cercana (por ejemplo, `AWS US East`).
2. En **Dashboard → Connect**, copia la cadena con **Connection pooling activado**: esa es `DATABASE_URL` (su host contiene `-pooler`).
3. Desactiva *Connection pooling* y copia la otra cadena: esa es `DIRECT_URL`.
4. Ambas deben terminar en `?sslmode=require`.

### Opción B — Supabase

1. Crea un proyecto y guarda la contraseña de la base de datos.
2. Pulsa **Connect** (arriba en el panel).
3. `DATABASE_URL` → **Transaction pooler** (puerto `6543`).
4. `DIRECT_URL` → **Direct connection** (puerto `5432`). Si tu red no tiene IPv6, usa el **Session pooler** (también puerto `5432`).
5. Reemplaza `[YOUR-PASSWORD]` por tu contraseña. Si tiene caracteres especiales (`@`, `#`, `/`…), codifícalos (por ejemplo, `@` → `%40`).

> El sistema ya está preparado para los poolers en modo transacción (`prepare: false`), así que no hace falta configurar nada más.

## 3. Configurar las variables de entorno

Copia el archivo de ejemplo:

```bash
cp .env.example .env
```

Y complétalo:

```env
DATABASE_URL="postgresql://...-pooler.../neondb?sslmode=require"
DIRECT_URL="postgresql://.../neondb?sslmode=require"

# Clave para firmar las sesiones (mínimo 32 caracteres, aleatoria)
AUTH_SECRET="pega-aqui-la-clave-generada"

# Administrador inicial
ADMIN_NAME="Ronald Santos"
ADMIN_EMAIL="rsantos@transjer.pe"
ADMIN_PASSWORD="UnaClaveSegura123!"
```

Para generar `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

Si no tienes `openssl` (Windows sin Git Bash):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> **Nunca subas el archivo `.env` a GitHub.** Ya está excluido en `.gitignore`. Usa claves distintas para desarrollo y producción.

## 4. Instalar y ejecutar en tu computadora

```bash
npm install
npm run db:migrate      # crea las tablas
npm run db:seed         # crea el administrador y las categorías base
npm run dev             # abre http://localhost:3000
```

Inicia sesión con el **usuario** o el **correo** del administrador. El usuario es la parte del correo antes de la `@`; por ejemplo, `rsantos@transjer.pe` → `rsantos`.

Otros comandos útiles:

| Comando | Qué hace |
|---|---|
| `npm run build` | Compila para producción (lo mismo que hace Vercel) |
| `npm run start` | Ejecuta la versión compilada |
| `npm run typecheck` | Revisa los tipos de TypeScript |
| `npm run lint` | Revisa el código con ESLint |
| `npm run db:studio` | Abre Drizzle Studio para ver las tablas en el navegador |

## 5. Migraciones

Las migraciones están en la carpeta `drizzle/` y se aplican con:

```bash
npm run db:migrate
```

Solo aplica las que faltan, así que puedes ejecutarlo todas las veces que quieras. Usa `DIRECT_URL` (o `DATABASE_URL` si la primera no está definida).

**Si cambias el esquema** (`src/db/schema.ts`):

```bash
npm run db:generate     # genera un nuevo archivo SQL en drizzle/
npm run db:migrate      # lo aplica
```

Revisa el SQL generado antes de aplicarlo en producción y súbelo a GitHub junto con el cambio de código.

## 6. Usuario administrador

`npm run db:seed` crea el administrador con los datos de `ADMIN_NAME`, `ADMIN_EMAIL` y `ADMIN_PASSWORD` (mínimo 8 caracteres). Si ya existe, no lo modifica.

Para crear otro administrador, o **restablecer la contraseña** de uno existente (por ejemplo, si nadie puede entrar):

```bash
npm run admin:create -- --name "Ronald Santos" --user rsantos --email rsantos@transjer.pe --password "ClaveSegura123"
```

El resto de usuarios (administradores o de rol Usuario) se crean desde la pantalla **Usuarios** del sistema.

> Después del primer despliegue, entra al sistema y cambia la contraseña inicial desde **Usuarios**.

## 7. Datos de prueba: cargarlos y borrarlos

Para probar el sistema con información realista:

```bash
npm run db:seed:demo
```

Carga **10 productos** (códigos `DEMO-001` a `DEMO-010`), **5 trabajadores**, entradas y entregas de las últimas semanas. Todos quedan marcados con la etiqueta gris **"Prueba"** en la interfaz (columna `is_demo` en la base de datos), así se distinguen de los datos reales. Puedes ejecutarlo varias veces: no duplica nada.

Para borrarlos cuando empieces a trabajar en serio:

```bash
npm run db:clear-demo
```

Elimina **solo** los registros marcados como prueba y su historial (movimientos y entregas). Los productos, trabajadores, usuarios y movimientos reales no se tocan. El stock de los productos reales tampoco cambia, porque las entregas de prueba solo se registraron sobre productos de prueba.

## 8. Subir el proyecto a GitHub

1. Crea un repositorio **privado** en GitHub (por ejemplo, `transjer-epp`) sin README ni `.gitignore`.
2. En la carpeta del proyecto:

```bash
git init
git add .
git commit -m "Sistema de control de inventario de EPP"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/transjer-epp.git
git push -u origin main
```

Antes del primer `push`, confirma que `.env` **no** aparece en `git status`.

## 9. Desplegar en Vercel

1. En Vercel: **Add New… → Project** e importa el repositorio de GitHub.
2. Vercel detecta Next.js automáticamente; no cambies los comandos de build.
3. Abre **Environment Variables** y agrega (para *Production* y *Preview*):

   | Nombre | Valor |
   |---|---|
   | `DATABASE_URL` | Cadena **pooled** |
   | `DIRECT_URL` | Cadena **directa** |
   | `AUTH_SECRET` | Una clave nueva generada con `openssl rand -base64 32` |

   `ADMIN_*` no hace falta en Vercel: solo la usan los scripts que ejecutas desde tu computadora.

4. Pulsa **Deploy**.
5. **Prepara la base de datos de producción** desde tu computadora, con el `.env` apuntando a esa base:

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

6. Abre la URL que te da Vercel (por ejemplo, `https://transjer-epp.vercel.app`) e inicia sesión.

**Región recomendada:** en **Settings → Functions** de Vercel, elige la región más cercana a tu base de datos (por ejemplo, `iad1` si Neon está en US East). Así las consultas son más rápidas.

**Dominio propio (opcional):** en **Settings → Domains** puedes asignar algo como `epp.transjer.pe`.

## 10. Actualizar el sistema

Cada vez que hagas un cambio:

```bash
git add .
git commit -m "Describe el cambio"
git push
```

Vercel despliega automáticamente cada `push` a `main`. Las ramas distintas de `main` generan una URL de vista previa para probar antes.

**Si el cambio incluye migraciones nuevas**, aplícalas en la base de producción **antes** de hacer `push`:

```bash
npm run db:migrate
```

Si necesitas volver atrás, en Vercel ve a **Deployments**, elige una versión anterior y pulsa **Promote to Production**. Ten en cuenta que esto no deshace migraciones de base de datos.

**Copias de seguridad:** Neon y Supabase guardan historial automáticamente según tu plan. Para una copia manual:

```bash
pg_dump "$DIRECT_URL" > respaldo-$(date +%F).sql
```

## 11. Roles y permisos

| Acción | Administrador | Usuario |
|---|:---:|:---:|
| Ver dashboard, inventario, movimientos, entregas y trabajadores | ✅ | ✅ |
| Registrar entregas de EPP | ✅ | ✅ |
| Registrar entradas y salidas | ✅ | ✅ |
| Registrar ajustes de inventario | ✅ | — |
| Crear, editar y eliminar productos | ✅ | — |
| Gestionar trabajadores | ✅ | — |
| Gestionar categorías | ✅ | — |
| Gestionar usuarios | ✅ | — |
| Ver auditoría | ✅ | — |
| Ver y exportar reportes | ✅ | — |

Los permisos se definen en `src/lib/permissions.ts`. Para agregar un rol nuevo (por ejemplo, "Supervisor"):

1. Agrégalo al enum `role` en `src/db/schema.ts` y genera la migración.
2. Asígnale permisos en `ROLE_PERMISSIONS`.

Los permisos se validan **en el servidor** en cada página, acción y exportación. Ocultar un botón es solo comodidad visual.

## 12. Reglas de negocio

- **El stock solo cambia mediante movimientos** (entrada, salida o ajuste). No se puede editar directamente.
- **El stock nunca es negativo.** Lo impide la aplicación y también una restricción en la base de datos. Si dos personas registran salidas a la vez, el sistema bloquea la fila para que no se descuadre.
- **Cada entrega genera automáticamente una salida** y descuenta el stock, en una sola operación.
- **El stock inicial** de un producto nuevo se registra como una entrada con motivo "Stock inicial".
- **Un ajuste** registra la diferencia entre el stock del sistema y el conteo físico.
- **La eliminación es lógica**: los productos, trabajadores y categorías se desactivan, pero su historial se conserva.
- **Estados de stock**: *Disponible* (por encima del mínimo), *⚠️ Stock bajo* (igual o por debajo del mínimo) y *🔴 Agotado* (cero).
- **Auditoría**: cada creación, edición, eliminación, movimiento e inicio de sesión queda registrado con el usuario, la fecha, la acción y los datos anteriores y nuevos. Las contraseñas nunca se guardan en la auditoría.
- **Zona horaria**: todas las fechas se muestran en hora de Lima (UTC−5).

## 13. Estructura del proyecto

```
drizzle/                 Migraciones SQL
scripts/                 migrate, seed, clear-demo, create-admin
src/
  app/
    login/               Inicio de sesión
    (app)/               Páginas protegidas: dashboard, inventario, movimientos,
                         entregas, trabajadores, categorías, usuarios, auditoría, reportes
    api/export/          Descarga de reportes (Excel, CSV, PDF)
  actions/               Server Actions (crear, editar, eliminar…)
  components/            Interfaz: ui/ (base), layout/, inventory/, deliveries/…
  db/                    Esquema y conexión
  lib/                   Sesión, permisos, auditoría, validaciones, utilidades
  server/                Consultas, lógica de inventario, reportes y exportadores
  middleware.ts          Protección de rutas
```

## 14. Solución de problemas

**`Falta la variable de entorno DATABASE_URL`**
No existe `.env` o está en otra carpeta. En Vercel, revisa **Settings → Environment Variables** y vuelve a desplegar: los cambios de variables solo se aplican en un despliegue nuevo.

**`relation "users" does not exist`**
No se ejecutaron las migraciones en esa base de datos: `npm run db:migrate`.

**No puedo iniciar sesión**
Restablece la contraseña con `npm run admin:create -- --email ... --password ...` (ver sección 6). Si cambiaste `AUTH_SECRET`, todas las sesiones anteriores se cierran; es normal.

**`prepared statement ... already exists`**
Estás usando una versión modificada de `src/db/index.ts`. La conexión debe mantener `prepare: false`.

**Errores de conexión o timeouts en las migraciones**
Usa la cadena **directa** en `DIRECT_URL`, no la del pooler.

**El primer inicio de sesión tarda unos segundos**
Es normal en planes gratuitos: la base de datos se "despierta" tras un tiempo sin uso.

---

Transjer Operador Logístico S.A.C. · Control de Inventario de EPP
