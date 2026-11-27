import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/widgets.dart';

String dateLabel(BuildContext context, int seconds) =>
    MaterialLocalizations.of(context)
        .formatMediumDate(DateTime.fromMillisecondsSinceEpoch(seconds * 1000));

typedef RowDetails = ({String title, String subtitle, VoidCallback? tap});

class RecordsPage extends ConsumerWidget {
  const RecordsPage({
    required this.path,
    required this.empty,
    required this.leading,
    required this.row,
    this.action,
    this.fields = const [],
    this.header,
    super.key,
  });
  final String path;
  final String empty;
  final String? action;
  final String? header;
  final IconData leading;
  final List<Field> fields;
  final RowDetails Function(Record) row;

  @override
  Widget build(BuildContext context, WidgetRef ref) => PageContent(
    children: [
      if (header != null)
        Padding(
          padding: const EdgeInsets.only(bottom: 20),
          child: Text(header!, style: Theme.of(context).textTheme.titleLarge),
        ),
      if (action != null)
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.icon(
            onPressed: () => editFields(
              context,
              title: action!,
              fields: fields,
              save: (data) async {
                await ref.read(apiProvider).post(path, data);
                ref.invalidate(rowsProvider(path));
              },
            ),
            icon: const Icon(Icons.add),
            label: Text(action!),
          ),
        ),
      const SizedBox(height: 12),
      Rows(
        path: path,
        empty: empty,
        builder: (record) {
          final details = row(record);
          return Card(
            child: ListTile(
              leading: Icon(leading),
              title: Text(details.title),
              subtitle: details.subtitle.isEmpty
                  ? null
                  : Text(details.subtitle),
              onTap: details.tap,
              trailing: details.tap == null
                  ? null
                  : const Icon(Icons.open_in_new),
            ),
          );
        },
      ),
    ],
  );
}

class Rows extends ConsumerWidget {
  const Rows({
    required this.path,
    required this.empty,
    required this.builder,
    super.key,
  });
  final String path;
  final String empty;
  final Widget Function(Record) builder;

  @override
  Widget build(BuildContext context, WidgetRef ref) => ref
      .watch(rowsProvider(path))
      .when(
        loading: () => const LinearProgressIndicator(),
        error: (error, _) => LoadError(
          errorMessage(error),
          () => ref.invalidate(rowsProvider(path)),
        ),
        data: (rows) => rows.isEmpty
            ? Padding(
                padding: const EdgeInsets.symmetric(vertical: 20),
                child: Text(empty),
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: rows.map(builder).toList(),
              ),
      );
}

int number(String? input) {
  final value = int.tryParse(input ?? '');
  if (value == null) {
    throw const ApiError(400, 'Introduce un número entero válido.');
  }
  return value;
}

class AssignmentsPage extends ConsumerWidget {
  const AssignmentsPage({
    required this.path,
    required this.staff,
    required this.archived,
    super.key,
  });
  final String path;
  final bool staff;
  final bool archived;

  Future<void> add(BuildContext context, WidgetRef ref) async {
    final today = DateUtils.dateOnly(DateTime.now());
    final day = await showDatePicker(
      context: context,
      firstDate: today,
      lastDate: DateTime(today.year + 10),
    );
    if (day == null || !context.mounted) return;
    final hour = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 23, minute: 59),
    );
    if (hour == null || !context.mounted) return;
    final due = DateTime(day.year, day.month, day.day, hour.hour, hour.minute);
    final allowLate = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('¿Admitir entregas después del plazo?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: const Text('Bloquear entregas tardías'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialog, true),
            child: const Text('Permitir'),
          ),
        ],
      ),
    );
    if (allowLate == null || !context.mounted) return;
    await editFields(
      context,
      title: 'Nueva tarea',
      fields: [
        field('title', 'Título', 160),
        field('body', 'Instrucciones', 6000),
        field('points', 'Puntuación máxima', 4),
      ],
      save: (data) async {
        await ref.read(apiProvider).post('$path/assignments', {
          ...data,
          'points': number(data['points']),
          'due': due.millisecondsSinceEpoch ~/ 1000,
          'allow_late': allowLate,
        });
        ref.invalidate(rowsProvider('$path/assignments'));
      },
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => PageContent(
    children: [
      if (staff && !archived)
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.icon(
            onPressed: () => add(context, ref),
            icon: const Icon(Icons.add),
            label: const Text('Crear tarea'),
          ),
        ),
      const SizedBox(height: 12),
      Rows(
        path: '$path/assignments',
        empty: 'Todavía no hay tareas.',
        builder: (task) {
          final endpoint = '$path/assignments/${task['id']}';
          final due = task['due'] as int;
          final closed =
              due < DateTime.now().millisecondsSinceEpoch ~/ 1000 &&
              task['allow_late'] == 0;
          final score = task['score'];
          final submitted = task['submitted'] as int?;
          final status = score != null
              ? '$score / ${task['points']} puntos'
              : submitted != null
              ? (submitted > due ? 'Entregada fuera de plazo' : 'Entregada')
              : closed
              ? 'Sin entregar'
              : 'Pendiente';
          final time = DateTime.fromMillisecondsSinceEpoch(due * 1000);
          final deadline =
              '${dateLabel(context, due)} · ${TimeOfDay.fromDateTime(time).format(context)}';
          return Card(
            child: ExpansionTile(
              title: Text(task['title'] as String),
              subtitle: Text(staff ? deadline : '$deadline · $status'),
              childrenPadding: const EdgeInsets.all(16),
              expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SelectableText(task['body'] as String),
                if (!staff && task['answer'] != null) ...[
                  const SizedBox(height: 12),
                  const Text('Tu entrega'),
                  SelectableText(task['answer'] as String),
                ],
                if (!staff &&
                    (task['feedback'] as String?)?.isNotEmpty == true) ...[
                  const SizedBox(height: 12),
                  const Text('Comentario privado'),
                  SelectableText(task['feedback'] as String),
                ],
                if (!staff && !archived && score == null && !closed)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      onPressed: () => editFields(
                        context,
                        title: 'Entregar tarea',
                        fields: [
                          field(
                            'body',
                            'Respuesta o enlace',
                            10000,
                            initial: task['answer'] as String?,
                          ),
                        ],
                        save: (data) async {
                          await ref
                              .read(apiProvider)
                              .post('$endpoint/deliver', data);
                          ref.invalidate(rowsProvider('$path/assignments'));
                        },
                      ),
                      child: Text(
                        submitted == null
                            ? 'Entregar tarea'
                            : 'Actualizar entrega',
                      ),
                    ),
                  ),
                if (staff)
                  Reviews(
                    path: '$endpoint/reviews',
                    archived: archived,
                    points: task['points'] as int,
                  ),
              ],
            ),
          );
        },
      ),
    ],
  );
}

