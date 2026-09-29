# -*- coding: utf-8 -*-
"""Build the Arabic site (ar/*.html) from the English pages.

    pip install beautifulsoup4
    python3 tools/build_ar.py

Run it after changing any English page or tools/i18n_ar.py. It prints any English text
it could not translate so nothing slips through.
"""
import os, re, sys
from bs4 import BeautifulSoup, Comment, NavigableString

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from i18n_ar import HEADLINES, TEXT, KEEP

URL = 'https://www.madatrips.sa'
PAGES = {'index.html': '/', 'events.html': '/events', 'services.html': '/services', 'about.html': '/about', 'contact.html': '/contact'}
NON_PAGE = ('/assets', '/css', '/js', '/og-image', '/site.webmanifest', '/favicon', '/robots', '/sitemap')
ARABIC_FONTS = '&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&family=Aref+Ruqaa:wght@400;700'
ARROWS = {'→': '←', '↗': '↖', '›': '‹', '↓': '↓'}

def norm(s):
    s = ' '.join(s.split())
    return re.sub(r'\s+([.,?!’;:])', r'\1', s)

def ar_path(p):
    if not p.startswith('/') or p.startswith(NON_PAGE) or p.startswith('/ar'):
        return p
    path, sep, rest = re.match(r'([^?#]*)([?#]?)(.*)', p).groups()
    base = '/ar' if path in ('/', '', '/index.html') else '/ar' + path.replace('.html', '')
    return base + sep + rest

