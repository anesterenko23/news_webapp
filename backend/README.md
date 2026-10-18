# World Lens — Phase 4

Backend для ручного анализа публикаций. Основные News и Country Explorer остаются на демонстрационных данных, их внешний вид не меняется.

## Запуск

Нужен Node.js 22.18+ и доступ к npm при первоначальной установке.

```powershell
npm ci
Copy-Item backend/.env.example backend/.env
# Заполнить MISTRAL_API_KEY в backend/.env
npm run db:migrate
npm run backend:start
```

Если `backend/.env` уже настроен, не перезаписывайте его. В текущем локальном окружении ключ уже настроен. Он не входит в репозиторий.

Открыть **http://127.0.0.1:3001/dev/ai-lab**. Вставить заголовок, источник, URL, дату публикации в UTC и текст, затем нажать Analyze. Запросы к Mistral происходят только после явного запуска анализа. Повторная отправка использует сохранённый run. Ошибочный run можно явно повторить; история и прежние расходы сохраняются, повторные клики на один retry не создают новые запросы.

Для разработки backend с перекомпиляцией: `npm run backend:dev`. Frontend запускается отдельно через `npm run dev`; Vite проксирует `/api` и `/dev/ai-lab` на порт 3001. Статический `npm run preview` не содержит backend, используйте прямой URL AI Lab выше.

SQLite хранится в `backend/prisma/dev.db` (исключён из Git). Миграции применяются командой `npm run db:migrate`, клиент Prisma генерируется в `postinstall`. Для пользовательского DATABASE_URL относительные пути Prisma отсчитываются от `backend/prisma`; для другого расположения предпочтителен абсолютный `file:` URL.

## Mistral и настройки

