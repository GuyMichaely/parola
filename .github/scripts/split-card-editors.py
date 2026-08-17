from pathlib import Path

path = Path("web/src/components/CardEditors.tsx")
text = path.read_text()

markers = {
    "types": "type BatchRow = {",
    "set_field": "export function SetField(",
    "row_from_card": "export function nounRowFromCard(",
    "row_cells": "export function NounRowCells(",
    "batch_nouns": "export function BatchNouns(",
    "edit_modal": "export function EditCardModal(",
    "inventory_type": "type InventoryMetadataDraft =",
    "bulk_modal": "export function BulkEditCardsModal(",
}
positions = {name: text.index(marker) for name, marker in markers.items()}

# Data model, transformations, validation, tag helpers, and draft persistence.
model = text[positions["types"]:positions["set_field"]] + text[positions["row_from_card"]:positions["row_cells"]]
for name in ["BatchRow", "VerbBatchRow", "AdjectiveBatchRow", "AdverbBatchRow"]:
    model = model.replace(f"type {name} =", f"export type {name} =", 1)
model = model.replace("type BatchDraft<Row> =", "export type BatchDraft<Row> =", 1)
model_header = '''import type { CardType, Flashcard } from "./types";
import { cardTypes } from "../cardTypes";
import {
  inferArticle,
  normalizeAnswer,
  standardAdjectivePattern,
  standardNounPattern,
} from "../study/logic";

'''
Path("web/src/cards/editorModel.ts").write_text(model_header + model.rstrip() + "\n")

# Shared form fields and table row cells.
fields = text[positions["set_field"]:positions["row_from_card"]] + text[positions["row_cells"]:positions["batch_nouns"]]
fields_header = '''import type { CardType } from "../cards/types";
import {
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchRow,
  type VerbBatchRow,
} from "../cards/editorModel";

'''
Path("web/src/components/CardEditorFields.tsx").write_text(fields_header + fields.rstrip() + "\n")

# Batch-add flow.
add = text[positions["batch_nouns"]:positions["edit_modal"]]
add_header = '''import { type FormEvent, useEffect, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import { cardTypes, typeLabels } from "../cardTypes";
import {
  adjectiveCard,
  adverbCard,
  clearBatchDraft,
  emptyAdjectiveBatchRow,
  emptyAdverbBatchRow,
  emptyBatchRow,
  emptyVerbBatchRow,
  newRowId,
  normalizeNounRow,
  nounCard,
  nounFormsError,
  parseTags,
  readBatchDraft,
  readCardAdderType,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchDraft,
  type BatchRow,
  type VerbBatchRow,
  updateNounRow,
  verbCard,
  writeBatchDraft,
  writeCardAdderType,
} from "../cards/editorModel";
import {
  AdjectiveRowCells,
  AdverbRowCells,
  NounRowCells,
  SetField,
  TagsField,
  VerbRowCells,
} from "./CardEditorFields";

'''
Path("web/src/components/AddCardModal.tsx").write_text(add_header + add.rstrip() + "\n")

# The remaining components are not ordered by responsibility in the original file,
# so derive their ranges from their actual positions rather than assuming an order.
post_edit_markers = sorted([
    (positions["bulk_modal"], "bulk"),
    (positions["inventory_type"], "inventory"),
])
edit_end = post_edit_markers[0][0]
edit = text[positions["edit_modal"]:edit_end]
edit_header = '''import { type FormEvent, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import { cardTypes, typeLabels } from "../cardTypes";
import {
  adjectiveCard,
  adjectiveRowFromCard,
  adverbCard,
  adverbRowFromCard,
  deckTagPrefix,
  nounCard,
  nounFormsError,
  nounRowFromCard,
  parseTags,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchRow,
  type VerbBatchRow,
  updateNounRow,
  verbCard,
  verbRowFromCard,
  visibleTags,
} from "../cards/editorModel";
import {
  AdjectiveRowCells,
  AdverbRowCells,
  NounRowCells,
  SetField,
  TagsField,
  VerbRowCells,
} from "./CardEditorFields";

'''
Path("web/src/components/EditCardModal.tsx").write_text(edit_header + edit.rstrip() + "\n")

common_editor_model_imports = '''
  adjectiveCard,
  adjectiveRowFromCard,
  adverbCard,
  adverbRowFromCard,
  deckTagPrefix,
  nounCard,
  nounFormsError,
  nounRowFromCard,
  parseTags,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchRow,
  type VerbBatchRow,
  updateNounRow,
  verbCard,
  verbRowFromCard,
  visibleTags,
'''
common_fields_imports = '''
  AdjectiveRowCells,
  AdverbRowCells,
  NounRowCells,
  VerbRowCells,
'''

# Extract bulk and inventory whichever order they happen to occur in.
if positions["bulk_modal"] < positions["inventory_type"]:
    bulk = text[positions["bulk_modal"]:positions["inventory_type"]]
    inventory = text[positions["inventory_type"]:]
else:
    inventory = text[positions["inventory_type"]:positions["bulk_modal"]]
    bulk = text[positions["bulk_modal"]:]

bulk_header = f'''import {{ type FormEvent, useState }} from "react";
import type {{ CardType, Flashcard }} from "../cards/types";
import {{ cardTypes, typeLabels }} from "../cardTypes";
import {{{common_editor_model_imports}}} from "../cards/editorModel";
import {{{common_fields_imports}}} from "./CardEditorFields";

'''
Path("web/src/components/BulkEditCardsModal.tsx").write_text(bulk_header + bulk.rstrip() + "\n")

inventory_header = f'''import {{ type FormEvent, useEffect, useState }} from "react";
import type {{ CardType, Flashcard }} from "../cards/types";
import {{ cardTypes, typeLabels }} from "../cardTypes";
import {{{common_editor_model_imports}}} from "../cards/editorModel";
import {{{common_fields_imports}}} from "./CardEditorFields";

'''
Path("web/src/components/InventoryCardsEditor.tsx").write_text(inventory_header + inventory.rstrip() + "\n")

barrel = '''export { AddCardModal } from "./AddCardModal";
export { BulkEditCardsModal } from "./BulkEditCardsModal";
export { EditCardModal } from "./EditCardModal";
export { InventoryCardsEditor } from "./InventoryCardsEditor";
export { deckName, deckTagPrefix, localDateStamp, visibleTags } from "../cards/editorModel";
'''
path.write_text(barrel)
print("Split CardEditors.tsx into focused modules")
