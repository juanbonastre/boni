FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 BONI_DB=/data/boni.sqlite3
WORKDIR /app
COPY pyproject.toml ./
COPY boni ./boni
RUN pip install --no-cache-dir . && rm -rf /root/.cache

# Same owner as the other NAS services; /data holds the SQLite file (bind mount).
RUN mkdir -p /data && chown 1026:100 /data
USER 1026:100
VOLUME ["/data"]
EXPOSE 8100
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8100/healthz', timeout=4).status == 200 else 1)"
CMD ["boni", "serve", "--host", "0.0.0.0", "--port", "8100"]
