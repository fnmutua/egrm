"""Extract plain text (paragraphs + tables) from .docx files into .txt files."""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}


def para_text(p):
    parts = []
    for node in p.iter():
        tag = node.tag.split('}')[-1]
        if tag == 't' and node.text:
            parts.append(node.text)
        elif tag in ('br', 'cr'):
            parts.append('\n')
        elif tag == 'tab':
            parts.append('\t')
    return ''.join(parts)


def extract_block(parent, depth=0):
    lines = []
    for child in parent:
        tag = child.tag.split('}')[-1]
        if tag == 'p':
            txt = para_text(child).strip()
            # detect heading style
            style = child.find('.//w:pStyle', NS)
            if txt:
                if style is not None and 'Heading' in (style.get(f"{{{NS['w']}}}val") or ''):
                    lvl = re.sub(r'\D', '', style.get(f"{{{NS['w']}}}val") or '') or '1'
                    txt = '#' * min(int(lvl), 6) + ' ' + txt
                lines.append(txt)
        elif tag == 'tbl':
            for row in child.findall('w:tr', NS):
                cells = []
                for cell in row.findall('w:tc', NS):
                    cell_lines = extract_block(cell, depth + 1)
                    cells.append(' '.join(cell_lines).strip())
                lines.append('| ' + ' | '.join(cells) + ' |')
            lines.append('')
    return lines


def extract(path: Path):
    with zipfile.ZipFile(path) as z:
        xml_data = z.read('word/document.xml')
    root = ET.fromstring(xml_data)
    body = root.find('w:body', NS)
    return '\n'.join(extract_block(body))


if __name__ == '__main__':
    folder = Path(sys.argv[1])
    for docx in sorted(folder.glob('*.docx')):
        if docx.name.startswith('~$'):
            continue
        out = docx.with_suffix('.extracted.txt')
        try:
            text = extract(docx)
            out.write_text(text, encoding='utf-8')
            print(f'OK  {docx.name} -> {out.name} ({len(text)} chars)')
        except Exception as e:
            print(f'ERR {docx.name}: {e}')
