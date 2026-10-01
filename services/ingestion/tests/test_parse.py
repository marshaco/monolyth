from pathlib import Path

from monolyth_ingestion.parse import filing_text

HTML = (Path(__file__).parent / "fixtures" / "aapl-10q.htm").read_text()


def test_extracts_readable_text():
    assert filing_text(HTML).splitlines() == [
        "UNITED STATES",
        "SECURITIES AND EXCHANGE COMMISSION",
        "Apple Inc. reported net sales of 94,036 million.",
        "Segment\tNet sales",
        "Americas\t$ 41,198",
        "Europe\t$ 24,014",
        "Item 1A. Risk Factors",
    ]


def test_drops_hidden_xbrl_scripts_and_styles():
    text = filing_text(HTML)
    for hidden in ("EntityCentralIndexKey", "window.analytics", "margin", "aapl-20260628"):
        assert hidden not in text
