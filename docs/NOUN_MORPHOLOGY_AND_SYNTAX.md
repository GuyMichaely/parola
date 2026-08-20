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

Syntax rules are stored as data and are editable in the noun morphology panel. The editor can change:

- the syntax name;
- field order and field type;
- singular, plural, or both-number behavior;
- automatic or no-article behavior;
- optional or required gender markers;
- required singular-only or plural-only markers;
- the inference set used by the syntax.

Syntax rules can also be added or removed. This is a structured data editor, not a separate expression or heuristic language. Morphological recognition still belongs to declension rules.

Parola validates syntax combinations before accepting the inventory. A singular-only syntax cannot contain plural fields, a plural-only syntax cannot contain singular fields, and a tantum marker must agree with the syntax number mode.

## Inference sets

Each syntax rule references an inference set. The inference set lists the declension rules that syntax is allowed to infer.

Several syntaxes can share one inference set. This lets study policy change once for several equivalent shorthand forms. For example, an article-based shorthand and a gender-based shorthand can both use the same `learned-shorthand` inference set.

Inference sets are editable policy objects. They can be renamed, created, removed when unused, and assigned to syntax rules. Their declension membership is editable independently of noun cards.

Adding `chio-chi` to an inference set means every syntax that references it may begin inferring `chio-chi`. The noun cards do not change.

A syntax also has a number mode. Parola only tries declension rules whose supported forms match that mode. A pluralia-tantum syntax therefore uses plural-only rules such as `plural-base`, rather than treating an ordinary two-number rule as a pluralia-tantum noun definition.

## Candidate parsing

Parola does not choose one morphology before checking the answer. It keeps every applicable interpretation as a candidate.

For each noun answer:

1. Try each syntax definition against the typed tokens.
2. For each structurally complete syntax, try every compatible declension rule in its inference set.
3. Let each declension rule recognize the noun fields and infer a base.
4. Use parsed articles and markers as grammatical facts. Ambiguous facts can branch into several interpretations. Conflicting facts make that syntax inapplicable.
5. Compare all produced candidates with the prompted card's actual noun definition.

The result follows three rules:

- If any candidate matches the card, the answer is correct.
- Otherwise, if at least one syntax is structurally complete, the answer is wrong. A complete syntax can therefore be wrong even when no allowed declension rule produces a candidate.
- If no syntax is structurally complete, the input is invalid or incomplete.

Syntax parsing does not consult the prompted card's actual declension rule. That keeps syntax validity separate from correctness.

When several rules recognize the same input, Parola keeps all candidates. Candidate ordering is deterministic and prefers more specific recognized suffixes for display and diagnostics, but specificity does not discard broader candidates or determine correctness.

### Ambiguous grammatical facts

Some typed forms do not determine every fact by themselves. For example, definite singular `l’` can introduce either a masculine or feminine noun. If no explicit gender marker resolves it, the parser branches and tries both genders. It does not consult the prompted card to choose one.

If the answer contains contradictory facts, such as an explicit masculine marker paired with an unambiguously feminine article, that syntax is not applicable.

## Live preview

The live preview shows which answer syntax is being recognized, the fields already consumed, and any fields still needed. When the typed input is sufficient to produce morphology candidates, it may also show the possible declension rules inferred from the learner's input and the configured inference set.

Showing those candidates does not reveal the answer by itself. Candidate generation does not consult the prompted card's canonical `ruleId` or base. The preview must not indicate which candidate, if any, matches the prompted card before submission.

For example, `lo specchio` may visibly produce both a broad `o-i` interpretation and a more specific `chio-chi` interpretation when both are allowed. The preview may list both. It must not mark `chio-chi` as the correct one merely because the prompted card uses that rule.

A structurally complete noun answer remains checkable even when no allowed declension rule produces a candidate. Submission records that answer as wrong rather than rejecting it as invalid syntax.

## Example: specchio and cetriolo

Assume these cards:

```text
cetriolo: rule o-i, base cetriol
specchio: rule chio-chi, base spec
```

Suppose `learned-shorthand` initially contains `o-i` but not `chio-chi`.

`il cetriolo` produces an `o-i` candidate with base `cetriol`. It matches the card and is correct.

`lo specchio` is valid `Article + singular` syntax. The allowed `o-i` rule recognizes the final `o` and produces base `specchi`. A candidate exists, but it does not match the card's actual `chio-chi` definition. The answer is wrong, not syntactically invalid.

Later, add `chio-chi` to `learned-shorthand`. The same input now also produces a `chio-chi` candidate with base `spec`. That candidate matches the card, so `lo specchio` becomes correct.

Nothing about `specchio` changed. Only the learner's permitted inference set changed.

## Example: dress and clothes

These are separate cards even though both contain the surface string `vestiti` somewhere in their paradigms.

```text
dress:   rule o-i,         base vestit,   number both
clothes: rule plural-base, base vestiti, number plural
```

The `dress` rule derives `vestito` and `vestiti` from `vestit`. The `clothes` rule has only a plural form and treats `vestiti` itself as the base. Parola never derives `vestito` as a form of the `clothes` card.

## Inventory state

Cards and noun morphology form one inventory state:

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

Storage reads and whole-inventory writes treat those values as one validated snapshot. A noun card must reference an existing compatible rule, its stored primary `italian` value must agree with the primary form generated by its canonical noun definition, and syntax rules must be internally consistent with their number and marker semantics.
