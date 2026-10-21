/**
 * Employee portal: dashboard & clocking, calendar & attendance history, requests,
 * sickness & certificates, notifications, profile.
 */
(function (window, document) {
	'use strict';

	var DOLLY = window.DOLLY, h = DOLLY.h, CFG = DOLLY.config, __ = DOLLY.__, _x = DOLLY._x;
	var root = document.getElementById('dolly-employee-app');
	if (!root) { return; }

	var ACTIONS = {
		entrata: { label: __('Clock-in'), icon: 'log-in', verb: __('Clock in') },
		inizio_pausa: { label: __('Break start'), icon: 'coffee', verb: __('Start break') },
		fine_pausa: { label: __('Break end'), icon: 'briefcase', verb: __('End break') },
		uscita: { label: __('Clock-out'), icon: 'log-out', verb: __('Clock out') }
	};
	// Notifications and profile are reached from the header, not from the bottom bar / side menu.
	var SECTIONS = [
		{ id: 'dashboard', label: _x('Clock-in', 'portal section'), icon: 'clock', nav: true },
		{ id: 'calendario', label: __('Calendar'), icon: 'calendar-days', nav: true },
		{ id: 'richieste', label: __('Requests'), icon: 'inbox', nav: true },
		{ id: 'malattia', label: __('Sickness'), icon: 'stethoscope', nav: true },
		{ id: 'documenti', label: __('Documents'), icon: 'folder-open', nav: true },
		{ id: 'notifiche', label: __('Notifications'), icon: 'bell' },
		{ id: 'profilo', label: __('Profile'), icon: 'circle-user' }
	];
	var SICK_KINDS = { malattia: __('Sickness'), infortunio: __('Injury') };

	var state = {
		me: null,
		section: 'dashboard',
		offset: (CFG.serverTime ? CFG.serverTime * 1000 - Date.now() : 0),
		reqPage: 1, reqStatus: '', sickPage: 1, notifPage: 1,
		month: null, year: null,
		pendingQr: null
	};
	var main, navEl, topActions, bellCount, clockTimer, refreshTimer, calendar;
	// Guided tour: while active, clocking runs in demo mode and nothing is sent to the server.
	var tour = { active: false };

	/* ------------------------------------------------------------------ */
	/* Shell                                                               */
	/* ------------------------------------------------------------------ */

	function shell() {
		bellCount = h('span', { class: 'dolly-count', hidden: true });
		topActions = h('div', { class: 'dolly-topbar__actions' }, [
			h('a', { href: '#notifiche', class: 'dolly-btn dolly-btn--ghost dolly-btn--icon dolly-bell', 'aria-label': __('Notifications'), title: __('Notifications'), dataset: { section: 'notifiche' } }, [DOLLY.icon('bell'), bellCount]),
			h('a', { href: '#profilo', class: 'dolly-btn dolly-btn--ghost dolly-btn--icon', 'aria-label': __('Profile'), title: __('Profile'), dataset: { section: 'profilo' } }, DOLLY.icon('circle-user')),
			DOLLY.button(__('Sign out'), { href: CFG.logoutUrl, variant: 'ghost', icon: 'log-out', iconOnly: true })
		]);
		var top = h('header', { class: 'dolly-topbar' }, [brand(), topActions]);
		navEl = h('nav', { class: 'dolly-nav', 'aria-label': __('Portal sections') }, SECTIONS.filter(function (s) { return s.nav; }).map(function (s) {
			return h('a', { class: 'dolly-nav__link', href: '#' + s.id, dataset: { section: s.id } }, [DOLLY.icon(s.icon), h('span', { text: s.label })]);
		}));
		main = h('main', { class: 'dolly-main', id: 'dolly-main', tabindex: '-1' });
		DOLLY.render(root, [top, h('div', { class: 'dolly-shell' }, [navEl, main])]);
	}

	function brand() {
		return DOLLY.brand(true, state.me ? state.me.first_name || CFG.userName : CFG.userName);
	}

	function updateBadges() {
		if (!state.me) { return; }
		bellCount.hidden = !state.me.unread;
		bellCount.textContent = state.me.unread > 99 ? '99+' : state.me.unread;
		var bell = topActions.querySelector('.dolly-bell');
		bell.setAttribute('aria-label', __('Notifications') + (state.me.unread ? ', ' + state.me.unread + __(' unread') : ''));
		// New documents: count on the "Documenti" menu item.
		var docs = navEl.querySelector('[data-section="documenti"]');
		if (docs) {
			var c = docs.querySelector('.dolly-count') || docs.appendChild(h('span', { class: 'dolly-count' }));
			c.hidden = !state.me.documents_unread;
			c.textContent = state.me.documents_unread > 99 ? '99+' : (state.me.documents_unread || '');
			docs.setAttribute('aria-label', __('Documents') + (state.me.documents_unread ? ', ' + state.me.documents_unread + __(' new') : ''));
		}
	}

	function route() {
		var id = (window.location.hash || '#dashboard').slice(1);
		if (!SECTIONS.some(function (s) { return s.id === id; })) { id = 'dashboard'; }
		state.section = id;
		Array.prototype.forEach.call(root.querySelectorAll('.dolly-nav__link, .dolly-topbar__actions [data-section]'), function (a) {
			if (a.dataset.section === id) { a.setAttribute('aria-current', 'page'); } else { a.removeAttribute('aria-current'); }
		});
		clearInterval(clockTimer);
		clearInterval(refreshTimer);
		if (calendar) { calendar.destroy(); calendar = null; }
		({ dashboard: viewDashboard, calendario: viewCalendar, richieste: viewRequests, malattia: viewSickness, documenti: viewDocuments, notifiche: viewNotifications, profilo: viewProfile })[id]();
		main.focus({ preventScroll: true });
		window.scrollTo(0, 0);
	}

	function pageTitle(text, actions) {
		return h('div', { class: 'dolly-page-title' }, [h('h1', { text: text }), actions ? h('div', { class: 'dolly-btn-row' }, actions) : null]);
	}

	function loadMe() {
		return DOLLY.api('me').then(function (me) {
			state.me = me;
			if (me.server_time) { state.offset = me.server_time * 1000 - Date.now(); }
			updateBadges();
			return me;
		});
	}

	/* ------------------------------------------------------------------ */
	/* Dashboard & clocking                                                */
	/* ------------------------------------------------------------------ */

	function viewDashboard() {
		clearInterval(refreshTimer);
		DOLLY.render(main, DOLLY.loading(__('Loading your day…')));
		loadMe().then(renderDashboard, function (err) {
			DOLLY.render(main, DOLLY.errorState(err, viewDashboard));
		});
		refreshTimer = setInterval(function () {
			if (document.hidden || document.querySelector('.dolly-dialog') || tour.active) { return; }
			loadMe().then(function () { if (state.section === 'dashboard') { renderDashboard(); } }, function () {});
		}, 60000);
	}

	function renderDashboard() {
		var me = state.me, st = me.state, plan = st.plan;
		if (tour.active) {
			// Tutorial: always show a day not yet started, whatever today's real state is.
			st = Object.assign({}, st, { primary: 'entrata', secondary: null, completed: false, blocked: null, punches: {}, last: null, exception: null, previous_incomplete: [] });
		}
		var blocks = [pageTitle(__('Hi ') + (me.first_name || ''))];

		if (st.exception && st.exception.active) {
			blocks.push(DOLLY.alert(__('Verification exception active until ') + DOLLY.fmt.time(st.exception.expires_at) + __(' on ') + DOLLY.fmt.dateTime(st.exception.expires_at).slice(0, 10) + __(': location and QR/PIN are not required.'), 'info'));
		}
		if (st.previous_incomplete && st.previous_incomplete.length) {
			blocks.push(DOLLY.alert(__('Previous days without clock-out: ') + st.previous_incomplete.join(', ') + __('. They are reported to the administrator; you can send a correction request.'), 'warning',
				h('div', { style: 'margin-top:8px' }, DOLLY.button(__('Request correction'), { size: 'sm', icon: 'pencil', onClick: function () { requestDialog({ type: 'correzione' }); } }))));
		}

		// Clock card.
		var timeEl = h('div', { class: 'dolly-clock__time', 'aria-hidden': 'true' });
		var dateEl = h('div', { class: 'dolly-clock__date' });
		function tick() {
			var p = DOLLY.fmt.nowParts(state.offset);
			timeEl.textContent = p.hour + ':' + p.minute + ':' + p.second;
			dateEl.textContent = p.weekday + ' ' + p.day + '/' + p.month + '/' + p.year;
		}
		tick();
		clearInterval(clockTimer);
		clockTimer = setInterval(tick, 1000);

		var clockChildren = [timeEl, dateEl];
		if (st.blocked) {
			clockChildren.push(DOLLY.alert(st.blocked, 'info'));
		} else if (st.completed) {
			clockChildren.push(h('button', { type: 'button', class: 'dolly-clock__btn', disabled: true }, [DOLLY.icon('circle-check'), __('Day completed')]));
		} else if (st.primary) {
			var a = ACTIONS[st.primary];
			var btn = h('button', { type: 'button', class: 'dolly-clock__btn dolly-clock__btn--' + st.primary, dataset: { tour: 'clock-btn' } }, [DOLLY.icon(a.icon), a.verb]);
			btn.addEventListener('click', function () { startPunch(st.primary); });
			clockChildren.push(btn);
			if (st.smart && st.smart.primary) {
				clockChildren.push(h('div', { class: 'dolly-clock__smart' }, [DOLLY.icon('house'), h('span', { text: __('Remote work: clock in with one tap, without presence verification.') })]));
			}
			if (st.secondary === 'uscita') {
				clockChildren.push(h('div', { class: 'dolly-clock__secondary' }, DOLLY.button(__('Early final clock-out'), { icon: 'log-out', onClick: function () { startPunch('uscita', true); } })));
			}
		}
		if (st.last) {
			clockChildren.push(h('div', { class: 'dolly-clock__last' }, [DOLLY.icon('history'), h('span', { text: __('Last action: ') + st.last.label + _x(' at ', 'time') + st.last.time + (st.last.workplace ? ' · ' + st.last.workplace : '') })]));
		}

		// Steps.
		var steps = (plan.has_lunch && !plan.lunch_auto) || st.punches.inizio_pausa ? ['entrata', 'inizio_pausa', 'fine_pausa', 'uscita'] : ['entrata', 'uscita'];
		var stepEls = h('div', { class: 'dolly-steps' + (steps.length === 2 ? ' dolly-steps--2' : ''), role: 'list', 'aria-label': __('Today\'s clock-ins') }, steps.map(function (k) {
			var p = st.punches[k];
			var cls = 'dolly-step' + (p ? ' is-done' : '') + (st.primary === k ? ' is-next' : '');
			return h('div', { class: cls, role: 'listitem' }, [
				h('div', { class: 'dolly-step__label' }, [DOLLY.icon(ACTIONS[k].icon), ACTIONS[k].label]),
				h('div', { class: 'dolly-step__time', text: p ? p.time : '—' }),
				h('span', { class: 'dolly-sr-only', text: p ? __('recorded') : __('not recorded yet') })
			]);
		}));
		clockChildren.push(stepEls);

		blocks.push(DOLLY.card(null, null, h('div', { class: 'dolly-clock', dataset: { tour: 'clock' } }, clockChildren), { accent: true }));

		// Today's info.
		var sched = plan.eligible ? plan.start + '–' + plan.end + (plan.has_lunch ? __(' · break ') + plan.lunch_start + '–' + plan.lunch_end + (plan.lunch_auto ? __(' (counted automatically, no need to clock it)') : '') : __(' · no break')) : __('Day off');
		if (plan.extension_end) { sched += __(' · overtime until ') + plan.extension_end; }
		if (plan.rest_day_extra) { sched = __('Overtime on a day off: ') + sched; }
		if (plan.work_mode === 'smart') { sched += __(' · remote work'); }
		if (plan.work_mode === 'mixed') { sched = plan.start + '–' + plan.end + ' · ' + DOLLY.sprintf(__('on site %1$s, remote %2$s'), plan.office_start + '–' + plan.office_end, plan.smart_start + '–' + plan.smart_end); }
		if (plan.on_call) { sched = __('On-call contract: you start and end your shift when you\'re called in. Hours are approved by the administrator.'); }
		if (plan.closure) {
			sched = plan.closure + __(': your workplace is closed and you don\'t need to clock in. ') + (plan.closure_type === 'holiday'
				? __('If you work anyway, today\'s hours count as holiday hours, with a premium.')
				: __('If you work anyway, today\'s hours count as regular hours.'));
		}
		blocks.push(DOLLY.card(__('Today'), 'calendar-check', h('dl', { class: 'dolly-dl', dataset: { tour: 'today' } }, [
			plan.holiday ? h('dt', { text: __('Public holiday') }) : null, plan.holiday ? h('dd', { text: plan.holiday }) : null,
			h('dt', { text: __('Schedule') }), h('dd', { text: sched }),
			h('dt', { text: __('Workplaces') }), h('dd', { text: me.workplaces.map(function (w) { return w.name; }).join(', ') || __('None') }),
			h('dt', { text: __('Verification') }), h('dd', { text: plan.work_mode === 'smart' && !plan.on_call ? __('Not required (remote work)') : (plan.work_mode === 'mixed' ? DOLLY.sprintf(__('%s for on-site hours; not required for remote work'), verificationLabel(st.verification)) : verificationLabel(st.verification)) })
		])));

		// Open anomalies.
		var anomBox = h('div', {}, DOLLY.loading());
		blocks.push(DOLLY.card(__('Open anomalies'), 'triangle-alert', anomBox));
		DOLLY.render(main, blocks);
		DOLLY.api('anomalies', { query: { status: 'open' } }).then(function (res) {
			DOLLY.render(anomBox, res.items.length ? res.items.map(anomalyItem) : DOLLY.empty(__('No open anomalies'), __('All good.'), 'circle-check'));
		}, function (err) { DOLLY.render(anomBox, DOLLY.errorState(err)); });

		if (state.pendingQr) {
			var code = state.pendingQr; state.pendingQr = null;
			if (st.primary && !st.blocked) { startPunch(st.primary, false, code); }
			else { DOLLY.toast(st.blocked || __('There are no clock-ins to record now.'), 'info'); }
		}
	}

	/** "Posizione GPS oppure QR/PIN della sede", "Posizione GPS e Bluetooth"… */
	function verificationLabel(v) {
		v = v || { methods: ['gps', 'qrpin'], require_gps: false };
		var names = { gps: _x('GPS location', 'in a sentence'), qrpin: __('Workplace QR/PIN'), ble: 'Bluetooth' };
		var codes = v.methods.filter(function (m) { return m !== 'gps'; }).map(function (m) { return names[m]; });
		var label = v.require_gps ? __('GPS location and ') + codes.join(__(' or ')) : v.methods.map(function (m) { return names[m]; }).join(__(' or '));
		return label.charAt(0).toUpperCase() + label.slice(1);
	}

	/** Web Bluetooth is available in Chrome, Edge and Samsung Internet on Android, not in Safari on iPhone. */
	var bleSupported = !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
	function bleUnsupportedMessage() {
		return /iPhone|iPad|iPod/.test(navigator.userAgent)
			? __('On iPhone and iPad, Safari doesn\'t let websites use Bluetooth. Open the portal with the Bluefy app (free on the App Store) or use another method.')
			: __('This browser doesn\'t let websites use Bluetooth. Open the portal in Chrome or use another method.');
	}

	function anomalyItem(a) {
		var note = h('div', { class: 'dolly-small dolly-muted', text: a.employee_note ? __('Your note: ') + a.employee_note : '' });
		// Missing entry or exit: the employee can ask for the punch to be corrected.
		var fix = { unjustified_absence: 'entrata', missing_exit: 'uscita' }[a.type];
		return h('div', { class: 'dolly-alert dolly-alert--error', role: 'group' }, [
			DOLLY.icon(a.type === 'missing_certificate' ? 'file-text' : (a.type === 'unjustified_absence' ? 'user-x' : 'triangle-alert')),
			h('div', { class: 'dolly-alert__body' }, [
				h('strong', { text: a.type_label + (a.work_date ? ' · ' + DOLLY.fmt.date(a.work_date) : '') }),
				h('div', { text: a.details }),
				note,
				h('div', { class: 'dolly-btn-row', style: 'margin-top:8px' }, [
					// Medical certificates are uploaded in "Malattia", the blood donation one in "Richieste".
					a.type === 'missing_certificate' ? DOLLY.button(__('Upload certificate'), { size: 'sm', icon: 'file-up', href: a.related_type === 'request' ? '#richieste' : '#malattia' }) : null,
					fix ? DOLLY.button(__('Request clock-in correction'), { size: 'sm', variant: 'primary', icon: 'pencil', onClick: function () { requestDialog({ type: 'correzione', correction_action: fix, start_date: a.work_date }); } }) : null,
					DOLLY.button(a.employee_note ? __('Edit note') : __('Add note'), { size: 'sm', icon: 'pencil', onClick: function () { anomalyNoteDialog(a); } })
				])
			])
		]);
	}

	function anomalyNoteDialog(a) {
		var f = DOLLY.field({ label: __('Note for the administrator'), name: 'note', type: 'textarea', value: a.employee_note, optional: true });
		var form = h('form', { class: 'dolly-form' }, f);
		DOLLY.dialog({
			title: __('Note on the anomaly'), body: form,
			actions: [
				{ label: __('Cancel') },
				{ label: __('Save note'), variant: 'primary', icon: 'save', onClick: function (close, btn) {
					DOLLY.busy(btn, DOLLY.api('anomalies/' + a.id + '/note', { method: 'POST', body: { note: f.input.value } })).then(function () {
						close(); DOLLY.toast(__('Note saved.'), 'success'); viewDashboard();
					}, function (err) { DOLLY.formError(form, err); });
				} }
			]
		});
	}

	/* ---------- Verification helpers ---------- */

	function getPosition() {
		return new Promise(function (resolve, reject) {
			if (!window.isSecureContext) { reject(new Error(__('Location is only available over a secure connection (HTTPS).'))); return; }
			if (!navigator.geolocation) { reject(new Error(__('This browser doesn\'t support geolocation. Use the QR or the PIN.'))); return; }
			navigator.geolocation.getCurrentPosition(function (pos) {
				resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
			}, function (e) {
				var msg = {
					1: __('Location access denied. Allow location for this site in your browser settings (on iPhone: Settings › Privacy › Location Services › Safari) or use QR/PIN.'),
					2: __('Location not available. Check that GPS is on and try again, or use QR/PIN.'),
					3: __('Timed out while detecting your location. Try again outdoors or use QR/PIN.')
				}[e.code] || __('Unable to detect your location.');
				var err = new Error(msg); err.code = 'gps_' + e.code;
				reject(err);
			}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
		});
	}

	/** Camera QR scanner using jsQR. Resolves with the decoded text. */
	function scanQr(container) {
		var stream = null, stopped = false, video, canvas, ctx, raf;
		var p = new Promise(function (resolve, reject) {
			if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
				reject(new Error(__('The camera is not available in this browser or without HTTPS. Enter the PIN.')));
				return;
			}
			video = h('video', { playsinline: true, muted: true, autoplay: true, 'aria-label': __('Camera preview') });
			video.setAttribute('playsinline', ''); // iOS Safari
			canvas = document.createElement('canvas');
			ctx = canvas.getContext('2d', { willReadFrequently: true });
			DOLLY.render(container, h('div', { class: 'dolly-scanner' }, [video, h('div', { class: 'dolly-scanner__frame', 'aria-hidden': 'true' })]));
			navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (s) {
				stream = s;
				if (stopped) { stop(); return; }
				video.srcObject = s;
				video.play().catch(function () {});
				var last = 0;
				(function loop(ts) {
					if (stopped) { return; }
					raf = window.requestAnimationFrame(loop);
					if (ts - last < 200 || video.readyState < 2) { return; }
					last = ts;
					var w = video.videoWidth, hh = video.videoHeight;
					if (!w) { return; }
					var scale = Math.min(1, 640 / Math.max(w, hh));
					canvas.width = Math.round(w * scale); canvas.height = Math.round(hh * scale);
					ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
					var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
					var code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
					if (code && code.data) { stop(); resolve(code.data); }
				})(0);
			}, function (e) {
				var msg = e && e.name === 'NotAllowedError' ? __('Camera access denied. Allow the camera for this site in your browser settings or enter the PIN.')
					: (e && e.name === 'NotFoundError' ? __('No camera found. Enter the PIN.') : __('Unable to start the camera. Enter the PIN.'));
				reject(new Error(msg));
			});
		});
		function stop() {
			stopped = true;
			if (raf) { window.cancelAnimationFrame(raf); }
			if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); }
		}
		p.stop = stop;
		return p;
	}

	/**
	 * Clocking flow: verification according to the plugin-wide mode, then explicit confirmation.
	 * The same request key is reused on retries, so repeated taps or network retries never duplicate a punch.
	 */
	function startPunch(action, isEarlyExit, presetQr) {
		var st = state.me.state;
		// Tutorial: same screens, but no GPS/QR request and nothing is sent to the server.
		var demo = tour.active;
		var v = demo ? { methods: ['gps', 'qrpin'], require_gps: false } : (st.verification || { methods: ['gps', 'qrpin'], require_gps: false });
		var exceptionActive = !demo && st.exception && st.exception.active;
		// Smart working: no presence verification, just the confirmation.
		var smart = !demo && !!st.smart && ((action === st.primary && st.smart.primary) || (action === st.secondary && st.smart.secondary));
		var allowGps = v.methods.indexOf('gps') !== -1, allowQr = v.methods.indexOf('qrpin') !== -1, allowBle = v.methods.indexOf('ble') !== -1;
		// "GPS as well": position first, then a workplace code (QR/PIN or Bluetooth).
		var requireGps = !exceptionActive && v.require_gps;
		var BLE = (state.me && state.me.settings && state.me.settings.bluetooth) || {};
		var ctx = { action: action, key: DOLLY.requestKey(), gps: null, ticket: null, workplace: null, scanner: null };
		var body = h('div', { class: 'dolly-stack' });
		var dlg = DOLLY.dialog({
			title: ACTIONS[action].label + (isEarlyExit ? __(' (early)') : ''),
			body: body,
			onClose: function () { if (ctx.scanner) { ctx.scanner.stop(); } }
		});

		function show(nodes) { DOLLY.render(body, nodes); }
		function fail(err, retry, alt) {
			show([DOLLY.alert(err.message, 'error'), h('div', { class: 'dolly-btn-row' }, [
				retry ? DOLLY.button(__('Try again'), { icon: 'refresh-cw', variant: 'primary', onClick: retry }) : null,
				alt || null,
				DOLLY.button(__('Close'), { onClick: function () { dlg.close(); } })
			])]);
		}

		function stepStart() {
			if (exceptionActive || smart) { return stepConfirm(); }
			if (presetQr) { var c = presetQr; presetQr = null; return verifyCode('qr', c, afterCode); }
			if (requireGps) { return stepGps(stepCodeChoice); }
			var count = (allowGps ? 1 : 0) + (allowQr ? 1 : 0) + (allowBle ? 1 : 0);
			if (count === 1) {
				if (allowGps) { return stepGps(stepConfirm); }
				return allowQr ? stepCodeChoice() : stepBle(stepConfirm);
			}
			var gpsBtn = allowGps ? DOLLY.button(__('Use my location'), { icon: 'locate-fixed', variant: 'primary', block: true, onClick: function () { stepGps(stepConfirm); } }) : null;
			var qrBtn = allowQr ? DOLLY.button(__('Scan the workplace QR'), { icon: 'scan-line', variant: allowGps ? null : 'primary', block: true, onClick: function () { stepQr(stepConfirm); } }) : null;
			if (gpsBtn) { gpsBtn.dataset.tour = 'gps'; }
			if (qrBtn) { qrBtn.dataset.tour = 'qr'; }
			show([
				h('p', { text: __('Choose how to verify you\'re at the workplace.') }),
				h('div', { class: 'dolly-stack', dataset: { tour: 'methods' } }, [
					gpsBtn,
					qrBtn,
					allowQr ? DOLLY.button(__('Enter the workplace PIN'), { icon: 'hash', block: true, onClick: function () { stepPin(stepConfirm); } }) : null,
					allowBle ? DOLLY.button(__('Use the workplace Bluetooth'), { icon: 'bluetooth', block: true, onClick: function () { stepBle(stepConfirm); } }) : null
				])
			]);
		}
		function afterCode() { return requireGps && !ctx.gps ? stepGps(stepConfirm) : stepConfirm(); }

		/** Workplace code: QR, PIN and/or Bluetooth, whichever are allowed. */
		function stepCodeChoice() {
			if (allowBle && !allowQr) { return stepBle(stepConfirm); }
			show([
				requireGps && ctx.gps ? DOLLY.alert(__('Location acquired.'), 'success') : null,
				h('p', { text: allowBle ? __('Verify with the workplace code: from the display (QR or PIN) or from the Bluetooth device.') : __('Verify with the code shown on the workplace display.') }),
				h('div', { class: 'dolly-stack' }, [
					DOLLY.button(__('Scan the QR'), { icon: 'scan-line', variant: 'primary', block: true, onClick: function () { stepQr(stepConfirm); } }),
					DOLLY.button(__('Enter the PIN'), { icon: 'hash', block: true, onClick: function () { stepPin(stepConfirm); } }),
					allowBle ? DOLLY.button(__('Use Bluetooth'), { icon: 'bluetooth', block: true, onClick: function () { stepBle(stepConfirm); } }) : null
				])
			]);
		}

		/** Bluetooth: the user picks the workplace device in the browser list (it requires a tap). */
		function stepBle(next) {
			var otherBtn = allowQr ? DOLLY.button(__('Use QR or PIN'), { icon: 'scan-line', block: true, onClick: stepCodeChoiceQr }) : null;
			if (!bleSupported) { return fail(new Error(bleUnsupportedMessage()), null, otherBtn); }
			show([
				requireGps && ctx.gps ? DOLLY.alert(__('Location acquired.'), 'success') : null,
				h('p', { text: __('Move close to the workplace\'s Bluetooth device (within a few meters), tap “Find the device” and choose the workplace from the list.') }),
				h('div', { class: 'dolly-stack' }, [
					DOLLY.button(__('Find the device'), { icon: 'bluetooth-searching', variant: 'primary', block: true, onClick: function () { readBle(next); } }),
					otherBtn
				])
			]);
		}
		function stepCodeChoiceQr() { allowBle = false; stepCodeChoice(); }

		function readBle(next) {
			var device = null;
			var done = function () { try { if (device && device.gatt.connected) { device.gatt.disconnect(); } } catch (e) { /* Already disconnected. */ } };
			// requestDevice must run directly in the tap handler: the browser shows its own device list.
			navigator.bluetooth.requestDevice({ filters: [{ services: [BLE.service] }] }).then(function (d) {
				device = d;
				show(DOLLY.loading(__('Reading the code from the device…')));
				return d.gatt.connect();
			}).then(function (server) {
				return server.getPrimaryService(BLE.service);
			}).then(function (service) {
				return service.getCharacteristic(BLE.code);
			}).then(function (ch) {
				return ch.readValue();
			}).then(function (value) {
				done();
				verifyCode('ble', new TextDecoder().decode(value).trim(), next);
			}, function (err) {
				done();
				var name = err && err.name;
				var msg = name === 'NotFoundError' ? __('No device selected. Move closer to the workplace device, check that your phone\'s Bluetooth is on and try again.')
					: (name === 'NotAllowedError' || name === 'SecurityError' ? __('Bluetooth is not allowed for this site. Enable it in the browser settings and try again.')
						: __('Unable to read the Bluetooth device. Move closer and try again.'));
				fail(new Error(msg), function () { stepBle(next); }, allowQr ? DOLLY.button(__('Use QR or PIN'), { icon: 'scan-line', onClick: stepCodeChoiceQr }) : null);
			});
		}

		function stepGps(next) {
			if (demo) { ctx.gps = { accuracy: 10 }; next(); return; }
			show(DOLLY.loading(__('Getting your location… Your location is read only now, for this clock-in.')));
			getPosition().then(function (pos) { ctx.gps = pos; next(); }, function (err) {
				var alt = !requireGps && (allowQr || allowBle) ? DOLLY.button(allowQr ? __('Use QR or PIN') : __('Use Bluetooth'), { icon: allowQr ? 'scan-line' : 'bluetooth', onClick: stepCodeChoice }) : null;
				fail(err, function () { stepGps(next); }, alt);
			});
		}

		function stepQr(next) {
			var box = h('div');
			show([h('p', { text: __('Scan the QR on the workplace display.') }), box, h('div', { class: 'dolly-btn-row' }, [
				DOLLY.button(__('Enter the PIN'), { icon: 'hash', onClick: function () { if (ctx.scanner) { ctx.scanner.stop(); } stepPin(next); } })
			])]);
			ctx.scanner = scanQr(box);
			ctx.scanner.then(function (text) { ctx.scanner = null; verifyCode('qr', text, next); }, function (err) {
				ctx.scanner = null;
				fail(err, function () { stepQr(next); }, DOLLY.button(__('Enter the PIN'), { icon: 'hash', onClick: function () { stepPin(next); } }));
			});
		}

		function stepPin(next) {
			var f = DOLLY.field({ label: __('Workplace PIN (6 digits)'), name: 'pin', attrs: { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', class: 'dolly-input dolly-pin-input' } });
			var form = h('form', { class: 'dolly-form', novalidate: true }, [f, DOLLY.button(__('Verify PIN'), { type: 'submit', variant: 'primary', icon: 'shield-check', block: true })]);
			form.addEventListener('submit', function (e) {
				e.preventDefault();
				var v = f.input.value.replace(/\D/g, '');
				if (v.length !== 6) { DOLLY.showErrors(form, { pin: __('Enter the 6 digits of the PIN.') }); return; }
				verifyCode('pin', v, next, form);
			});
			show([h('p', { text: __('The PIN changes every 15 seconds: enter the one shown now.') }), form]);
		}

		function verifyCode(type, code, next, form) {
			var btn = form ? form.querySelector('button[type=submit]') : null;
			var p = DOLLY.api('attendance/verify', { method: 'POST', body: { type: type, code: code } });
			if (!form) { show(DOLLY.loading(__('Verifying code…'))); }
			DOLLY.busy(btn, p).then(function (res) {
				ctx.ticket = res.ticket; ctx.workplace = res.workplace; next();
			}, function (err) {
				if (form && err.status === 400 && err.code === 'dolly_pin_invalid') { DOLLY.showErrors(form, { pin: err.message }); return; }
				var retry = type === 'qr' ? function () { stepQr(next); } : (type === 'ble' ? function () { stepBle(next); } : function () { stepPin(next); });
				var alt = type === 'qr' ? DOLLY.button(__('Enter the PIN'), { icon: 'hash', onClick: function () { stepPin(next); } })
					: (type === 'ble' && allowQr ? DOLLY.button(__('Use QR or PIN'), { icon: 'scan-line', onClick: stepCodeChoiceQr }) : null);
				fail(err, retry, alt);
			});
		}

		function stepConfirm() {
			var lines = [];
			if (demo) { lines.push(DOLLY.alert(__('Tutorial example: no clock-in will be recorded.'), 'info')); }
			if (smart) { lines.push(DOLLY.alert(__('Remote work: presence verification is not required.'), 'info')); }
			else if (exceptionActive) { lines.push(DOLLY.alert(__('Administrator exception active: verification not required.'), 'info')); }
			if (ctx.workplace) { lines.push(DOLLY.alert(__('Workplace verified: ') + ctx.workplace.name, 'success')); }
			if (ctx.gps) { lines.push(DOLLY.alert(__('Location acquired (accuracy ±') + Math.round(ctx.gps.accuracy) + ' m).', 'success')); }
			if (isEarlyExit) { lines.push(DOLLY.alert(__('You\'re recording your final clock-out: the day will be closed and you won\'t be able to record any more clock-ins today.'), 'warning')); }
			var confirmBtn = h('button', { type: 'button', class: 'dolly-btn dolly-btn--primary dolly-btn--block', dataset: { tour: 'confirm' } }, [DOLLY.icon(ACTIONS[action].icon), h('span', { text: __('Confirm ') + ACTIONS[action].label.toLowerCase() })]);
			confirmBtn.addEventListener('click', function () { submit(confirmBtn); });
			show([h('p', { text: __('The recorded time will be the server time at the moment of confirmation.') }), lines, confirmBtn, DOLLY.button(__('Cancel'), { block: true, onClick: function () { dlg.close(); } })]);
			confirmBtn.focus();
		}

		function submit(btn) {
			// No toast here: it would cover the bottom menu that the next tutorial step asks to tap.
			if (demo) { dlg.close(); return; }
			var payload = { action: action, request_key: ctx.key };
			if (ctx.gps) { payload.gps = ctx.gps; }
			if (ctx.ticket) { payload.ticket = ctx.ticket; }
			DOLLY.busy(btn, DOLLY.api('attendance/punch', { method: 'POST', body: payload })).then(function (res) {
				dlg.close();
				state.me.state = res.state;
				DOLLY.toast(res.message, 'success');
				renderDashboard();
			}, function (err) {
				if (err.data && err.data.state) { state.me.state = err.data.state; }
				if (err.code === 'dolly_challenge_expired' || err.code === 'dolly_ticket_invalid') {
					ctx.ticket = null;
					fail(err, function () { stepCodeChoice(); });
				} else if (err.status === 0) {
					// Network failure: retry with the same idempotency key.
					fail(err, function () { stepConfirm(); });
				} else {
					fail(err, null);
					if (err.data && err.data.state) { renderDashboard(); }
				}
			});
		}

		stepStart();
	}

	/* ------------------------------------------------------------------ */
	/* Calendar & monthly attendance                                       */
	/* ------------------------------------------------------------------ */

	function viewCalendar() {
		var now = DOLLY.fmt.nowParts(state.offset);
		if (!state.year) { state.year = +now.year; state.month = +now.month; }
		var calEl = h('div', { class: 'dolly-calendar' });
		var monthBox = h('div', {}, DOLLY.loading());
		DOLLY.render(main, [
			pageTitle(__('Calendar and attendance'), [DOLLY.button(__('New request'), { variant: 'primary', icon: 'calendar-plus', onClick: function () { requestDialog({}); } })]),
			DOLLY.card(null, null, [calEl, legend(), h('p', { class: 'dolly-small dolly-muted', style: 'margin:12px 0 0', text: __('Tap a day to create a request starting from that date.') })]),
			DOLLY.card(__('Attendance this month'), 'table', monthBox)
		]);
		if (!window.FullCalendar) { DOLLY.render(calEl, DOLLY.alert(__('Calendar not available.'), 'error')); }
		else {
			calendar = new window.FullCalendar.Calendar(calEl, {
				locale: DOLLY.lang, firstDay: 1, initialView: 'dayGridMonth', height: 'auto', timeZone: 'local',
				headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
				buttonText: { today: __('Today') },
				dayMaxEvents: 3,
				eventOrder: __('order,start,-duration,allDay,title'),
				events: function (info, ok, ko) {
					DOLLY.api('calendar', { query: { start: info.startStr.slice(0, 10), end: info.endStr.slice(0, 10) } }).then(ok, function (err) { DOLLY.toast(err.message, 'error'); ko(err); });
				},
				dateClick: function (info) { requestDialog({ start_date: info.dateStr, end_date: info.dateStr }); },
				eventClick: function (info) {
					var rid = info.event.extendedProps.request_id;
					if (rid) { window.location.hash = '#richieste'; }
				}
			});
			calendar.render();
		}
		loadMonth(monthBox);
	}

	function legend() {
		var items = [['var(--dolly-blue-bg)', __('Vacation')], ['var(--dolly-cat-permesso-bg)', __('Leave')], ['var(--dolly-cat-donazione-bg)', __('Blood donation')], ['var(--dolly-accent-soft)', __('Overtime')], ['var(--dolly-red-bg)', __('Sickness / injury')], ['var(--dolly-cat-festivo-bg)', __('Public holiday')], ['var(--dolly-surface-3)', __('Collective closure')], ['var(--dolly-cat-chiusura-festiva-bg)', __('Holiday closure')], ['var(--dolly-green-bg)', __('Day worked')], ['var(--dolly-amber-bg)', __('Incomplete day')], ['var(--dolly-surface)', __('Pending request')]];
		return h('div', { class: 'dolly-legend', 'aria-label': __('Legend') }, items.map(function (i) {
			return h('span', {}, [h('i', { style: 'background:' + i[0] + ';border:1px solid var(--dolly-border-strong)', 'aria-hidden': 'true' }), i[1]]);
		}));
	}

	function monthSelectors(onChange) {
		var years = [];
		for (var y = state.year + 1; y >= state.year - 5; y--) { years.push({ value: y, label: String(y) }); }
		var m = DOLLY.field({ label: __('Month'), type: 'select', value: state.month, options: DOLLY.MONTHS.map(function (n, i) { return { value: i + 1, label: n }; }) });
		var yy = DOLLY.field({ label: __('Year'), type: 'select', value: state.year, options: years });
		m.input.addEventListener('change', function () { state.month = +m.input.value; onChange(); });
		yy.input.addEventListener('change', function () { state.year = +yy.input.value; onChange(); });
		return h('div', { class: 'dolly-toolbar' }, [m, yy]);
	}

	function loadMonth(box) {
		DOLLY.render(box, [monthSelectors(function () { loadMonth(box); }), DOLLY.loading()]);
		DOLLY.api('attendance/month', { query: { year: state.year, month: state.month } }).then(function (data) {
			DOLLY.render(box, [monthSelectors(function () { loadMonth(box); }), monthTable(data)]);
		}, function (err) { DOLLY.render(box, [monthSelectors(function () { loadMonth(box); }), DOLLY.errorState(err, function () { loadMonth(box); })]); });
	}

	function monthTable(data) {
		var today = DOLLY.fmt.today();
		var cols = [
			{ label: __('Date'), render: function (r) { return h('span', {}, [h('strong', { text: r.date_label }), h('br'), h('span', { class: 'dolly-small dolly-muted', text: r.weekday + (r.holiday ? ' · ' + r.holiday : '') + (r.closure ? ' · ' + r.closure + (r.closure_label && r.closure_label !== r.closure ? ' (' + r.closure_label.toLowerCase() + ')' : '') : '') })]); } },
			{ label: __('Status'), render: function (r) { return DOLLY.dayStatusBadge(r.status); } },
			{ label: __('Clock-in'), cls: 'time', render: function (r) { return DOLLY.countedTime(r.entrata, r.entrata_real, r.late_min); } },
			{ label: __('Break start'), cls: 'time', render: function (r) { return r.inizio_pausa || (r.lunch_auto ? h('span', { class: 'dolly-small dolly-muted', text: 'automatica' }) : '—'); } },
			{ label: __('Break end'), key: 'fine_pausa', cls: 'time' },
			{ label: __('Clock-out'), cls: 'time', render: function (r) { return DOLLY.countedTime(r.uscita, r.uscita_real); } },
			{ label: __('Absences'), render: function (r) {
				var b = [];
				if (r.ferie) { b.push(DOLLY.badge(__('Vacation'), 'blue', 'sun')); }
				if (r.donazione) { b.push(DOLLY.badge(__('Blood donation'), 'blue', 'droplet')); }
				if (r.permesso) { b.push(DOLLY.badge(__('Leave ') + r.permesso, 'blue', 'timer')); }
				if (r.malattia) { b.push(DOLLY.badge(r.sick_label || __('Sickness'), 'red', r.status === 'infortunio' ? 'bandage' : 'stethoscope')); }
				if (r.certificate_status === 'missing' || r.certificate_status === 'overdue') { b.push(DOLLY.certBadge(r.certificate_status, r.certificate)); }
				return b.length ? h('div', { class: 'dolly-btn-row' }, b) : '—';
			} },
			{ label: __('Hours'), num: true, render: DOLLY.hoursCell },
			{ label: __('Overtime'), render: DOLLY.extraCell },
			{ label: __('Absence codes'), render: function (r) { return DOLLY.hoursCodes(r.hours); } },
			{ label: __('Anomalies'), render: function (r) { return r.anomalies.length ? h('div', { class: 'dolly-btn-row' }, r.anomalies.map(function (a) { return DOLLY.badge(a, 'red', 'triangle-alert'); })) : '—'; } }
		];
		var foot = h('tfoot', {}, h('tr', {}, [
			h('td', { colspan: 7, text: __('Total ') + data.month_label + (data.provisional ? __(' (provisional)') : '') }),
			h('td', { class: 'num', text: data.total }),
			h('td', { colspan: 3, text: DOLLY.monthTotals(data) })
		]));
		return h('div', {}, [
			DOLLY.table(cols, data.rows, {
				caption: __('Attendance ') + data.month_label, foot: foot,
				rowClass: function (r) { return (r.date === today ? 'is-today ' : '') + (r.status === 'riposo' ? 'is-weekend' : ''); }
			}),
			DOLLY.hoursSummary(data)
		]);
	}

	/* ------------------------------------------------------------------ */
	/* Requests                                                            */
	/* ------------------------------------------------------------------ */

	var TYPE_OPTIONS = [
		{ value: 'ferie', label: __('Vacation (full days)') },
		{ value: 'permesso', label: __('Hourly leave') },
		{ value: 'donazione', label: __('Blood donation') },
		{ value: 'correzione', label: __('Clock-in correction') }
	];

	/** Shown in red above "Tipo di richiesta" and in the tutorial. */
	var LEGAL_NOTICE = __('In any case, every request is subject to review by the employer and can be revoked, even after it has been approved.');

	var LEAVE_KINDS = [
		{ value: 'retribuito', label: __('Regular paid leave'), description: __('Paid absence hours.'), help: __('Paid absence hours, deducted from your leave balance (leave, ROL, former public holidays). This is the leave to use for normal personal needs.') },
		{ value: 'non_retribuito', label: __('Regular unpaid leave'), description: __('Unpaid absence hours.'), help: __('Absence hours granted by the company but unpaid: they are not deducted from your leave balance and are not paid in your paycheck.') },
		{ value: 'evento', label: __('Leave for specific events'), description: __('Law 104, bereavement, marriage, study… Note required.'), help: __('Leave provided by law or contract for special situations: Law 104, bereavement or serious illness of a family member, marriage, birth of a child, exams and study, medical appointments and similar. You must state the event in the note; documentation may be requested.') }
	];

	/** Certificate of a blood donation request: state, files and upload. */
	function donationCertificate(r) {
		if (r.type !== 'donazione' || !r.certificate_status || r.certificate_status === 'not_required') { return null; }
		var needs = r.certificate_status === 'missing' || r.certificate_status === 'overdue';
		var tone = { waiting: ['neutral', 'hourglass'], missing: ['red', 'file-text'], overdue: ['red', 'clock-alert'], uploaded: ['green', 'circle-check'], cleared: ['neutral', 'ban'] }[r.certificate_status] || ['neutral', 'info'];
		var nodes = [h('div', { style: 'margin-top:6px' }, DOLLY.badge(r.certificate_label, tone[0], tone[1]))];
		if (needs && r.certificate_due) { nodes.push(h('div', { class: 'dolly-small', text: __('Certificate due: ') + DOLLY.fmt.date(r.certificate_due) })); }
		if (r.certificates && r.certificates.length) {
			nodes.push(h('ul', { class: 'dolly-small', style: 'margin:6px 0 0;padding-left:18px' }, r.certificates.map(function (c) {
				return h('li', {}, [h('a', { href: DOLLY.downloadUrl('certificates/' + c.id + '/download') }, [DOLLY.icon('download'), ' ' + c.original_name]), ' · ' + DOLLY.fmt.bytes(c.size)]);
			})));
		}
		return h('div', {}, nodes);
	}

	/** "Carica certificato" of a blood donation (PDF, JPG or PNG up to 10 MB). */
	function donationUpload(r) {
		var needs = r.certificate_status === 'missing' || r.certificate_status === 'overdue';
		var fileInput = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png', class: 'dolly-sr-only', id: DOLLY.uid('file') });
		var btn = DOLLY.button(needs ? __('Upload certificate') : __('Add file'), { icon: 'file-up', variant: needs ? 'primary' : null, size: 'sm', onClick: function () { fileInput.click(); } });
		fileInput.addEventListener('change', function () {
			var file = fileInput.files[0];
			if (!file) { return; }
			if (file.size > 10 * 1024 * 1024) { DOLLY.toast(__('The file exceeds 10 MB.'), 'error'); fileInput.value = ''; return; }
			if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) { DOLLY.toast(__('Format not allowed: upload PDF, JPG or PNG.'), 'error'); fileInput.value = ''; return; }
			var fd = new FormData(); fd.append('file', file);
			DOLLY.busy(btn, DOLLY.api('requests/' + r.id + '/certificate', { method: 'POST', form: fd, timeout: 120000 })).then(function () {
				DOLLY.toast(__('Donation certificate uploaded.'), 'success');
				if (state.section === 'richieste') { viewRequests(); }
			}, function (err) { DOLLY.toast(err.message, 'error'); fileInput.value = ''; });
		});
		return h('span', {}, [btn, h('label', { for: fileInput.id, class: 'dolly-sr-only', text: __('Choose the donation certificate file') }), fileInput]);
	}

	function viewRequests() {
		var box = h('div', {}, DOLLY.loading());
		var statusF = DOLLY.field({ label: __('Status'), type: 'select', value: state.reqStatus, options: [{ value: '', label: __('All') }, { value: 'pending', label: __('Pending') }, { value: 'approved', label: _x('Approved', 'plural') }, { value: 'rejected', label: _x('Rejected', 'plural') }, { value: 'cancelled', label: _x('Canceled', 'plural') }] });
		statusF.input.addEventListener('change', function () { state.reqStatus = statusF.input.value; state.reqPage = 1; load(); });
		DOLLY.render(main, [
			pageTitle(__('Requests'), [tourTag(DOLLY.button(__('New request'), { variant: 'primary', icon: 'plus', onClick: function () { requestDialog({}); } }), 'new-request')]),
			tourTag(DOLLY.card(null, null, [h('div', { class: 'dolly-toolbar' }, statusF), box]), 'requests-list')
		]);
		function load() {
			DOLLY.render(box, DOLLY.loading());
			DOLLY.api('requests', { query: { page: state.reqPage, status: state.reqStatus } }).then(function (res) {
				DOLLY.render(box, [
					DOLLY.table([
						{ label: __('Request'), render: function (r) { return h('div', {}, [h('strong', { text: r.type_label }), h('div', { class: 'dolly-small', text: r.summary }), r.notes ? h('div', { class: 'dolly-small dolly-muted', text: __('Notes: ') + r.notes }) : null, donationCertificate(r)]); } },
						{ label: __('Status'), render: function (r) { return h('div', { class: 'dolly-btn-row' }, [DOLLY.requestBadge(r.status, r.status_label), r.pending_amendment ? DOLLY.badge(r.pending_amendment.amend_action === 'cancel' ? __('Cancellation pending') : __('Change pending'), 'amber', 'hourglass') : null]); } },
						{ label: __('Outcome'), render: function (r) { return r.decided_at ? h('div', { class: 'dolly-small' }, [DOLLY.fmt.dateTime(r.decided_at) + ' · ' + r.decided_by, r.decision_note ? h('div', { class: 'dolly-muted', text: r.decision_note }) : null]) : '—'; } },
						{ label: __('Submitted'), render: function (r) { return DOLLY.fmt.dateTime(r.created_at); } },
						{ label: '', srLabel: __('Actions'), render: requestActions }
					], res.items, { empty: [__('No requests'), __('Create a request from the button or the calendar.'), 'inbox'], caption: __('Your requests') }),
					DOLLY.pagination(res, function (p) { state.reqPage = p; load(); }, 'richieste')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function requestActions(r) {
		var btns = [];
		if (r.type === 'turno' || r.type === 'straordinario') { return h('span', { class: 'dolly-small dolly-muted', text: __('Managed by the administrator') }); }
		var editable = (r.status === 'pending' && r.amend_action !== 'cancel') || (r.status === 'approved' && r.type !== 'correzione' && r.amend_action !== 'cancel' && !r.pending_amendment);
		if (editable) {
			btns.push(DOLLY.button(r.status === 'approved' ? __('Request change') : __('Edit'), { size: 'sm', icon: 'pencil', onClick: function () { requestDialog(r); } }));
		}
		if (r.status === 'pending') {
			btns.push(DOLLY.button(__('Delete'), { size: 'sm', icon: 'trash-2', onClick: function () { cancelRequest(r, false); } }));
		} else if (editable) {
			btns.push(DOLLY.button(__('Request cancellation'), { size: 'sm', icon: 'ban', onClick: function () { cancelRequest(r, true); } }));
		}
		if (r.type === 'donazione' && r.can_upload) { btns.unshift(donationUpload(r)); }
		return h('div', { class: 'dolly-actions' }, btns);
	}

	function cancelRequest(r, approved) {
		DOLLY.confirm(approved ? __('Request cancellation?') : __('Delete the request?'),
			approved ? __('The approved request remains valid until the administrator approves the cancellation.') : __('The pending request will be canceled and will stay in the history.'),
			approved ? __('Send cancellation request') : __('Delete'), 'danger').then(function (ok) {
			if (!ok) { return; }
			DOLLY.api('requests/' + r.id, { method: 'DELETE' }).then(function () {
				DOLLY.toast(approved ? __('Cancellation request sent.') : __('Request deleted.'), 'success');
				if (state.section === 'richieste') { viewRequests(); }
			}, function (err) { DOLLY.toast(err.message, 'error'); });
		});
	}

	/**
	 * Create/edit request dialog. When editing an approved request, the change is submitted
	 * for approval and the current approval stays effective meanwhile.
	 */
	function requestDialog(r) {
		r = r || {};
		var isEdit = !!r.id;
		var alertBox = h('div', { hidden: true });
		var typeF = DOLLY.field({ label: __('Request type'), name: 'type', type: 'select', value: r.type || 'ferie', options: TYPE_OPTIONS, attrs: isEdit ? { disabled: true } : {} });
		var dynamic = h('div', { class: 'dolly-form-grid', dataset: { tour: 'request-fields' } });
		var notesF = DOLLY.field({ label: __('Notes'), name: 'notes', type: 'textarea', value: r.notes || '', optional: true, full: true });
		var legal = h('p', { class: 'dolly-legal', role: 'note', dataset: { tour: 'request-legal' }, text: LEGAL_NOTICE });
		var form = h('form', { class: 'dolly-form', novalidate: true, dataset: { tour: 'request-form' } }, [alertBox, legal, typeF, dynamic, notesF]);
		var f = {};
		var leaveKind = r.leave_kind || '';

		/** Notes are mandatory for corrections and for leaves for specific events. */
		function notesLabel() {
			var t = typeF.input.value;
			var required = t === 'correzione' || (t === 'permesso' && leaveKind === 'evento');
			notesF.querySelector('.dolly-optional').hidden = required;
			notesF.querySelector('label').firstChild.textContent = t === 'correzione' ? __('Reason for the correction') : (required ? __('Event you are requesting leave for (required)') : __('Notes'));
		}

		/** Kind of hourly leave, with the help button that explains the three kinds. */
		function leaveKindField() {
			var law = DOLLY.switchControl({ label: __('Law 104 leave'), name: 'law104', checked: !!r.law104, description: __('Turn it on only if the leave falls under Law 104.') });
			var lawBox = h('div', { class: 'dolly-field--full', hidden: leaveKind !== 'evento' }, law);
			var radios = DOLLY.radios({ label: __('Leave type'), name: 'leave_kind', value: leaveKind, full: true, options: LEAVE_KINDS, onChange: function (v) { leaveKind = v; lawBox.hidden = v !== 'evento'; notesLabel(); } });
			var helpBox = h('div', { hidden: true, id: DOLLY.uid('help') }, DOLLY.alert(null, 'info', h('ul', { class: 'dolly-help-list' }, LEAVE_KINDS.map(function (k) {
				return h('li', {}, [h('strong', { text: k.label }), k.help]);
			}))));
			var helpBtn = h('button', { type: 'button', class: 'dolly-help-btn', 'aria-label': __('What are the leave types?'), 'aria-expanded': 'false', 'aria-controls': helpBox.id, title: __('What are the leave types?') }, DOLLY.icon('circle-help'));
			helpBtn.addEventListener('click', function () {
				helpBox.hidden = !helpBox.hidden;
				helpBtn.setAttribute('aria-expanded', helpBox.hidden ? 'false' : 'true');
			});
			var legend = radios.querySelector('legend');
			legend.classList.add('dolly-label-row');
			legend.appendChild(helpBtn);
			legend.parentNode.insertBefore(helpBox, legend.nextSibling);
			f.leave_kind = radios;
			f.law104 = law;
			return [radios, lawBox];
		}

		function build() {
			var t = typeF.input.value;
			f = {};
			var nodes = [];
			if (t === 'ferie' || t === 'permesso') {
				if (t === 'permesso') { nodes = nodes.concat(leaveKindField()); }
				f.start_date = DOLLY.dateField({ label: __('From'), name: 'start_date', value: r.start_date, required: true });
				f.end_date = DOLLY.dateField({ label: __('To'), name: 'end_date', value: r.end_date || r.start_date, required: true });
				nodes.push(f.start_date, f.end_date);
				if (t === 'permesso') {
					f.start_time = DOLLY.timeField({ label: _x('From', 'time'), name: 'start_time', value: r.start_time, required: true });
					f.end_time = DOLLY.timeField({ label: _x('To', 'time'), name: 'end_time', value: r.end_time, required: true });
					nodes.push(f.start_time, f.end_time);
				}
			} else if (t === 'donazione') {
				var ds = state.me ? state.me.settings : {};
				f.start_date = DOLLY.dateField({ label: __('Donation day'), name: 'start_date', value: r.start_date, required: true });
				nodes.push(f.start_date, h('div', { class: 'dolly-field--full' }, DOLLY.alert(
					__('Absence for the whole day of the donation. ') + (ds.donation_certificate_mode === 'disabled'
						? __('The donation certificate is not required.')
						: __('From the day after the donation, you will need to upload the donation certificate here in Requests') + (ds.donation_certificate_mode === 'deadline' ? __(', within ') + ds.donation_certificate_days + __(' days.') : '.')), 'info')));
			} else if (t === 'correzione') {
				f.start_date = DOLLY.dateField({ label: __('Date'), name: 'start_date', value: r.start_date, required: true });
				f.correction_action = DOLLY.field({ label: _x('Clock-in', 'portal section'), name: 'correction_action', type: 'select', value: r.correction_action || 'uscita', options: Object.keys(ACTIONS).map(function (k) { return { value: k, label: ACTIONS[k].label }; }) });
				f.start_time = DOLLY.timeField({ label: __('Corrected time'), name: 'start_time', value: r.start_time, required: true });
				nodes.push(f.start_date, f.correction_action, f.start_time);
			}
			DOLLY.closePicker();
			DOLLY.render(dynamic, nodes);
			notesLabel();
		}
		typeF.input.addEventListener('change', build);
		build();

		DOLLY.dialog({
			title: isEdit ? (r.status === 'approved' ? __('Request change') : __('Edit request')) : __('New request'),
			body: [r.status === 'approved' ? DOLLY.alert(__('The change requires the administrator\'s approval. Until then, the approved request remains valid.'), 'info') : null, form],
			actions: [
				{ label: __('Cancel') },
				{ label: isEdit ? __('Send change') : __('Send request'), variant: 'primary', icon: 'send', onClick: function (close, btn) {
					DOLLY.clearErrors(form); alertBox.hidden = true;
					var t = typeF.input.value;
					var spec = {};
					['start_date', 'end_date'].forEach(function (k) { if (f[k]) { spec[k] = [f[k], 'date', true]; } });
					['start_time', 'end_time'].forEach(function (k) { if (f[k]) { spec[k] = [f[k], 'time', true]; } });
					var read = DOLLY.readDateTimes(spec);
					if (t === 'permesso') {
						if (!leaveKind) { read.errors.leave_kind = __('Choose the leave type.'); }
						else if (leaveKind === 'evento' && !notesF.input.value.trim()) { read.errors.notes = __('Enter the event you are requesting leave for.'); }
					}
					if (Object.keys(read.errors).length) { DOLLY.showErrors(form, read.errors); return; }
					var body = Object.assign({ type: t, notes: notesF.input.value }, read.values);
					if (t === 'permesso') { body.leave_kind = leaveKind; body.law104 = leaveKind === 'evento' && f.law104.control.isOn(); }
					if (t === 'correzione') { body.correction_action = f.correction_action.input.value; }
					if (!body.end_date && body.start_date) { body.end_date = body.start_date; }
					var p = isEdit ? DOLLY.api('requests/' + r.id, { method: 'PUT', body: body }) : DOLLY.api('requests', { method: 'POST', body: body });
					DOLLY.busy(btn, p).then(function () {
						close();
						DOLLY.toast(isEdit && r.status === 'approved' ? __('Change sent for approval.') : (isEdit ? __('Request updated.') : __('Request sent.')), 'success');
						route();
					}, function (err) { DOLLY.formError(form, err, alertBox); });
				} }
			]
		});
	}

	/* ------------------------------------------------------------------ */
	/* Documents                                                           */
	/* ------------------------------------------------------------------ */

	var DOC_ICONS = { contratto: 'file-signature', cu: 'receipt-text', busta_paga: 'wallet', altro: 'file' };

	/** Contracts, CU, payslips and other documents sent by the administrator, by category. */
	function viewDocuments() {
		var box = h('div', {}, DOLLY.loading());
		var filter = state.docFilter || '';
		DOLLY.render(main, [
			pageTitle(__('Documents')),
			DOLLY.alert(__('Here you find the documents the company sends you: contract, tax certificate, payslips and others. Only you and the administrators can see them.'), 'info'),
			box
		]);
		function load() {
			DOLLY.api('documents').then(function (d) {
				var groups = d.groups.filter(function (g) { return g.items.length; });
				if (!d.total) { DOLLY.render(box, DOLLY.card(null, null, DOLLY.empty(__('No documents'), __('When the company sends you a document you get a notification and find it here.'), 'folder-open'))); return; }
				if (filter && !groups.some(function (g) { return g.key === filter; })) { filter = ''; }
				var tabs = h('div', { class: 'dolly-doc-tabs', role: 'group', 'aria-label': __('Categories') }, [{ key: '', label: __('All'), n: d.total }].concat(groups.map(function (g) { return { key: g.key, label: g.label, n: g.items.length }; })).map(function (t) {
					var b = h('button', { type: 'button', class: 'dolly-chip', 'aria-pressed': t.key === filter ? 'true' : 'false' }, [t.label + ' · ' + t.n]);
					b.addEventListener('click', function () { filter = state.docFilter = t.key; load(); });
					return b;
				}));
				DOLLY.render(box, [tabs, h('div', { class: 'dolly-doc-groups' }, groups.filter(function (g) { return !filter || g.key === filter; }).map(function (g) {
					return DOLLY.card(null, null, [
						h('h2', { class: 'dolly-doc-group__title' }, [DOLLY.icon(DOC_ICONS[g.key] || 'folder'), g.label, h('span', { class: 'dolly-doc-group__count', text: String(g.items.length) })]),
						h('ul', { class: 'dolly-doc-list' }, g.items.map(docItem))
					]);
				}))]);
				DOLLY.icons();
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		function docItem(doc) {
			var open = h('a', { class: 'dolly-btn dolly-btn--sm' + (doc.viewed_at ? '' : ' dolly-btn--primary'), href: DOLLY.downloadUrl('documents/' + doc.id + '/download', doc.inline ? { inline: 1 } : {}), target: doc.inline ? '_blank' : null, rel: doc.inline ? 'noopener' : null }, [DOLLY.icon(doc.inline ? 'eye' : 'download'), h('span', { text: doc.inline ? __('Open') : __('Download') })]);
			var li = h('li', { class: 'dolly-doc' + (doc.viewed_at ? '' : ' is-new') }, [
				h('span', { class: 'dolly-doc__icon', 'aria-hidden': 'true' }, DOLLY.icon(doc.mime === 'application/pdf' ? 'file-text' : (doc.inline ? 'image' : 'file'))),
				h('div', { class: 'dolly-doc__text' }, [
					h('strong', { text: doc.title }),
					doc.viewed_at ? null : DOLLY.badge(__('New'), 'blue', 'sparkles'),
					doc.description ? h('span', { class: 'dolly-small', text: doc.description }) : null,
					h('span', { class: 'dolly-small dolly-muted', text: DOLLY.fmt.dateTime(doc.uploaded_at) + ' · ' + DOLLY.fmt.bytes(doc.size) + ' · ' + doc.original_name })
				]),
				h('div', { class: 'dolly-doc__actions' }, [
					open,
					doc.inline ? h('a', { class: 'dolly-btn dolly-btn--sm dolly-btn--ghost', href: DOLLY.downloadUrl('documents/' + doc.id + '/download'), 'aria-label': __('Download ') + doc.title, title: __('Download') }, DOLLY.icon('download')) : null
				])
			]);
			open.addEventListener('click', function () {
				if (doc.viewed_at) { return; }
				// The server records the first opening: update the counter shortly after.
				setTimeout(function () { loadMe().then(function () { if (state.section === 'documenti') { load(); } }, function () {}); }, 1500);
			});
			return li;
		}
		load();
	}

	/* ------------------------------------------------------------------ */
	/* Sickness & certificates                                             */
	/* ------------------------------------------------------------------ */

	function viewSickness() {
		var box = h('div', {}, DOLLY.loading());
		var s = state.me ? state.me.settings : {};
		var info = s.certificate_mode === 'disabled' ? __('The medical certificate is not required.')
			: (s.certificate_mode === 'deadline' ? __('The medical certificate is required within ') + s.certificate_days + __(' calendar days of the report.') : __('The medical certificate is required: upload it as soon as it is available.'));
		DOLLY.render(main, [
			pageTitle(__('Sickness and injury'), [tourTag(DOLLY.button(__('Report sickness/injury'), { variant: 'primary', icon: 'stethoscope', onClick: sicknessDialog }), 'new-sickness')]),
			DOLLY.alert(__('Sickness or injury is recorded immediately, without approval. ') + info, 'info'),
			tourTag(DOLLY.card(__('Your reports'), 'file-text', box), 'sick-list')
		]);
		function load() {
			DOLLY.api('sickness', { query: { page: state.sickPage } }).then(function (res) {
				DOLLY.render(box, [
					res.items.length ? h('div', { class: 'dolly-stack' }, res.items.map(sicknessItem)) : DOLLY.empty(__('No sickness or injury reported'), '', 'stethoscope'),
					DOLLY.pagination(res, function (p) { state.sickPage = p; load(); }, 'malattie')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function sicknessItem(s) {
		var needs = s.certificate_status === 'missing' || s.certificate_status === 'overdue';
		var uploadBtn = DOLLY.button(needs ? __('Upload certificate') : __('Add file or protocol'), { icon: 'file-up', variant: needs ? 'primary' : null, size: 'sm', onClick: function () { certificateDialog(s); } });
		return h('article', { class: 'dolly-card', style: 'box-shadow:none' }, [
			h('div', { class: 'dolly-card__head' }, [
				h('h3', { text: (s.kind_label || __('Sickness')) + __(' from ') + DOLLY.fmt.date(s.start_date) + __(' to ') + DOLLY.fmt.date(s.end_date) }),
				DOLLY.certBadge(s.certificate_status, s.certificate_label)
			]),
			s.reported_by_admin ? h('p', { class: 'dolly-small dolly-muted', text: __('Entered by the administrator.') }) : null,
			s.certificate_due && needs ? h('p', { class: 'dolly-small', text: __('Certificate due: ') + DOLLY.fmt.date(s.certificate_due) }) : null,
			s.notes ? h('p', { class: 'dolly-small dolly-muted', text: __('Notes: ') + s.notes }) : null,
			s.protocol ? h('p', { class: 'dolly-small', text: __('Certificate protocol number: ') + s.protocol }) : null,
			s.certificates.length ? h('ul', { class: 'dolly-small' }, s.certificates.map(function (c) {
				return h('li', {}, [h('a', { href: DOLLY.downloadUrl('certificates/' + c.id + '/download') }, [DOLLY.icon('download'), ' ' + c.original_name]), ' · ' + DOLLY.fmt.bytes(c.size) + ' · ' + DOLLY.fmt.dateTime(c.uploaded_at)]);
			})) : null,
			h('div', { class: 'dolly-btn-row' }, [uploadBtn])
		]);
	}

	/**
	 * Medical certificate: the file and/or the protocol number of the telematic certificate, as required
	 * by the settings (with neither required, one of the two is enough).
	 */
	function certificateDialog(s) {
		var need = (state.me && state.me.settings && state.me.settings.certificate_needs) || { file: true, protocol: false };
		var alertBox = h('div', { hidden: true });
		var protocol = DOLLY.field({ label: __('Certificate protocol number'), name: 'protocol', value: s.protocol || '', required: need.protocol && !s.protocol, optional: !need.protocol, help: __('You find it on the electronic certificate issued by the doctor (protocol number / PUC).'), attrs: { maxlength: 40, autocapitalize: 'characters', spellcheck: 'false', autocomplete: 'off' } });
		var fileInput = h('input', { type: 'file', class: 'dolly-input', id: DOLLY.uid('file'), accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png' });
		var fileField = h('div', { class: 'dolly-field', dataset: { name: 'file' } }, [
			h('label', { class: 'dolly-label', for: fileInput.id }, [__('Certificate file'), need.file && !s.certificates.length ? null : h('span', { class: 'dolly-optional', text: __(' (optional)') })]),
			fileInput,
			h('span', { class: 'dolly-help', text: __('PDF, JPG or PNG, max 10 MB.') }),
			h('span', { class: 'dolly-error', hidden: true })
		]);
		var rule = need.file && need.protocol ? __('Both the file and the protocol number are required.')
			: (need.file ? __('The file is required; the protocol number is optional.')
				: (need.protocol ? __('The protocol number is required; the file is optional.') : __('Either the file or the protocol number is enough.')));
		var form = h('form', { class: 'dolly-form', novalidate: true }, [alertBox, DOLLY.alert(rule, 'info'), protocol, fileField]);
		DOLLY.dialog({
			title: __('Medical certificate'), body: form,
			actions: [{ label: __('Cancel') }, { label: __('Send'), variant: 'primary', icon: 'send', onClick: function (close, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var file = fileInput.files[0], prot = protocol.input.value.trim(), errors = {};
				if (file && file.size > 10 * 1024 * 1024) { errors.file = __('The file exceeds 10 MB.'); }
				else if (file && !/\.(pdf|jpe?g|png)$/i.test(file.name)) { errors.file = __('Format not allowed: upload PDF, JPG or PNG.'); }
				if (need.file && !file && !s.certificates.length) { errors.file = __('The certificate file is required.'); }
				if (need.protocol && !prot && !s.protocol) { errors.protocol = __('The protocol number is required.'); }
				if (!file && !prot && !errors.file && !errors.protocol) { errors[need.protocol && !need.file ? 'protocol' : 'file'] = __('Enter the protocol number or choose the file.'); }
				if (Object.keys(errors).length) { DOLLY.showErrors(form, errors); return; }
				var fd = new FormData();
				if (file) { fd.append('file', file); }
				if (prot) { fd.append('protocol', prot); }
				DOLLY.busy(btn, DOLLY.api('sickness/' + s.id + '/certificate', { method: 'POST', form: fd, timeout: 120000 })).then(function () {
					close(); DOLLY.toast(__('Certificate sent.'), 'success'); viewSickness();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			} }]
		});
	}

	function sicknessDialog() {
		var alertBox = h('div', { hidden: true });
		var today = DOLLY.fmt.today();
		var kind = DOLLY.radios({ label: __('Type'), name: 'kind', value: 'malattia', full: true, options: [
			{ value: 'malattia', label: __('Sickness') },
			{ value: 'infortunio', label: __('Injury') }
		] });
		kind.dataset.tour = 'sick-kind';
		var sd = DOLLY.dateField({ label: __('From'), name: 'start_date', value: today, required: true });
		var ed = DOLLY.dateField({ label: __('To'), name: 'end_date', value: today, required: true });
		var notes = DOLLY.field({ label: __('Notes'), name: 'notes', type: 'textarea', optional: true, full: true, help: __('Visible only to you and the administrator. Don\'t include a diagnosis.') });
		var form = h('form', { class: 'dolly-form', novalidate: true }, [alertBox, h('div', { class: 'dolly-form-grid' }, [kind, sd, ed, notes])]);
		DOLLY.dialog({
			title: __('Report sickness/injury'), body: form,
			actions: [
				{ label: __('Cancel') },
				{ label: __('Report'), variant: 'primary', icon: 'send', onClick: function (close, btn) {
					DOLLY.clearErrors(form);
					var read = DOLLY.readDateTimes({ start_date: [sd, 'date', true], end_date: [ed, 'date', true] });
					if (Object.keys(read.errors).length) { DOLLY.showErrors(form, read.errors); return; }
					var k = kind.value() || 'malattia';
					DOLLY.busy(btn, DOLLY.api('sickness', { method: 'POST', body: Object.assign({ kind: k, notes: notes.input.value }, read.values) })).then(function (s) {
						close();
						DOLLY.toast((k === 'infortunio' ? __('Injury recorded.') : __('Sickness recorded.')) + (s.conflict ? __(' A conflict with attendance or vacation was flagged: the administrator will review it.') : ''), 'success');
						viewSickness();
					}, function (err) { DOLLY.formError(form, err, alertBox); });
				} }
			]
		});
	}

	/* ------------------------------------------------------------------ */
	/* Notifications                                                       */
	/* ------------------------------------------------------------------ */

	function viewNotifications() {
		var box = h('div', {}, DOLLY.loading());
		var readAll = DOLLY.button(__('Mark all as read'), { icon: 'check', onClick: function () {
			DOLLY.busy(readAll, DOLLY.api('notifications/read-all', { method: 'POST' })).then(function () { state.me && (state.me.unread = 0); updateBadges(); load(); });
		} });
		DOLLY.render(main, [pageTitle(__('Notifications'), [readAll]), DOLLY.card(null, null, box)]);
		function load() {
			DOLLY.api('notifications', { query: { page: state.notifPage } }).then(function (res) {
				if (state.me) { state.me.unread = res.unread; updateBadges(); }
				DOLLY.render(box, [
					res.items.length ? h('ul', { class: 'dolly-stack', style: 'list-style:none;padding:0;margin:0' }, res.items.map(function (n) {
						return h('li', { class: 'dolly-alert dolly-alert--' + (n.read ? 'info' : 'warning') }, [
							DOLLY.icon(n.read ? 'bell' : 'bell-ring'),
							h('div', { class: 'dolly-alert__body' }, [
								h('strong', { text: n.title }), n.read ? null : h('span', { class: 'dolly-sr-only', text: __(' (unread)') }),
								h('div', { style: 'white-space:pre-line', text: n.body }),
								h('div', { class: 'dolly-small dolly-muted', text: DOLLY.fmt.dateTime(n.created_at) }),
								h('div', { class: 'dolly-btn-row', style: 'margin-top:6px' }, [
									DOLLY.button(__('Open'), { size: 'sm', icon: 'arrow-right', onClick: function () { showNotification(n, load); } }),
									n.read ? null : DOLLY.button(__('Mark as read'), { size: 'sm', icon: 'check', onClick: function () { markRead(n).then(load); } })
								])
							])
						]);
					})) : DOLLY.empty(__('No notifications'), __('Here you\'ll find request outcomes, certificates and anomalies.'), 'bell'),
					DOLLY.pagination(res, function (p) { state.notifPage = p; load(); }, 'notifiche')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		function markRead(n) {
			return DOLLY.api('notifications/' + n.id + '/read', { method: 'POST' }).then(function (r) { if (state.me) { state.me.unread = r.unread; updateBadges(); } });
		}
		load();
	}

	var SECTION_LABELS = { dashboard: _x('Clock-in', 'portal section'), calendario: __('Calendar'), richieste: __('Requests'), malattia: __('Sickness'), profilo: __('Profile') };

	/**
	 * Shows one notification in a pop-up (subject, date, message) and marks it as read. When it refers to a
	 * section of the portal (e.g. a request), a button leads there.
	 */
	function showNotification(n, onClose) {
		var section = '';
		try { section = n.link ? new URL(n.link, window.location.href).hash.slice(1) : ''; } catch (e) { section = ''; }
		var go = SECTION_LABELS[section] ? { label: __('Go to ') + SECTION_LABELS[section], icon: 'arrow-right', onClick: function (close) { close(); window.location.hash = '#' + section; } } : null;
		DOLLY.dialog({
			title: n.title,
			body: [
				h('p', { class: 'dolly-small dolly-muted', style: 'margin:0 0 8px', text: DOLLY.fmt.dateTime(n.created_at) }),
				h('div', { class: 'dolly-notice-body', text: n.body || '' })
			],
			onClose: function () { if (onClose) { onClose(); } },
			actions: [go, { label: __('Close'), variant: 'primary' }].filter(Boolean)
		});
		if (!n.read) {
			DOLLY.api('notifications/' + n.id + '/read', { method: 'POST' }).then(function (r) { n.read = true; if (state.me) { state.me.unread = r.unread; updateBadges(); } }, function () {});
		}
	}

	/** Opens a notification by id (tap on a push notification: /portale/?n=ID). */
	function openNotificationById(id) {
		DOLLY.api('notifications/' + id).then(function (n) { showNotification(n); }, function (err) { DOLLY.toast(err.message, 'error'); });
	}

	/** Messages the administration wants read as soon as the portal opens: one pop-up after the other. */
	function showEntryPopups(list) {
		if (!list || !list.length) { return; }
		var n = list[0];
		showNotification(n, function () { showEntryPopups(list.slice(1)); });
	}

	/* ------------------------------------------------------------------ */
	/* Profile                                                             */
	/* ------------------------------------------------------------------ */

	function viewProfile() {
		DOLLY.render(main, DOLLY.loading());
		loadMe().then(function (me) {
			var alert1 = h('div', { hidden: true });
			var fn = DOLLY.field({ label: __('Name'), name: 'first_name', value: me.first_name, required: true, attrs: { autocomplete: 'given-name' } });
			var ln = DOLLY.field({ label: __('Last name'), name: 'last_name', value: me.last_name, required: true, attrs: { autocomplete: 'family-name' } });
			var ph = DOLLY.field({ label: __('Phone'), name: 'phone', type: 'tel', value: me.phone, optional: true, attrs: { autocomplete: 'tel' } });
			var em = DOLLY.field({ label: __('Email'), name: 'email', type: 'email', value: me.email, required: true, attrs: { autocomplete: 'email' } });
			var saveBtn = DOLLY.button(__('Save profile'), { type: 'submit', variant: 'primary', icon: 'save' });
			var form1 = h('form', { class: 'dolly-form', novalidate: true }, [alert1, h('div', { class: 'dolly-form-grid' }, [fn, ln, ph, em]), h('div', { class: 'dolly-btn-row' }, saveBtn)]);
			form1.addEventListener('submit', function (e) {
				e.preventDefault(); DOLLY.clearErrors(form1); alert1.hidden = true;
				DOLLY.busy(saveBtn, DOLLY.api('me/profile', { method: 'POST', body: { first_name: fn.input.value, last_name: ln.input.value, phone: ph.input.value, email: em.input.value } })).then(function () {
					DOLLY.toast(__('Profile updated.'), 'success');
				}, function (err) { DOLLY.formError(form1, err, alert1); });
			});

			var alert2 = h('div', { hidden: true });
			var cur = DOLLY.field({ label: __('Current password'), name: 'current_password', type: 'password', required: true, attrs: { autocomplete: 'current-password' } });
			var np = DOLLY.field({ label: __('New password'), name: 'new_password', type: 'password', required: true, help: __('At least 8 characters.'), attrs: { autocomplete: 'new-password', minlength: 8 } });
			var np2 = DOLLY.field({ label: __('Repeat new password'), name: 'new_password2', type: 'password', required: true, attrs: { autocomplete: 'new-password' } });
			var pwBtn = DOLLY.button(__('Change password'), { type: 'submit', variant: 'primary', icon: 'key-round' });
			var form2 = h('form', { class: 'dolly-form', novalidate: true }, [alert2, h('div', { class: 'dolly-form-grid' }, [cur, h('span'), np, np2]), h('div', { class: 'dolly-btn-row' }, pwBtn)]);
			form2.addEventListener('submit', function (e) {
				e.preventDefault(); DOLLY.clearErrors(form2); alert2.hidden = true;
				if (np.input.value.length < 8) { DOLLY.showErrors(form2, { new_password: __('At least 8 characters.') }); return; }
				if (np.input.value !== np2.input.value) { DOLLY.showErrors(form2, { new_password2: __('Passwords do not match.') }); return; }
				DOLLY.busy(pwBtn, DOLLY.api('me/password', { method: 'POST', body: { current_password: cur.input.value, new_password: np.input.value } })).then(function () {
					DOLLY.toast(__('Password updated. The page will reload.'), 'success');
					setTimeout(function () { window.location.reload(); }, 1500);
				}, function (err) { DOLLY.formError(form2, err, alert2); });
			});

			var form3 = bankForm(me);

			// Language of the portal and of the notifications: round flags; saved at once, then the page reloads.
			var lang = me.language || { choice: '', available: {}, default: '', flags: {} };
			var langBtns = h('div', { class: 'dolly-langs', role: 'group', 'aria-label': __('Portal language') });
			function langButton(value, label, flag) {
				var b = h('button', { type: 'button', class: 'dolly-lang', 'aria-pressed': lang.choice === value ? 'true' : 'false' }, [flag ? h('span', { html: flag }) : DOLLY.icon('globe'), h('span', { text: label })]);
				b.addEventListener('click', function () {
					if (b.getAttribute('aria-pressed') === 'true') { return; }
					DOLLY.busy(b, DOLLY.api('me/language', { method: 'POST', body: { locale: value } })).then(function () { window.location.reload(); }, function (err) { DOLLY.toast(err.message, 'error'); });
				});
				return b;
			}
			DOLLY.append(langBtns, [langButton('', __('Default') + (lang.default ? ' (' + lang.default + ')' : ''), null)].concat(Object.keys(lang.available).map(function (k) { return langButton(k, lang.available[k], (lang.flags || {})[k]); })));
			var langSel = h('div', { class: 'dolly-field' }, [langBtns, h('span', { class: 'dolly-help', text: __('Notifications and emails will also reach you in this language.') })]);

			var s = me.schedule;
			DOLLY.render(main, [
				pageTitle(__('Profile')),
				DOLLY.card(__('Personal details'), 'circle-user', [h('p', { class: 'dolly-muted', text: __('Username: ') + me.username + __(' (cannot be changed)') }), form1]),
				DOLLY.card(__('Bank details'), 'landmark', form3),
				DOLLY.card(__('Language'), 'languages', langSel),
				DOLLY.card(__('Phone notifications'), 'smartphone', pushCard()),
				DOLLY.card(__('Password'), 'key-round', form2),
				DOLLY.card(__('Tutorial'), 'graduation-cap', [
					h('p', { class: 'dolly-muted', text: __('Replay the guide that shows how to clock in, send requests and report sickness.') }),
					DOLLY.button(__('Replay the tutorial'), { icon: 'play', onClick: function () { startTour(); } })
				]),
				DOLLY.card(__('Contract and schedule'), 'briefcase', h('dl', { class: 'dolly-dl' }, [
					h('dt', { text: __('Type') }), h('dd', { text: s ? s.employment_label : '—' }),
					h('dt', { text: __('Schedule') }), h('dd', {}, s ? (s.on_call ? __('No fixed schedule: on-call shifts, approved by the administrator.') : s.weekdays.map(function (d) {
						var t = (s.days && s.days[d]) || { start: s.start_time, end: s.end_time, lunch_start: s.lunch_start, lunch_end: s.lunch_end };
						return h('div', { text: DOLLY.WEEKDAYS[d - 1] + ': ' + t.start + '–' + t.end + (t.lunch_start ? __(' · break ') + t.lunch_start + '–' + t.lunch_end : '') });
					})) : '—'),
					h('dt', { text: __('Workplaces') }), h('dd', { text: me.workplaces.map(function (w) { return w.name; }).join(', ') || '—' })
				]))
			]);
		}, function (err) { DOLLY.render(main, DOLLY.errorState(err, viewProfile)); });
	}

	/** Bank details for salary payments. Changing the IBAN notifies the administrators. */
	function bankForm(me) {
		var b = me.bank || {};
		var alertBox = h('div', { hidden: true });
		var iban = DOLLY.field({ label: 'IBAN', name: 'iban', value: DOLLY.fmt.iban(b.iban), optional: true, full: true, attrs: { autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: __('IT60 X054 2811 1010 0000 0123 456') } });
		var ben = DOLLY.field({ label: __('Account holder name'), name: 'bank_beneficiary', value: b.bank_beneficiary, optional: true, help: __('Account holder.') });
		var bank = DOLLY.field({ label: __('Bank'), name: 'bank_name', value: b.bank_name, optional: true });
		var bic = DOLLY.field({ label: 'BIC', name: 'bic', value: b.bic, optional: true, help: __('BIC/SWIFT code, 8 or 11 characters.'), attrs: { autocapitalize: 'characters', spellcheck: 'false', maxlength: 11 } });
		var btn = DOLLY.button(__('Save bank details'), { type: 'submit', variant: 'primary', icon: 'save' });
		var form = h('form', { class: 'dolly-form', novalidate: true }, [
			alertBox,
			h('p', { class: 'dolly-muted', text: __('Used for paying your salary. If you change the IBAN, the administrator is notified.') }),
			h('div', { class: 'dolly-form-grid' }, [iban, ben, bank, bic]),
			h('div', { class: 'dolly-btn-row' }, btn)
		]);
		form.addEventListener('submit', function (e) {
			e.preventDefault(); DOLLY.clearErrors(form); alertBox.hidden = true;
			var value = iban.input.value.replace(/[\s-]+/g, '').toUpperCase();
			if (value && !DOLLY.isIban(value)) { DOLLY.showErrors(form, { iban: __('Invalid IBAN: check the letters and digits.') }); return; }
			var changed = value !== (b.iban || '');
			DOLLY.busy(btn, DOLLY.api('me/profile', { method: 'POST', body: { iban: value, bank_beneficiary: ben.input.value, bank_name: bank.input.value, bic: bic.input.value } })).then(function (res) {
				b = res.bank || {}; state.me.bank = b;
				iban.input.value = DOLLY.fmt.iban(b.iban);
				bic.input.value = b.bic || '';
				DOLLY.toast(changed ? __('Bank details saved. The administrator has been notified of the new IBAN.') : __('Bank details saved.'), 'success');
			}, function (err) { DOLLY.formError(form, err, alertBox); });
		});
		return form;
	}

	/* ------------------------------------------------------------------ */
	/* Guided tour (first entry; can be replayed from the profile)         */
	/* ------------------------------------------------------------------ */

	function tourTag(el, id) { el.dataset.tour = id; return el; }
	function q(id) { return '[data-tour="' + id + '"]'; }
	function strong(t) { return h('strong', { text: t }); }
	function para(texts) { return texts.map(function (t) { return h('p', {}, t); }); }
	function bullets(items) { return h('ul', {}, items.map(function (i) { return h('li', {}, i); })); }
	/** Button of the open dialog by its label (e.g. "Annulla"). */
	function dialogButton(label) {
		return function () {
			var d = document.querySelector('.dolly-dialog');
			return d ? Array.prototype.filter.call(d.querySelectorAll('button'), function (b) { return b.textContent.trim() === label; })[0] || null : null;
		};
	}
	function goTo(section) {
		return function () {
			if (window.location.hash === '#' + section) { route(); } else { window.location.hash = '#' + section; }
			return new Promise(function (resolve) { setTimeout(resolve, 300); });
		};
	}
	function setRequestType(type) {
		return function () {
			var sel = document.querySelector('.dolly-dialog [name=type]');
			if (sel) { sel.value = type; sel.dispatchEvent(new window.Event('change')); }
		};
	}
	function closeDialogs() {
		Array.prototype.forEach.call(document.querySelectorAll('.dolly-dialog-backdrop'), function (b) {
			var x = b.querySelector('.dolly-dialog__head button');
			if (x) { x.click(); } else { b.remove(); }
		});
	}
	/** Example report in "Le tue segnalazioni" (only on screen, removed after the step). */
	function showDemoSickness() {
		var card = document.querySelector(q('sick-list'));
		if (!card || card.querySelector('.dolly-tour-demo')) { return; }
		var today = DOLLY.fmt.today();
		var item = sicknessItem({ id: 0, kind: 'malattia', kind_label: __('Sickness'), start_date: today, end_date: today, certificate_status: 'missing', certificate_label: __('Missing certificate'), certificate_due: null, notes: '', certificates: [], reported_by_admin: false });
		item.classList.add('dolly-tour-demo');
		item.dataset.tour = 'demo-sickness';
		item.insertBefore(h('div', { style: 'margin-bottom:8px' }, DOLLY.badge(__('Tutorial example'), 'amber', 'info')), item.firstChild);
		var box = card.lastElementChild;
		box.insertBefore(item, box.firstChild);
		DOLLY.icons();
	}
	function removeDemo() {
		Array.prototype.forEach.call(document.querySelectorAll('.dolly-tour-demo'), function (e) { e.remove(); });
	}

	/** Overtime is not requested: it follows from the punches (limit from the settings). */
	function overtimeText() {
		var min = state.me && state.me.settings ? parseInt(state.me.settings.overtime_auto, 10) || 0 : 0;
		var hh = Math.floor(min / 60), mm = min % 60;
		var limit = [hh ? hh + (hh === 1 ? __(' hour') : __(' hours')) : '', mm ? mm + __(' minutes') : ''].filter(Boolean).join(__(' and '));
		return [
			h('p', {}, [_x('Overtime ', 'sentence start'), strong(__('don\'t need to be requested')), __(': it\'s calculated automatically from your clock-ins.')]),
			bullets(min > 0 ? [
				[strong(__('Up to ') + limit + __(' per day')), __(': if you leave after your shift ends, the extra time is approved automatically.')],
				[strong(__('Over ') + limit), __(': the extra part awaits administrator approval. You\'ll get a notification with the outcome.')],
				[strong(__('Days off')), __(': you can work only if the administrator has authorized your overtime.')]
			] : [
				[strong(__('After the end of the shift')), __(': the extra time awaits administrator approval. You\'ll get a notification with the outcome.')],
				[strong(__('Days off')), __(': you can work only if the administrator has authorized your overtime.')]
			]),
			h('p', {}, __('Overtime hours appear in “Calendar and attendance”, “Overtime” column.')),
			h('p', { class: 'dolly-legal' }, __('Overtime hours are also subject to review by your employer.'))
		];
	}

	function tourSteps() {
		var ok = __('Got it');
		var requestType = function (type, title, text) {
			return { before: setRequestType(type), target: q('request-form'), title: __('Request types · ') + title, text: para(text), padding: 4 };
		};
		return [
			{ title: DOLLY.sprintf(__('Welcome to the %s portal!'), DOLLY.brandName), text: para([__('In a couple of minutes we\'ll show you how to clock in, send requests and report a sickness.'), __('Nothing is recorded during the tutorial: it\'s just a practice run.')]), next: _x('Start', 'verb'), nextIcon: 'play' },
			{ before: goTo('dashboard'), target: q('clock-btn'), mode: 'click', tap: true, scroll: true, title: __('Clock in'), text: para([__('When you arrive at work, tap this button. Its text and color change at each step: clock-in, break, clock-out.'), __('Try it now.')]), hint: __('Tap “Clock in”') },
			{ target: q('methods'), title: __('How to verify your presence'), text: bullets([
				[strong(__('Use my location')), __(': your phone uses GPS to check that you\'re at the workplace.')],
				[strong(__('Scan the workplace QR')), __(': scan the code on the workplace display. Use it if GPS isn\'t working.')],
				[strong(__('Enter the workplace PIN')), __(': instead of the QR, the 6-digit code shown on the display.')]
			]) },
			{ target: q('gps'), mode: 'click', tap: true, title: __('Use my location'), text: para([__('Tap “Use my location”.'), __('If GPS doesn\'t work or your location isn\'t detected, choose “Scan the workplace QR”.')]), hint: __('Tap “Use my location”') },
			{ target: q('confirm'), mode: 'click', tap: true, title: __('Confirm clock-in'), text: para([__('Check the details and tap “Confirm clock-in”. The time recorded is the server\'s.')]), hint: __('Tap “Confirm clock-in”') },
			{ target: q('today'), scroll: true, title: __('Today'), text: bullets([
				[strong(__('Schedule')), __(': your shift today and any break.')],
				[strong(__('Workplaces')), __(': where you can clock in.')],
				[strong(__('Verification')), __(': how you confirm you\'re there (location, QR or PIN).')]
			]), next: ok, nextIcon: 'check' },
			{ target: '.dolly-nav__link[data-section="richieste"]', mode: 'click', tap: true, title: __('Requests'), text: para([__('Here you request vacation, leave, blood donation and clock-in corrections. Tap “Requests”.')]), hint: __('Tap “Requests”') },
			{ target: q('requests-list'), title: __('Your requests'), text: para([__('Here you\'ll find all your requests and their status: pending, approved or rejected. You get a notification for every decision.'), __('Pending requests can be edited or deleted; for approved ones you can request a change or cancellation.')]), next: ok, nextIcon: 'check' },
			{ target: q('new-request'), mode: 'click', tap: true, title: __('New request'), text: para([__('Tap “New request” to see the request types.')]), hint: __('Tap “New request”') },
			requestType('ferie', __('Vacation (1 of 3)'), [__('For full days: enter “From” and “To” and, if you like, a note.'), __('The administrator approves or rejects the request and you receive a notification.')]),
			requestType('permesso', __('Hourly leave (2 of 3)'), [__('To be away for a few hours: choose the leave type (paid, unpaid or for specific events: the “?” button explains them), then the day and the “From” / “To” times.'), __('Approved leave hours are deducted from hours worked.')]),
			requestType('correzione', __('Clock-in correction (3 of 3)'), [__('If you forgot to clock in or made a mistake: choose the day and the clock-in, enter the correct time and the reason.'), __('When the request is approved, the clock-in is corrected.')]),
			{ target: q('request-legal'), scroll: true, title: __('Employer verification'), text: [h('p', { class: 'dolly-legal' }, LEGAL_NOTICE)], next: ok, nextIcon: 'check', padding: 4 },
			{ target: dialogButton(__('Cancel')), mode: 'click', tap: true, title: __('Close without sending'), text: para([__('We won\'t send anything for now: tap “Cancel”.')]), hint: __('Tap “Cancel”') },
			{ target: '.dolly-nav__link[data-section="malattia"]', mode: 'click', tap: true, title: __('Sickness'), text: para([__('Tap “Sickness”.')]), hint: __('Tap “Sickness”') },
			{ target: '#dolly-main > .dolly-alert', scroll: true, title: __('Sickness and injury'), text: para([__('Here you report sickness or an injury: the report is recorded right away, without approval.'), __('Below you\'ll find your reports with the status of the medical certificate.')]) },
			{ target: q('new-sickness'), mode: 'click', tap: true, title: __('Report sickness/injury'), text: para([__('Tap the button to see how to make a report.')]), hint: __('Tap “Report sickness/injury”') },
			{ target: q('sick-kind'), title: __('Report type'), text: [
				bullets([[strong(__('Sickness')), __(': when you\'re off work for health reasons.')], [strong(__('Injury')), __(': when you\'re injured at work or on your normal commute between home and work.')]]),
				h('p', {}, __('If you can\'t do it yourself, the administrator can also record the report on your behalf.')),
				h('p', {}, __('Enter the dates and, if you like, a note (do not include a diagnosis).')),
				h('p', {}, [__('After reporting it, you must '), strong(__('upload the medical certificate')), __(' in the “Your reports” table.')])
			] },
			{ target: dialogButton(__('Cancel')), mode: 'click', tap: true, title: __('Close'), text: para([__('Tap “Cancel”: we\'ll show you an example report.')]), hint: __('Tap “Cancel”') },
			{ before: showDemoSickness, target: function () { return document.querySelector(q('demo-sickness') + ' .dolly-btn'); }, tap: true, scroll: true, title: __('Upload the certificate'), text: para([__('Each report appears in “Your reports” (this is just an example).'), __('Tap «Upload certificate»: enter the protocol number of the electronic certificate and/or choose the file (PDF, JPG or PNG up to 10 MB), as required by the company. While the certificate is missing, the report stays red.')]), next: ok, nextIcon: 'check', after: removeDemo },
			{ target: '.dolly-nav__link[data-section="documenti"]', mode: 'click', tap: true, title: __('Documents'), text: para([__('Tap «Documents».')]), hint: __('Tap «Documents»') },
			{ target: '#dolly-main > .dolly-alert', scroll: true, title: __('Your documents'), text: para([__('Here you find your contract, tax certificate, payslips and the other documents the company sends you, by category.'), __('When a new one arrives you get a notification and the number appears on the menu: tap «Open» to view it or the icon to download it.')]) },
			{ target: '.dolly-topbar__actions [data-section="profilo"]', mode: 'click', tap: true, title: __('Your profile'), text: para([__('At the top you\'ll find notifications (bell) and your profile. Tap the profile.')]), hint: __('Tap the profile icon') },
			{ target: 'section[aria-label="' + __('Personal details') + '"]', scroll: true, title: __('Personal details'), text: para([__('Update your first name, last name, phone and email and tap “Save profile”. The username can\'t be changed.')]) },
			{ target: 'section[aria-label="' + __('Bank details') + '"]', scroll: true, title: __('Bank details'), text: para([__('IBAN, account holder, bank and BIC for your salary payment: tap “Save bank details”. If you change the IBAN, the administrator is notified.')]) },
			{ target: 'section[aria-label="' + __('Phone notifications') + '"]', scroll: true, title: __('Phone notifications'), text: para([__('Turn on notifications to receive request outcomes, anomalies and messages even when the app is closed.')]) },
			{ target: 'section[aria-label="' + __('Password') + '"]', scroll: true, title: __('Change password'), text: para([__('Enter your current password and the new one (at least 8 characters), then tap “Change password”.')]), next: ok, nextIcon: 'check' },
			{ before: goTo('dashboard'), target: q('today'), scroll: true, title: __('How overtime works'), text: overtimeText(), next: ok, nextIcon: 'check' },
			{ target: q('clock'), scroll: true, title: __('All set!'), text: para([__('This is where you clock in every day.'), __('You can replay the tutorial anytime from Profile › Tutorial.')]), next: __('End'), nextIcon: 'check', noSkip: true }
		];
	}

	function startTour() {
		if (tour.active) { return; }
		tour.active = true;
		closeDialogs();
		var steps = tourSteps();
		(function run(i) {
			if (!tour.active) { return; }
			if (i >= steps.length) { finishTour(); return; }
			var s = steps[i];
			Promise.resolve(s.before ? s.before() : null).then(function () {
				return DOLLY.coach.show(Object.assign({ progress: __('Step ') + (i + 1) + __(' of ') + steps.length }, s));
			}).then(function (result) {
				if (result !== 'next') { finishTour(); return; }
				if (s.after) { s.after(); }
				run(i + 1);
			});
		})(0);
	}

	/** End (or skip) of the tour: remembered on the server, then the real dashboard comes back. */
	function finishTour() {
		if (!tour.active) { return; }
		tour.active = false;
		DOLLY.coach.end();
		closeDialogs();
		removeDemo();
		if (state.me) { state.me.tour_done = true; }
		DOLLY.api('me/tour', { method: 'POST', body: { done: true } }).catch(function () {});
		if (state.section === 'dashboard') { viewDashboard(); } else { window.location.hash = '#dashboard'; }
		afterEntry();
	}

	/** After the tour (or on later entries): messages to read on entry, then the notifications prompt. */
	function afterEntry() {
		if (state.me && state.me.popups && state.me.popups.length) {
			var list = state.me.popups;
			state.me.popups = [];
			showEntryPopups(list);
		} else {
			maybeAskPush();
		}
	}

	/* ------------------------------------------------------------------ */
	/* Installed app & push notifications                                  */
	/* ------------------------------------------------------------------ */

	var PUSH = CFG.push || null;
	var swReady = null;

	function pushSupported() {
		return !!(PUSH && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
	}
	/** Opened from the icon on the home screen ("Aggiungi a Home"). */
	function isStandalone() {
		return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
	}
	function isIos() { return /iPhone|iPad|iPod/.test(navigator.userAgent); }
	function b64ToBytes(s) {
		var raw = window.atob((s + '===='.slice((s.length % 4) || 4)).replace(/-/g, '+').replace(/_/g, '/'));
		var out = new Uint8Array(raw.length);
		for (var i = 0; i < raw.length; i++) { out[i] = raw.charCodeAt(i); }
		return out;
	}
	/** The service worker makes the portal installable and shows the push notifications. */
	function registerSW() {
		if (swReady || !PUSH || !window.isSecureContext || !('serviceWorker' in navigator)) { return swReady; }
		swReady = navigator.serviceWorker.register(PUSH.sw, { scope: PUSH.scope }).then(function () { return navigator.serviceWorker.ready; });
		swReady.catch(function () {});
		return swReady;
	}
	function subscribePush() {
		return registerSW().then(function (reg) {
			return reg.pushManager.getSubscription().then(function (sub) {
				return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(PUSH.publicKey) });
			});
		}).then(function (sub) { return DOLLY.api('me/push', { method: 'POST', body: sub.toJSON() }); });
	}
	/** Must run inside a tap: iPhone only shows the permission request after a user gesture. */
	function enablePush() {
		return Promise.resolve(window.Notification.requestPermission()).then(function (p) {
			if (p !== 'granted') {
				throw new Error(p === 'denied' ? __('Notifications are blocked: turn them back on in your phone settings (Notifications › ') + DOLLY.brandName + ').' : __('Notification permission not granted.'));
			}
			return subscribePush();
		});
	}
	function disablePush() {
		return registerSW().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
			if (!sub) { return null; }
			var endpoint = sub.endpoint;
			return sub.unsubscribe().then(function () { return DOLLY.api('me/push', { method: 'DELETE', body: { endpoint: endpoint } }); });
		});
	}
	/** In the installed app: ask for notifications (at most every 3 days if postponed); keep the phone registered. */
	function maybeAskPush() {
		if (!pushSupported() || !isStandalone()) { return; }
		if (window.Notification.permission === 'granted') { subscribePush().catch(function () {}); return; }
		if (window.Notification.permission !== 'default') { return; }
		var last = 0;
		try { last = +window.localStorage.getItem('dolly_push_asked') || 0; } catch (e) { /* storage unavailable */ }
		if (Date.now() - last < 3 * 86400000) { return; }
		DOLLY.dialog({
			title: __('Turn on notifications'),
			body: [h('p', { text: __('Get request outcomes, anomalies to fix and messages from the administration on your phone, even when the app is closed.') })],
			actions: [
				{ label: __('Not now'), onClick: function (close) { try { window.localStorage.setItem('dolly_push_asked', String(Date.now())); } catch (e) { /* ignore */ } close(); } },
				{ label: __('Turn on notifications'), variant: 'primary', icon: 'bell-ring', onClick: function (close, btn) {
					DOLLY.busy(btn, enablePush()).then(function () { close(); DOLLY.toast(__('Notifications turned on for this phone.'), 'success'); }, function (err) { close(); DOLLY.toast(err.message, 'error'); });
				} }
			]
		});
	}
	/** Profile card: state of the notifications on this device. */
	function pushCard() {
		var box = h('div');
		function render() {
			if (!PUSH) { DOLLY.render(box, h('p', { class: 'dolly-muted', text: __('Phone notifications are not available. You can find everything in the Notifications section.') })); return; }
			if (isIos() && !isStandalone()) {
				DOLLY.render(box, DOLLY.alert(__('On iPhone, notifications work with the installed portal: tap Share › "Add to Home Screen", then open ') + DOLLY.brandName + __(' from the icon and turn on notifications.'), 'info'));
				return;
			}
			if (!pushSupported()) { DOLLY.render(box, h('p', { class: 'dolly-muted', text: __('This browser doesn\'t support push notifications.') })); return; }
			var perm = window.Notification.permission;
			if (perm === 'denied') { DOLLY.render(box, DOLLY.alert(__('Notifications are blocked for this site: turn them back on in your phone or browser settings.'), 'warning')); return; }
			if (perm === 'granted') {
				var result = h('div', { 'aria-live': 'polite', style: 'margin-top:8px' });
				var off = DOLLY.button(__('Turn off on this device'), { icon: 'bell-off', onClick: function () { DOLLY.busy(off, disablePush()).then(function () { DOLLY.toast(__('Notifications are off for this device.'), 'success'); render(); }, function (err) { DOLLY.toast(err.message, 'error'); }); } });
				// Re-registers this phone, then sends a test and shows what the push service answered.
				var test = DOLLY.button(__('Send a test notification'), { icon: 'send', onClick: function () {
					DOLLY.busy(test, subscribePush().then(function () { return DOLLY.api('me/push/test', { method: 'POST' }); })).then(function (r) {
						var ok = r.results.filter(function (x) { return x.ok; }).length;
						var lines = r.results.map(function (x) { return x.device + ': ' + (x.ok ? 'inviata' : x.error); });
						DOLLY.render(result, DOLLY.alert(ok
							? __('Test notification sent: it should appear in a few seconds.') + (isStandalone() ? __(' Close the app to see it as a phone notification.') : '')
							: (r.devices ? __('Sending failed.') : __('No device registered: turn notifications back on.')), ok ? 'success' : 'error', lines.length ? h('ul', { class: 'dolly-small', style: 'margin:6px 0 0;padding-left:18px' }, lines.map(function (l) { return h('li', { text: l }); })) : null));
					}, function (err) { DOLLY.render(result, DOLLY.alert(err.message, 'error')); });
				} });
				DOLLY.render(box, [DOLLY.alert(__('Notifications are on for this device.'), 'success'), h('div', { class: 'dolly-btn-row', style: 'margin-top:8px' }, [test, off]), result]);
				return;
			}
			var on = DOLLY.button(__('Turn on notifications'), { variant: 'primary', icon: 'bell-ring', onClick: function () { DOLLY.busy(on, enablePush()).then(function () { DOLLY.toast(__('Notifications turned on.'), 'success'); render(); }, function (err) { DOLLY.toast(err.message, 'error'); render(); }); } });
			DOLLY.render(box, [h('p', { class: 'dolly-muted', text: __('Get portal notifications even when the app is closed.') }), on]);
		}
		render();
		return box;
	}

	/* ------------------------------------------------------------------ */
	/* Boot                                                                */
	/* ------------------------------------------------------------------ */

	// A scanned workplace QR opens /portale/?mc=...: authentication already happened; confirmation is still required.
	var params = new URLSearchParams(window.location.search);
	var pendingNotification = params.get('n');
	if (pendingNotification) {
		params.delete('n');
		window.history.replaceState(null, '', window.location.pathname + (params.toString() ? '?' + params : '') + (window.location.hash || ''));
	}
	if (params.get('mc')) {
		state.pendingQr = params.get('mc');
		params.delete('mc');
		window.history.replaceState(null, '', window.location.pathname + (params.toString() ? '?' + params : '') + '#dashboard');
	}

	// Phones must use the installed app (setting "require_install"): in the browser only the procedure is shown.
	if (DOLLY.needsInstall()) {
		DOLLY.render(root, [
			h('header', { class: 'dolly-topbar' }, [brand(), h('div', { class: 'dolly-topbar__actions' }, DOLLY.button(__('Sign out'), { href: CFG.logoutUrl, variant: 'ghost', icon: 'log-out', iconOnly: true }))]),
			h('div', { class: 'dolly-auth' }, h('div', { class: 'dolly-card dolly-auth__card' }, DOLLY.installGate()))
		]);
		return;
	}

	shell();
	registerSW();
	loadMe().then(function () {
		root.querySelector('.dolly-topbar').replaceChild(brand(), root.querySelector('.dolly-topbar .dolly-brand'));
		DOLLY.icons();
		route();
		// Opened from a push notification: show it. First entry: guided tour. Then messages and push prompt.
		if (pendingNotification) {
			openNotificationById(pendingNotification);
		} else if (!state.me.tour_done) {
			startTour();
		} else {
			afterEntry();
		}
	}, function (err) {
		DOLLY.render(main, DOLLY.errorState(err, function () { window.location.reload(); }));
	});
	window.addEventListener('hashchange', route);
	document.addEventListener('visibilitychange', function () {
		if (!document.hidden && state.section === 'dashboard' && !document.querySelector('.dolly-dialog') && !tour.active) { viewDashboard(); }
	});
})(window, document);
