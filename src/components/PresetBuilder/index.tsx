/**
 * Preset Builder — visual, form-based editor for mapping profiles.
 *
 * Designed for non-technical HR consultants who need to create or customise
 * JSON mapping profiles without editing raw JSON.  Provides five focused tabs:
 *  1. Profile Info   — name, description, author, version
 *  2. Field Mappings — rule-per-target-field configuration
 *  3. Picklist Maps  — lookup table key → value editor (the main HR use-case)
 *  4. Settings       — error-handling and date locale
 *  5. Export         — live JSON preview + download / "use in migration"
 */
import { useState, useMemo, useCallback } from 'react'
import type { Profile, Rule } from '../../engine/schema.js'
import { ProfileSchema } from '../../engine/schema.js'
import { useAppStore } from '../../store/index.js'

// ── Static field catalogue ─────────────────────────────────────────────────────
// Mirrors the template JSON files so this component needs no async template load.

interface SourceField { name: string; displayName: string; type: string }
interface TargetField {
  name: string; displayName: string; type: string
  required: boolean; allowedValues?: string[]; description?: string
}

const SF_FIELDS: SourceField[] = [
  { name: 'PERNR',          displayName: 'Personnel Number',               type: 'string'  },
  { name: 'FIRSTNAME',      displayName: 'First Name',                     type: 'string'  },
  { name: 'LASTNAME',       displayName: 'Last Name',                      type: 'string'  },
  { name: 'MIDNAME',        displayName: 'Middle Name',                    type: 'string'  },
  { name: 'PREFIX',         displayName: 'Name Prefix',                    type: 'string'  },
  { name: 'GENDER',         displayName: 'Gender',                         type: 'string'  },
  { name: 'BIRTHDT',        displayName: 'Date of Birth',                  type: 'date'    },
  { name: 'NATID',          displayName: 'National ID',                    type: 'string'  },
  { name: 'EINDT',          displayName: 'Hire Date',                      type: 'date'    },
  { name: 'AUSDT',          displayName: 'Termination Date',               type: 'date'    },
  { name: 'PERSK',          displayName: 'Employee Sub-Group (Contract)',   type: 'string'  },
  { name: 'EMPST',          displayName: 'Employment Status',              type: 'string'  },
  { name: 'VDSK1',          displayName: 'Full-Time / Part-Time',          type: 'string'  },
  { name: 'BTZEI',          displayName: 'FTE Percentage',                 type: 'decimal' },
  { name: 'ORGEH',          displayName: 'Organisational Unit ID',         type: 'string'  },
  { name: 'PLANS',          displayName: 'Position ID',                    type: 'string'  },
  { name: 'STELL',          displayName: 'Job Title',                      type: 'string'  },
  { name: 'WERKS',          displayName: 'Personnel Area (Location)',      type: 'string'  },
  { name: 'LAND1',          displayName: 'Country Code (ISO)',             type: 'string'  },
  { name: 'BUKRS',          displayName: 'Company Code',                   type: 'string'  },
  { name: 'KOSTL',          displayName: 'Cost Centre',                    type: 'string'  },
  { name: 'MANAGER_PERNR',  displayName: 'Manager Personnel Number',       type: 'string'  },
  { name: 'EMAIL',          displayName: 'Work Email Address',             type: 'string'  },
  { name: 'PHONE',          displayName: 'Work Phone Number',              type: 'string'  },
  { name: 'MONTHLY_SALARY', displayName: 'Monthly Salary',                 type: 'decimal' },
  { name: 'CURRENCY',       displayName: 'Salary Currency',                type: 'string'  },
]

const WD_FIELDS: TargetField[] = [
  { name: 'Employee_ID',      displayName: 'Employee ID',          type: 'string',   required: true  },
  { name: 'First_Name',       displayName: 'First Name',           type: 'string',   required: true  },
  { name: 'Last_Name',        displayName: 'Last Name',            type: 'string',   required: true  },
  { name: 'Middle_Name',      displayName: 'Middle Name',          type: 'string',   required: false },
  { name: 'Preferred_Name',   displayName: 'Preferred Name',       type: 'string',   required: false },
  { name: 'Gender',           displayName: 'Gender',               type: 'picklist', required: false, allowedValues: ['Male', 'Female', 'Not Declared'] },
  { name: 'Date_of_Birth',    displayName: 'Date of Birth',        type: 'date',     required: false },
  { name: 'National_ID',      displayName: 'National ID',          type: 'string',   required: false },
  { name: 'Hire_Date',        displayName: 'Hire Date',            type: 'date',     required: true  },
  { name: 'Termination_Date', displayName: 'Termination Date',     type: 'date',     required: false },
  { name: 'Contract_Type',    displayName: 'Contract Type',        type: 'picklist', required: false, allowedValues: ['Regular', 'Contractor', 'Intern', 'Temporary'] },
  { name: 'Employment_Status',displayName: 'Employment Status',    type: 'picklist', required: false, allowedValues: ['Active', 'Inactive', 'Leave of Absence'] },
  { name: 'FTE_Type',         displayName: 'FTE Type',             type: 'picklist', required: false, allowedValues: ['Full-Time', 'Part-Time'] },
  { name: 'FTE_Percent',      displayName: 'FTE %',                type: 'decimal',  required: false },
  { name: 'Organisation_Unit',displayName: 'Organisation Unit',    type: 'string',   required: false },
  { name: 'Position_ID',      displayName: 'Position ID',          type: 'string',   required: false },
  { name: 'Job_Title',        displayName: 'Job Title',            type: 'string',   required: false },
  { name: 'Location',         displayName: 'Location',             type: 'string',   required: false },
  { name: 'Country',          displayName: 'Country',              type: 'string',   required: false },
  { name: 'Company',          displayName: 'Company',              type: 'string',   required: false },
  { name: 'Cost_Center',      displayName: 'Cost Center',          type: 'string',   required: false },
  { name: 'Manager_ID',       displayName: 'Manager Employee ID',  type: 'string',   required: false },
  { name: 'Email_Address',    displayName: 'Email Address',        type: 'string',   required: false },
  { name: 'Phone_Number',     displayName: 'Phone Number',         type: 'string',   required: false },
  { name: 'Annual_Salary',    displayName: 'Annual Salary',        type: 'decimal',  required: false },
  { name: 'Salary_Currency',  displayName: 'Salary Currency',      type: 'string',   required: false },
  { name: 'Source_System',    displayName: 'Source System',        type: 'string',   required: false },
]

