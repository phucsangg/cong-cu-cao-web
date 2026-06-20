FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for Playwright browser installation
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY src ./src

RUN pip install --no-cache-dir -e .

# Install chromium browser binaries and their system dependencies
RUN playwright install --with-deps chromium

# Default port exposed by FastAPI
EXPOSE 3000

CMD ["python", "-m", "uvicorn", "crawldata.main:app", "--host", "0.0.0.0", "--port", "3000"]
