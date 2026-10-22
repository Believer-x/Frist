"""Local-only speech recognition bridge for the Subtitle Bridge extension."""
import asyncio
import os
import re
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from .audio import MAX_UPLOAD, decode_wav


def create_app(model_override=None):
    lock = asyncio.Lock()

    @asynccontextmanager
    async def lifespan(app):
        if model_override is not None:
            app.state.model = model_override
        else:
            from faster_whisper import WhisperModel
            app.state.model = await asyncio.to_thread(
                WhisperModel,
                os.getenv('WHISPER_MODEL', 'base'),
                device=os.getenv('WHISPER_DEVICE', 'cpu'),
                compute_type=os.getenv('WHISPER_COMPUTE_TYPE', 'int8'),
                cpu_threads=min(4, os.cpu_count() or 1),
                download_root=os.getenv('WHISPER_CACHE_DIR', None),
            )
        yield
        app.state.model = None

    app = FastAPI(title='Subtitle Bridge Speech', lifespan=lifespan)
    app.state.model = None

    @app.middleware('http')
    async def local_clients_only(request, call_next):
        # Bind to loopback; block browser web origins from driving local inference.
        origin = request.headers.get('origin')
        expected_id = os.getenv('SUBTITLE_BRIDGE_EXTENSION_ID')
        allowed = re.fullmatch(r'chrome-extension://[a-p]{32}', origin or '')
        if origin and (not allowed or (expected_id and origin != f'chrome-extension://{expected_id}')):
            from fastapi.responses import JSONResponse
            return JSONResponse({'detail': 'Only extension origins are accepted'}, status_code=403)
        # Extension host permissions allow this cross-origin request. No broad CORS.
        if request.method == 'OPTIONS':
            from fastapi.responses import Response
            return Response(status_code=204, headers={
                'Access-Control-Allow-Origin': origin or 'null',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            })
        response = await call_next(request)
        if origin:
            response.headers['Access-Control-Allow-Origin'] = origin
        return response

    @app.get('/health')
    async def health():
        return {'ready': app.state.model is not None, 'model': os.getenv('WHISPER_MODEL', 'base')}

    @app.post('/transcribe')
    async def transcribe(request: Request, language: str = 'auto'):
        if not re.fullmatch(r'auto|[a-z]{2,3}', language):
            raise HTTPException(400, 'Invalid language')
        if app.state.model is None:
            raise HTTPException(503, 'Model is not ready')
        if lock.locked():
            raise HTTPException(429, 'Speech engine is busy')
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > MAX_UPLOAD:
                raise HTTPException(413, 'Audio upload is too large')
        try:
            audio = decode_wav(bytes(data))
        except ValueError as error:
            raise HTTPException(400, str(error)) from error

        def recognize():
            segments, info = app.state.model.transcribe(
                audio, language=None if language == 'auto' else language,
                beam_size=1, vad_filter=True, condition_on_previous_text=False,
                vad_parameters={'min_silence_duration_ms': 300},
            )
            # faster-whisper is lazy: consume segments while still holding the lock.
            text = ' '.join(segment.text.strip() for segment in segments).strip()
            return {'text': text[:1200], 'language': info.language}

        if lock.locked():
            raise HTTPException(429, 'Speech engine is busy')
        async with lock:
            try:
                return await asyncio.to_thread(recognize)
            except ValueError as error:
                raise HTTPException(400, 'Unsupported recognition language or audio') from error

    return app


app = create_app()
