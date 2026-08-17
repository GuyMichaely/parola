from pathlib import Path

# Clean App imports now that presentation/editor logic has moved out.
app_path = Path("web/src/App.tsx")
app = app_path.read_text()
app = app.replace('import { FormEvent, useEffect, useMemo, useState } from "react";', 'import { useEffect, useMemo, useState } from "react";', 1)
old_storage_import = 'import { createCardStorage, readStorageEndpoint, readStorageMode, saveStorageEndpoint, saveStorageMode, type CardStorage, type CardType, type Flashcard, type StorageMode } from "./storage";'
new_storage_import = 'import { createCardStorage, readStorageEndpoint, readStorageMode, saveStorageEndpoint, saveStorageMode, type CardStorage, type StorageMode } from "./storage";\nimport type { CardType, Flashcard } from "./cards/types";'
if old_storage_import not in app:
    raise SystemExit("Expected App storage import not found")
app = app.replace(old_storage_import, new_storage_import, 1)
old_study_import = '''import {
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
} from "./study/logic";'''
new_study_import = '''import {
  shuffled,
  withEnglishPromptFirst,
  type AnswerSyntaxMode,
  type StudyItem,
} from "./study/logic";'''
if old_study_import not in app:
    raise SystemExit("Expected App study import not found")
app = app.replace(old_study_import, new_study_import, 1)
app_path.write_text(app)

# Domain metadata should depend directly on domain types, not persistence.
card_types_path = Path("web/src/cardTypes.ts")
card_types = card_types_path.read_text().replace('from "./storage"', 'from "./cards/types"')
card_types_path.write_text(card_types)

study_options_path = Path("web/src/components/StudyOptions.tsx")
study_options = study_options_path.read_text().replace('from "../storage"', 'from "../cards/types"')
study_options_path.write_text(study_options)

# Split study ordering/session-list helpers from Italian answer verification.
logic_path = Path("web/src/study/logic.ts")
logic = logic_path.read_text()
infer_start = logic.index("export function inferArticle(")
shuffle_start = logic.index("export function shuffled")
verify_start = logic.index("export function verifyPowerAnswer")

verification_body = logic[infer_start:shuffle_start].rstrip() + "\n\n" + logic[verify_start:].lstrip()
verification_header = '''import type { CardType, Flashcard } from "../cards/types";
import type { AnswerKeywords } from "../components/StudyOptions";

export type AnswerSyntaxMode = "universal" | "compact";

export type VerificationField = {
  key: string;
  label: string;
  expected: string;
};

'''
Path("web/src/study/verification.ts").write_text(verification_header + verification_body)

order_body = logic[shuffle_start:verify_start].rstrip() + "\n"
order_header = '''import type { Flashcard } from "../cards/types";
import type { PromptLanguage } from "../components/StudyOptions";

export type StudyItem = {
  key: string;
  card: Flashcard;
  promptLanguage: PromptLanguage;
};

'''
Path("web/src/study/order.ts").write_text(order_header + order_body)

logic_path.write_text('''export { shuffled, withEnglishPromptFirst } from "./order";\nexport type { StudyItem } from "./order";\nexport * from "./verification";\n''')

# Persistence barrel exports persistence concepts only.
storage_index = Path("web/src/storage/index.ts")
storage = storage_index.read_text()
storage = storage.replace('export type { CardType, Flashcard } from "../cards/types";\n', '')
storage_index.write_text(storage)

print("Finalized frontend module dependencies and study modules")
