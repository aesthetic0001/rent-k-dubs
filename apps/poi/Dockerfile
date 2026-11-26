FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu 'torch==2.15.0' \
    && pip install --no-cache-dir 'numpy==2.5.5' 'transformers==5.24.1' 'psycopg[binary]==3.2.13'
COPY apps/poi/catalogue.py apps/poi/fuzzy.py apps/poi/server.py ./
COPY apps/web/src/lib/parse/known_places.json apps/web/src/lib/parse/known_places.generated.json ./known/
ENV HF_HOME=/models POI_KNOWN_PLACES_DIR=/app/known POI_SERVICE_HOST=0.0.0.0 \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN mkdir /models && chown 65534:65534 /models
EXPOSE 8082
USER 65534:65534
CMD ["python", "server.py"]
