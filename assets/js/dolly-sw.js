/**
 * Portal service worker, served by Dolly_Push::service_worker() from the site root (the scope of the portal).
 * The settings (self.DOLLY_SW) are prepended by PHP.
 */
/* Portal service worker (v2): shows push notifications and opens the portal when one is tapped. */
var C = self.DOLLY_SW || {}, FEED = C.feed, PORTAL = C.portal, ICON = C.icon, BRAND = C.brand, NOTE = C.note;
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
function show(n) {
	return self.registration.showNotification(n.title || BRAND, { body: n.body || '', tag: 'dolly-' + (n.id || 0), icon: ICON, badge: ICON, data: { url: n.url || PORTAL } });
}
self.addEventListener('push', function (e) {
	var data = null;
	try { data = e.data ? e.data.json() : null; } catch (err) { data = null; }
	if (data && data.title) { e.waitUntil(show(data)); return; }
	// Empty push (server without encryption support): ask the site for the new notifications.
	e.waitUntil(fetch(FEED, { credentials: 'include', cache: 'no-store' })
		.then(function (r) { return r.ok ? r.json() : { items: [] }; })
		.catch(function () { return { items: [] }; })
		.then(function (d) {
			var items = d && d.items && d.items.length ? d.items : [{ id: 0, title: BRAND, body: NOTE, url: PORTAL + '#notifiche' }];
			return Promise.all(items.map(show));
		}));
});
self.addEventListener('notificationclick', function (e) {
	e.notification.close();
	var url = (e.notification.data && e.notification.data.url) || PORTAL;
	e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
		for (var i = 0; i < list.length; i++) {
			if (list[i].url.indexOf(PORTAL) === 0 && 'focus' in list[i]) {
				return list[i].focus().then(function (w) { return w && w.navigate ? w.navigate(url) : w; });
			}
		}
		return self.clients.openWindow(url);
	}));
});
