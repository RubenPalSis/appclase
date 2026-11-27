import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/widgets.dart';
import '../../main.dart' show ThemeButton;
import 'board_page.dart';
import 'calendar_page.dart';
import 'coursework.dart';
import 'documents_page.dart';
import 'exams.dart';
import 'materials_page.dart';
import 'messages_page.dart';

enum ClassSection {
  board('Tablón', Icons.dashboard_outlined),
  materials('Temario', Icons.folder_outlined),
  assignments('Tareas', Icons.assignment_outlined),
  exams('Exámenes', Icons.quiz_outlined),
  students('Alumnos', Icons.people_outline),
  documents('Archivos', Icons.description_outlined),
  calendar('Calendario', Icons.calendar_month_outlined),
  grades('Calificaciones', Icons.grade_outlined),
  messages('Mensajes', Icons.forum_outlined),
  attendance('Asistencia', Icons.event_available_outlined);

  const ClassSection(this.label, this.icon);
  final String label;
  final IconData icon;
}

class ClassPage extends ConsumerStatefulWidget {
  const ClassPage({required this.id, this.initialSection, super.key});
  final String id;
  final String? initialSection;

  @override
  ConsumerState<ClassPage> createState() => _ClassPageState();
}

class _ClassPageState extends ConsumerState<ClassPage> {
  late ClassSection selected = ClassSection.values.firstWhere(
    (section) => section.name == widget.initialSection,
    orElse: () => ClassSection.board,
  );
  bool collapsed = false;
  bool changing = false;

  String get path => '/classes/${widget.id}';

