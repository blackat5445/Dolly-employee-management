/**
 * "Gestione Dipendenti" administration screens (Dashboard, Dipendenti, Nuovo dipendente, Sedi,
 * Richieste, Presenze, Analytics, Anomalie, Esportazioni, Impostazioni) built on the REST API.
 */
(function (window, document) {
	'use strict';

	var DOLLY = window.DOLLY, h = DOLLY.h, CFG = DOLLY.config, __ = DOLLY.__, _x = DOLLY._x;

	// Chart colours from the theme (Aspetto): the same meaning always has the same colour.
	var C = {
		primary: DOLLY.token('primary', '#2563EB'), amber: DOLLY.token('amber-solid', '#B45309'), grey: DOLLY.token('track', '#94A3B8'),
		green: DOLLY.token('green-solid', '#15803D'), red: DOLLY.token('red-solid', '#B91C1C'), blue: DOLLY.token('blue-solid', '#0369A1'),
		surface: DOLLY.token('surface', '#FFFFFF'), text: DOLLY.token('text', '#0F172A'), muted: DOLLY.token('muted', '#475569'), border: DOLLY.token('border', '#E2E8F0')
	};
	var app = document.getElementById('dolly-admin-app');
	if (!app) { return; }
	var main = document.getElementById('dolly-admin-main');
	var ACTIONS = { entrata: __('Clock-in'), inizio_pausa: __('Break start'), fine_pausa: __('Break end'), uscita: __('Clock-out') };
	var TYPES = { ferie: __('Vacation'), permesso: __('Hourly leave'), straordinario: __('Overtime'), correzione: __('Clock-in correction'), turno: __('On-call shift'), donazione: __('Blood donation'), smart: __('Remote work') };

	function workplaceOptions(allLabel) {
		var o = allLabel ? [{ value: '', label: allLabel }] : [];
		return o.concat((CFG.workplaces || []).map(function (w) { return { value: w.id, label: w.name + (w.active ? '' : _x(' (disabled)', 'workplace')) }; }));
	}
	function refreshWorkplaces() {
		return DOLLY.api('admin/workplaces').then(function (list) { CFG.workplaces = list; return list; });
	}
	var employeesCache = null;
	function allEmployees(force) {
		if (employeesCache && !force) { return Promise.resolve(employeesCache); }
		return DOLLY.api('admin/employees', { query: { all: 1 } }).then(function (l) { employeesCache = l; return l; });
	}
	function nowYM() { var p = DOLLY.fmt.nowParts(); return { year: +p.year, month: +p.month }; }

	function monthYearFields(state, onChange) {
		var years = [];
		var cur = nowYM().year;
		for (var y = cur + 1; y >= cur - 6; y--) { years.push({ value: y, label: String(y) }); }
		var m = DOLLY.field({ label: __('Month'), type: 'select', value: state.month, options: DOLLY.MONTHS.map(function (n, i) { return { value: i + 1, label: n }; }) });
		var yy = DOLLY.field({ label: __('Year'), type: 'select', value: state.year, options: years });
		m.input.addEventListener('change', function () { state.month = +m.input.value; onChange(); });
		yy.input.addEventListener('change', function () { state.year = +yy.input.value; onChange(); });
		return [m, yy];
	}

	/* ------------------------------------------------------------------ */
	/* Button at the top left: hides the WordPress side menu (full width)  */
	/* ------------------------------------------------------------------ */

	function menuToggle() {
		var btn = document.getElementById('dolly-menu-toggle');
		if (!btn) { return; }
		var docEl = document.documentElement;
		function sync() {
			var hidden = docEl.classList.contains('dolly-wpmenu-hidden');
			var label = hidden ? __('Show the sidebar') : __('Hide the sidebar');
			btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
			btn.setAttribute('aria-label', label);
			btn.title = label;
			DOLLY.render(btn, DOLLY.icon(hidden ? 'panel-left-open' : 'panel-left-close'));
		}
		btn.addEventListener('click', function () {
			var hidden = docEl.classList.toggle('dolly-wpmenu-hidden');
			try { window.localStorage.setItem('dolly_wpmenu_hidden', hidden ? '1' : '0'); } catch (e) { /* storage unavailable */ }
			sync();
			// Charts and calendars recalculate their size for the new width.
			window.dispatchEvent(new Event('resize'));
		});
		sync();
	}

	/* ------------------------------------------------------------------ */
	/* Header notifications (portal channel for administrators)            */
	/* ------------------------------------------------------------------ */

	function headerBell() {
		var header = app.querySelector('.dolly-admin__header');
		var count = h('span', { class: 'dolly-count', hidden: true });
		var bell = h('button', { type: 'button', class: 'dolly-btn dolly-btn--ghost dolly-btn--icon dolly-admin__bell', 'aria-label': __('Notifications') }, [DOLLY.icon('bell'), count]);
		header.appendChild(bell);
		function update() {
			DOLLY.api('notifications', { query: { page: 1 } }).then(function (r) {
				count.hidden = !r.unread; count.textContent = r.unread;
				bell.setAttribute('aria-label', __('Notifications') + (r.unread ? ', ' + r.unread + __(' unread') : ''));
			}, function () {});
		}
		bell.addEventListener('click', function () {
			var box = h('div', {}, DOLLY.loading());
			var page = 1;
			var dlg = DOLLY.dialog({ title: __('Notifications'), body: box, wide: true, actions: [
				{ label: __('Mark all as read'), icon: 'check', onClick: function (close, btn) { DOLLY.busy(btn, DOLLY.api('notifications/read-all', { method: 'POST' })).then(function () { update(); load(); }); } },
				{ label: __('Close'), variant: 'primary' }
			] });
			function load() {
				DOLLY.api('notifications', { query: { page: page } }).then(function (r) {
					DOLLY.render(box, [
						r.items.length ? h('ul', { style: 'list-style:none;margin:0;padding:0' }, r.items.map(function (n) {
							return h('li', { class: 'dolly-alert dolly-alert--' + (n.read ? 'info' : 'warning') }, [DOLLY.icon(n.read ? 'bell' : 'bell-ring'), h('div', { class: 'dolly-alert__body' }, [
								h('strong', { text: n.title }), h('div', { style: 'white-space:pre-line', text: n.body }),
								h('div', { class: 'dolly-small dolly-muted', text: DOLLY.fmt.dateTime(n.created_at) }),
								n.link ? h('a', { href: n.link, onclick: function () { DOLLY.api('notifications/' + n.id + '/read', { method: 'POST' }); } }, __('Open')) : null
							])]);
						})) : DOLLY.empty(__('No notifications'), '', 'bell'),
						DOLLY.pagination(r, function (p) { page = p; load(); }, 'notifiche')
					]);
				}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
			}
			load();
			return dlg;
		});
		update();
		setInterval(function () { if (!document.hidden) { update(); } }, 60000);
		DOLLY.icons();
	}

	/* ------------------------------------------------------------------ */
	/* Dashboard                                                           */
	/* ------------------------------------------------------------------ */

	function pageDashboard() {
		var st = { workplace: '', att: 1, req: 1, anom: 1, range: 7 };
		try { st.workplace = window.localStorage.getItem('dolly_dash_wp') || ''; } catch (e) { /* storage unavailable */ }
		var wpF = DOLLY.field({ label: __('Workplace'), type: 'select', value: st.workplace, options: workplaceOptions(__('All workplaces')) });
		var dateEl = h('div', { class: 'dolly-dash__date' });
		var updated = h('span', { class: 'dolly-small dolly-muted', 'aria-live': 'polite' });
		var kpis = h('div', { class: 'dolly-grid dolly-grid--4' });
		var attBox = h('div', {}, DOLLY.loading());
		var reqBox = h('div', {}, DOLLY.loading());
		var anomBox = h('div', {}, DOLLY.loading());
		var calEl = h('div');
		var chartWrap = h('div', { class: 'dolly-chart' }, h('canvas', { 'aria-label': __('Attendance chart'), role: 'img' }));
		var chartTable = h('div', { class: 'dolly-sr-only' });
		var rangeTabs = h('div');
		var chart = null, calendar = null;

		wpF.input.addEventListener('change', function () {
			st.workplace = wpF.input.value; st.att = st.req = st.anom = 1;
			try { window.localStorage.setItem('dolly_dash_wp', st.workplace); } catch (e) { /* ignore */ }
			refresh(true);
		});

		DOLLY.render(main, [
			h('div', { class: 'dolly-toolbar dolly-dash__toolbar' }, [dateEl, h('div', { class: 'dolly-toolbar__spacer' }), wpF, h('div', { class: 'dolly-dash__updated' }, [DOLLY.icon('refresh-cw'), updated])]),
			kpis,
			h('div', { class: 'dolly-grid dolly-grid--2' }, [
				DOLLY.card(__('Today\'s attendance'), 'clock', attBox),
				DOLLY.card(__('Latest requests'), 'inbox', reqBox, { actions: [DOLLY.button(_x('All', 'feminine plural'), { size: 'sm', href: CFG.pages.requests, icon: 'arrow-right' })] })
			]),
			DOLLY.card(__('Unresolved anomalies'), 'triangle-alert', anomBox, { actions: [DOLLY.button(_x('All', 'feminine plural'), { size: 'sm', href: CFG.pages.anomalies, icon: 'arrow-right' })] }),
			h('div', { class: 'dolly-grid dolly-grid--2 dolly-dash__bottom' }, [
				DOLLY.card(__('Calendar'), 'calendar-days', [calEl, legend(), h('p', { class: 'dolly-small dolly-muted', style: 'margin:12px 0 0', text: __('Click a day to set a closure for that day, or use "New closure" for a period.') })], {
					actions: [DOLLY.button(__('New closure'), { size: 'sm', variant: 'primary', icon: 'calendar-off', onClick: function () { closureDialog(null, function () { if (calendar) { calendar.refetchEvents(); } refresh(); }); } })]
				}),
				DOLLY.card(__('Attendance trend'), 'chart-column', [rangeTabs, chartWrap, chartTable])
			])
		]);

		function kpi(label, value, icon, sub, tone) {
			return h('section', { class: 'dolly-card dolly-kpi', 'aria-label': label }, [
				h('div', { class: 'dolly-kpi__top' }, [h('span', { text: label }), h('span', { class: 'dolly-kpi__icon' + (tone ? ' dolly-kpi__icon--' + tone : '') }, DOLLY.icon(icon))]),
				h('div', { class: 'dolly-kpi__value', text: String(value) }),
				sub ? h('div', { class: 'dolly-kpi__sub' }, sub) : null
			]);
		}

		function renderData(d) {
			dateEl.textContent = d.date_label;
			updated.textContent = __('Updated at ') + d.time + __(' · auto-refresh every 15 seconds');
			var ab = d.kpi.absent;
			DOLLY.render(kpis, [
				kpi(__('Present now'), d.kpi.present, 'user-check', __('On duty, excluding breaks and clock-outs'), 'green'),
				kpi(__('Absent today'), ab.total, 'user-x', [
					ab.ferie ? DOLLY.badge(__('Vacation ') + ab.ferie, 'blue', 'sun') : null, ' ',
					ab.malattia ? DOLLY.badge(__('Sickness/injury ') + ab.malattia, 'red', 'stethoscope') : null, ' ',
					ab.permesso ? DOLLY.badge(__('Leave ') + ab.permesso, 'blue', 'timer') : null, ' ',
					ab.ingiustificati ? DOLLY.badge(__('Unjustified ') + ab.ingiustificati, 'amber', 'circle-help') : null,
					ab.total ? null : __('No absences')
				], 'red'),
				kpi(__('Pending requests'), d.kpi.pending, 'inbox', h('a', { href: CFG.pages.requests, text: __('Manage requests') }), 'amber'),
				kpi(__('Unresolved anomalies'), d.kpi.anomalies, 'triangle-alert', h('a', { href: CFG.pages.anomalies, text: __('Manage anomalies') }), 'red')
			]);
			var attBadge = { presente: ['green', 'circle-check'], pausa: ['amber', 'coffee'], uscito: ['neutral', 'log-out'], assente: ['red', 'user-x'], ferie: ['blue', 'sun'], malattia: ['red', 'stethoscope'], infortunio: ['red', 'bandage'], festivo: ['neutral', 'party-popper'], atteso: ['neutral', 'clock'] };
			DOLLY.render(attBox, [
				DOLLY.table([
					{ label: __('Employee'), key: 'employee' },
					{ label: __('Workplace'), key: 'workplace' },
					{ label: __('Clock-in'), key: 'entrata', cls: 'time' },
					{ label: __('Break'), render: function (r) { return r.inizio_pausa ? r.inizio_pausa + (r.fine_pausa ? '–' + r.fine_pausa : '–…') : '—'; }, cls: 'time' },
					{ label: __('Clock-out'), key: 'uscita', cls: 'time' },
					{ label: __('Status'), render: function (r) { var b = attBadge[r.status] || ['neutral', 'info']; return DOLLY.badge(r.status_label, b[0], b[1]); } }
				], d.attendance.items, { empty: [__('No employees scheduled today'), '', 'calendar'], caption: __('Today\'s attendance') }),
				DOLLY.pagination(d.attendance, function (p) { st.att = p; refresh(); }, 'presenze')
			]);
			DOLLY.render(reqBox, [
				DOLLY.table([
					{ label: __('Employee'), key: 'employee' },
					{ label: __('Request'), render: function (r) { return h('span', { class: 'dolly-small', text: r.summary }); } },
					{ label: __('Status'), render: function (r) { return DOLLY.requestBadge(r.status, r.status_label); } },
					{ label: '', srLabel: __('Actions'), render: function (r) { return r.status === 'pending' ? decisionButtons(r, function () { refresh(); }) : ''; } }
				], d.requests.items, { empty: [__('No requests'), '', 'inbox'], caption: __('Latest requests') }),
				DOLLY.pagination(d.requests, function (p) { st.req = p; refresh(); }, 'richieste')
			]);
			DOLLY.render(anomBox, [
				anomaliesTable(d.anomalies.items, function () { refresh(); }),
				DOLLY.pagination(d.anomalies, function (p) { st.anom = p; refresh(); }, 'anomalie')
			]);
		}

		function refresh(all) {
			if (document.querySelector('.dolly-dialog')) { return; }
			DOLLY.api('admin/dashboard', { query: { workplace: st.workplace, att_page: st.att, req_page: st.req, anom_page: st.anom } }).then(renderData, function (err) {
				updated.textContent = __('Refresh failed: ') + err.message;
			});
			loadChart();
			if (calendar) { calendar.refetchEvents(); }
		}

		function renderRangeTabs() {
			DOLLY.render(rangeTabs, DOLLY.tabs([{ id: 7, label: __('7 days') }, { id: 30, label: __('30 days') }, { id: 90, label: __('90 days') }], st.range, function (id) { st.range = id; renderRangeTabs(); loadChart(); }));
		}
		function loadChart() {
			DOLLY.api('admin/chart', { query: { range: st.range, workplace: st.workplace } }).then(function (d) {
				var ds = [
					{ label: __('Present'), data: d.present, backgroundColor: C.green },
					{ label: _x('Absent without justification', 'plural'), data: d.absent, backgroundColor: C.red },
					{ label: __('Vacation'), data: d.leave, backgroundColor: C.blue },
					{ label: __('Sickness'), data: d.sick, backgroundColor: C.amber }
				];
				if (!window.Chart) { return; }
				if (chart) {
					chart.data.labels = d.labels;
					ds.forEach(function (x, i) { chart.data.datasets[i].data = x.data; });
					chart.update('none');
				} else {
					chart = new window.Chart(chartWrap.querySelector('canvas'), {
						type: 'bar',
						data: { labels: d.labels, datasets: ds },
						options: {
							responsive: true, maintainAspectRatio: false, animation: false,
							scales: { x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
							plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { mode: 'index', intersect: false } },
							locale: DOLLY.intlLocale
						}
					});
				}
				// Accessible data table equivalent of the chart.
				DOLLY.render(chartTable, DOLLY.table([{ label: __('Day'), key: 'l' }, { label: __('Present'), key: 'p' }, { label: _x('Absent', 'plural'), key: 'a' }, { label: __('Vacation'), key: 'f' }, { label: __('Sickness'), key: 's' }],
					d.labels.map(function (l, i) { return { l: l, p: d.present[i], a: d.absent[i], f: d.leave[i], s: d.sick[i] }; }), { caption: __('Attendance chart data') }));
			}, function () {});
		}

		if (window.FullCalendar) {
			calendar = new window.FullCalendar.Calendar(calEl, {
				locale: DOLLY.lang, firstDay: 1, initialView: 'dayGridMonth', height: 'auto',
				headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
				dayMaxEvents: 3,
				eventOrder: __('order,start,-duration,allDay,title'),
				events: function (info, ok, ko) {
					DOLLY.api('admin/calendar', { query: { start: info.startStr.slice(0, 10), end: info.endStr.slice(0, 10), workplace: st.workplace } }).then(ok, ko);
				},
				// A day opens the collective closure pop-up.
				dateClick: function (info) { closureDialog(info.dateStr.slice(0, 10), function () { calendar.refetchEvents(); refresh(); }); },
				eventClick: function (info) {
					if (info.event.extendedProps.kind === 'closure') { closureDialog(info.event.extendedProps.date, function () { calendar.refetchEvents(); refresh(); }); }
				}
			});
			calendar.render();
		}
		renderRangeTabs();
		refresh();
		setInterval(function () { if (!document.hidden) { refresh(); } }, 15000);
	}

	var CLOSURE_TYPES = {
		collective: { label: __('Collective closure'), description: __('Collective vacation, closure for stocktaking… Anyone who works anyway records regular hours.') },
		holiday: { label: __('Holiday closure'), description: __('Patron saint\'s day, holiday bridge… Hours of anyone who works anyway get the holiday premium.') }
	};

	/**
	 * Closure of one day (date given, opened from the calendar) or of a range of days (date null, opened
	 * from the "Nuova chiusura" button): type, closed/open switch for each workplace, optional broadcast to
	 * the employees of the closed workplaces. A missing entry on those days is never an anomaly.
	 */
	function closureDialog(date, done) {
		var range = !date;
		var body = h('div', {}, DOLLY.loading());
		var dlg = DOLLY.dialog({ title: range ? __('New closure (period)') : __('Closure'), body: body, wide: true });
		var load = range ? Promise.resolve({ date: CFG.today, name: '', type: 'collective', workplaces: [] }) : DOLLY.api('admin/closures', { query: { date: date } });
		load.then(function (c) {
			var alertBox = h('div', { hidden: true });
			var existing = !range && c.workplaces.length > 0;
			var from = range ? DOLLY.dateField({ label: __('From'), name: 'from', value: CFG.today, required: true }) : null;
			var to = range ? DOLLY.dateField({ label: __('To'), name: 'to', value: CFG.today, required: true }) : null;
			var type = DOLLY.radios({ label: __('Closure type'), name: 'type', value: c.type || 'collective', full: true, options: Object.keys(CLOSURE_TYPES).map(function (k) {
				return { value: k, label: CLOSURE_TYPES[k].label, description: CLOSURE_TYPES[k].description + (k === 'holiday' ? __(' (premium ') + (CFG.holidayIncrease || 0) + '%)' : '') };
			}), onChange: syncType });
			var name = DOLLY.field({ label: __('Description'), name: 'name', value: c.name, optional: true, full: true, help: __('For example: Summer vacation, Patron saint\'s day. Empty = the closure type.') });
			var switches = (CFG.workplaces || []).filter(function (w) { return w.active || c.workplaces.indexOf(w.id) !== -1; }).map(function (w) {
				var sw = DOLLY.switchControl({ label: w.name, name: 'wp' + w.id, checked: c.workplaces.indexOf(w.id) !== -1, description: [w.address, w.city].filter(Boolean).join(', ') || null });
				sw.wid = w.id;
				return sw;
			});
			var allBtn = DOLLY.button(__('Close all workplaces'), { size: 'sm', icon: 'building-2', onClick: function () { switches.forEach(function (s) { s.control.setOn(true); }); } });
			var effect = h('div');
			function syncType() {
				DOLLY.render(effect, DOLLY.alert(type.value() === 'holiday'
					? __('For employees of closed workplaces, not clocking in does not create anomalies. Anyone who works anyway can clock in: the hours count as holiday hours with a premium of ') + (CFG.holidayIncrease || 0) + __('% (percentage set in Settings).')
					: __('For employees of closed workplaces, not clocking in does not create anomalies. Anyone who works anyway can clock in: the hours count as regular hours.'), 'info'));
			}
			syncType();
			function periodText() {
				if (!range) { return __('on ') + DOLLY.fmt.date(date); }
				var a = from.iso(), b = to.iso();
				return a && b && a !== b ? __('from ') + DOLLY.fmt.date(a) + __(' to ') + DOLLY.fmt.date(b) : __('on ') + DOLLY.fmt.date(a || CFG.today);
			}
			var msg = DOLLY.field({ label: __('Message'), name: 'message', type: 'textarea', full: true, rows: 4 });
			var msgTouched = false;
			msg.input.addEventListener('input', function () { msgTouched = true; });
			function fillMessage() {
				if (msgTouched) { return; }
				msg.input.value = __('Please note that ') + periodText() + __(' your workplace will be closed (') + (name.input.value || CLOSURE_TYPES[type.value()].label).toLowerCase() + __('). There is no need to clock in.');
			}
			var chEmail = DOLLY.switchControl({ label: __('Email'), name: 'bc_email', checked: true });
			var chPortal = DOLLY.switchControl({ label: __('In-app notification'), name: 'bc_portal', checked: true, description: __('It also arrives as a push notification on phones with notifications turned on.') });
			var chPopup = DOLLY.switchControl({ label: __('Show immediately when the app opens'), name: 'bc_popup', checked: false, description: __('The message appears in a pop-up as soon as the employee opens the portal.') });
			var channels = h('div', { class: 'dolly-field dolly-field--full', dataset: { name: 'channels' } }, [h('div', { class: 'dolly-form-grid' }, [chEmail, chPortal, chPopup]), h('span', { class: 'dolly-error', hidden: true })]);
			var bcBox = h('div', { class: 'dolly-form-grid dolly-field--full', hidden: true }, [msg, channels]);
			var bc = DOLLY.switchControl({ label: __('Send a broadcast message'), name: 'broadcast', checked: false, description: __('To employees assigned to the closed workplaces, right after saving.'), onChange: function (on) { bcBox.hidden = !on; if (on) { fillMessage(); } } });
			var form = h('form', { class: 'dolly-form', novalidate: true }, [
				alertBox,
				range ? h('div', { class: 'dolly-form-grid' }, [from, to]) : h('p', {}, [h('strong', { text: c.date_label }), c.holiday ? __(' · public holiday: ') + c.holiday : '']),
				type,
				h('div', { class: 'dolly-form-grid' }, [name]),
				h('div', { class: 'dolly-toolbar' }, [h('h3', { style: 'margin:0', text: __('Closed workplaces') }), h('div', { class: 'dolly-toolbar__spacer' }), allBtn]),
				switches.length ? h('div', { class: 'dolly-form-grid dolly-closure__sites' }, switches) : DOLLY.alert(__('No workplaces configured.'), 'warning'),
				effect,
				bc, bcBox
			]);
			var actions = h('div', { class: 'dolly-btn-row dolly-btn-row--end', style: 'margin-top:16px' });
			var saveBtn = DOLLY.button(__('Save'), { variant: 'primary', icon: 'save' });
			function period() {
				if (!range) { return { from: date, to: date }; }
				var rd = DOLLY.readDateTimes({ from: [from, 'date', true], to: [to, 'date', true] });
				if (Object.keys(rd.errors).length) { DOLLY.showErrors(form, rd.errors); return null; }
				if (rd.values.to < rd.values.from) { DOLLY.showErrors(form, { to: __('The end date must be the same as or after the start.') }); return null; }
				return rd.values;
			}
			function send(workplaces, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var p = period();
				if (!p) { return; }
				var payload = { from: p.from, to: p.to, type: type.value(), name: name.input.value, workplaces: workplaces };
				if (bc.control.isOn()) { payload.broadcast = { enabled: true, message: msg.input.value, email: chEmail.control.isOn(), portal: chPortal.control.isOn(), popup: chPopup.control.isOn() }; }
				DOLLY.busy(btn, DOLLY.api('admin/closures', { method: 'POST', body: payload })).then(function (r) {
					dlg.close();
					var days = r.days > 1 ? ' (' + r.days + __(' days)') : '';
					var text = workplaces.length ? __('Closure saved') + days + ': ' + (r.affected === 1 ? __('1 employee affected.') : r.affected + __(' employees affected.')) : __('Closure removed') + days + '.';
					if (r.broadcast && r.broadcast.recipient_count !== undefined) { text += __(' Message sent to ') + r.broadcast.recipient_count + '.'; }
					else if (r.broadcast && r.broadcast.skipped) { text += __(' No employees to send the message to.'); }
					DOLLY.toast(text, 'success');
					done();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			}
			saveBtn.addEventListener('click', function () {
				var closed = switches.filter(function (s) { return s.control.isOn(); }).map(function (s) { return s.wid; });
				if (!closed.length && !existing) { alertBox.hidden = false; DOLLY.render(alertBox, DOLLY.alert(__('Select at least one closed workplace.'), 'error')); return; }
				send(closed, saveBtn);
			});
			if (existing || range) {
				var rm = DOLLY.button(range ? __('Remove the closures for the period') : __('Remove closure'), { variant: 'danger', icon: 'trash-2' });
				rm.addEventListener('click', function () {
					DOLLY.confirm(range ? __('Remove the closures for the period?') : __('Remove the closure?'), __('All workplaces will reopen ') + periodText() + '.', __('Remove'), 'danger').then(function (ok) {
						if (ok) { bc.control.setOn(false); bcBox.hidden = true; send([], rm); }
					});
				});
				actions.appendChild(rm);
			}
			actions.appendChild(saveBtn);
			DOLLY.render(body, [form, actions]);
		}, function (err) { DOLLY.render(body, DOLLY.errorState(err)); });
		return dlg;
	}

	function legend() {
		var items = [['var(--dolly-blue-bg)', __('Vacation')], ['var(--dolly-cat-permesso-bg)', __('Leave')], ['var(--dolly-accent-soft)', __('Overtime')], ['var(--dolly-red-bg)', __('Sickness / injury')], ['var(--dolly-cat-festivo-bg)', __('Public holiday')], ['var(--dolly-surface-3)', __('Collective closure')], ['var(--dolly-cat-chiusura-festiva-bg)', __('Holiday closure')]];
		return h('div', { class: 'dolly-legend', 'aria-label': __('Legend') }, items.map(function (i) {
			return h('span', {}, [h('i', { style: 'background:' + i[0] + ';border:1px solid var(--dolly-border-strong)', 'aria-hidden': 'true' }), i[1]]);
		}));
	}

	/* ------------------------------------------------------------------ */
	/* Requests: shared decision UI                                         */
	/* ------------------------------------------------------------------ */

	function decisionButtons(r, done) {
		return h('div', { class: 'dolly-actions' }, [
			DOLLY.button(__('Approve'), { size: 'sm', variant: 'success', icon: 'check', onClick: function () { decide(r, 'approve', done); } }),
			DOLLY.button(__('Reject'), { size: 'sm', icon: 'x', onClick: function () { decide(r, 'reject', done); } })
		]);
	}

	/** Kinds of hourly leave and the justification codes (hours history) allowed for each; the first is the default. */
	var LEAVE_KINDS = [
		{ value: 'retribuito', label: __('Regular paid leave'), codes: ['P', 'ROL', 'EO'] },
		{ value: 'non_retribuito', label: __('Regular unpaid leave'), codes: ['Pn'] },
		{ value: 'evento', label: __('Leave for specific events'), codes: ['P', 'PL'] }
	];
	var CODE_LABELS = { P: __('P · Leave'), ROL: __('ROL · Reduced working hours'), EO: __('EO · Former public holidays'), Pn: __('Pn · Unpaid leave'), PL: __('PL · Law 104 leave') };
	function leaveCodeOptions(kind) {
		var k = LEAVE_KINDS.filter(function (x) { return x.value === kind; })[0] || LEAVE_KINDS[0];
		return k.codes.map(function (c) { return { value: c, label: CODE_LABELS[c] }; });
	}

	function decide(r, decision, done) {
		var note = DOLLY.field({ label: __('Note for the employee'), name: 'note', type: 'textarea', optional: decision === 'approve' });
		// Hourly leave: the administrator confirms or changes the justification code recorded in the hours history.
		var code = r.type === 'permesso' && decision === 'approve' && r.amend_action !== 'cancel'
			? DOLLY.field({ label: __('Absence code (hours history)'), name: 'hours_code', type: 'select', value: r.hours_code, options: leaveCodeOptions(r.leave_kind), help: r.leave_kind_label + __('. Leave hours are recorded with this code.') })
			: null;
		var form = h('form', { class: 'dolly-form' }, [
			h('p', {}, [h('strong', { text: r.employee + ': ' }), r.summary]),
			r.notes ? h('p', { class: 'dolly-muted', text: __('Employee notes: ') + r.notes }) : null,
			code,
			r.type === 'correzione' && decision === 'approve' ? DOLLY.alert(__('If approved, the clock-in will be corrected and recorded in the change log.'), 'info') : null,
			r.amend_action ? DOLLY.alert(r.amend_action === 'cancel' ? __('If approved, the original approved request will be canceled.') : __('If approved, the change will replace the original approved request.'), 'info') : null,
			note
		]);
		DOLLY.dialog({
			title: decision === 'approve' ? __('Approve request') : __('Reject request'), body: form,
			actions: [
				{ label: __('Cancel') },
				{ label: decision === 'approve' ? __('Approve') : __('Reject'), variant: decision === 'approve' ? 'success' : 'danger', icon: decision === 'approve' ? 'check' : 'x', onClick: function (close, btn) {
					if (decision === 'reject' && !note.input.value.trim()) { DOLLY.showErrors(form, { note: __('Enter the reason for the rejection.') }); return; }
					DOLLY.busy(btn, DOLLY.api('admin/requests/' + r.id + '/decision', { method: 'POST', body: { decision: decision, note: note.input.value, hours_code: code ? code.input.value : '' } })).then(function () {
						close(); DOLLY.toast(decision === 'approve' ? __('Request approved.') : __('Request rejected.'), 'success'); done();
					}, function (err) { DOLLY.formError(form, err); });
				} }
			]
		});
	}

	/** Revokes an approved vacation, hourly leave or blood donation (the reason is mandatory). */
	function revokeDialog(r, done) {
		var note = DOLLY.field({ label: __('Reason for revoking'), name: 'note', type: 'textarea', required: true });
		var form = h('form', { class: 'dolly-form' }, [
			h('p', {}, [h('strong', { text: r.employee + ': ' }), r.summary]),
			DOLLY.alert(__('The approved request is canceled: it disappears from the employee\'s calendar and attendance, and the employee receives a notification with the reason. The request stays in the history as "Canceled".'), 'warning'),
			note
		]);
		DOLLY.dialog({
			title: __('Revoke approved request'), body: form,
			actions: [
				{ label: __('Cancel') },
				{ label: __('Revoke'), variant: 'danger', icon: 'undo-2', onClick: function (close, btn) {
					if (!note.input.value.trim()) { DOLLY.showErrors(form, { note: __('Enter the reason for the revocation.') }); return; }
					DOLLY.busy(btn, DOLLY.api('admin/requests/' + r.id + '/revoke', { method: 'POST', body: { note: note.input.value } })).then(function () {
						close(); DOLLY.toast(__('Request revoked.'), 'success'); done();
					}, function (err) { DOLLY.formError(form, err); });
				} }
			]
		});
	}

	/** Certificate of a blood donation: state, files and upload on the employee's behalf. */
	function donationCertificate(r, done) {
		if (r.type !== 'donazione' || !r.certificate_status || r.amend_action) { return null; }
		var tone = { waiting: ['neutral', 'hourglass'], missing: ['red', 'file-text'], overdue: ['red', 'clock-alert'], uploaded: ['green', 'circle-check'], not_required: ['neutral', 'minus'], cleared: ['neutral', 'ban'] }[r.certificate_status] || ['neutral', 'info'];
		var nodes = [h('div', { style: 'margin-top:6px' }, DOLLY.badge(r.certificate_label, tone[0], tone[1]))];
		if (r.certificate_due && (r.certificate_status === 'missing' || r.certificate_status === 'overdue')) { nodes.push(h('div', { class: 'dolly-small', text: __('Due ') + DOLLY.fmt.date(r.certificate_due) })); }
		(r.certificates || []).forEach(function (c) {
			nodes.push(h('div', { class: 'dolly-small' }, h('a', { href: DOLLY.downloadUrl('certificates/' + c.id + '/download') }, [DOLLY.icon('download'), ' ' + c.original_name])));
		});
		if (r.status === 'approved' && r.certificate_status !== 'not_required' && r.certificate_status !== 'cleared') {
			var file = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png', class: 'dolly-sr-only', 'aria-label': __('Donation certificate file for ') + r.employee });
			var up = DOLLY.button(__('Upload certificate'), { size: 'sm', icon: 'file-up', onClick: function () { file.click(); } });
			file.addEventListener('change', function () {
				if (!file.files[0]) { return; }
				var fd = new FormData(); fd.append('file', file.files[0]);
				DOLLY.busy(up, DOLLY.api('admin/requests/' + r.id + '/certificate', { method: 'POST', form: fd, timeout: 120000 })).then(function () { DOLLY.toast(__('Donation certificate uploaded.'), 'success'); done(); }, function (err) { DOLLY.toast(err.message, 'error'); file.value = ''; });
			});
			nodes.push(h('div', { style: 'margin-top:6px' }, [up, file]));
		}
		return h('div', {}, nodes);
	}

	/* ------------------------------------------------------------------ */
	/* Anomalies: shared table and resolution                               */
	/* ------------------------------------------------------------------ */

	function anomaliesTable(items, done) {
		return DOLLY.table([
			{ label: __('Employee'), key: 'employee' },
			{ label: __('Date'), render: function (a) { return DOLLY.fmt.date(a.work_date); } },
			{ label: __('Type'), render: function (a) { return a.status === 'open' ? DOLLY.badge(a.type_label, 'red', a.type === 'missing_certificate' ? 'file-text' : 'triangle-alert') : h('div', {}, [DOLLY.badge(a.type_label, 'neutral'), ' ', DOLLY.badge(a.resolution_label, 'green', 'circle-check')]); } },
			{ label: __('Details'), render: function (a) {
				return h('div', { class: 'dolly-small' }, [
					h('div', { style: 'white-space:pre-line', text: a.details }),
					a.employee_note ? h('div', { class: 'dolly-muted', text: __('Employee note: ') + a.employee_note }) : null,
					a.status === 'resolved' ? h('div', { class: 'dolly-muted', text: __('Resolved by ') + a.resolved_by + _x(' on ', 'before a date') + DOLLY.fmt.dateTime(a.resolved_at) + (a.resolution_note ? ': ' + a.resolution_note : '') }) : null
				]);
			} },
			{ label: '', srLabel: __('Actions'), render: function (a) { return a.status === 'open' ? anomalyActions(a, done) : ''; } }
		], items, { empty: [__('No anomalies'), __('There are no anomalies to show.'), 'circle-check'], caption: __('Anomalies') });
	}

	function anomalyActions(a, done) {
		var b = [];
		if (a.type === 'unjustified_absence') {
			b.push(DOLLY.button(__('Add clock-in'), { size: 'sm', icon: 'pencil', onClick: function () { resolveDialog(a, 'correct_entry', done); } }));
			b.push(DOLLY.button(__('Close'), { size: 'sm', icon: 'x', onClick: function () { resolveDialog(a, 'dismiss', done); } }));
		} else if (a.type === 'missing_exit' || a.type === 'late_exit') {
			b.push(DOLLY.button(__('Correct clock-out'), { size: 'sm', icon: 'pencil', onClick: function () { resolveDialog(a, 'correct_exit', done); } }));
			if (a.type === 'late_exit') { b.push(DOLLY.button(__('Approve overtime'), { size: 'sm', variant: 'success', icon: 'check', onClick: function () { resolveDialog(a, 'approve_extra', done); } })); }
			b.push(DOLLY.button(__('Close'), { size: 'sm', icon: 'x', onClick: function () { resolveDialog(a, 'dismiss', done); } }));
		} else if (a.type === 'sickness_conflict') {
			b.push(DOLLY.button(__('Mark as verified'), { size: 'sm', icon: 'shield-check', onClick: function () { resolveDialog(a, 'review', done); } }));
		} else if (a.type === 'missing_certificate') {
			return h('span', { class: 'dolly-small dolly-muted', text: __('Resolved by uploading the certificate.') });
		}
		return h('div', { class: 'dolly-actions' }, b);
	}

	function resolveDialog(a, action, done) {
		var titles = { correct_exit: __('Correct clock-out time'), correct_entry: __('Enter the clock-in'), approve_extra: __('Approve overtime'), dismiss: __('Close anomaly'), review: __('Review sickness/injury conflict') };
		var fields = [];
		var timeF = null, exitF = null;
		if (action === 'correct_entry') {
			timeF = DOLLY.timeField({ label: __('Clock-in time'), name: 'time', required: true });
			exitF = DOLLY.timeField({ label: __('Clock-out time'), name: 'exit_time', optional: true, help: __('Optional, HH:MM: fill it in if the day has already ended.') });
			fields.push(DOLLY.alert(__('The clock-ins are added as an administrator correction and recorded in the change log. To close a justified absence use "Close".'), 'info'), h('div', { class: 'dolly-form-grid' }, [timeF, exitF]));
		}
		if (action === 'correct_exit') {
			timeF = DOLLY.timeField({ label: __('Corrected clock-out time'), name: 'time', required: true });
			fields.push(DOLLY.alert(__('A clock-out is added as an administrator correction and recorded in the change log.'), 'info'), timeF);
		}
		if (action === 'approve_extra') {
			var m = /alle (\d{2}:\d{2})/.exec(a.details || '');
			timeF = DOLLY.timeField({ label: __('Overtime authorized until'), name: 'end_time', required: true, value: m ? m[1] : '' });
			fields.push(DOLLY.alert(__('Approval moves the alert limit; it does not create or change clock-ins.'), 'info'), timeF);
		}
		var note = DOLLY.field({ label: action === 'correct_exit' || action === 'correct_entry' ? __('Reason for the correction') : __('Note'), name: 'note', type: 'textarea', optional: action === 'approve_extra' });
		fields.push(note);
		var form = h('form', { class: 'dolly-form', novalidate: true }, [h('p', {}, [h('strong', { text: a.employee }), ' · ' + DOLLY.fmt.date(a.work_date) + ' · ' + a.type_label]), fields]);
		DOLLY.dialog({
			title: titles[action], body: form,
			actions: [{ label: __('Cancel') }, { label: __('Confirm'), variant: 'primary', icon: 'check', onClick: function (close, btn) {
				DOLLY.clearErrors(form);
				var body = { action: action, note: note.input.value };
				if (timeF) {
					var t = timeF.hm();
					if (!t) { DOLLY.showErrors(form, (function () { var o = {}; o[action === 'approve_extra' ? 'end_time' : 'time'] = __('Invalid time (HH:MM).'); return o; })()); return; }
					body[action === 'approve_extra' ? 'end_time' : 'time'] = t;
				}
				if (exitF && exitF.input.value.trim()) {
					var x = exitF.hm();
					if (!x) { DOLLY.showErrors(form, { exit_time: __('Invalid time (HH:MM).') }); return; }
					body.exit_time = x;
				}
				if ((action === 'correct_exit' || action === 'correct_entry' || action === 'dismiss' || action === 'review') && !note.input.value.trim()) { DOLLY.showErrors(form, { note: __('Required field.') }); return; }
				DOLLY.busy(btn, DOLLY.api('admin/anomalies/' + a.id + '/resolve', { method: 'POST', body: body })).then(function () {
					close(); DOLLY.toast(__('Anomaly resolved.'), 'success'); done();
				}, function (err) { DOLLY.formError(form, err); });
			} }]
		});
	}

	/* ------------------------------------------------------------------ */
	/* Employee form (create & edit)                                        */
	/* ------------------------------------------------------------------ */

	/**
	 * Working hours: one fixed timetable for the selected days ("turni normali"), or (switch) a different
	 * timetable for each day ("turni diversi"), each day with its own on/off switch. On-call contracts
	 * have no working days or hours.
	 * Smart working: with the fixed timetable one switch makes every day smart working; with a timetable
	 * per day each day is in presence, smart working, or mixed (a block in presence and a block in smart
	 * working that do not overlap). In smart working the employee clocks without presence verification.
	 * Returns an element with .collect(errors) -> schedule body for the API.
	 */
	function scheduleEditor(s) {
		var days = s.days || {};
		var type = DOLLY.field({ label: __('Contract type'), name: 'employment_type', type: 'select', value: s.employment_type || 'full_time', options: [{ value: 'full_time', label: __('Full-time') }, { value: 'part_time', label: __('Part-time') }, { value: 'on_call', label: __('On-call contract') }] });

		// Same hours for all the selected days.
		var u = {
			weekdays: DOLLY.chips({ label: __('Working days'), name: 'weekdays', full: true, selected: s.per_day ? [] : s.weekdays, options: DOLLY.WEEKDAYS.map(function (d, i) { return { value: i + 1, label: d }; }) }),
			start_time: DOLLY.timeField({ label: __('Shift start'), name: 'start_time', value: s.start_time || '09:00', required: true }),
			end_time: DOLLY.timeField({ label: __('Shift end'), name: 'end_time', value: s.end_time || '18:00', required: true }),
			lunch_start: DOLLY.timeField({ label: __('Lunch break start'), name: 'lunch_start', value: s.lunch_start || '13:00' }),
			lunch_end: DOLLY.timeField({ label: __('Lunch break end'), name: 'lunch_end', value: s.lunch_end || '14:00' })
		};
		var uLunch = h('div', { class: 'dolly-form-grid dolly-field--full', hidden: !s.has_lunch }, [u.lunch_start, u.lunch_end]);
		u.has_lunch = DOLLY.switchControl({ label: __('Planned lunch break'), name: 'has_lunch', checked: !!s.has_lunch, onChange: function (on) { uLunch.hidden = !on; } });
		u.smart = DOLLY.switchControl({ label: __('Remote work'), name: 'smart', checked: !s.per_day && s.work_mode === 'smart', description: __('On: the employee works remotely on all the selected days and clocks in and out with one tap, without GPS, QR/PIN or Bluetooth. The hours are approved as set in Settings › Remote work.') });
		u.smart.dataset.tour = 'smart';
		var uniformBox = h('div', { class: 'dolly-form-grid dolly-field--full' }, [u.weekdays, u.start_time, u.end_time, h('div', { class: 'dolly-field--full' }, u.has_lunch), uLunch, h('div', { class: 'dolly-field--full' }, u.smart)]);

		// A different timetable for each day.
		var rows = {};
		var perDayBox = h('div', { class: 'dolly-dayrows dolly-field--full' });
		var modeOptions = [{ value: 'office', label: __('On site') }, { value: 'smart', label: __('Remote work') }, { value: 'mixed', label: __('Mixed (on site and remote)') }];
		DOLLY.WEEKDAYS.forEach(function (label, i) {
			var wd = i + 1, d = days[wd] || null;
			var working = s.per_day ? !!d : (s.weekdays || []).indexOf(wd) !== -1;
			var base = d || { start: s.start_time || '09:00', end: s.end_time || '18:00', lunch_start: s.lunch_start, lunch_end: s.lunch_end };
			var hasLunch = d ? !!d.lunch_start : !!s.has_lunch;
			var mode = d && d.mode ? d.mode : (!s.per_day && s.work_mode === 'smart' ? 'smart' : 'office');
			var p = 'day' + wd + '_';
			var r = {
				mode: DOLLY.field({ label: __('Mode'), name: p + 'mode', type: 'select', value: mode, options: modeOptions }),
				start: DOLLY.timeField({ label: __('Start'), name: p + 'start_time', value: base.start }),
				end: DOLLY.timeField({ label: __('End'), name: p + 'end_time', value: base.end }),
				ls: DOLLY.timeField({ label: __('Break start'), name: p + 'lunch_start', value: base.lunch_start || '13:00' }),
				le: DOLLY.timeField({ label: __('Break end'), name: p + 'lunch_end', value: base.lunch_end || '14:00' }),
				os: DOLLY.timeField({ label: _x('From', 'time slot'), name: p + 'office_start', value: (d && d.office_start) || base.start || '09:00' }),
				oe: DOLLY.timeField({ label: _x('To', 'time slot'), name: p + 'office_end', value: (d && d.office_end) || base.lunch_start || '13:00' }),
				ss: DOLLY.timeField({ label: _x('From', 'time slot'), name: p + 'smart_start', value: (d && d.smart_start) || base.lunch_end || '14:00' }),
				se: DOLLY.timeField({ label: _x('To', 'time slot'), name: p + 'smart_end', value: (d && d.smart_end) || base.end || '18:00' })
			};
			var lunchBox = h('div', { class: 'dolly-dayrow__lunch', hidden: !hasLunch }, [r.ls, r.le]);
			r.lunch = DOLLY.switchControl({ label: __('Break'), name: p + 'has_lunch', checked: hasLunch, onChange: function (on) { lunchBox.hidden = !on; } });
			var plain = h('div', { class: 'dolly-dayrow__plain' }, [r.start, r.end, r.lunch, lunchBox]);
			var mixed = h('div', { class: 'dolly-dayrow__mixed' }, [
				h('div', { class: 'dolly-dayrow__block' }, [h('span', { class: 'dolly-dayrow__tag' }, [DOLLY.icon('building-2'), __('On site')]), r.os, r.oe]),
				h('div', { class: 'dolly-dayrow__block' }, [h('span', { class: 'dolly-dayrow__tag dolly-dayrow__tag--smart' }, [DOLLY.icon('house'), __('Remote work')]), r.ss, r.se]),
				h('p', { class: 'dolly-help dolly-dayrow__note', text: __('The two time slots must not overlap; the gap between them, if any, is the break.') })
			]);
			function syncMode() {
				var m = r.mode.input.value;
				plain.hidden = m === 'mixed';
				mixed.hidden = m !== 'mixed';
			}
			r.mode.input.addEventListener('change', syncMode);
			syncMode();
			var times = h('div', { class: 'dolly-dayrow__times', hidden: !working }, [r.mode, plain, mixed]);
			r.on = DOLLY.switchControl({ label: label, name: 'day' + wd, checked: working, onChange: function (on) { times.hidden = !on; } });
			rows[wd] = r;
			perDayBox.appendChild(h('div', { class: 'dolly-dayrow' }, [h('div', { class: 'dolly-dayrow__day' }, r.on), times]));
		});

		var perDay = DOLLY.switchControl({ label: __('Different shifts for each day'), name: 'per_day', checked: !!s.per_day, description: __('Off (regular shifts): one fixed timetable for all the selected days. On (different shifts): each day has its own switch, timetable and mode (on site, remote or mixed).'), onChange: sync });
		perDay.dataset.tour = 'per-day';
		var onCallInfo = h('div', { class: 'dolly-field--full' }, DOLLY.alert(__('On-call contract: no fixed days or hours. The employee starts and ends the shift whenever they want; each shift is approved by the administrator or automatically up to the threshold set in Settings.'), 'info'));
		var hoursBox = h('div', { class: 'dolly-form-grid dolly-field--full' }, [h('div', { class: 'dolly-field--full' }, perDay), uniformBox, perDayBox]);
		var wrap = h('div', { class: 'dolly-form-grid' }, [type, h('span'), onCallInfo, hoursBox]);
		function sync() {
			var onCall = type.input.value === 'on_call';
			onCallInfo.hidden = !onCall;
			hoursBox.hidden = onCall;
			var pd = perDay.control.isOn();
			uniformBox.hidden = pd;
			perDayBox.hidden = !pd;
		}
		type.input.addEventListener('change', sync);
		sync();

		wrap.collect = function (errors) {
			var t = type.input.value;
			if (t === 'on_call') { return { employment_type: 'on_call' }; }
			if (perDay.control.isOn()) {
				var out = { employment_type: t, per_day: true, days: {} }, any = false;
				Object.keys(rows).forEach(function (wd) {
					var r = rows[wd], p = 'day' + wd + '_';
					if (!r.on.control.isOn()) { return; }
					any = true;
					var mode = r.mode.input.value;
					var spec = {};
					if (mode === 'mixed') {
						['office_start', 'office_end', 'smart_start', 'smart_end'].forEach(function (k, i) { spec[p + k] = [[r.os, r.oe, r.ss, r.se][i], 'time', true]; });
						var rm = DOLLY.readDateTimes(spec);
						Object.assign(errors, rm.errors);
						out.days[wd] = { mode: 'mixed', office_start: rm.values[p + 'office_start'], office_end: rm.values[p + 'office_end'], smart_start: rm.values[p + 'smart_start'], smart_end: rm.values[p + 'smart_end'] };
						if (!Object.keys(rm.errors).length) {
							var m = function (v) { return +v.slice(0, 2) * 60 + +v.slice(3, 5); };
							var d = out.days[wd];
							if (m(d.office_end) <= m(d.office_start)) { errors[p + 'office_end'] = __('The end must be after the start.'); }
							else if (m(d.smart_end) <= m(d.smart_start)) { errors[p + 'smart_end'] = __('The end must be after the start.'); }
							else if (m(d.office_start) < m(d.smart_end) && m(d.smart_start) < m(d.office_end)) { errors[p + 'smart_start'] = __('On-site and remote hours must not overlap.'); }
						}
						return;
					}
					spec[p + 'start_time'] = [r.start, 'time', true];
					spec[p + 'end_time'] = [r.end, 'time', true];
					var lunch = r.lunch.control.isOn();
					if (lunch) { spec[p + 'lunch_start'] = [r.ls, 'time', true]; spec[p + 'lunch_end'] = [r.le, 'time', true]; }
					var rd = DOLLY.readDateTimes(spec);
					Object.assign(errors, rd.errors);
					out.days[wd] = { mode: mode, start_time: rd.values[p + 'start_time'], end_time: rd.values[p + 'end_time'], has_lunch: lunch, lunch_start: rd.values[p + 'lunch_start'] || '', lunch_end: rd.values[p + 'lunch_end'] || '' };
				});
				if (!any) { errors.per_day = __('Enable at least one working day.'); }
				return out;
			}
			var lunch2 = u.has_lunch.control.isOn();
			var spec2 = { start_time: [u.start_time, 'time', true], end_time: [u.end_time, 'time', true] };
			if (lunch2) { spec2.lunch_start = [u.lunch_start, 'time', true]; spec2.lunch_end = [u.lunch_end, 'time', true]; }
			var rd2 = DOLLY.readDateTimes(spec2);
			Object.assign(errors, rd2.errors);
			if (!u.weekdays.values().length) { errors.weekdays = __('Select at least one day.'); }
			return { employment_type: t, weekdays: u.weekdays.values().map(Number), start_time: rd2.values.start_time, end_time: rd2.values.end_time, has_lunch: lunch2, lunch_start: rd2.values.lunch_start || '', lunch_end: rd2.values.lunch_end || '', smart: u.smart.control.isOn() };
		};
		return wrap;
	}

	function employeeForm(e, isNew) {
		e = e || {};
		var s = e.schedule || { weekdays: [1, 2, 3, 4, 5], start_time: '09:00', end_time: '18:00', has_lunch: true, lunch_start: '13:00', lunch_end: '14:00', employment_type: 'full_time' };
		var bank = e.bank || {};
		var alertBox = h('div', { hidden: true });
		var f = {
			first_name: DOLLY.field({ label: __('Name'), name: 'first_name', value: e.first_name, required: true }),
			last_name: DOLLY.field({ label: __('Last name'), name: 'last_name', value: e.last_name, required: true }),
			username: DOLLY.field({ label: __('Username'), name: 'username', value: e.username, required: isNew, help: isNew ? __('It cannot be changed later.') : __('The username cannot be changed.'), attrs: isNew ? { autocomplete: 'off', autocapitalize: 'none' } : { readonly: true } }),
			email: DOLLY.field({ label: __('Email'), name: 'email', type: 'email', value: e.email, required: true }),
			phone: DOLLY.field({ label: __('Phone'), name: 'phone', type: 'tel', value: e.phone, optional: true }),
			password: isNew ? DOLLY.field({ label: __('Initial password'), name: 'password', type: 'text', required: true, help: __('At least 8 characters. Share it with the employee securely.'), attrs: { autocomplete: 'new-password' } }) : null,
			schedule: scheduleEditor(s),
			workplaces: DOLLY.chips({ label: __('Assigned workplaces'), name: 'workplaces', full: true, help: __('The employee can clock in only at the assigned workplaces.'), selected: (e.workplaces || []).map(function (w) { return w.id; }), options: (CFG.workplaces || []).filter(function (w) { return w.active; }).map(function (w) { return { value: w.id, label: w.name }; }) }),
			valid_from: DOLLY.dateField({ label: isNew ? __('Valid from') : __('Schedule and workplace changes valid from'), name: 'valid_from', value: CFG.today, required: true, help: __('Changes do not alter previous history. Format DD/MM/YYYY.') }),
			iban: DOLLY.field({ label: 'IBAN', name: 'iban', value: DOLLY.fmt.iban(bank.iban), optional: true, full: true, attrs: { autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' } }),
			bank_beneficiary: DOLLY.field({ label: __('Account holder name'), name: 'bank_beneficiary', value: bank.bank_beneficiary, optional: true }),
			bank_name: DOLLY.field({ label: __('Bank'), name: 'bank_name', value: bank.bank_name, optional: true }),
			bic: DOLLY.field({ label: 'BIC', name: 'bic', value: bank.bic, optional: true, help: __('8 or 11 characters.'), attrs: { autocapitalize: 'characters', spellcheck: 'false', maxlength: 11 } })
		};
		if (isNew) {
			var gen = DOLLY.button(__('Generate'), { icon: 'refresh-cw', onClick: function () {
				var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', out = '', a = new Uint32Array(12);
				window.crypto.getRandomValues(a);
				for (var i = 0; i < 12; i++) { out += chars[a[i] % chars.length]; }
				f.password.input.value = out;
			} });
			f.password.querySelector('.dolly-input').parentNode.insertBefore(h('div', { class: 'dolly-input-group' }, [f.password.input, gen]), f.password.querySelector('.dolly-help') || null);
		}
		if (!(CFG.workplaces || []).length) { f.workplaces = h('div', { class: 'dolly-field dolly-field--full', dataset: { name: 'workplaces' } }, [DOLLY.alert(__('Create at least one workplace first.'), 'warning', h('a', { href: CFG.pages.workplaces, text: __('Go to Workplaces') })), h('span', { class: 'dolly-error', hidden: true })]); f.workplaces.values = function () { return []; }; }

		var form = h('form', { class: 'dolly-form', novalidate: true }, [
			alertBox,
			h('h3', {}, [DOLLY.icon('id-card'), __(' Personal details')]),
			h('div', { class: 'dolly-form-grid' }, [f.first_name, f.last_name, f.username, f.email, f.phone, f.password]),
			h('h3', {}, [DOLLY.icon('clock'), __(' Schedule')]),
			f.schedule,
			h('h3', {}, [DOLLY.icon('map-pin'), __(' Workplaces')]),
			h('div', { class: 'dolly-form-grid' }, [f.workplaces, f.valid_from]),
			h('h3', {}, [DOLLY.icon('landmark'), __(' Bank details')]),
			h('div', { class: 'dolly-form-grid' }, [f.iban, f.bank_beneficiary, f.bank_name, f.bic])
		]);

		form.collect = function () {
			DOLLY.clearErrors(form); alertBox.hidden = true;
			var read = DOLLY.readDateTimes({ valid_from: [f.valid_from, 'date', true] });
			var errors = read.errors;
			var schedule = f.schedule.collect(errors);
			if (!f.workplaces.values().length) { errors.workplaces = __('Assign at least one workplace.'); }
			var iban = f.iban.input.value.replace(/[\s-]+/g, '').toUpperCase();
			if (iban && !DOLLY.isIban(iban)) { errors.iban = __('Invalid IBAN: check the letters and digits.'); }
			if (Object.keys(errors).length) { DOLLY.showErrors(form, errors); return null; }
			var body = {
				first_name: f.first_name.input.value, last_name: f.last_name.input.value, email: f.email.input.value, phone: f.phone.input.value,
				iban: iban, bank_beneficiary: f.bank_beneficiary.input.value, bank_name: f.bank_name.input.value, bic: f.bic.input.value,
				schedule: schedule,
				workplaces: f.workplaces.values().map(Number),
				valid_from: read.values.valid_from
			};
			if (isNew) { body.username = f.username.input.value; body.password = f.password.input.value; }
			return body;
		};
		form.fail = function (err) {
			var fields = err.fields ? Object.assign({}, err.fields) : null;
			DOLLY.formError(form, err, alertBox);
			if (fields) { DOLLY.showErrors(form, fields); }
		};
		return form;
	}

	function pageEmployeeNew() {
		var form = employeeForm(null, true);
		var btn = DOLLY.button(__('Create employee'), { type: 'submit', variant: 'primary', icon: 'user-plus' });
		form.appendChild(h('div', { class: 'dolly-btn-row' }, btn));
		form.addEventListener('submit', function (ev) {
			ev.preventDefault();
			var body = form.collect();
			if (!body) { return; }
			DOLLY.busy(btn, DOLLY.api('admin/employees', { method: 'POST', body: body })).then(function (emp) {
				DOLLY.render(main, DOLLY.card(__('Employee created'), 'circle-check', [
					DOLLY.alert(emp.name + ' (' + emp.username + __(') has been created. They can sign in at ') + CFG.portalUrl.replace('/portale/', '/accesso/') + '.', 'success'),
					h('div', { class: 'dolly-btn-row' }, [DOLLY.button(__('Create another employee'), { icon: 'user-plus', variant: 'primary', onClick: pageEmployeeNew }), DOLLY.button(__('Employee list'), { href: CFG.pages.employees, icon: 'users' })])
				], { accent: true }));
			}, form.fail);
		});
		DOLLY.render(main, DOLLY.card(__('New employee'), 'user-plus', form, { accent: true }));
	}

	/* ------------------------------------------------------------------ */
	/* Employees list & detail                                              */
	/* ------------------------------------------------------------------ */

	/* Device management: registered devices of an employee, limit and unlink. */

	var DEVICES_OFF = __('Device sessions are turned off (Settings › Device sessions): employees can currently sign in from any device.');

	/** Limit of devices of an employee: number + save. */
	function deviceLimitControl(uid, ds, reload) {
		var input = h('input', { class: 'dolly-input', type: 'number', min: 1, max: ds.max_limit, value: ds.limit, inputmode: 'numeric', 'aria-label': __('Maximum number of devices') });
		var btn = DOLLY.button(__('Save limit'), { size: 'sm', icon: 'save', onClick: function () {
			var v = parseInt(input.value, 10);
			if (!(v >= 1 && v <= ds.max_limit)) { DOLLY.toast(__('The limit must be between 1 and ') + ds.max_limit + '.', 'error'); return; }
			DOLLY.busy(btn, DOLLY.api('admin/employees/' + uid + '/device-limit', { method: 'POST', body: { limit: v } })).then(function () {
				DOLLY.toast(__('Device limit updated.'), 'success'); reload();
			}, function (err) { DOLLY.toast(err.message, 'error'); });
		} });
		return h('div', { class: 'dolly-limit' }, [input, btn]);
	}

	/** Registered devices with "Scollega"; the first one is the main device. */
	function deviceList(devices, employee, reload) {
		if (!devices.length) { return h('span', { class: 'dolly-small dolly-muted', text: __('No devices linked: the next sign-in registers the main device.') }); }
		return h('div', {}, devices.map(function (d, i) {
			return h('div', { class: 'dolly-device' }, [
				DOLLY.icon('smartphone'),
				h('span', { class: 'dolly-device__name', text: d.name }),
				i === 0 ? DOLLY.badge(__('Primary'), 'blue') : null,
				h('span', { class: 'dolly-device__meta', text: __('Linked on ') + DOLLY.fmt.dateTime(d.created_at) + __(' · last sign-in ') + DOLLY.fmt.dateTime(d.last_seen_at) }),
				DOLLY.button(__('Unlink'), { size: 'sm', icon: 'unlink', ariaLabel: __('Unlink ') + d.name + __(' of ') + employee, onClick: function (ev) {
					var b = ev.currentTarget;
					DOLLY.confirm(__('Unlink the device?'), '«' + d.name + __('» of ') + employee + __(' will be disconnected and the employee will have to sign in again: the next device they sign in with will be registered.'), __('Unlink'), 'danger').then(function (ok) {
						if (!ok) { return; }
						DOLLY.busy(b, DOLLY.api('admin/devices/' + d.id, { method: 'DELETE' })).then(function () { DOLLY.toast(__('Device unlinked.'), 'success'); reload(); }, function (err) { DOLLY.toast(err.message, 'error'); });
					});
				} })
			]);
		}));
	}

	/** Page tab "Gestione dispositivi": every employee with devices and limit. */
	function devicesTab(content) {
		var box = h('div', {}, DOLLY.loading());
		var search = DOLLY.field({ label: __('Search'), type: 'search', attrs: { placeholder: __('Employee name') } });
		var all = null;
		search.input.addEventListener('input', function () { draw(); });
		DOLLY.render(content, DOLLY.card(null, null, [
			h('p', { class: 'dolly-muted', style: 'margin-top:0', text: __('Each employee signs in only from linked devices: the first sign-in registers the main device. To let an employee sign in from another phone or computer, unlink the previous device or raise the limit.') }),
			h('div', { class: 'dolly-toolbar' }, search),
			box
		]));
		function draw() {
			if (!all) { return; }
			var q = search.input.value.trim().toLowerCase();
			var items = all.items.filter(function (e) { return !q || e.employee.toLowerCase().indexOf(q) !== -1; });
			DOLLY.render(box, [
				all.enabled ? null : DOLLY.alert(DEVICES_OFF, 'warning'),
				DOLLY.table([
					{ label: __('Employee'), render: function (e) { return h('strong', { text: e.employee }); } },
					{ label: __('Device limit'), render: function (e) { return deviceLimitControl(e.user_id, { limit: e.limit, max_limit: all.max_limit }, load); } },
					{ label: __('Linked devices'), render: function (e) { return deviceList(e.devices, e.employee, load); } }
				], items, { empty: [__('No employees found'), '', 'smartphone'], caption: __('Employee devices') })
			]);
			DOLLY.icons();
		}
		function load() {
			DOLLY.api('admin/devices').then(function (r) { all = r; draw(); }, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function pageEmployees() {
		var tab = window.location.hash === '#dispositivi' ? 'dispositivi' : 'elenco';
		var content = h('div');
		DOLLY.render(main, [
			DOLLY.tabs([{ id: 'elenco', label: __('Employees'), icon: 'users' }, { id: 'dispositivi', label: __('Device management'), icon: 'smartphone' }], tab, function (t) {
				window.location.hash = t === 'dispositivi' ? 'dispositivi' : '';
				pageEmployees();
			}),
			content
		]);
		if (tab === 'dispositivi') { devicesTab(content); } else { employeesTab(content); }
	}

	function employeesTab(main) {
		var st = { page: 1, search: '', status: 'active', workplace: '' };
		var search = DOLLY.field({ label: __('Search'), type: 'search', attrs: { placeholder: __('Name, username or email') } });
		var status = DOLLY.field({ label: __('Status'), type: 'select', value: st.status, options: [{ value: 'active', label: _x('Active', 'plural') }, { value: 'inactive', label: __('Inactive') }, { value: 'all', label: __('All') }] });
		var wp = DOLLY.field({ label: __('Workplace'), type: 'select', options: workplaceOptions(__('All workplaces')) });
		var box = h('div', {}, DOLLY.loading());
		var t;
		search.input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { st.search = search.input.value; st.page = 1; load(); }, 300); });
		status.input.addEventListener('change', function () { st.status = status.input.value; st.page = 1; load(); });
		wp.input.addEventListener('change', function () { st.workplace = wp.input.value; st.page = 1; load(); });
		DOLLY.render(main, DOLLY.card(null, null, [
			h('div', { class: 'dolly-toolbar' }, [search, status, wp, h('div', { class: 'dolly-toolbar__spacer' }), DOLLY.button(__('New employee'), { href: CFG.pages['employee-new'], variant: 'primary', icon: 'user-plus' })]),
			box
		]));
		function load() {
			DOLLY.api('admin/employees', { query: { page: st.page, search: st.search, status: st.status, workplace: st.workplace } }).then(function (r) {
				DOLLY.render(box, [
					DOLLY.table([
						{ label: __('Employee'), render: function (e) { return h('div', {}, [h('strong', { text: e.sort_name || e.name }), h('div', { class: 'dolly-small dolly-muted', text: e.username })]); } },
						{ label: __('Contacts'), render: function (e) { return h('div', { class: 'dolly-small' }, [e.email, e.phone ? h('div', { text: e.phone }) : null]); } },
						{ label: __('Workplaces'), render: function (e) { return e.workplaces.map(function (w) { return w.name; }).join(', ') || '—'; } },
						{ label: __('Schedule'), render: function (e) { var s = e.schedule; return s ? h('div', { class: 'dolly-small' }, [s.on_call ? DOLLY.badge(__('On call'), 'blue', 'phone-call') : null, h('div', { text: s.on_call ? '' : s.summary })]) : '—'; } },
						{ label: __('Status'), render: function (e) { return e.active ? DOLLY.badge(__('Active'), 'green', 'circle-check') : DOLLY.badge(__('Disabled'), 'neutral', 'ban'); } },
						{ label: '', srLabel: __('Actions'), render: function (e) { return h('div', { class: 'dolly-actions' }, [DOLLY.button(__('Manage'), { size: 'sm', icon: 'pencil', ariaLabel: __('Manage ') + e.name, onClick: function () { employeeDialog(e.id, load); } })]); } }
					], r.items, { empty: [__('No employees found'), __('Change the filters or create a new employee.'), 'users'], caption: __('Employee list') }),
					DOLLY.pagination(r, function (p) { st.page = p; load(); }, 'dipendenti')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function employeeDialog(id, done) {
		var body = h('div', {}, DOLLY.loading());
		var dlg = DOLLY.dialog({ title: __('Manage employee'), body: body, wide: true });
		var tab = 'dati';
		function load() {
			DOLLY.api('admin/employees/' + id).then(function (e) { render(e); }, function (err) { DOLLY.render(body, DOLLY.errorState(err, load)); });
		}
		function render(e) {
			var content = h('div');
			var tabs = DOLLY.tabs([{ id: 'dati', label: __('Details and schedule'), icon: 'id-card' }, { id: 'accesso', label: __('Sign-in and status'), icon: 'shield-check' }, { id: 'eccezioni', label: __('Verification exceptions'), icon: 'badge-check' }, { id: 'dispositivi', label: __('Device management'), icon: 'smartphone' }, { id: 'storico', label: __('History'), icon: 'history' }], tab, function (t) { tab = t; render(e); });
			DOLLY.render(body, [h('p', {}, [h('strong', { text: e.sort_name || e.name }), ' · ' + e.username + ' · ', e.active ? DOLLY.badge(__('Active'), 'green', 'circle-check') : DOLLY.badge(__('Disabled'), 'neutral', 'ban')]), tabs, content]);
			if (tab === 'dati') {
				var form = employeeForm(e, false);
				var reason = DOLLY.field({ label: __('Reason for the change'), name: 'reason', optional: true, full: true });
				var save = DOLLY.button(__('Save changes'), { type: 'submit', variant: 'primary', icon: 'save' });
				form.appendChild(reason);
				form.appendChild(h('div', { class: 'dolly-btn-row' }, save));
				form.addEventListener('submit', function (ev) {
					ev.preventDefault();
					var b = form.collect(); if (!b) { return; }
					b.reason = reason.input.value;
					DOLLY.busy(save, DOLLY.api('admin/employees/' + id, { method: 'PUT', body: b })).then(function () { DOLLY.toast(__('Employee updated.'), 'success'); done(); load(); }, form.fail);
				});
				DOLLY.render(content, form);
			} else if (tab === 'accesso') {
				var pw = DOLLY.field({ label: __('New password'), name: 'password', type: 'text', help: __('At least 8 characters. The employee\'s active sessions will be closed.'), attrs: { autocomplete: 'new-password' } });
				var pwBtn = DOLLY.button(__('Set password'), { type: 'submit', icon: 'key-round', variant: 'primary' });
				var pwForm = h('form', { class: 'dolly-form', novalidate: true }, [pw, h('div', { class: 'dolly-btn-row' }, pwBtn)]);
				pwForm.addEventListener('submit', function (ev) {
					ev.preventDefault();
					DOLLY.busy(pwBtn, DOLLY.api('admin/employees/' + id + '/password', { method: 'POST', body: { password: pw.input.value } })).then(function (r) { DOLLY.toast(r.message, 'success'); pw.input.value = ''; }, function (err) { DOLLY.formError(pwForm, err); });
				});
				var reason2 = DOLLY.field({ label: __('Reason'), name: 'reason', type: 'textarea', required: true });
				var stBtn = DOLLY.button(e.active ? __('Deactivate employee') : __('Reactivate employee'), { type: 'submit', icon: e.active ? 'ban' : 'rotate-ccw', variant: e.active ? 'danger' : 'success' });
				var stForm = h('form', { class: 'dolly-form', novalidate: true }, [
					DOLLY.alert(e.active ? __('Deactivating immediately ends all sessions and blocks access. The history is kept.') : __('The employee will be able to sign in to the portal again.'), e.active ? 'warning' : 'info'),
					reason2, h('div', { class: 'dolly-btn-row' }, stBtn)
				]);
				stForm.addEventListener('submit', function (ev) {
					ev.preventDefault();
					if (!reason2.input.value.trim()) { DOLLY.showErrors(stForm, { reason: __('Enter the reason.') }); return; }
					DOLLY.busy(stBtn, DOLLY.api('admin/employees/' + id + '/status', { method: 'POST', body: { active: !e.active, reason: reason2.input.value } })).then(function () {
						DOLLY.toast(e.active ? __('Employee deactivated.') : __('Employee reactivated.'), 'success'); done(); load();
					}, function (err) { DOLLY.formError(stForm, err); });
				});
				DOLLY.render(content, h('div', { class: 'dolly-stack' }, [DOLLY.card(__('Password'), 'key-round', pwForm, { level: 'h3' }), DOLLY.card(__('Account status'), 'shield-check', stForm, { level: 'h3' })]));
			} else if (tab === 'eccezioni') {
				var reason3 = DOLLY.field({ label: __('Reason'), name: 'reason', type: 'textarea', required: true });
				var customBox = h('div', { class: 'dolly-form-grid', hidden: true });
				var expD = DOLLY.dateField({ label: __('Expiry: date'), name: 'expires_date', value: CFG.today });
				var expT = DOLLY.timeField({ label: __('Expiry: time'), name: 'expires_time', value: '23:59' });
				DOLLY.append(customBox, [expD, expT]);
				var custom = DOLLY.switchControl({ label: __('Custom expiry'), name: 'custom', checked: false, description: __('If turned off, the exception expires at 23:59 today.'), onChange: function (on) { customBox.hidden = !on; } });
				var exBtn = DOLLY.button(__('Create exception'), { type: 'submit', icon: 'badge-check', variant: 'primary' });
				var exForm = h('form', { class: 'dolly-form', novalidate: true }, [DOLLY.alert(__('The exception allows clocking in without GPS and without QR/PIN. Its creation and every use are logged.'), 'info'), reason3, custom, customBox, h('div', { class: 'dolly-btn-row' }, exBtn)]);
				exForm.addEventListener('submit', function (ev) {
					ev.preventDefault(); DOLLY.clearErrors(exForm);
					if (!reason3.input.value.trim()) { DOLLY.showErrors(exForm, { reason: __('Enter the reason.') }); return; }
					var b = { reason: reason3.input.value };
					if (custom.control.isOn()) {
						var rd = DOLLY.readDateTimes({ expires_date: [expD, 'date', true], expires_time: [expT, 'time', true] });
						if (Object.keys(rd.errors).length) { DOLLY.showErrors(exForm, rd.errors); return; }
						b.expires_at = rd.values.expires_date + ' ' + rd.values.expires_time;
					}
					DOLLY.busy(exBtn, DOLLY.api('admin/employees/' + id + '/exception', { method: 'POST', body: b })).then(function () { DOLLY.toast(__('Exception created.'), 'success'); load(); }, function (err) { DOLLY.formError(exForm, err); });
				});
				DOLLY.render(content, h('div', { class: 'dolly-stack' }, [
					DOLLY.card(__('New exception'), 'badge-check', exForm, { level: 'h3' }),
					DOLLY.card(__('Recent exceptions'), 'history', DOLLY.table([
						{ label: __('Reason'), key: 'reason' },
						{ label: __('Expires'), render: function (x) { return DOLLY.fmt.dateTime(x.expires_at); } },
						{ label: __('Uses'), key: 'use_count', num: true },
						{ label: __('Created by'), render: function (x) { return x.created_by + ' · ' + DOLLY.fmt.dateTime(x.created_at); } },
						{ label: __('Status'), render: function (x) { return x.active ? DOLLY.badge(_x('Active', 'feminine'), 'green', 'circle-check') : (x.revoked_at ? DOLLY.badge(__('Revoked'), 'neutral', 'ban') : DOLLY.badge(__('Expired'), 'neutral', 'clock')); } },
						{ label: '', srLabel: __('Actions'), render: function (x) { return x.active ? DOLLY.button(__('Revoke'), { size: 'sm', icon: 'ban', onClick: function (ev) { DOLLY.busy(ev.currentTarget, DOLLY.api('admin/exceptions/' + x.id, { method: 'DELETE' })).then(function () { DOLLY.toast(__('Exception revoked.'), 'success'); load(); }, function (err) { DOLLY.toast(err.message, 'error'); }); } }) : ''; } }
					], e.exceptions, { empty: [__('No exceptions'), '', 'badge-check'] }), { level: 'h3' })
				]));
			} else if (tab === 'dispositivi') {
				var ds = e.device_session || { enabled: true, limit: 1, max_limit: 10, devices: [] };
				DOLLY.render(content, h('div', { class: 'dolly-stack' }, [
					ds.enabled ? null : DOLLY.alert(DEVICES_OFF, 'warning'),
					DOLLY.card(__('Linked devices'), 'smartphone', [
						h('p', { class: 'dolly-muted', style: 'margin-top:0', text: __('The employee can sign in only from these devices. Unlinking one signs it out, and the next device they sign in with is registered.') }),
						deviceList(ds.devices, e.sort_name || e.name, load)
					], { level: 'h3' }),
					DOLLY.card(__('Device limit'), 'shield-check', [
						h('p', { class: 'dolly-muted', style: 'margin-top:0', text: __('Maximum number of devices the employee can sign in from (default 1, maximum ') + ds.max_limit + ').' }),
						deviceLimitControl(e.id, ds, load)
					], { level: 'h3' })
				]));
			} else {
				DOLLY.render(content, h('div', { class: 'dolly-stack' }, [
					DOLLY.card(__('Schedule history'), 'clock', DOLLY.table([
						{ label: __('From'), render: function (s) { return DOLLY.fmt.date(s.valid_from); } },
						{ label: __('To'), render: function (s) { return s.valid_to ? DOLLY.fmt.date(s.valid_to) : __('ongoing'); } },
						{ label: __('Schedule'), render: function (s) { return h('span', { class: 'dolly-small', text: s.summary }); } },
						{ label: __('Type'), key: 'employment_label' }
					], e.schedule_history), { level: 'h3' }),
					DOLLY.card(__('Change log'), 'history', auditList(e.audit), { level: 'h3' })
				]));
			}
			DOLLY.icons();
		}
		load();
		return dlg;
	}

	function auditList(items) {
		return DOLLY.table([
			{ label: __('Date'), render: function (a) { return DOLLY.fmt.dateTime(a.created_at); } },
			{ label: __('Operation'), key: 'label' },
			{ label: __('Performed by'), key: 'actor' },
			{ label: __('Employee'), key: 'subject' },
			{ label: __('Reason'), key: 'reason' },
			{ label: __('Values'), render: function (a) {
				if (!a.before && !a.after) { return '—'; }
				return h('details', {}, [h('summary', { text: __('Before / after') }), h('pre', { class: 'dolly-small', style: 'white-space:pre-wrap;max-width:420px', text: __('Before: ') + JSON.stringify(a.before, null, 1) + __('\nAfter: ') + JSON.stringify(a.after, null, 1) })]);
			} }
		], items, { empty: [__('No changes recorded'), '', 'history'], caption: __('Change log') });
	}

	/* ------------------------------------------------------------------ */
	/* Workplaces                                                           */
	/* ------------------------------------------------------------------ */

	function pageWorkplaces() {
		var box = h('div', {}, DOLLY.loading());
		DOLLY.render(main, DOLLY.card(null, null, [
			h('div', { class: 'dolly-toolbar' }, [h('p', { class: 'dolly-muted', style: 'margin:0', text: __('Each workplace has a dedicated account that shows the QR and PIN at ') + CFG.portalUrl.replace('/portale/', '/accesso-sede/') }), h('div', { class: 'dolly-toolbar__spacer' }), DOLLY.button(__('New workplace'), { variant: 'primary', icon: 'plus', onClick: function () { workplaceDialog(null, load); } })]),
			box
		]));
		function load() {
			refreshWorkplaces().then(function (list) {
				DOLLY.render(box, DOLLY.table([
					{ label: __('Workplace'), render: function (w) { return h('div', {}, [h('strong', { text: w.name }), h('div', { class: 'dolly-small dolly-muted', text: [w.address, w.city, w.province].filter(Boolean).join(', ') })]); } },
					{ label: __('Coordinates'), render: function (w) { return w.lat !== null ? h('span', { class: 'dolly-small', text: String(w.lat).replace('.', ',') + ' / ' + String(w.lng).replace('.', ',') }) : DOLLY.badge(__('Not set'), 'amber', 'triangle-alert'); } },
					{ label: __('Radius'), render: function (w) { return w.radius_m + ' m'; }, num: true },
					{ label: __('Late tolerance'), render: function (w) { return w.late_tolerance === null || w.late_tolerance === undefined ? h('span', { class: 'dolly-muted', text: __('Default (') + (CFG.lateTolerance || 0) + __(' min)') }) : w.late_tolerance + __(' min'); } },
					{ label: __('Workplace account'), render: function (w) { return w.account_username ? w.account_username : DOLLY.badge(__('Missing'), 'amber', 'triangle-alert'); } },
					{ label: 'Bluetooth', render: function (w) { return w.bluetooth ? DOLLY.badge(__('Active'), 'green', 'bluetooth') : h('span', { class: 'dolly-muted', text: __('No') }); } },
					{ label: __('Status'), render: function (w) { return w.active ? DOLLY.badge(_x('Active', 'feminine'), 'green', 'circle-check') : DOLLY.badge(_x('Inactive', 'feminine'), 'neutral', 'ban'); } },
					{ label: '', srLabel: __('Actions'), render: function (w) { return h('div', { class: 'dolly-actions' }, [
						DOLLY.button('Bluetooth', { size: 'sm', icon: 'bluetooth', ariaLabel: __('Bluetooth device for ') + w.name, onClick: function () { bluetoothDialog(w, load); } }),
						DOLLY.button(__('Edit'), { size: 'sm', icon: 'pencil', ariaLabel: __('Edit ') + w.name, onClick: function () { workplaceDialog(w, load); } })
					]); } }
				], list, { empty: [__('No workplaces'), __('Create the first workplace to assign employees.'), 'map-pin'], caption: __('Workplaces') }));
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	/* ------------------------------------------------------------------ */
	/* Map for the position of a workplace                                  */
	/* ------------------------------------------------------------------ */

	function parseCoord(v) {
		var n = parseFloat(String(v || '').trim().replace(',', '.'));
		return isFinite(n) ? n : null;
	}
	function coordText(n) { return n.toFixed(7).replace('.', ','); }

	/**
	 * Interactive map (OpenStreetMap) for the GPS position of a workplace: shows where the administrator is,
	 * a tap on the map or a drag of the pin sets latitude and longitude, the circle is the allowed radius.
	 * The latitude/longitude fields stay editable and move the pin. Returns { el, init(dialogEl) }.
	 */
	function mapPicker(latField, lngField, radiusField, addressOf) {
		var M = CFG.map || {};
		var canvas = h('div', { class: 'dolly-map__canvas', role: 'application', 'aria-label': __('Workplace map: tap a point to place the workplace') });
		var status = h('p', { class: 'dolly-help dolly-map__status', 'aria-live': 'polite' });
		var search = h('input', { class: 'dolly-input', type: 'search', placeholder: __('Search for an address or a place'), 'aria-label': __('Search for an address or a place'), autocomplete: 'off' });
		var searchBtn = DOLLY.button(__('Search'), { icon: 'search', onClick: find });
		var hereBtn = DOLLY.button(__('Use my location'), { icon: 'locate-fixed', onClick: function () { locate(true); } });
		var el = h('div', { class: 'dolly-field dolly-field--full dolly-map' }, [
			h('div', { class: 'dolly-map__tools' }, [h('div', { class: 'dolly-input-group dolly-map__search' }, [search, searchBtn]), hereBtn]),
			canvas,
			h('div', { class: 'dolly-map__legend' }, [
				h('span', {}, [h('span', { class: 'dolly-map__key dolly-map__key--pin', 'aria-hidden': 'true' }), __('Workplace (drag the pin or tap the map)')]),
				h('span', {}, [h('span', { class: 'dolly-map__key dolly-map__key--me', 'aria-hidden': 'true' }), __('Your position')]),
				h('span', {}, [h('span', { class: 'dolly-map__key dolly-map__key--area', 'aria-hidden': 'true' }), __('Area where clocking in is allowed')])
			]),
			status
		]);
		search.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); find(); } });
		var L = window.L, map = null, pin = null, area = null, me = null, meAcc = null;

		function say(t) { status.textContent = t || ''; }
		function radius() { return Math.max(10, Math.min(5000, parseInt(radiusField.input.value, 10) || CFG.defaultRadius || 100)); }
		function place(lat, lng, o) {
			o = o || {};
			if (!pin) {
				pin = L.marker([lat, lng], { draggable: true, autoPan: true, keyboard: true, title: __('Workplace position'), alt: __('Workplace position'),
					icon: L.divIcon({ className: 'dolly-map__pin', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 30] }) }).addTo(map);
				area = L.circle([lat, lng], { radius: radius(), color: DOLLY.token('primary', '#2563EB'), weight: 2, fillOpacity: 0.12, interactive: false }).addTo(map);
				pin.on('drag', function () { area.setLatLng(pin.getLatLng()); });
				pin.on('dragend', function () { var p = pin.getLatLng(); write(p.lat, p.lng); say(__('Workplace position updated.')); });
			} else {
				pin.setLatLng([lat, lng]); area.setLatLng([lat, lng]);
			}
			if (o.write) { write(lat, lng); }
			if (o.fly) { map.setView([lat, lng], Math.max(map.getZoom(), 17)); }
		}
		function write(lat, lng) { latField.input.value = coordText(lat); lngField.input.value = coordText(lng); }
		function fromFields(fly) {
			var lat = parseCoord(latField.input.value), lng = parseCoord(lngField.input.value);
			if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) { return false; }
			place(lat, lng, { fly: fly });
			return true;
		}
		function locate(movePin) {
			if (!navigator.geolocation) { say(__('Geolocation is not supported by this browser.')); return; }
			hereBtn.classList.add('is-loading');
			say(__('Finding your position…'));
			navigator.geolocation.getCurrentPosition(function (p) {
				hereBtn.classList.remove('is-loading');
				var ll = [p.coords.latitude, p.coords.longitude], acc = Math.round(p.coords.accuracy);
				if (!me) {
					meAcc = L.circle(ll, { radius: acc, color: DOLLY.token('blue-solid', '#0369A1'), weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
					me = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 3, fillColor: DOLLY.token('blue-solid', '#0369A1'), fillOpacity: 1 }).addTo(map).bindTooltip(__('You are here'));
				} else { me.setLatLng(ll); meAcc.setLatLng(ll).setRadius(acc); }
				if (movePin) {
					place(ll[0], ll[1], { write: true, fly: true });
					say(DOLLY.sprintf(__('Workplace placed where you are (accuracy ±%d m). Drag the pin to adjust it.'), acc));
				} else {
					if (!pin) { map.setView(ll, 17); }
					say(DOLLY.sprintf(__('The blue dot is your position (accuracy ±%d m). Tap the map at the entrance of the workplace.'), acc));
				}
			}, function (e) {
				hereBtn.classList.remove('is-loading');
				say(e.code === 1 ? __('Location access denied: search for the address or tap the map.') : __('Position not available: search for the address or tap the map.'));
			}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
		}
		function find() {
			var q = search.value.trim() || addressOf();
			if (!q) { say(__('Type an address to search for (or fill in address and city).')); search.focus(); return; }
			if (!search.value.trim()) { search.value = q; }
			searchBtn.classList.add('is-loading');
			var url = (M.geocoder || 'https://nominatim.openstreetmap.org/search') + '?format=json&limit=1&q=' + encodeURIComponent(q) + '&accept-language=' + encodeURIComponent((CFG.locale || 'it').slice(0, 2));
			window.fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (list) {
				searchBtn.classList.remove('is-loading');
				if (!list || !list.length) { say(__('No results: try with street, number and city.')); return; }
				var lat = parseFloat(list[0].lat), lng = parseFloat(list[0].lon);
				place(lat, lng, { write: true });
				map.setView([lat, lng], 18);
				say(__('Found: ') + list[0].display_name + __('. Check it and drag the pin onto the entrance.'));
			}, function () { searchBtn.classList.remove('is-loading'); say(__('Search is not available right now: tap the map to place the workplace.')); });
		}

		return {
			el: el,
			init: function () {
				if (!L) { canvas.hidden = true; el.querySelector('.dolly-map__legend').hidden = true; say(__('Map not available: enter latitude and longitude.')); return; }
				map = L.map(canvas, { zoomControl: true, attributionControl: true, scrollWheelZoom: 'center' }).setView([41.9, 12.5], 5);
				map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
				L.tileLayer(M.tiles || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: M.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
				map.on('click', function (e) { place(e.latlng.lat, e.latlng.lng, { write: true }); say(__('Workplace placed. You can drag the pin to adjust it.')); });
				var had = fromFields(true);
				locate(false);
				if (!had) { say(__('Tap the map at the entrance of the workplace, search for the address or use your position.')); }
				[latField.input, lngField.input].forEach(function (i) { i.addEventListener('change', function () { fromFields(true); }); });
				radiusField.input.addEventListener('input', function () { if (area) { area.setRadius(radius()); } });
				// The dialog finishes its layout after opening.
				setTimeout(function () { map.invalidateSize(); }, 200);
			}
		};
	}

	function workplaceDialog(w, done) {
		var isNew = !w; w = w || { radius_m: CFG.defaultRadius || 100, active: true };
		var alertBox = h('div', { hidden: true });
		var num = function (v) { return v === null || v === undefined ? '' : String(v); };
		var f = {
			name: DOLLY.field({ label: __('Workplace name'), name: 'name', value: w.name, required: true }),
			address: DOLLY.field({ label: __('Address'), name: 'address', value: w.address }),
			city: DOLLY.field({ label: __('City'), name: 'city', value: w.city }),
			province: DOLLY.field({ label: __('Province'), name: 'province', value: w.province, attrs: { maxlength: 4, autocapitalize: 'characters' } }),
			lat: DOLLY.field({ label: __('Latitude'), name: 'lat', value: num(w.lat), attrs: { inputmode: 'decimal', placeholder: __('e.g. 45.0703') } }),
			lng: DOLLY.field({ label: __('Longitude'), name: 'lng', value: num(w.lng), attrs: { inputmode: 'decimal', placeholder: __('e.g. 7.6869') } }),
			radius_m: DOLLY.field({ label: __('Allowed radius (meters)'), name: 'radius_m', type: 'number', value: w.radius_m, attrs: { min: 10, max: 5000, step: 1 } }),
			late_tolerance: DOLLY.field({ label: __('Late tolerance on clock-in (minutes)'), name: 'late_tolerance', type: 'number', value: num(w.late_tolerance), optional: true, help: __('Empty = default value from Settings (') + (CFG.lateTolerance || 0) + __(' min). A clock-in within the tolerance counts as on time.'), attrs: { min: 0, max: 120, step: 1, placeholder: String(CFG.lateTolerance || 0) } }),
			account_username: DOLLY.field({ label: __('Workplace account username'), name: 'account_username', value: w.account_username, attrs: w.account_username ? { readonly: true } : { autocomplete: 'off', autocapitalize: 'none' }, help: w.account_username ? __('Cannot be changed.') : __('Create the dedicated account for the workplace display.') }),
			account_password: DOLLY.field({ label: w.account_username ? __('New workplace account password') : __('Workplace account password'), name: 'account_password', type: 'text', optional: !!w.account_username, help: __('At least 8 characters.'), attrs: { autocomplete: 'new-password' } })
		};
		var active = DOLLY.switchControl({ label: __('Active workplace'), name: 'active', checked: w.active !== false });
		var map = mapPicker(f.lat, f.lng, f.radius_m, function () {
			return [f.address.input.value, f.city.input.value, f.province.input.value].map(function (v) { return v.trim(); }).filter(Boolean).join(', ');
		});
		var form = h('form', { class: 'dolly-form', novalidate: true }, [
			alertBox,
			h('div', { class: 'dolly-form-grid' }, [f.name, f.address, f.city, f.province]),
			h('h3', {}, [DOLLY.icon('map'), __(' GPS location')]),
			map.el,
			h('div', { class: 'dolly-form-grid dolly-form-grid--3' }, [f.lat, f.lng, f.radius_m]),
			h('h3', {}, [DOLLY.icon('clock'), __(' Clock-ins')]),
			h('div', { class: 'dolly-form-grid' }, [f.late_tolerance]),
			h('h3', {}, [DOLLY.icon('monitor'), __(' Workplace display account')]),
			h('div', { class: 'dolly-form-grid' }, [f.account_username, f.account_password]),
			active
		]);
		var dlg = DOLLY.dialog({
			title: isNew ? __('New workplace') : __('Edit workplace'), body: form, wide: true,
			actions: [{ label: __('Cancel') }, { label: __('Save workplace'), variant: 'primary', icon: 'save', onClick: function (close, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var body = {
					name: f.name.input.value, address: f.address.input.value, city: f.city.input.value, province: f.province.input.value,
					lat: f.lat.input.value.trim().replace(',', '.'), lng: f.lng.input.value.trim().replace(',', '.'),
					radius_m: f.radius_m.input.value, late_tolerance: f.late_tolerance.input.value.trim(), active: active.control.isOn(),
					account_password: f.account_password.input.value
				};
				if (!w.account_username) { body.account_username = f.account_username.input.value; }
				var p = isNew ? DOLLY.api('admin/workplaces', { method: 'POST', body: body }) : DOLLY.api('admin/workplaces/' + w.id, { method: 'PUT', body: body });
				DOLLY.busy(btn, p).then(function () { close(); DOLLY.toast(__('Workplace saved.'), 'success'); done(); }, function (err) { DOLLY.formError(form, err, alertBox); });
			} }]
		});
		map.init(dlg.el);
	}

	/**
	 * Bluetooth device of a workplace: activation, configuration file for the firmware,
	 * current code for testing and key regeneration.
	 */
	function bluetoothDialog(w, done) {
		var body = h('div', { class: 'dolly-stack' }, DOLLY.loading());
		var dlg = DOLLY.dialog({ title: __('Bluetooth · ') + w.name, body: body, wide: true, onClose: done, actions: [{ label: __('Close') }] });
		var guide = h('details', {}, [
			h('summary', { text: __('Recommended device and setup') }),
			h('div', { class: 'dolly-stack', style: 'margin-top:12px' }, [
				h('p', { text: __('You need a small ESP32 board with Bluetooth and Wi-Fi, powered by a USB-C charger and mounted near the entrance:') }),
				h('ul', {}, [
					h('li', {}, [h('strong', { text: 'M5Stack AtomS3 Lite' }), __(' (recommended, about €9–12): already in a plastic case, with a status LED and button.')]),
					h('li', {}, [h('strong', { text: 'Seeed Studio XIAO ESP32-C3' }), __(' (about €5–7): cheaper, to be put in a small case.')])
				]),
				h('ol', {}, [
					h('li', { text: __('Install Arduino IDE and the Espressif "esp32" board support (Tools › Board › Boards Manager).') }),
					h('li', {}, [__('Open the firmware: the '), h('code', { text: 'firmware/dolly-ble-beacon' }), __(' folder in the plugin ('), h('a', { href: CFG.firmwareUrl, target: '_blank', rel: 'noopener', text: __('full instructions') }), ').']),
					h('li', {}, [__('Replace the file '), h('code', { text: 'config.h' }), __(' with the one below and, if the device must work on its own, enter the Wi-Fi name and password.')]),
					h('li', { text: __('Connect the board to the computer with a USB-C cable and press Upload.') }),
					h('li', { text: __('With Wi-Fi the device calculates the code on its own (time from the internet). Without Wi-Fi, open the workplace display on an Android tablet with Chrome and tap “Connect Bluetooth”: the tablet will send the code to the device.') })
				]),
				DOLLY.alert(__('Android phones read the device with Chrome, Edge or Samsung Internet. On iPhone, Safari does not support Bluetooth for websites: the free Bluefy app is needed, or also keep QR/PIN or GPS enabled.'), 'info')
			])
		]);
		function render(d) {
			if (!d.configured) {
				DOLLY.render(body, [
					h('p', { text: __('Employees can clock in by bringing their phone close to the workplace Bluetooth device: the phone reads a code that changes every 30 seconds and only reaches a few meters.') }),
					guide,
					h('div', { class: 'dolly-btn-row' }, DOLLY.button(__('Enable Bluetooth for this workplace'), { variant: 'primary', icon: 'bluetooth', onClick: function (e) { save({ enabled: true }, e.currentTarget); } }))
				]);
				return;
			}
			var enabled = DOLLY.switchControl({ label: __('Bluetooth enabled for this workplace'), checked: d.enabled, description: __('Off: device codes are not accepted.'), onChange: function (on) { save({ enabled: on }); } });
			var code = h('pre', { class: 'dolly-code', text: d.config });
			var copy = DOLLY.button(__('Copy'), { size: 'sm', icon: 'copy', onClick: function () {
				(navigator.clipboard ? navigator.clipboard.writeText(d.config) : Promise.reject()).then(function () { DOLLY.toast(__('Configuration copied.'), 'success'); }, function () { DOLLY.toast(__('Copy failed: select the text and copy it.'), 'error'); });
			} });
			var download = DOLLY.button(__('Download config.h'), { size: 'sm', icon: 'download', onClick: function () {
				var a = h('a', { href: URL.createObjectURL(new Blob([d.config], { type: 'text/plain' })), download: 'config.h' });
				document.body.appendChild(a); a.click(); a.remove();
			} });
			var regen = DOLLY.button(__('Generate a new key'), { size: 'sm', icon: 'key-round', variant: 'ghost', onClick: function () {
				DOLLY.confirm(__('Generate a new key?'), __('The current device will stop working until you upload the new configuration. Use this if the device was lost or the key was shared.'), __('Generate new key'), 'danger').then(function (ok) { if (ok) { save({ regenerate: true }); } });
			} });
			DOLLY.render(body, [
				enabled,
				h('dl', { class: 'dolly-dl' }, [
					h('dt', { text: __('Current code') }), h('dd', {}, [h('strong', { text: d.test_code ? d.test_code.slice(0, 3) + ' ' + d.test_code.slice(3) : '—' }), h('span', { class: 'dolly-help', text: __(' For a test: it must match the one on the device (Arduino IDE serial monitor).') })]),
					h('dt', { text: __('Key created') }), h('dd', { text: d.created_at ? DOLLY.fmt.dateTime(d.created_at) : '—' })
				]),
				h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('Device configuration (config.h)') }), code, h('div', { class: 'dolly-btn-row' }, [copy, download, regen]), h('span', { class: 'dolly-help', text: __('Contains the workplace\'s secret key: do not share it. Anyone who has it can generate valid codes.') })]),
				guide
			]);
		}
		function save(data, btn) {
			DOLLY.busy(btn, DOLLY.api('admin/workplaces/' + w.id + '/bluetooth', { method: 'POST', body: data })).then(function (d) { render(d); DOLLY.toast(__('Bluetooth updated.'), 'success'); }, function (err) { DOLLY.toast(err.message, 'error'); });
		}
		DOLLY.api('admin/workplaces/' + w.id + '/bluetooth').then(render, function (err) { DOLLY.render(body, DOLLY.errorState(err)); });
		return dlg;
	}

	/* ------------------------------------------------------------------ */
	/* Requests & sickness                                                  */
	/* ------------------------------------------------------------------ */

	function pageRequests() {
		var tab = window.location.hash === '#malattie' ? 'malattie' : 'richieste';
		var content = h('div');
		function renderTabs() {
			DOLLY.render(main, [
				DOLLY.tabs([{ id: 'richieste', label: __('Vacation, leave, donations, overtime and corrections'), icon: 'inbox' }, { id: 'malattie', label: __('Sickness, injuries and certificates'), icon: 'stethoscope' }], tab, function (t) { tab = t; window.location.hash = t === 'malattie' ? 'malattie' : ''; renderTabs(); }),
				content
			]);
			if (tab === 'richieste') { requestsTab(content); } else { sicknessTab(content); }
		}
		renderTabs();
	}

	function requestsTab(content) {
		var st = { page: 1, status: 'pending', type: '', workplace: '' };
		var status = DOLLY.field({ label: __('Status'), type: 'select', value: st.status, options: [{ value: '', label: __('All') }, { value: 'pending', label: __('Pending') }, { value: 'approved', label: _x('Approved', 'plural') }, { value: 'rejected', label: _x('Rejected', 'plural') }, { value: 'cancelled', label: _x('Canceled', 'plural') }, { value: 'superseded', label: __('Superseded') }] });
		var type = DOLLY.field({ label: __('Type'), type: 'select', options: [{ value: '', label: __('All') }].concat(Object.keys(TYPES).map(function (k) { return { value: k, label: TYPES[k] }; })) });
		var wp = DOLLY.field({ label: __('Workplace'), type: 'select', options: workplaceOptions(__('All workplaces')) });
		var box = h('div', {}, DOLLY.loading());
		[[status, 'status'], [type, 'type'], [wp, 'workplace']].forEach(function (x) { x[0].input.addEventListener('change', function () { st[x[1]] = x[0].input.value; st.page = 1; load(); }); });
		DOLLY.render(content, DOLLY.card(null, null, [
			h('div', { class: 'dolly-toolbar' }, [status, type, wp, h('div', { class: 'dolly-toolbar__spacer' }), DOLLY.button(__('Report injury'), { icon: 'bandage', onClick: function () { authorizationDialog(load, { type: 'infortunio' }); } }), DOLLY.button(__('New authorization'), { variant: 'primary', icon: 'calendar-plus', onClick: function () { authorizationDialog(load); } })]),
			box
		]));
		function load() {
			DOLLY.api('admin/requests', { query: { page: st.page, status: st.status, type: st.type, workplace: st.workplace } }).then(function (r) {
				DOLLY.render(box, [
					DOLLY.table([
						{ label: __('Employee'), key: 'employee' },
						{ label: __('Request'), render: function (x) { return h('div', {}, [h('strong', { text: x.type_label }), x.source === 'auto' ? [' ', DOLLY.badge(__('Detected automatically'), 'amber', 'alarm-clock-plus')] : null, h('div', { class: 'dolly-small', text: x.summary }), x.notes ? h('div', { class: 'dolly-small dolly-muted', text: __('Notes: ') + x.notes }) : null, donationCertificate(x, load)]); } },
						{ label: __('Submitted'), render: function (x) { return DOLLY.fmt.dateTime(x.created_at); } },
						{ label: __('Status'), render: function (x) { return h('div', {}, [DOLLY.requestBadge(x.status, x.status_label), x.decided_at ? h('div', { class: 'dolly-small dolly-muted', text: x.decided_by + ' · ' + DOLLY.fmt.dateTime(x.decided_at) + (x.decision_note ? ' · ' + x.decision_note : '') }) : null]); } },
						{ label: '', srLabel: __('Actions'), render: function (x) {
							if (x.status === 'pending') { return decisionButtons(x, load); }
							// Every approved request stays subject to verification: vacation, leave and donation can be revoked.
							var revocable = x.status === 'approved' && x.amend_action !== 'cancel' && ['ferie', 'permesso', 'donazione'].indexOf(x.type) !== -1;
							return revocable ? h('div', { class: 'dolly-actions' }, DOLLY.button(__('Revoke'), { size: 'sm', icon: 'undo-2', ariaLabel: __('Revoke the request of ') + x.employee, onClick: function () { revokeDialog(x, load); } })) : '';
						} }
					], r.items, { empty: [__('No requests'), __('No requests match the filters.'), 'inbox'], caption: __('Requests') }),
					DOLLY.pagination(r, function (p) { st.page = p; load(); }, 'richieste')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function employeeSelect(label, value) {
		var f = DOLLY.field({ label: label || __('Employee'), name: 'user_id', type: 'select', value: value || '', options: [{ value: '', label: __('Loading…') }] });
		allEmployees().then(function (list) {
			DOLLY.clear(f.input);
			f.input.appendChild(h('option', { value: '', text: __('Select…') }));
			list.forEach(function (e) { f.input.appendChild(h('option', { value: e.id, selected: String(e.id) === String(value) ? true : null, text: e.name + (e.active ? '' : __(' (disabled)')) })); });
		});
		return f;
	}

	/**
	 * Administrators create authorisations already approved: vacation, hourly leave, extra work
	 * (before or after the working day), or register sickness / injury on behalf of the employee.
	 */
	var AUTH_TYPES = [
		{ value: 'ferie', label: __('Vacation') },
		{ value: 'permesso', label: __('Hourly leave') },
		{ value: 'straordinario', label: __('Overtime') },
		{ value: 'donazione', label: __('Blood donation') },
		{ value: 'malattia', label: __('Sickness') },
		{ value: 'infortunio', label: __('Injury') }
	];

	function authorizationDialog(done, preset) {
		preset = preset || {};
		var alertBox = h('div', { hidden: true });
		var emp = employeeSelect(null, preset.user_id);
		var typeF = DOLLY.field({ label: __('Type'), name: 'type', type: 'select', value: preset.type || 'ferie', options: AUTH_TYPES });
		var box = h('div', { class: 'dolly-form-grid dolly-field--full' });
		var info = h('div', { class: 'dolly-field--full' });
		var f = {};
		var note = DOLLY.field({ label: __('Note for the employee'), name: 'decision_note', type: 'textarea', optional: true, full: true });

		function build() {
			var t = typeF.input.value;
			f = {};
			var nodes = [];
			if (t === 'straordinario') {
				f.start_date = DOLLY.dateField({ label: __('Date'), name: 'start_date', value: CFG.today, required: true });
				f.extra_kind = DOLLY.radios({ label: __('Day type'), name: 'extra_kind', value: 'working_day', full: true, options: [
					{ value: 'working_day', label: __('Working day'), description: __('Authorizes overtime until the clock-out time given.') },
					{ value: 'rest_day', label: __('Day off'), description: __('Authorizes clocking in with start, end and any break.') }
				], onChange: buildExtra });
				f._extraBox = h('div', { class: 'dolly-form-grid dolly-field--full' });
				nodes.push(f.start_date, f.extra_kind, f._extraBox);
			} else if (t === 'donazione') {
				f.start_date = DOLLY.dateField({ label: __('Donation day'), name: 'start_date', value: CFG.today, required: true });
				nodes.push(f.start_date);
			} else {
				if (t === 'permesso') {
					// Kind of leave and justification code recorded in the hours history.
					f.leave_kind = DOLLY.field({ label: __('Leave type'), name: 'leave_kind', type: 'select', value: 'retribuito', options: LEAVE_KINDS });
					f.hours_code = DOLLY.field({ label: __('Absence code (hours history)'), name: 'hours_code', type: 'select', options: leaveCodeOptions('retribuito') });
					f.leave_kind.input.addEventListener('change', function () {
						DOLLY.clear(f.hours_code.input);
						leaveCodeOptions(f.leave_kind.input.value).forEach(function (o) { f.hours_code.input.appendChild(h('option', { value: o.value, text: o.label })); });
					});
					nodes.push(f.leave_kind, f.hours_code);
				}
				f.start_date = DOLLY.dateField({ label: __('From'), name: 'start_date', value: CFG.today, required: true });
				f.end_date = DOLLY.dateField({ label: __('To'), name: 'end_date', value: CFG.today, required: true });
				nodes.push(f.start_date, f.end_date);
				if (t === 'permesso') {
					f.start_time = DOLLY.timeField({ label: _x('From', 'time'), name: 'start_time', required: true });
					f.end_time = DOLLY.timeField({ label: _x('To', 'time'), name: 'end_time', required: true });
					nodes.push(f.start_time, f.end_time);
				}
			}
			DOLLY.render(box, nodes);
			DOLLY.render(info, t === 'malattia' || t === 'infortunio'
				? DOLLY.alert((t === 'infortunio' ? __('Injury reported on behalf of the employee (at work or while commuting between home and work): ') : __('Sickness reported on behalf of the employee: ')) + __('it is recorded immediately and the employee receives a notification. The medical certificate follows the rules in Settings: you can upload it from the "Sickness, injuries and certificates" tab.'), 'info')
				: DOLLY.alert(__('The authorization is already approved: it appears immediately in the employee\'s calendar and attendance, and the employee receives a notification.'), 'info'));
			if (t === 'straordinario') { buildExtra(); }
		}
		function buildExtra() {
			var nodes = [];
			f.start_time = f.has_lunch = f.lunch_start = f.lunch_end = null;
			if (f.extra_kind.value() === 'rest_day') {
				f.start_time = DOLLY.timeField({ label: __('Start'), name: 'start_time', required: true });
				f.end_time = DOLLY.timeField({ label: __('End'), name: 'end_time', required: true });
				var lb = h('div', { class: 'dolly-form-grid dolly-field--full', hidden: true });
				f.lunch_start = DOLLY.timeField({ label: __('Break start'), name: 'lunch_start' });
				f.lunch_end = DOLLY.timeField({ label: __('Break end'), name: 'lunch_end' });
				DOLLY.append(lb, [f.lunch_start, f.lunch_end]);
				f.has_lunch = DOLLY.switchControl({ label: __('Lunch break'), name: 'has_lunch', onChange: function (on) { lb.hidden = !on; } });
				nodes.push(f.start_time, f.end_time, h('div', { class: 'dolly-field--full' }, f.has_lunch), lb);
			} else {
				f.end_time = DOLLY.timeField({ label: __('Clock-out authorized until'), name: 'end_time', required: true });
				nodes.push(f.end_time);
			}
			DOLLY.render(f._extraBox, nodes);
		}
		typeF.input.addEventListener('change', build);
		var form = h('form', { class: 'dolly-form', novalidate: true }, [alertBox, h('div', { class: 'dolly-form-grid' }, [emp, typeF, info, box, note])]);
		build();

		DOLLY.dialog({
			title: preset.type === 'infortunio' ? __('Report injury') : (preset.type === 'malattia' ? __('Record sickness') : __('New authorization')), body: form, wide: true,
			actions: [{ label: __('Cancel') }, { label: __('Confirm'), variant: 'primary', icon: 'check', onClick: function (close, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var t = typeF.input.value;
				var spec = {};
				['start_date', 'end_date'].forEach(function (k) { if (f[k]) { spec[k] = [f[k], 'date', true]; } });
				['start_time', 'end_time'].forEach(function (k) { if (f[k]) { spec[k] = [f[k], 'time', true]; } });
				var lunch = f.has_lunch && f.has_lunch.control.isOn();
				if (lunch) { spec.lunch_start = [f.lunch_start, 'time', true]; spec.lunch_end = [f.lunch_end, 'time', true]; }
				var rd = DOLLY.readDateTimes(spec);
				if (!emp.input.value) { rd.errors.user_id = __('Select an employee.'); }
				if (Object.keys(rd.errors).length) { DOLLY.showErrors(form, rd.errors); return; }
				var body = Object.assign({ user_id: emp.input.value, type: t, decision_note: note.input.value, notes: note.input.value || __('Authorized by the administrator.') }, rd.values);
				if (t === 'straordinario') { body.extra_kind = f.extra_kind.value(); body.has_lunch = !!lunch; body.end_date = body.start_date; }
				if (t === 'donazione') { body.end_date = body.start_date; }
				if (t === 'permesso') {
					body.leave_kind = f.leave_kind.input.value; body.hours_code = f.hours_code.input.value;
					// The note is the event of the leave: mandatory for leaves for specific events.
					if (body.leave_kind === 'evento' && !note.input.value.trim()) { DOLLY.showErrors(form, { decision_note: __('Enter the event the leave is granted for.') }); return; }
				}
				if (t === 'malattia' || t === 'infortunio') { body.notes = note.input.value; }
				var label = AUTH_TYPES.filter(function (x) { return x.value === t; })[0].label;
				DOLLY.busy(btn, DOLLY.api('admin/authorizations', { method: 'POST', body: body })).then(function () {
					close(); DOLLY.toast(label + (t === 'malattia' || t === 'infortunio' ? __(': report recorded for the employee.') : __(': authorization recorded.')), 'success'); done();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			} }]
		});
	}

	function sicknessTab(content) {
		var st = { page: 1, kind: '', certificate_status: '', workplace: '' };
		var kind = DOLLY.field({ label: __('Type'), type: 'select', options: [{ value: '', label: __('All') }, { value: 'malattia', label: __('Sickness') }, { value: 'infortunio', label: __('Injury') }] });
		var cs = DOLLY.field({ label: __('Certificate'), type: 'select', options: [{ value: '', label: __('All') }, { value: 'missing', label: __('Missing') }, { value: 'overdue', label: __('Overdue') }, { value: 'uploaded', label: __('Uploaded') }, { value: 'not_required', label: __('Not required') }, { value: 'cleared', label: __('Requirement canceled') }] });
		var wp = DOLLY.field({ label: __('Workplace'), type: 'select', options: workplaceOptions(__('All workplaces')) });
		var box = h('div', {}, DOLLY.loading());
		kind.input.addEventListener('change', function () { st.kind = kind.input.value; st.page = 1; load(); });
		cs.input.addEventListener('change', function () { st.certificate_status = cs.input.value; st.page = 1; load(); });
		wp.input.addEventListener('change', function () { st.workplace = wp.input.value; st.page = 1; load(); });
		DOLLY.render(content, DOLLY.card(null, null, [h('div', { class: 'dolly-toolbar' }, [kind, cs, wp, h('div', { class: 'dolly-toolbar__spacer' }), DOLLY.button(__('Report injury'), { icon: 'bandage', onClick: function () { authorizationDialog(load, { type: 'infortunio' }); } }), DOLLY.button(__('Record sickness'), { variant: 'primary', icon: 'stethoscope', onClick: function () { authorizationDialog(load, { type: 'malattia' }); } })]), box]));
		function load() {
			DOLLY.api('admin/sickness', { query: st }).then(function (r) {
				DOLLY.render(box, [
					DOLLY.table([
						{ label: __('Employee'), key: 'employee' },
						{ label: __('Type'), render: function (s) { return DOLLY.badge(s.kind_label || __('Sickness'), 'red', s.kind === 'infortunio' ? 'bandage' : 'stethoscope'); } },
						{ label: __('Period'), render: function (s) { return DOLLY.fmt.date(s.start_date) + ' – ' + DOLLY.fmt.date(s.end_date); } },
						{ label: __('Reported'), render: function (s) { return DOLLY.fmt.dateTime(s.reported_at); } },
						{ label: __('Certificate'), render: function (s) {
							return h('div', {}, [DOLLY.certBadge(s.certificate_status, s.certificate_label), s.certificate_due && (s.certificate_status === 'missing' || s.certificate_status === 'overdue') ? h('div', { class: 'dolly-small', text: __('Due ') + DOLLY.fmt.date(s.certificate_due) }) : null,
								s.protocol ? h('div', { class: 'dolly-small', text: __('Protocol: ') + s.protocol }) : null,
								s.certificates.map(function (c) { return h('div', { class: 'dolly-small' }, h('a', { href: DOLLY.downloadUrl('certificates/' + c.id + '/download') }, [DOLLY.icon('download'), ' ' + c.original_name])); })]);
						} },
						{ label: __('Notes'), render: function (s) { return s.notes ? h('span', { class: 'dolly-small', text: s.notes }) : '—'; } },
						{ label: __('Conflicts'), render: function (s) { return s.conflict ? h('div', {}, [DOLLY.badge(s.reviewed ? _x('Verified', 'masculine') : __('To review'), s.reviewed ? 'green' : 'amber', s.reviewed ? 'circle-check' : 'triangle-alert'), h('div', { class: 'dolly-small', style: 'white-space:pre-line', text: s.conflict_details })]) : '—'; } },
						{ label: '', srLabel: __('Actions'), render: function (s) { return sicknessActions(s, load); } }
					], r.items, { empty: [__('No sickness or injury'), '', 'stethoscope'], caption: __('Sickness and injuries') }),
					DOLLY.pagination(r, function (p) { st.page = p; load(); }, 'malattie')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function sicknessActions(s, done) {
		var file = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png', class: 'dolly-sr-only', 'aria-label': __('Certificate file for ') + s.employee });
		var up = DOLLY.button(__('Upload certificate'), { size: 'sm', icon: 'file-up', onClick: function () { file.click(); } });
		file.addEventListener('change', function () {
			var fl = file.files[0]; if (!fl) { return; }
			if (fl.size > 10485760) { DOLLY.toast(__('The file exceeds 10 MB.'), 'error'); return; }
			var fd = new FormData(); fd.append('file', fl);
			DOLLY.busy(up, DOLLY.api('admin/sickness/' + s.id + '/certificate', { method: 'POST', form: fd, timeout: 120000 })).then(function () { DOLLY.toast(__('Certificate uploaded.'), 'success'); done(); }, function (err) { DOLLY.toast(err.message, 'error'); });
		});
		var btns = [up, file];
		if (s.conflict && !s.reviewed) {
			btns.push(DOLLY.button(_x('Mark as verified', 'masculine'), { size: 'sm', icon: 'shield-check', onClick: function () {
				var note = DOLLY.field({ label: __('Review note'), name: 'note', type: 'textarea', required: true });
				var form = h('form', { class: 'dolly-form' }, [h('p', { style: 'white-space:pre-line', text: s.conflict_details }), note]);
				DOLLY.dialog({ title: __('Review conflict'), body: form, actions: [{ label: __('Cancel') }, { label: __('Confirm review'), variant: 'primary', icon: 'check', onClick: function (close, btn) {
					DOLLY.busy(btn, DOLLY.api('admin/sickness/' + s.id + '/review', { method: 'POST', body: { note: note.input.value } })).then(function () { close(); DOLLY.toast(__('Conflict reviewed.'), 'success'); done(); }, function (err) { DOLLY.formError(form, err); });
				} }] });
			} }));
		}
		return h('div', { class: 'dolly-actions' }, btns);
	}

	/* ------------------------------------------------------------------ */
	/* Attendance (by employee and by date) & corrections                 */
	/* ------------------------------------------------------------------ */

	/** Y-m-d plus/minus n days. */
	function addDays(ymd, n) {
		var d = new Date(ymd + 'T12:00:00Z');
		d.setUTCDate(d.getUTCDate() + n);
		return d.toISOString().slice(0, 10);
	}
	/** Minutes -> "h:mm" (also negative and above 24 hours). */
	function hm(min) {
		var neg = min < 0;
		min = Math.abs(Math.round(min || 0));
		return (neg ? '-' : '') + Math.floor(min / 60) + ':' + ('0' + (min % 60)).slice(-2);
	}
	function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

	/** CSV in the format of the server exports (semicolon, quoted, UTF-8 with BOM) saved by the browser. */
	function downloadCsv(filename, header, rows) {
		function cell(v) {
			v = v === null || v === undefined ? '' : String(v);
			if (v && '=+-@'.indexOf(v.charAt(0)) !== -1 && !/^-?\d/.test(v)) { v = '\'' + v; }
			return '"' + v.replace(/"/g, '""') + '"';
		}
		var text = [header].concat(rows).map(function (r) { return r.map(cell).join(';'); }).join('\r\n') + '\r\n';
		var url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
		var a = h('a', { href: url, download: filename, hidden: true });
		document.body.appendChild(a);
		a.click();
		setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
	}

	/** "Assenze" text of an attendance row (CSV). */
	function absenceText(r) {
		var p = [];
		if (r.ferie) { p.push(__('Vacation')); }
		if (r.donazione) { p.push(__('Blood donation')); }
		if (r.permesso) { p.push(__('Leave ') + r.permesso); }
		if (r.malattia) { p.push(r.sick_label || __('Sickness')); }
		if (r.certificate_status === 'missing' || r.certificate_status === 'overdue') { p.push(r.certificate); }
		r.pending.forEach(function (x) { p.push(__('Pending: ') + x); });
		return p.join(', ');
	}

	/* ------------------------------------------------------------------ */
	/* Attendance: by employee (month) and by date (all the employees)     */
	/* ------------------------------------------------------------------ */

	/** Columns shared by the two views, after the first one (date or employee). */
	function attendanceColumns(userOf, reload) {
		var today = DOLLY.fmt.today();
		return [
			{ label: __('Status'), render: function (r) { return h('div', {}, [DOLLY.dayStatusBadge(r.status), r.corrected ? h('div', {}, DOLLY.badge(__('Corrected'), 'neutral', 'pencil')) : null]); } },
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
				r.pending.forEach(function (p) { b.push(DOLLY.badge(__('Pending: ') + p, 'amber', 'hourglass')); });
				return b.length ? h('div', { class: 'dolly-btn-row' }, b) : '—';
			} },
			{ label: __('Hours'), num: true, render: DOLLY.hoursCell },
			{ label: __('Overtime'), render: DOLLY.extraCell },
			{ label: __('Absence codes'), render: function (r) { return DOLLY.hoursCodes(r.hours); } },
			{ label: __('Anomalies'), render: function (r) { return r.anomalies.length ? h('div', { class: 'dolly-btn-row' }, r.anomalies.map(function (a) { return DOLLY.badge(a, 'red', 'triangle-alert'); })) : '—'; } },
			{ label: '', srLabel: __('Actions'), render: function (r) {
				return r.date <= today ? DOLLY.button(__('Correct'), { size: 'sm', icon: 'pencil', ariaLabel: __('Correct ') + (r.employee ? r.employee + ', ' : '') + r.date_label, onClick: function () { correctionDialog(userOf(r), r.date, reload); } }) : '';
			} }
		];
	}

	function pageAttendance() {
		var mode = 'employee', preset = null;
		// Link from Analytics: admin.php?page=dolly-attendance&user_id=12&month=2026-09
		var qs = new URLSearchParams(window.location.search);
		if (qs.get('user_id') && /^\d{4}-\d{2}$/.test(qs.get('month') || '')) {
			preset = { user: qs.get('user_id'), date: qs.get('month') + '-01' };
		} else {
			try { mode = window.localStorage.getItem('dolly_att_mode') === 'date' ? 'date' : 'employee'; } catch (e) { /* storage unavailable */ }
		}
		var tabsEl = h('div', { class: 'dolly-att-modes' });
		var body = h('div');
		DOLLY.render(main, [tabsEl, body]);
		function select(m, p) {
			mode = m; preset = p || null;
			try { window.localStorage.setItem('dolly_att_mode', mode); } catch (e) { /* storage unavailable */ }
			renderTabs(); show();
		}
		function renderTabs() {
			DOLLY.render(tabsEl, DOLLY.tabs([
				{ id: 'employee', label: __('By employee'), icon: 'user' },
				{ id: 'date', label: __('By day'), icon: 'calendar-search' }
			], mode, function (m) {
				if (m === mode) { return; }
				select(m);
				var sel = tabsEl.querySelector('[aria-selected="true"]');
				if (sel) { sel.focus(); }
			}));
		}
		function show() {
			DOLLY.closePicker();
			if (mode === 'date') {
				attendanceByDate(body, function (userId, date) { select('employee', { user: userId, date: date }); window.scrollTo(0, 0); });
			} else {
				attendanceByEmployee(body, preset);
			}
		}
		renderTabs();
		show();
	}

	/** One employee, one month (the original view). */
	function attendanceByEmployee(container, preset) {
		var st = nowYM(); st.user = '';
		if (preset) { st.user = String(preset.user); st.year = +preset.date.slice(0, 4); st.month = +preset.date.slice(5, 7); }
		var emp = employeeSelect(__('Employee'), st.user);
		var box = h('div', {}, DOLLY.empty(__('Select an employee'), __('Choose the employee, month and year.'), 'calendar-days'));
		emp.input.addEventListener('change', function () { st.user = emp.input.value; load(); });
		var my = monthYearFields(st, load);
		DOLLY.render(container, DOLLY.card(null, null, [h('div', { class: 'dolly-toolbar' }, [emp].concat(my)), box]));
		function load() {
			if (!st.user) { return; }
			DOLLY.render(box, DOLLY.loading());
			DOLLY.api('admin/attendance', { query: { user_id: st.user, year: st.year, month: st.month } }).then(function (d) {
				var today = DOLLY.fmt.today();
				var foot = h('tfoot', {}, h('tr', {}, [h('td', { colspan: 7, text: __('Total ') + d.month_label + (d.provisional ? __(' (provisional)') : '') }), h('td', { class: 'num', text: d.total }), h('td', { colspan: 4, text: DOLLY.monthTotals(d) })]));
				DOLLY.render(box, [
					h('h2', { text: d.employee.name + ' · ' + d.month_label }),
					DOLLY.table([
						{ label: __('Date'), render: function (r) { return h('span', {}, [h('strong', { text: r.date_label }), h('br'), h('span', { class: 'dolly-small dolly-muted', text: r.weekday + (r.holiday ? ' · ' + r.holiday : '') + (r.closure ? ' · ' + r.closure + (r.closure_label && r.closure_label !== r.closure ? ' (' + r.closure_label.toLowerCase() + ')' : '') : '') + (r.schedule ? ' · ' + r.schedule : '') })]); } }
					].concat(attendanceColumns(function () { return st.user; }, load)), d.rows, { caption: __('Attendance ') + d.month_label, foot: foot, rowClass: function (r) { return (r.date === today ? 'is-today ' : '') + (r.status === 'riposo' ? 'is-weekend' : ''); } }),
					DOLLY.hoursSummary(d),
					h('p', { class: 'dolly-help', text: __('Hours per absence code are saved to the hours history in the database each time the month is opened or exported, and by the scheduler for changed months.') })
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		if (st.user) { load(); }
	}

	/** Groups of the "Stato" filter of the view by date. */
	var DATE_FILTERS = [
		{ value: '', label: __('All'), test: function () { return true; } },
		{ value: 'presenti', label: __('Present'), test: function (r) { return !!r.entrata; } },
		{ value: 'assenti', label: _x('Absent without justification', 'plural'), test: function (r) { return r.status === 'assente'; } },
		{ value: 'ferie', label: __('Vacation and blood donation'), test: function (r) { return r.status === 'ferie' || r.status === 'donazione'; } },
		{ value: 'permessi', label: __('With hourly leave'), test: function (r) { return !!r.permesso; } },
		{ value: 'malattia', label: __('Sickness and injury'), test: function (r) { return r.status === 'malattia' || r.status === 'infortunio'; } },
		{ value: 'riposo', label: __('Day off, holiday, closure'), test: function (r) { return ['riposo', 'festivo', 'chiusura', 'chiusura_festiva', 'nessun_turno', 'previsto'].indexOf(r.status) !== -1 && !r.entrata; } },
		{ value: 'ritardi', label: __('Late'), test: function (r) { return r.late_min > 0; } },
		{ value: 'anomalie', label: __('With anomalies'), test: function (r) { return r.anomalies.length > 0; } }
	];

	/** One date, every employee: the same columns with the employees in place of the days. */
	function attendanceByDate(container, openEmployee) {
		var today = DOLLY.fmt.today();
		var st = { date: today, workplace: '', filter: '', q: '' };
		try {
			var saved = window.sessionStorage.getItem('dolly_att_date');
			if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) && saved <= today) { st.date = saved; }
			st.workplace = window.localStorage.getItem('dolly_att_wp') || '';
		} catch (e) { /* storage unavailable */ }
		var dateF = DOLLY.dateField({ label: __('Date'), value: st.date, help: __('DD/MM/YYYY · up to today') });
		var prevBtn = DOLLY.button(__('Previous day'), { icon: 'chevron-left', iconOnly: true, onClick: function () { setDate(addDays(st.date, -1)); } });
		var nextBtn = DOLLY.button(__('Next day'), { icon: 'chevron-right', iconOnly: true, onClick: function () { setDate(addDays(st.date, 1)); } });
		var todayBtn = DOLLY.button(__('Today'), { icon: 'calendar-check', onClick: function () { setDate(today); } });
		var wpF = DOLLY.field({ label: __('Workplace'), type: 'select', value: st.workplace, options: workplaceOptions(__('All workplaces')) });
		var filterF = DOLLY.field({ label: __('Show'), type: 'select', value: '', options: DATE_FILTERS.map(function (f) { return { value: f.value, label: f.label }; }) });
		var searchF = DOLLY.field({ label: __('Search employee'), type: 'search', attrs: { placeholder: __('First or last name'), autocomplete: 'off' } });
		var csvBtn = DOLLY.button(__('Export CSV'), { icon: 'file-spreadsheet', disabled: true });
		var title = h('div', { class: 'dolly-att-date__title' });
		var summary = h('div', { class: 'dolly-att-date__summary', 'aria-live': 'polite' });
		var box = h('div', {}, DOLLY.loading());
		var data = null, seq = 0;

		dateF.input.addEventListener('change', function () {
			var v = dateF.iso();
			if (!v) { return; }
			if (v > today) { DOLLY.toast(__('You can choose a date up to today.'), 'error'); dateF.setIso(st.date); return; }
			if (v !== st.date) { st.date = v; load(); }
		});
		wpF.input.addEventListener('change', function () {
			st.workplace = wpF.input.value;
			try { window.localStorage.setItem('dolly_att_wp', st.workplace); } catch (e) { /* ignore */ }
			load();
		});
		filterF.input.addEventListener('change', function () { st.filter = filterF.input.value; renderRows(); });
		searchF.input.addEventListener('input', function () { st.q = searchF.input.value.trim().toLowerCase(); renderRows(); });
		csvBtn.addEventListener('click', exportCsv);

		DOLLY.render(container, DOLLY.card(null, null, [
			h('div', { class: 'dolly-toolbar dolly-att-date__toolbar' }, [
				h('div', { class: 'dolly-att-date__pick' }, [prevBtn, dateF, nextBtn, todayBtn]),
				wpF, filterF, searchF, h('div', { class: 'dolly-toolbar__spacer' }), csvBtn
			]),
			title, summary, box
		]));

		function setDate(v) {
			if (v > today) { return; }
			st.date = v; dateF.setIso(v); load();
		}
		function load() {
			var my = ++seq;
			nextBtn.disabled = st.date >= today;
			csvBtn.disabled = true;
			try { window.sessionStorage.setItem('dolly_att_date', st.date); } catch (e) { /* ignore */ }
			DOLLY.render(title, h('h2', { text: capitalize(DOLLY.fmt.longDate(st.date)) }));
			DOLLY.clear(summary);
			DOLLY.render(box, DOLLY.loading(__('Loading attendance for all employees…')));
			DOLLY.api('admin/attendance/date', { query: { date: st.date, workplace: st.workplace } }).then(function (d) {
				if (my !== seq) { return; }
				data = d;
				csvBtn.disabled = !d.rows.length;
				DOLLY.render(title, [h('h2', { text: capitalize(DOLLY.fmt.longDate(d.date)) }), d.holiday ? DOLLY.badge(d.holiday, 'neutral', 'party-popper') : null, d.is_today ? DOLLY.badge(__('Today: real-time data'), 'blue', 'clock') : null]);
				renderSummary();
				renderRows();
			}, function (err) { if (my === seq) { DOLLY.render(box, DOLLY.errorState(err, load)); } });
		}
		function count(fn) { return data.rows.filter(fn).length; }
		function renderSummary() {
			var chips = [
				['presenti', __('Present'), 'green', 'user-check'],
				['assenti', _x('Absent without justification', 'plural'), 'red', 'user-x'],
				['ferie', __('Vacation'), 'blue', 'sun'],
				['permessi', _x('Hourly leave', 'plural'), 'blue', 'timer'],
				['malattia', __('Sickness/injury'), 'red', 'stethoscope'],
				['riposo', __('Day off/holiday'), 'neutral', 'moon'],
				['ritardi', __('Late'), 'amber', 'clock-alert'],
				['anomalie', __('With anomalies'), 'red', 'triangle-alert']
			];
			DOLLY.render(summary, [
				h('span', { class: 'dolly-small dolly-muted', text: data.rows.length + __(' employees · hours worked ') + data.total_worked + (data.total_extra !== '0:00' ? __(' · overtime ') + data.total_extra : '') }),
				h('div', { class: 'dolly-btn-row' }, chips.map(function (c) {
					var f = DATE_FILTERS.filter(function (x) { return x.value === c[0]; })[0];
					var n = count(f.test);
					if (!n) { return null; }
					var b = h('button', { type: 'button', class: 'dolly-chip' + (st.filter === c[0] ? ' is-active' : ''), 'aria-pressed': st.filter === c[0] ? 'true' : 'false' }, [DOLLY.icon(c[3]), c[1] + ': ' + n]);
					b.addEventListener('click', function () { st.filter = st.filter === c[0] ? '' : c[0]; filterF.input.value = st.filter; renderRows(); });
					return b;
				}))
			]);
		}
		function visibleRows() {
			var f = DATE_FILTERS.filter(function (x) { return x.value === st.filter; })[0] || DATE_FILTERS[0];
			return data.rows.filter(function (r) { return f.test(r) && (!st.q || r.employee.toLowerCase().indexOf(st.q) !== -1); });
		}
		function renderRows() {
			if (!data) { return; }
			renderSummary();
			var rows = visibleRows();
			var worked = rows.reduce(function (s, r) { return s + (r.worked_min || 0); }, 0);
			var extra = rows.reduce(function (s, r) { return s + (r.extra_min || 0); }, 0);
			var foot = rows.length ? h('tfoot', {}, h('tr', {}, [
				h('td', { colspan: 7, text: __('Total ') + data.date_label + (rows.length !== data.rows.length ? ' (' + rows.length + __(' employees shown)') : '') }),
				h('td', { class: 'num', text: hm(worked) }),
				h('td', { colspan: 4, text: extra ? __('Overtime: ') + hm(extra) : '' })
			])) : null;
			DOLLY.render(box, h('div', { class: 'dolly-att-date__table' }, DOLLY.table([
				{ label: __('Employee'), render: function (r) {
					var link = h('a', { href: CFG.pages.attendance + '&user_id=' + r.user_id + '&month=' + r.date.slice(0, 7), title: __('Open the month for ') + r.employee, text: r.employee });
					link.addEventListener('click', function (e) { e.preventDefault(); openEmployee(r.user_id, r.date); });
					return h('span', {}, [
						h('strong', {}, link), r.active ? null : h('span', { class: 'dolly-att-date__off' }, DOLLY.badge(__('Disabled'), 'neutral')), h('br'),
						h('span', { class: 'dolly-small dolly-muted', text: [r.contract, r.schedule, r.workplaces].filter(Boolean).join(' · ') })
					]);
				} }
			].concat(attendanceColumns(function (r) { return r.user_id; }, load)), rows, {
				caption: __('Attendance of all employees on ') + data.date_label,
				foot: foot,
				empty: data.rows.length ? [__('No employees match the filters'), __('Change the filter or search.'), 'search'] : [__('No employees'), __('There are no employees for this date and workplace.'), 'users'],
				rowClass: function (r) { return r.status === 'riposo' || r.status === 'festivo' ? 'is-weekend' : ''; }
			})));
		}
		function exportCsv() {
			if (!data) { return; }
			var rows = visibleRows().map(function (r) {
				return [
					r.employee, r.contract, r.workplaces, DOLLY.dayStatusBadge(r.status).textContent, r.entrata, r.late_min ? r.late_min : '',
					r.inizio_pausa, r.fine_pausa, r.uscita, absenceText(r), r.worked,
					[r.extra, r.extra_over ? r.extra_over + (r.extra_over_status === 'pending' ? __(' to be approved') : __(' not approved')) : ''].filter(Boolean).join(' + '),
					(r.hours || []).map(function (c) { return c.code + ' ' + c.hm; }).join(', '),
					r.anomalies.join(', ')
				];
			});
			downloadCsv(__('Attendance_') + data.date.split('-').reverse().join('-') + '.csv',
				[__('Employee'), __('Contract'), __('Workplace'), __('Status'), __('Clock-in'), __('Late (min)'), __('Break start'), __('Break end'), __('Clock-out'), __('Absences'), __('Hours'), __('Overtime'), __('Absence codes'), __('Anomalies')], rows);
		}
		load();
	}

	function correctionDialog(userId, date, done) {
		var body = h('div', {}, DOLLY.loading());
		DOLLY.dialog({ title: __('Correction for ') + DOLLY.fmt.date(date), body: body, wide: true });
		DOLLY.api('admin/attendance/day', { query: { user_id: userId, date: date } }).then(function (d) {
			var alertBox = h('div', { hidden: true });
			var action = DOLLY.field({ label: _x('Clock-in', 'portal section'), name: 'action', type: 'select', value: d.punches.uscita ? 'entrata' : (d.punches.entrata ? 'uscita' : 'entrata'), options: Object.keys(ACTIONS).map(function (k) { return { value: k, label: ACTIONS[k] + (d.punches[k] ? __(' (current ') + d.punches[k].time + ')' : __(' (missing)')) }; }) });
			var time = DOLLY.timeField({ label: __('Corrected time'), name: 'time', help: __('HH:MM. Leave empty and use "Cancel clock-in" to remove it.') });
			var wp = DOLLY.field({ label: __('Workplace'), name: 'workplace_id', type: 'select', options: [{ value: '', label: __('Same as existing clock-in') }].concat(d.workplaces.map(function (w) { return { value: w.id, label: w.name }; })) });
			var reason = DOLLY.field({ label: __('Reason (required)'), name: 'reason', type: 'textarea', required: true });
			function fillTime() { var p = d.punches[action.input.value]; time.input.value = p ? p.time : ''; }
			action.input.addEventListener('change', fillTime); fillTime();
			var form = h('form', { class: 'dolly-form', novalidate: true }, [
				alertBox,
				DOLLY.table([{ label: _x('Clock-in', 'portal section'), render: function (k) { return ACTIONS[k]; } }, { label: __('Schedule'), render: function (k) { return d.punches[k] ? d.punches[k].time : '—'; } }, { label: __('Workplace'), render: function (k) { return d.punches[k] ? d.punches[k].workplace : '—'; } }, { label: __('Method'), render: function (k) { return d.punches[k] ? d.punches[k].method_label : '—'; } }], Object.keys(ACTIONS), { stack: false, caption: __('Current clock-ins') }),
				h('div', { class: 'dolly-form-grid' }, [action, time, wp, reason]),
				DOLLY.alert(__('Corrections keep the previous values in the change log. Future times are not allowed.'), 'info')
			]);
			function send(remove, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var t = remove ? '' : time.hm();
				if (!remove && !t) { DOLLY.showErrors(form, { time: __('Invalid time (HH:MM).') }); return; }
				if (!reason.input.value.trim()) { DOLLY.showErrors(form, { reason: __('Enter the reason.') }); return; }
				DOLLY.busy(btn, DOLLY.api('admin/attendance/correct', { method: 'POST', body: { user_id: userId, date: date, action: action.input.value, time: t, reason: reason.input.value, workplace_id: wp.input.value } })).then(function () {
					DOLLY.toast(remove ? __('Clock-in canceled.') : __('Clock-in saved.'), 'success');
					var dlgClose = body.closest('.dolly-dialog-backdrop'); if (dlgClose) { dlgClose.querySelector('.dolly-dialog__head button').click(); }
					done();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			}
			var saveBtn = DOLLY.button(__('Save correction'), { variant: 'primary', icon: 'save' });
			var rmBtn = DOLLY.button(__('Cancel clock-in'), { variant: 'danger', icon: 'trash-2' });
			saveBtn.addEventListener('click', function () { send(false, saveBtn); });
			rmBtn.addEventListener('click', function () { DOLLY.confirm(__('Cancel the clock-in?'), __('The clock-in will stay in the history as canceled.'), __('Cancel clock-in'), 'danger').then(function (ok) { if (ok) { send(true, rmBtn); } }); });
			DOLLY.render(body, [form, h('div', { class: 'dolly-btn-row dolly-btn-row--end', style: 'margin-top:16px' }, [rmBtn, saveBtn])]);
		}, function (err) { DOLLY.render(body, DOLLY.errorState(err)); });
	}

	/* ------------------------------------------------------------------ */
	/* Anomalies                                                            */
	/* ------------------------------------------------------------------ */

	function pageAnomalies() {
		var st = { page: 1, status: 'open', type: '', workplace: '' };
		var status = DOLLY.field({ label: __('Status'), type: 'select', value: 'open', options: [{ value: 'open', label: __('Unresolved') }, { value: 'resolved', label: _x('Resolved', 'plural') }, { value: '', label: _x('All', 'feminine plural') }] });
		var type = DOLLY.field({ label: __('Type'), type: 'select', options: [{ value: '', label: __('All') }, { value: 'unjustified_absence', label: __('Absent without justification') }, { value: 'missing_exit', label: __('Missing clock-out') }, { value: 'late_exit', label: __('Clock-out after scheduled time (previous versions)') }, { value: 'missing_certificate', label: __('Missing certificate') }, { value: 'sickness_conflict', label: __('Conflicting sickness/injury') }] });
		var wp = DOLLY.field({ label: __('Workplace'), type: 'select', options: workplaceOptions(__('All workplaces')) });
		var box = h('div', {}, DOLLY.loading());
		[[status, 'status'], [type, 'type'], [wp, 'workplace']].forEach(function (x) { x[0].input.addEventListener('change', function () { st[x[1]] = x[0].input.value; st.page = 1; load(); }); });
		DOLLY.render(main, DOLLY.card(null, null, [h('div', { class: 'dolly-toolbar' }, [status, type, wp]), box]));
		function load() {
			DOLLY.api('admin/anomalies', { query: st }).then(function (r) {
				DOLLY.render(box, [anomaliesTable(r.items, load), DOLLY.pagination(r, function (p) { st.page = p; load(); }, 'anomalie')]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	/* ------------------------------------------------------------------ */
	/* Broadcast                                                            */
	/* ------------------------------------------------------------------ */

	function pageBroadcast() {
		var page = 1;
		var box = h('div', {}, DOLLY.loading());
		DOLLY.render(main, DOLLY.card(null, null, [
			h('div', { class: 'dolly-toolbar' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('Messages to all employees or selected employees, immediately or on a scheduled date, by email and/or in-app notification (including push on phones).') }),
				h('div', { class: 'dolly-toolbar__spacer' }),
				DOLLY.button(__('New broadcast'), { variant: 'primary', icon: 'megaphone', onClick: function () { broadcastDialog(load); } })
			]),
			box
		]));
		function load() {
			DOLLY.api('admin/broadcasts', { query: { page: page } }).then(function (r) {
				var tones = { scheduled: ['amber', 'calendar-clock'], sending: ['blue', 'send'], sent: ['green', 'circle-check'], cancelled: ['neutral', 'ban'] };
				DOLLY.render(box, [
					DOLLY.table([
						{ label: _x('Sending', 'noun'), render: function (b) { return h('div', { class: 'dolly-small' }, [DOLLY.fmt.dateTime(b.sent_at || b.send_at), b.source === 'closure' ? h('div', { class: 'dolly-muted', text: __('From collective closure') }) : null]); } },
						{ label: __('Message'), render: function (b) { return h('div', {}, [h('strong', { text: b.title }), h('div', { class: 'dolly-small', style: 'white-space:pre-line', text: b.message.length > 220 ? b.message.slice(0, 220) + '…' : b.message })]); } },
						{ label: __('Recipients'), render: function (b) { return h('span', { class: 'dolly-small', text: b.recipients_label + (b.status === 'sent' ? __(' · delivered to ') + b.recipient_count : '') }); } },
						{ label: __('Channels'), render: function (b) { return h('div', { class: 'dolly-btn-row' }, [b.email ? DOLLY.badge(__('Email'), 'neutral', 'mail') : null, b.portal ? DOLLY.badge(__('App'), 'neutral', 'bell') : null, b.popup ? DOLLY.badge(__('Pop-up on opening'), 'blue', 'megaphone') : null]); } },
						{ label: __('Status'), render: function (b) { var t = tones[b.status] || ['neutral', 'info']; return DOLLY.badge(b.status_label, t[0], t[1]); } },
						{ label: '', srLabel: __('Actions'), render: function (b) {
							return b.status === 'scheduled' ? DOLLY.button(__('Cancel sending'), { size: 'sm', icon: 'ban', onClick: function (ev) {
								var btn = ev.currentTarget;
								DOLLY.confirm(__('Cancel the scheduled message?'), __('The message will not be sent.'), __('Cancel sending'), 'danger').then(function (ok) {
									if (ok) { DOLLY.busy(btn, DOLLY.api('admin/broadcasts/' + b.id, { method: 'DELETE' })).then(function () { DOLLY.toast(__('Sending canceled.'), 'success'); load(); }, function (err) { DOLLY.toast(err.message, 'error'); }); }
								});
							} }) : '';
						} }
					], r.items, { empty: [__('No broadcasts'), __('Create the first message with "New broadcast".'), 'megaphone'], caption: __('Broadcast') }),
					DOLLY.pagination(r, function (p) { page = p; load(); }, 'broadcast')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function broadcastDialog(done) {
		var alertBox = h('div', { hidden: true });
		var title = DOLLY.field({ label: __('Subject'), name: 'title', optional: true, full: true, help: __('Notification title and email subject.') });
		var message = DOLLY.field({ label: __('Message'), name: 'message', type: 'textarea', rows: 5, required: true, full: true });
		var who = DOLLY.radios({ label: __('Recipients'), name: 'who', value: 'all', full: true, options: [
			{ value: 'all', label: __('All active employees') },
			{ value: 'some', label: __('Selected employees') }
		], onChange: function (v) { pickBox.hidden = v !== 'some'; } });
		var chips = null;
		var pickBox = h('div', { class: 'dolly-field--full', hidden: true }, DOLLY.loading());
		allEmployees(true).then(function (list) {
			chips = DOLLY.chips({ label: __('Employees'), name: 'recipients', full: true, options: list.filter(function (e) { return e.active; }).map(function (e) { return { value: e.id, label: e.name }; }) });
			var search = DOLLY.field({ label: __('Filter the list'), type: 'search', attrs: { placeholder: __('Last or first name') } });
			search.input.addEventListener('input', function () {
				var q = search.input.value.trim().toLowerCase();
				Array.prototype.forEach.call(chips.querySelectorAll('.dolly-chip'), function (c) { c.hidden = q && c.textContent.toLowerCase().indexOf(q) === -1; });
			});
			DOLLY.render(pickBox, [search, chips]);
		}, function (err) { DOLLY.render(pickBox, DOLLY.errorState(err)); });
		var sendDate = DOLLY.dateField({ label: __('Send date'), name: 'send_date', value: CFG.today });
		var sendTime = DOLLY.timeField({ label: __('Send time'), name: 'send_time', value: '08:00' });
		var whenBox = h('div', { class: 'dolly-form-grid dolly-field--full', hidden: true }, [sendDate, sendTime]);
		var now = DOLLY.switchControl({ label: __('Send now'), name: 'send_now', checked: true, description: __('Turn off to schedule the send date and time.'), onChange: function (on) { whenBox.hidden = on; } });
		var chEmail = DOLLY.switchControl({ label: __('Email'), name: 'email', checked: true });
		var chPortal = DOLLY.switchControl({ label: __('In-app notification'), name: 'portal', checked: true, description: __('Visible in Notifications; arrives as a push notification on phones that have enabled it.') });
		var chPopup = DOLLY.switchControl({ label: __('Show immediately when the app opens'), name: 'popup', checked: false, description: __('The message appears in a pop-up as soon as the employee enters the portal (until they read it), as well as in Notifications.'), onChange: function (on) { if (on) { chPortal.control.setOn(true); } } });
		var channels = h('div', { class: 'dolly-field dolly-field--full', dataset: { name: 'channels' } }, [h('span', { class: 'dolly-label', text: __('Delivery method') }), h('div', { class: 'dolly-form-grid' }, [chEmail, chPortal, chPopup]), h('span', { class: 'dolly-error', hidden: true })]);
		var form = h('form', { class: 'dolly-form', novalidate: true }, [alertBox, h('div', { class: 'dolly-form-grid' }, [title, message, who, pickBox, h('div', { class: 'dolly-field--full' }, now), whenBox, channels])]);
		DOLLY.dialog({
			title: __('New broadcast'), body: form, wide: true,
			actions: [{ label: __('Cancel') }, { label: __('Send'), variant: 'primary', icon: 'send', onClick: function (close, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var errors = {};
				var body = { title: title.input.value, message: message.input.value, all: who.value() === 'all', email: chEmail.control.isOn(), portal: chPortal.control.isOn() || chPopup.control.isOn(), popup: chPopup.control.isOn(), send_now: now.control.isOn() };
				if (!body.message.trim()) { errors.message = __('Write the message.'); }
				if (!body.email && !body.portal) { errors.channels = __('Choose at least one channel: email and/or in-app notification.'); }
				if (!body.all) {
					body.recipients = chips ? chips.values().map(Number) : [];
					if (!body.recipients.length) { errors.recipients = __('Select at least one employee.'); }
				}
				if (!body.send_now) {
					var rd = DOLLY.readDateTimes({ send_date: [sendDate, 'date', true], send_time: [sendTime, 'time', true] });
					Object.assign(errors, rd.errors);
					body.send_date = rd.values.send_date; body.send_time = rd.values.send_time;
				}
				if (Object.keys(errors).length) { DOLLY.showErrors(form, errors); return; }
				DOLLY.busy(btn, DOLLY.api('admin/broadcasts', { method: 'POST', body: body })).then(function (b) {
					close();
					DOLLY.toast(b.status === 'sent' ? __('Message sent to ') + (b.recipient_count === 1 ? __('1 employee.') : b.recipient_count + __(' employees.')) : __('Message scheduled for ') + DOLLY.fmt.dateTime(b.send_at) + '.', 'success');
					done();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			} }]
		});
	}

	/* ------------------------------------------------------------------ */
	/* Exports                                                              */
	/* ------------------------------------------------------------------ */

	function pageExports() {
		var st = nowYM();
		var chipsBox = h('div', {}, DOLLY.loading());
		var chips = null;
		var allSw = DOLLY.switchControl({ label: __('Select all active employees'), name: 'all', checked: true, onChange: function (on) { if (chips) { chips.setAll(on); } } });
		var btn = DOLLY.button(__('Download attendance ZIP'), { variant: 'primary', icon: 'file-archive' });
		var err = h('div', { 'aria-live': 'polite' });
		btn.addEventListener('click', function () {
			var ids = chips ? chips.values() : [];
			if (!ids.length) { DOLLY.render(err, DOLLY.alert(__('Select at least one employee.'), 'error')); return; }
			DOLLY.clear(err);
			window.location.href = DOLLY.downloadUrl('admin/export/attendance', { year: st.year, month: st.month, users: ids.join(',') });
		});
		// Hours history: one line per employee with the hours of every justification code.
		var hoursBtn = DOLLY.button(__('Download hours summary (CSV)'), { icon: 'file-spreadsheet' });
		hoursBtn.addEventListener('click', function () {
			var ids = chips ? chips.values() : [];
			if (!ids.length) { DOLLY.render(err, DOLLY.alert(__('Select at least one employee.'), 'error')); return; }
			DOLLY.clear(err);
			window.location.href = DOLLY.downloadUrl('admin/export/hours', { year: st.year, month: st.month, users: ids.join(',') });
		});
		allEmployees(true).then(function (list) {
			chips = DOLLY.chips({ label: __('Employees'), name: 'users', selected: list.filter(function (e) { return e.active; }).map(function (e) { return e.id; }), options: list.map(function (e) { return { value: e.id, label: e.name + (e.active ? '' : __(' (disabled)')) }; }) });
			DOLLY.render(chipsBox, chips);
		}, function (e) { DOLLY.render(chipsBox, DOLLY.errorState(e)); });
		// Monthly attendance sheet (Excel): one file with all the employees, whatever the workplace.
		var sheetSt = nowYM();
		var sheetErr = h('div', { 'aria-live': 'polite' });
		var sheetBtn = DOLLY.button(__('Download timesheet (Excel)'), { variant: 'primary', icon: 'file-spreadsheet' });
		sheetBtn.addEventListener('click', function () {
			DOLLY.clear(sheetErr);
			var url = DOLLY.downloadUrl('admin/export/timesheet', { year: sheetSt.year, month: sheetSt.month });
			// Downloaded in the background: an error is shown here instead of a blank page.
			var p = window.fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
				if (!res.ok) {
					return res.text().then(function (t) {
						var msg = __('Export failed (error ') + res.status + ').';
						try { msg = JSON.parse(t).message || msg; } catch (e) { /* not JSON */ }
						throw new Error(msg);
					});
				}
				var cd = res.headers.get('Content-Disposition') || '';
				var m = /filename="?([^";]+)"?/.exec(cd);
				var name = m ? m[1] : __('Timesheet_') + DOLLY.MONTHS[sheetSt.month - 1] + '_' + sheetSt.year + '.xlsx';
				return res.blob().then(function (blob) {
					var a = h('a', { href: window.URL.createObjectURL(blob), download: name, style: 'display:none' });
					document.body.appendChild(a);
					a.click();
					setTimeout(function () { window.URL.revokeObjectURL(a.href); a.remove(); }, 2000);
					DOLLY.toast(__('Timesheet downloaded.'), 'success');
				});
			});
			DOLLY.busy(sheetBtn, p).then(null, function (e) { DOLLY.render(sheetErr, DOLLY.alert(e.message, 'error')); });
		});

		DOLLY.render(main, h('div', { class: 'dolly-stack' }, [
			DOLLY.card(__('Monthly timesheet (Excel)'), 'file-spreadsheet', [
				h('p', { text: __('Excel file (.xlsx) for the month with all the company\'s employees on a single sheet (the workplace is not shown), in the company timesheet format: for each employee the rows “actual working hours”, “absence codes” and “hours per absence code”, with Saturdays, Sundays and public holidays highlighted.') }),
				h('div', { class: 'dolly-toolbar' }, monthYearFields(sheetSt, function () {})),
				sheetErr,
				h('div', { class: 'dolly-btn-row', style: 'margin-top:16px' }, sheetBtn),
				h('p', { class: 'dolly-help', text: __('The contract is shown next to the name, e.g. MARIO ROSSI (Full-time - 40 hours per week). Legend: FS = Holiday · FER = Saturday · O = Regular · S = Overtime · FE vacation · P/ROL/EO/Pn/PL leave · M sickness · I injury · Av blood donation · A unpaid absence.') })
			]),
			DOLLY.card(__('Employee records (CSV)'), 'users', [
				h('p', { text: __('Username, full name, contacts, status, contract, schedule and workplaces. Does not include passwords, certificates or medical notes.') }),
				DOLLY.button(__('Download employees CSV'), { href: DOLLY.downloadUrl('admin/export/employees'), variant: 'primary', icon: 'file-spreadsheet' })
			]),
			DOLLY.card(__('Monthly attendance (ZIP)'), 'file-archive', [
				h('p', { text: __('One CSV file per employee with every day of the month (e.g. Mario_Rossi_September_2026.csv). UTF-8 CSV with semicolon separator, suitable for Excel in Italian. Certificates and medical notes are excluded.') }),
				h('div', { class: 'dolly-toolbar' }, monthYearFields(st, function () {})),
				allSw, chipsBox, err,
				h('div', { class: 'dolly-btn-row', style: 'margin-top:16px' }, [btn, hoursBtn]),
				h('p', { class: 'dolly-help', text: __('Hours summary: one row per employee with the planned hours and the hours for each absence code (O regular, FER Saturday, S overtime, FS holiday, FE vacation, P/ROL/EO/Pn/PL leave, M sickness, I injury, Av blood donation, A unpaid absence), read from the hours history.') })
			])
		]));
	}

	/* ------------------------------------------------------------------ */
	/* Settings                                                             */
	/* ------------------------------------------------------------------ */

	function pageSettings() {
		DOLLY.render(main, DOLLY.loading());
		DOLLY.api('admin/settings').then(renderSettings, function (err) { DOLLY.render(main, DOLLY.errorState(err, pageSettings)); });
	}

	/**
	 * Reminder offsets in minutes: chips with remove + "add" field.
	 * Returns {el, values()}.
	 */
	function minutesList(initial, label, unitText) {
		var list = (initial || []).map(Number).filter(function (n) { return n >= 1 && n <= 240; });
		var chipsEl = h('div', { class: 'dolly-minutes', role: 'list', 'aria-label': label });
		var input = h('input', { class: 'dolly-input', type: 'number', min: 1, max: 240, inputmode: 'numeric', placeholder: __('e.g. 5'), 'aria-label': __('Minutes to add') });
		var addBtn = DOLLY.button(__('Add'), { size: 'sm', icon: 'plus', onClick: add });
		var err = h('span', { class: 'dolly-error', hidden: true });
		function draw() {
			list.sort(function (a, b) { return a - b; });
			DOLLY.render(chipsEl, list.length ? list.map(function (m) {
				var rm = h('button', { type: 'button', 'aria-label': __('Remove ') + m + __(' minutes') }, DOLLY.icon('x'));
				rm.addEventListener('click', function () { list = list.filter(function (x) { return x !== m; }); draw(); });
				return h('span', { class: 'dolly-minutes__chip', role: 'listitem' }, [m + __(' min ') + unitText, rm]);
			}) : h('span', { class: 'dolly-small dolly-muted', text: __('No times configured: the reminder is not sent.') }));
			DOLLY.icons();
		}
		function add() {
			var v = parseInt(input.value, 10);
			err.hidden = true;
			if (!(v >= 1 && v <= 240)) { err.textContent = __('Enter a number of minutes between 1 and 240.'); err.hidden = false; return; }
			if (list.indexOf(v) === -1) {
				if (list.length >= 6) { err.textContent = __('At most 6 times per reminder.'); err.hidden = false; return; }
				list.push(v);
			}
			input.value = ''; draw();
		}
		input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } });
		draw();
		return {
			el: h('div', { class: 'dolly-field dolly-field--full' }, [h('span', { class: 'dolly-label', text: label }), chipsEl, h('div', { class: 'dolly-minutes__add', style: 'margin-top:8px' }, [input, addBtn]), err]),
			values: function () { return list.slice(); }
		};
	}

	function renderSettings(d) {
		var s = d.settings;
		var alertBox = h('div', { hidden: true });
		var langOptions = Object.keys(d.languages).map(function (k) { return { value: k, label: d.languages[k] }; });
		var language = DOLLY.field({ label: __('Default language'), name: 'language', type: 'select', value: s.language || 'auto', help: __('For the portal, the sign-in pages, emails and the panel of anyone who hasn\'t chosen a language.'),
			options: [{ value: 'auto', label: __('Same as site') + ' (' + d.site_language + ')' }].concat(langOptions) });
		var myLocale = DOLLY.field({ label: __('Your language in the dashboard'), name: 'my_locale', type: 'select', value: d.my_locale || '', help: __('Only for your account. Employees choose their language in their portal profile.'),
			options: [{ value: '', label: __('Default') }].concat(langOptions) });
		var methods = DOLLY.chips({ label: __('Methods to verify attendance'), name: 'verification_methods', full: true, selected: s.verification_methods, options: Object.keys(d.verification_methods).map(function (k) { return { value: k, label: d.verification_methods[k] }; }), help: __('The employee chooses one of the enabled methods. Bluetooth requires a device at the workplace: set it up in Workplaces › Bluetooth.') });
		var requireGps = DOLLY.switchControl({ label: __('Always also require GPS location'), name: 'verification_require_gps', checked: !!s.verification_require_gps, description: __('In addition to the workplace code (QR/PIN or Bluetooth), the phone must be within the workplace radius.') });
		var bleNote = DOLLY.alert(__('Bluetooth: works with Chrome, Edge and Samsung Internet on Android. On iPhone you need the free Bluefy app, because Safari doesn\'t support Bluetooth for websites: keep another method enabled too if some employees use iPhone.'), 'info');
		var radius = DOLLY.field({ label: __('Default GPS radius for new workplaces (meters)'), name: 'default_radius', type: 'number', value: s.default_radius, attrs: { min: 10, max: 5000 } });
		var cm = DOLLY.radios({ label: __('Medical certificate'), name: 'certificate_mode', value: s.certificate_mode, options: Object.keys(d.certificate_modes).map(function (k) { return { value: k, label: d.certificate_modes[k] + (k === 'required' ? __(' (default)') : ''), description: k === 'disabled' ? __('When turned off, pending requirements are canceled and recorded in the log.') : null }; }) });
		var cdays = DOLLY.field({ label: __('Calendar days for the certificate'), name: 'certificate_days', type: 'number', value: s.certificate_days, attrs: { min: 1, max: 365 }, help: __('Only used when the deadline is enabled.') });
		var certFile = DOLLY.switchControl({ label: __('Certificate file required'), name: 'certificate_require_file', checked: s.certificate_require_file !== false, description: __('The employee must upload the file (PDF, JPG or PNG).') });
		var certProtocol = DOLLY.switchControl({ label: __('Protocol number required'), name: 'certificate_require_protocol', checked: !!s.certificate_require_protocol, description: __('The employee must type the protocol number of the electronic certificate. With both off, either one is enough.') });
		// Smart working.
		var smartAuto = DOLLY.switchControl({ label: __('Automatic approval of remote work'), name: 'smart_auto', checked: s.smart_auto !== false, description: __('On: remote-work hours count as soon as the employee clocks out. Off: every day with remote-work hours must be approved in Requests; until then those hours do not count.') });
		// Attendance rules.
		var lunchPunch = DOLLY.switchControl({ label: __('Lunch break clock-in'), name: 'lunch_punch', checked: s.lunch_punch, description: __('On: employees clock break start and break end. Off: they don\'t clock the break, and the break in the schedule is deducted automatically.') });
		var lateTol = DOLLY.field({ label: __('Late tolerance on clock-in (minutes)'), name: 'late_tolerance', type: 'number', value: s.late_tolerance, attrs: { min: 0, max: 120 }, help: __('A clock-in within this many minutes of the shift start counts as on time (e.g. 3: shift at 08:00, clock-in at 08:03 → 08:00). Default value for all workplaces: each workplace can have its own tolerance in Workplaces › Edit.') });
		var stepBox = h('div', { class: 'dolly-form-grid', hidden: !s.exit_rounding });
		var step = DOLLY.field({ label: __('Rounding interval (minutes)'), name: 'rounding_step', type: 'number', value: s.rounding_step, attrs: { min: 1, max: 60 }, help: __('Rounds to the nearest multiple after the end of the shift.') });
		var roundExample = h('p', { class: 'dolly-help' });
		function updateExample() {
			var st = Math.max(1, Math.min(60, parseInt(step.input.value, 10) || 15));
			var half = Math.floor((st - 1) / 2);
			var end = 16 * 60 + 30;
			var t = function (m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };
			roundExample.textContent = DOLLY.sprintf(__('Example with a shift ending at 16:30: clock-out up to %s → 16:30; from %s to %s → %s.'), t(end + half), t(end + half + 1), t(end + st + half), t(end + st));
		}
		step.input.addEventListener('input', updateExample);
		updateExample();
		DOLLY.append(stepBox, [step, h('div', { class: 'dolly-field--full' }, roundExample)]);
		var rounding = DOLLY.switchControl({ label: __('Clock-out rounding'), name: 'exit_rounding', checked: s.exit_rounding, description: __('On the attendance form, clock-outs after the end of the shift are rounded; the actual clock-in record stays recorded.'), onChange: function (on) { stepBox.hidden = !on; } });
		var holidayIncrease = DOLLY.field({ label: __('Holiday work premium (%)'), name: 'holiday_increase', type: 'number', value: s.holiday_increase, attrs: { min: 0, max: 300 }, help: __('Applied to hours worked during holiday closures and national public holidays; shown on the attendance form and in the export.') });
		var overtime = DOLLY.field({ label: __('Automatically approved overtime (minutes per day)'), name: 'overtime_auto', type: 'number', value: s.overtime_auto, attrs: { min: 0, max: 1440 }, help: __('Time after the end of the shift is overtime. Up to this limit it is approved automatically (120 = 2 hours); beyond it, a request to approve is created in Requests.') });
		// Employee portal.
		var requireInstall = DOLLY.switchControl({ label: __('App installation required on phones'), name: 'require_install', checked: s.require_install !== false, description: __('On phones, before signing in, employees see the steps to add the portal to the Home screen and can sign in only from the installed app. The guided tutorial starts at the first sign-in.') });
		// On-call contracts.
		var ocBox = h('div', { class: 'dolly-form-grid', hidden: !s.oncall_auto });
		var ocThreshold = DOLLY.field({ label: __('Automatic approval threshold (minutes)'), name: 'oncall_threshold', type: 'number', value: s.oncall_threshold, attrs: { min: 1, max: 1440 }, help: __('A shift up to this length is approved automatically (120 = 2 hours); longer shifts must be approved in Requests.') });
		DOLLY.append(ocBox, ocThreshold);
		var ocAuto = DOLLY.switchControl({ label: __('Automatic approval of short shifts'), name: 'oncall_auto', checked: s.oncall_auto, description: __('Off: the administrator manually approves all hours of on-call contracts.'), onChange: function (on) { ocBox.hidden = !on; } });
		// Anomalies.
		var absDelayBox = h('div', { class: 'dolly-form-grid', hidden: !s.absence_check });
		var absDelay = DOLLY.field({ label: __('Minutes after shift start'), name: 'absence_delay', type: 'number', value: s.absence_delay, attrs: { min: 0, max: 720 }, help: __('With no clock-in after this time, the employee is marked as "Unjustified absence".') });
		DOLLY.append(absDelayBox, absDelay);
		var absCheck = DOLLY.switchControl({ label: __('Report unjustified absences'), name: 'absence_check', checked: s.absence_check, description: __('Excluding days off, public holidays, vacation, leave and sickness/injury. The employee receives a notification and can request a clock-in correction.'), onChange: function (on) { absDelayBox.hidden = !on; } });
		// Blood donation certificate (same modes as the medical one).
		var dcm = DOLLY.radios({ label: __('Blood donation certificate'), name: 'donation_certificate_mode', value: s.donation_certificate_mode, options: Object.keys(d.certificate_modes).map(function (k) { return { value: k, label: d.certificate_modes[k] + (k === 'required' ? __(' (default)') : ''), description: k === 'disabled' ? __('When turned off, pending requirements are canceled and recorded in the log.') : null }; }) });
		var dcdays = DOLLY.field({ label: __('Calendar days for the donation certificate'), name: 'donation_certificate_days', type: 'number', value: s.donation_certificate_days, attrs: { min: 1, max: 365 }, help: __('Only used when the deadline is enabled: counted from the day after the donation.') });
		// Device sessions.
		var deviceSessions = DOLLY.switchControl({ label: __('Device sessions'), name: 'device_sessions', checked: s.device_sessions !== false, description: __('Each employee signs in from a single device: the first sign-in registers it as the main device. Sign-in from another device is refused until you unlink the previous one (Employees › Device management), where you can also raise the limit for individual employees. Does not apply to administrators and workplace accounts.') });

		// Reminder mode.
		var remEntryMin = minutesList(s.reminder_entry_minutes, __('Minutes before shift start'), __('before'));
		var remExitMin = minutesList(s.reminder_exit_minutes, __('Minutes after shift end'), __('after'));
		var remEntryBox = h('div', { class: 'dolly-form-grid', hidden: !s.reminder_entry }, remEntryMin.el);
		var remExitBox = h('div', { class: 'dolly-form-grid', hidden: !s.reminder_exit }, remExitMin.el);
		var remEntry = DOLLY.switchControl({ label: __('Clock-in reminder'), name: 'reminder_entry', checked: !!s.reminder_entry, description: __('Push notification to employees who are working today and have not clocked in yet. You can configure several times (e.g. 10 and 5 minutes before).'), onChange: function (on) { remEntryBox.hidden = !on; } });
		var remExit = DOLLY.switchControl({ label: __('Clock-out reminder'), name: 'reminder_exit', checked: !!s.reminder_exit, description: __('Push notification to employees who have not clocked out yet after the end of their shift (e.g. 5 minutes after).'), onChange: function (on) { remExitBox.hidden = !on; } });

		/** One notification group (employees or administrators): master switches + per-event switches. */
		function notifyGroup(prefix, labels, saved, portalLabel, portalHelp) {
			var g = {
				portal: DOLLY.switchControl({ label: portalLabel, name: prefix + 'notify_portal', checked: s[prefix + 'notify_portal'], description: portalHelp }),
				email: DOLLY.switchControl({ label: __('Email'), name: prefix + 'notify_email', checked: s[prefix + 'notify_email'], description: __('Master switch for emails.') }),
				ev: {}
			};
			var rows = Object.keys(labels).map(function (k) {
				var cur = saved[k] || { portal: true, email: true };
				g.ev[k] = {
					portal: DOLLY.switchControl({ label: __('App: ') + labels[k], checked: cur.portal }),
					email: DOLLY.switchControl({ label: __('Email: ') + labels[k], checked: cur.email })
				};
				g.ev[k].portal.control.querySelector('.dolly-switch__label').classList.add('dolly-sr-only');
				g.ev[k].email.control.querySelector('.dolly-switch__label').classList.add('dolly-sr-only');
				return { k: k };
			});
			function sync() {
				Object.keys(g.ev).forEach(function (k) {
					g.ev[k].portal.control.classList.toggle('is-muted', !g.portal.control.isOn());
					g.ev[k].email.control.classList.toggle('is-muted', !g.email.control.isOn());
				});
			}
			[g.portal, g.email].forEach(function (sw) { sw.control.addEventListener('click', function () { setTimeout(sync, 0); }); });
			sync();
			g.table = DOLLY.table([
				{ label: __('Event'), render: function (r) { return labels[r.k]; } },
				{ label: prefix ? __('Panel') : __('App'), render: function (r) { return g.ev[r.k].portal; } },
				{ label: __('Email'), render: function (r) { return g.ev[r.k].email; } }
			], rows, { caption: prefix ? __('Notifications to administrators by event') : __('Notifications to employees by event') });
			g.values = function () {
				var out = {};
				Object.keys(g.ev).forEach(function (k) { out[k] = { portal: g.ev[k].portal.control.isOn(), email: g.ev[k].email.control.isOn() }; });
				return out;
			};
			return g;
		}
		var empN = notifyGroup('', d.employee_events || d.events, s.events, __('In-app notifications'), __('Portal bell and push notification on the phone (if enabled by the employee).'));
		var admN = notifyGroup('admin_', d.admin_events || d.events, s.admin_events || s.events, __('Dashboard notifications'), __('Bell at the top of the admin panel and push on the phone (if enabled).'));
		var recipients = DOLLY.chips({ label: __('Administrators who receive notifications'), name: 'admin_recipients', help: __('No selection = all administrators.'), selected: s.admin_recipients, options: d.admins.map(function (a) { return { value: a.id, label: a.name + ' (' + a.email + ')' }; }) });
		var pinMax = DOLLY.field({ label: __('Wrong PIN or Bluetooth attempts before lockout'), name: 'pin_max_attempts', type: 'number', value: s.pin_max_attempts, attrs: { min: 1, max: 50 } });
		var pinLock = DOLLY.field({ label: __('PIN lockout duration (minutes)'), name: 'pin_lock_minutes', type: 'number', value: s.pin_lock_minutes, attrs: { min: 1, max: 1440 } });
		var grace = DOLLY.field({ label: __('Network tolerance for QR/PIN (seconds)'), name: 'challenge_grace', type: 'number', value: s.challenge_grace, attrs: { min: 0, max: 10 }, help: __('Accepts the previous code for a few seconds after it changes (0–10).') });

		var saveBtn = DOLLY.button(__('Save settings'), { type: 'submit', variant: 'primary', icon: 'save' });
		var form = h('form', { class: 'dolly-stack', novalidate: true }, [
			alertBox,
			DOLLY.card(__('Language'), 'languages', h('div', { class: 'dolly-form-grid' }, [language, myLocale]), { level: 'h2' }),
			DOLLY.card(__('Clock-in verification'), 'shield-check', h('div', { class: 'dolly-form' }, [methods, requireGps, bleNote, radius, grace, h('div', { class: 'dolly-form-grid' }, [pinMax, pinLock])]), { level: 'h2' }),
			DOLLY.card(__('Attendance and schedules'), 'clock', h('div', { class: 'dolly-form' }, [lunchPunch, h('div', { class: 'dolly-form-grid' }, [lateTol]), rounding, stepBox, h('div', { class: 'dolly-form-grid' }, [overtime, holidayIncrease])]), { level: 'h2' }),
			DOLLY.card(__('Employee portal'), 'smartphone', h('div', { class: 'dolly-form' }, [requireInstall]), { level: 'h2' }),
			DOLLY.card(__('Device sessions'), 'shield-check', h('div', { class: 'dolly-form' }, [deviceSessions]), { level: 'h2' }),
			DOLLY.card(__('Clock-in reminders'), 'alarm-clock', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('Reminders arrive as a push notification on the phone (and in the app\'s bell) only for those scheduled to work: they are not sent on days off, public holidays or closure days, nor to anyone on vacation, sick leave, injury or blood donation, nor when an hourly leave covers the start (clock-in) or end (clock-out) of the shift.') }),
				remEntry, remEntryBox, remExit, remExitBox,
				h('p', { class: 'dolly-help', text: __('Requires the scheduler running every minute (see System status) and notifications enabled by the employee on their phone.') })
			]), { level: 'h2' }),
			DOLLY.card(__('On-call contracts'), 'phone-call', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('Employees with an on-call contract have no set days or schedule: they start and end their shift whenever they want, and each completed shift must be approved.') }),
				ocAuto, ocBox
			]), { level: 'h2' }),
			DOLLY.card(__('Remote work'), 'house', h('div', { class: 'dolly-form', dataset: { tour: 'smart-settings' } }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('Remote work is set in each employee\'s schedule (Employees › Manage): every day, single days, or mixed days with an on-site slot and a remote slot. When working remotely the employee clocks in without presence verification.') }),
				smartAuto
			]), { level: 'h2' }),
			DOLLY.card(__('Sickness, injury and certificates'), 'stethoscope', h('div', { class: 'dolly-form' }, [cm, cdays, certFile, certProtocol]), { level: 'h2' }),
			DOLLY.card(__('Blood donation'), 'droplet', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('Blood donation is requested from Requests. After approval, from the day after the donation the employee finds “Upload certificate” in the request (with a notification and a "Missing certificate" anomaly), as for the medical certificate.') }),
				dcm, dcdays
			]), { level: 'h2' }),
			DOLLY.card(__('Anomalies'), 'triangle-alert', h('div', { class: 'dolly-form' }, [
				absCheck, absDelayBox,
				h('p', { class: 'dolly-help', text: __('Missing clock-out: if the employee doesn\'t clock out by 23:59 that day, an anomaly is reported.') })
			]), { level: 'h2' }),
			DOLLY.card(__('Notifications to employees'), 'users', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('What all employees receive. The general switches turn off the channel for all events.') }),
				h('div', { class: 'dolly-form-grid' }, [empN.portal, empN.email]),
				empN.table,
				h('p', { class: 'dolly-help', text: __('Messages in the Communications menu have their own settings. Turning off notifications does not hide request statuses or anomalies.') })
			]), { level: 'h2' }),
			DOLLY.card(__('Notifications to administrators'), 'shield', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('What the administrators selected below receive.') }),
				h('div', { class: 'dolly-form-grid' }, [admN.portal, admN.email]),
				admN.table,
				recipients
			]), { level: 'h2' }),
			h('div', { class: 'dolly-btn-row dolly-settings__save' }, saveBtn)
		]);
		form.addEventListener('submit', function (ev) {
			ev.preventDefault(); DOLLY.clearErrors(form); alertBox.hidden = true;
			var body = {
				language: language.input.value,
				verification_methods: methods.values(), verification_require_gps: requireGps.control.isOn(), default_radius: radius.input.value, certificate_mode: cm.value(), certificate_days: cdays.input.value,
				lunch_punch: lunchPunch.control.isOn(), late_tolerance: lateTol.input.value, exit_rounding: rounding.control.isOn(), rounding_step: step.input.value,
				overtime_auto: overtime.input.value, absence_check: absCheck.control.isOn(), absence_delay: absDelay.input.value,
				oncall_auto: ocAuto.control.isOn(), oncall_threshold: ocThreshold.input.value, holiday_increase: holidayIncrease.input.value, require_install: requireInstall.control.isOn(),
				notify_portal: empN.portal.control.isOn(), notify_email: empN.email.control.isOn(), events: empN.values(),
				admin_notify_portal: admN.portal.control.isOn(), admin_notify_email: admN.email.control.isOn(), admin_events: admN.values(),
				reminder_entry: remEntry.control.isOn(), reminder_entry_minutes: remEntryMin.values(), reminder_exit: remExit.control.isOn(), reminder_exit_minutes: remExitMin.values(),
				donation_certificate_mode: dcm.value(), donation_certificate_days: dcdays.input.value, device_sessions: deviceSessions.control.isOn(),
				smart_auto: smartAuto.control.isOn(), certificate_require_file: certFile.control.isOn(), certificate_require_protocol: certProtocol.control.isOn(),
				admin_recipients: recipients.values().map(Number), pin_max_attempts: pinMax.input.value, pin_lock_minutes: pinLock.input.value, challenge_grace: grace.input.value
			};
			var go = function () {
				DOLLY.busy(saveBtn, DOLLY.api('admin/settings', { method: 'POST', body: body })).then(function (nd) {
					var reload = language.input.value !== (s.language || 'auto') || myLocale.input.value !== (d.my_locale || '');
					var mine = myLocale.input.value !== (d.my_locale || '') ? DOLLY.api('me/language', { method: 'POST', body: { locale: myLocale.input.value } }) : Promise.resolve();
					mine.then(function () {
						if (reload) { window.location.reload(); return; }
						DOLLY.toast(__('Settings saved.'), 'success'); renderSettings(nd);
					}, function (err) { DOLLY.toast(err.message, 'error'); });
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			};
			if (body.certificate_mode === 'disabled' && s.certificate_mode !== 'disabled') {
				DOLLY.confirm(__('Turn off certificates?'), __('All pending certificate requirements will be canceled and recorded in the change log.'), __('Turn off and save'), 'danger').then(function (ok) { if (ok) { go(); } });
			} else { go(); }
		});

		// System status.
		var c = d.cron;
		var runBtn = DOLLY.button(__('Run checks now'), { icon: 'play', onClick: function () {
			DOLLY.busy(runBtn, DOLLY.api('admin/cron/run', { method: 'POST' })).then(function () { DOLLY.toast(__('Checks run.'), 'success'); pageSettings(); }, function (err) { DOLLY.toast(err.message, 'error'); });
		} });
		var testMailResult = h('div', { style: 'margin-top:8px', 'aria-live': 'polite' });
		var testMail = DOLLY.button(__('Send test email'), { icon: 'mail', onClick: function () {
			DOLLY.busy(testMail, DOLLY.api('admin/test-email', { method: 'POST' })).then(function (r) {
				DOLLY.render(testMailResult, DOLLY.alert(r.message, r.ok ? 'success' : 'error'));
			}, function (err) { DOLLY.render(testMailResult, DOLLY.alert(err.message, 'error')); });
		} });
		var check = function (ok, label, bad) { return h('li', {}, [ok ? DOLLY.badge('OK', 'green', 'circle-check') : DOLLY.badge(__('To review'), 'red', 'circle-alert'), ' ', label, !ok && bad ? h('div', { class: 'dolly-help', text: bad }) : null]); };
		var status = DOLLY.card(__('System status'), 'activity', [
			h('ul', { class: 'dolly-stack', style: 'list-style:none;padding:0;margin:0 0 16px' }, [
				check(c.healthy, __('Scheduler every minute') + (c.last_run ? __(' · last run ') + DOLLY.fmt.dateTime(c.last_run) + ' (' + c.last_source + ')' : __(' · never run')), __('Set up the system cron: production must not depend on site visits.')),
				check(c.wp_cron_disabled, __('Visit-based WP-Cron disabled (DISABLE_WP_CRON)'), __('Add define( \'DISABLE_WP_CRON\', true ); to wp-config.php after setting up the system cron.')),
				check(d.storage.https, __('HTTPS active'), __('GPS and camera only work over HTTPS.')),
				check(d.storage.outside_webroot, __('Certificates stored outside the public folder'), __('The folder is inside uploads with blocking rules: check that the server does not serve it, or define DOLLY_PRIVATE_DIR.')),
				check(d.storage.zip, __('PHP ZIP extension available'), __('The PclZip library included in WordPress will be used.')),
				d.push ? check(d.push.available, __('Push notifications on phones') + (d.push.available ? ' · ' + d.push.devices + __(' devices for ') + d.push.employees + __(' employees') : ''), d.push.available ? null : __('The server\'s OpenSSL does not support EC keys (P-256): push notifications are not available, but in-app notifications still work.')) : null,
				d.push && d.push.available ? h('li', { class: 'dolly-help', text: (d.push.encrypted ? __('Encrypted push messages (content visible right away on the phone).') : __('PHP without ECDH: empty pushes, the phone downloads the content from the site.')) + (d.push.last_success ? __(' Last successful send: ') + DOLLY.fmt.dateTime(d.push.last_success) + '.' : __(' No successful sends so far.')) }) : null,
				d.push && d.push.last_error ? h('li', { class: 'dolly-help', text: __('Last push error: ') + d.push.last_error }) : null,
				check(!c.email_queue.failed, __('Email: ') + c.email_queue.sent + __(' sent, ') + c.email_queue.pending + __(' queued, ') + c.email_queue.failed + __(' failed'), c.email_queue.last_error ? __('Last error: ') + c.email_queue.last_error : __('Check the SMTP configuration.'))
			]),
			h('p', { class: 'dolly-label', text: __('System cron command (one of the two options, every minute):') }),
			h('pre', { class: 'dolly-code', text: '* * * * * ' + c.wp_cli + ' >/dev/null 2>&1\n* * * * * curl -fsS "' + c.cron_url + '" >/dev/null 2>&1' }),
			h('p', { class: 'dolly-help', text: __('The address contains a secret key: do not share it.') }),
			h('p', { class: 'dolly-help', text: __('Push and email notifications go out immediately, at the end of the operation that creates them; every minute the scheduler sends scheduled ones and retries failed ones.') }),
			h('div', { class: 'dolly-btn-row' }, [runBtn, testMail]),
			testMailResult
		]);

		var auditBox = h('div', {}, DOLLY.loading());
		var auditPage = 1;
		function loadAudit() {
			DOLLY.api('admin/audit', { query: { page: auditPage } }).then(function (r) {
				DOLLY.render(auditBox, [auditList(r.items), DOLLY.pagination(r, function (p) { auditPage = p; loadAudit(); }, 'registro')]);
			}, function (err) { DOLLY.render(auditBox, DOLLY.errorState(err, loadAudit)); });
		}
		var ob = CFG.onboarding || {};
		var tourBtn = DOLLY.button(__('Replay the tutorial'), { icon: 'circle-play', onClick: function () {
			DOLLY.busy(tourBtn, DOLLY.api('admin/tour', { method: 'POST', body: { state: '' } })).then(function (c) { CFG.onboarding = c; tourStart(0); }, function (err) { DOLLY.toast(err.message, 'error'); });
		} });
		var setup = DOLLY.card(__('Guided setup'), 'graduation-cap', [
			h('p', { class: 'dolly-muted', style: 'margin-top:0', text: ob.done
				? __('Go through the settings category by category, with an explanation of every option, then workplace, employees and tutorial. Your current choices stay until you change them.')
				: __('The guided setup is not complete yet: resume it where you left off.') }),
			h('div', { class: 'dolly-btn-row' }, [
				DOLLY.button(ob.done ? __('Restart the guided setup') : __('Resume the setup'), { variant: 'primary', icon: 'rotate-ccw', href: ob.url }),
				tourBtn
			])
		], { level: 'h2' });
		setup.setAttribute('data-tour', 'setup');
		DOLLY.render(main, h('div', { class: 'dolly-stack' }, [setup, form, status, DOLLY.card(__('Change log'), 'history', auditBox)]));
		loadAudit();
	}

	/* ------------------------------------------------------------------ */
	/* Analytics                                                            */
	/* ------------------------------------------------------------------ */


	var AN_PRESETS = [
		{ id: '7', label: __('Last 7 days') },
		{ id: '30', label: __('Last 30 days') },
		{ id: 'month', label: __('This month') },
		{ id: 'prev', label: __('Last month') },
		{ id: '90', label: __('Last 3 months') },
		{ id: 'year', label: __('This year') },
		{ id: '365', label: __('Last 12 months') }
	];

	function presetRange(id, today) {
		var first = today.slice(0, 8) + '01';
		switch (id) {
			case '7': return [addDays(today, -6), today];
			case 'month': return [first, today];
			case 'prev': var last = addDays(first, -1); return [last.slice(0, 8) + '01', last];
			case '90': return [addDays(today, -89), today];
			case 'year': return [today.slice(0, 4) + '-01-01', today];
			case '365': return [addDays(today, -364), today];
			default: return [addDays(today, -29), today];
		}
	}

	function pct(v) { return v === null || v === undefined ? '—' : String(v).replace('.', ',') + '%'; }
	function hours(min) { return Math.round((min || 0) / 6) / 10; }

	/** KPI tile (same look as the dashboard). */
	function kpiTile(label, value, icon, sub, tone) {
		return h('section', { class: 'dolly-card dolly-kpi', 'aria-label': label }, [
			h('div', { class: 'dolly-kpi__top' }, [h('span', { text: label }), h('span', { class: 'dolly-kpi__icon' + (tone ? ' dolly-kpi__icon--' + tone : '') }, DOLLY.icon(icon))]),
			h('div', { class: 'dolly-kpi__value', text: String(value) }),
			sub ? h('div', { class: 'dolly-kpi__sub' }, sub) : null
		]);
	}

	function pageAnalytics() {
		var today = DOLLY.fmt.today();
		var st = { preset: '30', from: '', to: '', workplace: '', user: '', sort: 'name' };
		try { Object.assign(st, JSON.parse(window.localStorage.getItem('dolly_analytics') || '{}')); } catch (e) { /* storage unavailable */ }
		if (st.preset !== 'custom' || !st.from || !st.to || st.to > today) {
			if (st.preset === 'custom') { st.preset = '30'; }
			var r0 = presetRange(st.preset, today); st.from = r0[0]; st.to = r0[1];
		}
		var charts = {}, data = null, seq = 0;

		var fromF = DOLLY.dateField({ label: __('From'), value: st.from });
		var toF = DOLLY.dateField({ label: __('To'), value: st.to, help: __('DD/MM/YYYY · up to today') });
		var wpF = DOLLY.field({ label: __('Workplace'), type: 'select', value: st.workplace, options: workplaceOptions(__('All workplaces')) });
		var empF = DOLLY.field({ label: __('Employee'), type: 'select', value: st.user, options: [{ value: '', label: __('All employees') }] });
		allEmployees().then(function (list) {
			list.forEach(function (e) { empF.input.appendChild(h('option', { value: e.id, selected: String(e.id) === String(st.user) ? true : null, text: e.name + (e.active ? '' : __(' (disabled)')) })); });
		});
		var applyBtn = DOLLY.button(__('Show'), { variant: 'primary', icon: 'chart-line' });
		var presetBox = h('div', { class: 'dolly-btn-row dolly-an__presets', role: 'group', 'aria-label': __('Quick periods') });
		var errBox = h('div');
		var meta = h('p', { class: 'dolly-small dolly-muted dolly-an__meta', 'aria-live': 'polite' });
		var notice = h('div');
		var kpis = h('div', { class: 'dolly-grid dolly-grid--4 dolly-an__kpis' });
		var body = h('div', { class: 'dolly-an__body' });
		var csvBtn = DOLLY.button(__('Export CSV'), { icon: 'file-spreadsheet', disabled: true, onClick: exportCsv });
		var printBtn = DOLLY.button(__('Print'), { icon: 'printer', disabled: true, onClick: function () { window.print(); } });
		var freshBtn = DOLLY.button(__('Recalculate'), { icon: 'refresh-cw', disabled: true, onClick: function () { load(true); } });
		freshBtn.title = __('Recalculate the data without using what\'s already saved');

		function renderPresets() {
			DOLLY.render(presetBox, AN_PRESETS.map(function (p) {
				var b = h('button', { type: 'button', class: 'dolly-chip' + (st.preset === p.id ? ' is-active' : ''), 'aria-pressed': st.preset === p.id ? 'true' : 'false', text: p.label });
				b.addEventListener('click', function () {
					var r = presetRange(p.id, today);
					st.preset = p.id; st.from = r[0]; st.to = r[1];
					fromF.setIso(st.from); toF.setIso(st.to);
					renderPresets(); load();
				});
				return b;
			}));
		}
		applyBtn.addEventListener('click', function () {
			var f = fromF.iso(), t = toF.iso();
			DOLLY.render(errBox, null);
			var msg = !f || !t ? __('Enter the dates in DD/MM/YYYY format.') : (t > today ? __('The end date cannot be after today.') : (f > t ? __('The start date must be before the end date.') : ''));
			if (!msg && (new Date(t) - new Date(f)) / 86400000 + 1 > 366) { msg = __('The period can last at most 366 days.'); }
			if (msg) { DOLLY.render(errBox, DOLLY.alert(msg, 'error')); return; }
			st.from = f; st.to = t; st.preset = 'custom';
			renderPresets(); load();
		});
		wpF.input.addEventListener('change', function () { st.workplace = wpF.input.value; load(); });
		empF.input.addEventListener('change', function () { st.user = empF.input.value; load(); });

		DOLLY.render(main, [
			DOLLY.card(null, null, [
				h('div', { class: 'dolly-toolbar dolly-an__filters' }, [fromF, toF, applyBtn, wpF, empF, h('div', { class: 'dolly-toolbar__spacer' }), h('div', { class: 'dolly-btn-row dolly-an__actions' }, [freshBtn, csvBtn, printBtn])]),
				presetBox, errBox, meta
			]),
			notice, kpis, body
		]);
		renderPresets();

		function save() {
			try { window.localStorage.setItem('dolly_analytics', JSON.stringify({ preset: st.preset, from: st.from, to: st.to, workplace: st.workplace, user: st.user, sort: st.sort })); } catch (e) { /* ignore */ }
		}

		function load(fresh) {
			var my = ++seq;
			save();
			[csvBtn, printBtn, freshBtn].forEach(function (b) { b.disabled = true; });
			meta.textContent = __('Calculating from ') + DOLLY.fmt.date(st.from) + __(' to ') + DOLLY.fmt.date(st.to) + '…';
			DOLLY.render(notice, null);
			DOLLY.render(kpis, null);
			destroyCharts();
			DOLLY.render(body, DOLLY.loading(__('Calculating statistics. For long periods this may take a few seconds.')));
			DOLLY.api('admin/analytics', { query: { from: st.from, to: st.to, workplace: st.workplace, user_id: st.user, fresh: fresh ? 1 : '' } }).then(function (d) {
				if (my !== seq) { return; }
				data = d;
				[csvBtn, printBtn, freshBtn].forEach(function (b) { b.disabled = false; });
				render();
			}, function (err) {
				if (my !== seq) { return; }
				freshBtn.disabled = false;
				meta.textContent = '';
				DOLLY.render(body, DOLLY.errorState(err, function () { load(fresh); }));
			});
		}

		function destroyCharts() {
			Object.keys(charts).forEach(function (k) { charts[k].destroy(); });
			charts = {};
		}

		function render() {
			var d = data, k = d.kpi;
			var unit = { day: __('per day'), week: __('per week'), month: __('per month') }[d.unit];
			meta.textContent = __('From ') + d.from_label + __(' to ') + d.to_label + ' · ' + d.days + __(' days · ') + d.employees_count + (d.employees_count === 1 ? __(' employee') : __(' employees')) + __(' · calculated on ') + d.generated;
			DOLLY.render(notice, k.provisional_days ? DOLLY.alert(k.provisional_days + (k.provisional_days === 1 ? __(' day is provisional') : __(' days are provisional')) + __(' (missing clock-out, open anomaly or shift to be approved): totals may still change.'), 'info') : null);
			DOLLY.render(kpis, [
				kpiTile(__('Hours worked'), hm(k.worked_min), 'clock', __('out of ') + hm(k.planned_min) + __(' planned (') + pct(k.worked_pct) + ')', 'green'),
				kpiTile(_x('Overtime', 'plural'), hm(k.extra_min), 'trending-up', k.extra_pending_min ? DOLLY.badge(hm(k.extra_pending_min) + __(' to be approved'), 'amber', 'hourglass') : __('Nothing to approve')),
				kpiTile(__('Attendance rate'), pct(k.presence_pct), 'user-check', k.present_days + __(' days worked · ') + k.expected_days + __(' expected working days'), 'green'),
				kpiTile(__('Absenteeism rate'), pct(k.absenteeism_pct), 'user-x', __('Sickness, injury and unjustified absences: ') + hm(k.absence_min) + __(' of planned hours'), 'red'),
				kpiTile(__('Punctuality'), pct(k.punctuality_pct), 'alarm-clock', k.late ? k.late + __(' late arrivals out of ') + k.entries + __(' clock-ins · on average ') + k.late_avg + __(' min') : __('No late arrivals out of ') + k.entries + __(' clock-ins'), 'amber'),
				kpiTile(__('Vacation and leave'), k.leave_days + __(' d'), 'sun', __('Hourly leave: ') + hm(k.leave_min)),
				kpiTile(__('Sickness and injury'), k.sick_days + __(' d'), 'stethoscope', __('Unjustified absences: ') + k.absent_days + __(' d'), 'red'),
				kpiTile(__('Anomalies'), k.anomalies, 'triangle-alert', k.anomalies_open ? DOLLY.badge(k.anomalies_open + __(' still open'), 'red', 'triangle-alert') : __('All resolved'), 'red')
			]);

			var empty = !d.employees_count;
			if (empty) {
				DOLLY.render(body, DOLLY.empty(__('No employees'), __('There are no employees for the selected period and workplace.'), 'users'));
				return;
			}
			var top = d.employees.filter(function (e) { return e.extra_min || e.extra_pending_min; })
				.sort(function (a, b) { return (b.extra_min + b.extra_pending_min) - (a.extra_min + a.extra_pending_min); }).slice(0, 10);
			var abs = d.absences.filter(function (a) { return a.min > 0; });
			var reqText = k.requests ? k.requests + __(' requests') + (k.requests_pending ? ', ' + k.requests_pending + __(' pending') : '') + (k.response_hours !== null ? __(' · average response in ') + String(k.response_hours).replace('.', ',') + __(' hours') : '') : '';

			var cards = {
				hours: chartCard(__('Hours worked ') + unit, 'clock', __('Regular and overtime hours compared with the hours planned by the schedule.')),
				presence: chartCard(__('Attendance and absences ') + unit, 'users', __('Person-days: who clocked in, who was on vacation, on sick leave or absent without justification.')),
				absences: chartCard(__('Absence breakdown'), 'chart-bar', __('Absence hours by reason.'), !abs.length && __('No absences in this period.')),
				weekday: chartCard(__('Late arrivals by weekday'), 'calendar-days', __('Number of clock-ins beyond the tolerance.'), !k.late && __('No late arrivals in this period.')),
				lateDist: chartCard(__('Extent of late arrivals'), 'alarm-clock', __('How many late clock-ins, by minutes late.'), !k.late && __('No late arrivals in this period.')),
				overtime: chartCard(__('Overtime by employee'), 'trending-up', d.employees_count > 10 ? __('The 10 employees with the most overtime.') : __('Approved overtime and overtime awaiting approval.'), !top.length && __('No overtime in this period.')),
				anomalies: chartCard(__('Anomalies by type'), 'triangle-alert', __('Anomalies on days in the period, open and resolved.'), !d.anomalies.length && __('No anomalies in this period.')),
				requests: chartCard(__('Requests by type'), 'inbox', reqText || __('Requests covering the period.'), !d.requests.length && __('No requests in this period.'))
			};
			var tableBox = h('div');
			var sortF = DOLLY.field({ label: __('Sort by'), type: 'select', value: st.sort, options: [
				{ value: 'name', label: __('Name') }, { value: 'worked', label: __('Hours worked') }, { value: 'balance', label: __('Difference from expected') },
				{ value: 'extra', label: __('Overtime') }, { value: 'presence', label: __('Attendance (lowest first)') }, { value: 'late', label: __('Late arrivals') },
				{ value: 'absent', label: __('Unjustified absences') }, { value: 'sick', label: __('Sickness and injury') }, { value: 'anomalies', label: __('Anomalies') }
			] });
			sortF.input.addEventListener('change', function () { st.sort = sortF.input.value; save(); renderTable(); });

			DOLLY.render(body, [
				h('div', { class: 'dolly-an__wide' }, [cards.hours.el, cards.presence.el]),
				h('div', { class: 'dolly-grid dolly-grid--2 dolly-an__grid' }, [cards.absences.el, cards.weekday.el, cards.lateDist.el, cards.overtime.el, cards.anomalies.el, cards.requests.el]),
				DOLLY.card(__('Summary by employee'), 'users', [h('div', { class: 'dolly-toolbar' }, [sortF]), tableBox])
			]);
			renderTable();

			var s = d.series;
			lineBar(cards.hours, s.labels, [
				{ label: __('Regular hours'), data: s.ordinary.map(hours), backgroundColor: C.primary, stack: 'h' },
				{ label: __('Overtime'), data: s.extra.map(hours), backgroundColor: C.amber, stack: 'h' },
				{ type: 'line', label: __('Planned hours'), data: s.planned.map(function (v) { return v ? hours(v) : null; }), borderColor: C.grey, backgroundColor: C.grey, borderDash: [6, 4], borderWidth: 2, pointRadius: s.labels.length > 40 ? 0 : 3, tension: 0 }
			], { stacked: true, axis: __('Hours'), fmt: function (v) { return hm(v * 60); } });
			lineBar(cards.presence, s.labels, [
				{ label: __('Present'), data: s.present, backgroundColor: C.green },
				{ label: __('Vacation and donation'), data: s.leave, backgroundColor: C.blue },
				{ label: __('Sickness and injury'), data: s.sick, backgroundColor: C.amber },
				{ label: _x('Absent without justification', 'plural'), data: s.absent, backgroundColor: C.red }
			], { stacked: true, axis: __('Person-days'), integer: true });
			if (abs.length) {
				lineBar(cards.absences, abs.map(function (a) { return a.label; }), [{ label: __('Absence hours'), data: abs.map(function (a) { return hours(a.min); }), backgroundColor: C.primary }], { horizontal: true, axis: __('Hours'), fmt: function (v) { return hm(v * 60); }, legend: false });
			}
			if (k.late) {
				lineBar(cards.weekday, d.weekday.map(function (w) { return w.short; }), [{ label: __('Late arrivals'), data: d.weekday.map(function (w) { return w.late; }), backgroundColor: C.primary }], {
					integer: true, legend: false, axis: __('Late arrivals'),
					extra: function (i) { var w = d.weekday[i]; return w.entries ? pct(w.late_pct) + __(' of clock-ins · average ') + w.late_avg + __(' min') : ''; }
				});
				lineBar(cards.lateDist, d.late_dist.labels, [{ label: __('Late clock-ins'), data: d.late_dist.values, backgroundColor: C.primary }], { integer: true, legend: false, axis: __('Clock-ins') });
			}
			if (top.length) {
				lineBar(cards.overtime, top.map(function (e) { return e.name; }), [
					{ label: _x('Approved', 'masculine'), data: top.map(function (e) { return hours(e.extra_min); }), backgroundColor: C.primary },
					{ label: __('To approve'), data: top.map(function (e) { return hours(e.extra_pending_min); }), backgroundColor: C.amber }
				], { horizontal: true, stacked: true, axis: __('Hours'), fmt: function (v) { return hm(v * 60); } });
			}
			if (d.anomalies.length) {
				lineBar(cards.anomalies, d.anomalies.map(function (a) { return a.label; }), [
					{ label: _x('Open', 'feminine plural'), data: d.anomalies.map(function (a) { return a.open; }), backgroundColor: C.red },
					{ label: _x('Resolved', 'plural'), data: d.anomalies.map(function (a) { return a.resolved; }), backgroundColor: C.green }
				], { horizontal: true, stacked: true, integer: true, axis: __('Anomalies') });
			}
			if (d.requests.length) {
				lineBar(cards.requests, d.requests.map(function (r) { return r.label; }), [
					{ label: _x('Approved', 'plural'), data: d.requests.map(function (r) { return r.approved; }), backgroundColor: C.green },
					{ label: __('Pending'), data: d.requests.map(function (r) { return r.pending; }), backgroundColor: C.amber },
					{ label: _x('Rejected', 'plural'), data: d.requests.map(function (r) { return r.rejected; }), backgroundColor: C.red },
					{ label: _x('Canceled', 'plural'), data: d.requests.map(function (r) { return r.cancelled; }), backgroundColor: C.grey }
				], { horizontal: true, stacked: true, integer: true, axis: __('Requests') });
			}

			function renderTable() {
				var rows = d.employees.slice();
				var by = {
					worked: function (e) { return -e.worked_min; }, balance: function (e) { return e.balance_min; }, extra: function (e) { return -(e.extra_min + e.extra_pending_min); },
					presence: function (e) { return e.presence_pct === null ? 1000 : e.presence_pct; }, late: function (e) { return -e.late; }, absent: function (e) { return -e.absent_days; },
					sick: function (e) { return -e.sick_days; }, anomalies: function (e) { return -e.anomalies; }
				}[st.sort];
				if (by) { rows.sort(function (a, b) { return by(a) - by(b) || a.sort.localeCompare(b.sort); }); }
				var ym = d.to.slice(0, 7);
				var tot = function (key) { return d.employees.reduce(function (s, e) { return s + (e[key] || 0); }, 0); };
				var foot = h('tfoot', {}, h('tr', {}, [
					h('td', { text: __('Total') }), h('td', { class: 'num', text: String(tot('present_days')) }), h('td', { class: 'num', text: hm(tot('worked_min')) }),
					h('td', { class: 'num', text: hm(tot('planned_min')) }), h('td', { class: 'num', text: hm(tot('balance_min')) }), h('td', { class: 'num', text: hm(tot('extra_min')) }),
					h('td', { class: 'num', text: pct(k.presence_pct) }), h('td', { class: 'num', text: String(tot('late')) }), h('td', { class: 'num', text: String(tot('absent_days')) }),
					h('td', { class: 'num', text: String(tot('leave_days')) }), h('td', { class: 'num', text: hm(tot('leave_min')) }), h('td', { class: 'num', text: String(tot('sick_days')) }),
					h('td', { class: 'num', text: String(tot('anomalies')) })
				]));
				DOLLY.render(tableBox, DOLLY.table([
					{ label: __('Employee'), render: function (e) {
						return h('span', {}, [
							h('strong', {}, h('a', { href: CFG.pages.attendance + '&user_id=' + e.user_id + '&month=' + ym, title: __('Open attendance for ') + e.name, text: e.name })),
							e.active ? null : h('span', { class: 'dolly-att-date__off' }, DOLLY.badge(__('Disabled'), 'neutral')),
							e.contract ? h('div', { class: 'dolly-small dolly-muted', text: e.contract }) : null
						]);
					} },
					{ label: __('Days worked'), num: true, render: function (e) { return e.present_days + (e.expected_days ? ' / ' + e.expected_days : ''); } },
					{ label: __('Hours worked'), num: true, render: function (e) { return hm(e.worked_min); } },
					{ label: __('Planned hours'), num: true, render: function (e) { return hm(e.planned_min); } },
					{ label: __('Difference'), num: true, render: function (e) { return h('span', { class: e.balance_min < 0 ? 'dolly-neg' : (e.balance_min > 0 ? 'dolly-pos' : ''), text: (e.balance_min > 0 ? '+' : '') + hm(e.balance_min) }); } },
					{ label: __('Overtime'), num: true, render: function (e) { return h('span', {}, [hm(e.extra_min), e.extra_pending_min ? h('div', {}, DOLLY.badge(hm(e.extra_pending_min) + __(' to be approved'), 'amber', 'hourglass')) : null]); } },
					{ label: _x('Attendance', 'singular'), num: true, render: function (e) { return pct(e.presence_pct); } },
					{ label: __('Late arrivals'), num: true, render: function (e) { return e.late ? e.late + ' · ' + e.late_min + __(' min') : '0'; } },
					{ label: __('Unjustified abs.'), num: true, render: function (e) { return e.absent_days ? DOLLY.badge(e.absent_days + __(' d'), 'red') : '0'; } },
					{ label: __('Vacation'), num: true, render: function (e) { return e.leave_days + __(' d'); } },
					{ label: _x('Leave', 'plural'), num: true, render: function (e) { return hm(e.leave_min); } },
					{ label: __('Sickness/injury'), num: true, render: function (e) { return e.sick_days + __(' d'); } },
					{ label: __('Anomalies'), num: true, render: function (e) { return e.anomalies ? DOLLY.badge(String(e.anomalies), 'red', 'triangle-alert') : '0'; } }
				], rows, { caption: __('Summary by employee from ') + d.from_label + __(' to ') + d.to_label, foot: d.employees.length > 1 ? foot : null }));
			}
		}

		/** Card with a canvas and its accessible data table. */
		function chartCard(title, icon, sub, emptyText) {
			var canvas = h('canvas', { role: 'img', 'aria-label': title });
			var table = h('div', { class: 'dolly-sr-only' });
			var el = DOLLY.card(title, icon, [
				h('p', { class: 'dolly-small dolly-muted', style: 'margin:0 0 8px', text: sub }),
				emptyText ? DOLLY.empty(emptyText, '', 'chart-bar') : h('div', { class: 'dolly-chart' }, canvas),
				table
			], { class: 'dolly-an__chart' });
			return { el: el, canvas: canvas, table: table, title: title };
		}

		/** Bar chart (vertical or horizontal, optionally stacked, with an optional line on the same axis). */
		function lineBar(card, labels, datasets, o) {
			if (!window.Chart) { return; }
			var fmt = o.fmt || function (v) { return String(v).replace('.', ','); };
			var valueAxis = o.horizontal ? 'x' : 'y', catAxis = o.horizontal ? 'y' : 'x';
			datasets.forEach(function (ds) {
				if (ds.type !== 'line') { Object.assign(ds, { borderRadius: o.stacked ? 2 : 4, borderSkipped: 'start', maxBarThickness: 36, borderColor: C.surface, borderWidth: o.stacked ? (o.horizontal ? { right: 2 } : { top: 2 }) : 0 }); }
			});
			var scales = {};
			scales[catAxis] = { stacked: !!o.stacked, grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0, color: C.muted } };
			scales[valueAxis] = {
				stacked: !!o.stacked, beginAtZero: true, grid: { color: C.border }, border: { display: false },
				title: { display: !!o.axis, text: o.axis, color: C.muted },
				ticks: { precision: o.integer ? 0 : undefined, color: C.muted, callback: function (v) { return o.fmt ? fmt(v) : String(v).replace('.', ','); } }
			};
			charts[card.title] = new window.Chart(card.canvas, {
				type: 'bar',
				data: { labels: labels, datasets: datasets },
				options: {
					indexAxis: o.horizontal ? 'y' : 'x',
					responsive: true, maintainAspectRatio: false, animation: false,
					interaction: { mode: 'index', intersect: false },
					scales: scales,
					plugins: {
						legend: { display: o.legend !== false && datasets.length > 1, position: 'bottom', labels: { boxWidth: 12, color: C.text } },
						tooltip: { callbacks: {
							label: function (c) { return ' ' + c.dataset.label + ': ' + fmt(o.horizontal ? c.parsed.x : c.parsed.y); },
							afterBody: o.extra ? function (items) { var t = o.extra(items[0].dataIndex); return t ? [t] : []; } : undefined
						} }
					},
					locale: DOLLY.intlLocale
				}
			});
			// Accessible data table equivalent of the chart.
			DOLLY.render(card.table, DOLLY.table([{ label: '', srLabel: __('Item'), key: 'l' }].concat(datasets.map(function (ds, i) { return { label: ds.label, render: function (r) { return fmt(r.v[i]); } }; })),
				labels.map(function (l, i) { return { l: l, v: datasets.map(function (ds) { return ds.data[i]; }) }; }), { caption: __('Chart data for ') + card.title, stack: false }));
		}

		function exportCsv() {
			if (!data) { return; }
			var rows = data.employees.map(function (e) {
				return [e.name, e.contract, e.present_days, e.expected_days, hm(e.worked_min), hm(e.planned_min), hm(e.balance_min), hm(e.extra_min), hm(e.extra_pending_min),
					e.presence_pct === null ? '' : String(e.presence_pct).replace('.', ','), e.late, e.late_min, e.absent_days, e.leave_days, hm(e.leave_min), e.sick_days, e.anomalies];
			});
			downloadCsv(__('Analytics_') + data.from.split('-').reverse().join('-') + '_' + data.to.split('-').reverse().join('-') + '.csv',
				[__('Employee'), __('Contract'), __('Days worked'), __('Scheduled working days'), __('Hours worked'), __('Planned hours'), __('Difference'), __('Overtime approved'), __('Overtime to approve'),
					__('Attendance %'), __('Late arrivals'), __('Minutes late'), __('Unjustified absences (days)'), __('Vacation and donation (days)'), _x('Hourly leave', 'plural'), __('Sickness and injury (days)'), __('Anomalies')], rows);
		}

		window.addEventListener('beforeprint', function () { Object.keys(charts).forEach(function (k) { charts[k].resize(); }); });
		load();
	}

	/* ------------------------------------------------------------------ */
	/* Appearance (white label)                                            */
	/* ------------------------------------------------------------------ */

	var COLOR_LABELS = {
		primary: [__('Primary color'), __('Buttons, links and selected items.')],
		accent: [__('Accent color'), __('Current day, time bar on the workplace display, details.')],
		header_bg: [__('Header'), __('Top bar of the portal and the panel, background of the workplace display.')],
		background: [__('Page background'), __('Behind cards and panels.')],
		surface: [__('Surfaces'), __('Cards, dialogs and fields.')],
		text: [__('Text'), __('Text and headings.')],
		muted: [__('Secondary text'), __('Descriptions and notes.')],
		border: [__('Borders'), __('Outlines of cards and tables.')],
		success: [__('Success'), __('Attendance, confirmations, clock-in.')],
		warning: [__('Warning'), __('Pending requests, break, warnings.')],
		danger: [__('Error'), __('Absences, errors, deletions.')],
		info: [__('Information'), __('Vacation and informational messages.')]
	};
	var DARK_LABELS = { dark_background: __('Page background'), dark_surface: __('Surfaces'), dark_text: __('Text'), dark_muted: __('Secondary text'), dark_border: __('Borders') };
	var COLOR_PRESETS = [
		{ label: __('Blue'), color: '#2563EB' }, { label: __('Indigo'), color: '#4F46E5' }, { label: __('Purple'), color: '#7C3AED' }, { label: __('Emerald'), color: '#059669' },
		{ label: __('Teal'), color: '#0D9488' }, { label: __('Pink'), color: '#DB2777' }, { label: __('Orange'), color: '#EA580C' }, { label: __('Slate'), color: '#334155' }
	];

	/** "#abc" / "AABBCC" → "#AABBCC", or '' when not a color. */
	function hexColor(v) {
		v = String(v || '').trim().replace(/^#/, '');
		if (/^[0-9a-f]{3}$/i.test(v)) { v = v.replace(/(.)/g, '$1$1'); }
		return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toUpperCase() : '';
	}

	/** Color picker paired with a hex text field. */
	function colorField(name, label, help, value, onChange) {
		var id = DOLLY.uid('c');
		var swatch = h('input', { type: 'color', class: 'dolly-color__swatch', value: value.toLowerCase(), 'aria-label': label + __(': color picker'), tabindex: '-1' });
		var text = h('input', { type: 'text', class: 'dolly-input dolly-color__hex', id: id, value: value, maxlength: 7, spellcheck: 'false', autocomplete: 'off', 'aria-describedby': help ? id + '-h' : null });
		swatch.addEventListener('input', function () { text.value = swatch.value.toUpperCase(); onChange(); });
		text.addEventListener('input', function () { var v = hexColor(text.value); if (v) { swatch.value = v.toLowerCase(); onChange(); } });
		text.addEventListener('blur', function () { var v = hexColor(text.value); if (v) { text.value = v; } });
		var wrap = h('div', { class: 'dolly-field', dataset: { name: name } }, [
			h('label', { class: 'dolly-label', for: id, text: label }),
			h('div', { class: 'dolly-color' }, [swatch, text]),
			help ? h('span', { class: 'dolly-help', id: id + '-h', text: help }) : null,
			h('span', { class: 'dolly-error', hidden: true })
		]);
		wrap.value = function () { return hexColor(text.value) || text.value.trim(); };
		wrap.set = function (v) { text.value = v; swatch.value = v.toLowerCase(); };
		return wrap;
	}

	/** Image from the media library: preview, "choose" and "remove". */
	function imageField(name, label, help, id, url, onChange, o) {
		o = o || {};
		var cur = id, curUrl = url;
		var preview = h('div', { class: 'dolly-image-pick' + (o.square ? ' dolly-image-pick--square' : '') });
		var rm = DOLLY.button(__('Remove'), { icon: 'x', size: 'sm', variant: 'ghost', onClick: function () { cur = 0; curUrl = ''; show(); onChange(); } });
		var choose = DOLLY.button(__('Choose image'), { icon: 'image', size: 'sm', onClick: function () {
			if (!window.wp || !window.wp.media) { DOLLY.toast(__('The media library is not available.'), 'error'); return; }
			var frame = window.wp.media({ title: label, library: { type: 'image' }, multiple: false, button: { text: __('Use this image') } });
			frame.on('select', function () {
				var a = frame.state().get('selection').first().toJSON();
				cur = a.id; curUrl = a.sizes && a.sizes.medium ? a.sizes.medium.url : a.url;
				show(); onChange();
			});
			frame.open();
		} });
		function show() {
			DOLLY.render(preview, curUrl ? h('img', { src: curUrl, alt: '' }) : h('span', { class: 'dolly-small dolly-muted', text: o.empty || __('No image') }));
			rm.hidden = !cur;
		}
		show();
		var wrap = h('div', { class: 'dolly-field', dataset: { name: name } }, [
			h('span', { class: 'dolly-label', text: label }), preview, h('div', { class: 'dolly-btn-row' }, [choose, rm]),
			help ? h('span', { class: 'dolly-help', text: help }) : null,
			h('span', { class: 'dolly-error', hidden: true })
		]);
		wrap.value = function () { return cur; };
		wrap.url = function () { return curUrl; };
		return wrap;
	}

	function choiceOptions(map) {
		return Object.keys(map).map(function (k) { return { value: k, label: map[k] }; });
	}

	/** Applies saved settings to the whole admin page without reloading it. */
	var liveStyle = null;
	function applyAdminCss(css) {
		if (!css) { return; }
		if (!liveStyle) { liveStyle = h('style', { id: 'dolly-appearance-live' }); document.head.appendChild(liveStyle); }
		liveStyle.textContent = css;
	}

	var fontLinks = {};
	function loadFont(url) {
		if (!url || fontLinks[url] || !/^https:\/\//.test(url)) { return; }
		fontLinks[url] = true;
		document.head.appendChild(h('link', { rel: 'stylesheet', href: url }));
	}

	function pageAppearance() {
		DOLLY.render(main, DOLLY.loading());
		DOLLY.api('admin/appearance').then(renderAppearance, function (err) { DOLLY.render(main, DOLLY.errorState(err, pageAppearance)); });
	}

	function renderAppearance(d) {
		var a = d.appearance, ch = d.choices, auto = d.auto;
		var alertBox = h('div', { hidden: true });
		var previewTimer = null;
		function changed() { clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 250); }

		function text(name, label, o) {
			o = o || {};
			return DOLLY.field({ label: label, name: name, type: o.type || 'text', value: a[name], help: o.help, optional: o.optional, rows: o.rows, full: o.full, attrs: Object.assign({ maxlength: o.max || 60 }, o.attrs || {}) });
		}
		function select(name, label, options, help) {
			return DOLLY.field({ label: label, name: name, type: 'select', value: a[name], options: options, help: help });
		}

		// Brand.
		var brandName = text('brand_name', __('Brand name'), { max: 40, help: __('Shown when there is no logo, as the app name on the phone, in notifications and in emails.') });
		var appName = text('app_name', __('Full app name'), { optional: true, help: __('Name of the installed app and title in the browser. Empty = "') + auto.app_name + '".', attrs: { placeholder: auto.app_name } });
		var portalSub = text('portal_subtitle', __('Portal subtitle'), { optional: true, help: __('Next to the brand on the sign-in pages.') });
		var adminTitle = text('admin_title', __('Admin dashboard name'), { max: 40, help: __('WordPress menu item and header of these pages.') });
		var displaySub = text('display_subtitle', __('Workplace display subtitle'), { optional: true });
		var mark = DOLLY.switchControl({ label: __('Small colored square after the name'), name: 'wordmark_mark', checked: !!a.wordmark_mark, description: __('Small detail in the accent color, only when there is no logo.'), onChange: changed });

		// Logos and icons.
		var logo = imageField('logo_id', __('Logo'), __('Sign-in pages and, if you don\'t set a header logo, also the top bar and workplace display. Landscape format with transparent background.'), a.logo_id, d.images.logo_id, changed, { empty: __('No logo: the brand name is shown.') });
		var logoHeader = imageField('logo_header_id', __('Logo for the colored header'), __('Optional: light version of the logo, readable on the header color.'), a.logo_header_id, d.images.logo_header_id, changed, { empty: __('Same as the main logo.') });
		var logoHeight = DOLLY.field({ label: __('Maximum logo height (px)'), name: 'logo_height', type: 'number', value: a.logo_height, attrs: { min: 24, max: 96 } });
		var appIcon = imageField('app_icon_id', __('App icon'), __('Square image of at least 512 × 512 px: icon on the Home screen and in notifications. Empty = site icon (Settings › General) or the default icon.'), a.app_icon_id, d.images.app_icon_id, changed, { square: true, empty: __('Default icon') });

		// Colors.
		var colors = {};
		Object.keys(COLOR_LABELS).forEach(function (k) { colors[k] = colorField(k, COLOR_LABELS[k][0], COLOR_LABELS[k][1], a[k], changed); });
		var darkColors = {};
		Object.keys(DARK_LABELS).forEach(function (k) { darkColors[k] = colorField(k, DARK_LABELS[k], null, a[k], changed); });
		var presets = h('div', { class: 'dolly-swatches', role: 'group', 'aria-label': __('Ready-made color schemes') }, COLOR_PRESETS.map(function (p) {
			var b = h('button', { type: 'button', class: 'dolly-swatch', title: p.label }, [h('span', { class: 'dolly-swatch__dot', style: 'background:' + p.color, 'aria-hidden': 'true' }), h('span', { text: p.label })]);
			b.addEventListener('click', function () { ['primary', 'accent', 'header_bg'].forEach(function (k) { colors[k].set(p.color); }); changed(); });
			return b;
		}));
		var contrastBox = h('ul', { class: 'dolly-contrast', 'aria-live': 'polite' });
		function showContrast(c) {
			var row = function (ratio, label, min) {
				var ok = ratio >= min;
				return h('li', {}, [ok ? DOLLY.badge(String(ratio).replace('.', ',') + ':1', 'green', 'circle-check') : DOLLY.badge(String(ratio).replace('.', ',') + ':1', 'amber', 'triangle-alert'), ' ', label, ok ? null : h('span', { class: 'dolly-help', text: __(' Low contrast: the text may be hard to read.') })]);
			};
			DOLLY.render(contrastBox, [
				row(c.on_primary, __('Text on main buttons'), 4.5),
				row(c.primary, __('Links and primary color on cards'), 3),
				row(c.header, __('Text on the header'), 4.5),
				row(c.text, __('Text on the background'), 4.5),
				row(c.muted, __('Secondary text on cards'), 4.5)
			]);
		}
		showContrast(d.contrast);

		// Dark mode.
		var scheme = DOLLY.radios({ label: __('Theme'), name: 'color_scheme', value: a.color_scheme, options: choiceOptions(ch.schemes).map(function (o) {
			o.description = { light: __('Always light (default).'), dark: __('Always dark.'), auto: __('Light or dark according to the phone or computer setting.') }[o.value];
			return o;
		}), onChange: changed });

		// Typography.
		var font = select('font_family', __('Font'), choiceOptions(ch.fonts), __('System fonts download nothing and are the fastest.'));
		var fontCustom = text('font_custom', __('Font name'), { max: 200, help: __('As in CSS, e.g. "Inter", sans-serif. It must be installed on the device or loaded from the address below.') });
		var fontUrl = text('font_url', __('Font stylesheet URL'), { optional: true, max: 500, type: 'url', help: __('E.g. a .css file hosted on your site. With external services (e.g. Google Fonts) visitors\' IP addresses are sent to third parties: consider the GDPR.'), attrs: { placeholder: 'https://' } });
		var customBox = h('div', { class: 'dolly-form-grid', hidden: a.font_family !== 'custom' }, [fontCustom, fontUrl]);
		font.input.addEventListener('change', function () { customBox.hidden = font.input.value !== 'custom'; });
		var textSize = select('text_size', __('Text size'), choiceOptions(ch.text_sizes), __('Portal, sign-in pages and workplace display.'));
		var headingWeight = select('heading_weight', __('Heading weight'), ch.heading_weights.map(function (w) { return { value: w, label: { 600: __('Semi-bold'), 700: __('Bold (default)'), 800: __('Extra bold') }[w] }; }));

		// Shapes.
		var radius = DOLLY.field({ label: __('Corner radius (px)'), name: 'radius', type: 'number', value: a.radius, attrs: { min: 0, max: 24 }, help: __('0 = sharp corners, 12 = default, 24 = very rounded.') });
		var btnShape = DOLLY.radios({ label: __('Button shape'), name: 'button_shape', value: a.button_shape, options: choiceOptions(ch.button_shapes), onChange: changed });
		var shadow = select('shadow', __('Card shadow'), choiceOptions(ch.shadows));
		var density = select('density', __('Spacing'), choiceOptions(ch.densities), __('Compact shows more content on the screen.'));

		// Login page.
		var loginTitle = text('login_title', __('Sign-in page title'));
		var loginText = DOLLY.field({ label: __('Text below the title'), name: 'login_text', type: 'textarea', value: a.login_text, optional: true, rows: 3, attrs: { maxlength: 300 } });
		var loginBg = imageField('login_bg_id', __('Background image'), __('Optional: covered by the sign-in box in the center. Use a low-contrast image.'), a.login_bg_id, d.images.login_bg_id, changed, { empty: __('No image: background color.') });

		// Emails.
		var fromName = text('email_from_name', __('Sender name'), { optional: true, help: __('Empty = default name from WordPress or the SMTP plugin.') });
		var fromEmail = text('email_from_email', __('Sender address'), { optional: true, type: 'email', max: 100, help: __('Use an address on your domain, otherwise emails may end up in spam.') });
		var subjectPrefix = text('email_subject_prefix', __('Subject prefix'), { optional: true, max: 40, help: __('Empty = "') + auto.email_subject_prefix + '".', attrs: { placeholder: auto.email_subject_prefix } });
		var signature = DOLLY.field({ label: __('Signature at the bottom of emails'), name: 'email_signature', type: 'textarea', value: a.email_signature, optional: true, rows: 2, help: __('Empty = "') + auto.email_signature + '".', attrs: { maxlength: 300, placeholder: auto.email_signature } });

		// Custom CSS.
		var customCss = DOLLY.field({ label: __('Additional CSS'), name: 'custom_css', type: 'textarea', value: a.custom_css, optional: true, rows: 8, help: __('Applied to the portal, the sign-in pages and the workplace display. You can use the --dolly-* variables (e.g. var(--dolly-primary)).'), attrs: { spellcheck: 'false', class: 'dolly-textarea dolly-textarea--code' } });

		// Preview.
		var previewStyle = h('style');
		var previewBrand = h('div', { class: 'dolly-brand' });
		var previewSub = h('span', { class: 'dolly-brand__sub' });
		var preview = h('div', { class: 'dolly-preview' + (a.color_scheme === 'dark' ? ' is-dark' : '') }, [
			h('div', { class: 'dolly-topbar dolly-preview__bar' }, [previewBrand, h('span', { class: 'dolly-btn dolly-btn--ghost dolly-btn--icon', 'aria-hidden': 'true' }, DOLLY.icon('bell'))]),
			h('div', { class: 'dolly-preview__body' }, [
				h('div', { class: 'dolly-card' }, [
					h('h3', { text: __('Good morning, Giulia') }),
					h('p', { class: 'dolly-muted', text: __('Today\'s shift: 09:00 – 18:00, main workplace.') }),
					h('div', { class: 'dolly-btn-row' }, [
						h('span', { class: 'dolly-btn dolly-btn--primary' }, [DOLLY.icon('log-in'), __('Clock in')]),
						h('span', { class: 'dolly-btn' }, __('Requests'))
					])
				]),
				h('div', { class: 'dolly-card' }, [
					h('div', { class: 'dolly-tabs', 'aria-hidden': 'true' }, [h('span', { class: 'dolly-tab', 'aria-selected': 'true' }, __('In progress')), h('span', { class: 'dolly-tab' }, __('Archive'))]),
					h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('Reason') }), h('span', { class: 'dolly-input' }, __('Medical appointment'))]),
					h('div', { class: 'dolly-preview__badges' }, [DOLLY.badge(__('Approved'), 'green', 'circle-check'), DOLLY.badge(__('Pending'), 'amber', 'clock'), DOLLY.badge(__('Rejected'), 'red', 'circle-x'), DOLLY.badge(__('Vacation'), 'blue')]),
					h('span', { class: 'dolly-switch', role: 'presentation', 'aria-checked': 'true' }, [h('span', { class: 'dolly-switch__track' }, h('span', { class: 'dolly-switch__thumb' })), h('span', { text: __('Notifications on') })]),
					DOLLY.alert(__('Requests are confirmed by email.'), 'info')
				])
			])
		]);
		var modeTabs = h('div');
		var previewDark = a.color_scheme === 'dark';
		function renderModeTabs() {
			DOLLY.render(modeTabs, DOLLY.tabs([{ id: 'light', label: __('Light'), icon: 'sun' }, { id: 'dark', label: __('Dark'), icon: 'moon' }], previewDark ? 'dark' : 'light', function (id) {
				previewDark = id === 'dark'; preview.classList.toggle('is-dark', previewDark); renderModeTabs();
			}));
		}
		renderModeTabs();
		function drawPreviewBrand(v) {
			var src = logoHeader.url() || logo.url();
			DOLLY.render(previewBrand, [
				src ? h('img', { class: 'dolly-brand__logo', src: src, alt: '' }) : h('span', { class: 'dolly-brand__wordmark', text: v.brand_name || '…' }),
				previewSub
			]);
			previewSub.textContent = v.portal_subtitle;
		}

		function collect() {
			var v = {};
			[brandName, appName, portalSub, adminTitle, displaySub, logoHeight, font, fontCustom, fontUrl, textSize, headingWeight, radius, shadow, density,
				loginTitle, loginText, fromName, fromEmail, subjectPrefix, signature, customCss].forEach(function (f) { v[f.dataset.name] = f.input.value; });
			[logo, logoHeader, appIcon, loginBg].forEach(function (f) { v[f.dataset.name] = f.value(); });
			Object.keys(colors).forEach(function (k) { v[k] = colors[k].value(); });
			Object.keys(darkColors).forEach(function (k) { v[k] = darkColors[k].value(); });
			v.wordmark_mark = mark.control.isOn();
			v.color_scheme = scheme.value();
			v.button_shape = btnShape.value();
			return v;
		}
		function updatePreview() {
			var v = collect();
			drawPreviewBrand(v);
			if (v.font_family === 'custom') { loadFont(v.font_url); }
			DOLLY.api('admin/appearance/preview', { method: 'POST', body: v }).then(function (r) {
				previewStyle.textContent = r.css;
				showContrast(r.contrast);
			}, function () { /* The preview keeps the last valid colours while a value is being typed. */ });
		}

		var saveBtn = DOLLY.button(__('Save appearance'), { type: 'submit', variant: 'primary', icon: 'save' });
		var resetBtn = DOLLY.button(__('Restore defaults'), { icon: 'rotate-ccw', variant: 'ghost', onClick: function () {
			DOLLY.confirm(__('Restore the default appearance?'), __('Brand, logo, colors, fonts, texts and additional CSS return to their initial values. Images remain in the media library.'), __('Restore'), 'danger').then(function (ok) {
				if (!ok) { return; }
				DOLLY.busy(resetBtn, DOLLY.api('admin/appearance/reset', { method: 'POST' })).then(function (nd) {
					applyAdminCss(nd.css); DOLLY.toast(__('Default appearance restored.'), 'success'); renderAppearance(nd);
				}, function (err) { DOLLY.toast(err.message, 'error'); });
			});
		} });

		var card = function (title, icon, children, intro) {
			return DOLLY.card(title, icon, h('div', { class: 'dolly-form' }, [intro ? h('p', { class: 'dolly-muted', style: 'margin:0', text: intro }) : null].concat(children)), { level: 'h2' });
		};
		var form = h('form', { class: 'dolly-stack', novalidate: true }, [
			alertBox,
			card(__('Brand'), 'tag', [h('div', { class: 'dolly-form-grid' }, [brandName, appName, portalSub, adminTitle, displaySub]), mark], __('While they keep their default values, the subtitles, the panel name and the sign-in page texts are shown in each user\'s language.')),
			card(__('Logo and icon'), 'image', [h('div', { class: 'dolly-form-grid' }, [logo, logoHeader]), h('div', { class: 'dolly-form-grid' }, [logoHeight]), appIcon]),
			card(__('Colors'), 'palette', [
				h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('Ready-made schemes') }), presets, h('span', { class: 'dolly-help', text: __('Sets the primary, accent and header colors together.') })]),
				h('div', { class: 'dolly-form-grid dolly-form-grid--3' }, Object.keys(colors).map(function (k) { return colors[k]; })),
				h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('Readability (WCAG contrast)') }), contrastBox])
			], __('The rest of the palette (shades, alert backgrounds, button text) is calculated automatically from these colors.')),
			card(__('Dark mode'), 'moon', [scheme, h('div', { class: 'dolly-form-grid dolly-form-grid--3' }, Object.keys(darkColors).map(function (k) { return darkColors[k]; }))],
				__('Applies to the employee portal, sign-in pages and workplace display: the admin panel stays light. In dark mode, the primary, accent and header colors are adjusted automatically.')),
			card(__('Fonts'), 'type', [font, customBox, h('div', { class: 'dolly-form-grid' }, [textSize, headingWeight])]),
			card(__('Shapes and spacing'), 'square-dashed', [h('div', { class: 'dolly-form-grid' }, [radius, shadow, density]), btnShape]),
			card(__('Sign-in page'), 'log-in', [loginTitle, loginText, loginBg]),
			card(__('Email'), 'mail', [h('div', { class: 'dolly-form-grid' }, [fromName, fromEmail, subjectPrefix]), signature], __('Sender, subject and signature of email notifications.')),
			card(__('Additional CSS'), 'code', [customCss]),
			h('div', { class: 'dolly-btn-row dolly-settings__save' }, [saveBtn, resetBtn])
		]);
		form.addEventListener('input', changed);
		form.addEventListener('change', changed);
		form.addEventListener('submit', function (ev) {
			ev.preventDefault(); DOLLY.clearErrors(form); alertBox.hidden = true;
			DOLLY.busy(saveBtn, DOLLY.api('admin/appearance', { method: 'POST', body: collect() })).then(function (nd) {
				applyAdminCss(nd.css);
				DOLLY.toast(__('Appearance saved. The panel name and logo will update the next time the page loads.'), 'success');
				renderAppearance(nd);
			}, function (err) { DOLLY.formError(form, err, alertBox); });
		});

		var aside = h('aside', { class: 'dolly-appearance__preview', 'aria-label': __('Preview') }, [
			DOLLY.card(__('Preview'), 'eye', [modeTabs, preview, h('p', { class: 'dolly-help', style: 'margin:12px 0 0', text: __('The preview updates as you edit; changes apply only after saving.') })], { level: 'h2' })
		]);
		DOLLY.render(main, h('div', { class: 'dolly-appearance' }, [previewStyle, form, aside]));
		updatePreview();
	}

	/* ------------------------------------------------------------------ */
	/* Documents                                                            */
	/* ------------------------------------------------------------------ */

	var DOC_ICONS = { contratto: 'file-signature', cu: 'receipt-text', busta_paga: 'wallet', altro: 'file' };
	function docIcon(key) { return DOC_ICONS[key] || 'folder'; }

	/** Employees with search and pagination; each row: send a document, list of documents. */
	function pageDocuments() {
		var st = { page: 1, search: '', status: 'active' };
		var box = h('div', {}, DOLLY.loading());
		var search = DOLLY.field({ label: __('Search'), type: 'search', attrs: { placeholder: __('Name, username or email') } });
		var status = DOLLY.field({ label: __('Status'), type: 'select', value: 'active', options: [{ value: 'active', label: _x('Active', 'plural') }, { value: 'inactive', label: __('Inactive') }, { value: 'all', label: __('All') }] });
		var timer = null;
		search.input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { st.search = search.input.value.trim(); st.page = 1; load(); }, 300); });
		status.input.addEventListener('change', function () { st.status = status.input.value; st.page = 1; load(); });
		var catBtn = DOLLY.button(__('Categories'), { icon: 'tags', onClick: function () { categoriesDialog(load); } });
		catBtn.dataset.tour = 'doc-categories';
		DOLLY.render(main, DOLLY.card(null, null, [
			h('p', { class: 'dolly-muted', style: 'margin-top:0', text: __('Send each employee contracts, tax certificates, payslips and other documents. The employee finds them in the Documents section of the portal and gets a notification; the files are kept in a private folder, separate for each employee.') }),
			h('div', { class: 'dolly-toolbar', dataset: { tour: 'doc-toolbar' } }, [search, status, h('div', { class: 'dolly-toolbar__spacer' }), catBtn]),
			box
		]));
		function load() {
			DOLLY.api('admin/documents/people', { query: st }).then(function (res) {
				DOLLY.render(box, [
					DOLLY.table([
						{ label: __('Employee'), render: function (e) { return h('div', {}, [h('strong', { text: e.name }), h('div', { class: 'dolly-small dolly-muted', text: e.username + (e.workplaces ? ' · ' + e.workplaces : '') }), e.active ? null : DOLLY.badge(__('Disabled'), 'neutral', 'ban')]); } },
						{ label: __('Documents'), num: true, render: function (e) { return e.documents ? String(e.documents) : h('span', { class: 'dolly-muted', text: '0' }); } },
						{ label: __('Last sent'), render: function (e) { return e.last_at ? DOLLY.fmt.dateTime(e.last_at) : h('span', { class: 'dolly-muted', text: '—' }); } },
						{ label: '', srLabel: __('Actions'), render: function (e) {
							return h('div', { class: 'dolly-actions dolly-doc-actions' }, [
								DOLLY.button(DOLLY.sprintf(__('Send a document to %s'), e.name), { iconOnly: true, icon: 'file-up', variant: 'primary', size: 'sm', onClick: function () { sendDocumentDialog(e, load); } }),
								DOLLY.button(DOLLY.sprintf(__('Documents of %s'), e.name), { iconOnly: true, icon: 'folder-open', size: 'sm', onClick: function () { documentsDialog(e, load); } })
							]);
						} }
					], res.items, { empty: [__('No employees'), st.search ? __('No results for this search.') : __('Create the employees first.'), 'users'], caption: __('Employee documents') }),
					DOLLY.pagination(res, function (p) { st.page = p; load(); }, 'dipendenti')
				]);
				var first = box.querySelector('.dolly-doc-actions');
				if (first) { first.dataset.tour = 'doc-actions'; }
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	/** Categories (defaults fixed, custom ones editable): admin/documents/categories. */
	function categoryOptions() {
		return DOLLY.api('admin/documents/categories');
	}

	function sendDocumentDialog(e, done) {
		var body = h('div', {}, DOLLY.loading());
		var dlg = DOLLY.dialog({ title: __('Send document'), body: body });
		categoryOptions().then(function (cats) {
			var alertBox = h('div', { hidden: true });
			var category = DOLLY.radios({ label: __('Category'), name: 'category', value: 'busta_paga', options: cats.map(function (c) { return { value: c.key, label: c.label }; }) });
			category.classList.add('dolly-doc-cats');
			var title = DOLLY.field({ label: __('Title'), name: 'title', required: true, attrs: { maxlength: 190 }, help: __('E.g. «Payslip October 2026».') });
			var desc = DOLLY.field({ label: __('Description'), name: 'description', type: 'textarea', optional: true, attrs: { maxlength: 2000, rows: 3 } });
			var fileInput = h('input', { type: 'file', class: 'dolly-input', id: DOLLY.uid('file'), accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.odt,.ods' });
			var fileField = h('div', { class: 'dolly-field', dataset: { name: 'file' } }, [
				h('label', { class: 'dolly-label', for: fileInput.id, text: __('File') }), fileInput,
				h('span', { class: 'dolly-help', text: __('PDF, JPG, PNG, Word, Excel or OpenDocument, up to 20 MB.') }),
				h('span', { class: 'dolly-error', hidden: true })
			]);
			// Title suggested from the category and the file name until the administrator types one.
			var typed = false;
			title.input.addEventListener('input', function () { typed = !!title.input.value; });
			function suggest() {
				if (typed) { return; }
				var c = cats.filter(function (x) { return x.key === category.value(); })[0];
				var f = fileInput.files[0];
				title.input.value = f ? f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : (c && c.key !== 'altro' ? c.label : '');
			}
			category.addEventListener('change', suggest);
			fileInput.addEventListener('change', suggest);
			suggest();
			var form = h('form', { class: 'dolly-form', novalidate: true }, [
				alertBox,
				h('p', { style: 'margin:0' }, [__('Recipient: '), h('strong', { text: e.name })]),
				category, title, desc, fileField
			]);
			DOLLY.render(body, form);
			DOLLY.render(dlg.foot, []);
			var cancel = DOLLY.button(__('Cancel'), { onClick: function () { dlg.close(); } });
			var send = DOLLY.button(__('Send'), { variant: 'primary', icon: 'send', onClick: submit });
			dlg.el.appendChild(h('div', { class: 'dolly-dialog__foot' }, [cancel, send]));
			DOLLY.icons();
			form.addEventListener('submit', function (ev) { ev.preventDefault(); submit(); });
			function submit() {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var f = fileInput.files[0], errors = {};
				if (!title.input.value.trim()) { errors.title = __('Required field.'); }
				if (!f) { errors.file = __('Choose the file to send.'); }
				else if (f.size > 20 * 1024 * 1024) { errors.file = __('The file is larger than 20 MB.'); }
				if (Object.keys(errors).length) { DOLLY.showErrors(form, errors); return; }
				var fd = new FormData();
				fd.append('user_id', e.id); fd.append('category', category.value()); fd.append('title', title.input.value.trim()); fd.append('description', desc.input.value.trim()); fd.append('file', f);
				DOLLY.busy(send, DOLLY.api('admin/documents', { method: 'POST', form: fd, timeout: 180000 })).then(function () {
					dlg.close(); DOLLY.toast(DOLLY.sprintf(__('Document sent to %s.'), e.name), 'success'); done();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			}
		}, function (err) { DOLLY.render(body, DOLLY.errorState(err)); });
	}

	/** Documents of one employee by category: open or delete. */
	function documentsDialog(e, done) {
		var body = h('div', {}, DOLLY.loading());
		var changed = false;
		DOLLY.dialog({
			title: DOLLY.sprintf(__('Documents of %s'), e.name), body: body, wide: true,
			actions: [{ label: __('Send document'), icon: 'file-up', onClick: function (close) { close(); sendDocumentDialog(e, done); } }, { label: __('Close'), variant: 'primary' }],
			onClose: function () { if (changed) { done(); } }
		});
		function load() {
			DOLLY.api('admin/documents', { query: { user_id: e.id } }).then(function (d) {
				var groups = d.groups.filter(function (g) { return g.items.length; });
				DOLLY.render(body, d.total ? h('div', { class: 'dolly-doc-groups' }, groups.map(function (g) {
					return h('section', { class: 'dolly-doc-group' }, [
						h('h3', { class: 'dolly-doc-group__title' }, [DOLLY.icon(docIcon(g.key)), g.label, h('span', { class: 'dolly-doc-group__count', text: String(g.items.length) })]),
						h('ul', { class: 'dolly-doc-list' }, g.items.map(function (doc) {
							var del = DOLLY.button(__('Delete'), { size: 'sm', variant: 'ghost', icon: 'trash-2', onClick: function () {
								DOLLY.confirm(__('Delete the document?'), DOLLY.sprintf(__('«%s» is deleted permanently and the employee will no longer be able to open it.'), doc.title), __('Delete'), 'danger').then(function (ok) {
									if (!ok) { return; }
									DOLLY.busy(del, DOLLY.api('admin/documents/' + doc.id, { method: 'DELETE' })).then(function () { changed = true; DOLLY.toast(__('Document deleted.'), 'success'); load(); }, function (err) { DOLLY.toast(err.message, 'error'); });
								});
							} });
							return h('li', { class: 'dolly-doc' }, [
								h('span', { class: 'dolly-doc__icon', 'aria-hidden': 'true' }, DOLLY.icon(doc.mime === 'application/pdf' ? 'file-text' : (doc.inline ? 'image' : 'file'))),
								h('div', { class: 'dolly-doc__text' }, [
									h('strong', { text: doc.title }),
									doc.description ? h('span', { class: 'dolly-small', text: doc.description }) : null,
									h('span', { class: 'dolly-small dolly-muted', text: doc.original_name + ' · ' + DOLLY.fmt.bytes(doc.size) + ' · ' + DOLLY.fmt.dateTime(doc.uploaded_at) + (doc.uploaded_by ? ' · ' + doc.uploaded_by : '') }),
									doc.viewed_at ? DOLLY.badge(__('Opened by the employee on ') + DOLLY.fmt.dateTime(doc.viewed_at), 'green', 'eye') : DOLLY.badge(__('Not opened yet'), 'neutral', 'eye-off')
								]),
								h('div', { class: 'dolly-doc__actions' }, [
									DOLLY.button(doc.inline ? __('Open') : __('Download'), { size: 'sm', icon: doc.inline ? 'eye' : 'download', href: DOLLY.downloadUrl('documents/' + doc.id + '/download', doc.inline ? { inline: 1 } : {}) }),
									del
								])
							]);
						}))
					]);
				})) : DOLLY.empty(__('No documents'), __('Use «Send document» to send one.'), 'folder-open'));
				Array.prototype.forEach.call(body.querySelectorAll('.dolly-doc__actions a'), function (a) { a.target = '_blank'; a.rel = 'noopener'; });
				DOLLY.icons();
			}, function (err) { DOLLY.render(body, DOLLY.errorState(err, load)); });
		}
		load();
	}

	/** Default categories are fixed; the administrator can add, rename and remove others. */
	function categoriesDialog(done) {
		var body = h('div', {}, DOLLY.loading());
		var dlg = DOLLY.dialog({ title: __('Document categories'), body: body });
		categoryOptions().then(function (cats) {
			var alertBox = h('div', { hidden: true });
			var list = h('div', { class: 'dolly-stack' });
			var rows = [];
			function addRow(c) {
				var i = rows.length;
				var f = DOLLY.field({ label: __('Category name'), name: 'category_' + i, value: c ? c.label : '', attrs: { maxlength: 40 } });
				var row = h('div', { class: 'dolly-doc-cat' }, [f]);
				var item = { key: c ? c.key : '', field: f, row: row, removed: false };
				var rm = DOLLY.button(__('Remove'), { size: 'sm', variant: 'ghost', icon: 'trash-2', onClick: function () { item.removed = true; row.remove(); } });
				row.appendChild(rm);
				if (c && c.count) { row.appendChild(h('span', { class: 'dolly-small dolly-muted', text: DOLLY.sprintf(__('%d documents: if you remove it they move to «Other».'), c.count) })); }
				rows.push(item); list.appendChild(row); DOLLY.icons();
				if (!c) { f.input.focus(); }
			}
			cats.filter(function (c) { return c.custom; }).forEach(addRow);
			var form = h('form', { class: 'dolly-form', novalidate: true }, [
				alertBox,
				h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('Default categories') }), h('div', { class: 'dolly-btn-row' }, cats.filter(function (c) { return !c.custom; }).map(function (c) { return DOLLY.badge(c.label + (c.count ? ' · ' + c.count : ''), 'blue', docIcon(c.key)); })), h('span', { class: 'dolly-help', text: __('They cannot be removed.') })]),
				h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('Other categories') }), list, h('div', {}, DOLLY.button(__('Add category'), { size: 'sm', icon: 'plus', onClick: function () { addRow(null); } }))])
			]);
			DOLLY.render(body, form);
			var save = DOLLY.button(__('Save categories'), { variant: 'primary', icon: 'save', onClick: function () {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var out = rows.filter(function (r) { return !r.removed && r.field.input.value.trim(); }).map(function (r) { return { key: r.key, label: r.field.input.value.trim() }; });
				DOLLY.busy(save, DOLLY.api('admin/documents/categories', { method: 'POST', body: { categories: out } })).then(function () {
					dlg.close(); DOLLY.toast(__('Categories saved.'), 'success'); done();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			} });
			dlg.el.appendChild(h('div', { class: 'dolly-dialog__foot' }, [DOLLY.button(__('Cancel'), { onClick: function () { dlg.close(); } }), save]));
			DOLLY.icons();
		}, function (err) { DOLLY.render(body, DOLLY.errorState(err)); });
	}

	/* ------------------------------------------------------------------ */
	/* Guided setup                                                         */
	/* ------------------------------------------------------------------ */

	var EFFECTS = {
		on: ['toggle-right', __('When on')],
		off: ['toggle-left', __('When off')],
		change: ['sliders-horizontal', __('When you change it')],
		tip: ['lightbulb', __('Tip')]
	};

	/**
	 * A setting followed by what it is for and what happens when it is turned on, off or changed.
	 * rows: [[kind, text], ...] with kind on | off | change | tip. For a switch the row matching the
	 * current state is highlighted while the administrator toggles it.
	 */
	function explained(control, rows) {
		var list = h('dl', { class: 'dolly-ob__effects' }, rows.filter(Boolean).map(function (r) {
			return h('div', { class: 'dolly-ob__effect', dataset: { kind: r[0] } }, [h('dt', {}, [DOLLY.icon(EFFECTS[r[0]][0]), EFFECTS[r[0]][1]]), h('dd', { text: r[1] })]);
		}));
		var sw = control && control.control && control.control.isOn ? control.control : null;
		function sync() {
			Array.prototype.forEach.call(list.children, function (row) {
				var k = row.dataset.kind;
				row.classList.toggle('is-current', (k === 'on' && sw.isOn()) || (k === 'off' && !sw.isOn()));
			});
		}
		if (sw) { sw.addEventListener('click', function () { setTimeout(sync, 0); }); sync(); }
		return h('div', { class: 'dolly-ob__setting' }, [control, list]);
	}

	function obNote(text, icon) {
		return h('div', { class: 'dolly-ob__note' }, [DOLLY.icon(icon || 'info'), h('p', { text: text })]);
	}

	/** Steps of the guided setup. build(ctx) -> { body, save(): Promise, check(): error text | '', next, reload } */
	function onboardingSteps() {
		function settingsSave(collect) {
			return function (ctx) {
				return DOLLY.api('admin/settings', { method: 'POST', body: collect() }).then(function (nd) { ctx.d = nd; });
			};
		}
		function certModes(d, name, value) {
			var help = {
				required: __('The employee must upload the certificate, with no deadline: while it is missing the "Missing certificate" anomaly stays open and the employee gets a reminder.'),
				deadline: __('The certificate must be uploaded within the days set below; after the deadline the employee and the administrators are notified and the anomaly stays open.'),
				disabled: __('No certificate required. Pending requirements are cancelled (and recorded in the change log).')
			};
			return DOLLY.radios({ label: name === 'certificate_mode' ? __('Medical certificate') : __('Blood donation certificate'), name: name, value: value, options: Object.keys(d.certificate_modes).map(function (k) { return { value: k, label: d.certificate_modes[k], description: help[k] || null }; }) });
		}
		var n = function (name, label, value, min, max, help) {
			return DOLLY.field({ label: label, name: name, type: 'number', value: value, help: help, attrs: { min: min, max: max } });
		};

		return [
			{ id: 'welcome', group: 'start', icon: 'sparkles', title: __('Welcome'), next: __('Let\'s start'), build: function () {
				var phase = function (icon, title, text) { return h('li', { class: 'dolly-ob__phase' }, [h('span', { class: 'dolly-ob__phase-icon' }, DOLLY.icon(icon)), h('div', {}, [h('strong', { text: title }), h('span', { text: text })])]); };
				return { body: [
					h('p', { class: 'dolly-ob__lead', text: DOLLY.sprintf(__('In a few minutes we set up %s for your company. We guide you step by step and, for every setting, explain what it is for and what happens when you turn it on, off or change it.'), DOLLY.brandName) }),
					h('ol', { class: 'dolly-ob__phases' }, [
						phase('sliders-horizontal', __('Settings'), __('Language and brand, clock-in verification, hours, portal, reminders, certificates, anomalies and notifications.')),
						phase('map-pin', __('The first workplace'), __('Where employees clock in: position on the map and account for the tablet at the entrance.')),
						phase('user-plus', __('The first employee'), __('Account, working hours and assigned workplaces.')),
						phase('graduation-cap', __('The tutorial'), __('An interactive guided tour of every section of the panel.'))
					]),
					obNote(__('You can stop whenever you like: your progress is saved and the setup resumes from there. You can restart it at any time from Settings › Guided setup, and every choice can be changed later in Settings.'), 'info')
				] };
			} },

			{ id: 'language', group: 'settings', icon: 'languages', title: __('Language and brand'), intro: __('How the system presents itself to employees and in which language.'), build: function (ctx) {
				var s = ctx.d.settings, a = ctx.a.appearance;
				var langOptions = Object.keys(ctx.d.languages).map(function (k) { return { value: k, label: ctx.d.languages[k] }; });
				var language = DOLLY.field({ label: __('Default language'), name: 'language', type: 'select', value: s.language || 'auto', options: [{ value: 'auto', label: __('Same as site') + ' (' + ctx.d.site_language + ')' }].concat(langOptions) });
				var myLocale = DOLLY.field({ label: __('Your language in the dashboard'), name: 'my_locale', type: 'select', value: ctx.d.my_locale || '', options: [{ value: '', label: __('Default') }].concat(langOptions) });
				var brand = DOLLY.field({ label: __('Brand name'), name: 'brand_name', value: a.brand_name, required: true, attrs: { maxlength: 40 } });
				var title = DOLLY.field({ label: __('Admin dashboard name'), name: 'admin_title', value: a.admin_title, required: true, attrs: { maxlength: 40 } });
				var picked = '';
				var primary = colorField('primary', __('Primary color'), null, a.primary, function () {});
				var swatches = h('div', { class: 'dolly-swatches', role: 'group', 'aria-label': __('Ready-made color schemes') }, COLOR_PRESETS.map(function (p) {
					var b = h('button', { type: 'button', class: 'dolly-swatch', title: p.label, 'aria-pressed': p.color === a.primary ? 'true' : 'false' }, [h('span', { class: 'dolly-swatch__dot', style: 'background:' + p.color, 'aria-hidden': 'true' }), h('span', { text: p.label })]);
					b.addEventListener('click', function () {
						picked = p.color; primary.set(p.color);
						Array.prototype.forEach.call(swatches.children, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
					});
					return b;
				}));
				return {
					body: [
						h('div', { class: 'dolly-form-grid' }, [
							explained(language, [['change', __('Changes the language of the portal, sign-in pages, emails and notifications for whoever has not chosen a language. Each employee can pick another one in their profile.')]]),
							explained(myLocale, [['change', __('Changes only your panel. After saving, the page reloads in the new language and the setup continues.')]])
						]),
						h('div', { class: 'dolly-form-grid' }, [
							explained(brand, [['change', __('Shown on the sign-in pages, as the app name on employees\' phones, in notifications and as the email sender.')]]),
							explained(title, [['change', __('WordPress menu item and header of these pages.')]])
						]),
						explained(h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('Ready-made schemes') }), swatches, primary]), [
							['change', __('Buttons, links, the portal and panel headers and the workplace display take this color. The other shades are calculated automatically.')],
							['tip', __('Logo, app icon, fonts, dark mode and sign-in page texts are customized in Appearance.')]
						])
					],
					save: function () {
						var body = { brand_name: brand.input.value, admin_title: title.input.value, primary: primary.value() };
						if (picked && picked === primary.value()) { body.accent = picked; body.header_bg = picked; }
						var langChanged = language.input.value !== (s.language || 'auto') || myLocale.input.value !== (ctx.d.my_locale || '');
						this.reload = langChanged;
						return DOLLY.api('admin/appearance', { method: 'POST', body: body }).then(function (nd) {
							ctx.a = nd; applyAdminCss(nd.css);
							return DOLLY.api('admin/settings', { method: 'POST', body: { language: language.input.value } });
						}).then(function (nd) {
							ctx.d = nd;
							if (myLocale.input.value !== (ctx.d.my_locale || '')) { return DOLLY.api('me/language', { method: 'POST', body: { locale: myLocale.input.value } }); }
						});
					}
				};
			} },

			{ id: 'verification', group: 'settings', icon: 'shield-check', title: __('Clock-in verification'), intro: __('How the system checks that the employee is really at the workplace when clocking in.'), build: function (ctx) {
				var s = ctx.d.settings;
				var methods = DOLLY.chips({ label: __('Methods to verify attendance'), name: 'verification_methods', full: true, selected: s.verification_methods, options: Object.keys(ctx.d.verification_methods).map(function (k) { return { value: k, label: ctx.d.verification_methods[k] }; }) });
				var requireGps = DOLLY.switchControl({ label: __('Always also require GPS location'), name: 'verification_require_gps', checked: !!s.verification_require_gps });
				var radius = n('default_radius', __('Default GPS radius for new workplaces (meters)'), s.default_radius, 10, 5000);
				var grace = n('challenge_grace', __('Network tolerance for QR/PIN (seconds)'), s.challenge_grace, 0, 10);
				var pinMax = n('pin_max_attempts', __('Wrong PIN or Bluetooth attempts before lockout'), s.pin_max_attempts, 1, 50);
				var pinLock = n('pin_lock_minutes', __('PIN lockout duration (minutes)'), s.pin_lock_minutes, 1, 1440);
				return {
					body: [
						explained(methods, [
							['tip', __('GPS: the phone must be within the workplace radius. QR or PIN: the employee scans the QR or types the PIN shown by the workplace tablet; the code changes every few seconds. Bluetooth: the phone reads the code of a small device installed at the workplace.')],
							['change', __('With several methods on, the employee chooses the one they prefer. A method that is turned off can no longer be used by anyone.')]
						]),
						explained(requireGps, [
							['on', __('Besides the workplace code (QR/PIN or Bluetooth) the position is required too: maximum security, but the phone\'s GPS must be on. Requires at least the QR/PIN or Bluetooth method.')],
							['off', __('One of the active methods is enough.')]
						]),
						DOLLY.alert(__('Bluetooth: works with Chrome, Edge and Samsung Internet on Android. On iPhone you need the free Bluefy app, because Safari doesn\'t support Bluetooth for websites: keep another method enabled too if some employees use iPhone.'), 'info'),
						h('div', { class: 'dolly-form-grid' }, [
							explained(radius, [['change', __('Applies to new workplaces; each workplace then has its own radius, shown on the map. A small radius is more precise, but indoors GPS can be off by 20–50 m: 100 m is a good compromise.')]]),
							explained(grace, [['change', __('The QR/PIN changes every few seconds. With 0 the previous code is rejected right after the change; a few seconds avoid errors on slow networks.')]])
						]),
						h('div', { class: 'dolly-form-grid' }, [
							explained(pinMax, [['change', __('After this many wrong attempts the employee is locked out: it protects against guessing the code. A low value is safer but also locks out people who mistype.')]]),
							explained(pinLock, [['change', __('How long a locked-out employee cannot try again. You can unlock them earlier by creating an exception from their profile.')]])
						])
					],
					save: settingsSave(function () {
						return { verification_methods: methods.values(), verification_require_gps: requireGps.control.isOn(), default_radius: radius.input.value, challenge_grace: grace.input.value, pin_max_attempts: pinMax.input.value, pin_lock_minutes: pinLock.input.value };
					})
				};
			} },

			{ id: 'attendance', group: 'settings', icon: 'clock', title: __('Attendance and schedules'), intro: __('How breaks, late arrivals, exits and overtime are counted in the attendance sheet.'), build: function (ctx) {
				var s = ctx.d.settings;
				var lunch = DOLLY.switchControl({ label: __('Lunch break clock-in'), name: 'lunch_punch', checked: s.lunch_punch });
				var lateTol = n('late_tolerance', __('Late tolerance on clock-in (minutes)'), s.late_tolerance, 0, 120);
				var stepBox = h('div', { hidden: !s.exit_rounding });
				var step = n('rounding_step', __('Rounding interval (minutes)'), s.rounding_step, 1, 60);
				DOLLY.append(stepBox, explained(step, [['change', __('Example with a 15-minute step and a shift ending at 16:30: exit up to 16:37 → 16:30; from 16:38 to 16:52 → 16:45.')]]));
				var rounding = DOLLY.switchControl({ label: __('Clock-out rounding'), name: 'exit_rounding', checked: s.exit_rounding, onChange: function (on) { stepBox.hidden = !on; } });
				var overtime = n('overtime_auto', __('Automatically approved overtime (minutes per day)'), s.overtime_auto, 0, 1440);
				var holiday = n('holiday_increase', __('Holiday work premium (%)'), s.holiday_increase, 0, 300);
				return {
					body: [
						explained(lunch, [
							['on', __('Employees clock the start and end of their break: the actual break is subtracted from the hours worked.')],
							['off', __('The break is not clocked: the break set in each employee\'s schedule is subtracted automatically.')]
						]),
						explained(lateTol, [['change', __('An entry within these minutes from the start of the shift counts as on time (with 3: shift at 08:00, entry at 08:03 → 08:00). With 0 every minute of delay counts. Each workplace can have its own tolerance.')]]),
						explained(rounding, [
							['on', __('In the attendance sheet the exit after the end of the shift is rounded to the chosen step; the actual clock-out is still recorded.')],
							['off', __('The exact exit time is used.')]
						]),
						stepBox,
						h('div', { class: 'dolly-form-grid' }, [
							explained(overtime, [['change', __('Time after the end of the shift is overtime: up to this limit it is approved automatically (120 = 2 hours). Beyond it, a request to approve is created in Requests. With 0 all overtime needs approval.')]]),
							explained(holiday, [['change', __('Percentage shown for hours worked on public holidays and holiday closures, in the attendance sheet and in exports.')]])
						])
					],
					save: settingsSave(function () {
						return { lunch_punch: lunch.control.isOn(), late_tolerance: lateTol.input.value, exit_rounding: rounding.control.isOn(), rounding_step: step.input.value, overtime_auto: overtime.input.value, holiday_increase: holiday.input.value };
					})
				};
			} },

			{ id: 'portal', group: 'settings', icon: 'smartphone', title: __('Portal and devices'), intro: __('How employees access the portal from their phone.'), build: function (ctx) {
				var s = ctx.d.settings;
				var install = DOLLY.switchControl({ label: __('App installation required on phones'), name: 'require_install', checked: s.require_install !== false });
				var sessions = DOLLY.switchControl({ label: __('Device sessions'), name: 'device_sessions', checked: s.device_sessions !== false });
				return {
					body: [
						obNote(DOLLY.sprintf(__('Employees sign in at %s. The portal works like an app: it is added to the phone\'s Home screen and receives push notifications.'), CFG.portalUrl.replace('/portale/', '/accesso/')), 'smartphone'),
						explained(install, [
							['on', __('On phones, before signing in, the employee sees how to add the portal to the Home screen and can only sign in from the installed app. On the first sign-in the employee tutorial starts.')],
							['off', __('The portal can also be used from the browser, without installing it.')]
						]),
						explained(sessions, [
							['on', __('Each employee signs in from a single device: the first sign-in registers it. From another phone sign-in is refused until you unlink the previous one in Employees › Device management. It prevents clocking in for a colleague.')],
							['off', __('Employees can sign in from any device.')],
							['tip', __('Does not apply to administrators and workplace accounts. The limit can be raised for a single employee.')]
						])
					],
					save: settingsSave(function () { return { require_install: install.control.isOn(), device_sessions: sessions.control.isOn() }; })
				};
			} },

			{ id: 'reminders', group: 'settings', icon: 'alarm-clock', title: __('Clock-in reminders'), intro: __('Push notifications on the phone for those who forget to clock in or out.'), build: function (ctx) {
				var s = ctx.d.settings;
				var inMin = minutesList(s.reminder_entry_minutes, __('Minutes before shift start'), __('before'));
				var outMin = minutesList(s.reminder_exit_minutes, __('Minutes after shift end'), __('after'));
				var inBox = h('div', { hidden: !s.reminder_entry }, inMin.el);
				var outBox = h('div', { hidden: !s.reminder_exit }, outMin.el);
				var entry = DOLLY.switchControl({ label: __('Clock-in reminder'), name: 'reminder_entry', checked: !!s.reminder_entry, onChange: function (on) { inBox.hidden = !on; } });
				var exit = DOLLY.switchControl({ label: __('Clock-out reminder'), name: 'reminder_exit', checked: !!s.reminder_exit, onChange: function (on) { outBox.hidden = !on; } });
				return {
					body: [
						explained(entry, [
							['on', __('Whoever is due to work today and has not clocked in yet gets a notification at the chosen times (e.g. 10 and 5 minutes before).')],
							['off', __('No clock-in reminder.')]
						]),
						inBox,
						explained(exit, [
							['on', __('Whoever has not clocked out after the end of the shift gets a notification (e.g. 5 minutes after): it avoids "missing clock-out" anomalies.')],
							['off', __('No clock-out reminder.')]
						]),
						outBox,
						obNote(__('Reminders are not sent on rest days, holidays or closures, nor to anyone on leave, sick or on permission. They need the scheduler running ("System status" step) and notifications turned on by the employee.'), 'info')
					],
					save: settingsSave(function () { return { reminder_entry: entry.control.isOn(), reminder_entry_minutes: inMin.values(), reminder_exit: exit.control.isOn(), reminder_exit_minutes: outMin.values() }; })
				};
			} },

			{ id: 'oncall', group: 'settings', icon: 'phone-call', title: __('On-call contracts'), intro: __('On-call employees have no fixed days or hours: they start and end the shift when they are called, and each shift needs approval.'), build: function (ctx) {
				var s = ctx.d.settings;
				var box = h('div', { hidden: !s.oncall_auto });
				var threshold = n('oncall_threshold', __('Automatic approval threshold (minutes)'), s.oncall_threshold, 1, 1440);
				DOLLY.append(box, explained(threshold, [['change', __('A shift up to this threshold is approved automatically (120 = 2 hours); longer shifts must be approved in Requests.')]]));
				var auto = DOLLY.switchControl({ label: __('Automatic approval of short shifts'), name: 'oncall_auto', checked: s.oncall_auto, onChange: function (on) { box.hidden = !on; } });
				return {
					body: [
						explained(auto, [
							['on', __('Shifts within the threshold are approved automatically; you only approve the longer ones.')],
							['off', __('You approve all on-call hours manually in Requests.')]
						]),
						box
					],
					save: settingsSave(function () { return { oncall_auto: auto.control.isOn(), oncall_threshold: threshold.input.value }; })
				};
			} },

			{ id: 'smart', group: 'settings', icon: 'house', title: __('Remote work'), intro: __('Working remotely: it is set in each employee\'s schedule, for every day, for single days or for part of a day.'), build: function (ctx) {
				var s = ctx.d.settings;
				var auto = DOLLY.switchControl({ label: __('Automatic approval of remote work'), name: 'smart_auto', checked: s.smart_auto !== false });
				var how = function (icon, title, text) { return h('div', {}, [DOLLY.icon(icon), h('strong', { text: title }), h('span', { text: text })]); };
				return {
					body: [
						h('div', { class: 'dolly-ob__how' }, [
							how('calendar-check', __('Regular shifts'), __('One fixed timetable for every day: the «Remote work» switch makes the whole timetable remote.')),
							how('calendar-range', __('Different shifts'), __('A timetable for each day: each day is on site, remote or mixed.')),
							how('split', __('Mixed day'), __('An on-site slot and a remote slot that do not overlap (e.g. 9–13 at the office, 14–18 from home).'))
						]),
						obNote(__('When working remotely the employee clocks in and out with one tap: no GPS, QR/PIN or Bluetooth. On mixed days verification is only needed for the clock-ins of the on-site slot.'), 'house'),
						explained(auto, [
							['on', __('Remote-work hours count as soon as the employee clocks out.')],
							['off', __('Every day with remote-work hours goes to Requests for approval (and you get a notification). Until you approve it those hours do not count; if you reject it they stay excluded.')],
							['tip', __('Hours after the end of the shift still follow the overtime rules.')]
						])
					],
					save: settingsSave(function () { return { smart_auto: auto.control.isOn() }; })
				};
			} },

			{ id: 'sickness', group: 'settings', icon: 'stethoscope', title: __('Sickness and certificates'), intro: __('What the employee must provide after sickness, an injury or a blood donation.'), build: function (ctx) {
				var s = ctx.d.settings;
				var cm = certModes(ctx.d, 'certificate_mode', s.certificate_mode);
				var cdays = n('certificate_days', __('Calendar days for the certificate'), s.certificate_days, 1, 365);
				var dcm = certModes(ctx.d, 'donation_certificate_mode', s.donation_certificate_mode);
				var dcdays = n('donation_certificate_days', __('Calendar days for the donation certificate'), s.donation_certificate_days, 1, 365);
				var reqFile = DOLLY.switchControl({ label: __('Certificate file required'), name: 'certificate_require_file', checked: s.certificate_require_file !== false });
				var reqProt = DOLLY.switchControl({ label: __('Protocol number required'), name: 'certificate_require_protocol', checked: !!s.certificate_require_protocol });
				return {
					body: [
						explained(cm, [['tip', __('The employee reports sickness from the portal and uploads the certificate (photo or PDF); you find it in Requests › Sickness, injuries and certificates.')]]),
						explained(cdays, [['change', __('Used only with the deadline on: calendar days from the report within which the certificate must be uploaded.')]]),
						h('div', { class: 'dolly-form-grid' }, [
							explained(reqFile, [['on', __('The employee must upload the certificate file (PDF, JPG or PNG): without the file the report stays "Missing certificate".')], ['off', __('The file is optional.')]]),
							explained(reqProt, [['on', __('The employee must type the protocol number of the electronic certificate; you see it next to the report in Requests.')], ['off', __('The protocol number is optional.')]])
						]),
						obNote(__('With both off, either one is enough: the file or the protocol number.'), 'info'),
						explained(dcm, [['tip', __('Blood donation is requested from Requests; after approval the employee uploads the certificate from the day after the donation.')]]),
						explained(dcdays, [['change', __('Only used when the deadline is enabled: counted from the day after the donation.')]])
					],
					save: function (ctx2) {
						var go = settingsSave(function () { return { certificate_mode: cm.value(), certificate_days: cdays.input.value, donation_certificate_mode: dcm.value(), donation_certificate_days: dcdays.input.value, certificate_require_file: reqFile.control.isOn(), certificate_require_protocol: reqProt.control.isOn() }; });
						if (cm.value() === 'disabled' && s.certificate_mode !== 'disabled') {
							return DOLLY.confirm(__('Turn off certificates?'), __('All pending certificate requirements will be canceled and recorded in the change log.'), __('Turn off and save'), 'danger').then(function (ok) {
								if (!ok) { return Promise.reject({ cancelled: true }); }
								return go(ctx2);
							});
						}
						return go(ctx2);
					}
				};
			} },

			{ id: 'anomalies', group: 'settings', icon: 'triangle-alert', title: __('Anomalies'), intro: __('Anomalies flag what does not add up in attendance and stay open until you resolve them.'), build: function (ctx) {
				var s = ctx.d.settings;
				var box = h('div', { hidden: !s.absence_check });
				var delay = n('absence_delay', __('Minutes after shift start'), s.absence_delay, 0, 720);
				DOLLY.append(box, explained(delay, [['change', __('With no clock-in after this time the employee shows as "Absent without justification". A higher value leaves room for late arrivals.')]]));
				var check = DOLLY.switchControl({ label: __('Report unjustified absences'), name: 'absence_check', checked: s.absence_check, onChange: function (on) { box.hidden = !on; } });
				return {
					body: [
						explained(check, [
							['on', __('Whoever was due to work and did not clock in gets a notification and you find an anomaly to resolve; the employee can request a clock-in correction.')],
							['off', __('Absences without clock-in are not flagged.')],
							['tip', __('Excluding rest days, holidays, closures, leave, permissions and sickness.')]
						]),
						box,
						obNote(__('Always on: missing clock-out (no clock-out by 23:59) and missing certificate. Anomalies are resolved from the Anomalies section, by correcting the clock-in or justifying the absence.'), 'info')
					],
					save: settingsSave(function () { return { absence_check: check.control.isOn(), absence_delay: delay.input.value }; })
				};
			} },

			{ id: 'documents', group: 'settings', icon: 'folder-open', title: __('Documents'), intro: __('Contracts, tax certificates, payslips and other documents to send to employees.'), build: function (ctx) {
				var s = ctx.d.settings;
				var ev = (s.events && s.events.document_received) || { portal: true, email: true };
				var portal = DOLLY.switchControl({ label: __('In-app notification for a new document'), name: 'doc_portal', checked: ev.portal !== false });
				var email = DOLLY.switchControl({ label: __('Email for a new document'), name: 'doc_email', checked: ev.email !== false });
				return {
					body: [
						h('div', { class: 'dolly-ob__how' }, [
							h('div', {}, [DOLLY.icon('file-up'), h('strong', { text: _x('Sending', 'noun') }), h('span', { text: __('From the Documents section choose the employee, the category (Contract, Tax certificate, Payslip, Other or one of yours), a title and the file.') })]),
							h('div', {}, [DOLLY.icon('folder-open'), h('strong', { text: __('Archive') }), h('span', { text: __('For each employee you see the documents by category, whether they have opened them, and you can open or delete them.') })]),
							h('div', {}, [DOLLY.icon('lock'), h('strong', { text: __('Privacy') }), h('span', { text: __('The files are in a private folder, separate for each employee: only the employee and the administrators can see them.') })])
						]),
						h('div', { class: 'dolly-form-grid' }, [
							explained(portal, [['on', __('The employee sees the new document in the bell and gets a push notification on the phone.')], ['off', __('No in-app alert: the document still appears in the Documents section, with the counter of new ones.')]]),
							explained(email, [['on', __('The employee also gets an email (without attachment: the file can only be opened from the portal).')], ['off', __('No emails for new documents.')]])
						])
					],
					save: settingsSave(function () { return { events: { document_received: { portal: portal.control.isOn(), email: email.control.isOn() } } }; })
				};
			} },

			{ id: 'notifications', group: 'settings', icon: 'bell', title: __('Notifications'), intro: __('Who receives alerts about requests, anomalies and certificates, and on which channels.'), build: function (ctx) {
				var s = ctx.d.settings;
				var sw = function (name, label) { return DOLLY.switchControl({ label: label, name: name, checked: s[name] }); };
				var ePortal = sw('notify_portal', __('Employees: in-app notifications')), eEmail = sw('notify_email', __('Employees: email'));
				var aPortal = sw('admin_notify_portal', __('Administrators: panel notifications')), aEmail = sw('admin_notify_email', __('Administrators: email'));
				var recipients = DOLLY.chips({ label: __('Administrators who receive notifications'), name: 'admin_recipients', selected: s.admin_recipients, options: ctx.d.admins.map(function (x) { return { value: x.id, label: x.name + ' (' + x.email + ')' }; }) });
				return {
					body: [
						h('div', { class: 'dolly-form-grid' }, [
							explained(ePortal, [['on', __('Portal bell and push notification on the phone (if the employee turned them on), for request outcomes, anomalies and certificates.')], ['off', __('No in-app notification for any event; statuses and anomalies stay visible in the portal.')]]),
							explained(eEmail, [['on', __('The same alerts also arrive by email.')], ['off', __('No emails to employees.')]])
						]),
						h('div', { class: 'dolly-form-grid' }, [
							explained(aPortal, [['on', __('Bell at the top of the panel (and push if turned on) for new requests, sickness, overtime and certificates.')], ['off', __('No alerts in the panel: you check the sections yourself.')]]),
							explained(aEmail, [['on', __('The same alerts arrive by email to the administrators chosen below.')], ['off', __('No emails to administrators.')]])
						]),
						explained(recipients, [['change', __('No selection = all administrators receive notifications.')]]),
						obNote(__('In Settings › Notifications you can choose event by event what to send and on which channel.'), 'lightbulb')
					],
					save: settingsSave(function () { return { notify_portal: ePortal.control.isOn(), notify_email: eEmail.control.isOn(), admin_notify_portal: aPortal.control.isOn(), admin_notify_email: aEmail.control.isOn(), admin_recipients: recipients.values().map(Number) }; })
				};
			} },

			{ id: 'system', group: 'settings', icon: 'activity', title: __('System status'), intro: __('Every minute the scheduler runs reminders, anomaly checks, certificate deadlines and the sending of emails and notifications.'), build: function (ctx) {
				var c = ctx.d.cron;
				var item = function (ok, label, bad) { return h('li', {}, [ok ? DOLLY.badge('OK', 'green', 'circle-check') : DOLLY.badge(__('To review'), 'amber', 'circle-alert'), ' ', label, !ok && bad ? h('div', { class: 'dolly-help', text: bad }) : null]); };
				var result = h('div', { 'aria-live': 'polite' });
				var testMail = DOLLY.button(__('Send test email'), { icon: 'mail', onClick: function () {
					DOLLY.busy(testMail, DOLLY.api('admin/test-email', { method: 'POST' })).then(function (r) { DOLLY.render(result, DOLLY.alert(r.message, r.ok ? 'success' : 'error')); }, function (err) { DOLLY.render(result, DOLLY.alert(err.message, 'error')); });
				} });
				return {
					next: __('Continue'),
					body: [
						h('ul', { class: 'dolly-stack dolly-ob__checks' }, [
							item(c.healthy, __('Scheduler every minute'), __('Without a system cron the checks only run when someone visits the site: reminders and anomalies may arrive late.')),
							item(ctx.d.storage.https, __('HTTPS active'), __('GPS, camera (QR), Bluetooth and push notifications only work over HTTPS.')),
							ctx.d.push ? item(ctx.d.push.available, __('Push notifications on phones'), __('The server\'s OpenSSL does not support EC keys (P-256): push notifications are not available, in-app notifications still work.')) : null
						]),
						explained(h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('System cron command (one of the two options, every minute):') }), h('pre', { class: 'dolly-code', text: '* * * * * ' + c.wp_cli + ' >/dev/null 2>&1\n* * * * * curl -fsS "' + c.cron_url + '" >/dev/null 2>&1' })]), [
							['tip', __('Ask your hosting provider to add one of the two commands. The address contains a secret key: do not share it.')]
						]),
						explained(h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('Email') }), h('div', { class: 'dolly-btn-row' }, testMail), result]), [
							['tip', __('Send a test email to your address: if it does not arrive, set up an SMTP plugin before adding employees.')]
						])
					]
				};
			} },

			{ id: 'workplace', group: 'workplace', icon: 'map-pin', title: __('The first workplace'), intro: __('The workplace is where employees clock in. You can add more at any time from the Workplaces section.'), build: function () {
				var list = h('div', { class: 'dolly-ob__list' });
				function draw() {
					var active = (CFG.workplaces || []);
					DOLLY.render(list, active.length ? active.map(function (w) {
						return h('div', { class: 'dolly-ob__item' }, [
							h('span', { class: 'dolly-ob__item-icon' }, DOLLY.icon('map-pin')),
							h('div', { class: 'dolly-ob__item-text' }, [h('strong', { text: w.name }), h('span', { class: 'dolly-small dolly-muted', text: [w.address, w.city].filter(Boolean).join(', ') || __('Address not given') }),
								h('div', { class: 'dolly-ob__badges' }, [
									w.lat !== null ? DOLLY.badge(__('Position set'), 'green', 'circle-check') : DOLLY.badge(__('Position missing'), 'amber', 'triangle-alert'),
									w.account_username ? DOLLY.badge(__('Tablet account: ') + w.account_username, 'blue', 'monitor') : DOLLY.badge(__('Tablet account missing'), 'amber', 'triangle-alert')
								])]),
							DOLLY.button(__('Edit'), { size: 'sm', icon: 'pencil', onClick: function () { workplaceDialog(w, reload); } })
						]);
					}) : DOLLY.empty(__('No workplaces'), __('Create the first workplace to continue.'), 'map-pin'));
					DOLLY.icons();
				}
				function reload() { refreshWorkplaces().then(draw); }
				draw();
				return {
					body: [
						h('div', { class: 'dolly-ob__how' }, [
							h('div', {}, [DOLLY.icon('map'), h('strong', { text: __('Position on the map') }), h('span', { text: __('Search for the address or tap the map at the entrance: the circle shows the area where GPS clock-in is allowed.') })]),
							h('div', {}, [DOLLY.icon('monitor'), h('strong', { text: __('Tablet at the entrance') }), h('span', { text: DOLLY.sprintf(__('With the workplace account the tablet opens %s and shows a QR and a PIN that change every few seconds.'), CFG.portalUrl.replace('/portale/', '/accesso-sede/')) })]),
							h('div', {}, [DOLLY.icon('bluetooth'), h('strong', { text: __('Bluetooth (optional)') }), h('span', { text: __('After saving, the Bluetooth button in Workplaces lets you set up the small device to install at the workplace.') })])
						]),
						list,
						h('div', { class: 'dolly-btn-row' }, DOLLY.button(__('Add a workplace'), { variant: 'primary', icon: 'plus', onClick: function () { workplaceDialog(null, reload); } }))
					],
					check: function () { return (CFG.workplaces || []).some(function (w) { return w.active; }) ? '' : __('Create at least one active workplace to continue.'); },
					next: __('Continue')
				};
			} },

			{ id: 'employee', group: 'employee', icon: 'user-plus', title: __('The first employee'), intro: __('Create the employee\'s account: they will get a username and password to access the portal from their phone.'), build: function () {
				var list = h('div', { class: 'dolly-ob__list' });
				var formBox = h('div');
				var employees = employeesCache || [];
				function drawList() {
					DOLLY.render(list, employees.length ? employees.slice(0, 6).map(function (e) {
						return h('div', { class: 'dolly-ob__item' }, [h('span', { class: 'dolly-ob__item-icon' }, DOLLY.icon('user')), h('div', { class: 'dolly-ob__item-text' }, h('strong', { text: e.name }))]);
					}).concat(employees.length > 6 ? [h('p', { class: 'dolly-small dolly-muted', text: DOLLY.sprintf(__('and %d more employees'), employees.length - 6) })] : []) : null);
					DOLLY.icons();
				}
				function drawForm() {
					var form = employeeForm(null, true);
					var btn = DOLLY.button(__('Create employee'), { type: 'submit', variant: 'primary', icon: 'user-plus' });
					form.appendChild(h('div', { class: 'dolly-btn-row' }, btn));
					form.addEventListener('submit', function (ev) {
						ev.preventDefault();
						var body = form.collect();
						if (!body) { return; }
						DOLLY.busy(btn, DOLLY.api('admin/employees', { method: 'POST', body: body })).then(function (emp) {
							allEmployees(true).then(function (l) { employees = l; drawList(); });
							DOLLY.render(formBox, [
								DOLLY.alert(DOLLY.sprintf(__('%1$s (%2$s) has been created. Give them the username and password: they sign in at %3$s.'), emp.name, emp.username, CFG.portalUrl.replace('/portale/', '/accesso/')), 'success'),
								h('div', { class: 'dolly-btn-row' }, DOLLY.button(__('Add another employee'), { icon: 'user-plus', onClick: drawForm }))
							]);
							DOLLY.icons();
						}, form.fail);
					});
					DOLLY.render(formBox, h('div', { class: 'dolly-ob__subcard' }, form));
					DOLLY.icons();
				}
				drawList();
				if (employees.length) {
					DOLLY.render(formBox, h('div', { class: 'dolly-btn-row' }, DOLLY.button(__('Add an employee'), { icon: 'user-plus', onClick: drawForm })));
				} else { drawForm(); }
				return {
					body: [
						h('div', { class: 'dolly-ob__how' }, [
							h('div', {}, [DOLLY.icon('id-card'), h('strong', { text: __('Details and access') }), h('span', { text: __('The username cannot be changed; you give them the initial password and the employee can change it.') })]),
							h('div', {}, [DOLLY.icon('clock'), h('strong', { text: __('Schedule and remote work') }), h('span', { text: __('Working days and hours (regular shifts or different shifts per day) and remote work: every day, some days or mixed days. On-call contracts need no schedule.') })]),
							h('div', {}, [DOLLY.icon('map-pin'), h('strong', { text: __('Workplaces and validity') }), h('span', { text: __('The employee can only clock in at the assigned workplaces. "Valid from" lets you change hours and workplaces in the future without touching the history.') })])
						]),
						list,
						formBox
					],
					next: __('Continue'),
					confirm: function () {
						if (employees.length) { return Promise.resolve(true); }
						return DOLLY.confirm(__('Continue without employees?'), __('You can create them later from New employee.'), __('Continue'));
					}
				};
			} },

			{ id: 'finish', group: 'tour', icon: 'party-popper', title: __('All set'), next: __('Start the tutorial'), nextIcon: 'circle-play', build: function () {
				var done = function (icon, text) { return h('li', {}, [DOLLY.icon(icon), h('span', { text: text })]); };
				return {
					body: [
						h('p', { class: 'dolly-ob__lead', text: __('The setup is complete. Now we show you how to use the panel every day: an interactive tutorial goes through every section and explains what it is for.') }),
						h('ul', { class: 'dolly-ob__done' }, [
							done('circle-check', __('Settings saved')),
							done('circle-check', DOLLY.sprintf(__('Workplaces: %d'), (CFG.workplaces || []).length)),
							done('circle-check', DOLLY.sprintf(__('Employees: %d'), (employeesCache || []).length))
						]),
						obNote(__('The tutorial takes about 3 minutes. You can stop it whenever you like and watch it again from Settings › Guided setup.'), 'graduation-cap')
					],
					secondary: { label: __('Go to the dashboard'), icon: 'layout-dashboard', run: function () {
						return DOLLY.api('admin/tour', { method: 'POST', body: { state: 'skipped' } }).then(function () { window.location.href = CFG.pages.dashboard; });
					} },
					finish: function () { tourStart(); }
				};
			} }
		];
	}

	var OB_GROUPS = { start: __('Welcome'), settings: __('Settings'), workplace: __('Workplace'), employee: __('Employees'), tour: __('Tutorial') };

	function pageOnboarding() {
		DOLLY.render(main, DOLLY.loading());
		Promise.all([DOLLY.api('admin/settings'), DOLLY.api('admin/appearance'), refreshWorkplaces(), allEmployees(true)]).then(function (r) {
			runOnboarding({ d: r[0], a: r[1] });
		}, function (err) { DOLLY.render(main, DOLLY.errorState(err, pageOnboarding)); });
	}

	function runOnboarding(ctx) {
		var steps = onboardingSteps();
		var ids = steps.map(function (s) { return s.id; });
		var ob = CFG.onboarding || {};
		var at = Math.max(0, ids.indexOf(ob.step));
		var reached = ob.done ? steps.length - 1 : at;
		var rail = h('nav', { class: 'dolly-ob__rail', 'aria-label': __('Setup steps') });
		var panel = h('section', { class: 'dolly-card dolly-ob__panel', tabindex: '-1' });
		DOLLY.render(main, h('div', { class: 'dolly-ob' }, [rail, panel]));

		function saveStep(id) {
			return DOLLY.api('admin/onboarding', { method: 'POST', body: { step: id } }).then(function (c) { CFG.onboarding = c; });
		}

		function drawRail() {
			var pct = Math.round(at / (steps.length - 1) * 100);
			var groups = [];
			steps.forEach(function (s, i) {
				var g = groups[groups.length - 1];
				if (!g || g.id !== s.group) { g = { id: s.group, items: [] }; groups.push(g); }
				g.items.push(i);
			});
			DOLLY.render(rail, [
				h('div', { class: 'dolly-ob__rail-head' }, [
					h('strong', { text: __('Guided setup') }),
					h('span', { class: 'dolly-small dolly-muted', text: DOLLY.sprintf(__('%d%% complete'), pct) })
				]),
				h('div', { class: 'dolly-ob__progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': __('Progress') }, h('span', { style: 'width:' + pct + '%' })),
				h('div', { class: 'dolly-ob__groups' }, groups.map(function (g) {
					return h('div', { class: 'dolly-ob__group' }, [
						h('span', { class: 'dolly-ob__group-label', text: OB_GROUPS[g.id] }),
						h('ol', {}, g.items.map(function (i) {
							var s = steps[i], state = i === at ? 'is-current' : (i < reached || (i <= reached && i < at) ? 'is-done' : '');
							var b = h('button', { type: 'button', class: 'dolly-ob__step ' + state, disabled: i > reached ? true : null, 'aria-current': i === at ? 'step' : null }, [
								h('span', { class: 'dolly-ob__dot', 'aria-hidden': 'true' }, state === 'is-done' ? DOLLY.icon('check') : String(i + 1)),
								h('span', { text: s.title })
							]);
							b.addEventListener('click', function () { if (i !== at) { show(i); } });
							return h('li', {}, b);
						}))
					]);
				}))
			]);
		}

		function drawPanel() {
			var s = steps[at];
			var built = s.build(ctx);
			var alertBox = h('div', { hidden: true });
			var form = h('div', { class: 'dolly-form dolly-ob__body' }, [alertBox].concat(built.body));
			var next = DOLLY.button(built.next || s.next || __('Save and continue'), { variant: 'primary', icon: s.nextIcon || 'arrow-right', onClick: submit });
			var back = at > 0 ? DOLLY.button(__('Back'), { icon: 'arrow-left', variant: 'ghost', onClick: function () { show(at - 1); } }) : null;
			var secondary = built.secondary ? DOLLY.button(built.secondary.label, { icon: built.secondary.icon, onClick: function () {
				DOLLY.busy(secondary, DOLLY.api('admin/onboarding', { method: 'POST', body: { complete: true } }).then(built.secondary.run)).catch(function (err) { DOLLY.toast(err.message, 'error'); });
			} }) : null;
			function submit() {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var err = built.check ? built.check() : '';
				if (err) { DOLLY.render(alertBox, DOLLY.alert(err, 'warning')); alertBox.hidden = false; alertBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
				var flow = (built.confirm ? built.confirm() : Promise.resolve(true)).then(function (ok) {
					if (!ok) { return Promise.reject({ cancelled: true }); }
					return built.save ? built.save.call(built, ctx) : null;
				}).then(function () {
					if (built.finish) {
						return DOLLY.api('admin/onboarding', { method: 'POST', body: { complete: true } }).then(function (c) { CFG.onboarding = c; built.finish(); });
					}
					return saveStep(ids[at + 1]).then(function () {
						if (built.reload) { window.location.reload(); return; }
						show(at + 1);
					});
				});
				DOLLY.busy(next, flow).catch(function (e) {
					if (e && e.cancelled) { return; }
					DOLLY.formError(form, e, alertBox);
				});
			}
			DOLLY.render(panel, [
				h('div', { class: 'dolly-ob__head' }, [
					h('span', { class: 'dolly-ob__icon', 'aria-hidden': 'true' }, DOLLY.icon(s.icon)),
					h('div', {}, [
						h('span', { class: 'dolly-ob__eyebrow', text: DOLLY.sprintf(__('Step %1$d of %2$d'), at + 1, steps.length) + ' · ' + OB_GROUPS[s.group] }),
						h('h2', { class: 'dolly-ob__title', text: s.id === 'welcome' ? DOLLY.sprintf(__('Welcome to %s'), DOLLY.brandName) : s.title }),
						s.intro ? h('p', { class: 'dolly-ob__intro', text: s.intro }) : null
					])
				]),
				form,
				h('div', { class: 'dolly-ob__foot' }, [back, h('span', { class: 'dolly-ob__spacer' }), secondary, next])
			]);
			DOLLY.icons();
		}

		function show(i) {
			at = i; reached = Math.max(reached, i);
			drawRail(); drawPanel();
			panel.classList.remove('is-entering'); void panel.offsetWidth; panel.classList.add('is-entering');
			window.scrollTo({ top: 0, behavior: 'smooth' });
			panel.focus({ preventScroll: true });
		}
		show(at);
	}

	/* ------------------------------------------------------------------ */
	/* Administrators' tutorial: an interactive tour across the sections   */
	/* ------------------------------------------------------------------ */

	var TOUR_KEY = 'dolly_admin_tour_step';
	function nav(page) { return '.dolly-admin__navlink[href$="=dolly-' + page + '"]'; }
	function navLabel(page) {
		var a = document.querySelector(nav(page));
		return a ? a.textContent.trim() : page;
	}
	/** Step on the menu link of the next section: the administrator taps it to move on. */
	function go(from, page, section) {
		var label = navLabel(page);
		return {
			page: from, section: section, nav: page, target: nav(page), mode: 'click', scroll: true, tap: true, hint: __('Tap the highlighted section'),
			title: DOLLY.sprintf(__('Next section: %s'), label), text: [h('p', { text: DOLLY.sprintf(__('Tap "%s" in the menu to continue.'), label) })]
		};
	}

	function tourSteps() {
		var p = function (t) { return h('p', { text: t }); };
		var ul = function (items) { return h('ul', {}, items.map(function (t) { return h('li', { text: t }); })); };
		return [
			{ page: 'dashboard', section: __('Dashboard'), title: DOLLY.sprintf(__('Welcome to %s'), DOLLY.brandName), text: [p(__('This tutorial takes you through every section of the panel. You can go forward, go back or stop whenever you like.')), p(__('In some steps we ask you to tap the highlighted element yourself: you learn by doing.'))], next: __('Let\'s start') },
			{ page: 'dashboard', section: __('Dashboard'), target: '.dolly-admin__nav', title: __('The sections'), text: [p(__('From this menu you reach every section. The Dashboard is the home page: today\'s situation at a glance.'))] },
			{ page: 'dashboard', section: __('Dashboard'), target: '.dolly-admin__bell', title: __('Notifications'), text: [p(__('New requests, sickness reports, overtime to approve and certificates arrive here. The number shows the unread notifications.'))] },
			{ page: 'dashboard', section: __('Dashboard'), target: '.dolly-dash__toolbar', title: __('Filter by workplace'), text: [p(__('Choose a workplace to see only its data. The page refreshes by itself every few seconds.'))] },
			{ page: 'dashboard', section: __('Dashboard'), target: '#dolly-admin-main > .dolly-grid--4', scroll: true, title: __('Today\'s numbers'), text: [p(__('Present, on break, pending requests and open anomalies. Tap the links to go straight to the section.'))] },
			{ page: 'dashboard', section: __('Dashboard'), target: '#dolly-admin-main > .dolly-grid--2', scroll: true, title: __('Attendance and latest requests'), text: [p(__('Who clocked in today and at what time, and the latest employee requests to approve.'))] },
			{ page: 'dashboard', section: __('Dashboard'), target: '.dolly-dash__bottom > :first-child', scroll: true, title: __('Calendar and closures'), text: [p(__('Holidays, leave and company closures. Tap a day to set a closure: on closed days a missing clock-in creates no anomaly, and whoever works anyway gets the holiday increase.'))] },
			{ page: 'dashboard', section: __('Dashboard'), target: '.dolly-dash__bottom > :last-child', scroll: true, title: __('Attendance trend'), text: [p(__('Present, absent and late in recent days. For deeper analysis there is the Analytics section.'))] },
			go('dashboard', 'workplaces', __('Dashboard')),
			{ page: 'workplaces', section: __('Workplaces'), target: '#dolly-admin-main .dolly-toolbar', title: __('Workplaces'), text: [p(__('Each workplace is a place where employees clock in. With "New workplace" you set the name, the position on the map, the radius and the account for the tablet at the entrance.'))] },
			{ page: 'workplaces', section: __('Workplaces'), target: '#dolly-admin-main .dolly-table, #dolly-admin-main .dolly-empty', title: __('Workplace list'), text: [ul([__('Coordinates and radius: where GPS clock-in works.'), __('Late tolerance: can differ for each workplace.'), __('Bluetooth: set up the device to install at the workplace.'), __('Edit: move the pin on the map or change the tablet password.')])] },
			{ page: 'workplaces', section: __('Workplaces'), title: __('The workplace display'), text: [p(DOLLY.sprintf(__('On the tablet at the entrance open %s and sign in with the workplace account. The screen shows a QR and a PIN that change every few seconds: the employee scans or types them to clock in.'), CFG.portalUrl.replace('/portale/', '/accesso-sede/'))), p(__('The tablet can also act as a Bluetooth bridge for phones that do not support it.'))] },
			go('workplaces', 'employees', __('Workplaces')),
			{ page: 'employees', section: __('Employees'), target: '#dolly-admin-main .dolly-tabs', title: __('Employees and devices'), text: [p(__('The first tab lists the employees; "Device management" shows the linked phones, to unlink when an employee changes phone.'))] },
			{ page: 'employees', section: __('Employees'), target: '#dolly-admin-main .dolly-toolbar', title: __('Search and filter'), text: [p(__('Search by name, filter by status and workplace. "New employee" opens account creation.'))] },
			{ page: 'employees', section: __('Employees'), target: '#dolly-admin-main .dolly-table, #dolly-admin-main .dolly-empty', title: __('The employee profile'), text: [p(__('Tap an employee to open their profile:')), ul([__('Details, hours and workplaces, with the history of changes.'), __('Exceptions: allow clocking in away from the workplace or without verification for a period.'), __('Deactivate the account when employment ends: the history stays.')])] },
			go('employees', 'employee-new', __('Employees')),
			{ page: 'employee-new', section: navLabel('employee-new'), target: '#dolly-admin-main .dolly-card', title: __('New employee'), text: [p(__('Here you create a new account: personal details, working hours, workplaces and bank details. The employee signs in from their phone with username and password. The same tabs are used to edit it from Employees › Manage.'))] },
			{ page: 'employee-new', section: navLabel('employee-new'), target: '[data-name="employment_type"]', scroll: true, title: __('Contract type'), text: [p(__('Full time, part time or on-call contract. On call there are no fixed days or hours: each shift is approved.'))] },
			{ page: 'employee-new', section: navLabel('employee-new'), target: '[data-tour="per-day"]', scroll: true, title: __('Regular or different shifts'), text: [p(__('Off (regular shifts): one fixed timetable for the selected days. On (different shifts): each day has its own timetable and mode: on site, remote or mixed, with an on-site slot and a remote slot that do not overlap.'))] },
			{ page: 'employee-new', section: navLabel('employee-new'), target: '[data-tour="smart"]', scroll: true, title: __('Remote work'), text: [p(__('With regular shifts this switch makes every day remote. When working remotely the employee clocks in and out with one tap, without GPS, QR/PIN or Bluetooth.')), p(__('Remote-work hours are approved automatically or by you, as set in Settings › Remote work.'))] },
			go('employee-new', 'requests', navLabel('employee-new')),
			{ page: 'requests', section: __('Requests'), target: '#dolly-admin-main .dolly-tabs', title: __('Requests and sickness'), text: [p(__('Leave, permissions, donations, overtime, on-call shifts and clock-in corrections in one tab; sickness, injuries and certificates in the other.'))] },
			{ page: 'requests', section: __('Requests'), target: '#dolly-admin-main .dolly-toolbar', title: __('Approve or reject'), text: [p(__('Filter by status, type and workplace. Each request has Approve and Reject buttons; the employee gets the outcome right away. You can also enter an authorization on behalf of an employee.'))] },
			{ page: 'requests', section: __('Requests'), target: '#dolly-admin-main .dolly-tabs', title: __('Shifts and remote work to approve'), text: [p(__('On-call shifts also arrive here and, if automatic approval is off, remote-work days: until you approve them those hours do not count in attendance.')), p(__('For sickness you see the uploaded certificate and the protocol number entered by the employee.'))] },
			go('requests', 'attendance', __('Requests')),
			{ page: 'attendance', section: __('Attendance'), target: '.dolly-att-modes', title: __('By employee or by day'), text: [p(__('An employee\'s monthly sheet, or all employees on one day.'))] },
			{ page: 'attendance', section: __('Attendance'), target: '.dolly-att-modes + div', title: __('The attendance sheet'), text: [p(__('Entries, breaks, exits, regular hours, overtime and absences. You can correct a clock-in (it stays traced in the log), print and export to CSV.'))] },
			go('attendance', 'documents', __('Attendance')),
			{ page: 'documents', section: navLabel('documents'), target: '[data-tour="doc-toolbar"]', title: __('Employee documents'), text: [p(__('Search for the employee by name, username or email. The list is split into pages and shows how many documents each one has and the last one sent.'))] },
			{ page: 'documents', section: navLabel('documents'), target: '[data-tour="doc-actions"]', title: __('Send or browse'), text: [p(__('The first button sends a document: choose the category, write a title and an optional description, and choose the file. The employee gets a notification.')), p(__('The second opens the employee\'s archive by category: you see whether they opened each document, and you can open or delete it.'))] },
			{ page: 'documents', section: navLabel('documents'), target: '[data-tour="doc-categories"]', title: __('Categories'), text: [p(__('Contract, Tax certificate, Payslip and Other are always there; here you add your own. The files stay in a private folder, separate for each employee.'))] },
			go('documents', 'analytics', navLabel('documents')),
			{ page: 'analytics', section: __('Analytics'), target: '#dolly-admin-main > :first-child', title: __('Analytics'), text: [p(__('Punctuality, absences, overtime and hours worked by period, workplace and employee, with charts and export.'))] },
			go('analytics', 'anomalies', __('Analytics')),
			{ page: 'anomalies', section: __('Anomalies'), target: '#dolly-admin-main .dolly-card', title: __('Anomalies'), text: [p(__('Unjustified absences, missing clock-outs and missing certificates. Resolve them by correcting the clock-in or justifying the absence: the employee is notified.'))] },
			go('anomalies', 'broadcast', __('Anomalies')),
			{ page: 'broadcast', section: navLabel('broadcast'), target: '#dolly-admin-main .dolly-card', title: navLabel('broadcast'), text: [p(__('Messages to everyone, to a workplace or to single employees, right away or scheduled: they arrive as in-app notifications and optionally by email.'))] },
			go('broadcast', 'exports', navLabel('broadcast')),
			{ page: 'exports', section: __('Exports'), target: '#dolly-admin-main > :first-child', title: __('Exports'), text: [p(__('Attendance for the payroll consultant, requests, certificates and employee data in CSV or ZIP.'))] },
			go('exports', 'appearance', __('Exports')),
			{ page: 'appearance', section: __('Appearance'), target: '.dolly-appearance__preview', title: __('Appearance'), text: [p(__('Logo, colors, fonts, dark mode, sign-in page and emails: the preview shows the result as you edit.'))] },
			go('appearance', 'settings', __('Appearance')),
			{ page: 'settings', section: __('Settings'), target: '[data-tour="setup"]', scroll: true, title: __('Guided setup'), text: [p(__('From here you restart the guided setup or watch this tutorial again whenever you like.'))] },
			{ page: 'settings', section: __('Settings'), target: '[data-tour="smart-settings"]', scroll: true, title: __('Remote work and certificates'), text: [p(__('Choose whether remote-work hours are approved automatically or by you, and whether the medical certificate needs the file, the protocol number or both.'))] },
			{ page: 'settings', section: __('Settings'), target: '#dolly-admin-main form > .dolly-card', scroll: true, title: __('All settings'), text: [p(__('The same choices as the guided setup, plus notifications event by event and the system status at the bottom of the page.'))] },
			{ page: 'settings', section: __('Settings'), title: __('You\'re done!'), text: [p(__('Now you know every section of the panel. Employees get their own tutorial the first time they sign in from their phone.')), p(__('Have a good day at work!'))], next: __('End'), nextIcon: 'check', noSkip: true, media: h('div', { class: 'dolly-ob__cheer', 'aria-hidden': 'true' }, DOLLY.icon('party-popper')) }
		];
	}

	function tourGet() {
		try { var v = window.sessionStorage.getItem(TOUR_KEY); return v === null ? -1 : parseInt(v, 10); } catch (e) { return -1; }
	}
	function tourSet(i) {
		try { if (i < 0) { window.sessionStorage.removeItem(TOUR_KEY); } else { window.sessionStorage.setItem(TOUR_KEY, String(i)); } } catch (e) { /* storage unavailable */ }
	}
	function tourStart(from) {
		tourSet(from || 0);
		var first = tourSteps()[from || 0];
		if (CFG.page === first.page) { tourRun(); } else { window.location.href = CFG.pages[first.page]; }
	}
	function tourEnd(state) {
		tourSet(-1);
		DOLLY.coach.end();
		DOLLY.api('admin/tour', { method: 'POST', body: { state: state } }).then(function (c) { CFG.onboarding = c; });
		if (state === 'done') { DOLLY.toast(__('Tutorial completed.'), 'success'); } else { DOLLY.toast(__('You can watch the tutorial again from Settings › Guided setup.'), 'info'); }
	}
	function tourRun() {
		var steps = tourSteps(), i = tourGet();
		if (i < 0 || i >= steps.length) { return; }
		var step = steps[i];
		if (step.page !== CFG.page) { window.location.href = CFG.pages[step.page]; return; }
		// A tap on a menu link leaves the page: remember the next step first.
		if (step.nav) { tourSet(i + 1); }
		DOLLY.coach.show(Object.assign({}, step, {
			progress: step.section + ' · ' + (i + 1) + ' / ' + steps.length,
			back: i > 0,
			next: step.next || (i === steps.length - 1 ? __('End') : null),
			mode: step.mode || 'next'
		})).then(function (res) {
			if (res === 'end') { return; }
			if (res === 'skip') { tourEnd('skipped'); return; }
			if (res === 'back') { tourSet(i - 1); tourRun(); return; }
			if (step.nav) { return; }
			if (i === steps.length - 1) { tourEnd('done'); return; }
			tourSet(i + 1); tourRun();
		});
	}

	/** On every admin screen: continue a running tour, invite to the tour or to finish the setup. */
	function guide() {
		var ob = CFG.onboarding;
		if (!ob || CFG.page === 'onboarding') { return; }
		if (tourGet() >= 0) { setTimeout(tourRun, 300); return; }
		if (!ob.done) {
			app.insertBefore(h('div', { class: 'dolly-ob-banner' }, DOLLY.alert(__('The guided setup is not complete yet.'), 'warning',
				h('div', { class: 'dolly-btn-row', style: 'margin-top:8px' }, DOLLY.button(__('Resume the setup'), { size: 'sm', variant: 'primary', icon: 'arrow-right', href: ob.url })))), main);
			DOLLY.icons();
			return;
		}
		if (!ob.tour) {
			// Setup already done (for example by another administrator): only the tour.
			setTimeout(function () {
				DOLLY.coach.show({
					title: DOLLY.sprintf(__('Hi %s!'), CFG.userName || ''),
					text: [h('p', { text: __('A short interactive tutorial shows you how the dashboard, workplaces, employees, requests and the other sections of the panel work.') })],
					media: h('div', { class: 'dolly-ob__cheer', 'aria-hidden': 'true' }, DOLLY.icon('graduation-cap')),
					next: __('Start the tutorial'), nextIcon: 'circle-play', skip: __('Not now')
				}).then(function (res) {
					if (res === 'next') { tourStart(0); } else if (res === 'skip') { tourEnd('skipped'); }
				});
			}, 500);
		}
	}

	/* ------------------------------------------------------------------ */
	/* Boot                                                               */
	/* ------------------------------------------------------------------ */

	var pages = {
		dashboard: pageDashboard, employees: pageEmployees, 'employee-new': pageEmployeeNew, workplaces: pageWorkplaces,
		requests: pageRequests, attendance: pageAttendance, analytics: pageAnalytics, anomalies: pageAnomalies, broadcast: pageBroadcast, exports: pageExports, appearance: pageAppearance, settings: pageSettings,
		documents: pageDocuments, onboarding: pageOnboarding
	};
	menuToggle();
	headerBell();
	(pages[CFG.page] || pageDashboard)();
	guide();
	DOLLY.icons();
})(window, document);
