import sys
import json
import fitz  # PyMuPDF
import datetime
import os

# ─── Font paths ──────────────────────────────────────────────────────
NIRMALA_PATH = r"C:\Windows\Fonts\Nirmala.ttc"

# ─── Multilingual Label Dictionaries ─────────────────────────────────
LABELS = {
    "en": {
        "title": "LEGAL ANALYSIS REPORT",
        "subtitle": "NEXUS AI Tribunal - Multi-Agent Legal Investigation",
        "ref": "Reference No.",
        "date": "Date of Analysis",
        "prepared_for": "Prepared For",
        "jurisdiction": "Jurisdiction",
        "jurisdiction_val": "Republic of India",
        "classification": "Classification",
        "classification_val": "CONFIDENTIAL - For Addressee Only",
        "tribunal": "Tribunal Composition",
        "confidence": "Confidence Score",
        "risk": "Risk Level",
        "notice": "This report has been prepared as a structured legal reference document using the NEXUS Multi-Agent AI system. This document is intended solely for the use of the named addressee and should not be circulated without prior written consent.",
        "header": "LEGAL ANALYSIS REPORT",
        "page": "Page",
    },
    "hi": {
        "title": "\u0935\u093f\u0927\u093f\u0915 \u0935\u093f\u0936\u094d\u0932\u0947\u0937\u0923 \u0930\u093f\u092a\u094b\u0930\u094d\u091f",
        "subtitle": "NEXUS AI \u0928\u094d\u092f\u093e\u092f\u093e\u0927\u093f\u0915\u0930\u0923 - \u092c\u0939\u0941-\u090f\u091c\u0947\u0902\u091f \u0935\u093f\u0927\u093f\u0915 \u091c\u093e\u0901\u091a",
        "ref": "\u0938\u0902\u0926\u0930\u094d\u092d \u0938\u0902\u0916\u094d\u092f\u093e",
        "date": "\u0935\u093f\u0936\u094d\u0932\u0947\u0937\u0923 \u0924\u093f\u0925\u093f",
        "prepared_for": "\u0915\u0947 \u0932\u093f\u090f \u0924\u0948\u092f\u093e\u0930",
        "jurisdiction": "\u0915\u094d\u0937\u0947\u0924\u094d\u0930\u093e\u0927\u093f\u0915\u093e\u0930",
        "jurisdiction_val": "\u092d\u093e\u0930\u0924 \u0917\u0923\u0930\u093e\u091c\u094d\u092f",
        "classification": "\u0935\u0930\u094d\u0917\u0940\u0915\u0930\u0923",
        "classification_val": "\u0917\u094b\u092a\u0928\u0940\u092f - \u0915\u0947\u0935\u0932 \u092a\u094d\u0930\u093e\u092a\u094d\u0924\u0915\u0930\u094d\u0924\u093e \u0915\u0947 \u0932\u093f\u090f",
        "tribunal": "\u0928\u094d\u092f\u093e\u092f\u093e\u0927\u093f\u0915\u0930\u0923 \u0938\u0902\u0930\u091a\u0928\u093e",
        "confidence": "\u0935\u093f\u0936\u094d\u0935\u093e\u0938 \u0938\u094d\u0915\u094b\u0930",
        "risk": "\u091c\u094b\u0916\u093f\u092e \u0938\u094d\u0924\u0930",
        "notice": "\u092f\u0939 \u0930\u093f\u092a\u094b\u0930\u094d\u091f NEXUS \u092c\u0939\u0941-\u090f\u091c\u0947\u0902\u091f AI \u092a\u094d\u0930\u0923\u093e\u0932\u0940 \u0915\u093e \u0909\u092a\u092f\u094b\u0917 \u0915\u0930\u0924\u0947 \u0939\u0941\u090f \u090f\u0915 \u0938\u0902\u0930\u091a\u093f\u0924 \u0935\u093f\u0927\u093f\u0915 \u0938\u0902\u0926\u0930\u094d\u092d \u0926\u0938\u094d\u0924\u093e\u0935\u0947\u091c\u093c \u0915\u0947 \u0930\u0942\u092a \u092e\u0947\u0902 \u0924\u0948\u092f\u093e\u0930 \u0915\u0940 \u0917\u0908 \u0939\u0948\u0964",
        "header": "\u0935\u093f\u0927\u093f\u0915 \u0935\u093f\u0936\u094d\u0932\u0947\u0937\u0923 \u0930\u093f\u092a\u094b\u0930\u094d\u091f",
        "page": "\u092a\u0943\u0937\u094d\u0920",
    },
    "kn": {
        "title": "\u0c95\u0cbe\u0ca8\u0cc2\u0ca8\u0cc1 \u0cb5\u0cbf\u0cb6\u0ccd\u0cb2\u0cc7\u0cb7\u0ca3\u0cc6 \u0cb5\u0cb0\u0ca6\u0cbf",
        "subtitle": "NEXUS AI \u0ca8\u0ccd\u0caf\u0cbe\u0caf\u0cbe\u0cb2\u0caf - \u0cac\u0cb9\u0cc1-\u0c8f\u0c9c\u0cc6\u0c82\u0c9f\u0ccd \u0c95\u0cbe\u0ca8\u0cc2\u0ca8\u0cc1 \u0ca4\u0ca8\u0cbf\u0c96\u0cc6",
        "ref": "\u0c89\u0cb2\u0ccd\u0cb2\u0cc7\u0c96 \u0cb8\u0c82\u0c96\u0ccd\u0caf\u0cc6",
        "date": "\u0cb5\u0cbf\u0cb6\u0ccd\u0cb2\u0cc7\u0cb7\u0ca3\u0cc6 \u0ca6\u0cbf\u0ca8\u0cbe\u0c82\u0c95",
        "prepared_for": "\u0caf\u0cbe\u0cb0\u0cbf\u0c97\u0cbe\u0c97\u0cbf \u0cb8\u0cbf\u0ca6\u0ccd\u0ca7\u0caa\u0ca1\u0cbf\u0cb8\u0cb2\u0cbe\u0c97\u0cbf\u0ca6\u0cc6",
        "jurisdiction": "\u0ca8\u0ccd\u0caf\u0cbe\u0caf\u0cbe\u0ca7\u0cbf\u0c95\u0cbe\u0cb0\u0cb5\u0ccd\u0caf\u0cbe\u0caa\u0ccd\u0ca4\u0cbf",
        "jurisdiction_val": "\u0cad\u0cbe\u0cb0\u0ca4 \u0c97\u0ca3\u0cb0\u0cbe\u0c9c\u0ccd\u0caf",
        "classification": "\u0cb5\u0cb0\u0ccd\u0c97\u0cc0\u0c95\u0cb0\u0ca3",
        "classification_val": "\u0c97\u0cc1\u0caa\u0ccd\u0ca4 - \u0c95\u0cc7\u0cb5\u0cb2 \u0cb8\u0ccd\u0cb5\u0cc0\u0c95\u0cb0\u0cbf\u0cb8\u0cc1\u0cb5\u0cb5\u0cb0\u0cbf\u0c97\u0cc6",
        "tribunal": "\u0ca8\u0ccd\u0caf\u0cbe\u0caf\u0cbe\u0cb2\u0caf \u0cb0\u0c9a\u0ca8\u0cc6",
        "confidence": "\u0cb5\u0cbf\u0cb6\u0ccd\u0cb5\u0cbe\u0cb8 \u0c85\u0c82\u0c95",
        "risk": "\u0c85\u0caa\u0cbe\u0caf \u0cae\u0c9f\u0ccd\u0c9f",
        "notice": "\u0c88 \u0cb5\u0cb0\u0ca6\u0cbf\u0caf\u0ca8\u0ccd\u0ca8\u0cc1 NEXUS \u0cac\u0cb9\u0cc1-\u0c8f\u0c9c\u0cc6\u0c82\u0c9f\u0ccd AI \u0cb5\u0ccd\u0caf\u0cb5\u0cb8\u0ccd\u0ca5\u0cc6\u0caf\u0ca8\u0ccd\u0ca8\u0cc1 \u0cac\u0cb3\u0cb8\u0cbf \u0cb8\u0c82\u0cb0\u0c9a\u0cbf\u0ca4 \u0c95\u0cbe\u0ca8\u0cc2\u0ca8\u0cc1 \u0c89\u0cb2\u0ccd\u0cb2\u0cc7\u0c96 \u0ca6\u0cb8\u0ccd\u0ca4\u0cbe\u0cb5\u0cc7\u0c9c\u0cbe\u0c97\u0cbf \u0cb8\u0cbf\u0ca6\u0ccd\u0ca7\u0caa\u0ca1\u0cbf\u0cb8\u0cb2\u0cbe\u0c97\u0cbf\u0ca6\u0cc6.",
        "header": "\u0c95\u0cbe\u0ca8\u0cc2\u0ca8\u0cc1 \u0cb5\u0cbf\u0cb6\u0ccd\u0cb2\u0cc7\u0cb7\u0ca3\u0cc6 \u0cb5\u0cb0\u0ca6\u0cbf",
        "page": "\u0caa\u0cc1\u0c9f",
    },
    "te": {
        "title": "\u0c1a\u0c1f\u0c4d\u0c1f\u0c2a\u0c30\u0c2e\u0c48\u0c28 \u0c35\u0c3f\u0c36\u0c4d\u0c32\u0c47\u0c37\u0c23 \u0c28\u0c3f\u0c35\u0c47\u0c26\u0c3f\u0c15",
        "subtitle": "NEXUS AI - \u0c2c\u0c39\u0c41\u0c33-\u0c0f\u0c1c\u0c46\u0c02\u0c1f\u0c4d \u0c1a\u0c1f\u0c4d\u0c1f \u0c2a\u0c30\u0c3f\u0c36\u0c4b\u0c27\u0c28",
        "ref": "\u0c38\u0c02\u0c26\u0c30\u0c4d\u0c2d \u0c38\u0c02\u0c16\u0c4d\u0c2f",
        "date": "\u0c35\u0c3f\u0c36\u0c4d\u0c32\u0c47\u0c37\u0c23 \u0c24\u0c47\u0c26\u0c40",
        "prepared_for": "\u0c15\u0c4b\u0c38\u0c02 \u0c24\u0c2f\u0c3e\u0c30\u0c41 \u0c1a\u0c47\u0c2f\u0c2c\u0c21\u0c3f\u0c02\u0c26\u0c3f",
        "jurisdiction": "\u0c28\u0c4d\u0c2f\u0c3e\u0c2f\u0c2a\u0c30\u0c3f\u0c27\u0c3f",
        "jurisdiction_val": "\u0c2d\u0c3e\u0c30\u0c24 \u0c17\u0c23\u0c30\u0c3e\u0c1c\u0c4d\u0c2f\u0c02",
        "classification": "\u0c35\u0c30\u0c4d\u0c17\u0c40\u0c15\u0c30\u0c23",
        "classification_val": "\u0c30\u0c39\u0c38\u0c4d\u0c2f\u0c02 - \u0c15\u0c47\u0c35\u0c32\u0c02 \u0c38\u0c4d\u0c35\u0c40\u0c15\u0c30\u0c3f\u0c02\u0c1a\u0c47\u0c35\u0c3e\u0c30\u0c3f\u0c15\u0c3f",
        "tribunal": "\u0c1f\u0c4d\u0c30\u0c3f\u0c2c\u0c4d\u0c2f\u0c41\u0c28\u0c32\u0c4d \u0c28\u0c3f\u0c30\u0c4d\u0c2e\u0c3e\u0c23\u0c02",
        "confidence": "\u0c35\u0c3f\u0c36\u0c4d\u0c35\u0c3e\u0c38 \u0c38\u0c4d\u0c15\u0c4b\u0c30\u0c41",
        "risk": "\u0c30\u0c3f\u0c38\u0c4d\u0c15\u0c4d \u0c38\u0c4d\u0c25\u0c3e\u0c2f\u0c3f",
        "notice": "\u0c08 \u0c28\u0c3f\u0c35\u0c47\u0c26\u0c3f\u0c15 NEXUS \u0c2c\u0c39\u0c41\u0c33-\u0c0f\u0c1c\u0c46\u0c02\u0c1f\u0c4d AI \u0c35\u0c4d\u0c2f\u0c35\u0c38\u0c4d\u0c25 \u0c09\u0c2a\u0c2f\u0c4b\u0c17\u0c3f\u0c02\u0c1a\u0c3f \u0c24\u0c2f\u0c3e\u0c30\u0c41 \u0c1a\u0c47\u0c2f\u0c2c\u0c21\u0c3f\u0c02\u0c26\u0c3f.",
        "header": "\u0c1a\u0c1f\u0c4d\u0c1f\u0c2a\u0c30\u0c2e\u0c48\u0c28 \u0c35\u0c3f\u0c36\u0c4d\u0c32\u0c47\u0c37\u0c23 \u0c28\u0c3f\u0c35\u0c47\u0c26\u0c3f\u0c15",
        "page": "\u0c2a\u0c47\u0c1c\u0c40",
    },
    "ta": {
        "title": "\u0b9a\u0b9f\u0bcd\u0b9f \u0b86\u0baf\u0bcd\u0bb5\u0bc1 \u0b85\u0bb1\u0bbf\u0b95\u0bcd\u0b95\u0bc8",
        "subtitle": "NEXUS AI - \u0baa\u0bb2\u0bcd-\u0b8f\u0b9c\u0bc6\u0ba3\u0bcd\u0b9f\u0bcd \u0b9a\u0b9f\u0bcd\u0b9f \u0b86\u0baf\u0bcd\u0bb5\u0bc1",
        "ref": "\u0b95\u0bc1\u0bb1\u0bbf\u0baa\u0bcd\u0baa\u0bc1 \u0b8e\u0ba3\u0bcd",
        "date": "\u0bb5\u0bbf\u0b9a\u0bbe\u0bb0\u0ba3\u0bc8 \u0ba4\u0bc7\u0ba4\u0bbf",
        "prepared_for": "\u0baf\u0bbe\u0bb0\u0bc1\u0b95\u0bcd\u0b95\u0bbe\u0b95 \u0ba4\u0baf\u0bbe\u0bb0\u0bbf\u0b95\u0bcd\u0b95\u0baa\u0bcd\u0baa\u0b9f\u0bcd\u0b9f\u0ba4\u0bc1",
        "jurisdiction": "\u0b85\u0ba4\u0bbf\u0b95\u0bbe\u0bb0 \u0baa\u0bb0\u0bbf\u0ba4\u0bbf",
        "jurisdiction_val": "\u0b87\u0ba8\u0bcd\u0ba4\u0bbf\u0baf \u0b95\u0bc1\u0b9f\u0bbf\u0baf\u0bb0\u0b9a\u0bc1",
        "classification": "\u0bb5\u0b95\u0bc8\u0baa\u0bcd\u0baa\u0bbe\u0b9f\u0bc1",
        "classification_val": "\u0bb0\u0b95\u0b9a\u0bbf\u0baf\u0bae\u0bbe\u0ba9\u0ba4\u0bc1 - \u0baa\u0bc6\u0bb1\u0bc1\u0ba8\u0bb0\u0bc1\u0b95\u0bcd\u0b95\u0bc1 \u0bae\u0b9f\u0bcd\u0b9f\u0bc1\u0bae\u0bc7",
        "tribunal": "\u0ba8\u0bc0\u0ba4\u0bbf\u0bae\u0ba9\u0bcd\u0bb1 \u0b85\u0bae\u0bc8\u0baa\u0bcd\u0baa\u0bc1",
        "confidence": "\u0ba8\u0bae\u0bcd\u0baa\u0bbf\u0b95\u0bcd\u0b95\u0bc8 \u0bae\u0ba4\u0bbf\u0baa\u0bcd\u0baa\u0bc6\u0ba3\u0bcd",
        "risk": "\u0b86\u0baa\u0ba4\u0bcd\u0ba4\u0bc1 \u0bae\u0b9f\u0bcd\u0b9f\u0bae\u0bcd",
        "notice": "\u0b87\u0ba8\u0bcd\u0ba4 \u0b85\u0bb1\u0bbf\u0b95\u0bcd\u0b95\u0bc8 NEXUS \u0baa\u0bb2\u0bcd-\u0b8f\u0b9c\u0bc6\u0ba3\u0bcd\u0b9f\u0bcd AI \u0b85\u0bae\u0bc8\u0baa\u0bcd\u0baa\u0bc8 \u0baa\u0baf\u0ba9\u0bcd\u0baa\u0b9f\u0bc1\u0ba4\u0bcd\u0ba4\u0bbf \u0ba4\u0baf\u0bbe\u0bb0\u0bbf\u0b95\u0bcd\u0b95\u0baa\u0bcd\u0baa\u0b9f\u0bcd\u0b9f\u0ba4\u0bc1.",
        "header": "\u0b9a\u0b9f\u0bcd\u0b9f \u0b86\u0baf\u0bcd\u0bb5\u0bc1 \u0b85\u0bb1\u0bbf\u0b95\u0bcd\u0b95\u0bc8",
        "page": "\u0baa\u0b95\u0bcd\u0b95\u0bae\u0bcd",
    },
}

