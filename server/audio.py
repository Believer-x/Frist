"""Validate bounded WAV uploads without invoking an external decoder."""
import io
import wave
import numpy as np
MAX_UPLOAD = 400_000
MAX_SECONDS = 10


def decode_wav(data: bytes) -> np.ndarray:
    if len(data) > MAX_UPLOAD:
        raise ValueError('Audio upload is too large')
    try:
        with wave.open(io.BytesIO(data), 'rb') as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, 16000, 'NONE'):
                raise ValueError('Expected mono 16 kHz PCM16 WAV')
            frames = audio.getnframes()
            if not 1600 <= frames <= MAX_SECONDS * 16000:
                raise ValueError('Audio duration must be 0.1–10 seconds')
            raw = audio.readframes(frames)
            if len(raw) != frames * 2:
                raise ValueError('Truncated WAV audio')
    except (wave.Error, EOFError) as error:
        raise ValueError('Invalid WAV audio') from error
    return np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
