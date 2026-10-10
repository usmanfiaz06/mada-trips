# Synthetic passport photo pages for testing the MRZ reader (test/ocr.e2e.mjs).
# Usage: python3 test/make-passports.py test/fixtures   (needs Pillow and the DejaVu fonts)
import sys, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1]
W = [7, 3, 1]
def cv(c):
    if c.isdigit(): return int(c)
    if c.isalpha(): return ord(c) - 55
    return 0
def cd(s): return str(sum(cv(c) * W[i % 3] for i, c in enumerate(s)) % 10)
def td3(surname, given, num, nat, dob, sex, exp, opt=''):
    l1 = ('P<' + nat + surname.replace(' ', '<') + '<<' + given.replace(' ', '<')).ljust(44, '<')[:44]
    n = num.ljust(9, '<'); o = opt.ljust(14, '<')
    oc = '<' if set(o) == {'<'} else cd(o)
    body = n + cd(n) + nat + dob + cd(dob) + sex + exp + cd(exp) + o + oc
    return l1, body + cd(body[0:10] + body[13:20] + body[21:43])

MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def page(l1, l2, labels):
    w, h = 1250, 880  # 125 x 88 mm at 10 px/mm, the TD3 page size
    im = Image.new('RGB', (w, h), (236, 228, 210))
    d = ImageDraw.Draw(im)
    rnd = random.Random(4)
    for i in range(0, w, 6):  # faint guilloche-ish lines
        d.line([(i, 0), (i + rnd.randint(-40, 40), h)], fill=(228, 218, 198), width=1)
    d.text((40, 30), labels['country'], font=ImageFont.truetype(BOLD, 30), fill=(70, 60, 50))
    d.text((40, 70), 'PASSPORT  P  ' + labels['code'], font=ImageFont.truetype(SANS, 22), fill=(90, 80, 70))
    d.rectangle([40, 130, 330, 520], fill=(205, 196, 180), outline=(150, 140, 120), width=2)
    d.ellipse([125, 190, 245, 310], fill=(160, 150, 135)); d.pieslice([80, 330, 290, 560], 180, 360, fill=(160, 150, 135))
    f_l = ImageFont.truetype(SANS, 18); f_v = ImageFont.truetype(BOLD, 28)
    y = 140
    for k, v in labels['fields']:
        d.text((380, y), k, font=f_l, fill=(110, 100, 90)); d.text((380, y + 22), v, font=f_v, fill=(30, 30, 30)); y += 72
    # MRZ: 44 chars across about 1170 px, centred 10 px/mm
    f = ImageFont.truetype(MONO, 44)
    d.text((40, 700), l1, font=f, fill=(20, 20, 20))
    d.text((40, 770), l2, font=f, fill=(20, 20, 20))
    return im

def as_photo(im, angle=2.5, blur=1.1, noise=10, scale=0.9, seed=1):
    rnd = random.Random(seed)
    bg = Image.new('RGB', (int(im.width * 1.35), int(im.height * 1.6)), (92, 74, 58))  # wooden table
    dd = ImageDraw.Draw(bg)
    for y in range(0, bg.height, 9): dd.line([(0, y), (bg.width, y + rnd.randint(-6, 6))], fill=(100 + rnd.randint(-8, 8), 80, 62), width=4)
    p = im.rotate(angle, expand=True, resample=Image.BICUBIC, fillcolor=(92, 74, 58))
    bg.paste(p, ((bg.width - p.width) // 2, int(bg.height * 0.18)))
    # uneven light: brighter top-left
    light = Image.linear_gradient('L').rotate(35, expand=True).resize(bg.size)
    bg = Image.composite(bg, Image.eval(bg, lambda v: int(v * 0.78)), light)
    bg = bg.filter(ImageFilter.GaussianBlur(blur))
    px = bg.load()
    for _ in range(bg.width * bg.height // 6):
        x = rnd.randrange(bg.width); y = rnd.randrange(bg.height); r, g, b = px[x, y]; n = rnd.randint(-noise, noise)
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return bg.resize((int(bg.width * scale), int(bg.height * scale)), Image.LANCZOS)

people = {
  'noura': (('ALQAHTANI', 'NOURA FAHAD', 'B47120385', 'SAU', '920517', 'F', '330904'), 'KINGDOM OF SAUDI ARABIA', [('Surname', 'ALQAHTANI'), ('Given names', 'NOURA FAHAD'), ('Passport No.', 'B47120385'), ('Date of birth', '17 MAY 1992'), ('Date of expiry', '04 SEP 2033')]),
  'anna': (('ERIKSSON', 'ANNA MARIA', 'L898902C3', 'UTO', '740812', 'F', '120415', 'ZE184226B'), 'UTOPIA', [('Surname', 'ERIKSSON'), ('Given names', 'ANNA MARIA'), ('Passport No.', 'L898902C3'), ('Date of birth', '12 AUG 1974'), ('Date of expiry', '15 APR 2012')]),
}
for key, (args, country, fields) in people.items():
    l1, l2 = td3(*args)
    print(key, l1, l2, sep='\n')
    im = page(l1, l2, {'country': country, 'code': args[3], 'fields': fields})
    im.save(f'{OUT}/{key}-scan.png')
    as_photo(im).convert('RGB').save(f'{OUT}/{key}-photo.jpg', quality=72)
    as_photo(im, angle=-4, blur=1.8, noise=18, scale=0.75, seed=7).convert('RGB').save(f'{OUT}/{key}-hard.jpg', quality=60)
# Not a passport
im = Image.new('RGB', (1000, 700), (250, 250, 245)); d = ImageDraw.Draw(im)
for i, t in enumerate(['RECEIPT', 'COFFEE 2 X 14.00', 'CAKE 1 X 18.00', 'TOTAL SAR 46.00', 'THANK YOU']):
    d.text((60, 60 + i * 90), t, font=ImageFont.truetype(MONO, 48), fill=(20, 20, 20))
im.save(f'{OUT}/receipt.png')
open(f'{OUT}/notes.txt', 'w').write('not an image\n')
l1, l2 = td3(*people['noura'][0])
im = page(l1, l2, {'country': people['noura'][1], 'code': 'SAU', 'fields': people['noura'][2]})
as_photo(im, angle=8, blur=1.2, noise=12, scale=0.85, seed=3).convert('RGB').save(f'{OUT}/noura-tilt8.jpg', quality=70)
as_photo(im, angle=1, blur=1.0, noise=10, scale=0.9, seed=5).rotate(90, expand=True).convert('RGB').save(f'{OUT}/noura-sideways.jpg', quality=70)
# A misprinted birth date: its check digit no longer agrees, so the reader should flag it.
bad2 = l2[:13] + '920518' + l2[19:]
im = page(l1, bad2, {'country': people['noura'][1], 'code': 'SAU', 'fields': people['noura'][2]})
as_photo(im, angle=1.5, blur=1.0, noise=8, scale=0.9, seed=9).convert('RGB').save(f'{OUT}/noura-baddigit.jpg', quality=72)
