FROM python:3.13-slim
WORKDIR /app
RUN --mount=from=wheels,target=/wheels if ls /wheels/*.whl >/dev/null 2>&1; then pip install --no-cache-dir --no-index --find-links=/wheels sherpa-onnx==1.12.39 numpy==2.2.6 imageio-ffmpeg==0.6.0; else pip install --no-cache-dir sherpa-onnx==1.12.39 numpy==2.2.6 imageio-ffmpeg==0.6.0; fi
COPY services/speech/server.py .
USER 1000:1000
CMD ["python","server.py"]
