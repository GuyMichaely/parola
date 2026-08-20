# Noun morphology and answer syntax

Parola keeps a noun's actual morphology separate from what the learner is allowed to type during study.

## Noun cards

A noun card stores these morphology facts:

- `ruleId`, the noun's actual declension rule;
- `base`, the string that the rule transforms;
- `gender`;
- `numberMode`, one of `both`, `singular`, or `plural`;
- `articleMode`, currently `automatic` or `none`.

The card does not store derived plurals or articles. Parola generates them when it needs them.

For example, `cetriolo` can use rule `o-i` with base `cetriol`. `specchio` can use rule `chio-chi` with base `spec`.

A noun with no useful declensional counterpart can use the `identity` rule. Its surface form is its base. This avoids assigning a singular-only noun such as `Venezia` an arbitrary unseen plural pattern.

## Declension rules

A declension rule describes transformations between a base and noun forms. It does not contain gender or study policy.

For example:

```json
{
  "id": "o-i",
  "forms": {
    "singular": { "suffix": "o" },
    "plural": { "suffix": "i" }
  }
}
```

Generation and recognition use the same definition.

- Generate singular: append `o` to the base.
- Recognize singular: if the observed form ends in `o`, remove that suffix to recover a candidate base.
- Generate plural: append `i`.
- Recognize plural: if the observed form ends in `i`, remove it.

Parola derives recognition from generation when the transformation is safely reversible. If a future transformation cannot be inverted this way, the rule model can gain an explicit recognition override rather than duplicating inverse logic for every rule.

## Syntax rules

A syntax rule describes the structure of a typed answer. It does not encode noun-specific morphology.

For example, `Article + singular` contains these fields:

```text
[gender] <definite singular article> <singular noun>
```

A syntax can also require markers such as singular-only or plural-only. Marker order is currently flexible, so gender and tantum markers can be interchanged.

Syntax rules are stored as data. The current UI shows them but does not edit their structure yet.

## Inference sets

Each syntax rule references an inference set. The inference set lists the declension rules that syntax is allowed to infer.

Several syntaxes can share one inference set. This lets study policy change once for several equivalent shorthand forms. For example, an article-based shorthand and a gender-based shorthand can both use the same `learned-shorthand` inference set.

Adding `chio-chi` to that inference set means every syntax that references it may begin inferring `chio-chi`. The noun cards do not change.

## Candidate parsing

Parola does not choose one morphology before checking the answer. It keeps every applicable interpretation as a candidate.

For each noun answer:

1. Try each syntax definition against the typed tokens.
2. For each applicable syntax, try every declension rule in its inference set.
3. Let each declension rule recognize the noun fields and infer a base.
4. Use parsed articles and markers as grammatical facts. A candidate must agree with those facts.
5. Compare all complete candidates with the prompted card's actual noun definition.

The result follows three rules:

- If any candidate matches the card, the answer is correct.
- If at least one complete candidate exists but none matches the card, the answer is wrong.
- If no complete candidate exists, the input has invalid or incomplete syntax.

Syntax parsing does not consult the prompted card's actual declension rule. That keeps syntax validity separate from correctness.

## Live preview

The live preview can show the parsed syntax fields and every declension rule that currently recognizes the input. It must not mark any candidate as matching or not matching the prompted card before submission.

For `lo specchio`, the preview may therefore show `-o -> -i` and `-chio -> -chi` as possible interpretations if both are allowed by the active inference set. That information comes from the typed characters and the configured rules, not from the target card.

## Example: specchio and cetriolo

Assume these cards:

```text
cetriolo: rule o-i, base cetriol
specchio: rule chio-chi, base spec
```

Suppose `learned-shorthand` initially contains `o-i` but not `chio-chi`.

`il cetriolo` produces an `o-i` candidate with base `cetriol`. It matches the card and is correct.

`lo specchio` is valid `Article + singular` syntax. The allowed `o-i` rule recognizes the final `o` and produces base `specchi`. A complete candidate exists, but it does not match the card's actual `chio-chi` definition. The answer is wrong, not syntactically invalid.

Later, add `chio-chi` to `learned-shorthand`. The same input now also produces a `chio-chi` candidate with base `spec`. That candidate matches the card, so `lo specchio` becomes correct.

Nothing about `specchio` changed. Only the learner's permitted inference set changed.

## Storage

The inventory snapshot contains:

```json
{
  "cards": [],
  "nounMorphology": {
    "declensionRules": [],
    "inferenceSets": [],
    "syntaxRules": []
  }
}
```

There is one current schema. Old representations are migrated once outside the application rather than supported by permanent compatibility code.
