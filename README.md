# Escuela de Tenis · Club de Amigos — versión web con login real

Esta es la versión **online** de la app: corre en un servidor, guarda todo en una **base de datos** y tiene **login real** (contraseñas encriptadas). Varias personas entran desde cualquier lugar con un **enlace**, ven los mismos datos y cada una accede según su rol (Director, Administrativo, Profesor/a).

Trae cargados los **479 alumnos** migrados de tu Excel.

---

## Lo que necesitás (todo gratis)

1. Una cuenta en **Neon** (la base de datos PostgreSQL) → https://neon.tech
2. Una cuenta en **Render** (donde vive la app) → https://render.com
3. Una cuenta en **GitHub** (para subir el código) → https://github.com

Las tres tienen plan gratuito suficiente para una escuela. No hace falta tarjeta de crédito en Neon ni en Render (plan free).

---

## Paso a paso para publicarla

### 1) Subir el código a GitHub
- Entrá a GitHub, creá un repositorio nuevo (botón **New**), por ejemplo `club-amigos-tenis`.
- Subí **todo el contenido de esta carpeta** (botón *Add file → Upload files*, arrastrás los archivos).
  - No subas las carpetas `node_modules` ni `data` si aparecen (ya están excluidas por `.gitignore`).

### 2) Crear la base de datos en Neon
- Entrá a https://neon.tech y registrate (podés usar tu cuenta de Google).
- Creá un proyecto (**Create project**). Elegí la región más cercana.
- Cuando termine, te muestra una **Connection string** que empieza con `postgresql://...`
  → **Copiala**, la vas a pegar en el paso siguiente. (Si te da varias, usá la que dice *Pooled connection*.)

### 3) Publicar la app en Render
- Entrá a https://render.com y registrate con tu cuenta de GitHub.
- Botón **New → Web Service** y elegí el repositorio que subiste.
- Render detecta Node automáticamente. Verificá:
  - **Build Command:** `npm install`
  - **Start Command:** `npm start`
  - **Instance Type:** **Free**
- Abrí **Advanced / Environment Variables** y agregá dos variables:
  - `DATABASE_URL` → pegá la connection string que copiaste de Neon.
  - `JWT_SECRET` → cualquier texto largo y al azar (por ejemplo, aporreá el teclado 40+ caracteres).
- Dale **Create Web Service** y esperá unos minutos. Cuando termine, Render te da el **enlace** (algo como `https://club-amigos-tenis.onrender.com`). **Ese es el link** que compartís con tu equipo.

### 4) Primer ingreso
- Abrí el enlace. Entrá con:
  - **Usuario:** `director`  ·  **Contraseña:** `director`
- Andá a la pestaña **Usuarios** y:
  1. Editá tu usuario director y **cambiá la contraseña** por una tuya.
  2. Creá los usuarios para administración y para cada profe (rol Profesor/a, vinculado a su nombre).

¡Listo! Ya está online, con login real y datos compartidos.

> Nota del plan gratuito de Render: si nadie usa la app por un rato, el servidor "se duerme" y la primera visita puede tardar ~30 segundos en despertar. Los datos **no se pierden** (viven en Neon). Si molesta, se soluciona con un plan pago bajo.

---

## Roles y permisos

| Acción | Director/Coordinador | Administrativo | Profesor/a |
|---|:--:|:--:|:--:|
| Ver alumnos, canchas, profesores | ✅ | ✅ | ✅ |
| Crear / editar alumnos | ✅ | ✅ | — |
| Eliminar alumnos | ✅ | — | — |
| Tomar asistencia | ✅ | ✅ | ✅ |
| Cargar observaciones | ✅ | ✅ | ✅ |
| Configuración (canchas, profes, etc.) | ✅ | — | — |
| Gestionar usuarios | ✅ | — | — |
| Respaldar (descargar copia) | ✅ | ✅ | — |

Los permisos se controlan **en el servidor**, así que nadie puede saltárselos desde el navegador.

---

## Probarla en tu computadora (opcional, sin nube)

Si querés verla funcionar antes de publicarla:

1. Instalá Node.js (https://nodejs.org).
2. En esta carpeta, abrí una terminal y ejecutá:
   ```
   npm install
   npm start
   ```
3. Abrí http://localhost:3000 y entrá con `director` / `director`.

Sin `DATABASE_URL`, la app guarda los datos en un archivo local `data/db.json` (perfecto para probar). En producción usás Neon.

---

## Cambiar el logo por el oficial
El logo está dibujado dentro de `public/index.html` (es un gráfico SVG en el encabezado). Si querés el archivo oficial del club, mandámelo y lo reemplazo, o cualquier persona con conocimientos puede sustituir ese bloque por una etiqueta `<img>`.

---

## Seguridad
- Las contraseñas se guardan **encriptadas** (bcrypt), nunca en texto plano.
- Las sesiones usan tokens firmados (JWT) con tu `JWT_SECRET`.
- Render sirve todo por **HTTPS**.
- Recomendado: cambiar la contraseña del director en el primer ingreso y usar contraseñas distintas por persona.

## Estructura del proyecto
```
server.js        → servidor y API (login, alumnos, asistencia, usuarios)
store.js         → base de datos (PostgreSQL en producción / archivo JSON en local)
seed-data.json   → los 479 alumnos migrados del Excel + configuración inicial
public/index.html→ la página (frontend)
package.json     → dependencias
render.yaml      → configuración opcional para Render
```
