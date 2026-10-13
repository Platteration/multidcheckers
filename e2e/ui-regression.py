"""Run against a development server: python e2e/ui-regression.py URL.

Requires Python Playwright and Chromium (PW_CHROMIUM overrides its path).
Development mode matters: the desktop ScrollView assertion is absent in exports.
"""
import os
import sys
from playwright.sync_api import expect, sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5175'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.getenv('PW_CHROMIUM', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url, wait_until='networkidle', timeout=120000)
    page.get_by_role('button', name='Skip', exact=True).click()
    expect(page.get_by_role('button', name='b3, Red man', exact=True)).to_be_visible()
    page.get_by_role('button', name='b3, Red man', exact=True).click()
    page.get_by_role('button', name='a4, move here', exact=True).click()
    expect(page.get_by_text('Black to move · 1 board waiting', exact=True)).to_be_visible()
    page.wait_for_timeout(400)
    page.reload(wait_until='networkidle')
    expect(page.get_by_role('button', name='a4, Red man', exact=True)).to_be_visible()
    for width, height in [(390, 844), (844, 390), (1440, 1000)]:
        page.set_viewport_size({'width': width, 'height': height})
        expect(page.get_by_role('button', name='a4, Red man', exact=True)).to_be_visible()
        expect(page.get_by_role('button', name='Undo', exact=True)).to_be_enabled()
    page.get_by_role('button', name='Undo', exact=True).click()
    expect(page.get_by_role('button', name='b3, Red man', exact=True)).to_be_visible()
    assert not errors, '\n'.join(errors)
    browser.close()
print('PASS: desktop move, reload, phone/landscape resize and undo; no page errors')
