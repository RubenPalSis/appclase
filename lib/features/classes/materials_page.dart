import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:web/web.dart' as web;

import '../../core/api.dart';
import '../../core/widgets.dart';
import 'coursework.dart';

const levels = {
  'unit': 'Unidad didáctica',
  'topic': 'Tema',
  'subtopic': 'Subtema',
  'lesson': 'Lección',
  'folder': 'Carpeta',
};

class MaterialsPage extends ConsumerStatefulWidget {
  const MaterialsPage({required this.path, required this.writable, super.key});
  final String path;
  final bool writable;

  @override
  ConsumerState<MaterialsPage> createState() => _MaterialsPageState();
}

class _MaterialsPageState extends ConsumerState<MaterialsPage> {
  final breadcrumbs = <Record>[];
  final search = TextEditingController();
  String query = '';

  String? get topic =>
      breadcrumbs.isEmpty ? null : breadcrumbs.last['id'] as String;
  String get queryTopic => topic == null ? '' : '?topic=$topic';
  String get resources => '${widget.path}/materials';
  String get topics => '${widget.path}/topics';
  String get visibleResources => query.isEmpty
      ? resources + queryTopic
      : '$resources?q=${Uri.encodeQueryComponent(query)}';

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> newTopic(String kind) => editFields(
    context,
    title: 'Añadir ${levels[kind]!.toLowerCase()}',
    fields: [
      field('title', 'Título', 160),
      field('order', 'Posición (0 a 10 000)', 5, initial: '0'),
    ],
    save: (data) async {
      await ref.read(apiProvider).post(topics, {
        'title': data['title'],
        'topic_id': topic,
        'kind': kind,
        'sort_order': number(data['order']),
      });
      ref.invalidate(rowsProvider(topics + queryTopic));
    },
  );

  Future<void> newResource() => editFields(
    context,
    title: 'Añadir recurso',
    fields: [
      field('title', 'Título', 160),
      field('url', 'Enlace HTTPS', 2000, optional: true),
      field('body', 'Contenido', 8000, optional: true),
    ],
    save: (data) async {
      await ref.read(apiProvider).post(resources, {...data, 'topic_id': topic});
      ref.invalidate(rowsProvider(visibleResources));
    },
  );

  Future<void> moveTopic(Record section) => editFields(
    context,
    title: 'Cambiar posición',
    fields: [
      field(
        'order',
        'Posición (0 a 10 000)',
        5,
        initial: '${section['sort_order']}',
      ),
    ],
    save: (data) async {
      await ref.read(apiProvider).post('$topics/${section['id']}', {
        'sort_order': number(data['order']),
      });
      ref.invalidate(rowsProvider(topics + queryTopic));
    },
  );

  @override
  Widget build(BuildContext context) => PageContent(
    children: [
      TextField(
        controller: search,
        maxLength: 60,
        textInputAction: TextInputAction.search,
        onSubmitted: (value) => setState(() => query = value.trim()),
        decoration: InputDecoration(
          labelText: 'Buscar recursos en el temario',
          suffixIcon: IconButton(
            tooltip: 'Buscar',
            icon: const Icon(Icons.search),
            onPressed: () => setState(() => query = search.text.trim()),
          ),
        ),
      ),
      if (query.isNotEmpty)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            icon: const Icon(Icons.close),
            label: Text('Quitar búsqueda «$query»'),
            onPressed: () => setState(() {
              search.clear();
              query = '';
            }),
          ),
        )
      else ...[
        Wrap(
          spacing: 6,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            TextButton(
              onPressed: breadcrumbs.isEmpty
                  ? null
                  : () => setState(breadcrumbs.clear),
              child: const Text('Temario'),
            ),
            for (var index = 0; index < breadcrumbs.length; index++)
              TextButton(
                onPressed: index == breadcrumbs.length - 1
                    ? null
                    : () => setState(
                        () => breadcrumbs.removeRange(
                          index + 1,
                          breadcrumbs.length,
                        ),
                      ),
                child: Text(breadcrumbs[index]['title'] as String),
              ),
          ],
        ),
        if (widget.writable)
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: newResource,
                icon: const Icon(Icons.add),
                label: const Text('Añadir recurso'),
              ),
              PopupMenuButton<String>(
                tooltip: 'Tipo de sección',
                onSelected: newTopic,
                itemBuilder: (_) => [
                  for (final item in levels.entries)
                    PopupMenuItem(value: item.key, child: Text(item.value)),
                ],
                child: const Padding(
                  padding: EdgeInsets.all(12),
                  child: Text('Añadir sección'),
                ),
              ),
            ],
          ),
        Rows(
          path: topics + queryTopic,
          empty: 'No hay subsecciones.',
          builder: (section) => Card(
            child: ListTile(
              leading: const Icon(Icons.folder_outlined),
              title: Text(section['title'] as String),
              subtitle: Text(levels[section['kind']] ?? 'Sección'),
              trailing: widget.writable
                  ? IconButton(
                      tooltip: 'Cambiar posición de ${section['title']}',
                      icon: const Icon(Icons.swap_vert),
                      onPressed: () => moveTopic(section),
                    )
                  : const Icon(Icons.chevron_right),
              onTap: () => setState(() => breadcrumbs.add(section)),
            ),
          ),
        ),
      ],
      const SizedBox(height: 12),
      Rows(
        path: visibleResources,
        empty: 'No se encontraron recursos.',
        builder: (resource) {
          final url = resource['url'] as String;
          final text = resource['body'] as String;
          return Card(
            child: ExpansionTile(
              leading: Icon(url.isEmpty ? Icons.article_outlined : Icons.link),
              title: Text(resource['title'] as String),
              subtitle: resource['topic'] == null
                  ? null
                  : Text(resource['topic'] as String),
              expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
              childrenPadding: const EdgeInsets.all(16),
              children: [
                if (text.isNotEmpty) SelectableText(text),
                if (url.isNotEmpty)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.open_in_new),
                      label: const Text('Abrir enlace'),
                      onPressed: () =>
                          web.window.open(url, '_blank', 'noopener,noreferrer'),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    ],
  );
}
