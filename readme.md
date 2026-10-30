# TravelerAPI

REST API для планування подорожей на PostgreSQL з коректною обробкою конкурентних змін.
Проєкт курсу «Розподілені сховища даних» (СумДУ), лабораторні роботи 1–8.

## Стек

| Що | Чим |
|---|---|
| Мова / рантайм | Node.js 20+ (ES modules) |
| HTTP | Express 4 |
| БД | PostgreSQL 18, драйвер `pg` (пул з'єднань, тільки параметризовані запити) |
| Функціональні тести | [Hurl](https://hurl.dev) (`tests/*.hurl`) |
| Тести конкурентності | `scripts/race-demo.js` (справді паралельні запити через `fetch`) |

## Структура

```
src/
  server.js              запуск HTTP-сервера, graceful shutdown
  app.js                 маршрути, заголовки безпеки, обробка помилок
  config.js              налаштування зі змінних оточення
  db.js                  пул з'єднань, withTransaction()
  errors.js              HTTP-помилки, перетворення помилок PostgreSQL у 400
  validation.js          валідація тіл запитів і пагінації
  repositories/
    plans.js             плани: optimistic locking (version)
    locations.js         локації: блокування батьківського плану, атомарні часткові оновлення
db/migrations/           SQL-схема (таблиці, обмеження, індекси, тригери)
docs/                    OpenAPI (travel_api_swagger.json), схема БД (sql, mermaid, png)
tests/                   Hurl-сценарії та variables.properties
scripts/
  migrate.js             застосування міграцій
  race-demo.js           демонстрація розв'язання проблем 1–3 під паралельним навантаженням
```

## Запуск

```bash
# 1. PostgreSQL: роль і база
psql -U postgres -c "CREATE ROLE travel LOGIN PASSWORD 'travel'" -c "CREATE DATABASE travel_planner OWNER travel"
# 2. Залежності та схема
npm install
npm run migrate
# 3. Сервер (http://127.0.0.1:4567)
npm start
```

Змінні оточення: `DATABASE_URL` або `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`; `PORT`, `DB_POOL`.

## Тести

```bash
hurl --test tests/ --variables-file tests/variables.properties
node scripts/race-demo.js
```

## Як розв'язано проблеми конкурентного доступу

1. **Concurrent Plan Updates (lost update)** — optimistic locking:
   `UPDATE ... SET ..., version = version + 1 WHERE id = $1 AND version = $2`.
   0 змінених рядків означає конфлікт, і API повертає `409` з `current_version`.
2. **Sequential Location Addition (однаковий visit_order)** — у транзакції спершу
   `SELECT ... FROM travel_plans WHERE id = $1 FOR UPDATE` (блокування батьківського плану),
   потім `INSERT ... SELECT MAX(visit_order)+1`. Вставки в один план серіалізуються,
   у різні плани — йдуть паралельно. `UNIQUE (travel_plan_id, visit_order)` — страховка.
3. **Concurrent Location Updates** — оновлення лише тих полів, що прийшли в запиті,
   одним `UPDATE` без читання-зміни-запису в застосунку. Рядкове блокування PostgreSQL
   серіалізує два `UPDATE`, тож зміни budget і notes не затирають одна одну.

## Docker (ЛР3)

```bash
cp .env.example .env        # задайте паролі
docker compose up --build -d
curl http://localhost:4567/health
```

`docker-compose.dev.yml` — режим розробки (код змонтовано в контейнер, `node --watch`).
PostgreSQL у контейнері слухає `127.0.0.1:5433`, бо порт 5432 на машині розробника зайнятий локальною службою.

## Реплікація (ЛР4)

Скрипти ініціалізації — у `db/replication/`:

- `logical/` — публікація/підписка;
- `physical/` — `pg_basebackup` + слот реплікації для кожної репліки.

Обліковий запис реплікації задають змінні оточення `REPL_USER` і `REPL_PASSWORD`.

## Шардинг (ЛР6)

```bash
docker compose -f docker-compose.sharding.yml up --build -d
# DDL/DML на всіх 16 vnode-БД атомарно (2PC):
docker compose -f docker-compose.sharding.yml exec app node scripts/shard-exec.js shards/sql/001_add_plan_tags.sql
# перенесення vnode на інший сервер (логічна реплікація + перемикання):
docker compose -f docker-compose.sharding.yml exec app node scripts/shard-move.js 3 postgres_01:5432
```

Як влаштовано шардинг:

- vnode = останній hex-символ UUID плану;
- id локації закінчується тим самим символом, що й id її плану;
- `shards/mapping.json` зіставляє vnode з `сервер:порт/база`.

## Моніторинг (ЛР7)

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

- Grafana: http://localhost:3000, дашборд «TravelerAPI — RED & PostgreSQL»;
- Prometheus: http://localhost:9090;
- метрики застосунку: `GET /metrics`.

## JSONB (ЛР8)

`STORAGE=jsonb` перемикає збереження локацій на JSONB-масив у `travel_plans.locations`. Міграцію виконує `db/migrations-jsonb/002_locations_to_jsonb.sql`; її застосовує `npm run migrate` при `STORAGE=jsonb`.
