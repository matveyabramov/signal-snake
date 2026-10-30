#!/usr/bin/env python3
"""Create the offline phone-sized PDF from the existing NO ANSWER performance data."""
import json
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output/pdf/NO_ANSWER_MOBILE.pdf'
INK, BLUE, GREEN = map(colors.HexColor, ['#183356', '#486cdd', '#b8e3be'])
pdfmetrics.registerFont(TTFont('Plex', str(ROOT / 'assets/fonts/ibm-plex-mono-400.ttf')))
pdfmetrics.registerFont(TTFont('Onest', str(ROOT / 'assets/fonts/onest.ttf')))
STYLES = {
    'title': ParagraphStyle('title', fontName='Onest', fontSize=30, leading=35, textColor=INK, spaceAfter=14),
    'heading': ParagraphStyle('heading', fontName='Onest', fontSize=23, leading=29, textColor=INK, spaceAfter=12),
    'body': ParagraphStyle('body', fontName='Onest', fontSize=18, leading=25, textColor=INK, spaceAfter=14),
    'action': ParagraphStyle('action', fontName='Onest', fontSize=18, leading=24, textColor=INK, spaceAfter=5),
    'meta': ParagraphStyle('meta', fontName='Plex', fontSize=12, leading=18, textColor=colors.HexColor('#46617d'), spaceAfter=10),
    'label': ParagraphStyle('label', fontName='Plex', fontSize=15, leading=21, textColor=INK, spaceAfter=8),
    'already': ParagraphStyle('already', fontName='Plex', fontSize=12, leading=17, textColor=colors.HexColor('#46617d'), spaceAfter=3),
    'cycle': ParagraphStyle('cycle', fontName='Plex', fontSize=17, leading=23, textColor=BLUE, spaceBefore=4, spaceAfter=2),
}


def text(value, style='body'):
    return Paragraph(escape(value).replace('\n', '<br/>'), STYLES[style])


class Bookmark(Flowable):
    def __init__(self, key, label, level=0):
        super().__init__()
        self.key, self.label, self.level = key, label, level
        self.width = self.height = 0

    def draw(self):
        self.canv.bookmarkPage(self.key)
        self.canv.addOutlineEntry(self.label, self.key, self.level, False)


class Grid(Flowable):
    def __init__(self, rows, labels):
        super().__init__()
        self.rows, self.labels = rows, labels
        self.width, self.height = 342, 31 * (len(rows) + 1) + 8

    def draw(self):
        c = self.canv
        x0, top, pitch, side = 70, self.height - 25, 31, 27
        c.setFont('Plex', 14)
        c.setFillColor(INK)
        for column in range(8):
            c.drawCentredString(x0 + column * pitch + side / 2, top, str(column + 1))
        for row, values in enumerate(self.rows):
            y = top - (row + 1) * pitch
            c.setFillColor(INK)
            c.setFont('Plex', 13)
            c.drawRightString(x0 - 10, y + 8, self.labels[row])
            for column, active in enumerate(values):
                x = x0 + column * pitch
                c.setFillColor(colors.HexColor('#e5efdf'))
                c.setStrokeColor(colors.HexColor('#9eb994'))
                c.rect(x, y, side, side, fill=1, stroke=1)
                if active:
                    c.setFillColor(colors.HexColor('#2b5136'))
                    c.rect(x + 5, y + 5, side - 10, side - 10, fill=1, stroke=0)


def clock(seconds):
    return f'{int(seconds // 60)}:{int(seconds % 60):02d}'


def plans(scene):
    # Same wording and toggle accumulation as performance/score.js.
    sources, names = ['CALL', 'PING', 'CLICK'], ['Eb5', 'C5', 'Bb4', 'G4']
    active = [[False] * 8 for _ in sources]
    result = []
    for step in scene['cycle_actions']:
        sounding = sum(map(sum, active))
        actions = []
        for a in step['actions']:
            kind = a['type']
            if kind == 'rhythm':
                r, col = sources.index(a['source']), a['column'] - 1
                active[r][col] = not active[r][col]
                line = f"{'Включи' if active[r][col] else 'Убери'} {a['source']} - колонка {a['column']}."
            elif kind == 'pitch':
                line = f"PITCH {'+' if a['value'] > 0 else ''}{a['value']}."
            elif kind == 'signal':
                line = f"ПОМЕХИ {a['value']}%."
            elif kind == 'melody':
                suffix = 'убрать эту ноту' if scene['initial_state']['melody'][a['column'] - 1] == a['row'] else 'поставить ноту'
                line = f"MELODY: нажми {names[a['row']]} в колонке {a['column']} - {suffix}."
            elif kind == 'ping':
                line = 'Нажми центральную PING один раз поверх музыки.'
            elif kind == 'scene_next':
                line = 'Выбери следующую сцену сейчас. Начнётся со следующего цикла.'
            elif kind == 'end_call':
                line = 'На последнем шаге 8 нажми END CALL. Финальная нота уже затихнет.'
            else:
                raise ValueError('Unknown existing action: ' + kind)
            actions.append(line)
        result.append((step['cycle'], sounding, actions))
    return result


