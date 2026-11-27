import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:web/web.dart' as web;

import '../../core/api.dart';
import '../../core/widgets.dart';
import '../../main.dart' show ThemeButton;
import '../classes/coursework.dart';
import '../notifications/notifications_page.dart';

class AccessPage extends ConsumerWidget {
  const AccessPage({super.key});

  Future<void> credentials(BuildContext context, WidgetRef ref, bool register) =>
      editFields(
        context,
        title: register ? 'Crear cuenta' : 'Iniciar sesión',
        fields: [
          if (register) field('name', 'Nombre', 160),
          field('email', 'Correo electrónico', 254),
          if (!register) field('center_code', 'Código del centro (primer acceso docente)', 4, optional: true),
          field('password', 'Contraseña', 128),
        ],
        save: (data) async {
          await ref.read(apiProvider).post(
            register ? '/auth/register' : '/auth/login', data,
          );
          ref.invalidate(sessionProvider);
        },
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
              const SizedBox(height: 28),
              FilledButton(
                onPressed: () => credentials(context, ref, false),
                child: const Text('Iniciar sesión'),
              ),
              TextButton(
                onPressed: () => credentials(context, ref, true),
                child: const Text('Crear cuenta'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class HomePage extends ConsumerStatefulWidget {
  const HomePage({super.key});

  @override
  ConsumerState<HomePage> createState() => _HomePageState();
}

class _HomePageState extends ConsumerState<HomePage> {
  int selected = 0;

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

  Future<void> createCenter() => editFields(
    context,
    title: 'Nuevo centro',
    fields: [field('name', 'Nombre del centro', 120)],
    save: (data) async {
      await ref.read(apiProvider).post('/organizations', data);
      ref.invalidate(rowsProvider('/organizations'));
      ref.invalidate(sessionProvider);
    },
  );

  Future<void> logout() async {
    try {
      await ref.read(apiProvider).post('/logout');
      ref.invalidate(classesProvider);
      ref.invalidate(courseProvider);
      ref.invalidate(rowsProvider);
      ref.invalidate(sessionProvider);
    } catch (error) {
      if (mounted) showMessage(context, errorMessage(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider).value!;
    final user = session['user'] as Record;
    final organizations = (session['organizations'] as List).cast<Record>();
    final staff = organizations.where((org) => org['role'] != 'student').toList();
    final admin = session['platform_admin'] == true;
    final teacher = staff.isNotEmpty && !admin;
    final role = admin ? 'Administración' : teacher ? 'Espacio docente' : 'Espacio del alumno';
    final labels = admin
        ? ['Centros educativos', 'Clases', 'Mi cuenta']
        : teacher ? ['Mis clases', 'Agenda docente', 'Mi cuenta']
        : ['Mis clases', 'Próximas entregas', 'Mi cuenta'];
    final icons = [
      admin ? Icons.apartment_rounded : Icons.school_outlined,
      admin ? Icons.school_outlined : Icons.event_note_outlined,
      Icons.person_outline,
    ];
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final accent = admin ? const Color(0xFF4F46A5)
        : teacher ? const Color(0xFF174B89) : const Color(0xFF176A54);
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final navigation = Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const ListTile(
            leading: Icon(Icons.school_outlined),
            title: Text('APPCLASE', style: TextStyle(fontWeight: FontWeight.w800)),
          ),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text(role)),
          const Divider(height: 32),
          for (var i = 0; i < labels.length; i++)
            ListTile(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              selected: i == selected,
              selectedTileColor: colors.primaryContainer,
              leading: Icon(icons[i]),
              title: Text(labels[i]),
              onTap: () {
                setState(() => selected = i);
                if (!wide) Navigator.of(context).pop();
              },
            ),
          const Spacer(),
          ListTile(leading: const Icon(Icons.logout_rounded), title: const Text('Cerrar sesión'), onTap: logout),
        ],
      ),
    );
    final page = PageContent(children: [
      Container(
        padding: const EdgeInsets.all(26),
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: [accent, Color.lerp(accent, Colors.black, .32)!]),
          borderRadius: BorderRadius.circular(24),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(role, style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Text(labels[selected], style: theme.textTheme.headlineMedium?.copyWith(color: Colors.white, fontWeight: FontWeight.w800)),
          if (admin && selected == 0) ...[
            const SizedBox(height: 16),
            FilledButton.tonalIcon(onPressed: createCenter, icon: const Icon(Icons.add), label: const Text('Crear centro')),
          ],
          if (selected == 0 && !admin) ...[
            const SizedBox(height: 16),
            if (teacher)
              PopupMenuButton<Record>(
                tooltip: 'Crear clase',
                onSelected: (org) => create(context, ref, org),
                itemBuilder: (_) => [
                  for (final org in staff) PopupMenuItem(value: org, child: Text(org['name'] as String)),
                ],
                child: const Chip(avatar: Icon(Icons.add), label: Text('Crear clase')),
              )
            else
              FilledButton.tonalIcon(onPressed: () => join(context, ref), icon: const Icon(Icons.group_add_outlined), label: const Text('Unirse a una clase')),
          ],
        ]),
      ),
      const SizedBox(height: 20),
      if (selected == 2)
        Card(child: ListTile(
          leading: const Icon(Icons.account_circle_outlined),
          title: Text(user['name'] as String),
          subtitle: SelectableText("ID de cuenta: ${user['id'] ?? ''}"),
        ))
      else if (admin && selected == 0)
        Rows(path: '/organizations', empty: 'Aún no hay centros.', builder: (center) => Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(child: Icon(Icons.apartment_rounded)),
            title: Text(center['name'] as String),
            subtitle: Text("Código: ${center['access_code'] ?? '—'} · ${center['teachers']} profesores · ${center['students']} alumnos"),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/centros/${center['id']}'),
          ),
        ))
      else if (selected == 0 || admin)
        ref.watch(classesProvider).when(
          loading: () => const LinearProgressIndicator(),
          error: (error, _) => LoadError(errorMessage(error), () => ref.invalidate(classesProvider)),
          data: (courses) => courses.isEmpty
              ? const Card(child: ListTile(title: Text('Aún no hay clases disponibles.')))
              : Column(children: [
                  for (final course in courses)
                    Card(child: ListTile(
                      contentPadding: const EdgeInsets.all(16),
                      leading: const CircleAvatar(child: Icon(Icons.class_outlined)),
                      title: Text(course['name'] as String),
                      subtitle: Text("${course['subject']} · ${course['organization']}"),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/clases/${course['id']}'),
                    )),
                ]),
        )
      else
        Rows(path: '/dashboard/upcoming', empty: 'No hay entregas ni exámenes próximos.', builder: (item) => Card(
          child: ListTile(
            leading: Icon(item['type'] == 'exam' ? Icons.quiz_outlined : Icons.assignment_outlined),
            title: Text(item['title'] as String),
            subtitle: Text("${item['name']} · ${dateLabel(context, item['date'] as int)}"),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/clases/${item['class_id']}'),
          ),
        )),
    ]);
    return Scaffold(
      drawer: wide ? null : Drawer(child: SafeArea(child: navigation)),
      appBar: AppBar(title: Text(role), actions: const [ThemeButton(), NotificationsButton()]),
      body: wide ? Row(children: [
        SizedBox(width: 260, child: Material(color: colors.surfaceContainerLow, child: navigation)),
        const VerticalDivider(width: 1),
        Expanded(child: page),
      ]) : page,
    );
  }
}
