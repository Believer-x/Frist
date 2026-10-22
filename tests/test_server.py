import io
import unittest
import wave
from types import SimpleNamespace
import numpy as np
from fastapi.testclient import TestClient
from server.app import create_app
from server.audio import decode_wav


def wav(rate=16000, frames=16000):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes((np.sin(np.arange(frames) / 10) * 2000).astype('<i2').tobytes())
    return buffer.getvalue()


class Model:
    def transcribe(self, audio, **kwargs):
        assert audio.dtype == np.float32 and len(audio) == 16000
        assert kwargs['vad_filter'] is True
        return iter([SimpleNamespace(text=' Hello world ')]), SimpleNamespace(language='en')


class ServerTests(unittest.TestCase):
    def test_audio_validation(self):
        self.assertEqual(len(decode_wav(wav())),16000)
        for invalid in [b'not a wav', wav(rate=8000), wav(frames=16000 * 11), wav()[:-4]]:
            with self.assertRaises(ValueError): decode_wav(invalid)

    def test_health_and_transcription_contract(self):
        with TestClient(create_app(Model())) as client:
            self.assertTrue(client.get('/health').json()['ready'])
            response = client.post('/transcribe?language=en',content=wav(),headers={'Content-Type':'audio/wav'})
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json(),{'text':'Hello world','language':'en'})
            self.assertEqual(client.post('/transcribe?language=BAD',content=wav()).status_code,400)
            self.assertEqual(client.post('/transcribe',content=b'broken').status_code,400)
            self.assertEqual(client.post('/transcribe',content=b'0'*400001).status_code,413)

    def test_blocks_web_origin_and_allows_extension_origin(self):
        with TestClient(create_app(Model())) as client:
            self.assertEqual(client.get('/health',headers={'Origin':'https://random-website.example'}).status_code,403)
            origin = 'chrome-extension://' + 'a'*32
            response = client.options('/transcribe',headers={'Origin':origin})
            self.assertEqual(response.status_code,204)
            self.assertEqual(response.headers['access-control-allow-origin'],origin)


if __name__ == '__main__': unittest.main()
