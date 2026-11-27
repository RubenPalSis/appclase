const loading = document.getElementById('loading');
const status = document.getElementById('status');
const timer = setTimeout(() => {
  status.textContent = navigator.onLine
    ? 'La aplicación tarda en cargar. Recarga la página si el problema continúa.'
    : 'Estás sin conexión. Vuelve a conectarte para cargar tus clases.';
}, 12000);
window.addEventListener('flutter-first-frame', () => {
  clearTimeout(timer);
  loading.remove();
}, { once: true });
if ('serviceWorker' in navigator) {
  let previous = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (previous) {
      window.location.reload();
      return;
    }
    previous = navigator.serviceWorker.controller;
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, { once: true });
}
