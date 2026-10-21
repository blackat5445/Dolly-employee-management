/**
 * Dolly shared client: REST API (with WordPress nonce), formatting in Italian / Europe/Rome,
 * and reusable accessible components (buttons, cards, fields, switches, chips, badges, tables,
 * dialogs, pagination, toasts). Icons are produced only by the bundled Lucide library.
 */
(function (window, document) {
	'use strict';

	var CFG = window.DOLLY_CONFIG || {};
	var DOLLY = window.DOLLY = window.DOLLY || {};
	DOLLY.config = CFG;

	/**
	 * Texts are written in Italian; languages/dolly-employee-management-<locale>.js provides
	 * window.DOLLY_I18N = { "Italian text": "translation" } for the user's language.
	 */
	var I18N = window.DOLLY_I18N || {};
	function __(text) { return Object.prototype.hasOwnProperty.call(I18N, text) ? I18N[text] : text; }
	DOLLY.__ = __;
	/** "%s" placeholders filled in order, for sentences whose word order changes between languages. */
	DOLLY.sprintf = function (text) {
		var args = arguments, i = 1;
		return String(text).replace(/%s/g, function () { return i < args.length ? args[i++] : ''; });
	};
	DOLLY.lang = CFG.lang || 'it';
	/** Locale for Intl date and number formats ("it-IT", "en-US"…). */
	DOLLY.intlLocale = (CFG.locale || 'it_IT').replace('_', '-');
	/** Brand name set in Gestione Dipendenti › Aspetto. */
	var BRAND = CFG.brand || 'Dolly';
	DOLLY.brandName = BRAND;

	/* ------------------------------------------------------------------ */
	/* Icons                                                               */
	/* ------------------------------------------------------------------ */

	var iconTimer = null;
	/** Converts every <i data-lucide> into the library's SVG (debounced). */
	DOLLY.icons = function () {
		if (iconTimer) { return; }
		iconTimer = window.requestAnimationFrame(function () {
			iconTimer = null;
			if (window.lucide && window.lucide.createIcons) {
				window.lucide.createIcons({ icons: window.lucide.icons, attrs: { 'stroke-width': 2 } });
			}
		});
	};

	/* ------------------------------------------------------------------ */
	/* DOM helpers                                                         */
	/* ------------------------------------------------------------------ */

	/**
	 * h('button', {class: 'x', onclick: fn, text: 'Label'}, [children])
	 * Strings in children become text nodes (never parsed as HTML).
	 */
	function h(tag, attrs, children) {
		var el = document.createElement(tag);
		attrs = attrs || {};
		Object.keys(attrs).forEach(function (k) {
			var v = attrs[k];
			if (v === null || v === undefined || v === false) { return; }
			if (k === 'class') { el.className = v; }
			else if (k === 'text') { el.textContent = v; }
			else if (k === 'html') { el.innerHTML = v; } // Only used with static, trusted markup.
			else if (k === 'dataset') { Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; }); }
			else if (k.indexOf('on') === 0 && typeof v === 'function') { el.addEventListener(k.slice(2), v); }
			else if (k === 'value') { el.value = v; }
			else if (v === true) { el.setAttribute(k, ''); }
			else { el.setAttribute(k, String(v)); }
		});
		append(el, children);
		return el;
	}
	function append(el, children) {
		if (children === null || children === undefined || children === false) { return el; }
		if (!Array.isArray(children)) { children = [children]; }
		children.forEach(function (c) {
			if (c === null || c === undefined || c === false) { return; }
			if (Array.isArray(c)) { append(el, c); return; }
			el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
		});
		return el;
	}
	DOLLY.h = h;
	DOLLY.append = append;
	DOLLY.clear = function (el) { while (el.firstChild) { el.removeChild(el.firstChild); } return el; };
	DOLLY.render = function (el, children) { DOLLY.clear(el); append(el, children); DOLLY.icons(); return el; };

	/** Decorative icon (hidden from assistive technologies). */
	DOLLY.icon = function (name, cls) {
		return h('i', { 'data-lucide': name, 'aria-hidden': 'true', class: cls || null });
	};

	var uid = 0;
	DOLLY.uid = function (p) { uid += 1; return (p || 'dolly') + '-' + uid; };

	/* ------------------------------------------------------------------ */
	/* API                                                                 */
	/* ------------------------------------------------------------------ */

	function qs(params) {
		var parts = [];
		Object.keys(params || {}).forEach(function (k) {
			var v = params[k];
			if (v === null || v === undefined || v === '') { return; }
			if (Array.isArray(v)) { v.forEach(function (x) { parts.push(encodeURIComponent(k + '[]') + '=' + encodeURIComponent(x)); }); }
			else { parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); }
		});
		return parts.join('&');
	}
	DOLLY.qs = qs;

	DOLLY.url = function (path, params) {
		var base = CFG.root + path.replace(/^\//, '');
		var q = qs(params);
		return q ? base + (base.indexOf('?') === -1 ? '?' : '&') + q : base;
	};

	/** Download URL for authenticated GET exports (nonce in query string). */
	DOLLY.downloadUrl = function (path, params) {
		var p = Object.assign({}, params || {}, { _wpnonce: CFG.nonce });
		return DOLLY.url(path, p);
	};

	/**
	 * DOLLY.api('attendance/punch', {method:'POST', body:{...}}) -> Promise<json>
	 * Rejects with Error having .status, .code, .fields, .data.
	 */
	DOLLY.api = function (path, opts) {
		opts = opts || {};
		var method = opts.method || 'GET';
		var headers = { 'X-WP-Nonce': CFG.nonce, 'Accept': 'application/json' };
		var body;
		if (opts.form) {
			body = opts.form;
		} else if (opts.body !== undefined) {
			headers['Content-Type'] = 'application/json';
			body = JSON.stringify(opts.body);
		}
		var ctrl = window.AbortController ? new AbortController() : null;
		var timeout = setTimeout(function () { if (ctrl) { ctrl.abort(); } }, opts.timeout || 20000);
		return window.fetch(DOLLY.url(path, opts.query), {
			method: method,
			headers: headers,
			body: body,
			credentials: 'same-origin',
			cache: 'no-store',
			signal: ctrl ? ctrl.signal : undefined
		}).then(function (res) {
			clearTimeout(timeout);
			var fresh = res.headers.get('X-WP-Nonce');
			if (fresh) { CFG.nonce = fresh; }
			return res.text().then(function (text) {
				var json = null;
				try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
				if (!res.ok) {
					var err = new Error((json && json.message) || __('Operazione non riuscita (errore ') + res.status + ').');
					err.status = res.status;
					err.code = json && json.code;
					err.data = json && json.data;
					err.fields = (json && json.data && json.data.fields) || null;
					if (res.status === 401 || (json && json.code === 'rest_cookie_invalid_nonce')) {
						err.message = __('Sessione scaduta. Ricarica la pagina ed effettua di nuovo l\'accesso.');
					}
					throw err;
				}
				return json;
			});
		}, function (e) {
			clearTimeout(timeout);
			var err = new Error(e && e.name === 'AbortError' ? __('Il server non risponde. Controlla la connessione e riprova.') : __('Connessione assente. Controlla la rete e riprova.'));
			err.status = 0;
			err.code = 'network';
			throw err;
		});
	};

	/* ------------------------------------------------------------------ */
	/* Formatting (Italian, Europe/Rome, DD/MM/YYYY, 24h)                  */
	/* ------------------------------------------------------------------ */

	var TZ = CFG.timezone || 'Europe/Rome';
	function parts(date) {
		var f = new Intl.DateTimeFormat(DOLLY.intlLocale, { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'long' });
		var o = {};
		f.formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
		return o;
	}
	DOLLY.fmt = {
		/** "2026-09-23" -> "23/09/2026" */
		date: function (ymd) {
			if (!ymd) { return ''; }
			var p = String(ymd).slice(0, 10).split('-');
			return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ymd;
		},
		/** ISO datetime -> "23/09/2026 08:05" in Rome time */
		dateTime: function (iso) {
			if (!iso) { return ''; }
			var o = parts(new Date(iso));
			return o.day + '/' + o.month + '/' + o.year + ' ' + o.hour + ':' + o.minute;
		},
		time: function (iso) {
			if (!iso) { return ''; }
			var o = parts(new Date(iso));
			return o.hour + ':' + o.minute;
		},
		nowParts: function (offsetMs) { return parts(new Date(Date.now() + (offsetMs || 0))); },
		/** Today's date in Rome as Y-m-d */
		today: function () { var o = parts(new Date()); return o.year + '-' + o.month + '-' + o.day; },
		longDate: function (ymd) {
			var d = new Date(ymd + 'T12:00:00Z');
			return new Intl.DateTimeFormat(DOLLY.intlLocale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
		},
		bytes: function (n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
	};
	/** "IT60X0542811101000000123456" -> "IT60 X054 2811 1010 0000 0123 456". */
	DOLLY.fmt.iban = function (v) { return (v || '').replace(/(.{4})/g, '$1 ').trim(); };

	/** IBAN check (country format, 27 characters for Italy, mod-97 check digits); same rule as the server. */
	DOLLY.isIban = function (v) {
		if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v) || (v.indexOf('IT') === 0 && v.length !== 27)) { return false; }
		var s = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, function (c) { return String(c.charCodeAt(0) - 55); });
		var rem = 0;
		for (var i = 0; i < s.length; i += 7) { rem = parseInt(String(rem) + s.slice(i, i + 7), 10) % 97; }
		return rem === 1;
	};

	DOLLY.MONTHS = [__('Gennaio'), __('Febbraio'), __('Marzo'), __('Aprile'), __('Maggio'), __('Giugno'), __('Luglio'), __('Agosto'), __('Settembre'), __('Ottobre'), __('Novembre'), __('Dicembre')];
	DOLLY.WEEKDAYS_SHORT = [__('Lun'), __('Mar'), __('Mer'), __('Gio'), __('Ven'), __('Sab'), __('Dom')];
	DOLLY.WEEKDAYS = [__('Lunedì'), __('Martedì'), __('Mercoledì'), __('Giovedì'), __('Venerdì'), __('Sabato'), __('Domenica')];

	/** Random idempotency key for punches and other retry-safe mutations. */
	DOLLY.requestKey = function () {
		if (window.crypto && window.crypto.randomUUID) { return window.crypto.randomUUID(); }
		var a = new Uint8Array(16);
		(window.crypto || window.msCrypto).getRandomValues(a);
		return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
	};

	/* ------------------------------------------------------------------ */
	/* Layer (toasts, dialogs) — appended to body inside a scoped .dolly-app */
	/* ------------------------------------------------------------------ */

	var layer = null;
	function getLayer() {
		if (!layer) {
			layer = h('div', { class: 'dolly-app dolly-layer' }, [h('div', { class: 'dolly-toasts', 'aria-live': 'polite', role: 'status' })]);
			document.body.appendChild(layer);
		}
		return layer;
	}

	DOLLY.toast = function (message, type) {
		var box = getLayer().querySelector('.dolly-toasts');
		var icon = type === 'error' ? 'circle-alert' : (type === 'success' ? 'circle-check' : 'info');
		var t = h('div', { class: 'dolly-toast dolly-toast--' + (type || 'info'), role: type === 'error' ? 'alert' : null }, [
			DOLLY.icon(icon),
			h('span', { text: message }),
			h('button', { type: 'button', 'aria-label': __('Chiudi notifica'), onclick: function () { t.remove(); } }, DOLLY.icon('x'))
		]);
		box.appendChild(t);
		DOLLY.icons();
		setTimeout(function () { if (t.parentNode) { t.remove(); } }, type === 'error' ? 9000 : 5000);
	};

	/**
	 * DOLLY.dialog({title, body: Node|[Node], actions: [{label, variant, icon, onClick(close, btn)}], wide})
	 * Focus is trapped inside; Escape closes; focus returns to the opener.
	 */
	DOLLY.dialog = function (opts) {
		var opener = document.activeElement;
		var titleId = DOLLY.uid('dlg');
		var body = h('div', { class: 'dolly-dialog__body' }, opts.body);
		var foot = h('div', { class: 'dolly-dialog__foot' });
		var dlg = h('div', { class: 'dolly-dialog' + (opts.wide ? ' dolly-dialog--wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' }, [
			h('div', { class: 'dolly-dialog__head' }, [
				h('h2', { id: titleId, text: opts.title }),
				h('button', { type: 'button', class: 'dolly-btn dolly-btn--ghost dolly-btn--icon', 'aria-label': __('Chiudi'), onclick: function () { close(); } }, DOLLY.icon('x'))
			]),
			body,
			foot
		]);
		var backdrop = h('div', { class: 'dolly-dialog-backdrop', onclick: function (e) { if (e.target === backdrop && !opts.persistent) { close(); } } }, dlg);
		function close(result) {
			document.removeEventListener('keydown', onKey, true);
			backdrop.remove();
			document.documentElement.style.overflow = '';
			if (opts.onClose) { opts.onClose(result); }
			if (opener && opener.focus && document.contains(opener)) { opener.focus(); }
		}
		function onKey(e) {
			if (e.key === 'Escape') { e.preventDefault(); close(); return; }
			if (e.key === 'Tab') {
				var f = dlg.querySelectorAll('button:not([disabled]), [href], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
				if (!f.length) { return; }
				var first = f[0], last = f[f.length - 1];
				if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
				else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
			}
		}
		(opts.actions || []).forEach(function (a) {
			var btn = DOLLY.button(a.label, { variant: a.variant, icon: a.icon, type: a.type || 'button' });
			btn.addEventListener('click', function () { a.onClick ? a.onClick(close, btn) : close(); });
			foot.appendChild(btn);
		});
		if (!foot.childNodes.length) { foot.remove(); }
		getLayer().appendChild(backdrop);
		document.documentElement.style.overflow = 'hidden';
		document.addEventListener('keydown', onKey, true);
		DOLLY.icons();
		setTimeout(function () {
			var first = body.querySelector('input:not([type=hidden]), select, textarea, button');
			(first || dlg).focus();
		}, 30);
		return { close: close, el: dlg, body: body, foot: foot };
	};

	DOLLY.confirm = function (title, message, confirmLabel, variant) {
		return new Promise(function (resolve) {
			var done = false;
			DOLLY.dialog({
				title: title,
				body: h('p', { text: message }),
				onClose: function () { if (!done) { resolve(false); } },
				actions: [
					{ label: __('Annulla'), onClick: function (close) { close(); } },
					{ label: confirmLabel || __('Conferma'), variant: variant || 'primary', onClick: function (close) { done = true; resolve(true); close(); } }
				]
			});
		});
	};

	/* ------------------------------------------------------------------ */
	/* Components                                                          */
	/* ------------------------------------------------------------------ */

	DOLLY.button = function (label, o) {
		o = o || {};
		var cls = 'dolly-btn' + (o.variant ? ' dolly-btn--' + o.variant : '') + (o.size ? ' dolly-btn--' + o.size : '') + (o.block ? ' dolly-btn--block' : '') + (o.iconOnly ? ' dolly-btn--icon' : '');
		return h(o.href ? 'a' : 'button', {
			class: cls,
			type: o.href ? null : (o.type || 'button'),
			href: o.href || null,
			onclick: o.onClick || null,
			'aria-label': o.iconOnly ? label : (o.ariaLabel || null),
			title: o.iconOnly ? label : null,
			disabled: o.disabled || null,
			download: o.download || null
		}, [o.icon ? DOLLY.icon(o.icon) : null, o.iconOnly ? null : h('span', { text: label })]);
	};

	/** Shows progress on a button while a promise runs. */
	DOLLY.busy = function (btn, promise) {
		if (btn) { btn.classList.add('is-loading'); btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }
		return promise.finally(function () {
			if (btn) { btn.classList.remove('is-loading'); btn.removeAttribute('aria-busy'); btn.disabled = false; }
		});
	};

	DOLLY.card = function (title, icon, children, o) {
		o = o || {};
		return h('section', { class: 'dolly-card' + (o.accent ? ' dolly-card--accent' : '') + (o.class ? ' ' + o.class : ''), 'aria-label': title || null }, [
			(title || o.actions) ? h('div', { class: 'dolly-card__head' }, [
				title ? h(o.level || 'h2', {}, [icon ? DOLLY.icon(icon) : null, title]) : h('span'),
				o.actions ? h('div', { class: 'dolly-btn-row' }, o.actions) : null
			]) : null,
			children
		]);
	};

	/** Logo, or the text wordmark when no logo is set. onHeader: on the colored header, which may have its own logo. */
	DOLLY.brandMark = function (onHeader) {
		var src = onHeader ? (CFG.logoHeader || CFG.logo) : CFG.logo;
		return src ? h('img', { class: 'dolly-brand__logo', src: src, alt: BRAND }) : h('span', { class: 'dolly-brand__wordmark', text: BRAND });
	};

	/** Current value of a --dolly-* theme token (for drawings that cannot use CSS, such as charts). */
	DOLLY.token = function (name, fallback) {
		var v = window.getComputedStyle(document.documentElement).getPropertyValue('--dolly-' + name).trim();
		return v || fallback || '';
	};

	DOLLY.badge = function (label, tone, icon) {
		return h('span', { class: 'dolly-badge dolly-badge--' + (tone || 'neutral') }, [icon ? DOLLY.icon(icon) : null, label]);
	};

	DOLLY.alert = function (message, type, children) {
		var icon = { error: 'circle-alert', success: 'circle-check', warning: 'triangle-alert', info: 'info' }[type || 'info'];
		return h('div', { class: 'dolly-alert dolly-alert--' + (type || 'info'), role: type === 'error' ? 'alert' : 'status' }, [
			DOLLY.icon(icon), h('div', { class: 'dolly-alert__body' }, [message ? h('div', { text: message }) : null, children])
		]);
	};

	DOLLY.loading = function (label) {
		return h('div', { class: 'dolly-loading', role: 'status' }, [h('span', { class: 'dolly-spinner', 'aria-hidden': 'true' }), h('span', { text: label || __('Caricamento…') })]);
	};

	DOLLY.empty = function (title, text, icon) {
		return h('div', { class: 'dolly-empty' }, [DOLLY.icon(icon || 'inbox'), h('strong', { text: title }), text ? h('span', { text: text }) : null]);
	};

	DOLLY.errorState = function (err, retry) {
		return DOLLY.alert(err && err.message ? err.message : __('Si è verificato un errore.'), 'error', retry ? h('div', { style: 'margin-top:8px' }, DOLLY.button(__('Riprova'), { icon: 'refresh-cw', size: 'sm', onClick: retry })) : null);
	};

	/**
	 * Field with persistent label and inline error.
	 * DOLLY.field({label, name, type, value, required, help, optional, options:[{value,label}], attrs})
	 * Returns wrapper with .input reference.
	 */
	DOLLY.field = function (o) {
		var id = o.id || DOLLY.uid('f');
		var errId = id + '-err', helpId = id + '-help';
		var input;
		var common = { id: id, name: o.name, required: o.required || null, 'aria-describedby': (o.help ? helpId + ' ' : '') + errId };
		Object.assign(common, o.attrs || {});
		if (o.type === 'select') {
			input = h('select', Object.assign({ class: 'dolly-select' }, common), (o.options || []).map(function (op) {
				return h('option', { value: op.value, selected: String(op.value) === String(o.value) ? true : null, text: op.label });
			}));
		} else if (o.type === 'textarea') {
			input = h('textarea', Object.assign({ class: 'dolly-textarea', rows: o.rows || 3 }, common));
			input.value = o.value || '';
		} else {
			input = h('input', Object.assign({ class: 'dolly-input', type: o.type || 'text', value: o.value !== undefined && o.value !== null ? o.value : '' }, common));
		}
		// Password fields: full width, with the show/hide button inside the field.
		var control = o.type === 'password'
			? h('div', { class: 'dolly-password' }, [input, h('button', { type: 'button', class: 'dolly-password__toggle', dataset: { togglePassword: id }, 'aria-label': __('Mostra password'), 'aria-pressed': 'false' }, DOLLY.icon('eye'))])
			: input;
		var wrap = h('div', { class: 'dolly-field' + (o.full ? ' dolly-field--full' : ''), dataset: { name: o.name || '' } }, [
			h('label', { class: 'dolly-label', for: id }, [o.label, o.optional ? h('span', { class: 'dolly-optional', text: __(' (facoltativo)') }) : null]),
			control,
			o.help ? h('span', { class: 'dolly-help', id: helpId, text: o.help }) : null,
			h('span', { class: 'dolly-error', id: errId, hidden: true })
		]);
		wrap.input = input;
		return wrap;
	};

	/**
	 * Accessible switch (WAI-ARIA "switch"): button with role=switch and aria-checked.
	 * DOLLY.switchControl({label, checked, onChange(checked), name, description})
	 */
	DOLLY.switchControl = function (o) {
		var id = DOLLY.uid('sw');
		var state = h('span', { class: 'dolly-switch__state', 'aria-hidden': 'true', text: o.checked ? __('Sì') : __('No') });
		var btn = h('button', { type: 'button', class: 'dolly-switch', role: 'switch', id: id, 'aria-checked': o.checked ? 'true' : 'false', dataset: { name: o.name || '' }, disabled: o.disabled || null, 'aria-describedby': o.description ? id + '-d' : null }, [
			h('span', { class: 'dolly-switch__track', 'aria-hidden': 'true' }, h('span', { class: 'dolly-switch__thumb' })),
			h('span', { class: 'dolly-switch__label', text: o.label }),
			state
		]);
		btn.addEventListener('click', function () {
			var v = btn.getAttribute('aria-checked') !== 'true';
			btn.setAttribute('aria-checked', v ? 'true' : 'false');
			state.textContent = v ? __('Sì') : __('No');
			if (o.onChange) { o.onChange(v); }
		});
		btn.isOn = function () { return btn.getAttribute('aria-checked') === 'true'; };
		btn.setOn = function (v) { btn.setAttribute('aria-checked', v ? 'true' : 'false'); state.textContent = v ? __('Sì') : __('No'); };
		var wrap = h('div', { class: 'dolly-field dolly-field--switch', dataset: { name: o.name || '' } }, [btn, o.description ? h('span', { class: 'dolly-help', id: id + '-d', text: o.description }) : null, h('span', { class: 'dolly-error', hidden: true })]);
		wrap.control = btn;
		return wrap;
	};

	/**
	 * Selectable chips for multi-selection (toggle buttons with aria-pressed), inside a labelled group.
	 * DOLLY.chips({label, name, options:[{value,label}], selected:[values]}) -> wrapper with .values()
	 */
	DOLLY.chips = function (o) {
		var labelId = DOLLY.uid('chips');
		var sel = (o.selected || []).map(String);
		var group = h('div', { class: 'dolly-chips', role: 'group', 'aria-labelledby': labelId });
		(o.options || []).forEach(function (op) {
			var on = sel.indexOf(String(op.value)) !== -1;
			var chip = h('button', { type: 'button', class: 'dolly-chip', 'aria-pressed': on ? 'true' : 'false', dataset: { value: op.value } }, [on ? DOLLY.icon('check') : null, h('span', { text: op.label })]);
			chip.addEventListener('click', function () {
				var v = chip.getAttribute('aria-pressed') !== 'true';
				chip.setAttribute('aria-pressed', v ? 'true' : 'false');
				var ic = chip.querySelector('svg, i');
				if (ic) { ic.remove(); }
				if (v) { chip.insertBefore(DOLLY.icon('check'), chip.firstChild); DOLLY.icons(); }
				if (o.onChange) { o.onChange(wrap.values()); }
			});
			group.appendChild(chip);
		});
		var wrap = h('div', { class: 'dolly-field' + (o.full ? ' dolly-field--full' : ''), dataset: { name: o.name || '' } }, [
			h('span', { class: 'dolly-label', id: labelId, text: o.label }),
			o.help ? h('span', { class: 'dolly-help', text: o.help }) : null,
			group,
			h('span', { class: 'dolly-error', hidden: true })
		]);
		wrap.values = function () {
			return Array.prototype.filter.call(group.querySelectorAll('.dolly-chip'), function (c) { return c.getAttribute('aria-pressed') === 'true'; }).map(function (c) { return c.dataset.value; });
		};
		wrap.setAll = function (v) {
			Array.prototype.forEach.call(group.querySelectorAll('.dolly-chip'), function (c) {
				if ((c.getAttribute('aria-pressed') === 'true') !== v) { c.click(); }
			});
		};
		return wrap;
	};

	/** Radio group for mutually exclusive choices. */
	DOLLY.radios = function (o) {
		var name = o.name || DOLLY.uid('r');
		var fs = h('fieldset', { class: 'dolly-radio-group', dataset: { name: name } }, [h('legend', { text: o.label })]);
		(o.options || []).forEach(function (op) {
			var input = h('input', { type: 'radio', name: name, value: op.value, checked: String(op.value) === String(o.value) ? true : null });
			input.addEventListener('change', function () { if (o.onChange) { o.onChange(op.value); } });
			fs.appendChild(h('label', { class: 'dolly-radio' }, [input, h('span', { class: 'dolly-radio__dot', 'aria-hidden': 'true' }), h('span', { class: 'dolly-radio__text' }, [h('strong', { text: op.label }), op.description ? h('span', { text: op.description }) : null])]));
		});
		var wrap = h('div', { class: 'dolly-field' + (o.full ? ' dolly-field--full' : ''), dataset: { name: name } }, [fs, h('span', { class: 'dolly-error', hidden: true })]);
		wrap.value = function () { var c = fs.querySelector('input:checked'); return c ? c.value : null; };
		return wrap;
	};

	/** Shows server-side field errors inline; returns true if any were shown. */
	DOLLY.showErrors = function (form, fields) {
		DOLLY.clearErrors(form);
		var first = null;
		Object.keys(fields || {}).forEach(function (name) {
			var wrap = form.querySelector('.dolly-field[data-name="' + name + '"]');
			if (!wrap) { return; }
			wrap.classList.add('has-error');
			var err = wrap.querySelector('.dolly-error');
			if (err) { DOLLY.render(err, [DOLLY.icon('circle-alert'), fields[name]]); err.hidden = false; }
			var input = wrap.querySelector('input, select, textarea, button');
			if (input) { input.setAttribute('aria-invalid', 'true'); if (!first) { first = input; } }
		});
		if (first) { first.focus(); }
		return !!first;
	};
	DOLLY.clearErrors = function (form) {
		Array.prototype.forEach.call(form.querySelectorAll('.dolly-field.has-error'), function (w) {
			w.classList.remove('has-error');
			var err = w.querySelector('.dolly-error'); if (err) { err.hidden = true; DOLLY.clear(err); }
			var input = w.querySelector('[aria-invalid]'); if (input) { input.removeAttribute('aria-invalid'); }
		});
	};

	/** Handles an API error in a form: inline field errors + message. User input is preserved. */
	DOLLY.formError = function (form, err, alertBox) {
		if (err && err.fields) { DOLLY.showErrors(form, err.fields); }
		if (alertBox) { DOLLY.render(alertBox, DOLLY.alert(err.message, 'error')); alertBox.hidden = false; }
		else { DOLLY.toast(err.message, 'error'); }
	};

	/**
	 * Table. columns: [{label, key|render(row), cls, num}]
	 * o.stack: stack cells on mobile; o.empty: [title, text, icon]; o.rowClass(row)
	 */
	DOLLY.table = function (columns, rows, o) {
		o = o || {};
		if (!rows || !rows.length) {
			var e = o.empty || [__('Nessun elemento'), ''];
			return DOLLY.empty(e[0], e[1], e[2]);
		}
		var thead = h('thead', {}, h('tr', {}, columns.map(function (c) {
			return h('th', { scope: 'col', class: (c.num ? 'num ' : '') + (c.cls || '') }, c.label ? c.label : h('span', { class: 'dolly-sr-only', text: c.srLabel || __('Azioni') }));
		})));
		var tbody = h('tbody', {}, rows.map(function (r) {
			return h('tr', { class: o.rowClass ? o.rowClass(r) : null }, columns.map(function (c) {
				var v = c.render ? c.render(r) : (r[c.key] === null || r[c.key] === undefined || r[c.key] === '' ? '—' : String(r[c.key]));
				return h('td', { class: (c.num ? 'num ' : '') + (c.cls || ''), 'data-label': c.label || '' }, v);
			}));
		}));
		var table = h('table', { class: 'dolly-table' + (o.stack !== false ? ' dolly-table--stack' : '') }, [o.caption ? h('caption', { class: 'dolly-sr-only', text: o.caption }) : null, thead, tbody, o.foot || null]);
		return h('div', { class: 'dolly-table-wrap' }, table);
	};

	/** Pagination controls for {page, pages, total}. */
	DOLLY.pagination = function (data, onPage, label) {
		if (!data || data.pages <= 1) {
			return data && data.total ? h('div', { class: 'dolly-pagination' }, h('span', { class: 'dolly-pagination__info', text: data.total + __(' elementi') })) : null;
		}
		return h('nav', { class: 'dolly-pagination', 'aria-label': __('Paginazione ') + (label || '') }, [
			h('span', { class: 'dolly-pagination__info', text: __('Pagina ') + data.page + __(' di ') + data.pages + ' · ' + data.total + __(' elementi') }),
			h('div', { class: 'dolly-pagination__btns' }, [
				DOLLY.button(__('Pagina precedente'), { icon: 'chevron-left', iconOnly: true, size: null, disabled: data.page <= 1, onClick: function () { onPage(data.page - 1); } }),
				DOLLY.button(__('Pagina successiva'), { icon: 'chevron-right', iconOnly: true, disabled: data.page >= data.pages, onClick: function () { onPage(data.page + 1); } })
			])
		]);
	};

	/** Tabs with arrow-key navigation. tabs: [{id, label, icon}] */
	DOLLY.tabs = function (tabs, active, onSelect) {
		var list = h('div', { class: 'dolly-tabs', role: 'tablist' });
		tabs.forEach(function (t, i) {
			var b = h('button', { type: 'button', role: 'tab', class: 'dolly-tab', 'aria-selected': t.id === active ? 'true' : 'false', tabindex: t.id === active ? '0' : '-1' }, [t.icon ? DOLLY.icon(t.icon) : null, t.label]);
			b.addEventListener('click', function () { onSelect(t.id); });
			b.addEventListener('keydown', function (e) {
				var btns = list.querySelectorAll('[role=tab]');
				if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
					e.preventDefault();
					var n = (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
					btns[n].focus(); btns[n].click();
				}
			});
			list.appendChild(b);
		});
		return list;
	};

	/* ------------------------------------------------------------------ */
	/* Italian date (GG/MM/AAAA) and 24-hour time (HH:MM) inputs           */
	/* ------------------------------------------------------------------ */

	/** "23/09/2026" -> "2026-09-23" (validated, leap years included) or null. */
	DOLLY.parseDate = function (s) {
		var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim());
		if (!m) { return null; }
		var d = +m[1], mo = +m[2], y = +m[3];
		var dt = new Date(Date.UTC(y, mo - 1, d));
		if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) { return null; }
		return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
	};
	DOLLY.parseTime = function (s) {
		var m = /^(\d{1,2})[:.](\d{2})$/.exec(String(s || '').trim());
		if (!m || +m[1] > 23 || +m[2] > 59) { return null; }
		return ('0' + m[1]).slice(-2) + ':' + m[2];
	};

	/** Inserts the separator after a completed group while typing (never rewrites what the user typed). */
	function autoFormat(input, sep) {
		input.addEventListener('input', function (e) {
			if (e.inputType && e.inputType.indexOf('delete') === 0) { return; }
			var v = input.value;
			if (sep === '/' && (/^\d{2}$/.test(v) || /^\d{1,2}\/\d{2}$/.test(v))) { input.value = v + '/'; }
			if (sep === ':' && /^\d{2}$/.test(v)) { input.value = v + ':'; }
		});
	}

	/* ------------------------------------------------------------------ */
	/* Pickers: calendar for date fields, clock for time fields.            */
	/* The text field stays usable with the keyboard; tapping it (or the    */
	/* icon) opens the popover. On touch screens the keyboard is not shown. */
	/* ------------------------------------------------------------------ */

	var MONTH_NAMES = [__('Gennaio'), __('Febbraio'), __('Marzo'), __('Aprile'), __('Maggio'), __('Giugno'), __('Luglio'), __('Agosto'), __('Settembre'), __('Ottobre'), __('Novembre'), __('Dicembre')];
	var WEEKDAYS = [__('Lu'), __('Ma'), __('Me'), __('Gi'), __('Ve'), __('Sa'), __('Do')];
	var openPicker = null;
	var pad2 = function (n) { return ('0' + n).slice(-2); };
	var isoOf = function (y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); };
	var addDays = function (iso, n) {
		var p = iso.split('-');
		var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
		return isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
	};
	var addMonths = function (iso, n) {
		var p = iso.split('-'), y = +p[0], m = +p[1] - 1 + n;
		y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
		var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
		return isoOf(y, m + 1, Math.min(+p[2], last));
	};
	var isTouch = function () { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); };
	function fire(input) {
		input.dispatchEvent(new window.Event('input', { bubbles: true }));
		input.dispatchEvent(new window.Event('change', { bubbles: true }));
	}

	/** Popover anchored to a field; inside a dialog it lives in the dialog (focus trap). */
	function popover(field, label, build) {
		if (openPicker) { openPicker.close(); }
		var input = field.input;
		var host = input.closest('.dolly-dialog') || getLayer();
		var pop = h('div', { class: 'dolly-picker', role: 'dialog', 'aria-label': label });
		var api = { field: field, el: pop, close: close, place: place, onInput: null };
		function close(focusInput) {
			window.removeEventListener('keydown', onKey, true);
			document.removeEventListener('pointerdown', onDown, true);
			window.removeEventListener('resize', place);
			window.removeEventListener('scroll', place, true);
			pop.remove();
			input.setAttribute('aria-expanded', 'false');
			if (openPicker === api) { openPicker = null; }
			if (focusInput) { input.focus({ preventScroll: true }); }
		}
		function onKey(e) {
			if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
			if (e.key === 'Tab' && pop.contains(document.activeElement)) {
				var f = pop.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), select, [tabindex="0"]');
				if (!f.length) { return; }
				var first = f[0], last = f[f.length - 1];
				if (e.shiftKey && document.activeElement === first) { e.preventDefault(); e.stopPropagation(); last.focus(); }
				else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); e.stopPropagation(); first.focus(); }
				else { e.stopPropagation(); }
			}
		}
		function onDown(e) { if (!pop.contains(e.target) && !field.contains(e.target)) { close(false); } }
		function place() {
			var r = input.getBoundingClientRect();
			var w = pop.offsetWidth, ph = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
			var left = Math.min(Math.max(8, r.left), Math.max(8, vw - w - 8));
			var top = r.bottom + 6;
			if (top + ph > vh - 8 && r.top - ph - 6 >= 8) { top = r.top - ph - 6; }
			if (top + ph > vh - 8) { top = Math.max(8, vh - ph - 8); }
			pop.style.left = left + 'px';
			pop.style.top = top + 'px';
		}
		build(pop, api);
		host.appendChild(pop);
		DOLLY.icons();
		place();
		input.setAttribute('aria-expanded', 'true');
		window.addEventListener('keydown', onKey, true);
		document.addEventListener('pointerdown', onDown, true);
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);
		openPicker = api;
		return api;
	}

	/** Wraps the text input with the icon button and wires opening/syncing. */
	function attachPicker(f, icon, label, open) {
		var input = f.input;
		var btn = h('button', { type: 'button', class: 'dolly-picker-input__btn', 'aria-label': label, disabled: input.disabled || null }, DOLLY.icon(icon));
		var box = h('div', { class: 'dolly-picker-input' });
		input.parentNode.insertBefore(box, input);
		box.appendChild(input);
		box.appendChild(btn);
		input.setAttribute('aria-haspopup', 'dialog');
		input.setAttribute('aria-expanded', 'false');
		if (isTouch()) { input.setAttribute('inputmode', 'none'); }
		var isOpen = function () { return openPicker && openPicker.field === f; };
		input.addEventListener('click', function () { if (!input.disabled && !input.readOnly && !isOpen()) { open(false); } });
		btn.addEventListener('click', function () { if (isOpen()) { openPicker.close(true); } else { open(true); } });
		input.addEventListener('input', function () { if (isOpen() && openPicker.onInput) { openPicker.onInput(); } });
		input.addEventListener('keydown', function (e) {
			if (e.key === 'ArrowDown' && (e.altKey || isOpen())) {
				e.preventDefault();
				if (isOpen()) { var t = openPicker.el.querySelector('[tabindex="0"]'); if (t) { t.focus(); } } else { open(true); }
			}
		});
	}

	function openCalendar(f, focusGrid) {
		var today = DOLLY.fmt.today();
		var sel = f.iso();
		var cursor = sel || today;
		var grid, monthSel, yearSel;
		var api = popover(f, __('Calendario'), function (pop, a) {
			var y0 = Math.min(1930, +cursor.slice(0, 4)), y1 = Math.max(2100, +cursor.slice(0, 4));
			var years = [];
			for (var y = y0; y <= y1; y++) { years.push(h('option', { value: y, text: y })); }
			monthSel = h('select', { class: 'dolly-picker__select', 'aria-label': __('Mese') }, MONTH_NAMES.map(function (n, i) { return h('option', { value: i + 1, text: n }); }));
			yearSel = h('select', { class: 'dolly-picker__select', 'aria-label': __('Anno') }, years);
			var nav = function (n, lbl, ic) { return h('button', { type: 'button', class: 'dolly-picker__nav', 'aria-label': lbl, onclick: function () { cursor = addMonths(cursor, n); render(); } }, DOLLY.icon(ic)); };
			monthSel.addEventListener('change', function () { cursor = clampDay(cursor.slice(0, 5) + pad2(+monthSel.value) + cursor.slice(7)); render(); });
			yearSel.addEventListener('change', function () { cursor = clampDay(yearSel.value + cursor.slice(4)); render(); });
			grid = h('div', { class: 'dolly-cal__grid', role: 'grid', 'aria-label': __('Giorni del mese') });
			grid.addEventListener('keydown', onGridKey);
			var foot = [h('button', { type: 'button', class: 'dolly-btn dolly-btn--sm', onclick: function () { pick(today); } }, __('Oggi'))];
			if (!f.input.required) { foot.push(h('button', { type: 'button', class: 'dolly-btn dolly-btn--sm', onclick: function () { f.input.value = ''; fire(f.input); a.close(true); } }, __('Cancella'))); }
			foot.push(h('button', { type: 'button', class: 'dolly-btn dolly-btn--sm dolly-btn--ghost', onclick: function () { a.close(true); } }, __('Chiudi')));
			DOLLY.append(pop, [
				h('div', { class: 'dolly-picker__head' }, [nav(-1, __('Mese precedente'), 'chevron-left'), monthSel, yearSel, nav(1, __('Mese successivo'), 'chevron-right')]),
				h('div', { class: 'dolly-cal__week', 'aria-hidden': 'true' }, WEEKDAYS.map(function (d) { return h('span', { text: d }); })),
				grid,
				h('div', { class: 'dolly-picker__foot' }, foot)
			]);
			a.onInput = function () { var v = f.iso(); if (v) { sel = v; cursor = v; render(); } };
			pop.classList.add('dolly-picker--cal');
		});
		function clampDay(iso) {
			var p = iso.split('-'), last = new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate();
			return isoOf(+p[0], +p[1], Math.min(+p[2], last));
		}
		function pick(iso) {
			f.setIso(iso);
			fire(f.input);
			api.close(true);
		}
		function render(focus) {
			var y = +cursor.slice(0, 4), m = +cursor.slice(5, 7);
			monthSel.value = String(m);
			yearSel.value = String(y);
			var first = isoOf(y, m, 1);
			var offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
			var start = addDays(first, -offset);
			var cells = [];
			for (var i = 0; i < 42; i++) {
				var iso = addDays(start, i);
				var other = +iso.slice(5, 7) !== m;
				cells.push(h('button', {
					type: 'button', role: 'gridcell',
					class: 'dolly-cal__day' + (other ? ' is-other' : '') + (iso === today ? ' is-today' : '') + (iso === sel ? ' is-selected' : ''),
					tabindex: iso === cursor ? '0' : '-1', 'aria-selected': iso === sel ? 'true' : 'false',
					'aria-label': DOLLY.fmt.longDate(iso) + (iso === today ? __(' (oggi)') : ''),
					dataset: { iso: iso }, text: String(+iso.slice(8))
				}));
			}
			var rows = [];
			for (var r = 0; r < 6; r++) { rows.push(h('div', { class: 'dolly-cal__row', role: 'row' }, cells.slice(r * 7, r * 7 + 7))); }
			DOLLY.render(grid, rows);
			if (focus) { var b = grid.querySelector('[tabindex="0"]'); if (b) { b.focus(); } }
			api && api.place();
		}
		function onGridKey(e) {
			var moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
			var next = null;
			if (moves[e.key]) { next = addDays(cursor, moves[e.key]); }
			else if (e.key === 'Home') { next = addDays(cursor, -((new Date(cursor + 'T00:00:00Z').getUTCDay() + 6) % 7)); }
			else if (e.key === 'End') { next = addDays(cursor, 6 - ((new Date(cursor + 'T00:00:00Z').getUTCDay() + 6) % 7)); }
			else if (e.key === 'PageUp') { next = addMonths(cursor, e.shiftKey ? -12 : -1); }
			else if (e.key === 'PageDown') { next = addMonths(cursor, e.shiftKey ? 12 : 1); }
			if (next) { e.preventDefault(); cursor = next; render(true); }
		}
		grid.addEventListener('click', function (e) {
			var b = e.target.closest('.dolly-cal__day');
			if (b) { pick(b.dataset.iso); }
		});
		render(focusGrid);
	}

	function openClock(f, focusHead) {
		var cur = f.hm();
		if (!cur) {
			var now = DOLLY.fmt.nowParts ? DOLLY.fmt.nowParts() : null;
			var nh = now ? +now.hour : new Date().getHours(), nm = now ? +now.minute : new Date().getMinutes();
			nm = Math.round(nm / 5) * 5;
			if (nm === 60) { nm = 0; nh = (nh + 1) % 24; }
			cur = pad2(nh) + ':' + pad2(nm);
		}
		var st = { h: +cur.slice(0, 2), m: +cur.slice(3, 5), stage: 'h' };
		var SIZE = 232, C = SIZE / 2, R_OUT = 92, R_IN = 60;
		var face, hand, hSeg, mSeg, marks;
		var api = popover(f, __('Orologio'), function (pop, a) {
			var seg = function (kind) {
				var b = h('button', { type: 'button', class: 'dolly-clock-pick__seg', role: 'spinbutton', 'aria-label': kind === 'h' ? __('Ore') : __('Minuti'), 'aria-valuemin': 0, 'aria-valuemax': kind === 'h' ? 23 : 59 });
				b.addEventListener('click', function () { st.stage = kind; render(); });
				b.addEventListener('keydown', function (e) {
					var d = { ArrowUp: 1, ArrowDown: -1, PageUp: 5, PageDown: -5 }[e.key];
					if (d) { e.preventDefault(); st.stage = kind; if (kind === 'h') { st.h = (st.h + d + 24) % 24; } else { st.m = (st.m + d + 60) % 60; } render(); }
					if (e.key === 'Enter') { e.preventDefault(); ok(); }
				});
				return b;
			};
			hSeg = seg('h'); mSeg = seg('m');
			hand = h('div', { class: 'dolly-clock-pick__hand', 'aria-hidden': 'true' });
			marks = h('div', { class: 'dolly-clock-pick__marks', 'aria-hidden': 'true' });
			face = h('div', { class: 'dolly-clock-pick__face', 'aria-hidden': 'true', style: 'width:' + SIZE + 'px;height:' + SIZE + 'px' }, [hand, marks, h('span', { class: 'dolly-clock-pick__center' })]);
			var dragging = false;
			face.addEventListener('pointerdown', function (e) { dragging = true; try { face.setPointerCapture(e.pointerId); } catch (x) {} fromPointer(e); e.preventDefault(); });
			face.addEventListener('pointermove', function (e) { if (dragging) { fromPointer(e); } });
			face.addEventListener('pointerup', function () { if (!dragging) { return; } dragging = false; if (st.stage === 'h') { st.stage = 'm'; render(); mSeg.focus(); } });
			face.addEventListener('pointercancel', function () { dragging = false; });
			DOLLY.append(pop, [
				h('div', { class: 'dolly-clock-pick__head' }, [hSeg, h('span', { class: 'dolly-clock-pick__colon', text: ':' }), mSeg]),
				h('p', { class: 'dolly-clock-pick__hint', text: __('Tocca o trascina sul quadrante') }),
				face,
				h('div', { class: 'dolly-picker__foot' }, [
					h('button', { type: 'button', class: 'dolly-btn dolly-btn--sm', onclick: function () { var p = DOLLY.fmt.nowParts ? DOLLY.fmt.nowParts() : null; st.h = p ? +p.hour : new Date().getHours(); st.m = p ? +p.minute : new Date().getMinutes(); render(); } }, __('Adesso')),
					!f.input.required ? h('button', { type: 'button', class: 'dolly-btn dolly-btn--sm', onclick: function () { f.input.value = ''; fire(f.input); a.close(true); } }, __('Cancella')) : null,
					h('button', { type: 'button', class: 'dolly-btn dolly-btn--sm dolly-btn--ghost', onclick: function () { a.close(true); } }, __('Annulla')),
					h('button', { type: 'button', class: 'dolly-btn dolly-btn--sm dolly-btn--primary', onclick: ok }, 'OK')
				])
			]);
			a.onInput = function () { var v = f.hm(); if (v) { st.h = +v.slice(0, 2); st.m = +v.slice(3, 5); render(); } };
			pop.classList.add('dolly-picker--clock');
		});
		function ok() {
			f.input.value = pad2(st.h) + ':' + pad2(st.m);
			fire(f.input);
			api.close(true);
		}
		function pos(angleDeg, r) {
			var a = angleDeg * Math.PI / 180;
			return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
		}
		function fromPointer(e) {
			var rect = face.getBoundingClientRect();
			var dx = e.clientX - rect.left - C, dy = e.clientY - rect.top - C;
			var ang = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
			if (st.stage === 'h') {
				var idx = Math.round(ang / 30) % 12;
				var inner = Math.sqrt(dx * dx + dy * dy) < (R_OUT + R_IN) / 2;
				st.h = inner ? (idx === 0 ? 0 : idx + 12) : (idx === 0 ? 12 : idx);
			} else {
				st.m = Math.round(ang / 6) % 60;
			}
			render();
		}
		function render() {
			hSeg.textContent = pad2(st.h); mSeg.textContent = pad2(st.m);
			hSeg.setAttribute('aria-valuenow', st.h); hSeg.setAttribute('aria-valuetext', pad2(st.h));
			mSeg.setAttribute('aria-valuenow', st.m); mSeg.setAttribute('aria-valuetext', pad2(st.m));
			hSeg.classList.toggle('is-active', st.stage === 'h');
			mSeg.classList.toggle('is-active', st.stage === 'm');
			var items = [];
			if (st.stage === 'h') {
				for (var i = 1; i <= 12; i++) { items.push({ v: i, label: String(i), r: R_OUT, a: (i % 12) * 30 }); }
				for (var j = 13; j <= 24; j++) { var v = j % 24; items.push({ v: v, label: pad2(v), r: R_IN, a: (j % 12) * 30, inner: true }); }
			} else {
				for (var k = 0; k < 60; k += 5) { items.push({ v: k, label: pad2(k), r: R_OUT, a: k * 6 }); }
			}
			var value = st.stage === 'h' ? st.h : st.m;
			DOLLY.render(marks, items.map(function (it) {
				var p = pos(it.a, it.r);
				return h('span', { class: 'dolly-clock-pick__num' + (it.inner ? ' is-inner' : '') + (it.v === value ? ' is-selected' : ''), style: 'left:' + p.x + 'px;top:' + p.y + 'px', text: it.label });
			}));
			var angle = st.stage === 'h' ? (st.h % 12) * 30 : st.m * 6;
			var len = st.stage === 'h' && (st.h === 0 || st.h > 12) ? R_IN : R_OUT;
			hand.style.height = len + 'px';
			hand.style.transform = 'rotate(' + angle + 'deg)';
			hand.classList.toggle('is-between', st.stage === 'm' && st.m % 5 !== 0);
		}
		render();
		if (focusHead) { hSeg.focus(); }
	}

	/** Date field in GG/MM/AAAA with a calendar. value/ .iso() use Y-m-d. */
	DOLLY.dateField = function (o) {
		var f = DOLLY.field(Object.assign({}, o, { type: 'text', value: o.value ? DOLLY.fmt.date(o.value) : '', help: o.help || __('GG/MM/AAAA · tocca per aprire il calendario'), attrs: Object.assign({ inputmode: 'numeric', placeholder: 'GG/MM/AAAA', maxlength: 10, autocomplete: 'off' }, o.attrs || {}) }));
		autoFormat(f.input, '/', [2, 2, 4]);
		f.iso = function () { return DOLLY.parseDate(f.input.value); };
		f.setIso = function (v) { f.input.value = v ? DOLLY.fmt.date(v) : ''; };
		attachPicker(f, 'calendar-days', __('Apri il calendario'), function (focus) { openCalendar(f, focus); });
		return f;
	};

	/** Time field in 24-hour HH:MM with a clock. */
	DOLLY.timeField = function (o) {
		var f = DOLLY.field(Object.assign({}, o, { type: 'text', value: o.value || '', help: o.help || __('Formato 24 ore HH:MM · tocca per aprire l\'orologio'), attrs: Object.assign({ inputmode: 'numeric', placeholder: 'HH:MM', maxlength: 5, autocomplete: 'off' }, o.attrs || {}) }));
		autoFormat(f.input, ':', [2, 2]);
		f.hm = function () { return DOLLY.parseTime(f.input.value); };
		attachPicker(f, 'clock', __('Apri l\'orologio'), function (focus) { openClock(f, focus); });
		return f;
	};
	/** Closes an open calendar/clock (e.g. before re-rendering a form). */
	DOLLY.closePicker = function () { if (openPicker) { openPicker.close(false); } };

	/**
	 * Reads date/time fields client-side; returns {values, errors}.
	 * spec: {name: [fieldWrapper, 'date'|'time', required, label]}
	 */
	DOLLY.readDateTimes = function (spec) {
		var values = {}, errors = {};
		Object.keys(spec).forEach(function (k) {
			var s = spec[k], f = s[0], raw = f.input.value.trim();
			if (!raw) {
				if (s[2]) { errors[k] = __('Campo obbligatorio.'); }
				values[k] = '';
				return;
			}
			var v = s[1] === 'date' ? f.iso() : f.hm();
			if (!v) { errors[k] = s[1] === 'date' ? __('Data non valida (GG/MM/AAAA).') : __('Orario non valido (HH:MM).'); }
			values[k] = v || '';
		});
		return { values: values, errors: errors };
	};

	/* Status helpers shared by portal and admin */
	DOLLY.requestBadge = function (status, label) {
		var map = { pending: ['amber', 'hourglass'], approved: ['green', 'circle-check'], rejected: ['red', 'circle-x'], cancelled: ['neutral', 'ban'], superseded: ['neutral', 'history'] };
		var m = map[status] || ['neutral', 'info'];
		return DOLLY.badge(label || status, m[0], m[1]);
	};
	DOLLY.anomalyBadge = function (a) {
		if (a.status === 'resolved') { return DOLLY.badge(__('Risolta'), 'green', 'circle-check'); }
		return DOLLY.badge(a.type_label, 'red', a.type === 'missing_certificate' ? 'file-text' : 'triangle-alert');
	};
	DOLLY.certBadge = function (status, label) {
		var map = { missing: ['red', 'file-text'], overdue: ['red', 'clock-alert'], uploaded: ['green', 'circle-check'], not_required: ['neutral', 'minus'], cleared: ['neutral', 'ban'] };
		var m = map[status] || ['neutral', 'info'];
		return DOLLY.badge(label, m[0], m[1]);
	};
	DOLLY.dayStatusBadge = function (s) {
		var map = {
			completo: [__('Completo'), 'green', 'circle-check'], in_corso: [__('In corso'), 'blue', 'clock'], incompleto: [__('Incompleto'), 'amber', 'clock-alert'],
			assente: [__('Assente'), 'red', 'user-x'], ferie: [__('Ferie'), 'blue', 'sun'], malattia: [__('Malattia'), 'red', 'stethoscope'],
			infortunio: [__('Infortunio'), 'red', 'bandage'], donazione: [__('Donazione sangue'), 'blue', 'droplet'], festivo: [__('Festivo'), 'neutral', 'party-popper'],
			chiusura: [__('Chiusura collettiva'), 'neutral', 'calendar-off'], chiusura_festiva: [__('Chiusura per festività'), 'neutral', 'party-popper'],
			nessun_turno: [__('Nessun turno'), 'neutral', 'phone-call'],
			riposo: [__('Riposo'), 'neutral', 'moon'], previsto: [__('Previsto'), 'neutral', 'calendar']
		};
		var m = map[s] || [s, 'neutral', 'info'];
		return DOLLY.badge(m[0], m[1], m[2]);
	};

	/**
	 * Hours of a day (or of a month) by justification code: "L 6:00", "P 2:00"...
	 * list: [{code, label, hm}] from the server (hours history).
	 */
	DOLLY.hoursCodes = function (list) {
		if (!list || !list.length) { return '—'; }
		var tones = { O: 'green', FER: 'green', S: 'amber', A: 'red', M: 'red', I: 'red' };
		return h('div', { class: 'dolly-hours-codes' }, list.map(function (c) {
			var b = DOLLY.badge(c.code + ' ' + c.hm, tones[c.code] || 'blue');
			b.title = c.label;
			b.setAttribute('aria-label', c.label + ': ' + c.hm);
			return b;
		}));
	};

	/** Month totals of the hours history: planned hours and hours for each justification code. */
	DOLLY.hoursSummary = function (data) {
		if (!data.hours_totals || !data.hours_totals.length) { return null; }
		return h('div', { style: 'margin-top:16px' }, [
			h('h3', { text: __('Riepilogo ore · ') + data.month_label, style: 'margin:0 0 4px' }),
			h('p', { class: 'dolly-small dolly-muted', style: 'margin:0 0 8px', text: __('Ore previste dall\'orario: ') + data.planned_total + __('. Ore per giustificativo') + (data.provisional ? __(' (provvisorie)') : '') + ':' }),
			h('ul', { class: 'dolly-hours-summary' }, data.hours_totals.map(function (c) {
				return h('li', {}, [h('span', {}, [h('b', { text: c.code }), ' · ' + c.label]), h('em', { text: c.hm })]);
			}))
		]);
	};

	/**
	 * Monthly attendance cell: the counted time (late tolerance / exit rounding) with the
	 * real punch underneath when they differ, and the minutes of delay beyond the tolerance.
	 */
	DOLLY.countedTime = function (counted, real, lateMin) {
		if (!counted) { return '—'; }
		return h('span', {}, [
			counted,
			real ? h('div', { class: 'dolly-small dolly-muted', text: __('timbrata ') + real }) : null,
			lateMin ? h('div', {}, DOLLY.badge(__('Ritardo ') + lateMin + __(' min'), 'amber', 'clock-alert')) : null
		]);
	};

	/** Monthly attendance "Ore" cell, with the approval state of on-call shifts. */
	DOLLY.hoursCell = function (r) {
		if (!r.worked) { return r.provisional ? DOLLY.badge(__('Provvisorio'), 'amber') : '—'; }
		var b = null;
		if (r.oncall_status === 'pending') { b = DOLLY.badge(__('Turno da approvare'), 'amber', 'hourglass'); }
		else if (r.oncall_status === 'rejected') { b = DOLLY.badge(__('Turno non approvato'), 'neutral', 'ban'); }
		else if (r.oncall_status === 'approved') { b = DOLLY.badge(__('Turno approvato'), 'green', 'circle-check'); }
		else if (r.provisional) { b = DOLLY.badge(__('Provvisorio'), 'amber'); }
		// Closure / holiday days: how the hours count.
		var kind = null;
		if (r.festive) { kind = DOLLY.badge(__('Festive ') + r.festive + ' · +' + r.holiday_increase + '%', 'blue', 'party-popper'); }
		else if (r.closure_type === 'collective') { kind = DOLLY.badge(__('Ore ordinarie (chiusura)'), 'neutral', 'calendar-off'); }
		return h('span', {}, [r.worked, b ? h('div', {}, b) : null, kind ? h('div', {}, kind) : null]);
	};

	/** Footer text of the monthly attendance: totals of overtime, holiday hours and pending shifts. */
	DOLLY.monthTotals = function (d) {
		var parts = [];
		if (d.total_extra && d.total_extra !== '0:00') { parts.push(__('Straordinario approvato: ') + d.total_extra); }
		if (d.total_over && d.total_over !== '0:00') { parts.push(__('oltre il limite: ') + d.total_over); }
		if (d.total_festive) { parts.push(__('ore festive: ') + d.total_festive + __(' (maggiorazione ') + d.holiday_increase + '%)'); }
		if (d.total_oncall_pending) { parts.push(__('turni da approvare: ') + d.total_oncall_pending); }
		return parts.join(' · ');
	};

	/** Monthly attendance "Straordinario" cell: approved overtime and any overtime beyond the limit. */
	DOLLY.extraCell = function (r) {
		var parts = [];
		if (r.extra || r.extra_label) { parts.push(h('div', { text: (r.extra ? r.extra : '') + (r.extra_label ? (r.extra ? ' · ' : '') + r.extra_label : '') })); }
		if (r.extra_over) {
			parts.push(r.extra_over_status === 'pending'
				? DOLLY.badge(r.extra_over + __(' da approvare'), 'amber', 'hourglass')
				: DOLLY.badge(r.extra_over + __(' non approvato'), 'neutral', 'ban'));
		}
		return parts.length ? h('div', {}, parts) : '—';
	};

	/* ------------------------------------------------------------------ */
	/* Installed app: device detection and "install first" gate            */
	/* ------------------------------------------------------------------ */

	DOLLY.device = function () {
		var ua = navigator.userAgent || '';
		var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		var android = /Android/.test(ua);
		return {
			ios: ios,
			android: android,
			mobile: ios || android,
			// Browsers inside other apps (WhatsApp, Facebook, Instagram, Google app…) cannot install web apps.
			inApp: /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|TikTok|GSA\//.test(ua),
			// Samsung Internet builds its own app package: Google Play Protect may block it as "unsafe".
			samsung: android && /SamsungBrowser/.test(ua),
			iosOtherBrowser: ios && /CriOS|FxiOS|EdgiOS/.test(ua)
		};
	};
	/** Opened from the icon on the home screen. */
	DOLLY.isStandalone = function () {
		return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true);
	};
	/** Phones must install the portal before using it (setting "require_install"). */
	DOLLY.needsInstall = function () {
		return !!CFG.requireInstall && DOLLY.device().mobile && !DOLLY.isStandalone();
	};

	// Android/Chrome: keep the install prompt to offer a one-tap "Installa l'app" button.
	DOLLY.installPrompt = null;
	window.addEventListener('beforeinstallprompt', function (e) {
		e.preventDefault();
		DOLLY.installPrompt = e;
		document.dispatchEvent(new window.Event('dolly:installable'));
	});
	window.addEventListener('appinstalled', function () {
		DOLLY.installPrompt = null;
		document.dispatchEvent(new window.Event('dolly:installed'));
	});

	/** Small phone sketch that points out the browser button to tap (Lucide icons only). */
	function phoneSketch(kind) {
		var bar = kind === 'ios'
			? h('div', { class: 'dolly-phone__bar dolly-phone__bar--bottom' }, [DOLLY.icon('chevron-left'), DOLLY.icon('chevron-right'), h('span', { class: 'dolly-phone__hot' }, DOLLY.icon('share')), DOLLY.icon('book-open'), DOLLY.icon('copy')])
			: h('div', { class: 'dolly-phone__bar dolly-phone__bar--top' }, [h('span', { class: 'dolly-phone__url', text: window.location.host }), h('span', { class: 'dolly-phone__hot' }, DOLLY.icon('ellipsis-vertical'))]);
		return h('div', { class: 'dolly-phone', 'aria-hidden': 'true' }, [
			kind === 'ios' ? null : bar,
			h('div', { class: 'dolly-phone__screen' }, [DOLLY.brandMark(false)]),
			kind === 'ios' ? bar : null
		]);
	}

	function steps(list) {
		return h('ol', { class: 'dolly-install__steps' }, list.map(function (s, i) {
			return h('li', {}, [h('span', { class: 'dolly-install__num', text: String(i + 1) }), h('span', { class: 'dolly-install__icon' }, DOLLY.icon(s[0])), h('span', { class: 'dolly-install__text' }, s[1])]);
		}));
	}
	function b(text) { return h('strong', { text: text }); }

	/** What to do when Google Play Protect stops the installation ("App non sicura bloccata"). */
	function playProtectHelp() {
		return h('div', { class: 'dolly-install__protect' }, DOLLY.alert(null, 'warning', [
			h('strong', { text: __('Compare «App non sicura bloccata»?') }),
			h('p', { text: DOLLY.sprintf(__('È un avviso di Google Play Protect che può comparire con alcuni browser, ad esempio Samsung Internet. Il portale %s è sicuro: per completare l\'installazione'), BRAND) }),
			h('ol', {}, [
				h('li', {}, [__('tocca '), b(__('Altri dettagli')), ';']),
				h('li', {}, [__('tocca '), b(__('Installa comunque')), '.'])
			]),
			h('p', { class: 'dolly-help', text: __('Non toccare «Ok»: chiude l\'avviso senza installare l\'app.') })
		]));
	}

	/** Link that opens the current page in Chrome from another Android browser. */
	function chromeIntent() {
		var l = window.location;
		return 'intent://' + l.host + l.pathname + l.search + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(l.href) + ';end';
	}

	/**
	 * Procedure to add the portal to the home screen (iPhone / Android), shown before the login on phones.
	 * Returns the element; "done" is shown once Android reports the installation.
	 */
	DOLLY.installGate = function () {
		var dev = DOLLY.device();
		if (CFG.sw && 'serviceWorker' in navigator && window.isSecureContext) {
			navigator.serviceWorker.register(CFG.sw, { scope: CFG.swScope || '/' }).catch(function () {});
		}
		var panel = h('div');
		var tab = dev.android ? 'android' : 'ios';
		var installBtn = DOLLY.button(__('Installa l\'app'), { variant: 'primary', icon: 'download', block: true, onClick: function () {
			if (!DOLLY.installPrompt) { return; }
			DOLLY.installPrompt.prompt();
			DOLLY.installPrompt.userChoice.then(function () { DOLLY.installPrompt = null; renderPanel(); });
		} });
		function renderPanel() {
			var nodes;
			if (tab === 'ios') {
				nodes = [
					phoneSketch('ios'),
					steps([
						['share', [dev.iosOtherBrowser ? __('Tocca il pulsante ') : __('In Safari tocca il pulsante '), b(__('Condividi')), dev.iosOtherBrowser ? __(' (in alto a destra, accanto all\'indirizzo).') : __(' nella barra in basso (su iPad in alto).')]],
						['square-plus', [__('Scorri il menu e tocca '), b(__('Aggiungi alla schermata Home')), '.']],
						['circle-check', [__('Tocca '), b(__('Aggiungi')), __(' in alto a destra.')]],
						['smartphone', [__('Chiudi il browser e apri '), b(BRAND), __(' dall\'icona sulla schermata Home: lì potrai accedere.')]]
					])
				];
			} else {
				nodes = [
					DOLLY.installPrompt ? h('div', { class: 'dolly-install__quick' }, [installBtn, h('p', { class: 'dolly-help', text: __('Oppure segui i passaggi qui sotto.') })]) : null,
					phoneSketch('android'),
					steps([
						['ellipsis-vertical', [__('In Chrome tocca il menu '), b('⋮'), __(' in alto a destra.')]],
						['square-plus', [__('Tocca '), b(__('Installa app')), __(' oppure '), b(__('Aggiungi a schermata Home')), '.']],
						['circle-check', [__('Conferma con '), b(__('Installa')), '.']],
						['smartphone', [__('Apri '), b(BRAND), __(' dall\'icona sulla schermata Home: lì potrai accedere.')]]
					]),
					playProtectHelp()
				];
			}
			DOLLY.render(panel, nodes);
		}
		var tabs = h('div');
		function renderTabs() {
			DOLLY.render(tabs, DOLLY.tabs([{ id: 'ios', label: 'iPhone', icon: 'smartphone' }, { id: 'android', label: 'Android', icon: 'smartphone' }], tab, function (t) { tab = t; renderTabs(); renderPanel(); }));
		}
		var copyBtn = DOLLY.button(__('Copia l\'indirizzo'), { size: 'sm', icon: 'copy', onClick: function () {
			(navigator.clipboard ? navigator.clipboard.writeText(window.location.href) : Promise.reject()).then(function () { DOLLY.toast(__('Indirizzo copiato: incollalo in ') + (dev.ios ? 'Safari' : 'Chrome') + '.', 'success'); }, function () { DOLLY.toast(window.location.href, 'info'); });
		} });
		var done = h('div', { hidden: true }, DOLLY.alert(__('App installata! Chiudi il browser e apri ') + BRAND + __(' dall\'icona sulla schermata Home per accedere.'), 'success'));
		var gate = h('div', { class: 'dolly-install' }, [
			h('h1', { class: 'dolly-auth__title', text: __('Installa l\'app ') + BRAND }),
			h('p', { class: 'dolly-muted', text: __('Prima di accedere aggiungi il portale alla schermata Home del telefono: lo aprirai come un\'app e riceverai le notifiche.') }),
			dev.inApp ? DOLLY.alert(__('Stai usando il browser di un\'altra app: apri questa pagina in ') + (dev.ios ? 'Safari' : 'Chrome') + __(' per installarla.'), 'warning', h('div', { style: 'margin-top:8px' }, copyBtn)) : null,
			dev.samsung && !dev.inApp ? DOLLY.alert(__('Stai usando Samsung Internet: con questo browser il telefono può bloccare l\'installazione. Apri questa pagina in Chrome e installa l\'app da lì.'), 'warning', h('div', { class: 'dolly-install__actions' }, [
				DOLLY.button(__('Apri in Chrome'), { variant: 'primary', size: 'sm', icon: 'external-link', href: chromeIntent() }), copyBtn
			])) : null,
			done, tabs, panel,
			h('p', { class: 'dolly-help', style: 'margin-top:16px', text: __('Hai già installato l\'app? Aprila dall\'icona ') + BRAND + __(' sulla schermata Home.') })
		]);
		document.addEventListener('dolly:installable', renderPanel);
		document.addEventListener('dolly:installed', function () { done.hidden = false; renderPanel(); });
		renderTabs();
		renderPanel();
		return gate;
	};

	/* ------------------------------------------------------------------ */
	/* Coach marks: spotlight overlay, explanation bubble, tapping finger  */
	/* ------------------------------------------------------------------ */

	/**
	 * DOLLY.coach.show(step) -> Promise resolved with 'next' (button or tap on the target) or 'skip'.
	 * step: { target: selector | element | function, title, text, mode: 'click' (the user taps the
	 *   highlighted element) | 'next' (button), next: button label, tap: finger animation,
	 *   scroll: bring the target into view, progress: "3 / 20", padding, wait: ms to wait for the target }
	 * Outside the highlighted area nothing can be tapped; in 'next' mode not even the target.
	 */
	DOLLY.coach = (function () {
		var root = null, hole, bubble, finger, blocks, cur = null, raf = 0, resolveFn = null, clickTimer = 0;

		function find(t) {
			var el = typeof t === 'function' ? t() : (typeof t === 'string' ? document.querySelector(t) : t);
			return el && el.getClientRects && el.getClientRects().length ? el : null;
		}
		function swallow(e) { e.preventDefault(); e.stopPropagation(); }
		function build() {
			if (root) { return; }
			blocks = [0, 1, 2, 3].map(function () { return h('div', { class: 'dolly-coach__block', onclick: swallow }); });
			// In 'next' mode the hole is locked (catches taps); in 'click' mode taps pass through to the target.
			hole = h('div', { class: 'dolly-coach__hole', onclick: swallow });
			finger = h('div', { class: 'dolly-coach__finger', 'aria-hidden': 'true' }, [h('span', { class: 'dolly-coach__ripple' }), DOLLY.icon('pointer')]);
			bubble = h('div', { class: 'dolly-coach__bubble', role: 'dialog', 'aria-modal': 'true', 'aria-live': 'polite', tabindex: '-1' });
			root = h('div', { class: 'dolly-app dolly-coach' }, blocks.concat([hole, finger, bubble]));
			document.body.appendChild(root);
			document.addEventListener('click', onDocClick, true);
			document.addEventListener('keydown', onKey, true);
			DOLLY.icons();
		}
		function box(el, x, y, w, hh) {
			el.style.left = x + 'px'; el.style.top = y + 'px';
			el.style.width = Math.max(0, w) + 'px'; el.style.height = Math.max(0, hh) + 'px';
		}
		function place() {
			if (!cur) { return; }
			var vw = window.innerWidth, vh = window.innerHeight;
			var t = cur.target ? find(cur.target) : null;
			var bh = bubble.offsetHeight, bw = Math.min(380, vw - 32);
			bubble.style.width = bw + 'px';
			if (t) {
				var r = t.getBoundingClientRect(), pad = cur.padding === undefined ? 8 : cur.padding;
				var x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
				var w = Math.min(vw - 4, r.right + pad) - x, hh = Math.min(vh - 4, r.bottom + pad) - y;
				root.classList.remove('is-center');
				hole.hidden = false;
				box(hole, x, y, w, hh);
				box(blocks[0], 0, 0, vw, y);
				box(blocks[1], 0, y + hh, vw, vh - y - hh);
				box(blocks[2], 0, y, x, hh);
				box(blocks[3], x + w, y, vw - x - w, hh);
				hole.classList.toggle('is-locked', cur.mode !== 'click');
				finger.hidden = !cur.tap;
				if (cur.tap) { finger.style.left = (r.left + r.width / 2 - 6) + 'px'; finger.style.top = (r.top + r.height / 2 - 4) + 'px'; }
				var left = Math.min(Math.max(16, r.left + r.width / 2 - bw / 2), vw - bw - 16);
				var below = y + hh + 14, above = y - 14 - bh;
				var top = below + bh <= vh - 12 ? below : (above >= 12 ? above : Math.max(12, vh - bh - 12));
				bubble.style.left = left + 'px';
				bubble.style.top = top + 'px';
			} else {
				root.classList.add('is-center');
				hole.hidden = true; finger.hidden = true;
				box(blocks[0], 0, 0, vw, vh); box(blocks[1], 0, 0, 0, 0); box(blocks[2], 0, 0, 0, 0); box(blocks[3], 0, 0, 0, 0);
				bubble.style.left = Math.max(16, (vw - bw) / 2) + 'px';
				bubble.style.top = Math.max(16, (vh - bh) / 2) + 'px';
			}
		}
		function loop() { place(); raf = window.requestAnimationFrame(loop); }
		function finish(result) {
			if (!cur) { return; }
			cur = null;
			window.cancelAnimationFrame(raf);
			root.hidden = true;
			var fn = resolveFn; resolveFn = null;
			if (fn) { fn(result); }
		}
		function onDocClick(e) {
			if (!cur || cur.mode !== 'click' || root.hidden) { return; }
			var t = find(cur.target);
			if (t && t.contains(e.target)) {
				// Let the application handle the tap first, then move on.
				clearTimeout(clickTimer);
				clickTimer = setTimeout(function () { finish('next'); }, cur.delay || 350);
			}
		}
		function onKey(e) {
			if (cur && !root.hidden && e.key === 'Escape') { swallow(e); }
		}
		function waitFor(target, ms) {
			return new Promise(function (resolve) {
				var start = Date.now();
				(function poll() {
					var el = find(target);
					if (el || Date.now() - start > ms) { resolve(el); return; }
					setTimeout(poll, 100);
				})();
			});
		}

		return {
			show: function (step) {
				build();
				return (step.target ? waitFor(step.target, step.wait || 6000) : Promise.resolve(null)).then(function (el) {
					if (step.target && !el) {
						// Target not available (e.g. screen not rendered): show the explanation anyway.
						step = Object.assign({}, step, { target: null, mode: 'next', tap: false });
					}
					if (el && step.scroll) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
					return new Promise(function (resolve) { setTimeout(resolve, el && step.scroll ? 450 : 0); });
				}).then(function () {
					return new Promise(function (resolve) {
						cur = step;
						resolveFn = resolve;
						var next = step.mode === 'click' ? null : DOLLY.button(step.next || __('Avanti'), { variant: 'primary', icon: step.nextIcon || 'arrow-right', onClick: function () { finish('next'); } });
						var skip = step.noSkip ? null : DOLLY.button(__('Salta il tutorial'), { variant: 'ghost', size: 'sm', onClick: function () { finish('skip'); } });
						DOLLY.render(bubble, [
							step.progress ? h('div', { class: 'dolly-coach__progress', text: step.progress }) : null,
							step.title ? h('h3', { class: 'dolly-coach__title', text: step.title }) : null,
							h('div', { class: 'dolly-coach__text' }, step.text),
							step.mode === 'click' ? h('p', { class: 'dolly-coach__hint' }, [DOLLY.icon('pointer'), step.hint || __('Tocca l\'elemento evidenziato')]) : null,
							h('div', { class: 'dolly-coach__actions' }, [skip, h('span', { class: 'dolly-coach__spacer' }), next])
						]);
						root.hidden = false;
						loop();
						setTimeout(function () { (next || bubble).focus({ preventScroll: true }); }, 60);
					});
				});
			},
			end: function () { finish('end'); if (root) { root.hidden = true; } },
			isActive: function () { return !!cur; }
		};
	})();

	/* Login page: phones install the app before signing in. */
	function gateLogin() {
		if (CFG.view !== 'login' || !DOLLY.needsInstall()) { return; }
		var card = document.querySelector('.dolly-auth__card');
		if (!card || card.querySelector('.dolly-install')) { return; }
		card.classList.add('is-gated');
		card.appendChild(DOLLY.installGate());
		DOLLY.icons();
	}
	if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', gateLogin); } else { gateLogin(); }

	/* Login page helpers (no framework on those pages) */
	document.addEventListener('click', function (e) {
		var t = e.target.closest && e.target.closest('[data-toggle-password]');
		if (t) {
			var input = document.getElementById(t.getAttribute('data-toggle-password'));
			var show = input.type === 'password';
			input.type = show ? 'text' : 'password';
			t.setAttribute('aria-pressed', show ? 'true' : 'false');
			t.setAttribute('aria-label', show ? __('Nascondi password') : __('Mostra password'));
			return;
		}
		var sw = e.target.closest && e.target.closest('.dolly-switch[data-switch-input]');
		if (sw) {
			var on = sw.getAttribute('aria-checked') !== 'true';
			sw.setAttribute('aria-checked', on ? 'true' : 'false');
			var hidden = document.querySelector('input[data-switch-value="' + sw.id + '"]');
			if (hidden) { hidden.value = on ? '1' : ''; }
		}
	});

	document.addEventListener('DOMContentLoaded', DOLLY.icons);
	if (document.readyState !== 'loading') { DOLLY.icons(); }
})(window, document);
