#!/usr/bin/env python3
"""Translation tools for Dolly Employee Management (Python 3, no dependencies).

The plugin is written in Italian. Translations live in languages/dolly-employee-management-<locale>.po.

    python3 tools/i18n/i18n.py update     # rescan the code: refresh the .pot and add new strings to every .po
    python3 tools/i18n/i18n.py compile    # .po -> .mo (PHP) and .js (browser dictionary, window.DOLLY_I18N)
    python3 tools/i18n/i18n.py check      # report untranslated strings and placeholder mistakes

Translatable strings: __( / esc_html__( / esc_attr__( / esc_html_e( / esc_attr_e( with the plugin text domain in PHP,
__('...') in JS, and the label constants listed in LABEL_CONSTS (translated at runtime with Dolly_I18n::t()).
"""
import json
import re
import struct
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOMAIN = 'dolly-employee-management'
LANG_DIR = ROOT / 'languages'

LABEL_CONSTS = {'PAGES', 'ABSENCE_GROUPS', 'SHORT_MONTHS', 'SHORT_WEEKDAYS', 'TYPES', 'RESOLUTIONS', 'SCHEMES', 'FONTS', 'TEXT_SIZES',
                'BUTTON_SHAPES', 'SHADOWS', 'DENSITIES', 'ACTIONS', 'METHODS', 'LABELS', 'STATUSES', 'CERT_STATUSES', 'FIXED', 'CODES',
                'LEAVE_KINDS', 'SHORT_DAYS', 'VERIFICATION_METHODS', 'CERTIFICATE_MODES', 'EVENTS', 'EMPLOYEE_EVENTS', 'ADMIN_EVENTS',
                'KINDS', 'MONTHS', 'WEEKDAYS', 'CATEGORIES', 'MODES'}
KEY_IS_LABEL = {'ABSENCE_GROUPS'}
CODES = {'', 'A', 'Av', 'O', 'FER', 'S', 'FS', 'FE', 'P', 'ROL', 'EO', 'Pn', 'PL', 'M', 'I'}
# Default texts of Dolly_Appearance::defaults(), translated while unchanged (Dolly_Appearance::DEFAULT_TEXTS).
APPEARANCE_TEXTS = ['Gestione Dipendenti', 'Portale dipendenti', 'Codice presenze', 'Accedi', "Accedi con le credenziali fornite dall'amministratore."]


# ---------------------------------------------------------------- source scanning

def _skip_string(src, i):
    q = src[i]
    j = i + 1
    while src[j] != q:
        j += 2 if src[j] == '\\' else 1
    return j


def unescape_js(raw):
    simple = {'n': '\n', 't': '\t', 'r': '\r', '0': '\0', 'b': '\b', 'f': '\f', 'v': '\v'}
    out, i = [], 0
    while i < len(raw):
        c = raw[i]
        if c != '\\':
            out.append(c)
            i += 1
        elif raw[i + 1] in simple:
            out.append(simple[raw[i + 1]])
            i += 2
        elif raw[i + 1] == 'u':
            out.append(chr(int(raw[i + 2:i + 6], 16)))
            i += 6
        else:
            out.append(raw[i + 1])
            i += 2
    return ''.join(out)


def unescape_php(raw, quote):
    if quote == "'":
        return re.sub(r"\\([\\'])", r'\1', raw)
    raw = raw.replace('\\$', '$')  # "\$" is a literal dollar sign in PHP double-quoted strings.
    return raw.encode('latin-1', 'backslashreplace').decode('unicode_escape') if '\\' in raw else raw