class Reviews extends ConsumerWidget {
  const Reviews({
    required this.path,
    required this.archived,
    required this.points,
    super.key,
  });
  final String path;
  final bool archived;
  final int points;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Rows(
    path: path,
    empty: 'Aún no hay entregas.',
    builder: (review) => ListTile(
      title: Text(review['name'] as String),
      subtitle: Text(
        '${review['body']}\n${review['score'] ?? 'Pendiente de corregir'}',
      ),
      trailing: archived
          ? null
          : IconButton(
              tooltip: 'Calificar entrega',
              icon: const Icon(Icons.rate_review_outlined),
              onPressed: () => editFields(
                context,
                title: 'Calificar entrega',
                fields: [
                  field(
                    'score',
                    'Nota sobre $points',
                    4,
                    initial: review['score']?.toString(),
                  ),
                  field(
                    'feedback',
                    'Comentario privado',
                    4000,
                    optional: true,
                    initial: review['feedback'] as String?,
                  ),
                ],
                save: (data) async {
                  await ref.read(apiProvider).post(path, {
                    ...data,
                    'score': number(data['score']),
                    'user_id': review['user_id'],
                  });
                  ref.invalidate(rowsProvider(path));
                },
              ),
            ),
    ),
  );
}

const attendanceStates = {
  'present': 'Presente',
  'absent': 'Ausente',
  'late': 'Retraso',
  'excused': 'Falta justificada',
};

class AttendancePage extends ConsumerStatefulWidget {
  const AttendancePage({
    required this.path,
    required this.staff,
    required this.archived,
    super.key,
  });
  final String path;
  final bool staff;
  final bool archived;

  @override
  ConsumerState<AttendancePage> createState() => _AttendancePageState();
}

class _AttendancePageState extends ConsumerState<AttendancePage> {
  DateTime day = DateUtils.dateOnly(DateTime.now());

  @override
  Widget build(BuildContext context) {
    final iso = day.toIso8601String().split('T').first;
    final endpoint = '${widget.path}/attendance';
    final path = widget.staff ? '$endpoint?day=$iso' : endpoint;
    return PageContent(
      children: [
        if (widget.staff)
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              icon: const Icon(Icons.calendar_today),
              label: Text(
                MaterialLocalizations.of(context).formatMediumDate(day),
              ),
              onPressed: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: day,
                  firstDate: DateTime(2000),
                  lastDate: DateTime.now(),
                );
                if (picked != null && mounted) setState(() => day = picked);
              },
            ),
          ),
        const SizedBox(height: 12),
        Rows(
          path: path,
          empty: widget.staff
              ? 'Aún no hay alumnos inscritos.'
              : 'Aún no hay registros de asistencia.',
          builder: (record) => Card(
            child: ListTile(
              title: Text((record['name'] ?? record['day']) as String),
              subtitle: Text(
                [
                  attendanceStates[record['status']] ?? 'Sin registrar',
                  if ((record['notes'] as String?)?.isNotEmpty == true)
                    record['notes'] as String,
                ].join(' · '),
              ),
              trailing: widget.staff && !widget.archived
                  ? PopupMenuButton<String>(
                      tooltip: 'Registrar asistencia de ${record['name']}',
                      itemBuilder: (_) => [
                        for (final entry in attendanceStates.entries)
                          PopupMenuItem(
                            value: entry.key,
                            child: Text(entry.value),
                          ),
                      ],
                      onSelected: (status) => editFields(
                        context,
                        title: attendanceStates[status]!,
                        fields: [
                          field(
                            'notes',
                            'Observaciones',
                            1000,
                            optional: true,
                            initial: record['notes'] as String?,
                          ),
                        ],
                        save: (data) async {
                          await ref.read(apiProvider).post(endpoint, {
                            ...data,
                            'user_id': record['id'],
                            'day': iso,
                            'status': status,
                          });
                          ref.invalidate(rowsProvider(path));
                        },
                      ),
                    )
                  : null,
            ),
          ),
        ),
      ],
    );
  }
}
