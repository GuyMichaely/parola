# Noun morphology and answer syntax

Parola keeps a noun's lexical definition separate from the study syntax used to recognize typed answers.

## Noun cards

A noun card stores four facts:

- `rule`, the name of its declension rule;
- `base`, the string transformed by that rule;
- `gender`;
- `articleProfile`, an object containing the noun's three article capabilities.

The article capabilities are:

- `definiteSingular`;
- `definitePlural`;
- `indefiniteSingular`.

For example:

```json
{
  "type": "noun",
  "english": "mirror",
  "italian": "specchio",
  "details": {
    "rule": "-chio → -chi",
    "base": "spec",
    "gender": "masculine",
    "articleProfile": {
      "definiteSingular": true,
      "definitePlural": true,
      "indefiniteSingular": true
    }
  }
}
```

The card does not store generated singular/plural strings or article strings.

## Declension rules

A declension rule describes how a stored base produces singular and/or plural forms.

```json
{
  "name": "-o → -i",
  "forms": {
    "singular": { "suffix": "o" },
    "plural": { "suffix": "i" }
  }
}
```

The presence of form entries defines number availability:

```text
singular + plural entries  -> both numbers
singular entry only        -> singular only
plural entry only          -> plural only
```

A blank suffix means the base itself is the surface form. `Plural form is the base` therefore represents a plural-only noun by storing its plural form as the base.

Generation appends the configured suffix. Recognition reverses that operation by removing the suffix.

Rule names are unique and serve as references. Renaming a rule in the morphology editor updates inference-set references and noun-card references when saved.

## Number and article availability are independent

Declension number availability and article availability are separate facts.

A noun can have singular and plural forms while enabling only `definiteSingular`. Its plural form still exists, but the noun definition says definite plural and indefinite singular article constructions are not accepted for that card's sense.

Parola therefore does not derive `articleProfile` from the declension rule and does not derive number availability from `articleProfile`.

The only structural compatibility checks are that an enabled article capability has the noun form it needs. `definitePlural` requires a plural form. `definiteSingular` and `indefiniteSingular` require a singular form.

## Article profiles

The profile is naturally represented as the product of three Boolean capabilities. Parola restricts that product to four canonical combinations:

| Definite singular | Definite plural | Indefinite singular | Meaning |
| --- | --- | --- | --- |
| yes | yes | yes | all three article constructions |
| yes | no | no | definite singular only |
| no | yes | no | definite plural only |
| no | no | no | no articles |

The other four Boolean combinations are rejected by the current schema.

Parola calculates the actual Italian article spelling from gender and the noun form. The profile controls which of those article constructions are available.

For example, a masculine `specchio` card with all three capabilities yields `lo specchio`, `gli specchi`, and `uno specchio`. A card with all three capabilities disabled yields no article forms.

The profile describes the noun sense being taught. It is not a claim that no marked or context-dependent Italian construction can ever use the word differently.

## Inference sets

An inference set is a named learning-policy group containing declension-rule names.

```json
{
  "name": "Learned shorthand",
  "declensionRules": [
    "Singular form is the base",
    "Plural form is the base",
    "Unchanged singular / plural",
    "-o → -i",
    "-e → -i"
  ]
}
```

A syntax can infer only rules in its selected inference set.

The `specchio` learning case depends on this separation. The `-chio → -chi` rule exists and is assigned to the `specchio` card, but it is excluded from `Learned shorthand` by default. Adding it later changes what shorthand can infer without changing the noun card.

## Syntax rules

A syntax rule stores:

- `name`;
- optional or required markers;
- ordered input fields;
- `inferenceSet`.

It does not store an article profile or a number mode.

Article and number claims are derived from the syntax structure at runtime.

### Article-bearing syntax

An article field asserts only the article capability represented by that field.

Examples:

```text
<definite singular article> <singular noun>
    requires articleProfile.definiteSingular

<definite plural article> <plural noun>
    requires articleProfile.definitePlural

<indefinite singular article> <singular noun>
    requires articleProfile.indefiniteSingular
```