// ── Draft types ────────────────────────────────────────────────────────────────

type RuleType = 'skip' | 'direct' | 'constant' | 'lookup' | 'dateFormat'

interface FieldMappingDraft {
  targetField: string
  ruleType: RuleType
  // direct / lookup share sourceField
  sourceField: string
  // constant
  constantValue: string
  // lookup
  lookupTable: string
  lookupDefault: string
  lookupOnMissing: 'warn' | 'error'
  // dateFormat
  dateSourceField: string
  dateInputFormat: string
  dateOutputFormat: string
  // meta
  notes: string
}

interface LookupEntry { id: string; source: string; target: string }

interface LookupTableDraft {
  id: string
  name: string        // machine key used in fieldMappings
  displayName: string // human-readable label shown in the UI
  entries: LookupEntry[]
}

interface PresetDraft {
  profileId: string
  description: string
  version: string
  author: string
  onValidationError: 'skip' | 'halt' | 'include'
  dateLocale: string
  fieldMappings: FieldMappingDraft[]
  lookupTables: LookupTableDraft[]
}

type Tab = 'info' | 'mappings' | 'picklists' | 'settings' | 'export'

// ── Helpers ────────────────────────────────────────────────────────────────────

let _id = 0
function uid() { return `uid-${++_id}` }

function emptyMapping(targetField: string): FieldMappingDraft {
  return {
    targetField,
    ruleType: 'skip',
    sourceField: '', constantValue: '',
    lookupTable: '', lookupDefault: '', lookupOnMissing: 'warn',
    dateSourceField: '', dateInputFormat: 'YYYYMMDD', dateOutputFormat: 'MM/DD/YYYY',
    notes: '',
  }
}

