# Café Doux — шрифты сайта: по одному файлу на начертание, только нужные символы.
#
# Раньше каждый шрифт был разрезан на 3 части (кириллица / латиница / расширенная латиница),
# и из-за цифр, знаков препинания и одного символа ₽ браузер качал все три: ~525 КБ, 10 файлов.
# Теперь: полные шрифты Google Fonts → один woff2 с нужными символами и осями.
#
# Запуск:  python -I build/fonts.py <папка с исходными .ttf>
#   Literata.ttf, Literata-Italic.ttf, Caveat.ttf, YesevaOne.ttf
#   (github.com/google/fonts: ofl/literata, ofl/caveat, ofl/yesevaone)
import sys, os, io, glob
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

SRC = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'fonts')

# Набор символов: всё, что встречается в текстах сайта, плюс запас — полные русский и базовый
# латинский алфавиты (подпись на открытку посетитель пишет сам), типографские знаки, ₽ и №.
BASE = [
    (0x20, 0x7E),      # базовая латиница, цифры, знаки
    (0xA0, 0xFF),      # неразрывный пробел, «», é, × …
    (0x0400, 0x045F),  # русский алфавит (и ё)
    (0x2010, 0x2027),  # тире, кавычки, многоточие
    (0x2030, 0x203A),
    (0x2190, 0x2193),  # стрелки ← ↑ → ↓
]
EXTRA = [0x0301, 0x20BD, 0x2116, 0x2212, 0x20AC]  # ударение, ₽, №, минус, €

def site_text():
    text = ''
    for pattern in ('*.html', 'js/*.js'):
        for f in glob.glob(os.path.join(ROOT, pattern)):
            text += open(f, encoding='utf-8').read()
    return text

def unicodes():
    u = set(EXTRA)
    for a, b in BASE:
        u.update(range(a, b + 1))
    u.update(ord(c) for c in site_text() if ord(c) > 0x7E and not 0xD800 <= ord(c) <= 0xDFFF)
    # служебные символы-эмодзи и т. п. в шрифтах всё равно отсутствуют — subset их просто пропустит
    return sorted(u)

FONTS = [
    # файл,               результат,             диапазоны осей (лишние насыщенности убираем)
    ('YesevaOne.ttf',       'yeseva-one.woff2',     None),
    ('Literata.ttf',        'literata.woff2',       {'wght': (400, 600)}),
    ('Literata-Italic.ttf', 'literata-italic.woff2', {'wght': (400, 500)}),
    ('Caveat.ttf',          'caveat.woff2',         {'wght': (500, 600)}),
]

codes = unicodes()
for src, out, axes in FONTS:
    font = TTFont(os.path.join(SRC, src))
    if axes:
        font = instancer.instantiateVariableFont(font, axes)
        # после урезания осей шрифт нужно пересобрать, иначе subset спотыкается о старые таблицы
        buf = io.BytesIO()
        font.save(buf)
        buf.seek(0)
        font = TTFont(buf)
    opts = subset.Options()
    opts.flavor = 'woff2'
    # стандартный набор fontTools: кернинг, лигатуры, диакритика. Капитель, дроби, старостильные
    # цифры и стилистические наборы сайт не использует — без них сотни глифов уходят
    opts.layout_features = list(subset.Options().layout_features)
    if src == 'Caveat.ttf':
        # контекстные варианты букв Caveat в коротких подписях сайта на глаз не видны
        # (сравнивали на подписи первого экрана), а весят половину файла: 114 → 60 КБ
        opts.layout_features = [f for f in opts.layout_features if f not in ('calt', 'rclt', 'rand')]
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.hinting = False                  # хинтинг на современных экранах не нужен, а весит заметно
    opts.desubroutinize = True            # лучше сжимается brotli внутри woff2
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=codes)
    sub.subset(font)
    path = os.path.join(OUT, out)
    subset.save_font(font, path, opts)
    print(f'{out:24} {os.path.getsize(path) / 1024:6.1f} KB, glyphs {len(font.getGlyphOrder())}')
