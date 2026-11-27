import 'dart:async';
import 'dart:js_interop';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:web/web.dart' as web;

import '../../core/api.dart';
import '../../core/widgets.dart';
import 'coursework.dart';

class DocumentsPage extends ConsumerStatefulWidget {
  const DocumentsPage({required this.path, required this.canUpload, super.key});
  final String path;
  final bool canUpload;

  @override
  ConsumerState<DocumentsPage> createState() => _DocumentsPageState();
}

class _DocumentsPageState extends ConsumerState<DocumentsPage> {
  bool uploading = false;

  Future<web.File?> choose() {
    final picker = web.HTMLInputElement()
      ..type = 'file'
      ..accept = '.pdf,.jpg,.jpeg,.png,.docx,.xlsx,.pptx';
    final chosen = Completer<web.File?>();
    picker.onchange = ((web.Event _) => chosen.complete(
      picker.files?.item(0),
    )).toJS;
    picker.oncancel = ((web.Event _) => chosen.complete(null)).toJS;
    picker.click();
    return chosen.future;
  }

  Future<void> upload() async {
    final file = await choose();
    if (file == null || !mounted) return;
    if (file.size > 16 * 1024 * 1024) {
      showMessage(context, 'El documento supera los 16 MB.');
      return;
    }
    setState(() => uploading = true);
    try {
      final api = ref.read(apiProvider);
      final bytes = (await file.arrayBuffer().toDart).toDart.asUint8List();
      await api.upload(widget.path, file.name, bytes);
      if (!mounted) return;
      ref.invalidate(rowsProvider(widget.path));
    } catch (error) {
      if (mounted) showMessage(context, errorMessage(error));
    } finally {
      if (mounted) setState(() => uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) => PageContent(
    children: [
      if (widget.canUpload)
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.icon(
            onPressed: uploading ? null : upload,
            icon: const Icon(Icons.upload_file_outlined),
            label: Text(uploading ? 'Subiendo documento…' : 'Subir documento'),
          ),
        ),
      const SizedBox(height: 12),
      Rows(
        path: widget.path,
        empty: 'Todavía no hay documentos en esta clase.',
        builder: (file) => Card(
          child: ListTile(
            leading: const Icon(Icons.description_outlined),
            title: Text(file['name'] as String),
            subtitle: Text('${((file['bytes'] as int) / 1024).ceil()} KB'),
            trailing: IconButton(
              tooltip: 'Descargar ${file['name']}',
              icon: const Icon(Icons.download_outlined),
              onPressed: () {
                final link = web.HTMLAnchorElement()
                  ..href = '/api${widget.path}/${file['id']}';
                link.click();
              },
            ),
          ),
        ),
      ),
    ],
  );
}
