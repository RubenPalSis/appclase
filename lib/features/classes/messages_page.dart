import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:web/web.dart' as web;

import '../../core/api.dart';
import '../../core/widgets.dart';
import 'coursework.dart';

class MessagesPage extends ConsumerStatefulWidget {
  const MessagesPage({required this.path, required this.archived, super.key});
  final String path;
  final bool archived;

  @override
  ConsumerState<MessagesPage> createState() => _MessagesPageState();
}

class _MessagesPageState extends ConsumerState<MessagesPage> {
  String filter = '';

  @override
  Widget build(BuildContext context) => PageContent(
    children: [
      TextField(
        decoration: const InputDecoration(
          labelText: 'Buscar conversación',
          prefixIcon: Icon(Icons.search),
        ),
        onChanged: (value) =>
            setState(() => filter = value.trim().toLowerCase()),
      ),
      const SizedBox(height: 12),
      Consumer(
        builder: (context, ref, _) => ref
            .watch(rowsProvider(widget.path))
            .when(
              loading: () => const LinearProgressIndicator(),
              error: (error, _) => LoadError(
                errorMessage(error),
                () => ref.invalidate(rowsProvider(widget.path)),
              ),
              data: (threads) {
                final filtered = threads
                    .where(
                      (thread) => (thread['name'] as String)
                          .toLowerCase()
                          .contains(filter),
                    )
                    .toList();
                if (filtered.isEmpty)
                  return const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text('No hay conversaciones disponibles.'),
                  );
                return Column(
                  children: [
                    for (final thread in filtered)
                      Card(
                        child: ListTile(
                          leading: const CircleAvatar(
                            child: Icon(Icons.person_outline),
                          ),
                          title: Text(thread['name'] as String),
                          subtitle: thread['unread'] == 0
                              ? null
                              : Text('${thread['unread']} sin leer'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () async {
                            await Navigator.of(context).push<void>(
                              MaterialPageRoute(
                                builder: (_) => ThreadPage(
                                  path:
                                      '${widget.path}/${thread['student_id']}',
                                  name: thread['name'] as String,
                                  archived: widget.archived,
                                ),
                              ),
                            );
                            if (mounted)
                              ref.invalidate(rowsProvider(widget.path));
                          },
                        ),
                      ),
                  ],
                );
              },
            ),
      ),
    ],
  );
}

class ThreadPage extends ConsumerStatefulWidget {
  const ThreadPage({
    required this.path,
    required this.name,
    required this.archived,
    super.key,
  });
  final String path;
  final String name;
  final bool archived;

  @override
  ConsumerState<ThreadPage> createState() => _ThreadPageState();
}

class _ThreadPageState extends ConsumerState<ThreadPage> {
  late final Timer poll;
  int seen = 0;

  @override
  void initState() {
    super.initState();
    poll = Timer.periodic(const Duration(seconds: 12), (_) {
      if (web.document.visibilityState == 'visible') {
        ref.invalidate(rowsProvider(widget.path));
      }
    });
  }

  @override
  void dispose() {
    poll.cancel();
    super.dispose();
  }

  Future<void> markRead(int sequence) async {
    if (sequence <= seen) return;
    seen = sequence;
    try {
      await ref.read(apiProvider).post('${widget.path}/read', {
        'last_seen': sequence,
      });
    } catch (_) {
      // A later successful refresh will retry if this is still the latest message.
      if (seen == sequence) seen = 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(rowsProvider(widget.path), (_, next) {
      final rows = next.asData?.value;
      if (rows != null && rows.isNotEmpty) {
        unawaited(markRead(rows.last['sequence'] as int));
      }
    });
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.name),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Actualizar conversación',
            onPressed: () => ref.invalidate(rowsProvider(widget.path)),
          ),
        ],
      ),
      body: PageContent(
        children: [
          if (!widget.archived)
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.icon(
                icon: const Icon(Icons.send_outlined),
                label: const Text('Escribir mensaje'),
                onPressed: () => editFields(
                  context,
                  title: 'Nuevo mensaje',
                  fields: [field('body', 'Mensaje', 2000)],
                  save: (data) async {
                    await ref.read(apiProvider).post(widget.path, data);
                    ref.invalidate(rowsProvider(widget.path));
                  },
                ),
              ),
            ),
          const SizedBox(height: 12),
          Rows(
            path: widget.path,
            empty: 'Todavía no hay mensajes.',
            builder: (message) {
              final mine = message['mine'] == 1;
              final time = DateTime.fromMillisecondsSinceEpoch(
                (message['created'] as int) * 1000,
              );
              return Card(
                child: ListTile(
                  title: Text(message['body'] as String),
                  subtitle: Text(
                    '${mine ? 'Tú' : widget.name} · ${dateLabel(context, message['created'] as int)} · ${TimeOfDay.fromDateTime(time).format(context)}',
                  ),
                  trailing: mine
                      ? null
                      : IconButton(
                          tooltip: 'Informar de este mensaje',
                          icon: const Icon(Icons.flag_outlined),
                          onPressed: () => editFields(
                            context,
                            title: 'Informar al administrador del centro',
                            fields: [field('reason', 'Motivo', 1000)],
                            save: (data) async {
                              await ref.read(apiProvider).post(
                                '${widget.path}/report',
                                {...data, 'id': message['sequence']},
                              );
                              if (context.mounted)
                                showMessage(
                                  context,
                                  'Mensaje comunicado al centro.',
                                );
                            },
                          ),
                        ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}
