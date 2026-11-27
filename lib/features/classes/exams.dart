import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/widgets.dart';
import 'coursework.dart';

class ExamsPage extends ConsumerWidget {
  const ExamsPage({
    required this.path,
    required this.staff,
    required this.archived,
    super.key,
  });
  final String path;
  final bool staff;
  final bool archived;

  Future<void> create(BuildContext context, WidgetRef ref) async {
    final opening = await pickDateTime(
      context,
      'Elige cuándo se abre el examen',
    );
    if (opening == null || !context.mounted) return;
    final closing = await pickDateTime(
      context,
      'Elige cuándo se cierra el examen',
      from: opening,
    );
    if (closing == null || !context.mounted) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => ExamEditor(
          onSave: (data) async {
            await ref.read(apiProvider).post(path, {
              ...data,
              'opens': opening.millisecondsSinceEpoch ~/ 1000,
              'closes': closing.millisecondsSinceEpoch ~/ 1000,
            });
            ref.invalidate(rowsProvider(path));
          },
        ),
      ),
    );
  }

  Future<void> attempt(
    BuildContext context,
    WidgetRef ref,
    String endpoint, [
    Record? existing,
  ]) async {
    try {
      final current =
          existing ?? await ref.read(apiProvider).post('$endpoint/start');
      if (!context.mounted) return;
      final api = ref.read(apiProvider);
      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          builder: (_) => AttemptScreen(
            attempt: current,
            canEdit: !archived,
            save: (answers, submit) async {
              await api.post('$endpoint/${current['id']}', {
                'answers': answers,
                'submit': submit,
              });
            },
          ),
        ),
      );
    } catch (error) {
      if (context.mounted) showMessage(context, errorMessage(error));
    } finally {
      if (context.mounted) {
        ref.invalidate(rowsProvider(path));
        ref.invalidate(rowsProvider('$endpoint/attempts'));
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => PageContent(
    children: [
      if (staff && !archived)
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.icon(
            onPressed: () => create(context, ref),
            icon: const Icon(Icons.add),
            label: const Text('Crear examen'),
          ),
        ),
      const SizedBox(height: 12),
      Rows(
        path: path,
        empty: 'Todavía no hay exámenes.',
        builder: (exam) {
          final endpoint = '$path/${exam['id']}';
          final timestamp = DateTime.now().millisecondsSinceEpoch ~/ 1000;
          final open =
              !archived &&
              timestamp >= (exam['opens'] as int) &&
              timestamp < (exam['closes'] as int);
          return Card(
            child: ExpansionTile(
              title: Text(exam['title'] as String),
              subtitle: Text(
                '${dateLabel(context, exam['opens'] as int)} – ${dateLabel(context, exam['closes'] as int)}',
              ),
              childrenPadding: const EdgeInsets.all(16),
              expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  '${(exam['duration'] as int) ~/ 60} min por intento · ${exam['max_attempts']} intentos permitidos',
                ),
                const SizedBox(height: 8),
                if (!staff &&
                    open &&
                    (exam['attempts'] as int) < (exam['max_attempts'] as int))
                  Align(
                    alignment: Alignment.centerLeft,
                    child: FilledButton(
                      onPressed: () => attempt(context, ref, endpoint),
                      child: const Text('Comenzar o continuar'),
                    ),
                  ),
                Rows(
                  path: '$endpoint/attempts',
                  empty: 'Todavía no hay intentos.',
                  builder: (item) {
                    final finished =
                        item['submitted'] != null || item['closed'] == true;
                    return ListTile(
                      title: Text(
                        staff
                            ? '${item['name']} · Intento ${item['number']}'
                            : 'Intento ${item['number']}',
                      ),
                      subtitle: Text(
                        item['score'] != null
                            ? '${item['score']} aciertos'
                            : finished
                            ? 'Finalizado'
                            : 'En curso',
                      ),
                      trailing: staff ? null : const Icon(Icons.chevron_right),
                      onTap: staff
                          ? null
                          : () => attempt(context, ref, endpoint, item),
                    );
                  },
                ),
              ],
            ),
          );
        },
      ),
    ],
  );
}

Future<DateTime?> pickDateTime(
  BuildContext context,
  String label, {
  DateTime? from,
}) async {
  final first = DateUtils.dateOnly(from ?? DateTime.now());
  final date = await showDatePicker(
    context: context,
    firstDate: first,
    lastDate: DateTime(first.year + 5),
    helpText: label,
  );
  if (date == null || !context.mounted) return null;
  final time = await showTimePicker(
    context: context,
    initialTime: TimeOfDay.now(),
    helpText: label,
  );
  return time == null
      ? null
      : DateTime(date.year, date.month, date.day, time.hour, time.minute);
}

class ExamEditor extends StatefulWidget {
  const ExamEditor({required this.onSave, super.key});
  final Future<void> Function(Record) onSave;

  @override
  State<ExamEditor> createState() => _ExamEditorState();
}

class _ExamEditorState extends State<ExamEditor> {
  final questions = <Record>[];
  bool saving = false;

