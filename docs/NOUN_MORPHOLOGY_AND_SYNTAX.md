# Noun morphology and answer syntax

Parola keeps a noun's actual morphology separate from what the learner is allowed to type during study.

## Noun cards

A noun card stores these morphology facts:

- `ruleId`, the noun's actual declension rule;
- `base`, the string that the rule transforms;
- `gender`;
- `numberMode`, one of `both`, `singular`, or `plural`;
- `articleMode`, currently `automatic` or `none`.

The card does not store derived forms or articles. Parola generates them when it needs them.

For example, `cetriolo` can use rule `o-i` with base `cetriol`. `specchio` can use rule `chio-chi` with base `spec`.

A tantum noun does not borrow a hypothetical two-number declension merely because its visible form resembles one. A pluralia-tantum card for `clothes` uses `plural-base` with base `vestiti`. A separate `dress` card uses `o-i` with base `vestit`. Likewise, a singular-only `Venezia` card uses `singular-base` with base `Venezia`.

## Declension rules

A declension rule describes transformations between a base and the noun forms that rule actually supports. It does not contain gender or study policy. A rule may define both numbers or only one.

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

`plural-base` instead defines only a plural form:

```json
{
  "id": "plural-base",
  "forms": {
    "plural": { "suffix": "" }
  }
}
```

With an empty suffix, the base is already the surface form. `base: "vestiti"` therefore generates and recognizes `vestiti`, and the rule contains no singular transformation.

Generation and recognition use the same definition.

- Generate a supported form by appending its suffix to the base.
- Recognize a supported form by removing that suffix from the observed form.
- A missing form is unsupported. Parola does not generate or recognize it through that rule.

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

A syntax also has a number mode. Parola only tries declension rules whose supported forms match that mode. A pluralia-tantum syntax therefore uses plural-only rules such as `plural-base`, rather than treating an ordinary two-number rule as a pluralia-tantum noun definition.

## Candidate parsing

Parola does not choose one morphology before checking the answer. It keeps every applicable interpretation as a candidate.

For each noun answer:

1. Try each syntax definition against the typed tokens.
2. For each applicable syntax, try every compatible declension rule in its inference set.
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

## Example: dress and clothes

These are separate cards even though both contain the surface string `vestiti` somewhere in their paradigms.

```text
dress:   rule o-i,        base vestit,  number both
clothes: rule plural-base, base vestiti, number plural
```

The `dress` rule derives `vestito` and `vestiti` from `vestit`. The `clothes` rule has only a plural form and treats `vestiti` itself as the base. Parola never derives `vestito` as a form of the `clothes` card.

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
