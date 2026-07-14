#!/usr/bin/env python3
"""
NextMav Procure — Complete Product Documentation Generator
Main entry point that combines helpers and content to generate the PDF.
"""

import sys
import os

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import Part 1 (styles and helpers)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "docgen_part1.py")).read())

# Import Part 2 (content)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "docgen_part2.py")).read())

# Build the story
story = build_story(
    h1, h2, h3, h4, p, pl, muted, bullet_list, make_table, hr, spacer,
    PageBreak, KeepTogether, CondPageBreak, Paragraph, style_body, style_muted,
    FONT_BODY, FONT_BOLD
)

# Create the document
doc = TocDocTemplate(
    OUTPUT_PATH,
    pagesize=A4,
    leftMargin=LEFT_MARGIN,
    rightMargin=RIGHT_MARGIN,
    topMargin=TOP_MARGIN,
    bottomMargin=BOTTOM_MARGIN,
    title="NextMav Procure — Complete Product Documentation",
    author="NextMav",
    subject="Enterprise Procurement & Operations Platform Documentation",
    creator="NextMav Procure",
)

# Build with multiBuild for TOC
print(f"Building PDF with {len(story)} flowables...")
doc.multiBuild(story)
print(f"PDF generated: {OUTPUT_PATH}")

# Check file size
file_size = os.path.getsize(OUTPUT_PATH)
print(f"File size: {file_size / 1024 / 1024:.2f} MB")

# Get page count
try:
    import fitz  # PyMuPDF
    pdf_doc = fitz.open(OUTPUT_PATH)
    print(f"Page count: {pdf_doc.page_count}")
    pdf_doc.close()
except:
    print("PyMuPDF not available — cannot count pages")
