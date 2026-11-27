import 'package:appclase/core/api.dart';
import 'package:appclase/features/access/access.dart';
import 'package:appclase/main.dart';
import 'package:flutter/material.dart';
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
}
