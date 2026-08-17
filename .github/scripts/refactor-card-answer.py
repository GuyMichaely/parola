from pathlib import Path
import re

path = Path("web/src/App.tsx")
text = path.read_text()

start_marker = "function NounAnswer("
end_marker = "function SetField("
start = text.index(start_marker)
end = text.index(end_marker)
block = text[start:end].rstrip() + "\n"
block = re.sub(r"(?m)^function ([A-Za-z0-9_]+)", r"export function \1", block)

module = '''import type { FormEvent } from "react";
import type { CardType, Flashcard } from "../cards/types";
import { typeLabels } from "../cardTypes";
import { answerKeyword, type AnswerKeywords } from "./StudyOptions";
import {
  inferArticle,
  verifyPowerAnswer,
  type AnswerSyntaxMode,
} from "../study/logic";

''' + block

out = Path("web/src/components/CardAnswer.tsx")
out.write_text(module)

text = text[:start] + text[end:]
anchor = 'import { SaveIndicator, type SaveState } from "./components/SaveIndicator";\n'
imports = 'import { CardAnswer, EnglishAnswer, ItalianPrompt, ItalianVerificationForm } from "./components/CardAnswer";\n'
if anchor not in text:
    raise SystemExit("Import anchor not found")
text = text.replace(anchor, anchor + imports, 1)
path.write_text(text)
print("Extracted components/CardAnswer.tsx")
