import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api.dart';
import '../../core/widgets.dart';
import 'coursework.dart';
import 'exams.dart' show pickDateTime;

class BoardPage extends ConsumerWidget {
  const BoardPage({required this.course, super.key});
  final Record course;

  String get classId => course['id'] as String;
  String get path => '/classes/$classId/posts';
  bool get staff => course['role'] != 'student';
  bool get active => course['archived'] == 0;
  bool get mayPublish => active && (staff || course['student_posts'] == 1);
  bool get mayComment => active && (staff || course['student_comments'] == 1);

  Future<void> post(
    BuildContext context,
    WidgetRef ref, {
    bool schedule = false,
  }) async {
    final publishAt = schedule
        ? await pickDateTime(context, 'Fecha de publicación')
        : null;
    if (!context.mounted || schedule && publishAt == null) return;
    await editFields(
      context,
      title: schedule ? 'Programar publicación' : 'Publicar en el tablón',
      fields: [field('body', 'Publicación', 4000)],
      save: (data) async {
        await ref.read(apiProvider).post(path, {
          ...data,
          if (publishAt != null)
            'publish_at': publishAt.millisecondsSinceEpoch ~/ 1000,
        });
        ref.invalidate(rowsProvider(path));
        ref.invalidate(rowsProvider('/notifications'));
      },
    );
  }

  Future<void> settings(BuildContext context, WidgetRef ref) async {
    final proposed = await showDialog<Record>(
      context: context,
      builder: (dialog) {
        var posts = course['student_posts'] == 1;
        var comments = course['student_comments'] == 1;
        return StatefulBuilder(
          builder: (context, setState) => AlertDialog(
            title: const Text('Permisos del tablón'),
            content: SizedBox(
              width: 410,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SwitchListTile(
                    value: posts,
                    title: const Text('El alumnado puede publicar'),
                    onChanged: (value) => setState(() => posts = value),
                  ),
                  SwitchListTile(
                    value: comments,
                    title: const Text('El alumnado puede comentar'),
                    onChanged: (value) => setState(() => comments = value),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialog),
                child: const Text('Cancelar'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialog, {
                  'student_posts': posts,
                  'student_comments': comments,
                }),
                child: const Text('Guardar'),
              ),
            ],
          ),
        );
      },
    );
    if (proposed == null || !context.mounted) return;
    try {
      await ref
          .read(apiProvider)
          .post('/classes/$classId/board-settings', proposed);
      if (context.mounted) ref.invalidate(courseProvider(classId));
    } catch (error) {
      if (context.mounted) showMessage(context, errorMessage(error));
    }
  }

  Future<void> change(
    BuildContext context,
    WidgetRef ref,
    Record item,
    String action,
  ) async {
    final endpoint = '$path/${item['id']}/$action';
    if (action == 'edit') {
      await editFields(
        context,
        title: 'Editar publicación',
        fields: [
          field('body', 'Publicación', 4000, initial: item['body'] as String),
        ],
        save: (data) async {
          await ref.read(apiProvider).post(endpoint, data);
          ref.invalidate(rowsProvider(path));
        },
      );
      return;
    }
    if (action == 'delete') {
      final confirm = await showDialog<bool>(
        context: context,
        builder: (dialog) => AlertDialog(
          title: const Text('¿Eliminar esta publicación?'),
          content: const Text(
            'También se eliminarán los comentarios de esta publicación.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialog, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialog, true),
              child: const Text('Eliminar'),
            ),
          ],
        ),
      );
      if (confirm != true || !context.mounted) return;
    }
    try {
      await ref.read(apiProvider).post(endpoint);
      if (context.mounted) {
        ref.invalidate(rowsProvider(path));
        ref.invalidate(rowsProvider('/notifications'));
      }
    } catch (error) {
      if (context.mounted) showMessage(context, errorMessage(error));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).asData?.value;
    final userId = (session?['user'] as Record?)?['id'];
    return PageContent(
      children: [
        Text(
          '${course['subject']} · ${course['academic_year']}',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        if ((course['description'] as String).isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(course['description'] as String),
          ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (mayPublish)
              FilledButton.icon(
                onPressed: () => post(context, ref),
                icon: const Icon(Icons.add),
                label: const Text('Publicar'),
              ),
            if (staff && active) ...[
              OutlinedButton.icon(
                onPressed: () => post(context, ref, schedule: true),
                icon: const Icon(Icons.schedule),
                label: const Text('Programar'),
              ),
              OutlinedButton(
                onPressed: () => settings(context, ref),
                child: const Text('Permisos del tablón'),
              ),
            ],
          ],
        ),
        const SizedBox(height: 12),
        Rows(
          path: path,
          empty: 'Todavía no hay publicaciones.',
          builder: (item) {
            final timestamp = DateTime.now().millisecondsSinceEpoch ~/ 1000;
            final publication = item['publish_at'] as int;
            final scheduled = publication > timestamp;
            final pinned = item['pinned'] == 1;
            final canChange =
                active &&
                (staff ||
                    course['student_posts'] == 1 &&
                        item['author_id'] == userId);
            final comments = '$path/${item['id']}/comments';
            return Card(
              child: ExpansionTile(
                leading: Icon(
                  pinned ? Icons.push_pin_outlined : Icons.campaign_outlined,
                ),
                title: Text(item['body'] as String),
                subtitle: Text(
                  [
                    item['author'] as String,
                    scheduled
                        ? 'Programada · ${dateLabel(context, publication)}'
                        : dateLabel(
                            context,
                            (publication == 0 ? item['created'] : publication)
                                as int,
                          ),
                    if (item['updated'] != null) 'Editada',
                  ].join(' · '),
                ),
                childrenPadding: const EdgeInsets.all(16),
                expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (canChange)
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        TextButton(
                          onPressed: () => change(context, ref, item, 'edit'),
                          child: const Text('Editar'),
                        ),
                        if (staff)
                          TextButton(
                            onPressed: () => change(context, ref, item, 'pin'),
                            child: Text(pinned ? 'Desfijar' : 'Fijar'),
                          ),
                        TextButton(
                          onPressed: () => change(context, ref, item, 'delete'),
                          child: const Text('Eliminar'),
                        ),
                      ],
                    ),
                  if (!scheduled) ...[
                    Rows(
                      path: comments,
                      empty: 'Todavía no hay comentarios.',
                      builder: (comment) => ListTile(
                        leading: const Icon(Icons.comment_outlined),
                        title: Text(comment['body'] as String),
                        subtitle: Text(
                          '${comment['author']} · ${dateLabel(context, comment['created'] as int)}',
                        ),
                      ),
                    ),
                    if (mayComment)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: OutlinedButton(
                          onPressed: () => editFields(
                            context,
                            title: 'Escribir comentario',
                            fields: [field('body', 'Comentario', 2000)],
                            save: (data) async {
                              await ref.read(apiProvider).post(comments, data);
                              ref.invalidate(rowsProvider(comments));
                            },
                          ),
                          child: const Text('Comentar'),
                        ),
                      ),
                  ],
                ],
              ),
            );
          },
        ),
      ],
    );
  }
}
