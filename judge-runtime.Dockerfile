FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN --mount=type=bind,source=.,target=/deps pip install --no-index --find-links=/deps/wheels -r /deps/requirements.txt && pip check
WORKDIR /studio