  Future<void> edit([int? index]) async {
    final previous = index == null ? null : questions[index];
    await editFields(
      context,
      title: index == null ? 'Añadir pregunta' : 'Editar pregunta',
      fields: [
        field(
          'prompt',
          'Pregunta',
          600,
          initial: previous?['prompt'] as String?,
        ),
        for (var i = 0; i < 4; i++)
          field(
            'option$i',
            'Opción ${i + 1}',
            300,
            optional: i >= 2,
            initial:
                previous != null && (previous['options'] as List).length > i
                ? previous['options'][i] as String
                : null,
          ),
        field(
          'correct',
          'Número de la opción correcta',
          1,
          initial: previous == null
              ? null
              : '${(previous['correct'] as int) + 1}',
        ),
      ],
      save: (data) async {
        final options = [for (var i = 0; i < 4; i++) data['option$i']!];
        while (options.last.isEmpty) {
          options.removeLast();
        }
        final correct = number(data['correct']) - 1;
        if (options.contains('') || correct < 0 || correct >= options.length) {
          throw const ApiError(
            400,
            'Rellena las opciones en orden e indica cuál es correcta.',
          );
        }
        final question = {
          'prompt': data['prompt'],
          'options': options,
          'correct': correct,
        };
        setState(() {
          if (index == null) {
            questions.add(question);
          } else {
            questions[index] = question;
          }
        });
      },
    );
  }

  Future<void> publish() async {
    setState(() => saving = true);
    await editFields(
      context,
      title: 'Publicar examen',
      fields: [
        field('title', 'Título', 160),
        field('minutes', 'Duración en minutos', 3),
        field('attempts', 'Intentos máximos', 2, initial: '1'),
      ],
      save: (data) => widget
          .onSave({
            'title': data['title'],
            'duration': number(data['minutes']) * 60,
            'max_attempts': number(data['attempts']),
            'questions': questions,
          })
          .then((_) {
            // The form closes first, then the editor returns to the exam list.
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted) Navigator.of(context).pop();
            });
          }),
    );
    if (mounted) setState(() => saving = false);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Editor de examen')),
    body: PageContent(
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: saving || questions.length >= 30 ? null : () => edit(),
              icon: const Icon(Icons.add),
              label: const Text('Añadir pregunta'),
            ),
            FilledButton(
              onPressed: saving || questions.isEmpty ? null : publish,
              child: const Text('Publicar'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        for (var index = 0; index < questions.length; index++)
          Card(
            child: ListTile(
              title: Text(questions[index]['prompt'] as String),
              subtitle: Text(
                '${(questions[index]['options'] as List).length} opciones',
              ),
              onTap: saving ? null : () => edit(index),
              trailing: IconButton(
                tooltip: 'Eliminar pregunta',
                icon: const Icon(Icons.delete_outline),
                onPressed: saving
                    ? null
                    : () => setState(() => questions.removeAt(index)),
              ),
            ),
          ),
      ],
    ),
  );
}

class AttemptScreen extends StatefulWidget {
  const AttemptScreen({
    required this.attempt,
    required this.save,
    required this.canEdit,
    super.key,
  });
  final Record attempt;
  final Future<void> Function(Record answers, bool submit) save;
  final bool canEdit;

  @override
  State<AttemptScreen> createState() => _AttemptScreenState();
}

class _AttemptScreenState extends State<AttemptScreen> {
  late final answers = Record.of(widget.attempt['answers'] as Record);
  late final clock = Stopwatch()..start();
  late final int duration =
      (widget.attempt['deadline'] as int) -
      (widget.attempt['server_time'] as int);
  late bool submitted = widget.attempt['submitted'] != null;
  bool saving = false;
  bool dirty = false;
  String? error;
  Timer? timer;
  int get remaining => (duration - clock.elapsed.inSeconds).clamp(
    0,
    duration < 0 ? 0 : duration,
  );
  bool get writable => widget.canEdit && !submitted && remaining > 0;

  @override
  void initState() {
    super.initState();
    if (writable) {
      timer = Timer.periodic(const Duration(seconds: 1), (_) {
        setState(() {});
        if (remaining == 0) timer?.cancel();
      });
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    clock.stop();
    super.dispose();
  }

  Future<void> persist({required bool submit}) async {
    setState(() {
      saving = true;
      error = null;
    });
    try {
      await widget.save(Record.of(answers), submit);
      if (mounted) {
        setState(() {
          dirty = false;
          submitted = submit;
        });
      }
    } catch (exception) {
      if (mounted) setState(() => error = errorMessage(exception));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final questions = (widget.attempt['questions'] as List).cast<Record>();
    return Scaffold(
      appBar: AppBar(title: Text('Intento ${widget.attempt['number']}')),
      body: PageContent(
        children: [
          Text(
            submitted
                ? 'Entregado'
                : remaining == 0
                ? 'Tiempo finalizado'
                : '${remaining ~/ 60} min ${remaining % 60} s',
          ),
          if (widget.attempt['score'] != null)
            Text('${widget.attempt['score']} de ${questions.length} aciertos'),
          if (error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(error!),
            ),
          if (writable)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton(
                  onPressed: dirty && !saving
                      ? () => persist(submit: false)
                      : null,
                  child: const Text('Guardar borrador'),
                ),
                FilledButton(
                  onPressed: saving ? null : () => persist(submit: true),
                  child: const Text('Entregar examen'),
                ),
              ],
            ),
          for (var index = 0; index < questions.length; index++)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      questions[index]['prompt'] as String,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    for (
                      var option = 0;
                      option < (questions[index]['options'] as List).length;
                      option++
                    )
                      ListTile(
                        title: Text(
                          questions[index]['options'][option] as String,
                        ),
                        selected: answers['$index'] == option,
                        leading: Icon(
                          answers['$index'] == option
                              ? Icons.radio_button_checked
                              : Icons.radio_button_unchecked,
                        ),
                        onTap: writable && !saving
                            ? () {
                                setState(() {
                                  answers['$index'] = option;
                                  dirty = true;
                                });
                                unawaited(persist(submit: false));
                              }
                            : null,
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
