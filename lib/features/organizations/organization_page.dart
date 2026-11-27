import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/widgets.dart';
import '../classes/coursework.dart';

const roles = {
  'admin': 'Administrador',
  'teacher': 'Profesor',
  'student': 'Alumno',
};
const auditEvents = {
  'membership.enabled': 'Acceso concedido o actualizado',
  'membership.disabled': 'Acceso desactivado',
  'organization.renamed': 'Nombre del centro actualizado',
  'class.created': 'Clase creada',
  'class.archived': 'Clase archivada',
  'class.restored': 'Clase restaurada',
  'invitation.rotated': 'Código de invitación renovado',
};

class OrganizationPage extends ConsumerStatefulWidget {
  const OrganizationPage({required this.id, this.initialSection, super.key});
  final String id;
  final String? initialSection;

  @override
  ConsumerState<OrganizationPage> createState() => _OrganizationPageState();
}

class _OrganizationPageState extends ConsumerState<OrganizationPage> {
  String get id => widget.id;
  static const sections = {
    'overview': 'Resumen',
    'teachers': 'Profesores',
    'students': 'Alumnos',
    'reports': 'Reportes',
    'activity': 'Actividad',
  };
  late String selected = sections.containsKey(widget.initialSection)
      ? widget.initialSection! : 'overview';

  Future<void> manage(
    BuildContext context,
    WidgetRef ref,
    String role, [
    Record? user,
  ]) => editFields(
    context,
    title: user == null
        ? 'Dar acceso · ${roles[role]}'
        : 'Cambiar acceso a ${roles[role]}',
    fields: [
      field(
        'user_id',
        'ID de cuenta APPCLASE',
        100,
        initial: user?['id'] as String?,
      ),
    ],
    save: (data) async {
      await ref.read(apiProvider).post('/organizations/$id/members', {
        ...data,
        'role': role,
        'active': true,
      });
      ref.invalidate(rowsProvider('/organizations/$id/members'));
      ref.invalidate(rowsProvider('/organizations/$id/audit'));
    },
  );

  Future<void> disable(BuildContext context, WidgetRef ref, Record user) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text('¿Desactivar el acceso de ${user['name']}?'),
        content: const Text(
          'Se conservará su historial en este centro. Puedes restablecer el acceso desde esta página.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialog, true),
            child: const Text('Desactivar acceso'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      await ref.read(apiProvider).post('/organizations/$id/members', {
        'user_id': user['id'],
        'role': user['role'],
        'active': false,
      });
      if (!context.mounted) return;
      ref.invalidate(rowsProvider('/organizations/$id/members'));
      ref.invalidate(rowsProvider('/organizations/$id/audit'));
    } catch (error) {
      if (context.mounted) showMessage(context, errorMessage(error));
    }
  }

