# Noun morphology and answer syntax

This document defines the target noun model. The current implementation should be changed to match it rather than preserved for compatibility.

## Keep morphology separate from answer syntax

A noun's morphology and the syntax accepted during study are different data.

A noun that follows a rule stores the information needed to derive its forms:

- a declension rule ID;
- a base form and whether that base is singular or plural;
- gender;
- number behavior: both numbers, singular-only, or plural-only;
- article behavior, normally automatic, with an option for no article when needed.

A declension rule only describes the spelling transformation between singular and plural. Gender and study syntax do not belong to the rule. For example, `-e -> -i` can be shared by masculine and feminine nouns.

Parola derives the available singular and plural forms from the noun instance plus its rule. It derives articles from gender, number behavior, article behavior, and the spelling of the resulting form.

Manual nouns may keep explicit forms when no useful rule describes them.

## Answer syntax is separate data

Study syntax definitions describe what fields the user may type and which declension rules that syntax is allowed to infer.

For example, an `Article + singular` syntax may accept:

`<definite singular article> <singular noun>`

Optional noun markers such as gender or tantum may be parsed separately from the core syntax.

The syntax definition contains the declension rule IDs that it may infer. A learner can therefore change which rules a short syntax covers without changing any noun's actual morphology.

## How Parola chooses a rule from typed text

When a syntax can infer more than one declension rule, Parola inspects the supplied noun form and finds the allowed rules whose suffixes match it. The most specific matching suffix wins. If two matches have the same specificity, the syntax definition's rule order breaks the tie.

This is deliberately based on the user's answer, not on the prompted card's stored rule. The live parser should decide whether an answer is syntactically valid without revealing whether the inferred morphology is correct for the prompt.

After parsing, Parola derives a candidate set of noun forms from the syntax-selected rule and compares that candidate with the prompted noun's canonical forms.

## Example: specchio and cetriolo

`specchio` is always assigned to `-chio -> -chi`.

`cetriolo` is always assigned to `-o -> -i`.

Suppose `Article + singular` initially allows only `-o -> -i`.

`il cetriolo` parses under `-o -> -i`, derives `cetrioli`, and matches the stored noun. It is correct.

`lo specchio` is still a complete, valid instance of the same answer syntax. Because `-o -> -i` is the only allowed rule, Parola derives `specchii`. That candidate does not match the stored `-chio -> -chi` noun, so the submitted answer is wrong. The live syntax preview must not reveal this before submission.

Later, the learner can add `-chio -> -chi` to the rules allowed by `Article + singular`. Both `-o -> -i` and `-chio -> -chi` match the characters in `specchio`, but `-chio` is the more specific suffix. Parola therefore chooses `-chio -> -chi`, derives `specchi`, and accepts `lo specchio`.

The noun did not change. The learner changed what the shorthand syntax is allowed to infer.

## Schema changes

Do not keep the current `nounPatterns` representation as a compatibility layer. Replace it with the clean target model when this design is implemented.

The inventory will need separate collections for declension rules and answer syntax definitions. Noun cards will need canonical morphology fields rather than a pattern that also owns gender and study syntax.

Preserve real user data with a one-time migration outside the application repository. Do not commit permanent readers, fallback branches, or legacy-field handling for the old schema.
