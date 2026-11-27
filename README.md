# APPCLASE

APPCLASE es una plataforma educativa web instalable para centros educativos, academias y clases particulares. La interfaz usa **React + TypeScript + Vite**, Tailwind CSS y componentes propios basados en patrones de shadcn/ui. La API se ejecuta en Cloudflare Pages Functions; los datos y las sesiones viven en Cloudflare D1.

## Estado del producto

La aplicación ya tiene acceso por correo y contraseña, alta de cuentas, activación obligatoria de cuentas docentes con contraseña temporal y código del centro, perfiles por rol, centros, clases, gestión de miembros, tablón, materiales, tareas, exámenes de opción múltiple, calendario, notas, asistencia, mensajes, avisos y exportaciones de calendario/notas donde la API ya las ofrece. La navegación, panel y áreas de trabajo cambian entre administración de plataforma, profesorado y alumnado.

La API valida permisos en el servidor; ocultar una opción en la interfaz no concede ni revoca acceso. Las rutas y tablas existentes de D1 se conservan durante esta migración.

El producto aún requiere trabajo antes de comercializarlo con centros reales: activar y probar los servicios de correo y documentos en producción, definir la retención de datos y completar las pruebas de accesibilidad y la revisión de privacidad aplicable a cada centro. Los archivos de materiales requieren configurar un bucket R2 privado; el binding no está activado en este repositorio. No se deben cargar datos reales de menores hasta completar las revisiones del centro y de privacidad.

## Arquitectura

```text
src/                         React, TypeScript, rutas y experiencia por rol
src/lib/api.ts               Cliente HTTP same-origin con cookie de sesión
functions/api/[[path]].ts    Enrutador Cloudflare Pages Functions
server/*.ts                  Servicios de dominio, autenticación y validaciones
migrations/*.sql             Esquema D1 versionado
public/                      Manifest, iconos, service worker y cabeceras
scripts/                     Pruebas de API, PWA y humo en Wrangler
```

Las cuentas, centros, membresías y datos académicos mantienen el esquema D1 actual. Las sesiones usan cookies `HttpOnly`, `SameSite=Lax` y `Secure` bajo HTTPS. La PWA guarda el shell y recursos estáticos permitidos; nunca almacena las respuestas de `/api` en caché.

## Requisitos

- Node.js 24 LTS.
- npm 11 o compatible.
- Wrangler 4 para Pages y D1 local/remoto.

## Ejecución local

```sh
npm ci
npm run dev
```

Para probar la API y D1 en el mismo origen de Pages:

```sh
npm run build
npx wrangler pages dev build/web --port 8788
```

Abre `http://localhost:8788`. Las migraciones locales se aplican con:

```sh
npx wrangler d1 migrations apply appclase --local
```

Para inspeccionar las rutas Pages y D1 con datos efímeros, ejecuta `bash scripts/cloudflare-smoke.sh`.

## Pruebas y compilación

```sh
npm run build
npm test
```

`npm run build` comprueba los componentes React y TypeScript de cliente y API, y genera el sitio estático en `build/web`. `npm test` ejecuta las pruebas de API con SQLite local y las comprobaciones del manifest/service worker. GitHub Actions ejecuta también una prueba de humo con Wrangler Pages y D1.

## Configuración de Cloudflare

1. Crea una base D1 llamada `appclase` y configura su UUID en `wrangler.toml` para el entorno que corresponda.
2. Aplica las migraciones con `npx wrangler d1 migrations apply appclase --remote`.
3. Crea el proyecto Pages `appclase` y conecta el repositorio o publica el artefacto `build/web`.
4. En GitHub, guarda `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` como secretos del entorno `production`. No los pongas en `VITE_*`, código del navegador ni el repositorio.
5. El despliegue continuo queda condicionado a `APPCLASE_DEPLOY=true`; si no está habilitado, CI solo verifica y genera el artefacto. Pages aplica HTTPS y permite conectar un dominio personalizado desde el panel de Cloudflare.
6. Para archivos, configura un bucket R2 privado y habilita el binding `DOCUMENTS` solo tras revisar límites, acceso y coste.

`secretos.env.example` es una plantilla local sin secretos. El archivo `secretos.env` está excluido de Git. No actives servicios con facturación sin revisar primero límites y precios vigentes.

## Primer centro y administración

El usuario autorizado se registra y un operador con acceso administrativo a D1 le asigna el rol de plataforma una sola vez. El administrador inicial ya provisionado no requiere repetir este paso. En una instalación nueva, sustituye el correo por el de la cuenta que acabas de verificar:

```sql
INSERT OR IGNORE INTO platform_administrators (user_id)
SELECT id FROM users WHERE email = lower('admin@centro.es');
```

Ejecuta ese SQL únicamente en la D1 correcta y comprueba que devuelve una fila. No se permite autoasignar privilegios desde el navegador. El administrador global crea centros y cuentas docentes desde APPCLASE; la contraseña temporal se muestra una sola vez y el docente debe conocer también el código del centro para el primer acceso. El profesor solo gestiona las clases y el alumnado que permite su asociación en D1.

## Seguridad y privacidad

- Las comprobaciones de rol y pertenencia ocurren en Pages Functions antes de consultar o modificar los datos.
- Los cambios POST validan el origen y la API aplica validación y límites de longitud/valor.
- Las contraseñas se derivan con PBKDF2 y las sesiones almacenan hashes de token.
- Las respuestas de examen no publican las claves correctas en el navegador.
- Los datos académicos no se cachean en el service worker.
- Antes de operar con alumnado real, revisa RGPD/LOPDGDD, contratos con encargados, retención y eliminación, permisos del personal, avisos de privacidad y procedimiento ante incidentes con el centro.

## Costes y límites

Pages, Workers y D1 pueden servir un piloto dentro de las cuotas gratuitas vigentes, sujetas a cambios y límites de uso. R2 puede facturar si se exceden sus cuotas o condiciones. El código no activa servicios adicionales facturables. La entrega de correo, push, respaldo operativo y alto volumen pueden requerir proveedores o planes adicionales.

## Diagnóstico

- `401` al consultar la sesión: inicia sesión otra vez o comprueba que Pages y la API comparten el mismo origen.
- No aparece un centro o clase: revisa las asociaciones y estado activo en D1; la interfaz no sustituye las reglas del servidor.
- El primer acceso docente falla: verifica correo, contraseña temporal, código del centro y asociación activa.
- Una publicación no aparece tras desplegar: actualiza el service worker cerrando pestañas APPCLASE antiguas y vuelve a abrir la web.
- Error de esquema D1: aplica las migraciones al mismo binding que está configurado en el proyecto Pages.

### Correo de cuenta

La recuperación de contraseña aparece cuando el entorno de Pages tiene
`APP_ORIGIN` con el origen público de APPCLASE, `ACCOUNT_EMAIL_FROM` con
el remitente verificado y `RESEND_API_KEY` como secreto. Estos valores
son de ejecución y deben configurarse en el entorno de Cloudflare. Prueba
el flujo con cuentas de prueba antes de habilitarlos para el alumnado.
Los enlaces caducan a los 30 minutos y se consumen una sola vez.

En el aula, `Videoclases y PDF` admite PDF de hasta 16 MB y vídeos MP4 o WebM de hasta 48 MB con el bucket `DOCUMENTS` activo. Los vídeos se sirven con peticiones por rangos. El profesorado puede mostrar las videoclases, PDF y exámenes en Agenda con un candado u ocultarlos hasta la apertura. La API aplica estas reglas también a las descargas directas. La pestaña Mensajes conecta de forma privada al profesor responsable con cada alumno de la clase.
