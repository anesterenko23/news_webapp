# Human annotation / adjudication protocol

Этот пакет должен читать человек, не участвующий в выборе победителя по ответам моделей. Он содержит только source texts/metadata, без предсказаний. Автор разметки и adjudicator указывают настоящие имена/идентификаторы и UTC дату. Если это один человек, явно отметить single-reviewer limitation. Не проставлять фиктивное human-подтверждение от агента.

## До просмотра предсказаний

1. Проверить каждый текст и provenance. Подтвердить категорию (`categoryConfirmed=true`) или вернуть запись на замену до заморозки основного benchmark. Проверить уникальность публикации/отсутствие перепечатки среди основных100; разные тексты могут всё равно относиться к одному событию — отметить это.
2. Разделить самостоятельные действия на expected events. Не делать отдельное событие из каждого упоминания страны. Указывать literal type/status и countries с role. Взаимное соглашение partner/partner. Страна места проведения не становится автоматически участником отношения. Организация не превращается в ISO-страну; partners без названий не разворачиваются в список государств.
3. Для каждого отношения указать endpoints, type и directed/bidirectional. Совместное упоминание не подтверждает отношение. Различать факт сообщения/обвинения/опровержения и истинность внешнего факта. Независимый fact-check здесь не выполняется.
4. Указать точные evidence spans в `title + "\n" + content`, start/end в UTF-16 code units (как JS String.slice). `end` исключающий. Сохранить строку text и уникальный id. `source.slice(start,end)` должно совпадать с text. Нормализованный action description допустим; evidence.text — дословный.
5. Не угадывать неизвестные страны/роли/даты. Для неоднозначности записать причины и заранее допустимые альтернативные полные event sets. Альтернативы нельзя добавлять только ради оправдания конкретного ответа модели.
6. Контрольный отрицательный пример после проверки получает `expectedEvents:[]`; `null` — не размечен. Пока все100 имеют null, включая5 предполагаемых control статей.
7. Заполнить coverageTags: multi_event, venue_only, international_organization, unspecified_partners, indirect_attribution, planned, announced, proposed, alleged, denied, speculative, historical_context, contradictory_claims — только если признак действительно есть. Проверить, что все запрошенные ТЗ сложные признаки представлены. Утвердить итог независимым/явно описанным ручным adjudication.
8. После окончательного решения: review.status=`adjudicated`, method=`human`, annotator/adjudicator/reviewedAt заполнены, categoryConfirmed=true. Root status=`adjudicated`. Не менять prompts под размеченный holdout.

Структура одного ожидаемого события:

```json
{
  "id":"WL46-001-E1",
  "actionDescription":"Human normalized description",
  "event_type":"diplomacy",
  "event_status":"completed",
  "countries":[{"code":"FR","role":"partner"},{"code":"DE","role":"partner"}],
  "relationships":[{"source_country":"FR","target_country":"DE","type":"diplomacy","direction":"bidirectional","supportingEvidenceIds":["Q1"]}],
  "evidence":[{"id":"Q1","start":0,"end":35,"text":"Replace with exact span from source"}]
}
```

Это только пример формата на вымышленных данных, не готовая метка. Допустимые типы/роли/модальности — текущие schemas.ts. Для acceptableAlternatives использовать `{id,reason,events:[...]}`. У основной записи также есть ambiguityReasons.

## После реальных ответов: adjudication.json

Каждый main article/model имеет две отдельные записи: level A и B. Указать jobId из сохранённого run; raw predictionIndex относится к порядку raw.events, B — к порядку pipelinePredictions из инструмента (Valid+canonical, unique canonical ID). Сопоставление one-to-one; невыравненные expected/predicted считаются FN/FP. Ни confidence, ни текстовая similarity автоматически не определяют совпадение.

```json
{
  "articleId":"WL46-001","model":"gemini","level":"A",
  "jobId":"main__WL46-001__0__gemini",
  "status":"adjudicated","method":"human","reviewer":"actual reviewer",
  "alternativeId":null,
  "countryErrorsReviewed":true,"countryErrors":[],
  "matches":[{"predictionIndex":0,"expectedEventId":"WL46-001-E1"}],
  "evidence":[{"predictionIndex":0,"evidenceId":"returned-evidence-id","attributionCorrect":true,"support":"supported","quoteKind":"exact"}],
  "relationships":[{"predictionIndex":0,"relationshipIndex":0,"support":"supported","falseCause":null}],
  "titleModality":[{"predictionIndex":0,"consistent":true}]
}
```

support: supported/unsupported/ambiguous. quoteKind: exact/format_only/paraphrase/unrelated. Несовпадение строки не доказывает парафраз: reviewer должен это определить. falseCause при ошибке: venue/co_mention/organization/multilateral/historical/other. Все evidence и отношения должны быть оценены для полного отчёта; отсутствие оценок даёт null rate, а не0% ошибок. Для API-failure actual=[]: expected не исчезают и увеличивают missed count.

Raw нормализованный actionText не превращает событие в hallucination. Если production guard отклонил его за недословность, это отдельный Level B эффект. Same type/countries с обратным направлением или другим relationship type не считаются правильной связью.

## Deduplication

Отдельные10 synthetic reprints явно имеют того же предка и не являются независимыми подтверждениями. 10 negative candidate pairs требуют ручной проверки, а не автоматического assumedFalse. В `adjudication.deduplication` указать pairId, model, leftJobId/rightJobId, leftClaimId/rightClaimId, expectedSame boolean, status=adjudicated, method=human, reviewer. Если claims отсутствуют из-за extraction failure, отметить extractionUnavailable=true; это исключённый из matcher precision случай с отдельным счётчиком. Для существующих Invalid claims инструмент также исключает matcher оценку и показывает extraction unavailable.

Сравниваются autoLink и candidate отдельно. Без reviewed negative controls precision интерпретировать нельзя. Перепечатка не повышает factual VerificationStatus при любом результате.

Для Organization-as-Country Error Rate нужен countryErrorsReviewed=true после просмотра всех country labels. countryErrors содержит `{predictionIndex,countryIndex,kind:"organization_as_country"}` или kind=other. Без этого полного ручного просмотра организация-as-country rate остаётся null; автоматический счётчик очевидных UN/EU/NATO и т.п. — только нижняя граница, не окончательная семантическая разметка.
