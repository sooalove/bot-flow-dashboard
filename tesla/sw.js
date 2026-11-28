// /tesla/sw.js — 행복한 우리집 가족 개인별 알림 (2026-11-23 fpush v1). FCM 데이터 메시지 {title, body, tab, tag, member} → 알림 표시.
// 탭하면 열려 있는 앱으로 가거나(그 탭으로 이동) 새로 열어요. 캐시·오프라인 기능은 없어요(fetch 처리 없음).
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch (_) {}
  const x = d.data || d, tab = /^(jipbap|skin|tesla)$/.test(x.tab || '') ? x.tab : '';
  const o = { body: String(x.body || ''), data: { tab } }; if (x.tag) o.tag = 'fp-' + String(x.tag).slice(0, 40);
  e.waitUntil(self.registration.showNotification(String(x.title || '행복한 우리집'), o));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const tab = (e.notification.data || {}).tab || '';
  e.waitUntil((async () => {
    const cs = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = cs.find(w => w.url.startsWith(self.registration.scope));
    if (c) { try { await c.focus(); } catch (_) {} if (tab) c.postMessage({ fpTab: tab }); return; }
    await clients.openWindow(self.registration.scope + (tab ? '#t=' + tab : ''));
  })());
});
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
