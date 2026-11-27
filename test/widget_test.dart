import 'package:appclase/core/api.dart';
import 'package:appclase/features/access/access.dart';
import 'package:appclase/main.dart';
import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Muestra el acceso con Google en una pantalla estrecha', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [sessionProvider.overrideWith((ref) async => null)],
        child: const AppClase(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(AccessPage), findsOneWidget);
    expect(find.text('Continuar con Google'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('El profesor ve la creación de clases en escritorio', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionProvider.overrideWith(
            (ref) async => {
              'user': {'name': 'Docente'},
              'organizations': [
                {'id': 'centro', 'name': 'Centro', 'role': 'teacher'},
              ],
            },
          ),
          classesProvider.overrideWith((ref) async => []),
          rowsProvider.overrideWith((ref, path) async => []),
        ],
        child: const AppClase(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Hola, Docente'), findsOneWidget);
    expect(find.text('Crear clase'), findsOneWidget);
    expect(find.text('Administrar centro'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
