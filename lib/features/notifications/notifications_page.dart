import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api.dart';
import '../../core/widgets.dart';
import '../classes/coursework.dart';

const notificationPath = '/notifications';
const preferencesPath = '/notifications/preferences';
const categories = {
  'announcement': 'Anuncios',
  'material': 'Materiales',
  'assignment': 'Tareas',
  'exam': 'Exámenes',
  'grade': 'Calificaciones',
  'message': 'Mensajes',
};

class NotificationsButton extends ConsumerWidget {
  const NotificationsButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recent =
        ref.watch(rowsProvider(notificationPath)).asData?.value ?? const [];
    final count = recent.where((notice) => notice['seen'] == 0).length;
    return IconButton(
      tooltip: count == 0
          ? 'Notificaciones'
          : 'Notificaciones · $count avisos sin leer',
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text('$count'),
        child: const Icon(Icons.notifications_outlined),
      ),
      onPressed: () => context.push('/avisos'),
    );
  }
}

class NotificationsPage extends ConsumerWidget {
  const NotificationsPage({super.key});

  Future<void> mark(BuildContext context, WidgetRef ref, Record notice) async {
    try {
      await ref.read(apiProvider).post('/notifications/read', {
        'id': notice['id'],
      });
      if (context.mounted) ref.invalidate(rowsProvider(notificationPath));
    } catch (error) {
      if (context.mounted) showMessage(context, errorMessage(error));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    appBar: AppBar(
      leading: IconButton(
        icon: const Icon(Icons.arrow_back),
        tooltip: 'Volver a mis clases',
        onPressed: () => context.go('/'),
      ),
      title: const Text('Notificaciones'),
      actions: [
        IconButton(
          icon: const Icon(Icons.refresh),
          tooltip: 'Actualizar avisos',
          onPressed: () => ref.invalidate(rowsProvider(notificationPath)),
        ),
      ],
    ),
    body: PageContent(
      children: [
        Rows(
          path: notificationPath,
          empty: 'Aún no tienes avisos recientes.',
          builder: (notice) {
            final seen = notice['seen'] == 1;
            final category = categories[notice['category']] ?? 'Actividad';
            return Card(
              child: ListTile(
                leading: Icon(
                  seen
                      ? Icons.notifications_none
                      : Icons.notifications_active_outlined,
                ),
                title: Text('$category · ${notice['name']}'),
                subtitle: Text(
                  '${dateLabel(context, notice['created'] as int)}${seen ? '' : ' · Sin leer'}',
                ),
                onTap: () async {
                  if (!seen) await mark(context, ref, notice);
                  if (context.mounted) {
                    context.push('/clases/${notice['class_id']}');
                  }
                },
                trailing: seen
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.done),
                        tooltip: 'Marcar como leído',
                        onPressed: () => mark(context, ref, notice),
                      ),
              ),
            );
          },
        ),
        const SizedBox(height: 24),
        Text(
          'Preferencias de avisos',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        Rows(
          path: preferencesPath,
          empty: 'No hay preferencias disponibles.',
          builder: (preference) => PreferenceSwitch(
            key: ValueKey(preference['category']),
            category: preference['category'] as String,
            enabled: preference['enabled'] as bool,
          ),
        ),
      ],
    ),
  );
}

class PreferenceSwitch extends ConsumerStatefulWidget {
  const PreferenceSwitch({
    required this.category,
    required this.enabled,
    super.key,
  });
  final String category;
  final bool enabled;

  @override
  ConsumerState<PreferenceSwitch> createState() => _PreferenceSwitchState();
}

class _PreferenceSwitchState extends ConsumerState<PreferenceSwitch> {
  bool saving = false;

  Future<void> toggle(bool value) async {
    setState(() => saving = true);
    try {
      await ref.read(apiProvider).post(preferencesPath, {
        'category': widget.category,
        'enabled': value,
      });
      if (!mounted) return;
      ref.invalidate(rowsProvider(preferencesPath));
      ref.invalidate(rowsProvider(notificationPath));
    } catch (error) {
      if (mounted) showMessage(context, errorMessage(error));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => SwitchListTile(
    value: widget.enabled,
    onChanged: saving ? null : toggle,
    title: Text(categories[widget.category] ?? widget.category),
  );
}
