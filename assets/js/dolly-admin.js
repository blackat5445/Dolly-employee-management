/**
 * "Gestione Dipendenti" administration screens (Dashboard, Dipendenti, Nuovo dipendente, Sedi,
 * Richieste, Presenze, Analytics, Anomalie, Esportazioni, Impostazioni) built on the REST API.
 */
(function (window, document) {
	'use strict';

	var DOLLY = window.DOLLY, h = DOLLY.h, CFG = DOLLY.config, __ = DOLLY.__;

	// Chart colours from the theme (Aspetto): the same meaning always has the same colour.
	var C = {
		primary: DOLLY.token('primary', '#2563EB'), amber: DOLLY.token('amber-solid', '#B45309'), grey: DOLLY.token('track', '#94A3B8'),
		green: DOLLY.token('green-solid', '#15803D'), red: DOLLY.token('red-solid', '#B91C1C'), blue: DOLLY.token('blue-solid', '#0369A1'),
		surface: DOLLY.token('surface', '#FFFFFF'), text: DOLLY.token('text', '#0F172A'), muted: DOLLY.token('muted', '#475569'), border: DOLLY.token('border', '#E2E8F0')
	};
	var app = document.getElementById('dolly-admin-app');
	if (!app) { return; }
	var main = document.getElementById('dolly-admin-main');
	var ACTIONS = { entrata: __('Entrata'), inizio_pausa: __('Inizio pausa'), fine_pausa: __('Fine pausa'), uscita: __('Uscita') };
	var TYPES = { ferie: __('Ferie'), permesso: __('Permesso orario'), straordinario: __('Straordinario'), correzione: __('Correzione timbratura'), turno: __('Turno a chiamata'), donazione: __('Donazione sangue') };

	function workplaceOptions(allLabel) {
		var o = allLabel ? [{ value: '', label: allLabel }] : [];
		return o.concat((CFG.workplaces || []).map(function (w) { return { value: w.id, label: w.name + (w.active ? '' : __(' (disattivata)')) }; }));
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
		var m = DOLLY.field({ label: __('Mese'), type: 'select', value: state.month, options: DOLLY.MONTHS.map(function (n, i) { return { value: i + 1, label: n }; }) });
		var yy = DOLLY.field({ label: __('Anno'), type: 'select', value: state.year, options: years });
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
			var label = hidden ? __('Mostra il menu laterale') : __('Nascondi il menu laterale');
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
		var bell = h('button', { type: 'button', class: 'dolly-btn dolly-btn--ghost dolly-btn--icon dolly-admin__bell', 'aria-label': __('Notifiche') }, [DOLLY.icon('bell'), count]);
		header.appendChild(bell);
		function update() {
			DOLLY.api('notifications', { query: { page: 1 } }).then(function (r) {
				count.hidden = !r.unread; count.textContent = r.unread;
				bell.setAttribute('aria-label', __('Notifiche') + (r.unread ? ', ' + r.unread + __(' non lette') : ''));
			}, function () {});
		}
		bell.addEventListener('click', function () {
			var box = h('div', {}, DOLLY.loading());
			var page = 1;
			var dlg = DOLLY.dialog({ title: __('Notifiche'), body: box, wide: true, actions: [
				{ label: __('Segna tutte come lette'), icon: 'check', onClick: function (close, btn) { DOLLY.busy(btn, DOLLY.api('notifications/read-all', { method: 'POST' })).then(function () { update(); load(); }); } },
				{ label: __('Chiudi'), variant: 'primary' }
			] });
			function load() {
				DOLLY.api('notifications', { query: { page: page } }).then(function (r) {
					DOLLY.render(box, [
						r.items.length ? h('ul', { style: 'list-style:none;margin:0;padding:0' }, r.items.map(function (n) {
							return h('li', { class: 'dolly-alert dolly-alert--' + (n.read ? 'info' : 'warning') }, [DOLLY.icon(n.read ? 'bell' : 'bell-ring'), h('div', { class: 'dolly-alert__body' }, [
								h('strong', { text: n.title }), h('div', { style: 'white-space:pre-line', text: n.body }),
								h('div', { class: 'dolly-small dolly-muted', text: DOLLY.fmt.dateTime(n.created_at) }),
								n.link ? h('a', { href: n.link, onclick: function () { DOLLY.api('notifications/' + n.id + '/read', { method: 'POST' }); } }, __('Apri')) : null
							])]);
						})) : DOLLY.empty(__('Nessuna notifica'), '', 'bell'),
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
		var wpF = DOLLY.field({ label: __('Sede'), type: 'select', value: st.workplace, options: workplaceOptions(__('Tutte le sedi')) });
		var dateEl = h('div', { class: 'dolly-dash__date' });
		var updated = h('span', { class: 'dolly-small dolly-muted', 'aria-live': 'polite' });
		var kpis = h('div', { class: 'dolly-grid dolly-grid--4' });
		var attBox = h('div', {}, DOLLY.loading());
		var reqBox = h('div', {}, DOLLY.loading());
		var anomBox = h('div', {}, DOLLY.loading());
		var calEl = h('div');
		var chartWrap = h('div', { class: 'dolly-chart' }, h('canvas', { 'aria-label': __('Grafico presenze'), role: 'img' }));
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
				DOLLY.card(__('Presenze di oggi'), 'clock', attBox),
				DOLLY.card(__('Ultime richieste'), 'inbox', reqBox, { actions: [DOLLY.button(__('Tutte'), { size: 'sm', href: CFG.pages.requests, icon: 'arrow-right' })] })
			]),
			DOLLY.card(__('Anomalie non risolte'), 'triangle-alert', anomBox, { actions: [DOLLY.button(__('Tutte'), { size: 'sm', href: CFG.pages.anomalies, icon: 'arrow-right' })] }),
			h('div', { class: 'dolly-grid dolly-grid--2 dolly-dash__bottom' }, [
				DOLLY.card(__('Calendario'), 'calendar-days', [calEl, legend(), h('p', { class: 'dolly-small dolly-muted', style: 'margin:12px 0 0', text: __('Clicca un giorno per impostare una chiusura di quel giorno, oppure usa "Nuova chiusura" per un periodo.') })], {
					actions: [DOLLY.button(__('Nuova chiusura'), { size: 'sm', variant: 'primary', icon: 'calendar-off', onClick: function () { closureDialog(null, function () { if (calendar) { calendar.refetchEvents(); } refresh(); }); } })]
				}),
				DOLLY.card(__('Andamento presenze'), 'chart-column', [rangeTabs, chartWrap, chartTable])
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
			updated.textContent = __('Aggiornato alle ') + d.time + __(' · aggiornamento automatico ogni 15 secondi');
			var ab = d.kpi.absent;
			DOLLY.render(kpis, [
				kpi(__('Presenti ora'), d.kpi.present, 'user-check', __('In servizio, esclusi pausa e uscite'), 'green'),
				kpi(__('Assenti oggi'), ab.total, 'user-x', [
					ab.ferie ? DOLLY.badge(__('Ferie ') + ab.ferie, 'blue', 'sun') : null, ' ',
					ab.malattia ? DOLLY.badge(__('Malattia/infortunio ') + ab.malattia, 'red', 'stethoscope') : null, ' ',
					ab.permesso ? DOLLY.badge(__('Permesso ') + ab.permesso, 'blue', 'timer') : null, ' ',
					ab.ingiustificati ? DOLLY.badge(__('Non giustificati ') + ab.ingiustificati, 'amber', 'circle-help') : null,
					ab.total ? null : __('Nessuna assenza')
				], 'red'),
				kpi(__('Richieste in attesa'), d.kpi.pending, 'inbox', h('a', { href: CFG.pages.requests, text: __('Gestisci richieste') }), 'amber'),
				kpi(__('Anomalie non risolte'), d.kpi.anomalies, 'triangle-alert', h('a', { href: CFG.pages.anomalies, text: __('Gestisci anomalie') }), 'red')
			]);
			var attBadge = { presente: ['green', 'circle-check'], pausa: ['amber', 'coffee'], uscito: ['neutral', 'log-out'], assente: ['red', 'user-x'], ferie: ['blue', 'sun'], malattia: ['red', 'stethoscope'], infortunio: ['red', 'bandage'], festivo: ['neutral', 'party-popper'], atteso: ['neutral', 'clock'] };
			DOLLY.render(attBox, [
				DOLLY.table([
					{ label: __('Dipendente'), key: 'employee' },
					{ label: __('Sede'), key: 'workplace' },
					{ label: __('Entrata'), key: 'entrata', cls: 'time' },
					{ label: __('Pausa'), render: function (r) { return r.inizio_pausa ? r.inizio_pausa + (r.fine_pausa ? '–' + r.fine_pausa : '–…') : '—'; }, cls: 'time' },
					{ label: __('Uscita'), key: 'uscita', cls: 'time' },
					{ label: __('Stato'), render: function (r) { var b = attBadge[r.status] || ['neutral', 'info']; return DOLLY.badge(r.status_label, b[0], b[1]); } }
				], d.attendance.items, { empty: [__('Nessun dipendente previsto oggi'), '', 'calendar'], caption: __('Presenze di oggi') }),
				DOLLY.pagination(d.attendance, function (p) { st.att = p; refresh(); }, 'presenze')
			]);
			DOLLY.render(reqBox, [
				DOLLY.table([
					{ label: __('Dipendente'), key: 'employee' },
					{ label: __('Richiesta'), render: function (r) { return h('span', { class: 'dolly-small', text: r.summary }); } },
					{ label: __('Stato'), render: function (r) { return DOLLY.requestBadge(r.status, r.status_label); } },
					{ label: '', srLabel: __('Azioni'), render: function (r) { return r.status === 'pending' ? decisionButtons(r, function () { refresh(); }) : ''; } }
				], d.requests.items, { empty: [__('Nessuna richiesta'), '', 'inbox'], caption: __('Ultime richieste') }),
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
				updated.textContent = __('Aggiornamento non riuscito: ') + err.message;
			});
			loadChart();
			if (calendar) { calendar.refetchEvents(); }
		}

		function renderRangeTabs() {
			DOLLY.render(rangeTabs, DOLLY.tabs([{ id: 7, label: __('7 giorni') }, { id: 30, label: __('30 giorni') }, { id: 90, label: __('90 giorni') }], st.range, function (id) { st.range = id; renderRangeTabs(); loadChart(); }));
		}
		function loadChart() {
			DOLLY.api('admin/chart', { query: { range: st.range, workplace: st.workplace } }).then(function (d) {
				var ds = [
					{ label: __('Presenti'), data: d.present, backgroundColor: C.green },
					{ label: __('Assenti non giustificati'), data: d.absent, backgroundColor: C.red },
					{ label: __('Ferie'), data: d.leave, backgroundColor: C.blue },
					{ label: __('Malattia'), data: d.sick, backgroundColor: C.amber }
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
				DOLLY.render(chartTable, DOLLY.table([{ label: __('Giorno'), key: 'l' }, { label: __('Presenti'), key: 'p' }, { label: __('Assenti'), key: 'a' }, { label: __('Ferie'), key: 'f' }, { label: __('Malattia'), key: 's' }],
					d.labels.map(function (l, i) { return { l: l, p: d.present[i], a: d.absent[i], f: d.leave[i], s: d.sick[i] }; }), { caption: __('Dati del grafico presenze') }));
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
		collective: { label: __('Chiusura collettiva'), description: __('Ferie collettive, chiusura per inventario… Chi lavora comunque registra ore ordinarie.') },
		holiday: { label: __('Chiusura per festività'), description: __('Festa del patrono, ponte festivo… Le ore di chi lavora comunque hanno la maggiorazione festiva.') }
	};

	/**
	 * Closure of one day (date given, opened from the calendar) or of a range of days (date null, opened
	 * from the "Nuova chiusura" button): type, closed/open switch for each workplace, optional broadcast to
	 * the employees of the closed workplaces. A missing entry on those days is never an anomaly.
	 */
	function closureDialog(date, done) {
		var range = !date;
		var body = h('div', {}, DOLLY.loading());
		var dlg = DOLLY.dialog({ title: range ? __('Nuova chiusura (periodo)') : __('Chiusura'), body: body, wide: true });
		var load = range ? Promise.resolve({ date: CFG.today, name: '', type: 'collective', workplaces: [] }) : DOLLY.api('admin/closures', { query: { date: date } });
		load.then(function (c) {
			var alertBox = h('div', { hidden: true });
			var existing = !range && c.workplaces.length > 0;
			var from = range ? DOLLY.dateField({ label: __('Dal'), name: 'from', value: CFG.today, required: true }) : null;
			var to = range ? DOLLY.dateField({ label: __('Al'), name: 'to', value: CFG.today, required: true }) : null;
			var type = DOLLY.radios({ label: __('Tipo di chiusura'), name: 'type', value: c.type || 'collective', full: true, options: Object.keys(CLOSURE_TYPES).map(function (k) {
				return { value: k, label: CLOSURE_TYPES[k].label, description: CLOSURE_TYPES[k].description + (k === 'holiday' ? __(' (maggiorazione ') + (CFG.holidayIncrease || 0) + '%)' : '') };
			}), onChange: syncType });
			var name = DOLLY.field({ label: __('Descrizione'), name: 'name', value: c.name, optional: true, full: true, help: __('Ad esempio: Ferie estive, Santo patrono. Vuota = il tipo di chiusura.') });
			var switches = (CFG.workplaces || []).filter(function (w) { return w.active || c.workplaces.indexOf(w.id) !== -1; }).map(function (w) {
				var sw = DOLLY.switchControl({ label: w.name, name: 'wp' + w.id, checked: c.workplaces.indexOf(w.id) !== -1, description: [w.address, w.city].filter(Boolean).join(', ') || null });
				sw.wid = w.id;
				return sw;
			});
			var allBtn = DOLLY.button(__('Chiudi tutte le sedi'), { size: 'sm', icon: 'building-2', onClick: function () { switches.forEach(function (s) { s.control.setOn(true); }); } });
			var effect = h('div');
			function syncType() {
				DOLLY.render(effect, DOLLY.alert(type.value() === 'holiday'
					? __('Per i dipendenti delle sedi chiuse la mancata timbratura non genera anomalie. Chi lavora comunque può timbrare: le ore sono conteggiate come ore festive con maggiorazione del ') + (CFG.holidayIncrease || 0) + __('% (percentuale nelle Impostazioni).')
					: __('Per i dipendenti delle sedi chiuse la mancata timbratura non genera anomalie. Chi lavora comunque può timbrare: le ore sono conteggiate come ore ordinarie.'), 'info'));
			}
			syncType();
			function periodText() {
				if (!range) { return __('il ') + DOLLY.fmt.date(date); }
				var a = from.iso(), b = to.iso();
				return a && b && a !== b ? __('dal ') + DOLLY.fmt.date(a) + __(' al ') + DOLLY.fmt.date(b) : __('il ') + DOLLY.fmt.date(a || CFG.today);
			}
			var msg = DOLLY.field({ label: __('Messaggio'), name: 'message', type: 'textarea', full: true, rows: 4 });
			var msgTouched = false;
			msg.input.addEventListener('input', function () { msgTouched = true; });
			function fillMessage() {
				if (msgTouched) { return; }
				msg.input.value = __('Ti informiamo che ') + periodText() + __(' la tua sede resterà chiusa (') + (name.input.value || CLOSURE_TYPES[type.value()].label).toLowerCase() + __('). Non è necessario timbrare.');
			}
			var chEmail = DOLLY.switchControl({ label: __('Email'), name: 'bc_email', checked: true });
			var chPortal = DOLLY.switchControl({ label: __('Notifica nell\'app'), name: 'bc_portal', checked: true, description: __('Arriva anche come notifica push sui telefoni con le notifiche attive.') });
			var chPopup = DOLLY.switchControl({ label: __('Mostra subito all\'apertura dell\'app'), name: 'bc_popup', checked: false, description: __('Il messaggio compare in un pop-up appena il dipendente apre il portale.') });
			var channels = h('div', { class: 'dolly-field dolly-field--full', dataset: { name: 'channels' } }, [h('div', { class: 'dolly-form-grid' }, [chEmail, chPortal, chPopup]), h('span', { class: 'dolly-error', hidden: true })]);
			var bcBox = h('div', { class: 'dolly-form-grid dolly-field--full', hidden: true }, [msg, channels]);
			var bc = DOLLY.switchControl({ label: __('Invia un messaggio broadcast'), name: 'broadcast', checked: false, description: __('Ai dipendenti assegnati alle sedi chiuse, subito dopo il salvataggio.'), onChange: function (on) { bcBox.hidden = !on; if (on) { fillMessage(); } } });
			var form = h('form', { class: 'dolly-form', novalidate: true }, [
				alertBox,
				range ? h('div', { class: 'dolly-form-grid' }, [from, to]) : h('p', {}, [h('strong', { text: c.date_label }), c.holiday ? __(' · festività: ') + c.holiday : '']),
				type,
				h('div', { class: 'dolly-form-grid' }, [name]),
				h('div', { class: 'dolly-toolbar' }, [h('h3', { style: 'margin:0', text: __('Sedi chiuse') }), h('div', { class: 'dolly-toolbar__spacer' }), allBtn]),
				switches.length ? h('div', { class: 'dolly-form-grid dolly-closure__sites' }, switches) : DOLLY.alert(__('Nessuna sede configurata.'), 'warning'),
				effect,
				bc, bcBox
			]);
			var actions = h('div', { class: 'dolly-btn-row dolly-btn-row--end', style: 'margin-top:16px' });
			var saveBtn = DOLLY.button(__('Salva'), { variant: 'primary', icon: 'save' });
			function period() {
				if (!range) { return { from: date, to: date }; }
				var rd = DOLLY.readDateTimes({ from: [from, 'date', true], to: [to, 'date', true] });
				if (Object.keys(rd.errors).length) { DOLLY.showErrors(form, rd.errors); return null; }
				if (rd.values.to < rd.values.from) { DOLLY.showErrors(form, { to: __('La data di fine deve essere uguale o successiva all\'inizio.') }); return null; }
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
					var days = r.days > 1 ? ' (' + r.days + __(' giorni)') : '';
					var text = workplaces.length ? __('Chiusura salvata') + days + ': ' + (r.affected === 1 ? __('1 dipendente coinvolto.') : r.affected + __(' dipendenti coinvolti.')) : __('Chiusura rimossa') + days + '.';
					if (r.broadcast && r.broadcast.recipient_count !== undefined) { text += __(' Messaggio inviato a ') + r.broadcast.recipient_count + '.'; }
					else if (r.broadcast && r.broadcast.skipped) { text += __(' Nessun dipendente a cui inviare il messaggio.'); }
					DOLLY.toast(text, 'success');
					done();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			}
			saveBtn.addEventListener('click', function () {
				var closed = switches.filter(function (s) { return s.control.isOn(); }).map(function (s) { return s.wid; });
				if (!closed.length && !existing) { alertBox.hidden = false; DOLLY.render(alertBox, DOLLY.alert(__('Attiva almeno una sede chiusa.'), 'error')); return; }
				send(closed, saveBtn);
			});
			if (existing || range) {
				var rm = DOLLY.button(range ? __('Rimuovi le chiusure del periodo') : __('Rimuovi chiusura'), { variant: 'danger', icon: 'trash-2' });
				rm.addEventListener('click', function () {
					DOLLY.confirm(range ? __('Rimuovere le chiusure del periodo?') : __('Rimuovere la chiusura?'), __('Tutte le sedi torneranno aperte ') + periodText() + '.', __('Rimuovi'), 'danger').then(function (ok) {
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
		var items = [['var(--dolly-blue-bg)', __('Ferie')], ['var(--dolly-cat-permesso-bg)', __('Permesso')], ['var(--dolly-accent-soft)', __('Straordinario')], ['var(--dolly-red-bg)', __('Malattia / infortunio')], ['var(--dolly-cat-festivo-bg)', __('Festività')], ['var(--dolly-surface-3)', __('Chiusura collettiva')], ['var(--dolly-cat-chiusura-festiva-bg)', __('Chiusura per festività')]];
		return h('div', { class: 'dolly-legend', 'aria-label': __('Legenda') }, items.map(function (i) {
			return h('span', {}, [h('i', { style: 'background:' + i[0] + ';border:1px solid var(--dolly-border-strong)', 'aria-hidden': 'true' }), i[1]]);
		}));
	}

	/* ------------------------------------------------------------------ */
	/* Requests: shared decision UI                                         */
	/* ------------------------------------------------------------------ */

	function decisionButtons(r, done) {
		return h('div', { class: 'dolly-actions' }, [
			DOLLY.button(__('Approva'), { size: 'sm', variant: 'success', icon: 'check', onClick: function () { decide(r, 'approve', done); } }),
			DOLLY.button(__('Respingi'), { size: 'sm', icon: 'x', onClick: function () { decide(r, 'reject', done); } })
		]);
	}

	/** Kinds of hourly leave and the justification codes (hours history) allowed for each; the first is the default. */
	var LEAVE_KINDS = [
		{ value: 'retribuito', label: __('Permesso ordinario retribuito'), codes: ['P', 'ROL', 'EO'] },
		{ value: 'non_retribuito', label: __('Permesso ordinario non retribuito'), codes: ['Pn'] },
		{ value: 'evento', label: __('Congedi e permessi per eventi specifici'), codes: ['P', 'PL'] }
	];
	var CODE_LABELS = { P: __('P · Permesso'), ROL: __('ROL · Riduzione orario di lavoro'), EO: __('EO · Ex festività'), Pn: __('Pn · Permesso non retribuito'), PL: __('PL · Permesso Legge 104') };
	function leaveCodeOptions(kind) {
		var k = LEAVE_KINDS.filter(function (x) { return x.value === kind; })[0] || LEAVE_KINDS[0];
		return k.codes.map(function (c) { return { value: c, label: CODE_LABELS[c] }; });
	}

	function decide(r, decision, done) {
		var note = DOLLY.field({ label: __('Nota per il dipendente'), name: 'note', type: 'textarea', optional: decision === 'approve' });
		// Hourly leave: the administrator confirms or changes the justification code recorded in the hours history.
		var code = r.type === 'permesso' && decision === 'approve' && r.amend_action !== 'cancel'
			? DOLLY.field({ label: __('Giustificativo (storico ore)'), name: 'hours_code', type: 'select', value: r.hours_code, options: leaveCodeOptions(r.leave_kind), help: r.leave_kind_label + __('. Le ore del permesso vengono registrate con questo codice.') })
			: null;
		var form = h('form', { class: 'dolly-form' }, [
			h('p', {}, [h('strong', { text: r.employee + ': ' }), r.summary]),
			r.notes ? h('p', { class: 'dolly-muted', text: __('Note del dipendente: ') + r.notes }) : null,
			code,
			r.type === 'correzione' && decision === 'approve' ? DOLLY.alert(__('Approvando, la timbratura verrà corretta con registrazione nel registro modifiche.'), 'info') : null,
			r.amend_action ? DOLLY.alert(r.amend_action === 'cancel' ? __('Approvando, la richiesta originale approvata verrà annullata.') : __('Approvando, la modifica sostituirà la richiesta approvata originale.'), 'info') : null,
			note
		]);
		DOLLY.dialog({
			title: decision === 'approve' ? __('Approva richiesta') : __('Respingi richiesta'), body: form,
			actions: [
				{ label: __('Annulla') },
				{ label: decision === 'approve' ? __('Approva') : __('Respingi'), variant: decision === 'approve' ? 'success' : 'danger', icon: decision === 'approve' ? 'check' : 'x', onClick: function (close, btn) {
					if (decision === 'reject' && !note.input.value.trim()) { DOLLY.showErrors(form, { note: __('Indica il motivo del rifiuto.') }); return; }
					DOLLY.busy(btn, DOLLY.api('admin/requests/' + r.id + '/decision', { method: 'POST', body: { decision: decision, note: note.input.value, hours_code: code ? code.input.value : '' } })).then(function () {
						close(); DOLLY.toast(decision === 'approve' ? __('Richiesta approvata.') : __('Richiesta respinta.'), 'success'); done();
					}, function (err) { DOLLY.formError(form, err); });
				} }
			]
		});
	}

	/** Revokes an approved vacation, hourly leave or blood donation (the reason is mandatory). */
	function revokeDialog(r, done) {
		var note = DOLLY.field({ label: __('Motivo della revoca'), name: 'note', type: 'textarea', required: true });
		var form = h('form', { class: 'dolly-form' }, [
			h('p', {}, [h('strong', { text: r.employee + ': ' }), r.summary]),
			DOLLY.alert(__('La richiesta approvata viene annullata: sparisce dal calendario e dalle presenze del dipendente, che riceve una notifica con il motivo. La richiesta resta nello storico come "Annullata".'), 'warning'),
			note
		]);
		DOLLY.dialog({
			title: __('Revoca richiesta approvata'), body: form,
			actions: [
				{ label: __('Annulla') },
				{ label: __('Revoca'), variant: 'danger', icon: 'undo-2', onClick: function (close, btn) {
					if (!note.input.value.trim()) { DOLLY.showErrors(form, { note: __('Indica il motivo della revoca.') }); return; }
					DOLLY.busy(btn, DOLLY.api('admin/requests/' + r.id + '/revoke', { method: 'POST', body: { note: note.input.value } })).then(function () {
						close(); DOLLY.toast(__('Richiesta revocata.'), 'success'); done();
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
		if (r.certificate_due && (r.certificate_status === 'missing' || r.certificate_status === 'overdue')) { nodes.push(h('div', { class: 'dolly-small', text: __('Scadenza ') + DOLLY.fmt.date(r.certificate_due) })); }
		(r.certificates || []).forEach(function (c) {
			nodes.push(h('div', { class: 'dolly-small' }, h('a', { href: DOLLY.downloadUrl('certificates/' + c.id + '/download') }, [DOLLY.icon('download'), ' ' + c.original_name])));
		});
		if (r.status === 'approved' && r.certificate_status !== 'not_required' && r.certificate_status !== 'cleared') {
			var file = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png', class: 'dolly-sr-only', 'aria-label': __('File certificato di donazione per ') + r.employee });
			var up = DOLLY.button(__('Carica certificato'), { size: 'sm', icon: 'file-up', onClick: function () { file.click(); } });
			file.addEventListener('change', function () {
				if (!file.files[0]) { return; }
				var fd = new FormData(); fd.append('file', file.files[0]);
				DOLLY.busy(up, DOLLY.api('admin/requests/' + r.id + '/certificate', { method: 'POST', form: fd, timeout: 120000 })).then(function () { DOLLY.toast(__('Certificato di donazione caricato.'), 'success'); done(); }, function (err) { DOLLY.toast(err.message, 'error'); file.value = ''; });
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
			{ label: __('Dipendente'), key: 'employee' },
			{ label: __('Data'), render: function (a) { return DOLLY.fmt.date(a.work_date); } },
			{ label: __('Tipo'), render: function (a) { return a.status === 'open' ? DOLLY.badge(a.type_label, 'red', a.type === 'missing_certificate' ? 'file-text' : 'triangle-alert') : h('div', {}, [DOLLY.badge(a.type_label, 'neutral'), ' ', DOLLY.badge(a.resolution_label, 'green', 'circle-check')]); } },
			{ label: __('Dettagli'), render: function (a) {
				return h('div', { class: 'dolly-small' }, [
					h('div', { style: 'white-space:pre-line', text: a.details }),
					a.employee_note ? h('div', { class: 'dolly-muted', text: __('Nota del dipendente: ') + a.employee_note }) : null,
					a.status === 'resolved' ? h('div', { class: 'dolly-muted', text: __('Risolta da ') + a.resolved_by + __(' il ') + DOLLY.fmt.dateTime(a.resolved_at) + (a.resolution_note ? ': ' + a.resolution_note : '') }) : null
				]);
			} },
			{ label: '', srLabel: __('Azioni'), render: function (a) { return a.status === 'open' ? anomalyActions(a, done) : ''; } }
		], items, { empty: [__('Nessuna anomalia'), __('Non ci sono anomalie da mostrare.'), 'circle-check'], caption: __('Anomalie') });
	}

	function anomalyActions(a, done) {
		var b = [];
		if (a.type === 'unjustified_absence') {
			b.push(DOLLY.button(__('Inserisci entrata'), { size: 'sm', icon: 'pencil', onClick: function () { resolveDialog(a, 'correct_entry', done); } }));
			b.push(DOLLY.button(__('Chiudi'), { size: 'sm', icon: 'x', onClick: function () { resolveDialog(a, 'dismiss', done); } }));
		} else if (a.type === 'missing_exit' || a.type === 'late_exit') {
			b.push(DOLLY.button(__('Correggi uscita'), { size: 'sm', icon: 'pencil', onClick: function () { resolveDialog(a, 'correct_exit', done); } }));
			if (a.type === 'late_exit') { b.push(DOLLY.button(__('Approva straordinario'), { size: 'sm', variant: 'success', icon: 'check', onClick: function () { resolveDialog(a, 'approve_extra', done); } })); }
			b.push(DOLLY.button(__('Chiudi'), { size: 'sm', icon: 'x', onClick: function () { resolveDialog(a, 'dismiss', done); } }));
		} else if (a.type === 'sickness_conflict') {
			b.push(DOLLY.button(__('Segna come verificata'), { size: 'sm', icon: 'shield-check', onClick: function () { resolveDialog(a, 'review', done); } }));
		} else if (a.type === 'missing_certificate') {
			return h('span', { class: 'dolly-small dolly-muted', text: __('Si risolve con il caricamento del certificato.') });
		}
		return h('div', { class: 'dolly-actions' }, b);
	}

	function resolveDialog(a, action, done) {
		var titles = { correct_exit: __('Correggi orario di uscita'), correct_entry: __('Inserisci l\'entrata'), approve_extra: __('Approva straordinario'), dismiss: __('Chiudi anomalia'), review: __('Verifica conflitto malattia/infortunio') };
		var fields = [];
		var timeF = null, exitF = null;
		if (action === 'correct_entry') {
			timeF = DOLLY.timeField({ label: __('Orario di entrata'), name: 'time', required: true });
			exitF = DOLLY.timeField({ label: __('Orario di uscita'), name: 'exit_time', optional: true, help: __('Facoltativo, HH:MM: compilalo se la giornata è già terminata.') });
			fields.push(DOLLY.alert(__('Vengono inserite le timbrature con correzione dell\'amministratore, registrate nel registro modifiche. Per chiudere un\'assenza giustificata usa "Chiudi".'), 'info'), h('div', { class: 'dolly-form-grid' }, [timeF, exitF]));
		}
		if (action === 'correct_exit') {
			timeF = DOLLY.timeField({ label: __('Orario di uscita corretto'), name: 'time', required: true });
			fields.push(DOLLY.alert(__('Viene inserita un\'uscita con correzione dell\'amministratore, registrata nel registro modifiche.'), 'info'), timeF);
		}
		if (action === 'approve_extra') {
			var m = /alle (\d{2}:\d{2})/.exec(a.details || '');
			timeF = DOLLY.timeField({ label: __('Straordinario autorizzato fino alle'), name: 'end_time', required: true, value: m ? m[1] : '' });
			fields.push(DOLLY.alert(__('L\'approvazione sposta il limite di allerta; non crea né modifica timbrature.'), 'info'), timeF);
		}
		var note = DOLLY.field({ label: action === 'correct_exit' || action === 'correct_entry' ? __('Motivo della correzione') : __('Nota'), name: 'note', type: 'textarea', optional: action === 'approve_extra' });
		fields.push(note);
		var form = h('form', { class: 'dolly-form', novalidate: true }, [h('p', {}, [h('strong', { text: a.employee }), ' · ' + DOLLY.fmt.date(a.work_date) + ' · ' + a.type_label]), fields]);
		DOLLY.dialog({
			title: titles[action], body: form,
			actions: [{ label: __('Annulla') }, { label: __('Conferma'), variant: 'primary', icon: 'check', onClick: function (close, btn) {
				DOLLY.clearErrors(form);
				var body = { action: action, note: note.input.value };
				if (timeF) {
					var t = timeF.hm();
					if (!t) { DOLLY.showErrors(form, (function () { var o = {}; o[action === 'approve_extra' ? 'end_time' : 'time'] = __('Orario non valido (HH:MM).'); return o; })()); return; }
					body[action === 'approve_extra' ? 'end_time' : 'time'] = t;
				}
				if (exitF && exitF.input.value.trim()) {
					var x = exitF.hm();
					if (!x) { DOLLY.showErrors(form, { exit_time: __('Orario non valido (HH:MM).') }); return; }
					body.exit_time = x;
				}
				if ((action === 'correct_exit' || action === 'correct_entry' || action === 'dismiss' || action === 'review') && !note.input.value.trim()) { DOLLY.showErrors(form, { note: __('Campo obbligatorio.') }); return; }
				DOLLY.busy(btn, DOLLY.api('admin/anomalies/' + a.id + '/resolve', { method: 'POST', body: body })).then(function () {
					close(); DOLLY.toast(__('Anomalia risolta.'), 'success'); done();
				}, function (err) { DOLLY.formError(form, err); });
			} }]
		});
	}

	/* ------------------------------------------------------------------ */
	/* Employee form (create & edit)                                        */
	/* ------------------------------------------------------------------ */

	/**
	 * Working hours: one fixed timetable for the selected days, or (switch) a different timetable for each
	 * day, each day with its own on/off switch. On-call contracts have no working days or hours.
	 * Returns an element with .collect(errors) -> schedule body for the API.
	 */
	function scheduleEditor(s) {
		var days = s.days || {};
		var type = DOLLY.field({ label: __('Tipo di contratto'), name: 'employment_type', type: 'select', value: s.employment_type || 'full_time', options: [{ value: 'full_time', label: __('Tempo pieno') }, { value: 'part_time', label: __('Part-time') }, { value: 'on_call', label: __('Contratto a chiamata') }] });

		// Same hours for all the selected days.
		var u = {
			weekdays: DOLLY.chips({ label: __('Giorni lavorativi'), name: 'weekdays', full: true, selected: s.per_day ? [] : s.weekdays, options: DOLLY.WEEKDAYS.map(function (d, i) { return { value: i + 1, label: d }; }) }),
			start_time: DOLLY.timeField({ label: __('Inizio turno'), name: 'start_time', value: s.start_time || '09:00', required: true }),
			end_time: DOLLY.timeField({ label: __('Fine turno'), name: 'end_time', value: s.end_time || '18:00', required: true }),
			lunch_start: DOLLY.timeField({ label: __('Inizio pausa pranzo'), name: 'lunch_start', value: s.lunch_start || '13:00' }),
			lunch_end: DOLLY.timeField({ label: __('Fine pausa pranzo'), name: 'lunch_end', value: s.lunch_end || '14:00' })
		};
		var uLunch = h('div', { class: 'dolly-form-grid dolly-field--full', hidden: !s.has_lunch }, [u.lunch_start, u.lunch_end]);
		u.has_lunch = DOLLY.switchControl({ label: __('Pausa pranzo prevista'), name: 'has_lunch', checked: !!s.has_lunch, onChange: function (on) { uLunch.hidden = !on; } });
		var uniformBox = h('div', { class: 'dolly-form-grid dolly-field--full' }, [u.weekdays, u.start_time, u.end_time, h('div', { class: 'dolly-field--full' }, u.has_lunch), uLunch]);

		// A different timetable for each day.
		var rows = {};
		var perDayBox = h('div', { class: 'dolly-dayrows dolly-field--full' });
		DOLLY.WEEKDAYS.forEach(function (label, i) {
			var wd = i + 1, d = days[wd] || null;
			var working = s.per_day ? !!d : (s.weekdays || []).indexOf(wd) !== -1;
			var base = d || { start: s.start_time || '09:00', end: s.end_time || '18:00', lunch_start: s.lunch_start, lunch_end: s.lunch_end };
			var hasLunch = d ? !!d.lunch_start : !!s.has_lunch;
			var p = 'day' + wd + '_';
			var r = {
				start: DOLLY.timeField({ label: __('Inizio'), name: p + 'start_time', value: base.start }),
				end: DOLLY.timeField({ label: __('Fine'), name: p + 'end_time', value: base.end }),
				ls: DOLLY.timeField({ label: __('Inizio pausa'), name: p + 'lunch_start', value: base.lunch_start || '13:00' }),
				le: DOLLY.timeField({ label: __('Fine pausa'), name: p + 'lunch_end', value: base.lunch_end || '14:00' })
			};
			var lunchBox = h('div', { class: 'dolly-dayrow__lunch', hidden: !hasLunch }, [r.ls, r.le]);
			r.lunch = DOLLY.switchControl({ label: __('Pausa'), name: p + 'has_lunch', checked: hasLunch, onChange: function (on) { lunchBox.hidden = !on; } });
			var times = h('div', { class: 'dolly-dayrow__times', hidden: !working }, [r.start, r.end, r.lunch, lunchBox]);
			r.on = DOLLY.switchControl({ label: label, name: 'day' + wd, checked: working, onChange: function (on) { times.hidden = !on; } });
			rows[wd] = r;
			perDayBox.appendChild(h('div', { class: 'dolly-dayrow' }, [h('div', { class: 'dolly-dayrow__day' }, r.on), times]));
		});

		var perDay = DOLLY.switchControl({ label: __('Orario diverso per ogni giorno'), name: 'per_day', checked: !!s.per_day, description: __('Disattivato: un orario fisso per tutti i giorni selezionati. Attivato: ogni giorno ha il suo interruttore e il suo orario.'), onChange: sync });
		var onCallInfo = h('div', { class: 'dolly-field--full' }, DOLLY.alert(__('Contratto a chiamata: nessun giorno né orario fisso. Il dipendente inizia e termina il turno quando vuole; ogni turno viene approvato dall\'amministratore oppure automaticamente fino alla soglia indicata nelle Impostazioni.'), 'info'));
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
					var spec = {};
					spec[p + 'start_time'] = [r.start, 'time', true];
					spec[p + 'end_time'] = [r.end, 'time', true];
					var lunch = r.lunch.control.isOn();
					if (lunch) { spec[p + 'lunch_start'] = [r.ls, 'time', true]; spec[p + 'lunch_end'] = [r.le, 'time', true]; }
					var rd = DOLLY.readDateTimes(spec);
					Object.assign(errors, rd.errors);
					out.days[wd] = { start_time: rd.values[p + 'start_time'], end_time: rd.values[p + 'end_time'], has_lunch: lunch, lunch_start: rd.values[p + 'lunch_start'] || '', lunch_end: rd.values[p + 'lunch_end'] || '' };
				});
				if (!any) { errors.per_day = __('Attiva almeno un giorno lavorativo.'); }
				return out;
			}
			var lunch2 = u.has_lunch.control.isOn();
			var spec2 = { start_time: [u.start_time, 'time', true], end_time: [u.end_time, 'time', true] };
			if (lunch2) { spec2.lunch_start = [u.lunch_start, 'time', true]; spec2.lunch_end = [u.lunch_end, 'time', true]; }
			var rd2 = DOLLY.readDateTimes(spec2);
			Object.assign(errors, rd2.errors);
			if (!u.weekdays.values().length) { errors.weekdays = __('Seleziona almeno un giorno.'); }
			return { employment_type: t, weekdays: u.weekdays.values().map(Number), start_time: rd2.values.start_time, end_time: rd2.values.end_time, has_lunch: lunch2, lunch_start: rd2.values.lunch_start || '', lunch_end: rd2.values.lunch_end || '' };
		};
		return wrap;
	}

	function employeeForm(e, isNew) {
		e = e || {};
		var s = e.schedule || { weekdays: [1, 2, 3, 4, 5], start_time: '09:00', end_time: '18:00', has_lunch: true, lunch_start: '13:00', lunch_end: '14:00', employment_type: 'full_time' };
		var bank = e.bank || {};
		var alertBox = h('div', { hidden: true });
		var f = {
			first_name: DOLLY.field({ label: __('Nome'), name: 'first_name', value: e.first_name, required: true }),
			last_name: DOLLY.field({ label: __('Cognome'), name: 'last_name', value: e.last_name, required: true }),
			username: DOLLY.field({ label: __('Nome utente'), name: 'username', value: e.username, required: isNew, help: isNew ? __('Non potrà essere modificato.') : __('Il nome utente non è modificabile.'), attrs: isNew ? { autocomplete: 'off', autocapitalize: 'none' } : { readonly: true } }),
			email: DOLLY.field({ label: __('Email'), name: 'email', type: 'email', value: e.email, required: true }),
			phone: DOLLY.field({ label: __('Telefono'), name: 'phone', type: 'tel', value: e.phone, optional: true }),
			password: isNew ? DOLLY.field({ label: __('Password iniziale'), name: 'password', type: 'text', required: true, help: __('Almeno 8 caratteri. Comunicala al dipendente in modo sicuro.'), attrs: { autocomplete: 'new-password' } }) : null,
			schedule: scheduleEditor(s),
			workplaces: DOLLY.chips({ label: __('Sedi assegnate'), name: 'workplaces', full: true, help: __('Il dipendente può timbrare solo nelle sedi assegnate.'), selected: (e.workplaces || []).map(function (w) { return w.id; }), options: (CFG.workplaces || []).filter(function (w) { return w.active; }).map(function (w) { return { value: w.id, label: w.name }; }) }),
			valid_from: DOLLY.dateField({ label: isNew ? __('Valido dal') : __('Modifiche a orario e sedi valide dal'), name: 'valid_from', value: CFG.today, required: true, help: __('Le modifiche non alterano lo storico precedente. Formato GG/MM/AAAA.') }),
			iban: DOLLY.field({ label: 'IBAN', name: 'iban', value: DOLLY.fmt.iban(bank.iban), optional: true, full: true, attrs: { autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' } }),
			bank_beneficiary: DOLLY.field({ label: __('Nome beneficiario'), name: 'bank_beneficiary', value: bank.bank_beneficiary, optional: true }),
			bank_name: DOLLY.field({ label: __('Banca'), name: 'bank_name', value: bank.bank_name, optional: true }),
			bic: DOLLY.field({ label: 'BIC', name: 'bic', value: bank.bic, optional: true, help: __('8 o 11 caratteri.'), attrs: { autocapitalize: 'characters', spellcheck: 'false', maxlength: 11 } })
		};
		if (isNew) {
			var gen = DOLLY.button(__('Genera'), { icon: 'refresh-cw', onClick: function () {
				var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', out = '', a = new Uint32Array(12);
				window.crypto.getRandomValues(a);
				for (var i = 0; i < 12; i++) { out += chars[a[i] % chars.length]; }
				f.password.input.value = out;
			} });
			f.password.querySelector('.dolly-input').parentNode.insertBefore(h('div', { class: 'dolly-input-group' }, [f.password.input, gen]), f.password.querySelector('.dolly-help') || null);
		}
		if (!(CFG.workplaces || []).length) { f.workplaces = h('div', { class: 'dolly-field dolly-field--full', dataset: { name: 'workplaces' } }, [DOLLY.alert(__('Crea prima almeno una sede.'), 'warning', h('a', { href: CFG.pages.workplaces, text: __('Vai a Sedi') })), h('span', { class: 'dolly-error', hidden: true })]); f.workplaces.values = function () { return []; }; }

		var form = h('form', { class: 'dolly-form', novalidate: true }, [
			alertBox,
			h('h3', {}, [DOLLY.icon('id-card'), __(' Dati anagrafici')]),
			h('div', { class: 'dolly-form-grid' }, [f.first_name, f.last_name, f.username, f.email, f.phone, f.password]),
			h('h3', {}, [DOLLY.icon('clock'), __(' Orario')]),
			f.schedule,
			h('h3', {}, [DOLLY.icon('map-pin'), __(' Sedi')]),
			h('div', { class: 'dolly-form-grid' }, [f.workplaces, f.valid_from]),
			h('h3', {}, [DOLLY.icon('landmark'), __(' Dati bancari')]),
			h('div', { class: 'dolly-form-grid' }, [f.iban, f.bank_beneficiary, f.bank_name, f.bic])
		]);

		form.collect = function () {
			DOLLY.clearErrors(form); alertBox.hidden = true;
			var read = DOLLY.readDateTimes({ valid_from: [f.valid_from, 'date', true] });
			var errors = read.errors;
			var schedule = f.schedule.collect(errors);
			if (!f.workplaces.values().length) { errors.workplaces = __('Assegna almeno una sede.'); }
			var iban = f.iban.input.value.replace(/[\s-]+/g, '').toUpperCase();
			if (iban && !DOLLY.isIban(iban)) { errors.iban = __('IBAN non valido: controlla lettere e cifre.'); }
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
		var btn = DOLLY.button(__('Crea dipendente'), { type: 'submit', variant: 'primary', icon: 'user-plus' });
		form.appendChild(h('div', { class: 'dolly-btn-row' }, btn));
		form.addEventListener('submit', function (ev) {
			ev.preventDefault();
			var body = form.collect();
			if (!body) { return; }
			DOLLY.busy(btn, DOLLY.api('admin/employees', { method: 'POST', body: body })).then(function (emp) {
				DOLLY.render(main, DOLLY.card(__('Dipendente creato'), 'circle-check', [
					DOLLY.alert(emp.name + ' (' + emp.username + __(') è stato creato. Può accedere da ') + CFG.portalUrl.replace('/portale/', '/accesso/') + '.', 'success'),
					h('div', { class: 'dolly-btn-row' }, [DOLLY.button(__('Crea un altro dipendente'), { icon: 'user-plus', variant: 'primary', onClick: pageEmployeeNew }), DOLLY.button(__('Elenco dipendenti'), { href: CFG.pages.employees, icon: 'users' })])
				], { accent: true }));
			}, form.fail);
		});
		DOLLY.render(main, DOLLY.card(__('Nuovo dipendente'), 'user-plus', form, { accent: true }));
	}

	/* ------------------------------------------------------------------ */
	/* Employees list & detail                                              */
	/* ------------------------------------------------------------------ */

	/* Device management: registered devices of an employee, limit and unlink. */

	var DEVICES_OFF = __('Le sessioni dispositivo sono disattivate (Impostazioni › Sessioni dispositivo): al momento i dipendenti possono accedere da qualsiasi dispositivo.');

	/** Limit of devices of an employee: number + save. */
	function deviceLimitControl(uid, ds, reload) {
		var input = h('input', { class: 'dolly-input', type: 'number', min: 1, max: ds.max_limit, value: ds.limit, inputmode: 'numeric', 'aria-label': __('Numero massimo di dispositivi') });
		var btn = DOLLY.button(__('Salva limite'), { size: 'sm', icon: 'save', onClick: function () {
			var v = parseInt(input.value, 10);
			if (!(v >= 1 && v <= ds.max_limit)) { DOLLY.toast(__('Il limite deve essere compreso tra 1 e ') + ds.max_limit + '.', 'error'); return; }
			DOLLY.busy(btn, DOLLY.api('admin/employees/' + uid + '/device-limit', { method: 'POST', body: { limit: v } })).then(function () {
				DOLLY.toast(__('Limite dispositivi aggiornato.'), 'success'); reload();
			}, function (err) { DOLLY.toast(err.message, 'error'); });
		} });
		return h('div', { class: 'dolly-limit' }, [input, btn]);
	}

	/** Registered devices with "Scollega"; the first one is the main device. */
	function deviceList(devices, employee, reload) {
		if (!devices.length) { return h('span', { class: 'dolly-small dolly-muted', text: __('Nessun dispositivo collegato: il prossimo accesso registra il dispositivo principale.') }); }
		return h('div', {}, devices.map(function (d, i) {
			return h('div', { class: 'dolly-device' }, [
				DOLLY.icon('smartphone'),
				h('span', { class: 'dolly-device__name', text: d.name }),
				i === 0 ? DOLLY.badge(__('Principale'), 'blue') : null,
				h('span', { class: 'dolly-device__meta', text: __('Collegato il ') + DOLLY.fmt.dateTime(d.created_at) + __(' · ultimo accesso ') + DOLLY.fmt.dateTime(d.last_seen_at) }),
				DOLLY.button(__('Scollega'), { size: 'sm', icon: 'unlink', ariaLabel: __('Scollega ') + d.name + __(' di ') + employee, onClick: function (ev) {
					var b = ev.currentTarget;
					DOLLY.confirm(__('Scollegare il dispositivo?'), '«' + d.name + __('» di ') + employee + __(' verrà scollegato e il dipendente dovrà accedere di nuovo: il prossimo dispositivo con cui accede verrà registrato.'), __('Scollega'), 'danger').then(function (ok) {
						if (!ok) { return; }
						DOLLY.busy(b, DOLLY.api('admin/devices/' + d.id, { method: 'DELETE' })).then(function () { DOLLY.toast(__('Dispositivo scollegato.'), 'success'); reload(); }, function (err) { DOLLY.toast(err.message, 'error'); });
					});
				} })
			]);
		}));
	}

	/** Page tab "Gestione dispositivi": every employee with devices and limit. */
	function devicesTab(content) {
		var box = h('div', {}, DOLLY.loading());
		var search = DOLLY.field({ label: __('Cerca'), type: 'search', attrs: { placeholder: __('Nome del dipendente') } });
		var all = null;
		search.input.addEventListener('input', function () { draw(); });
		DOLLY.render(content, DOLLY.card(null, null, [
			h('p', { class: 'dolly-muted', style: 'margin-top:0', text: __('Ogni dipendente accede solo dai dispositivi collegati: il primo accesso registra il dispositivo principale. Per far accedere un dipendente da un altro telefono o computer scollega il dispositivo precedente, oppure aumenta il limite.') }),
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
					{ label: __('Dipendente'), render: function (e) { return h('strong', { text: e.employee }); } },
					{ label: __('Limite dispositivi'), render: function (e) { return deviceLimitControl(e.user_id, { limit: e.limit, max_limit: all.max_limit }, load); } },
					{ label: __('Dispositivi collegati'), render: function (e) { return deviceList(e.devices, e.employee, load); } }
				], items, { empty: [__('Nessun dipendente trovato'), '', 'smartphone'], caption: __('Dispositivi dei dipendenti') })
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
			DOLLY.tabs([{ id: 'elenco', label: __('Dipendenti'), icon: 'users' }, { id: 'dispositivi', label: __('Gestione dispositivi'), icon: 'smartphone' }], tab, function (t) {
				window.location.hash = t === 'dispositivi' ? 'dispositivi' : '';
				pageEmployees();
			}),
			content
		]);
		if (tab === 'dispositivi') { devicesTab(content); } else { employeesTab(content); }
	}

	function employeesTab(main) {
		var st = { page: 1, search: '', status: 'active', workplace: '' };
		var search = DOLLY.field({ label: __('Cerca'), type: 'search', attrs: { placeholder: __('Nome, utente o email') } });
		var status = DOLLY.field({ label: __('Stato'), type: 'select', value: st.status, options: [{ value: 'active', label: __('Attivi') }, { value: 'inactive', label: __('Disattivati') }, { value: 'all', label: __('Tutti') }] });
		var wp = DOLLY.field({ label: __('Sede'), type: 'select', options: workplaceOptions(__('Tutte le sedi')) });
		var box = h('div', {}, DOLLY.loading());
		var t;
		search.input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { st.search = search.input.value; st.page = 1; load(); }, 300); });
		status.input.addEventListener('change', function () { st.status = status.input.value; st.page = 1; load(); });
		wp.input.addEventListener('change', function () { st.workplace = wp.input.value; st.page = 1; load(); });
		DOLLY.render(main, DOLLY.card(null, null, [
			h('div', { class: 'dolly-toolbar' }, [search, status, wp, h('div', { class: 'dolly-toolbar__spacer' }), DOLLY.button(__('Nuovo dipendente'), { href: CFG.pages['employee-new'], variant: 'primary', icon: 'user-plus' })]),
			box
		]));
		function load() {
			DOLLY.api('admin/employees', { query: { page: st.page, search: st.search, status: st.status, workplace: st.workplace } }).then(function (r) {
				DOLLY.render(box, [
					DOLLY.table([
						{ label: __('Dipendente'), render: function (e) { return h('div', {}, [h('strong', { text: e.sort_name || e.name }), h('div', { class: 'dolly-small dolly-muted', text: e.username })]); } },
						{ label: __('Contatti'), render: function (e) { return h('div', { class: 'dolly-small' }, [e.email, e.phone ? h('div', { text: e.phone }) : null]); } },
						{ label: __('Sedi'), render: function (e) { return e.workplaces.map(function (w) { return w.name; }).join(', ') || '—'; } },
						{ label: __('Orario'), render: function (e) { var s = e.schedule; return s ? h('div', { class: 'dolly-small' }, [s.on_call ? DOLLY.badge(__('A chiamata'), 'blue', 'phone-call') : null, h('div', { text: s.on_call ? '' : s.summary })]) : '—'; } },
						{ label: __('Stato'), render: function (e) { return e.active ? DOLLY.badge(__('Attivo'), 'green', 'circle-check') : DOLLY.badge(__('Disattivato'), 'neutral', 'ban'); } },
						{ label: '', srLabel: __('Azioni'), render: function (e) { return h('div', { class: 'dolly-actions' }, [DOLLY.button(__('Gestisci'), { size: 'sm', icon: 'pencil', ariaLabel: __('Gestisci ') + e.name, onClick: function () { employeeDialog(e.id, load); } })]); } }
					], r.items, { empty: [__('Nessun dipendente trovato'), __('Modifica i filtri o crea un nuovo dipendente.'), 'users'], caption: __('Elenco dipendenti') }),
					DOLLY.pagination(r, function (p) { st.page = p; load(); }, 'dipendenti')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function employeeDialog(id, done) {
		var body = h('div', {}, DOLLY.loading());
		var dlg = DOLLY.dialog({ title: __('Gestione dipendente'), body: body, wide: true });
		var tab = 'dati';
		function load() {
			DOLLY.api('admin/employees/' + id).then(function (e) { render(e); }, function (err) { DOLLY.render(body, DOLLY.errorState(err, load)); });
		}
		function render(e) {
			var content = h('div');
			var tabs = DOLLY.tabs([{ id: 'dati', label: __('Dati e orario'), icon: 'id-card' }, { id: 'accesso', label: __('Accesso e stato'), icon: 'shield-check' }, { id: 'eccezioni', label: __('Eccezioni verifica'), icon: 'badge-check' }, { id: 'dispositivi', label: __('Gestione dispositivi'), icon: 'smartphone' }, { id: 'storico', label: __('Storico'), icon: 'history' }], tab, function (t) { tab = t; render(e); });
			DOLLY.render(body, [h('p', {}, [h('strong', { text: e.sort_name || e.name }), ' · ' + e.username + ' · ', e.active ? DOLLY.badge(__('Attivo'), 'green', 'circle-check') : DOLLY.badge(__('Disattivato'), 'neutral', 'ban')]), tabs, content]);
			if (tab === 'dati') {
				var form = employeeForm(e, false);
				var reason = DOLLY.field({ label: __('Motivo della modifica'), name: 'reason', optional: true, full: true });
				var save = DOLLY.button(__('Salva modifiche'), { type: 'submit', variant: 'primary', icon: 'save' });
				form.appendChild(reason);
				form.appendChild(h('div', { class: 'dolly-btn-row' }, save));
				form.addEventListener('submit', function (ev) {
					ev.preventDefault();
					var b = form.collect(); if (!b) { return; }
					b.reason = reason.input.value;
					DOLLY.busy(save, DOLLY.api('admin/employees/' + id, { method: 'PUT', body: b })).then(function () { DOLLY.toast(__('Dipendente aggiornato.'), 'success'); done(); load(); }, form.fail);
				});
				DOLLY.render(content, form);
			} else if (tab === 'accesso') {
				var pw = DOLLY.field({ label: __('Nuova password'), name: 'password', type: 'text', help: __('Almeno 8 caratteri. Le sessioni attive del dipendente verranno chiuse.'), attrs: { autocomplete: 'new-password' } });
				var pwBtn = DOLLY.button(__('Imposta password'), { type: 'submit', icon: 'key-round', variant: 'primary' });
				var pwForm = h('form', { class: 'dolly-form', novalidate: true }, [pw, h('div', { class: 'dolly-btn-row' }, pwBtn)]);
				pwForm.addEventListener('submit', function (ev) {
					ev.preventDefault();
					DOLLY.busy(pwBtn, DOLLY.api('admin/employees/' + id + '/password', { method: 'POST', body: { password: pw.input.value } })).then(function (r) { DOLLY.toast(r.message, 'success'); pw.input.value = ''; }, function (err) { DOLLY.formError(pwForm, err); });
				});
				var reason2 = DOLLY.field({ label: __('Motivo'), name: 'reason', type: 'textarea', required: true });
				var stBtn = DOLLY.button(e.active ? __('Disattiva dipendente') : __('Riattiva dipendente'), { type: 'submit', icon: e.active ? 'ban' : 'rotate-ccw', variant: e.active ? 'danger' : 'success' });
				var stForm = h('form', { class: 'dolly-form', novalidate: true }, [
					DOLLY.alert(e.active ? __('La disattivazione chiude subito tutte le sessioni e blocca l\'accesso. Lo storico viene conservato.') : __('Il dipendente potrà di nuovo accedere al portale.'), e.active ? 'warning' : 'info'),
					reason2, h('div', { class: 'dolly-btn-row' }, stBtn)
				]);
				stForm.addEventListener('submit', function (ev) {
					ev.preventDefault();
					if (!reason2.input.value.trim()) { DOLLY.showErrors(stForm, { reason: __('Indica il motivo.') }); return; }
					DOLLY.busy(stBtn, DOLLY.api('admin/employees/' + id + '/status', { method: 'POST', body: { active: !e.active, reason: reason2.input.value } })).then(function () {
						DOLLY.toast(e.active ? __('Dipendente disattivato.') : __('Dipendente riattivato.'), 'success'); done(); load();
					}, function (err) { DOLLY.formError(stForm, err); });
				});
				DOLLY.render(content, h('div', { class: 'dolly-stack' }, [DOLLY.card(__('Password'), 'key-round', pwForm, { level: 'h3' }), DOLLY.card(__('Stato account'), 'shield-check', stForm, { level: 'h3' })]));
			} else if (tab === 'eccezioni') {
				var reason3 = DOLLY.field({ label: __('Motivo'), name: 'reason', type: 'textarea', required: true });
				var customBox = h('div', { class: 'dolly-form-grid', hidden: true });
				var expD = DOLLY.dateField({ label: __('Scadenza: data'), name: 'expires_date', value: CFG.today });
				var expT = DOLLY.timeField({ label: __('Scadenza: ora'), name: 'expires_time', value: '23:59' });
				DOLLY.append(customBox, [expD, expT]);
				var custom = DOLLY.switchControl({ label: __('Scadenza personalizzata'), name: 'custom', checked: false, description: __('Se disattivata, l\'eccezione scade alle 23:59 di oggi.'), onChange: function (on) { customBox.hidden = !on; } });
				var exBtn = DOLLY.button(__('Crea eccezione'), { type: 'submit', icon: 'badge-check', variant: 'primary' });
				var exForm = h('form', { class: 'dolly-form', novalidate: true }, [DOLLY.alert(__('L\'eccezione permette di timbrare senza GPS e senza QR/PIN. Creazione e ogni utilizzo vengono registrati.'), 'info'), reason3, custom, customBox, h('div', { class: 'dolly-btn-row' }, exBtn)]);
				exForm.addEventListener('submit', function (ev) {
					ev.preventDefault(); DOLLY.clearErrors(exForm);
					if (!reason3.input.value.trim()) { DOLLY.showErrors(exForm, { reason: __('Indica il motivo.') }); return; }
					var b = { reason: reason3.input.value };
					if (custom.control.isOn()) {
						var rd = DOLLY.readDateTimes({ expires_date: [expD, 'date', true], expires_time: [expT, 'time', true] });
						if (Object.keys(rd.errors).length) { DOLLY.showErrors(exForm, rd.errors); return; }
						b.expires_at = rd.values.expires_date + ' ' + rd.values.expires_time;
					}
					DOLLY.busy(exBtn, DOLLY.api('admin/employees/' + id + '/exception', { method: 'POST', body: b })).then(function () { DOLLY.toast(__('Eccezione creata.'), 'success'); load(); }, function (err) { DOLLY.formError(exForm, err); });
				});
				DOLLY.render(content, h('div', { class: 'dolly-stack' }, [
					DOLLY.card(__('Nuova eccezione'), 'badge-check', exForm, { level: 'h3' }),
					DOLLY.card(__('Eccezioni recenti'), 'history', DOLLY.table([
						{ label: __('Motivo'), key: 'reason' },
						{ label: __('Scadenza'), render: function (x) { return DOLLY.fmt.dateTime(x.expires_at); } },
						{ label: __('Utilizzi'), key: 'use_count', num: true },
						{ label: __('Creata da'), render: function (x) { return x.created_by + ' · ' + DOLLY.fmt.dateTime(x.created_at); } },
						{ label: __('Stato'), render: function (x) { return x.active ? DOLLY.badge(__('Attiva'), 'green', 'circle-check') : (x.revoked_at ? DOLLY.badge(__('Revocata'), 'neutral', 'ban') : DOLLY.badge(__('Scaduta'), 'neutral', 'clock')); } },
						{ label: '', srLabel: __('Azioni'), render: function (x) { return x.active ? DOLLY.button(__('Revoca'), { size: 'sm', icon: 'ban', onClick: function (ev) { DOLLY.busy(ev.currentTarget, DOLLY.api('admin/exceptions/' + x.id, { method: 'DELETE' })).then(function () { DOLLY.toast(__('Eccezione revocata.'), 'success'); load(); }, function (err) { DOLLY.toast(err.message, 'error'); }); } }) : ''; } }
					], e.exceptions, { empty: [__('Nessuna eccezione'), '', 'badge-check'] }), { level: 'h3' })
				]));
			} else if (tab === 'dispositivi') {
				var ds = e.device_session || { enabled: true, limit: 1, max_limit: 10, devices: [] };
				DOLLY.render(content, h('div', { class: 'dolly-stack' }, [
					ds.enabled ? null : DOLLY.alert(DEVICES_OFF, 'warning'),
					DOLLY.card(__('Dispositivi collegati'), 'smartphone', [
						h('p', { class: 'dolly-muted', style: 'margin-top:0', text: __('Il dipendente accede solo da questi dispositivi. Scollegandone uno viene disconnesso e il prossimo dispositivo con cui accede viene registrato.') }),
						deviceList(ds.devices, e.sort_name || e.name, load)
					], { level: 'h3' }),
					DOLLY.card(__('Limite dispositivi'), 'shield-check', [
						h('p', { class: 'dolly-muted', style: 'margin-top:0', text: __('Numero massimo di dispositivi da cui il dipendente può accedere (predefinito 1, massimo ') + ds.max_limit + ').' }),
						deviceLimitControl(e.id, ds, load)
					], { level: 'h3' })
				]));
			} else {
				DOLLY.render(content, h('div', { class: 'dolly-stack' }, [
					DOLLY.card(__('Storico orari'), 'clock', DOLLY.table([
						{ label: __('Dal'), render: function (s) { return DOLLY.fmt.date(s.valid_from); } },
						{ label: __('Al'), render: function (s) { return s.valid_to ? DOLLY.fmt.date(s.valid_to) : __('in corso'); } },
						{ label: __('Orario'), render: function (s) { return h('span', { class: 'dolly-small', text: s.summary }); } },
						{ label: __('Tipo'), key: 'employment_label' }
					], e.schedule_history), { level: 'h3' }),
					DOLLY.card(__('Registro modifiche'), 'history', auditList(e.audit), { level: 'h3' })
				]));
			}
			DOLLY.icons();
		}
		load();
		return dlg;
	}

	function auditList(items) {
		return DOLLY.table([
			{ label: __('Data'), render: function (a) { return DOLLY.fmt.dateTime(a.created_at); } },
			{ label: __('Operazione'), key: 'label' },
			{ label: __('Eseguita da'), key: 'actor' },
			{ label: __('Dipendente'), key: 'subject' },
			{ label: __('Motivo'), key: 'reason' },
			{ label: __('Valori'), render: function (a) {
				if (!a.before && !a.after) { return '—'; }
				return h('details', {}, [h('summary', { text: __('Prima / dopo') }), h('pre', { class: 'dolly-small', style: 'white-space:pre-wrap;max-width:420px', text: __('Prima: ') + JSON.stringify(a.before, null, 1) + __('\nDopo: ') + JSON.stringify(a.after, null, 1) })]);
			} }
		], items, { empty: [__('Nessuna modifica registrata'), '', 'history'], caption: __('Registro modifiche') });
	}

	/* ------------------------------------------------------------------ */
	/* Workplaces                                                           */
	/* ------------------------------------------------------------------ */

	function pageWorkplaces() {
		var box = h('div', {}, DOLLY.loading());
		DOLLY.render(main, DOLLY.card(null, null, [
			h('div', { class: 'dolly-toolbar' }, [h('p', { class: 'dolly-muted', style: 'margin:0', text: __('Ogni sede ha un account dedicato che mostra QR e PIN su ') + CFG.portalUrl.replace('/portale/', '/accesso-sede/') }), h('div', { class: 'dolly-toolbar__spacer' }), DOLLY.button(__('Nuova sede'), { variant: 'primary', icon: 'plus', onClick: function () { workplaceDialog(null, load); } })]),
			box
		]));
		function load() {
			refreshWorkplaces().then(function (list) {
				DOLLY.render(box, DOLLY.table([
					{ label: __('Sede'), render: function (w) { return h('div', {}, [h('strong', { text: w.name }), h('div', { class: 'dolly-small dolly-muted', text: [w.address, w.city, w.province].filter(Boolean).join(', ') })]); } },
					{ label: __('Coordinate'), render: function (w) { return w.lat !== null ? h('span', { class: 'dolly-small', text: String(w.lat).replace('.', ',') + ' / ' + String(w.lng).replace('.', ',') }) : DOLLY.badge(__('Non impostate'), 'amber', 'triangle-alert'); } },
					{ label: __('Raggio'), render: function (w) { return w.radius_m + ' m'; }, num: true },
					{ label: __('Tolleranza ritardo'), render: function (w) { return w.late_tolerance === null || w.late_tolerance === undefined ? h('span', { class: 'dolly-muted', text: __('Predefinita (') + (CFG.lateTolerance || 0) + __(' min)') }) : w.late_tolerance + __(' min'); } },
					{ label: __('Account sede'), render: function (w) { return w.account_username ? w.account_username : DOLLY.badge(__('Mancante'), 'amber', 'triangle-alert'); } },
					{ label: 'Bluetooth', render: function (w) { return w.bluetooth ? DOLLY.badge(__('Attivo'), 'green', 'bluetooth') : h('span', { class: 'dolly-muted', text: __('No') }); } },
					{ label: __('Stato'), render: function (w) { return w.active ? DOLLY.badge(__('Attiva'), 'green', 'circle-check') : DOLLY.badge(__('Disattivata'), 'neutral', 'ban'); } },
					{ label: '', srLabel: __('Azioni'), render: function (w) { return h('div', { class: 'dolly-actions' }, [
						DOLLY.button('Bluetooth', { size: 'sm', icon: 'bluetooth', ariaLabel: __('Dispositivo Bluetooth di ') + w.name, onClick: function () { bluetoothDialog(w, load); } }),
						DOLLY.button(__('Modifica'), { size: 'sm', icon: 'pencil', ariaLabel: __('Modifica ') + w.name, onClick: function () { workplaceDialog(w, load); } })
					]); } }
				], list, { empty: [__('Nessuna sede'), __('Crea la prima sede per assegnare i dipendenti.'), 'map-pin'], caption: __('Sedi') }));
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function workplaceDialog(w, done) {
		var isNew = !w; w = w || { radius_m: CFG.defaultRadius || 100, active: true };
		var alertBox = h('div', { hidden: true });
		var num = function (v) { return v === null || v === undefined ? '' : String(v); };
		var f = {
			name: DOLLY.field({ label: __('Nome sede'), name: 'name', value: w.name, required: true }),
			address: DOLLY.field({ label: __('Indirizzo'), name: 'address', value: w.address }),
			city: DOLLY.field({ label: __('Città'), name: 'city', value: w.city }),
			province: DOLLY.field({ label: __('Provincia'), name: 'province', value: w.province, attrs: { maxlength: 4, autocapitalize: 'characters' } }),
			lat: DOLLY.field({ label: __('Latitudine'), name: 'lat', value: num(w.lat), attrs: { inputmode: 'decimal', placeholder: __('es. 45,0703') } }),
			lng: DOLLY.field({ label: __('Longitudine'), name: 'lng', value: num(w.lng), attrs: { inputmode: 'decimal', placeholder: __('es. 7,6869') } }),
			radius_m: DOLLY.field({ label: __('Raggio consentito (metri)'), name: 'radius_m', type: 'number', value: w.radius_m, attrs: { min: 10, max: 5000, step: 1 } }),
			late_tolerance: DOLLY.field({ label: __('Tolleranza ritardo in entrata (minuti)'), name: 'late_tolerance', type: 'number', value: num(w.late_tolerance), optional: true, help: __('Vuoto = valore predefinito delle Impostazioni (') + (CFG.lateTolerance || 0) + __(' min). Un\'entrata entro la tolleranza conta come entrata regolare.'), attrs: { min: 0, max: 120, step: 1, placeholder: String(CFG.lateTolerance || 0) } }),
			account_username: DOLLY.field({ label: __('Nome utente account sede'), name: 'account_username', value: w.account_username, attrs: w.account_username ? { readonly: true } : { autocomplete: 'off', autocapitalize: 'none' }, help: w.account_username ? __('Non modificabile.') : __('Crea l\'account dedicato allo schermo della sede.') }),
			account_password: DOLLY.field({ label: w.account_username ? __('Nuova password account sede') : __('Password account sede'), name: 'account_password', type: 'text', optional: !!w.account_username, help: __('Almeno 8 caratteri.'), attrs: { autocomplete: 'new-password' } })
		};
		var active = DOLLY.switchControl({ label: __('Sede attiva'), name: 'active', checked: w.active !== false });
		var locate = DOLLY.button(__('Usa la posizione attuale'), { icon: 'locate-fixed', onClick: function () {
			if (!navigator.geolocation) { DOLLY.toast(__('Geolocalizzazione non supportata.'), 'error'); return; }
			locate.classList.add('is-loading');
			navigator.geolocation.getCurrentPosition(function (p) {
				locate.classList.remove('is-loading');
				f.lat.input.value = p.coords.latitude.toFixed(7).replace('.', ',');
				f.lng.input.value = p.coords.longitude.toFixed(7).replace('.', ',');
				DOLLY.toast(__('Coordinate inserite (precisione ±') + Math.round(p.coords.accuracy) + ' m).', 'success');
			}, function (e) { locate.classList.remove('is-loading'); DOLLY.toast(e.code === 1 ? __('Accesso alla posizione negato.') : __('Posizione non disponibile.'), 'error'); }, { enableHighAccuracy: true, timeout: 15000 });
		} });
		var form = h('form', { class: 'dolly-form', novalidate: true }, [
			alertBox,
			h('div', { class: 'dolly-form-grid' }, [f.name, f.address, f.city, f.province]),
			h('h3', {}, [DOLLY.icon('map'), __(' Posizione GPS')]),
			h('div', { class: 'dolly-form-grid dolly-form-grid--3' }, [f.lat, f.lng, f.radius_m]),
			h('div', { class: 'dolly-btn-row' }, locate),
			h('h3', {}, [DOLLY.icon('clock'), __(' Timbrature')]),
			h('div', { class: 'dolly-form-grid' }, [f.late_tolerance]),
			h('h3', {}, [DOLLY.icon('monitor'), __(' Account dello schermo sede')]),
			h('div', { class: 'dolly-form-grid' }, [f.account_username, f.account_password]),
			active
		]);
		DOLLY.dialog({
			title: isNew ? __('Nuova sede') : __('Modifica sede'), body: form, wide: true,
			actions: [{ label: __('Annulla') }, { label: __('Salva sede'), variant: 'primary', icon: 'save', onClick: function (close, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var body = {
					name: f.name.input.value, address: f.address.input.value, city: f.city.input.value, province: f.province.input.value,
					lat: f.lat.input.value.trim().replace(',', '.'), lng: f.lng.input.value.trim().replace(',', '.'),
					radius_m: f.radius_m.input.value, late_tolerance: f.late_tolerance.input.value.trim(), active: active.control.isOn(),
					account_password: f.account_password.input.value
				};
				if (!w.account_username) { body.account_username = f.account_username.input.value; }
				var p = isNew ? DOLLY.api('admin/workplaces', { method: 'POST', body: body }) : DOLLY.api('admin/workplaces/' + w.id, { method: 'PUT', body: body });
				DOLLY.busy(btn, p).then(function () { close(); DOLLY.toast(__('Sede salvata.'), 'success'); done(); }, function (err) { DOLLY.formError(form, err, alertBox); });
			} }]
		});
	}

	/**
	 * Bluetooth device of a workplace: activation, configuration file for the firmware,
	 * current code for testing and key regeneration.
	 */
	function bluetoothDialog(w, done) {
		var body = h('div', { class: 'dolly-stack' }, DOLLY.loading());
		var dlg = DOLLY.dialog({ title: __('Bluetooth · ') + w.name, body: body, wide: true, onClose: done, actions: [{ label: __('Chiudi') }] });
		var guide = h('details', {}, [
			h('summary', { text: __('Dispositivo consigliato e installazione') }),
			h('div', { class: 'dolly-stack', style: 'margin-top:12px' }, [
				h('p', { text: __('Serve una piccola scheda ESP32 con Bluetooth e Wi-Fi, alimentata da un caricatore USB-C, fissata vicino all\'ingresso:') }),
				h('ul', {}, [
					h('li', {}, [h('strong', { text: 'M5Stack AtomS3 Lite' }), __(' (consigliato, circa 9–12 €): già in un guscio di plastica, con LED di stato e pulsante.')]),
					h('li', {}, [h('strong', { text: 'Seeed Studio XIAO ESP32-C3' }), __(' (circa 5–7 €): più economico, da mettere in una scatolina.')])
				]),
				h('ol', {}, [
					h('li', { text: __('Installa Arduino IDE e il supporto per le schede "esp32" di Espressif (Strumenti › Scheda › Gestore schede).') }),
					h('li', {}, [__('Apri il firmware: cartella '), h('code', { text: 'firmware/dolly-ble-beacon' }), __(' del plugin ('), h('a', { href: CFG.firmwareUrl, target: '_blank', rel: 'noopener', text: __('istruzioni complete') }), ').']),
					h('li', {}, [__('Sostituisci il file '), h('code', { text: 'config.h' }), __(' con quello qui sotto e, se il dispositivo deve funzionare da solo, inserisci nome e password del Wi-Fi.')]),
					h('li', { text: __('Collega la scheda al computer con un cavo USB-C e premi Carica.') }),
					h('li', { text: __('Con il Wi-Fi il dispositivo calcola il codice da solo (ora da internet). Senza Wi-Fi, apri lo schermo sede su un tablet Android con Chrome e tocca «Collega il Bluetooth»: il tablet invierà il codice al dispositivo.') })
				]),
				DOLLY.alert(__('I telefoni Android leggono il dispositivo con Chrome, Edge o Samsung Internet. Su iPhone Safari non supporta il Bluetooth per i siti web: serve l\'app gratuita Bluefy, oppure lascia attivi anche QR/PIN o GPS.'), 'info')
			])
		]);
		function render(d) {
			if (!d.configured) {
				DOLLY.render(body, [
					h('p', { text: __('I dipendenti potranno timbrare avvicinando il telefono al dispositivo Bluetooth della sede: il telefono legge un codice che cambia ogni 30 secondi e che arriva solo a pochi metri.') }),
					guide,
					h('div', { class: 'dolly-btn-row' }, DOLLY.button(__('Attiva il Bluetooth per questa sede'), { variant: 'primary', icon: 'bluetooth', onClick: function (e) { save({ enabled: true }, e.currentTarget); } }))
				]);
				return;
			}
			var enabled = DOLLY.switchControl({ label: __('Bluetooth attivo per questa sede'), checked: d.enabled, description: __('Disattivato: i codici del dispositivo non vengono accettati.'), onChange: function (on) { save({ enabled: on }); } });
			var code = h('pre', { class: 'dolly-code', text: d.config });
			var copy = DOLLY.button(__('Copia'), { size: 'sm', icon: 'copy', onClick: function () {
				(navigator.clipboard ? navigator.clipboard.writeText(d.config) : Promise.reject()).then(function () { DOLLY.toast(__('Configurazione copiata.'), 'success'); }, function () { DOLLY.toast(__('Copia non riuscita: seleziona il testo e copialo.'), 'error'); });
			} });
			var download = DOLLY.button(__('Scarica config.h'), { size: 'sm', icon: 'download', onClick: function () {
				var a = h('a', { href: URL.createObjectURL(new Blob([d.config], { type: 'text/plain' })), download: 'config.h' });
				document.body.appendChild(a); a.click(); a.remove();
			} });
			var regen = DOLLY.button(__('Genera una nuova chiave'), { size: 'sm', icon: 'key-round', variant: 'ghost', onClick: function () {
				DOLLY.confirm(__('Generare una nuova chiave?'), __('Il dispositivo attuale smetterà di funzionare finché non carichi la nuova configurazione. Usala se il dispositivo è stato perso o la chiave è stata condivisa.'), __('Genera nuova chiave'), 'danger').then(function (ok) { if (ok) { save({ regenerate: true }); } });
			} });
			DOLLY.render(body, [
				enabled,
				h('dl', { class: 'dolly-dl' }, [
					h('dt', { text: __('Codice attuale') }), h('dd', {}, [h('strong', { text: d.test_code ? d.test_code.slice(0, 3) + ' ' + d.test_code.slice(3) : '—' }), h('span', { class: 'dolly-help', text: __(' Per una prova: deve coincidere con quello del dispositivo (monitor seriale di Arduino IDE).') })]),
					h('dt', { text: __('Chiave creata') }), h('dd', { text: d.created_at ? DOLLY.fmt.dateTime(d.created_at) : '—' })
				]),
				h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('Configurazione del dispositivo (config.h)') }), code, h('div', { class: 'dolly-btn-row' }, [copy, download, regen]), h('span', { class: 'dolly-help', text: __('Contiene la chiave segreta della sede: non condividerla. Chi la possiede può generare codici validi.') })]),
				guide
			]);
		}
		function save(data, btn) {
			DOLLY.busy(btn, DOLLY.api('admin/workplaces/' + w.id + '/bluetooth', { method: 'POST', body: data })).then(function (d) { render(d); DOLLY.toast(__('Bluetooth aggiornato.'), 'success'); }, function (err) { DOLLY.toast(err.message, 'error'); });
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
				DOLLY.tabs([{ id: 'richieste', label: __('Ferie, permessi, donazioni, straordinari e correzioni'), icon: 'inbox' }, { id: 'malattie', label: __('Malattie, infortuni e certificati'), icon: 'stethoscope' }], tab, function (t) { tab = t; window.location.hash = t === 'malattie' ? 'malattie' : ''; renderTabs(); }),
				content
			]);
			if (tab === 'richieste') { requestsTab(content); } else { sicknessTab(content); }
		}
		renderTabs();
	}

	function requestsTab(content) {
		var st = { page: 1, status: 'pending', type: '', workplace: '' };
		var status = DOLLY.field({ label: __('Stato'), type: 'select', value: st.status, options: [{ value: '', label: __('Tutti') }, { value: 'pending', label: __('In attesa') }, { value: 'approved', label: __('Approvate') }, { value: 'rejected', label: __('Respinte') }, { value: 'cancelled', label: __('Annullate') }, { value: 'superseded', label: __('Sostituite') }] });
		var type = DOLLY.field({ label: __('Tipo'), type: 'select', options: [{ value: '', label: __('Tutti') }].concat(Object.keys(TYPES).map(function (k) { return { value: k, label: TYPES[k] }; })) });
		var wp = DOLLY.field({ label: __('Sede'), type: 'select', options: workplaceOptions(__('Tutte le sedi')) });
		var box = h('div', {}, DOLLY.loading());
		[[status, 'status'], [type, 'type'], [wp, 'workplace']].forEach(function (x) { x[0].input.addEventListener('change', function () { st[x[1]] = x[0].input.value; st.page = 1; load(); }); });
		DOLLY.render(content, DOLLY.card(null, null, [
			h('div', { class: 'dolly-toolbar' }, [status, type, wp, h('div', { class: 'dolly-toolbar__spacer' }), DOLLY.button(__('Segnala infortunio'), { icon: 'bandage', onClick: function () { authorizationDialog(load, { type: 'infortunio' }); } }), DOLLY.button(__('Nuova autorizzazione'), { variant: 'primary', icon: 'calendar-plus', onClick: function () { authorizationDialog(load); } })]),
			box
		]));
		function load() {
			DOLLY.api('admin/requests', { query: { page: st.page, status: st.status, type: st.type, workplace: st.workplace } }).then(function (r) {
				DOLLY.render(box, [
					DOLLY.table([
						{ label: __('Dipendente'), key: 'employee' },
						{ label: __('Richiesta'), render: function (x) { return h('div', {}, [h('strong', { text: x.type_label }), x.source === 'auto' ? [' ', DOLLY.badge(__('Rilevato automaticamente'), 'amber', 'alarm-clock-plus')] : null, h('div', { class: 'dolly-small', text: x.summary }), x.notes ? h('div', { class: 'dolly-small dolly-muted', text: __('Note: ') + x.notes }) : null, donationCertificate(x, load)]); } },
						{ label: __('Inviata'), render: function (x) { return DOLLY.fmt.dateTime(x.created_at); } },
						{ label: __('Stato'), render: function (x) { return h('div', {}, [DOLLY.requestBadge(x.status, x.status_label), x.decided_at ? h('div', { class: 'dolly-small dolly-muted', text: x.decided_by + ' · ' + DOLLY.fmt.dateTime(x.decided_at) + (x.decision_note ? ' · ' + x.decision_note : '') }) : null]); } },
						{ label: '', srLabel: __('Azioni'), render: function (x) {
							if (x.status === 'pending') { return decisionButtons(x, load); }
							// Every approved request stays subject to verification: vacation, leave and donation can be revoked.
							var revocable = x.status === 'approved' && x.amend_action !== 'cancel' && ['ferie', 'permesso', 'donazione'].indexOf(x.type) !== -1;
							return revocable ? h('div', { class: 'dolly-actions' }, DOLLY.button(__('Revoca'), { size: 'sm', icon: 'undo-2', ariaLabel: __('Revoca la richiesta di ') + x.employee, onClick: function () { revokeDialog(x, load); } })) : '';
						} }
					], r.items, { empty: [__('Nessuna richiesta'), __('Nessuna richiesta corrisponde ai filtri.'), 'inbox'], caption: __('Richieste') }),
					DOLLY.pagination(r, function (p) { st.page = p; load(); }, 'richieste')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function employeeSelect(label, value) {
		var f = DOLLY.field({ label: label || __('Dipendente'), name: 'user_id', type: 'select', value: value || '', options: [{ value: '', label: __('Caricamento…') }] });
		allEmployees().then(function (list) {
			DOLLY.clear(f.input);
			f.input.appendChild(h('option', { value: '', text: __('Seleziona…') }));
			list.forEach(function (e) { f.input.appendChild(h('option', { value: e.id, selected: String(e.id) === String(value) ? true : null, text: e.name + (e.active ? '' : __(' (disattivato)')) })); });
		});
		return f;
	}

	/**
	 * Administrators create authorisations already approved: vacation, hourly leave, extra work
	 * (before or after the working day), or register sickness / injury on behalf of the employee.
	 */
	var AUTH_TYPES = [
		{ value: 'ferie', label: __('Ferie') },
		{ value: 'permesso', label: __('Permesso orario') },
		{ value: 'straordinario', label: __('Straordinario') },
		{ value: 'donazione', label: __('Donazione sangue') },
		{ value: 'malattia', label: __('Malattia') },
		{ value: 'infortunio', label: __('Infortunio') }
	];

	function authorizationDialog(done, preset) {
		preset = preset || {};
		var alertBox = h('div', { hidden: true });
		var emp = employeeSelect(null, preset.user_id);
		var typeF = DOLLY.field({ label: __('Tipo'), name: 'type', type: 'select', value: preset.type || 'ferie', options: AUTH_TYPES });
		var box = h('div', { class: 'dolly-form-grid dolly-field--full' });
		var info = h('div', { class: 'dolly-field--full' });
		var f = {};
		var note = DOLLY.field({ label: __('Nota per il dipendente'), name: 'decision_note', type: 'textarea', optional: true, full: true });

		function build() {
			var t = typeF.input.value;
			f = {};
			var nodes = [];
			if (t === 'straordinario') {
				f.start_date = DOLLY.dateField({ label: __('Data'), name: 'start_date', value: CFG.today, required: true });
				f.extra_kind = DOLLY.radios({ label: __('Tipo di giornata'), name: 'extra_kind', value: 'working_day', full: true, options: [
					{ value: 'working_day', label: __('Giorno lavorativo'), description: __('Autorizza lo straordinario fino all\'orario di uscita indicato.') },
					{ value: 'rest_day', label: __('Giorno di riposo'), description: __('Autorizza la timbratura con inizio, fine ed eventuale pausa.') }
				], onChange: buildExtra });
				f._extraBox = h('div', { class: 'dolly-form-grid dolly-field--full' });
				nodes.push(f.start_date, f.extra_kind, f._extraBox);
			} else if (t === 'donazione') {
				f.start_date = DOLLY.dateField({ label: __('Giorno della donazione'), name: 'start_date', value: CFG.today, required: true });
				nodes.push(f.start_date);
			} else {
				if (t === 'permesso') {
					// Kind of leave and justification code recorded in the hours history.
					f.leave_kind = DOLLY.field({ label: __('Tipo di permesso'), name: 'leave_kind', type: 'select', value: 'retribuito', options: LEAVE_KINDS });
					f.hours_code = DOLLY.field({ label: __('Giustificativo (storico ore)'), name: 'hours_code', type: 'select', options: leaveCodeOptions('retribuito') });
					f.leave_kind.input.addEventListener('change', function () {
						DOLLY.clear(f.hours_code.input);
						leaveCodeOptions(f.leave_kind.input.value).forEach(function (o) { f.hours_code.input.appendChild(h('option', { value: o.value, text: o.label })); });
					});
					nodes.push(f.leave_kind, f.hours_code);
				}
				f.start_date = DOLLY.dateField({ label: __('Dal'), name: 'start_date', value: CFG.today, required: true });
				f.end_date = DOLLY.dateField({ label: __('Al'), name: 'end_date', value: CFG.today, required: true });
				nodes.push(f.start_date, f.end_date);
				if (t === 'permesso') {
					f.start_time = DOLLY.timeField({ label: __('Dalle ore'), name: 'start_time', required: true });
					f.end_time = DOLLY.timeField({ label: __('Alle ore'), name: 'end_time', required: true });
					nodes.push(f.start_time, f.end_time);
				}
			}
			DOLLY.render(box, nodes);
			DOLLY.render(info, t === 'malattia' || t === 'infortunio'
				? DOLLY.alert((t === 'infortunio' ? __('Segnalazione dell\'infortunio per conto del dipendente (sul lavoro o nel tragitto casa-lavoro): ') : __('Segnalazione della malattia per conto del dipendente: ')) + __('viene registrata subito e il dipendente riceve una notifica. Il certificato medico segue le regole delle Impostazioni: puoi caricarlo dalla scheda "Malattie, infortuni e certificati".'), 'info')
				: DOLLY.alert(__('L\'autorizzazione è già approvata: compare subito nel calendario e nelle presenze del dipendente, che riceve una notifica.'), 'info'));
			if (t === 'straordinario') { buildExtra(); }
		}
		function buildExtra() {
			var nodes = [];
			f.start_time = f.has_lunch = f.lunch_start = f.lunch_end = null;
			if (f.extra_kind.value() === 'rest_day') {
				f.start_time = DOLLY.timeField({ label: __('Inizio'), name: 'start_time', required: true });
				f.end_time = DOLLY.timeField({ label: __('Fine'), name: 'end_time', required: true });
				var lb = h('div', { class: 'dolly-form-grid dolly-field--full', hidden: true });
				f.lunch_start = DOLLY.timeField({ label: __('Inizio pausa'), name: 'lunch_start' });
				f.lunch_end = DOLLY.timeField({ label: __('Fine pausa'), name: 'lunch_end' });
				DOLLY.append(lb, [f.lunch_start, f.lunch_end]);
				f.has_lunch = DOLLY.switchControl({ label: __('Pausa pranzo'), name: 'has_lunch', onChange: function (on) { lb.hidden = !on; } });
				nodes.push(f.start_time, f.end_time, h('div', { class: 'dolly-field--full' }, f.has_lunch), lb);
			} else {
				f.end_time = DOLLY.timeField({ label: __('Uscita autorizzata fino alle'), name: 'end_time', required: true });
				nodes.push(f.end_time);
			}
			DOLLY.render(f._extraBox, nodes);
		}
		typeF.input.addEventListener('change', build);
		var form = h('form', { class: 'dolly-form', novalidate: true }, [alertBox, h('div', { class: 'dolly-form-grid' }, [emp, typeF, info, box, note])]);
		build();

		DOLLY.dialog({
			title: preset.type === 'infortunio' ? __('Segnala infortunio') : (preset.type === 'malattia' ? __('Registra malattia') : __('Nuova autorizzazione')), body: form, wide: true,
			actions: [{ label: __('Annulla') }, { label: __('Conferma'), variant: 'primary', icon: 'check', onClick: function (close, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var t = typeF.input.value;
				var spec = {};
				['start_date', 'end_date'].forEach(function (k) { if (f[k]) { spec[k] = [f[k], 'date', true]; } });
				['start_time', 'end_time'].forEach(function (k) { if (f[k]) { spec[k] = [f[k], 'time', true]; } });
				var lunch = f.has_lunch && f.has_lunch.control.isOn();
				if (lunch) { spec.lunch_start = [f.lunch_start, 'time', true]; spec.lunch_end = [f.lunch_end, 'time', true]; }
				var rd = DOLLY.readDateTimes(spec);
				if (!emp.input.value) { rd.errors.user_id = __('Seleziona un dipendente.'); }
				if (Object.keys(rd.errors).length) { DOLLY.showErrors(form, rd.errors); return; }
				var body = Object.assign({ user_id: emp.input.value, type: t, decision_note: note.input.value, notes: note.input.value || __('Autorizzato dall\'amministratore.') }, rd.values);
				if (t === 'straordinario') { body.extra_kind = f.extra_kind.value(); body.has_lunch = !!lunch; body.end_date = body.start_date; }
				if (t === 'donazione') { body.end_date = body.start_date; }
				if (t === 'permesso') {
					body.leave_kind = f.leave_kind.input.value; body.hours_code = f.hours_code.input.value;
					// The note is the event of the leave: mandatory for leaves for specific events.
					if (body.leave_kind === 'evento' && !note.input.value.trim()) { DOLLY.showErrors(form, { decision_note: __('Indica l\'evento per cui viene concesso il permesso.') }); return; }
				}
				if (t === 'malattia' || t === 'infortunio') { body.notes = note.input.value; }
				var label = AUTH_TYPES.filter(function (x) { return x.value === t; })[0].label;
				DOLLY.busy(btn, DOLLY.api('admin/authorizations', { method: 'POST', body: body })).then(function () {
					close(); DOLLY.toast(label + (t === 'malattia' || t === 'infortunio' ? __(': segnalazione registrata per il dipendente.') : __(': autorizzazione registrata.')), 'success'); done();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			} }]
		});
	}

	function sicknessTab(content) {
		var st = { page: 1, kind: '', certificate_status: '', workplace: '' };
		var kind = DOLLY.field({ label: __('Tipo'), type: 'select', options: [{ value: '', label: __('Tutti') }, { value: 'malattia', label: __('Malattia') }, { value: 'infortunio', label: __('Infortunio') }] });
		var cs = DOLLY.field({ label: __('Certificato'), type: 'select', options: [{ value: '', label: __('Tutti') }, { value: 'missing', label: __('Mancante') }, { value: 'overdue', label: __('Scaduto') }, { value: 'uploaded', label: __('Caricato') }, { value: 'not_required', label: __('Non richiesto') }, { value: 'cleared', label: __('Requisito annullato') }] });
		var wp = DOLLY.field({ label: __('Sede'), type: 'select', options: workplaceOptions(__('Tutte le sedi')) });
		var box = h('div', {}, DOLLY.loading());
		kind.input.addEventListener('change', function () { st.kind = kind.input.value; st.page = 1; load(); });
		cs.input.addEventListener('change', function () { st.certificate_status = cs.input.value; st.page = 1; load(); });
		wp.input.addEventListener('change', function () { st.workplace = wp.input.value; st.page = 1; load(); });
		DOLLY.render(content, DOLLY.card(null, null, [h('div', { class: 'dolly-toolbar' }, [kind, cs, wp, h('div', { class: 'dolly-toolbar__spacer' }), DOLLY.button(__('Segnala infortunio'), { icon: 'bandage', onClick: function () { authorizationDialog(load, { type: 'infortunio' }); } }), DOLLY.button(__('Registra malattia'), { variant: 'primary', icon: 'stethoscope', onClick: function () { authorizationDialog(load, { type: 'malattia' }); } })]), box]));
		function load() {
			DOLLY.api('admin/sickness', { query: st }).then(function (r) {
				DOLLY.render(box, [
					DOLLY.table([
						{ label: __('Dipendente'), key: 'employee' },
						{ label: __('Tipo'), render: function (s) { return DOLLY.badge(s.kind_label || __('Malattia'), 'red', s.kind === 'infortunio' ? 'bandage' : 'stethoscope'); } },
						{ label: __('Periodo'), render: function (s) { return DOLLY.fmt.date(s.start_date) + ' – ' + DOLLY.fmt.date(s.end_date); } },
						{ label: __('Segnalata'), render: function (s) { return DOLLY.fmt.dateTime(s.reported_at); } },
						{ label: __('Certificato'), render: function (s) {
							return h('div', {}, [DOLLY.certBadge(s.certificate_status, s.certificate_label), s.certificate_due && (s.certificate_status === 'missing' || s.certificate_status === 'overdue') ? h('div', { class: 'dolly-small', text: __('Scadenza ') + DOLLY.fmt.date(s.certificate_due) }) : null,
								s.certificates.map(function (c) { return h('div', { class: 'dolly-small' }, h('a', { href: DOLLY.downloadUrl('certificates/' + c.id + '/download') }, [DOLLY.icon('download'), ' ' + c.original_name])); })]);
						} },
						{ label: __('Note'), render: function (s) { return s.notes ? h('span', { class: 'dolly-small', text: s.notes }) : '—'; } },
						{ label: __('Conflitti'), render: function (s) { return s.conflict ? h('div', {}, [DOLLY.badge(s.reviewed ? __('Verificato') : __('Da verificare'), s.reviewed ? 'green' : 'amber', s.reviewed ? 'circle-check' : 'triangle-alert'), h('div', { class: 'dolly-small', style: 'white-space:pre-line', text: s.conflict_details })]) : '—'; } },
						{ label: '', srLabel: __('Azioni'), render: function (s) { return sicknessActions(s, load); } }
					], r.items, { empty: [__('Nessuna malattia o infortunio'), '', 'stethoscope'], caption: __('Malattie e infortuni') }),
					DOLLY.pagination(r, function (p) { st.page = p; load(); }, 'malattie')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function sicknessActions(s, done) {
		var file = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png', class: 'dolly-sr-only', 'aria-label': __('File certificato per ') + s.employee });
		var up = DOLLY.button(__('Carica certificato'), { size: 'sm', icon: 'file-up', onClick: function () { file.click(); } });
		file.addEventListener('change', function () {
			var fl = file.files[0]; if (!fl) { return; }
			if (fl.size > 10485760) { DOLLY.toast(__('Il file supera i 10 MB.'), 'error'); return; }
			var fd = new FormData(); fd.append('file', fl);
			DOLLY.busy(up, DOLLY.api('admin/sickness/' + s.id + '/certificate', { method: 'POST', form: fd, timeout: 120000 })).then(function () { DOLLY.toast(__('Certificato caricato.'), 'success'); done(); }, function (err) { DOLLY.toast(err.message, 'error'); });
		});
		var btns = [up, file];
		if (s.conflict && !s.reviewed) {
			btns.push(DOLLY.button(__('Segna come verificato'), { size: 'sm', icon: 'shield-check', onClick: function () {
				var note = DOLLY.field({ label: __('Nota di verifica'), name: 'note', type: 'textarea', required: true });
				var form = h('form', { class: 'dolly-form' }, [h('p', { style: 'white-space:pre-line', text: s.conflict_details }), note]);
				DOLLY.dialog({ title: __('Verifica conflitto'), body: form, actions: [{ label: __('Annulla') }, { label: __('Conferma verifica'), variant: 'primary', icon: 'check', onClick: function (close, btn) {
					DOLLY.busy(btn, DOLLY.api('admin/sickness/' + s.id + '/review', { method: 'POST', body: { note: note.input.value } })).then(function () { close(); DOLLY.toast(__('Conflitto verificato.'), 'success'); done(); }, function (err) { DOLLY.formError(form, err); });
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
		if (r.ferie) { p.push(__('Ferie')); }
		if (r.donazione) { p.push(__('Donazione sangue')); }
		if (r.permesso) { p.push(__('Permesso ') + r.permesso); }
		if (r.malattia) { p.push(r.sick_label || __('Malattia')); }
		if (r.certificate_status === 'missing' || r.certificate_status === 'overdue') { p.push(r.certificate); }
		r.pending.forEach(function (x) { p.push(__('In attesa: ') + x); });
		return p.join(', ');
	}

	/* ------------------------------------------------------------------ */
	/* Attendance: by employee (month) and by date (all the employees)     */
	/* ------------------------------------------------------------------ */

	/** Columns shared by the two views, after the first one (date or employee). */
	function attendanceColumns(userOf, reload) {
		var today = DOLLY.fmt.today();
		return [
			{ label: __('Stato'), render: function (r) { return h('div', {}, [DOLLY.dayStatusBadge(r.status), r.corrected ? h('div', {}, DOLLY.badge(__('Corretta'), 'neutral', 'pencil')) : null]); } },
			{ label: __('Entrata'), cls: 'time', render: function (r) { return DOLLY.countedTime(r.entrata, r.entrata_real, r.late_min); } },
			{ label: __('Inizio pausa'), cls: 'time', render: function (r) { return r.inizio_pausa || (r.lunch_auto ? h('span', { class: 'dolly-small dolly-muted', text: 'automatica' }) : '—'); } },
			{ label: __('Fine pausa'), key: 'fine_pausa', cls: 'time' },
			{ label: __('Uscita'), cls: 'time', render: function (r) { return DOLLY.countedTime(r.uscita, r.uscita_real); } },
			{ label: __('Assenze'), render: function (r) {
				var b = [];
				if (r.ferie) { b.push(DOLLY.badge(__('Ferie'), 'blue', 'sun')); }
				if (r.donazione) { b.push(DOLLY.badge(__('Donazione sangue'), 'blue', 'droplet')); }
				if (r.permesso) { b.push(DOLLY.badge(__('Permesso ') + r.permesso, 'blue', 'timer')); }
				if (r.malattia) { b.push(DOLLY.badge(r.sick_label || __('Malattia'), 'red', r.status === 'infortunio' ? 'bandage' : 'stethoscope')); }
				if (r.certificate_status === 'missing' || r.certificate_status === 'overdue') { b.push(DOLLY.certBadge(r.certificate_status, r.certificate)); }
				r.pending.forEach(function (p) { b.push(DOLLY.badge(__('In attesa: ') + p, 'amber', 'hourglass')); });
				return b.length ? h('div', { class: 'dolly-btn-row' }, b) : '—';
			} },
			{ label: __('Ore'), num: true, render: DOLLY.hoursCell },
			{ label: __('Straordinario'), render: DOLLY.extraCell },
			{ label: __('Giustificativi'), render: function (r) { return DOLLY.hoursCodes(r.hours); } },
			{ label: __('Anomalie'), render: function (r) { return r.anomalies.length ? h('div', { class: 'dolly-btn-row' }, r.anomalies.map(function (a) { return DOLLY.badge(a, 'red', 'triangle-alert'); })) : '—'; } },
			{ label: '', srLabel: __('Azioni'), render: function (r) {
				return r.date <= today ? DOLLY.button(__('Correggi'), { size: 'sm', icon: 'pencil', ariaLabel: __('Correggi ') + (r.employee ? r.employee + ', ' : '') + r.date_label, onClick: function () { correctionDialog(userOf(r), r.date, reload); } }) : '';
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
				{ id: 'employee', label: __('Per dipendente'), icon: 'user' },
				{ id: 'date', label: __('Per giorno'), icon: 'calendar-search' }
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
		var emp = employeeSelect(__('Dipendente'), st.user);
		var box = h('div', {}, DOLLY.empty(__('Seleziona un dipendente'), __('Scegli il dipendente, il mese e l\'anno.'), 'calendar-days'));
		emp.input.addEventListener('change', function () { st.user = emp.input.value; load(); });
		var my = monthYearFields(st, load);
		DOLLY.render(container, DOLLY.card(null, null, [h('div', { class: 'dolly-toolbar' }, [emp].concat(my)), box]));
		function load() {
			if (!st.user) { return; }
			DOLLY.render(box, DOLLY.loading());
			DOLLY.api('admin/attendance', { query: { user_id: st.user, year: st.year, month: st.month } }).then(function (d) {
				var today = DOLLY.fmt.today();
				var foot = h('tfoot', {}, h('tr', {}, [h('td', { colspan: 7, text: __('Totale ') + d.month_label + (d.provisional ? __(' (provvisorio)') : '') }), h('td', { class: 'num', text: d.total }), h('td', { colspan: 4, text: DOLLY.monthTotals(d) })]));
				DOLLY.render(box, [
					h('h2', { text: d.employee.name + ' · ' + d.month_label }),
					DOLLY.table([
						{ label: __('Data'), render: function (r) { return h('span', {}, [h('strong', { text: r.date_label }), h('br'), h('span', { class: 'dolly-small dolly-muted', text: r.weekday + (r.holiday ? ' · ' + r.holiday : '') + (r.closure ? ' · ' + r.closure + (r.closure_label && r.closure_label !== r.closure ? ' (' + r.closure_label.toLowerCase() + ')' : '') : '') + (r.schedule ? ' · ' + r.schedule : '') })]); } }
					].concat(attendanceColumns(function () { return st.user; }, load)), d.rows, { caption: __('Presenze ') + d.month_label, foot: foot, rowClass: function (r) { return (r.date === today ? 'is-today ' : '') + (r.status === 'riposo' ? 'is-weekend' : ''); } }),
					DOLLY.hoursSummary(d),
					h('p', { class: 'dolly-help', text: __('Le ore per giustificativo vengono salvate nello storico ore del database a ogni apertura o esportazione del mese, e dallo scheduler per i mesi modificati.') })
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		if (st.user) { load(); }
	}

	/** Groups of the "Stato" filter of the view by date. */
	var DATE_FILTERS = [
		{ value: '', label: __('Tutti'), test: function () { return true; } },
		{ value: 'presenti', label: __('Presenti'), test: function (r) { return !!r.entrata; } },
		{ value: 'assenti', label: __('Assenti non giustificati'), test: function (r) { return r.status === 'assente'; } },
		{ value: 'ferie', label: __('Ferie e donazione sangue'), test: function (r) { return r.status === 'ferie' || r.status === 'donazione'; } },
		{ value: 'permessi', label: __('Con permesso orario'), test: function (r) { return !!r.permesso; } },
		{ value: 'malattia', label: __('Malattia e infortunio'), test: function (r) { return r.status === 'malattia' || r.status === 'infortunio'; } },
		{ value: 'riposo', label: __('Riposo, festivo, chiusura'), test: function (r) { return ['riposo', 'festivo', 'chiusura', 'chiusura_festiva', 'nessun_turno', 'previsto'].indexOf(r.status) !== -1 && !r.entrata; } },
		{ value: 'ritardi', label: __('In ritardo'), test: function (r) { return r.late_min > 0; } },
		{ value: 'anomalie', label: __('Con anomalie'), test: function (r) { return r.anomalies.length > 0; } }
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
		var dateF = DOLLY.dateField({ label: __('Data'), value: st.date, help: __('GG/MM/AAAA · fino a oggi') });
		var prevBtn = DOLLY.button(__('Giorno precedente'), { icon: 'chevron-left', iconOnly: true, onClick: function () { setDate(addDays(st.date, -1)); } });
		var nextBtn = DOLLY.button(__('Giorno successivo'), { icon: 'chevron-right', iconOnly: true, onClick: function () { setDate(addDays(st.date, 1)); } });
		var todayBtn = DOLLY.button(__('Oggi'), { icon: 'calendar-check', onClick: function () { setDate(today); } });
		var wpF = DOLLY.field({ label: __('Sede'), type: 'select', value: st.workplace, options: workplaceOptions(__('Tutte le sedi')) });
		var filterF = DOLLY.field({ label: __('Mostra'), type: 'select', value: '', options: DATE_FILTERS.map(function (f) { return { value: f.value, label: f.label }; }) });
		var searchF = DOLLY.field({ label: __('Cerca dipendente'), type: 'search', attrs: { placeholder: __('Nome o cognome'), autocomplete: 'off' } });
		var csvBtn = DOLLY.button(__('Esporta CSV'), { icon: 'file-spreadsheet', disabled: true });
		var title = h('div', { class: 'dolly-att-date__title' });
		var summary = h('div', { class: 'dolly-att-date__summary', 'aria-live': 'polite' });
		var box = h('div', {}, DOLLY.loading());
		var data = null, seq = 0;

		dateF.input.addEventListener('change', function () {
			var v = dateF.iso();
			if (!v) { return; }
			if (v > today) { DOLLY.toast(__('Puoi scegliere una data fino a oggi.'), 'error'); dateF.setIso(st.date); return; }
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
			DOLLY.render(box, DOLLY.loading(__('Caricamento delle presenze di tutti i dipendenti…')));
			DOLLY.api('admin/attendance/date', { query: { date: st.date, workplace: st.workplace } }).then(function (d) {
				if (my !== seq) { return; }
				data = d;
				csvBtn.disabled = !d.rows.length;
				DOLLY.render(title, [h('h2', { text: capitalize(DOLLY.fmt.longDate(d.date)) }), d.holiday ? DOLLY.badge(d.holiday, 'neutral', 'party-popper') : null, d.is_today ? DOLLY.badge(__('Oggi: dati in tempo reale'), 'blue', 'clock') : null]);
				renderSummary();
				renderRows();
			}, function (err) { if (my === seq) { DOLLY.render(box, DOLLY.errorState(err, load)); } });
		}
		function count(fn) { return data.rows.filter(fn).length; }
		function renderSummary() {
			var chips = [
				['presenti', __('Presenti'), 'green', 'user-check'],
				['assenti', __('Assenti non giustificati'), 'red', 'user-x'],
				['ferie', __('Ferie'), 'blue', 'sun'],
				['permessi', __('Permessi orari'), 'blue', 'timer'],
				['malattia', __('Malattia/infortunio'), 'red', 'stethoscope'],
				['riposo', __('Riposo/festivo'), 'neutral', 'moon'],
				['ritardi', __('In ritardo'), 'amber', 'clock-alert'],
				['anomalie', __('Con anomalie'), 'red', 'triangle-alert']
			];
			DOLLY.render(summary, [
				h('span', { class: 'dolly-small dolly-muted', text: data.rows.length + __(' dipendenti · ore lavorate ') + data.total_worked + (data.total_extra !== '0:00' ? __(' · straordinario ') + data.total_extra : '') }),
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
				h('td', { colspan: 7, text: __('Totale ') + data.date_label + (rows.length !== data.rows.length ? ' (' + rows.length + __(' dipendenti mostrati)') : '') }),
				h('td', { class: 'num', text: hm(worked) }),
				h('td', { colspan: 4, text: extra ? __('Straordinario: ') + hm(extra) : '' })
			])) : null;
			DOLLY.render(box, h('div', { class: 'dolly-att-date__table' }, DOLLY.table([
				{ label: __('Dipendente'), render: function (r) {
					var link = h('a', { href: CFG.pages.attendance + '&user_id=' + r.user_id + '&month=' + r.date.slice(0, 7), title: __('Apri il mese di ') + r.employee, text: r.employee });
					link.addEventListener('click', function (e) { e.preventDefault(); openEmployee(r.user_id, r.date); });
					return h('span', {}, [
						h('strong', {}, link), r.active ? null : h('span', { class: 'dolly-att-date__off' }, DOLLY.badge(__('Disattivato'), 'neutral')), h('br'),
						h('span', { class: 'dolly-small dolly-muted', text: [r.contract, r.schedule, r.workplaces].filter(Boolean).join(' · ') })
					]);
				} }
			].concat(attendanceColumns(function (r) { return r.user_id; }, load)), rows, {
				caption: __('Presenze di tutti i dipendenti del ') + data.date_label,
				foot: foot,
				empty: data.rows.length ? [__('Nessun dipendente corrisponde ai filtri'), __('Cambia il filtro o la ricerca.'), 'search'] : [__('Nessun dipendente'), __('Non ci sono dipendenti per questa data e sede.'), 'users'],
				rowClass: function (r) { return r.status === 'riposo' || r.status === 'festivo' ? 'is-weekend' : ''; }
			})));
		}
		function exportCsv() {
			if (!data) { return; }
			var rows = visibleRows().map(function (r) {
				return [
					r.employee, r.contract, r.workplaces, DOLLY.dayStatusBadge(r.status).textContent, r.entrata, r.late_min ? r.late_min : '',
					r.inizio_pausa, r.fine_pausa, r.uscita, absenceText(r), r.worked,
					[r.extra, r.extra_over ? r.extra_over + (r.extra_over_status === 'pending' ? __(' da approvare') : __(' non approvato')) : ''].filter(Boolean).join(' + '),
					(r.hours || []).map(function (c) { return c.code + ' ' + c.hm; }).join(', '),
					r.anomalies.join(', ')
				];
			});
			downloadCsv(__('Presenze_') + data.date.split('-').reverse().join('-') + '.csv',
				[__('Dipendente'), __('Contratto'), __('Sede'), __('Stato'), __('Entrata'), __('Ritardo (min)'), __('Inizio pausa'), __('Fine pausa'), __('Uscita'), __('Assenze'), __('Ore'), __('Straordinario'), __('Giustificativi'), __('Anomalie')], rows);
		}
		load();
	}

	function correctionDialog(userId, date, done) {
		var body = h('div', {}, DOLLY.loading());
		DOLLY.dialog({ title: __('Correzione del ') + DOLLY.fmt.date(date), body: body, wide: true });
		DOLLY.api('admin/attendance/day', { query: { user_id: userId, date: date } }).then(function (d) {
			var alertBox = h('div', { hidden: true });
			var action = DOLLY.field({ label: __('Timbratura'), name: 'action', type: 'select', value: d.punches.uscita ? 'entrata' : (d.punches.entrata ? 'uscita' : 'entrata'), options: Object.keys(ACTIONS).map(function (k) { return { value: k, label: ACTIONS[k] + (d.punches[k] ? __(' (attuale ') + d.punches[k].time + ')' : __(' (mancante)')) }; }) });
			var time = DOLLY.timeField({ label: __('Orario corretto'), name: 'time', help: __('HH:MM. Lascia vuoto e usa "Annulla timbratura" per rimuoverla.') });
			var wp = DOLLY.field({ label: __('Sede'), name: 'workplace_id', type: 'select', options: [{ value: '', label: __('Come timbratura esistente') }].concat(d.workplaces.map(function (w) { return { value: w.id, label: w.name }; })) });
			var reason = DOLLY.field({ label: __('Motivo (obbligatorio)'), name: 'reason', type: 'textarea', required: true });
			function fillTime() { var p = d.punches[action.input.value]; time.input.value = p ? p.time : ''; }
			action.input.addEventListener('change', fillTime); fillTime();
			var form = h('form', { class: 'dolly-form', novalidate: true }, [
				alertBox,
				DOLLY.table([{ label: __('Timbratura'), render: function (k) { return ACTIONS[k]; } }, { label: __('Orario'), render: function (k) { return d.punches[k] ? d.punches[k].time : '—'; } }, { label: __('Sede'), render: function (k) { return d.punches[k] ? d.punches[k].workplace : '—'; } }, { label: __('Metodo'), render: function (k) { return d.punches[k] ? d.punches[k].method_label : '—'; } }], Object.keys(ACTIONS), { stack: false, caption: __('Timbrature attuali') }),
				h('div', { class: 'dolly-form-grid' }, [action, time, wp, reason]),
				DOLLY.alert(__('Le correzioni conservano i valori precedenti nel registro modifiche. Non sono ammessi orari futuri.'), 'info')
			]);
			function send(remove, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var t = remove ? '' : time.hm();
				if (!remove && !t) { DOLLY.showErrors(form, { time: __('Orario non valido (HH:MM).') }); return; }
				if (!reason.input.value.trim()) { DOLLY.showErrors(form, { reason: __('Indica il motivo.') }); return; }
				DOLLY.busy(btn, DOLLY.api('admin/attendance/correct', { method: 'POST', body: { user_id: userId, date: date, action: action.input.value, time: t, reason: reason.input.value, workplace_id: wp.input.value } })).then(function () {
					DOLLY.toast(remove ? __('Timbratura annullata.') : __('Timbratura salvata.'), 'success');
					var dlgClose = body.closest('.dolly-dialog-backdrop'); if (dlgClose) { dlgClose.querySelector('.dolly-dialog__head button').click(); }
					done();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			}
			var saveBtn = DOLLY.button(__('Salva correzione'), { variant: 'primary', icon: 'save' });
			var rmBtn = DOLLY.button(__('Annulla timbratura'), { variant: 'danger', icon: 'trash-2' });
			saveBtn.addEventListener('click', function () { send(false, saveBtn); });
			rmBtn.addEventListener('click', function () { DOLLY.confirm(__('Annullare la timbratura?'), __('La timbratura resterà nello storico come annullata.'), __('Annulla timbratura'), 'danger').then(function (ok) { if (ok) { send(true, rmBtn); } }); });
			DOLLY.render(body, [form, h('div', { class: 'dolly-btn-row dolly-btn-row--end', style: 'margin-top:16px' }, [rmBtn, saveBtn])]);
		}, function (err) { DOLLY.render(body, DOLLY.errorState(err)); });
	}

	/* ------------------------------------------------------------------ */
	/* Anomalies                                                            */
	/* ------------------------------------------------------------------ */

	function pageAnomalies() {
		var st = { page: 1, status: 'open', type: '', workplace: '' };
		var status = DOLLY.field({ label: __('Stato'), type: 'select', value: 'open', options: [{ value: 'open', label: __('Non risolte') }, { value: 'resolved', label: __('Risolte') }, { value: '', label: __('Tutte') }] });
		var type = DOLLY.field({ label: __('Tipo'), type: 'select', options: [{ value: '', label: __('Tutti') }, { value: 'unjustified_absence', label: __('Assente non giustificato') }, { value: 'missing_exit', label: __('Uscita mancante') }, { value: 'late_exit', label: __('Uscita oltre l\'orario (versioni precedenti)') }, { value: 'missing_certificate', label: __('Certificato mancante') }, { value: 'sickness_conflict', label: __('Malattia/infortunio in conflitto') }] });
		var wp = DOLLY.field({ label: __('Sede'), type: 'select', options: workplaceOptions(__('Tutte le sedi')) });
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
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('Messaggi a tutti i dipendenti o a dipendenti scelti, subito o in una data programmata, via email e/o notifica nell\'app (anche push sui telefoni).') }),
				h('div', { class: 'dolly-toolbar__spacer' }),
				DOLLY.button(__('Nuovo broadcast'), { variant: 'primary', icon: 'megaphone', onClick: function () { broadcastDialog(load); } })
			]),
			box
		]));
		function load() {
			DOLLY.api('admin/broadcasts', { query: { page: page } }).then(function (r) {
				var tones = { scheduled: ['amber', 'calendar-clock'], sending: ['blue', 'send'], sent: ['green', 'circle-check'], cancelled: ['neutral', 'ban'] };
				DOLLY.render(box, [
					DOLLY.table([
						{ label: __('Invio'), render: function (b) { return h('div', { class: 'dolly-small' }, [DOLLY.fmt.dateTime(b.sent_at || b.send_at), b.source === 'closure' ? h('div', { class: 'dolly-muted', text: __('Da chiusura collettiva') }) : null]); } },
						{ label: __('Messaggio'), render: function (b) { return h('div', {}, [h('strong', { text: b.title }), h('div', { class: 'dolly-small', style: 'white-space:pre-line', text: b.message.length > 220 ? b.message.slice(0, 220) + '…' : b.message })]); } },
						{ label: __('Destinatari'), render: function (b) { return h('span', { class: 'dolly-small', text: b.recipients_label + (b.status === 'sent' ? __(' · consegnato a ') + b.recipient_count : '') }); } },
						{ label: __('Canali'), render: function (b) { return h('div', { class: 'dolly-btn-row' }, [b.email ? DOLLY.badge(__('Email'), 'neutral', 'mail') : null, b.portal ? DOLLY.badge(__('App'), 'neutral', 'bell') : null, b.popup ? DOLLY.badge(__('Pop-up all\'apertura'), 'blue', 'megaphone') : null]); } },
						{ label: __('Stato'), render: function (b) { var t = tones[b.status] || ['neutral', 'info']; return DOLLY.badge(b.status_label, t[0], t[1]); } },
						{ label: '', srLabel: __('Azioni'), render: function (b) {
							return b.status === 'scheduled' ? DOLLY.button(__('Annulla invio'), { size: 'sm', icon: 'ban', onClick: function (ev) {
								var btn = ev.currentTarget;
								DOLLY.confirm(__('Annullare il messaggio programmato?'), __('Il messaggio non verrà inviato.'), __('Annulla invio'), 'danger').then(function (ok) {
									if (ok) { DOLLY.busy(btn, DOLLY.api('admin/broadcasts/' + b.id, { method: 'DELETE' })).then(function () { DOLLY.toast(__('Invio annullato.'), 'success'); load(); }, function (err) { DOLLY.toast(err.message, 'error'); }); }
								});
							} }) : '';
						} }
					], r.items, { empty: [__('Nessun broadcast'), __('Crea il primo messaggio con "Nuovo broadcast".'), 'megaphone'], caption: __('Broadcast') }),
					DOLLY.pagination(r, function (p) { page = p; load(); }, 'broadcast')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function broadcastDialog(done) {
		var alertBox = h('div', { hidden: true });
		var title = DOLLY.field({ label: __('Oggetto'), name: 'title', optional: true, full: true, help: __('Titolo della notifica e oggetto dell\'email.') });
		var message = DOLLY.field({ label: __('Messaggio'), name: 'message', type: 'textarea', rows: 5, required: true, full: true });
		var who = DOLLY.radios({ label: __('Destinatari'), name: 'who', value: 'all', full: true, options: [
			{ value: 'all', label: __('Tutti i dipendenti attivi') },
			{ value: 'some', label: __('Dipendenti selezionati') }
		], onChange: function (v) { pickBox.hidden = v !== 'some'; } });
		var chips = null;
		var pickBox = h('div', { class: 'dolly-field--full', hidden: true }, DOLLY.loading());
		allEmployees(true).then(function (list) {
			chips = DOLLY.chips({ label: __('Dipendenti'), name: 'recipients', full: true, options: list.filter(function (e) { return e.active; }).map(function (e) { return { value: e.id, label: e.name }; }) });
			var search = DOLLY.field({ label: __('Filtra l\'elenco'), type: 'search', attrs: { placeholder: __('Cognome o nome') } });
			search.input.addEventListener('input', function () {
				var q = search.input.value.trim().toLowerCase();
				Array.prototype.forEach.call(chips.querySelectorAll('.dolly-chip'), function (c) { c.hidden = q && c.textContent.toLowerCase().indexOf(q) === -1; });
			});
			DOLLY.render(pickBox, [search, chips]);
		}, function (err) { DOLLY.render(pickBox, DOLLY.errorState(err)); });
		var sendDate = DOLLY.dateField({ label: __('Data di invio'), name: 'send_date', value: CFG.today });
		var sendTime = DOLLY.timeField({ label: __('Ora di invio'), name: 'send_time', value: '08:00' });
		var whenBox = h('div', { class: 'dolly-form-grid dolly-field--full', hidden: true }, [sendDate, sendTime]);
		var now = DOLLY.switchControl({ label: __('Invia ora'), name: 'send_now', checked: true, description: __('Disattiva per programmare data e ora di invio.'), onChange: function (on) { whenBox.hidden = on; } });
		var chEmail = DOLLY.switchControl({ label: __('Email'), name: 'email', checked: true });
		var chPortal = DOLLY.switchControl({ label: __('Notifica nell\'app'), name: 'portal', checked: true, description: __('Visibile in Notifiche; arriva come notifica push sui telefoni che l\'hanno attivata.') });
		var chPopup = DOLLY.switchControl({ label: __('Mostra subito all\'apertura dell\'app'), name: 'popup', checked: false, description: __('Il messaggio compare in un pop-up appena il dipendente entra nel portale (finché non lo legge), oltre che in Notifiche.'), onChange: function (on) { if (on) { chPortal.control.setOn(true); } } });
		var channels = h('div', { class: 'dolly-field dolly-field--full', dataset: { name: 'channels' } }, [h('span', { class: 'dolly-label', text: __('Modalità di invio') }), h('div', { class: 'dolly-form-grid' }, [chEmail, chPortal, chPopup]), h('span', { class: 'dolly-error', hidden: true })]);
		var form = h('form', { class: 'dolly-form', novalidate: true }, [alertBox, h('div', { class: 'dolly-form-grid' }, [title, message, who, pickBox, h('div', { class: 'dolly-field--full' }, now), whenBox, channels])]);
		DOLLY.dialog({
			title: __('Nuovo broadcast'), body: form, wide: true,
			actions: [{ label: __('Annulla') }, { label: __('Invia'), variant: 'primary', icon: 'send', onClick: function (close, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var errors = {};
				var body = { title: title.input.value, message: message.input.value, all: who.value() === 'all', email: chEmail.control.isOn(), portal: chPortal.control.isOn() || chPopup.control.isOn(), popup: chPopup.control.isOn(), send_now: now.control.isOn() };
				if (!body.message.trim()) { errors.message = __('Scrivi il messaggio.'); }
				if (!body.email && !body.portal) { errors.channels = __('Scegli almeno un canale: email e/o notifica nell\'app.'); }
				if (!body.all) {
					body.recipients = chips ? chips.values().map(Number) : [];
					if (!body.recipients.length) { errors.recipients = __('Seleziona almeno un dipendente.'); }
				}
				if (!body.send_now) {
					var rd = DOLLY.readDateTimes({ send_date: [sendDate, 'date', true], send_time: [sendTime, 'time', true] });
					Object.assign(errors, rd.errors);
					body.send_date = rd.values.send_date; body.send_time = rd.values.send_time;
				}
				if (Object.keys(errors).length) { DOLLY.showErrors(form, errors); return; }
				DOLLY.busy(btn, DOLLY.api('admin/broadcasts', { method: 'POST', body: body })).then(function (b) {
					close();
					DOLLY.toast(b.status === 'sent' ? __('Messaggio inviato a ') + (b.recipient_count === 1 ? __('1 dipendente.') : b.recipient_count + __(' dipendenti.')) : __('Messaggio programmato per il ') + DOLLY.fmt.dateTime(b.send_at) + '.', 'success');
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
		var allSw = DOLLY.switchControl({ label: __('Seleziona tutti i dipendenti attivi'), name: 'all', checked: true, onChange: function (on) { if (chips) { chips.setAll(on); } } });
		var btn = DOLLY.button(__('Scarica ZIP presenze'), { variant: 'primary', icon: 'file-archive' });
		var err = h('div', { 'aria-live': 'polite' });
		btn.addEventListener('click', function () {
			var ids = chips ? chips.values() : [];
			if (!ids.length) { DOLLY.render(err, DOLLY.alert(__('Seleziona almeno un dipendente.'), 'error')); return; }
			DOLLY.clear(err);
			window.location.href = DOLLY.downloadUrl('admin/export/attendance', { year: st.year, month: st.month, users: ids.join(',') });
		});
		// Hours history: one line per employee with the hours of every justification code.
		var hoursBtn = DOLLY.button(__('Scarica riepilogo ore (CSV)'), { icon: 'file-spreadsheet' });
		hoursBtn.addEventListener('click', function () {
			var ids = chips ? chips.values() : [];
			if (!ids.length) { DOLLY.render(err, DOLLY.alert(__('Seleziona almeno un dipendente.'), 'error')); return; }
			DOLLY.clear(err);
			window.location.href = DOLLY.downloadUrl('admin/export/hours', { year: st.year, month: st.month, users: ids.join(',') });
		});
		allEmployees(true).then(function (list) {
			chips = DOLLY.chips({ label: __('Dipendenti'), name: 'users', selected: list.filter(function (e) { return e.active; }).map(function (e) { return e.id; }), options: list.map(function (e) { return { value: e.id, label: e.name + (e.active ? '' : __(' (disattivato)')) }; }) });
			DOLLY.render(chipsBox, chips);
		}, function (e) { DOLLY.render(chipsBox, DOLLY.errorState(e)); });
		// Monthly attendance sheet (Excel): one file with all the employees, whatever the workplace.
		var sheetSt = nowYM();
		var sheetErr = h('div', { 'aria-live': 'polite' });
		var sheetBtn = DOLLY.button(__('Scarica foglio presenze (Excel)'), { variant: 'primary', icon: 'file-spreadsheet' });
		sheetBtn.addEventListener('click', function () {
			DOLLY.clear(sheetErr);
			var url = DOLLY.downloadUrl('admin/export/timesheet', { year: sheetSt.year, month: sheetSt.month });
			// Downloaded in the background: an error is shown here instead of a blank page.
			var p = window.fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
				if (!res.ok) {
					return res.text().then(function (t) {
						var msg = __('Esportazione non riuscita (errore ') + res.status + ').';
						try { msg = JSON.parse(t).message || msg; } catch (e) { /* not JSON */ }
						throw new Error(msg);
					});
				}
				var cd = res.headers.get('Content-Disposition') || '';
				var m = /filename="?([^";]+)"?/.exec(cd);
				var name = m ? m[1] : __('Foglio_presenze_') + DOLLY.MONTHS[sheetSt.month - 1] + '_' + sheetSt.year + '.xlsx';
				return res.blob().then(function (blob) {
					var a = h('a', { href: window.URL.createObjectURL(blob), download: name, style: 'display:none' });
					document.body.appendChild(a);
					a.click();
					setTimeout(function () { window.URL.revokeObjectURL(a.href); a.remove(); }, 2000);
					DOLLY.toast(__('Foglio presenze scaricato.'), 'success');
				});
			});
			DOLLY.busy(sheetBtn, p).then(null, function (e) { DOLLY.render(sheetErr, DOLLY.alert(e.message, 'error')); });
		});

		DOLLY.render(main, h('div', { class: 'dolly-stack' }, [
			DOLLY.card(__('Foglio presenze mensile (Excel)'), 'file-spreadsheet', [
				h('p', { text: __('File Excel (.xlsx) del mese con tutti i dipendenti dell\'azienda in un unico foglio (la sede non è indicata), nel formato del foglio presenze aziendale: per ogni dipendente le righe «ore lavoro effettive», «giustificativi» e «ore per giustificativi», con sabati, domeniche e festività colorati.') }),
				h('div', { class: 'dolly-toolbar' }, monthYearFields(sheetSt, function () {})),
				sheetErr,
				h('div', { class: 'dolly-btn-row', style: 'margin-top:16px' }, sheetBtn),
				h('p', { class: 'dolly-help', text: __('Accanto al nome è indicato il contratto, es. MARIO ROSSI (Tempo pieno - 40 ore settimanali). Legenda: FS = Festivo · FER = Sabato · O = Ordinario · S = Straordinario · FE ferie · P/ROL/EO/Pn/PL permessi · M malattia · I infortunio · Av donazione sangue · A assenza non retribuita.') })
			]),
			DOLLY.card(__('Anagrafica dipendenti (CSV)'), 'users', [
				h('p', { text: __('Nome utente, nominativo, contatti, stato, contratto, orario e sedi. Non include password, certificati né note mediche.') }),
				DOLLY.button(__('Scarica CSV dipendenti'), { href: DOLLY.downloadUrl('admin/export/employees'), variant: 'primary', icon: 'file-spreadsheet' })
			]),
			DOLLY.card(__('Presenze mensili (ZIP)'), 'file-archive', [
				h('p', { text: __('Un file CSV per dipendente con ogni giorno del mese (es. Mario_Rossi_Settembre_2026.csv). CSV UTF-8 con separatore punto e virgola, adatto a Excel in italiano. Certificati e note mediche sono esclusi.') }),
				h('div', { class: 'dolly-toolbar' }, monthYearFields(st, function () {})),
				allSw, chipsBox, err,
				h('div', { class: 'dolly-btn-row', style: 'margin-top:16px' }, [btn, hoursBtn]),
				h('p', { class: 'dolly-help', text: __('Riepilogo ore: una riga per dipendente con le ore previste e le ore di ogni giustificativo (O ordinario, FER sabato, S straordinario, FS festivo, FE ferie, P/ROL/EO/Pn/PL permessi, M malattia, I infortunio, Av donazione sangue, A assenza non retribuita), lette dallo storico ore.') })
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

	function renderSettings(d) {
		var s = d.settings;
		var alertBox = h('div', { hidden: true });
		var langOptions = Object.keys(d.languages).map(function (k) { return { value: k, label: d.languages[k] }; });
		var language = DOLLY.field({ label: __('Lingua predefinita'), name: 'language', type: 'select', value: s.language || 'auto', help: __('Per il portale, le pagine di accesso, le email e il pannello di chi non ha scelto una lingua.'),
			options: [{ value: 'auto', label: __('Come il sito') + ' (' + d.site_language + ')' }].concat(langOptions) });
		var myLocale = DOLLY.field({ label: __('La tua lingua nel pannello'), name: 'my_locale', type: 'select', value: d.my_locale || '', help: __('Solo per il tuo account. I dipendenti scelgono la loro lingua nel profilo del portale.'),
			options: [{ value: '', label: __('Predefinita') }].concat(langOptions) });
		var methods = DOLLY.chips({ label: __('Metodi per verificare la presenza'), name: 'verification_methods', full: true, selected: s.verification_methods, options: Object.keys(d.verification_methods).map(function (k) { return { value: k, label: d.verification_methods[k] }; }), help: __('Il dipendente sceglie uno dei metodi attivi. Il Bluetooth richiede un dispositivo in sede: configuralo in Sedi › Bluetooth.') });
		var requireGps = DOLLY.switchControl({ label: __('Richiedi sempre anche la posizione GPS'), name: 'verification_require_gps', checked: !!s.verification_require_gps, description: __('Oltre al codice della sede (QR/PIN o Bluetooth) il telefono deve trovarsi entro il raggio della sede.') });
		var bleNote = DOLLY.alert(__('Bluetooth: funziona con Chrome, Edge e Samsung Internet su Android. Su iPhone serve l\'app gratuita Bluefy, perché Safari non supporta il Bluetooth per i siti web: lascia attivo anche un altro metodo se alcuni dipendenti usano iPhone.'), 'info');
		var radius = DOLLY.field({ label: __('Raggio GPS predefinito per le nuove sedi (metri)'), name: 'default_radius', type: 'number', value: s.default_radius, attrs: { min: 10, max: 5000 } });
		var cm = DOLLY.radios({ label: __('Certificato medico'), name: 'certificate_mode', value: s.certificate_mode, options: Object.keys(d.certificate_modes).map(function (k) { return { value: k, label: d.certificate_modes[k] + (k === 'required' ? __(' (predefinito)') : ''), description: k === 'disabled' ? __('Disattivando, i requisiti in sospeso vengono annullati con registrazione nel registro.') : null }; }) });
		var cdays = DOLLY.field({ label: __('Giorni di calendario per il certificato'), name: 'certificate_days', type: 'number', value: s.certificate_days, attrs: { min: 1, max: 365 }, help: __('Usato solo con la scadenza attiva.') });
		// Attendance rules.
		var lunchPunch = DOLLY.switchControl({ label: __('Timbratura della pausa pranzo'), name: 'lunch_punch', checked: s.lunch_punch, description: __('Attiva: i dipendenti timbrano inizio e fine pausa. Disattivata: non timbrano la pausa e la pausa prevista dall\'orario viene sottratta in automatico.') });
		var lateTol = DOLLY.field({ label: __('Tolleranza ritardo in entrata (minuti)'), name: 'late_tolerance', type: 'number', value: s.late_tolerance, attrs: { min: 0, max: 120 }, help: __('Un\'entrata entro questi minuti dall\'inizio turno conta come entrata regolare (es. 3: turno alle 08:00, entrata alle 08:03 → 08:00). Valore predefinito per tutte le sedi: ogni sede può avere la sua tolleranza in Sedi › Modifica.') });
		var stepBox = h('div', { class: 'dolly-form-grid', hidden: !s.exit_rounding });
		var step = DOLLY.field({ label: __('Intervallo di arrotondamento (minuti)'), name: 'rounding_step', type: 'number', value: s.rounding_step, attrs: { min: 1, max: 60 }, help: __('Arrotonda al multiplo più vicino dopo la fine turno.') });
		var roundExample = h('p', { class: 'dolly-help' });
		function updateExample() {
			var st = Math.max(1, Math.min(60, parseInt(step.input.value, 10) || 15));
			var half = Math.floor((st - 1) / 2);
			var end = 16 * 60 + 30;
			var t = function (m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };
			roundExample.textContent = DOLLY.sprintf(__('Esempio con fine turno alle 16:30: uscita fino alle %s → 16:30; dalle %s alle %s → %s.'), t(end + half), t(end + half + 1), t(end + st + half), t(end + st));
		}
		step.input.addEventListener('input', updateExample);
		updateExample();
		DOLLY.append(stepBox, [step, h('div', { class: 'dolly-field--full' }, roundExample)]);
		var rounding = DOLLY.switchControl({ label: __('Arrotondamento dell\'uscita'), name: 'exit_rounding', checked: s.exit_rounding, description: __('Nel modulo presenze l\'uscita dopo la fine turno viene arrotondata; la timbratura reale resta registrata.'), onChange: function (on) { stepBox.hidden = !on; } });
		var holidayIncrease = DOLLY.field({ label: __('Maggiorazione lavoro festivo (%)'), name: 'holiday_increase', type: 'number', value: s.holiday_increase, attrs: { min: 0, max: 300 }, help: __('Applicata alle ore lavorate nelle chiusure per festività e nelle festività nazionali; indicata nel modulo presenze e nell\'esportazione.') });
		var overtime = DOLLY.field({ label: __('Straordinario approvato automaticamente (minuti al giorno)'), name: 'overtime_auto', type: 'number', value: s.overtime_auto, attrs: { min: 0, max: 1440 }, help: __('Il tempo dopo la fine turno è straordinario. Fino a questo limite è approvato automaticamente (120 = 2 ore); oltre, viene creata una richiesta da approvare in Richieste.') });
		// Employee portal.
		var requireInstall = DOLLY.switchControl({ label: __('Installazione dell\'app obbligatoria sui telefoni'), name: 'require_install', checked: s.require_install !== false, description: __('Sui telefoni, prima dell\'accesso, il dipendente vede la procedura per aggiungere il portale alla schermata Home e può accedere solo dall\'app installata. Al primo accesso parte il tutorial guidato.') });
		// On-call contracts.
		var ocBox = h('div', { class: 'dolly-form-grid', hidden: !s.oncall_auto });
		var ocThreshold = DOLLY.field({ label: __('Soglia di approvazione automatica (minuti)'), name: 'oncall_threshold', type: 'number', value: s.oncall_threshold, attrs: { min: 1, max: 1440 }, help: __('Un turno lungo fino a questa soglia è approvato automaticamente (120 = 2 ore); i turni più lunghi vanno approvati in Richieste.') });
		DOLLY.append(ocBox, ocThreshold);
		var ocAuto = DOLLY.switchControl({ label: __('Approvazione automatica dei turni brevi'), name: 'oncall_auto', checked: s.oncall_auto, description: __('Disattivata: l\'amministratore approva manualmente tutte le ore dei contratti a chiamata.'), onChange: function (on) { ocBox.hidden = !on; } });
		// Anomalies.
		var absDelayBox = h('div', { class: 'dolly-form-grid', hidden: !s.absence_check });
		var absDelay = DOLLY.field({ label: __('Minuti dopo l\'inizio turno'), name: 'absence_delay', type: 'number', value: s.absence_delay, attrs: { min: 0, max: 720 }, help: __('Senza entrata dopo questo tempo il dipendente risulta "Assente non giustificato".') });
		DOLLY.append(absDelayBox, absDelay);
		var absCheck = DOLLY.switchControl({ label: __('Segnala le assenze non giustificate'), name: 'absence_check', checked: s.absence_check, description: __('Esclusi giorni di riposo, festività, ferie, permessi e malattia/infortunio. Il dipendente riceve una notifica e può chiedere la correzione della timbratura.'), onChange: function (on) { absDelayBox.hidden = !on; } });
		// Blood donation certificate (same modes as the medical one).
		var dcm = DOLLY.radios({ label: __('Certificato di donazione sangue'), name: 'donation_certificate_mode', value: s.donation_certificate_mode, options: Object.keys(d.certificate_modes).map(function (k) { return { value: k, label: d.certificate_modes[k] + (k === 'required' ? __(' (predefinito)') : ''), description: k === 'disabled' ? __('Disattivando, i requisiti in sospeso vengono annullati con registrazione nel registro.') : null }; }) });
		var dcdays = DOLLY.field({ label: __('Giorni di calendario per il certificato di donazione'), name: 'donation_certificate_days', type: 'number', value: s.donation_certificate_days, attrs: { min: 1, max: 365 }, help: __('Usato solo con la scadenza attiva: contati dal giorno successivo alla donazione.') });
		// Device sessions.
		var deviceSessions = DOLLY.switchControl({ label: __('Sessioni dispositivo'), name: 'device_sessions', checked: s.device_sessions !== false, description: __('Ogni dipendente accede da un solo dispositivo: il primo accesso lo registra come dispositivo principale. Da un altro dispositivo l\'accesso viene rifiutato finché non scolleghi il precedente (Dipendenti › Gestione dispositivi), dove puoi anche aumentare il limite per singolo dipendente. Non riguarda amministratori e account sede.') });

		/**
		 * Reminder offsets in minutes: chips with remove + "add" field.
		 * Returns {el, values()}.
		 */
		function minutesList(initial, label, unitText) {
			var list = (initial || []).map(Number).filter(function (n) { return n >= 1 && n <= 240; });
			var chipsEl = h('div', { class: 'dolly-minutes', role: 'list', 'aria-label': label });
			var input = h('input', { class: 'dolly-input', type: 'number', min: 1, max: 240, inputmode: 'numeric', placeholder: __('es. 5'), 'aria-label': __('Minuti da aggiungere') });
			var addBtn = DOLLY.button(__('Aggiungi'), { size: 'sm', icon: 'plus', onClick: add });
			var err = h('span', { class: 'dolly-error', hidden: true });
			function draw() {
				list.sort(function (a, b) { return a - b; });
				DOLLY.render(chipsEl, list.length ? list.map(function (m) {
					var rm = h('button', { type: 'button', 'aria-label': __('Rimuovi ') + m + __(' minuti') }, DOLLY.icon('x'));
					rm.addEventListener('click', function () { list = list.filter(function (x) { return x !== m; }); draw(); });
					return h('span', { class: 'dolly-minutes__chip', role: 'listitem' }, [m + __(' min ') + unitText, rm]);
				}) : h('span', { class: 'dolly-small dolly-muted', text: __('Nessun orario configurato: il promemoria non viene inviato.') }));
				DOLLY.icons();
			}
			function add() {
				var v = parseInt(input.value, 10);
				err.hidden = true;
				if (!(v >= 1 && v <= 240)) { err.textContent = __('Inserisci un numero di minuti tra 1 e 240.'); err.hidden = false; return; }
				if (list.indexOf(v) === -1) {
					if (list.length >= 6) { err.textContent = __('Al massimo 6 orari per promemoria.'); err.hidden = false; return; }
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
		// Reminder mode.
		var remEntryMin = minutesList(s.reminder_entry_minutes, __('Minuti prima dell\'inizio del turno'), 'prima');
		var remExitMin = minutesList(s.reminder_exit_minutes, __('Minuti dopo la fine del turno'), 'dopo');
		var remEntryBox = h('div', { class: 'dolly-form-grid', hidden: !s.reminder_entry }, remEntryMin.el);
		var remExitBox = h('div', { class: 'dolly-form-grid', hidden: !s.reminder_exit }, remExitMin.el);
		var remEntry = DOLLY.switchControl({ label: __('Promemoria di entrata'), name: 'reminder_entry', checked: !!s.reminder_entry, description: __('Notifica push ai dipendenti che oggi devono lavorare e non hanno ancora timbrato l\'entrata. Puoi configurare più orari (es. 10 e 5 minuti prima).'), onChange: function (on) { remEntryBox.hidden = !on; } });
		var remExit = DOLLY.switchControl({ label: __('Promemoria di uscita'), name: 'reminder_exit', checked: !!s.reminder_exit, description: __('Notifica push ai dipendenti che, passata la fine del turno, non hanno ancora timbrato l\'uscita (es. 5 minuti dopo).'), onChange: function (on) { remExitBox.hidden = !on; } });

		/** One notification group (employees or administrators): master switches + per-event switches. */
		function notifyGroup(prefix, labels, saved, portalLabel, portalHelp) {
			var g = {
				portal: DOLLY.switchControl({ label: portalLabel, name: prefix + 'notify_portal', checked: s[prefix + 'notify_portal'], description: portalHelp }),
				email: DOLLY.switchControl({ label: __('Email'), name: prefix + 'notify_email', checked: s[prefix + 'notify_email'], description: __('Interruttore generale delle email.') }),
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
				{ label: __('Evento'), render: function (r) { return labels[r.k]; } },
				{ label: prefix ? __('Pannello') : __('App'), render: function (r) { return g.ev[r.k].portal; } },
				{ label: __('Email'), render: function (r) { return g.ev[r.k].email; } }
			], rows, { caption: prefix ? __('Notifiche agli amministratori per evento') : __('Notifiche ai dipendenti per evento') });
			g.values = function () {
				var out = {};
				Object.keys(g.ev).forEach(function (k) { out[k] = { portal: g.ev[k].portal.control.isOn(), email: g.ev[k].email.control.isOn() }; });
				return out;
			};
			return g;
		}
		var empN = notifyGroup('', d.employee_events || d.events, s.events, __('Notifiche nell\'app'), __('Campanella del portale e notifica push sul telefono (se attivata dal dipendente).'));
		var admN = notifyGroup('admin_', d.admin_events || d.events, s.admin_events || s.events, __('Notifiche nel pannello'), __('Campanella in alto nel pannello di amministrazione e push sul telefono (se attivata).'));
		var recipients = DOLLY.chips({ label: __('Amministratori che ricevono le notifiche'), name: 'admin_recipients', help: __('Nessuna selezione = tutti gli amministratori.'), selected: s.admin_recipients, options: d.admins.map(function (a) { return { value: a.id, label: a.name + ' (' + a.email + ')' }; }) });
		var pinMax = DOLLY.field({ label: __('Tentativi PIN o Bluetooth errati prima del blocco'), name: 'pin_max_attempts', type: 'number', value: s.pin_max_attempts, attrs: { min: 1, max: 50 } });
		var pinLock = DOLLY.field({ label: __('Durata del blocco PIN (minuti)'), name: 'pin_lock_minutes', type: 'number', value: s.pin_lock_minutes, attrs: { min: 1, max: 1440 } });
		var grace = DOLLY.field({ label: __('Tolleranza di rete per QR/PIN (secondi)'), name: 'challenge_grace', type: 'number', value: s.challenge_grace, attrs: { min: 0, max: 10 }, help: __('Accetta il codice precedente per pochi secondi dopo la rotazione (0–10).') });

		var saveBtn = DOLLY.button(__('Salva impostazioni'), { type: 'submit', variant: 'primary', icon: 'save' });
		var form = h('form', { class: 'dolly-stack', novalidate: true }, [
			alertBox,
			DOLLY.card(__('Lingua'), 'languages', h('div', { class: 'dolly-form-grid' }, [language, myLocale]), { level: 'h2' }),
			DOLLY.card(__('Verifica timbrature'), 'shield-check', h('div', { class: 'dolly-form' }, [methods, requireGps, bleNote, radius, grace, h('div', { class: 'dolly-form-grid' }, [pinMax, pinLock])]), { level: 'h2' }),
			DOLLY.card(__('Presenze e orari'), 'clock', h('div', { class: 'dolly-form' }, [lunchPunch, h('div', { class: 'dolly-form-grid' }, [lateTol]), rounding, stepBox, h('div', { class: 'dolly-form-grid' }, [overtime, holidayIncrease])]), { level: 'h2' }),
			DOLLY.card(__('Portale dipendenti'), 'smartphone', h('div', { class: 'dolly-form' }, [requireInstall]), { level: 'h2' }),
			DOLLY.card(__('Sessioni dispositivo'), 'shield-check', h('div', { class: 'dolly-form' }, [deviceSessions]), { level: 'h2' }),
			DOLLY.card(__('Promemoria timbratura'), 'alarm-clock', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('I promemoria arrivano come notifica push sul telefono (e nella campanella dell\'app) solo a chi è previsto al lavoro: non vengono inviati nei giorni di riposo, festivi o di chiusura, né a chi è in ferie, malattia, infortunio o donazione sangue, né quando un permesso orario copre l\'inizio (entrata) o la fine (uscita) del turno.') }),
				remEntry, remEntryBox, remExit, remExitBox,
				h('p', { class: 'dolly-help', text: __('Richiede lo scheduler attivo ogni minuto (vedi Stato del sistema) e le notifiche attivate dal dipendente sul telefono.') })
			]), { level: 'h2' }),
			DOLLY.card(__('Contratti a chiamata'), 'phone-call', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('I dipendenti con contratto a chiamata non hanno giorni né orari: iniziano e terminano il turno quando vogliono e ogni turno completato va approvato.') }),
				ocAuto, ocBox
			]), { level: 'h2' }),
			DOLLY.card(__('Malattia, infortunio e certificati'), 'stethoscope', h('div', { class: 'dolly-form' }, [cm, cdays]), { level: 'h2' }),
			DOLLY.card(__('Donazione sangue'), 'droplet', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('La donazione sangue si chiede da Richieste. Dopo l\'approvazione, dal giorno successivo alla donazione il dipendente trova nella richiesta «Carica certificato» (con notifica e anomalia "Certificato mancante"), come per il certificato medico.') }),
				dcm, dcdays
			]), { level: 'h2' }),
			DOLLY.card(__('Anomalie'), 'triangle-alert', h('div', { class: 'dolly-form' }, [
				absCheck, absDelayBox,
				h('p', { class: 'dolly-help', text: __('Uscita mancante: se il dipendente non timbra l\'uscita entro le 23:59 della giornata viene segnalata un\'anomalia.') })
			]), { level: 'h2' }),
			DOLLY.card(__('Notifiche ai dipendenti'), 'users', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('Cosa ricevono tutti i dipendenti. Gli interruttori generali disattivano il canale per tutti gli eventi.') }),
				h('div', { class: 'dolly-form-grid' }, [empN.portal, empN.email]),
				empN.table,
				h('p', { class: 'dolly-help', text: __('I messaggi del menu Comunicazioni hanno impostazioni proprie. Disattivare le notifiche non nasconde stati delle richieste né anomalie.') })
			]), { level: 'h2' }),
			DOLLY.card(__('Notifiche agli amministratori'), 'shield', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: __('Cosa ricevono gli amministratori selezionati qui sotto.') }),
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
				admin_recipients: recipients.values().map(Number), pin_max_attempts: pinMax.input.value, pin_lock_minutes: pinLock.input.value, challenge_grace: grace.input.value
			};
			var go = function () {
				DOLLY.busy(saveBtn, DOLLY.api('admin/settings', { method: 'POST', body: body })).then(function (nd) {
					var reload = language.input.value !== (s.language || 'auto') || myLocale.input.value !== (d.my_locale || '');
					var mine = myLocale.input.value !== (d.my_locale || '') ? DOLLY.api('me/language', { method: 'POST', body: { locale: myLocale.input.value } }) : Promise.resolve();
					mine.then(function () {
						if (reload) { window.location.reload(); return; }
						DOLLY.toast(__('Impostazioni salvate.'), 'success'); renderSettings(nd);
					}, function (err) { DOLLY.toast(err.message, 'error'); });
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			};
			if (body.certificate_mode === 'disabled' && s.certificate_mode !== 'disabled') {
				DOLLY.confirm(__('Disattivare i certificati?'), __('Tutti i requisiti di certificato in sospeso verranno annullati e registrati nel registro modifiche.'), __('Disattiva e salva'), 'danger').then(function (ok) { if (ok) { go(); } });
			} else { go(); }
		});

		// System status.
		var c = d.cron;
		var runBtn = DOLLY.button(__('Esegui controlli ora'), { icon: 'play', onClick: function () {
			DOLLY.busy(runBtn, DOLLY.api('admin/cron/run', { method: 'POST' })).then(function () { DOLLY.toast(__('Controlli eseguiti.'), 'success'); pageSettings(); }, function (err) { DOLLY.toast(err.message, 'error'); });
		} });
		var testMailResult = h('div', { style: 'margin-top:8px', 'aria-live': 'polite' });
		var testMail = DOLLY.button(__('Invia email di prova'), { icon: 'mail', onClick: function () {
			DOLLY.busy(testMail, DOLLY.api('admin/test-email', { method: 'POST' })).then(function (r) {
				DOLLY.render(testMailResult, DOLLY.alert(r.message, r.ok ? 'success' : 'error'));
			}, function (err) { DOLLY.render(testMailResult, DOLLY.alert(err.message, 'error')); });
		} });
		var check = function (ok, label, bad) { return h('li', {}, [ok ? DOLLY.badge('OK', 'green', 'circle-check') : DOLLY.badge(__('Da verificare'), 'red', 'circle-alert'), ' ', label, !ok && bad ? h('div', { class: 'dolly-help', text: bad }) : null]); };
		var status = DOLLY.card(__('Stato del sistema'), 'activity', [
			h('ul', { class: 'dolly-stack', style: 'list-style:none;padding:0;margin:0 0 16px' }, [
				check(c.healthy, __('Scheduler ogni minuto') + (c.last_run ? __(' · ultima esecuzione ') + DOLLY.fmt.dateTime(c.last_run) + ' (' + c.last_source + ')' : __(' · mai eseguito')), __('Configura il cron di sistema: la produzione non deve dipendere dalle visite.')),
				check(c.wp_cron_disabled, __('WP-Cron basato sulle visite disattivato (DISABLE_WP_CRON)'), __('Aggiungi define( \'DISABLE_WP_CRON\', true ); in wp-config.php dopo aver configurato il cron di sistema.')),
				check(d.storage.https, __('HTTPS attivo'), __('GPS e fotocamera funzionano solo su HTTPS.')),
				check(d.storage.outside_webroot, __('Certificati salvati fuori dalla cartella pubblica'), __('La cartella è dentro uploads con regole di blocco: verifica che il server non la serva, oppure definisci DOLLY_PRIVATE_DIR.')),
				check(d.storage.zip, __('Estensione ZIP di PHP disponibile'), __('Verrà usata la libreria PclZip inclusa in WordPress.')),
				d.push ? check(d.push.available, __('Notifiche push sui telefoni') + (d.push.available ? ' · ' + d.push.devices + __(' dispositivi di ') + d.push.employees + __(' dipendenti') : ''), d.push.available ? null : __('OpenSSL del server non supporta le chiavi EC (P-256): le notifiche push non sono disponibili, le notifiche nell\'app funzionano comunque.')) : null,
				d.push && d.push.available ? h('li', { class: 'dolly-help', text: (d.push.encrypted ? __('Messaggi push cifrati (contenuto visibile subito sul telefono).') : __('PHP senza ECDH: push vuote, il telefono scarica il contenuto dal sito.')) + (d.push.last_success ? __(' Ultimo invio riuscito: ') + DOLLY.fmt.dateTime(d.push.last_success) + '.' : __(' Nessun invio riuscito finora.')) }) : null,
				d.push && d.push.last_error ? h('li', { class: 'dolly-help', text: __('Ultimo errore push: ') + d.push.last_error }) : null,
				check(!c.email_queue.failed, __('Email: ') + c.email_queue.sent + __(' inviate, ') + c.email_queue.pending + __(' in coda, ') + c.email_queue.failed + __(' non riuscite'), c.email_queue.last_error ? __('Ultimo errore: ') + c.email_queue.last_error : __('Verifica la configurazione SMTP.'))
			]),
			h('p', { class: 'dolly-label', text: __('Comando cron di sistema (una delle due opzioni, ogni minuto):') }),
			h('pre', { class: 'dolly-code', text: '* * * * * ' + c.wp_cli + ' >/dev/null 2>&1\n* * * * * curl -fsS "' + c.cron_url + '" >/dev/null 2>&1' }),
			h('p', { class: 'dolly-help', text: __('L\'indirizzo contiene una chiave segreta: non condividerlo.') }),
			h('p', { class: 'dolly-help', text: __('Notifiche push ed email partono subito, alla fine dell\'operazione che le crea; lo scheduler ogni minuto invia quelle programmate e ripete quelle non riuscite.') }),
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
		DOLLY.render(main, h('div', { class: 'dolly-stack' }, [form, status, DOLLY.card(__('Registro modifiche'), 'history', auditBox)]));
		loadAudit();
	}

	/* ------------------------------------------------------------------ */
	/* Analytics                                                            */
	/* ------------------------------------------------------------------ */


	var AN_PRESETS = [
		{ id: '7', label: __('Ultimi 7 giorni') },
		{ id: '30', label: __('Ultimi 30 giorni') },
		{ id: 'month', label: __('Questo mese') },
		{ id: 'prev', label: __('Mese scorso') },
		{ id: '90', label: __('Ultimi 3 mesi') },
		{ id: 'year', label: __('Quest\'anno') },
		{ id: '365', label: __('Ultimi 12 mesi') }
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

		var fromF = DOLLY.dateField({ label: __('Dal'), value: st.from });
		var toF = DOLLY.dateField({ label: __('Al'), value: st.to, help: __('GG/MM/AAAA · fino a oggi') });
		var wpF = DOLLY.field({ label: __('Sede'), type: 'select', value: st.workplace, options: workplaceOptions(__('Tutte le sedi')) });
		var empF = DOLLY.field({ label: __('Dipendente'), type: 'select', value: st.user, options: [{ value: '', label: __('Tutti i dipendenti') }] });
		allEmployees().then(function (list) {
			list.forEach(function (e) { empF.input.appendChild(h('option', { value: e.id, selected: String(e.id) === String(st.user) ? true : null, text: e.name + (e.active ? '' : __(' (disattivato)')) })); });
		});
		var applyBtn = DOLLY.button(__('Mostra'), { variant: 'primary', icon: 'chart-line' });
		var presetBox = h('div', { class: 'dolly-btn-row dolly-an__presets', role: 'group', 'aria-label': __('Periodi rapidi') });
		var errBox = h('div');
		var meta = h('p', { class: 'dolly-small dolly-muted dolly-an__meta', 'aria-live': 'polite' });
		var notice = h('div');
		var kpis = h('div', { class: 'dolly-grid dolly-grid--4 dolly-an__kpis' });
		var body = h('div', { class: 'dolly-an__body' });
		var csvBtn = DOLLY.button(__('Esporta CSV'), { icon: 'file-spreadsheet', disabled: true, onClick: exportCsv });
		var printBtn = DOLLY.button(__('Stampa'), { icon: 'printer', disabled: true, onClick: function () { window.print(); } });
		var freshBtn = DOLLY.button(__('Ricalcola'), { icon: 'refresh-cw', disabled: true, onClick: function () { load(true); } });
		freshBtn.title = __('Ricalcola i dati senza usare quelli già salvati');

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
			var msg = !f || !t ? __('Indica le date nel formato GG/MM/AAAA.') : (t > today ? __('La data finale non può essere successiva a oggi.') : (f > t ? __('La data iniziale deve precedere quella finale.') : ''));
			if (!msg && (new Date(t) - new Date(f)) / 86400000 + 1 > 366) { msg = __('Il periodo può durare al massimo 366 giorni.'); }
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
			meta.textContent = __('Calcolo dal ') + DOLLY.fmt.date(st.from) + __(' al ') + DOLLY.fmt.date(st.to) + '…';
			DOLLY.render(notice, null);
			DOLLY.render(kpis, null);
			destroyCharts();
			DOLLY.render(body, DOLLY.loading(__('Calcolo delle statistiche in corso. Per periodi lunghi può richiedere qualche secondo.')));
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
			var unit = { day: __('per giorno'), week: __('per settimana'), month: __('per mese') }[d.unit];
			meta.textContent = __('Dal ') + d.from_label + __(' al ') + d.to_label + ' · ' + d.days + __(' giorni · ') + d.employees_count + (d.employees_count === 1 ? __(' dipendente') : __(' dipendenti')) + __(' · calcolato il ') + d.generated;
			DOLLY.render(notice, k.provisional_days ? DOLLY.alert(k.provisional_days + (k.provisional_days === 1 ? __(' giornata è provvisoria') : __(' giornate sono provvisorie')) + __(' (uscita mancante, anomalia aperta o turno da approvare): i totali possono ancora cambiare.'), 'info') : null);
			DOLLY.render(kpis, [
				kpiTile(__('Ore lavorate'), hm(k.worked_min), 'clock', __('su ') + hm(k.planned_min) + __(' previste (') + pct(k.worked_pct) + ')', 'green'),
				kpiTile(__('Straordinari'), hm(k.extra_min), 'trending-up', k.extra_pending_min ? DOLLY.badge(hm(k.extra_pending_min) + __(' da approvare'), 'amber', 'hourglass') : __('Nessuno da approvare')),
				kpiTile(__('Tasso di presenza'), pct(k.presence_pct), 'user-check', k.present_days + __(' giornate lavorate · ') + k.expected_days + __(' giornate lavorative previste'), 'green'),
				kpiTile(__('Tasso di assenteismo'), pct(k.absenteeism_pct), 'user-x', __('Malattia, infortunio e assenze non giustificate: ') + hm(k.absence_min) + __(' sulle ore previste'), 'red'),
				kpiTile(__('Puntualità'), pct(k.punctuality_pct), 'alarm-clock', k.late ? k.late + __(' ritardi su ') + k.entries + __(' entrate · in media ') + k.late_avg + __(' min') : __('Nessun ritardo su ') + k.entries + __(' entrate'), 'amber'),
				kpiTile(__('Ferie e permessi'), k.leave_days + __(' gg'), 'sun', __('Permessi orari: ') + hm(k.leave_min)),
				kpiTile(__('Malattia e infortunio'), k.sick_days + __(' gg'), 'stethoscope', __('Assenze non giustificate: ') + k.absent_days + __(' gg'), 'red'),
				kpiTile(__('Anomalie'), k.anomalies, 'triangle-alert', k.anomalies_open ? DOLLY.badge(k.anomalies_open + __(' ancora aperte'), 'red', 'triangle-alert') : __('Tutte risolte'), 'red')
			]);

			var empty = !d.employees_count;
			if (empty) {
				DOLLY.render(body, DOLLY.empty(__('Nessun dipendente'), __('Non ci sono dipendenti per il periodo e la sede scelti.'), 'users'));
				return;
			}
			var top = d.employees.filter(function (e) { return e.extra_min || e.extra_pending_min; })
				.sort(function (a, b) { return (b.extra_min + b.extra_pending_min) - (a.extra_min + a.extra_pending_min); }).slice(0, 10);
			var abs = d.absences.filter(function (a) { return a.min > 0; });
			var reqText = k.requests ? k.requests + __(' richieste') + (k.requests_pending ? ', ' + k.requests_pending + __(' in attesa') : '') + (k.response_hours !== null ? __(' · risposta media in ') + String(k.response_hours).replace('.', ',') + __(' ore') : '') : '';

			var cards = {
				hours: chartCard(__('Ore lavorate ') + unit, 'clock', __('Ore ordinarie e di straordinario rispetto alle ore previste dall\'orario.')),
				presence: chartCard(__('Presenze e assenze ') + unit, 'users', __('Giornate-persona: chi ha timbrato, chi era in ferie, in malattia o assente senza giustificazione.')),
				absences: chartCard(__('Ripartizione delle assenze'), 'chart-bar', __('Ore di assenza per motivo.'), !abs.length && __('Nessuna assenza nel periodo.')),
				weekday: chartCard(__('Ritardi per giorno della settimana'), 'calendar-days', __('Numero di entrate oltre la tolleranza.'), !k.late && __('Nessun ritardo nel periodo.')),
				lateDist: chartCard(__('Entità dei ritardi'), 'alarm-clock', __('Quante entrate in ritardo, per minuti di ritardo.'), !k.late && __('Nessun ritardo nel periodo.')),
				overtime: chartCard(__('Straordinari per dipendente'), 'trending-up', d.employees_count > 10 ? __('I 10 dipendenti con più straordinario.') : __('Straordinario approvato e da approvare.'), !top.length && __('Nessuno straordinario nel periodo.')),
				anomalies: chartCard(__('Anomalie per tipo'), 'triangle-alert', __('Anomalie delle giornate del periodo, aperte e risolte.'), !d.anomalies.length && __('Nessuna anomalia nel periodo.')),
				requests: chartCard(__('Richieste per tipo'), 'inbox', reqText || __('Richieste che riguardano il periodo.'), !d.requests.length && __('Nessuna richiesta nel periodo.'))
			};
			var tableBox = h('div');
			var sortF = DOLLY.field({ label: __('Ordina per'), type: 'select', value: st.sort, options: [
				{ value: 'name', label: __('Nome') }, { value: 'worked', label: __('Ore lavorate') }, { value: 'balance', label: __('Differenza sulle previste') },
				{ value: 'extra', label: __('Straordinario') }, { value: 'presence', label: __('Presenza (dal più basso)') }, { value: 'late', label: __('Ritardi') },
				{ value: 'absent', label: __('Assenze non giustificate') }, { value: 'sick', label: __('Malattia e infortunio') }, { value: 'anomalies', label: __('Anomalie') }
			] });
			sortF.input.addEventListener('change', function () { st.sort = sortF.input.value; save(); renderTable(); });

			DOLLY.render(body, [
				h('div', { class: 'dolly-an__wide' }, [cards.hours.el, cards.presence.el]),
				h('div', { class: 'dolly-grid dolly-grid--2 dolly-an__grid' }, [cards.absences.el, cards.weekday.el, cards.lateDist.el, cards.overtime.el, cards.anomalies.el, cards.requests.el]),
				DOLLY.card(__('Riepilogo per dipendente'), 'users', [h('div', { class: 'dolly-toolbar' }, [sortF]), tableBox])
			]);
			renderTable();

			var s = d.series;
			lineBar(cards.hours, s.labels, [
				{ label: __('Ore ordinarie'), data: s.ordinary.map(hours), backgroundColor: C.primary, stack: 'h' },
				{ label: __('Straordinario'), data: s.extra.map(hours), backgroundColor: C.amber, stack: 'h' },
				{ type: 'line', label: __('Ore previste'), data: s.planned.map(function (v) { return v ? hours(v) : null; }), borderColor: C.grey, backgroundColor: C.grey, borderDash: [6, 4], borderWidth: 2, pointRadius: s.labels.length > 40 ? 0 : 3, tension: 0 }
			], { stacked: true, axis: __('Ore'), fmt: function (v) { return hm(v * 60); } });
			lineBar(cards.presence, s.labels, [
				{ label: __('Presenti'), data: s.present, backgroundColor: C.green },
				{ label: __('Ferie e donazione'), data: s.leave, backgroundColor: C.blue },
				{ label: __('Malattia e infortunio'), data: s.sick, backgroundColor: C.amber },
				{ label: __('Assenti non giustificati'), data: s.absent, backgroundColor: C.red }
			], { stacked: true, axis: __('Giornate-persona'), integer: true });
			if (abs.length) {
				lineBar(cards.absences, abs.map(function (a) { return a.label; }), [{ label: __('Ore di assenza'), data: abs.map(function (a) { return hours(a.min); }), backgroundColor: C.primary }], { horizontal: true, axis: __('Ore'), fmt: function (v) { return hm(v * 60); }, legend: false });
			}
			if (k.late) {
				lineBar(cards.weekday, d.weekday.map(function (w) { return w.short; }), [{ label: __('Ritardi'), data: d.weekday.map(function (w) { return w.late; }), backgroundColor: C.primary }], {
					integer: true, legend: false, axis: __('Ritardi'),
					extra: function (i) { var w = d.weekday[i]; return w.entries ? pct(w.late_pct) + __(' delle entrate · media ') + w.late_avg + __(' min') : ''; }
				});
				lineBar(cards.lateDist, d.late_dist.labels, [{ label: __('Entrate in ritardo'), data: d.late_dist.values, backgroundColor: C.primary }], { integer: true, legend: false, axis: __('Entrate') });
			}
			if (top.length) {
				lineBar(cards.overtime, top.map(function (e) { return e.name; }), [
					{ label: __('Approvato'), data: top.map(function (e) { return hours(e.extra_min); }), backgroundColor: C.primary },
					{ label: __('Da approvare'), data: top.map(function (e) { return hours(e.extra_pending_min); }), backgroundColor: C.amber }
				], { horizontal: true, stacked: true, axis: __('Ore'), fmt: function (v) { return hm(v * 60); } });
			}
			if (d.anomalies.length) {
				lineBar(cards.anomalies, d.anomalies.map(function (a) { return a.label; }), [
					{ label: __('Aperte'), data: d.anomalies.map(function (a) { return a.open; }), backgroundColor: C.red },
					{ label: __('Risolte'), data: d.anomalies.map(function (a) { return a.resolved; }), backgroundColor: C.green }
				], { horizontal: true, stacked: true, integer: true, axis: __('Anomalie') });
			}
			if (d.requests.length) {
				lineBar(cards.requests, d.requests.map(function (r) { return r.label; }), [
					{ label: __('Approvate'), data: d.requests.map(function (r) { return r.approved; }), backgroundColor: C.green },
					{ label: __('In attesa'), data: d.requests.map(function (r) { return r.pending; }), backgroundColor: C.amber },
					{ label: __('Respinte'), data: d.requests.map(function (r) { return r.rejected; }), backgroundColor: C.red },
					{ label: __('Annullate'), data: d.requests.map(function (r) { return r.cancelled; }), backgroundColor: C.grey }
				], { horizontal: true, stacked: true, integer: true, axis: __('Richieste') });
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
					h('td', { text: __('Totale') }), h('td', { class: 'num', text: String(tot('present_days')) }), h('td', { class: 'num', text: hm(tot('worked_min')) }),
					h('td', { class: 'num', text: hm(tot('planned_min')) }), h('td', { class: 'num', text: hm(tot('balance_min')) }), h('td', { class: 'num', text: hm(tot('extra_min')) }),
					h('td', { class: 'num', text: pct(k.presence_pct) }), h('td', { class: 'num', text: String(tot('late')) }), h('td', { class: 'num', text: String(tot('absent_days')) }),
					h('td', { class: 'num', text: String(tot('leave_days')) }), h('td', { class: 'num', text: hm(tot('leave_min')) }), h('td', { class: 'num', text: String(tot('sick_days')) }),
					h('td', { class: 'num', text: String(tot('anomalies')) })
				]));
				DOLLY.render(tableBox, DOLLY.table([
					{ label: __('Dipendente'), render: function (e) {
						return h('span', {}, [
							h('strong', {}, h('a', { href: CFG.pages.attendance + '&user_id=' + e.user_id + '&month=' + ym, title: __('Apri le presenze di ') + e.name, text: e.name })),
							e.active ? null : h('span', { class: 'dolly-att-date__off' }, DOLLY.badge(__('Disattivato'), 'neutral')),
							e.contract ? h('div', { class: 'dolly-small dolly-muted', text: e.contract }) : null
						]);
					} },
					{ label: __('Giorni lavorati'), num: true, render: function (e) { return e.present_days + (e.expected_days ? ' / ' + e.expected_days : ''); } },
					{ label: __('Ore lavorate'), num: true, render: function (e) { return hm(e.worked_min); } },
					{ label: __('Ore previste'), num: true, render: function (e) { return hm(e.planned_min); } },
					{ label: __('Differenza'), num: true, render: function (e) { return h('span', { class: e.balance_min < 0 ? 'dolly-neg' : (e.balance_min > 0 ? 'dolly-pos' : ''), text: (e.balance_min > 0 ? '+' : '') + hm(e.balance_min) }); } },
					{ label: __('Straordinario'), num: true, render: function (e) { return h('span', {}, [hm(e.extra_min), e.extra_pending_min ? h('div', {}, DOLLY.badge(hm(e.extra_pending_min) + __(' da approvare'), 'amber', 'hourglass')) : null]); } },
					{ label: __('Presenza'), num: true, render: function (e) { return pct(e.presence_pct); } },
					{ label: __('Ritardi'), num: true, render: function (e) { return e.late ? e.late + ' · ' + e.late_min + __(' min') : '0'; } },
					{ label: __('Assenze non giust.'), num: true, render: function (e) { return e.absent_days ? DOLLY.badge(e.absent_days + __(' gg'), 'red') : '0'; } },
					{ label: __('Ferie'), num: true, render: function (e) { return e.leave_days + __(' gg'); } },
					{ label: __('Permessi'), num: true, render: function (e) { return hm(e.leave_min); } },
					{ label: __('Malattia/infortunio'), num: true, render: function (e) { return e.sick_days + __(' gg'); } },
					{ label: __('Anomalie'), num: true, render: function (e) { return e.anomalies ? DOLLY.badge(String(e.anomalies), 'red', 'triangle-alert') : '0'; } }
				], rows, { caption: __('Riepilogo per dipendente dal ') + d.from_label + __(' al ') + d.to_label, foot: d.employees.length > 1 ? foot : null }));
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
			DOLLY.render(card.table, DOLLY.table([{ label: '', srLabel: __('Voce'), key: 'l' }].concat(datasets.map(function (ds, i) { return { label: ds.label, render: function (r) { return fmt(r.v[i]); } }; })),
				labels.map(function (l, i) { return { l: l, v: datasets.map(function (ds) { return ds.data[i]; }) }; }), { caption: __('Dati del grafico ') + card.title, stack: false }));
		}

		function exportCsv() {
			if (!data) { return; }
			var rows = data.employees.map(function (e) {
				return [e.name, e.contract, e.present_days, e.expected_days, hm(e.worked_min), hm(e.planned_min), hm(e.balance_min), hm(e.extra_min), hm(e.extra_pending_min),
					e.presence_pct === null ? '' : String(e.presence_pct).replace('.', ','), e.late, e.late_min, e.absent_days, e.leave_days, hm(e.leave_min), e.sick_days, e.anomalies];
			});
			downloadCsv(__('Analytics_') + data.from.split('-').reverse().join('-') + '_' + data.to.split('-').reverse().join('-') + '.csv',
				[__('Dipendente'), __('Contratto'), __('Giorni lavorati'), __('Giorni lavorativi previsti'), __('Ore lavorate'), __('Ore previste'), __('Differenza'), __('Straordinario approvato'), __('Straordinario da approvare'),
					__('Presenza %'), __('Ritardi'), __('Minuti di ritardo'), __('Assenze non giustificate (gg)'), __('Ferie e donazione (gg)'), __('Permessi orari'), __('Malattia e infortunio (gg)'), __('Anomalie')], rows);
		}

		window.addEventListener('beforeprint', function () { Object.keys(charts).forEach(function (k) { charts[k].resize(); }); });
		load();
	}

	/* ------------------------------------------------------------------ */
	/* Appearance (white label)                                            */
	/* ------------------------------------------------------------------ */

	var COLOR_LABELS = {
		primary: [__('Colore principale'), __('Pulsanti, link ed elementi selezionati.')],
		accent: [__('Colore di evidenza'), __('Giorno corrente, barra del tempo sullo schermo sede, dettagli.')],
		header_bg: [__('Intestazione'), __('Barra superiore del portale e del pannello, sfondo dello schermo sede.')],
		background: [__('Sfondo pagina'), __('Dietro a schede e riquadri.')],
		surface: [__('Riquadri'), __('Schede, finestre e campi.')],
		text: [__('Testo'), __('Testo e titoli.')],
		muted: [__('Testo secondario'), __('Descrizioni e note.')],
		border: [__('Bordi'), __('Contorni di schede e tabelle.')],
		success: [__('Successo'), __('Presenze, conferme, entrata.')],
		warning: [__('Attenzione'), __('Richieste in attesa, pausa, avvisi.')],
		danger: [__('Errore'), __('Assenze, errori, eliminazioni.')],
		info: [__('Informazione'), __('Ferie e messaggi informativi.')]
	};
	var DARK_LABELS = { dark_background: __('Sfondo pagina'), dark_surface: __('Riquadri'), dark_text: __('Testo'), dark_muted: __('Testo secondario'), dark_border: __('Bordi') };
	var COLOR_PRESETS = [
		{ label: __('Blu'), color: '#2563EB' }, { label: __('Indaco'), color: '#4F46E5' }, { label: __('Viola'), color: '#7C3AED' }, { label: __('Smeraldo'), color: '#059669' },
		{ label: __('Verde acqua'), color: '#0D9488' }, { label: __('Rosa'), color: '#DB2777' }, { label: __('Arancio'), color: '#EA580C' }, { label: __('Ardesia'), color: '#334155' }
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
		var swatch = h('input', { type: 'color', class: 'dolly-color__swatch', value: value.toLowerCase(), 'aria-label': label + __(': selettore colore'), tabindex: '-1' });
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
		var rm = DOLLY.button(__('Rimuovi'), { icon: 'x', size: 'sm', variant: 'ghost', onClick: function () { cur = 0; curUrl = ''; show(); onChange(); } });
		var choose = DOLLY.button(__('Scegli immagine'), { icon: 'image', size: 'sm', onClick: function () {
			if (!window.wp || !window.wp.media) { DOLLY.toast(__('La libreria media non è disponibile.'), 'error'); return; }
			var frame = window.wp.media({ title: label, library: { type: 'image' }, multiple: false, button: { text: __('Usa questa immagine') } });
			frame.on('select', function () {
				var a = frame.state().get('selection').first().toJSON();
				cur = a.id; curUrl = a.sizes && a.sizes.medium ? a.sizes.medium.url : a.url;
				show(); onChange();
			});
			frame.open();
		} });
		function show() {
			DOLLY.render(preview, curUrl ? h('img', { src: curUrl, alt: '' }) : h('span', { class: 'dolly-small dolly-muted', text: o.empty || __('Nessuna immagine') }));
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
		var brandName = text('brand_name', __('Nome del marchio'), { max: 40, help: __('Mostrato quando non c\'è un logo, come nome dell\'app sul telefono, nelle notifiche e nelle email.') });
		var appName = text('app_name', __('Nome completo dell\'app'), { optional: true, help: __('Nome dell\'app installata e titolo nel browser. Vuoto = "') + auto.app_name + '".', attrs: { placeholder: auto.app_name } });
		var portalSub = text('portal_subtitle', __('Sottotitolo del portale'), { optional: true, help: __('Accanto al marchio nelle pagine di accesso.') });
		var adminTitle = text('admin_title', __('Nome del pannello di amministrazione'), { max: 40, help: __('Voce del menu di WordPress e intestazione di queste pagine.') });
		var displaySub = text('display_subtitle', __('Sottotitolo dello schermo sede'), { optional: true });
		var mark = DOLLY.switchControl({ label: __('Quadratino colorato dopo il nome'), name: 'wordmark_mark', checked: !!a.wordmark_mark, description: __('Piccolo dettaglio nel colore di evidenza, solo quando non c\'è un logo.'), onChange: changed });

		// Logos and icons.
		var logo = imageField('logo_id', __('Logo'), __('Pagine di accesso e, se non imposti il logo per l\'intestazione, anche barra superiore e schermo sede. Formato orizzontale con sfondo trasparente.'), a.logo_id, d.images.logo_id, changed, { empty: __('Nessun logo: viene mostrato il nome del marchio.') });
		var logoHeader = imageField('logo_header_id', __('Logo per l\'intestazione colorata'), __('Facoltativo: versione chiara del logo, leggibile sul colore dell\'intestazione.'), a.logo_header_id, d.images.logo_header_id, changed, { empty: __('Uguale al logo principale.') });
		var logoHeight = DOLLY.field({ label: __('Altezza massima del logo (px)'), name: 'logo_height', type: 'number', value: a.logo_height, attrs: { min: 24, max: 96 } });
		var appIcon = imageField('app_icon_id', __('Icona dell\'app'), __('Immagine quadrata di almeno 512 × 512 px: icona sulla schermata Home e nelle notifiche. Vuoto = icona del sito (Impostazioni › Generali) oppure l\'icona predefinita.'), a.app_icon_id, d.images.app_icon_id, changed, { square: true, empty: __('Icona predefinita') });

		// Colors.
		var colors = {};
		Object.keys(COLOR_LABELS).forEach(function (k) { colors[k] = colorField(k, COLOR_LABELS[k][0], COLOR_LABELS[k][1], a[k], changed); });
		var darkColors = {};
		Object.keys(DARK_LABELS).forEach(function (k) { darkColors[k] = colorField(k, DARK_LABELS[k], null, a[k], changed); });
		var presets = h('div', { class: 'dolly-swatches', role: 'group', 'aria-label': __('Combinazioni di colori pronte') }, COLOR_PRESETS.map(function (p) {
			var b = h('button', { type: 'button', class: 'dolly-swatch', title: p.label }, [h('span', { class: 'dolly-swatch__dot', style: 'background:' + p.color, 'aria-hidden': 'true' }), h('span', { text: p.label })]);
			b.addEventListener('click', function () { ['primary', 'accent', 'header_bg'].forEach(function (k) { colors[k].set(p.color); }); changed(); });
			return b;
		}));
		var contrastBox = h('ul', { class: 'dolly-contrast', 'aria-live': 'polite' });
		function showContrast(c) {
			var row = function (ratio, label, min) {
				var ok = ratio >= min;
				return h('li', {}, [ok ? DOLLY.badge(String(ratio).replace('.', ',') + ':1', 'green', 'circle-check') : DOLLY.badge(String(ratio).replace('.', ',') + ':1', 'amber', 'triangle-alert'), ' ', label, ok ? null : h('span', { class: 'dolly-help', text: __(' Contrasto basso: il testo può essere difficile da leggere.') })]);
			};
			DOLLY.render(contrastBox, [
				row(c.on_primary, __('Testo sui pulsanti principali'), 4.5),
				row(c.primary, __('Link e colore principale sui riquadri'), 3),
				row(c.header, __('Testo sull\'intestazione'), 4.5),
				row(c.text, __('Testo sullo sfondo'), 4.5),
				row(c.muted, __('Testo secondario sui riquadri'), 4.5)
			]);
		}
		showContrast(d.contrast);

		// Dark mode.
		var scheme = DOLLY.radios({ label: __('Tema'), name: 'color_scheme', value: a.color_scheme, options: choiceOptions(ch.schemes).map(function (o) {
			o.description = { light: __('Sempre chiaro (predefinito).'), dark: __('Sempre scuro.'), auto: __('Chiaro o scuro secondo l\'impostazione del telefono o del computer.') }[o.value];
			return o;
		}), onChange: changed });

		// Typography.
		var font = select('font_family', __('Carattere'), choiceOptions(ch.fonts), __('I caratteri di sistema non scaricano nulla e sono i più veloci.'));
		var fontCustom = text('font_custom', __('Nome del carattere'), { max: 200, help: __('Come in CSS, es. "Inter", sans-serif. Deve essere installato sul dispositivo o caricato con l\'indirizzo qui sotto.') });
		var fontUrl = text('font_url', __('Indirizzo del foglio di stile del carattere'), { optional: true, max: 500, type: 'url', help: __('Es. un file .css ospitato sul tuo sito. Con servizi esterni (es. Google Fonts) l\'indirizzo IP dei visitatori viene inviato a terzi: valuta il GDPR.'), attrs: { placeholder: 'https://' } });
		var customBox = h('div', { class: 'dolly-form-grid', hidden: a.font_family !== 'custom' }, [fontCustom, fontUrl]);
		font.input.addEventListener('change', function () { customBox.hidden = font.input.value !== 'custom'; });
		var textSize = select('text_size', __('Dimensione del testo'), choiceOptions(ch.text_sizes), __('Portale, pagine di accesso e schermo sede.'));
		var headingWeight = select('heading_weight', __('Spessore dei titoli'), ch.heading_weights.map(function (w) { return { value: w, label: { 600: __('Semi-grassetto'), 700: __('Grassetto (predefinito)'), 800: __('Extra grassetto') }[w] }; }));

		// Shapes.
		var radius = DOLLY.field({ label: __('Arrotondamento degli angoli (px)'), name: 'radius', type: 'number', value: a.radius, attrs: { min: 0, max: 24 }, help: __('0 = angoli vivi, 12 = predefinito, 24 = molto arrotondati.') });
		var btnShape = DOLLY.radios({ label: __('Forma dei pulsanti'), name: 'button_shape', value: a.button_shape, options: choiceOptions(ch.button_shapes), onChange: changed });
		var shadow = select('shadow', __('Ombra dei riquadri'), choiceOptions(ch.shadows));
		var density = select('density', __('Spaziatura'), choiceOptions(ch.densities), __('Compatta mostra più contenuto sullo schermo.'));

		// Login page.
		var loginTitle = text('login_title', __('Titolo della pagina di accesso'));
		var loginText = DOLLY.field({ label: __('Testo sotto il titolo'), name: 'login_text', type: 'textarea', value: a.login_text, optional: true, rows: 3, attrs: { maxlength: 300 } });
		var loginBg = imageField('login_bg_id', __('Immagine di sfondo'), __('Facoltativa: coperta dal riquadro di accesso al centro. Usa un\'immagine poco contrastata.'), a.login_bg_id, d.images.login_bg_id, changed, { empty: __('Nessuna immagine: colore di sfondo.') });

		// Emails.
		var fromName = text('email_from_name', __('Nome del mittente'), { optional: true, help: __('Vuoto = nome predefinito di WordPress o del plugin SMTP.') });
		var fromEmail = text('email_from_email', __('Indirizzo del mittente'), { optional: true, type: 'email', max: 100, help: __('Usa un indirizzo del tuo dominio, altrimenti le email possono finire nello spam.') });
		var subjectPrefix = text('email_subject_prefix', __('Prefisso dell\'oggetto'), { optional: true, max: 40, help: __('Vuoto = "') + auto.email_subject_prefix + '".', attrs: { placeholder: auto.email_subject_prefix } });
		var signature = DOLLY.field({ label: __('Firma in fondo alle email'), name: 'email_signature', type: 'textarea', value: a.email_signature, optional: true, rows: 2, help: __('Vuoto = "') + auto.email_signature + '".', attrs: { maxlength: 300, placeholder: auto.email_signature } });

		// Custom CSS.
		var customCss = DOLLY.field({ label: __('CSS aggiuntivo'), name: 'custom_css', type: 'textarea', value: a.custom_css, optional: true, rows: 8, help: __('Applicato al portale, alle pagine di accesso e allo schermo sede. Puoi usare le variabili --dolly-* (es. var(--dolly-primary)).'), attrs: { spellcheck: 'false', class: 'dolly-textarea dolly-textarea--code' } });

		// Preview.
		var previewStyle = h('style');
		var previewBrand = h('div', { class: 'dolly-brand' });
		var previewSub = h('span', { class: 'dolly-brand__sub' });
		var preview = h('div', { class: 'dolly-preview' + (a.color_scheme === 'dark' ? ' is-dark' : '') }, [
			h('div', { class: 'dolly-topbar dolly-preview__bar' }, [previewBrand, h('span', { class: 'dolly-btn dolly-btn--ghost dolly-btn--icon', 'aria-hidden': 'true' }, DOLLY.icon('bell'))]),
			h('div', { class: 'dolly-preview__body' }, [
				h('div', { class: 'dolly-card' }, [
					h('h3', { text: __('Buongiorno, Giulia') }),
					h('p', { class: 'dolly-muted', text: __('Turno di oggi: 09:00 – 18:00, sede centrale.') }),
					h('div', { class: 'dolly-btn-row' }, [
						h('span', { class: 'dolly-btn dolly-btn--primary' }, [DOLLY.icon('log-in'), __('Timbra entrata')]),
						h('span', { class: 'dolly-btn' }, __('Richieste'))
					])
				]),
				h('div', { class: 'dolly-card' }, [
					h('div', { class: 'dolly-tabs', 'aria-hidden': 'true' }, [h('span', { class: 'dolly-tab', 'aria-selected': 'true' }, __('In corso')), h('span', { class: 'dolly-tab' }, __('Archivio'))]),
					h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('Motivo') }), h('span', { class: 'dolly-input' }, __('Visita medica'))]),
					h('div', { class: 'dolly-preview__badges' }, [DOLLY.badge(__('Approvata'), 'green', 'circle-check'), DOLLY.badge(__('In attesa'), 'amber', 'clock'), DOLLY.badge(__('Respinta'), 'red', 'circle-x'), DOLLY.badge(__('Ferie'), 'blue')]),
					h('span', { class: 'dolly-switch', role: 'presentation', 'aria-checked': 'true' }, [h('span', { class: 'dolly-switch__track' }, h('span', { class: 'dolly-switch__thumb' })), h('span', { text: __('Notifiche attive') })]),
					DOLLY.alert(__('Le richieste vengono confermate via email.'), 'info')
				])
			])
		]);
		var modeTabs = h('div');
		var previewDark = a.color_scheme === 'dark';
		function renderModeTabs() {
			DOLLY.render(modeTabs, DOLLY.tabs([{ id: 'light', label: __('Chiaro'), icon: 'sun' }, { id: 'dark', label: __('Scuro'), icon: 'moon' }], previewDark ? 'dark' : 'light', function (id) {
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

		var saveBtn = DOLLY.button(__('Salva aspetto'), { type: 'submit', variant: 'primary', icon: 'save' });
		var resetBtn = DOLLY.button(__('Ripristina predefiniti'), { icon: 'rotate-ccw', variant: 'ghost', onClick: function () {
			DOLLY.confirm(__('Ripristinare l\'aspetto predefinito?'), __('Marchio, logo, colori, caratteri, testi e CSS aggiuntivo tornano ai valori iniziali. Le immagini restano nella libreria media.'), __('Ripristina'), 'danger').then(function (ok) {
				if (!ok) { return; }
				DOLLY.busy(resetBtn, DOLLY.api('admin/appearance/reset', { method: 'POST' })).then(function (nd) {
					applyAdminCss(nd.css); DOLLY.toast(__('Aspetto predefinito ripristinato.'), 'success'); renderAppearance(nd);
				}, function (err) { DOLLY.toast(err.message, 'error'); });
			});
		} });

		var card = function (title, icon, children, intro) {
			return DOLLY.card(title, icon, h('div', { class: 'dolly-form' }, [intro ? h('p', { class: 'dolly-muted', style: 'margin:0', text: intro }) : null].concat(children)), { level: 'h2' });
		};
		var form = h('form', { class: 'dolly-stack', novalidate: true }, [
			alertBox,
			card(__('Marchio'), 'tag', [h('div', { class: 'dolly-form-grid' }, [brandName, appName, portalSub, adminTitle, displaySub]), mark], __('Finché restano quelli predefiniti, sottotitoli, nome del pannello e testi della pagina di accesso vengono mostrati nella lingua di ogni utente.')),
			card(__('Logo e icona'), 'image', [h('div', { class: 'dolly-form-grid' }, [logo, logoHeader]), h('div', { class: 'dolly-form-grid' }, [logoHeight]), appIcon]),
			card(__('Colori'), 'palette', [
				h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('Combinazioni pronte') }), presets, h('span', { class: 'dolly-help', text: __('Imposta insieme colore principale, evidenza e intestazione.') })]),
				h('div', { class: 'dolly-form-grid dolly-form-grid--3' }, Object.keys(colors).map(function (k) { return colors[k]; })),
				h('div', { class: 'dolly-field' }, [h('span', { class: 'dolly-label', text: __('Leggibilità (contrasto WCAG)') }), contrastBox])
			], __('Il resto della palette (sfumature, sfondi degli avvisi, testo sui pulsanti) viene calcolato in automatico da questi colori.')),
			card(__('Modalità scura'), 'moon', [scheme, h('div', { class: 'dolly-form-grid dolly-form-grid--3' }, Object.keys(darkColors).map(function (k) { return darkColors[k]; }))],
				__('Riguarda portale dipendenti, pagine di accesso e schermo sede: il pannello di amministrazione resta chiaro. In modalità scura colore principale, evidenza e intestazione vengono adattati in automatico.')),
			card(__('Caratteri'), 'type', [font, customBox, h('div', { class: 'dolly-form-grid' }, [textSize, headingWeight])]),
			card(__('Forme e spaziature'), 'square-dashed', [h('div', { class: 'dolly-form-grid' }, [radius, shadow, density]), btnShape]),
			card(__('Pagina di accesso'), 'log-in', [loginTitle, loginText, loginBg]),
			card(__('Email'), 'mail', [h('div', { class: 'dolly-form-grid' }, [fromName, fromEmail, subjectPrefix]), signature], __('Mittente, oggetto e firma delle notifiche via email.')),
			card(__('CSS aggiuntivo'), 'code', [customCss]),
			h('div', { class: 'dolly-btn-row dolly-settings__save' }, [saveBtn, resetBtn])
		]);
		form.addEventListener('input', changed);
		form.addEventListener('change', changed);
		form.addEventListener('submit', function (ev) {
			ev.preventDefault(); DOLLY.clearErrors(form); alertBox.hidden = true;
			DOLLY.busy(saveBtn, DOLLY.api('admin/appearance', { method: 'POST', body: collect() })).then(function (nd) {
				applyAdminCss(nd.css);
				DOLLY.toast(__('Aspetto salvato. Nome e logo del pannello si aggiornano al prossimo caricamento.'), 'success');
				renderAppearance(nd);
			}, function (err) { DOLLY.formError(form, err, alertBox); });
		});

		var aside = h('aside', { class: 'dolly-appearance__preview', 'aria-label': __('Anteprima') }, [
			DOLLY.card(__('Anteprima'), 'eye', [modeTabs, preview, h('p', { class: 'dolly-help', style: 'margin:12px 0 0', text: __('L\'anteprima si aggiorna mentre modifichi; le modifiche si applicano solo dopo il salvataggio.') })], { level: 'h2' })
		]);
		DOLLY.render(main, h('div', { class: 'dolly-appearance' }, [previewStyle, form, aside]));
		updatePreview();
	}

	/* ------------------------------------------------------------------ */
	/* Boot                                                               */
	/* ------------------------------------------------------------------ */

	var pages = {
		dashboard: pageDashboard, employees: pageEmployees, 'employee-new': pageEmployeeNew, workplaces: pageWorkplaces,
		requests: pageRequests, attendance: pageAttendance, analytics: pageAnalytics, anomalies: pageAnomalies, broadcast: pageBroadcast, exports: pageExports, appearance: pageAppearance, settings: pageSettings
	};
	menuToggle();
	headerBell();
	(pages[CFG.page] || pageDashboard)();
	DOLLY.icons();
})(window, document);
