FROM python:3.12-slim AS builder

WORKDIR /app

# Copy package metadata and source before installing the app.
COPY pyproject.toml .
COPY src/ /app/src/

# Install dependencies using pip
RUN pip install --no-cache-dir .

FROM python:3.12-slim

# Create a non-privileged user to run the app
RUN addgroup --system appgroup && adduser --system --group appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy backend source code
COPY src/ /app/src/
COPY pyproject.toml /app/

# Expose port
EXPOSE 8000

# Switch to non-root user
USER appuser

# Run server
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
