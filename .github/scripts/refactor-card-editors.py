from pathlib import Path
import re

path = Path("web/src/App.tsx")
text = path.read_text()

start_marker = "type BatchRow = {"
end_marker = "export default function Home()"
start = text.index(start_marker)
end = text.index(end_marker)
block = text[start:end].rstrip() + "\n"

block = re.sub(r"(?m)^function ([A-Za-z0-9_]+)", r"export function \1", block)
block = block.replace('const deckTagPrefix = "__deck__:";', 'export const deckTagPrefix = "__deck__:";')

module = '''import { type FormEvent, useEffect, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import { cardTypes, typeLabels } from "../cardTypes";
import {
  inferArticle,
  normalizeAnswer,
  standardAdjectivePattern,
  standardNounPattern,
} from "../study/logic";

''' + block

out = Path("web/src/components/CardEditors.tsx")
out.write_text(module)

text = text[:start] + text[end:]
anchor = 'import { CardAnswer, EnglishAnswer, ItalianPrompt, ItalianVerificationForm } from "./components/CardAnswer";\n'
imports = '''import {
  AddCardModal,
  BulkEditCardsModal,
  EditCardModal,
  InventoryCardsEditor,
  deckName,
  deckTagPrefix,
  localDateStamp,
  visibleTags,
} from "./components/CardEditors";\n'''
if anchor not in text:
    raise SystemExit("Import anchor not found")
text = text.replace(anchor, anchor + imports, 1)
path.write_text(text)
print("Extracted components/CardEditors.tsx")
