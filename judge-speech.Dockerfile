FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng && rm -rf /var/lib/apt/lists/*
RUN --mount=type=bind,from=wheels,target=/deps pip install --no-index --find-links=/deps/wheels -r /deps/speech.txt && pip check
WORKDIR /voice
COPY asr.py service.py ./
USER 1000:1000
CMD ["python","service.py"]