def js_strings(src):
    """__('...') calls, skipping comments and regex literals."""
    i, n, prev = 0, len(src), ''
    while i < n:
        c = src[i]
        if src.startswith('//', i):
            end = src.find('\n', i)
            i = n if end < 0 else end
            continue
        if src.startswith('/*', i):
            i = src.find('*/', i + 2) + 2
            continue
        if c in '\'"':
            j = _skip_string(src, i)
            if re.search(r'\b__\(\s*$', src[max(0, i - 6):i]):
                yield src.count('\n', 0, i) + 1, unescape_js(src[i + 1:j])
            i, prev = j + 1, 'str'
            continue
        if c == '/' and prev in ('', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', 'return'):
            j, in_class = i + 1, False
            while j < n and src[j] != '\n':
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == '[':
                    in_class = True
                elif src[j] == ']':
                    in_class = False
                elif src[j] == '/' and not in_class:
                    break
                j += 1
            i, prev = j + 1, 'regex'
            continue
        if not c.isspace():
            m = re.match(r'[A-Za-z_$][\w$]*', src[i:i + 40])
            if m:
                prev = m.group(0)
                i += len(prev)
                continue
            prev = c
        i += 1


def php_strings(src):
    for m in re.finditer(r'\b(__|esc_html__|esc_attr__|esc_html_e|esc_attr_e)\(\s*', src):
        i = m.end()
        if src[i] not in '\'"':
            continue
        j = _skip_string(src, i)
        if re.match(r"\s*,\s*'" + DOMAIN + "'", src[j + 1:j + 60]):
            yield src.count('\n', 0, i) + 1, unescape_php(src[i + 1:j], src[i])


def const_strings(src):
    for m in re.finditer(r'const\s+(\w+)\s*=\s*array\(', src):
        name = m.group(1)
        if name not in LABEL_CONSTS:
            continue
        depth, j = 1, m.end()
        while depth:
            if src[j] in '\'"':
                j = _skip_string(src, j)
            elif src[j] == '(':
                depth += 1
            elif src[j] == ')':
                depth -= 1
            j += 1
        for lm in re.finditer(r"'((?:[^'\\]|\\.)*)'(\s*=>)?", src[m.end():j - 1]):
            value = unescape_php(lm.group(1), "'")
            if lm.group(2) and name not in KEY_IS_LABEL:
                continue
            if value in CODES or re.fullmatch(r'[a-z0-9_\-]+', value) or (name == 'FONTS' and ',' in value):
                continue
            yield name, value


def extract():
    """{msgid: [references]} in source order."""
    cat = {}

    def add(msgid, ref):
        if msgid:
            cat.setdefault(msgid, [])
            if ref not in cat[msgid]:
                cat[msgid].append(ref)

    for p in sorted((ROOT / 'includes').glob('*.php')) + [ROOT / 'dolly-employee-management.php', ROOT / 'templates' / 'fallback.php']:
        src = p.read_text(encoding='utf-8')
        rel = p.relative_to(ROOT).as_posix()
        for line, s in php_strings(src):
            add(s, f'{rel}:{line}')
        for const, s in const_strings(src):
            add(s, f'{rel}:{const}')
    for s in APPEARANCE_TEXTS:
        add(s, 'includes/class-dolly-appearance.php:defaults')
    for p in sorted((ROOT / 'assets' / 'js').glob('dolly-*.js')):
        rel = p.relative_to(ROOT).as_posix()
        for line, s in js_strings(p.read_text(encoding='utf-8')):
            add(s, f'{rel}:{line}')
    return cat


# ---------------------------------------------------------------- .po files

def po_quote(s):
    s = s.replace('\\', '\\\\').replace('"', '\\"').replace('\t', '\\t').replace('\r', '\\r')
    parts = s.split('\n')
    if len(parts) == 1:
        return '"' + parts[0] + '"'
    lines = [p + '\\n' for p in parts[:-1]] + ([parts[-1]] if parts[-1] else [])
    return '""\n' + '\n'.join('"' + x + '"' for x in lines)


def _po_line(x):
    x = x.strip()[1:-1]
    return re.sub(r'\\(.)', lambda m: {'n': '\n', 't': '\t', 'r': '\r', '"': '"', '\\': '\\'}.get(m.group(1), m.group(1)), x)


def read_po(path):
    """{msgid: (msgstr, [refs])} and the header."""
    entries, header = {}, ''
    cur = {'refs': [], 'id': None, 'str': None, 'field': None}

    def flush():
        if cur['id'] is not None:
            if cur['id'] == '':
                nonlocal header
                header = cur['str'] or ''
            else:
                entries[cur['id']] = (cur['str'] or '', cur['refs'])
        cur.update({'refs': [], 'id': None, 'str': None, 'field': None})

    for line in path.read_text(encoding='utf-8').splitlines() + ['']:
        if line.startswith('#:'):
            if cur['id'] is not None:
                flush()
            cur['refs'] += line[2:].split()
        elif line.startswith('msgid '):
            if cur['id'] is not None:
                flush()
            cur['id'], cur['field'] = _po_line(line[6:]), 'id'
        elif line.startswith('msgstr '):
            cur['str'], cur['field'] = _po_line(line[7:]), 'str'
        elif line.startswith('"') and cur['field']:
            cur[cur['field']] += _po_line(line)
        elif not line.strip():
            flush()
    return entries, header


def header_for(locale):
    return ('Project-Id-Version: Dolly Employee Management\n'
            'Report-Msgid-Bugs-To: https://github.com/blackat5445/Dolly-employee-management/issues\n'
            'MIME-Version: 1.0\n'
            'Content-Type: text/plain; charset=UTF-8\n'
            'Content-Transfer-Encoding: 8bit\n'
            + (f'Language: {locale}\n' if locale else '')
            + 'Plural-Forms: nplurals=2; plural=(n != 1);\n'
            'X-Domain: dolly-employee-management\n'
            'X-Source-Language: it_IT\n')


def write_po(path, catalog, translations, locale):
    out = ['# Dolly Employee Management. Source language: Italian.', 'msgid ""', 'msgstr ' + po_quote(header_for(locale)), '']
    for msgid, refs in catalog.items():
        for i in range(0, len(refs), 4):
            out.append('#: ' + ' '.join(refs[i:i + 4]))
        out.append('msgid ' + po_quote(msgid))
        out.append('msgstr ' + po_quote(translations.get(msgid, '')))
        out.append('')
    path.write_text('\n'.join(out), encoding='utf-8')


# ---------------------------------------------------------------- .mo and .js

def write_mo(path, pairs, header):
    """GNU gettext .mo (little endian, no hash table)."""
    items = sorted([('', header)] + [(k, v) for k, v in pairs.items() if v])
    ids = [k.encode('utf-8') for k, _ in items]
    strs = [v.encode('utf-8') for _, v in items]
    n = len(items)
    key_start = 7 * 4 + 16 * n
    data, offsets_ids, offsets_strs = b'', [], []
    for b in ids:
        offsets_ids.append((len(b), key_start + len(data)))
        data += b + b'\0'
    for b in strs:
        offsets_strs.append((len(b), key_start + len(data)))
        data += b + b'\0'
    out = struct.pack('<7I', 0x950412de, 0, n, 7 * 4, 7 * 4 + 8 * n, 0, key_start)
    out += b''.join(struct.pack('<2I', *o) for o in offsets_ids)
    out += b''.join(struct.pack('<2I', *o) for o in offsets_strs)
    path.write_bytes(out + data)


def write_js(path, pairs):
    body = json.dumps(pairs, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    path.write_text('/* Dolly Employee Management: browser translations, generated by tools/i18n/i18n.py from the .po file. */\n'
                    'window.DOLLY_I18N=' + body + ';\n', encoding='utf-8')


# ---------------------------------------------------------------- checks

PLACEHOLDER = re.compile(r'%(?:\d+\$)?[sdf%]')


def problems(msgid, msgstr):
    if not msgstr:
        return 'untranslated'
    if sorted(PLACEHOLDER.findall(msgid)) != sorted(PLACEHOLDER.findall(msgstr)):
        return 'placeholders differ'
    if re.match(r'\s*', msgid).group(0) != re.match(r'\s*', msgstr).group(0) or re.search(r'\s*$', msgid).group(0) != re.search(r'\s*$', msgstr).group(0):
        return 'leading/trailing whitespace differs'
    return None


# ---------------------------------------------------------------- commands

def po_files():
    return sorted(LANG_DIR.glob(DOMAIN + '-*.po'))


def cmd_update():
    catalog = extract()
    LANG_DIR.mkdir(exist_ok=True)
    write_po(LANG_DIR / (DOMAIN + '.pot'), catalog, {}, '')
    for po in po_files():
        entries, _ = read_po(po)
        locale = po.stem[len(DOMAIN) + 1:]
        write_po(po, catalog, {k: v[0] for k, v in entries.items()}, locale)
        missing = sum(1 for k in catalog if not entries.get(k, ('',))[0])
        print(f'{po.name}: {len(catalog)} strings, {missing} untranslated')
    print(f'{DOMAIN}.pot: {len(catalog)} strings')


def cmd_compile():
    for po in po_files():
        entries, header = read_po(po)
        pairs = {k: v[0] for k, v in entries.items() if v[0]}
        write_mo(po.with_suffix('.mo'), pairs, header)
        js = {k: v[0] for k, v in entries.items() if v[0] and any(r.split(':')[0].endswith('.js') for r in v[1])}
        write_js(po.with_suffix('.js'), js)
        print(f'{po.stem}: {len(pairs)} strings (.mo), {len(js)} for the browser (.js)')


def cmd_check():
    bad = 0
    for po in po_files():
        entries, _ = read_po(po)
        for k, (v, refs) in entries.items():
            p = problems(k, v)
            if p:
                bad += 1
                print(f'{po.name}: {p}: {k!r} -> {v!r} ({refs[0] if refs else ""})')
    print('ok' if not bad else f'{bad} problems')
    return bad


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'update':
        cmd_update()
    elif cmd == 'compile':
        cmd_compile()
    elif cmd == 'check':
        sys.exit(1 if cmd_check() else 0)
    else:
        print(__doc__)
