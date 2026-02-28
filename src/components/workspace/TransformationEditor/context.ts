import { createContext } from 'react'
import type { FieldMapping, ObjectField } from '../../../types/index.js'

export interface EditorContextValue {
  /** All field mappings for this transformation, keyed by targetFieldId. */
  mappingsByTargetFieldId: Record<string, FieldMapping>
  /** Called when user clicks the ⚙ button on a target field row. */
  onTargetFieldClick: (targetObjectId: string, field: ObjectField, mapping: FieldMapping | undefined) => void
}

export const EditorContext = createContext<EditorContextValue | null>(null)
