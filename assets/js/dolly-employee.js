/**
 * Employee portal: dashboard & clocking, calendar & attendance history, requests,
 * sickness & certificates, notifications, profile.
 */
(function (window, document) {
	'use strict';

	var DOLLY = window.DOLLY, h = DOLLY.h, CFG = DOLLY.config;
	var root = document.getElementById('dolly-employee-app');
	if (!root) { return; }

	var ACTIONS = {
		entrata: { label: 'Entrata', icon: 'log-in', verb: 'Registra entrata' },
		inizio_pausa: { label: 'Inizio pausa', icon: 'coffee', verb: 'Inizia pausa' },
		fine_pausa: { label: 'Fine pausa', icon: 'briefcase', verb: 'Termina pausa' },
		uscita: { label: 'Uscita', icon: 'log-out', verb: 'Registra uscita' }
	};
	// Notifications and profile are reached from the header, not from the bottom bar / side menu.
	var SECTIONS = [
		{ id: 'dashboard', label: 'Timbratura', icon: 'clock', nav: true },
		{ id: 'calendario', label: 'Calendario', icon: 'calendar-days', nav: true },
		{ id: 'richieste', label: 'Richieste', icon: 'inbox', nav: true },
		{ id: 'malattia', label: 'Malattia', icon: 'stethoscope', nav: true },
		{ id: 'notifiche', label: 'Notifiche', icon: 'bell' },
		{ id: 'profilo', label: 'Profilo', icon: 'circle-user' }
	];
	var SICK_KINDS = { malattia: 'Malattia', infortunio: 'Infortunio' };

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
			h('a', { href: '#notifiche', class: 'dolly-btn dolly-btn--ghost dolly-btn--icon dolly-bell', 'aria-label': 'Notifiche', title: 'Notifiche', dataset: { section: 'notifiche' } }, [DOLLY.icon('bell'), bellCount]),
			h('a', { href: '#profilo', class: 'dolly-btn dolly-btn--ghost dolly-btn--icon', 'aria-label': 'Profilo', title: 'Profilo', dataset: { section: 'profilo' } }, DOLLY.icon('circle-user')),
			DOLLY.button('Esci', { href: CFG.logoutUrl, variant: 'ghost', icon: 'log-out', iconOnly: true })
		]);
		var top = h('header', { class: 'dolly-topbar' }, [brand(), topActions]);
		navEl = h('nav', { class: 'dolly-nav', 'aria-label': 'Sezioni del portale' }, SECTIONS.filter(function (s) { return s.nav; }).map(function (s) {
			return h('a', { class: 'dolly-nav__link', href: '#' + s.id, dataset: { section: s.id } }, [DOLLY.icon(s.icon), h('span', { text: s.label })]);
		}));
		main = h('main', { class: 'dolly-main', id: 'dolly-main', tabindex: '-1' });
		DOLLY.render(root, [top, h('div', { class: 'dolly-shell' }, [navEl, main])]);
	}

	function brand() {
		return h('div', { class: 'dolly-brand' }, [
			DOLLY.brandMark(true),
			h('span', { class: 'dolly-brand__sub', text: state.me ? state.me.first_name || CFG.userName : CFG.userName })
		]);
	}

	function updateBadges() {
		if (!state.me) { return; }
		bellCount.hidden = !state.me.unread;
		bellCount.textContent = state.me.unread > 99 ? '99+' : state.me.unread;
		var bell = topActions.querySelector('.dolly-bell');
		bell.setAttribute('aria-label', 'Notifiche' + (state.me.unread ? ', ' + state.me.unread + ' non lette' : ''));
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
		({ dashboard: viewDashboard, calendario: viewCalendar, richieste: viewRequests, malattia: viewSickness, notifiche: viewNotifications, profilo: viewProfile })[id]();
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
		DOLLY.render(main, DOLLY.loading('Caricamento della giornata…'));
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
		var blocks = [pageTitle('Ciao ' + (me.first_name || ''))];

		if (st.exception && st.exception.active) {
			blocks.push(DOLLY.alert('Eccezione di verifica attiva fino alle ' + DOLLY.fmt.time(st.exception.expires_at) + ' del ' + DOLLY.fmt.dateTime(st.exception.expires_at).slice(0, 10) + ': posizione e QR/PIN non sono richiesti.', 'info'));
		}
		if (st.previous_incomplete && st.previous_incomplete.length) {
			blocks.push(DOLLY.alert('Giornate precedenti senza uscita: ' + st.previous_incomplete.join(', ') + '. Sono segnalate all\'amministratore; puoi inviare una richiesta di correzione.', 'warning',
				h('div', { style: 'margin-top:8px' }, DOLLY.button('Richiedi correzione', { size: 'sm', icon: 'pencil', onClick: function () { requestDialog({ type: 'correzione' }); } }))));
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
			clockChildren.push(h('button', { type: 'button', class: 'dolly-clock__btn', disabled: true }, [DOLLY.icon('circle-check'), 'Giornata completata']));
		} else if (st.primary) {
			var a = ACTIONS[st.primary];
			var btn = h('button', { type: 'button', class: 'dolly-clock__btn dolly-clock__btn--' + st.primary, dataset: { tour: 'clock-btn' } }, [DOLLY.icon(a.icon), a.verb]);
			btn.addEventListener('click', function () { startPunch(st.primary); });
			clockChildren.push(btn);
			if (st.secondary === 'uscita') {
				clockChildren.push(h('div', { class: 'dolly-clock__secondary' }, DOLLY.button('Uscita definitiva anticipata', { icon: 'log-out', onClick: function () { startPunch('uscita', true); } })));
			}
		}
		if (st.last) {
			clockChildren.push(h('div', { class: 'dolly-clock__last' }, [DOLLY.icon('history'), h('span', { text: 'Ultima azione: ' + st.last.label + ' alle ' + st.last.time + (st.last.workplace ? ' · ' + st.last.workplace : '') })]));
		}

		// Steps.
		var steps = (plan.has_lunch && !plan.lunch_auto) || st.punches.inizio_pausa ? ['entrata', 'inizio_pausa', 'fine_pausa', 'uscita'] : ['entrata', 'uscita'];
		var stepEls = h('div', { class: 'dolly-steps' + (steps.length === 2 ? ' dolly-steps--2' : ''), role: 'list', 'aria-label': 'Timbrature di oggi' }, steps.map(function (k) {
			var p = st.punches[k];
			var cls = 'dolly-step' + (p ? ' is-done' : '') + (st.primary === k ? ' is-next' : '');
			return h('div', { class: cls, role: 'listitem' }, [
				h('div', { class: 'dolly-step__label' }, [DOLLY.icon(ACTIONS[k].icon), ACTIONS[k].label]),
				h('div', { class: 'dolly-step__time', text: p ? p.time : '—' }),
				h('span', { class: 'dolly-sr-only', text: p ? 'registrata' : 'da registrare' })
			]);
		}));
		clockChildren.push(stepEls);

		blocks.push(DOLLY.card(null, null, h('div', { class: 'dolly-clock', dataset: { tour: 'clock' } }, clockChildren), { accent: true }));

		// Today's info.
		var sched = plan.eligible ? plan.start + '–' + plan.end + (plan.has_lunch ? ' · pausa ' + plan.lunch_start + '–' + plan.lunch_end + (plan.lunch_auto ? ' (conteggiata in automatico, non serve timbrarla)' : '') : ' · senza pausa') : 'Riposo';
		if (plan.extension_end) { sched += ' · straordinario fino alle ' + plan.extension_end; }
		if (plan.rest_day_extra) { sched = 'Straordinario in giorno di riposo: ' + sched; }
		if (plan.on_call) { sched = 'Contratto a chiamata: inizi e termini il turno quando vieni chiamato. Le ore vengono approvate dall\'amministratore.'; }
		if (plan.closure) {
			sched = plan.closure + ': la tua sede è chiusa e non devi timbrare. ' + (plan.closure_type === 'holiday'
				? 'Se lavori comunque, le ore di oggi sono festive, con maggiorazione.'
				: 'Se lavori comunque, le ore di oggi sono conteggiate come ore ordinarie.');
		}
		blocks.push(DOLLY.card('Oggi', 'calendar-check', h('dl', { class: 'dolly-dl', dataset: { tour: 'today' } }, [
			plan.holiday ? h('dt', { text: 'Festività' }) : null, plan.holiday ? h('dd', { text: plan.holiday }) : null,
			h('dt', { text: 'Orario' }), h('dd', { text: sched }),
			h('dt', { text: 'Sedi' }), h('dd', { text: me.workplaces.map(function (w) { return w.name; }).join(', ') || 'Nessuna' }),
			h('dt', { text: 'Verifica' }), h('dd', { text: modeLabel(st.verification_mode) })
		])));

		// Open anomalies.
		var anomBox = h('div', {}, DOLLY.loading());
		blocks.push(DOLLY.card('Anomalie aperte', 'triangle-alert', anomBox));
		DOLLY.render(main, blocks);
		DOLLY.api('anomalies', { query: { status: 'open' } }).then(function (res) {
			DOLLY.render(anomBox, res.items.length ? res.items.map(anomalyItem) : DOLLY.empty('Nessuna anomalia aperta', 'Tutto in ordine.', 'circle-check'));
		}, function (err) { DOLLY.render(anomBox, DOLLY.errorState(err)); });

		if (state.pendingQr) {
			var code = state.pendingQr; state.pendingQr = null;
			if (st.primary && !st.blocked) { startPunch(st.primary, false, code); }
			else { DOLLY.toast(st.blocked || 'Non ci sono timbrature da registrare ora.', 'info'); }
		}
	}

	function modeLabel(m) {
		return { gps: 'Posizione GPS', qrpin: 'QR o PIN della sede', either: 'Posizione GPS oppure QR/PIN', both: 'Posizione GPS e QR/PIN' }[m] || m;
	}

	function anomalyItem(a) {
		var note = h('div', { class: 'dolly-small dolly-muted', text: a.employee_note ? 'La tua nota: ' + a.employee_note : '' });
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
					a.type === 'missing_certificate' ? DOLLY.button('Carica certificato', { size: 'sm', icon: 'file-up', href: a.related_type === 'request' ? '#richieste' : '#malattia' }) : null,
					fix ? DOLLY.button('Richiedi correzione timbratura', { size: 'sm', variant: 'primary', icon: 'pencil', onClick: function () { requestDialog({ type: 'correzione', correction_action: fix, start_date: a.work_date }); } }) : null,
					DOLLY.button(a.employee_note ? 'Modifica nota' : 'Aggiungi nota', { size: 'sm', icon: 'pencil', onClick: function () { anomalyNoteDialog(a); } })
				])
			])
		]);
	}

	function anomalyNoteDialog(a) {
		var f = DOLLY.field({ label: 'Nota per l\'amministratore', name: 'note', type: 'textarea', value: a.employee_note, optional: true });
		var form = h('form', { class: 'dolly-form' }, f);
		DOLLY.dialog({
			title: 'Nota sull\'anomalia', body: form,
			actions: [
				{ label: 'Annulla' },
				{ label: 'Salva nota', variant: 'primary', icon: 'save', onClick: function (close, btn) {
					DOLLY.busy(btn, DOLLY.api('anomalies/' + a.id + '/note', { method: 'POST', body: { note: f.input.value } })).then(function () {
						close(); DOLLY.toast('Nota salvata.', 'success'); viewDashboard();
					}, function (err) { DOLLY.formError(form, err); });
				} }
			]
		});
	}

	/* ---------- Verification helpers ---------- */

	function getPosition() {
		return new Promise(function (resolve, reject) {
			if (!window.isSecureContext) { reject(new Error('La posizione è disponibile solo tramite connessione sicura (HTTPS).')); return; }
			if (!navigator.geolocation) { reject(new Error('Questo browser non supporta la geolocalizzazione. Usa il QR o il PIN.')); return; }
			navigator.geolocation.getCurrentPosition(function (pos) {
				resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
			}, function (e) {
				var msg = {
					1: 'Accesso alla posizione negato. Consenti la posizione per questo sito nelle impostazioni del browser (su iPhone: Impostazioni › Privacy › Localizzazione › Safari) oppure usa QR/PIN.',
					2: 'Posizione non disponibile. Verifica che il GPS sia attivo e riprova, oppure usa QR/PIN.',
					3: 'Tempo scaduto per rilevare la posizione. Riprova all\'aperto oppure usa QR/PIN.'
				}[e.code] || 'Impossibile rilevare la posizione.';
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
				reject(new Error('La fotocamera non è disponibile in questo browser o senza HTTPS. Inserisci il PIN.'));
				return;
			}
			video = h('video', { playsinline: true, muted: true, autoplay: true, 'aria-label': 'Anteprima fotocamera' });
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
				var msg = e && e.name === 'NotAllowedError' ? 'Accesso alla fotocamera negato. Consenti la fotocamera per questo sito nelle impostazioni del browser oppure inserisci il PIN.'
					: (e && e.name === 'NotFoundError' ? 'Nessuna fotocamera trovata. Inserisci il PIN.' : 'Impossibile avviare la fotocamera. Inserisci il PIN.');
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
		var mode = demo ? 'either' : st.verification_mode;
		var exceptionActive = !demo && st.exception && st.exception.active;
		var needsGps = !exceptionActive && (mode === 'gps' || mode === 'both');
		var needsQr = !exceptionActive && (mode === 'qrpin' || mode === 'both');
		var either = !exceptionActive && mode === 'either';
		var ctx = { action: action, key: DOLLY.requestKey(), gps: null, ticket: null, workplace: null, scanner: null };
		var body = h('div', { class: 'dolly-stack' });
		var dlg = DOLLY.dialog({
			title: ACTIONS[action].label + (isEarlyExit ? ' anticipata' : ''),
			body: body,
			onClose: function () { if (ctx.scanner) { ctx.scanner.stop(); } }
		});

		function show(nodes) { DOLLY.render(body, nodes); }
		function fail(err, retry, alt) {
			show([DOLLY.alert(err.message, 'error'), h('div', { class: 'dolly-btn-row' }, [
				retry ? DOLLY.button('Riprova', { icon: 'refresh-cw', variant: 'primary', onClick: retry }) : null,
				alt || null,
				DOLLY.button('Chiudi', { onClick: function () { dlg.close(); } })
			])]);
		}

		function stepStart() {
			if (exceptionActive) { return stepConfirm(); }
			if (presetQr) { var c = presetQr; presetQr = null; return verifyCode('qr', c, afterQr); }
			if (either) {
				var gpsBtn = DOLLY.button('Usa la mia posizione', { icon: 'locate-fixed', variant: 'primary', block: true, onClick: function () { stepGps(stepConfirm); } });
				var qrBtn = DOLLY.button('Scansiona il QR della sede', { icon: 'scan-line', block: true, onClick: function () { stepQr(stepConfirm); } });
				gpsBtn.dataset.tour = 'gps';
				qrBtn.dataset.tour = 'qr';
				show([
					h('p', { text: 'Scegli come verificare la tua presenza in sede.' }),
					h('div', { class: 'dolly-stack', dataset: { tour: 'methods' } }, [
						gpsBtn,
						qrBtn,
						DOLLY.button('Inserisci il PIN della sede', { icon: 'hash', block: true, onClick: function () { stepPin(stepConfirm); } })
					])
				]);
				return;
			}
			if (needsGps) { return stepGps(needsQr ? stepQrChoice : stepConfirm); }
			if (needsQr) { return stepQrChoice(); }
			stepConfirm();
		}
		function afterQr() { return needsGps && !ctx.gps ? stepGps(stepConfirm) : stepConfirm(); }

		function stepQrChoice() {
			show([
				needsGps && ctx.gps ? DOLLY.alert('Posizione acquisita.', 'success') : null,
				h('p', { text: 'Verifica con il codice mostrato sullo schermo della sede.' }),
				h('div', { class: 'dolly-stack' }, [
					DOLLY.button('Scansiona il QR', { icon: 'scan-line', variant: 'primary', block: true, onClick: function () { stepQr(stepConfirm); } }),
					DOLLY.button('Inserisci il PIN', { icon: 'hash', block: true, onClick: function () { stepPin(stepConfirm); } })
				])
			]);
		}

		function stepGps(next) {
			if (demo) { ctx.gps = { accuracy: 10 }; next(); return; }
			show(DOLLY.loading('Rilevamento della posizione in corso… La posizione viene letta solo ora, per questa timbratura.'));
			getPosition().then(function (pos) { ctx.gps = pos; next(); }, function (err) {
				var alt = (either || needsQr) ? DOLLY.button('Usa QR o PIN', { icon: 'scan-line', onClick: function () { needsGps = false; either = false; needsQr = true; stepQrChoice(); } }) : null;
				if (mode === 'both') { alt = null; }
				fail(err, function () { stepGps(next); }, alt);
			});
		}

		function stepQr(next) {
			var box = h('div');
			show([h('p', { text: 'Inquadra il QR sullo schermo della sede.' }), box, h('div', { class: 'dolly-btn-row' }, [
				DOLLY.button('Inserisci il PIN', { icon: 'hash', onClick: function () { if (ctx.scanner) { ctx.scanner.stop(); } stepPin(next); } })
			])]);
			ctx.scanner = scanQr(box);
			ctx.scanner.then(function (text) { ctx.scanner = null; verifyCode('qr', text, next); }, function (err) {
				ctx.scanner = null;
				fail(err, function () { stepQr(next); }, DOLLY.button('Inserisci il PIN', { icon: 'hash', onClick: function () { stepPin(next); } }));
			});
		}

		function stepPin(next) {
			var f = DOLLY.field({ label: 'PIN della sede (6 cifre)', name: 'pin', attrs: { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', class: 'dolly-input dolly-pin-input' } });
			var form = h('form', { class: 'dolly-form', novalidate: true }, [f, DOLLY.button('Verifica PIN', { type: 'submit', variant: 'primary', icon: 'shield-check', block: true })]);
			form.addEventListener('submit', function (e) {
				e.preventDefault();
				var v = f.input.value.replace(/\D/g, '');
				if (v.length !== 6) { DOLLY.showErrors(form, { pin: 'Inserisci le 6 cifre del PIN.' }); return; }
				verifyCode('pin', v, next, form);
			});
			show([h('p', { text: 'Il PIN cambia ogni 15 secondi: inserisci quello mostrato ora.' }), form]);
		}

		function verifyCode(type, code, next, form) {
			var btn = form ? form.querySelector('button[type=submit]') : null;
			var p = DOLLY.api('attendance/verify', { method: 'POST', body: { type: type, code: code } });
			if (!form) { show(DOLLY.loading('Verifica del codice…')); }
			DOLLY.busy(btn, p).then(function (res) {
				ctx.ticket = res.ticket; ctx.workplace = res.workplace; next();
			}, function (err) {
				if (form && err.status === 400 && err.code === 'dolly_pin_invalid') { DOLLY.showErrors(form, { pin: err.message }); return; }
				var retry = type === 'qr' ? function () { stepQr(next); } : function () { stepPin(next); };
				fail(err, retry, type === 'qr' ? DOLLY.button('Inserisci il PIN', { icon: 'hash', onClick: function () { stepPin(next); } }) : null);
			});
		}

		function stepConfirm() {
			var lines = [];
			if (demo) { lines.push(DOLLY.alert('Esempio del tutorial: nessuna timbratura verrà registrata.', 'info')); }
			if (exceptionActive) { lines.push(DOLLY.alert('Eccezione dell\'amministratore attiva: verifica non richiesta.', 'info')); }
			if (ctx.workplace) { lines.push(DOLLY.alert('Sede verificata: ' + ctx.workplace.name, 'success')); }
			if (ctx.gps) { lines.push(DOLLY.alert('Posizione acquisita (precisione ±' + Math.round(ctx.gps.accuracy) + ' m).', 'success')); }
			if (isEarlyExit) { lines.push(DOLLY.alert('Stai registrando l\'uscita definitiva: la giornata verrà chiusa e non potrai registrare altre timbrature oggi.', 'warning')); }
			var confirmBtn = h('button', { type: 'button', class: 'dolly-btn dolly-btn--primary dolly-btn--block', dataset: { tour: 'confirm' } }, [DOLLY.icon(ACTIONS[action].icon), h('span', { text: 'Conferma ' + ACTIONS[action].label.toLowerCase() })]);
			confirmBtn.addEventListener('click', function () { submit(confirmBtn); });
			show([h('p', { text: 'L\'orario registrato sarà quello del server al momento della conferma.' }), lines, confirmBtn, DOLLY.button('Annulla', { block: true, onClick: function () { dlg.close(); } })]);
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
					fail(err, function () { stepQrChoice(); });
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
			pageTitle('Calendario e presenze', [DOLLY.button('Nuova richiesta', { variant: 'primary', icon: 'calendar-plus', onClick: function () { requestDialog({}); } })]),
			DOLLY.card(null, null, [calEl, legend(), h('p', { class: 'dolly-small dolly-muted', style: 'margin:12px 0 0', text: 'Tocca un giorno per creare una richiesta a partire da quella data.' })]),
			DOLLY.card('Presenze del mese', 'table', monthBox)
		]);
		if (!window.FullCalendar) { DOLLY.render(calEl, DOLLY.alert('Calendario non disponibile.', 'error')); }
		else {
			calendar = new window.FullCalendar.Calendar(calEl, {
				locale: 'it', firstDay: 1, initialView: 'dayGridMonth', height: 'auto', timeZone: 'local',
				headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
				buttonText: { today: 'Oggi' },
				dayMaxEvents: 3,
				eventOrder: 'order,start,-duration,allDay,title',
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
		var items = [['var(--dolly-blue-bg)', 'Ferie'], ['var(--dolly-cat-permesso-bg)', 'Permesso'], ['var(--dolly-cat-donazione-bg)', 'Donazione sangue'], ['var(--dolly-accent-soft)', 'Straordinario'], ['var(--dolly-red-bg)', 'Malattia / infortunio'], ['var(--dolly-cat-festivo-bg)', 'Festività'], ['var(--dolly-surface-3)', 'Chiusura collettiva'], ['var(--dolly-cat-chiusura-festiva-bg)', 'Chiusura per festività'], ['var(--dolly-green-bg)', 'Giornata lavorata'], ['var(--dolly-amber-bg)', 'Giornata incompleta'], ['var(--dolly-surface)', 'Richiesta in attesa']];
		return h('div', { class: 'dolly-legend', 'aria-label': 'Legenda' }, items.map(function (i) {
			return h('span', {}, [h('i', { style: 'background:' + i[0] + ';border:1px solid var(--dolly-border-strong)', 'aria-hidden': 'true' }), i[1]]);
		}));
	}

	function monthSelectors(onChange) {
		var years = [];
		for (var y = state.year + 1; y >= state.year - 5; y--) { years.push({ value: y, label: String(y) }); }
		var m = DOLLY.field({ label: 'Mese', type: 'select', value: state.month, options: DOLLY.MONTHS.map(function (n, i) { return { value: i + 1, label: n }; }) });
		var yy = DOLLY.field({ label: 'Anno', type: 'select', value: state.year, options: years });
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
			{ label: 'Data', render: function (r) { return h('span', {}, [h('strong', { text: r.date_label }), h('br'), h('span', { class: 'dolly-small dolly-muted', text: r.weekday + (r.holiday ? ' · ' + r.holiday : '') + (r.closure ? ' · ' + r.closure + (r.closure_label && r.closure_label !== r.closure ? ' (' + r.closure_label.toLowerCase() + ')' : '') : '') })]); } },
			{ label: 'Stato', render: function (r) { return DOLLY.dayStatusBadge(r.status); } },
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
				return b.length ? h('div', { class: 'dolly-btn-row' }, b) : '—';
			} },
			{ label: 'Ore', num: true, render: DOLLY.hoursCell },
			{ label: 'Straordinario', render: DOLLY.extraCell },
			{ label: 'Giustificativi', render: function (r) { return DOLLY.hoursCodes(r.hours); } },
			{ label: 'Anomalie', render: function (r) { return r.anomalies.length ? h('div', { class: 'dolly-btn-row' }, r.anomalies.map(function (a) { return DOLLY.badge(a, 'red', 'triangle-alert'); })) : '—'; } }
		];
		var foot = h('tfoot', {}, h('tr', {}, [
			h('td', { colspan: 7, text: 'Totale ' + data.month_label + (data.provisional ? ' (provvisorio)' : '') }),
			h('td', { class: 'num', text: data.total }),
			h('td', { colspan: 3, text: DOLLY.monthTotals(data) })
		]));
		return h('div', {}, [
			DOLLY.table(cols, data.rows, {
				caption: 'Presenze ' + data.month_label, foot: foot,
				rowClass: function (r) { return (r.date === today ? 'is-today ' : '') + (r.status === 'riposo' ? 'is-weekend' : ''); }
			}),
			DOLLY.hoursSummary(data)
		]);
	}

	/* ------------------------------------------------------------------ */
	/* Requests                                                            */
	/* ------------------------------------------------------------------ */

	var TYPE_OPTIONS = [
		{ value: 'ferie', label: 'Ferie (giornate intere)' },
		{ value: 'permesso', label: 'Permesso orario' },
		{ value: 'donazione', label: 'Donazione sangue' },
		{ value: 'correzione', label: 'Correzione timbratura' }
	];

	/** Shown in red above "Tipo di richiesta" and in the tutorial. */
	var LEGAL_NOTICE = 'In ogni caso, ogni richiesta è soggetta a verifica da parte del datore di lavoro e può essere revocata, anche dopo essere stata approvata.';

	var LEAVE_KINDS = [
		{ value: 'retribuito', label: 'Permesso ordinario retribuito', description: 'Ore di assenza pagate.', help: 'Ore di assenza pagate, scalate dal tuo monte ore di permessi (permessi, ROL, ex festività). È il permesso da usare per le normali esigenze personali.' },
		{ value: 'non_retribuito', label: 'Permesso ordinario non retribuito', description: 'Ore di assenza non pagate.', help: 'Ore di assenza concesse dall\'azienda ma non pagate: non vengono scalate dal monte ore e non sono retribuite in busta paga.' },
		{ value: 'evento', label: 'Congedi e permessi per eventi specifici', description: 'Legge 104, lutto, matrimonio, studio… Nota obbligatoria.', help: 'Permessi previsti dalla legge o dal contratto per situazioni particolari: Legge 104, lutto o grave infermità di un familiare, matrimonio, nascita di un figlio, esami e studio, visite mediche e simili. Nella nota devi indicare l\'evento; può essere richiesta la documentazione.' }
	];

	/** Certificate of a blood donation request: state, files and upload. */
	function donationCertificate(r) {
		if (r.type !== 'donazione' || !r.certificate_status || r.certificate_status === 'not_required') { return null; }
		var needs = r.certificate_status === 'missing' || r.certificate_status === 'overdue';
		var tone = { waiting: ['neutral', 'hourglass'], missing: ['red', 'file-text'], overdue: ['red', 'clock-alert'], uploaded: ['green', 'circle-check'], cleared: ['neutral', 'ban'] }[r.certificate_status] || ['neutral', 'info'];
		var nodes = [h('div', { style: 'margin-top:6px' }, DOLLY.badge(r.certificate_label, tone[0], tone[1]))];
		if (needs && r.certificate_due) { nodes.push(h('div', { class: 'dolly-small', text: 'Scadenza certificato: ' + DOLLY.fmt.date(r.certificate_due) })); }
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
		var btn = DOLLY.button(needs ? 'Carica certificato' : 'Aggiungi file', { icon: 'file-up', variant: needs ? 'primary' : null, size: 'sm', onClick: function () { fileInput.click(); } });
		fileInput.addEventListener('change', function () {
			var file = fileInput.files[0];
			if (!file) { return; }
			if (file.size > 10 * 1024 * 1024) { DOLLY.toast('Il file supera i 10 MB.', 'error'); fileInput.value = ''; return; }
			if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) { DOLLY.toast('Formato non consentito: carica PDF, JPG o PNG.', 'error'); fileInput.value = ''; return; }
			var fd = new FormData(); fd.append('file', file);
			DOLLY.busy(btn, DOLLY.api('requests/' + r.id + '/certificate', { method: 'POST', form: fd, timeout: 120000 })).then(function () {
				DOLLY.toast('Certificato di donazione caricato.', 'success');
				if (state.section === 'richieste') { viewRequests(); }
			}, function (err) { DOLLY.toast(err.message, 'error'); fileInput.value = ''; });
		});
		return h('span', {}, [btn, h('label', { for: fileInput.id, class: 'dolly-sr-only', text: 'Scegli il file del certificato di donazione' }), fileInput]);
	}

	function viewRequests() {
		var box = h('div', {}, DOLLY.loading());
		var statusF = DOLLY.field({ label: 'Stato', type: 'select', value: state.reqStatus, options: [{ value: '', label: 'Tutti' }, { value: 'pending', label: 'In attesa' }, { value: 'approved', label: 'Approvate' }, { value: 'rejected', label: 'Respinte' }, { value: 'cancelled', label: 'Annullate' }] });
		statusF.input.addEventListener('change', function () { state.reqStatus = statusF.input.value; state.reqPage = 1; load(); });
		DOLLY.render(main, [
			pageTitle('Richieste', [tourTag(DOLLY.button('Nuova richiesta', { variant: 'primary', icon: 'plus', onClick: function () { requestDialog({}); } }), 'new-request')]),
			tourTag(DOLLY.card(null, null, [h('div', { class: 'dolly-toolbar' }, statusF), box]), 'requests-list')
		]);
		function load() {
			DOLLY.render(box, DOLLY.loading());
			DOLLY.api('requests', { query: { page: state.reqPage, status: state.reqStatus } }).then(function (res) {
				DOLLY.render(box, [
					DOLLY.table([
						{ label: 'Richiesta', render: function (r) { return h('div', {}, [h('strong', { text: r.type_label }), h('div', { class: 'dolly-small', text: r.summary }), r.notes ? h('div', { class: 'dolly-small dolly-muted', text: 'Note: ' + r.notes }) : null, donationCertificate(r)]); } },
						{ label: 'Stato', render: function (r) { return h('div', { class: 'dolly-btn-row' }, [DOLLY.requestBadge(r.status, r.status_label), r.pending_amendment ? DOLLY.badge(r.pending_amendment.amend_action === 'cancel' ? 'Annullamento in attesa' : 'Modifica in attesa', 'amber', 'hourglass') : null]); } },
						{ label: 'Esito', render: function (r) { return r.decided_at ? h('div', { class: 'dolly-small' }, [DOLLY.fmt.dateTime(r.decided_at) + ' · ' + r.decided_by, r.decision_note ? h('div', { class: 'dolly-muted', text: r.decision_note }) : null]) : '—'; } },
						{ label: 'Inviata', render: function (r) { return DOLLY.fmt.dateTime(r.created_at); } },
						{ label: '', srLabel: 'Azioni', render: requestActions }
					], res.items, { empty: ['Nessuna richiesta', 'Crea una richiesta dal pulsante o dal calendario.', 'inbox'], caption: 'Le tue richieste' }),
					DOLLY.pagination(res, function (p) { state.reqPage = p; load(); }, 'richieste')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function requestActions(r) {
		var btns = [];
		if (r.type === 'turno' || r.type === 'straordinario') { return h('span', { class: 'dolly-small dolly-muted', text: 'Gestito dall\'amministratore' }); }
		var editable = (r.status === 'pending' && r.amend_action !== 'cancel') || (r.status === 'approved' && r.type !== 'correzione' && r.amend_action !== 'cancel' && !r.pending_amendment);
		if (editable) {
			btns.push(DOLLY.button(r.status === 'approved' ? 'Chiedi modifica' : 'Modifica', { size: 'sm', icon: 'pencil', onClick: function () { requestDialog(r); } }));
		}
		if (r.status === 'pending') {
			btns.push(DOLLY.button('Elimina', { size: 'sm', icon: 'trash-2', onClick: function () { cancelRequest(r, false); } }));
		} else if (editable) {
			btns.push(DOLLY.button('Chiedi annullamento', { size: 'sm', icon: 'ban', onClick: function () { cancelRequest(r, true); } }));
		}
		if (r.type === 'donazione' && r.can_upload) { btns.unshift(donationUpload(r)); }
		return h('div', { class: 'dolly-actions' }, btns);
	}

	function cancelRequest(r, approved) {
		DOLLY.confirm(approved ? 'Chiedere l\'annullamento?' : 'Eliminare la richiesta?',
			approved ? 'La richiesta approvata resta valida finché l\'amministratore non approva l\'annullamento.' : 'La richiesta in attesa verrà annullata e resterà nello storico.',
			approved ? 'Invia richiesta di annullamento' : 'Elimina', 'danger').then(function (ok) {
			if (!ok) { return; }
			DOLLY.api('requests/' + r.id, { method: 'DELETE' }).then(function () {
				DOLLY.toast(approved ? 'Richiesta di annullamento inviata.' : 'Richiesta eliminata.', 'success');
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
		var typeF = DOLLY.field({ label: 'Tipo di richiesta', name: 'type', type: 'select', value: r.type || 'ferie', options: TYPE_OPTIONS, attrs: isEdit ? { disabled: true } : {} });
		var dynamic = h('div', { class: 'dolly-form-grid', dataset: { tour: 'request-fields' } });
		var notesF = DOLLY.field({ label: 'Note', name: 'notes', type: 'textarea', value: r.notes || '', optional: true, full: true });
		var legal = h('p', { class: 'dolly-legal', role: 'note', dataset: { tour: 'request-legal' }, text: LEGAL_NOTICE });
		var form = h('form', { class: 'dolly-form', novalidate: true, dataset: { tour: 'request-form' } }, [alertBox, legal, typeF, dynamic, notesF]);
		var f = {};
		var leaveKind = r.leave_kind || '';

		/** Notes are mandatory for corrections and for leaves for specific events. */
		function notesLabel() {
			var t = typeF.input.value;
			var required = t === 'correzione' || (t === 'permesso' && leaveKind === 'evento');
			notesF.querySelector('.dolly-optional').hidden = required;
			notesF.querySelector('label').firstChild.textContent = t === 'correzione' ? 'Motivo della correzione' : (required ? 'Evento per cui chiedi il permesso (obbligatorio)' : 'Note');
		}

		/** Kind of hourly leave, with the help button that explains the three kinds. */
		function leaveKindField() {
			var law = DOLLY.switchControl({ label: 'Permesso Legge 104', name: 'law104', checked: !!r.law104, description: 'Attivalo solo se il permesso rientra nella Legge 104.' });
			var lawBox = h('div', { class: 'dolly-field--full', hidden: leaveKind !== 'evento' }, law);
			var radios = DOLLY.radios({ label: 'Tipo di permesso', name: 'leave_kind', value: leaveKind, full: true, options: LEAVE_KINDS, onChange: function (v) { leaveKind = v; lawBox.hidden = v !== 'evento'; notesLabel(); } });
			var helpBox = h('div', { hidden: true, id: DOLLY.uid('help') }, DOLLY.alert(null, 'info', h('ul', { class: 'dolly-help-list' }, LEAVE_KINDS.map(function (k) {
				return h('li', {}, [h('strong', { text: k.label }), k.help]);
			}))));
			var helpBtn = h('button', { type: 'button', class: 'dolly-help-btn', 'aria-label': 'Cosa sono i tipi di permesso?', 'aria-expanded': 'false', 'aria-controls': helpBox.id, title: 'Cosa sono i tipi di permesso?' }, DOLLY.icon('circle-help'));
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
				f.start_date = DOLLY.dateField({ label: 'Dal', name: 'start_date', value: r.start_date, required: true });
				f.end_date = DOLLY.dateField({ label: 'Al', name: 'end_date', value: r.end_date || r.start_date, required: true });
				nodes.push(f.start_date, f.end_date);
				if (t === 'permesso') {
					f.start_time = DOLLY.timeField({ label: 'Dalle ore', name: 'start_time', value: r.start_time, required: true });
					f.end_time = DOLLY.timeField({ label: 'Alle ore', name: 'end_time', value: r.end_time, required: true });
					nodes.push(f.start_time, f.end_time);
				}
			} else if (t === 'donazione') {
				var ds = state.me ? state.me.settings : {};
				f.start_date = DOLLY.dateField({ label: 'Giorno della donazione', name: 'start_date', value: r.start_date, required: true });
				nodes.push(f.start_date, h('div', { class: 'dolly-field--full' }, DOLLY.alert(
					'Assenza per l\'intera giornata della donazione. ' + (ds.donation_certificate_mode === 'disabled'
						? 'Il certificato di donazione non è richiesto.'
						: 'Dal giorno successivo alla donazione dovrai caricare qui in Richieste il certificato di donazione' + (ds.donation_certificate_mode === 'deadline' ? ', entro ' + ds.donation_certificate_days + ' giorni.' : '.')), 'info')));
			} else if (t === 'correzione') {
				f.start_date = DOLLY.dateField({ label: 'Data', name: 'start_date', value: r.start_date, required: true });
				f.correction_action = DOLLY.field({ label: 'Timbratura', name: 'correction_action', type: 'select', value: r.correction_action || 'uscita', options: Object.keys(ACTIONS).map(function (k) { return { value: k, label: ACTIONS[k].label }; }) });
				f.start_time = DOLLY.timeField({ label: 'Orario corretto', name: 'start_time', value: r.start_time, required: true });
				nodes.push(f.start_date, f.correction_action, f.start_time);
			}
			DOLLY.closePicker();
			DOLLY.render(dynamic, nodes);
			notesLabel();
		}
		typeF.input.addEventListener('change', build);
		build();

		DOLLY.dialog({
			title: isEdit ? (r.status === 'approved' ? 'Chiedi modifica' : 'Modifica richiesta') : 'Nuova richiesta',
			body: [r.status === 'approved' ? DOLLY.alert('La modifica richiede l\'approvazione dell\'amministratore. Fino ad allora resta valida la richiesta approvata.', 'info') : null, form],
			actions: [
				{ label: 'Annulla' },
				{ label: isEdit ? 'Invia modifica' : 'Invia richiesta', variant: 'primary', icon: 'send', onClick: function (close, btn) {
					DOLLY.clearErrors(form); alertBox.hidden = true;
					var t = typeF.input.value;
					var spec = {};
					['start_date', 'end_date'].forEach(function (k) { if (f[k]) { spec[k] = [f[k], 'date', true]; } });
					['start_time', 'end_time'].forEach(function (k) { if (f[k]) { spec[k] = [f[k], 'time', true]; } });
					var read = DOLLY.readDateTimes(spec);
					if (t === 'permesso') {
						if (!leaveKind) { read.errors.leave_kind = 'Scegli il tipo di permesso.'; }
						else if (leaveKind === 'evento' && !notesF.input.value.trim()) { read.errors.notes = 'Indica l\'evento per cui chiedi il permesso.'; }
					}
					if (Object.keys(read.errors).length) { DOLLY.showErrors(form, read.errors); return; }
					var body = Object.assign({ type: t, notes: notesF.input.value }, read.values);
					if (t === 'permesso') { body.leave_kind = leaveKind; body.law104 = leaveKind === 'evento' && f.law104.control.isOn(); }
					if (t === 'correzione') { body.correction_action = f.correction_action.input.value; }
					if (!body.end_date && body.start_date) { body.end_date = body.start_date; }
					var p = isEdit ? DOLLY.api('requests/' + r.id, { method: 'PUT', body: body }) : DOLLY.api('requests', { method: 'POST', body: body });
					DOLLY.busy(btn, p).then(function () {
						close();
						DOLLY.toast(isEdit && r.status === 'approved' ? 'Modifica inviata per approvazione.' : (isEdit ? 'Richiesta aggiornata.' : 'Richiesta inviata.'), 'success');
						route();
					}, function (err) { DOLLY.formError(form, err, alertBox); });
				} }
			]
		});
	}

	/* ------------------------------------------------------------------ */
	/* Sickness & certificates                                             */
	/* ------------------------------------------------------------------ */

	function viewSickness() {
		var box = h('div', {}, DOLLY.loading());
		var s = state.me ? state.me.settings : {};
		var info = s.certificate_mode === 'disabled' ? 'Il certificato medico non è richiesto.'
			: (s.certificate_mode === 'deadline' ? 'Il certificato medico è obbligatorio entro ' + s.certificate_days + ' giorni di calendario dalla segnalazione.' : 'Il certificato medico è obbligatorio: caricalo appena disponibile.');
		DOLLY.render(main, [
			pageTitle('Malattia e infortunio', [tourTag(DOLLY.button('Segnala malattia/infortunio', { variant: 'primary', icon: 'stethoscope', onClick: sicknessDialog }), 'new-sickness')]),
			DOLLY.alert('La malattia o l\'infortunio vengono registrati subito, senza approvazione. ' + info, 'info'),
			tourTag(DOLLY.card('Le tue segnalazioni', 'file-text', box), 'sick-list')
		]);
		function load() {
			DOLLY.api('sickness', { query: { page: state.sickPage } }).then(function (res) {
				DOLLY.render(box, [
					res.items.length ? h('div', { class: 'dolly-stack' }, res.items.map(sicknessItem)) : DOLLY.empty('Nessuna malattia o infortunio segnalato', '', 'stethoscope'),
					DOLLY.pagination(res, function (p) { state.sickPage = p; load(); }, 'malattie')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		load();
	}

	function sicknessItem(s) {
		var needs = s.certificate_status === 'missing' || s.certificate_status === 'overdue';
		var fileInput = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png', class: 'dolly-sr-only', id: DOLLY.uid('file') });
		var uploadBtn = DOLLY.button(needs ? 'Carica certificato' : 'Aggiungi file', { icon: 'file-up', variant: needs ? 'primary' : null, size: 'sm', onClick: function () { fileInput.click(); } });
		var status = h('div', { class: 'dolly-small', 'aria-live': 'polite' });
		fileInput.addEventListener('change', function () {
			var file = fileInput.files[0];
			if (!file) { return; }
			if (file.size > 10 * 1024 * 1024) { DOLLY.render(status, DOLLY.alert('Il file supera i 10 MB.', 'error')); return; }
			if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) { DOLLY.render(status, DOLLY.alert('Formato non consentito: carica PDF, JPG o PNG.', 'error')); return; }
			var fd = new FormData(); fd.append('file', file);
			DOLLY.render(status, DOLLY.loading('Caricamento di ' + file.name + '…'));
			DOLLY.busy(uploadBtn, DOLLY.api('sickness/' + s.id + '/certificate', { method: 'POST', form: fd, timeout: 120000 })).then(function () {
				DOLLY.toast('Certificato caricato.', 'success');
				viewSickness();
			}, function (err) { DOLLY.render(status, DOLLY.alert(err.message, 'error')); fileInput.value = ''; });
		});
		return h('article', { class: 'dolly-card', style: 'box-shadow:none' }, [
			h('div', { class: 'dolly-card__head' }, [
				h('h3', { text: (s.kind_label || 'Malattia') + ' dal ' + DOLLY.fmt.date(s.start_date) + ' al ' + DOLLY.fmt.date(s.end_date) }),
				DOLLY.certBadge(s.certificate_status, s.certificate_label)
			]),
			s.reported_by_admin ? h('p', { class: 'dolly-small dolly-muted', text: 'Inserita dall\'amministratore.' }) : null,
			s.certificate_due && needs ? h('p', { class: 'dolly-small', text: 'Scadenza certificato: ' + DOLLY.fmt.date(s.certificate_due) }) : null,
			s.notes ? h('p', { class: 'dolly-small dolly-muted', text: 'Note: ' + s.notes }) : null,
			s.certificates.length ? h('ul', { class: 'dolly-small' }, s.certificates.map(function (c) {
				return h('li', {}, [h('a', { href: DOLLY.downloadUrl('certificates/' + c.id + '/download') }, [DOLLY.icon('download'), ' ' + c.original_name]), ' · ' + DOLLY.fmt.bytes(c.size) + ' · ' + DOLLY.fmt.dateTime(c.uploaded_at)]);
			})) : null,
			h('div', { class: 'dolly-btn-row' }, [uploadBtn, h('label', { for: fileInput.id, class: 'dolly-sr-only', text: 'Scegli il file del certificato' }), fileInput]),
			h('p', { class: 'dolly-help', text: 'PDF, JPG o PNG, massimo 10 MB.' }),
			status
		]);
	}

	function sicknessDialog() {
		var alertBox = h('div', { hidden: true });
		var today = DOLLY.fmt.today();
		var kind = DOLLY.radios({ label: 'Tipo', name: 'kind', value: 'malattia', full: true, options: [
			{ value: 'malattia', label: 'Malattia' },
			{ value: 'infortunio', label: 'Infortunio' }
		] });
		kind.dataset.tour = 'sick-kind';
		var sd = DOLLY.dateField({ label: 'Dal', name: 'start_date', value: today, required: true });
		var ed = DOLLY.dateField({ label: 'Al', name: 'end_date', value: today, required: true });
		var notes = DOLLY.field({ label: 'Note', name: 'notes', type: 'textarea', optional: true, full: true, help: 'Visibili solo a te e all\'amministratore. Non inserire diagnosi.' });
		var form = h('form', { class: 'dolly-form', novalidate: true }, [alertBox, h('div', { class: 'dolly-form-grid' }, [kind, sd, ed, notes])]);
		DOLLY.dialog({
			title: 'Segnala malattia/infortunio', body: form,
			actions: [
				{ label: 'Annulla' },
				{ label: 'Segnala', variant: 'primary', icon: 'send', onClick: function (close, btn) {
					DOLLY.clearErrors(form);
					var read = DOLLY.readDateTimes({ start_date: [sd, 'date', true], end_date: [ed, 'date', true] });
					if (Object.keys(read.errors).length) { DOLLY.showErrors(form, read.errors); return; }
					var k = kind.value() || 'malattia';
					DOLLY.busy(btn, DOLLY.api('sickness', { method: 'POST', body: Object.assign({ kind: k, notes: notes.input.value }, read.values) })).then(function (s) {
						close();
						DOLLY.toast(SICK_KINDS[k] + ' registrat' + (k === 'infortunio' ? 'o' : 'a') + '.' + (s.conflict ? ' Segnalato un conflitto con presenze o ferie: verrà verificato dall\'amministratore.' : ''), 'success');
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
		var readAll = DOLLY.button('Segna tutte come lette', { icon: 'check', onClick: function () {
			DOLLY.busy(readAll, DOLLY.api('notifications/read-all', { method: 'POST' })).then(function () { state.me && (state.me.unread = 0); updateBadges(); load(); });
		} });
		DOLLY.render(main, [pageTitle('Notifiche', [readAll]), DOLLY.card(null, null, box)]);
		function load() {
			DOLLY.api('notifications', { query: { page: state.notifPage } }).then(function (res) {
				if (state.me) { state.me.unread = res.unread; updateBadges(); }
				DOLLY.render(box, [
					res.items.length ? h('ul', { class: 'dolly-stack', style: 'list-style:none;padding:0;margin:0' }, res.items.map(function (n) {
						return h('li', { class: 'dolly-alert dolly-alert--' + (n.read ? 'info' : 'warning') }, [
							DOLLY.icon(n.read ? 'bell' : 'bell-ring'),
							h('div', { class: 'dolly-alert__body' }, [
								h('strong', { text: n.title }), n.read ? null : h('span', { class: 'dolly-sr-only', text: ' (non letta)' }),
								h('div', { style: 'white-space:pre-line', text: n.body }),
								h('div', { class: 'dolly-small dolly-muted', text: DOLLY.fmt.dateTime(n.created_at) }),
								h('div', { class: 'dolly-btn-row', style: 'margin-top:6px' }, [
									DOLLY.button('Apri', { size: 'sm', icon: 'arrow-right', onClick: function () { showNotification(n, load); } }),
									n.read ? null : DOLLY.button('Segna come letta', { size: 'sm', icon: 'check', onClick: function () { markRead(n).then(load); } })
								])
							])
						]);
					})) : DOLLY.empty('Nessuna notifica', 'Qui trovi esiti delle richieste, certificati e anomalie.', 'bell'),
					DOLLY.pagination(res, function (p) { state.notifPage = p; load(); }, 'notifiche')
				]);
			}, function (err) { DOLLY.render(box, DOLLY.errorState(err, load)); });
		}
		function markRead(n) {
			return DOLLY.api('notifications/' + n.id + '/read', { method: 'POST' }).then(function (r) { if (state.me) { state.me.unread = r.unread; updateBadges(); } });
		}
		load();
	}

	var SECTION_LABELS = { dashboard: 'Timbratura', calendario: 'Calendario', richieste: 'Richieste', malattia: 'Malattia', profilo: 'Profilo' };

	/**
	 * Shows one notification in a pop-up (subject, date, message) and marks it as read. When it refers to a
	 * section of the portal (e.g. a request), a button leads there.
	 */
	function showNotification(n, onClose) {
		var section = '';
		try { section = n.link ? new URL(n.link, window.location.href).hash.slice(1) : ''; } catch (e) { section = ''; }
		var go = SECTION_LABELS[section] ? { label: 'Vai a ' + SECTION_LABELS[section], icon: 'arrow-right', onClick: function (close) { close(); window.location.hash = '#' + section; } } : null;
		DOLLY.dialog({
			title: n.title,
			body: [
				h('p', { class: 'dolly-small dolly-muted', style: 'margin:0 0 8px', text: DOLLY.fmt.dateTime(n.created_at) }),
				h('div', { class: 'dolly-notice-body', text: n.body || '' })
			],
			onClose: function () { if (onClose) { onClose(); } },
			actions: [go, { label: 'Chiudi', variant: 'primary' }].filter(Boolean)
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
			var fn = DOLLY.field({ label: 'Nome', name: 'first_name', value: me.first_name, required: true, attrs: { autocomplete: 'given-name' } });
			var ln = DOLLY.field({ label: 'Cognome', name: 'last_name', value: me.last_name, required: true, attrs: { autocomplete: 'family-name' } });
			var ph = DOLLY.field({ label: 'Telefono', name: 'phone', type: 'tel', value: me.phone, optional: true, attrs: { autocomplete: 'tel' } });
			var em = DOLLY.field({ label: 'Email', name: 'email', type: 'email', value: me.email, required: true, attrs: { autocomplete: 'email' } });
			var saveBtn = DOLLY.button('Salva profilo', { type: 'submit', variant: 'primary', icon: 'save' });
			var form1 = h('form', { class: 'dolly-form', novalidate: true }, [alert1, h('div', { class: 'dolly-form-grid' }, [fn, ln, ph, em]), h('div', { class: 'dolly-btn-row' }, saveBtn)]);
			form1.addEventListener('submit', function (e) {
				e.preventDefault(); DOLLY.clearErrors(form1); alert1.hidden = true;
				DOLLY.busy(saveBtn, DOLLY.api('me/profile', { method: 'POST', body: { first_name: fn.input.value, last_name: ln.input.value, phone: ph.input.value, email: em.input.value } })).then(function () {
					DOLLY.toast('Profilo aggiornato.', 'success');
				}, function (err) { DOLLY.formError(form1, err, alert1); });
			});

			var alert2 = h('div', { hidden: true });
			var cur = DOLLY.field({ label: 'Password attuale', name: 'current_password', type: 'password', required: true, attrs: { autocomplete: 'current-password' } });
			var np = DOLLY.field({ label: 'Nuova password', name: 'new_password', type: 'password', required: true, help: 'Almeno 8 caratteri.', attrs: { autocomplete: 'new-password', minlength: 8 } });
			var np2 = DOLLY.field({ label: 'Ripeti nuova password', name: 'new_password2', type: 'password', required: true, attrs: { autocomplete: 'new-password' } });
			var pwBtn = DOLLY.button('Cambia password', { type: 'submit', variant: 'primary', icon: 'key-round' });
			var form2 = h('form', { class: 'dolly-form', novalidate: true }, [alert2, h('div', { class: 'dolly-form-grid' }, [cur, h('span'), np, np2]), h('div', { class: 'dolly-btn-row' }, pwBtn)]);
			form2.addEventListener('submit', function (e) {
				e.preventDefault(); DOLLY.clearErrors(form2); alert2.hidden = true;
				if (np.input.value.length < 8) { DOLLY.showErrors(form2, { new_password: 'Almeno 8 caratteri.' }); return; }
				if (np.input.value !== np2.input.value) { DOLLY.showErrors(form2, { new_password2: 'Le password non coincidono.' }); return; }
				DOLLY.busy(pwBtn, DOLLY.api('me/password', { method: 'POST', body: { current_password: cur.input.value, new_password: np.input.value } })).then(function () {
					DOLLY.toast('Password aggiornata. La pagina verrà ricaricata.', 'success');
					setTimeout(function () { window.location.reload(); }, 1500);
				}, function (err) { DOLLY.formError(form2, err, alert2); });
			});

			var form3 = bankForm(me);

			var s = me.schedule;
			DOLLY.render(main, [
				pageTitle('Profilo'),
				DOLLY.card('Dati personali', 'circle-user', [h('p', { class: 'dolly-muted', text: 'Nome utente: ' + me.username + ' (non modificabile)' }), form1]),
				DOLLY.card('Dati bancari', 'landmark', form3),
				DOLLY.card('Notifiche sul telefono', 'smartphone', pushCard()),
				DOLLY.card('Password', 'key-round', form2),
				DOLLY.card('Tutorial', 'graduation-cap', [
					h('p', { class: 'dolly-muted', text: 'Rivedi la guida che mostra come timbrare, inviare richieste e segnalare malattie.' }),
					DOLLY.button('Rivedi il tutorial', { icon: 'play', onClick: function () { startTour(); } })
				]),
				DOLLY.card('Contratto e orario', 'briefcase', h('dl', { class: 'dolly-dl' }, [
					h('dt', { text: 'Tipo' }), h('dd', { text: s ? s.employment_label : '—' }),
					h('dt', { text: 'Orario' }), h('dd', {}, s ? (s.on_call ? 'Nessun orario fisso: turni su chiamata, approvati dall\'amministratore.' : s.weekdays.map(function (d) {
						var t = (s.days && s.days[d]) || { start: s.start_time, end: s.end_time, lunch_start: s.lunch_start, lunch_end: s.lunch_end };
						return h('div', { text: DOLLY.WEEKDAYS[d - 1] + ': ' + t.start + '–' + t.end + (t.lunch_start ? ' · pausa ' + t.lunch_start + '–' + t.lunch_end : '') });
					})) : '—'),
					h('dt', { text: 'Sedi' }), h('dd', { text: me.workplaces.map(function (w) { return w.name; }).join(', ') || '—' })
				]))
			]);
		}, function (err) { DOLLY.render(main, DOLLY.errorState(err, viewProfile)); });
	}

	/** Bank details for salary payments. Changing the IBAN notifies the administrators. */
	function bankForm(me) {
		var b = me.bank || {};
		var alertBox = h('div', { hidden: true });
		var iban = DOLLY.field({ label: 'IBAN', name: 'iban', value: DOLLY.fmt.iban(b.iban), optional: true, full: true, attrs: { autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'IT60 X054 2811 1010 0000 0123 456' } });
		var ben = DOLLY.field({ label: 'Nome beneficiario', name: 'bank_beneficiary', value: b.bank_beneficiary, optional: true, help: 'Intestatario del conto.' });
		var bank = DOLLY.field({ label: 'Banca', name: 'bank_name', value: b.bank_name, optional: true });
		var bic = DOLLY.field({ label: 'BIC', name: 'bic', value: b.bic, optional: true, help: 'Codice BIC/SWIFT, 8 o 11 caratteri.', attrs: { autocapitalize: 'characters', spellcheck: 'false', maxlength: 11 } });
		var btn = DOLLY.button('Salva dati bancari', { type: 'submit', variant: 'primary', icon: 'save' });
		var form = h('form', { class: 'dolly-form', novalidate: true }, [
			alertBox,
			h('p', { class: 'dolly-muted', text: 'Usati per l\'accredito dello stipendio. Se modifichi l\'IBAN, l\'amministratore riceve una notifica.' }),
			h('div', { class: 'dolly-form-grid' }, [iban, ben, bank, bic]),
			h('div', { class: 'dolly-btn-row' }, btn)
		]);
		form.addEventListener('submit', function (e) {
			e.preventDefault(); DOLLY.clearErrors(form); alertBox.hidden = true;
			var value = iban.input.value.replace(/[\s-]+/g, '').toUpperCase();
			if (value && !DOLLY.isIban(value)) { DOLLY.showErrors(form, { iban: 'IBAN non valido: controlla lettere e cifre.' }); return; }
			var changed = value !== (b.iban || '');
			DOLLY.busy(btn, DOLLY.api('me/profile', { method: 'POST', body: { iban: value, bank_beneficiary: ben.input.value, bank_name: bank.input.value, bic: bic.input.value } })).then(function (res) {
				b = res.bank || {}; state.me.bank = b;
				iban.input.value = DOLLY.fmt.iban(b.iban);
				bic.input.value = b.bic || '';
				DOLLY.toast(changed ? 'Dati bancari salvati. L\'amministratore è stato avvisato del nuovo IBAN.' : 'Dati bancari salvati.', 'success');
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
		var item = sicknessItem({ id: 0, kind: 'malattia', kind_label: 'Malattia', start_date: today, end_date: today, certificate_status: 'missing', certificate_label: 'Certificato mancante', certificate_due: null, notes: '', certificates: [], reported_by_admin: false });
		item.classList.add('dolly-tour-demo');
		item.dataset.tour = 'demo-sickness';
		item.insertBefore(h('div', { style: 'margin-bottom:8px' }, DOLLY.badge('Esempio del tutorial', 'amber', 'info')), item.firstChild);
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
		var limit = [hh ? hh + (hh === 1 ? ' ora' : ' ore') : '', mm ? mm + ' minuti' : ''].filter(Boolean).join(' e ');
		return [
			h('p', {}, ['Gli straordinari ', strong('non si richiedono'), ': vengono calcolati in automatico dalle tue timbrature.']),
			bullets(min > 0 ? [
				[strong('Fino a ' + limit + ' al giorno'), ': se esci dopo la fine del turno, il tempo in più è approvato automaticamente.'],
				[strong('Oltre ' + limit), ': la parte in più resta in attesa dell\'approvazione dell\'amministratore. Ricevi una notifica con l\'esito.'],
				[strong('Giorni di riposo'), ': puoi lavorare solo se l\'amministratore ti ha autorizzato lo straordinario.']
			] : [
				[strong('Dopo la fine del turno'), ': il tempo in più resta in attesa dell\'approvazione dell\'amministratore. Ricevi una notifica con l\'esito.'],
				[strong('Giorni di riposo'), ': puoi lavorare solo se l\'amministratore ti ha autorizzato lo straordinario.']
			]),
			h('p', {}, 'Le ore di straordinario compaiono in «Calendario e presenze», colonna «Straordinario».'),
			h('p', { class: 'dolly-legal' }, 'Anche le ore di straordinario sono soggette a verifica da parte del datore di lavoro.')
		];
	}

	function tourSteps() {
		var ok = 'Ho capito';
		var requestType = function (type, title, text) {
			return { before: setRequestType(type), target: q('request-form'), title: 'Tipi di richiesta · ' + title, text: para(text), padding: 4 };
		};
		return [
			{ title: 'Benvenuto nel portale ' + DOLLY.brandName + '!', text: para(['In un paio di minuti ti mostriamo come timbrare, inviare richieste e segnalare una malattia.', 'Durante il tutorial non viene registrato nulla: è solo una prova.']), next: 'Inizia', nextIcon: 'play' },
			{ before: goTo('dashboard'), target: q('clock-btn'), mode: 'click', tap: true, scroll: true, title: 'Registra entrata', text: para(['Quando arrivi al lavoro tocca questo pulsante. Cambia testo e colore a ogni fase: entrata, pausa, uscita.', 'Provalo ora.']), hint: 'Tocca «Registra entrata»' },
			{ target: q('methods'), title: 'Come verificare la presenza', text: bullets([
				[strong('Usa la mia posizione'), ': il telefono verifica con il GPS che sei in sede.'],
				[strong('Scansiona il QR della sede'), ': inquadra il codice sullo schermo della sede. Usalo se il GPS non funziona.'],
				[strong('Inserisci il PIN della sede'), ': in alternativa al QR, il codice di 6 cifre mostrato sullo schermo.']
			]) },
			{ target: q('gps'), mode: 'click', tap: true, title: 'Usa la mia posizione', text: para(['Tocca «Usa la mia posizione».', 'Se il GPS non funziona o la posizione non viene rilevata, scegli «Scansiona il QR della sede».']), hint: 'Tocca «Usa la mia posizione»' },
			{ target: q('confirm'), mode: 'click', tap: true, title: 'Conferma entrata', text: para(['Controlla i dati e tocca «Conferma entrata». L\'orario registrato è quello del server.']), hint: 'Tocca «Conferma entrata»' },
			{ target: q('today'), scroll: true, title: 'Oggi', text: bullets([
				[strong('Orario'), ': il tuo turno di oggi e l\'eventuale pausa.'],
				[strong('Sedi'), ': dove puoi timbrare.'],
				[strong('Verifica'), ': come devi confermare la presenza (posizione, QR o PIN).']
			]), next: ok, nextIcon: 'check' },
			{ target: '.dolly-nav__link[data-section="richieste"]', mode: 'click', tap: true, title: 'Richieste', text: para(['Qui chiedi ferie, permessi, donazione sangue e correzioni delle timbrature. Tocca «Richieste».']), hint: 'Tocca «Richieste»' },
			{ target: q('requests-list'), title: 'Le tue richieste', text: para(['Qui trovi tutte le tue richieste con il loro stato: in attesa, approvata o respinta. Per ogni decisione ricevi una notifica.', 'Le richieste in attesa si possono modificare o eliminare; per quelle approvate puoi chiedere una modifica o l\'annullamento.']), next: ok, nextIcon: 'check' },
			{ target: q('new-request'), mode: 'click', tap: true, title: 'Nuova richiesta', text: para(['Tocca «Nuova richiesta» per vedere i tipi di richiesta.']), hint: 'Tocca «Nuova richiesta»' },
			requestType('ferie', 'Ferie (1 di 3)', ['Per giornate intere: indica «Dal» e «Al» e, se vuoi, una nota.', 'L\'amministratore approva o respinge la richiesta e ricevi una notifica.']),
			requestType('permesso', 'Permesso orario (2 di 3)', ['Per assentarti alcune ore: scegli il tipo di permesso (retribuito, non retribuito o per eventi specifici: il pulsante «?» li spiega), poi il giorno e l\'orario «Dalle ore» / «Alle ore».', 'Le ore di permesso approvate vengono tolte dalle ore lavorate.']),
			requestType('correzione', 'Correzione timbratura (3 di 3)', ['Se hai dimenticato di timbrare o hai sbagliato: scegli giorno e timbratura, indica l\'orario corretto e il motivo.', 'Quando la richiesta è approvata, la timbratura viene corretta.']),
			{ target: q('request-legal'), scroll: true, title: 'Verifica del datore di lavoro', text: [h('p', { class: 'dolly-legal' }, LEGAL_NOTICE)], next: ok, nextIcon: 'check', padding: 4 },
			{ target: dialogButton('Annulla'), mode: 'click', tap: true, title: 'Chiudi senza inviare', text: para(['Per ora non inviamo nulla: tocca «Annulla».']), hint: 'Tocca «Annulla»' },
			{ target: '.dolly-nav__link[data-section="malattia"]', mode: 'click', tap: true, title: 'Malattia', text: para(['Tocca «Malattia».']), hint: 'Tocca «Malattia»' },
			{ target: '#dolly-main > .dolly-alert', scroll: true, title: 'Malattia e infortunio', text: para(['Qui segnali una malattia o un infortunio: la segnalazione viene registrata subito, senza approvazione.', 'Sotto trovi le tue segnalazioni con lo stato del certificato medico.']) },
			{ target: q('new-sickness'), mode: 'click', tap: true, title: 'Segnala malattia/infortunio', text: para(['Tocca il pulsante per vedere come si fa una segnalazione.']), hint: 'Tocca «Segnala malattia/infortunio»' },
			{ target: q('sick-kind'), title: 'Tipo di segnalazione', text: [
				bullets([[strong('Malattia'), ': quando sei assente dal lavoro per motivi di salute.'], [strong('Infortunio'), ': quando subisci un infortunio sul lavoro o durante il normale tragitto tra casa e lavoro.']]),
				h('p', {}, 'Se non puoi farlo tu, la segnalazione può essere registrata anche dall\'amministratore per tuo conto.'),
				h('p', {}, 'Indica le date e, se vuoi, una nota (non inserire diagnosi).'),
				h('p', {}, ['Dopo la segnalazione devi ', strong('caricare il certificato medico'), ' nella tabella «Le tue segnalazioni».'])
			] },
			{ target: dialogButton('Annulla'), mode: 'click', tap: true, title: 'Chiudi', text: para(['Tocca «Annulla»: ti mostriamo un esempio di segnalazione.']), hint: 'Tocca «Annulla»' },
			{ before: showDemoSickness, target: function () { return document.querySelector(q('demo-sickness') + ' .dolly-btn'); }, tap: true, scroll: true, title: 'Carica il certificato', text: para(['Ogni segnalazione compare in «Le tue segnalazioni» (questa è solo un esempio).', 'Tocca «Carica certificato» e scegli il file: PDF, JPG o PNG fino a 10 MB. Finché il certificato manca, la segnalazione resta in rosso.']), next: ok, nextIcon: 'check', after: removeDemo },
			{ target: '.dolly-topbar__actions [data-section="profilo"]', mode: 'click', tap: true, title: 'Il tuo profilo', text: para(['In alto trovi le notifiche (campanella) e il tuo profilo. Tocca il profilo.']), hint: 'Tocca l\'icona del profilo' },
			{ target: 'section[aria-label="Dati personali"]', scroll: true, title: 'Dati personali', text: para(['Aggiorna nome, cognome, telefono ed email e tocca «Salva profilo». Il nome utente non si può cambiare.']) },
			{ target: 'section[aria-label="Dati bancari"]', scroll: true, title: 'Dati bancari', text: para(['IBAN, intestatario, banca e BIC per l\'accredito dello stipendio: tocca «Salva dati bancari». Se cambi l\'IBAN l\'amministratore viene avvisato.']) },
			{ target: 'section[aria-label="Notifiche sul telefono"]', scroll: true, title: 'Notifiche sul telefono', text: para(['Attiva le notifiche per ricevere esiti delle richieste, anomalie e messaggi anche con l\'app chiusa.']) },
			{ target: 'section[aria-label="Password"]', scroll: true, title: 'Cambia password', text: para(['Inserisci la password attuale e quella nuova (almeno 8 caratteri), poi tocca «Cambia password».']), next: ok, nextIcon: 'check' },
			{ before: goTo('dashboard'), target: q('today'), scroll: true, title: 'Come funzionano gli straordinari', text: overtimeText(), next: ok, nextIcon: 'check' },
			{ target: q('clock'), scroll: true, title: 'Tutto pronto!', text: para(['Da qui timbri ogni giorno.', 'Puoi rivedere il tutorial quando vuoi da Profilo › Tutorial.']), next: 'Fine', nextIcon: 'check', noSkip: true }
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
				return DOLLY.coach.show(Object.assign({ progress: 'Passo ' + (i + 1) + ' di ' + steps.length }, s));
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
				throw new Error(p === 'denied' ? 'Le notifiche sono bloccate: riattivale dalle impostazioni del telefono (Notifiche › ' + DOLLY.brandName + ').' : 'Permesso per le notifiche non concesso.');
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
			title: 'Attiva le notifiche',
			body: [h('p', { text: 'Ricevi sul telefono gli esiti delle richieste, le anomalie da sistemare e i messaggi dell\'amministrazione, anche con l\'app chiusa.' })],
			actions: [
				{ label: 'Non ora', onClick: function (close) { try { window.localStorage.setItem('dolly_push_asked', String(Date.now())); } catch (e) { /* ignore */ } close(); } },
				{ label: 'Attiva notifiche', variant: 'primary', icon: 'bell-ring', onClick: function (close, btn) {
					DOLLY.busy(btn, enablePush()).then(function () { close(); DOLLY.toast('Notifiche attivate su questo telefono.', 'success'); }, function (err) { close(); DOLLY.toast(err.message, 'error'); });
				} }
			]
		});
	}
	/** Profile card: state of the notifications on this device. */
	function pushCard() {
		var box = h('div');
		function render() {
			if (!PUSH) { DOLLY.render(box, h('p', { class: 'dolly-muted', text: 'Le notifiche sul telefono non sono disponibili. Trovi tutto nella sezione Notifiche.' })); return; }
			if (isIos() && !isStandalone()) {
				DOLLY.render(box, DOLLY.alert('Su iPhone le notifiche funzionano con il portale installato: tocca Condividi › "Aggiungi alla schermata Home", poi apri ' + DOLLY.brandName + ' dall\'icona e attiva le notifiche.', 'info'));
				return;
			}
			if (!pushSupported()) { DOLLY.render(box, h('p', { class: 'dolly-muted', text: 'Questo browser non supporta le notifiche push.' })); return; }
			var perm = window.Notification.permission;
			if (perm === 'denied') { DOLLY.render(box, DOLLY.alert('Le notifiche sono bloccate per questo sito: riattivale dalle impostazioni del telefono o del browser.', 'warning')); return; }
			if (perm === 'granted') {
				var result = h('div', { 'aria-live': 'polite', style: 'margin-top:8px' });
				var off = DOLLY.button('Disattiva su questo dispositivo', { icon: 'bell-off', onClick: function () { DOLLY.busy(off, disablePush()).then(function () { DOLLY.toast('Notifiche disattivate su questo dispositivo.', 'success'); render(); }, function (err) { DOLLY.toast(err.message, 'error'); }); } });
				// Re-registers this phone, then sends a test and shows what the push service answered.
				var test = DOLLY.button('Invia una notifica di prova', { icon: 'send', onClick: function () {
					DOLLY.busy(test, subscribePush().then(function () { return DOLLY.api('me/push/test', { method: 'POST' }); })).then(function (r) {
						var ok = r.results.filter(function (x) { return x.ok; }).length;
						var lines = r.results.map(function (x) { return x.device + ': ' + (x.ok ? 'inviata' : x.error); });
						DOLLY.render(result, DOLLY.alert(ok
							? 'Notifica di prova inviata: dovrebbe comparire tra pochi secondi.' + (isStandalone() ? ' Chiudi l\'app per vederla come notifica del telefono.' : '')
							: (r.devices ? 'Invio non riuscito.' : 'Nessun dispositivo registrato: riattiva le notifiche.'), ok ? 'success' : 'error', lines.length ? h('ul', { class: 'dolly-small', style: 'margin:6px 0 0;padding-left:18px' }, lines.map(function (l) { return h('li', { text: l }); })) : null));
					}, function (err) { DOLLY.render(result, DOLLY.alert(err.message, 'error')); });
				} });
				DOLLY.render(box, [DOLLY.alert('Notifiche attive su questo dispositivo.', 'success'), h('div', { class: 'dolly-btn-row', style: 'margin-top:8px' }, [test, off]), result]);
				return;
			}
			var on = DOLLY.button('Attiva notifiche', { variant: 'primary', icon: 'bell-ring', onClick: function () { DOLLY.busy(on, enablePush()).then(function () { DOLLY.toast('Notifiche attivate.', 'success'); render(); }, function (err) { DOLLY.toast(err.message, 'error'); render(); }); } });
			DOLLY.render(box, [h('p', { class: 'dolly-muted', text: 'Ricevi le notifiche del portale anche con l\'app chiusa.' }), on]);
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
			h('header', { class: 'dolly-topbar' }, [brand(), h('div', { class: 'dolly-topbar__actions' }, DOLLY.button('Esci', { href: CFG.logoutUrl, variant: 'ghost', icon: 'log-out', iconOnly: true }))]),
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
