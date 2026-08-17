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

model = text[positions["types"]:positions["set_field"]] + text[positions["row_from_card"]:positions["row_cells"]]
for name in ["BatchRow", "VerbBatchRow", "AdjectiveBatchRow", "AdverbBatchRow", "BatchDraft"]:
    model = model.replace(f"type {name} =", f"export type {name} =", 1)
model_header = '''import type { CardType, Flashcard } from "./types";
import { cardTypes } from "../cardTypes";
import {
  inferArticle,
  normalizeAnswer,
  standardAdjectivePattern,
  standardNounPattern,
} from "../study/logic";

'''
model_path = Path("web/src/cards/editorModel.ts")
model_path.write_text(model_header + model.rstrip() + "\n")

fields = text[positions["set_field"]:positions["row_from_card"]] + text[positions["row_cells"]:positions["batch_nouns"]]
fields_header = '''import type { CardType } from "../cards/types";
import {
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchRow,
  type VerbBatchRow,
  updateNounRow,
} from "../cards/editorModel";

'''
Path("web/src/components/CardEditorFields.tsx").write_text(fields_header + fields.rstrip() + "\n")

add = text[positions["batch_nouns"]:positions["edit_modal"]]
add_header = '''import { type FormEvent, useEffect, useState } from "react";
import type { Flashcard } from "../cards/types";
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

edit = text[positions["edit_modal"]:positions["inventory_type"]]
edit_header = '''import { type FormEvent, useState } from "react";
import type { Flashcard } from "../cards/types";
import { typeLabels } from "../cardTypes";
import {
  adjectiveRowFromCard,
  adverbRowFromCard,
  nounCard,
  nounFormsError,
  nounRowFromCard,
  parseTags,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchRow,
  type VerbBatchRow,
  updateNounRow,
  verbRowFromCard,
  visibleTags,
  deckTagPrefix,
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

inventory = text[positions["inventory_type"]:positions["bulk_modal"]]
inventory_header = '''import { type FormEvent, useEffect, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import { cardTypes, typeLabels } from "../cardTypes";
import {
  adjectiveCard,
  adjectiveRowFromCard,
  adverbCard,
  adverbRowFromCard,
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
  deckTagPrefix,
} from "../cards/editorModel";
import {
  AdjectiveRowCells,
  AdverbRowCells,
  NounRowCells,
  VerbRowCells,
} from "./CardEditorFields";

'''
Path("web/src/components/InventoryCardsEditor.tsx").write_text(inventory_header + inventory.rstrip() + "\n")

bulk = text[positions["bulk_modal"]:]
bulk_header = '''import { useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import { cardTypes, typeLabels } from "../cardTypes";
import {
  adjectiveCard,
  adjectiveRowFromCard,
  adverbCard,
  adverbRowFromCard,
  nounCard,
  nounFormsError,
  nounRowFromCard,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchRow,
  type VerbBatchRow,
  updateNounRow,
  verbCard,
  verbRowFromCard,
} from "../cards/editorModel";
import {
  AdjectiveRowCells,
  AdverbRowCells,
  NounRowCells,
  VerbRowCells,
} from "./CardEditorFields";

'''
Path("web/src/components/BulkEditCardsModal.tsx").write_text(bulk_header + bulk.rstrip() + "\n")

barrel = '''export { AddCardModal } from "./AddCardModal";
export { BulkEditCardsModal } from "./BulkEditCardsModal";
export { EditCardModal } from "./EditCardModal";
export { InventoryCardsEditor } from "./InventoryCardsEditor";
export { deckName, deckTagPrefix, localDateStamp, visibleTags } from "../cards/editorModel";
'''
path.write_text(barrel)
print("Split CardEditors.tsx into focused modules")
