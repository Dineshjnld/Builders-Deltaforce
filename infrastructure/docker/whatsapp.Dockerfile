FROM python:3.13-slim
WORKDIR /app
COPY services/whatsapp/requirements.txt requirements.txt
RUN --mount=from=wheels,target=/wheels \
    if ls /wheels/*.whl >/dev/null 2>&1; then \
      pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt; \
    else \
      pip install --no-cache-dir -r requirements.txt; \
    fi
COPY services/whatsapp services/whatsapp
USER 1000:1000
CMD ["uvicorn","services.whatsapp.evolution:create_app","--factory","--host","0.0.0.0","--port","8788","--no-access-log"]

