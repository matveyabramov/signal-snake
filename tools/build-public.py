#!/usr/bin/env python3
"""Prepare the SIGNAL SNAKE public allowlist. Default: check only, never publish."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    'snake.css', 'snake.js', 'snake-ui.js', 'snake-engine.js', 'audio.js',
    'assets/vendor/Tone.js', 'assets/vendor/Tone-LICENSE.md', 'assets/vendor/Tone.js.LICENSE.txt',
    'assets/vendor/Tone-dependencies-LICENSES.txt',
    'THIRD-PARTY-NOTICES.md',
    'assets/audio/call.wav', 'assets/audio/ping.wav', 'assets/audio/click.wav',
    'assets/fonts/pixel-ultima-bold.woff2', 'assets/fonts/Pixel-Ultima-LICENSE.txt',
    'assets/fonts/ibm-plex-mono-400.woff2', 'assets/fonts/IBM-Plex-Mono-LICENSE.txt',
    'assets/fonts/onest.ttf', 'assets/fonts/Onest-LICENSE.txt',
    *['assets/nokia/' + name + '.svg' for name in [
        'background-contained-halo', 'background-glow-right', 'd-pad-arrow-up',
        'd-pad-arrow-down', 'd-pad-arrow-left', 'd-pad-arrow-right', 'melody-editable-note']],
]


def prepare():
    files = {name: (ROOT / name).read_bytes() for name in FILES}
    files['index.html'] = (ROOT / 'snake.html').read_bytes()
    files['.nojekyll'] = b''
    # Only the data consumed by the instrument. No HTML maps, PDF, raw score file,
    # timing tables, cheat sheet, diagnostics, or development pages are copied.
    score = json.loads((ROOT / 'performance/NO_ANSWER_SCENES.json').read_text())
    runtime = {key: score[key] for key in ['bpm', 'steps', 'rhythm_sources', 'recommended_cycles']}
    runtime['scenes'] = [{
        **{key: scene[key] for key in ['id', 'number', 'name_ru', 'recommended_cycles',
                                      'initial_state', 'cycle_actions', 'musical_goal']},
        # Retain the existing validator's target-grid check; targets never drive playback.
        'target_state': {'rhythm': scene['target_state']['rhythm']},
    } for scene in score['scenes']]
    story = (ROOT / 'snake-story.js').read_text()
    start = story.index("    api.ready = fetch('performance/NO_ANSWER_SCENES.json')")
    end = story.index('.then(api.validate);', start) + len('.then(api.validate);')
    payload = json.dumps(runtime, ensure_ascii=False, separators=(',', ':'))
    story = story[:start] + '    api.ready = Promise.resolve().then(() => api.validate(' + payload + '));' + story[end:]
    files['snake-story.js'] = story.encode()
    assert not any(Path(name).parts[0] in ['performance', 'docs', 'tests', 'tools', 'output', 'build'] for name in files)
    assert not any(name.endswith(('.pdf', '.mp3', '.json')) for name in files)
    html = files['index.html'].decode()
    for internal in ['Stage 3', 'Functional Core', 'performance/', 'snake-core.html', 'score-links', '<footer']:
        assert internal not in html, 'Internal navigation in public entry: ' + internal
    assert 'performance/' not in story
    assert runtime['rhythm_sources'] == ['CALL', 'PING', 'CLICK']
    # Check every static resource against the allowlist, including CSS fonts.
    references = re.findall(r'(?:src|href)=[\"\']([^\"\']+)', html)
    references += re.findall(r'url\([\"\']?([^\"\')]+)', files['snake.css'].decode())
    for reference in references:
        if reference.startswith('data:'):
            continue
        if reference.startswith(('/', 'http:', 'https:', '//')) or reference not in files:
            raise ValueError('Resource must be local and included in dist: ' + reference)
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Validate without writing (the default).')
    mode.add_argument('--output', type=Path, help='Write a build directory (use dist/ for production).')
    args = parser.parse_args()
    files = prepare()
    if args.output:
        destination = args.output.resolve()
        if destination == ROOT or destination in ROOT.parents or args.output.is_symlink():
            parser.error('--output must be a separate build directory, never the project or its parent.')
        if destination.exists():
            existing = list(destination.rglob('*'))
            if any(p.is_symlink() for p in existing):
                parser.error('Refusing to overwrite a build containing symlinks.')
            allowed = set(files) | {parent.as_posix() for name in files for parent in Path(name).parents if parent != Path('.')}
            unexpected = {p.relative_to(destination).as_posix() for p in existing} - allowed
            if unexpected:
                parser.error('Build contains unknown files; inspect them first: ' + ', '.join(sorted(unexpected)))
        destination.mkdir(parents=True, exist_ok=True)
        for name, data in files.items():
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    print(json.dumps({'mode': 'write' if args.output else 'check', 'publish': False,
                      'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}, indent=2))


if __name__ == '__main__':
    main()
