import re

from bs4 import BeautifulSoup

# Inline XBRL keeps machine-readable facts in a hidden <ix:header>; it isn't part of the readable filing
_DROP = ["script", "style", "head", "ix:header", "noscript"]
_BLOCK = re.compile(r"^(p|div|br|tr|li|h[1-6]|table|section|article)$")


def filing_text(html: str) -> str:
    """Readable plain text of an EDGAR HTML/iXBRL document: one paragraph per line,
    with tables flattened to tab-separated rows."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all(_DROP):
        tag.decompose()
    for tag in soup.find_all(style=re.compile(r"display\s*:\s*none", re.I)):
        tag.decompose()

    for cell in soup.find_all(["td", "th"]):
        cell.append("\t")
    for block in soup.find_all(_BLOCK):
        block.insert_before("\n")
        block.append("\n")

    lines = []
    for line in soup.get_text().splitlines():
        cells = [re.sub(r"\s+", " ", c).strip() for c in line.split("\t")]
        text = "\t".join(c for c in cells if c)
        if text:
            lines.append(text)
    return "\n".join(lines)
