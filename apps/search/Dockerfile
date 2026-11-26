FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu 'torch==2.15.0' \
    && pip install --no-cache-dir 'gliner2[local]==2.2.0' 'transformers==5.24.1' 'peft==0.22.0'
COPY server.py labels.py model_artifacts.py ./
RUN mkdir /models && chown 65534:65534 /models
ENV HF_HOME=/models SEARCH_MODEL_HOST=0.0.0.0 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8081
USER 65534:65534
CMD ["python", "server.py"]
