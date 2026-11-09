FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

RUN mkdir -p /app/artifacts
VOLUME ["/app/artifacts"]

EXPOSE 8090
CMD ["uvicorn", "app:APP", "--host", "0.0.0.0", "--port", "8090"]
