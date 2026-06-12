"""Combine the eGRM spec markdown files into one styled HTML file and print it to PDF via headless Edge."""
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

import markdown

SPECS = Path(__file__).parent
DOCS = [
    "01-overview.md",
    "02-configuration-model.md",
    "03-domain-model.md",
    "04-workflow-engine.md",
    "05-intake-and-channels.md",
    "06-notifications.md",
    "07-security-access-control.md",
    "08-reporting-kpis.md",
    "09-api-integrations.md",
    "10-requirements-catalogue.md",
    "11-tenant-profiles.md",
    "12-development-plan.md",
]
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

MD_EXT = ["tables", "fenced_code", "sane_lists", "smarty"]

CSS = """
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body {
  font-family: 'Segoe UI', Calibri, Arial, sans-serif;
  font-size: 10.5pt; line-height: 1.45; color: #1f2937; margin: 0;
}
.cover {
  page-break-after: always; display: flex; flex-direction: column;
  justify-content: center; min-height: 240mm; text-align: center;
}
.cover h1 { font-size: 26pt; color: #0f3a5e; margin: 0 0 6mm; border: none; }
.cover .subtitle { font-size: 14pt; color: #374151; margin-bottom: 18mm; }
.cover .meta { font-size: 10.5pt; color: #6b7280; }
.cover .rule { width: 60mm; height: 1.2mm; background: #0f3a5e; margin: 8mm auto; }
.toc { page-break-after: always; }
.toc h1 { font-size: 16pt; }
.toc ol { font-size: 11pt; line-height: 2; }
.toc a { color: #1f2937; text-decoration: none; }
.chapter { page-break-before: always; }
h1 { font-size: 16pt; color: #0f3a5e; border-bottom: 2px solid #0f3a5e; padding-bottom: 2mm; margin-top: 0; }
h2 { font-size: 12.5pt; color: #14532d; margin-top: 7mm; }
h3 { font-size: 11pt; color: #1e3a8a; margin-top: 5mm; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0; font-size: 9pt; page-break-inside: auto; }
th, td { border: 0.3mm solid #cbd5e1; padding: 1.4mm 2mm; text-align: left; vertical-align: top; }
th { background: #eef2f7; color: #0f3a5e; }
tr { page-break-inside: avoid; }
tr:nth-child(even) td { background: #f8fafc; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 9pt; background: #f1f5f9; padding: 0 1mm; border-radius: 1mm; }
pre { background: #f1f5f9; border: 0.3mm solid #e2e8f0; padding: 3mm; border-radius: 1.5mm; overflow-x: hidden; white-space: pre-wrap; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
blockquote { border-left: 1.2mm solid #94a3b8; margin: 3mm 0; padding: 1mm 4mm; color: #475569; background: #f8fafc; }
ul, ol { padding-left: 7mm; }
li { margin: 0.8mm 0; }
a { color: #1d4ed8; }
hr { border: none; border-top: 0.3mm solid #cbd5e1; margin: 5mm 0; }
"""


def doc_anchor(name: str) -> str:
    return "doc-" + name[:2]


def rewrite_links(md_text: str) -> str:
    """Point cross-references between spec files at in-document anchors."""
    def repl(m):
        target = m.group(2)
        if target == "README.md":
            return m.group(1)  # drop link, keep text
        return f"[{m.group(1)}](#{doc_anchor(target)})"
    return re.sub(r"\[([^\]]+)\]\(((?:\d{2}-[\w.-]+|README)\.md)\)", repl, md_text)


def main():
    chapters, toc_items = [], []
    for name in DOCS:
        raw = (SPECS / name).read_text(encoding="utf-8")
        raw = rewrite_links(raw)
        title_match = re.search(r"^#\s+(.+)$", raw, re.M)
        title = title_match.group(1) if title_match else name
        toc_items.append(f'<li><a href="#{doc_anchor(name)}">{title}</a></li>')
        html = markdown.markdown(raw, extensions=MD_EXT)
        chapters.append(f'<div class="chapter" id="{doc_anchor(name)}">{html}</div>')

    today = date.today().strftime("%d %B %Y")
    page = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Generic eGRM Platform — Specifications</title>
<style>{CSS}</style></head><body>
<div class="cover">
  <h1>Generic eGRM Platform</h1>
  <div class="subtitle">System Specifications &mdash; Consolidated Reference Document</div>
  <div class="rule"></div>
  <div class="meta">
    Configurable, multi-client electronic Grievance Redress Mechanism<br>
    Derived from the KISIP implementation and KUSP2 requirements<br><br>
    Version 1.0 &nbsp;&bull;&nbsp; {today}
  </div>
</div>
<div class="toc"><h1>Contents</h1><ol>{''.join(toc_items)}</ol></div>
{''.join(chapters)}
</body></html>"""

    html_path = SPECS / "egrm-specifications.html"
    html_path.write_text(page, encoding="utf-8")
    pdf_path = SPECS / "eGRM-Specifications.pdf"
    subprocess.run([
        EDGE, "--headless", "--disable-gpu", "--no-pdf-header-footer",
        f"--print-to-pdf={pdf_path}", html_path.as_uri(),
    ], check=True, timeout=120)
    print(f"OK {pdf_path} ({pdf_path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    sys.exit(main())
