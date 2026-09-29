# Transjer Gestión — Transjer Operador Logístico S.A.C.

Sistema web con dos áreas de trabajo:

- **Almacén (EPP):** stock, entradas, salidas, ajustes, entregas al personal, alertas de stock bajo, auditoría y reportes en Excel, CSV y PDF.
- **Administración y Finanzas:** facturas de proveedores por servicios de transporte, con control de pagos y lectura automática del buzón `facturas@transjer.com`. Es multiusuario: todos trabajan sobre la misma base de datos PostgreSQL en la nube, así que lo que registra una persona lo ven las demás al instante.

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
11. [Facturas de proveedores](#11-facturas-de-proveedores)
12. [Lectura automática del correo](#12-lectura-automática-del-correo)
12b. [Préstamos y servicios](#12b-préstamos-y-servicios)
13. [Roles y permisos](#13-roles-y-permisos)
14. [Reglas de negocio](#14-reglas-de-negocio)
15. [Estructura del proyecto](#15-estructura-del-proyecto)
16. [Pruebas](#16-pruebas)
17. [Solución de problemas](#17-solución-de-problemas)

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

Esas cinco variables son las únicas obligatorias. El archivo de ejemplo trae además las
opcionales del módulo de facturas (dónde guardar los PDF y la conexión con el buzón de
correo); se explican en las secciones 11 y 12 y puedes dejarlas vacías por ahora.

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

Elimina **solo** los registros marcados como prueba y su historial (movimientos y entregas). Los productos, trabajadores, usuarios y movimientos reales no se tocan. Si alguien registró un movimiento de un producto **real** para un trabajador de prueba, ese movimiento se conserva (solo se quita el vínculo con el trabajador), para que el historial siga cuadrando con el stock.

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
   Las variables del módulo de facturas (archivos adjuntos y lectura del correo) se agregan
   después, cuando las necesites: ver secciones 11 y 12.

4. Pulsa **Deploy**.
5. **Prepara la base de datos de producción** desde tu computadora, con el `.env` apuntando a esa base:

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

6. Abre la URL que te da Vercel (por ejemplo, `https://transjer-epp.vercel.app`) e inicia sesión.

**Región recomendada:** en **Settings → Functions** de Vercel, elige la región más cercana a tu base de datos (por ejemplo, `iad1` si Neon está en US East). Así las consultas son más rápidas.

**Dominio propio (opcional):** en **Settings → Domains** puedes asignar algo como `epp.transjer.pe`. Si lo haces y tienes activada la lectura del correo, actualiza también `APP_URL` (sección 12).

**Tarea programada:** `vercel.json` ya incluye la revisión diaria del buzón de facturas. Vercel la registra sola al desplegar y solo hace algo si configuraste el correo.

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

**Ejemplo: última actualización** (migraciones `0002_facturas_proveedores` y `0003_rol_jefe_almacen`). Solo agregan tablas y roles nuevos; no modifican ni borran nada de lo que ya existe:

```bash
# 1. Con el .env apuntando a la base de PRODUCCIÓN
npm install
npm run db:migrate
# 2. Publicar el código
git add .
git commit -m "Transjer Gestión: plazos de pago, préstamos y servicios"
git push
```

Si necesitas volver atrás, en Vercel ve a **Deployments**, elige una versión anterior y pulsa **Promote to Production**. Ten en cuenta que esto no deshace migraciones de base de datos.

**Copias de seguridad:** Neon y Supabase guardan historial automáticamente según tu plan. Para una copia manual:

```bash
pg_dump "$DIRECT_URL" > respaldo-$(date +%F).sql
```

## 11. Facturas de proveedores

Registra las facturas que los transportistas envían a `facturas@transjer.com` y lleva el control de cuáles ya se pagaron.

### Cómo se registra una factura

Hay tres caminos, y todos terminan igual: la factura queda **pendiente de pago**.

| Camino | Cuándo se usa | Cómo |
|---|---|---|
| **Automático** | El proveedor envía la factura al buzón con su XML | El sistema la registra solo (sección 12) |
| **Cargar XML** | Tienes los archivos a mano | *Facturas → Cargar XML*: eliges el XML (y el PDF) y los datos se leen solos |
| **Nueva factura** | No hay XML, solo un PDF o un papel | *Facturas → Nueva factura*: se escriben los datos a mano |

El **XML** es el archivo que SUNAT exige junto a la factura electrónica. De ahí se leen el RUC y la razón social del proveedor, la serie y el número, las fechas, la moneda, los importes y la guía de remisión, sin escribir nada. Si el proveedor no existe todavía, se crea con los datos del comprobante.

### Estados de una factura

- **Pendiente de pago** — recibida y correcta, esperando el pago. Si pasa su fecha de vencimiento se marca **Vencida** en rojo.
- **Pagada** — guarda la fecha, la referencia (número de operación) y quién la registró.
- **Observada** — devuelta al proveedor porque falta algo o los datos no coinciden. Se anota el motivo y el proveedor debe corregirla. Cuando la corrige, se **reactiva** y vuelve a la cola de pago.
- **Anulada** — el registro se hizo por error. No se borra: queda marcado y fuera de los totales.

Una factura pagada no se puede editar ni volver a pagar. Si el pago se registró por equivocación, se usa **Reabrir**, que deja constancia del motivo y devuelve la factura a pendiente.

### Marcar un pago

En *Facturas*, el botón **Pagar** de cada fila (o el del detalle) pide la fecha, la referencia y una observación opcional. Si dos personas intentan pagar la misma factura a la vez, el sistema solo acepta una.

### Plazos de pago: contado y crédito

Cada factura se paga en su propia fecha límite, según lo pactado con el proveedor.

| Condición | Desde cuándo corre el plazo | Plazo habitual |
|---|---|---|
| **Contado** | Desde que llega la factura por correo | 1 día |
| **Crédito** | Desde que el proveedor **además** entrega la guía de remisión en físico | 7 días |

El crédito exige que se cumplan **las dos** cosas —el correo y la guía en mano—, así que el plazo arranca en la más tardía de las dos fechas. Mientras no se anote la entrega de la guía, la factura **no tiene fecha de pago** y el sistema lo dice con todas sus letras: *Esperando la guía*.

**Anotar la guía** es lo que pone el reloj en marcha. Se hace desde la ficha de la factura, con el botón **Anotar guía**, poniendo el día en que el proveedor la trajo. El sistema calcula la fecha límite y la factura entra en la cola de pagos.

Cada proveedor tiene su **condición pactada** (en *Proveedores*), que se propone al registrar sus facturas y se puede cambiar factura por factura. Las que llegan por correo toman la condición del proveedor automáticamente.

Dónde lo ves:

| Lugar | Qué muestra |
|---|---|
| Dashboard | Tarjetas **Vencidas** y **Vencen en 3 días** |
| Dashboard → *Próximas a pagar* | Las siguientes en la cola, ordenadas por fecha límite |
| Facturas | Avisos de lo vencido y de lo que espera guía; en cada fila, cuándo vence y su condición |
| Detalle de la factura | La fecha límite, la condición, la fecha de la guía y por qué todavía no hay fecha |
| Calendario de pagos | Todo junto con las cuotas de préstamos y servicios |

Filtros rápidos: `?vencidas=1`, `?porvencer=1` (hoy y los próximos tres días) y `?singuia=1`. Todos están enlazados desde las tarjetas y los avisos.

**De dónde sale la fecha de llegada:** de las facturas que entran por correo, del momento en que llegó el mensaje. De las que registras a mano, del campo **Llegó el correo**, que por defecto es hoy y puedes retroceder si la factura llegó antes.

### Archivos

Cada factura guarda sus archivos (PDF, XML, guía de remisión, imágenes). Se ven y se descargan desde el detalle. Dónde se guardan depende de lo que configures en `.env`:

| Configuración | Dónde viven los archivos | Límite por archivo |
|---|---|---|
| Nada configurado | Dentro de la base de datos | 3 MB |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob | 15 MB |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Supabase Storage (bucket `facturas`) | 15 MB |

Para uso continuo conviene Vercel Blob o Supabase Storage: los PDF ocupan espacio y las bases de datos gratuitas son pequeñas. El cambio no requiere tocar código, solo añadir las variables; los archivos antiguos se siguen leyendo donde estén.

### Proveedores

En *Configuración → Proveedores* se gestionan las empresas que facturan. El RUC es único y tiene 11 dígitos. Los proveedores no se borran: se **desactivan**, y solo si no tienen facturas pendientes de pago.

---

## 12. Lectura automática del correo

Cuando está activada, cada factura que llega a `facturas@transjer.com` se registra sola y aparece en *Facturas* como pendiente de pago. La encargada solo revisa y marca el pago.

**Nada se pierde.** Si un correo no se puede registrar (no trae el XML, viene dañado, o la factura ya estaba registrada), queda en *Facturas → Correos* con sus archivos y el motivo, para revisarlo a mano.

### Cómo funciona

1. **Aviso instantáneo:** Microsoft avisa al sistema en cuanto llega un correo. El permiso para avisar dura casi 7 días y hay que renovarlo.
2. **Revisión diaria de respaldo:** una tarea programada renueva ese permiso y repasa el buzón por si algún aviso se perdió. Está configurada en `vercel.json` y corre de madrugada.
3. **Revisar ahora:** en cualquier momento se puede forzar una revisión desde *Facturas → Correos*.

> El plan gratuito (Hobby) de Vercel solo permite **una tarea programada al día**. Por eso el sistema usa el aviso instantáneo para lo urgente y deja la tarea diaria como respaldo. No hace falta el plan Pro.

### Qué debe hacer el administrador de Microsoft 365

Estos pasos los hace quien administra el correo de la empresa, una sola vez.

**1. Registrar la aplicación** (portal de Microsoft Entra ID → *App registrations* → *New registration*):

- Nombre: `Transjer EPP - Facturas`
- Tipo de cuenta: solo esta organización
- Sin URI de redirección

Al terminar, anota el **Directory (tenant) ID** y el **Application (client) ID**.

**2. Crear el secreto** (*Certificates & secrets* → *New client secret*). Copia el **Value** en ese momento: después ya no se puede ver. Anota también la fecha de caducidad, porque habrá que renovarlo.

**3. Dar el permiso** (*API permissions* → *Add a permission* → *Microsoft Graph* → **Application permissions** → `Mail.Read`). Luego pulsa **Grant admin consent**.

**4. Limitar el permiso a un solo buzón.** El paso anterior da acceso a *todos* los buzones de la organización, así que hay que acotarlo a `facturas@transjer.com`. Desde PowerShell de Exchange Online:

```powershell
New-ServicePrincipal -AppId <CLIENT-ID> -ObjectId <OBJECT-ID-DEL-SERVICE-PRINCIPAL> -DisplayName "Transjer EPP Facturas"

New-ManagementScope -Name "BuzonFacturas" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'facturas@transjer.com'"

New-ManagementRoleAssignment -App <CLIENT-ID> -Role "Application Mail.Read" -CustomResourceScope "BuzonFacturas"
```

Los cambios tardan entre 30 minutos y 2 horas en aplicarse. Puedes comprobarlo con `Test-ServicePrincipalAuthorization`.

### Qué debes configurar tú en Vercel

En **Settings → Environment Variables**:

| Variable | Valor |
|---|---|
| `GRAPH_TENANT_ID` | Directory (tenant) ID del paso 1 |
| `GRAPH_CLIENT_ID` | Application (client) ID del paso 1 |
| `GRAPH_CLIENT_SECRET` | El secreto del paso 2 |
| `INVOICE_MAILBOX` | `facturas@transjer.com` |
| `GRAPH_WEBHOOK_SECRET` | Genera una con `openssl rand -base64 24` |
| `CRON_SECRET` | Genera otra con `openssl rand -base64 24` |
| `APP_URL` | Solo si usas dominio propio, p. ej. `https://epp.transjer.pe` |

Vuelve a desplegar para que se apliquen. Después, entra a *Facturas → Correos* y:

1. **Probar conexión** — confirma que Microsoft acepta las credenciales y que la aplicación llega al buzón.
2. **Activar avisos** — a partir de ahí, las facturas que lleguen se registran solas.

### Mantenimiento

- **El secreto caduca** (normalmente en 6, 12 o 24 meses). Cuando se acerque la fecha, crea uno nuevo en Microsoft, actualiza `GRAPH_CLIENT_SECRET` en Vercel y vuelve a desplegar. Si caduca, *Correos* mostrará el error y las facturas dejarán de registrarse solas hasta que lo renueves; ninguna se pierde, quedan en el buzón y entran con **Revisar ahora**.
- **Si cambias el dominio**, actualiza `APP_URL`, desactiva y vuelve a activar los avisos, porque Microsoft guarda la dirección a la que avisa.

### Seguridad

- Las credenciales viven solo en las variables de entorno, nunca en la base de datos ni en el código.
- El permiso es de **solo lectura** y limitado a un único buzón: el sistema no puede enviar correos, borrarlos ni leer otros buzones.
- Cada aviso de Microsoft trae `GRAPH_WEBHOOK_SECRET`; si no coincide, se descarta.
- La tarea diaria exige `CRON_SECRET`.

---

## 12b. Préstamos y servicios

Además de las facturas de proveedores, el sistema lleva **todo lo que se paga mes a mes**: créditos del banco, planes de celular, luz, agua, internet, alquileres e impuestos. Están en *Préstamos y servicios*.

### Préstamos del banco

Se registra el préstamo (entidad, número de crédito, capital, TEA y fecha de desembolso) y después se carga su **cronograma**. Hay dos caminos:

**Pegar del banco** — el recomendable. Se copian las filas del PDF o del Excel del banco y se pegan tal cual. Cada banco ordena las columnas distinto, así que el sistema reconoce cuál es cuál por la forma de los números: la cuota es la columna que casi no varía, el capital sube cuota a cuota, el interés baja, y el saldo es mucho mayor y siempre desciende. La propuesta se muestra en pantalla **para corregirla antes de guardar**, así nunca se guarda una asignación equivocada en silencio.

Están probados los cuatro formatos que usa Transjer: BCP Crédito Negocios, Interbank Capital de Trabajo, Interbank Préstamo Fácil y Crédito Pyme. Dos detalles que el sistema resuelve solo:

- El BCP imprime el saldo **antes** del desglose y el Préstamo Fácil **después** de la cuota. Se distingue por aritmética y se guarda siempre como "lo que queda después de pagar".
- La columna de saldo nunca se confunde con la de la cuota, que es el error que haría cuadrar mal todo lo demás.

**Calcular** — para no tipear 24 filas cuando no se tiene el papel a mano. Usa la TEA sobre días reales con año de 360, que es como liquidan los bancos peruanos, así que el interés cuadra al céntimo con Interbank y con el Crédito Pyme. Es un borrador: según cómo cobre el banco el primer período puede desviarse unos soles, y conviene pegar el cronograma real en cuanto se tenga.

### Servicios de monto variable

La luz o el celular por consumo llegan con un importe distinto cada mes. Se registra el servicio con su **día de pago** y se marca *El importe cambia cada mes*: el sistema crea los vencimientos del próximo año y la encargada anota el monto cuando llega el recibo, con el botón **Importe**.

Las cuotas sin importe aparecen como *falta el recibo*, no se suman a los totales y el sistema avisa de cuántas hay pendientes. El botón **Extender un año** agrega otros doce meses cuando se acaban.

### Calendario de pagos

Junta en una sola lista, ordenada por fecha, **las facturas de proveedores y las cuotas de préstamos y servicios**. Es la vista que responde "cuánto tiene que salir de caja esta semana". Muestra primero lo vencido sin pagar, luego cada día con su total, y suma por separado cada moneda que aparezca.

## 13. Roles y permisos

| Acción | Administrador | Jefe de almacén | Usuario | Finanzas |
|---|:---:|:---:|:---:|:---:|
| Ver dashboard, inventario, movimientos, entregas y trabajadores | ✅ | ✅ | ✅ | — |
| Registrar entregas de EPP | ✅ | ✅ | ✅ | — |
| Registrar entradas y salidas | ✅ | ✅ | ✅ | — |
| Registrar ajustes de inventario | ✅ | ✅ | — | — |
| Anular entregas | ✅ | ✅ | — | — |
| Crear, editar y eliminar productos | ✅ | ✅ | — | — |
| Gestionar trabajadores | ✅ | ✅ | — | — |
| Gestionar categorías | ✅ | ✅ | — | — |
| Gestionar usuarios | ✅ | — | — | — |
| Ver auditoría | ✅ | — | — | — |
| Ver y exportar reportes | ✅ | ✅ | — | ✅ |
| Ver facturas de proveedores | ✅ | — | — | ✅ |
| Registrar y editar facturas | ✅ | — | — | ✅ |
| Marcar pagos | ✅ | — | — | ✅ |
| Gestionar proveedores | ✅ | — | — | ✅ |
| Ver préstamos y servicios | ✅ | — | — | ✅ |
| Registrar préstamos, servicios y cronogramas | ✅ | — | — | ✅ |
| Marcar el pago de una cuota | ✅ | — | — | ✅ |
| Configurar la lectura del correo | ✅ | — | — | — |

- **Jefe de almacén**: manda en todo el módulo de EPP (productos, categorías, trabajadores, ajustes y anulaciones), pero no ve facturas, usuarios ni auditoría.
- **Usuario**: el día a día del almacén — consulta, movimientos y entregas.
- **Finanzas**: la encargada de pagos. Gestiona las facturas, los préstamos y los servicios, y no entra al almacén.

Al elegir un rol en *Nuevo usuario*, el sistema explica en pantalla qué puede hacer.

Los permisos se definen en `src/lib/permissions.ts`. Para agregar un rol nuevo (por ejemplo, "Supervisor"):

1. Agrégalo al enum `role` en `src/db/schema.ts` y genera la migración.
2. Asígnale permisos en `ROLE_PERMISSIONS`.

Los permisos se validan **en el servidor** en cada página, acción y exportación. Ocultar un botón es solo comodidad visual.

## 14. Reglas de negocio

- **El stock solo cambia mediante movimientos** (entrada, salida o ajuste). No se puede editar directamente.
- **El stock nunca es negativo.** Lo impide la aplicación y también una restricción en la base de datos. Si dos personas registran salidas a la vez, el sistema bloquea la fila para que no se descuadre.
- **Cada entrega genera automáticamente una salida** y descuenta el stock, en una sola operación.
- **Las entregas no se borran, se anulan.** Solo un administrador puede anular una entrega registrada por error, con el botón 🚫 **Anular** en *Entregas* o en el historial del trabajador. Debe indicar el motivo. El sistema devuelve las unidades al stock con una entrada ("Anulación de entrega") y marca la entrega como **Anulada**, con fecha, responsable y motivo. Las anuladas siguen visibles (tachadas) pero no cuentan en los totales del trabajador, del dashboard ni de los reportes. Puedes filtrarlas con **Estado: Vigentes / Anuladas**.
- **El stock inicial** de un producto nuevo se registra como una entrada con motivo "Stock inicial".
- **Un ajuste** registra la diferencia entre el stock del sistema y el conteo físico.
- **La eliminación es lógica**: los productos, trabajadores y categorías se desactivan, pero su historial se conserva.
- **Estados de stock**: *Disponible* (por encima del mínimo), *⚠️ Stock bajo* (igual o por debajo del mínimo) y *🔴 Agotado* (cero).
- **Auditoría**: cada creación, edición, eliminación, movimiento e inicio de sesión queda registrado con el usuario, la fecha, la acción y los datos anteriores y nuevos. Las contraseñas nunca se guardan en la auditoría.
- **Zona horaria**: todas las fechas se muestran en hora de Lima (UTC−5).

Y en las facturas de proveedores:

- **No se registra dos veces el mismo comprobante.** La combinación proveedor + tipo + serie + número es única, tanto si se registra a mano como si llega por correo.
- **Las facturas no se borran**: se anulan, dejando el motivo y quién lo hizo.
- **Una factura pagada está cerrada**: no se edita ni se vuelve a pagar. Para corregir, se reabre primero.
- **El importe total siempre es mayor a cero** y la moneda solo puede ser soles o dólares (lo impide la base de datos).
- **Una factura pagada siempre tiene fecha de pago**, y una sin pagar nunca la tiene (también lo impide la base de datos).
- **Ningún correo se pierde**: el que no se pueda registrar queda en la bandeja con sus archivos y el motivo.
- **Cada factura vence según su condición**: al contado, un día desde que llegó el correo; a crédito, una semana desde que el proveedor entregó la guía en físico. Una factura a crédito sin guía anotada no tiene fecha de pago, y el sistema lo dice en vez de inventarse una.

Y en los préstamos y servicios:

- **El cronograma del banco manda**: la cuota, las fechas y el saldo se guardan tal como los imprime el papel, no recalculados.
- **Una cuota pagada está cerrada**: para corregirla hay que reabrirla, y queda en auditoría.
- **No se reemplaza un cronograma con cuotas ya pagadas.** El sistema se niega y dice cuántas hay.
- **Un préstamo se cierra solo** cuando se paga su última cuota, y vuelve a abrirse si se reabre esa cuota.
- **Un servicio de monto variable puede tener cuotas sin importe**: son los meses cuyo recibo todavía no llegó. No se suman a los totales y el sistema avisa de cuántas faltan.

## 15. Estructura del proyecto

```
drizzle/                 Migraciones SQL
scripts/                 migrate, seed, clear-demo, create-admin
src/
  app/
    login/               Inicio de sesión
    (app)/               Páginas protegidas: dashboard, inventario, movimientos,
                         entregas, trabajadores, categorías, usuarios, auditoría, reportes,
                         facturas, facturas/correos, proveedores, obligaciones, calendario
    api/export/          Descarga de reportes (Excel, CSV, PDF)
    api/facturas/        Descarga de los archivos adjuntos de las facturas
    api/correo/graph/    Aviso instantáneo de Microsoft 365 (webhook)
    api/cron/facturas/   Tarea diaria: renueva los avisos y repasa el buzón
  actions/               Server Actions (crear, editar, eliminar…)
  components/            Interfaz: ui/ (base), layout/, inventory/, deliveries/…
  db/                    Esquema y conexión
  lib/                   Sesión, permisos, auditoría, validaciones, utilidades
                         amortization.ts (cronogramas de préstamos y lectura del papel del banco)
  server/                Consultas, lógica de inventario, reportes y exportadores
                         invoice-*.ts (facturas), sunat-xml.ts (lectura del XML),
                         obligation-queries.ts (préstamos, servicios y calendario de pagos),
                         graph.ts (Microsoft 365), storage.ts (archivos adjuntos)
  middleware.ts          Protección de rutas
tests/                   Pruebas automáticas
vercel.json              Tarea diaria programada
```

---

## 15b. Identidad visual

Los archivos oficiales del logotipo están en `public/`:

| Archivo | Para qué |
|---|---|
| `logo.png` | Logotipo completo, fondo claro (login) |
| `logo-blanco.png` | El mismo con el texto en blanco, fondo oscuro (menú lateral) |
| `logo-tj.png` | Solo el monograma TJ, para espacios estrechos (cabecera móvil) |
| `icon.png` | Ícono de la pestaña del navegador |

Todo se usa desde `src/components/layout/brand.tsx`. Si la empresa cambia el logotipo, reemplaza los archivos de `public/` respetando los nombres y no hay que tocar código.

---

## 16. Pruebas

```bash
npm test          # XML de SUNAT, plazos de pago, cronogramas de préstamos y correos
```

Las pruebas de interfaz usan Playwright contra el sistema en marcha:

```bash
npm run build && npm start          # en otra terminal
python3 tests/e2e-epp.py            # almacén: inventario, movimientos, entregas, permisos
python3 tests/e2e-facturas.py       # facturas: registro, pagos, plazos, correos, permisos, móvil
python3 tests/e2e-obligaciones.py   # plazos de contado y crédito, préstamos, servicios y calendario
```

Si tu base no se llama `epp`, pásaselo: `E2E_DB=mibase python3 tests/e2e-facturas.py`.

Las suites se pueden repetir las veces que haga falta: cada una limpia lo que crea. Necesitan la base con datos de prueba (`npm run db:seed:demo`).

## 17. Solución de problemas

**`Falta la variable de entorno DATABASE_URL`**
No existe `.env` o está en otra carpeta. En Vercel, revisa **Settings → Environment Variables** y vuelve a desplegar: los cambios de variables solo se aplican en un despliegue nuevo.

**`invalid input value for enum role` o "La base de datos está desactualizada"**
Publicaste el código nuevo sin aplicar las migraciones en esa base. Ejecuta `npm run db:migrate` con el `.env` apuntando a ella y reinicia el servidor. Pasa cuando se agrega un rol o un estado nuevo.

**`relation "users" does not exist`**
No se ejecutaron las migraciones en esa base de datos: `npm run db:migrate`.

**No puedo iniciar sesión**
Restablece la contraseña con `npm run admin:create -- --email ... --password ...` (ver sección 6). Si cambiaste `AUTH_SECRET`, todas las sesiones anteriores se cierran; es normal.

**`prepared statement ... already exists`**
Estás usando una versión modificada de `src/db/index.ts`. La conexión debe mantener `prepare: false`.

**Errores de conexión o timeouts en las migraciones**
Usa la cadena **directa** en `DIRECT_URL`, no la del pooler.

**Las facturas no se registran solas**
Entra a *Facturas → Correos*: ahí se ve si falta configurar algo, si los avisos están activos y cuál fue el último error. Pulsa **Probar conexión**. Si el secreto de Microsoft caducó, créalo de nuevo y actualiza `GRAPH_CLIENT_SECRET` en Vercel. Mientras tanto, **Revisar ahora** recupera los correos pendientes.

**`Sin permiso para leer el buzón ...`**
Falta el permiso `Mail.Read` con consentimiento del administrador, o la aplicación no está autorizada sobre ese buzón (paso 4 de la sección 12). Los cambios de permisos tardan hasta 2 horas en aplicarse.

**Un correo quedó "Por revisar"**
Es normal cuando el proveedor no adjuntó el XML o mandó solo el PDF. Desde la bandeja puedes **Registrar** la factura a mano (los archivos del correo se adjuntan solos), **Reintentar** o **Descartar** el correo.

**`El archivo supera el máximo permitido`**
Estás guardando los adjuntos dentro de la base de datos, donde el límite es 3 MB. Configura Vercel Blob o Supabase Storage (sección 11) para subir a 15 MB.

**El primer inicio de sesión tarda unos segundos**
Es normal en planes gratuitos: la base de datos se "despierta" tras un tiempo sin uso.

---

Transjer Operador Logístico S.A.C. · Control de Inventario de EPP