  Future<void> classAction(String action, Record data) async {
    setState(() => changing = true);
    try {
      final result = await ref.read(apiProvider).post('$path/$action', data);
      if (!mounted) return;
      if (action == 'archive') {
        ref.invalidate(courseProvider(widget.id));
        ref.invalidate(classesProvider);
      } else {
        final link = Uri.base
            .resolve('/')
            .replace(queryParameters: {'invitacion': result['code'] as String})
            .toString();
        await showDialog<void>(
          context: context,
          builder: (dialog) => AlertDialog(
            title: const Text('Invitación válida durante 7 días'),
            content: SelectableText(result['code'] as String),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialog),
                child: const Text('Cerrar'),
              ),
              FilledButton(
                onPressed: () async {
                  try {
                    await Clipboard.setData(ClipboardData(text: link));
                    if (dialog.mounted) Navigator.pop(dialog);
                    if (mounted) showMessage(context, 'Enlace copiado');
                  } catch (_) {
                    if (mounted) {
                      showMessage(
                        context,
                        'No se pudo copiar el enlace. Puedes seleccionar el código.',
                      );
                    }
                  }
                },
                child: const Text('Copiar enlace'),
              ),
            ],
          ),
        );
      }
    } catch (error) {
      if (mounted) showMessage(context, errorMessage(error));
    } finally {
      if (mounted) setState(() => changing = false);
    }
  }

  @override
  Widget build(BuildContext context) => ref
      .watch(courseProvider(widget.id))
      .when(
        loading: () =>
            const Scaffold(body: Center(child: CircularProgressIndicator())),
        error: (error, _) => Scaffold(
          appBar: AppBar(),
          body: LoadError(
            errorMessage(error),
            () => ref.invalidate(courseProvider(widget.id)),
          ),
        ),
        data: (course) {
          final staff = course['role'] != 'student';
          final archived = course['archived'] == 1;
          final writable = staff && !archived;
          final sections = ClassSection.values
              .where(
                (item) => switch (item) {
                  ClassSection.students => staff,
                  ClassSection.documents => course['documents_enabled'] == true,
                  _ => true,
                },
              )
              .toList();
          final index = sections.contains(selected)
              ? sections.indexOf(selected)
              : 0;
          final body = switch (sections[index]) {
            ClassSection.board => BoardPage(course: course),
            ClassSection.materials => MaterialsPage(
              path: path,
              writable: writable,
            ),
            ClassSection.assignments => AssignmentsPage(
              path: path,
              staff: staff,
              archived: archived,
            ),
            ClassSection.exams => ExamsPage(
              path: '$path/exams',
              staff: staff,
              archived: archived,
            ),
            ClassSection.students => RecordsPage(
              path: '$path/students',
              empty: 'Todavía no hay alumnos inscritos.',
              leading: Icons.person_outline,
              row: (item) =>
                  (title: item['name'] as String, subtitle: '', tap: null),
            ),
            ClassSection.documents => DocumentsPage(
              path: '$path/documents',
              canUpload: writable,
            ),
            ClassSection.calendar => CalendarPage(
              path: '$path/calendar',
              writable: writable,
            ),
            ClassSection.grades => GradesPage(
              path: '$path/grades',
              staff: staff,
            ),
            ClassSection.messages => MessagesPage(
              path: '$path/messages',
              archived: archived,
            ),
            ClassSection.attendance => AttendancePage(
              path: path,
              staff: staff,
              archived: archived,
            ),
          };
          final wide = MediaQuery.sizeOf(context).width >= 850;
          final mobile = sections.take(4).toList();
          final more = sections.skip(4).toList();
          final nav = MediaQuery.sizeOf(context).width < 500
              ? NavigationDestinationLabelBehavior.onlyShowSelected
              : NavigationDestinationLabelBehavior.alwaysShow;
          return Scaffold(
            appBar: AppBar(
              leading: IconButton(
                icon: const Icon(Icons.arrow_back),
                tooltip: 'Volver a mis clases',
                onPressed: () => context.go('/'),
              ),
              title: Text(course['name'] as String),
              actions: [
                if (wide)
                  IconButton(
                    tooltip: 'Plegar o ampliar el menú',
                    icon: const Icon(Icons.menu_open),
                    onPressed: () => setState(() => collapsed = !collapsed),
                  ),
                if (staff)
                  PopupMenuButton<String>(
                    enabled: !changing,
                    tooltip: 'Opciones de clase',
                    onSelected: (action) => classAction(
                      action,
                      action == 'archive' ? {'archived': !archived} : {},
                    ),
                    itemBuilder: (_) => [
                      if (!archived)
                        const PopupMenuItem(
                          value: 'invite',
                          child: Text('Generar nuevo código'),
                        ),
                      PopupMenuItem(
                        value: 'archive',
                        child: Text(
                          archived ? 'Restaurar clase' : 'Archivar clase',
                        ),
                      ),
                    ],
                  ),
                const ThemeButton(),
              ],
            ),
            body: wide
                ? Row(
                    children: [
                      NavigationRail(
                        scrollable: true,
                        extended: !collapsed,
                        labelType: collapsed
                            ? NavigationRailLabelType.selected
                            : null,
                        selectedIndex: index,
                        onDestinationSelected: (index) =>
                            setState(() => selected = sections[index]),
                        destinations: [
                          for (final item in sections)
                            NavigationRailDestination(
                              icon: Icon(item.icon),
                              label: Text(item.label),
                            ),
                        ],
                      ),
                      const VerticalDivider(width: 1),
                      Expanded(child: body),
                    ],
                  )
                : body,
            bottomNavigationBar: wide
                ? null
                : NavigationBar(
                    selectedIndex: index < 4 ? index : 4,
                    labelBehavior: nav,
                    onDestinationSelected: (index) async {
                      if (index < mobile.length) {
                        setState(() => selected = mobile[index]);
                        return;
                      }
                      final destination =
                          await showModalBottomSheet<ClassSection>(
                            context: context,
                            builder: (sheet) => SafeArea(
                              child: ListView(
                                shrinkWrap: true,
                                children: [
                                  for (final item in more)
                                    ListTile(
                                      leading: Icon(item.icon),
                                      title: Text(item.label),
                                      selected: selected == item,
                                      onTap: () => Navigator.pop(sheet, item),
                                    ),
                                ],
                              ),
                            ),
                          );
                      if (destination != null && mounted) {
                        setState(() => selected = destination);
                      }
                    },
                    destinations: [
                      for (final item in mobile)
                        NavigationDestination(
                          icon: Icon(item.icon),
                          label: item.label,
                        ),
                      if (more.isNotEmpty)
                        NavigationDestination(
                          icon: const Icon(Icons.more_horiz),
                          label: index < 4 ? 'Más' : sections[index].label,
                        ),
                    ],
                  ),
          );
        },
      );
}