  Future<void> provision(BuildContext context, WidgetRef ref) async {
    Record? invitation;
    await editFields(context, title: 'Crear cuenta de profesor',
      fields: [field('name', 'Nombre completo', 160), field('email', 'Correo electrónico', 254)],
      save: (data) async {
        invitation = await ref.read(apiProvider).post('/organizations/$id/teachers', data);
        ref.invalidate(rowsProvider('/organizations/$id/members'));
      },
    );
    final details = invitation;
    if (!context.mounted || details == null) return;
    await showDialog<void>(context: context, builder: (dialog) => AlertDialog(
      title: const Text('Datos para el primer acceso'),
      content: SelectableText("Nombre: ${details['name']}\nCorreo: ${details['email']}\nCódigo del centro: ${details['access_code']}\nContraseña temporal: ${details['password']}"),
      actions: [TextButton(onPressed: () => Navigator.pop(dialog), child: const Text('Cerrar'))],
    ));
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider).value;
    final organizations = (session?['organizations'] as List? ?? [])
        .cast<Record>();
    final names = {
      for (final org in organizations.where((org) => org['role'] == 'admin'))
        org['id']: org['name'] as String,
    };
    final name = names[id];
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: 'Volver a mis clases',
          onPressed: () => context.go('/'),
          icon: const Icon(Icons.arrow_back),
        ),
        title: Text(name ?? 'Administración'),
      ),
      body: name == null
          ? const Center(
              child: Text('No tienes permisos para administrar este centro.'),
            )
          : PageContent(
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final entry in sections.entries)
                      ChoiceChip(
                        label: Text(entry.value),
                        selected: selected == entry.key,
                        onSelected: (_) => setState(() => selected = entry.key),
                      ),
                  ],
                ),
                const SizedBox(height: 24),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (selected == 'teachers') FilledButton(
                      onPressed: () => provision(context, ref),
                      child: const Text('Crear profesor'),
                    ),
                    if (selected == 'teachers') OutlinedButton(
                      onPressed: () => manage(context, ref, 'teacher'),
                      child: const Text('Vincular profesor existente'),
                    ),
                    if (selected == 'students') OutlinedButton(
                      onPressed: () => manage(context, ref, 'student'),
                      child: const Text('Añadir alumno'),
                    ),
                    if (selected == 'overview') OutlinedButton(
                      onPressed: () => editFields(
                        context,
                        title: 'Cambiar nombre del centro',
                        fields: [field('name', 'Nombre', 120, initial: name)],
                        save: (data) async {
                          await ref
                              .read(apiProvider)
                              .post('/organizations/$id/settings', data);
                          ref.invalidate(sessionProvider);
                          ref.invalidate(classesProvider);
                          ref.invalidate(
                            rowsProvider('/organizations/$id/audit'),
                          );
                        },
                      ),
                      child: const Text('Renombrar centro'),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                if (selected == 'overview')
                  Card(child: ListTile(
                    leading: const Icon(Icons.apartment_outlined),
                    title: Text(name),
                    subtitle: Text("Código del centro: ${organizations.firstWhere((org) => org['id'] == id)['access_code'] ?? '—'}"),
                  )),
                if (selected == 'teachers' || selected == 'students')
                  ref.watch(rowsProvider('/organizations/$id/members')).when(
                    loading: () => const LinearProgressIndicator(),
                    error: (error, _) => LoadError(errorMessage(error),
                      () => ref.invalidate(rowsProvider('/organizations/$id/members'))),
                    data: (members) {
                      final role = selected == 'teachers' ? 'teacher' : 'student';
                      final visible = members.where((member) => member['role'] == role).toList();
                      return visible.isEmpty
                          ? const Card(child: ListTile(title: Text('Todavía no hay cuentas en este apartado.')))
                          : Column(children: visible.map((user) {
                    final role = user['role'] as String;
                    final active = user['active'] == 1;
                    return Card(
                      child: ListTile(
                        title: Text(user['name'] as String),
                        subtitle: Text(
                          '${user['email']} · ${roles[role]}${active ? '' : ' · Acceso desactivado'}',
                        ),
                        trailing: role == 'admin'
                            ? null
                            : PopupMenuButton<String>(
                                tooltip: 'Gestionar acceso a ${user['name']}',
                                itemBuilder: (_) => [
                                  if (active)
                                    const PopupMenuItem(
                                      value: 'disable',
                                      child: Text('Desactivar acceso'),
                                    ),
                                  if (!active || role != 'teacher')
                                    const PopupMenuItem(
                                      value: 'teacher',
                                      child: Text('Dar acceso como profesor'),
                                    ),
                                  if (!active || role != 'student')
                                    const PopupMenuItem(
                                      value: 'student',
                                      child: Text('Dar acceso como alumno'),
                                    ),
                                ],
                                onSelected: (action) {
                                  if (action == 'disable') {
                                    disable(context, ref, user);
                                  } else {
                                    manage(context, ref, action, user);
                                  }
                                },
                              ),
                      ),
                    );
                          }).toList());
                    },
                  ),
                if (selected == 'reports') ...[
                Text(
                  'Mensajes reportados',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Rows(
                  path: '/organizations/$id/reports',
                  empty: 'No hay mensajes reportados.',
                  builder: (report) => Card(
                    child: ListTile(
                      leading: const Icon(Icons.flag_outlined),
                      title: Text('${report['course']} · ${report['reason']}'),
                      subtitle: Text(
                        'De ${report['sender']}, reportado por ${report['reporter']}\n${report['body']}',
                      ),
                    ),
                  ),
                ),
                ],
                if (selected == 'activity') ...[
                Text(
                  'Actividad administrativa',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Rows(
                  path: '/organizations/$id/audit',
                  empty: 'Todavía no hay actividad registrada.',
                  builder: (event) => ListTile(
                    leading: const Icon(Icons.history_outlined),
                    title: Text(
                      auditEvents[event['action']] ?? event['action'] as String,
                    ),
                    subtitle: Text(
                      '${event['actor']} · ${dateLabel(context, event['created'] as int)}',
                    ),
                  ),
                ),
                ],
              ],
            ),
    );
  }
}
