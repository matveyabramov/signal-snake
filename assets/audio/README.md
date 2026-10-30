# Digital Signals

Original local one-shot sources created for RINGTONE MACHINE Stage 1.
No external recording, existing ringtone tune or musical score is included.

- `call.wav`: 660 / 880 Hz dual-tone ring with ONE 8 ms attack and a continuous exponential decay, 0.8 seconds. Stage 2.1 removes the old second burst; the timbre, sample format and total duration are preserved.
- `ping.wav`: decaying C6/G6 notification chime, 0.55 seconds.
- `click.wav`: short descending digital impulse with a noise transient, 0.085 seconds.

Mono PCM WAV, 44.1 kHz, 16 bit. Short attack/release fades avoid discontinuities.
Files are standalone timbres; rhythms and phrases are supplied by live pad input.
The three signals use their own Tone.Sampler instances. Live and loop playback
have separate instances and sum into Voice B's independent bus.

Stage 2.1 QA compares the original two-burst waveform in `tests/fixtures/call-stage2-before.wav` with the production source. The fixture is never loaded by the instrument. PING and CLICK are unchanged.

SIGNAL SNAKE Stage 02 removes the fourth NOISE pad and its WAV completely.
The CALL, PING and CLICK source files are unchanged. Historical score/session
events for pad index 3 are treated as rests without renumbering other sounds.
