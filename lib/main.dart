import 'package:material_ui/material_ui.dart';
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/api.dart';
import 'core/widgets.dart';
import 'features/access/access.dart';
import 'features/classes/class_page.dart';
import 'features/notifications/notifications_page.dart';
import 'features/organizations/organization_page.dart';

void main() {
  usePathUrlStrategy();
  runApp(const ProviderScope(child: AppClase()));
}

final router = GoRouter(
  routes: [
    GoRoute(
      path: '/',
      builder: (_, _) => const SessionGate(child: HomePage()),
    ),
    GoRoute(
      path: '/avisos',
      builder: (_, _) => const SessionGate(child: NotificationsPage()),
    ),
    GoRoute(
      path: '/centros/:id',
      builder: (_, state) =>
          SessionGate(child: OrganizationPage(id: state.pathParameters['id']!)),
    ),
    GoRoute(
      path: '/clases/:id',
      builder: (_, state) =>
          SessionGate(child: ClassPage(id: state.pathParameters['id']!)),
    ),
  ],
);

final themeProvider = NotifierProvider<ThemeController, ThemeMode>(
  ThemeController.new,
);

class ThemeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() => ThemeMode.system;

  void toggle(Brightness current) =>
      state = current == Brightness.dark ? ThemeMode.light : ThemeMode.dark;
}

class AppClase extends ConsumerWidget {
  const AppClase({super.key});

  ThemeData theme(Brightness brightness) => ThemeData(
    colorScheme: ColorScheme.fromSeed(
      seedColor: const Color(0xFF176A54),
      brightness: brightness,
    ),
    useMaterial3: true,
    inputDecorationTheme: const InputDecorationThemeData(
      border: OutlineInputBorder(),
    ),
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp.router(
    title: 'APPCLASE',
    debugShowCheckedModeBanner: false,
    theme: theme(Brightness.light),
    darkTheme: theme(Brightness.dark),
    themeMode: ref.watch(themeProvider),
    routerConfig: router,
    locale: const Locale('es'),
    supportedLocales: const [Locale('es')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
  );
}

class SessionGate extends ConsumerWidget {
  const SessionGate({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) => ref
      .watch(sessionProvider)
      .when(
        data: (session) {
          if (session == null) return const AccessPage();
          if ((session['user'] as Record)['must_change'] == 1) return const ActivateAccountPage();
          return child;
        },
        loading: () =>
            const Scaffold(body: Center(child: CircularProgressIndicator())),
        error: (error, _) => Scaffold(
          body: LoadError(
            errorMessage(error),
            () => ref.invalidate(sessionProvider),
          ),
        ),
      );
}

class ThemeButton extends ConsumerWidget {
  const ThemeButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => IconButton(
    tooltip: 'Cambiar modo de color',
    onPressed: () =>
        ref.read(themeProvider.notifier).toggle(Theme.of(context).brightness),
    icon: const Icon(Icons.contrast_rounded),
  );
}

class ActivateAccountPage extends ConsumerWidget {
  const ActivateAccountPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    appBar: AppBar(title: const Text('Activa tu cuenta docente')),
    body: PageContent(children: [
      const Text('Elige una contraseña nueva de al menos 12 caracteres para acceder a tu centro.'),
      const SizedBox(height: 16),
      FilledButton(
        onPressed: () => editFields(context, title: 'Nueva contraseña',
          fields: [field('password', 'Nueva contraseña', 128)],
          save: (data) async {
            await ref.read(apiProvider).post('/auth/activate', data);
            ref.invalidate(sessionProvider);
          },
        ),
        child: const Text('Establecer contraseña'),
      ),
    ]),
  );
}
