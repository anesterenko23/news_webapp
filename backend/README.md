# World Lens — Phase 4.5

Ручной административный анализ публикаций с сохранением исходных ответов, выделенных утверждений и истории решений. Основной глобус и лента продолжают использовать демонстрационные данные. Сбор новостей и независимая проверка источников пока не реализованы.

## Запуск

Требуется Node.js 22.18+. После клонирования:

```powershell
npm ci
Copy-Item backend/.env.example backend/.env
# Указать MISTRAL_API_KEY локально; существующий .env не перезаписывать.
npm run db:migrate
npm run backend:start
```

AI Lab: http://127.0.0.1:3001/dev/ai-lab. Frontend запускается отдельно через npm run dev. Vite проксирует /api и /dev/ai-lab на backend; статический preview backend не содержит.

SQLite: backend/prisma/dev.db, исключена из Git. Перед миграцией существующей базы остановить backend и сделать копию файла БД вместе с WAL/SHM, если они существуют. db:migrate применяет SQL, генерирует Prisma Client, компилирует backend, выполняет идемпотентный перенос старых событий и версионированную повторную валидацию без LLM. Старые Event, Evidence, ReviewDecision, ProcessingRun и rawOutput остаются в базе. Неизвестный legacy Rejected требует проверки и не превращается в Refuted. Проверка отката слияния сохраняет исходные связи источников как неактивные и добавляет ревизии.

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


## Модель данных и статусы

Article → ProcessingRun → ExtractedClaim → CanonicalEvent. Публикация может содержать несколько claims; каноническое событие объединяет утверждения из нескольких публикаций. Одно событие может иметь несколько отношений. Исходный rawClaim и полный rawOutput неизменяемы; текущая техническая оценка хранится отдельно и имеет ClaimValidationDecision с версией валидатора и снимками до/после.

| Слой | Значения | Что означает |
|---|---|---|
| ValidationStatus | Valid / Invalid / NeedsRepair | Контракт, цитаты, ссылки и детерминированные ограничения |
| VerificationStatus | NotAssessed / Unverified / Corroborated / Verified / Disputed / Refuted | Достоверность утверждения, отдельно от уверенности модели |
| PublicationStatus | Draft / NeedsReview / Ready / Blocked | Решение о публикации |

Valid из одного источника получает Unverified / NeedsReview. Invalid получает NotAssessed / Blocked; NeedsRepair — NotAssessed / NeedsReview. Ошибка evidence или неоднозначный актор не доказывает ложность новости. Политика не выдаёт Ready автоматически. В текущем pipeline нет механизма, который присваивает Verified, Corroborated, Disputed или Refuted: IndependentSourceVerifier пока возвращает NotAssessed. Количество источников, цитата и confidence не являются проверкой достоверности.

QuoteMatch, ReferenceIntegrity, SemanticSupport и SourceVerification — разные результаты. SemanticSupport по умолчанию NotAssessed; точная цитата не доказывает, что она подтверждает направление связи. Отдельные правила находят Unsupported/Ambiguous, но не заменяют полноценного семантического верификатора. Подробные ограничения и реальные результаты: [EVALUATION45.md](EVALUATION45.md).

## Извлечение и evidence

Текущий prompt world-lens-extraction/1.2.1, предыдущие 1.1.0 и 1.2.0 сохранены и выбираются в AI Lab. Версия входит в ключ идемпотентности. Повтор идентичного ввода с той же моделью/версией возвращает прежний run, без LLM. Явный retryOf доступен только для failed run и сохраняет прежние расходы и raw.

Типизированные entities разделяют страны, организации, компании, людей, города и другие сущности. Участники и концы географических отношений принимают только ISO alpha-2 из справочника. UK/USA/South Korea разрешаются централизованным alias resolver; UN/EU/NATO не являются странами. Неопределённые partners не разворачиваются в выдуманные страны. Для взаимных соглашений используются partner/partner.

Модель возвращает строковые temporary evidence IDs, уникальные в ответе. Сервер проверяет все локальные ссылки и выдаёт постоянные UUID с FK-связями. Пропавшие, чужие и повторные IDs не исправляются подстановкой индекса. Цитата должна совпадать с непрерывным фрагментом заголовка/текста; допустимо только выравнивание пробелов с сохранением точных исходных offsets. action_text и object_text также должны быть дословными фрагментами. Автоматический repair-запрос не реализован: дефекты остаются в очереди с машинными кодами. Это не скрытый дополнительный расход.

## Канонические события и источники

Автопривязка разрешена только при совпадении типа, модальности, ролей стран, направлений отношений, времени, действия, объекта и fingerprint текста публикации. Более слабое сходство создаёт MergeCandidate без второго CanonicalEvent. Эвристическая оценка сходства не является вероятностью и не используется для проверки истинности. Смена planned/completed или дрейф объекта в перепечатке требуют review.

