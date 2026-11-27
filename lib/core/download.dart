import 'package:web/web.dart' as web;

void downloadFromApi(String path) {
  final link = web.HTMLAnchorElement()..href = '/api$path';
  link.click();
}