This deliberately does not require exact profile equality. `il libro` can match a noun with all three capabilities or one with only definite singular enabled. `i libri` can match all-three or definite-plural-only. An indefinite singular answer can match only the all-three profile under the current four-profile model.

The article spelling itself is also checked against the inferred noun form and gender.

If the typed article does not identify gender, the syntax must obtain gender from a marker. In particular, `l'` does not distinguish masculine from feminine, so `l'albero` alone is insufficient under the default syntax while `m l'albero` is complete.

### Articleless syntax

A syntax with no article field asserts that all three article capabilities are false.

The canonical articleless syntaxes require both an explicit gender marker and a singular-only or plural-only marker, for example:

```text
f s Venezia
```

That answer asserts feminine gender, singular-only morphology, and no articles.

### Number constraints

A noun field identifies the surface form being supplied. A singular noun field can be recognized by any inference rule that has a singular form; it does not by itself assert that the noun is singular-only.

A required singular-only or plural-only marker is stronger. When present, it constrains inference to a declension rule with exactly that number availability.

This is why an article shorthand can cover both ordinary two-number nouns and singular-only/plural-only nouns without storing a separate syntax `numberMode`.

## Candidate parsing

For each typed noun answer Parola:

1. Tries every syntax rule against the typed tokens.
2. Parses explicit gender and singular/plural-only markers.
3. Derives article constraints from the syntax fields.
4. Loads the syntax's inference set.
5. Tries every applicable declension rule in that set.
6. Uses the typed noun form or forms to infer a base.
7. Validates typed article spellings against the inferred form and gender.
8. Produces candidates containing inferred `rule`, `base`, and `gender`, plus the syntax-derived article constraint.
9. Only then compares candidates with the prompted card.

The target card is not consulted while candidates are generated.

The result rules remain:

- Any matching candidate means correct.
- If no candidate matches but at least one syntax is structurally complete, the answer is wrong.
- If no syntax is structurally complete, the input is invalid or incomplete.

A complete syntax can therefore be wrong even if its inference set produces zero candidates.

## Example: `specchio`

The card is:

```text
rule: -chio → -chi
base: spec
gender: masculine
articleProfile: definiteSingular=true, definitePlural=true, indefiniteSingular=true
```

`Learned shorthand` initially does not contain `-chio → -chi`.

For `lo specchio`, the definite-singular syntax is structurally complete. Other allowed rules can recognize the surface string, but they infer different definitions. For example, `-o → -i` removes only the final `o` and produces base `specchi`. `Singular form is the base` produces base `specchio`. Neither candidate matches the card's `rule: -chio → -chi`, `base: spec` definition, so the answer is wrong.

After `-chio → -chi` is added to `Learned shorthand`, the same input can infer base `spec` under the correct rule. The article says masculine and requires the definite-singular capability, both of which match the card, so the answer becomes correct.

`m specchio` is not an article-taking shorthand in the current default syntax set. Article-taking nouns must supply an article.

## Example: `Venezia`

A Venice card can be represented as:

```text
rule: Singular form is the base
base: Venezia
gender: feminine
articleProfile: definiteSingular=false, definitePlural=false, indefiniteSingular=false
```

The default articleless singular syntax accepts:

```text
f s Venezia
```

`f Venezia` is incomplete for that policy because it does not explicitly state singular-only behavior. `la Venezia` is a complete article-bearing syntax, but it is wrong for the articleless card because its definite-singular capability is disabled.

## Names as references

Declension rules and inference sets use their unique names as references:

```text
noun card          -> rule name
inference set      -> declension rule names
syntax rule        -> inference-set name
```

The editor updates those references when names change and rejects duplicate names.

## Live preview

The live preview shows the selected syntax, consumed fields, missing fields, and declension names inferred from that syntax.

Candidate generation does not consult the prompted card's stored rule, base, gender, or article profile, so the preview must not reveal which candidate is correct before submission.

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

The schema is strict. Retired noun `articleMode` fields and retired syntax `articleMode`/`numberMode` fields are not accepted.

Storage validates the snapshot as a whole. Every noun must reference an existing rule, required article capabilities must have the necessary noun forms, and the stored primary `italian` value must equal the primary form generated from the rule and base.