CanonicalEventSource хранит publisher, originalSource, syndicationSource, primaryDocument, lineageId и independenceStatus. Совпадающий текст, повторное извлечение одной статьи и известная общая lineage помечаются Dependent; прочие остаются Unknown. Unknown не означает Independent. Перепечатки не повышают VerificationStatus. linkedSourceCount считает уникальные статьи, а не число запусков модели. Обратимость обеспечена активными/неактивными source links, EventRevision и сохранёнными claims/evidence.

## API

Все endpoints данных административные, включая чтение. Production требует ADMIN_API_TOKEN и Authorization: Bearer TOKEN. Локальный development без токена разрешён только на loopback с проверкой Host/peer/Origin. Запись требует Content-Type: application/json и X-World-Lens-Client: ai-lab. Текст модели в UI выводится через textContent. Локальные .env, DB, dist и work не публикуются.

| Метод | Путь | Назначение |
|---|---|---|
| POST | /api/articles/process | title, content, source, url, publishedAt; optional language, primarySourceId, originalSource, syndicationSource, primaryDocument, lineageId, promptVersion, retryOf |
| GET | /api/events | Канонические события; country, eventType, verificationStatus, from, to, limit, offset |
| GET | /api/events/:id | Claims, evidence, источники и их история, revisions, verificationHistory, globePreview |
| GET | /api/claims/:id | Исходное утверждение, статусы, проверка evidence и история валидации |
| GET | /api/countries/:code/events | Канонические события страны |
| GET | /api/review-queue | Claims, машинные причины, merge candidates, failed runs |
| POST | /api/merge-candidates/:id/resolve | decision: merge/separate, reviewer, note; не подтверждает достоверность |
| POST | /api/event-sources/:id/unlink | reviewer, note; отмена привязки с сохранением истории |
| GET | /api/ai/usage | Токены, расходы, резервы и лимит |
| GET | /health | Доступность процесса |

Изменение контракта Phase 4: в ответе обработки events теперь означает CanonicalEvent[], claims — ExtractedClaim[]. Невалидные claims доступны даже без canonicalEventId. Ответ также содержит rawOutput, model, promptVersion, runId, usage и canonicalEventIds. Date filters относятся к дате публикации. Pagination: default50/max100. Неудачный run сохраняется и возвращает 502, budget —429; выполняющийся run может вернуть202. Основной frontend с этими AI-данными не связан.

## Проверки и сравнение

```powershell
npm run test:backend
npm run test -- --configLoader runner
npm run build -- --configLoader runner
# Опциональный ПЛАТНЫЙ прогон 30 размеченных публикаций на локальном backend:
npm run ai:benchmark
npm run ai:score
npm run ai:score-duplicates
```

Unit/integration tests и CI используют сохранённые ответы/фикстуры, не настоящий API. ai:benchmark вызывает реальный API только при явном запуске, сохраняет work/benchmark45/live-runs.json; бюджет общий с AI Lab. ai:score анализирует сохранённые реальные ответы. ai:score-duplicates — детерминированные 10 пар без LLM. Прежний ai:evaluate оставлен как диагностический запуск 22 Phase4 фикстур; для сравнимых метрик использовать benchmark.

Поддержка: src/canonical.ts — match/link/undo; entities.ts — aliases; validation.ts — технические проверки; verification.ts — независимый интерфейс; legacy-migration.ts/revalidation.ts — перенос и история; presentation.ts — API DTO. Промпты и старые валидаторы сохранены для воспроизводимого baseline.

## Gemini (пробное подключение)

Установить LLM_PROVIDER=gemini, GEMINI_API_KEY и GEMINI_MODEL=gemini-3.8-flash в локальном backend/.env, затем перезапустить backend. Для Mistral вернуть LLM_PROVIDER=mistral. Gemini имеет отдельные GEMINI_INPUT_USD_PER_MILLION / GEMINI_OUTPUT_USD_PER_MILLION / GEMINI_PRICING_VERIFIED_AT, чтобы не наследовать тариф Mistral. Подтверждённый стандартный тариф на18.10.2026: $0.75 input / $3.75 output за1M токенов, включая thinking; [официальные тарифы](https://ai.google.dev/gemini-api/docs/pricing). Скидки/бесплатный tier не предполагаются.

Google generateContent вызывается с x-goog-api-key (ключ не в URL), responseJsonSchema и тем же версионированным промптом. Модель входит в ключ идемпотентности: сохранённый Mistral run не подменяет Gemini run. Thinking parts не парсятся как claims; thoughtsTokenCount включается в output cost. Общий бюджет, сохранение raw, правила ошибок и статусы Phase4.5 остаются общими. Для новых моделей задать подтверждённые Gemini-specific цены; неизвестные тарифы блокируются.

Реальная проверка18.10.2026: models.list200, Gemini2.5Flash generateContent404 (модель недоступна новым пользователям); Gemini3.8Flash generateContent503 без usage. Ни одного успешного ответа генерации не получено, оценка качества не выполнена.503 сохраняет неопределённый расход и блокирует дальнейшие вызовы до сверки у провайдера; не обнулять резерв без подтверждения. Смена модели не обходит общий блок USAGE_UNCERTAIN. Дополнительные unit tests используют mock HTTP, а не изображают успешную реальную генерацию.