def get_labels(lang):
    return LABELS.get(lang, LABELS["en"])

def is_indic(lang):
    return lang in ("hi", "kn", "te", "ta")

def has_indic_chars(text):
    return any(ord(c) > 0x0900 for c in text)

def draw_cover_page(doc, session_id, agent_count, confidence, risk_level, lang="en"):
    page = doc.new_page()
    L = get_labels(lang)
    use_nirmala = is_indic(lang) and os.path.exists(NIRMALA_PATH)

    font_helv = fitz.Font("Helvetica")
    font_helvb = fitz.Font("Helvetica-Bold")
    font_times_bold = fitz.Font("Times-Bold")
    font_helv_italic = fitz.Font("Helvetica-Oblique")
    font_nirmala = fitz.Font(fontfile=NIRMALA_PATH) if use_nirmala else None

    page.draw_rect(fitz.Rect(0, 0, 595, 20), color=(0.1, 0.2, 0.4), fill=(0.1, 0.2, 0.4))
    
    # Title
    tw = fitz.TextWriter(page.rect)
    if use_nirmala:
        tw.append((50, 100), L["title"], font=font_nirmala, fontsize=24)
    else:
        tw.append((50, 100), L["title"], font=font_times_bold, fontsize=28)
    tw.write_text(page, color=(0.1, 0.2, 0.4))

    tw = fitz.TextWriter(page.rect)
    if use_nirmala:
        tw.append((50, 130), L["subtitle"], font=font_nirmala, fontsize=12)
    else:
        tw.append((50, 130), L["subtitle"], font=font_helv_italic, fontsize=14)
    tw.write_text(page, color=(0.4, 0.4, 0.4))
    
    page.draw_line(fitz.Point(50, 145), fitz.Point(545, 145), color=(0.8, 0.8, 0.8), width=1)

    date_str = datetime.datetime.now().strftime("%d %B %Y")
    fields = [
        (L["ref"], f"NEXUS/AI/{datetime.datetime.now().year}/{session_id[:8].upper()}"),
        (L["date"], date_str),
        (L["prepared_for"], "Authorized System User"),
        (L["jurisdiction"], L["jurisdiction_val"]),
        (L["classification"], L["classification_val"]),
        (L["tribunal"], f"{agent_count} AI Agents"),
        (L["confidence"], f"{confidence}%"),
        (L["risk"], str(risk_level).upper())
    ]
    
    y = 200
    for label, val in fields:
        page.draw_rect(fitz.Rect(50, y, 210, y + 30), color=(0.8, 0.8, 0.8))
        page.draw_rect(fitz.Rect(210, y, 545, y + 30), color=(0.8, 0.8, 0.8))
        page.draw_rect(fitz.Rect(50, y, 210, y + 30), color=(0.95, 0.95, 0.95), fill=(0.95, 0.95, 0.95))
        
        tw = fitz.TextWriter(page.rect)
        lf = font_nirmala if (use_nirmala and has_indic_chars(label)) else font_helvb
        tw.append((60, y + 20), label, font=lf, fontsize=10)
        tw.write_text(page, color=(0.1, 0.1, 0.1))
        
        tw = fitz.TextWriter(page.rect)
        vf = font_nirmala if (use_nirmala and has_indic_chars(val)) else font_helv
        tw.append((220, y + 20), val, font=vf, fontsize=10)
        tw.write_text(page, color=(0.2, 0.2, 0.2))
        
        y += 30

    if use_nirmala:
        # Manual word wrap with TextWriter for Indic scripts
        notice_text = L["notice"]
        words = notice_text.split(' ')
        line = ""
        line_y = y + 75
        max_w = 495  # 545 - 50
        for word in words:
            test = (line + " " + word).strip()
            tw_test = fitz.TextWriter(page.rect)
            tw_test.append((0, 0), test, font=font_nirmala, fontsize=9)
            text_length = tw_test.text_rect.width
            if text_length > max_w and line:
                tw_n = fitz.TextWriter(page.rect)
                tw_n.append((50, line_y), line, font=font_nirmala, fontsize=9)
                tw_n.write_text(page, color=(0.3, 0.3, 0.3))
                line = word
                line_y += 14
            else:
                line = test
        if line:
            tw_n = fitz.TextWriter(page.rect)
            tw_n.append((50, line_y), line, font=font_nirmala, fontsize=9)
            tw_n.write_text(page, color=(0.3, 0.3, 0.3))
    else:
        page.insert_textbox(fitz.Rect(50, y + 60, 545, y + 160), L["notice"], fontname="helv", fontsize=10, color=(0.3, 0.3, 0.3), align=fitz.TEXT_ALIGN_JUSTIFY)
    
    page.draw_line(fitz.Point(50, 780), fitz.Point(545, 780), color=(0.8, 0.8, 0.8), width=1)
    tw = fitz.TextWriter(page.rect)
    tw.append((50, 800), f"Ref: NEXUS/AI/{session_id[:8].upper()}", font=font_helv, fontsize=9)
    pl = f"{L['page']} 1"
    pf = font_nirmala if (use_nirmala and has_indic_chars(pl)) else font_helvb
    tw.append((490, 800), pl, font=pf, fontsize=9)
    tw.write_text(page, color=(0.5, 0.5, 0.5))