def build(name, en_path):
    soup = BeautifulSoup(open(os.path.join(ROOT, name), encoding='utf-8').read(), 'html.parser')
    ar_url = ar_path(en_path)
    missing = set()

    html = soup.find('html'); html['lang'] = 'ar'; html['dir'] = 'rtl'

    # whole headlines first
    for el in soup.find_all(['h1', 'h2', 'h3', 'p', 'blockquote']):
        key = norm(el.get_text(' '))
        if key in HEADLINES:
            el.clear()
            el.append(BeautifulSoup(HEADLINES[key], 'html.parser'))

    # special cases
    for el in soup.select('.signature--dark'):
        el.string = 'بدر السليمان'
    for el in soup.select('.vision__big b'):
        el.clear(); el.append(BeautifulSoup('<span class="count" data-to="150">0</span> مليون', 'html.parser'))
    for el in soup.select('.manifesto__a span'):
        el.string = '/مَدى/'

    # every remaining text node
    for t in soup.find_all(string=True):
        if isinstance(t, Comment) or t.parent.name in ('script', 'style', 'title'):
            continue
        raw = str(t); key = norm(raw)
        if not key or not re.search(r'[A-Za-z]', key) or key in KEEP:
            continue
        if t.find_parent(class_=['loader__word', 'footer__mega', 'founder__name', 'kbd', 'avatar']):
            continue
        if key in TEXT:
            lead = raw[:len(raw) - len(raw.lstrip())]; trail = raw[len(raw.rstrip()):]
            t.replace_with(NavigableString(lead + TEXT[key] + trail))
        elif not re.fullmatch(r'[A-Z0-9·→\s+\-:/.]{1,12}', key):
            missing.add(key)

    # attributes
    for attr, tag in (('alt', 'ALT'), ('placeholder', 'PLACEHOLDER'), ('aria-label', 'ARIA-LABEL'), ('title', 'TITLE')):
        for el in soup.find_all(attrs={attr: True}):
            v = el[attr].strip()
            if not re.search(r'[A-Za-z]', v) or f'{tag}::{v}' in KEEP:
                continue
            k = f'{tag}::{v}'
            if k in TEXT: el[attr] = TEXT[k]
            elif v in TEXT: el[attr] = TEXT[v]
            else: missing.add(k)
    if soup.title:
        k = 'TITLE::' + soup.title.string
        if k in TEXT: soup.title.string = TEXT[k]
        else: missing.add(k)
    for m in soup.find_all('meta'):
        prop = m.get('property') or m.get('name') or ''
        if prop in ('description', 'og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image:alt', 'apple-mobile-web-app-title'):
            k = 'META::' + m['content']
            if k in TEXT: m['content'] = TEXT[k]
            else: missing.add(k)
        if prop == 'og:url': m['content'] = URL + ar_url
        if prop in ('og:image', 'og:image:secure_url', 'twitter:image'):
            m['content'] = re.sub(r'/og-image\.jpg$', '/assets/og/ar-home.jpg', m['content'])
            m['content'] = re.sub(r'/assets/og/(?!ar-)([a-z]+)\.jpg$', r'/assets/og/ar-\1.jpg', m['content'])
        if prop == 'og:locale': m['content'] = 'ar_SA'
        if prop == 'og:locale:alternate': m['content'] = 'en_US'
    if not soup.find('meta', attrs={'property': 'og:locale'}):
        tag = soup.new_tag('meta'); tag['property'] = 'og:locale'; tag['content'] = 'ar_SA'
        soup.find('meta', attrs={'property': 'og:site_name'}).insert_after(tag)
    canon = soup.find('link', rel='canonical')
    if canon: canon['href'] = URL + ar_url

    # arrows point the other way in RTL
    for el in soup.select('.btn__arrow, .svc__go, .type-row__go, .ev-list i, .btn--light i, .topbar svg + *, .chip-link'):
        for t in el.find_all(string=True):
            t.replace_with(''.join(ARROWS.get(c, c) for c in str(t)))
    for el in soup.select('.btn--light i'):
        if el.string: el.string = ''.join(ARROWS.get(c, c) for c in el.string)

    # links and asset paths
    for el in soup.find_all(True):
        for attr in ('href', 'src', 'poster', 'data-img'):
            v = el.get(attr)
            if not v: continue
            if attr == 'href' and el.name == 'link':
                if not re.match(r'^(https?:|/|#|data:)', v): el[attr] = '/' + v
                continue
            if 'nav__lang' in (el.get('class') or []) or 'menu__lang' in (el.get('class') or []) or 'footer__lang' in (el.get('class') or []):
                continue
            if not re.match(r'^(https?:|/|#|mailto:|tel:|data:|javascript:)', v):
                v = '/' + v
            if attr == 'href' and v.startswith('/'):
                v = ar_path(v)
            el[attr] = v

    # language switch now points back to English
    for el in soup.select('.nav__lang, .menu__lang, .footer__lang'):
        el['href'] = en_path; el['lang'] = 'en'; el['hreflang'] = 'en'; el.string = 'English'

    # phone numbers stay left-to-right inside Arabic text
    for t in soup.find_all(string=re.compile(r'\+966[\d ]+')):
        if t.parent.name in ('script', 'style', 'title') or t.find_parent('head'): continue
        parts = re.split(r'(\+966[\d ]+\d)', str(t))
        new = []
        for part in parts:
            if re.fullmatch(r'\+966[\d ]+\d', part):
                b = soup.new_tag('bdi'); b['dir'] = 'ltr'; b.string = part; new.append(b)
            elif part: new.append(NavigableString(part))
        t.replace_with(*new)

    # Arabic fonts
    for l in soup.find_all('link', href=re.compile('fonts.googleapis.com/css2')):
        if 'IBM+Plex+Sans+Arabic' not in l['href']:
            l['href'] = l['href'].replace('&display=swap', ARABIC_FONTS + '&display=swap')

    out = os.path.join(ROOT, 'ar', 'index.html' if name == 'index.html' else name)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    text = str(soup)
    if not text.lstrip().lower().startswith('<!doctype'):
        text = '<!doctype html>\n' + text
    open(out, 'w', encoding='utf-8').write(text)
    return out, missing

if __name__ == '__main__':
    total = set()
    for name, p in PAGES.items():
        out, missing = build(name, p)
        print(f'built {os.path.relpath(out, ROOT)}' + (f'  ({len(missing)} untranslated)' if missing else ''))
        total |= missing
    if total:
        print('\nUntranslated:'); [print('  ', m) for m in sorted(total)]
