# APPCLASE

Plataforma educativa web instalable escrita en Flutter y Dart. La aplicación y la API comparten origen en Cloudflare Pages. La API usa Pages Functions, que se ejecuta en el runtime de Workers, y almacena sus datos en D1.

## Funciones incluidas

- Google OAuth con PKCE, correo verificado y sesiones HttpOnly. Revocación de la sesión al cerrar sesión.
- Roles de administrador, profesor y alumno por centro. El administrador puede acceder a las clases del centro. El profesor solo accede a las clases de las que es responsable. El alumno necesita estar matriculado.
- Administración de accesos de profesores y alumnos, nombre de centro e historial administrativo.
- Creación y archivo de clases, invitaciones revocables vía rotación con caducidad de siete días y listado de alumnos.
- Tablón de anuncios y materiales mediante enlaces HTTPS.
- Tareas individuales con fecha límite, entregas de texto o enlace, corrección y feedback privado.
- Exámenes de respuesta única, con apertura y cierre, temporizador, intentos limitados, guardado en el servidor y corrección automática. Las claves de respuesta se quedan en el servidor. El alumno ve su puntuación después del cierre.
- Registro de asistencia por fecha y consulta privada por alumno.
- Interfaz adaptable y modos de color. El service worker guarda solo el código y los recursos estáticos. La API académica requiere conexión.

La versión actual requiere más desarrollo para cubrir todos los requisitos. Faltan la creación de centros desde la interfaz, el acceso por correo y contraseña, archivos privados con R2, temario jerárquico, comentarios, el cuaderno completo, calendario, mensajería, push, sincronización académica sin conexión, los estilos adicionales de examen y los flujos de exportación y eliminación de datos personales. Las listas devuelven hasta 100 registros y necesitan paginación para centros con más volumen. La instalación en distintos navegadores, la accesibilidad y los flujos OAuth y D1 remotos deben validarse antes de un piloto. No utilizar datos reales de alumnado hasta completar esa revisión y las medidas de privacidad del centro.

## Código y datos

| Ruta | Responsabilidad |
| --- | --- |
| `lib/core` | Cliente HTTP, proveedores Riverpod y componentes comunes |
| `lib/features` | Sesión, panel, clases y trabajo académico |
| `functions/api` | Enrutamiento HTTP de Pages Functions |
| `server` | Autenticación, permisos y operaciones de clases y evaluación |
| `migrations` | Esquema SQL versionado con índices y claves externas |
| `web` | Manifest, recursos, página inicial y cabeceras |
| `scripts` | Generación del service worker y pruebas de API |
| `.github/workflows` | Verificación y despliegue opcional |

Las tablas de pertenencia separan organización y clase. Las sesiones contienen hashes de tokens con caducidad. Las notas y los intentos se relacionan con el alumno y la tarea o examen. Las operaciones de archivo e invitación se registran en auditoría. El navegador utiliza la misma API para todos los roles y la autorización se verifica contra D1 en el servidor.

## Desarrollo local

Requisitos: Flutter 3.50.1 estable, Dart 3.14, Node.js 24, Google Chrome para el test de widgets y Wrangler 4.

```sh
cp -n secretos.env.example secretos.env
flutter pub get
flutter analyze
flutter test --platform chrome
node --test scripts/api.test.mjs
flutter build web
node scripts/build_pwa.mjs
npx --yes wrangler@4 d1 migrations apply appclase --local
npx --yes wrangler@4 pages dev build/web --port 8788
```

La API y Flutter deben abrirse desde el mismo origen, por ejemplo `http://localhost:8788`. Para OAuth local, crea un cliente OAuth web y registra exactamente `http://localhost:8788/api/auth/callback`. Copia `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `APP_ORIGIN=http://localhost:8788` a `.dev.vars` para Wrangler. `secretos.env` sirve para preparar la configuración y permanece excluido de Git. No cargues los tokens de despliegue en el navegador ni en `.dev.vars`.

Las pruebas de API ejecutan las migraciones y el manejador real sobre SQLite local. La capa D1 de prueba simula su interfaz. Para comprobar OAuth y la integración con Wrangler, inicia sesión desde la PWA y recorre los flujos con dos cuentas en el mismo centro y una tercera en otro centro.

## Primer centro y administrador

Tras el primer acceso válido con Google, identifica al usuario por su correo verificado. Ejecuta manualmente esta inicialización en la consola D1 de tu entorno, sustituyendo el correo de ejemplo. Úsala únicamente con un administrador autorizado.

```sql
INSERT INTO organizations (id, name) VALUES ('centro-inicial', 'Mi centro');
INSERT INTO memberships (org_id, user_id, role)
SELECT 'centro-inicial', id, 'admin' FROM users WHERE email='admin@example.com';
```

Para conceder el rol de profesor, añade una pertenencia `teacher` al centro después de comprobar el correo verificado del usuario. Las invitaciones de clase solo pueden crear pertenencias de alumno. Ningún parámetro de registro otorga privilegios.

## Despliegue previsto

1. Crea una base D1 denominada `appclase` y sustituye su UUID de marcador en `wrangler.toml`. Usa otra base y otro proyecto Pages para pruebas remotas.
2. Crea un proyecto Pages de Direct Upload denominado `appclase`. Se puede conectar un dominio personalizado desde Pages y activar HTTPS.
3. Configura `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `APP_ORIGIN` en Cloudflare. Registra `<APP_ORIGIN>/api/auth/callback` en Google Cloud. Si el cliente OAuth está en pruebas, añade las cuentas de prueba en Google.
4. Añade `CLOUDFLARE_ACCOUNT_ID` y un `CLOUDFLARE_API_TOKEN` con el acceso mínimo a Pages y D1 a los secretos del entorno `production` de GitHub. Activa `APPCLASE_DEPLOY=true` como variable del repositorio cuando la infraestructura esté lista.
5. La acción aplica las migraciones y publica el resultado de Flutter y las Functions. La navegación SPA usa el fallback de Pages a `index.html`. El service worker precarga la versión estática nueva y la utiliza tras cerrar las pestañas que mantienen activa la versión anterior.

Workers, Pages y D1 disponen de cuotas gratuitas sujetas a límites. R2 requiere suscripción y puede facturar por exceso. Este código no crea recursos ni habilita servicios facturables.

## Diagnóstico

- Si el botón de Google abre un error de configuración, revisa las variables del Worker, el dominio exacto y el URI de redirección.
- Si ha iniciado sesión y no aparecen centros, comprueba la pertenencia en D1. Un alumno también puede entrar con una invitación vigente.
- Si la nueva versión todavía no se muestra, cierra las demás pestañas de APPCLASE y abre la web de nuevo.
- Si D1 devuelve un error tras un cambio de esquema, comprueba en Wrangler que aplicaste las migraciones al mismo entorno que usa Pages.