def render_pdf(session_id, verdict_text, confidence, risk_level, output_path, lang="en"):
    doc = fitz.open()
    L = get_labels(lang)
    use_nirmala = is_indic(lang) and os.path.exists(NIRMALA_PATH)

    draw_cover_page(doc, session_id, 50, confidence, risk_level, lang)

    # For Story HTML body, embed Nirmala for Indic rendering
    if use_nirmala:
        font_face = f'@font-face {{ font-family: "NirmalaUI"; src: url("{NIRMALA_PATH.replace(chr(92), "/")}"); }}'
        body_font = '"NirmalaUI", "Nirmala UI", sans-serif'
    else:
        font_face = ""
        body_font = '"Helvetica", sans-serif'

    html = f"""
    <html>
    <head>
    <style>
      {font_face}
      body {{ font-family: {body_font}; font-size: 11px; line-height: 1.6; color: #222; text-align: justify; }}
      h2 {{ font-size: 16px; color: #1a365d; margin-top: 24px; margin-bottom: 12px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }}
      h3 {{ font-size: 13px; color: #333; margin-top: 16px; }}
      p {{ margin-bottom: 12px; }}
      strong {{ color: #111; }}
      ul {{ margin-bottom: 12px; margin-left: 15px; }}
      li {{ margin-bottom: 6px; }}
    </style>
    </head>
    <body>
      {verdict_text}
    </body>
    </html>
    """

    rect = fitz.Rect(50, 60, 545, 760) 
    
    try:
        story = fitz.Story(html=html)
        temp_path = output_path + ".temp.pdf"
        writer = fitz.DocumentWriter(temp_path)
    except Exception as e:
        print(f"Error initializing Story: {e}")
        sys.exit(1)

    more = 1
    page_num = 2
    while more:
        dev = writer.begin_page(fitz.paper_rect("a4"))
        more, _ = story.place(rect)
        story.draw(dev)
        writer.end_page()
    writer.close()

    # Apply headers/footers using TextWriter
    font_helv = fitz.Font("Helvetica")
    font_helvb = fitz.Font("Helvetica-Bold")
    font_times_bold = fitz.Font("Times-Bold")
    font_nirmala = fitz.Font(fontfile=NIRMALA_PATH) if use_nirmala else None

    story_doc = fitz.open(temp_path)
    for p in story_doc:
        # Header
        tw = fitz.TextWriter(p.rect)
        header_font = font_nirmala if (use_nirmala and has_indic_chars(L["header"])) else font_times_bold
        tw.append((50, 40), L["header"], font=header_font, fontsize=10)
        tw.write_text(p, color=(0.4, 0.4, 0.5))
        p.draw_line(fitz.Point(50, 45), fitz.Point(545, 45), color=(0.8, 0.8, 0.8), width=1)
        
        # Footer
        p.draw_line(fitz.Point(50, 780), fitz.Point(545, 780), color=(0.8, 0.8, 0.8), width=1)
        tw = fitz.TextWriter(p.rect)
        tw.append((50, 800), f"Ref: NEXUS/AI/{session_id[:8].upper()}", font=font_helv, fontsize=9)
        page_label = f"{L['page']} {page_num}"
        pg_font = font_nirmala if (use_nirmala and has_indic_chars(page_label)) else font_helvb
        tw.append((490, 800), page_label, font=pg_font, fontsize=9)
        tw.write_text(p, color=(0.5, 0.5, 0.5))
        page_num += 1

    doc.insert_pdf(story_doc)
    doc.save(output_path, garbage=4, deflate=True)
    doc.close()
    story_doc.close()
    
    try:
        os.remove(temp_path)
    except Exception:
        pass

