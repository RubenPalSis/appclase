import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:web/web.dart' as web;

import '../../core/api.dart';
import '../../core/widgets.dart';
import '../../main.dart' show ThemeButton;
import '../notifications/notifications_page.dart';

class AccessPage extends StatelessWidget {
  const AccessPage({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(actions: const [ThemeButton()]),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(24),
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: CircleAvatar(
                  radius: 32,
                  backgroundColor: theme.colorScheme.primaryContainer,
                  child: Icon(
                    Icons.school_outlined,
                    color: theme.colorScheme.onPrimaryContainer,
                    size: 34,
                  ),
                ),
              ),
              const SizedBox(height: 28),
              Text(
                'APPCLASE',
                style: theme.textTheme.displaySmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'Tus clases, materiales y entregas en un mismo lugar.',
                style: theme.textTheme.titleMedium,
              ),
              if (Uri.base.queryParameters['acceso'] == 'cancelado')
                const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: Text('No se pudo completar el inicio de sesión.'),
                ),
              const SizedBox(height: 28),
              FilledButton.icon(
                onPressed: () {
                  final invitation = Uri.base.queryParameters['invitacion'];
                  if (invitation != null) {
                    web.window.sessionStorage.setItem(
                      'appclase.invitation',
                      invitation,
                    );
                  }
                  web.window.location.assign('/api/auth/google');
                },
                icon: const Icon(Icons.login_rounded),
                label: const Text('Continuar con Google'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  Future<void> join(BuildContext context, WidgetRef ref) => editFields(
    context,
    title: 'Unirse a una clase',
    fields: [
      field(
        'code',
        'Código de invitación',
        24,
        initial:
            Uri.base.queryParameters['invitacion'] ??
            web.window.sessionStorage.getItem('appclase.invitation'),
      ),
    ],
    save: (data) async {
      await ref.read(apiProvider).post('/join', data);
      web.window.sessionStorage.removeItem('appclase.invitation');
      ref.invalidate(classesProvider);
      ref.invalidate(sessionProvider);
    },
  );

  Future<void> create(
    BuildContext context,
    WidgetRef ref,
    Record organization,
  ) => editFields(
    context,
    title: 'Nueva clase · ${organization['name']}',
    fields: [
      field('name', 'Nombre de la clase', 120),
      field('subject', 'Asignatura', 120),
      field('academic_year', 'Curso académico', 30),
      field('description', 'Descripción', 2000, optional: true),
    ],
    save: (data) async {
      await ref.read(apiProvider).post('/classes', {
        ...data,
        'org_id': organization['id'],
      });
      ref.invalidate(classesProvider);
    },
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).value!;
    final user = session['user'] as Record;
    final organizations = (session['organizations'] as List).cast<Record>();
    final staff = organizations
        .where((org) => org['role'] != 'student')
        .toList();
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('APPCLASE'),
        actions: [
          const ThemeButton(),
          const NotificationsButton(),
          IconButton(
            tooltip: 'Cerrar sesión',
            icon: const Icon(Icons.logout_rounded),
            onPressed: () async {
              try {
                await ref.read(apiProvider).post('/logout');
                ref.invalidate(classesProvider);
                ref.invalidate(courseProvider);
                ref.invalidate(rowsProvider);
                ref.invalidate(sessionProvider);
              } catch (error) {
                if (context.mounted) showMessage(context, errorMessage(error));
              }
            },
          ),
        ],
      ),
      body: PageContent(
        children: [
          Card(
            color: theme.colorScheme.primaryContainer,
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Hola, ${user['name']}',
                    style: theme.textTheme.headlineMedium?.copyWith(
                      color: theme.colorScheme.onPrimaryContainer,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 12,
                    runSpacing: 8,
                    children: [
                      FilledButton.icon(
                        onPressed: () => join(context, ref),
                        icon: const Icon(Icons.group_add_outlined),
                        label: const Text('Unirse a una clase'),
                      ),
                      if (staff.isNotEmpty)
                        PopupMenuButton<Record>(
                          onSelected: (org) => create(context, ref, org),
                          itemBuilder: (_) => [
                            for (final org in staff)
                              PopupMenuItem(
                                value: org,
                                child: Text(org['name'] as String),
                              ),
                          ],
                          child: const Padding(
                            padding: EdgeInsets.all(12),
                            child: Text('Crear clase'),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          for (final org in organizations.where(
            (org) => org['role'] == 'admin',
          ))
            Card(
              child: ListTile(
                leading: const Icon(Icons.admin_panel_settings_outlined),
                title: Text(org['name'] as String),
                subtitle: const Text('Administrar centro'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/centros/${org['id']}'),
              ),
            ),
          Text('Mis clases', style: theme.textTheme.headlineSmall),
          const SizedBox(height: 10),
          ref
              .watch(classesProvider)
              .when(
                loading: () => const LinearProgressIndicator(),
                error: (error, _) => LoadError(
                  errorMessage(error),
                  () => ref.invalidate(classesProvider),
                ),
                data: (classes) => classes.isEmpty
                    ? const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Text(
                          'Todavía no tienes clases. Puedes unirte con el código de tu profesor.',
                        ),
                      )
                    : LayoutBuilder(
                        builder: (context, constraints) {
                          final wide = constraints.maxWidth >= 680;
                          return Wrap(
                            spacing: 12,
                            runSpacing: 12,
                            children: [
                              for (final course in classes)
                                SizedBox(
                                  width: wide
                                      ? (constraints.maxWidth - 12) / 2
                                      : constraints.maxWidth,
                                  child: Card(
                                    child: ListTile(
                                      contentPadding: const EdgeInsets.all(16),
                                      leading: const CircleAvatar(
                                        child: Icon(Icons.school_outlined),
                                      ),
                                      title: Text(course['name'] as String),
                                      subtitle: Text(
                                        '${course['subject']} · ${course['organization']}${course['archived'] == 1 ? ' · Archivada' : ''}',
                                      ),
                                      trailing: const Icon(Icons.chevron_right),
                                      onTap: () => context.push(
                                        '/clases/${course['id']}',
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          );
                        },
                      ),
              ),
        ],
      ),
    );
  }
}