def decorate(canvas, doc):
    canvas.setFillColor(BLUE)
    canvas.rect(0, 828, 390, 16, fill=1, stroke=0)
    canvas.setFillColor(INK)
    canvas.setFont('Plex', 11)
    canvas.drawString(24, 802, 'NO ANSWER / LIVE SCORE')
    canvas.setFont('Plex', 10)
    canvas.drawString(24, 22, 'SIGNAL SNAKE · 104 BPM')
    canvas.drawRightString(366, 22, str(doc.page))


def main():
    score = json.loads((ROOT / 'performance/NO_ANSWER_SCENES.json').read_text())
    assert score['rhythm_sources'] == ['CALL', 'PING', 'CLICK']
    story = [Bookmark('start', 'Как играть'), text('NO ANSWER', 'title'),
             text('Карта для телефона', 'heading'),
             text('104 BPM · 26 циклов · около двух минут. Один цикл - проход восьми колонок, 4,615 секунды.'),
             text('Ритм каждой сцены начинается с пустой сетки. Нажатые клетки вступают с начала следующего цикла. Не торопись попадать в долю.'),
             text('В последнем цикле сцены выбери следующую - переход дождётся границы. Если задержался, музыка спокойно повторяется.'),
             text('Колонки считаются от 1 до 8. Заполненная клетка - нота или звук, пустая - пауза.'),
             text('Названия на инструменте', 'label'),
             text('PITCH = ВЫСОТА\nMELODY = МЕЛОДИЯ\nRHYTHM = РИТМ\nPING = центральная OK\nEND CALL = ЗАВЕРШИТЬ', 'meta'),
             text('ПОМЕХИ: 0% - чисто, 50% - связь слабеет, 100% - почти потеряна. Батарейка не меняется.', 'meta')]
    for scene in score['scenes']:
        n = scene['number']
        story.extend([PageBreak(), Bookmark(f'scene-{n}', f'{n:02d} {scene["name_ru"]}'),
                      text(f'СЦЕНА {n:02d} / 07', 'label'), text(scene['name_ru'], 'title'),
                      text(f"{clock(scene['start_seconds'])} - {clock(scene['start_seconds'] + scene['duration_seconds'])} · {scene['recommended_cycles']} полных цикла\nТакты {scene['bars'][0]} - {scene['bars'][1]}", 'meta'),
                      text(scene['musical_goal']),
                      text('Начало: PITCH 0 · ПОМЕХИ 0% · ритм пустой.', 'meta'),
                      text('MELODY - начало сцены', 'label'),
                      Grid([[row == r for row in scene['initial_state']['melody']] for r in range(4)], score['note_rows']),
                      Spacer(1, 12), text('RHYTHM - собери сам', 'label'), Grid(scene['target_state']['rhythm'], score['rhythm_sources'])])
        if n == 7:
            story.append(text('Целевой ритм нужен в середине сцены; к финалу убери его.', 'meta'))
        story.extend([PageBreak(), Bookmark(f'actions-{n}', 'Действия по циклам', 1),
                      text(f'{n:02d} / {scene["name_ru"]}', 'label'), text('По циклам', 'heading')])
        for cycle, sounding, actions in plans(scene):
            already = f'{sounding} ритмических события' if sounding else 'только мелодия'
            story.append(KeepTogether([text(f'ЦИКЛ {cycle}', 'cycle'), text(f'Уже звучит: {already}.', 'already'),
                                       *[text(line, 'action') for line in actions], Spacer(1, 3)]))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(OUTPUT), pagesize=(390, 844), leftMargin=24, rightMargin=24,
                            topMargin=58, bottomMargin=42, title='NO ANSWER - карта для iPhone',
                            author='SIGNAL SNAKE', pageCompression=1)
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    print(OUTPUT)


if __name__ == '__main__':
    main()