if __name__ == "__main__":
    try:
        input_data = sys.stdin.read()
        payload = json.loads(input_data)
        
        session_id = payload.get("sessionId", "UNKNOWN")
        verdict = payload.get("verdict", "")
        language = payload.get("language", "en")
        
        # parse basic markdown for PyMuPDF HTML
        while "**" in verdict:
            verdict = verdict.replace("**", "<strong>", 1).replace("**", "</strong>", 1)
            
        new_verdict = []
        for line in verdict.split("\n"):
            line = line.strip()
            if line.startswith("### "):
                new_verdict.append(f"<h3>{line[4:]}</h3>")
            elif line.startswith("## "):
                new_verdict.append(f"<h2>{line[3:]}</h2>")
            elif line.startswith("# "):
                new_verdict.append(f"<h2>{line[2:]}</h2>")
            elif line.startswith("- ") or line.startswith("* "):
                new_verdict.append(f"<li>{line[2:]}</li>")
            elif line == "":
                new_verdict.append("<br/>")
            else:
                new_verdict.append(f"{line}")
        
        final_verdict = ""
        in_list = False
        for line in new_verdict:
            if line.startswith("<li>"):
                if not in_list:
                    final_verdict += "<ul>"
                    in_list = True
                final_verdict += line
            else:
                if in_list:
                    final_verdict += "</ul>"
                    in_list = False
                final_verdict += f"<p>{line}</p>"
        if in_list:
             final_verdict += "</ul>"
             
        confidence = payload.get("confidence", 0)
        risk_level = payload.get("riskLevel", "LOW")
        output_path = payload.get("outputPath", f"Legal_Analysis_{session_id}.pdf")

        render_pdf(session_id, final_verdict, confidence, risk_level, output_path, language)
        print(json.dumps({"success": True, "path": output_path}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)
