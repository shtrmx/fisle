# Fisle

Пошаговая гексагональная 3D-стратегия по мотивам **Antiyoy**: одиночная игра против ИИ, локальный хотсит на одном устройстве, онлайн-мультиплеер с комнатами по коду и паролю, туман войны и дипломатия.

> Оригинальная игра: [Antiyoy by yiotro](https://github.com/yiotro/Antiyoy)

Пример конфигурации контейнера:

## Docker Compose (`docker-compose.yml`)

```yaml
services:
  fisle:
    image: shtrmx/fisle-game:latest
    container_name: fisle
    ports:
      - "${PORT:-3000}:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      MAX_ROOMS: ${MAX_ROOMS:-100}
      MAX_ROOMS_PER_PLAYER: ${MAX_ROOMS_PER_PLAYER:-3}
    deploy:
      resources:
        limits:
          cpus: "${CPU_LIMIT:-1.0}"
          memory: "${MEMORY_LIMIT:-512M}"
    restart: unless-stopped
```

## Переменные окружения (`.env`)

```env
FISLE_VERSION=latest
PORT=3000
MAX_ROOMS=100
MAX_ROOMS_PER_PLAYER=3
CPU_LIMIT=1.0
MEMORY_LIMIT=512M
```

## Запуск через `docker run`

```bash
docker run -d \
  --name fisle \
  -p 3000:3000 \
  -e MAX_ROOMS=100 \
  -e MAX_ROOMS_PER_PLAYER=3 \
  --cpus="1.0" \
  --memory="512m" \
  shtrmx/fisle-game:latest
```