function defaultDraft(): PresetDraft {
  return {
    profileId: 'my-preset',
    description: '',
    version: '1.0',
    author: '',
    onValidationError: 'skip',
    dateLocale: 'en-US',
    fieldMappings: WD_FIELDS.map(f => emptyMapping(f.name)),
    lookupTables: [],
  }
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function ruleToMappingDraft(targetField: string, rule: Rule, notes?: string): FieldMappingDraft {
  const base = emptyMapping(targetField)
  base.notes = notes ?? ''
  switch (rule.type) {
    case 'direct':
      return { ...base, ruleType: 'direct', sourceField: rule.sourceField }
    case 'constant':
      return { ...base, ruleType: 'constant', constantValue: rule.value }
    case 'lookup':
      return {
        ...base, ruleType: 'lookup', sourceField: rule.sourceField,
        lookupTable: rule.table, lookupDefault: rule.default ?? '',
        lookupOnMissing: rule.onMissing ?? 'warn',
      }
    case 'dateFormat':
      return {
        ...base, ruleType: 'dateFormat', dateSourceField: rule.sourceField,
        dateInputFormat: rule.inputFormat, dateOutputFormat: rule.outputFormat,
      }
    default:
      return base
  }
}

function mappingDraftToRule(fm: FieldMappingDraft): Rule | null {
  switch (fm.ruleType) {
    case 'direct':
      return fm.sourceField ? { type: 'direct', sourceField: fm.sourceField } : null
    case 'constant':
      return { type: 'constant', value: fm.constantValue }
    case 'lookup':
      if (!fm.sourceField || !fm.lookupTable) return null
      return {
        type: 'lookup', sourceField: fm.sourceField, table: fm.lookupTable,
        ...(fm.lookupDefault ? { default: fm.lookupDefault } : {}),
        onMissing: fm.lookupOnMissing,
      }
    case 'dateFormat':
      return fm.dateSourceField
        ? { type: 'dateFormat', sourceField: fm.dateSourceField, inputFormat: fm.dateInputFormat, outputFormat: fm.dateOutputFormat }
        : null
    case 'skip':
      return null
  }
}

function profileToDraft(profile: Profile): PresetDraft {
  const lookupTables: LookupTableDraft[] = Object.entries(profile.lookupTables).map(([name, table]) => {
    const tableEntries = Object.entries(table as Record<string, string>)
    return {
      id: uid(),
      name,
      displayName: name,
      entries: tableEntries.map(([src, tgt]: [string, string]) => ({ id: uid(), source: src, target: tgt })),
    }
  })
  const fieldMappings = WD_FIELDS.map(tf => {
    const existing = profile.fieldMappings.find((fm: { targetField: string }) => fm.targetField === tf.name)
    return existing ? ruleToMappingDraft(tf.name, existing.rule, existing.notes) : emptyMapping(tf.name)
  })
  return {
    profileId: profile.profileId,
    description: profile.description,
    version: profile.version,
    author: profile.author ?? '',
    onValidationError: profile.settings.onValidationError,
    dateLocale: profile.settings.dateLocale,
    fieldMappings,
    lookupTables,
  }
}

function draftToJsonObject(draft: PresetDraft): Record<string, unknown> {
  const today = new Date().toISOString().split('T')[0]
  const fieldMappings: unknown[] = []
  for (const fm of draft.fieldMappings) {
    const rule = mappingDraftToRule(fm)
    if (!rule) continue
    fieldMappings.push({ targetField: fm.targetField, rule, ...(fm.notes.trim() ? { notes: fm.notes.trim() } : {}) })
  }
  const lookupTables: Record<string, Record<string, string>> = {}
  for (const tbl of draft.lookupTables) {
    const entries: Record<string, string> = {}
    for (const e of tbl.entries) {
      if (e.source.trim()) entries[e.source.trim()] = e.target.trim()
    }
    lookupTables[tbl.name] = entries
  }
  return {
    profileId: draft.profileId || 'my-preset',
    description: draft.description,
    version: draft.version || '1.0',
    createdAt: today,
    updatedAt: today,
    author: draft.author,
    source: { system: 'sap-successfactors', template: 'ec-employee-export' },
    target: { system: 'workday', template: 'eib-worker' },
    settings: {
      onValidationError: draft.onValidationError,
      dateLocale: draft.dateLocale,
      emptySourceValue: ['', null, 'NULL', 'N/A', 'n/a'],
      enableExprRules: false,
    },
    lookupTables,
    fieldMappings,
  }
}

// ── Small UI helpers ───────────────────────────────────────────────────────────

function Badge({ label, colour }: { label: string; colour: string }) {
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colour}`}>{label}</span>
}

function FieldTypeTag({ type }: { type: string }) {
  const map: Record<string, string> = {
    picklist: 'bg-amber-100 text-amber-700',
    date:     'bg-blue-100 text-blue-700',
    decimal:  'bg-purple-100 text-purple-700',
    string:   'bg-gray-100 text-gray-600',
  }
  return <Badge label={type} colour={map[type] ?? 'bg-gray-100 text-gray-600'} />
}

// ── Tab: Profile Info ──────────────────────────────────────────────────────────

interface InfoTabProps {
  draft: PresetDraft
  onChange: (updates: Partial<PresetDraft>) => void
}

function InfoTab({ draft, onChange }: InfoTabProps) {
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Preset Name</label>
        <input
          type="text"
          value={draft.description}
          onChange={e => {
            const description = e.target.value
            onChange({ description, profileId: slugify(description) || 'my-preset' })
          }}
          placeholder="e.g. ACME Corp — SF to Workday Worker Load"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <p className="text-xs text-gray-400 mt-1">A human-readable name describing this preset's purpose.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Preset ID</label>
        <input
          type="text"
          value={draft.profileId}
          onChange={e => onChange({ profileId: e.target.value })}
          placeholder="acme-sf-to-wd-worker"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <p className="text-xs text-gray-400 mt-1">A short machine-readable identifier (auto-generated from the name above).</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Author</label>
        <input
          type="text"
          value={draft.author}
          onChange={e => onChange({ author: e.target.value })}
          placeholder="e.g. Jane Smith"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
        <input
          type="text"
          value={draft.version}
          onChange={e => onChange({ version: e.target.value })}
          placeholder="1.0"
          className="w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>

      <div className="pt-2 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-xs font-semibold text-blue-700 mb-1">Source & Target Systems</p>
        <p className="text-xs text-blue-600">
          This preset builder is configured for <strong>SAP SuccessFactors Employee Central → Workday EIB Worker</strong> migrations. Additional system pairs can be added in a future version.
        </p>
      </div>
    </div>
  )
}

// ── Tab: Field Mappings ────────────────────────────────────────────────────────

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  skip:       'Skip (not included)',
  direct:     'Copy as-is',
  constant:   'Fixed value',
  lookup:     'Translate (lookup table)',
  dateFormat: 'Convert date format',
}

interface MappingsTabProps {
  draft: PresetDraft
  onUpdateMapping: (targetField: string, updates: Partial<FieldMappingDraft>) => void
}

function MappingsTab({ draft, onUpdateMapping }: MappingsTabProps) {
  const [filter, setFilter] = useState<'all' | 'mapped' | 'skipped' | 'required'>('all')
  const [expandedField, setExpandedField] = useState<string | null>(null)

  const visible = useMemo(() => {
    return draft.fieldMappings.filter(fm => {
      const tf = WD_FIELDS.find(f => f.name === fm.targetField)
      if (filter === 'mapped')   return fm.ruleType !== 'skip'
      if (filter === 'skipped')  return fm.ruleType === 'skip'
      if (filter === 'required') return tf?.required
      return true
    })
  }, [draft.fieldMappings, filter])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {(['all', 'required', 'mapped', 'skipped'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={[
                'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              ].join(' ')}
            >
              {f === 'all' ? `All (${draft.fieldMappings.length})`
                : f === 'required' ? `Required (${WD_FIELDS.filter(f => f.required).length})`
                : f === 'mapped' ? `Mapped (${draft.fieldMappings.filter(m => m.ruleType !== 'skip').length})`
                : `Skipped (${draft.fieldMappings.filter(m => m.ruleType === 'skip').length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {visible.map(fm => {
          const tf = WD_FIELDS.find(f => f.name === fm.targetField)!
          const isExpanded = expandedField === fm.targetField
          const isMapped = fm.ruleType !== 'skip'

          return (
            <div
              key={fm.targetField}
              className={[
                'border rounded-xl transition-colors',
                isMapped ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white',
              ].join(' ')}
            >
              {/* Row header */}
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
                onClick={() => setExpandedField(isExpanded ? null : fm.targetField)}
              >
                <span className={[
                  'w-2 h-2 rounded-full flex-shrink-0',
                  isMapped ? 'bg-green-500' : 'bg-gray-300',
                ].join(' ')} />
                <span className="flex-1 text-sm font-medium text-gray-800">{tf.displayName}</span>
                <div className="flex items-center gap-2 mr-2">
                  {tf.required && <Badge label="Required" colour="bg-red-100 text-red-600" />}
                  <FieldTypeTag type={tf.type} />
                  <span className="text-xs text-gray-500 font-mono">{RULE_TYPE_LABELS[fm.ruleType]}</span>
                </div>
                <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
              </button>

              {/* Expanded config */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
                  {/* Rule type picker */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Rule type</label>
                    <select
                      value={fm.ruleType}
                      onChange={e => onUpdateMapping(fm.targetField, { ruleType: e.target.value as RuleType })}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    >
                      {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>

                  {/* Rule-specific fields */}
                  {fm.ruleType === 'direct' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Source column (SuccessFactors)</label>
                      <select
                        value={fm.sourceField}
                        onChange={e => onUpdateMapping(fm.targetField, { sourceField: e.target.value })}
                        className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      >
                        <option value="">— choose a column —</option>
                        {SF_FIELDS.map(sf => (
                          <option key={sf.name} value={sf.name}>
                            {sf.displayName} ({sf.name})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {fm.ruleType === 'constant' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Fixed value (same for every employee)</label>
                      <input
                        type="text"
                        value={fm.constantValue}
                        onChange={e => onUpdateMapping(fm.targetField, { constantValue: e.target.value })}
                        placeholder="e.g. SuccessFactors"
                        className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                    </div>
                  )}

                  {fm.ruleType === 'lookup' && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Source column (SuccessFactors)</label>
                        <select
                          value={fm.sourceField}
                          onChange={e => onUpdateMapping(fm.targetField, { sourceField: e.target.value })}
                          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        >
                          <option value="">— choose a column —</option>
                          {SF_FIELDS.map(sf => (
                            <option key={sf.name} value={sf.name}>
                              {sf.displayName} ({sf.name})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Translation table to use</label>
                        <select
                          value={fm.lookupTable}
                          onChange={e => onUpdateMapping(fm.targetField, { lookupTable: e.target.value })}
                          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        >
                          <option value="">— choose a table —</option>
                          {draft.lookupTables.map(tbl => (
                            <option key={tbl.id} value={tbl.name}>{tbl.displayName} ({tbl.name})</option>
                          ))}
                        </select>
                        {draft.lookupTables.length === 0 && (
                          <p className="text-xs text-amber-600 mt-1">
                            No translation tables yet — add them in the "Picklist Maps" tab.
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Fallback value (if code not found in table)</label>
                        <input
                          type="text"
                          value={fm.lookupDefault}
                          onChange={e => onUpdateMapping(fm.targetField, { lookupDefault: e.target.value })}
                          placeholder="Leave empty to use no fallback"
                          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        />
                      </div>
                      {tf.allowedValues && (
                        <p className="text-xs text-gray-500">
                          Valid Workday values: {tf.allowedValues.map(v => <code key={v} className="mx-0.5 bg-gray-100 px-1 rounded">{v}</code>)}
                        </p>
                      )}
                    </div>
                  )}

                  {fm.ruleType === 'dateFormat' && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Source date column</label>
                        <select
                          value={fm.dateSourceField}
                          onChange={e => onUpdateMapping(fm.targetField, { dateSourceField: e.target.value })}
                          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        >
                          <option value="">— choose a column —</option>
                          {SF_FIELDS.filter(f => f.type === 'date' || f.type === 'string').map(sf => (
                            <option key={sf.name} value={sf.name}>
                              {sf.displayName} ({sf.name})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Input format (SF)</label>
                          <select
                            value={fm.dateInputFormat}
                            onChange={e => onUpdateMapping(fm.targetField, { dateInputFormat: e.target.value })}
                            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          >
                            <option value="YYYYMMDD">YYYYMMDD (e.g. 19900115)</option>
                            <option value="DD.MM.YYYY">DD.MM.YYYY (e.g. 15.01.1990)</option>
                            <option value="MM/DD/YYYY">MM/DD/YYYY (e.g. 01/15/1990)</option>
                            <option value="YYYY-MM-DD">YYYY-MM-DD (e.g. 1990-01-15)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Output format (Workday)</label>
                          <select
                            value={fm.dateOutputFormat}
                            onChange={e => onUpdateMapping(fm.targetField, { dateOutputFormat: e.target.value })}
                            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          >
                            <option value="MM/DD/YYYY">MM/DD/YYYY (e.g. 01/15/1990)</option>
                            <option value="YYYY-MM-DD">YYYY-MM-DD (e.g. 1990-01-15)</option>
                            <option value="DD/MM/YYYY">DD/MM/YYYY (e.g. 15/01/1990)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional, for your reference)</label>
                    <input
                      type="text"
                      value={fm.notes}
                      onChange={e => onUpdateMapping(fm.targetField, { notes: e.target.value })}
                      placeholder="e.g. Client-specific mapping, verified with HR team"
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Tab: Picklist Maps ────────────────────────────────────────────────────────

interface PicklistsTabProps {
  draft: PresetDraft
  onAddTable: (name: string, displayName: string) => void
  onRemoveTable: (id: string) => void
  onUpdateTable: (id: string, updates: Partial<LookupTableDraft>) => void
  onAddEntry: (tableId: string) => void
  onUpdateEntry: (tableId: string, entryId: string, field: 'source' | 'target', value: string) => void
  onRemoveEntry: (tableId: string, entryId: string) => void
  onImportEntries: (tableId: string, tsv: string) => void
}

function PicklistsTab({
  draft, onAddTable, onRemoveTable, onUpdateTable,
  onAddEntry, onUpdateEntry, onRemoveEntry, onImportEntries,
}: PicklistsTabProps) {
  const [newTableName, setNewTableName] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [importText, setImportText] = useState<Record<string, string>>({})
  const [showImport, setShowImport] = useState<Record<string, boolean>>({})

  // Which Workday picklist fields reference each lookup table
  const tableToPicklistAllowed = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const fm of draft.fieldMappings) {
      if (fm.ruleType !== 'lookup' || !fm.lookupTable) continue
      const tf = WD_FIELDS.find(f => f.name === fm.targetField)
      if (tf?.allowedValues) {
        map[fm.lookupTable] = tf.allowedValues
      }
    }
    return map
  }, [draft.fieldMappings])

  const handleAddTable = () => {
    const trimmed = newTableName.trim()
    if (!trimmed) return
    const name = slugify(trimmed) || trimmed.replace(/\s+/g, '_').toLowerCase()
    onAddTable(name, trimmed)
    setNewTableName('')
    setShowAddForm(false)
  }

  const handleImport = (tableId: string) => {
    const text = importText[tableId] ?? ''
    onImportEntries(tableId, text)
    setImportText(prev => ({ ...prev, [tableId]: '' }))
    setShowImport(prev => ({ ...prev, [tableId]: false }))
  }

  return (
    <div className="space-y-6">
      {/* Hint banner */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <p className="text-sm font-medium text-amber-800 mb-1">About Picklist Maps (Translation Tables)</p>
        <p className="text-xs text-amber-700">
          SuccessFactors often stores values as codes (e.g. <code className="bg-amber-100 px-1 rounded">M</code>, <code className="bg-amber-100 px-1 rounded">F</code>) that Workday does not understand.
          Create a translation table here to map each source code to the correct Workday label.
          Reference the table from the <strong>Field Mappings</strong> tab using the "Translate" rule.
        </p>
      </div>

      {/* Quick-add for picklist target fields */}
      {WD_FIELDS.filter(f => f.type === 'picklist').some(f => {
        const fm = draft.fieldMappings.find(m => m.targetField === f.name)
        return fm?.ruleType === 'lookup' && fm.lookupTable && !draft.lookupTables.find(t => t.name === fm.lookupTable)
      }) && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs text-red-700">
            Some field mappings reference translation tables that have not been created yet. Add the missing tables below.
          </p>
        </div>
      )}

      {/* Existing tables */}
      {draft.lookupTables.map(tbl => {
        const allowedValues = tableToPicklistAllowed[tbl.name]
        return (
          <div key={tbl.id} className="border border-gray-200 rounded-xl bg-white">
            {/* Table header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div>
                <input
                  type="text"
                  value={tbl.displayName}
                  onChange={e => onUpdateTable(tbl.id, { displayName: e.target.value })}
                  className="font-semibold text-sm text-gray-800 border-0 border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none bg-transparent"
                />
                <span className="text-xs text-gray-400 font-mono ml-2">({tbl.name})</span>
              </div>
              <button
                onClick={() => onRemoveTable(tbl.id)}
                className="text-xs text-red-400 hover:text-red-600 transition-colors"
              >
                Remove table
              </button>
            </div>

            {/* Allowed values hint */}
            {allowedValues && (
              <div className="px-4 py-2 bg-blue-50 border-b border-blue-100">
                <p className="text-xs text-blue-700">
                  Valid Workday values for this table:&nbsp;
                  {allowedValues.map(v => (
                    <code key={v} className="mx-0.5 bg-blue-100 px-1 rounded">{v}</code>
                  ))}
                </p>
              </div>
            )}

            {/* Entries table */}
            <div className="px-4 py-3">
              {tbl.entries.length > 0 ? (
                <div className="space-y-1.5 mb-3">
                  {/* Header row */}
                  <div className="grid grid-cols-[1fr_24px_1fr_32px] gap-2 mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">SuccessFactors value</span>
                    <span />
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Workday value</span>
                    <span />
                  </div>
                  {tbl.entries.map(entry => (
                    <div key={entry.id} className="grid grid-cols-[1fr_24px_1fr_32px] gap-2 items-center">
                      <input
                        type="text"
                        value={entry.source}
                        onChange={e => onUpdateEntry(tbl.id, entry.id, 'source', e.target.value)}
                        placeholder="Source code (e.g. M)"
                        className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                      <span className="text-center text-gray-400 text-sm">→</span>
                      {allowedValues ? (
                        <select
                          value={entry.target}
                          onChange={e => onUpdateEntry(tbl.id, entry.id, 'target', e.target.value)}
                          className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        >
                          <option value="">— choose —</option>
                          {allowedValues.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={entry.target}
                          onChange={e => onUpdateEntry(tbl.id, entry.id, 'target', e.target.value)}
                          placeholder="Target value"
                          className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        />
                      )}
                      <button
                        onClick={() => onRemoveEntry(tbl.id, entry.id)}
                        className="text-gray-300 hover:text-red-400 transition-colors text-sm font-medium"
                        title="Remove row"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 mb-3 text-center py-2">
                  No entries yet — add rows below or import from a spreadsheet.
                </p>
              )}

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => onAddEntry(tbl.id)}
                  className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors font-medium"
                >
                  + Add row
                </button>
                <button
                  onClick={() => setShowImport(prev => ({ ...prev, [tbl.id]: !prev[tbl.id] }))}
                  className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors font-medium"
                >
                  Import from spreadsheet…
                </button>
              </div>

              {/* Import panel */}
              {showImport[tbl.id] && (
                <div className="mt-3 p-3 border border-blue-200 bg-blue-50 rounded-lg">
                  <p className="text-xs text-blue-700 mb-2 font-medium">
                    Paste two columns from Excel or Google Sheets (tab-separated: source value, then Workday value):
                  </p>
                  <textarea
                    value={importText[tbl.id] ?? ''}
                    onChange={e => setImportText(prev => ({ ...prev, [tbl.id]: e.target.value }))}
                    placeholder={'M\tMale\nF\tFemale\nU\tNot Declared'}
                    rows={5}
                    className="w-full border border-blue-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleImport(tbl.id)}
                      className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Import rows
                    </button>
                    <button
                      onClick={() => setShowImport(prev => ({ ...prev, [tbl.id]: false }))}
                      className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Add new table */}
      {showAddForm ? (
        <div className="border border-dashed border-blue-300 rounded-xl p-4 bg-blue-50">
          <p className="text-sm font-medium text-blue-800 mb-3">New translation table</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newTableName}
              onChange={e => setNewTableName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddTable()}
              placeholder="e.g. Gender Codes, Location Codes, Org Units…"
              autoFocus
              className="flex-1 border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
            <button
              onClick={handleAddTable}
              disabled={!newTableName.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewTableName('') }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-blue-600 mt-2">
            Give the table a descriptive name. A machine key will be generated automatically.
          </p>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full border-2 border-dashed border-gray-300 rounded-xl py-4 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors font-medium"
        >
          + Add translation table
        </button>
      )}
    </div>
  )
}

// ── Tab: Settings ─────────────────────────────────────────────────────────────

interface SettingsTabProps {
  draft: PresetDraft
  onChange: (updates: Partial<PresetDraft>) => void
}

function SettingsTab({ draft, onChange }: SettingsTabProps) {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          What should happen when a row has a validation error?
        </label>
        <div className="space-y-2">
          {([
            { value: 'skip',    label: 'Skip the row',              desc: 'Rows with errors are excluded from the output file. Safest option for clean imports.' },
            { value: 'include', label: 'Include with error column', desc: 'All rows are included. A "__Errors" column is added so you can review issues in the output.' },
            { value: 'halt',    label: 'Stop the whole migration',  desc: 'If any row has an error, the entire transformation is aborted. Use only if you need zero errors.' },
          ] as const).map(opt => (
            <label key={opt.value} className={[
              'flex gap-3 p-3 border rounded-xl cursor-pointer transition-colors',
              draft.onValidationError === opt.value
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300',
            ].join(' ')}>
              <input
                type="radio"
                name="onValidationError"
                value={opt.value}
                checked={draft.onValidationError === opt.value}
                onChange={() => onChange({ onValidationError: opt.value })}
                className="mt-0.5 shrink-0"
              />
              <div>
                <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Date locale</label>
        <select
          value={draft.dateLocale}
          onChange={e => onChange({ dateLocale: e.target.value })}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          <option value="en-US">English (US) — en-US</option>
          <option value="en-GB">English (UK) — en-GB</option>
          <option value="de-DE">German — de-DE</option>
          <option value="fr-FR">French — fr-FR</option>
          <option value="es-ES">Spanish — es-ES</option>
          <option value="nl-NL">Dutch — nl-NL</option>
        </select>
        <p className="text-xs text-gray-400 mt-1">
          Used when parsing ambiguous date values from the source file.
        </p>
      </div>
    </div>
  )
}

// ── Tab: Export ───────────────────────────────────────────────────────────────

interface ExportTabProps {
  draft: PresetDraft
  generatedJson: string | null
  onDownload: () => void
  onUseInMigration: () => void
  exportError: string | null
}

function ExportTab({ draft, generatedJson, onDownload, onUseInMigration, exportError }: ExportTabProps) {
  const [copied, setCopied] = useState(false)

  const mappedCount  = draft.fieldMappings.filter(fm => fm.ruleType !== 'skip').length
  const skippedCount = draft.fieldMappings.filter(fm => fm.ruleType === 'skip').length
  const requiredMissing = WD_FIELDS.filter(tf => tf.required).filter(tf => {
    const fm = draft.fieldMappings.find(m => m.targetField === tf.name)
    return !fm || fm.ruleType === 'skip'
  })

  const handleCopy = () => {
    if (!generatedJson) return
    navigator.clipboard.writeText(generatedJson).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{mappedCount}</p>
          <p className="text-xs text-gray-500 mt-1">Fields mapped</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-400">{skippedCount}</p>
          <p className="text-xs text-gray-500 mt-1">Fields skipped</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-amber-500">{draft.lookupTables.length}</p>
          <p className="text-xs text-gray-500 mt-1">Translation tables</p>
        </div>
      </div>

      {/* Warnings */}
      {requiredMissing.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs font-semibold text-amber-800 mb-1">Required fields not yet mapped</p>
          <p className="text-xs text-amber-700">
            {requiredMissing.map(f => f.displayName).join(', ')} — these are required by Workday and must be mapped before running a migration.
          </p>
        </div>
      )}

      {exportError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs font-semibold text-red-700 mb-1">Validation error</p>
          <p className="text-xs text-red-600 font-mono whitespace-pre-wrap">{exportError}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={onDownload}
          disabled={!generatedJson}
          className="px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          Download JSON preset
        </button>
        <button
          onClick={onUseInMigration}
          disabled={!generatedJson}
          className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          Load into Migration →
        </button>
        <button
          onClick={handleCopy}
          disabled={!generatedJson}
          className="px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy JSON'}
        </button>
      </div>

      {/* JSON preview */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Generated JSON preview</p>
        <pre className="bg-gray-900 text-green-300 text-xs font-mono rounded-xl p-4 overflow-auto max-h-96 leading-relaxed">
          {generatedJson ?? '(error generating JSON)'}
        </pre>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PresetBuilder() {
  const setProfile = useAppStore(s => s.setProfile)
  const setAppMode = useAppStore(s => s.setAppMode)

  const [activeTab, setActiveTab] = useState<Tab>('info')
  const [draft, setDraft] = useState<PresetDraft>(defaultDraft())
  const [isLoadingStarter, setIsLoadingStarter] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  // Load the built-in starter profile as a baseline
  const loadStarter = useCallback(async () => {
    setIsLoadingStarter(true)
    setLoadError(null)
    try {
      const resp = await fetch('/profiles/sf-to-wd/ec-worker-to-eib-worker.json')
      if (!resp.ok) throw new Error('Could not load starter profile.')
      const raw = await resp.json()
      const parsed = ProfileSchema.parse(raw)
      setDraft(profileToDraft(parsed))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load.')
    } finally {
      setIsLoadingStarter(false)
    }
  }, [])

  const resetToBlank = useCallback(() => { setDraft(defaultDraft()) }, [])

  // Draft mutation helpers
  const updateDraft = useCallback((updates: Partial<PresetDraft>) => {
    setDraft(prev => ({ ...prev, ...updates }))
  }, [])

  const updateMapping = useCallback((targetField: string, updates: Partial<FieldMappingDraft>) => {
    setDraft(prev => ({
      ...prev,
      fieldMappings: prev.fieldMappings.map(fm =>
        fm.targetField === targetField ? { ...fm, ...updates } : fm
      ),
    }))
  }, [])

  const addLookupTable = useCallback((name: string, displayName: string) => {
    setDraft(prev => ({
      ...prev,
      lookupTables: [...prev.lookupTables, { id: uid(), name, displayName, entries: [] }],
    }))
  }, [])

  const removeLookupTable = useCallback((id: string) => {
    setDraft(prev => ({ ...prev, lookupTables: prev.lookupTables.filter(t => t.id !== id) }))
  }, [])

  const updateLookupTable = useCallback((id: string, updates: Partial<LookupTableDraft>) => {
    setDraft(prev => ({
      ...prev,
      lookupTables: prev.lookupTables.map(t => t.id === id ? { ...t, ...updates } : t),
    }))
  }, [])

  const addLookupEntry = useCallback((tableId: string) => {
    setDraft(prev => ({
      ...prev,
      lookupTables: prev.lookupTables.map(t =>
        t.id === tableId ? { ...t, entries: [...t.entries, { id: uid(), source: '', target: '' }] } : t
      ),
    }))
  }, [])

  const updateLookupEntry = useCallback((tableId: string, entryId: string, field: 'source' | 'target', value: string) => {
    setDraft(prev => ({
      ...prev,
      lookupTables: prev.lookupTables.map(t =>
        t.id === tableId
          ? { ...t, entries: t.entries.map(e => e.id === entryId ? { ...e, [field]: value } : e) }
          : t
      ),
    }))
  }, [])

  const removeLookupEntry = useCallback((tableId: string, entryId: string) => {
    setDraft(prev => ({
      ...prev,
      lookupTables: prev.lookupTables.map(t =>
        t.id === tableId ? { ...t, entries: t.entries.filter(e => e.id !== entryId) } : t
      ),
    }))
  }, [])

  const importEntries = useCallback((tableId: string, tsv: string) => {
    const entries: LookupEntry[] = tsv.split('\n').flatMap(line => {
      const parts = line.split('\t')
      if (parts.length < 2) return []
      const [source, target] = parts
      if (!source.trim()) return []
      return [{ id: uid(), source: source.trim(), target: target.trim() }]
    })
    setDraft(prev => ({
      ...prev,
      lookupTables: prev.lookupTables.map(t =>
        t.id === tableId ? { ...t, entries: [...t.entries, ...entries] } : t
      ),
    }))
  }, [])

  // Generate JSON
  const generatedJson = useMemo(() => {
    try { return JSON.stringify(draftToJsonObject(draft), null, 2) } catch { return null }
  }, [draft])

  // Download
  const downloadJson = useCallback(() => {
    if (!generatedJson) return
    const blob = new Blob([generatedJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${draft.profileId || 'preset'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [generatedJson, draft.profileId])

  // Use in migration
  const useInMigration = useCallback(() => {
    if (!generatedJson) return
    setExportError(null)
    try {
      const raw = JSON.parse(generatedJson)
      const parsed = ProfileSchema.parse(raw)
      setProfile(parsed, null)
      setAppMode('migrate')
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Invalid profile — check required fields.')
    }
  }, [generatedJson, setProfile, setAppMode])

  // ── Render ───────────────────────────────────────────────────────────────────

  const TABS: { id: Tab; label: string }[] = [
    { id: 'info',      label: 'Profile Info'   },
    { id: 'mappings',  label: 'Field Mappings' },
    { id: 'picklists', label: 'Picklist Maps'  },
    { id: 'settings',  label: 'Settings'       },
    { id: 'export',    label: 'Export'         },
  ]

  const mappedCount = draft.fieldMappings.filter(fm => fm.ruleType !== 'skip').length

  return (
    <div className="flex flex-col h-full">
      {/* Preset Builder sub-header */}
      <div className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">
            Preset Builder
            {draft.description && (
              <span className="ml-2 text-gray-400 font-normal">— {draft.description}</span>
            )}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {mappedCount} of {WD_FIELDS.length} fields mapped · {draft.lookupTables.length} translation tables
          </p>
        </div>

        <div className="flex gap-2 items-center">
          {/* Starter / blank buttons */}
          {isLoadingStarter ? (
            <span className="text-xs text-gray-400">Loading…</span>
          ) : (
            <>
              <button
                onClick={loadStarter}
                className="px-3 py-1.5 text-xs border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors font-medium"
              >
                Load starter profile
              </button>
              <button
                onClick={resetToBlank}
                className="px-3 py-1.5 text-xs border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Start blank
              </button>
            </>
          )}
          {loadError && <span className="text-xs text-red-500">{loadError}</span>}
        </div>
      </div>

      {/* Tab bar */}
      <nav className="bg-gray-50 border-b px-6">
        <ol className="flex">
          {TABS.map((tab, idx) => (
            <li key={tab.id}>
              <button
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'px-4 py-3 text-sm transition-colors',
                  activeTab === tab.id
                    ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                <span className={[
                  'w-5 h-5 rounded-full text-xs font-semibold inline-flex items-center justify-center mr-1.5',
                  activeTab === tab.id ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500',
                ].join(' ')}>
                  {idx + 1}
                </span>
                {tab.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {/* Tab content */}
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto">
          {activeTab === 'info' && (
            <InfoTab draft={draft} onChange={updateDraft} />
          )}
          {activeTab === 'mappings' && (
            <MappingsTab draft={draft} onUpdateMapping={updateMapping} />
          )}
          {activeTab === 'picklists' && (
            <PicklistsTab
              draft={draft}
              onAddTable={addLookupTable}
              onRemoveTable={removeLookupTable}
              onUpdateTable={updateLookupTable}
              onAddEntry={addLookupEntry}
              onUpdateEntry={updateLookupEntry}
              onRemoveEntry={removeLookupEntry}
              onImportEntries={importEntries}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsTab draft={draft} onChange={updateDraft} />
          )}
          {activeTab === 'export' && (
            <ExportTab
              draft={draft}
              generatedJson={generatedJson}
              onDownload={downloadJson}
              onUseInMigration={useInMigration}
              exportError={exportError}
            />
          )}
        </div>
      </main>
    </div>
  )
}
