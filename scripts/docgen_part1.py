#!/usr/bin/env python3
"""
NextMav Procure — Complete Product Documentation Generator
Generates a comprehensive professional PDF documenting every aspect of the platform.
"""

import hashlib
import os
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    Image, KeepTogether, ListFlowable, ListItem, HRFlowable, CondPageBreak,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.platypus.doctemplate import PageTemplate, BaseDocTemplate
from reportlab.platypus.frames import Frame
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register fonts
try:
    pdfmetrics.registerFont(TTFont('NotoSans', '/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('NotoSans-Bold', '/usr/share/fonts/truetype/chinese/NotoSansSC-Bold.ttf'))
    FONT_BODY = 'NotoSans'
    FONT_BOLD = 'NotoSans-Bold'
except:
    FONT_BODY = 'Helvetica'
    FONT_BOLD = 'Helvetica-Bold'

# Palette
PAGE_BG = colors.HexColor('#FFFFFF')
SECTION_BG = colors.HexColor('#F8F9FA')
CARD_BG = colors.HexColor('#F0FDF4')
TABLE_STRIPE = colors.HexColor('#F9FAFB')
HEADER_FILL = colors.HexColor('#064E3B')
COVER_BLOCK = colors.HexColor('#065F46')
BORDER = colors.HexColor('#E5E7EB')
ICON = colors.HexColor('#10B981')
ACCENT = colors.HexColor('#059669')
ACCENT_2 = colors.HexColor('#0EA5E9')
TEXT_PRIMARY = colors.HexColor('#111827')
TEXT_MUTED = colors.HexColor('#6B7280')
SEM_SUCCESS = colors.HexColor('#10B981')
SEM_WARNING = colors.HexColor('#F59E0B')
SEM_ERROR = colors.HexColor('#EF4444')
SEM_INFO = colors.HexColor('#3B82F6')

OUTPUT_PATH = "/home/z/my-project/download/NextMav_Procure_Complete_Documentation.pdf"
PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT_MARGIN = 20 * mm
RIGHT_MARGIN = 20 * mm
TOP_MARGIN = 25 * mm
BOTTOM_MARGIN = 20 * mm
CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN

# --- Styles ---
styles = getSampleStyleSheet()

style_cover_title = ParagraphStyle('CoverTitle', parent=styles['Title'], fontName=FONT_BOLD, fontSize=28, leading=36, textColor=colors.white, alignment=TA_LEFT, spaceAfter=8)
style_cover_subtitle = ParagraphStyle('CoverSubtitle', parent=styles['Normal'], fontName=FONT_BODY, fontSize=14, leading=20, textColor=colors.HexColor('#A7F3D0'), alignment=TA_LEFT, spaceAfter=4)
style_cover_meta = ParagraphStyle('CoverMeta', parent=styles['Normal'], fontName=FONT_BODY, fontSize=10, leading=14, textColor=colors.HexColor('#D1FAE5'), alignment=TA_LEFT)

style_h1 = ParagraphStyle('H1', parent=styles['Heading1'], fontName=FONT_BOLD, fontSize=20, leading=28, textColor=HEADER_FILL, spaceBefore=20, spaceAfter=10, keepWithNext=True)
style_h2 = ParagraphStyle('H2', parent=styles['Heading2'], fontName=FONT_BOLD, fontSize=15, leading=22, textColor=ACCENT, spaceBefore=16, spaceAfter=8, keepWithNext=True)
style_h3 = ParagraphStyle('H3', parent=styles['Heading3'], fontName=FONT_BOLD, fontSize=12, leading=18, textColor=TEXT_PRIMARY, spaceBefore=12, spaceAfter=6, keepWithNext=True)
style_h4 = ParagraphStyle('H4', parent=styles['Heading4'], fontName=FONT_BOLD, fontSize=11, leading=16, textColor=TEXT_MUTED, spaceBefore=10, spaceAfter=4, keepWithNext=True)

style_body = ParagraphStyle('Body', parent=styles['Normal'], fontName=FONT_BODY, fontSize=10, leading=15, textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=6)
style_body_left = ParagraphStyle('BodyLeft', parent=style_body, alignment=TA_LEFT)
style_bullet = ParagraphStyle('Bullet', parent=style_body, leftIndent=20, bulletIndent=10, spaceAfter=3, alignment=TA_LEFT)
style_muted = ParagraphStyle('Muted', parent=style_body, textColor=TEXT_MUTED, fontSize=9, leading=13)
style_code = ParagraphStyle('Code', parent=styles['Code'], fontName='Courier', fontSize=9, leading=12, textColor=TEXT_PRIMARY, backColor=SECTION_BG, leftIndent=10, rightIndent=10, spaceBefore=4, spaceAfter=4)
style_table_cell = ParagraphStyle('TableCell', parent=style_body, fontSize=9, leading=12, spaceAfter=0, alignment=TA_LEFT)
style_table_header = ParagraphStyle('TableHeader', parent=style_body, fontSize=9, leading=12, spaceAfter=0, fontName=FONT_BOLD, textColor=colors.white, alignment=TA_LEFT)

# TOC styles
toc_level0 = ParagraphStyle('TOC0', fontName=FONT_BOLD, fontSize=11, leading=18, textColor=TEXT_PRIMARY, leftIndent=0, spaceBefore=6)
toc_level1 = ParagraphStyle('TOC1', fontName=FONT_BODY, fontSize=10, leading=16, textColor=TEXT_MUTED, leftIndent=20, spaceBefore=2)
toc_level2 = ParagraphStyle('TOC2', fontName=FONT_BODY, fontSize=9, leading=14, textColor=TEXT_MUTED, leftIndent=40, spaceBefore=1)

# --- TocDocTemplate ---
class TocDocTemplate(BaseDocTemplate):
    def __init__(self, filename, **kw):
        BaseDocTemplate.__init__(self, filename, **kw)
        frame = Frame(LEFT_MARGIN, BOTTOM_MARGIN, CONTENT_WIDTH, PAGE_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN, id='normal')
        template = PageTemplate(id='main', frames=frame, onPage=self.draw_page_footer)
        self.addPageTemplates([template])

    def afterFlowable(self, flowable):
        if hasattr(flowable, 'bookmark_name'):
            level = getattr(flowable, 'bookmark_level', 0)
            text = getattr(flowable, 'bookmark_text', '')
            key = getattr(flowable, 'bookmark_key', '')
            self.notify('TOCEntry', (level, text, self.page, key))

    def draw_page_footer(self, canvas, doc):
        canvas.saveState()
        canvas.setFont(FONT_BODY, 8)
        canvas.setFillColor(TEXT_MUTED)
        canvas.drawString(LEFT_MARGIN, 10 * mm, "NextMav Procure — Complete Product Documentation")
        canvas.drawRightString(PAGE_WIDTH - RIGHT_MARGIN, 10 * mm, f"Page {doc.page}")
        canvas.setStrokeColor(BORDER)
        canvas.setLineWidth(0.5)
        canvas.line(LEFT_MARGIN, 13 * mm, PAGE_WIDTH - RIGHT_MARGIN, 13 * mm)
        canvas.restoreState()

# --- Helper functions ---
def add_heading(text, style, level=0):
    key = f'h_{hashlib.md5(text.encode()).hexdigest()[:8]}'
    p = Paragraph(f'<a name="{key}"/>{text}', style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p

def h1(text): return add_heading(text, style_h1, 0)
def h2(text): return add_heading(text, style_h2, 1)
def h3(text): return add_heading(text, style_h3, 2)
def h4(text): return Paragraph(text, style_h4)

def p(text): return Paragraph(text, style_body)
def pl(text): return Paragraph(text, style_body_left)
def muted(text): return Paragraph(text, style_muted)

def bullet_list(items):
    """Returns a list of Paragraph flowables with bullet formatting."""
    flowables = []
    for item in items:
        flowables.append(Paragraph(f'\u2022 {item}', style_bullet))
    flowables.append(Spacer(1, 4))
    return flowables

def make_table(headers, rows, col_widths=None):
    """Create a professional table with headers and data rows."""
    if col_widths is None:
        col_widths = [CONTENT_WIDTH / len(headers)] * len(headers)
    else:
        total = sum(col_widths)
        col_widths = [w / total * CONTENT_WIDTH for w in col_widths]

    header_row = [Paragraph(h, style_table_header) for h in headers]
    data_rows = [[Paragraph(str(c), style_table_cell) for c in row] for row in rows]
    t = Table([header_row] + data_rows, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), FONT_BOLD),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('BACKGROUND', (0, 1), (-1, -1), colors.white),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, TABLE_STRIPE]),
        ('TEXTCOLOR', (0, 1), (-1, -1), TEXT_PRIMARY),
        ('FONTNAME', (0, 1), (-1, -1), FONT_BODY),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('TOPPADDING', (0, 1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    return t

def hr():
    return HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceBefore=6, spaceAfter=6)

def spacer(h=6): return Spacer(1, h)

print("Script part 1 loaded — styles and helpers defined")
