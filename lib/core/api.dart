import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

typedef Record = Map<String, dynamic>;

final apiProvider = Provider<Api>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return Api(client);
});
final sessionProvider = FutureProvider<Record?>((ref) async {
  try {
    return await ref.watch(apiProvider).record('/me');
  } on ApiError catch (error) {
    if (error.status == 401) return null;
    rethrow;
  }
});
final classesProvider = FutureProvider<List<Record>>(
  (ref) => ref.watch(apiProvider).rows('/classes'),
);
final courseProvider = FutureProvider.autoDispose.family<Record, String>(
  (ref, id) => ref.watch(apiProvider).record('/classes/$id'),
);
final rowsProvider = FutureProvider.autoDispose.family<List<Record>, String>(
  (ref, path) => ref.watch(apiProvider).rows(path),
);

class ApiError implements Exception {
  const ApiError(this.status, this.message);
  final int status;
  final String message;
}

String errorMessage(Object error) => switch (error) {
  ApiError(:final message) => message,
  _ => 'No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.',
};

class Api {
  Api(this.client);
  final http.Client client;

  Future<Record> record(String path) async => (await _request(path)) as Record;

  Future<List<Record>> rows(String path) async =>
      ((await _request(path)) as List).cast<Record>();

  Future<Record> post(String path, [Record payload = const {}]) async =>
      ((await _request(path, payload)) as Record?) ?? {};

  Future<Object?> _request(String path, [Record? payload]) async {
    final uri = Uri.base.resolve('/api$path');
    final response =
        await (payload == null
                ? client.get(uri)
                : client.post(
                    uri,
                    headers: {'Content-Type': 'application/json'},
                    body: jsonEncode(payload),
                  ))
            .timeout(const Duration(seconds: 20));
    if (response.statusCode == 204) return null;
    final Object? data;
    try {
      data = jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      throw const ApiError(503, 'El servidor de APPCLASE no está disponible.');
    }
    if (response.statusCode >= 400) {
      final message = data is Record ? data['error'] as String? : null;
      throw ApiError(
        response.statusCode,
        message ?? 'No se pudo completar la operación.',
      );
    }
    return data;
  }
}
