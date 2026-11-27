import 'package:material_ui/material_ui.dart';

import 'api.dart';

class LoadError extends StatelessWidget {
  const LoadError(this.message, this.retry, {super.key});
  final String message;
  final VoidCallback retry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: retry, child: const Text('Reintentar')),
        ],
      ),
    ),
  );
}

class PageContent extends StatelessWidget {
  const PageContent({required this.children, super.key});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.topCenter,
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 1100),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
        children: children,
      ),
    ),
  );
}

void showMessage(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}

typedef Field = ({
  String key,
  String label,
  int max,
  bool optional,
  String? initial,
});

Future<void> editFields(
  BuildContext context, {
  required String title,
  required List<Field> fields,
  required Future<void> Function(Map<String, String>) save,
}) => showDialog<void>(
  context: context,
  builder: (_) => EditFieldsDialog(title: title, fields: fields, save: save),
);

Field field(
  String key,
  String label,
  int max, {
  bool optional = false,
  String? initial,
}) => (key: key, label: label, max: max, optional: optional, initial: initial);

class EditFieldsDialog extends StatefulWidget {
  const EditFieldsDialog({
    required this.title,
    required this.fields,
    required this.save,
    super.key,
  });
  final String title;
  final List<Field> fields;
  final Future<void> Function(Map<String, String>) save;

  @override
  State<EditFieldsDialog> createState() => _EditFieldsDialogState();
}

class _EditFieldsDialogState extends State<EditFieldsDialog> {
  final form = GlobalKey<FormState>();
  late final controllers = {
    for (final field in widget.fields)
      field.key: TextEditingController(text: field.initial),
  };
  bool saving = false;
  String? error;

  @override
  void dispose() {
    for (final controller in controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> submit() async {
    if (!form.currentState!.validate()) return;
    setState(() {
      saving = true;
      error = null;
    });
    try {
      await widget.save({
        for (final entry in controllers.entries)
          entry.key: entry.value.text.trim(),
      });
      if (mounted) Navigator.of(context).pop();
    } catch (exception) {
      if (mounted) {
        setState(() {
          saving = false;
          error = errorMessage(exception);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !saving,
    child: AlertDialog(
      title: Text(widget.title),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Form(
            key: form,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final field in widget.fields)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: TextFormField(
                      controller: controllers[field.key],
                      enabled: !saving,
                      decoration: InputDecoration(labelText: field.label),
                      maxLength: field.max,
                      minLines: field.max > 1000 ? 3 : 1,
                      maxLines: field.max > 1000 ? 6 : 1,
                      validator: (value) =>
                          !field.optional && value!.trim().isEmpty
                          ? 'Campo obligatorio'
                          : null,
                    ),
                  ),
                if (error != null)
                  Text(
                    error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: saving ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: saving ? null : submit,
          child: Text(saving ? 'Guardando…' : 'Guardar'),
        ),
      ],
    ),
  );
}
