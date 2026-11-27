import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api.dart';
import '../../core/download.dart';
import '../../core/widgets.dart';
import 'coursework.dart';
import 'exams.dart' show pickDateTime;

enum Period {
  month('Mes'),
  week('Semana'),
  day('Día');

  const Period(this.label);
  final String label;
}

int seconds(DateTime time) => time.millisecondsSinceEpoch ~/ 1000;

class CalendarPage extends ConsumerStatefulWidget {
  const CalendarPage({required this.path, required this.writable, super.key});
  final String path;
  final bool writable;

  @override
  ConsumerState<CalendarPage> createState() => _CalendarPageState();
}

class _CalendarPageState extends ConsumerState<CalendarPage> {
  DateTime selected = DateUtils.dateOnly(DateTime.now());
  Period period = Period.month;

  DateTime shift(DateTime day, int count) =>
      DateTime(day.year, day.month, day.day + count);

  (DateTime, DateTime) get range {
    final monday = shift(selected, 1 - selected.weekday);
    return switch (period) {
      Period.month => (
        DateTime(selected.year, selected.month),
        DateTime(selected.year, selected.month + 1),
      ),
      Period.week => (monday, shift(monday, 7)),
      Period.day => (selected, shift(selected, 1)),
    };
  }

  void move(int direction) => setState(() {
    selected = switch (period) {
      Period.month => DateTime(selected.year, selected.month + direction),
      Period.week => shift(selected, 7 * direction),
      Period.day => shift(selected, direction),
    };
  });

  Future<void> create(String path) async {
    final start = await pickDateTime(context, 'Fecha de inicio');
    if (start == null || !mounted) return;
    final finish = await pickDateTime(
      context,
      'Fecha de finalización',
      from: start,
    );
    if (finish == null || !mounted) return;
    await editFields(
      context,
      title: 'Nuevo evento',
      fields: [
        field('title', 'Título', 160),
        field('body', 'Descripción', 2000, optional: true),
      ],
      save: (data) async {
        await ref.read(apiProvider).post(widget.path, {
          ...data,
          'start': seconds(start),
          'finish': seconds(finish),
        });
        ref.invalidate(rowsProvider(path));
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final (start, end) = range;
    final query = '?from=${seconds(start)}&until=${seconds(end)}';
    final path = widget.path + query;
    final localizations = MaterialLocalizations.of(context);
    final label = switch (period) {
      Period.month => localizations.formatMonthYear(start),
      Period.week =>
        '${localizations.formatMediumDate(start)} – ${localizations.formatMediumDate(shift(end, -1))}',
      Period.day => localizations.formatFullDate(start),
    };
    return PageContent(
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            SegmentedButton<Period>(
              segments: [
                for (final item in Period.values)
                  ButtonSegment(value: item, label: Text(item.label)),
              ],
              selected: {period},
              onSelectionChanged: (selection) =>
                  setState(() => period = selection.single),
            ),
            OutlinedButton.icon(
              icon: const Icon(Icons.download_outlined),
              label: const Text('Exportar ICS'),
              onPressed: () => downloadFromApi('${widget.path}/export$query'),
            ),
            if (widget.writable)
              FilledButton.icon(
                icon: const Icon(Icons.add),
                label: const Text('Añadir evento'),
                onPressed: () => create(path),
              ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            IconButton(
              icon: const Icon(Icons.chevron_left),
              tooltip: 'Periodo anterior',
              onPressed: () => move(-1),
            ),
            Expanded(
              child: Text(
                label,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            IconButton(
              icon: const Icon(Icons.chevron_right),
              tooltip: 'Periodo siguiente',
              onPressed: () => move(1),
            ),
          ],
        ),
        Rows(
          path: path,
          empty: 'No hay eventos en este periodo.',
          builder: (event) {
            final (kind, icon) = switch (event['kind']) {
              'exam' => ('Examen', Icons.quiz_outlined),
              'assignment' => ('Entrega', Icons.assignment_outlined),
              _ => ('Evento', Icons.event_outlined),
            };
            final time = DateTime.fromMillisecondsSinceEpoch(
              (event['start'] as int) * 1000,
            );
            final startLabel =
                '${localizations.formatMediumDate(time)} · ${TimeOfDay.fromDateTime(time).format(context)}';
            final description = event['body'] as String;
            return Card(
              child: ListTile(
                leading: Icon(icon),
                title: Text(event['title'] as String),
                subtitle: Text(
                  '$kind · $startLabel${description.isEmpty ? '' : '\n$description'}',
                ),
              ),
            );
          },
        ),
      ],
    );
  }
}

class GradesPage extends StatelessWidget {
  const GradesPage({required this.path, required this.staff, super.key});
  final String path;
  final bool staff;

  @override
  Widget build(BuildContext context) => PageContent(
    children: [
      if (staff)
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.download_outlined),
            label: const Text('Exportar CSV'),
            onPressed: () => downloadFromApi('$path/export'),
          ),
        ),
      const SizedBox(height: 12),
      Rows(
        path: path,
        empty: 'Todavía no hay calificaciones publicadas.',
        builder: (grade) {
          final score = grade['score'] as int;
          final points = grade['points'] as int;
          final title = (staff ? grade['name'] : grade['title']) as String;
          final detail = staff
              ? '${grade['graded']} tareas corregidas'
              : grade['feedback'] as String? ?? '';
          return Card(
            child: ListTile(
              leading: const Icon(Icons.grade_outlined),
              title: Text(title),
              subtitle: Text(
                '$score / $points puntos${detail.isEmpty ? '' : ' · $detail'}',
              ),
            ),
          );
        },
      ),
    ],
  );
}
