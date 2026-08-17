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

print('Normalized localStorage keys in:')
for path in changed:
    print(f'  {path}')

# Production source should not contain versioned Parola localStorage keys.
for path in Path('web').rglob('*'):
    if not path.is_file() or path.suffix not in text_suffixes:
        continue
    text = path.read_text()
    if 'parola:' in text and (':v1' in text or ':v2' in text):
        raise SystemExit(f'Versioned Parola storage key remains in {path}')
