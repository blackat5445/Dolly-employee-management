/**
 * "Gestione Dipendenti" administration screens (Dashboard, Dipendenti, Nuovo dipendente, Sedi,
 * Richieste, Presenze, Analytics, Anomalie, Esportazioni, Impostazioni) built on the REST API.
 */
(function (window, document) {
	'use strict';

	var DOLLY = window.DOLLY, h = DOLLY.h, CFG = DOLLY.config;
	var app = document.getElementById('dolly-admin-app');
	if (!app) { return; }
	var main = document.getElementById('dolly-admin-main');
	var ACTIONS = { entrata: 'Entrata', inizio_pausa: 'Inizio pausa', fine_pausa: 'Fine pausa', uscita: 'Uscita' };
	var TYPES = { ferie: 'Ferie', permesso: 'Permesso orario', straordinario: 'Straordinario', correzione: 'Correzione timbratura', turno: 'Turno a chiamata', donazione: 'Donazione sangue' };

	function workplaceOptions(allLabel) {
		var o = allLabel ? [{ value: '', label: allLabel }] : [];
		return o.concat((CFG.workplaces || []).map(function (w) { return { value: w.id, label: w.name + (w.active ? '' : ' (disattivata)') }; }));
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
		var m = DOLLY.field({ label: 'Mese', type: 'select', value: state.month, options: DOLLY.MONTHS.map(function (n, i) { return { value: i + 1, label: n }; }) });
		var yy = DOLLY.field({ label: 'Anno', type: 'select', value: state.year, options: years });
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
			var label = hidden ? 'Mostra il menu laterale' : 'Nascondi il menu laterale';
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
		var bell = h('button', { type: 'button', class: 'dolly-btn dolly-btn--ghost dolly-btn--icon dolly-admin__bell', 'aria-label': 'Notifiche' }, [DOLLY.icon('bell'), count]);
		header.appendChild(bell);
		function update() {
			DOLLY.api('notifications', { query: { page: 1 } }).then(function (r) {
				count.hidden = !r.unread; count.textContent = r.unread;
				bell.setAttribute('aria-label', 'Notifiche' + (r.unread ? ', ' + r.unread + ' non lette' : ''));
			}, function () {});
		}
		bell.addEventListener('click', function () {
			var box = h('div', {}, DOLLY.loading());
			var page = 1;
			var dlg = DOLLY.dialog({ title: 'Notifiche', body: box, wide: true, actions: [
				{ label: 'Segna tutte come lette', icon: 'check', onClick: function (close, btn) { DOLLY.busy(btn, DOLLY.api('notifications/read-all', { method: 'POST' })).then(function () { update(); load(); }); } },
				{ label: 'Chiudi', variant: 'primary' }
			] });
			function load() {
				DOLLY.api('notifications', { query: { page: page } }).then(function (r) {
					DOLLY.render(box, [
						r.items.length ? h('ul', { style: 'list-style:none;margin:0;padding:0' }, r.items.map(function (n) {
							return h('li', { class: 'dolly-alert dolly-alert--' + (n.read ? 'info' : 'warning') }, [DOLLY.icon(n.read ? 'bell' : 'bell-ring'), h('div', { class: 'dolly-alert__body' }, [
								h('strong', { text: n.title }), h('div', { style: 'white-space:pre-line', text: n.body }),
								h('div', { class: 'dolly-small dolly-muted', text: DOLLY.fmt.dateTime(n.created_at) }),
								n.link ? h('a', { href: n.link, onclick: function () { DOLLY.api('notifications/' + n.id + '/read', { method: 'POST' }); } }, 'Apri') : null
							])]);
						})) : DOLLY.empty('Nessuna notifica', '', 'bell'),
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
		var wpF = DOLLY.field({ label: 'Sede', type: 'select', value: st.workplace, options: workplaceOptions('Tutte le sedi') });
		var dateEl = h('div', { class: 'dolly-dash__date' });
		var updated = h('span', { class: 'dolly-small dolly-muted', 'aria-live': 'polite' });
		var kpis = h('div', { class: 'dolly-grid dolly-grid--4' });
		var attBox = h('div', {}, DOLLY.loading());
		var reqBox = h('div', {}, DOLLY.loading());
		var anomBox = h('div', {}, DOLLY.loading());
		var calEl = h('div');
		var chartWrap = h('div', { class: 'dolly-chart' }, h('canvas', { 'aria-label': 'Grafico presenze', role: 'img' }));
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
				DOLLY.card('Presenze di oggi', 'clock', attBox),
				DOLLY.card('Ultime richieste', 'inbox', reqBox, { actions: [DOLLY.button('Tutte', { size: 'sm', href: CFG.pages.requests, icon: 'arrow-right' })] })
			]),
			DOLLY.card('Anomalie non risolte', 'triangle-alert', anomBox, { actions: [DOLLY.button('Tutte', { size: 'sm', href: CFG.pages.anomalies, icon: 'arrow-right' })] }),
			h('div', { class: 'dolly-grid dolly-grid--2 dolly-dash__bottom' }, [
				DOLLY.card('Calendario', 'calendar-days', [calEl, legend(), h('p', { class: 'dolly-small dolly-muted', style: 'margin:12px 0 0', text: 'Clicca un giorno per impostare una chiusura di quel giorno, oppure usa "Nuova chiusura" per un periodo.' })], {
					actions: [DOLLY.button('Nuova chiusura', { size: 'sm', variant: 'primary', icon: 'calendar-off', onClick: function () { closureDialog(null, function () { if (calendar) { calendar.refetchEvents(); } refresh(); }); } })]
				}),
				DOLLY.card('Andamento presenze', 'chart-column', [rangeTabs, chartWrap, chartTable])
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
			updated.textContent = 'Aggiornato alle ' + d.time + ' · aggiornamento automatico ogni 15 secondi';
			var ab = d.kpi.absent;
			DOLLY.render(kpis, [
				kpi('Presenti ora', d.kpi.present, 'user-check', 'In servizio, esclusi pausa e uscite', 'green'),
				kpi('Assenti oggi', ab.total, 'user-x', [
					ab.ferie ? DOLLY.badge('Ferie ' + ab.ferie, 'blue', 'sun') : null, ' ',
					ab.malattia ? DOLLY.badge('Malattia/infortunio ' + ab.malattia, 'red', 'stethoscope') : null, ' ',
					ab.permesso ? DOLLY.badge('Permesso ' + ab.permesso, 'blue', 'timer') : null, ' ',
					ab.ingiustificati ? DOLLY.badge('Non giustificati ' + ab.ingiustificati, 'amber', 'circle-help') : null,
					ab.total ? null : 'Nessuna assenza'
				], 'red'),
				kpi('Richieste in attesa', d.kpi.pending, 'inbox', h('a', { href: CFG.pages.requests, text: 'Gestisci richieste' }), 'amber'),
				kpi('Anomalie non risolte', d.kpi.anomalies, 'triangle-alert', h('a', { href: CFG.pages.anomalies, text: 'Gestisci anomalie' }), 'red')
			]);
			var attBadge = { presente: ['green', 'circle-check'], pausa: ['amber', 'coffee'], uscito: ['neutral', 'log-out'], assente: ['red', 'user-x'], ferie: ['blue', 'sun'], malattia: ['red', 'stethoscope'], infortunio: ['red', 'bandage'], festivo: ['neutral', 'party-popper'], atteso: ['neutral', 'clock'] };
			DOLLY.render(attBox, [
				DOLLY.table([
					{ label: 'Dipendente', key: 'employee' },
					{ label: 'Sede', key: 'workplace' },
					{ label: 'Entrata', key: 'entrata', cls: 'time' },
					{ label: 'Pausa', render: function (r) { return r.inizio_pausa ? r.inizio_pausa + (r.fine_pausa ? '–' + r.fine_pausa : '–…') : '—'; }, cls: 'time' },
					{ label: 'Uscita', key: 'uscita', cls: 'time' },
					{ label: 'Stato', render: function (r) { var b = attBadge[r.status] || ['neutral', 'info']; return DOLLY.badge(r.status_label, b[0], b[1]); } }
				], d.attendance.items, { empty: ['Nessun dipendente previsto oggi', '', 'calendar'], caption: 'Presenze di oggi' }),
				DOLLY.pagination(d.attendance, function (p) { st.att = p; refresh(); }, 'presenze')
			]);
			DOLLY.render(reqBox, [
				DOLLY.table([
					{ label: 'Dipendente', key: 'employee' },
					{ label: 'Richiesta', render: function (r) { return h('span', { class: 'dolly-small', text: r.summary }); } },
					{ label: 'Stato', render: function (r) { return DOLLY.requestBadge(r.status, r.status_label); } },
					{ label: '', srLabel: 'Azioni', render: function (r) { return r.status === 'pending' ? decisionButtons(r, function () { refresh(); }) : ''; } }
				], d.requests.items, { empty: ['Nessuna richiesta', '', 'inbox'], caption: 'Ultime richieste' }),
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
				updated.textContent = 'Aggiornamento non riuscito: ' + err.message;
			});
			loadChart();
			if (calendar) { calendar.refetchEvents(); }
		}

		function renderRangeTabs() {
			DOLLY.render(rangeTabs, DOLLY.tabs([{ id: 7, label: '7 giorni' }, { id: 30, label: '30 giorni' }, { id: 90, label: '90 giorni' }], st.range, function (id) { st.range = id; renderRangeTabs(); loadChart(); }));
		}
		function loadChart() {
			DOLLY.api('admin/chart', { query: { range: st.range, workplace: st.workplace } }).then(function (d) {
				var ds = [
					{ label: 'Presenti', data: d.present, backgroundColor: '#17693A' },
					{ label: 'Assenti non giustificati', data: d.absent, backgroundColor: '#B42318' },
					{ label: 'Ferie', data: d.leave, backgroundColor: '#1F5FAD' },
					{ label: 'Malattia', data: d.sick, backgroundColor: '#CCB166' }
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
							locale: 'it-IT'
						}
					});
				}
				// Accessible data table equivalent of the chart.
				DOLLY.render(chartTable, DOLLY.table([{ label: 'Giorno', key: 'l' }, { label: 'Presenti', key: 'p' }, { label: 'Assenti', key: 'a' }, { label: 'Ferie', key: 'f' }, { label: 'Malattia', key: 's' }],
					d.labels.map(function (l, i) { return { l: l, p: d.present[i], a: d.absent[i], f: d.leave[i], s: d.sick[i] }; }), { caption: 'Dati del grafico presenze' }));
			}, function () {});
		}

		if (window.FullCalendar) {
			calendar = new window.FullCalendar.Calendar(calEl, {
				locale: 'it', firstDay: 1, initialView: 'dayGridMonth', height: 'auto',
				headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
				dayMaxEvents: 3,
				eventOrder: 'order,start,-duration,allDay,title',
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
		collective: { label: 'Chiusura collettiva', description: 'Ferie collettive, chiusura per inventario… Chi lavora comunque registra ore ordinarie.' },
		holiday: { label: 'Chiusura per festività', description: 'Festa del patrono, ponte festivo… Le ore di chi lavora comunque hanno la maggiorazione festiva.' }
	};

	/**
	 * Closure of one day (date given, opened from the calendar) or of a range of days (date null, opened
	 * from the "Nuova chiusura" button): type, closed/open switch for each workplace, optional broadcast to
	 * the employees of the closed workplaces. A missing entry on those days is never an anomaly.
	 */
	function closureDialog(date, done) {
		var range = !date;
		var body = h('div', {}, DOLLY.loading());
		var dlg = DOLLY.dialog({ title: range ? 'Nuova chiusura (periodo)' : 'Chiusura', body: body, wide: true });
		var load = range ? Promise.resolve({ date: CFG.today, name: '', type: 'collective', workplaces: [] }) : DOLLY.api('admin/closures', { query: { date: date } });
		load.then(function (c) {
			var alertBox = h('div', { hidden: true });
			var existing = !range && c.workplaces.length > 0;
			var from = range ? DOLLY.dateField({ label: 'Dal', name: 'from', value: CFG.today, required: true }) : null;
			var to = range ? DOLLY.dateField({ label: 'Al', name: 'to', value: CFG.today, required: true }) : null;
			var type = DOLLY.radios({ label: 'Tipo di chiusura', name: 'type', value: c.type || 'collective', full: true, options: Object.keys(CLOSURE_TYPES).map(function (k) {
				return { value: k, label: CLOSURE_TYPES[k].label, description: CLOSURE_TYPES[k].description + (k === 'holiday' ? ' (maggiorazione ' + (CFG.holidayIncrease || 0) + '%)' : '') };
			}), onChange: syncType });
			var name = DOLLY.field({ label: 'Descrizione', name: 'name', value: c.name, optional: true, full: true, help: 'Ad esempio: Ferie estive, Santo patrono. Vuota = il tipo di chiusura.' });
			var switches = (CFG.workplaces || []).filter(function (w) { return w.active || c.workplaces.indexOf(w.id) !== -1; }).map(function (w) {
				var sw = DOLLY.switchControl({ label: w.name, name: 'wp' + w.id, checked: c.workplaces.indexOf(w.id) !== -1, description: [w.address, w.city].filter(Boolean).join(', ') || null });
				sw.wid = w.id;
				return sw;
			});
			var allBtn = DOLLY.button('Chiudi tutte le sedi', { size: 'sm', icon: 'building-2', onClick: function () { switches.forEach(function (s) { s.control.setOn(true); }); } });
			var effect = h('div');
			function syncType() {
				DOLLY.render(effect, DOLLY.alert(type.value() === 'holiday'
					? 'Per i dipendenti delle sedi chiuse la mancata timbratura non genera anomalie. Chi lavora comunque può timbrare: le ore sono conteggiate come ore festive con maggiorazione del ' + (CFG.holidayIncrease || 0) + '% (percentuale nelle Impostazioni).'
					: 'Per i dipendenti delle sedi chiuse la mancata timbratura non genera anomalie. Chi lavora comunque può timbrare: le ore sono conteggiate come ore ordinarie.', 'info'));
			}
			syncType();
			function periodText() {
				if (!range) { return 'il ' + DOLLY.fmt.date(date); }
				var a = from.iso(), b = to.iso();
				return a && b && a !== b ? 'dal ' + DOLLY.fmt.date(a) + ' al ' + DOLLY.fmt.date(b) : 'il ' + DOLLY.fmt.date(a || CFG.today);
			}
			var msg = DOLLY.field({ label: 'Messaggio', name: 'message', type: 'textarea', full: true, rows: 4 });
			var msgTouched = false;
			msg.input.addEventListener('input', function () { msgTouched = true; });
			function fillMessage() {
				if (msgTouched) { return; }
				msg.input.value = 'Ti informiamo che ' + periodText() + ' la tua sede resterà chiusa (' + (name.input.value || CLOSURE_TYPES[type.value()].label).toLowerCase() + '). Non è necessario timbrare.';
			}
			var chEmail = DOLLY.switchControl({ label: 'Email', name: 'bc_email', checked: true });
			var chPortal = DOLLY.switchControl({ label: 'Notifica nell\'app', name: 'bc_portal', checked: true, description: 'Arriva anche come notifica push sui telefoni con le notifiche attive.' });
			var chPopup = DOLLY.switchControl({ label: 'Mostra subito all\'apertura dell\'app', name: 'bc_popup', checked: false, description: 'Il messaggio compare in un pop-up appena il dipendente apre il portale.' });
			var channels = h('div', { class: 'dolly-field dolly-field--full', dataset: { name: 'channels' } }, [h('div', { class: 'dolly-form-grid' }, [chEmail, chPortal, chPopup]), h('span', { class: 'dolly-error', hidden: true })]);
			var bcBox = h('div', { class: 'dolly-form-grid dolly-field--full', hidden: true }, [msg, channels]);
			var bc = DOLLY.switchControl({ label: 'Invia un messaggio broadcast', name: 'broadcast', checked: false, description: 'Ai dipendenti assegnati alle sedi chiuse, subito dopo il salvataggio.', onChange: function (on) { bcBox.hidden = !on; if (on) { fillMessage(); } } });
			var form = h('form', { class: 'dolly-form', novalidate: true }, [
				alertBox,
				range ? h('div', { class: 'dolly-form-grid' }, [from, to]) : h('p', {}, [h('strong', { text: c.date_label }), c.holiday ? ' · festività: ' + c.holiday : '']),
				type,
				h('div', { class: 'dolly-form-grid' }, [name]),
				h('div', { class: 'dolly-toolbar' }, [h('h3', { style: 'margin:0', text: 'Sedi chiuse' }), h('div', { class: 'dolly-toolbar__spacer' }), allBtn]),
				switches.length ? h('div', { class: 'dolly-form-grid dolly-closure__sites' }, switches) : DOLLY.alert('Nessuna sede configurata.', 'warning'),
				effect,
				bc, bcBox
			]);
			var actions = h('div', { class: 'dolly-btn-row dolly-btn-row--end', style: 'margin-top:16px' });
			var saveBtn = DOLLY.button('Salva', { variant: 'primary', icon: 'save' });
			function period() {
				if (!range) { return { from: date, to: date }; }
				var rd = DOLLY.readDateTimes({ from: [from, 'date', true], to: [to, 'date', true] });
				if (Object.keys(rd.errors).length) { DOLLY.showErrors(form, rd.errors); return null; }
				if (rd.values.to < rd.values.from) { DOLLY.showErrors(form, { to: 'La data di fine deve essere uguale o successiva all\'inizio.' }); return null; }
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
					var days = r.days > 1 ? ' (' + r.days + ' giorni)' : '';
					var text = workplaces.length ? 'Chiusura salvata' + days + ': ' + r.affected + ' dipendent' + (r.affected === 1 ? 'e' : 'i') + ' coinvolt' + (r.affected === 1 ? 'o' : 'i') + '.' : 'Chiusura rimossa' + days + '.';
					if (r.broadcast && r.broadcast.recipient_count !== undefined) { text += ' Messaggio inviato a ' + r.broadcast.recipient_count + '.'; }
					else if (r.broadcast && r.broadcast.skipped) { text += ' Nessun dipendente a cui inviare il messaggio.'; }
					DOLLY.toast(text, 'success');
					done();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			}
			saveBtn.addEventListener('click', function () {
				var closed = switches.filter(function (s) { return s.control.isOn(); }).map(function (s) { return s.wid; });
				if (!closed.length && !existing) { alertBox.hidden = false; DOLLY.render(alertBox, DOLLY.alert('Attiva almeno una sede chiusa.', 'error')); return; }
				send(closed, saveBtn);
			});
			if (existing || range) {
				var rm = DOLLY.button(range ? 'Rimuovi le chiusure del periodo' : 'Rimuovi chiusura', { variant: 'danger', icon: 'trash-2' });
				rm.addEventListener('click', function () {
					DOLLY.confirm(range ? 'Rimuovere le chiusure del periodo?' : 'Rimuovere la chiusura?', 'Tutte le sedi torneranno aperte ' + periodText() + '.', 'Rimuovi', 'danger').then(function (ok) {
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
		var items = [['#E8F1FC', 'Ferie'], ['#EDE9FE', 'Permesso'], ['#F6F0DE', 'Straordinario'], ['#FDECEA', 'Malattia / infortunio'], ['#F1E4F7', 'Festività'], ['#E3EEF3', 'Chiusura collettiva'], ['#FBE9D6', 'Chiusura per festività']];
		return h('div', { class: 'dolly-legend', 'aria-label': 'Legenda' }, items.map(function (i) {
			return h('span', {}, [h('i', { style: 'background:' + i[0] + ';border:1px solid #C7CED6', 'aria-hidden': 'true' }), i[1]]);
		}));
	}

	/* ------------------------------------------------------------------ */
	/* Requests: shared decision UI                                         */
	/* ------------------------------------------------------------------ */

	function decisionButtons(r, done) {
		return h('div', { class: 'dolly-actions' }, [
			DOLLY.button('Approva', { size: 'sm', variant: 'success', icon: 'check', onClick: function () { decide(r, 'approve', done); } }),
			DOLLY.button('Respingi', { size: 'sm', icon: 'x', onClick: function () { decide(r, 'reject', done); } })
		]);
	}

	/** Kinds of hourly leave and the justification codes (hours history) allowed for each; the first is the default. */
	var LEAVE_KINDS = [
		{ value: 'retribuito', label: 'Permesso ordinario retribuito', codes: ['P', 'ROL', 'EO'] },
		{ value: 'non_retribuito', label: 'Permesso ordinario non retribuito', codes: ['Pn'] },
		{ value: 'evento', label: 'Congedi e permessi per eventi specifici', codes: ['P', 'PL'] }
	];
	var CODE_LABELS = { P: 'P · Permesso', ROL: 'ROL · Riduzione orario di lavoro', EO: 'EO · Ex festività', Pn: 'Pn · Permesso non retribuito', PL: 'PL · Permesso Legge 104' };
	function leaveCodeOptions(kind) {
		var k = LEAVE_KINDS.filter(function (x) { return x.value === kind; })[0] || LEAVE_KINDS[0];
		return k.codes.map(function (c) { return { value: c, label: CODE_LABELS[c] }; });
	}

	function decide(r, decision, done) {
		var note = DOLLY.field({ label: 'Nota per il dipendente', name: 'note', type: 'textarea', optional: decision === 'approve' });
		// Hourly leave: the administrator confirms or changes the justification code recorded in the hours history.
		var code = r.type === 'permesso' && decision === 'approve' && r.amend_action !== 'cancel'
			? DOLLY.field({ label: 'Giustificativo (storico ore)', name: 'hours_code', type: 'select', value: r.hours_code, options: leaveCodeOptions(r.leave_kind), help: r.leave_kind_label + '. Le ore del permesso vengono registrate con questo codice.' })
			: null;
		var form = h('form', { class: 'dolly-form' }, [
			h('p', {}, [h('strong', { text: r.employee + ': ' }), r.summary]),
			r.notes ? h('p', { class: 'dolly-muted', text: 'Note del dipendente: ' + r.notes }) : null,
			code,
			r.type === 'correzione' && decision === 'approve' ? DOLLY.alert('Approvando, la timbratura verrà corretta con registrazione nel registro modifiche.', 'info') : null,
			r.amend_action ? DOLLY.alert(r.amend_action === 'cancel' ? 'Approvando, la richiesta originale approvata verrà annullata.' : 'Approvando, la modifica sostituirà la richiesta approvata originale.', 'info') : null,
			note
		]);
		DOLLY.dialog({
			title: decision === 'approve' ? 'Approva richiesta' : 'Respingi richiesta', body: form,
			actions: [
				{ label: 'Annulla' },
				{ label: decision === 'approve' ? 'Approva' : 'Respingi', variant: decision === 'approve' ? 'success' : 'danger', icon: decision === 'approve' ? 'check' : 'x', onClick: function (close, btn) {
					if (decision === 'reject' && !note.input.value.trim()) { DOLLY.showErrors(form, { note: 'Indica il motivo del rifiuto.' }); return; }
					DOLLY.busy(btn, DOLLY.api('admin/requests/' + r.id + '/decision', { method: 'POST', body: { decision: decision, note: note.input.value, hours_code: code ? code.input.value : '' } })).then(function () {
						close(); DOLLY.toast(decision === 'approve' ? 'Richiesta approvata.' : 'Richiesta respinta.', 'success'); done();
					}, function (err) { DOLLY.formError(form, err); });
				} }
			]
		});
	}

	/** Revokes an approved vacation, hourly leave or blood donation (the reason is mandatory). */
	function revokeDialog(r, done) {
		var note = DOLLY.field({ label: 'Motivo della revoca', name: 'note', type: 'textarea', required: true });
		var form = h('form', { class: 'dolly-form' }, [
			h('p', {}, [h('strong', { text: r.employee + ': ' }), r.summary]),
			DOLLY.alert('La richiesta approvata viene annullata: sparisce dal calendario e dalle presenze del dipendente, che riceve una notifica con il motivo. La richiesta resta nello storico come "Annullata".', 'warning'),
			note
		]);
		DOLLY.dialog({
			title: 'Revoca richiesta approvata', body: form,
			actions: [
				{ label: 'Annulla' },
				{ label: 'Revoca', variant: 'danger', icon: 'undo-2', onClick: function (close, btn) {
					if (!note.input.value.trim()) { DOLLY.showErrors(form, { note: 'Indica il motivo della revoca.' }); return; }
					DOLLY.busy(btn, DOLLY.api('admin/requests/' + r.id + '/revoke', { method: 'POST', body: { note: note.input.value } })).then(function () {
						close(); DOLLY.toast('Richiesta revocata.', 'success'); done();
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
		if (r.certificate_due && (r.certificate_status === 'missing' || r.certificate_status === 'overdue')) { nodes.push(h('div', { class: 'dolly-small', text: 'Scadenza ' + DOLLY.fmt.date(r.certificate_due) })); }
		(r.certificates || []).forEach(function (c) {
			nodes.push(h('div', { class: 'dolly-small' }, h('a', { href: DOLLY.downloadUrl('certificates/' + c.id + '/download') }, [DOLLY.icon('download'), ' ' + c.original_name])));
		});
		if (r.status === 'approved' && r.certificate_status !== 'not_required' && r.certificate_status !== 'cleared') {
			var file = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png', class: 'dolly-sr-only', 'aria-label': 'File certificato di donazione per ' + r.employee });
			var up = DOLLY.button('Carica certificato', { size: 'sm', icon: 'file-up', onClick: function () { file.click(); } });
			file.addEventListener('change', function () {
				if (!file.files[0]) { return; }
				var fd = new FormData(); fd.append('file', file.files[0]);
				DOLLY.busy(up, DOLLY.api('admin/requests/' + r.id + '/certificate', { method: 'POST', form: fd, timeout: 120000 })).then(function () { DOLLY.toast('Certificato di donazione caricato.', 'success'); done(); }, function (err) { DOLLY.toast(err.message, 'error'); file.value = ''; });
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
			{ label: 'Dipendente', key: 'employee' },
			{ label: 'Data', render: function (a) { return DOLLY.fmt.date(a.work_date); } },
			{ label: 'Tipo', render: function (a) { return a.status === 'open' ? DOLLY.badge(a.type_label, 'red', a.type === 'missing_certificate' ? 'file-text' : 'triangle-alert') : h('div', {}, [DOLLY.badge(a.type_label, 'neutral'), ' ', DOLLY.badge(a.resolution_label, 'green', 'circle-check')]); } },
			{ label: 'Dettagli', render: function (a) {
				return h('div', { class: 'dolly-small' }, [
					h('div', { style: 'white-space:pre-line', text: a.details }),
					a.employee_note ? h('div', { class: 'dolly-muted', text: 'Nota del dipendente: ' + a.employee_note }) : null,
					a.status === 'resolved' ? h('div', { class: 'dolly-muted', text: 'Risolta da ' + a.resolved_by + ' il ' + DOLLY.fmt.dateTime(a.resolved_at) + (a.resolution_note ? ': ' + a.resolution_note : '') }) : null
				]);
			} },
			{ label: '', srLabel: 'Azioni', render: function (a) { return a.status === 'open' ? anomalyActions(a, done) : ''; } }
		], items, { empty: ['Nessuna anomalia', 'Non ci sono anomalie da mostrare.', 'circle-check'], caption: 'Anomalie' });
	}

	function anomalyActions(a, done) {
		var b = [];
		if (a.type === 'unjustified_absence') {
			b.push(DOLLY.button('Inserisci entrata', { size: 'sm', icon: 'pencil', onClick: function () { resolveDialog(a, 'correct_entry', done); } }));
			b.push(DOLLY.button('Chiudi', { size: 'sm', icon: 'x', onClick: function () { resolveDialog(a, 'dismiss', done); } }));
		} else if (a.type === 'missing_exit' || a.type === 'late_exit') {
			b.push(DOLLY.button('Correggi uscita', { size: 'sm', icon: 'pencil', onClick: function () { resolveDialog(a, 'correct_exit', done); } }));
			if (a.type === 'late_exit') { b.push(DOLLY.button('Approva straordinario', { size: 'sm', variant: 'success', icon: 'check', onClick: function () { resolveDialog(a, 'approve_extra', done); } })); }
			b.push(DOLLY.button('Chiudi', { size: 'sm', icon: 'x', onClick: function () { resolveDialog(a, 'dismiss', done); } }));
		} else if (a.type === 'sickness_conflict') {
			b.push(DOLLY.button('Segna come verificata', { size: 'sm', icon: 'shield-check', onClick: function () { resolveDialog(a, 'review', done); } }));
		} else if (a.type === 'missing_certificate') {
			return h('span', { class: 'dolly-small dolly-muted', text: 'Si risolve con il caricamento del certificato.' });
		}
		return h('div', { class: 'dolly-actions' }, b);
	}

	function resolveDialog(a, action, done) {
		var titles = { correct_exit: 'Correggi orario di uscita', correct_entry: 'Inserisci l\'entrata', approve_extra: 'Approva straordinario', dismiss: 'Chiudi anomalia', review: 'Verifica conflitto malattia/infortunio' };
		var fields = [];
		var timeF = null, exitF = null;
		if (action === 'correct_entry') {
			timeF = DOLLY.timeField({ label: 'Orario di entrata', name: 'time', required: true });
			exitF = DOLLY.timeField({ label: 'Orario di uscita', name: 'exit_time', optional: true, help: 'Facoltativo, HH:MM: compilalo se la giornata è già terminata.' });
			fields.push(DOLLY.alert('Vengono inserite le timbrature con correzione dell\'amministratore, registrate nel registro modifiche. Per chiudere un\'assenza giustificata usa "Chiudi".', 'info'), h('div', { class: 'dolly-form-grid' }, [timeF, exitF]));
		}
		if (action === 'correct_exit') {
			timeF = DOLLY.timeField({ label: 'Orario di uscita corretto', name: 'time', required: true });
			fields.push(DOLLY.alert('Viene inserita un\'uscita con correzione dell\'amministratore, registrata nel registro modifiche.', 'info'), timeF);
		}
		if (action === 'approve_extra') {
			var m = /alle (\d{2}:\d{2})/.exec(a.details || '');
			timeF = DOLLY.timeField({ label: 'Straordinario autorizzato fino alle', name: 'end_time', required: true, value: m ? m[1] : '' });
			fields.push(DOLLY.alert('L\'approvazione sposta il limite di allerta; non crea né modifica timbrature.', 'info'), timeF);
		}
		var note = DOLLY.field({ label: action === 'correct_exit' || action === 'correct_entry' ? 'Motivo della correzione' : 'Nota', name: 'note', type: 'textarea', optional: action === 'approve_extra' });
		fields.push(note);
		var form = h('form', { class: 'dolly-form', novalidate: true }, [h('p', {}, [h('strong', { text: a.employee }), ' · ' + DOLLY.fmt.date(a.work_date) + ' · ' + a.type_label]), fields]);
		DOLLY.dialog({
			title: titles[action], body: form,
			actions: [{ label: 'Annulla' }, { label: 'Conferma', variant: 'primary', icon: 'check', onClick: function (close, btn) {
				DOLLY.clearErrors(form);
				var body = { action: action, note: note.input.value };
				if (timeF) {
					var t = timeF.hm();
					if (!t) { DOLLY.showErrors(form, (function () { var o = {}; o[action === 'approve_extra' ? 'end_time' : 'time'] = 'Orario non valido (HH:MM).'; return o; })()); return; }
					body[action === 'approve_extra' ? 'end_time' : 'time'] = t;
				}
				if (exitF && exitF.input.value.trim()) {
					var x = exitF.hm();
					if (!x) { DOLLY.showErrors(form, { exit_time: 'Orario non valido (HH:MM).' }); return; }
					body.exit_time = x;
				}
				if ((action === 'correct_exit' || action === 'correct_entry' || action === 'dismiss' || action === 'review') && !note.input.value.trim()) { DOLLY.showErrors(form, { note: 'Campo obbligatorio.' }); return; }
				DOLLY.busy(btn, DOLLY.api('admin/anomalies/' + a.id + '/resolve', { method: 'POST', body: body })).then(function () {
					close(); DOLLY.toast('Anomalia risolta.', 'success'); done();
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
		var type = DOLLY.field({ label: 'Tipo di contratto', name: 'employment_type', type: 'select', value: s.employment_type || 'full_time', options: [{ value: 'full_time', label: 'Tempo pieno' }, { value: 'part_time', label: 'Part-time' }, { value: 'on_call', label: 'Contratto a chiamata' }] });

		// Same hours for all the selected days.
		var u = {
			weekdays: DOLLY.chips({ label: 'Giorni lavorativi', name: 'weekdays', full: true, selected: s.per_day ? [] : s.weekdays, options: DOLLY.WEEKDAYS.map(function (d, i) { return { value: i + 1, label: d }; }) }),
			start_time: DOLLY.timeField({ label: 'Inizio turno', name: 'start_time', value: s.start_time || '09:00', required: true }),
			end_time: DOLLY.timeField({ label: 'Fine turno', name: 'end_time', value: s.end_time || '18:00', required: true }),
			lunch_start: DOLLY.timeField({ label: 'Inizio pausa pranzo', name: 'lunch_start', value: s.lunch_start || '13:00' }),
			lunch_end: DOLLY.timeField({ label: 'Fine pausa pranzo', name: 'lunch_end', value: s.lunch_end || '14:00' })
		};
		var uLunch = h('div', { class: 'dolly-form-grid dolly-field--full', hidden: !s.has_lunch }, [u.lunch_start, u.lunch_end]);
		u.has_lunch = DOLLY.switchControl({ label: 'Pausa pranzo prevista', name: 'has_lunch', checked: !!s.has_lunch, onChange: function (on) { uLunch.hidden = !on; } });
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
				start: DOLLY.timeField({ label: 'Inizio', name: p + 'start_time', value: base.start }),
				end: DOLLY.timeField({ label: 'Fine', name: p + 'end_time', value: base.end }),
				ls: DOLLY.timeField({ label: 'Inizio pausa', name: p + 'lunch_start', value: base.lunch_start || '13:00' }),
				le: DOLLY.timeField({ label: 'Fine pausa', name: p + 'lunch_end', value: base.lunch_end || '14:00' })
			};
			var lunchBox = h('div', { class: 'dolly-dayrow__lunch', hidden: !hasLunch }, [r.ls, r.le]);
			r.lunch = DOLLY.switchControl({ label: 'Pausa', name: p + 'has_lunch', checked: hasLunch, onChange: function (on) { lunchBox.hidden = !on; } });
			var times = h('div', { class: 'dolly-dayrow__times', hidden: !working }, [r.start, r.end, r.lunch, lunchBox]);
			r.on = DOLLY.switchControl({ label: label, name: 'day' + wd, checked: working, onChange: function (on) { times.hidden = !on; } });
			rows[wd] = r;
			perDayBox.appendChild(h('div', { class: 'dolly-dayrow' }, [h('div', { class: 'dolly-dayrow__day' }, r.on), times]));
		});

		var perDay = DOLLY.switchControl({ label: 'Orario diverso per ogni giorno', name: 'per_day', checked: !!s.per_day, description: 'Disattivato: un orario fisso per tutti i giorni selezionati. Attivato: ogni giorno ha il suo interruttore e il suo orario.', onChange: sync });
		var onCallInfo = h('div', { class: 'dolly-field--full' }, DOLLY.alert('Contratto a chiamata: nessun giorno né orario fisso. Il dipendente inizia e termina il turno quando vuole; ogni turno viene approvato dall\'amministratore oppure automaticamente fino alla soglia indicata nelle Impostazioni.', 'info'));
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
				if (!any) { errors.per_day = 'Attiva almeno un giorno lavorativo.'; }
				return out;
			}
			var lunch2 = u.has_lunch.control.isOn();
			var spec2 = { start_time: [u.start_time, 'time', true], end_time: [u.end_time, 'time', true] };
			if (lunch2) { spec2.lunch_start = [u.lunch_start, 'time', true]; spec2.lunch_end = [u.lunch_end, 'time', true]; }
			var rd2 = DOLLY.readDateTimes(spec2);
			Object.assign(errors, rd2.errors);
			if (!u.weekdays.values().length) { errors.weekdays = 'Seleziona almeno un giorno.'; }
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
			first_name: DOLLY.field({ label: 'Nome', name: 'first_name', value: e.first_name, required: true }),
			last_name: DOLLY.field({ label: 'Cognome', name: 'last_name', value: e.last_name, required: true }),
			username: DOLLY.field({ label: 'Nome utente', name: 'username', value: e.username, required: isNew, help: isNew ? 'Non potrà essere modificato.' : 'Il nome utente non è modificabile.', attrs: isNew ? { autocomplete: 'off', autocapitalize: 'none' } : { readonly: true } }),
			email: DOLLY.field({ label: 'Email', name: 'email', type: 'email', value: e.email, required: true }),
			phone: DOLLY.field({ label: 'Telefono', name: 'phone', type: 'tel', value: e.phone, optional: true }),
			password: isNew ? DOLLY.field({ label: 'Password iniziale', name: 'password', type: 'text', required: true, help: 'Almeno 8 caratteri. Comunicala al dipendente in modo sicuro.', attrs: { autocomplete: 'new-password' } }) : null,
			schedule: scheduleEditor(s),
			workplaces: DOLLY.chips({ label: 'Sedi assegnate', name: 'workplaces', full: true, help: 'Il dipendente può timbrare solo nelle sedi assegnate.', selected: (e.workplaces || []).map(function (w) { return w.id; }), options: (CFG.workplaces || []).filter(function (w) { return w.active; }).map(function (w) { return { value: w.id, label: w.name }; }) }),
			valid_from: DOLLY.dateField({ label: isNew ? 'Valido dal' : 'Modifiche a orario e sedi valide dal', name: 'valid_from', value: CFG.today, required: true, help: 'Le modifiche non alterano lo storico precedente. Formato GG/MM/AAAA.' }),
			iban: DOLLY.field({ label: 'IBAN', name: 'iban', value: DOLLY.fmt.iban(bank.iban), optional: true, full: true, attrs: { autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' } }),
			bank_beneficiary: DOLLY.field({ label: 'Nome beneficiario', name: 'bank_beneficiary', value: bank.bank_beneficiary, optional: true }),
			bank_name: DOLLY.field({ label: 'Banca', name: 'bank_name', value: bank.bank_name, optional: true }),
			bic: DOLLY.field({ label: 'BIC', name: 'bic', value: bank.bic, optional: true, help: '8 o 11 caratteri.', attrs: { autocapitalize: 'characters', spellcheck: 'false', maxlength: 11 } })
		};
		if (isNew) {
			var gen = DOLLY.button('Genera', { icon: 'refresh-cw', onClick: function () {
				var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', out = '', a = new Uint32Array(12);
				window.crypto.getRandomValues(a);
				for (var i = 0; i < 12; i++) { out += chars[a[i] % chars.length]; }
				f.password.input.value = out;
			} });
			f.password.querySelector('.dolly-input').parentNode.insertBefore(h('div', { class: 'dolly-input-group' }, [f.password.input, gen]), f.password.querySelector('.dolly-help') || null);
		}
		if (!(CFG.workplaces || []).length) { f.workplaces = h('div', { class: 'dolly-field dolly-field--full', dataset: { name: 'workplaces' } }, [DOLLY.alert('Crea prima almeno una sede.', 'warning', h('a', { href: CFG.pages.workplaces, text: 'Vai a Sedi' })), h('span', { class: 'dolly-error', hidden: true })]); f.workplaces.values = function () { return []; }; }

		var form = h('form', { class: 'dolly-form', novalidate: true }, [
			alertBox,
			h('h3', {}, [DOLLY.icon('id-card'), ' Dati anagrafici']),
			h('div', { class: 'dolly-form-grid' }, [f.first_name, f.last_name, f.username, f.email, f.phone, f.password]),
			h('h3', {}, [DOLLY.icon('clock'), ' Orario']),
			f.schedule,
			h('h3', {}, [DOLLY.icon('map-pin'), ' Sedi']),
			h('div', { class: 'dolly-form-grid' }, [f.workplaces, f.valid_from]),
			h('h3', {}, [DOLLY.icon('landmark'), ' Dati bancari']),
			h('div', { class: 'dolly-form-grid' }, [f.iban, f.bank_beneficiary, f.bank_name, f.bic])
		]);

		form.collect = function () {
			DOLLY.clearErrors(form); alertBox.hidden = true;
			var read = DOLLY.readDateTimes({ valid_from: [f.valid_from, 'date', true] });
			var errors = read.errors;
			var schedule = f.schedule.collect(errors);
			if (!f.workplaces.values().length) { errors.workplaces = 'Assegna almeno una sede.'; }
			var iban = f.iban.input.value.replace(/[\s-]+/g, '').toUpperCase();
			if (iban && !DOLLY.isIban(iban)) { errors.iban = 'IBAN non valido: controlla lettere e cifre.'; }
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
		var btn = DOLLY.button('Crea dipendente', { type: 'submit', variant: 'primary', icon: 'user-plus' });
		form.appendChild(h('div', { class: 'dolly-btn-row' }, btn));
		form.addEventListener('submit', function (ev) {
			ev.preventDefault();
			var body = form.collect();
			if (!body) { return; }
			DOLLY.busy(btn, DOLLY.api('admin/employees', { method: 'POST', body: body })).then(function (emp) {
				DOLLY.render(main, DOLLY.card('Dipendente creato', 'circle-check', [
					DOLLY.alert(emp.name + ' (' + emp.username + ') è stato creato. Può accedere da ' + CFG.portalUrl.replace('/portale/', '/accesso/') + '.', 'success'),
					h('div', { class: 'dolly-btn-row' }, [DOLLY.button('Crea un altro dipendente', { icon: 'user-plus', variant: 'primary', onClick: pageEmployeeNew }), DOLLY.button('Elenco dipendenti', { href: CFG.pages.employees, icon: 'users' })])
				], { accent: true }));
			}, form.fail);
		});
		DOLLY.render(main, DOLLY.card('Nuovo dipendente', 'user-plus', form, { accent: true }));
	}

	/* ------------------------------------------------------------------ */
	/* Employees list & detail                                              */
	/* ------------------------------------------------------------------ */

	/* Device management: registered devices of an employee, limit and unlink. */

	var DEVICES_OFF = 'Le sessioni dispositivo sono disattivate (Impostazioni › Sessioni dispositivo): al momento i dipendenti possono accedere da qualsiasi dispositivo.';

	/** Limit of devices of an employee: number + save. */
	function deviceLimitControl(uid, ds, reload) {
		var input = h('input', { class: 'dolly-input', type: 'number', min: 1, max: ds.max_limit, value: ds.limit, inputmode: 'numeric', 'aria-label': 'Numero massimo di dispositivi' });
		var btn = DOLLY.button('Salva limite', { size: 'sm', icon: 'save', onClick: function () {
			var v = parseInt(input.value, 10);
			if (!(v >= 1 && v <= ds.max_limit)) { DOLLY.toast('Il limite deve essere compreso tra 1 e ' + ds.max_limit + '.', 'error'); return; }
			DOLLY.busy(btn, DOLLY.api('admin/employees/' + uid + '/device-limit', { method: 'POST', body: { limit: v } })).then(function () {
				DOLLY.toast('Limite dispositivi aggiornato.', 'success'); reload();
			}, function (err) { DOLLY.toast(err.message, 'error'); });
		} });
		return h('div', { class: 'dolly-limit' }, [input, btn]);
	}

	/** Registered devices with "Scollega"; the first one is the main device. */
	function deviceList(devices, employee, reload) {
		if (!devices.length) { return h('span', { class: 'dolly-small dolly-muted', text: 'Nessun dispositivo collegato: il prossimo accesso registra il dispositivo principale.' }); }
		return h('div', {}, devices.map(function (d, i) {
			return h('div', { class: 'dolly-device' }, [
				DOLLY.icon('smartphone'),
				h('span', { class: 'dolly-device__name', text: d.name }),
				i === 0 ? DOLLY.badge('Principale', 'blue') : null,
				h('span', { class: 'dolly-device__meta', text: 'Collegato il ' + DOLLY.fmt.dateTime(d.created_at) + ' · ultimo accesso ' + DOLLY.fmt.dateTime(d.last_seen_at) }),
				DOLLY.button('Scollega', { size: 'sm', icon: 'unlink', ariaLabel: 'Scollega ' + d.name + ' di ' + employee, onClick: function (ev) {
					var b = ev.currentTarget;
					DOLLY.confirm('Scollegare il dispositivo?', '«' + d.name + '» di ' + employee + ' verrà scollegato e il dipendente dovrà accedere di nuovo: il prossimo dispositivo con cui accede verrà registrato.', 'Scollega', 'danger').then(function (ok) {
						if (!ok) { return; }
						DOLLY.busy(b, DOLLY.api('admin/devices/' + d.id, { method: 'DELETE' })).then(function () { DOLLY.toast('Dispositivo scollegato.', 'success'); reload(); }, function (err) { DOLLY.toast(err.message, 'error'); });
					});
				} })
			]);
		}));
	}

	/** Page tab "Gestione dispositivi": every employee with devices and limit. */
	function devicesTab(content) {
		var box = h('div', {}, DOLLY.loading());
		var search = DOLLY.field({ label: 'Cerca', type: 'search', attrs: { placeholder: 'Nome del dipendente' } });
		var all = null;
		search.input.addEventListener('input', function () { draw(); });
		DOLLY.render(content, DOLLY.card(null, null, [
			h('p', { class: 'dolly-muted', style: 'margin-top:0', text: 'Ogni dipendente accede solo dai dispositivi collegati: il primo accesso registra il dispositivo principale. Per far accedere un dipendente da un altro telefono o computer scollega il dispositivo precedente, oppure aumenta il limite.' }),
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
					{ label: 'Dipendente', render: function (e) { return h('strong', { text: e.employee }); } },
					{ label: 'Limite dispositivi', render: function (e) { return deviceLimitControl(e.user_id, { limit: e.limit, max_limit: all.max_limit }, load); } },
					{ label: 'Dispositivi collegati', render: function (e) { return deviceList(e.devices, e.employee, load); } }
				], items, { empty: ['Nessun dipendente trovato', '', 'smartphone'], caption: 'Dispositivi dei dipendenti' })
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
			DOLLY.tabs([{ id: 'elenco', label: 'Dipendenti', icon: 'users' }, { id: 'dispositivi', label: 'Gestione dispositivi', icon: 'smartphone' }], tab, function (t) {
				window.location.hash = t === 'dispositivi' ? 'dispositivi' : '';
				pageEmployees();
			}),
			content
		]);
		if (tab === 'dispositivi') { devicesTab(content); } else { employeesTab(content); }
	}

	function employeesTab(main) {
		var st = { page: 1, search: '', status: 'active', workplace: '' };
		var search = DOLLY.field({ label: 'Cerca', type: 'search', attrs: { placeholder: 'Nome, utente o email' } });
		var status = DOLLY.field({ label: 'Stato', type: 'select', value: st.status, options: [{ value: 'active', label: 'Attivi' }, { value: 'inactive', label: 'Disattivati' }, { value: 'all', label: 'Tutti' }] });
		var wp = DOLLY.field({ label: 'Sede', type: 'select', options: workplaceOptions('Tutte le sedi') });
		var box = h('div', {}, DOLLY.loading());
		var t;
		search.input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { st.search = search.input.value; st.page = 1; load(); }, 300); });
		status.input.addEventListener('change', function () { st.status = status.input.value; st.page = 1; load(); });
		wp.input.addEventListener('change', function () { st.workplace = wp.input.value; st.page = 1; load(); });
		DOLLY.render(main, DOLLY.card(null, null, [
			h('div', { class: 'dolly-toolbar' }, [search, status, wp, h('div', { class: 'dolly-toolbar__spacer' }), DOLLY.button('Nuovo dipendente', { href: CFG.pages['employee-new'], variant: 'primary', icon: 'user-plus' })]),
			box
		]));
		function load() {
			DOLLY.api('admin/employees', { query: { page: st.page, search: st.search, status: st.status, workplace: st.workplace } }).then(function (r) {
				DOLLY.render(box, [
					DOLLY.table([
						{ label: 'Dipendente', render: function (e) { return h('div', {}, [h('strong', { text: e.sort_name || e.name }), h('div', { class: 'dolly-small dolly-muted', text: e.username })]); } },
						{ label: 'Contatti', render: function (e) { return h('div', { class: 'dolly-small' }, [e.email, e.phone ? h('div', { text: e.phone }) : null]); } },
						{ label: 'Sedi', render: function (e) { return e.workplaces.map(function (w) { return w.name; }).join(', ') || '—'; } },
						{ label: 'Orario', render: function (e) { var s = e.schedule; return s ? h('div', { class: 'dolly-small' }, [s.on_call ? DOLLY.badge('A chiamata', 'blue', 'phone-call') : null, h('div', { text: s.on_call ? '' : s.summary })]) : '—'; } },
						{ label: 'Stato', render: function (e) { return e.active ? DOLLY.badge('Attivo', 'green', 'circle-check') : DOLLY.badge('Disattivato', 'neutral', 'ban'); } },
						{ label: '', srLabel: 'Azioni', render: function (e) { return h('div', { class: 'dolly-actions' }, [DOLLY.button('Gestisci', { size: 'sm', icon: 'pencil', ariaLabel: 'Gestisci ' + e.name, onClick: function () { employeeDialog(e.id, load); } })]); } }
					], r.items, { empty: ['Nessun dipendente trovato', 'Modifica i filtri o crea un nuovo dipendente.', 'users'], caption: 'Elenco dipendenti' }),
					DOLLY.pagination(r, function (p) { st.page = p; load(); }, 'dipendenti')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function employeeDialog(id, done) {
		var body = h('div', {}, DOLLY.loading());
		var dlg = DOLLY.dialog({ title: 'Gestione dipendente', body: body, wide: true });
		var tab = 'dati';
		function load() {
			DOLLY.api('admin/employees/' + id).then(function (e) { render(e); }, function (err) { DOLLY.render(body, DOLLY.errorState(err, load)); });
		}
		function render(e) {
			var content = h('div');
			var tabs = DOLLY.tabs([{ id: 'dati', label: 'Dati e orario', icon: 'id-card' }, { id: 'accesso', label: 'Accesso e stato', icon: 'shield-check' }, { id: 'eccezioni', label: 'Eccezioni verifica', icon: 'badge-check' }, { id: 'dispositivi', label: 'Gestione dispositivi', icon: 'smartphone' }, { id: 'storico', label: 'Storico', icon: 'history' }], tab, function (t) { tab = t; render(e); });
			DOLLY.render(body, [h('p', {}, [h('strong', { text: e.sort_name || e.name }), ' · ' + e.username + ' · ', e.active ? DOLLY.badge('Attivo', 'green', 'circle-check') : DOLLY.badge('Disattivato', 'neutral', 'ban')]), tabs, content]);
			if (tab === 'dati') {
				var form = employeeForm(e, false);
				var reason = DOLLY.field({ label: 'Motivo della modifica', name: 'reason', optional: true, full: true });
				var save = DOLLY.button('Salva modifiche', { type: 'submit', variant: 'primary', icon: 'save' });
				form.appendChild(reason);
				form.appendChild(h('div', { class: 'dolly-btn-row' }, save));
				form.addEventListener('submit', function (ev) {
					ev.preventDefault();
					var b = form.collect(); if (!b) { return; }
					b.reason = reason.input.value;
					DOLLY.busy(save, DOLLY.api('admin/employees/' + id, { method: 'PUT', body: b })).then(function () { DOLLY.toast('Dipendente aggiornato.', 'success'); done(); load(); }, form.fail);
				});
				DOLLY.render(content, form);
			} else if (tab === 'accesso') {
				var pw = DOLLY.field({ label: 'Nuova password', name: 'password', type: 'text', help: 'Almeno 8 caratteri. Le sessioni attive del dipendente verranno chiuse.', attrs: { autocomplete: 'new-password' } });
				var pwBtn = DOLLY.button('Imposta password', { type: 'submit', icon: 'key-round', variant: 'primary' });
				var pwForm = h('form', { class: 'dolly-form', novalidate: true }, [pw, h('div', { class: 'dolly-btn-row' }, pwBtn)]);
				pwForm.addEventListener('submit', function (ev) {
					ev.preventDefault();
					DOLLY.busy(pwBtn, DOLLY.api('admin/employees/' + id + '/password', { method: 'POST', body: { password: pw.input.value } })).then(function (r) { DOLLY.toast(r.message, 'success'); pw.input.value = ''; }, function (err) { DOLLY.formError(pwForm, err); });
				});
				var reason2 = DOLLY.field({ label: 'Motivo', name: 'reason', type: 'textarea', required: true });
				var stBtn = DOLLY.button(e.active ? 'Disattiva dipendente' : 'Riattiva dipendente', { type: 'submit', icon: e.active ? 'ban' : 'rotate-ccw', variant: e.active ? 'danger' : 'success' });
				var stForm = h('form', { class: 'dolly-form', novalidate: true }, [
					DOLLY.alert(e.active ? 'La disattivazione chiude subito tutte le sessioni e blocca l\'accesso. Lo storico viene conservato.' : 'Il dipendente potrà di nuovo accedere al portale.', e.active ? 'warning' : 'info'),
					reason2, h('div', { class: 'dolly-btn-row' }, stBtn)
				]);
				stForm.addEventListener('submit', function (ev) {
					ev.preventDefault();
					if (!reason2.input.value.trim()) { DOLLY.showErrors(stForm, { reason: 'Indica il motivo.' }); return; }
					DOLLY.busy(stBtn, DOLLY.api('admin/employees/' + id + '/status', { method: 'POST', body: { active: !e.active, reason: reason2.input.value } })).then(function () {
						DOLLY.toast(e.active ? 'Dipendente disattivato.' : 'Dipendente riattivato.', 'success'); done(); load();
					}, function (err) { DOLLY.formError(stForm, err); });
				});
				DOLLY.render(content, h('div', { class: 'dolly-stack' }, [DOLLY.card('Password', 'key-round', pwForm, { level: 'h3' }), DOLLY.card('Stato account', 'shield-check', stForm, { level: 'h3' })]));
			} else if (tab === 'eccezioni') {
				var reason3 = DOLLY.field({ label: 'Motivo', name: 'reason', type: 'textarea', required: true });
				var customBox = h('div', { class: 'dolly-form-grid', hidden: true });
				var expD = DOLLY.dateField({ label: 'Scadenza: data', name: 'expires_date', value: CFG.today });
				var expT = DOLLY.timeField({ label: 'Scadenza: ora', name: 'expires_time', value: '23:59' });
				DOLLY.append(customBox, [expD, expT]);
				var custom = DOLLY.switchControl({ label: 'Scadenza personalizzata', name: 'custom', checked: false, description: 'Se disattivata, l\'eccezione scade alle 23:59 di oggi.', onChange: function (on) { customBox.hidden = !on; } });
				var exBtn = DOLLY.button('Crea eccezione', { type: 'submit', icon: 'badge-check', variant: 'primary' });
				var exForm = h('form', { class: 'dolly-form', novalidate: true }, [DOLLY.alert('L\'eccezione permette di timbrare senza GPS e senza QR/PIN. Creazione e ogni utilizzo vengono registrati.', 'info'), reason3, custom, customBox, h('div', { class: 'dolly-btn-row' }, exBtn)]);
				exForm.addEventListener('submit', function (ev) {
					ev.preventDefault(); DOLLY.clearErrors(exForm);
					if (!reason3.input.value.trim()) { DOLLY.showErrors(exForm, { reason: 'Indica il motivo.' }); return; }
					var b = { reason: reason3.input.value };
					if (custom.control.isOn()) {
						var rd = DOLLY.readDateTimes({ expires_date: [expD, 'date', true], expires_time: [expT, 'time', true] });
						if (Object.keys(rd.errors).length) { DOLLY.showErrors(exForm, rd.errors); return; }
						b.expires_at = rd.values.expires_date + ' ' + rd.values.expires_time;
					}
					DOLLY.busy(exBtn, DOLLY.api('admin/employees/' + id + '/exception', { method: 'POST', body: b })).then(function () { DOLLY.toast('Eccezione creata.', 'success'); load(); }, function (err) { DOLLY.formError(exForm, err); });
				});
				DOLLY.render(content, h('div', { class: 'dolly-stack' }, [
					DOLLY.card('Nuova eccezione', 'badge-check', exForm, { level: 'h3' }),
					DOLLY.card('Eccezioni recenti', 'history', DOLLY.table([
						{ label: 'Motivo', key: 'reason' },
						{ label: 'Scadenza', render: function (x) { return DOLLY.fmt.dateTime(x.expires_at); } },
						{ label: 'Utilizzi', key: 'use_count', num: true },
						{ label: 'Creata da', render: function (x) { return x.created_by + ' · ' + DOLLY.fmt.dateTime(x.created_at); } },
						{ label: 'Stato', render: function (x) { return x.active ? DOLLY.badge('Attiva', 'green', 'circle-check') : (x.revoked_at ? DOLLY.badge('Revocata', 'neutral', 'ban') : DOLLY.badge('Scaduta', 'neutral', 'clock')); } },
						{ label: '', srLabel: 'Azioni', render: function (x) { return x.active ? DOLLY.button('Revoca', { size: 'sm', icon: 'ban', onClick: function (ev) { DOLLY.busy(ev.currentTarget, DOLLY.api('admin/exceptions/' + x.id, { method: 'DELETE' })).then(function () { DOLLY.toast('Eccezione revocata.', 'success'); load(); }, function (err) { DOLLY.toast(err.message, 'error'); }); } }) : ''; } }
					], e.exceptions, { empty: ['Nessuna eccezione', '', 'badge-check'] }), { level: 'h3' })
				]));
			} else if (tab === 'dispositivi') {
				var ds = e.device_session || { enabled: true, limit: 1, max_limit: 10, devices: [] };
				DOLLY.render(content, h('div', { class: 'dolly-stack' }, [
					ds.enabled ? null : DOLLY.alert(DEVICES_OFF, 'warning'),
					DOLLY.card('Dispositivi collegati', 'smartphone', [
						h('p', { class: 'dolly-muted', style: 'margin-top:0', text: 'Il dipendente accede solo da questi dispositivi. Scollegandone uno viene disconnesso e il prossimo dispositivo con cui accede viene registrato.' }),
						deviceList(ds.devices, e.sort_name || e.name, load)
					], { level: 'h3' }),
					DOLLY.card('Limite dispositivi', 'shield-check', [
						h('p', { class: 'dolly-muted', style: 'margin-top:0', text: 'Numero massimo di dispositivi da cui il dipendente può accedere (predefinito 1, massimo ' + ds.max_limit + ').' }),
						deviceLimitControl(e.id, ds, load)
					], { level: 'h3' })
				]));
			} else {
				DOLLY.render(content, h('div', { class: 'dolly-stack' }, [
					DOLLY.card('Storico orari', 'clock', DOLLY.table([
						{ label: 'Dal', render: function (s) { return DOLLY.fmt.date(s.valid_from); } },
						{ label: 'Al', render: function (s) { return s.valid_to ? DOLLY.fmt.date(s.valid_to) : 'in corso'; } },
						{ label: 'Orario', render: function (s) { return h('span', { class: 'dolly-small', text: s.summary }); } },
						{ label: 'Tipo', key: 'employment_label' }
					], e.schedule_history), { level: 'h3' }),
					DOLLY.card('Registro modifiche', 'history', auditList(e.audit), { level: 'h3' })
				]));
			}
			DOLLY.icons();
		}
		load();
		return dlg;
	}

	function auditList(items) {
		return DOLLY.table([
			{ label: 'Data', render: function (a) { return DOLLY.fmt.dateTime(a.created_at); } },
			{ label: 'Operazione', key: 'label' },
			{ label: 'Eseguita da', key: 'actor' },
			{ label: 'Dipendente', key: 'subject' },
			{ label: 'Motivo', key: 'reason' },
			{ label: 'Valori', render: function (a) {
				if (!a.before && !a.after) { return '—'; }
				return h('details', {}, [h('summary', { text: 'Prima / dopo' }), h('pre', { class: 'dolly-small', style: 'white-space:pre-wrap;max-width:420px', text: 'Prima: ' + JSON.stringify(a.before, null, 1) + '\nDopo: ' + JSON.stringify(a.after, null, 1) })]);
			} }
		], items, { empty: ['Nessuna modifica registrata', '', 'history'], caption: 'Registro modifiche' });
	}

	/* ------------------------------------------------------------------ */
	/* Workplaces                                                           */
	/* ------------------------------------------------------------------ */

	function pageWorkplaces() {
		var box = h('div', {}, DOLLY.loading());
		DOLLY.render(main, DOLLY.card(null, null, [
			h('div', { class: 'dolly-toolbar' }, [h('p', { class: 'dolly-muted', style: 'margin:0', text: 'Ogni sede ha un account dedicato che mostra QR e PIN su ' + CFG.portalUrl.replace('/portale/', '/accesso-sede/') }), h('div', { class: 'dolly-toolbar__spacer' }), DOLLY.button('Nuova sede', { variant: 'primary', icon: 'plus', onClick: function () { workplaceDialog(null, load); } })]),
			box
		]));
		function load() {
			refreshWorkplaces().then(function (list) {
				DOLLY.render(box, DOLLY.table([
					{ label: 'Sede', render: function (w) { return h('div', {}, [h('strong', { text: w.name }), h('div', { class: 'dolly-small dolly-muted', text: [w.address, w.city, w.province].filter(Boolean).join(', ') })]); } },
					{ label: 'Coordinate', render: function (w) { return w.lat !== null ? h('span', { class: 'dolly-small', text: String(w.lat).replace('.', ',') + ' / ' + String(w.lng).replace('.', ',') }) : DOLLY.badge('Non impostate', 'amber', 'triangle-alert'); } },
					{ label: 'Raggio', render: function (w) { return w.radius_m + ' m'; }, num: true },
					{ label: 'Tolleranza ritardo', render: function (w) { return w.late_tolerance === null || w.late_tolerance === undefined ? h('span', { class: 'dolly-muted', text: 'Predefinita (' + (CFG.lateTolerance || 0) + ' min)' }) : w.late_tolerance + ' min'; } },
					{ label: 'Account sede', render: function (w) { return w.account_username ? w.account_username : DOLLY.badge('Mancante', 'amber', 'triangle-alert'); } },
					{ label: 'Stato', render: function (w) { return w.active ? DOLLY.badge('Attiva', 'green', 'circle-check') : DOLLY.badge('Disattivata', 'neutral', 'ban'); } },
					{ label: '', srLabel: 'Azioni', render: function (w) { return h('div', { class: 'dolly-actions' }, DOLLY.button('Modifica', { size: 'sm', icon: 'pencil', ariaLabel: 'Modifica ' + w.name, onClick: function () { workplaceDialog(w, load); } })); } }
				], list, { empty: ['Nessuna sede', 'Crea la prima sede per assegnare i dipendenti.', 'map-pin'], caption: 'Sedi' }));
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function workplaceDialog(w, done) {
		var isNew = !w; w = w || { radius_m: CFG.defaultRadius || 100, active: true };
		var alertBox = h('div', { hidden: true });
		var num = function (v) { return v === null || v === undefined ? '' : String(v); };
		var f = {
			name: DOLLY.field({ label: 'Nome sede', name: 'name', value: w.name, required: true }),
			address: DOLLY.field({ label: 'Indirizzo', name: 'address', value: w.address }),
			city: DOLLY.field({ label: 'Città', name: 'city', value: w.city }),
			province: DOLLY.field({ label: 'Provincia', name: 'province', value: w.province, attrs: { maxlength: 4, autocapitalize: 'characters' } }),
			lat: DOLLY.field({ label: 'Latitudine', name: 'lat', value: num(w.lat), attrs: { inputmode: 'decimal', placeholder: 'es. 45,0703' } }),
			lng: DOLLY.field({ label: 'Longitudine', name: 'lng', value: num(w.lng), attrs: { inputmode: 'decimal', placeholder: 'es. 7,6869' } }),
			radius_m: DOLLY.field({ label: 'Raggio consentito (metri)', name: 'radius_m', type: 'number', value: w.radius_m, attrs: { min: 10, max: 5000, step: 1 } }),
			late_tolerance: DOLLY.field({ label: 'Tolleranza ritardo in entrata (minuti)', name: 'late_tolerance', type: 'number', value: num(w.late_tolerance), optional: true, help: 'Vuoto = valore predefinito delle Impostazioni (' + (CFG.lateTolerance || 0) + ' min). Un\'entrata entro la tolleranza conta come entrata regolare.', attrs: { min: 0, max: 120, step: 1, placeholder: String(CFG.lateTolerance || 0) } }),
			account_username: DOLLY.field({ label: 'Nome utente account sede', name: 'account_username', value: w.account_username, attrs: w.account_username ? { readonly: true } : { autocomplete: 'off', autocapitalize: 'none' }, help: w.account_username ? 'Non modificabile.' : 'Crea l\'account dedicato allo schermo della sede.' }),
			account_password: DOLLY.field({ label: w.account_username ? 'Nuova password account sede' : 'Password account sede', name: 'account_password', type: 'text', optional: !!w.account_username, help: 'Almeno 8 caratteri.', attrs: { autocomplete: 'new-password' } })
		};
		var active = DOLLY.switchControl({ label: 'Sede attiva', name: 'active', checked: w.active !== false });
		var locate = DOLLY.button('Usa la posizione attuale', { icon: 'locate-fixed', onClick: function () {
			if (!navigator.geolocation) { DOLLY.toast('Geolocalizzazione non supportata.', 'error'); return; }
			locate.classList.add('is-loading');
			navigator.geolocation.getCurrentPosition(function (p) {
				locate.classList.remove('is-loading');
				f.lat.input.value = p.coords.latitude.toFixed(7).replace('.', ',');
				f.lng.input.value = p.coords.longitude.toFixed(7).replace('.', ',');
				DOLLY.toast('Coordinate inserite (precisione ±' + Math.round(p.coords.accuracy) + ' m).', 'success');
			}, function (e) { locate.classList.remove('is-loading'); DOLLY.toast(e.code === 1 ? 'Accesso alla posizione negato.' : 'Posizione non disponibile.', 'error'); }, { enableHighAccuracy: true, timeout: 15000 });
		} });
		var form = h('form', { class: 'dolly-form', novalidate: true }, [
			alertBox,
			h('div', { class: 'dolly-form-grid' }, [f.name, f.address, f.city, f.province]),
			h('h3', {}, [DOLLY.icon('map'), ' Posizione GPS']),
			h('div', { class: 'dolly-form-grid dolly-form-grid--3' }, [f.lat, f.lng, f.radius_m]),
			h('div', { class: 'dolly-btn-row' }, locate),
			h('h3', {}, [DOLLY.icon('clock'), ' Timbrature']),
			h('div', { class: 'dolly-form-grid' }, [f.late_tolerance]),
			h('h3', {}, [DOLLY.icon('monitor'), ' Account dello schermo sede']),
			h('div', { class: 'dolly-form-grid' }, [f.account_username, f.account_password]),
			active
		]);
		DOLLY.dialog({
			title: isNew ? 'Nuova sede' : 'Modifica sede', body: form, wide: true,
			actions: [{ label: 'Annulla' }, { label: 'Salva sede', variant: 'primary', icon: 'save', onClick: function (close, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var body = {
					name: f.name.input.value, address: f.address.input.value, city: f.city.input.value, province: f.province.input.value,
					lat: f.lat.input.value.trim().replace(',', '.'), lng: f.lng.input.value.trim().replace(',', '.'),
					radius_m: f.radius_m.input.value, late_tolerance: f.late_tolerance.input.value.trim(), active: active.control.isOn(),
					account_password: f.account_password.input.value
				};
				if (!w.account_username) { body.account_username = f.account_username.input.value; }
				var p = isNew ? DOLLY.api('admin/workplaces', { method: 'POST', body: body }) : DOLLY.api('admin/workplaces/' + w.id, { method: 'PUT', body: body });
				DOLLY.busy(btn, p).then(function () { close(); DOLLY.toast('Sede salvata.', 'success'); done(); }, function (err) { DOLLY.formError(form, err, alertBox); });
			} }]
		});
	}

	/* ------------------------------------------------------------------ */
	/* Requests & sickness                                                  */
	/* ------------------------------------------------------------------ */

	function pageRequests() {
		var tab = window.location.hash === '#malattie' ? 'malattie' : 'richieste';
		var content = h('div');
		function renderTabs() {
			DOLLY.render(main, [
				DOLLY.tabs([{ id: 'richieste', label: 'Ferie, permessi, donazioni, straordinari e correzioni', icon: 'inbox' }, { id: 'malattie', label: 'Malattie, infortuni e certificati', icon: 'stethoscope' }], tab, function (t) { tab = t; window.location.hash = t === 'malattie' ? 'malattie' : ''; renderTabs(); }),
				content
			]);
			if (tab === 'richieste') { requestsTab(content); } else { sicknessTab(content); }
		}
		renderTabs();
	}

	function requestsTab(content) {
		var st = { page: 1, status: 'pending', type: '', workplace: '' };
		var status = DOLLY.field({ label: 'Stato', type: 'select', value: st.status, options: [{ value: '', label: 'Tutti' }, { value: 'pending', label: 'In attesa' }, { value: 'approved', label: 'Approvate' }, { value: 'rejected', label: 'Respinte' }, { value: 'cancelled', label: 'Annullate' }, { value: 'superseded', label: 'Sostituite' }] });
		var type = DOLLY.field({ label: 'Tipo', type: 'select', options: [{ value: '', label: 'Tutti' }].concat(Object.keys(TYPES).map(function (k) { return { value: k, label: TYPES[k] }; })) });
		var wp = DOLLY.field({ label: 'Sede', type: 'select', options: workplaceOptions('Tutte le sedi') });
		var box = h('div', {}, DOLLY.loading());
		[[status, 'status'], [type, 'type'], [wp, 'workplace']].forEach(function (x) { x[0].input.addEventListener('change', function () { st[x[1]] = x[0].input.value; st.page = 1; load(); }); });
		DOLLY.render(content, DOLLY.card(null, null, [
			h('div', { class: 'dolly-toolbar' }, [status, type, wp, h('div', { class: 'dolly-toolbar__spacer' }), DOLLY.button('Segnala infortunio', { icon: 'bandage', onClick: function () { authorizationDialog(load, { type: 'infortunio' }); } }), DOLLY.button('Nuova autorizzazione', { variant: 'primary', icon: 'calendar-plus', onClick: function () { authorizationDialog(load); } })]),
			box
		]));
		function load() {
			DOLLY.api('admin/requests', { query: { page: st.page, status: st.status, type: st.type, workplace: st.workplace } }).then(function (r) {
				DOLLY.render(box, [
					DOLLY.table([
						{ label: 'Dipendente', key: 'employee' },
						{ label: 'Richiesta', render: function (x) { return h('div', {}, [h('strong', { text: x.type_label }), x.source === 'auto' ? [' ', DOLLY.badge('Rilevato automaticamente', 'amber', 'alarm-clock-plus')] : null, h('div', { class: 'dolly-small', text: x.summary }), x.notes ? h('div', { class: 'dolly-small dolly-muted', text: 'Note: ' + x.notes }) : null, donationCertificate(x, load)]); } },
						{ label: 'Inviata', render: function (x) { return DOLLY.fmt.dateTime(x.created_at); } },
						{ label: 'Stato', render: function (x) { return h('div', {}, [DOLLY.requestBadge(x.status, x.status_label), x.decided_at ? h('div', { class: 'dolly-small dolly-muted', text: x.decided_by + ' · ' + DOLLY.fmt.dateTime(x.decided_at) + (x.decision_note ? ' · ' + x.decision_note : '') }) : null]); } },
						{ label: '', srLabel: 'Azioni', render: function (x) {
							if (x.status === 'pending') { return decisionButtons(x, load); }
							// Every approved request stays subject to verification: vacation, leave and donation can be revoked.
							var revocable = x.status === 'approved' && x.amend_action !== 'cancel' && ['ferie', 'permesso', 'donazione'].indexOf(x.type) !== -1;
							return revocable ? h('div', { class: 'dolly-actions' }, DOLLY.button('Revoca', { size: 'sm', icon: 'undo-2', ariaLabel: 'Revoca la richiesta di ' + x.employee, onClick: function () { revokeDialog(x, load); } })) : '';
						} }
					], r.items, { empty: ['Nessuna richiesta', 'Nessuna richiesta corrisponde ai filtri.', 'inbox'], caption: 'Richieste' }),
					DOLLY.pagination(r, function (p) { st.page = p; load(); }, 'richieste')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function employeeSelect(label, value) {
		var f = DOLLY.field({ label: label || 'Dipendente', name: 'user_id', type: 'select', value: value || '', options: [{ value: '', label: 'Caricamento…' }] });
		allEmployees().then(function (list) {
			DOLLY.clear(f.input);
			f.input.appendChild(h('option', { value: '', text: 'Seleziona…' }));
			list.forEach(function (e) { f.input.appendChild(h('option', { value: e.id, selected: String(e.id) === String(value) ? true : null, text: e.name + (e.active ? '' : ' (disattivato)') })); });
		});
		return f;
	}

	/**
	 * Administrators create authorisations already approved: vacation, hourly leave, extra work
	 * (before or after the working day), or register sickness / injury on behalf of the employee.
	 */
	var AUTH_TYPES = [
		{ value: 'ferie', label: 'Ferie' },
		{ value: 'permesso', label: 'Permesso orario' },
		{ value: 'straordinario', label: 'Straordinario' },
		{ value: 'donazione', label: 'Donazione sangue' },
		{ value: 'malattia', label: 'Malattia' },
		{ value: 'infortunio', label: 'Infortunio' }
	];

	function authorizationDialog(done, preset) {
		preset = preset || {};
		var alertBox = h('div', { hidden: true });
		var emp = employeeSelect(null, preset.user_id);
		var typeF = DOLLY.field({ label: 'Tipo', name: 'type', type: 'select', value: preset.type || 'ferie', options: AUTH_TYPES });
		var box = h('div', { class: 'dolly-form-grid dolly-field--full' });
		var info = h('div', { class: 'dolly-field--full' });
		var f = {};
		var note = DOLLY.field({ label: 'Nota per il dipendente', name: 'decision_note', type: 'textarea', optional: true, full: true });

		function build() {
			var t = typeF.input.value;
			f = {};
			var nodes = [];
			if (t === 'straordinario') {
				f.start_date = DOLLY.dateField({ label: 'Data', name: 'start_date', value: CFG.today, required: true });
				f.extra_kind = DOLLY.radios({ label: 'Tipo di giornata', name: 'extra_kind', value: 'working_day', full: true, options: [
					{ value: 'working_day', label: 'Giorno lavorativo', description: 'Autorizza lo straordinario fino all\'orario di uscita indicato.' },
					{ value: 'rest_day', label: 'Giorno di riposo', description: 'Autorizza la timbratura con inizio, fine ed eventuale pausa.' }
				], onChange: buildExtra });
				f._extraBox = h('div', { class: 'dolly-form-grid dolly-field--full' });
				nodes.push(f.start_date, f.extra_kind, f._extraBox);
			} else if (t === 'donazione') {
				f.start_date = DOLLY.dateField({ label: 'Giorno della donazione', name: 'start_date', value: CFG.today, required: true });
				nodes.push(f.start_date);
			} else {
				if (t === 'permesso') {
					// Kind of leave and justification code recorded in the hours history.
					f.leave_kind = DOLLY.field({ label: 'Tipo di permesso', name: 'leave_kind', type: 'select', value: 'retribuito', options: LEAVE_KINDS });
					f.hours_code = DOLLY.field({ label: 'Giustificativo (storico ore)', name: 'hours_code', type: 'select', options: leaveCodeOptions('retribuito') });
					f.leave_kind.input.addEventListener('change', function () {
						DOLLY.clear(f.hours_code.input);
						leaveCodeOptions(f.leave_kind.input.value).forEach(function (o) { f.hours_code.input.appendChild(h('option', { value: o.value, text: o.label })); });
					});
					nodes.push(f.leave_kind, f.hours_code);
				}
				f.start_date = DOLLY.dateField({ label: 'Dal', name: 'start_date', value: CFG.today, required: true });
				f.end_date = DOLLY.dateField({ label: 'Al', name: 'end_date', value: CFG.today, required: true });
				nodes.push(f.start_date, f.end_date);
				if (t === 'permesso') {
					f.start_time = DOLLY.timeField({ label: 'Dalle ore', name: 'start_time', required: true });
					f.end_time = DOLLY.timeField({ label: 'Alle ore', name: 'end_time', required: true });
					nodes.push(f.start_time, f.end_time);
				}
			}
			DOLLY.render(box, nodes);
			DOLLY.render(info, t === 'malattia' || t === 'infortunio'
				? DOLLY.alert((t === 'infortunio' ? 'Segnalazione dell\'infortunio per conto del dipendente (sul lavoro o nel tragitto casa-lavoro): ' : 'Segnalazione della malattia per conto del dipendente: ') + 'viene registrata subito e il dipendente riceve una notifica. Il certificato medico segue le regole delle Impostazioni: puoi caricarlo dalla scheda "Malattie, infortuni e certificati".', 'info')
				: DOLLY.alert('L\'autorizzazione è già approvata: compare subito nel calendario e nelle presenze del dipendente, che riceve una notifica.', 'info'));
			if (t === 'straordinario') { buildExtra(); }
		}
		function buildExtra() {
			var nodes = [];
			f.start_time = f.has_lunch = f.lunch_start = f.lunch_end = null;
			if (f.extra_kind.value() === 'rest_day') {
				f.start_time = DOLLY.timeField({ label: 'Inizio', name: 'start_time', required: true });
				f.end_time = DOLLY.timeField({ label: 'Fine', name: 'end_time', required: true });
				var lb = h('div', { class: 'dolly-form-grid dolly-field--full', hidden: true });
				f.lunch_start = DOLLY.timeField({ label: 'Inizio pausa', name: 'lunch_start' });
				f.lunch_end = DOLLY.timeField({ label: 'Fine pausa', name: 'lunch_end' });
				DOLLY.append(lb, [f.lunch_start, f.lunch_end]);
				f.has_lunch = DOLLY.switchControl({ label: 'Pausa pranzo', name: 'has_lunch', onChange: function (on) { lb.hidden = !on; } });
				nodes.push(f.start_time, f.end_time, h('div', { class: 'dolly-field--full' }, f.has_lunch), lb);
			} else {
				f.end_time = DOLLY.timeField({ label: 'Uscita autorizzata fino alle', name: 'end_time', required: true });
				nodes.push(f.end_time);
			}
			DOLLY.render(f._extraBox, nodes);
		}
		typeF.input.addEventListener('change', build);
		var form = h('form', { class: 'dolly-form', novalidate: true }, [alertBox, h('div', { class: 'dolly-form-grid' }, [emp, typeF, info, box, note])]);
		build();

		DOLLY.dialog({
			title: preset.type === 'infortunio' ? 'Segnala infortunio' : (preset.type === 'malattia' ? 'Registra malattia' : 'Nuova autorizzazione'), body: form, wide: true,
			actions: [{ label: 'Annulla' }, { label: 'Conferma', variant: 'primary', icon: 'check', onClick: function (close, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var t = typeF.input.value;
				var spec = {};
				['start_date', 'end_date'].forEach(function (k) { if (f[k]) { spec[k] = [f[k], 'date', true]; } });
				['start_time', 'end_time'].forEach(function (k) { if (f[k]) { spec[k] = [f[k], 'time', true]; } });
				var lunch = f.has_lunch && f.has_lunch.control.isOn();
				if (lunch) { spec.lunch_start = [f.lunch_start, 'time', true]; spec.lunch_end = [f.lunch_end, 'time', true]; }
				var rd = DOLLY.readDateTimes(spec);
				if (!emp.input.value) { rd.errors.user_id = 'Seleziona un dipendente.'; }
				if (Object.keys(rd.errors).length) { DOLLY.showErrors(form, rd.errors); return; }
				var body = Object.assign({ user_id: emp.input.value, type: t, decision_note: note.input.value, notes: note.input.value || 'Autorizzato dall\'amministratore.' }, rd.values);
				if (t === 'straordinario') { body.extra_kind = f.extra_kind.value(); body.has_lunch = !!lunch; body.end_date = body.start_date; }
				if (t === 'donazione') { body.end_date = body.start_date; }
				if (t === 'permesso') {
					body.leave_kind = f.leave_kind.input.value; body.hours_code = f.hours_code.input.value;
					// The note is the event of the leave: mandatory for leaves for specific events.
					if (body.leave_kind === 'evento' && !note.input.value.trim()) { DOLLY.showErrors(form, { decision_note: 'Indica l\'evento per cui viene concesso il permesso.' }); return; }
				}
				if (t === 'malattia' || t === 'infortunio') { body.notes = note.input.value; }
				var label = AUTH_TYPES.filter(function (x) { return x.value === t; })[0].label;
				DOLLY.busy(btn, DOLLY.api('admin/authorizations', { method: 'POST', body: body })).then(function () {
					close(); DOLLY.toast(label + (t === 'malattia' || t === 'infortunio' ? ': segnalazione registrata per il dipendente.' : ': autorizzazione registrata.'), 'success'); done();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			} }]
		});
	}

	function sicknessTab(content) {
		var st = { page: 1, kind: '', certificate_status: '', workplace: '' };
		var kind = DOLLY.field({ label: 'Tipo', type: 'select', options: [{ value: '', label: 'Tutti' }, { value: 'malattia', label: 'Malattia' }, { value: 'infortunio', label: 'Infortunio' }] });
		var cs = DOLLY.field({ label: 'Certificato', type: 'select', options: [{ value: '', label: 'Tutti' }, { value: 'missing', label: 'Mancante' }, { value: 'overdue', label: 'Scaduto' }, { value: 'uploaded', label: 'Caricato' }, { value: 'not_required', label: 'Non richiesto' }, { value: 'cleared', label: 'Requisito annullato' }] });
		var wp = DOLLY.field({ label: 'Sede', type: 'select', options: workplaceOptions('Tutte le sedi') });
		var box = h('div', {}, DOLLY.loading());
		kind.input.addEventListener('change', function () { st.kind = kind.input.value; st.page = 1; load(); });
		cs.input.addEventListener('change', function () { st.certificate_status = cs.input.value; st.page = 1; load(); });
		wp.input.addEventListener('change', function () { st.workplace = wp.input.value; st.page = 1; load(); });
		DOLLY.render(content, DOLLY.card(null, null, [h('div', { class: 'dolly-toolbar' }, [kind, cs, wp, h('div', { class: 'dolly-toolbar__spacer' }), DOLLY.button('Segnala infortunio', { icon: 'bandage', onClick: function () { authorizationDialog(load, { type: 'infortunio' }); } }), DOLLY.button('Registra malattia', { variant: 'primary', icon: 'stethoscope', onClick: function () { authorizationDialog(load, { type: 'malattia' }); } })]), box]));
		function load() {
			DOLLY.api('admin/sickness', { query: st }).then(function (r) {
				DOLLY.render(box, [
					DOLLY.table([
						{ label: 'Dipendente', key: 'employee' },
						{ label: 'Tipo', render: function (s) { return DOLLY.badge(s.kind_label || 'Malattia', 'red', s.kind === 'infortunio' ? 'bandage' : 'stethoscope'); } },
						{ label: 'Periodo', render: function (s) { return DOLLY.fmt.date(s.start_date) + ' – ' + DOLLY.fmt.date(s.end_date); } },
						{ label: 'Segnalata', render: function (s) { return DOLLY.fmt.dateTime(s.reported_at); } },
						{ label: 'Certificato', render: function (s) {
							return h('div', {}, [DOLLY.certBadge(s.certificate_status, s.certificate_label), s.certificate_due && (s.certificate_status === 'missing' || s.certificate_status === 'overdue') ? h('div', { class: 'dolly-small', text: 'Scadenza ' + DOLLY.fmt.date(s.certificate_due) }) : null,
								s.certificates.map(function (c) { return h('div', { class: 'dolly-small' }, h('a', { href: DOLLY.downloadUrl('certificates/' + c.id + '/download') }, [DOLLY.icon('download'), ' ' + c.original_name])); })]);
						} },
						{ label: 'Note', render: function (s) { return s.notes ? h('span', { class: 'dolly-small', text: s.notes }) : '—'; } },
						{ label: 'Conflitti', render: function (s) { return s.conflict ? h('div', {}, [DOLLY.badge(s.reviewed ? 'Verificato' : 'Da verificare', s.reviewed ? 'green' : 'amber', s.reviewed ? 'circle-check' : 'triangle-alert'), h('div', { class: 'dolly-small', style: 'white-space:pre-line', text: s.conflict_details })]) : '—'; } },
						{ label: '', srLabel: 'Azioni', render: function (s) { return sicknessActions(s, load); } }
					], r.items, { empty: ['Nessuna malattia o infortunio', '', 'stethoscope'], caption: 'Malattie e infortuni' }),
					DOLLY.pagination(r, function (p) { st.page = p; load(); }, 'malattie')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function sicknessActions(s, done) {
		var file = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png', class: 'dolly-sr-only', 'aria-label': 'File certificato per ' + s.employee });
		var up = DOLLY.button('Carica certificato', { size: 'sm', icon: 'file-up', onClick: function () { file.click(); } });
		file.addEventListener('change', function () {
			var fl = file.files[0]; if (!fl) { return; }
			if (fl.size > 10485760) { DOLLY.toast('Il file supera i 10 MB.', 'error'); return; }
			var fd = new FormData(); fd.append('file', fl);
			DOLLY.busy(up, DOLLY.api('admin/sickness/' + s.id + '/certificate', { method: 'POST', form: fd, timeout: 120000 })).then(function () { DOLLY.toast('Certificato caricato.', 'success'); done(); }, function (err) { DOLLY.toast(err.message, 'error'); });
		});
		var btns = [up, file];
		if (s.conflict && !s.reviewed) {
			btns.push(DOLLY.button('Segna come verificato', { size: 'sm', icon: 'shield-check', onClick: function () {
				var note = DOLLY.field({ label: 'Nota di verifica', name: 'note', type: 'textarea', required: true });
				var form = h('form', { class: 'dolly-form' }, [h('p', { style: 'white-space:pre-line', text: s.conflict_details }), note]);
				DOLLY.dialog({ title: 'Verifica conflitto', body: form, actions: [{ label: 'Annulla' }, { label: 'Conferma verifica', variant: 'primary', icon: 'check', onClick: function (close, btn) {
					DOLLY.busy(btn, DOLLY.api('admin/sickness/' + s.id + '/review', { method: 'POST', body: { note: note.input.value } })).then(function () { close(); DOLLY.toast('Conflitto verificato.', 'success'); done(); }, function (err) { DOLLY.formError(form, err); });
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
		if (r.ferie) { p.push('Ferie'); }
		if (r.donazione) { p.push('Donazione sangue'); }
		if (r.permesso) { p.push('Permesso ' + r.permesso); }
		if (r.malattia) { p.push(r.sick_label || 'Malattia'); }
		if (r.certificate_status === 'missing' || r.certificate_status === 'overdue') { p.push(r.certificate); }
		r.pending.forEach(function (x) { p.push('In attesa: ' + x); });
		return p.join(', ');
	}

	/* ------------------------------------------------------------------ */
	/* Attendance: by employee (month) and by date (all the employees)     */
	/* ------------------------------------------------------------------ */

	/** Columns shared by the two views, after the first one (date or employee). */
	function attendanceColumns(userOf, reload) {
		var today = DOLLY.fmt.today();
		return [
			{ label: 'Stato', render: function (r) { return h('div', {}, [DOLLY.dayStatusBadge(r.status), r.corrected ? h('div', {}, DOLLY.badge('Corretta', 'neutral', 'pencil')) : null]); } },
			{ label: 'Entrata', cls: 'time', render: function (r) { return DOLLY.countedTime(r.entrata, r.entrata_real, r.late_min); } },
			{ label: 'Inizio pausa', cls: 'time', render: function (r) { return r.inizio_pausa || (r.lunch_auto ? h('span', { class: 'dolly-small dolly-muted', text: 'automatica' }) : '—'); } },
			{ label: 'Fine pausa', key: 'fine_pausa', cls: 'time' },
			{ label: 'Uscita', cls: 'time', render: function (r) { return DOLLY.countedTime(r.uscita, r.uscita_real); } },
			{ label: 'Assenze', render: function (r) {
				var b = [];
				if (r.ferie) { b.push(DOLLY.badge('Ferie', 'blue', 'sun')); }
				if (r.donazione) { b.push(DOLLY.badge('Donazione sangue', 'blue', 'droplet')); }
				if (r.permesso) { b.push(DOLLY.badge('Permesso ' + r.permesso, 'blue', 'timer')); }
				if (r.malattia) { b.push(DOLLY.badge(r.sick_label || 'Malattia', 'red', r.status === 'infortunio' ? 'bandage' : 'stethoscope')); }
				if (r.certificate_status === 'missing' || r.certificate_status === 'overdue') { b.push(DOLLY.certBadge(r.certificate_status, r.certificate)); }
				r.pending.forEach(function (p) { b.push(DOLLY.badge('In attesa: ' + p, 'amber', 'hourglass')); });
				return b.length ? h('div', { class: 'dolly-btn-row' }, b) : '—';
			} },
			{ label: 'Ore', num: true, render: DOLLY.hoursCell },
			{ label: 'Straordinario', render: DOLLY.extraCell },
			{ label: 'Giustificativi', render: function (r) { return DOLLY.hoursCodes(r.hours); } },
			{ label: 'Anomalie', render: function (r) { return r.anomalies.length ? h('div', { class: 'dolly-btn-row' }, r.anomalies.map(function (a) { return DOLLY.badge(a, 'red', 'triangle-alert'); })) : '—'; } },
			{ label: '', srLabel: 'Azioni', render: function (r) {
				return r.date <= today ? DOLLY.button('Correggi', { size: 'sm', icon: 'pencil', ariaLabel: 'Correggi ' + (r.employee ? r.employee + ', ' : '') + r.date_label, onClick: function () { correctionDialog(userOf(r), r.date, reload); } }) : '';
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
				{ id: 'employee', label: 'Per dipendente', icon: 'user' },
				{ id: 'date', label: 'Per giorno', icon: 'calendar-search' }
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
		var emp = employeeSelect('Dipendente', st.user);
		var box = h('div', {}, DOLLY.empty('Seleziona un dipendente', 'Scegli il dipendente, il mese e l\'anno.', 'calendar-days'));
		emp.input.addEventListener('change', function () { st.user = emp.input.value; load(); });
		var my = monthYearFields(st, load);
		DOLLY.render(container, DOLLY.card(null, null, [h('div', { class: 'dolly-toolbar' }, [emp].concat(my)), box]));
		function load() {
			if (!st.user) { return; }
			DOLLY.render(box, DOLLY.loading());
			DOLLY.api('admin/attendance', { query: { user_id: st.user, year: st.year, month: st.month } }).then(function (d) {
				var today = DOLLY.fmt.today();
				var foot = h('tfoot', {}, h('tr', {}, [h('td', { colspan: 7, text: 'Totale ' + d.month_label + (d.provisional ? ' (provvisorio)' : '') }), h('td', { class: 'num', text: d.total }), h('td', { colspan: 4, text: DOLLY.monthTotals(d) })]));
				DOLLY.render(box, [
					h('h2', { text: d.employee.name + ' · ' + d.month_label }),
					DOLLY.table([
						{ label: 'Data', render: function (r) { return h('span', {}, [h('strong', { text: r.date_label }), h('br'), h('span', { class: 'dolly-small dolly-muted', text: r.weekday + (r.holiday ? ' · ' + r.holiday : '') + (r.closure ? ' · ' + r.closure + (r.closure_label && r.closure_label !== r.closure ? ' (' + r.closure_label.toLowerCase() + ')' : '') : '') + (r.schedule ? ' · ' + r.schedule : '') })]); } }
					].concat(attendanceColumns(function () { return st.user; }, load)), d.rows, { caption: 'Presenze ' + d.month_label, foot: foot, rowClass: function (r) { return (r.date === today ? 'is-today ' : '') + (r.status === 'riposo' ? 'is-weekend' : ''); } }),
					DOLLY.hoursSummary(d),
					h('p', { class: 'dolly-help', text: 'Le ore per giustificativo vengono salvate nello storico ore del database a ogni apertura o esportazione del mese, e dallo scheduler per i mesi modificati.' })
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		if (st.user) { load(); }
	}

	/** Groups of the "Stato" filter of the view by date. */
	var DATE_FILTERS = [
		{ value: '', label: 'Tutti', test: function () { return true; } },
		{ value: 'presenti', label: 'Presenti', test: function (r) { return !!r.entrata; } },
		{ value: 'assenti', label: 'Assenti non giustificati', test: function (r) { return r.status === 'assente'; } },
		{ value: 'ferie', label: 'Ferie e donazione sangue', test: function (r) { return r.status === 'ferie' || r.status === 'donazione'; } },
		{ value: 'permessi', label: 'Con permesso orario', test: function (r) { return !!r.permesso; } },
		{ value: 'malattia', label: 'Malattia e infortunio', test: function (r) { return r.status === 'malattia' || r.status === 'infortunio'; } },
		{ value: 'riposo', label: 'Riposo, festivo, chiusura', test: function (r) { return ['riposo', 'festivo', 'chiusura', 'chiusura_festiva', 'nessun_turno', 'previsto'].indexOf(r.status) !== -1 && !r.entrata; } },
		{ value: 'ritardi', label: 'In ritardo', test: function (r) { return r.late_min > 0; } },
		{ value: 'anomalie', label: 'Con anomalie', test: function (r) { return r.anomalies.length > 0; } }
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
		var dateF = DOLLY.dateField({ label: 'Data', value: st.date, help: 'GG/MM/AAAA · fino a oggi' });
		var prevBtn = DOLLY.button('Giorno precedente', { icon: 'chevron-left', iconOnly: true, onClick: function () { setDate(addDays(st.date, -1)); } });
		var nextBtn = DOLLY.button('Giorno successivo', { icon: 'chevron-right', iconOnly: true, onClick: function () { setDate(addDays(st.date, 1)); } });
		var todayBtn = DOLLY.button('Oggi', { icon: 'calendar-check', onClick: function () { setDate(today); } });
		var wpF = DOLLY.field({ label: 'Sede', type: 'select', value: st.workplace, options: workplaceOptions('Tutte le sedi') });
		var filterF = DOLLY.field({ label: 'Mostra', type: 'select', value: '', options: DATE_FILTERS.map(function (f) { return { value: f.value, label: f.label }; }) });
		var searchF = DOLLY.field({ label: 'Cerca dipendente', type: 'search', attrs: { placeholder: 'Nome o cognome', autocomplete: 'off' } });
		var csvBtn = DOLLY.button('Esporta CSV', { icon: 'file-spreadsheet', disabled: true });
		var title = h('div', { class: 'dolly-att-date__title' });
		var summary = h('div', { class: 'dolly-att-date__summary', 'aria-live': 'polite' });
		var box = h('div', {}, DOLLY.loading());
		var data = null, seq = 0;

		dateF.input.addEventListener('change', function () {
			var v = dateF.iso();
			if (!v) { return; }
			if (v > today) { DOLLY.toast('Puoi scegliere una data fino a oggi.', 'error'); dateF.setIso(st.date); return; }
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
			DOLLY.render(box, DOLLY.loading('Caricamento delle presenze di tutti i dipendenti…'));
			DOLLY.api('admin/attendance/date', { query: { date: st.date, workplace: st.workplace } }).then(function (d) {
				if (my !== seq) { return; }
				data = d;
				csvBtn.disabled = !d.rows.length;
				DOLLY.render(title, [h('h2', { text: capitalize(DOLLY.fmt.longDate(d.date)) }), d.holiday ? DOLLY.badge(d.holiday, 'neutral', 'party-popper') : null, d.is_today ? DOLLY.badge('Oggi: dati in tempo reale', 'blue', 'clock') : null]);
				renderSummary();
				renderRows();
			}, function (err) { if (my === seq) { DOLLY.render(box, DOLLY.errorState(err, load)); } });
		}
		function count(fn) { return data.rows.filter(fn).length; }
		function renderSummary() {
			var chips = [
				['presenti', 'Presenti', 'green', 'user-check'],
				['assenti', 'Assenti non giustificati', 'red', 'user-x'],
				['ferie', 'Ferie', 'blue', 'sun'],
				['permessi', 'Permessi orari', 'blue', 'timer'],
				['malattia', 'Malattia/infortunio', 'red', 'stethoscope'],
				['riposo', 'Riposo/festivo', 'neutral', 'moon'],
				['ritardi', 'In ritardo', 'amber', 'clock-alert'],
				['anomalie', 'Con anomalie', 'red', 'triangle-alert']
			];
			DOLLY.render(summary, [
				h('span', { class: 'dolly-small dolly-muted', text: data.rows.length + ' dipendenti · ore lavorate ' + data.total_worked + (data.total_extra !== '0:00' ? ' · straordinario ' + data.total_extra : '') }),
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
				h('td', { colspan: 7, text: 'Totale ' + data.date_label + (rows.length !== data.rows.length ? ' (' + rows.length + ' dipendenti mostrati)' : '') }),
				h('td', { class: 'num', text: hm(worked) }),
				h('td', { colspan: 4, text: extra ? 'Straordinario: ' + hm(extra) : '' })
			])) : null;
			DOLLY.render(box, h('div', { class: 'dolly-att-date__table' }, DOLLY.table([
				{ label: 'Dipendente', render: function (r) {
					var link = h('a', { href: CFG.pages.attendance + '&user_id=' + r.user_id + '&month=' + r.date.slice(0, 7), title: 'Apri il mese di ' + r.employee, text: r.employee });
					link.addEventListener('click', function (e) { e.preventDefault(); openEmployee(r.user_id, r.date); });
					return h('span', {}, [
						h('strong', {}, link), r.active ? null : h('span', { class: 'dolly-att-date__off' }, DOLLY.badge('Disattivato', 'neutral')), h('br'),
						h('span', { class: 'dolly-small dolly-muted', text: [r.contract, r.schedule, r.workplaces].filter(Boolean).join(' · ') })
					]);
				} }
			].concat(attendanceColumns(function (r) { return r.user_id; }, load)), rows, {
				caption: 'Presenze di tutti i dipendenti del ' + data.date_label,
				foot: foot,
				empty: data.rows.length ? ['Nessun dipendente corrisponde ai filtri', 'Cambia il filtro o la ricerca.', 'search'] : ['Nessun dipendente', 'Non ci sono dipendenti per questa data e sede.', 'users'],
				rowClass: function (r) { return r.status === 'riposo' || r.status === 'festivo' ? 'is-weekend' : ''; }
			})));
		}
		function exportCsv() {
			if (!data) { return; }
			var rows = visibleRows().map(function (r) {
				return [
					r.employee, r.contract, r.workplaces, DOLLY.dayStatusBadge(r.status).textContent, r.entrata, r.late_min ? r.late_min : '',
					r.inizio_pausa, r.fine_pausa, r.uscita, absenceText(r), r.worked,
					[r.extra, r.extra_over ? r.extra_over + (r.extra_over_status === 'pending' ? ' da approvare' : ' non approvato') : ''].filter(Boolean).join(' + '),
					(r.hours || []).map(function (c) { return c.code + ' ' + c.hm; }).join(', '),
					r.anomalies.join(', ')
				];
			});
			downloadCsv('Presenze_' + data.date.split('-').reverse().join('-') + '.csv',
				['Dipendente', 'Contratto', 'Sede', 'Stato', 'Entrata', 'Ritardo (min)', 'Inizio pausa', 'Fine pausa', 'Uscita', 'Assenze', 'Ore', 'Straordinario', 'Giustificativi', 'Anomalie'], rows);
		}
		load();
	}

	function correctionDialog(userId, date, done) {
		var body = h('div', {}, DOLLY.loading());
		DOLLY.dialog({ title: 'Correzione del ' + DOLLY.fmt.date(date), body: body, wide: true });
		DOLLY.api('admin/attendance/day', { query: { user_id: userId, date: date } }).then(function (d) {
			var alertBox = h('div', { hidden: true });
			var action = DOLLY.field({ label: 'Timbratura', name: 'action', type: 'select', value: d.punches.uscita ? 'entrata' : (d.punches.entrata ? 'uscita' : 'entrata'), options: Object.keys(ACTIONS).map(function (k) { return { value: k, label: ACTIONS[k] + (d.punches[k] ? ' (attuale ' + d.punches[k].time + ')' : ' (mancante)') }; }) });
			var time = DOLLY.timeField({ label: 'Orario corretto', name: 'time', help: 'HH:MM. Lascia vuoto e usa "Annulla timbratura" per rimuoverla.' });
			var wp = DOLLY.field({ label: 'Sede', name: 'workplace_id', type: 'select', options: [{ value: '', label: 'Come timbratura esistente' }].concat(d.workplaces.map(function (w) { return { value: w.id, label: w.name }; })) });
			var reason = DOLLY.field({ label: 'Motivo (obbligatorio)', name: 'reason', type: 'textarea', required: true });
			function fillTime() { var p = d.punches[action.input.value]; time.input.value = p ? p.time : ''; }
			action.input.addEventListener('change', fillTime); fillTime();
			var form = h('form', { class: 'dolly-form', novalidate: true }, [
				alertBox,
				DOLLY.table([{ label: 'Timbratura', render: function (k) { return ACTIONS[k]; } }, { label: 'Orario', render: function (k) { return d.punches[k] ? d.punches[k].time : '—'; } }, { label: 'Sede', render: function (k) { return d.punches[k] ? d.punches[k].workplace : '—'; } }, { label: 'Metodo', render: function (k) { return d.punches[k] ? d.punches[k].method_label : '—'; } }], Object.keys(ACTIONS), { stack: false, caption: 'Timbrature attuali' }),
				h('div', { class: 'dolly-form-grid' }, [action, time, wp, reason]),
				DOLLY.alert('Le correzioni conservano i valori precedenti nel registro modifiche. Non sono ammessi orari futuri.', 'info')
			]);
			function send(remove, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var t = remove ? '' : time.hm();
				if (!remove && !t) { DOLLY.showErrors(form, { time: 'Orario non valido (HH:MM).' }); return; }
				if (!reason.input.value.trim()) { DOLLY.showErrors(form, { reason: 'Indica il motivo.' }); return; }
				DOLLY.busy(btn, DOLLY.api('admin/attendance/correct', { method: 'POST', body: { user_id: userId, date: date, action: action.input.value, time: t, reason: reason.input.value, workplace_id: wp.input.value } })).then(function () {
					DOLLY.toast(remove ? 'Timbratura annullata.' : 'Timbratura salvata.', 'success');
					var dlgClose = body.closest('.dolly-dialog-backdrop'); if (dlgClose) { dlgClose.querySelector('.dolly-dialog__head button').click(); }
					done();
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			}
			var saveBtn = DOLLY.button('Salva correzione', { variant: 'primary', icon: 'save' });
			var rmBtn = DOLLY.button('Annulla timbratura', { variant: 'danger', icon: 'trash-2' });
			saveBtn.addEventListener('click', function () { send(false, saveBtn); });
			rmBtn.addEventListener('click', function () { DOLLY.confirm('Annullare la timbratura?', 'La timbratura resterà nello storico come annullata.', 'Annulla timbratura', 'danger').then(function (ok) { if (ok) { send(true, rmBtn); } }); });
			DOLLY.render(body, [form, h('div', { class: 'dolly-btn-row dolly-btn-row--end', style: 'margin-top:16px' }, [rmBtn, saveBtn])]);
		}, function (err) { DOLLY.render(body, DOLLY.errorState(err)); });
	}

	/* ------------------------------------------------------------------ */
	/* Anomalies                                                            */
	/* ------------------------------------------------------------------ */

	function pageAnomalies() {
		var st = { page: 1, status: 'open', type: '', workplace: '' };
		var status = DOLLY.field({ label: 'Stato', type: 'select', value: 'open', options: [{ value: 'open', label: 'Non risolte' }, { value: 'resolved', label: 'Risolte' }, { value: '', label: 'Tutte' }] });
		var type = DOLLY.field({ label: 'Tipo', type: 'select', options: [{ value: '', label: 'Tutti' }, { value: 'unjustified_absence', label: 'Assente non giustificato' }, { value: 'missing_exit', label: 'Uscita mancante' }, { value: 'late_exit', label: 'Uscita oltre l\'orario (versioni precedenti)' }, { value: 'missing_certificate', label: 'Certificato mancante' }, { value: 'sickness_conflict', label: 'Malattia/infortunio in conflitto' }] });
		var wp = DOLLY.field({ label: 'Sede', type: 'select', options: workplaceOptions('Tutte le sedi') });
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
				h('p', { class: 'dolly-muted', style: 'margin:0', text: 'Messaggi a tutti i dipendenti o a dipendenti scelti, subito o in una data programmata, via email e/o notifica nell\'app (anche push sui telefoni).' }),
				h('div', { class: 'dolly-toolbar__spacer' }),
				DOLLY.button('Nuovo broadcast', { variant: 'primary', icon: 'megaphone', onClick: function () { broadcastDialog(load); } })
			]),
			box
		]));
		function load() {
			DOLLY.api('admin/broadcasts', { query: { page: page } }).then(function (r) {
				var tones = { scheduled: ['amber', 'calendar-clock'], sending: ['blue', 'send'], sent: ['green', 'circle-check'], cancelled: ['neutral', 'ban'] };
				DOLLY.render(box, [
					DOLLY.table([
						{ label: 'Invio', render: function (b) { return h('div', { class: 'dolly-small' }, [DOLLY.fmt.dateTime(b.sent_at || b.send_at), b.source === 'closure' ? h('div', { class: 'dolly-muted', text: 'Da chiusura collettiva' }) : null]); } },
						{ label: 'Messaggio', render: function (b) { return h('div', {}, [h('strong', { text: b.title }), h('div', { class: 'dolly-small', style: 'white-space:pre-line', text: b.message.length > 220 ? b.message.slice(0, 220) + '…' : b.message })]); } },
						{ label: 'Destinatari', render: function (b) { return h('span', { class: 'dolly-small', text: b.recipients_label + (b.status === 'sent' ? ' · consegnato a ' + b.recipient_count : '') }); } },
						{ label: 'Canali', render: function (b) { return h('div', { class: 'dolly-btn-row' }, [b.email ? DOLLY.badge('Email', 'neutral', 'mail') : null, b.portal ? DOLLY.badge('App', 'neutral', 'bell') : null, b.popup ? DOLLY.badge('Pop-up all\'apertura', 'blue', 'megaphone') : null]); } },
						{ label: 'Stato', render: function (b) { var t = tones[b.status] || ['neutral', 'info']; return DOLLY.badge(b.status_label, t[0], t[1]); } },
						{ label: '', srLabel: 'Azioni', render: function (b) {
							return b.status === 'scheduled' ? DOLLY.button('Annulla invio', { size: 'sm', icon: 'ban', onClick: function (ev) {
								var btn = ev.currentTarget;
								DOLLY.confirm('Annullare il messaggio programmato?', 'Il messaggio non verrà inviato.', 'Annulla invio', 'danger').then(function (ok) {
									if (ok) { DOLLY.busy(btn, DOLLY.api('admin/broadcasts/' + b.id, { method: 'DELETE' })).then(function () { DOLLY.toast('Invio annullato.', 'success'); load(); }, function (err) { DOLLY.toast(err.message, 'error'); }); }
								});
							} }) : '';
						} }
					], r.items, { empty: ['Nessun broadcast', 'Crea il primo messaggio con "Nuovo broadcast".', 'megaphone'], caption: 'Broadcast' }),
					DOLLY.pagination(r, function (p) { page = p; load(); }, 'broadcast')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function broadcastDialog(done) {
		var alertBox = h('div', { hidden: true });
		var title = DOLLY.field({ label: 'Oggetto', name: 'title', optional: true, full: true, help: 'Titolo della notifica e oggetto dell\'email.' });
		var message = DOLLY.field({ label: 'Messaggio', name: 'message', type: 'textarea', rows: 5, required: true, full: true });
		var who = DOLLY.radios({ label: 'Destinatari', name: 'who', value: 'all', full: true, options: [
			{ value: 'all', label: 'Tutti i dipendenti attivi' },
			{ value: 'some', label: 'Dipendenti selezionati' }
		], onChange: function (v) { pickBox.hidden = v !== 'some'; } });
		var chips = null;
		var pickBox = h('div', { class: 'dolly-field--full', hidden: true }, DOLLY.loading());
		allEmployees(true).then(function (list) {
			chips = DOLLY.chips({ label: 'Dipendenti', name: 'recipients', full: true, options: list.filter(function (e) { return e.active; }).map(function (e) { return { value: e.id, label: e.name }; }) });
			var search = DOLLY.field({ label: 'Filtra l\'elenco', type: 'search', attrs: { placeholder: 'Cognome o nome' } });
			search.input.addEventListener('input', function () {
				var q = search.input.value.trim().toLowerCase();
				Array.prototype.forEach.call(chips.querySelectorAll('.dolly-chip'), function (c) { c.hidden = q && c.textContent.toLowerCase().indexOf(q) === -1; });
			});
			DOLLY.render(pickBox, [search, chips]);
		}, function (err) { DOLLY.render(pickBox, DOLLY.errorState(err)); });
		var sendDate = DOLLY.dateField({ label: 'Data di invio', name: 'send_date', value: CFG.today });
		var sendTime = DOLLY.timeField({ label: 'Ora di invio', name: 'send_time', value: '08:00' });
		var whenBox = h('div', { class: 'dolly-form-grid dolly-field--full', hidden: true }, [sendDate, sendTime]);
		var now = DOLLY.switchControl({ label: 'Invia ora', name: 'send_now', checked: true, description: 'Disattiva per programmare data e ora di invio.', onChange: function (on) { whenBox.hidden = on; } });
		var chEmail = DOLLY.switchControl({ label: 'Email', name: 'email', checked: true });
		var chPortal = DOLLY.switchControl({ label: 'Notifica nell\'app', name: 'portal', checked: true, description: 'Visibile in Notifiche; arriva come notifica push sui telefoni che l\'hanno attivata.' });
		var chPopup = DOLLY.switchControl({ label: 'Mostra subito all\'apertura dell\'app', name: 'popup', checked: false, description: 'Il messaggio compare in un pop-up appena il dipendente entra nel portale (finché non lo legge), oltre che in Notifiche.', onChange: function (on) { if (on) { chPortal.control.setOn(true); } } });
		var channels = h('div', { class: 'dolly-field dolly-field--full', dataset: { name: 'channels' } }, [h('span', { class: 'dolly-label', text: 'Modalità di invio' }), h('div', { class: 'dolly-form-grid' }, [chEmail, chPortal, chPopup]), h('span', { class: 'dolly-error', hidden: true })]);
		var form = h('form', { class: 'dolly-form', novalidate: true }, [alertBox, h('div', { class: 'dolly-form-grid' }, [title, message, who, pickBox, h('div', { class: 'dolly-field--full' }, now), whenBox, channels])]);
		DOLLY.dialog({
			title: 'Nuovo broadcast', body: form, wide: true,
			actions: [{ label: 'Annulla' }, { label: 'Invia', variant: 'primary', icon: 'send', onClick: function (close, btn) {
				DOLLY.clearErrors(form); alertBox.hidden = true;
				var errors = {};
				var body = { title: title.input.value, message: message.input.value, all: who.value() === 'all', email: chEmail.control.isOn(), portal: chPortal.control.isOn() || chPopup.control.isOn(), popup: chPopup.control.isOn(), send_now: now.control.isOn() };
				if (!body.message.trim()) { errors.message = 'Scrivi il messaggio.'; }
				if (!body.email && !body.portal) { errors.channels = 'Scegli almeno un canale: email e/o notifica nell\'app.'; }
				if (!body.all) {
					body.recipients = chips ? chips.values().map(Number) : [];
					if (!body.recipients.length) { errors.recipients = 'Seleziona almeno un dipendente.'; }
				}
				if (!body.send_now) {
					var rd = DOLLY.readDateTimes({ send_date: [sendDate, 'date', true], send_time: [sendTime, 'time', true] });
					Object.assign(errors, rd.errors);
					body.send_date = rd.values.send_date; body.send_time = rd.values.send_time;
				}
				if (Object.keys(errors).length) { DOLLY.showErrors(form, errors); return; }
				DOLLY.busy(btn, DOLLY.api('admin/broadcasts', { method: 'POST', body: body })).then(function (b) {
					close();
					DOLLY.toast(b.status === 'sent' ? 'Messaggio inviato a ' + b.recipient_count + ' dipendent' + (b.recipient_count === 1 ? 'e' : 'i') + '.' : 'Messaggio programmato per il ' + DOLLY.fmt.dateTime(b.send_at) + '.', 'success');
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
		var allSw = DOLLY.switchControl({ label: 'Seleziona tutti i dipendenti attivi', name: 'all', checked: true, onChange: function (on) { if (chips) { chips.setAll(on); } } });
		var btn = DOLLY.button('Scarica ZIP presenze', { variant: 'primary', icon: 'file-archive' });
		var err = h('div', { 'aria-live': 'polite' });
		btn.addEventListener('click', function () {
			var ids = chips ? chips.values() : [];
			if (!ids.length) { DOLLY.render(err, DOLLY.alert('Seleziona almeno un dipendente.', 'error')); return; }
			DOLLY.clear(err);
			window.location.href = DOLLY.downloadUrl('admin/export/attendance', { year: st.year, month: st.month, users: ids.join(',') });
		});
		// Hours history: one line per employee with the hours of every justification code.
		var hoursBtn = DOLLY.button('Scarica riepilogo ore (CSV)', { icon: 'file-spreadsheet' });
		hoursBtn.addEventListener('click', function () {
			var ids = chips ? chips.values() : [];
			if (!ids.length) { DOLLY.render(err, DOLLY.alert('Seleziona almeno un dipendente.', 'error')); return; }
			DOLLY.clear(err);
			window.location.href = DOLLY.downloadUrl('admin/export/hours', { year: st.year, month: st.month, users: ids.join(',') });
		});
		allEmployees(true).then(function (list) {
			chips = DOLLY.chips({ label: 'Dipendenti', name: 'users', selected: list.filter(function (e) { return e.active; }).map(function (e) { return e.id; }), options: list.map(function (e) { return { value: e.id, label: e.name + (e.active ? '' : ' (disattivato)') }; }) });
			DOLLY.render(chipsBox, chips);
		}, function (e) { DOLLY.render(chipsBox, DOLLY.errorState(e)); });
		// Monthly attendance sheet (Excel): one file with all the employees, whatever the workplace.
		var sheetSt = nowYM();
		var sheetErr = h('div', { 'aria-live': 'polite' });
		var sheetBtn = DOLLY.button('Scarica foglio presenze (Excel)', { variant: 'primary', icon: 'file-spreadsheet' });
		sheetBtn.addEventListener('click', function () {
			DOLLY.clear(sheetErr);
			var url = DOLLY.downloadUrl('admin/export/timesheet', { year: sheetSt.year, month: sheetSt.month });
			// Downloaded in the background: an error is shown here instead of a blank page.
			var p = window.fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
				if (!res.ok) {
					return res.text().then(function (t) {
						var msg = 'Esportazione non riuscita (errore ' + res.status + ').';
						try { msg = JSON.parse(t).message || msg; } catch (e) { /* not JSON */ }
						throw new Error(msg);
					});
				}
				var cd = res.headers.get('Content-Disposition') || '';
				var m = /filename="?([^";]+)"?/.exec(cd);
				var name = m ? m[1] : 'Foglio_presenze_' + DOLLY.MONTHS[sheetSt.month - 1] + '_' + sheetSt.year + '.xlsx';
				return res.blob().then(function (blob) {
					var a = h('a', { href: window.URL.createObjectURL(blob), download: name, style: 'display:none' });
					document.body.appendChild(a);
					a.click();
					setTimeout(function () { window.URL.revokeObjectURL(a.href); a.remove(); }, 2000);
					DOLLY.toast('Foglio presenze scaricato.', 'success');
				});
			});
			DOLLY.busy(sheetBtn, p).then(null, function (e) { DOLLY.render(sheetErr, DOLLY.alert(e.message, 'error')); });
		});

		DOLLY.render(main, h('div', { class: 'dolly-stack' }, [
			DOLLY.card('Foglio presenze mensile (Excel)', 'file-spreadsheet', [
				h('p', { text: 'File Excel (.xlsx) del mese con tutti i dipendenti dell\'azienda in un unico foglio (la sede non è indicata), nel formato del foglio presenze aziendale: per ogni dipendente le righe «ore lavoro effettive», «giustificativi» e «ore per giustificativi», con sabati, domeniche e festività colorati.' }),
				h('div', { class: 'dolly-toolbar' }, monthYearFields(sheetSt, function () {})),
				sheetErr,
				h('div', { class: 'dolly-btn-row', style: 'margin-top:16px' }, sheetBtn),
				h('p', { class: 'dolly-help', text: 'Accanto al nome è indicato il contratto, es. MARIO ROSSI (Tempo pieno - 40 ore settimanali). Legenda: FS = Festivo · FER = Sabato · O = Ordinario · S = Straordinario · FE ferie · P/ROL/EO/Pn/PL permessi · M malattia · I infortunio · Av donazione sangue · A assenza non retribuita.' })
			]),
			DOLLY.card('Anagrafica dipendenti (CSV)', 'users', [
				h('p', { text: 'Nome utente, nominativo, contatti, stato, contratto, orario e sedi. Non include password, certificati né note mediche.' }),
				DOLLY.button('Scarica CSV dipendenti', { href: DOLLY.downloadUrl('admin/export/employees'), variant: 'primary', icon: 'file-spreadsheet' })
			]),
			DOLLY.card('Presenze mensili (ZIP)', 'file-archive', [
				h('p', { text: 'Un file CSV per dipendente con ogni giorno del mese (es. Mario_Rossi_Settembre_2026.csv). CSV UTF-8 con separatore punto e virgola, adatto a Excel in italiano. Certificati e note mediche sono esclusi.' }),
				h('div', { class: 'dolly-toolbar' }, monthYearFields(st, function () {})),
				allSw, chipsBox, err,
				h('div', { class: 'dolly-btn-row', style: 'margin-top:16px' }, [btn, hoursBtn]),
				h('p', { class: 'dolly-help', text: 'Riepilogo ore: una riga per dipendente con le ore previste e le ore di ogni giustificativo (O ordinario, FER sabato, S straordinario, FS festivo, FE ferie, P/ROL/EO/Pn/PL permessi, M malattia, I infortunio, Av donazione sangue, A assenza non retribuita), lette dallo storico ore.' })
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
		var vm = DOLLY.radios({ label: 'Modalità di verifica della timbratura', name: 'verification_mode', value: s.verification_mode, options: Object.keys(d.verification_modes).map(function (k) { return { value: k, label: d.verification_modes[k] + (k === 'either' ? ' (predefinita)' : '') }; }) });
		var radius = DOLLY.field({ label: 'Raggio GPS predefinito per le nuove sedi (metri)', name: 'default_radius', type: 'number', value: s.default_radius, attrs: { min: 10, max: 5000 } });
		var cm = DOLLY.radios({ label: 'Certificato medico', name: 'certificate_mode', value: s.certificate_mode, options: Object.keys(d.certificate_modes).map(function (k) { return { value: k, label: d.certificate_modes[k] + (k === 'required' ? ' (predefinito)' : ''), description: k === 'disabled' ? 'Disattivando, i requisiti in sospeso vengono annullati con registrazione nel registro.' : null }; }) });
		var cdays = DOLLY.field({ label: 'Giorni di calendario per il certificato', name: 'certificate_days', type: 'number', value: s.certificate_days, attrs: { min: 1, max: 365 }, help: 'Usato solo con la scadenza attiva.' });
		// Attendance rules.
		var lunchPunch = DOLLY.switchControl({ label: 'Timbratura della pausa pranzo', name: 'lunch_punch', checked: s.lunch_punch, description: 'Attiva: i dipendenti timbrano inizio e fine pausa. Disattivata: non timbrano la pausa e la pausa prevista dall\'orario viene sottratta in automatico.' });
		var lateTol = DOLLY.field({ label: 'Tolleranza ritardo in entrata (minuti)', name: 'late_tolerance', type: 'number', value: s.late_tolerance, attrs: { min: 0, max: 120 }, help: 'Un\'entrata entro questi minuti dall\'inizio turno conta come entrata regolare (es. 3: turno alle 08:00, entrata alle 08:03 → 08:00). Valore predefinito per tutte le sedi: ogni sede può avere la sua tolleranza in Sedi › Modifica.' });
		var stepBox = h('div', { class: 'dolly-form-grid', hidden: !s.exit_rounding });
		var step = DOLLY.field({ label: 'Intervallo di arrotondamento (minuti)', name: 'rounding_step', type: 'number', value: s.rounding_step, attrs: { min: 1, max: 60 }, help: 'Arrotonda al multiplo più vicino dopo la fine turno.' });
		var roundExample = h('p', { class: 'dolly-help' });
		function updateExample() {
			var st = Math.max(1, Math.min(60, parseInt(step.input.value, 10) || 15));
			var half = Math.floor((st - 1) / 2);
			var end = 16 * 60 + 30;
			var t = function (m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };
			roundExample.textContent = 'Esempio con fine turno alle 16:30: uscita fino alle ' + t(end + half) + ' → 16:30; dalle ' + t(end + half + 1) + ' alle ' + t(end + st + half) + ' → ' + t(end + st) + '.';
		}
		step.input.addEventListener('input', updateExample);
		updateExample();
		DOLLY.append(stepBox, [step, h('div', { class: 'dolly-field--full' }, roundExample)]);
		var rounding = DOLLY.switchControl({ label: 'Arrotondamento dell\'uscita', name: 'exit_rounding', checked: s.exit_rounding, description: 'Nel modulo presenze l\'uscita dopo la fine turno viene arrotondata; la timbratura reale resta registrata.', onChange: function (on) { stepBox.hidden = !on; } });
		var holidayIncrease = DOLLY.field({ label: 'Maggiorazione lavoro festivo (%)', name: 'holiday_increase', type: 'number', value: s.holiday_increase, attrs: { min: 0, max: 300 }, help: 'Applicata alle ore lavorate nelle chiusure per festività e nelle festività nazionali; indicata nel modulo presenze e nell\'esportazione.' });
		var overtime = DOLLY.field({ label: 'Straordinario approvato automaticamente (minuti al giorno)', name: 'overtime_auto', type: 'number', value: s.overtime_auto, attrs: { min: 0, max: 1440 }, help: 'Il tempo dopo la fine turno è straordinario. Fino a questo limite è approvato automaticamente (120 = 2 ore); oltre, viene creata una richiesta da approvare in Richieste.' });
		// Employee portal.
		var requireInstall = DOLLY.switchControl({ label: 'Installazione dell\'app obbligatoria sui telefoni', name: 'require_install', checked: s.require_install !== false, description: 'Sui telefoni, prima dell\'accesso, il dipendente vede la procedura per aggiungere il portale alla schermata Home e può accedere solo dall\'app installata. Al primo accesso parte il tutorial guidato.' });
		// On-call contracts.
		var ocBox = h('div', { class: 'dolly-form-grid', hidden: !s.oncall_auto });
		var ocThreshold = DOLLY.field({ label: 'Soglia di approvazione automatica (minuti)', name: 'oncall_threshold', type: 'number', value: s.oncall_threshold, attrs: { min: 1, max: 1440 }, help: 'Un turno lungo fino a questa soglia è approvato automaticamente (120 = 2 ore); i turni più lunghi vanno approvati in Richieste.' });
		DOLLY.append(ocBox, ocThreshold);
		var ocAuto = DOLLY.switchControl({ label: 'Approvazione automatica dei turni brevi', name: 'oncall_auto', checked: s.oncall_auto, description: 'Disattivata: l\'amministratore approva manualmente tutte le ore dei contratti a chiamata.', onChange: function (on) { ocBox.hidden = !on; } });
		// Anomalies.
		var absDelayBox = h('div', { class: 'dolly-form-grid', hidden: !s.absence_check });
		var absDelay = DOLLY.field({ label: 'Minuti dopo l\'inizio turno', name: 'absence_delay', type: 'number', value: s.absence_delay, attrs: { min: 0, max: 720 }, help: 'Senza entrata dopo questo tempo il dipendente risulta "Assente non giustificato".' });
		DOLLY.append(absDelayBox, absDelay);
		var absCheck = DOLLY.switchControl({ label: 'Segnala le assenze non giustificate', name: 'absence_check', checked: s.absence_check, description: 'Esclusi giorni di riposo, festività, ferie, permessi e malattia/infortunio. Il dipendente riceve una notifica e può chiedere la correzione della timbratura.', onChange: function (on) { absDelayBox.hidden = !on; } });
		// Blood donation certificate (same modes as the medical one).
		var dcm = DOLLY.radios({ label: 'Certificato di donazione sangue', name: 'donation_certificate_mode', value: s.donation_certificate_mode, options: Object.keys(d.certificate_modes).map(function (k) { return { value: k, label: d.certificate_modes[k] + (k === 'required' ? ' (predefinito)' : ''), description: k === 'disabled' ? 'Disattivando, i requisiti in sospeso vengono annullati con registrazione nel registro.' : null }; }) });
		var dcdays = DOLLY.field({ label: 'Giorni di calendario per il certificato di donazione', name: 'donation_certificate_days', type: 'number', value: s.donation_certificate_days, attrs: { min: 1, max: 365 }, help: 'Usato solo con la scadenza attiva: contati dal giorno successivo alla donazione.' });
		// Device sessions.
		var deviceSessions = DOLLY.switchControl({ label: 'Sessioni dispositivo', name: 'device_sessions', checked: s.device_sessions !== false, description: 'Ogni dipendente accede da un solo dispositivo: il primo accesso lo registra come dispositivo principale. Da un altro dispositivo l\'accesso viene rifiutato finché non scolleghi il precedente (Dipendenti › Gestione dispositivi), dove puoi anche aumentare il limite per singolo dipendente. Non riguarda amministratori e account sede.' });

		/**
		 * Reminder offsets in minutes: chips with remove + "add" field.
		 * Returns {el, values()}.
		 */
		function minutesList(initial, label, unitText) {
			var list = (initial || []).map(Number).filter(function (n) { return n >= 1 && n <= 240; });
			var chipsEl = h('div', { class: 'dolly-minutes', role: 'list', 'aria-label': label });
			var input = h('input', { class: 'dolly-input', type: 'number', min: 1, max: 240, inputmode: 'numeric', placeholder: 'es. 5', 'aria-label': 'Minuti da aggiungere' });
			var addBtn = DOLLY.button('Aggiungi', { size: 'sm', icon: 'plus', onClick: add });
			var err = h('span', { class: 'dolly-error', hidden: true });
			function draw() {
				list.sort(function (a, b) { return a - b; });
				DOLLY.render(chipsEl, list.length ? list.map(function (m) {
					var rm = h('button', { type: 'button', 'aria-label': 'Rimuovi ' + m + ' minuti' }, DOLLY.icon('x'));
					rm.addEventListener('click', function () { list = list.filter(function (x) { return x !== m; }); draw(); });
					return h('span', { class: 'dolly-minutes__chip', role: 'listitem' }, [m + ' min ' + unitText, rm]);
				}) : h('span', { class: 'dolly-small dolly-muted', text: 'Nessun orario configurato: il promemoria non viene inviato.' }));
				DOLLY.icons();
			}
			function add() {
				var v = parseInt(input.value, 10);
				err.hidden = true;
				if (!(v >= 1 && v <= 240)) { err.textContent = 'Inserisci un numero di minuti tra 1 e 240.'; err.hidden = false; return; }
				if (list.indexOf(v) === -1) {
					if (list.length >= 6) { err.textContent = 'Al massimo 6 orari per promemoria.'; err.hidden = false; return; }
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
		var remEntryMin = minutesList(s.reminder_entry_minutes, 'Minuti prima dell\'inizio del turno', 'prima');
		var remExitMin = minutesList(s.reminder_exit_minutes, 'Minuti dopo la fine del turno', 'dopo');
		var remEntryBox = h('div', { class: 'dolly-form-grid', hidden: !s.reminder_entry }, remEntryMin.el);
		var remExitBox = h('div', { class: 'dolly-form-grid', hidden: !s.reminder_exit }, remExitMin.el);
		var remEntry = DOLLY.switchControl({ label: 'Promemoria di entrata', name: 'reminder_entry', checked: !!s.reminder_entry, description: 'Notifica push ai dipendenti che oggi devono lavorare e non hanno ancora timbrato l\'entrata. Puoi configurare più orari (es. 10 e 5 minuti prima).', onChange: function (on) { remEntryBox.hidden = !on; } });
		var remExit = DOLLY.switchControl({ label: 'Promemoria di uscita', name: 'reminder_exit', checked: !!s.reminder_exit, description: 'Notifica push ai dipendenti che, passata la fine del turno, non hanno ancora timbrato l\'uscita (es. 5 minuti dopo).', onChange: function (on) { remExitBox.hidden = !on; } });

		/** One notification group (employees or administrators): master switches + per-event switches. */
		function notifyGroup(prefix, labels, saved, portalLabel, portalHelp) {
			var g = {
				portal: DOLLY.switchControl({ label: portalLabel, name: prefix + 'notify_portal', checked: s[prefix + 'notify_portal'], description: portalHelp }),
				email: DOLLY.switchControl({ label: 'Email', name: prefix + 'notify_email', checked: s[prefix + 'notify_email'], description: 'Interruttore generale delle email.' }),
				ev: {}
			};
			var rows = Object.keys(labels).map(function (k) {
				var cur = saved[k] || { portal: true, email: true };
				g.ev[k] = {
					portal: DOLLY.switchControl({ label: 'App: ' + labels[k], checked: cur.portal }),
					email: DOLLY.switchControl({ label: 'Email: ' + labels[k], checked: cur.email })
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
				{ label: 'Evento', render: function (r) { return labels[r.k]; } },
				{ label: prefix ? 'Pannello' : 'App', render: function (r) { return g.ev[r.k].portal; } },
				{ label: 'Email', render: function (r) { return g.ev[r.k].email; } }
			], rows, { caption: prefix ? 'Notifiche agli amministratori per evento' : 'Notifiche ai dipendenti per evento' });
			g.values = function () {
				var out = {};
				Object.keys(g.ev).forEach(function (k) { out[k] = { portal: g.ev[k].portal.control.isOn(), email: g.ev[k].email.control.isOn() }; });
				return out;
			};
			return g;
		}
		var empN = notifyGroup('', d.employee_events || d.events, s.events, 'Notifiche nell\'app', 'Campanella del portale e notifica push sul telefono (se attivata dal dipendente).');
		var admN = notifyGroup('admin_', d.admin_events || d.events, s.admin_events || s.events, 'Notifiche nel pannello', 'Campanella in alto nel pannello di amministrazione e push sul telefono (se attivata).');
		var recipients = DOLLY.chips({ label: 'Amministratori che ricevono le notifiche', name: 'admin_recipients', help: 'Nessuna selezione = tutti gli amministratori.', selected: s.admin_recipients, options: d.admins.map(function (a) { return { value: a.id, label: a.name + ' (' + a.email + ')' }; }) });
		var pinMax = DOLLY.field({ label: 'Tentativi PIN errati prima del blocco', name: 'pin_max_attempts', type: 'number', value: s.pin_max_attempts, attrs: { min: 1, max: 50 } });
		var pinLock = DOLLY.field({ label: 'Durata del blocco PIN (minuti)', name: 'pin_lock_minutes', type: 'number', value: s.pin_lock_minutes, attrs: { min: 1, max: 1440 } });
		var grace = DOLLY.field({ label: 'Tolleranza di rete per QR/PIN (secondi)', name: 'challenge_grace', type: 'number', value: s.challenge_grace, attrs: { min: 0, max: 10 }, help: 'Accetta il codice precedente per pochi secondi dopo la rotazione (0–10).' });

		var logoId = s.logo_id;
		var logoPreview = h('div', { class: 'dolly-logo-preview' });
		function showLogo(url) { DOLLY.render(logoPreview, url ? h('img', { src: url, alt: 'Logo attuale', style: 'max-height:56px' }) : h('span', { class: 'dolly-brand__wordmark', text: 'Dolly' })); }
		showLogo(d.logo_url);
		var pick = DOLLY.button('Scegli logo', { icon: 'image', onClick: function () {
			if (!window.wp || !window.wp.media) { return; }
			var frame = window.wp.media({ title: 'Logo Dolly', library: { type: 'image' }, multiple: false, button: { text: 'Usa questo logo' } });
			frame.on('select', function () { var a = frame.state().get('selection').first().toJSON(); logoId = a.id; showLogo((a.sizes && a.sizes.medium ? a.sizes.medium.url : a.url)); });
			frame.open();
		} });
		var rmLogo = DOLLY.button('Usa il marchio testuale', { icon: 'type', onClick: function () { logoId = 0; showLogo(''); } });

		var saveBtn = DOLLY.button('Salva impostazioni', { type: 'submit', variant: 'primary', icon: 'save' });
		var form = h('form', { class: 'dolly-stack', novalidate: true }, [
			alertBox,
			DOLLY.card('Verifica timbrature', 'shield-check', h('div', { class: 'dolly-form' }, [vm, radius, grace, h('div', { class: 'dolly-form-grid' }, [pinMax, pinLock])]), { level: 'h2' }),
			DOLLY.card('Presenze e orari', 'clock', h('div', { class: 'dolly-form' }, [lunchPunch, h('div', { class: 'dolly-form-grid' }, [lateTol]), rounding, stepBox, h('div', { class: 'dolly-form-grid' }, [overtime, holidayIncrease])]), { level: 'h2' }),
			DOLLY.card('Portale dipendenti', 'smartphone', h('div', { class: 'dolly-form' }, [requireInstall]), { level: 'h2' }),
			DOLLY.card('Sessioni dispositivo', 'shield-check', h('div', { class: 'dolly-form' }, [deviceSessions]), { level: 'h2' }),
			DOLLY.card('Promemoria timbratura', 'alarm-clock', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: 'I promemoria arrivano come notifica push sul telefono (e nella campanella dell\'app) solo a chi è previsto al lavoro: non vengono inviati nei giorni di riposo, festivi o di chiusura, né a chi è in ferie, malattia, infortunio o donazione sangue, né quando un permesso orario copre l\'inizio (entrata) o la fine (uscita) del turno.' }),
				remEntry, remEntryBox, remExit, remExitBox,
				h('p', { class: 'dolly-help', text: 'Richiede lo scheduler attivo ogni minuto (vedi Stato del sistema) e le notifiche attivate dal dipendente sul telefono.' })
			]), { level: 'h2' }),
			DOLLY.card('Contratti a chiamata', 'phone-call', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: 'I dipendenti con contratto a chiamata non hanno giorni né orari: iniziano e terminano il turno quando vogliono e ogni turno completato va approvato.' }),
				ocAuto, ocBox
			]), { level: 'h2' }),
			DOLLY.card('Malattia, infortunio e certificati', 'stethoscope', h('div', { class: 'dolly-form' }, [cm, cdays]), { level: 'h2' }),
			DOLLY.card('Donazione sangue', 'droplet', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: 'La donazione sangue si chiede da Richieste. Dopo l\'approvazione, dal giorno successivo alla donazione il dipendente trova nella richiesta «Carica certificato» (con notifica e anomalia "Certificato mancante"), come per il certificato medico.' }),
				dcm, dcdays
			]), { level: 'h2' }),
			DOLLY.card('Anomalie', 'triangle-alert', h('div', { class: 'dolly-form' }, [
				absCheck, absDelayBox,
				h('p', { class: 'dolly-help', text: 'Uscita mancante: se il dipendente non timbra l\'uscita entro le 23:59 della giornata viene segnalata un\'anomalia.' })
			]), { level: 'h2' }),
			DOLLY.card('Notifiche ai dipendenti', 'users', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: 'Cosa ricevono tutti i dipendenti. Gli interruttori generali disattivano il canale per tutti gli eventi.' }),
				h('div', { class: 'dolly-form-grid' }, [empN.portal, empN.email]),
				empN.table,
				h('p', { class: 'dolly-help', text: 'I messaggi del menu Comunicazioni hanno impostazioni proprie. Disattivare le notifiche non nasconde stati delle richieste né anomalie.' })
			]), { level: 'h2' }),
			DOLLY.card('Notifiche agli amministratori', 'shield', h('div', { class: 'dolly-form' }, [
				h('p', { class: 'dolly-muted', style: 'margin:0', text: 'Cosa ricevono gli amministratori selezionati qui sotto.' }),
				h('div', { class: 'dolly-form-grid' }, [admN.portal, admN.email]),
				admN.table,
				recipients
			]), { level: 'h2' }),
			DOLLY.card('Logo', 'image', [h('p', { class: 'dolly-muted', text: 'I colori del marchio (blu #002F4D e oro #CCB166) sono fissi. Senza logo viene mostrato il marchio testuale.' }), logoPreview, h('div', { class: 'dolly-btn-row', style: 'margin-top:8px' }, [pick, rmLogo])], { level: 'h2' }),
			h('div', { class: 'dolly-btn-row dolly-settings__save' }, saveBtn)
		]);
		form.addEventListener('submit', function (ev) {
			ev.preventDefault(); DOLLY.clearErrors(form); alertBox.hidden = true;
			var body = {
				verification_mode: vm.value(), default_radius: radius.input.value, certificate_mode: cm.value(), certificate_days: cdays.input.value,
				lunch_punch: lunchPunch.control.isOn(), late_tolerance: lateTol.input.value, exit_rounding: rounding.control.isOn(), rounding_step: step.input.value,
				overtime_auto: overtime.input.value, absence_check: absCheck.control.isOn(), absence_delay: absDelay.input.value,
				oncall_auto: ocAuto.control.isOn(), oncall_threshold: ocThreshold.input.value, holiday_increase: holidayIncrease.input.value, require_install: requireInstall.control.isOn(),
				notify_portal: empN.portal.control.isOn(), notify_email: empN.email.control.isOn(), events: empN.values(),
				admin_notify_portal: admN.portal.control.isOn(), admin_notify_email: admN.email.control.isOn(), admin_events: admN.values(),
				reminder_entry: remEntry.control.isOn(), reminder_entry_minutes: remEntryMin.values(), reminder_exit: remExit.control.isOn(), reminder_exit_minutes: remExitMin.values(),
				donation_certificate_mode: dcm.value(), donation_certificate_days: dcdays.input.value, device_sessions: deviceSessions.control.isOn(),
				admin_recipients: recipients.values().map(Number), logo_id: logoId, pin_max_attempts: pinMax.input.value, pin_lock_minutes: pinLock.input.value, challenge_grace: grace.input.value
			};
			var go = function () {
				DOLLY.busy(saveBtn, DOLLY.api('admin/settings', { method: 'POST', body: body })).then(function (nd) {
					DOLLY.toast('Impostazioni salvate.', 'success'); renderSettings(nd);
				}, function (err) { DOLLY.formError(form, err, alertBox); });
			};
			if (body.certificate_mode === 'disabled' && s.certificate_mode !== 'disabled') {
				DOLLY.confirm('Disattivare i certificati?', 'Tutti i requisiti di certificato in sospeso verranno annullati e registrati nel registro modifiche.', 'Disattiva e salva', 'danger').then(function (ok) { if (ok) { go(); } });
			} else { go(); }
		});

		// System status.
		var c = d.cron;
		var runBtn = DOLLY.button('Esegui controlli ora', { icon: 'play', onClick: function () {
			DOLLY.busy(runBtn, DOLLY.api('admin/cron/run', { method: 'POST' })).then(function () { DOLLY.toast('Controlli eseguiti.', 'success'); pageSettings(); }, function (err) { DOLLY.toast(err.message, 'error'); });
		} });
		var testMailResult = h('div', { style: 'margin-top:8px', 'aria-live': 'polite' });
		var testMail = DOLLY.button('Invia email di prova', { icon: 'mail', onClick: function () {
			DOLLY.busy(testMail, DOLLY.api('admin/test-email', { method: 'POST' })).then(function (r) {
				DOLLY.render(testMailResult, DOLLY.alert(r.message, r.ok ? 'success' : 'error'));
			}, function (err) { DOLLY.render(testMailResult, DOLLY.alert(err.message, 'error')); });
		} });
		var check = function (ok, label, bad) { return h('li', {}, [ok ? DOLLY.badge('OK', 'green', 'circle-check') : DOLLY.badge('Da verificare', 'red', 'circle-alert'), ' ', label, !ok && bad ? h('div', { class: 'dolly-help', text: bad }) : null]); };
		var status = DOLLY.card('Stato del sistema', 'activity', [
			h('ul', { class: 'dolly-stack', style: 'list-style:none;padding:0;margin:0 0 16px' }, [
				check(c.healthy, 'Scheduler ogni minuto' + (c.last_run ? ' · ultima esecuzione ' + DOLLY.fmt.dateTime(c.last_run) + ' (' + c.last_source + ')' : ' · mai eseguito'), 'Configura il cron di sistema: la produzione non deve dipendere dalle visite.'),
				check(c.wp_cron_disabled, 'WP-Cron basato sulle visite disattivato (DISABLE_WP_CRON)', 'Aggiungi define( \'DISABLE_WP_CRON\', true ); in wp-config.php dopo aver configurato il cron di sistema.'),
				check(d.storage.https, 'HTTPS attivo', 'GPS e fotocamera funzionano solo su HTTPS.'),
				check(d.storage.outside_webroot, 'Certificati salvati fuori dalla cartella pubblica', 'La cartella è dentro uploads con regole di blocco: verifica che il server non la serva, oppure definisci DOLLY_PRIVATE_DIR.'),
				check(d.storage.zip, 'Estensione ZIP di PHP disponibile', 'Verrà usata la libreria PclZip inclusa in WordPress.'),
				d.push ? check(d.push.available, 'Notifiche push sui telefoni' + (d.push.available ? ' · ' + d.push.devices + ' dispositivi di ' + d.push.employees + ' dipendenti' : ''), d.push.available ? null : 'OpenSSL del server non supporta le chiavi EC (P-256): le notifiche push non sono disponibili, le notifiche nell\'app funzionano comunque.') : null,
				d.push && d.push.available ? h('li', { class: 'dolly-help', text: (d.push.encrypted ? 'Messaggi push cifrati (contenuto visibile subito sul telefono).' : 'PHP senza ECDH: push vuote, il telefono scarica il contenuto dal sito.') + (d.push.last_success ? ' Ultimo invio riuscito: ' + DOLLY.fmt.dateTime(d.push.last_success) + '.' : ' Nessun invio riuscito finora.') }) : null,
				d.push && d.push.last_error ? h('li', { class: 'dolly-help', text: 'Ultimo errore push: ' + d.push.last_error }) : null,
				check(!c.email_queue.failed, 'Email: ' + c.email_queue.sent + ' inviate, ' + c.email_queue.pending + ' in coda, ' + c.email_queue.failed + ' non riuscite', c.email_queue.last_error ? 'Ultimo errore: ' + c.email_queue.last_error : 'Verifica la configurazione SMTP.')
			]),
			h('p', { class: 'dolly-label', text: 'Comando cron di sistema (una delle due opzioni, ogni minuto):' }),
			h('pre', { class: 'dolly-code', text: '* * * * * ' + c.wp_cli + ' >/dev/null 2>&1\n* * * * * curl -fsS "' + c.cron_url + '" >/dev/null 2>&1' }),
			h('p', { class: 'dolly-help', text: 'L\'indirizzo contiene una chiave segreta: non condividerlo.' }),
			h('p', { class: 'dolly-help', text: 'Notifiche push ed email partono subito, alla fine dell\'operazione che le crea; lo scheduler ogni minuto invia quelle programmate e ripete quelle non riuscite.' }),
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
		DOLLY.render(main, h('div', { class: 'dolly-stack' }, [form, status, DOLLY.card('Registro modifiche', 'history', auditBox)]));
		loadAudit();
	}

	/* ------------------------------------------------------------------ */
	/* Analytics                                                            */
	/* ------------------------------------------------------------------ */

	// Brand colours; the presence chart keeps the dashboard colours (same meaning, same colour).
	var C = { navy: '#002F4D', gold: '#B8963E', grey: '#8A94A0', green: '#17693A', red: '#B42318', blue: '#1F5FAD', sand: '#CCB166' };

	var AN_PRESETS = [
		{ id: '7', label: 'Ultimi 7 giorni' },
		{ id: '30', label: 'Ultimi 30 giorni' },
		{ id: 'month', label: 'Questo mese' },
		{ id: 'prev', label: 'Mese scorso' },
		{ id: '90', label: 'Ultimi 3 mesi' },
		{ id: 'year', label: 'Quest\'anno' },
		{ id: '365', label: 'Ultimi 12 mesi' }
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

		var fromF = DOLLY.dateField({ label: 'Dal', value: st.from });
		var toF = DOLLY.dateField({ label: 'Al', value: st.to, help: 'GG/MM/AAAA · fino a oggi' });
		var wpF = DOLLY.field({ label: 'Sede', type: 'select', value: st.workplace, options: workplaceOptions('Tutte le sedi') });
		var empF = DOLLY.field({ label: 'Dipendente', type: 'select', value: st.user, options: [{ value: '', label: 'Tutti i dipendenti' }] });
		allEmployees().then(function (list) {
			list.forEach(function (e) { empF.input.appendChild(h('option', { value: e.id, selected: String(e.id) === String(st.user) ? true : null, text: e.name + (e.active ? '' : ' (disattivato)') })); });
		});
		var applyBtn = DOLLY.button('Mostra', { variant: 'primary', icon: 'chart-line' });
		var presetBox = h('div', { class: 'dolly-btn-row dolly-an__presets', role: 'group', 'aria-label': 'Periodi rapidi' });
		var errBox = h('div');
		var meta = h('p', { class: 'dolly-small dolly-muted dolly-an__meta', 'aria-live': 'polite' });
		var notice = h('div');
		var kpis = h('div', { class: 'dolly-grid dolly-grid--4 dolly-an__kpis' });
		var body = h('div', { class: 'dolly-an__body' });
		var csvBtn = DOLLY.button('Esporta CSV', { icon: 'file-spreadsheet', disabled: true, onClick: exportCsv });
		var printBtn = DOLLY.button('Stampa', { icon: 'printer', disabled: true, onClick: function () { window.print(); } });
		var freshBtn = DOLLY.button('Ricalcola', { icon: 'refresh-cw', disabled: true, onClick: function () { load(true); } });
		freshBtn.title = 'Ricalcola i dati senza usare quelli già salvati';

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
			var msg = !f || !t ? 'Indica le date nel formato GG/MM/AAAA.' : (t > today ? 'La data finale non può essere successiva a oggi.' : (f > t ? 'La data iniziale deve precedere quella finale.' : ''));
			if (!msg && (new Date(t) - new Date(f)) / 86400000 + 1 > 366) { msg = 'Il periodo può durare al massimo 366 giorni.'; }
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
			meta.textContent = 'Calcolo dal ' + DOLLY.fmt.date(st.from) + ' al ' + DOLLY.fmt.date(st.to) + '…';
			DOLLY.render(notice, null);
			DOLLY.render(kpis, null);
			destroyCharts();
			DOLLY.render(body, DOLLY.loading('Calcolo delle statistiche in corso. Per periodi lunghi può richiedere qualche secondo.'));
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
			var unit = { day: 'per giorno', week: 'per settimana', month: 'per mese' }[d.unit];
			meta.textContent = 'Dal ' + d.from_label + ' al ' + d.to_label + ' · ' + d.days + ' giorni · ' + d.employees_count + (d.employees_count === 1 ? ' dipendente' : ' dipendenti') + ' · calcolato il ' + d.generated;
			DOLLY.render(notice, k.provisional_days ? DOLLY.alert(k.provisional_days + (k.provisional_days === 1 ? ' giornata è provvisoria' : ' giornate sono provvisorie') + ' (uscita mancante, anomalia aperta o turno da approvare): i totali possono ancora cambiare.', 'info') : null);
			DOLLY.render(kpis, [
				kpiTile('Ore lavorate', hm(k.worked_min), 'clock', 'su ' + hm(k.planned_min) + ' previste (' + pct(k.worked_pct) + ')', 'green'),
				kpiTile('Straordinari', hm(k.extra_min), 'trending-up', k.extra_pending_min ? DOLLY.badge(hm(k.extra_pending_min) + ' da approvare', 'amber', 'hourglass') : 'Nessuno da approvare'),
				kpiTile('Tasso di presenza', pct(k.presence_pct), 'user-check', k.present_days + ' giornate lavorate · ' + k.expected_days + ' giornate lavorative previste', 'green'),
				kpiTile('Tasso di assenteismo', pct(k.absenteeism_pct), 'user-x', 'Malattia, infortunio e assenze non giustificate: ' + hm(k.absence_min) + ' sulle ore previste', 'red'),
				kpiTile('Puntualità', pct(k.punctuality_pct), 'alarm-clock', k.late ? k.late + ' ritardi su ' + k.entries + ' entrate · in media ' + k.late_avg + ' min' : 'Nessun ritardo su ' + k.entries + ' entrate', 'amber'),
				kpiTile('Ferie e permessi', k.leave_days + ' gg', 'sun', 'Permessi orari: ' + hm(k.leave_min)),
				kpiTile('Malattia e infortunio', k.sick_days + ' gg', 'stethoscope', 'Assenze non giustificate: ' + k.absent_days + ' gg', 'red'),
				kpiTile('Anomalie', k.anomalies, 'triangle-alert', k.anomalies_open ? DOLLY.badge(k.anomalies_open + ' ancora aperte', 'red', 'triangle-alert') : 'Tutte risolte', 'red')
			]);

			var empty = !d.employees_count;
			if (empty) {
				DOLLY.render(body, DOLLY.empty('Nessun dipendente', 'Non ci sono dipendenti per il periodo e la sede scelti.', 'users'));
				return;
			}
			var top = d.employees.filter(function (e) { return e.extra_min || e.extra_pending_min; })
				.sort(function (a, b) { return (b.extra_min + b.extra_pending_min) - (a.extra_min + a.extra_pending_min); }).slice(0, 10);
			var abs = d.absences.filter(function (a) { return a.min > 0; });
			var reqText = k.requests ? k.requests + ' richieste' + (k.requests_pending ? ', ' + k.requests_pending + ' in attesa' : '') + (k.response_hours !== null ? ' · risposta media in ' + String(k.response_hours).replace('.', ',') + ' ore' : '') : '';

			var cards = {
				hours: chartCard('Ore lavorate ' + unit, 'clock', 'Ore ordinarie e di straordinario rispetto alle ore previste dall\'orario.'),
				presence: chartCard('Presenze e assenze ' + unit, 'users', 'Giornate-persona: chi ha timbrato, chi era in ferie, in malattia o assente senza giustificazione.'),
				absences: chartCard('Ripartizione delle assenze', 'chart-bar', 'Ore di assenza per motivo.', !abs.length && 'Nessuna assenza nel periodo.'),
				weekday: chartCard('Ritardi per giorno della settimana', 'calendar-days', 'Numero di entrate oltre la tolleranza.', !k.late && 'Nessun ritardo nel periodo.'),
				lateDist: chartCard('Entità dei ritardi', 'alarm-clock', 'Quante entrate in ritardo, per minuti di ritardo.', !k.late && 'Nessun ritardo nel periodo.'),
				overtime: chartCard('Straordinari per dipendente', 'trending-up', d.employees_count > 10 ? 'I 10 dipendenti con più straordinario.' : 'Straordinario approvato e da approvare.', !top.length && 'Nessuno straordinario nel periodo.'),
				anomalies: chartCard('Anomalie per tipo', 'triangle-alert', 'Anomalie delle giornate del periodo, aperte e risolte.', !d.anomalies.length && 'Nessuna anomalia nel periodo.'),
				requests: chartCard('Richieste per tipo', 'inbox', reqText || 'Richieste che riguardano il periodo.', !d.requests.length && 'Nessuna richiesta nel periodo.')
			};
			var tableBox = h('div');
			var sortF = DOLLY.field({ label: 'Ordina per', type: 'select', value: st.sort, options: [
				{ value: 'name', label: 'Nome' }, { value: 'worked', label: 'Ore lavorate' }, { value: 'balance', label: 'Differenza sulle previste' },
				{ value: 'extra', label: 'Straordinario' }, { value: 'presence', label: 'Presenza (dal più basso)' }, { value: 'late', label: 'Ritardi' },
				{ value: 'absent', label: 'Assenze non giustificate' }, { value: 'sick', label: 'Malattia e infortunio' }, { value: 'anomalies', label: 'Anomalie' }
			] });
			sortF.input.addEventListener('change', function () { st.sort = sortF.input.value; save(); renderTable(); });

			DOLLY.render(body, [
				h('div', { class: 'dolly-an__wide' }, [cards.hours.el, cards.presence.el]),
				h('div', { class: 'dolly-grid dolly-grid--2 dolly-an__grid' }, [cards.absences.el, cards.weekday.el, cards.lateDist.el, cards.overtime.el, cards.anomalies.el, cards.requests.el]),
				DOLLY.card('Riepilogo per dipendente', 'users', [h('div', { class: 'dolly-toolbar' }, [sortF]), tableBox])
			]);
			renderTable();

			var s = d.series;
			lineBar(cards.hours, s.labels, [
				{ label: 'Ore ordinarie', data: s.ordinary.map(hours), backgroundColor: C.navy, stack: 'h' },
				{ label: 'Straordinario', data: s.extra.map(hours), backgroundColor: C.gold, stack: 'h' },
				{ type: 'line', label: 'Ore previste', data: s.planned.map(function (v) { return v ? hours(v) : null; }), borderColor: C.grey, backgroundColor: C.grey, borderDash: [6, 4], borderWidth: 2, pointRadius: s.labels.length > 40 ? 0 : 3, tension: 0 }
			], { stacked: true, axis: 'Ore', fmt: function (v) { return hm(v * 60); } });
			lineBar(cards.presence, s.labels, [
				{ label: 'Presenti', data: s.present, backgroundColor: C.green },
				{ label: 'Ferie e donazione', data: s.leave, backgroundColor: C.blue },
				{ label: 'Malattia e infortunio', data: s.sick, backgroundColor: C.sand },
				{ label: 'Assenti non giustificati', data: s.absent, backgroundColor: C.red }
			], { stacked: true, axis: 'Giornate-persona', integer: true });
			if (abs.length) {
				lineBar(cards.absences, abs.map(function (a) { return a.label; }), [{ label: 'Ore di assenza', data: abs.map(function (a) { return hours(a.min); }), backgroundColor: C.navy }], { horizontal: true, axis: 'Ore', fmt: function (v) { return hm(v * 60); }, legend: false });
			}
			if (k.late) {
				lineBar(cards.weekday, d.weekday.map(function (w) { return w.short; }), [{ label: 'Ritardi', data: d.weekday.map(function (w) { return w.late; }), backgroundColor: C.navy }], {
					integer: true, legend: false, axis: 'Ritardi',
					extra: function (i) { var w = d.weekday[i]; return w.entries ? pct(w.late_pct) + ' delle entrate · media ' + w.late_avg + ' min' : ''; }
				});
				lineBar(cards.lateDist, d.late_dist.labels, [{ label: 'Entrate in ritardo', data: d.late_dist.values, backgroundColor: C.navy }], { integer: true, legend: false, axis: 'Entrate' });
			}
			if (top.length) {
				lineBar(cards.overtime, top.map(function (e) { return e.name; }), [
					{ label: 'Approvato', data: top.map(function (e) { return hours(e.extra_min); }), backgroundColor: C.navy },
					{ label: 'Da approvare', data: top.map(function (e) { return hours(e.extra_pending_min); }), backgroundColor: C.gold }
				], { horizontal: true, stacked: true, axis: 'Ore', fmt: function (v) { return hm(v * 60); } });
			}
			if (d.anomalies.length) {
				lineBar(cards.anomalies, d.anomalies.map(function (a) { return a.label; }), [
					{ label: 'Aperte', data: d.anomalies.map(function (a) { return a.open; }), backgroundColor: C.red },
					{ label: 'Risolte', data: d.anomalies.map(function (a) { return a.resolved; }), backgroundColor: C.green }
				], { horizontal: true, stacked: true, integer: true, axis: 'Anomalie' });
			}
			if (d.requests.length) {
				lineBar(cards.requests, d.requests.map(function (r) { return r.label; }), [
					{ label: 'Approvate', data: d.requests.map(function (r) { return r.approved; }), backgroundColor: C.green },
					{ label: 'In attesa', data: d.requests.map(function (r) { return r.pending; }), backgroundColor: C.sand },
					{ label: 'Respinte', data: d.requests.map(function (r) { return r.rejected; }), backgroundColor: C.red },
					{ label: 'Annullate', data: d.requests.map(function (r) { return r.cancelled; }), backgroundColor: C.grey }
				], { horizontal: true, stacked: true, integer: true, axis: 'Richieste' });
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
					h('td', { text: 'Totale' }), h('td', { class: 'num', text: String(tot('present_days')) }), h('td', { class: 'num', text: hm(tot('worked_min')) }),
					h('td', { class: 'num', text: hm(tot('planned_min')) }), h('td', { class: 'num', text: hm(tot('balance_min')) }), h('td', { class: 'num', text: hm(tot('extra_min')) }),
					h('td', { class: 'num', text: pct(k.presence_pct) }), h('td', { class: 'num', text: String(tot('late')) }), h('td', { class: 'num', text: String(tot('absent_days')) }),
					h('td', { class: 'num', text: String(tot('leave_days')) }), h('td', { class: 'num', text: hm(tot('leave_min')) }), h('td', { class: 'num', text: String(tot('sick_days')) }),
					h('td', { class: 'num', text: String(tot('anomalies')) })
				]));
				DOLLY.render(tableBox, DOLLY.table([
					{ label: 'Dipendente', render: function (e) {
						return h('span', {}, [
							h('strong', {}, h('a', { href: CFG.pages.attendance + '&user_id=' + e.user_id + '&month=' + ym, title: 'Apri le presenze di ' + e.name, text: e.name })),
							e.active ? null : h('span', { class: 'dolly-att-date__off' }, DOLLY.badge('Disattivato', 'neutral')),
							e.contract ? h('div', { class: 'dolly-small dolly-muted', text: e.contract }) : null
						]);
					} },
					{ label: 'Giorni lavorati', num: true, render: function (e) { return e.present_days + (e.expected_days ? ' / ' + e.expected_days : ''); } },
					{ label: 'Ore lavorate', num: true, render: function (e) { return hm(e.worked_min); } },
					{ label: 'Ore previste', num: true, render: function (e) { return hm(e.planned_min); } },
					{ label: 'Differenza', num: true, render: function (e) { return h('span', { class: e.balance_min < 0 ? 'dolly-neg' : (e.balance_min > 0 ? 'dolly-pos' : ''), text: (e.balance_min > 0 ? '+' : '') + hm(e.balance_min) }); } },
					{ label: 'Straordinario', num: true, render: function (e) { return h('span', {}, [hm(e.extra_min), e.extra_pending_min ? h('div', {}, DOLLY.badge(hm(e.extra_pending_min) + ' da approvare', 'amber', 'hourglass')) : null]); } },
					{ label: 'Presenza', num: true, render: function (e) { return pct(e.presence_pct); } },
					{ label: 'Ritardi', num: true, render: function (e) { return e.late ? e.late + ' · ' + e.late_min + ' min' : '0'; } },
					{ label: 'Assenze non giust.', num: true, render: function (e) { return e.absent_days ? DOLLY.badge(e.absent_days + ' gg', 'red') : '0'; } },
					{ label: 'Ferie', num: true, render: function (e) { return e.leave_days + ' gg'; } },
					{ label: 'Permessi', num: true, render: function (e) { return hm(e.leave_min); } },
					{ label: 'Malattia/infortunio', num: true, render: function (e) { return e.sick_days + ' gg'; } },
					{ label: 'Anomalie', num: true, render: function (e) { return e.anomalies ? DOLLY.badge(String(e.anomalies), 'red', 'triangle-alert') : '0'; } }
				], rows, { caption: 'Riepilogo per dipendente dal ' + d.from_label + ' al ' + d.to_label, foot: d.employees.length > 1 ? foot : null }));
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
				if (ds.type !== 'line') { Object.assign(ds, { borderRadius: o.stacked ? 2 : 4, borderSkipped: 'start', maxBarThickness: 36, borderColor: '#fff', borderWidth: o.stacked ? (o.horizontal ? { right: 2 } : { top: 2 }) : 0 }); }
			});
			var scales = {};
			scales[catAxis] = { stacked: !!o.stacked, grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0, color: '#56616E' } };
			scales[valueAxis] = {
				stacked: !!o.stacked, beginAtZero: true, grid: { color: '#E8ECF0' }, border: { display: false },
				title: { display: !!o.axis, text: o.axis, color: '#56616E' },
				ticks: { precision: o.integer ? 0 : undefined, color: '#56616E', callback: function (v) { return o.fmt ? fmt(v) : String(v).replace('.', ','); } }
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
						legend: { display: o.legend !== false && datasets.length > 1, position: 'bottom', labels: { boxWidth: 12, color: '#1B2530' } },
						tooltip: { callbacks: {
							label: function (c) { return ' ' + c.dataset.label + ': ' + fmt(o.horizontal ? c.parsed.x : c.parsed.y); },
							afterBody: o.extra ? function (items) { var t = o.extra(items[0].dataIndex); return t ? [t] : []; } : undefined
						} }
					},
					locale: 'it-IT'
				}
			});
			// Accessible data table equivalent of the chart.
			DOLLY.render(card.table, DOLLY.table([{ label: '', srLabel: 'Voce', key: 'l' }].concat(datasets.map(function (ds, i) { return { label: ds.label, render: function (r) { return fmt(r.v[i]); } }; })),
				labels.map(function (l, i) { return { l: l, v: datasets.map(function (ds) { return ds.data[i]; }) }; }), { caption: 'Dati del grafico ' + card.title, stack: false }));
		}

		function exportCsv() {
			if (!data) { return; }
			var rows = data.employees.map(function (e) {
				return [e.name, e.contract, e.present_days, e.expected_days, hm(e.worked_min), hm(e.planned_min), hm(e.balance_min), hm(e.extra_min), hm(e.extra_pending_min),
					e.presence_pct === null ? '' : String(e.presence_pct).replace('.', ','), e.late, e.late_min, e.absent_days, e.leave_days, hm(e.leave_min), e.sick_days, e.anomalies];
			});
			downloadCsv('Analytics_' + data.from.split('-').reverse().join('-') + '_' + data.to.split('-').reverse().join('-') + '.csv',
				['Dipendente', 'Contratto', 'Giorni lavorati', 'Giorni lavorativi previsti', 'Ore lavorate', 'Ore previste', 'Differenza', 'Straordinario approvato', 'Straordinario da approvare',
					'Presenza %', 'Ritardi', 'Minuti di ritardo', 'Assenze non giustificate (gg)', 'Ferie e donazione (gg)', 'Permessi orari', 'Malattia e infortunio (gg)', 'Anomalie'], rows);
		}

		window.addEventListener('beforeprint', function () { Object.keys(charts).forEach(function (k) { charts[k].resize(); }); });
		load();
	}

	/* ------------------------------------------------------------------ */
	/* Boot                                                               */
	/* ------------------------------------------------------------------ */

	var pages = {
		dashboard: pageDashboard, employees: pageEmployees, 'employee-new': pageEmployeeNew, workplaces: pageWorkplaces,
		requests: pageRequests, attendance: pageAttendance, analytics: pageAnalytics, anomalies: pageAnomalies, broadcast: pageBroadcast, exports: pageExports, settings: pageSettings
	};
	menuToggle();
	headerBell();
	(pages[CFG.page] || pageDashboard)();
	DOLLY.icons();
})(window, document);
