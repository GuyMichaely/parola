from pathlib import Path
import re

path = Path("web/src/App.tsx")
text = path.read_text()

start_marker = "function inferArticle("
end_marker = "function emptyBatchRow("
start = text.index(start_marker)
end = text.index(end_marker)
block = text[start:end].rstrip() + "\n"

block = re.sub(r"(?m)^function ([A-Za-z0-9_]+)", r"export function \1", block)

module = '''import type { CardType, Flashcard } from "../cards/types";
import type { AnswerKeywords, PromptLanguage } from "../components/StudyOptions";

export type AnswerSyntaxMode = "universal" | "compact";

export type StudyItem = {
  key: string;
  card: Flashcard;
  promptLanguage: PromptLanguage;
};

export type VerificationField = {
  key: string;
  label: string;
  expected: string;
};

''' + block

out = Path("web/src/study/logic.ts")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(module)

for type_block in [
'''type AnswerSyntaxMode = "universal" | "compact";\n\n''',
'''type StudyItem = {\n  key: string;\n  card: Flashcard;\n  promptLanguage: PromptLanguage;\n};\n\n''',
'''type VerificationField = {\n  key: string;\n  label: string;\n  expected: string;\n};\n\n''',
]:
    if type_block not in text:
        raise SystemExit(f"Expected type block not found: {type_block.splitlines()[0]}")
    text = text.replace(type_block, "", 1)

text = text[:text.index(start_marker)] + text[text.index(end_marker):]

anchor = 'import { StudyScope, type ScopeMode, type StudyScopeOption } from "./components/StudyScope";\n'
imports = '''import {
  inferArticle,
  normalizeAnswer,
  standardNounPattern,
  standardAdjectivePattern,
  shuffled,
  withEnglishPromptFirst,
  verifyPowerAnswer,
  verificationFields,
  type AnswerSyntaxMode,
  type StudyItem,
} from "./study/logic";\n'''
if anchor not in text:
    raise SystemExit("Import anchor not found")
text = text.replace(anchor, anchor + imports, 1)

path.write_text(text)
print("Extracted study/logic.ts")
