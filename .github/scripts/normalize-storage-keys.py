from pathlib import Path

replacements = {
    'parola:cards:v1': 'parola:cards',
    'parola:storage-endpoint:v2': 'parola:storage-endpoint',
    'parola:storage-mode:v1': 'parola:storage-mode',
    'parola:card-adder:type:v1': 'parola:card-adder:type',
    'parola:answer-keywords:v1': 'parola:answer-keywords',
    'parola:card-adder:${type}:v1': 'parola:card-adder:${type}',
}

text_suffixes = {'.ts', '.tsx', '.js', '.jsx', '.md', '.json', '.css', '.html'}
changed = []
for path in Path('web').rglob('*'):
    if not path.is_file() or path.suffix not in text_suffixes:
        continue
    text = path.read_text()
    updated = text
    for old, new in replacements.items():
        updated = updated.replace(old, new)
    if updated != text:
        path.write_text(updated)
        changed.append(str(path))

# Treat the current source as the sole release, not as a successor to older builds.
for path in [Path('web/package.json'), Path('web/package-lock.json')]:
    text = path.read_text()
    updated = text.replace('"version": "2.0.0"', '"version": "1.0.0"')
    if updated != text:
        path.write_text(updated)
        changed.append(str(path))

readme = Path('web/README.md')
text = readme.read_text()
updated = text.replace('\nOn first use, the app seeds browser storage from `src/data/current-cards.json`.\n', '\n')
if updated != text:
    readme.write_text(updated)
    changed.append(str(readme))

print('Normalized clean-release source in:')
for path in sorted(set(changed)):
    print(f'  {path}')

# Production source should not contain versioned Parola localStorage keys.
for path in Path('web').rglob('*'):
    if not path.is_file() or path.suffix not in text_suffixes:
        continue
    text = path.read_text()
    if 'parola:' in text and (':v1' in text or ':v2' in text):
        raise SystemExit(f'Versioned Parola storage key remains in {path}')

if '"version": "2.0.0"' in Path('web/package.json').read_text() or '"version": "2.0.0"' in Path('web/package-lock.json').read_text():
    raise SystemExit('Old package release version remains')