Используется официальный endpoint `https://api.mistral.ai/v1/chat/completions`, structured output `response_format.type=json_schema` и модель **ministral-8b-2512**. Идентификатор, поддержка structured outputs и стандартные цены проверены 18 октября 2026 по [странице модели](https://docs.mistral.ai/models/ministral-3-8b-25-12), [документации формата](https://docs.mistral.ai/studio/conversations/structured-output/custom) и [тарифам](https://docs.mistral.ai/inference/pricing).

| Переменная | По умолчанию / назначение |
|---|---|
| MISTRAL_API_KEY | Только backend/.env, обязательна для AI |
| MISTRAL_MODEL | ministral-8b-2512 |
| LLM_PROVIDER | mistral |
| LLM_MAX_OUTPUT_TOKENS | 2000, максимум 8000 |
| LLM_TIMEOUT_MS | 30000 |
| LLM_MAX_RETRIES | 2 дополнительных попытки **только после HTTP 429** |
| LLM_MONTHLY_BUDGET_USD | 10 |
| LLM_INPUT_USD_PER_MILLION | 0.15 для основной модели |
| LLM_OUTPUT_USD_PER_MILLION | 0.15 для основной модели |
| LLM_PRICING_VERIFIED_AT | 2026-10-18; тариф необходимо перепроверять не реже чем каждые 30 дней |
| DATABASE_URL | file:./dev.db |
| HOST / PORT | 127.0.0.1 / 3001 |
| NODE_ENV | development |
| ADMIN_API_TOKEN | Обязателен вне локального development; минимум 32 символа, используйте случайный секрет |

Для новой модели явно задать обе цены и дату проверки. Неизвестные/просроченные тарифы блокируют отправку. Оценка не учитывает скидки за кэш и может отличаться от биллинга Mistral.

Бюджет резервируется транзакцией **перед каждой попыткой** на верхнюю оценку входных токенов и max output tokens. После ответа резерв заменяется стоимостью по usage. На 80% показывается предупреждение; запрос, который нельзя покрыть остатком, блокируется. Резервы других запросов также учитываются. Все месяцы считаются по UTC.

Timeout, 5xx, потеря соединения, нечитаемый ответ или отсутствие usage оставляют консервативный расход и блокируют новые запросы: такие операции нельзя безопасно повторять автоматически. Сначала проверить биллинг провайдера, затем выполнить локальную сверку:

```powershell
npm run backend:build
node backend/reconcile.mjs REQUEST_ID INPUT_TOKENS OUTPUT_TOKENS CONFIRMED_COST_USD "Verified against provider billing record ..."
```

CLI изменяет только неопределённые записи, сохраняет аудиторскую запись в run и не вызывает LLM. Не освобождайте резерв без проверки фактического расхода. Прерванный активный run после сверки помечается failed и допускает явный retry. Обычный повтор не перезапускает ошибочную обработку автоматически.

## Архитектура и созданные модули

`Article → normalization → Mistral extraction → Zod + evidence validation → duplicate candidates → verification/publication decision → SQLite transaction`.

- `src/config.ts`: env, безопасный сетевой режим, подтверждённые тарифы.
- `src/schemas.ts`, `src/countries.ts`: контракт статей, 12 типов событий/отношений, 8 статусов событий, роли, ISO alpha-2, JSON Schema из Zod.
- `src/normalization.ts`: UTC, URL, удаление tracking-параметров и повторных технических строк, консервативная эвристика языка, fingerprint. Исходный JSON и текст сохраняются без замены нормализованной версией.
- `src/prompt.ts`: версионированный промпт с примерами, отделением инструкции от недоверенного текста, планов от действий и комментаторов от участников.
- `src/provider.ts`: официальный Mistral HTTP API, timeout, ограниченный backoff, отдельный учёт каждой попытки, budget reservations. Provider-интерфейс позволяет менять модель/реализацию без изменения pipeline.
- `src/validation.ts`: проверка кодов, участников, направлений, self-links, ссылок на evidence, модальности, цитат и автоматически развёрнутых многосторонних графов. Различия только в пробелах привязываются к точному непрерывному фрагменту оригинала; слова и пунктуация не исправляются. Оригинальный ответ модели сохраняется отдельно.
- `src/deduplication.ts`: нормализованные заголовки, страны, тип/статус, трёхдневное окно по event date или публикации, текстовое сходство и primarySourceId. До 1000 кандидатов на сравнение. Нет дополнительного LLM-запроса и автоматического слияния.
- `src/verification.ts`: отдельные verification/publication статусы. В MVP валидное извлечение из одного источника **всегда Unverified / NeedsReview**, невалидное — Rejected. Автоматическая публикация отключена явной политикой. Ни confidence, ни совпадение цитаты не дают Verified.
- `src/database.ts`, `prisma/schema.prisma`, `prisma/migrations`: статьи, runs с версиями и попытками, события, участники, связи, evidence с original offsets, источники, история решений и LLM-запросы с расходами. Результаты одного run сохраняются атомарно.
- `src/engine.ts`: оркестрация, идемпотентность, ограниченная очередь, запись raw output/ошибок, повтор failed run только по явному retryOf.
- `src/globe-projection.ts`: preview-контракт слоя глобуса с alpha-3 кодами и текущей палитрой. Исходная AI-категория, статус действия и статус проверки сохраняются. Проекция не подключена к публичной ленте.
- `src/app.ts`, `src/server.ts`: Fastify API и защита доступа.
- `src/lab.ts`: отдельный внутренний AI Lab, ввод публикаций, роли, связи, цитаты, статусы, дубликаты, raw JSON, время, токены и стоимость. Текст модели выводится через textContent.
- `tests/fixtures.ts`: 22 вымышленные тестовые публикации. `tests/intelligence.test.ts` и `tests/api.test.ts`: unit и интеграционные проверки с отдельной временной SQLite.
- `evaluate.mjs`: необязательный **платный** реальный прогон фикстур через запущенный backend. Не выполняется в CI.
- `reconcile.mjs`: локальная сверка неопределённого расхода после проверки у провайдера.

## API

Все data endpoints административные, включая чтение. Ни один endpoint не публикует события в основной frontend.

| Метод и путь | Назначение |
|---|---|
| POST /api/articles/process | title, content, source, url, publishedAt; optional language, primarySourceId, retryOf |
| GET /api/events | country (alpha-2), eventType, verificationStatus, from, to, limit, offset |
| GET /api/events/:id | Событие, роли, evidence, источники, решения и globePreview |
| GET /api/countries/:code/events | События страны, те же фильтры |
| GET /api/review-queue | NeedsReview, пагинация limit/offset |
| GET /api/ai/usage | Месяц, токены, расход и резервы, ошибки, недавние запросы, лимит |
| GET /health | Проверка доступности процесса без приватных данных |

Date range относится к дате публикации, не к предположительно восстановленной дате события. UTC datetime должен содержать Z или offset. Лимит выдачи 100, по умолчанию 50.

POST требует `Content-Type: application/json` и `X-World-Lens-Client: ai-lab`. Ответ содержит articleId, runId, processingStatus, events, warnings, rawOutput, model, promptVersion, durationMs и usage. Ошибочный AI run возвращает HTTP 502 (бюджет — 429), но также сохраняется в базе; исходный HTTP код провайдера записывается в безопасную диагностику без тела ошибки и ключа. Уже выполняющийся сохранённый run может вернуть 202; повторите тот же запрос для получения результата, новый AI-вызов не создастся.

Локальный development разрешён без admin token только на loopback, с проверкой Host, peer IP, Origin и специального заголовка для записи. CORS не включён. При любом сетевом/production запуске конфигурация требует ADMIN_API_TOKEN; каждый API требует `Authorization: Bearer TOKEN`. AI Lab показывает форму токена, хранит его только в памяти страницы. За reverse proxy сохранять NODE_ENV=production, использовать HTTPS, не обходить эту проверку режимом development. Локальные env, SQLite и raw run данные не коммитятся.

Пример PowerShell после заполнения локального env:

```powershell
$article = @{
  title = 'A test announcement'
  content = 'Germany announced sanctions against Russia and confirmed military assistance to Ukraine.'
  source = 'Fictional test fixture'
  url = 'https://example.org/test-announcement'
  publishedAt = '2026-10-18T10:00:00Z'
  language = 'en'
}
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3001/api/articles/process -ContentType application/json -Headers @{'X-World-Lens-Client'='ai-lab'} -Body ($article | ConvertTo-Json)
```

## Проверки и ограничения

```powershell
npm run backend:build
npm run test:backend
npm test
npm run build
# Только осознанный платный прогон с настроенным ключом и запущенным backend:
npm run ai:evaluate
```

CI использует injected provider и временную SQLite; реальные ключи не нужны. Unit-тесты golden output проверяют pipeline, а не доказывают качество LLM. Результаты фактического API-прогона записаны в [EVALUATION.md](EVALUATION.md).

Полноценный независимый fact-check пока отсутствует. Семантическая связь цитаты с утверждением требует review; проверки имени/модальности — только эвристики. LLM может ошибиться в evidence refs, странах, датах или разделении событий; ошибочные результаты отклоняются/отправляются на проверку, автоматического платного repair нет. Короткие неопределённые/нейтральные публикации могут давать пустой список с diagnostics. Определение языка — эвристика для нескольких письменностей, прочие случаи und. Тексты ограничены 30000 символами, до 12 событий, output cap может потребовать явного повторного анализа с другой настройкой. SQLite и очередь предназначены для локального MVP, не для распределённого ingestion. Проверка дубликатов создаёт кандидатов, но не устанавливает независимость источников или тождественность событий.

RSS, NewsAPI/GDELT, публичная модерация, автоматический сбор, AI-факты на глобусе, аккаунты и автоматическое Verified в эту фазу не входят.
