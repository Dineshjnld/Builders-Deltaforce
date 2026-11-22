ARG BASE=python:3.13-slim
FROM ${BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir sherpa-onnx==1.12.39 imageio-ffmpeg==0.6.0 numpy==2.2.6
WORKDIR /voice
COPY asr.py service.py ./
USER 1000:1000
CMD ["python","service.py"]
