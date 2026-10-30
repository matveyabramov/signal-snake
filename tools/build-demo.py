#!/usr/bin/env python3
"""A local, dependency-free demonstration build. NO publishing.
Preview module/media, import loader, listening UI and tests are physically absent.
"""
from pathlib import Path
import shutil,re,json,hashlib
root=Path(__file__).resolve().parents[1]
out=root/'build'/'demo'
if out.exists():shutil.rmtree(out)
out.mkdir(parents=True)
files=['index.html','style.css','app.js','loop-engine.js','audio.js','timeline.js','roll-core.js','piano-roll.js','composition.js','song.js']
for name in files:
 text=(root/name).read_text()
 if name=='index.html':text=re.sub(r'<!-- DEV_PREVIEW_BEGIN -->.*?<!-- DEV_PREVIEW_END -->','',text,flags=re.S)
 if name=='song.js':text=re.sub(r'/\* DEV_PREVIEW_BEGIN \*/.*?/\* DEV_PREVIEW_END \*/','',text,flags=re.S)
 (out/name).write_text(text)
(out/'build-config.js').write_text("window.RingtoneBuild=Object.freeze({preview:false,final:true});\n")
for folder in ['audio','fonts','vendor']:shutil.copytree(root/'assets'/folder,out/'assets'/folder)
p=out/'assets/composition';p.mkdir(parents=True)
shutil.copy2(root/'assets/composition/NO_ANSWER_v3_1_score.json',p/'NO_ANSWER_v3_1_score.json')
assert not list(out.rglob('*.mp3')) and not (out/'preview.js').exists() and not (out/'tests').exists()
assert "import('./preview.js')" not in (out/'song.js').read_text()
assert 'preview-panel' not in (out/'index.html').read_text()
manifest={'kind':'manual-live-demo','preview_module':False,'preview_media':False,'files':{str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file()}}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2))
print('Local demo ready:',out,'— preview module, loader, MP3 and listening UI excluded.')
