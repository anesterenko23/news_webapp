import path from 'node:path';
import fs from 'node:fs/promises';
import { ROOT, context, readJson } from './common.mjs';
const ctx = await context(), dry = await readJson(path.join(ROOT, 'dry-run.json')), metrics = await readJson(path.join(ROOT, 'metrics.json')), cost = await readJson(path.join(ROOT, 'cost-analysis.json'));
const num = v => typeof v === 'number' ? v.toFixed(3) : '—';
const pct = r => r && r.value !== null ? `${(r.value * 100).toFixed(2)}% (${r.numerator}/${r.denominator})` : '—';
const quality = (model, level = 'A') => metrics.paired[level]?.matchedSubset?.[model] ?? metrics.quality.find(m => m.model === model)?.levels[level]?.metrics;
const operation = model => metrics.operational.find(m => m.model === model);
const price = model => cost.main.find(m => m.model === model);
const tableRows = [['Event F1', m => pct(quality(m)?.event.f1)], ['Country F1', m => pct(quality(m)?.countries.f1)], ['Role F1', m => pct(quality(m)?.roles.f1)], ['Relationship F1', m => pct(quality(m)?.relationships.f1)], ['False Relationship Rate', m => pct(quality(m)?.falseRelationshipRate)], ['Evidence Attribution Accuracy', m => pct(quality(m)?.evidenceAttributionAccuracy)], ['JSON Validity', m => pct(operation(m)?.jsonValidity)], ['API Success Rate (HTTP attempts)', m => pct(operation(m)?.successfulHttpRequests)], ['Median Latency, ms', m => num(operation(m)?.latency.allRequests.medianMs)], ['Cost / 1,000 articles, USD', m => num(price(m)?.costPer1000ArticlesUsd)]];
const measurements = [m => quality(m)?.event.f1.value, m => quality(m)?.countries.f1.value, m => quality(m)?.roles.f1.value, m => quality(m)?.relationships.f1.value, m => quality(m)?.falseRelationshipRate.value, m => quality(m)?.evidenceAttributionAccuracy.value, m => operation(m)?.jsonValidity.value, m => operation(m)?.successfulHttpRequests.value, m => operation(m)?.latency.allRequests.medianMs, m => price(m)?.costPer1000ArticlesUsd];
function winner(index) {
    if (metrics.status !== 'human_adjudicated')
        return 'Not determined';
    const a = measurements[index]('ministral'), b = measurements[index]('gemini');
    if (a == null || b == null)
        return 'Not assessed';
    if (a === b)
        return 'Tie';
    const ciKey = { 0: 'eventF1Delta', 3: 'relationshipF1Delta', 4: 'falseRelationshipRateDelta' }[index];
    if (ciKey) {
        const interval = metrics.paired.A.confidenceIntervals[ciKey].interval;
        if (!interval || interval[0] <= 0 && interval[1] >= 0)
            return 'Uncertain (95% CI)';
    }
    const lower = [4, 8, 9].includes(index);
    return ((lower ? b < a : b > a) ? 'Gemini' : 'Ministral') + ' (descriptive)';
}
const table = '| Metric | Ministral 3 8B | Gemini 3.8 Flash | Winner |\n|---|---:|---:|---|\n' + tableRows.map(([name, get], index) => `| ${name} | ${get('ministral')} | ${get('gemini')} | ${winner(index)} |`).join('\n');
const categoryRows = [...new Set(ctx.articles.map(a => a.category))].map(category => `| ${category} | ${ctx.articles.filter(a => a.category === category).length} | ${metrics.groundTruth.ready ? ctx.articles.filter(a => a.category === category).length : 0} |`).join('\n');
const report = `# World Lens — Phase 4.6: AI Model Benchmark

## 1. Executive Summary

Статус: **${metrics.status}**. Подготовлен воспроизводимый инструмент и100 новых для проекта публикаций. Сохранено${metrics.completedLogicalRuns}/${metrics.plannedLogicalRuns} логических запросов. Подтверждённой ручной разметки${metrics.groundTruth.approved}/100. Автоматические метки не выдаются за ground truth. Победитель не определён, production-конфигурация не изменялась.

${table}

Quality в таблице относится к Level A на парном complete-case пересечении (${metrics.paired.A.articles} статей), кроме операционных метрик. Отдельные coverage и API outcomes сохраняются, поэтому пропущенный ответ провайдера не скрывается. Level B оценивается отдельно в metrics.json и не подмешивается к Raw Model. Пустое значение означает отсутствие данных/ручного решения, не нулевое качество. Per-metric winner описательный; F1/False Relationship с парным CI, пересекающим0, остаются Uncertain. Это не итоговый выбор модели. Никакого среднего балла с произвольными весами и автоматического переключения модели.

## 2. Dataset Description

Dataset ${ctx.dataset.version}:100 реальных GOV.UK news/press releases и официальных выступлений,${ctx.articles.reduce((n, a) => n + a.article.content.length, 0)} символов извлечённых полных details.body. Сбор через публичный Content API, без LLM-пересказов и обрезки. У каждого текста URL, original content ID, дата, UTC timestamp получения и SHA256 HTML/текста. Повторяемые полные тела исключены; два прежних GOV.UK тестовых URL исключены. Это новизна относительно проекта, а не доказательство отсутствия текстов в обучающих данных моделей.

| Страта отбора | Текстов | Ручная разметка подтверждена |
|---|---:|---:|
${categoryRows}

Категории отбора пока требуют ручного подтверждения, как и наличие всех сложных признаков: multi-event, venue-only, organizations, unspecified partners, indirect attribution, announced/planned/denied, historical context и противоречия. Контрольные статьи выбраны из внутренних новостей о flood schemes; expectedEvents пока null, а не автоматически[]. Если человек найдёт там подходящее событие, набор нужно пересмотреть до заморозки основного прогона.

Ограничение: один английский официальный источник, британская перспектива и корреляция событий. Нельзя переносить выводы на весь мировой новостной поток. Нужен последующий независимый многоязычный/многоисточниковый holdout.

Полные тексты и source snapshots локальны и исключены из Git до item-level проверки прав/исключений third-party material. В Git находятся provenance, hashes и шаблоны разметки. Правила: https://www.gov.uk/help/reuse-govuk-content. Пакет разметки содержит исходные тексты, но не ответы моделей.

## 3. Model Configuration

- Ministral: **ministral-8b-2512**, без замены на latest alias.
- Gemini: **gemini-3.8-flash**, без молчаливой подмены версией.
- Metadata GET обеих моделей вернули200; это не smoke generation. model-availability.json сохраняет фактические определения. Платный smoke ещё ожидает разрешения.
- Prompt **${ctx.config.promptVersion}**, SHA256${dry.frozen.promptSha256}.
- Logical schema **${ctx.config.schemaVersion}**, SHA256${dry.frozen.schemaSha256}.
- Temperature0, output cap6000 у обеих, timeout120000ms, максимум1 retry только429 с bounded backoff.
- Gemini cap включает thinking tokens; у Ministral reasoning выключен/не поддержан этим model ID. Реальный usage и различие видимого бюджета фиксируются.
- Mistral получает полную JSON Schema. Gemini — существующий совместимый wire adapter, сохраняющий форму/required/nullable/date-time, но оставляющий часть ограничений строгому серверу. Это отличие decoder constraints может влиять на Raw Model и документируется, а не скрывается.
- Все метаданные и нормализованный текст одного job идентичны для обеих моделей; actual HTTP payload, parameters, body SHA и reported model IDs архивируются.
- Код runtime, compiled JS, tools, конфигурация, prompts, schema и dataset зафиксированы в plan SHA **${dry.planSha256}**. Изменения дают новую серию; результаты не смешиваются.

## 4. Extraction Quality

Precision/Recall/F1, missed/hallucinated events считаются по ручному one-to-one выравниванию expected event IDs и predicted indices, отдельно по статье, категории и multi-event поднабору. Никакого greedy text similarity как окончательного арбитра. Допустимые альтернативы сначала утверждает человек. После разметки доступны TP/FP/FN и все числители/знаменатели.

Level A использует неизменённый raw output, включая технически невалидные claims. Level B — только Valid claims с canonicalEventId, уникальные по canonical ID внутри публикации; MergeCandidate без канонической привязки удерживается, а не считается вторым событием. Это предложения для review, а не автоматически опубликованные события. Provider failure безHTTP200 исключён из Raw semantic quality и отдельно отражается в end-to-end Level B как отсутствие результата. Invalid JSON приHTTP200 учитывается как структурный срыв извлечения.

## 5. Country & Role Accuracy

Считаются country Precision/Recall/F1, raw invalid ISO, organization-as-country, role Accuracy/F1 и неверные initiator/target. Роли сравниваются country:role; роли пропущенных/лишних стран штрафуются F1. Accuracy ролей условна на совпавшие страны, её знаменатель указан. Автоматический счётчик очевидных организаций — только нижняя граница; полный Organization-as-Country Error Rate требует ручного countryErrorsReviewed и разбора неоднозначных кодов. Без ground truth качественные метрики недоступны; при наличии разметки значения и покрытия перечислены в metrics.json.

## 6. Relationship Quality

Правильность требует точного совпадения участников, типа и направления. GB→RU sanctions не равно military_aid и не равно RU→GB sanctions. Для bidirectional порядок концов несущественен. False relationship rate =FP/все предсказанные отношения. Support и причины ложной связи (venue, co-mention, organization, multilateral, historical) задаёт человек отдельно от формального совпадения кортежа.

10 контролируемых перепечаток не входят в100 независимых input records. Дополнительно подготовлены10 отрицательных кандидатных пар из уже обрабатываемых основных статей, без дополнительных вызовов; expectedSameEvent до ручного решения null. Auto-link и candidate detection оцениваются отдельно. Без отрицательных adjudicated controls нельзя объявлять precision100%. Неполученные/отклонённые claims нужно отдельно учитывать как extraction unavailable, а не успешную дедупликацию.

## 7. Evidence Quality

Reference validity — существующие локальные IDs и отсутствие cross-event/duplicate IDs. Exact Quote Match — непрерывное точное совпадение evidence.text с сохранённым оригиналом title+newline+body. Нормализация пробелов не превращается в raw exact quote. Evidence Attribution/Unsupported/Paraphrasing требуют отдельных ручных оценок; несовпавшая строка не объявляется автоматически парафразом или ложью.

Нормализованный action_text сам по себе не создаёт FP на Level A. Текущий production validator строже и требует дословного action_text: его отклонение отражается в Level B как эффект backend guard, без объявления фактической ложности события. Во время benchmark правило не изменяется. Для Level B сохранённые temporaryId↔UUID используются лишь для разрешения пространства имён ссылок, без угадывания отсутствующих IDs.

## 8. JSON Reliability

JSON validity и strict schema validity считаются отдельно и условно на полученный HTTP200. Malformed raw claims не исчезают из архива. Отдельно сохраняются all-three JSON-valid consistency и случай, когда три невалидных ответа одинаково невалидны. Число сохранённых генераций указано в Executive Summary; прежние диагностические серии сюда не входят.

## 9. API Reliability

metrics.json разделяет HTTP400/429/500/502/503, timeouts, прочие network errors, invalid JSON, schema failures и backend validation. errors.json содержит причины и безопасные provider details. Configuration/adapter smoke ошибки исключены из основной серии; обнаруженная новая400 в main останавливает серию и требует отдельного исправленного запуска, а не удаления неудобного кейса.

Completed envelope не равен полностью валидной статье: successfulProcessingRate требует schema-valid envelope и Valid всех claims; partial acceptance показана отдельно. Каждая HTTP попытка и retry сохраняются. Обе модели чередуются по статьям для уменьшения временного перекоса доступности.

## 10. Latency

Для каждой попытки сохраняется duration, для статьи wall latency с retry/backoff. Average, median и nearest-rank P95 считаются отдельно для всех статей и HTTP-success статей; n указан. Retries имеют отдельный overhead. Числители, знаменатели и значения доступны в metrics.json после реальных запросов.

## 11. Cost

Тарифы проверены18.10.2026: Ministral$0.15 input/$0.15 output; Gemini$0.75/$3.75 за1M токенов, включая мысли. Источники в config.json. Нет предположения о бесплатном tier/cache discounts. Это estimated cost, не billing.

Dry-run: **${dry.logicalRequests}** логических генераций, максимум${dry.maxHttpAttempts} HTTP попыток при429. Основная серия200; отдельно smoke4, consistency120, перепечатки20. Плановый сценарий **$${dry.totalIllustrativeScenarioUsd.toFixed(2)}**, консервативная сумма первых резервов **$${dry.firstAttemptConservativeUpperUsd.toFixed(2)}**, configurable hard cap **$${dry.hardBudgetCapUsd}**. Сценарий использует body chars/4 input и2000 output Ministral /3000 Gemini, включая thinking: это допущение, не измерение. Все344 HTTP bodies рассчитаны реальным request builder без сетевых generation вызовов.

После запуска: cost/article, cost/valid canonical proposal, cost/correctly-extracted raw event, cost/1000 и явно заданный месячный сценарий30000 статей. Неизвестный usage даёт unknown total и сохраняет резерв; не нулевую стоимость. Полные затраты всех фаз и основная серия разделены.

## 12. Consistency

20 заранее выбранных стратифицированных статей ×3 свежих генерации ×2 модели =120 отдельных jobs. Для каждого повтора отдельная benchmark DB; рабочая application-idempotency не меняется. Все ответы сохраняются независимо. Сравниваются count/country/role/typed-directional relationship/modality signatures, не порядок JSON или формулировки заголовков. Это structural consistency, не гарантия семантической эквивалентности. Неполные/невалидные тройки не выдаются за стабильные корректные ответы.

## 13. Error Analysis

${metrics.completedLogicalRuns ? "Серия содержит сохранённые реальные результаты; конкретные ошибки и phases перечислены в errors.json и per-article rows." : "Новая серия ещё не запущена: ошибок generation серии пока нет."} Старые Phase4/4.5/Gemini diagnostics не смешиваются с holdout и не подставляются вместо новых ответов. После запуска per-article и per-category counters, конкретные job IDs/raw results и ручные причины доступны в JSON. Для Event/Relationship F1 и False Relationship Rate реализован paired article bootstrap5000 повторов, seed461018, percentile95% CI; при<20 пар CI не заявляется. Корреляция источников остаётся ограничением даже при100 статьях.

## 14. Final Recommendation

${metrics.status === "human_adjudicated" ? "Получены human-adjudicated оценки. Итоговое решение должно учитывать раздельные Raw/Pipeline результаты и парные интервалы; автоматический выбор/переключение production не выполняется." : "Сейчас **выбирать победителя нельзя**: серия или независимая ручная разметка ещё не завершены."} До первого платного запуска ТЗ требует остановки и разрешения на расходы. Для полного результата нужны человеческая разметка100 текстов, ручное выравнивание/assessment двух уровней, утверждённый бюджет, успешный smoke и реальные новые серии. Приоритет решения: ложные международные связи → участники/направления → event quality → evidence → надёжность → стоимость → скорость. Production-модель автоматически не меняется.
`;
await fs.writeFile(path.join(ROOT, 'comparison.md'), report);
console.log('comparison.md updated; no model winner inferred.');
