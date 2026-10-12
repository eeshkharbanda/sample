"""Builds preview.html: the site/ website as one self-contained page in demo-login mode,
for publishing as a test link (no Firebase needed). Run: python3 build-preview.py"""
import re, pathlib
here = pathlib.Path(__file__).parent
site = here / 'site'
html = (site / 'index.html').read_text()
demo = (site / 'demo-firebase.js').read_text().replace('export const ', 'const ')
account = (site / 'account.js').read_text()
account = re.sub(r"^import \{ firebaseConfig \}.*\n", '', account, flags=re.M)
account = account.replace('export function ', 'function ')
account = account.replace("await import('./demo-firebase.js')", '({ demoApp, demoAuth, demoFirestore })')
app = re.sub(r"^import \{ createAccount, authMessage \}.*\n", '', (site / 'app.js').read_text(), flags=re.M)
assert 'import(' not in account.replace('import(SDK', '') and 'export ' not in account

head = html[html.index('<title>'):html.index('</head>')]
head = re.sub(r'\s*<meta name="description"[^>]*>', '', head)
head = head.replace('<title>Poly Bag Size Calculator</title>', '<title>Poly Bag Calculator Demo</title>')
body = html[html.index('<body>') + len('<body>'):html.index('<script type="module" src="app.js"></script>')]
bundle = f"{demo}\nconst firebaseConfig = 'demo';\n{account}\n{app}"
(here / 'preview.html').write_text(f"{head.strip()}\n{body.strip()}\n<script type=\"module\">\n{bundle}\n</script>\n")
print('wrote preview.html')
